import { normalizeGroupLink, type ChatPlatform } from '../chats/bulk-input.ts';

// Службові дії над лідами в «Налаштування → Сервіс»: підтягнути чати наявним лідам і позначити заглушки NoUserName*.
// Усе лише за підтвердженням власника: перегляд нічого не змінює.

export type ChatOption = { id: string; name: string; platform: string; link: string; workflow_status: string };
export type LeadWithoutChat = { id: string; name: string; platform: string; source_chat_link: string };
export type ChatLinkReason = 'link' | 'code' | 'name';
export type ChatLinkProposal = {
  leadId: string;
  leadName: string;
  sourceLink: string;
  reason: ChatLinkReason;
  chat: { id: string; name: string; platform: string; status: string; link: string };
};

const fold = (value: string) => value.normalize('NFC').toLocaleLowerCase('uk-UA').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** У Work OS до назви чату часто дописано платформу в кінці («… в Viber»): для порівняння її відкидаємо. */
const foldName = (value: string) => fold(value.replace(/[\s\-–—([]*(?:(?:в|у|in|на|для|for)\s+)?(?:viber|telegram|whatsapp|facebook)[)\]]*\s*$/iu, ''));

/** Код запрошення з канонічного посилання: різні посилання на один чат мають однаковий код. */
export function inviteCode(link: string): { platform: ChatPlatform; code: string } | null {
  const chat = normalizeGroupLink(link);
  if (!chat) return null;
  const url = new URL(chat.link);
  if (chat.platform === 'telegram') return { platform: 'telegram', code: url.pathname.replace(/^\/\+?/, '').toLowerCase() };
  if (chat.platform === 'viber') {
    const code = url.searchParams.get('g2') ?? url.searchParams.get('g');
    return code ? { platform: 'viber', code: code.replace(/^[/+]+/, '') } : { platform: 'viber', code: url.pathname.replace(/^\/+/, '') };
  }
  return { platform: chat.platform, code: url.pathname.replace(/^\/+/, '').toLowerCase() };
}

export function matchLeadsToChats(leads: readonly LeadWithoutChat[], chats: readonly ChatOption[]) {
  const byLink = new Map<string, ChatOption>();
  const byCode = new Map<string, ChatOption[]>();
  const byName = new Map<string, ChatOption[]>();
  const push = (map: Map<string, ChatOption[]>, key: string, chat: ChatOption) => { const list = map.get(key); if (list) list.push(chat); else map.set(key, [chat]); };
  for (const chat of chats) {
    const canonical = normalizeGroupLink(chat.link);
    byLink.set(`${chat.platform}|${canonical?.link ?? chat.link}`, chat);
    const code = inviteCode(chat.link);
    if (code?.code) push(byCode, `${code.platform}|${code.code}`, chat);
    const name = foldName(chat.name);
    if (name) push(byName, `${chat.platform}|${name}`, chat);
  }
  const proposals: ChatLinkProposal[] = [];
  let ambiguous = 0;
  let unmatched = 0;
  const propose = (lead: LeadWithoutChat, reason: ChatLinkReason, chat: ChatOption) => proposals.push({
    leadId: lead.id, leadName: lead.name, sourceLink: lead.source_chat_link, reason,
    chat: { id: chat.id, name: chat.name, platform: chat.platform, status: chat.workflow_status, link: chat.link },
  });
  for (const lead of leads) {
    const canonical = normalizeGroupLink(lead.source_chat_link);
    if (canonical) {
      const exact = byLink.get(`${canonical.platform}|${canonical.link}`);
      if (exact) { propose(lead, 'link', exact); continue; }
      const code = inviteCode(lead.source_chat_link);
      const same = code?.code ? byCode.get(`${code.platform}|${code.code}`) ?? [] : [];
      if (same.length === 1) { propose(lead, 'code', same[0]); continue; }
      if (same.length > 1) { ambiguous += 1; continue; }
      unmatched += 1;
      continue;
    }
    // Не посилання: у «Джерело» могла лишитись назва чату (старі записи).
    const named = byName.get(`${lead.platform}|${foldName(lead.source_chat_link)}`) ?? [];
    if (named.length === 1) propose(lead, 'name', named[0]);
    else if (named.length > 1) ambiguous += 1;
    else unmatched += 1;
  }
  return { proposals, ambiguous, unmatched };
}

