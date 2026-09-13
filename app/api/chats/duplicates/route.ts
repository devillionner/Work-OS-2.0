import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { findChatDuplicates, DuplicateScanError } from '@/lib/chats/duplicates';
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
