import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { chatStateTokenSql } from '../../lib/chats/state.ts';

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
  let mf; let db;
  for (let attempt = 0; attempt < 5; attempt++) {
    mf = new Miniflare({ modules: true, port: 0, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
    try {
      db = await mf.getD1Database('DB');
      await db.prepare('SELECT 1').first();
      break;
    } catch (error) {
      await mf.dispose();
      if (!/EADDRINUSE/.test(String(error) + String(error?.cause)) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  t.after(() => mf.dispose());
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
  return db.prepare(`SELECT c.*,${chatStateTokenSql()} AS state_token FROM chats c WHERE c.id=?1`).bind(id).first();
}

export async function seedEvent(db, { id, owner = 'u', type, date, at = 100, platform = 'telegram', cancelled = null, lead = null, chat = null, lesson = null, metadata = null } ) {
  await db.prepare(`INSERT INTO activity_events(id,user_id,event_type,platform,event_date,occurred_at,metadata_json,source_key,cancelled_at,lead_id,chat_id,lesson_id)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?1,?8,?9,?10,?11)`).bind(id,owner,type,platform,date,at,metadata?JSON.stringify(metadata):'{}',cancelled,lead,chat,lesson).run();
}
