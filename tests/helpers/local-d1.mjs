import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';

function sqlStatements(sql) {
  const statements = [];
  let current = ''; let trigger = false;
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    current += ` ${line}`;
    if (/^CREATE TRIGGER/i.test(trimmed)) trigger = true;
    if ((!trigger && trimmed.endsWith(';')) || (trigger && trimmed.startsWith('END;'))) {
      statements.push(current.trim()); current = ''; trigger = false;
    }
  }
  assert.equal(current.trim(), '', 'Every migration statement must be complete');
  return statements;
}

export async function localDatabase(t) {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const folder = new URL('../../migrations/', import.meta.url);
  for (const file of readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of sqlStatements(readFileSync(new URL(file, folder), 'utf8'))) await db.prepare(sql).run();
  }
  await db.prepare(`INSERT INTO users(id,email,display_name,created_at,last_login_at)
    VALUES ('u','u@example.test','Test',1,1),('other','other@example.test','Other',1,1)`).run();
  return db;
}

export async function seedChat(db, { id = 'chat', owner = 'u', platform = 'whatsapp', status = 'ready', joined = null, snoozed = null } = {}) {
  await db.prepare(`INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,joined_at,snoozed_until,created_at,updated_at)
    VALUES (?1,?2,?3,?1,?4,?4,?5,?6,?7,1,1)`).bind(id,owner,platform,`https://example.test/${id}`,status,joined,snoozed).run();
  return db.prepare('SELECT * FROM chats WHERE id=?1').bind(id).first();
}

export async function seedEvent(db, { id, owner = 'u', type, date, at = 100, platform = 'telegram', cancelled = null, lead = null, chat = null } ) {
  await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,event_date,occurred_at,source_key,cancelled_at,lead_id,chat_id)
    VALUES (?1,?2,?3,?4,?5,?6,?1,?7,?8,?9)`).bind(id,owner,type,platform,date,at,cancelled,lead,chat).run();
}
