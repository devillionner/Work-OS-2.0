import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { businessDate } from '@/lib/business-time';
import { changeChatLeave } from '@/lib/chats/leave';
import { publicationAvailability, recordManualPublication } from '@/lib/chats/publication';
import { changeChatSnooze } from '@/lib/chats/snooze';
import { chatSnoozeCountSql } from '@/lib/chats/snooze-history';
import { chatLeftAtSql, chatStateTokenSql, readChatState } from '@/lib/chats/state';
import { transitionChat } from '@/lib/chats/transitions';
import { availableTodayStatement, joinedTodayStatement } from '@/lib/chats/daily-links';
import { PROFILE_CADENCES, saveChatProfile } from '@/lib/chats/profile';
import type { ChatProfileInput } from '@/lib/chats/profile';
import { permanentlyDeleteChat } from '@/lib/chats/permanent-delete';
import { readJsonObject, sameOrigin } from '@/lib/http-json';
import { resolveDailyPublicationGoal } from '@/lib/publication-goal';

const PLATFORMS = new Set(['telegram', 'whatsapp', 'viber', 'facebook']);
const STATUSES = new Set(['to_join', 'waiting', 'ready', 'archived']);
const ACTIONS = new Set(['joined', 'waiting', 'approved', 'failed', 'archive', 'restore', 'snooze', 'unsnooze', 'confirm_leave', 'undo_leave', 'permanent_delete', 'published', 'assign_account', 'return_to_join', 'profile']);
const REQUEST_MAX_BYTES = 64 * 1024;

