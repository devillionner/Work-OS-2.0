import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { libraryVersionStatement } from '@/lib/library';
import { SCRIPT_FIELDS, fieldToken, legacyBrackets, type ScriptFieldKey } from '@/lib/script-fields';

type Row = { id: string; title: string; version: number; uk_text: string; ru_text: string };
const SCRIPTS = `FROM library_items WHERE user_id=?1 AND kind='script' AND collection IN ('official_script','personal_script') AND archived_at IS NULL`;
const isField = (value: unknown): value is ScriptFieldKey => SCRIPT_FIELDS.some((field) => field.key === value);

/** Перегляд: старі позначки в дужках у скриптах і поле, на яке їх можна замінити. Нічого не змінює. */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const rows = await env.DB.prepare(`SELECT id,title,version,uk_text,ru_text ${SCRIPTS} ORDER BY title`).bind(user.id).all<Row>();
  const items = rows.results.flatMap((row) => {
    const brackets = new Map<string, { token: string; field: ScriptFieldKey | null }>();
    for (const found of [...legacyBrackets(row.uk_text), ...legacyBrackets(row.ru_text)]) if (!brackets.has(found.token)) brackets.set(found.token, { token: found.token, field: found.field });
    return brackets.size ? [{ id: row.id, title: row.title, version: Number(row.version), brackets: [...brackets.values()].map((item) => ({ ...item, replacement: item.field ? fieldToken(item.field) : null })) }] : [];
  });
  return Response.json({ items, scanned: rows.results.length }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Застосовує лише підтверджені заміни `{ itemId, token, field }`; кожен скрипт отримує нову версію з історією. */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 256 * 1024);
  if (body instanceof Response) return body;
  const changes = Array.isArray(body.changes) ? body.changes : [];
  const byItem = new Map<string, Array<{ token: string; field: ScriptFieldKey }>>();
  for (const change of changes) {
    const value = change as { itemId?: unknown; token?: unknown; field?: unknown };
    if (typeof value?.itemId !== 'string' || typeof value.token !== 'string' || !/^\[[^[\]\n]{1,40}\]$/.test(value.token) || !isField(value.field)) continue;
    byItem.set(value.itemId, [...(byItem.get(value.itemId) ?? []), { token: value.token, field: value.field }]);
  }
  if (!byItem.size || byItem.size > 500) return Response.json({ error: 'Виберіть, що замінити.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  let updated = 0;
  for (const [itemId, list] of byItem) {
    const row = await env.DB.prepare(`SELECT id,title,version,uk_text,ru_text ${SCRIPTS} AND id=?2`).bind(user.id, itemId).first<Row>();
    if (!row) continue;
    const apply = (text: string) => list.reduce((out, change) => out.split(change.token).join(fieldToken(change.field)), text);
    const uk = apply(row.uk_text);
    const ru = apply(row.ru_text);
    if (uk === row.uk_text && ru === row.ru_text) continue;
    const results = await env.DB.batch([
      env.DB.prepare('UPDATE library_items SET uk_text=?1,ru_text=?2,updated_at=?3,version=version+1 WHERE id=?4 AND user_id=?5 AND version=?6 AND archived_at IS NULL')
        .bind(uk, ru, now, itemId, user.id, Number(row.version)),
      libraryVersionStatement(env.DB, { userId: user.id, itemId, action: 'update', expectedVersion: Number(row.version) + 1, savedAt: now }),
    ]);
    if (results[0].meta.changes) updated += 1;
  }
  return Response.json({ ok: true, updated });
}
