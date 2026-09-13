import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { goalVersionStatement } from '@/lib/goals';
import { readJsonObject, sameOrigin } from '@/lib/http-json';

const ALLOWED = new Set(['focus_directions', 'daily_booking_goal', 'monthly_booking_goal', 'enabled_platforms']);
const PLATFORMS = new Set(['telegram', 'whatsapp', 'viber', 'facebook']);
const REQUEST_MAX_BYTES = 16 * 1024;

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const result = await env.DB.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN ('focus_directions','daily_booking_goal','monthly_booking_goal','enabled_platforms')`).bind(user.id).all<{ setting_key: string; value_json: string }>();
  const settings: Record<string, unknown> = {};
  for (const row of result.results) { try { settings[row.setting_key] = JSON.parse(row.value_json); } catch { /* ignore malformed legacy setting */ } }
  return Response.json({ settings }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { settings?: unknown };
  if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) return Response.json({ error: 'Некоректні налаштування.' }, { status: 400 });
  const entries = Object.entries(body.settings as Record<string, unknown>).filter(([key]) => ALLOWED.has(key));
  if (!entries.length || entries.length !== Object.keys(body.settings as Record<string, unknown>).length) return Response.json({ error: 'Є невідомий параметр.' }, { status: 400 });
  const values = new Map<string, string>();
  for (const [key, value] of entries) {
    if (key === 'focus_directions' || key === 'enabled_platforms') {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string') || value.length > 20) return Response.json({ error: 'Некоректний список напрямків.' }, { status: 400 });
      const list = value.map((item) => item.trim().slice(0, 80)).filter(Boolean);
      if (key === 'enabled_platforms' && (!list.length || list.some((item) => !PLATFORMS.has(item)))) return Response.json({ error: 'Обери хоча б одну коректну активну платформу.' }, { status: 400 });
      values.set(key, JSON.stringify([...new Set(list)]));
    } else {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 0 || number > 100000) return Response.json({ error: 'Ціль має бути цілим числом від 0 до 100 000.' }, { status: 400 });
      values.set(key, JSON.stringify(number));
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const current = await env.DB.prepare(`SELECT setting_key,value_json FROM user_settings WHERE user_id=?1 AND setting_key IN ('daily_booking_goal','monthly_booking_goal')`).bind(user.id).all<{setting_key:string;value_json:string}>();
  const currentGoals = new Map(current.results.map((row) => [row.setting_key, row.value_json]));
  const statements = [...values].map(([key, value]) => env.DB.prepare(`INSERT INTO user_settings (user_id,setting_key,value_json,source_import_id,updated_at) VALUES (?1,?2,?3,NULL,?4) ON CONFLICT(user_id,setting_key) DO UPDATE SET value_json=excluded.value_json,source_import_id=NULL,updated_at=excluded.updated_at WHERE user_settings.user_id=excluded.user_id`).bind(user.id, key, value, now));
  const today = businessDate(now);
  for (const key of ['daily_booking_goal','monthly_booking_goal'] as const) {
    const value = values.get(key);
    if (value === undefined || currentGoals.get(key) === value) continue;
    statements.push(goalVersionStatement(env.DB,{ userId:user.id, key, value:JSON.parse(value), now, today }));
  }
  await env.DB.batch(statements);
  return Response.json({ ok: true, settings: Object.fromEntries([...values].map(([key, value]) => [key, JSON.parse(value)])) });
}
