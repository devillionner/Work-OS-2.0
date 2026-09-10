import { chatStateTokenSql } from './state.ts';
import { businessDate } from '../business-time.ts';

export const PROFILE_CADENCES = ['any', 'daily', 'several_week', 'weekly', 'monthly', 'custom'] as const;
export type ProfileCadence = (typeof PROFILE_CADENCES)[number];
export type ChatProfileInput = {
  name: unknown; language: unknown; cadence: unknown; weekdays: unknown;
  directions: unknown; note: unknown; reviewStatus: unknown;
};
export type ChatProfile = {
  name: string; language: 'uk' | 'ru' | null; cadence: ProfileCadence;
  weekdays: number[]; directions: string[]; note: string; reviewStatus: 'draft' | 'confirmed';
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

export function validateChatProfile(input: ChatProfileInput): ChatProfile {
  const name = text(input.name, 180, true);
  const language = input.language === null || input.language === '' ? null : input.language;
  if (language !== null && language !== 'uk' && language !== 'ru') throw new ChatProfileError('Оберіть мову публікації.');
  if (typeof input.cadence !== 'string' || !PROFILE_CADENCES.includes(input.cadence as ProfileCadence)) throw new ChatProfileError('Оберіть частоту публікацій.');
  const weekdays = Array.isArray(input.weekdays) && input.weekdays.every(item => Number.isInteger(item) && item >= 1 && item <= 7)
    ? [...new Set(input.weekdays as number[])].sort((a, b) => a - b) : (() => { throw new ChatProfileError('Оберіть коректні дні.'); })();
  const directions = list(input.directions, 12, 80);
  const note = text(input.note, 1000);
  const reviewStatus = input.reviewStatus === 'confirmed' ? 'confirmed' : input.reviewStatus === 'draft' ? 'draft' : (() => { throw new ChatProfileError('Некоректний стан профілю.'); })();
  return { name, language: language as 'uk' | 'ru' | null, cadence: input.cadence as ProfileCadence, weekdays, directions, note, reviewStatus };
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
    db.prepare(`INSERT INTO chat_profiles(chat_id,language,cadence,weekdays_json,directions_json,note,review_status,source,updated_at)
      SELECT ?1,?2,?3,?4,?5,?6,?7,'manual',?8 WHERE changes()=1
      ON CONFLICT(chat_id) DO UPDATE SET language=excluded.language,cadence=excluded.cadence,
        weekdays_json=excluded.weekdays_json,directions_json=excluded.directions_json,note=excluded.note,
        review_status=excluded.review_status,source='manual',updated_at=excluded.updated_at`)
      .bind(input.chatId, profile.language, profile.cadence, JSON.stringify(profile.weekdays), JSON.stringify(profile.directions), profile.note, profile.reviewStatus, input.now),
    db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,occurred_at,event_date,metadata_json,source_key)
      SELECT ?1,c.user_id,'chat_profile_changed',c.platform,c.id,?2,?3,?4,?5 FROM chats c
      WHERE c.id=?6 AND c.user_id=?7 AND changes()=1`)
      .bind(eventId, input.now, businessDate(input.now), JSON.stringify({ profile }), sourceKey, input.chatId, input.userId),
  ]);
  if (!results[0].meta.changes) return { ok: false, error: 'Чат уже змінено. Оновіть список.' };
  return { ok: true, profile };
}
