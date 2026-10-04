// Shared seed for the Analytics D1-cost and daily-counter tests: 90 days of chat, publication and lead
// activity across three platforms, plus a metered D1 wrapper that sums rows_read.
export const ANALYTICS_FROM = '2027-01-01';
export const ANALYTICS_TO = '2027-03-31';
const DAYS = 90;
const CHATS = 300;
const LEADS = 60;
const PLATFORMS = ['telegram', 'whatsapp', 'viber'];

function dateOf(day) {
  return new Date(Date.UTC(2027, 0, 1 + day)).toISOString().slice(0, 10);
}

export async function seedAnalytics(db, { owner = 'u' } = {}) {
  const statements = [];
  const flush = async (force = false) => {
    if (statements.length >= 200 || (force && statements.length)) await db.batch(statements.splice(0));
  };
  for (let index = 0; index < CHATS; index += 1) {
    const platform = PLATFORMS[index % PLATFORMS.length];
    statements.push(db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,is_private,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?5,?6,0,1,?7)`).bind(`${owner}-chat-${index}`, owner, platform, `Chat ${String(index).padStart(3, '0')}`,
      `https://example.test/${owner}/${index}`, index % 5 === 0 ? 'archived' : 'ready', index));
    if (index % 3 === 0) statements.push(db.prepare(`INSERT INTO chat_profiles(chat_id,language,directions_json,updated_at)
      VALUES (?1,?2,'["english"]',1)`).bind(`${owner}-chat-${index}`, index % 2 ? 'uk' : 'ru'));
    await flush();
  }
  for (let index = 0; index < LEADS; index += 1) {
    statements.push(db.prepare(`INSERT INTO leads(id,user_id,name,platform,source_chat_id,status,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,'new',1,1)`).bind(`${owner}-lead-${index}`, owner, `Lead ${index}`, PLATFORMS[index % PLATFORMS.length],
      index % 4 === 0 ? null : `${owner}-chat-${(index * 7) % CHATS}`));
    await flush();
  }
  let sequence = 0;
  const event = (type, day, { platform = null, chat = null, lead = null, cancelled = null } = {}) => {
    sequence += 1;
    const id = `${owner}-ev-${sequence}`;
    statements.push(db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,chat_id,lead_id,occurred_at,event_date,metadata_json,source_key,cancelled_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'{}',?1,?9)`).bind(id, owner, type, platform, chat, lead, 1_800_000_000 + day * 86_400 + sequence, dateOf(day), cancelled));
  };
  for (let day = 0; day < DAYS; day += 1) {
    for (let slot = 0; slot < 60; slot += 1) {
      const chatIndex = (day * 13 + slot * 7) % CHATS;
      const chat = `${owner}-chat-${chatIndex}`;
      const platform = PLATFORMS[chatIndex % PLATFORMS.length];
      event('publication', day, { platform, chat, cancelled: slot % 29 === 0 ? 1 : null });
      if (slot % 3 === 0) event('chat_joined', day, { platform, chat });
      if (slot % 2 === 0) event('chat_state_changed', day, { platform, chat });
    }
    for (let slot = 0; slot < 4; slot += 1) {
      const lead = `${owner}-lead-${(day * 3 + slot) % LEADS}`;
      event('lead_created', day, { lead });
      if (slot % 2 === 0) event('lesson_booked', day, { lead });
    }
    if (day % 10 === 0) event('chat_bulk_added', day);
    await flush();
  }
  await flush(true);
  return sequence;
}

export function meter(db) {
  let rows = 0;
  const count = (result) => { rows += result?.meta?.rows_read || 0; return result; };
  const wrap = (statement) => {
    const wrapped = Object.create(statement);
    wrapped.bind = (...values) => wrap(statement.bind(...values));
    wrapped.all = async () => count(await statement.all());
    return wrapped;
  };
  return {
    db: new Proxy(db, { get(target, property) {
      if (property === 'prepare') return (sql) => wrap(target.prepare(sql));
      if (property === 'batch') return async (statements) => { const results = await target.batch(statements); results.forEach(count); return results; };
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    } }),
    take() { const value = rows; rows = 0; return value; },
  };
}

