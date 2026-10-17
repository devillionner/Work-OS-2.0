import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import {
  cleanChecklist, cleanDevPriority, cleanDevStatus, cleanDevText, cleanDevType, cleanPhotos, parseJsonList,
  type ChecklistItem, type DevPhoto,
} from '@/lib/dev-items';

type Row = {
  id: string; type: string; title: string; body: string; status: string; priority: string; checklist_json: string; photos_json: string;
  notes: string; position: number; version: number; archived_at: number | null; created_at: number; updated_at: number;
};
const COLUMNS = 'id,type,title,body,status,priority,checklist_json,photos_json,notes,position,version,archived_at,created_at,updated_at';
const publicItem = (row: Row) => ({
  id: row.id, type: row.type, title: row.title, body: row.body, status: row.status, priority: row.priority,
  checklist: parseJsonList<ChecklistItem>(row.checklist_json), photos: parseJsonList<DevPhoto>(row.photos_json), notes: row.notes,
  position: Number(row.position), version: Number(row.version), archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
});
const positiveInteger = (value: unknown) => { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; };

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const archived = new URL(request.url).searchParams.get('archived') === 'true';
  const rows = await env.DB.prepare(`SELECT ${COLUMNS} FROM dev_items WHERE user_id=?1 AND ((?2=0 AND archived_at IS NULL) OR (?2=1 AND archived_at IS NOT NULL))
    ORDER BY status,position,created_at LIMIT 500`).bind(user.id, Number(archived)).all<Row>();
  return Response.json({ items: rows.results.map(publicItem) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Позиція нового запису на початку колонки статусу. */
const topPosition = (userId: string, status: string) => env.DB.prepare('SELECT COALESCE(MIN(position),1)-1 AS position FROM dev_items WHERE user_id=?1 AND archived_at IS NULL AND status=?2').bind(userId, status);

async function removePhotos(keys: string[]) {
  if (!env.FILES || !keys.length) return;
  try { await env.FILES.delete(keys); } catch { /* осиротілий файл не критичний */ }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 64 * 1024);
  if (body instanceof Response) return body;
  const action = typeof body.action === 'string' ? body.action : 'save';
  const id = typeof body.id === 'string' ? body.id.trim().slice(0, 80) : '';
  const now = Math.floor(Date.now() / 1000);

  if (action === 'archive' || action === 'restore') {
    if (!id) return Response.json({ error: 'Запис не знайдено.' }, { status: 400 });
    const result = await env.DB.prepare(`UPDATE dev_items SET archived_at=?1,updated_at=?2,version=version+1 WHERE id=?3 AND user_id=?4 AND ${action === 'archive' ? 'archived_at IS NULL' : 'archived_at IS NOT NULL'}`)
      .bind(action === 'archive' ? now : null, now, id, user.id).run();
    return result.meta.changes ? Response.json({ ok: true }) : Response.json({ error: 'Запис уже змінився. Оновіть список.' }, { status: 409 });
  }

  if (action === 'move') {
    const status = cleanDevStatus(body.status);
    if (!id || !status) return Response.json({ error: 'Некоректне переміщення.' }, { status: 400 });
    const beforeId = typeof body.beforeId === 'string' ? body.beforeId.trim().slice(0, 80) : '';
    let position: number;
    if (beforeId && beforeId !== id) {
      const before = await env.DB.prepare('SELECT position FROM dev_items WHERE id=?1 AND user_id=?2 AND status=?3 AND archived_at IS NULL').bind(beforeId, user.id, status).first<{ position: number }>();
      if (!before) return Response.json({ error: 'Запис уже змінився. Оновіть список.' }, { status: 409 });
      const prev = await env.DB.prepare('SELECT MAX(position) AS position FROM dev_items WHERE user_id=?1 AND status=?2 AND archived_at IS NULL AND id<>?3 AND position<?4').bind(user.id, status, id, Number(before.position)).first<{ position: number | null }>();
      position = prev?.position === null || prev?.position === undefined ? Number(before.position) - 1 : (Number(prev.position) + Number(before.position)) / 2;
    } else {
      const last = await env.DB.prepare('SELECT COALESCE(MAX(position),0)+1 AS position FROM dev_items WHERE user_id=?1 AND status=?2 AND archived_at IS NULL AND id<>?3').bind(user.id, status, id).first<{ position: number }>();
      position = Number(last?.position ?? 1);
    }
    const result = await env.DB.prepare('UPDATE dev_items SET status=?1,position=?2,updated_at=?3,version=version+1 WHERE id=?4 AND user_id=?5 AND archived_at IS NULL').bind(status, position, now, id, user.id).run();
    return result.meta.changes ? Response.json({ ok: true, position }) : Response.json({ error: 'Запис уже змінився. Оновіть список.' }, { status: 409 });
  }

  if (action !== 'save') return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  const title = cleanDevText(body.title, 200).replace(/\n+/g, ' ');
  const type = cleanDevType(body.type);
  const status = cleanDevStatus(body.status) ?? 'idea';
  const priority = cleanDevPriority(body.priority) ?? 'normal';
  if (!title) return Response.json({ error: 'Вкажіть назву запису.' }, { status: 400 });
  if (!type) return Response.json({ error: 'Оберіть тип запису.' }, { status: 400 });
  const text = cleanDevText(body.body, 10000);
  const notes = cleanDevText(body.notes, 5000);
  const checklist = cleanChecklist(body.checklist);
  const photos = cleanPhotos(body.photos, user.id);

  if (!id) {
    const top = await topPosition(user.id, status).first<{ position: number }>();
    const newId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO dev_items (id,user_id,type,title,body,status,priority,checklist_json,photos_json,notes,position,version,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?12)`)
      .bind(newId, user.id, type, title, text, status, priority, JSON.stringify(checklist), JSON.stringify(photos), notes, Number(top?.position ?? 0), now).run();
    return Response.json({ ok: true, id: newId, version: 1, updatedAt: now });
  }
  const expected = positiveInteger(body.version);
  if (!expected) return Response.json({ error: 'Оновіть список перед редагуванням.' }, { status: 409 });
  const current = await env.DB.prepare('SELECT status,photos_json FROM dev_items WHERE id=?1 AND user_id=?2 AND version=?3 AND archived_at IS NULL').bind(id, user.id, expected).first<{ status: string; photos_json: string }>();
  if (!current) return Response.json({ error: 'Запис уже змінився. Оновіть список.' }, { status: 409 });
  const position = current.status === status ? null : Number((await topPosition(user.id, status).first<{ position: number }>())?.position ?? 0);
  const result = await env.DB.prepare(`UPDATE dev_items SET type=?1,title=?2,body=?3,status=?4,priority=?5,checklist_json=?6,photos_json=?7,notes=?8,position=COALESCE(?9,position),updated_at=?10,version=version+1
    WHERE id=?11 AND user_id=?12 AND version=?13 AND archived_at IS NULL`)
    .bind(type, title, text, status, priority, JSON.stringify(checklist), JSON.stringify(photos), notes, position, now, id, user.id, expected).run();
  if (!result.meta.changes) return Response.json({ error: 'Запис уже змінився. Оновіть список.' }, { status: 409 });
  const kept = new Set(photos.map((photo) => photo.key));
  await removePhotos(parseJsonList<DevPhoto>(current.photos_json).map((photo) => photo.key).filter((key) => !kept.has(key) && key.startsWith(`dev/${user.id}/`)));
  return Response.json({ ok: true, id, version: expected + 1, updatedAt: now });
}
