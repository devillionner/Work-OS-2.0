import { chatStateTokenSql } from './state.ts';
import { businessDate, shiftBusinessDate } from '../business-time.ts';
import { canonicalDirections } from '../directions.ts';

export const PROFILE_CADENCES = ['any', 'daily', 'several_week', 'weekly', 'monthly', 'custom'] as const;
export type ProfileCadence = (typeof PROFILE_CADENCES)[number];
export type ChatProfileInput = {
  name: unknown; language: unknown; cadence: unknown; weekdays: unknown;
  customIntervalDays: unknown; nextAllowedOn: unknown;
  directions: unknown; note: unknown; reviewStatus: unknown;
};
export type ChatProfile = {
  name: string; language: 'uk' | 'ru' | null; cadence: ProfileCadence;
  weekdays: number[]; customIntervalDays: number | null; nextAllowedOn: string | null;
  directions: string[]; note: string; reviewStatus: 'draft' | 'confirmed';
};

export class ChatProfileError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'ChatProfileError'; this.status = status; }
}

function text(value: unknown, max: number, required = false) {
  if (typeof value !== 'string') throw new ChatProfileError('Некоректні дані профілю.');
  const result = value.replace(/\p{Cc}/gu, ' ').trim().replace(/\s+/g, ' ').normalize('NFC');
  if (required && !result) throw new ChatProfileError('Вкажіть назву чату.');
  if (Array.from(result).length > max) throw new ChatProfileError('Назва або нотатка завелика.');
  return Array.from(result).slice(0, max).join('');
}

function list(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems || value.some(item => typeof item !== 'string')) throw new ChatProfileError('Некоректний список профілю.');
  return [...new Set(value.map(item => text(item, maxLength)))].filter(Boolean);
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ChatProfileError('Некоректна дата наступної публікації.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ChatProfileError('Некоректна дата наступної публікації.');
  return value;
}
function customInterval(value: unknown, cadence: ProfileCadence): number | null {
  if (cadence !== 'custom') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) throw new ChatProfileError('Власний інтервал має бути від 1 до 3650 днів.');
  return parsed;
}
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
export function nextProfilePublicationDate(date: string, cadence: ProfileCadence, interval: number | null): string | null {
  if (cadence === 'any') return null;
  if (cadence === 'daily' || cadence === 'several_week') return shiftBusinessDate(date, 1);
  if (cadence === 'weekly') return shiftBusinessDate(date, 7);
  if (cadence === 'custom') return shiftBusinessDate(date, interval || 1);
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month, 1));
  const targetYear = target.getUTCFullYear(); const targetMonth = target.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}
export function profilePublicationEligibilitySql(dateParam:string, weekdayParam:string) {
  if (!/^\?\d+$/.test(dateParam) || !/^\?\d+$/.test(weekdayParam)) throw new Error('Invalid SQL parameter marker.');
  return `NOT EXISTS(SELECT 1 FROM chat_profiles pr WHERE pr.chat_id=c.id AND pr.review_status='confirmed' AND (
    (pr.next_allowed_on IS NOT NULL AND pr.next_allowed_on>${dateParam}) OR
    (pr.cadence='custom' AND (pr.custom_interval_days IS NULL OR pr.custom_interval_days<1)) OR
    (pr.weekdays_json!='[]' AND NOT EXISTS(SELECT 1 FROM json_each(pr.weekdays_json) wd WHERE CAST(wd.value AS INTEGER)=${weekdayParam}))
  ))`;
}

export function profilePublicationRule(profile: Pick<ChatProfile, 'reviewStatus'|'cadence'|'weekdays'|'customIntervalDays'|'nextAllowedOn'>, date: string) {
  if (profile.reviewStatus !== 'confirmed') return { allowed: true as const, reason: null };
  if (profile.cadence === 'custom' && !profile.customIntervalDays) return { allowed: false as const, reason: 'У профілі треба уточнити власний інтервал публікацій.' };
  if (profile.nextAllowedOn && profile.nextAllowedOn > date) return { allowed: false as const, reason: `Наступна публікація дозволена з ${profile.nextAllowedOn}.` };
  if (profile.weekdays.length && !profile.weekdays.includes(isoWeekday(date))) return { allowed: false as const, reason: 'Сьогодні не дозволений день публікації для цього чату.' };
  return { allowed: true as const, reason: null };
}

