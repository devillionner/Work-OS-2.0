import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import {
  TelegramScheduleError,
  clearPendingTelegramSchedule,
  generateTelegramSchedule,
  readTelegramSchedule,
  saveTelegramScheduleSettings,
  updateTelegramScheduleSlot,
} from '@/lib/chats/telegram-schedule';
import { readBoundedText } from '@/lib/http-body';

const REQUEST_MAX_BYTES = 128 * 1024;

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const accountId = (url.searchParams.get('account') || '').trim();
  if (!accountId) return bad('Оберіть Telegram-акаунт.');
  const now = unixNow();
  try {
    const snapshot = await readTelegramSchedule(env.DB, {
      userId: user.id,
      accountId,
      now,
      date: businessDate(now),
    });
    return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (reason) {
    return scheduleError(reason);
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  if (!isJson(request.headers.get('content-type'))) return Response.json({ error: 'Очікується JSON-запит.' }, { status: 415 });
  const raw = await readBoundedText(request, REQUEST_MAX_BYTES);
  if (raw instanceof Response) return raw;
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('Некоректний JSON.');
    body = parsed as Record<string, unknown>;
  } catch {
    return bad('Некоректний JSON.');
  }
  const action = text(body.action);
  const accountId = text(body.accountId);
  if (!accountId) return bad('Оберіть Telegram-акаунт.');
  const now = unixNow();
  const date = businessDate(now);
  try {
    if (action === 'save') {
      const expectedVersion = integer(body.expectedVersion);
      const mode = body.selectionMode;
      if (expectedVersion < 0 || (mode !== 'auto' && mode !== 'manual') || !validStringList(body.manualChatIds)) {
        return bad('Некоректні налаштування розкладу.');
      }
      return Response.json(await saveTelegramScheduleSettings(env.DB, {
        userId: user.id,
        accountId,
        expectedVersion,
        intervalMinutes: number(body.intervalMinutes),
        baseAt: number(body.baseAt),
        selectionMode: mode,
        manualChatIds: body.manualChatIds as string[],
        now,
        date,
      }));
    }
    if (action === 'generate') {
      const count = integer(body.count);
      if (count < 1 || count > 200) return bad('Кількість слотів має бути від 1 до 200.');
      return Response.json(await generateTelegramSchedule(env.DB, { userId: user.id, accountId, count, now, date }));
    }
    if (action === 'slot') {
      const slotId = text(body.slotId);
      const expectedVersion = integer(body.expectedVersion);
      if (!slotId || expectedVersion < 0) return bad('Некоректні дані слота.');
      return Response.json(await updateTelegramScheduleSlot(env.DB, {
        userId: user.id,
        accountId,
        slotId,
        expectedVersion,
        scheduledAt: body.scheduledAt === undefined ? undefined : number(body.scheduledAt),
        chatId: body.chatId === undefined ? undefined : body.chatId === null ? null : text(body.chatId),
        now,
        date,
      }));
    }
    if (action === 'clear_pending') {
      return Response.json(await clearPendingTelegramSchedule(env.DB, { userId: user.id, accountId, now, date }));
    }
    return bad('Невідома дія розкладу.');
  } catch (reason) {
    return scheduleError(reason);
  }
}

function scheduleError(reason: unknown): Response {
  if (reason instanceof TelegramScheduleError) return Response.json({ error: reason.message }, { status: reason.status });
  console.error('telegram schedule error', reason);
  return Response.json({ error: 'Не вдалося оновити Telegram-розклад.' }, { status: 500 });
}
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
function isJson(value: string | null) { return Boolean(value && /^application\/json(?:\s*;|$)/i.test(value)); }
function unixNow() { return Math.floor(Date.now() / 1000); }
function text(value: unknown) { return typeof value === 'string' ? value.trim().slice(0, 200) : ''; }
function number(value: unknown) { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : Number.NaN; }
function integer(value: unknown) { const parsed = number(value); return Number.isInteger(parsed) ? parsed : Number.NaN; }
function validStringList(value: unknown) { return Array.isArray(value) && value.length <= 500 && value.every((item) => typeof item === 'string' && item.trim().length > 0 && item.length <= 200); }
function bad(error: string) { return Response.json({ error }, { status: 400 }); }
