import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import {
  cleanLibraryBody,
  cleanLibraryList,
  cleanLibraryPlatforms,
  cleanLibraryTags,
  cleanLibraryText,
  defaultCollection,
  isLibraryCollection,
  hasUnsupportedLibraryPlatforms,
  libraryKind,
  libraryVersionStatement,
  type LibraryCollection,
} from '@/lib/library';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
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
  const cacheRequest=await revisionCacheRequest(env.DB,user.id,'library',`${kind}:${collection}:${archived ? 1 : 0}:${search}:${today}`);
  const cached=await matchRevisionJson(cacheRequest);
  if(cached)return cached;
  const libraryLimit=normalizedSearch?'':' LIMIT 200';
  const [itemsResult,usageResult] = await env.DB.batch([
    env.DB.prepare(`SELECT id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,archived_at,created_at,updated_at
      FROM library_items WHERE user_id=?1
        AND ((?2=0 AND archived_at IS NULL) OR (?2=1 AND archived_at IS NOT NULL))
        AND (?3='' OR collection=?3)
        AND (?4='all' OR kind=?4)
        AND NOT (?4='script' AND ?3='' AND collection='knowledge')
      ORDER BY updated_at DESC,title${libraryLimit}`).bind(user.id,Number(archived),collection,kind),
    env.DB.prepare(`SELECT p.advertisement_id,c.platform
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id AND c.user_id=p.user_id
      WHERE p.user_id=?1 AND p.published_on=?2 AND p.advertisement_id IS NOT NULL
      GROUP BY p.advertisement_id,c.platform`).bind(user.id,today),
  ]);
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
  const payload={ items: libraryRows.map(row=>publicItem(row,usageByAdvertisement.get(row.id)||[])), businessDate:today };
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
  const itemId = id || crypto.randomUUID();

  if (id) {
    const expectedVersion = positiveInteger(body.version);
    if (!expectedVersion) return Response.json({ error: 'Оновіть бібліотеку перед редагуванням.' }, { status: 409 });
    const nextVersion = expectedVersion + 1;
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE library_items SET kind=?1,collection=?2,title=?3,uk_text=?4,ru_text=?5,notes=?6,tags_json=?7,platforms_json=?8,updated_at=?9,version=version+1
        WHERE id=?10 AND user_id=?11 AND version=?12 AND archived_at IS NULL`)
        .bind(kind,requestedCollection,title,ukText,ruText,notes,JSON.stringify(tags),JSON.stringify(platforms),now,id,user.id,expectedVersion),
      libraryVersionStatement(env.DB,{userId:user.id,itemId:id,action:'update',expectedVersion:nextVersion,savedAt:now}),
    ]);
    if (!results[0].meta.changes) return Response.json({ error: 'Матеріал уже змінився. Оновіть бібліотеку.' }, { status: 409 });
    return Response.json({ ok: true, id, collection:requestedCollection,kind,version:nextVersion,updatedAt:now });
  }

  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,created_at,updated_at)
      VALUES (?1,?2,?3,?4,1,?5,?6,?7,?8,?9,?10,?11,?11)`)
      .bind(itemId,user.id,kind,requestedCollection,title,ukText,ruText,notes,JSON.stringify(tags),JSON.stringify(platforms),now),
    libraryVersionStatement(env.DB,{userId:user.id,itemId:itemId,action:'create',expectedVersion:1,savedAt:now}),
  ]);
  if (!results[0].meta.changes) return Response.json({ error: 'Не вдалося створити матеріал.' }, { status: 409 });
  return Response.json({ ok: true, id: itemId, collection:requestedCollection,kind,version:1,updatedAt:now });
}

type LibraryRow = { id: string; kind: string; collection:string; version:number; title: string; uk_text: string; ru_text: string; notes: string; tags_json: string; platforms_json: string; archived_at:number|null; created_at: number; updated_at: number };
function publicItem(row: LibraryRow,usedTodayPlatforms:string[]) { return { id: row.id, kind: row.kind, collection:row.collection, version:Number(row.version), title: row.title, ukText: row.uk_text, ruText: row.ru_text, notes: row.notes, tags: parseList(row.tags_json), platforms: parseList(row.platforms_json), usedTodayPlatforms, archivedAt:row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
function parseList(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
function positiveInteger(value:unknown){const number=Number(value);return Number.isSafeInteger(number)&&number>0?number:null;}

