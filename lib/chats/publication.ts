import { validatePublicationAdvertisementChoice } from './advertisement-selection.ts';
import { chatStateTokenSql } from './state.ts';
import { nextProfilePublicationDate, profilePublicationRule, PROFILE_CADENCES, type ChatProfile, type ProfileCadence } from './profile.ts';

export type PublicationChat = {
  id: string;
  platform: string;
  workflow_status: string;
  joined_at: number | null;
  snoozed_until: number | null;
};

export function publicationAvailability(chat: PublicationChat, now: number) {
  const telegramAt = chat.platform === 'telegram' && chat.joined_at !== null
    ? chat.joined_at + 21600 : 0;
  const availableAt = Math.max(telegramAt, chat.snoozed_until ?? 0) || null;
  const availableNow = chat.workflow_status === 'ready' && (availableAt === null || availableAt <= now);
  return { availableAt, availableNow };
}

export async function recordManualPublication(
  db: D1Database,
  input: { userId: string; chat: PublicationChat; accountId: string | null; advertisementId?: string | null; language?: 'uk' | 'ru' | null; quickMode?: boolean; now: number; date: string; stateToken: string },
): Promise<{ ok: true } | { ok: false; error: string; availableAt?: number | null }> {
  const { userId, chat, accountId, advertisementId = null, now, date } = input;
  const language = input.language === 'uk' || input.language === 'ru' ? input.language : null;
  const quickMode = input.quickMode === true;
  if (quickMode && chat.platform !== 'whatsapp' && chat.platform !== 'viber')
    return { ok:false,error:'Швидка публікація доступна лише для WhatsApp і Viber.' };
  if (quickMode && !advertisementId)
    return { ok:false,error:'Для швидкої публікації оберіть матеріал.' };
  const profileRow = await db.prepare(`SELECT p.cadence,p.weekdays_json,p.custom_interval_days,p.next_allowed_on,p.review_status
    FROM chat_profiles p JOIN chats c ON c.id=p.chat_id WHERE p.chat_id=?1 AND c.user_id=?2 LIMIT 1`).bind(chat.id,userId).first<Record<string,unknown>>();
  const profile = publicationProfile(profileRow);
  if (profile) {
    const rule = profilePublicationRule(profile,date);
    if (!rule.allowed) return { ok:false,error:rule.reason || 'Публікація зараз недоступна.' };
  }
  const nextAllowedOn = profile?.reviewStatus === 'confirmed' ? nextProfilePublicationDate(date,profile.cadence,profile.customIntervalDays) : null;
  const availability = publicationAvailability(chat, now);
  if (!availability.availableNow) {
    return { ok: false, ...availability, error: chat.workflow_status !== 'ready'
      ? 'Цей чат зараз не в черзі публікації.'
      : (chat.snoozed_until ?? 0) > now ? 'Цей чат відкладено. Публікація ще недоступна.' : 'Для Telegram ще не минуло 6 годин.' };
  }
  if (advertisementId) {
    const choice = await validatePublicationAdvertisementChoice(db, { userId, chatId: chat.id, advertisementId, date, allowSameDayReuse: quickMode });
    if (!choice.ok) return choice;
  }
  const publicationId = crypto.randomUUID();
  const sourceKey = `manual:${publicationId}`;
  // Recheck the current row inside the same transaction as the event. A racing
  // archive/snooze or duplicate click must not create a publication or an event.
  const statements = [
    db.prepare(`INSERT INTO chat_publications
      (id,user_id,chat_id,published_on,published_at,advertisement_id,source,source_key,created_at,telegram_account_id)
      SELECT ?1,c.user_id,c.id,?2,?3,?6,'manual',?4,?3,CASE WHEN c.platform='telegram' THEN COALESCE(c.telegram_account_id,?5) ELSE NULL END
      FROM chats c WHERE c.id=?7 AND c.user_id=?8 AND c.workflow_status='ready'
        AND (c.snoozed_until IS NULL OR c.snoozed_until<=?3)
        AND (c.platform!='telegram' OR c.joined_at IS NULL OR c.joined_at+21600<=?3)
        AND ${chatStateTokenSql()}=?9
        AND (?6 IS NULL OR EXISTS(SELECT 1 FROM library_items li
          WHERE li.id=?6 AND li.user_id=c.user_id AND li.kind='advertisement' AND li.archived_at IS NULL))
        AND (c.platform!='telegram' OR EXISTS(SELECT 1 FROM telegram_accounts a
          WHERE a.id=COALESCE(c.telegram_account_id,?5) AND a.user_id=c.user_id AND a.is_enabled=1))
      ON CONFLICT(user_id,chat_id,published_on) DO NOTHING`)
      .bind(publicationId,date,now,sourceKey,accountId,advertisementId,chat.id,userId,input.stateToken),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,p.user_id,'publication',c.platform,p.chat_id,NULL,NULL,p.published_at,p.published_on,
        CASE WHEN p.advertisement_id IS NULL AND ?4 IS NULL THEN '{}'
          WHEN p.advertisement_id IS NULL THEN json_object('language',?4)
          WHEN ?4 IS NULL THEN json_object('advertisementId',p.advertisement_id)
          ELSE json_object('advertisementId',p.advertisement_id,'language',?4) END,
        p.source_key,p.telegram_account_id
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id AND c.user_id=p.user_id
      WHERE p.id=?2 AND p.user_id=?3`).bind(crypto.randomUUID(),publicationId,userId,language),
    db.prepare(`UPDATE telegram_schedule_slots SET status='completed',completed_at=?1,publication_id=?2,updated_at=?1,version=version+1
      WHERE id=(SELECT s.id FROM telegram_schedule_slots s JOIN chat_publications p
        ON p.user_id=s.user_id AND p.telegram_account_id=s.telegram_account_id AND p.chat_id=s.chat_id
        WHERE p.id=?2 AND p.user_id=?3 AND s.status='pending' ORDER BY s.scheduled_at,s.sequence LIMIT 1)
        AND user_id=?3 AND status='pending'`).bind(now,publicationId,userId),
  ];
  if (profile?.reviewStatus === 'confirmed') statements.push(
    db.prepare(`UPDATE chat_profiles SET next_allowed_on=?1,updated_at=?2 WHERE chat_id=?3
      AND EXISTS(SELECT 1 FROM chat_publications p WHERE p.id=?4 AND p.user_id=?5)`)
      .bind(nextAllowedOn,now,chat.id,publicationId,userId),
  );
  statements.push(db.prepare(`UPDATE chats SET updated_at=?1 WHERE id=?2 AND user_id=?3
      AND EXISTS(SELECT 1 FROM chat_publications p WHERE p.id=?4 AND p.user_id=?3)`)
      .bind(now,chat.id,userId,publicationId));
  const results = await db.batch(statements);
  return results[0].meta.changes ? { ok: true }
    : { ok: false, error: 'Чат уже змінено або сьогодні в ньому вже публікували. Оновіть список.' };
}

function publicationProfile(row:Record<string,unknown>|null): Pick<ChatProfile,'reviewStatus'|'cadence'|'weekdays'|'customIntervalDays'|'nextAllowedOn'> | null {
  if(!row) return null;
  const cadence = typeof row.cadence==='string' && PROFILE_CADENCES.includes(row.cadence as ProfileCadence) ? row.cadence as ProfileCadence : 'any';
  let weekdays:number[]=[]; try { const parsed=JSON.parse(typeof row.weekdays_json==='string'?row.weekdays_json:'[]'); if(Array.isArray(parsed)) weekdays=parsed.filter(value=>Number.isInteger(value)&&value>=1&&value<=7); } catch {}
  const customIntervalDays = row.custom_interval_days===null||row.custom_interval_days===undefined ? null : Number(row.custom_interval_days);
  return { reviewStatus:row.review_status==='confirmed'?'confirmed':'draft',cadence,weekdays,customIntervalDays:Number.isInteger(customIntervalDays)?customIntervalDays:null,nextAllowedOn:typeof row.next_allowed_on==='string'?row.next_allowed_on:null };
}