export function validateChatProfile(input: ChatProfileInput): ChatProfile {
  const name = text(input.name, 180, true);
  const language = input.language === null || input.language === '' ? null : input.language;
  if (language !== null && language !== 'uk' && language !== 'ru') throw new ChatProfileError('Оберіть мову публікації.');
  if (typeof input.cadence !== 'string' || !PROFILE_CADENCES.includes(input.cadence as ProfileCadence)) throw new ChatProfileError('Оберіть частоту публікацій.');
  const weekdays = Array.isArray(input.weekdays) && input.weekdays.every(item => Number.isInteger(item) && item >= 1 && item <= 7)
    ? [...new Set(input.weekdays as number[])].sort((a, b) => a - b) : (() => { throw new ChatProfileError('Оберіть коректні дні.'); })();
  const customIntervalDays = customInterval(input.customIntervalDays, input.cadence as ProfileCadence);
  const nextAllowedOn = optionalDate(input.nextAllowedOn);
  const directions = canonicalDirections(list(input.directions, 12, 80));
  const note = text(input.note, 1000);
  const reviewStatus = input.reviewStatus === 'confirmed' ? 'confirmed' : input.reviewStatus === 'draft' ? 'draft' : (() => { throw new ChatProfileError('Некоректний стан профілю.'); })();
  return { name, language: language as 'uk' | 'ru' | null, cadence: input.cadence as ProfileCadence, weekdays, customIntervalDays, nextAllowedOn, directions, note, reviewStatus };
}

export async function saveChatProfile(db: D1Database, input: {
  userId: string; chatId: string; stateToken: string; now: number; profile: ChatProfileInput;
}): Promise<{ ok: boolean; profile?: ChatProfile; error?: string }> {
  let profile: ChatProfile;
  try { profile = validateChatProfile(input.profile); } catch (error) {
    if (error instanceof ChatProfileError) return { ok: false, error: error.message };
    throw error;
  }
  const eventId = crypto.randomUUID();
  const sourceKey = `chat-profile:${input.chatId}:${eventId}`;
  const results = await db.batch([
    db.prepare(`UPDATE chats SET name=?1,updated_at=?2 WHERE id=?3 AND user_id=?4 AND ${chatStateTokenSql('chats')}=?5`)
      .bind(profile.name, input.now, input.chatId, input.userId, input.stateToken),
    db.prepare(`INSERT INTO chat_profiles(chat_id,language,cadence,weekdays_json,custom_interval_days,next_allowed_on,directions_json,note,review_status,source,updated_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,'manual',?10 WHERE changes()=1
      ON CONFLICT(chat_id) DO UPDATE SET language=excluded.language,cadence=excluded.cadence,
        weekdays_json=excluded.weekdays_json,custom_interval_days=excluded.custom_interval_days,next_allowed_on=excluded.next_allowed_on,directions_json=excluded.directions_json,note=excluded.note,
        review_status=excluded.review_status,source='manual',updated_at=excluded.updated_at`)
      .bind(input.chatId, profile.language, profile.cadence, JSON.stringify(profile.weekdays), profile.customIntervalDays, profile.nextAllowedOn, JSON.stringify(profile.directions), profile.note, profile.reviewStatus, input.now),
    db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
      SELECT ?1,c.user_id,'chat_profile_changed',c.platform,c.id,?2,?3,?4,?5 FROM chats c
      WHERE c.id=?6 AND c.user_id=?7 AND changes()=1`)
      .bind(eventId, input.now, businessDate(input.now), JSON.stringify({ profile }), sourceKey, input.chatId, input.userId),
  ]);
  if (!results[0].meta.changes) return { ok: false, error: 'Чат уже змінено. Оновіть список.' };
  return { ok: true, profile };
}
