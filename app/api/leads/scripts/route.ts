import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

type UsedRow = { item_id: string | null; at: number; count: number };

/** Які скрипти вже використано для ліда: за подіями `script_used` в історії (індекс user_id, lead_id, event_type). */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const leadId = (new URL(request.url).searchParams.get('id') || '').trim().slice(0, 200);
  if (!leadId) return Response.json({ error: 'Ліда не знайдено.' }, { status: 400 });
  const rows = await env.DB.prepare(`SELECT json_extract(metadata_json,'$.itemId') AS item_id,MAX(occurred_at) AS at,COUNT(*) AS count
    FROM activity_events WHERE user_id=?1 AND lead_id=?2 AND event_type='script_used' AND cancelled_at IS NULL GROUP BY item_id`).bind(user.id, leadId).all<UsedRow>();
  return Response.json({ used: rows.results.flatMap((row) => (row.item_id ? [{ itemId: row.item_id, at: Number(row.at), count: Number(row.count) }] : [])) }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Відмітка «використано»: ставиться при копіюванні скрипту й лишається в історії ліда. Назва береться з бази, не з запиту. */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 4 * 1024);
  if (body instanceof Response) return body;
  const leadId = typeof body.leadId === 'string' ? body.leadId.trim().slice(0, 200) : '';
  const itemId = typeof body.itemId === 'string' ? body.itemId.trim().slice(0, 200) : '';
  const language = body.language === 'ru' ? 'ru' : 'uk';
  if (!leadId || !itemId) return Response.json({ error: 'Некоректний запит.' }, { status: 400 });
  const [lead, item] = await env.DB.batch([
    env.DB.prepare('SELECT platform FROM leads WHERE id=?1 AND user_id=?2 LIMIT 1').bind(leadId, user.id),
    env.DB.prepare('SELECT title FROM library_items WHERE id=?1 AND user_id=?2 LIMIT 1').bind(itemId, user.id),
  ]);
  const leadRow = lead.results[0] as { platform: string } | undefined;
  const itemRow = item.results[0] as { title: string } | undefined;
  if (!leadRow || !itemRow) return Response.json({ error: 'Ліда чи скрипт не знайдено.' }, { status: 404 });
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO activity_events (id,user_id,event_type,occurred_at,event_date,lead_id,platform,metadata_json,source_key)
    VALUES (?1,?2,'script_used',?3,?4,?5,?6,?7,?8)`)
    .bind(id, user.id, now, businessDate(now), leadId, leadRow.platform, JSON.stringify({ itemId, title: itemRow.title, language }), `script_used:${leadId}:${itemId}:${id}`).run();
  return Response.json({ ok: true, at: now });
}
