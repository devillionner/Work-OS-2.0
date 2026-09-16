import assert from 'node:assert/strict';
import test from 'node:test';
import { listLeads } from '../lib/leads/data/list.ts';
import { localDatabase, seedEvent } from './helpers/local-d1.mjs';

const NOW = 2_000;

async function seedLead(db, {
  id,
  owner = 'u',
  name,
  platform = 'telegram',
  status = 'active',
  funnel = 'response',
  subject = '',
  note = '',
  teacher = '',
  nextAction = '',
  nextContact = null,
  needsDetails = 0,
  phone = '',
  normalizedPhone = '',
  telegram = '',
  normalizedTelegram = '',
  archivedAt = null,
}) {
  await db.prepare(`INSERT INTO leads(
    id,user_id,name,platform,status,funnel_stage,subject,note,teacher_name,next_action,next_contact_at,
    needs_details,phone,normalized_phone,telegram_username,normalized_telegram,source_chat_link,
    duplicate_state,created_at,updated_at,archived_at
  ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'','none',1,1,?17)`)
    .bind(id,owner,name,platform,status,funnel,subject,note,teacher,nextAction,nextContact,needsDetails,phone,normalizedPhone,telegram,normalizedTelegram,archivedAt).run();
}

void test('expanded lead list search is owner-safe and covers human CRM context', async (t) => {
  const db = await localDatabase(t);
  await seedLead(db, {
    id: 'response', name: 'Ірина Ґала', funnel: 'result', subject: 'Англійська',
    note: 'Вечірній час з батьками', phone: '+38 (067) 123-45-67', normalizedPhone: '380671234567',
    telegram: '@ExampleParent', normalizedTelegram: 'exampleparent',
  });
  await seedLead(db, { id: 'lesson', name: 'Родина Коваль', funnel: 'lesson' });
  await seedLead(db, { id: 'curator', name: 'Запит куратору', funnel: 'clarification' });
  await seedLead(db, { id: 'clarify', name: 'Уточнення даних', needsDetails: 1 });
  await seedLead(db, { id: 'other', owner: 'other', name: 'Ірина Ґала' });
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_name,subject,teacher_name,lesson_date,status,created_at,updated_at)
    VALUES ('lesson-1','u','lesson','Марічка','Математика','Алла','2026-09-18','booked',1,1)`).run();
  await db.prepare(`INSERT INTO students(id,user_id,lead_id,name,surname,note,created_at,updated_at)
    VALUES ('student-1','u','lesson','Марічка','Коваль','Любить математику',1,1)`).run();
  await db.prepare(`INSERT INTO curator_requests(id,user_id,lead_id,status,submitted_at,submitted_date,created_at,updated_at)
    VALUES ('curator-1','u','curator','pending',1,'2026-09-16',1,1)`).run();
  await seedEvent(db, { id: 'response-event', type: 'lead_created', date: '2026-09-16', lead: 'response' });

  const names = async (search) => (await listLeads(db, 'u', { view: 'active', search, offset: 0 }, NOW)).leads.map((lead) => lead.id);
  assert.deepEqual(await names('ірина ґал'), ['response']);
  assert.deepEqual(await names('067123'), ['response']);
  assert.deepEqual(await names('@exampleparent'), ['response']);
  assert.deepEqual(await names('вечірній'), ['response']);
  assert.deepEqual(await names('алла'), ['lesson']);
  assert.deepEqual(await names('марічка'), ['lesson']);
  assert.deepEqual(await names('матем'), ['lesson']);
  assert.deepEqual(await names('відгук'), ['response']);
  assert.deepEqual(await names('у куратора'), ['curator']);
  assert.deepEqual(await names('записано'), ['lesson']);
  assert.ok((await names('потрібно уточнити')).includes('clarify'));
});

void test('lead workflow views use authoritative events/state and isolate owners', async (t) => {
  const db = await localDatabase(t);
  await seedLead(db, { id: 'response', name: 'Response', funnel: 'result' });
  await seedLead(db, { id: 'curator', name: 'Curator' });
  await seedLead(db, { id: 'clarify', name: 'Clarify', needsDetails: 1 });
  await seedLead(db, { id: 'overdue', name: 'Overdue', nextAction: 'Написати', nextContact: 100 });
  await seedLead(db, { id: 'archive', name: 'Archive', archivedAt: 500 });
  await seedLead(db, { id: 'foreign', owner: 'other', name: 'Foreign', needsDetails: 1, nextAction: 'Написати', nextContact: 100 });
  await seedEvent(db, { id: 'response-event', type: 'lead_created', date: '2026-09-16', lead: 'response' });
  await seedEvent(db, { id: 'foreign-event', owner: 'other', type: 'lead_created', date: '2026-09-16', lead: 'foreign' });
  await db.prepare(`INSERT INTO curator_requests(id,user_id,lead_id,status,submitted_at,submitted_date,created_at,updated_at)
    VALUES ('curator-1','u','curator','pending',1,'2026-09-16',1,1)`).run();

  const ids = async (view) => (await listLeads(db, 'u', { view, search: '', offset: 0 }, NOW)).leads.map((lead) => lead.id);
  assert.deepEqual(await ids('responses'), ['response']);
  assert.deepEqual(await ids('curator'), ['curator']);
  assert.deepEqual(await ids('needs-details'), ['clarify']);
  assert.deepEqual(await ids('overdue'), ['overdue']);
  assert.deepEqual(await ids('archived'), ['archive']);
  assert.ok(!(await ids('active')).includes('foreign'));
});
