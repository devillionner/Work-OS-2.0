import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { changeChatLeave } from '@/lib/chats/leave';
import { publicationAvailability, recordManualPublication, undoManualPublication } from '@/lib/chats/publication';
import { changeChatSnooze } from '@/lib/chats/snooze';
import { readChatState } from '@/lib/chats/state';
import { transitionChat } from '@/lib/chats/transitions';
import { CHAT_ROW_JOINS, chatListPageStatement, chatRowColumns, telegramJoinQueueStatement, telegramJoinSectionCountsStatement, telegramNewChatsStatement } from '@/lib/chats/list-query';
import { resolveTelegramAccount } from '@/lib/chats/telegram-account';
import { availableTodayStatement, joinedTodayStatement, publishedTodayStatement } from '@/lib/chats/daily-links';
import { PROFILE_CADENCES, saveChatProfile } from '@/lib/chats/profile';
import type { ChatProfileInput } from '@/lib/chats/profile';
import { permanentlyDeleteChat } from '@/lib/chats/permanent-delete';
import { chatMatchesSearch, normalizeChatSearchText } from '@/lib/chats/search';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { resolveDailyPublicationGoal } from '@/lib/publication-goal';
import { revisionCacheEntry, matchRevisionJson, putRevisionJson } from '@/lib/revision-cache';

const PLATFORMS = new Set(['telegram', 'whatsapp', 'viber', 'facebook']);
const STATUSES = new Set(['to_join', 'waiting', 'ready', 'profile_review', 'archived']);
const ACTIONS = new Set(['joined', 'waiting', 'approved', 'failed', 'archive', 'restore', 'snooze', 'unsnooze', 'confirm_leave', 'undo_leave', 'permanent_delete', 'published', 'undo_published', 'assign_account', 'return_to_join', 'profile', 'shortlist', 'unshortlist']);
const REQUEST_MAX_BYTES = 64 * 1024;