export const PLACEHOLDER_TELEGRAM = /^nousername\d*$/i;

export type PlaceholderLead = { id: string; name: string; telegram_username: string; normalized_phone: string };

export async function previewChatLinks(db: D1Database, userId: string) {
  const [leadRows, chatRows] = await Promise.all([
    db.prepare(`SELECT id,name,platform,source_chat_link FROM leads
      WHERE user_id=?1 AND source_chat_id IS NULL AND source_chat_link<>'' ORDER BY updated_at DESC LIMIT 5000`)
      .bind(userId).all<LeadWithoutChat>(),
    db.prepare('SELECT id,name,platform,link,workflow_status FROM chats WHERE user_id=?1 LIMIT 8000').bind(userId).all<ChatOption>(),
  ]);
  const result = matchLeadsToChats(leadRows.results, chatRows.results);
  return { examined: leadRows.results.length, ...result, proposals: result.proposals.slice(0, 500), more: Math.max(0, result.proposals.length - 500) };
}

/** Зв'язує лише ліди без чату й лише з чатами цього власника; повертає, скільком справді змінено. */
export async function applyChatLinks(db: D1Database, userId: string, items: ReadonlyArray<{ leadId: string; chatId: string }>): Promise<number> {
  let changed = 0;
  for (let start = 0; start < items.length; start += 50) {
    const results = await db.batch(items.slice(start, start + 50).map((item) => db.prepare(`UPDATE leads SET source_chat_id=?1,version=version+1
      WHERE id=?2 AND user_id=?3 AND source_chat_id IS NULL AND EXISTS (SELECT 1 FROM chats WHERE id=?1 AND user_id=?3)
      RETURNING id`)
      .bind(item.chatId, item.leadId, userId)));
    // `meta.changes` рахує й рядки, які пишуть тригери ревізії, тож лічимо повернені рядки.
    for (const result of results) changed += result.results?.length ?? 0;
  }
  return changed;
}

export async function previewPlaceholderLeads(db: D1Database, userId: string) {
  const rows = await db.prepare(`SELECT id,name,telegram_username,normalized_phone FROM leads
    WHERE user_id=?1 AND normalized_telegram LIKE 'nousername%' ORDER BY name LIMIT 2000`).bind(userId).all<PlaceholderLead>();
  return rows.results.filter((row) => PLACEHOLDER_TELEGRAM.test(row.telegram_username.replace(/^@/, '').trim()))
    .map((row) => ({ leadId: row.id, name: row.name, telegramUsername: row.telegram_username, hasPhone: row.normalized_phone !== '' }));
}

/**
 * Позначає ліди із заглушкою NoUserName* як «контакт невідомий» і прибирає заглушку з поля Telegram (її не можна відкрити як
 * контакт). Якщо в ліда є номер, позначка не ставиться: контакт відомий. Попередній нік лишається в історії ліда.
 */
export async function applyPlaceholderLeads(db: D1Database, userId: string, leadIds: readonly string[], now: number): Promise<number> {
  let changed = 0;
  for (let start = 0; start < leadIds.length; start += 25) {
    const chunk = leadIds.slice(start, start + 25);
    const statements = chunk.flatMap((leadId) => [
      db.prepare(`INSERT OR IGNORE INTO activity_events (id,user_id,event_type,occurred_at,event_date,lead_id,platform,metadata_json,source_key)
        SELECT ?1,user_id,'lead_updated',?2,?3,id,platform,json_object('fields',json_array('telegramUsername','contactUnknown'),'previousTelegramUsername',telegram_username,'source','service'),?4
        FROM leads WHERE id=?5 AND user_id=?6 AND normalized_telegram LIKE 'nousername%'`)
        .bind(crypto.randomUUID(), now, kyivDate(now), `leads:service-placeholder:${leadId}:${now}`, leadId, userId),
      db.prepare(`UPDATE leads SET telegram_username='',normalized_telegram='',
          contact_unknown=CASE WHEN normalized_phone='' THEN 1 ELSE 0 END,version=version+1
        WHERE id=?1 AND user_id=?2 AND normalized_telegram LIKE 'nousername%' RETURNING id`).bind(leadId, userId),
    ]);
    const results = await db.batch(statements);
    for (let index = 1; index < results.length; index += 2) changed += results[index].results?.length ?? 0;
  }
  return changed;
}

function kyivDate(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
