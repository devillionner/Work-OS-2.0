import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema.ts';
import { D1LeadRepository } from '../lib/leads/data/repository.ts';
import { leadSearchAliases } from '../lib/leads/data/search.ts';
import { localDatabase } from './helpers/local-d1.mjs';

async function seedLead(db, { id, owner = 'u', name, platform = 'telegram', subject = '', note = '', teacher = '', source = '', funnel = 'response', status = 'active', needsDetails = 0 }) {
  await db.prepare(`INSERT INTO leads(id,user_id,name,platform,status,subject,note,teacher_name,source_chat_link,funnel_stage,needs_details,created_at,updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,1)`)
    .bind(id, owner, name, platform, status, subject, note, teacher, source, funnel, needsDetails)
    .run();
}

void test('lead search aliases map operator language to domain states', () => {
  assert.deepEqual(leadSearchAliases('потрібно уточнити'), ['clarification']);
  assert.deepEqual(leadSearchAliases('у куратора'), ['curator']);
  assert.deepEqual(leadSearchAliases('записано'), ['booked']);
  assert.deepEqual(leadSearchAliases('у роботі'), ['active']);
});

void test('lead list search covers lead fields, related entities and owner-safe state aliases', async (t) => {
  const db = await localDatabase(t);
  const repo = new D1LeadRepository(drizzle(db, { schema }));
  await seedLead(db, { id: 'response', name: 'Олена', subject: 'Математика', note: 'Вечірній контакт', teacher: 'Ірина', source: 'https://t.me/parents', funnel: 'response' });
  await seedLead(db, { id: 'booked', name: 'Марія', platform: 'whatsapp', funnel: 'booked' });
  await seedLead(db, { id: 'clarify', name: 'Олег', funnel: 'clarification', needsDetails: 1 });
  await seedLead(db, { id: 'curator', name: 'Софія', platform: 'facebook', funnel: 'response' });
  await seedLead(db, { id: 'lesson', name: 'Данило', platform: 'viber', funnel: 'lesson' });
  await seedLead(db, { id: 'foreign', owner: 'other', name: 'Чужий', note: 'Вечірній контакт', funnel: 'response' });

  await db.prepare(`INSERT INTO students(id,user_id,lead_id,name,surname,note,created_at,updated_at)
    VALUES ('student','u','lesson','Марічка','Коваль','',1,1)`).run();
  await db.prepare(`INSERT INTO lessons(id,user_id,lead_id,student_id,student_name,subject,teacher_name,lesson_date,status,created_at,updated_at)
    VALUES ('lesson-1','u','lesson','student','Марічка Коваль','Англійська','Алла Підбуртна','2026-09-18','booked',1,1)`).run();
  await db.prepare(`INSERT INTO curator_requests(id,user_id,lead_id,status,submitted_at,submitted_date,created_at,updated_at)
    VALUES ('curator-1','u','curator','pending',1,'2026-09-16',1,1)`).run();

  const ids = async (search) => (await repo.list('u', { archived: false, overdue: false, search, offset: 0 }, 10)).leads.map((lead) => lead.id).sort();
  assert.deepEqual(await ids('вечірній'), ['response']);
  assert.deepEqual(await ids('матем'), ['response']);
  assert.deepEqual(await ids('ірин'), ['response']);
  assert.deepEqual(await ids('parents'), ['response']);
  assert.deepEqual(await ids('telegram'), ['response']);
  assert.deepEqual(await ids('алла'), ['lesson']);
  assert.deepEqual(await ids('марічка'), ['lesson']);
  assert.deepEqual(await ids('у куратора'), ['curator']);
  assert.deepEqual(await ids('записано'), ['booked']);
  assert.deepEqual(await ids('потрібно уточнити'), ['clarify']);
  assert.deepEqual(await ids('в роботі'), ['booked', 'clarify', 'curator', 'lesson', 'response']);
  assert.deepEqual(await ids('відгук'), ['curator', 'response']);
});
