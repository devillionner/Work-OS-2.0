import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { libraryVersionStatement } from '@/lib/library';
import { IMPORT_CHUNK, cleanImportEntry, entryNotes, type ImportEntry } from '@/lib/script-import';
import { TEMPLATE_SCRIPTS } from '@/lib/script-fields';

const STAMP_TOLERANCE_SECONDS = 6 * 3600;

/**
 * Імпорт скриптів із таблиць: приймає вже підтверджені власником записи порціями (≤ IMPORT_CHUNK) і створює їх у «Офіційних скриптах».
 * Скрипт із такою ж назвою пропускається (повторний імпорт нічого не дублює). Запис із ключем шаблону замінює текст вбудованого шаблону
 * (нова версія, ключ і підбір за часом до уроку лишаються) або створює шаблон, якщо його ще немає. Усе з браузера очищається заново.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 256 * 1024);
  if (body instanceof Response) return body;
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (!rawEntries.length || rawEntries.length > IMPORT_CHUNK) return Response.json({ error: 'Передайте від 1 до 20 скриптів за раз.' }, { status: 400 });
  const entries = rawEntries.flatMap((value) => { const entry = cleanImportEntry(value); return entry ? [entry] : []; });
  if (entries.length !== rawEntries.length) return Response.json({ error: 'Один зі скриптів має некоректні дані.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  // Одна мітка часу на весь імпорт: за нею сітка тримає порядок аркуша таблиці (новіші вище), навіть коли порції йдуть різними запитами.
  const stampValue = Number(body.stamp);
  const stamp = Number.isFinite(stampValue) && Math.abs(stampValue - now) <= STAMP_TOLERANCE_SECONDS ? Math.floor(stampValue) : now;

  const plain = entries.filter((entry) => !entry.templateKey);
  const templates = entries.filter((entry): entry is ImportEntry & { templateKey: NonNullable<ImportEntry['templateKey']> } => entry.templateKey !== null);
  const existing = new Set<string>();
  if (plain.length) {
    const rows = await env.DB.prepare(`SELECT title FROM library_items WHERE user_id=?1 AND collection='official_script' AND archived_at IS NULL
      AND title IN (SELECT value FROM json_each(?2))`).bind(user.id, JSON.stringify(plain.map((entry) => entry.title))).all<{ title: string }>();
    for (const row of rows.results) existing.add(row.title);
  }

  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  const skipped: string[] = [];
  const replaced: string[] = [];
  for (const entry of plain) {
    if (existing.has(entry.title)) { skipped.push(entry.title); continue; }
    const itemId = crypto.randomUUID();
    const at = stamp - entry.rank;
    statements.push(
      env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch,created_at,updated_at)
        VALUES (?1,?2,'script','official_script',1,?3,?4,'',?5,?6,'[]',?7,?8,?9,?9)`)
        .bind(itemId, user.id, entry.title, entry.text, entryNotes(entry), JSON.stringify(entry.tags), entry.stage, entry.branch, at),
      libraryVersionStatement(env.DB, { userId: user.id, itemId, action: 'create', expectedVersion: 1, savedAt: at }),
    );
    created.push(entry.title);
  }
  for (const entry of templates) {
    const builtIn = TEMPLATE_SCRIPTS.find((template) => template.key === entry.templateKey);
    const current = await env.DB.prepare(`SELECT id,version FROM library_items WHERE user_id=?1 AND template_key=?2 AND archived_at IS NULL LIMIT 1`)
      .bind(user.id, entry.templateKey).first<{ id: string; version: number }>();
    if (current) {
      const version = Number(current.version);
      // Російський текст шаблону не чіпаємо: таблиця його не має.
      statements.push(
        env.DB.prepare(`UPDATE library_items SET uk_text=?1,updated_at=?2,version=version+1 WHERE id=?3 AND user_id=?4 AND version=?5 AND archived_at IS NULL`)
          .bind(entry.text, now, current.id, user.id, version),
        libraryVersionStatement(env.DB, { userId: user.id, itemId: current.id, action: 'update', expectedVersion: version + 1, savedAt: now }),
      );
      replaced.push(entry.title);
      continue;
    }
    const itemId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,collection,version,title,uk_text,ru_text,notes,tags_json,platforms_json,stage,branch,template_key,created_at,updated_at)
        VALUES (?1,?2,'script','official_script',1,?3,?4,?5,?6,?7,'[]',?8,?9,?10,?11,?11)`)
        .bind(itemId, user.id, builtIn?.title ?? entry.title, entry.text, builtIn?.ruText ?? '', entryNotes(entry), JSON.stringify(entry.tags), entry.stage ?? builtIn?.stage ?? null, entry.branch, entry.templateKey, now),
      libraryVersionStatement(env.DB, { userId: user.id, itemId, action: 'create', expectedVersion: 1, savedAt: now }),
    );
    created.push(entry.title);
  }
  if (statements.length) await env.DB.batch(statements);
  return Response.json({ ok: true, created: created.length, skipped, replaced: replaced.length });
}
