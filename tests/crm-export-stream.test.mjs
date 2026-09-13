import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema.ts';
import { D1LeadRepository } from '../lib/leads/data/repository.ts';
import { executeLeadCommand } from '../lib/leads/application/service.ts';
import { prepareConversationExport } from '../lib/leads/application/conversation-export.ts';
import { readConversationExportPage } from '../lib/leads/data/conversation-export.ts';
import { localDatabase } from './helpers/local-d1.mjs';

const NOW = Math.floor(Date.parse('2026-09-13T12:00:00Z') / 1000);

async function seedLongConversation(t) {
  const db = await localDatabase(t);
  const repo = new D1LeadRepository(drizzle(db, { schema }));
  const leadId = await executeLeadCommand(
    repo,
    'u',
    {
      commandId: crypto.randomUUID(),
      version: 0,
      action: 'create',
      data: { name: 'Long lead', subject: 'English', responseDate: '2026-09-13' },
    },
    NOW,
  );
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: `message-${String(index).padStart(3, '0')}`,
    sender: index % 2 ? 'me' : 'lead',
    body: `Body ${index}`,
    sentAt: 1_000 + Math.floor(index / 2),
  }));
  await db
    .prepare(`INSERT INTO lead_messages(id,user_id,lead_id,sender,body,sent_at,created_at,updated_at)
      SELECT json_extract(value,'$.id'),'u',?1,json_extract(value,'$.sender'),json_extract(value,'$.body'),json_extract(value,'$.sentAt'),?2,?2
      FROM json_each(?3)`)
    .bind(leadId, NOW, JSON.stringify(rows))
    .run();
  await db
    .prepare(`INSERT INTO lead_messages(id,user_id,lead_id,sender,body,sent_at,created_at,updated_at,deleted_at)
      VALUES ('deleted','u',?1,'lead','DELETED',999,?2,?2,?2),
             ('foreign','other',?1,'lead','FOREIGN',999,?2,?2,NULL)`)
    .bind(leadId, NOW)
    .run();
  const lead = await db
    .prepare('SELECT version FROM leads WHERE id=?1 AND user_id=?2')
    .bind(leadId, 'u')
    .first();
  return { db, leadId, version: Number(lead.version), rows };
}

void test('CRM export streams long history in bounded owner-scoped chronological pages', async (t) => {
  const { db, leadId, version, rows } = await seedLongConversation(t);
  const first = await readConversationExportPage(db, 'u', leadId, version, null, 100);
  assert.equal(first.messages.length, 100);
  assert.equal(first.hasMore, true);
  const second = await readConversationExportPage(db, 'u', leadId, version, first.after, 100);
  assert.equal(second.messages.length, 100);
  assert.equal(second.hasMore, true);
  const third = await readConversationExportPage(db, 'u', leadId, version, second.after, 100);
  assert.equal(third.messages.length, 5);
  assert.equal(third.hasMore, false);

  const prepared = await prepareConversationExport(db, 'u', leadId);
  assert.ok(prepared);
  const text = await new Response(prepared.stream).text();
  assert.match(text, /Lead: Long lead|Лід: Long lead/);
  assert.equal((text.match(/\] (?:Лід|Я):/g) || []).length, 205);
  assert.equal(text.includes('DELETED'), false);
  assert.equal(text.includes('FOREIGN'), false);
  const firstIndex = text.indexOf(rows[0].body);
  const lastIndex = text.indexOf(rows.at(-1).body);
  assert.ok(firstIndex > 0 && lastIndex > firstIndex);
});

void test('CRM export page fails closed when the lead changes between chunks', async (t) => {
  const { db, leadId, version } = await seedLongConversation(t);
  const first = await readConversationExportPage(db, 'u', leadId, version, null, 100);
  assert.equal(first.hasMore, true);
  await db
    .prepare('UPDATE leads SET version=version+1 WHERE id=?1 AND user_id=?2')
    .bind(leadId, 'u')
    .run();
  await assert.rejects(
    readConversationExportPage(db, 'u', leadId, version, first.after, 100),
    /змінено під час експорту/,
  );
  assert.equal(await prepareConversationExport(db, 'other', leadId), null);
});
