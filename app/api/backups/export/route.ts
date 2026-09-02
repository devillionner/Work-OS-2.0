import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';

const PAGE_SIZE = 200;
const TABLES = ['chats', 'chat_profiles', 'chat_publications', 'leads', 'students', 'lessons', 'daily_reports', 'user_settings', 'activity_events'] as const;
type BackupTable = (typeof TABLES)[number];

const CURSOR_COLUMN: Record<BackupTable, string> = {
  chats: 'id', chat_profiles: 'chat_id', chat_publications: 'id', leads: 'id', students: 'id',
  lessons: 'id', daily_reports: 'id', user_settings: 'setting_key', activity_events: 'id',
};

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const table = url.searchParams.get('table');
  if (!table) return manifest(user.id, user.email);
  if (!TABLES.includes(table as BackupTable)) return Response.json({ error: 'Невідомий розділ резервної копії.' }, { status: 400 });

  const selected = table as BackupTable;
  const cursor = url.searchParams.get('cursor') || '';
  const cursorColumn = CURSOR_COLUMN[selected];
  const query = tableQuery(selected, cursorColumn);
  const result = await env.DB.prepare(query).bind(user.id, cursor, PAGE_SIZE).all<Record<string, unknown>>();
  const rows = result.results;
  const cursorValue = rows.at(-1)?.[cursorColumn];
  const nextCursor = rows.length === PAGE_SIZE && (typeof cursorValue === 'string' || typeof cursorValue === 'number')
    ? String(cursorValue)
    : null;
  return Response.json({ table: selected, rows, nextCursor }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { sha256?: unknown; byteSize?: unknown; counts?: unknown };
  const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '';
  const byteSize = Number(body.byteSize);
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isInteger(byteSize) || byteSize <= 0 || !body.counts || typeof body.counts !== 'object') {
    return Response.json({ error: 'Некоректні дані резервної копії.' }, { status: 400 });
  }
  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO backup_exports (id,user_id,sha256,byte_size,record_counts_json,created_at) VALUES (?1,?2,?3,?4,?5,?6)`).bind(id,user.id,sha256,byteSize,JSON.stringify(body.counts),createdAt).run();
  return Response.json({ ok: true, id, createdAt });
}

async function manifest(userId: string, email: string): Promise<Response> {
  const statements = TABLES.map((table) => env.DB.prepare(countQuery(table)).bind(userId));
  const results = await env.DB.batch<{ count: number }>(statements);
  const counts = Object.fromEntries(TABLES.map((table, index) => [table, Number(results[index].results[0]?.count || 0)]));
  const last = await env.DB.prepare(`SELECT sha256,byte_size,record_counts_json,created_at FROM backup_exports WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1`).bind(userId).first();
  return Response.json({
    app: 'work-os-cloud-backup', schemaVersion: 1, ownerEmail: email,
    createdAt: new Date().toISOString(), tables: TABLES, counts, lastBackup: last || null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

function tableQuery(table: BackupTable, cursorColumn: string): string {
  if (table === 'chat_profiles') return `SELECT p.* FROM chat_profiles p JOIN chats c ON c.id=p.chat_id WHERE c.user_id=?1 AND p.${cursorColumn}>?2 ORDER BY p.${cursorColumn} LIMIT ?3`;
  return `SELECT * FROM ${table} WHERE user_id=?1 AND ${cursorColumn}>?2 ORDER BY ${cursorColumn} LIMIT ?3`;
}
function countQuery(table: BackupTable): string {
  if (table === 'chat_profiles') return `SELECT COUNT(*) AS count FROM chat_profiles p JOIN chats c ON c.id=p.chat_id WHERE c.user_id=?1`;
  return `SELECT COUNT(*) AS count FROM ${table} WHERE user_id=?1`;
}
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
