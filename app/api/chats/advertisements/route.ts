import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { readPublicationAdvertisementSelection } from '@/lib/chats/advertisement-selection';

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const chatId = new URL(request.url).searchParams.get('chatId')?.trim().slice(0, 120) || '';
  if (!chatId) return Response.json({ error: 'Чат не вказано.' }, { status: 400 });
  const now = Math.floor(Date.now() / 1000);
  const selection = await readPublicationAdvertisementSelection(env.DB, {
    userId: user.id,
    chatId,
    date: businessDate(now),
  });
  if (!selection) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  return Response.json(selection, { headers: { 'Cache-Control': 'no-store' } });
}
