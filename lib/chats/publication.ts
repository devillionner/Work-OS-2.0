import { validatePublicationAdvertisementChoice } from './advertisement-selection.ts';
import { chatStateEvent, chatStateTokenSql, type ChatState } from './state.ts';
import { nextProfilePublicationDate, profilePublicationRule, PROFILE_CADENCES, type ChatProfile, type ProfileCadence } from './profile.ts';

const MANUAL_PUBLICATION_UNDO_WINDOW_SECONDS = 8;

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
): Promise<{ ok: true; publicationId: string; undoExpiresAt: number } | { ok: false; error: string; availableAt?: number | null }> {
  const { userId, chat, accountId, advertisementId = null, now, date } = input;
  const language = input.language === 'uk' || input.language === 'ru' ? input.language : null;
  const quickMode = input.quickMode === true;
  if (quickMode && chat.platform !== 'whatsapp' && chat.platform !== 'viber')
    return { ok:false,error:'Швидка публікація доступна лише для WhatsApp і Viber.' };
  if (quickMode && !advertisementId)
    return { ok:false,error:'Для швидкої публікації оберіть матеріал.' };
  const discovery = await db.prepare(`SELECT decision FROM chat_discovery_candidates
    WHERE user_id=?1 AND imported_chat_id=?2 ORDER BY updated_at DESC,id LIMIT 1`)
    .bind(userId,chat.id).first<{ decision:string }>();
  if (discovery && discovery.decision !== 'target')
    return { ok:false,error:'Чат із автопошуку ще не пройшов кваліфікацію для публікації.' };
  const profileRow = await db.prepare(`SELECT p.cadence,p.weekdays_json,p.custom_interval_days,p.next_allowed_on,p.review_status
    FROM chat_profiles p JOIN chats c ON c.id=p.chat_id WHERE p.chat_id=?1 AND c.user_id=?2 LIMIT 1`).bind(chat.id,userId).first<Record<string,unknown>>();
  const profile = publicationProfile(profileRow);
  if (!quickMode && chat.platform !== 'viber' && profile?.reviewStatus !== 'confirmed')
    return { ok:false,error:'Звичайна публікація потребує підтвердженого профілю чату. Уточніть профіль або використайте швидкий режим для WhatsApp.' };
  if (profile) {
    const rule = profilePublicationRule(profile,date);
    if (!rule.allowed) return { ok:false,error:rule.reason || 'Публікація зараз недоступна.' };
  }
  const nextAllowedOn = profile?.reviewStatus === 'confirmed' ? nextProfilePublicationDate(date,profile.cadence,profile.customIntervalDays) : null;
  const activeAutopost = chat.platform === 'whatsapp'
    ? await db.prepare(`SELECT id FROM whatsapp_autopost_jobs
        WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 AND status IN ('pending','claimed') LIMIT 1`)
      .bind(userId,chat.id,date).first<{id:string}>()
    : null;
  if (activeAutopost) return { ok:false,error:'Для цього чату вже виконується WhatsApp автопублікація.' };
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
  const eventMetadata: Record<string, unknown> = {
    manualUndo: {
      profileCadenceAdvanced: profile?.reviewStatus === 'confirmed',
      previousNextAllowedOn: profile?.nextAllowedOn ?? null,
    },
  };
  if (advertisementId) eventMetadata.advertisementId = advertisementId;
  if (language) eventMetadata.language = language;
  const statements = [
    db.prepare(`INSERT INTO chat_publications
      (id,user_id,chat_id,published_on,published_at,advertisement_id,source,source_key,created_at,telegram_account_id)
      SELECT ?1,c.user_id,c.id,?2,?3,?6,'manual',?4,?3,CASE WHEN c.platform='telegram' THEN COALESCE(c.telegram_account_id,?5) ELSE NULL END
      FROM chats c WHERE c.id=?7 AND c.user_id=?8 AND c.workflow_status='ready'
        AND (c.snoozed_until IS NULL OR c.snoozed_until<=?3)
        AND (c.platform!='telegram' OR c.joined_at IS NULL OR c.joined_at+21600<=?3)
        AND NOT EXISTS(SELECT 1 FROM chat_discovery_candidates dc
          WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id AND dc.decision!='target')
        AND ${chatStateTokenSql()}=?9
        AND (?10=1 OR c.platform='viber' OR EXISTS(SELECT 1 FROM chat_profiles pr WHERE pr.chat_id=c.id AND pr.review_status='confirmed'))
        AND (?6 IS NULL OR EXISTS(SELECT 1 FROM library_items li
          WHERE li.id=?6 AND li.user_id=c.user_id AND li.kind='advertisement' AND li.archived_at IS NULL))
        AND (c.platform!='telegram' OR EXISTS(SELECT 1 FROM telegram_accounts a
          WHERE a.id=COALESCE(c.telegram_account_id,?5) AND a.user_id=c.user_id AND a.is_enabled=1))
      ON CONFLICT(user_id,chat_id,published_on) DO NOTHING`)
      .bind(publicationId,date,now,sourceKey,accountId,advertisementId,chat.id,userId,input.stateToken,Number(quickMode)),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,p.user_id,'publication',c.platform,p.chat_id,NULL,NULL,p.published_at,p.published_on,
        ?4,p.source_key,p.telegram_account_id
      FROM chat_publications p JOIN chats c ON c.id=p.chat_id AND c.user_id=p.user_id
      WHERE p.id=?2 AND p.user_id=?3`).bind(crypto.randomUUID(),publicationId,userId,JSON.stringify(eventMetadata)),
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
  return results[0].meta.changes ? { ok: true, publicationId, undoExpiresAt: now + MANUAL_PUBLICATION_UNDO_WINDOW_SECONDS }
    : { ok: false, error: 'Чат уже змінено або сьогодні в ньому вже публікували. Оновіть список.' };
}

export async function recordConfirmedWhatsappAutopostPublication(
  db: D1Database,
  input: {
    userId:string; chatId:string; advertisementId:string; language:'uk'|'ru';
    now:number; date:string; sourceKey:string; automationJobId:string;
  },
): Promise<{ok:true;publicationId:string;existing:boolean}|{ok:false;error:string}> {
  const chat = await db.prepare(`SELECT id,platform,workflow_status,joined_at,snoozed_until
    FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(input.chatId,input.userId).first<PublicationChat>();
  if(!chat||chat.platform!=='whatsapp') return {ok:false,error:'WhatsApp-чат для автопублікації не знайдено.'};

  const existing = await db.prepare(`SELECT id,source_key FROM chat_publications
    WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`)
    .bind(input.userId,input.chatId,input.date).first<{id:string;source_key:string}>();
  if(existing) {
    return existing.source_key===input.sourceKey
      ? {ok:true,publicationId:existing.id,existing:true}
      : {ok:false,error:'У цьому чаті вже є інша підтверджена публікація за сьогодні.'};
  }

  const profileRow = await db.prepare(`SELECT p.cadence,p.weekdays_json,p.custom_interval_days,p.next_allowed_on,p.review_status
    FROM chat_profiles p JOIN chats c ON c.id=p.chat_id WHERE p.chat_id=?1 AND c.user_id=?2 LIMIT 1`)
    .bind(input.chatId,input.userId).first<Record<string,unknown>>();
  const profile = publicationProfile(profileRow);
  const publicationId=crypto.randomUUID();
  const nextAllowedOn=profile?.reviewStatus==='confirmed'
    ? nextProfilePublicationDate(input.date,profile.cadence,profile.customIntervalDays)
    : null;
  const metadata=JSON.stringify({
    advertisementId:input.advertisementId,
    language:input.language,
    automation:{kind:'whatsapp_autopost',jobId:input.automationJobId,sendConfirmed:true},
  });
  const statements=[
    db.prepare(`INSERT INTO chat_publications
      (id,user_id,chat_id,published_on,published_at,advertisement_id,source,source_key,created_at,telegram_account_id)
      SELECT ?1,c.user_id,c.id,?2,?3,?4,'whatsapp_autopost',?5,?3,NULL
      FROM chats c
      WHERE c.id=?6 AND c.user_id=?7 AND c.platform='whatsapp'
        AND NOT EXISTS(SELECT 1 FROM chat_publications p
          WHERE p.user_id=c.user_id AND p.chat_id=c.id AND p.published_on=?2)
        AND EXISTS(SELECT 1 FROM library_items li
          WHERE li.id=?4 AND li.user_id=c.user_id AND li.kind='advertisement')
      ON CONFLICT(user_id,chat_id,published_on) DO NOTHING`)
      .bind(publicationId,input.date,input.now,input.advertisementId,input.sourceKey,input.chatId,input.userId),
    db.prepare(`INSERT INTO activity_events
      (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id)
      SELECT ?1,p.user_id,'publication','whatsapp',p.chat_id,NULL,NULL,p.published_at,p.published_on,
        ?4,p.source_key,NULL
      FROM chat_publications p
      WHERE p.id=?2 AND p.user_id=?3`)
      .bind(crypto.randomUUID(),publicationId,input.userId,metadata),
  ];
  if(profile?.reviewStatus==='confirmed') statements.push(
    db.prepare(`UPDATE chat_profiles SET next_allowed_on=?1,updated_at=?2
      WHERE chat_id=?3 AND EXISTS(SELECT 1 FROM chat_publications p WHERE p.id=?4 AND p.user_id=?5)`)
      .bind(nextAllowedOn,input.now,input.chatId,publicationId,input.userId),
  );
  statements.push(
    db.prepare(`UPDATE chats SET updated_at=?1 WHERE id=?2 AND user_id=?3
      AND EXISTS(SELECT 1 FROM chat_publications p WHERE p.id=?4 AND p.user_id=?3)`)
      .bind(input.now,input.chatId,input.userId,publicationId),
  );
  const results=await db.batch(statements);
  if(results[0].meta.changes)return {ok:true,publicationId,existing:false};
  const reconciled=await db.prepare(`SELECT id,source_key FROM chat_publications
    WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`)
    .bind(input.userId,input.chatId,input.date).first<{id:string;source_key:string}>();
  return reconciled?.source_key===input.sourceKey
    ? {ok:true,publicationId:reconciled.id,existing:true}
    : {ok:false,error:'Підтверджений send не вдалося безпечно зв’язати з canonical publication fact.'};
}

export async function undoManualPublication(
  db: D1Database,
  input: { userId: string; chat: ChatState; now: number; date: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, chat, now, date } = input;
  if (chat.workflow_status !== 'ready') return { ok:false,error:'Скасування публікації доступне лише в черзі публікації.' };
  const publication = await db.prepare(`SELECT p.id,p.source_key,p.published_at,e.id AS event_id,e.metadata_json,e.cancelled_at
    FROM chat_publications p JOIN activity_events e
      ON e.user_id=p.user_id AND e.source_key=p.source_key AND e.event_type='publication'
    WHERE p.user_id=?1 AND p.chat_id=?2 AND p.published_on=?3 AND p.source='manual'
    ORDER BY p.created_at DESC LIMIT 1`).bind(userId,chat.id,date)
    .first<{id:string;source_key:string;published_at:number;event_id:string;metadata_json:string;cancelled_at:number|null}>();
  if (!publication || publication.cancelled_at !== null)
    return { ok:false,error:'Активну ручну публікацію за сьогодні не знайдено. Оновіть список.' };
  if (!Number.isFinite(publication.published_at) || publication.published_at > now || now - publication.published_at > MANUAL_PUBLICATION_UNDO_WINDOW_SECONDS)
    return { ok:false,error:'Час швидкого скасування минув. Для пізнішого виправлення скористайтеся корекцією звіту.' };

  let metadata: unknown;
  try { metadata = JSON.parse(publication.metadata_json || '{}'); } catch { metadata = null; }
  const undo = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as {manualUndo?:unknown}).manualUndo : null;
  if (!undo || typeof undo !== 'object' || Array.isArray(undo))
    return { ok:false,error:'Цю стару публікацію не можна безпечно скасувати автоматично. Скористайтеся корекцією звіту.' };
  const undoData = undo as {profileCadenceAdvanced?:unknown;previousNextAllowedOn?:unknown};
  if (typeof undoData.profileCadenceAdvanced !== 'boolean')
    return { ok:false,error:'Для цієї публікації бракує даних безпечного відновлення.' };
  let previousNextAllowedOn: string | null = null;
  if (undoData.profileCadenceAdvanced) {
    const previous = undoData.previousNextAllowedOn;
    if (previous !== null && (typeof previous !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(previous)))
      return { ok:false,error:'Не вдалося підтвердити попередню дозволену дату публікації.' };
    previousNextAllowedOn = previous;
  }

  const slot = chat.platform === 'telegram'
    ? await db.prepare(`SELECT id FROM telegram_schedule_slots
        WHERE user_id=?1 AND publication_id=?2 AND status='completed' LIMIT 1`)
      .bind(userId,publication.id).first<{id:string}>()
    : null;
  if (undoData.profileCadenceAdvanced) {
    const profile = await db.prepare(`SELECT chat_id FROM chat_profiles WHERE chat_id=?1 LIMIT 1`).bind(chat.id).first();
    if (!profile) return { ok:false,error:'Профіль чату вже змінився. Оновіть список.' };
  }

  const correctionEventId = crypto.randomUUID();
  const statements = [
    db.prepare(`UPDATE chats SET updated_at=?1
      WHERE id=?2 AND user_id=?3 AND workflow_status='ready' AND ${chatStateTokenSql('chats')}=?4`)
      .bind(now,chat.id,userId,chat.state_token),
  ];
  if (slot) statements.push(
    db.prepare(`UPDATE telegram_schedule_slots
      SET status='pending',completed_at=NULL,publication_id=NULL,updated_at=?1,version=version+1
      WHERE id=?2 AND user_id=?3 AND publication_id=?4 AND status='completed' AND changes()=1`)
      .bind(now,slot.id,userId,publication.id),
  );
  if (undoData.profileCadenceAdvanced) statements.push(
    db.prepare(`UPDATE chat_profiles SET next_allowed_on=?1,updated_at=?2
      WHERE chat_id=?3 AND changes()=1`)
      .bind(previousNextAllowedOn,now,chat.id),
  );
  statements.push(
    db.prepare(`DELETE FROM chat_publications
      WHERE id=?1 AND user_id=?2 AND chat_id=?3 AND published_on=?4 AND source='manual' AND changes()=1`)
      .bind(publication.id,userId,chat.id,date),
    db.prepare(`UPDATE activity_events SET cancelled_at=?1
      WHERE id=?2 AND user_id=?3 AND event_type='publication' AND source_key=?4
        AND cancelled_at IS NULL AND changes()=1`)
      .bind(now,publication.event_id,userId,publication.source_key),
    chatStateEvent(db,{id:correctionEventId,userId,chatId:chat.id,action:'undo_published',now,previous:chat.state_token}),
  );
  try {
    const results = await db.batch(statements);
    return results.at(-1)?.meta.changes ? {ok:true}
      : {ok:false,error:'Публікація вже змінилася. Оновіть список перед повторною спробою.'};
  } catch {
    return {ok:false,error:'Не вдалося безпечно скасувати публікацію. Оновіть список і спробуйте ще раз.'};
  }
}

function publicationProfile(row:Record<string,unknown>|null): Pick<ChatProfile,'reviewStatus'|'cadence'|'weekdays'|'customIntervalDays'|'nextAllowedOn'> | null {
  if(!row) return null;
  const cadence = typeof row.cadence==='string' && PROFILE_CADENCES.includes(row.cadence as ProfileCadence) ? row.cadence as ProfileCadence : 'any';
  let weekdays:number[]=[]; try { const parsed=JSON.parse(typeof row.weekdays_json==='string'?row.weekdays_json:'[]'); if(Array.isArray(parsed)) weekdays=parsed.filter(value=>Number.isInteger(value)&&value>=1&&value<=7); } catch {}
  const customIntervalDays = row.custom_interval_days===null||row.custom_interval_days===undefined ? null : Number(row.custom_interval_days);
  return { reviewStatus:row.review_status==='confirmed'?'confirmed':'draft',cadence,weekdays,customIntervalDays:Number.isInteger(customIntervalDays)?customIntervalDays:null,nextAllowedOn:typeof row.next_allowed_on==='string'?row.next_allowed_on:null };
}