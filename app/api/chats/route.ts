import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';

const PLATFORMS = new Set(['telegram', 'whatsapp', 'viber', 'facebook']);
const STATUSES = new Set(['to_join', 'waiting', 'ready', 'archived']);
const ACTIONS = new Set(['joined', 'waiting', 'approved', 'failed', 'archive', 'restore', 'snooze', 'published', 'assign_account']);

type ChatRow = {
  id: string; name: string; link: string; platform: string; workflow_status: string;
  joined_at: number | null; snoozed_until: number | null; archive_reason: string | null;
  profile_status: string | null; published_today: number;
  telegram_account_id: string | null;
};

export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'telegram';
  const status = url.searchParams.get('status') || 'to_join';
  const search = (url.searchParams.get('search') || '').trim().slice(0, 150);
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  if (!PLATFORMS.has(platform) || !STATUSES.has(status)) return Response.json({ error: 'Невідомий фільтр.' }, { status: 400 });

  const accountId = platform === 'telegram' ? await selectedTelegramAccount(user.id, url.searchParams.get('account')) : null;
  if (platform === 'telegram' && !accountId) return Response.json({ error: 'Додайте активний Telegram-акаунт.' }, { status: 409 });

  const today = kyivDate();
  const pattern = `%${escapeLike(search.toLowerCase())}%`;
  const filter = `c.user_id=?1 AND c.platform=?2 AND c.workflow_status=?3 AND (?4='' OR lower(c.name) LIKE ?5 ESCAPE '\\' OR lower(c.link) LIKE ?5 ESCAPE '\\')`;
  const rowAccountFilter = platform === 'telegram' ? ` AND (c.telegram_account_id=?9 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))` : '';
  const totalAccountFilter = platform === 'telegram' ? ` AND (c.telegram_account_id=?6 OR (c.telegram_account_id IS NULL AND c.workflow_status='to_join'))` : '';
  const [rowsResult, totalResult, countsResult, joinedResult, publishedResult] = await env.DB.batch([
    env.DB.prepare(`SELECT c.id,c.name,c.link,c.platform,c.workflow_status,c.joined_at,c.snoozed_until,c.archive_reason,c.telegram_account_id,p.review_status AS profile_status,EXISTS(SELECT 1 FROM chat_publications cp WHERE cp.user_id=c.user_id AND cp.chat_id=c.id AND cp.published_on=?6) AS published_today FROM chats c LEFT JOIN chat_profiles p ON p.chat_id=c.id WHERE ${filter}${rowAccountFilter} ORDER BY CASE WHEN c.snoozed_until IS NOT NULL AND c.snoozed_until>?7 THEN 1 ELSE 0 END,c.updated_at DESC,c.name LIMIT 50 OFFSET ?8`).bind(user.id, platform, status, search, pattern, today, unixNow(), offset, ...(accountId?[accountId]:[])),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM chats c WHERE ${filter}${totalAccountFilter}`).bind(user.id, platform, status, search, pattern, ...(accountId?[accountId]:[])),
    platform === 'telegram'
      ? env.DB.prepare(`SELECT workflow_status,COUNT(*) AS count FROM chats WHERE user_id=?1 AND platform=?2 AND (telegram_account_id=?3 OR (telegram_account_id IS NULL AND workflow_status='to_join')) GROUP BY workflow_status`).bind(user.id,platform,accountId)
      : env.DB.prepare(`SELECT workflow_status,COUNT(*) AS count FROM chats WHERE user_id=?1 AND platform=?2 GROUP BY workflow_status`).bind(user.id,platform),
    platform === 'telegram'
      ? env.DB.prepare(`SELECT name,link FROM chats WHERE user_id=?1 AND platform=?2 AND joined_at>=?3 AND joined_at<?4 AND telegram_account_id=?5 ORDER BY joined_at`).bind(user.id,platform,kyivDayStart(),kyivDayStart()+86400,accountId)
      : env.DB.prepare(`SELECT name,link FROM chats WHERE user_id=?1 AND platform=?2 AND joined_at>=?3 AND joined_at<?4 ORDER BY joined_at`).bind(user.id,platform,kyivDayStart(),kyivDayStart()+86400),
    platform === 'telegram'
      ? env.DB.prepare(`SELECT c.name,c.link FROM chat_publications p JOIN chats c ON c.id=p.chat_id WHERE p.user_id=?1 AND c.platform=?2 AND p.published_on=?3 AND p.telegram_account_id=?4 ORDER BY p.published_at,p.created_at`).bind(user.id,platform,today,accountId)
      : env.DB.prepare(`SELECT c.name,c.link FROM chat_publications p JOIN chats c ON c.id=p.chat_id WHERE p.user_id=?1 AND c.platform=?2 AND p.published_on=?3 ORDER BY p.published_at,p.created_at`).bind(user.id,platform,today),
  ]);
  const now = unixNow();
  const chats = (rowsResult.results as ChatRow[]).map((row) => ({
    id: row.id, name: row.name, link: row.link, platform: row.platform,
    status: row.workflow_status, archiveReason: row.archive_reason,
    telegramAccountId: row.telegram_account_id,
    profileConfirmed: row.profile_status === 'confirmed', publishedToday: Boolean(row.published_today),
    snoozedUntil: row.snoozed_until,
    availableAt: row.platform === 'telegram' && row.joined_at ? row.joined_at + 6 * 60 * 60 : null,
    availableNow: row.platform !== 'telegram' || !row.joined_at || row.joined_at + 6 * 60 * 60 <= now,
  }));
  const counts = Object.fromEntries((countsResult.results as Array<{workflow_status:string;count:number}>).map((row) => [row.workflow_status, Number(row.count)]));
  return Response.json({ chats, total: Number((totalResult.results[0] as {count?:number})?.count || 0), offset, counts, accountId, joinedToday: joinedResult.results, publishedToday: publishedResult.results });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'Потрібно увійти.' }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'Недійсний запит.' }, { status: 403 });
  const body = await request.json() as { id?: unknown; action?: unknown; reason?: unknown; accountId?: unknown };
  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!id || !ACTIONS.has(action)) return Response.json({ error: 'Невідома дія.' }, { status: 400 });
  const chat = await env.DB.prepare(`SELECT id,platform,workflow_status,joined_at,telegram_account_id FROM chats WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(id, user.id).first<{id:string;platform:string;workflow_status:string;joined_at:number|null;telegram_account_id:string|null}>();
  if (!chat) return Response.json({ error: 'Чат не знайдено.' }, { status: 404 });
  const now = unixNow();
  const requestedAccount = typeof body.accountId === 'string' ? body.accountId : null;
  const accountId = chat.platform === 'telegram' ? (chat.telegram_account_id || await selectedTelegramAccount(user.id,requestedAccount)) : null;
  if (chat.platform === 'telegram' && !accountId && !['restore','archive','failed'].includes(action)) return Response.json({error:'Оберіть активний Telegram-акаунт.'},{status:409});
  if(action==='assign_account') {
    const target=await selectedTelegramAccount(user.id,requestedAccount);
    if(chat.platform!=='telegram'||!target) return Response.json({error:'Не вдалося призначити акаунт.'},{status:400});
    if(!['waiting','ready','archived'].includes(chat.workflow_status)) return Response.json({error:'Цей чат поки належить до спільного пулу.'},{status:409});
    await env.DB.prepare(`UPDATE chats SET telegram_account_id=?1,updated_at=?2 WHERE id=?3 AND user_id=?4`).bind(target,now,id,user.id).run();
    return Response.json({ok:true});
  }
  if (action === 'published') {
    if (chat.workflow_status !== 'ready') return Response.json({ error: 'Цей чат зараз не в черзі публікації.' }, { status: 409 });
    const availableAt = chat.platform === 'telegram' && chat.joined_at ? chat.joined_at + 21600 : 0;
    if (availableAt > now) return Response.json({ error: 'Для Telegram ще не минуло 6 годин.', availableAt }, { status: 409 });
    const today = kyivDate();
    const existing = await env.DB.prepare(`SELECT id FROM chat_publications WHERE user_id=?1 AND chat_id=?2 AND published_on=?3 LIMIT 1`).bind(user.id, id, today).first();
    if (existing) return Response.json({ error: 'Сьогодні в цьому чаті вже публікували.' }, { status: 409 });
    const publicationId = crypto.randomUUID();
    const sourceKey = `manual:${publicationId}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO chat_publications (id,user_id,chat_id,published_on,published_at,source,source_key,created_at,telegram_account_id) VALUES (?1,?2,?3,?4,?5,'manual',?6,?5,?7)`).bind(publicationId,user.id,id,today,now,sourceKey,accountId),
      env.DB.prepare(`INSERT INTO activity_events (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id) VALUES (?1,?2,'publication',?3,?4,NULL,NULL,?5,?6,'{}',?7,?8)`).bind(crypto.randomUUID(),user.id,chat.platform,id,now,today,sourceKey,accountId),
      env.DB.prepare(`UPDATE chats SET updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,id,user.id),
    ]);
    return Response.json({ ok: true });
  }

  const allowedFrom: Record<string, string[]> = {
    joined: ['to_join'], waiting: ['to_join'], failed: ['to_join'],
    approved: ['waiting'], snooze: ['waiting', 'ready'],
    archive: ['to_join', 'waiting', 'ready'], restore: ['archived'],
  };
  if (!allowedFrom[action]?.includes(chat.workflow_status)) {
    return Response.json({ error: 'Стан чату вже змінився. Оновіть список.' }, { status: 409 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 100) : null;
  const mapping: Record<string, {status:string; joinedAt?:number|null; snooze?:number|null; archive?:number|null}> = {
    joined: { status: 'ready', joinedAt: now }, waiting: { status: 'waiting' },
    approved: { status: 'ready', joinedAt: chat.joined_at || now }, failed: { status: 'archived', archive: now },
    archive: { status: 'archived', archive: now }, restore: { status: 'to_join', joinedAt: null, archive: null },
    snooze: { status: chat.workflow_status, snooze: now + 3 * 86400 },
  };
  const next = mapping[action];
  const statements = [env.DB.prepare(`UPDATE chats SET workflow_status=?1,joined_at=CASE WHEN ?3='restore' THEN NULL WHEN ?2 IS NOT NULL THEN ?2 ELSE joined_at END,processed_at=CASE WHEN ?3 IN ('joined','waiting','approved') THEN ?4 ELSE processed_at END,snoozed_until=?5,archive_reason=?6,archived_at=?7,telegram_account_id=CASE WHEN ?3='restore' THEN NULL WHEN platform='telegram' AND ?3 IN ('joined','waiting') THEN COALESCE(telegram_account_id,?10) ELSE telegram_account_id END,updated_at=?4 WHERE id=?8 AND user_id=?9`)
    .bind(next.status, next.joinedAt ?? null, action, now, next.snooze ?? null, next.status === 'archived' ? (reason || (action === 'failed' ? 'Не вдалося приєднатися' : 'Не актуальний')) : null, next.archive ?? null, id, user.id, accountId)];
  if (action === 'joined' || action === 'approved') {
    const eventDate = kyivDate();
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO activity_events (id,user_id,event_type,platform,chat_id,lead_id,lesson_id,occurred_at,event_date,metadata_json,source_key,telegram_account_id) VALUES (?1,?2,'chat_joined',?3,?4,NULL,NULL,?5,?6,'{}',?7,?8)`)
      .bind(crypto.randomUUID(),user.id,chat.platform,id,now,eventDate,`chat-joined:${id}:${eventDate}`,accountId));
    if(chat.platform==='telegram'&&accountId) statements.push(env.DB.prepare(`UPDATE telegram_accounts SET join_streak=join_streak+1,updated_at=?1 WHERE id=?2 AND user_id=?3`).bind(now,accountId,user.id));
  }
  await env.DB.batch(statements);
  return Response.json({ ok: true });
}

function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return Boolean(origin && origin === new URL(request.url).origin); }
function unixNow() { return Math.floor(Date.now() / 1000); }
function escapeLike(value: string) { return value.replace(/[\\%_]/g, '\\$&'); }
function kyivDate() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Kyiv'}).format(new Date()); }
function kyivDayStart() {
  const date = kyivDate();
  const zone = new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Kyiv',timeZoneName:'longOffset'}).formatToParts(new Date(`${date}T12:00:00Z`)).find((part)=>part.type==='timeZoneName')?.value || 'GMT+02:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(zone);
  const offset = match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 120;
  return Math.floor(Date.parse(`${date}T00:00:00Z`)/1000) - offset * 60;
}

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
