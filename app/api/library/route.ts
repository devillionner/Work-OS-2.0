import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';

const KINDS = new Set(['advertisement', 'script']);

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || 'advertisement';
  const search = (url.searchParams.get('search') || '').trim().slice(0, 120);
  if (kind !== 'all' && !KINDS.has(kind)) return Response.json({ error: 'Невідомий тип матеріалу.' }, { status: 400 });
  const pattern = `%${escapeLike(search.toLowerCase())}%`;
  const result = await env.DB.prepare(`SELECT id,kind,title,uk_text,ru_text,notes,tags_json,platforms_json,created_at,updated_at
    FROM library_items WHERE user_id=?1 AND archived_at IS NULL
      AND (?2='all' OR kind=?2) AND (?3='' OR lower(title) LIKE ?4 ESCAPE '\\' OR lower(uk_text) LIKE ?4 ESCAPE '\\' OR lower(ru_text) LIKE ?4 ESCAPE '\\' OR lower(notes) LIKE ?4 ESCAPE '\\')
    ORDER BY updated_at DESC,title LIMIT 200`).bind(user.id, kind, search, pattern).all<LibraryRow>();
  return Response.json({ items: result.results.map(publicItem) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === 'string' ? body.action : 'save';
  const id = typeof body.id === 'string' ? body.id : '';
  if (action === 'archive') {
    if (!id) return Response.json({ error: 'Матеріал не знайдено.' }, { status: 400 });
    const result = await env.DB.prepare(`UPDATE library_items SET archived_at=?1,updated_at=?1 WHERE id=?2 AND user_id=?3 AND archived_at IS NULL`).bind(Math.floor(Date.now() / 1000), id, user.id).run();
    return result.meta.changes ? Response.json({ ok: true }) : Response.json({ error: 'Матеріал уже змінено.' }, { status: 409 });
  }
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const ukText = typeof body.ukText === 'string' ? body.ukText.slice(0, 20000) : '';
  const ruText = typeof body.ruText === 'string' ? body.ruText.slice(0, 20000) : '';
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 4000) : '';
  if (!KINDS.has(kind) || !title || (!ukText.trim() && !ruText.trim())) return Response.json({ error: 'Вкажіть тип, назву та хоча б одну мовну версію.' }, { status: 400 });
  const tags = cleanList(body.tags); const platforms = cleanList(body.platforms); const now = Math.floor(Date.now() / 1000); const itemId = id || crypto.randomUUID();
  if (id) {
    const result = await env.DB.prepare(`UPDATE library_items SET kind=?1,title=?2,uk_text=?3,ru_text=?4,notes=?5,tags_json=?6,platforms_json=?7,updated_at=?8 WHERE id=?9 AND user_id=?10 AND archived_at IS NULL`).bind(kind,title,ukText,ruText,notes,JSON.stringify(tags),JSON.stringify(platforms),now,id,user.id).run();
    if (!result.meta.changes) return Response.json({ error: 'Матеріал не знайдено або він уже в архіві.' }, { status: 404 });
  } else {
    await env.DB.prepare(`INSERT INTO library_items (id,user_id,kind,title,uk_text,ru_text,notes,tags_json,platforms_json,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)`).bind(itemId,user.id,kind,title,ukText,ruText,notes,JSON.stringify(tags),JSON.stringify(platforms),now).run();
  }
  return Response.json({ ok: true, id: itemId });
}

type LibraryRow = { id: string; kind: string; title: string; uk_text: string; ru_text: string; notes: string; tags_json: string; platforms_json: string; created_at: number; updated_at: number };
function publicItem(row: LibraryRow) { return { id: row.id, kind: row.kind, title: row.title, ukText: row.uk_text, ruText: row.ru_text, notes: row.notes, tags: parseList(row.tags_json), platforms: parseList(row.platforms_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function parseList(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
function cleanList(value: unknown): string[] { if (!Array.isArray(value)) return []; return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 50)).filter(Boolean).slice(0, 20); }
function escapeLike(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_'); }
function sameOrigin(request: Request): boolean { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
