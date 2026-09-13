import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { changeChatLeaveConfirmation, readChatLeaveState } from '@/lib/chats/leave-checklist';
import { readChatState } from '@/lib/chats/state';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const id = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!id || id.length > 100) return Response.json({ error: 'Чат не знайдено.' }, { status: 400 });
  const state = await readChatLeaveState(env.DB, user.id, id);
  if (!state) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  return Response.json(state, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json() as { id?: unknown; stateToken?: unknown; confirm?: unknown };
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const stateToken = typeof body.stateToken === 'string' ? body.stateToken : '';
  if (!id || id.length > 100 || !stateToken || typeof body.confirm !== 'boolean') {
    return Response.json({ error: 'Некоректна дія чекліста.' }, { status: 400 });
  }
  const chat = await readChatState(env.DB, user.id, id);
  if (!chat) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  if (chat.state_token !== stateToken) {
    return Response.json({ error: 'Стан чату вже змінився. Оновіть архів.', refresh: true }, { status: 409 });
  }
  const result = await changeChatLeaveConfirmation(env.DB, {
    userId: user.id,
    chatId: id,
    stateToken,
    confirm: body.confirm,
    now: Math.floor(Date.now() / 1000),
  });
  if (!result.ok) return Response.json(result, { status: 409 });
  const next = await readChatState(env.DB, user.id, id);
  const leave = await readChatLeaveState(env.DB, user.id, id);
  return Response.json({ ok: true, stateToken: next?.state_token, leave });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
