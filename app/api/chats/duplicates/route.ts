import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { findChatDuplicates, DuplicateScanError } from '@/lib/chats/duplicates';
import { renameDuplicateChat } from '@/lib/chats/duplicate-actions';
import { readChatState } from '@/lib/chats/state';
import { transitionChat } from '@/lib/chats/transitions';
import type { ChatPlatform } from '@/lib/chats/bulk-input';

const PLATFORMS = new Set<ChatPlatform>(['telegram', 'whatsapp', 'viber', 'facebook']);

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const rawPlatform = url.searchParams.get('platform');
  const platform = rawPlatform && PLATFORMS.has(rawPlatform as ChatPlatform)
    ? rawPlatform as ChatPlatform : null;
  if (rawPlatform && !platform) return Response.json({ error: 'Невідома платформа.' }, { status: 400 });
  const telegramAccountId = platform === 'telegram'
    ? (url.searchParams.get('account') || '').trim().slice(0, 100) || null
    : null;
  try {
    const groups = await findChatDuplicates(env.DB, {
      userId: user.id,
      platform,
      telegramAccountId,
    });
    return Response.json({ groups }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof DuplicateScanError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json() as { id?: unknown; action?: unknown; stateToken?: unknown; name?: unknown };
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const action = body.action === 'rename' || body.action === 'archive' ? body.action : null;
  const stateToken = typeof body.stateToken === 'string' ? body.stateToken : '';
  if (!id || id.length > 100 || !action || !stateToken) {
    return Response.json({ error: 'Некоректна дія з дублікатом.' }, { status: 400 });
  }
  const chat = await readChatState(env.DB, user.id, id);
  if (!chat) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  if (chat.state_token !== stateToken) {
    return Response.json({ error: 'Чат уже змінився. Оновіть список дублікатів.', refresh: true }, { status: 409 });
  }
  const now = Math.floor(Date.now() / 1000);
  if (action === 'rename') {
    const result = await renameDuplicateChat(env.DB, {
      userId: user.id,
      id,
      stateToken,
      name: body.name,
      now,
    });
    return Response.json(result, { status: result.ok ? 200 : 409 });
  }
  if (chat.workflow_status === 'archived') {
    return Response.json({ error: 'Цей чат уже в архіві.' }, { status: 409 });
  }
  const result = await transitionChat(env.DB, {
    userId: user.id,
    chat,
    action: 'archive',
    accountId: chat.telegram_account_id,
    now,
    reason: 'Дублікат',
  });
  return Response.json(result, { status: result.ok ? 200 : 409 });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}