type ChatRow = {
  id: string; name: string; link: string; platform: string; workflow_status: string;
  joined_at: number | null; snoozed_until: number | null; archive_reason: string | null; archived_at: number | null; snooze_count: number; left_at: number | null;
  profile_status: string | null; published_today: number;
  profile_language: string | null; profile_cadence: string | null; profile_weekdays: string | null;
  profile_custom_interval_days: number | null; profile_next_allowed_on: string | null;
  profile_directions: string | null; profile_note: string | null;
  telegram_account_id: string | null; state_token: string; discovery_decision: string | null;
};

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
  const pattern = `%${escapeLike(search.toLowerCase())}%`;
  const profileFilter = profile === 'needs_review' ? ` AND (p.review_status IS NULL OR p.review_status!='confirmed')` : '';
  const filter = `c.user_id=?1 AND c.platform=?2 AND c.workflow_status=?3 AND (?4='' OR lower(c.name) LIKE ?5 ESCAPE '\\' OR lower(c.link) LIKE ?5 ESCAPE '\\')${profileFilter}`;
  const totalSource = profileFilter ? 'FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id' : 'FROM chats c';
  const rowAccountFilter = platform === 'telegram' ? ` AND (c.telegram_account_id=?9 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))` : '';
  const totalAccountFilter = platform === 'telegram' ? ` AND (c.telegram_account_id=?6 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))` : '';
  const statements = [
    env.DB.prepare(`SELECT c.id,c.name,c.link,c.platform,c.workflow_status,c.joined_at,c.snoozed_until,c.archive_reason,c.archived_at,${chatSnoozeCountSql()} AS snooze_count,${chatLeftAtSql()} AS left_at,c.telegram_account_id,${chatStateTokenSql()} AS state_token,p.review_status AS profile_status,p.language AS profile_language,p.cadence AS profile_cadence,p.weekdays_json AS profile_weekdays,p.custom_interval_days AS profile_custom_interval_days,p.next_allowed_on AS profile_next_allowed_on,p.directions_json AS profile_directions,p.note AS profile_note,(SELECT dc.decision FROM chat_discovery_candidates dc WHERE dc.user_id=c.user_id AND dc.imported_chat_id=c.id ORDER BY dc.updated_at DESC,dc.id LIMIT 1) AS discovery_decision,EXISTS(SELECT 1 FROM chat_publications cp WHERE cp.user_id=c.user_id AND cp.chat_id=c.id AND cp.published_on=?6) AS published_today FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE ${filter}${rowAccountFilter} ORDER BY published_today ASC,CASE WHEN c.snoozed_until IS NOT NULL AND c.snoozed_until>?7 THEN 1 ELSE 0 END,c.updated_at DESC,c.name LIMIT 50 OFFSET ?8`).bind(user.id, platform, status, search, pattern, today, now, offset, ...(accountId?[accountId]:[])),
    env.DB.prepare(`SELECT COUNT(*) AS count ${totalSource} WHERE ${filter}${totalAccountFilter}`).bind(user.id, platform, status, search, pattern, ...(accountId?[accountId]:[])),
    platform === 'telegram'
      ? env.DB.prepare(`SELECT c.workflow_status,COUNT(*) AS count,SUM(CASE WHEN p.review_status='confirmed' THEN 1 ELSE 0 END) AS confirmed_count,SUM(CASE WHEN p.review_status='draft' THEN 1 ELSE 0 END) AS draft_count,SUM(CASE WHEN p.chat_id IS NULL THEN 1 ELSE 0 END) AS empty_count FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform=?2 AND (c.telegram_account_id=?3 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join')) GROUP BY c.workflow_status`).bind(user.id,platform,accountId)
      : env.DB.prepare(`SELECT c.workflow_status,COUNT(*) AS count,SUM(CASE WHEN p.review_status='confirmed' THEN 1 ELSE 0 END) AS confirmed_count,SUM(CASE WHEN p.review_status='draft' THEN 1 ELSE 0 END) AS draft_count,SUM(CASE WHEN p.chat_id IS NULL THEN 1 ELSE 0 END) AS empty_count FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE c.user_id=?1 AND c.platform=?2 GROUP BY c.workflow_status`).bind(user.id,platform),
    joinedTodayStatement(env.DB,{userId:user.id,platform,date:today,accountId}),
    platform === 'telegram'
      ? env.DB.prepare(`SELECT c.name,c.link FROM chat_publications p JOIN chats c ON c.id=p.chat_id WHERE p.user_id=?1 AND c.platform=?2 AND p.published_on=?3 AND p.telegram_account_id=?4 ORDER BY p.published_at,p.created_at`).bind(user.id,platform,today,accountId)
      : env.DB.prepare(`SELECT c.name,c.link FROM chat_publications p JOIN chats c ON c.id=p.chat_id WHERE p.user_id=?1 AND c.platform=?2 AND p.published_on=?3 ORDER BY p.published_at,p.created_at`).bind(user.id,platform,today),
    env.DB.prepare(`SELECT value_json FROM user_settings WHERE user_id=?1 AND setting_key='analytics-daily-goal-schedule-v1' LIMIT 1`).bind(user.id),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM activity_events WHERE user_id=?1 AND event_type='publication' AND event_date=?2 AND cancelled_at IS NULL`).bind(user.id,today),
  ];
  if(status==='ready') statements.push(availableTodayStatement(env.DB,{userId:user.id,platform,date:today,accountId,now}));
  const results = await env.DB.batch(statements);
  const [rowsResult, totalResult, countsResult, joinedResult, publishedResult, goalResult, publicationCountResult] = results;
  const availableResult = status==='ready' ? results[7] : { results: [] };
  const chats = (rowsResult.results as ChatRow[]).map((row) => ({
    id: row.id, name: row.name, link: row.link, platform: row.platform,
    status: row.workflow_status, archiveReason: row.archive_reason, archivedAt: row.archived_at,
    telegramAccountId: row.telegram_account_id, stateToken: row.state_token,
    discoveryDecision: row.discovery_decision === 'target' || row.discovery_decision === 'review' || row.discovery_decision === 'rejected' || row.discovery_decision === 'unavailable' ? row.discovery_decision : null,
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
  }));
  const countRows = countsResult.results as Array<{workflow_status:string;count:number;confirmed_count:number;draft_count:number;empty_count:number}>;
  const counts = Object.fromEntries(countRows.map((row) => [row.workflow_status, Number(row.count)]));
  const profileCounts = Object.fromEntries(countRows.map((row) => { const confirmed=Number(row.confirmed_count)||0; const draft=Number(row.draft_count)||0; const empty=Number(row.empty_count)||0; return [row.workflow_status,{confirmed,draft,empty,needsReview:draft+empty}]; }));
  const goalValue = (goalResult.results[0] as {value_json?:string}|undefined)?.value_json;
  const completedPublications = Number((publicationCountResult.results[0] as {count?:number}|undefined)?.count || 0);
  return Response.json({ chats, total: Number((totalResult.results[0] as {count?:number})?.count || 0), offset, counts, profileCounts, accountId, joinedToday: joinedResult.results, publishedToday: publishedResult.results, availableToday: availableResult.results, publicationPace: { ratePerHour: 7, completed: completedPublications, target: resolveDailyPublicationGoal(goalValue,today) } });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const parsed = await readJsonObject(request, REQUEST_MAX_BYTES);
  if (parsed instanceof Response) return parsed;
  const body = parsed as { id?: unknown; action?: unknown; reason?: unknown; confirmation?: unknown; accountId?: unknown; stateToken?: unknown; advertisementId?: unknown; language?: unknown; quick?: unknown; profile?: ChatProfileInput };
  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!id || !ACTIONS.has(action)) return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  const chat = await readChatState(env.DB,user.id,id);
  if (!chat) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  if (body.stateToken !== chat.state_token) return Response.json({error:'Стан чату вже змінився. Оновіть список.',refresh:true},{status:409});
  const now = unixNow();
  const requestedAccount = typeof body.accountId === 'string' ? body.accountId : null;
  const accountId = chat.platform === 'telegram' ? (chat.telegram_account_id || await selectedTelegramAccount(user.id,requestedAccount)) : null;
  if (chat.platform === 'telegram' && !accountId && !['restore','archive','failed','profile','confirm_leave','undo_leave','permanent_delete'].includes(action)) return Response.json({error:'Оберіть активний Telegram-акаунт.'},{status:409});
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
    return Response.json(result, { status: result.ok ? 200 : 409 });
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
    reason:typeof body.reason === 'string' ? body.reason : undefined});
  if (!result.ok) return Response.json(result,{status:409});
  if (action === 'archive' || action === 'failed' || action === 'restore') {
    const next = await readChatState(env.DB,user.id,id);
    return next ? Response.json({ ...result, stateToken: next.state_token })
      : Response.json({ error: 'Не вдалося підтвердити новий стан. Оновіть список.' }, { status: 409 });
  }
  return Response.json(result,{status:200});
}

function unixNow() { return Math.floor(Date.now() / 1000); }
function parseNumberList(value:string|null) { try { const parsed=JSON.parse(value||'[]'); return Array.isArray(parsed)?parsed.filter((item):item is number=>Number.isInteger(item)&&item>=1&&item<=7):[]; } catch { return []; } }
function parseStringList(value:string|null) { try { const parsed=JSON.parse(value||'[]'); return Array.isArray(parsed)?parsed.filter((item):item is string=>typeof item==='string'):[]; } catch { return []; } }
function escapeLike(value: string) { return value.replace(/[\\%_]/g, '\\$&'); }
async function selectedTelegramAccount(userId:string,requested:string|null) {
  let row=requested
    ? await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1 LIMIT 1`).bind(requested,userId).first<{id:string}>()
    : await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE user_id=?1 AND is_enabled=1 ORDER BY is_selected DESC,account_number LIMIT 1`).bind(userId).first<{id:string}>();
  if(!row&&!requested) {
    const now=unixNow();
    const id=`${userId}:tg1`;
    await env.DB.prepare(`INSERT OR IGNORE INTO telegram_accounts (id,user_id,account_number,name,is_enabled,is_selected,created_at,updated_at) VALUES (?1,?2,1,'TG 1',1,1,?3,?3)`).bind(id,userId,now).run();
    row=await env.DB.prepare(`SELECT id FROM telegram_accounts WHERE id=?1 AND user_id=?2 AND is_enabled=1 LIMIT 1`).bind(id,userId).first<{id:string}>();
  }
  return row?.id||null;
}
