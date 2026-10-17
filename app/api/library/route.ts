import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import {
  cleanLibraryBody,
  cleanLibraryBranch,
  cleanLibraryList,
  cleanLibraryPlatforms,
  cleanLibraryTags,
  cleanLibraryOrder,
  cleanLibraryStage,
  cleanLibraryText,
  defaultCollection,
  isLibraryCollection,
  hasUnsupportedLibraryPlatforms,
  libraryKind,
  libraryOrderKey,
  libraryVersionStatement,
  type LibraryCollection,
} from '@/lib/library';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { TEMPLATE_SCRIPTS } from '@/lib/script-fields';
import { subjectSearchVariants } from '@/lib/subjects';
import { businessDate } from '@/lib/business-time';
import { revisionCacheRequest, matchRevisionJson, putRevisionJson } from '@/lib/revision-cache';
import { normalizeUnicodeSearchText, unicodeSearchMatchesAny } from '@/lib/unicode-search';

const KINDS = new Set(['advertisement', 'script']);
const REQUEST_MAX_BYTES = 64 * 1024;

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || 'advertisement';
  const collectionText = url.searchParams.get('collection') || '';
  const archived = url.searchParams.get('archived') === 'true';
  const search = (url.searchParams.get('search') || '').trim().slice(0, 120);
  if (kind !== 'all' && !KINDS.has(kind)) return Response.json({ error: 'Невідомий тип матеріалу.' }, { status: 400 });
  if (collectionText && !isLibraryCollection(collectionText)) return Response.json({ error: 'Невідома колекція.' }, { status: 400 });
  const collection = collectionText as LibraryCollection | '';
  const normalizedSearch=normalizeUnicodeSearchText(search);
  const subjectTerms=subjectSearchVariants(search).map(normalizeUnicodeSearchText);
  const today=businessDate(Math.floor(Date.now()/1000));
  const cacheRequest=await revisionCacheRequest(env.DB,user.id,'library',`unicode-v2:${kind}:${collection}:${archived ? 1 : 0}:${search}:${today}`);
  const cached=await matchRevisionJson(cacheRequest);
  if(cached)return cached;
  const libraryLimit=normalizedSearch?'':' LIMIT 200';
  const [itemsResult,usageResult,orderResult] = await env.DB.batch([
    env.DB.prepare(`SELECT id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch,origin_id,template_key,archived_at,created_at,updated_at
      FROM library_items WHERE user_id=?1
        AND ((?2=0 AND archived_at IS NULL) OR (?2=1 AND archived_at IS NOT NULL))
        AND (?3='' OR collection=?3)
        AND (?4='all' OR kind=?4)
        AND NOT (?4='script' AND ?3='' AND collection='knowledge')
      ORDER BY updated_at DESC,title${libraryLimit}`).bind(user.id,Number(archived),collection,kind),
    env.DB.prepare(`SELECT p.advertisement_id,p.platform
      FROM chat_publications p
      WHERE p.user_id=?1 AND p.published_on=?2 AND p.advertisement_id IS NOT NULL
      GROUP BY p.advertisement_id,p.platform`).bind(user.id,today),
    env.DB.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1`)
      .bind(user.id,collection?libraryOrderKey(collection):'library_order_none'),
  ]);
  let order:string[]=[];
  try{order=cleanLibraryOrder(JSON.parse(((orderResult.results[0] as {value_json?:string}|undefined)?.value_json)||'[]'));}catch{order=[];}
  const usageByAdvertisement=new Map<string,string[]>();
  for(const row of usageResult.results as Array<{advertisement_id:string;platform:string}>){
    const platforms=usageByAdvertisement.get(row.advertisement_id)||[];
    platforms.push(row.platform);usageByAdvertisement.set(row.advertisement_id,platforms);
  }
  const libraryRows=(itemsResult.results as LibraryRow[])
    .filter(row=>!normalizedSearch
      ||unicodeSearchMatchesAny([row.title,row.uk_text,row.ru_text,row.notes,row.tags_json],normalizedSearch)
      ||subjectTerms.some(term=>unicodeSearchMatchesAny([row.tags_json],term)))
    .slice(0,200);
  const payload={ items: libraryRows.map(row=>publicItem(row,usageByAdvertisement.get(row.id)||[])), order, businessDate:today };
  await putRevisionJson(cacheRequest,payload,120);
  return Response.json(payload,{headers:{'Cache-Control':'no-store','X-Work-OS-Cache':'MISS'}});
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed;
  const action = typeof body.action === 'string' ? body.action : 'save';
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const now = Math.floor(Date.now() / 1000);

  if (action === 'archive' || action === 'restore') {
    if (!id) return Response.json({ error: 'Матеріал не знайдено.' }, { status: 400 });
    const expectedVersion = positiveInteger(body.version);
    if (!expectedVersion) return Response.json({ error: 'Оновіть бібліотеку перед зміною матеріалу.' }, { status: 409 });
    const nextVersion = expectedVersion + 1;
    const condition = action === 'archive' ? 'archived_at IS NULL' : 'archived_at IS NOT NULL';
    const archivedAt = action === 'archive' ? now : null;
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE library_items SET archived_at=?1,updated_at=?2,version=version+1
        WHERE id=?3 AND user_id=?4 AND version=?5 AND ${condition}`)
        .bind(archivedAt,now,id,user.id,expectedVersion),
      libraryVersionStatement(env.DB,{userId:user.id,itemId:id,action,expectedVersion:nextVersion,savedAt:now}),
    ]);
    return results[0].meta.changes
      ? Response.json({ ok: true, id, version: nextVersion, updatedAt: now })
      : Response.json({ error: 'Матеріал уже змінився. Оновіть бібліотеку.' }, { status: 409 });
  }
  if (action === 'order') {
    const target = isLibraryCollection(body.collection) ? body.collection : null;
    if (!target) return Response.json({ error: 'Невідома колекція.' }, { status: 400 });
    const ids = cleanLibraryOrder(body.ids);
    await env.DB.prepare(`INSERT INTO user_settings (user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
      ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,source_import_id=NULL,updated_at=excluded.updated_at WHERE user_settings.user_id=excluded.user_id`)
      .bind(user.id, libraryOrderKey(target), JSON.stringify(ids), now).run();
    return Response.json({ ok: true });
  }
  if (action === 'copy_personal') {
    if (!id) return Response.json({ error: 'Скрипт не знайдено.' }, { status: 400 });
    const existing = await env.DB.prepare(`SELECT id FROM library_items WHERE user_id=?1 AND origin_id=?2 AND collection='personal_script' AND archived_at IS NULL LIMIT 1`).bind(user.id, id).first<{ id: string }>();
    if (existing) return Response.json({ ok: true, id: existing.id, existing: true });
    const source = await env.DB.prepare(`SELECT title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch FROM library_items WHERE id=?1 AND user_id=?2 AND collection='official_script' LIMIT 1`).bind(id, user.id)
      .first<{ title: string; uk_text: string; ru_text: string; notes: string; tags_json: string; platforms_json: string; stage: string | null; branch: string }>();
    if (!source) return Response.json({ error: 'Офіційний скрипт не знайдено.' }, { status: 404 });
    const copyId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch,origin_id,created_at,updated_at)
        VALUES (?1,?2,'script','personal_script',1,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)`)
        .bind(copyId, user.id, cleanLibraryText(`${source.title} · моя версія`, 200), source.uk_text, source.ru_text, source.notes, source.tags_json, source.platforms_json, source.stage, source.branch, id, now),
      libraryVersionStatement(env.DB, { userId: user.id, itemId: copyId, action: 'create', expectedVersion: 1, savedAt: now }),
    ]);
    return Response.json({ ok: true, id: copyId, existing: false });
  }
  if (action === 'seed_templates') {
    const have = await env.DB.prepare(`SELECT template_key FROM library_items WHERE user_id=?1 AND template_key IS NOT NULL`).bind(user.id).all<{ template_key: string }>();
    const present = new Set(have.results.map((row) => row.template_key));
    const missing = TEMPLATE_SCRIPTS.filter((template) => !present.has(template.key));
    if (missing.length) {
      await env.DB.batch(missing.flatMap((template) => {
        const itemId = crypto.randomUUID();
        return [
          env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch,template_key,created_at,updated_at)
            VALUES (?1,?2,'script','official_script',1,?3,?4,?5,'Шаблон із полями: поля підставляються з даних ліда й уроку.','[]','[]',?6,'',?7,?8,?8)`)
            .bind(itemId, user.id, template.title, template.ukText, template.ruText, template.stage, template.key, now),
          libraryVersionStatement(env.DB, { userId: user.id, itemId, action: 'create', expectedVersion: 1, savedAt: now }),
        ];
      }));
    }
    return Response.json({ ok: true, created: missing.length });
  }
  if (action !== 'save') return Response.json({ error: 'Невідома дія.' }, { status: 400 });

  const requestedCollection = isLibraryCollection(body.collection) ? body.collection : defaultCollection(body.kind);
  const kind = libraryKind(requestedCollection);
  const title = cleanLibraryText(body.title, 200);
  const ukText = cleanLibraryBody(body.ukText, 20000);
  const ruText = cleanLibraryBody(body.ruText, 20000);
  const notes = cleanLibraryBody(body.notes, 4000);
  if (!title) return Response.json({ error: 'Вкажіть назву матеріалу.' }, { status: 400 });
  if (kind === 'advertisement' && (!ukText.trim() || !ruText.trim()))
    return Response.json({ error: 'Для оголошення заповніть українську та російську версії.' }, { status: 400 });
  if (kind !== 'advertisement' && !ukText.trim() && !ruText.trim())
    return Response.json({ error: 'Вкажіть хоча б одну мовну версію.' }, { status: 400 });
  const tags = cleanLibraryTags(body.tags);
  if (kind === 'advertisement' && hasUnsupportedLibraryPlatforms(body.platforms))
    return Response.json({ error: 'Оберіть платформи зі списку Work OS.' }, { status: 400 });
  const platforms = kind === 'advertisement' ? cleanLibraryPlatforms(body.platforms) : cleanLibraryList(body.platforms);
  if (kind === 'advertisement' && platforms.length === 0)
    return Response.json({ error: 'Оберіть хоча б одну платформу для оголошення.' }, { status: 400 });
  const stage = kind === 'script' ? cleanLibraryStage(body.stage) : null;
  const branch = kind === 'script' ? cleanLibraryBranch(body.branch) : '';
  const itemId = id || crypto.randomUUID();

  if (id) {
    const expectedVersion = positiveInteger(body.version);
    if (!expectedVersion) return Response.json({ error: 'Оновіть бібліотеку перед редагуванням.' }, { status: 409 });
    const nextVersion = expectedVersion + 1;
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE library_items SET kind=?1,collection=?2,title=?3,uk_text=?4,ru_text=?5,notes=?6,tags_json=?7,platforms_json=?8,stage=?13,branch=?14,updated_at=?9,version=version+1
        WHERE id=?10 AND user_id=?11 AND version=?12 AND archived_at IS NULL`)
        .bind(kind,requestedCollection,title,ukText,ruText,notes,JSON.stringify(tags),JSON.stringify(platforms),now,id,user.id,expectedVersion,stage,branch),
      libraryVersionStatement(env.DB,{userId:user.id,itemId:id,action:'update',expectedVersion:nextVersion,savedAt:now}),
    ]);
    if (!results[0].meta.changes) return Response.json({ error: 'Матеріал уже змінився. Оновіть бібліотеку.' }, { status: 409 });
    return Response.json({ ok: true, id, collection:requestedCollection,kind,version:nextVersion,updatedAt:now });
  }

  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch,created_at,updated_at)
      VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,?9,?10,?12,?13,?11,?11)`)
      .bind(itemId,user.id,kind,requestedCollection,title,ukText,ruText,notes,JSON.stringify(tags),JSON.stringify(platforms),now,stage,branch),
    libraryVersionStatement(env.DB,{userId:user.id,itemId:itemId,action:'create',expectedVersion:1,savedAt:now}),
  ]);
  if (!results[0].meta.changes) return Response.json({ error: 'Не вдалося створити матеріал.' }, { status: 409 });
  return Response.json({ ok: true, id: itemId, collection:requestedCollection,kind,version:1,updatedAt:now });
}

type LibraryRow = { id: string; kind: string; collection:string; version:number; title: string; uk_text: string; ru_text: string; notes: string; tags_json: string; platforms_json: string; stage:string|null; branch:string; origin_id:string|null; template_key:string|null; archived_at:number|null; created_at: number; updated_at: number };
function publicItem(row: LibraryRow,usedTodayPlatforms:string[]) { return { id: row.id, kind: row.kind, collection:row.collection, version:Number(row.version), title: row.title, ukText: row.uk_text, ruText: row.ru_text, notes: row.notes, tags: parseList(row.tags_json), platforms: parseList(row.platforms_json), stage: row.stage, branch: row.branch||'', originId: row.origin_id, templateKey: row.template_key, usedTodayPlatforms, archivedAt:row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
function parseList(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
function positiveInteger(value:unknown){const number=Number(value);return Number.isSafeInteger(number)&&number>0?number:null;}

