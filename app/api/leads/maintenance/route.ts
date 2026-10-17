import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { applyChatLinks, applyPlaceholderLeads, previewChatLinks, previewPlaceholderLeads } from '@/lib/leads/maintenance';

const TOOLS = ['chat-links', 'placeholder-contacts'] as const;
type Tool = (typeof TOOLS)[number];
const MAX_ITEMS = 500;

const tool = (value: unknown): Tool | null => TOOLS.find((candidate) => candidate === value) ?? null;

/** Перегляд службових дій над лідами: нічого не змінює. Читається лише за кнопкою в «Сервісі», не за таймером. */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const which = tool(new URL(request.url).searchParams.get('tool'));
  if (!which) return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  const payload = which === 'chat-links'
    ? await previewChatLinks(env.DB, user.id)
    : { leads: await previewPlaceholderLeads(env.DB, user.id) };
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

/** Застосування лише того, що власник підтвердив: пари «лід → чат» або список лідів із заглушкою. */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await readJsonObject(request, 128 * 1024);
  if (body instanceof Response) return body;
  const which = tool(body.tool);
  if (!which) return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  if (which === 'chat-links') {
    const items = Array.isArray(body.items) ? body.items : [];
    const pairs = items.flatMap((item) => {
      const value = item as { leadId?: unknown; chatId?: unknown };
      return typeof value?.leadId === 'string' && typeof value.chatId === 'string' ? [{ leadId: value.leadId, chatId: value.chatId }] : [];
    });
    if (!pairs.length || pairs.length > MAX_ITEMS) return Response.json({ error: 'Виберіть від 1 до 500 лідів.' }, { status: 400 });
    return Response.json({ ok: true, changed: await applyChatLinks(env.DB, user.id, pairs) });
  }
  const ids = Array.isArray(body.leadIds) ? body.leadIds.filter((id): id is string => typeof id === 'string') : [];
  if (!ids.length || ids.length > 2000) return Response.json({ error: 'Виберіть ліди для позначки.' }, { status: 400 });
  return Response.json({ ok: true, changed: await applyPlaceholderLeads(env.DB, user.id, ids, now) });
}
