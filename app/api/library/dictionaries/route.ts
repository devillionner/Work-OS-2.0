import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import {
  DICTIONARY_KINDS, DICTIONARY_SETTING_KEY, cleanDictionaryName, cleanNames, dictionaryUsage, isDictionaryKind, isStandardDirection,
  mergeDictionaries, parseDictionaries, sameName, type DictionaryKind, type Dictionaries,
} from '@/lib/library-dictionaries';

type ItemRow = { id: string; tags_json: string; branch: string };
const tagsOf = (json: string): string[] => { try { const parsed = JSON.parse(json); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };

async function load(userId: string) {
  const [settings, items] = await env.DB.batch([
    env.DB.prepare('SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2 LIMIT 1').bind(userId, DICTIONARY_SETTING_KEY),
    env.DB.prepare('SELECT id,tags_json,branch FROM library_items WHERE user_id=?1').bind(userId),
  ]);
  const saved = parseDictionaries((settings.results[0] as { value_json?: string } | undefined)?.value_json);
  const rows = items.results as ItemRow[];
  const uses = rows.map((row) => ({ tags: tagsOf(row.tags_json), branch: row.branch || '' }));
  return { rows, dictionaries: mergeDictionaries(saved, uses), uses };
}

const saveStatement = (userId: string, dictionaries: Dictionaries, now: number) => env.DB.prepare(`INSERT INTO user_settings (user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4)
  ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,source_import_id=NULL,updated_at=excluded.updated_at WHERE user_settings.user_id=excluded.user_id`)
  .bind(userId, DICTIONARY_SETTING_KEY, JSON.stringify(dictionaries), now);

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const { dictionaries, uses } = await load(user.id);
  const leadsUse = await env.DB.prepare(`SELECT interest,COUNT(*) AS count FROM leads WHERE user_id=?1 AND interest<>'' GROUP BY interest`).bind(user.id).all<{ interest: string; count: number }>();
  const usage = dictionaryUsage(dictionaries, uses);
  // Гілка вживається ще й лідами (їхній «інтерес»), тож видалення потребує перевірки й там.
  const leadCounts: Record<string, number> = {};
  for (const row of leadsUse.results) leadCounts[row.interest] = Number(row.count);
  return Response.json({ dictionaries, usage, leads: leadCounts, standard: dictionaries.directions.filter(isStandardDirection) }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Довідники: «save» (новий порядок і склад), «rename» (оновлює матеріали, де вжито), «delete» (з перевіркою, де вжито:
 * без `force` повертає кількість). Стандартні предмети не перейменовуються.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 32 * 1024);
  if (body instanceof Response) return body;
  const action = typeof body.action === 'string' ? body.action : '';
  const now = Math.floor(Date.now() / 1000);
  const { rows, dictionaries } = await load(user.id);

  if (action === 'save') {
    const next: Dictionaries = { directions: cleanNames(body.directions ?? dictionaries.directions), tags: cleanNames(body.tags ?? dictionaries.tags), branches: cleanNames(body.branches ?? dictionaries.branches) };
    const seen = new Set<string>();
    for (const name of [...next.directions, ...next.tags]) {
      const key = name.toLocaleLowerCase('uk-UA');
      if (seen.has(key)) return Response.json({ error: `«${name}» уже є в іншому довіднику.` }, { status: 400 });
      seen.add(key);
    }
    await saveStatement(user.id, next, now).run();
    return Response.json({ ok: true });
  }

  const kind = isDictionaryKind(body.kind) ? body.kind : null;
  const name = cleanDictionaryName(body.name);
  if (!kind || !name || !dictionaries[kind].some((item) => sameName(item, name))) return Response.json({ error: 'Запис довідника не знайдено.' }, { status: 404 });
  const current = dictionaries[kind].find((item) => sameName(item, name))!;
  const itemsWithTag = rows.filter((row) => kind !== 'branches' && tagsOf(row.tags_json).some((tag) => sameName(tag, current)));
  const itemsWithBranch = rows.filter((row) => kind === 'branches' && sameName(row.branch || '', current));
  const count = itemsWithTag.length + itemsWithBranch.length;
  const leadCount = kind === 'branches'
    ? Number((await env.DB.prepare(`SELECT COUNT(*) AS count FROM leads WHERE user_id=?1 AND interest=?2`).bind(user.id, current).first<{ count: number }>())?.count ?? 0)
    : 0;

  if (action === 'rename') {
    const to = cleanDictionaryName(body.to);
    if (!to) return Response.json({ error: 'Вкажіть нову назву.' }, { status: 400 });
    if (kind === 'directions' && isStandardDirection(current)) return Response.json({ error: 'Стандартний предмет Work OS не перейменовується: за ним підбираються оголошення чатам.' }, { status: 400 });
    if (!sameName(current, to) && DICTIONARY_KINDS.some((other) => (other === 'branches') === (kind === 'branches') && dictionaries[other].some((item) => sameName(item, to))))
      return Response.json({ error: `Запис «${to}» уже існує.` }, { status: 409 });
    const next: Dictionaries = { ...dictionaries, [kind]: dictionaries[kind].map((item) => (sameName(item, current) ? to : item)) };
    const statements = [saveStatement(user.id, next, now)];
    for (const row of itemsWithTag) {
      const tags = [...new Set(tagsOf(row.tags_json).map((tag) => (sameName(tag, current) ? to : tag)))];
      statements.push(env.DB.prepare('UPDATE library_items SET tags_json=?1,updated_at=?2,version=version+1 WHERE id=?3 AND user_id=?4').bind(JSON.stringify(tags), now, row.id, user.id));
    }
    for (const row of itemsWithBranch) statements.push(env.DB.prepare('UPDATE library_items SET branch=?1,updated_at=?2,version=version+1 WHERE id=?3 AND user_id=?4').bind(to, now, row.id, user.id));
    if (kind === 'branches' && leadCount) statements.push(env.DB.prepare('UPDATE leads SET interest=?1 WHERE user_id=?2 AND interest=?3').bind(to, user.id, current));
    await env.DB.batch(statements);
    return Response.json({ ok: true, updated: count + leadCount });
  }

  if (action === 'delete') {
    if (count + leadCount > 0 && body.force !== true) return Response.json({ error: 'Запис ще вживається.', usage: { items: count, leads: leadCount } }, { status: 409 });
    const next: Dictionaries = { ...dictionaries, [kind]: dictionaries[kind].filter((item) => !sameName(item, current)) };
    const statements = [saveStatement(user.id, next, now)];
    for (const row of itemsWithTag) {
      const tags = tagsOf(row.tags_json).filter((tag) => !sameName(tag, current));
      statements.push(env.DB.prepare('UPDATE library_items SET tags_json=?1,updated_at=?2,version=version+1 WHERE id=?3 AND user_id=?4').bind(JSON.stringify(tags), now, row.id, user.id));
    }
    for (const row of itemsWithBranch) statements.push(env.DB.prepare(`UPDATE library_items SET branch='',updated_at=?1,version=version+1 WHERE id=?2 AND user_id=?3`).bind(now, row.id, user.id));
    if (kind === 'branches' && leadCount) statements.push(env.DB.prepare(`UPDATE leads SET interest='' WHERE user_id=?1 AND interest=?2`).bind(user.id, current));
    await env.DB.batch(statements);
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'Невідома дія.' }, { status: 400 });
}

