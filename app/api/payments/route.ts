import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import {
  bonusRangeFor,
  buildPaymentSummary,
  DEFAULT_PAYMENT_RULES,
  normalizePaymentRules,
  salaryRangeFor,
  validatePaymentRules,
  type DateRange,
  type PaymentMetric,
  type PaymentRules,
} from '@/lib/payments';

const REQUEST_MAX_BYTES = 16 * 1024;
const SETTING_KEY = 'payment_rules';

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const row = await env.DB.prepare(
    'SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key=?2',
  ).bind(user.id, SETTING_KEY).first<{ value_json: string }>();
  let rules = DEFAULT_PAYMENT_RULES;
  if (row?.value_json) {
    try { rules = normalizePaymentRules(JSON.parse(row.value_json)); } catch { /* keep safe defaults */ }
  }
  const summary = await readPaymentSummary(env.DB, user.id, rules);
  return Response.json({ rules, summary }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request))
    return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;

  let rules: PaymentRules;
  try {
    rules = validatePaymentRules((parsed as { rules?: unknown }).rules);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Некоректні правила виплат.' },
      { status: 400 },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id,setting_key,value_json,source_import_id,updated_at)
     VALUES (?1,?2,?3,NULL,?4)
     ON CONFLICT(user_id,setting_key) DO UPDATE SET
       value_json=excluded.value_json,source_import_id=NULL,updated_at=excluded.updated_at
     WHERE user_settings.user_id=excluded.user_id`,
  ).bind(user.id, SETTING_KEY, JSON.stringify(rules), now).run();

  const summary = await readPaymentSummary(env.DB, user.id, rules, now);
  return Response.json({ ok: true, rules, summary });
}

async function readPaymentSummary(
  db: D1Database,
  userId: string,
  rules: PaymentRules,
  now = Math.floor(Date.now() / 1000),
) {
  const asOf = businessDate(now);
  const salaryRange = salaryRangeFor(asOf, rules);
  const ranges: Record<PaymentMetric, DateRange> = {
    leads: bonusRangeFor(asOf, rules.leadBonusPeriod, salaryRange),
    bookings: bonusRangeFor(asOf, rules.bookingBonusPeriod, salaryRange),
    lessons: bonusRangeFor(asOf, rules.lessonBonusPeriod, salaryRange),
  };
  const results = await db.batch([
    countStatement(db, userId, ranges.leads, ['lead_created']),
    countStatement(db, userId, ranges.bookings, ['lesson_booked', 'curator_booking_pending']),
    countStatement(db, userId, ranges.lessons, ['lesson_completed']),
  ]);
  const counts: Record<PaymentMetric, number> = {
    leads: readCount(results[0]),
    bookings: readCount(results[1]),
    lessons: readCount(results[2]),
  };
  return buildPaymentSummary({ asOf, rules, salaryCountRanges: ranges, counts });
}

function countStatement(
  db: D1Database,
  userId: string,
  range: DateRange,
  eventTypes: string[],
) {
  const placeholders = eventTypes.map((_, index) => `?${index + 4}`).join(',');
  return db.prepare(
    `SELECT COUNT(*) AS count FROM activity_events
     WHERE user_id=?1 AND event_date>=?2 AND event_date<=?3
       AND cancelled_at IS NULL AND event_type IN (${placeholders})`,
  ).bind(userId, range.from, range.to, ...eventTypes);
}

function readCount(result: D1Result<unknown>): number {
  const row = result.results[0] as { count?: unknown } | undefined;
  const value = Number(row?.count || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
