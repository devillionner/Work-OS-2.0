import assert from 'node:assert/strict';
import test from 'node:test';
import { listLeads } from '../lib/leads/data/list.ts';
import { leadPlatformSearchValues } from '../lib/leads/data/search.ts';
import { localDatabase } from './helpers/local-d1.mjs';

void test('CRM platform search resolves operator-facing UA/RU aliases without broad short-fragment expansion', () => {
  assert.deepEqual(leadPlatformSearchValues('телеграм'), ['telegram']);
  assert.deepEqual(leadPlatformSearchValues('тел'), ['telegram']);
  assert.deepEqual(leadPlatformSearchValues('вайбер'), ['viber']);
  assert.deepEqual(leadPlatformSearchValues('ватсап'), ['whatsapp']);
  assert.deepEqual(leadPlatformSearchValues('фейсбук'), ['facebook']);
  assert.deepEqual(leadPlatformSearchValues('тредс'), ['threads']);
  assert.deepEqual(leadPlatformSearchValues('тг'), ['telegram']);
  assert.deepEqual(leadPlatformSearchValues('wa'), ['whatsapp']);
  assert.deepEqual(leadPlatformSearchValues('a'), []);
  assert.deepEqual(leadPlatformSearchValues('в'), []);
});

void test('CRM platform aliases filter canonical stored platform values owner-safely', async (t) => {
  const db = await localDatabase(t);
  for (const [id, owner, platform] of [
    ['tg', 'u', 'telegram'],
    ['wa', 'u', 'whatsapp'],
    ['vb', 'u', 'viber'],
    ['fb', 'u', 'facebook'],
    ['th', 'u', 'threads'],
    ['foreign', 'other', 'telegram'],
  ]) {
    await db.prepare(`INSERT INTO leads(
      id,user_id,name,platform,status,funnel_stage,subject,note,teacher_name,next_action,
      needs_details,phone,normalized_phone,telegram_username,normalized_telegram,source_chat_link,
      duplicate_state,created_at,updated_at
    ) VALUES (?1,?2,?3,?4,'active','response','','','','',0,'','','','','','none',1,1)`)
      .bind(id, owner, id, platform).run();
  }
  const ids = async (search) => (await listLeads(db, 'u', { view: 'active', search, offset: 0 }, 2_000)).leads.map((lead) => lead.id);
  assert.deepEqual(await ids('телеграм'), ['tg']);
  assert.deepEqual(await ids('вацап'), ['wa']);
  assert.deepEqual(await ids('вайбер'), ['vb']);
  assert.deepEqual(await ids('фейсбук'), ['fb']);
  assert.deepEqual(await ids('тредс'), ['th']);
});
