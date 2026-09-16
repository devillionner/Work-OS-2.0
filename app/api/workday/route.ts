import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { readDashboardSnapshot } from '@/lib/dashboard-data';
import {
  WorkdayError,
  endWorkday,
  pauseWorkday,
  readWorkdaySnapshot,
  reopenWorkday,
  resetWorkday,
  resumeWorkday,
  startWorkday,
} from '@/lib/workday';

const REQUEST_MAX_BYTES = 16 * 1024;

type Body = Record<string, unknown>;

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const now = Math.floor(Date.now() / 1000);
  const today = businessDate(now);
  try {
    return Response.json(
      { workday: await readWorkdaySnapshot(env.DB, user.id, today, now), today },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (reason) {
    return workdayError(reason);
  }
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  if (!isJson(request.headers.get('content-type'))) return Response.json({ error: 'Очікується JSON-запит.' }, { status: 415 });
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const action = text(body.action);
  const now = Math.floor(Date.now() / 1000);
  const today = businessDate(now);
  try {
    if (action === 'start') {
      const dashboard = await readDashboardSnapshot(env.DB, user.id, now);
      return Response.json({
        workday: await startWorkday(env.DB, {
          userId: user.id,
          today,
          now,
          plan: {
            dailyGoal: dashboard.bookingGoal.target,
            monthlyGoal: dashboard.monthlyBookingGoal,
            focusDirections: dashboard.focusDirections,
          },
        }),
      });
    }
    const id = text(body.id);
    const workDate = date(body.workDate);
    const expectedVersion = integer(body.expectedVersion);
    if (!id || !workDate || expectedVersion < 0) return bad('Некоректний стан робочого дня.');
    const args = { userId: user.id, id, workDate, expectedVersion, now };
    if (action === 'pause') return Response.json({ workday: await pauseWorkday(env.DB, args) });
    if (action === 'resume') return Response.json({ workday: await resumeWorkday(env.DB, args) });
    if (action === 'reopen') return Response.json({ workday: await reopenWorkday(env.DB, args) });
    if (action === 'reset') {
      if (workDate !== today) throw new WorkdayError('Скинути можна лише сьогоднішній завершений день.');
      await resetWorkday(env.DB, args);
      return Response.json({ workday: null, today });
    }
    if (action === 'end') {
      const dashboard = await readDashboardSnapshot(env.DB, user.id, now);
      if (dashboard.leadTaskCount > 0 && body.confirmIncomplete !== true) {
        return Response.json({
          error: `Залишилося незавершених справ: ${dashboard.leadTaskCount}. Завершити день однаково?`,
          requiresConfirmation: true,
          unfinishedCount: dashboard.leadTaskCount,
        }, { status: 409 });
      }
      return Response.json({
        workday: await endWorkday(env.DB, args),
        unfinishedCount: dashboard.leadTaskCount,
      });
    }
    return bad('Невідома дія робочого дня.');
  } catch (reason) {
    return workdayError(reason);
  }
}

async function readBody(request: Request): Promise<Body | Response> {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > REQUEST_MAX_BYTES) return Response.json({ error: 'Запит завеликий.' }, { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > REQUEST_MAX_BYTES) return Response.json({ error: 'Запит завеликий.' }, { status: 413 });
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Body : bad('Некоректний JSON.');
  } catch { return bad('Некоректний JSON.'); }
}
function workdayError(reason: unknown) {
  if (reason instanceof WorkdayError) return Response.json({ error: reason.message }, { status: reason.status });
  console.error('workday error', reason);
  return Response.json({ error: 'Не вдалося змінити робочий день.' }, { status: 500 });
}
function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
function isJson(value: string | null) { return Boolean(value && /^application\/json(?:\s*;|$)/i.test(value)); }
function text(value: unknown) { return typeof value === 'string' ? value.trim().slice(0, 200) : ''; }
function integer(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) ? number : -1; }
function date(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''; }
function bad(error: string) { return Response.json({ error }, { status: 400 }); }