type ChatRow = {
  id: string; name: string; link: string; platform: string; workflow_status: string;
  joined_at: number | null; snoozed_until: number | null; archive_reason: string | null; archived_at: number | null; snooze_count: number; left_at: number | null;
  profile_status: string | null; published_today: number;
  profile_language: string | null; profile_cadence: string | null; profile_weekdays: string | null;
  profile_custom_interval_days: number | null; profile_next_allowed_on: string | null;
  profile_directions: string | null; profile_note: string | null;
  telegram_account_id: string | null; state_token: string; discovery_decision: string | null; autopost_job_id: string | null;
  join_candidate_at: number | null; in_schedule: number;
};
const JOIN_QUEUE_MAX = 200;
const POOL_LIMIT_MAX = 500;

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'telegram';
  const status = url.searchParams.get('status') || 'to_join';
  const profile = url.searchParams.get('profile') || 'all';
  const search = (url.searchParams.get('search') || '').trim().slice(0, 150);
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  if (!PLATFORMS.has(platform) || !STATUSES.has(status) || !['all','needs_review'].includes(profile)) return Response.json({ error: 'Невідомий фільтр.' }, { status: 400 });

  const accountId = platform === 'telegram' ? await selectedTelegramAccount(user.id, url.searchParams.get('account')) : null;
  if (platform === 'telegram' && !accountId) return Response.json({ error: 'Додайте активний Telegram-акаунт.' }, { status: 409 });

  const now = unixNow();
  const today = businessDate(now);
  // «Доступні для публікації» (до 200 посилань) коштують сотні читань, тож список їх не несе: клієнт просить їх окремо,
  // коли відкрито чергу «Для публікації», і ще раз при копіюванні.
  if (url.searchParams.get('section') === 'available') {
    const { request: availableCache, revision: availableRevision } = await revisionCacheEntry(env.DB, user.id, 'chats-available',
      `${platform}:${accountId || ''}:${today}:${Math.floor(now/30)}`);
    const availableCached = await matchRevisionJson(availableCache);
    if (availableCached) return availableCached;
    const availableRows = await availableTodayStatement(env.DB, { userId: user.id, platform, date: today, accountId, now }).all();
    const availablePayload = { revision: availableRevision, availableToday: availableRows.results };
    await putRevisionJson(availableCache, availablePayload, 45);
    return Response.json(availablePayload, { headers: { 'Cache-Control': 'no-store', 'X-Work-OS-Cache': 'MISS' } });
  }
  // Telegram «Для приєднання» віддає два розділи: «Нові чати» (chats, зі сторінкою `limit`) і чергу вибраного акаунта (candidates).
  const joinAccount = platform === 'telegram' && status === 'to_join' ? accountId : null;
  const limit = joinAccount ? Math.min(POOL_LIMIT_MAX, Math.max(1, Math.floor(Number(url.searchParams.get('limit'))) || 50)) : 50;
  const { request: cacheRequest, revision } = await revisionCacheEntry(env.DB, user.id, 'chats',
    `unicode-v2:${platform}:${status}:${profile}:${search}:${offset}:${joinAccount ? limit : ''}:${accountId || ''}:${today}:${Math.floor(now/30)}`);
  const cached = await matchRevisionJson(cacheRequest);
  if (cached) return cached;
  const normalizedSearch = normalizeChatSearchText(search);
  const profileFilter = status === 'profile_review' || profile === 'needs_review' ? ` AND (p.review_status IS NULL OR p.review_status!='confirmed')` : '';
  // Same status filter as chatListPageStatement: a plain equality/IN keeps the (platform, status) index.
  // Unicode search matching runs in JavaScript because SQLite/D1 lower()/NOCASE only case-fold ASCII.
  const workflowFilter = status === 'profile_review'
    ? `c.workflow_status IN ('waiting','ready') AND ?3='profile_review'`
    : `c.workflow_status=?3`;
  const accountKey = platform === 'telegram' ? accountId || '' : '';
  const counterAccountFilter = platform === 'telegram'
    ? ` AND (account_key=?3 OR (account_key='' AND workflow_status='to_join'))`
    : ` AND account_key=?3`;
  const counterBindings = [user.id, platform, accountKey];
  let searchPageIds:string[]|null=null;
  let searchTotal=0;
  if(search){
    const searchSource=profileFilter?'FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id':'FROM chats c';
    const searchAccountFilter=platform==='telegram'
      ? ` AND (c.telegram_account_id=?4 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))`
      : '';
    const searchIndex=await env.DB.prepare(`SELECT c.id,c.name,c.link,c.telegram_account_id AS account_id ${searchSource}
      WHERE c.user_id=?1 AND c.platform=?2 AND ${workflowFilter}${profileFilter}${searchAccountFilter}
      ORDER BY c.updated_at DESC,c.id`)
      .bind(user.id,platform,status,...(accountId?[accountId]:[]))
      .all<{id:string;name:string;link:string;account_id:string|null}>();
    const matched=searchIndex.results.filter(row=>chatMatchesSearch(row.name,row.link,normalizedSearch));
    if(joinAccount){
      // Пошук діє на обидва розділи: уся черга акаунта й сторінка «Нових чатів».
      const queueMatched=matched.filter(row=>row.account_id!==null);
      const poolMatched=matched.filter(row=>row.account_id===null);
      searchTotal=poolMatched.length;
      searchPageIds=[...queueMatched.slice(0,JOIN_QUEUE_MAX),...poolMatched.slice(offset,offset+limit)].map(row=>row.id);
    }else{
      searchTotal=matched.length;
      searchPageIds=matched.slice(offset,offset+50).map(row=>row.id);
    }
  }

  const counterTotalSql = status === 'profile_review'
    ? `SELECT COALESCE(SUM(profile_draft_count+profile_empty_count),0) AS count FROM chat_queue_counts WHERE user_id=?1 AND platform=?2 AND workflow_status IN ('waiting','ready')${counterAccountFilter}`
    : profileFilter
      ? `SELECT COALESCE(SUM(profile_draft_count+profile_empty_count),0) AS count FROM chat_queue_counts WHERE user_id=?1 AND platform=?2 AND workflow_status=?4${counterAccountFilter}`
      : `SELECT COALESCE(SUM(chat_count),0) AS count FROM chat_queue_counts WHERE user_id=?1 AND platform=?2 AND workflow_status=?4${counterAccountFilter}`;
  const totalStatement = search
    ? env.DB.prepare('SELECT ?1 AS count').bind(searchTotal)
    // Запит profile_review не має ?4: зайвий параметр привласнений статус давав «wrong number of bindings» і 500.
    : env.DB.prepare(counterTotalSql).bind(...counterBindings, ...(status === 'profile_review' ? [] : [status]));
  const searchRowStatement=search
    ? searchPageIds&&searchPageIds.length
      ? joinAccount
        ? env.DB.prepare(`SELECT ${chatRowColumns('?3')} FROM chats c ${CHAT_ROW_JOINS} WHERE c.user_id=?1 AND c.platform=?2 AND c.id IN (SELECT value FROM json_each(?4)) ORDER BY c.updated_at DESC,c.id`)
          .bind(user.id,platform,today,JSON.stringify(searchPageIds))
        : env.DB.prepare(`SELECT ${chatRowColumns('?3')} FROM chats c ${CHAT_ROW_JOINS} WHERE c.user_id=?1 AND c.platform=?2 AND c.id IN (${searchPageIds.map((_,index)=>`?${index+4}`).join(',')}) ORDER BY c.updated_at DESC,c.id`)
          .bind(user.id,platform,today,...searchPageIds)
      : env.DB.prepare(`SELECT ${chatRowColumns('?3')} FROM chats c ${CHAT_ROW_JOINS} WHERE c.user_id=?1 AND c.platform=?2 AND 0`).bind(user.id,platform,today)
    : null;
  const statements = [
    searchRowStatement||(joinAccount?telegramNewChatsStatement(env.DB,{userId:user.id,today,offset,limit}):chatListPageStatement(env.DB,{userId:user.id,platform,status,needsReview:profile==='needs_review',today,now,offset,accountId})),
    totalStatement,
    env.DB.prepare(`SELECT workflow_status,SUM(chat_count) AS count,SUM(profile_confirmed_count) AS confirmed_count,SUM(profile_draft_count) AS draft_count,SUM(profile_empty_count) AS empty_count FROM chat_queue_counts WHERE user_id=?1 AND platform=?2${counterAccountFilter} GROUP BY workflow_status`).bind(...counterBindings),
    joinedTodayStatement(env.DB,{userId:user.id,platform,date:today,accountId}),
    publishedTodayStatement(env.DB,{userId:user.id,platform,date:today,accountId}),
    env.DB.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key='analytics-daily-goal-schedule-v1' LIMIT 1`).bind(user.id),
    // Лічильник дня (тригери на activity_events) замість COUNT(*) по всіх публікаціях дня: кілька рядків замість ≈60.
    env.DB.prepare(`SELECT COALESCE(SUM(active_count),0) AS count FROM activity_daily_counts WHERE user_id=?1 AND event_date=?2 AND event_type='publication'`).bind(user.id,today),
  ];
  const joinIndex = statements.length;
  if(joinAccount){
    statements.push(telegramJoinSectionCountsStatement(env.DB,{userId:user.id,accountId:joinAccount}));
    if(!search) statements.push(telegramJoinQueueStatement(env.DB,{userId:user.id,accountId:joinAccount,today,limit:JOIN_QUEUE_MAX}));
  }
  const results = await env.DB.batch(statements);
  const [rowsResult, totalResult, countsResult, joinedResult, publishedResult, goalResult, publicationCountResult] = results;
  const toChat = (row: ChatRow) => ({
    id: row.id, name: row.name, link: row.link, platform: row.platform,
    status: row.workflow_status, archiveReason: row.archive_reason, archivedAt: row.archived_at,
    telegramAccountId: row.telegram_account_id, stateToken: row.state_token,
    discoveryDecision: row.discovery_decision === 'target' || row.discovery_decision === 'review' || row.discovery_decision === 'rejected' || row.discovery_decision === 'unavailable' ? row.discovery_decision : null,
    autopostJobId: row.autopost_job_id || null,
    profileConfirmed: row.profile_status === 'confirmed',
    profile: { language: row.profile_language === 'uk' || row.profile_language === 'ru' ? row.profile_language : null,
      cadence: typeof row.profile_cadence === 'string' && PROFILE_CADENCES.includes(row.profile_cadence as typeof PROFILE_CADENCES[number]) ? row.profile_cadence : 'any', weekdays: parseNumberList(row.profile_weekdays), customIntervalDays: row.profile_custom_interval_days === null ? null : Number(row.profile_custom_interval_days), nextAllowedOn: row.profile_next_allowed_on || null, directions: parseStringList(row.profile_directions),
      note: row.profile_note || '', reviewStatus: row.profile_status === 'confirmed' ? 'confirmed' : 'draft' },
    publishedToday: Boolean(row.published_today),
    joinedAt: row.joined_at === null || row.joined_at === undefined ? null : Number(row.joined_at),
    snoozedUntil: row.snoozed_until,
    snoozeCount: Number(row.snooze_count) || 0,
    leftAt: row.left_at === null || row.left_at === undefined ? null : Number(row.left_at),
    ...publicationAvailability(row, now),
    inSchedule: Boolean(row.in_schedule),
    candidateAt: row.join_candidate_at === null || row.join_candidate_at === undefined ? null : Number(row.join_candidate_at),
  });
  const sectionRows = joinAccount ? (results[joinIndex].results as Array<{ account_key: string; count: number }>) : [];
  const sections = joinAccount ? { queue: Number(sectionRows.find((row) => row.account_key === joinAccount)?.count || 0), pool: Number(sectionRows.find((row) => row.account_key === '')?.count || 0) } : null;
  const listedRows = rowsResult.results as ChatRow[];
  const queueRows = !joinAccount ? [] : search
    ? listedRows.filter((row) => row.telegram_account_id !== null).sort((a, b) => Number(a.join_candidate_at || 0) - Number(b.join_candidate_at || 0) || (a.id < b.id ? -1 : 1))
    : (results[joinIndex + 1].results as ChatRow[]);
  const chats = (joinAccount && search ? listedRows.filter((row) => row.telegram_account_id === null) : listedRows).map(toChat);
  const candidates = joinAccount ? queueRows.map(toChat) : undefined;
  chats.sort((a,b) => Number(a.publishedToday)-Number(b.publishedToday)
    || Number(Boolean(a.snoozedUntil && a.snoozedUntil>now))-Number(Boolean(b.snoozedUntil && b.snoozedUntil>now)));
  const countRows = countsResult.results as Array<{workflow_status:string;count:number;confirmed_count:number;draft_count:number;empty_count:number}>;
  const counts = Object.fromEntries(countRows.map((row) => [row.workflow_status, Number(row.count)]));
  const profileCounts = Object.fromEntries(countRows.map((row) => { const confirmed=Number(row.confirmed_count)||0; const draft=Number(row.draft_count)||0; const empty=Number(row.empty_count)||0; return [row.workflow_status,{confirmed,draft,empty,needsReview:draft+empty}]; }));
  const waitingProfiles=profileCounts.waiting || {confirmed:0,draft:0,empty:0,needsReview:0};
  const readyProfiles=profileCounts.ready || {confirmed:0,draft:0,empty:0,needsReview:0};
  profileCounts.profile_review={confirmed:0,draft:waitingProfiles.draft+readyProfiles.draft,empty:waitingProfiles.empty+readyProfiles.empty,needsReview:waitingProfiles.needsReview+readyProfiles.needsReview};
  counts.profile_review=profileCounts.profile_review.needsReview;
  const goalValue = (goalResult.results[0] as {value_json?:string}|undefined)?.value_json;
  const completedPublications = Number((publicationCountResult.results[0] as {count?:number}|undefined)?.count || 0);
  const payload = { revision, chats, ...(candidates ? { candidates, sections } : {}), total: sections ? (search ? searchTotal : sections.pool) : Number((totalResult.results[0] as {count?:number})?.count || 0), offset, counts, profileCounts, accountId, joinedToday: joinedResult.results, publishedToday: publishedResult.results, publicationPace: { ratePerHour: 7, completed: completedPublications, target: resolveDailyPublicationGoal(goalValue,today) } };
  await putRevisionJson(cacheRequest, payload, 45);
  return Response.json(payload, { headers: { 'Cache-Control':'no-store', 'X-Work-OS-Cache':'MISS' } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { id?: unknown; action?: unknown; reason?: unknown; confirmation?: unknown; accountId?: unknown; stateToken?: unknown; advertisementId?: unknown; language?: unknown; quick?: unknown; toPool?: unknown; profile?: ChatProfileInput };
  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!id || !ACTIONS.has(action)) return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  const chat = await readChatState(env.DB,user.id,id);
  if (!chat) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  if (body.stateToken !== chat.state_token) return Response.json({error:'Стан чату вже змінився. Оновіть список.',refresh:true},{status:409});
  const now = unixNow();
  if(chat.platform==='whatsapp'){
    const activeAutopost=await env.DB.prepare(`SELECT id FROM whatsapp_autopost_jobs
      WHERE user_id=?1 AND chat_id=?2 AND status IN ('pending','claimed') LIMIT 1`)
      .bind(user.id,chat.id).first<{id:string}>();
    if(activeAutopost)return Response.json({error:'Для цього чату виконується WhatsApp автопублікація. Дочекайтеся результату або скасуйте pending job.'},{status:409});
  }
  const requestedAccount = typeof body.accountId === 'string' ? body.accountId : null;
  const accountId = chat.platform === 'telegram' ? (chat.telegram_account_id || await selectedTelegramAccount(user.id,requestedAccount)) : null;
  if (chat.platform === 'telegram' && !accountId && !['restore','archive','failed','profile','confirm_leave','undo_leave','permanent_delete','return_to_join'].includes(action)) return Response.json({error:'Оберіть активний Telegram-акаунт.'},{status:409});
  if (action === 'profile') {
    if (!body.profile || typeof body.profile !== 'object' || Array.isArray(body.profile)) return Response.json({error:'Некоректний профіль.'},{status:400});
    const result = await saveChatProfile(env.DB, { userId:user.id, chatId:id, stateToken:chat.state_token, now, profile:body.profile });
    return Response.json(result, { status: result.ok ? 200 : 409 });
  }
  if (action === 'published') {
    if (body.advertisementId !== undefined && body.advertisementId !== null && typeof body.advertisementId !== 'string') return Response.json({ error:'Некоректний матеріал.' }, { status:400 });
    if (body.language !== undefined && body.language !== null && body.language !== '' && body.language !== 'uk' && body.language !== 'ru') return Response.json({ error:'Некоректна мова публікації.' }, { status:400 });
    if (body.quick !== undefined && typeof body.quick !== 'boolean') return Response.json({ error:'Некоректний режим публікації.' }, { status:400 });
    const advertisementId = typeof body.advertisementId === 'string' ? body.advertisementId.trim().slice(0, 100) || null : null;
    const language = body.language === 'uk' || body.language === 'ru' ? body.language : null;
    const quickMode = body.quick === true;
    if (quickMode && chat.platform !== 'whatsapp' && chat.platform !== 'viber') return Response.json({ error:'Швидка публікація доступна лише для WhatsApp і Viber.' }, { status:400 });
    if (quickMode && !advertisementId) return Response.json({ error:'Для швидкої публікації оберіть матеріал.' }, { status:400 });
    const result = await recordManualPublication(env.DB, { userId: user.id, chat, accountId, advertisementId, language, quickMode, now, date: businessDate(now), stateToken: chat.state_token });
    if (!result.ok) return Response.json(result, { status: 409 });
    const next = await readChatState(env.DB,user.id,id);
    if (!next) return Response.json({ error: 'Не вдалося підтвердити новий стан. Оновіть список.' }, { status: 409 });
    const publicationState = await readPublicationState(user.id,next,accountId,businessDate(now));
    return Response.json({ ...result, stateToken: next.state_token, publicationState });
  }

  if (action === 'undo_published') {
    const result = await undoManualPublication(env.DB,{userId:user.id,chat,now,date:businessDate(now)});
    if (!result.ok) return Response.json(result,{status:409});
    const next = await readChatState(env.DB,user.id,id);
    if (!next) return Response.json({ error: 'Не вдалося підтвердити новий стан. Оновіть список.' }, { status: 409 });
    const publicationState = await readPublicationState(user.id,next,accountId,businessDate(now));
    return Response.json({ ...result, stateToken: next.state_token, publicationState });
  }

  if (action === 'snooze' || action === 'unsnooze') {
    const ok = await changeChatSnooze(env.DB, { userId: user.id, id, status: chat.workflow_status,
      previousDeadline: chat.snoozed_until, now, resume: action === 'unsnooze', stateToken: chat.state_token });
    if (!ok) return Response.json({ error: 'Стан чату вже змінився. Оновіть список.' }, { status: 409 });
    const next = await readChatState(env.DB,user.id,id);
    return next ? Response.json({ ok: true, stateToken: next.state_token, snoozedUntil: next.snoozed_until })
      : Response.json({ error: 'Не вдалося підтвердити новий стан. Оновіть список.' }, { status: 409 });
  }

  if (action === 'confirm_leave' || action === 'undo_leave') {
    const result = await changeChatLeave(env.DB,{userId:user.id,chat,now,confirm:action==='confirm_leave'});
    if(!result.ok) return Response.json(result,{status:409});
    const next=await readChatState(env.DB,user.id,id);
    return next ? Response.json({ok:true,stateToken:next.state_token,leftAt:next.left_at})
      : Response.json({error:'Не вдалося підтвердити новий стан. Оновіть список.'},{status:409});
  }

  if (action === 'permanent_delete') {
    if(body.confirmation!=='PERMANENTLY_DELETE_NONEXISTENT_CHAT') return Response.json({error:'Потрібне явне підтвердження остаточного видалення.'},{status:400});
    const result=await permanentlyDeleteChat(env.DB,{userId:user.id,chat,now});
    return Response.json(result,{status:result.ok?200:409});
  }

  const targetAccount = action === 'assign_account' ? requestedAccount : accountId;
  const result = await transitionChat(env.DB,{userId:user.id,chat,action,accountId:targetAccount,now,
    reason:typeof body.reason === 'string' ? body.reason : undefined,toPool:body.toPool === true});
  if (!result.ok) return Response.json(result,{status:409});
  if (action === 'archive' || action === 'failed' || action === 'restore' || action === 'joined' || action === 'waiting' || action === 'shortlist' || action === 'unshortlist') {
    const next = await readChatState(env.DB,user.id,id);
    return next ? Response.json({ ...result, stateToken: next.state_token })
      : Response.json({ error: 'Не вдалося підтвердити новий стан. Оновіть список.' }, { status: 409 });
  }
  return Response.json(result,{status:200});
}

function unixNow() { return Math.floor(Date.now() / 1000); }
function parseNumberList(value:string|null) { try { const parsed=JSON.parse(value||'[]'); return Array.isArray(parsed)?parsed.filter((item):item is number=>Number.isInteger(item)&&item>=1&&item<=7):[]; } catch { return []; } }
function parseStringList(value:string|null) { try { const parsed=JSON.parse(value||'[]'); return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==='string'):[]; } catch { return []; } }
async function readPublicationState(userId:string, chat:{id:string;platform:string}, accountId:string|null, date:string) {
  const publishedStatement = publishedTodayStatement(env.DB,{userId,platform:chat.platform,date,accountId});
  const [chatPublishedResult,publishedResult,goalResult,publicationCountResult] = await env.DB.batch([
    env.DB.prepare(`SELECT EXISTS(SELECT 1 FROM chat_publications
      WHERE user_id=?1 AND chat_id=?2 AND published_on=?3) AS published`).bind(userId,chat.id,date),
    publishedStatement,
    env.DB.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key='analytics-daily-goal-schedule-v1' LIMIT 1`).bind(userId),
    env.DB.prepare(`SELECT COALESCE(SUM(active_count),0) AS count FROM activity_daily_counts
      WHERE user_id=?1 AND event_date=?2 AND event_type='publication'`).bind(userId,date),
  ]);
  const goalValue=(goalResult.results[0] as {value_json?:string}|undefined)?.value_json;
  return {
    chatId:chat.id,
    chatPublishedToday:Boolean((chatPublishedResult.results[0] as {published?:number}|undefined)?.published),
    publishedToday:publishedResult.results,
    publicationPace:{
      ratePerHour:7,
      completed:Number((publicationCountResult.results[0] as {count?:number}|undefined)?.count||0),
      target:resolveDailyPublicationGoal(goalValue,date),
    },
  };
}

function selectedTelegramAccount(userId:string,requested:string|null) {
  return resolveTelegramAccount(env.DB,userId,requested,unixNow());
}
