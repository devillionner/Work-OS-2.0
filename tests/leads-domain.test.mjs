import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema.ts';
import { D1LeadRepository } from '../lib/leads/data/repository.ts';
import { executeLeadCommand } from '../lib/leads/application/service.ts';
import {
  leadDetail,
  exportConversation,
} from '../lib/leads/application/queries.ts';
import { commandBody } from '../lib/leads/application/http.ts';
import { lessonEpoch } from '../lib/leads/domain/time.ts';

const NOW = Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000);
const root = new URL('../', import.meta.url);
// SQLite/D1 exec supports statements on individual lines. Preserve trigger bodies
// as one statement; SQL in this repository contains no semicolons in string literals.
function statements(sql) {
  const result = [];
  let part = '';
  let trigger = false;
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    part += ` ${line}`;
    if (/^CREATE TRIGGER/i.test(trimmed)) trigger = true;
    if (
      (!trigger && trimmed.endsWith(';')) ||
      (trigger && trimmed.startsWith('END;'))
    ) {
      result.push(part.trim());
      part = '';
      trigger = false;
    }
  }
  assert.equal(part.trim(), '');
  return result;
}
async function fixture(t, seed = false) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['DB'],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migrations = readdirSync(new URL('migrations', root))
    .filter((p) => p.endsWith('.sql'))
    .sort();
  for (const migration of migrations.filter((m) => m < '0014')) {
    for (const s of statements(
      readFileSync(new URL(`migrations/${migration}`, root), 'utf8'),
    ))
      await db.prepare(s).run();
  }
  await db
    .prepare(
      "INSERT INTO users(id,email,display_name,created_at,last_login_at) VALUES ('u','u@example.test','Test',1,1),('other','other@example.test','Other',1,1)",
    )
    .run();
  if (seed) {
    for (let i = 0; i < 24; i++)
      await db
        .prepare(
          "INSERT INTO leads(id,user_id,name,platform,status,phone,normalized_phone,created_at,updated_at,response_date) VALUES (?,'u',?,'telegram','legacy-open',?,'',1,1,'2026-09-04')",
        )
        .bind(
          `imported-${i}`,
          `Legacy ${i}`,
          i === 0 ? '+38 (067) 123-45-67' : '',
        )
        .run();
    for (let i = 0; i < 5; i++)
      await db
        .prepare(
          "INSERT INTO students(id,user_id,lead_id,name,created_at,updated_at) VALUES (?,'u','imported-0',?,1,1)",
        )
        .bind(`student-${i}`, `Student ${i}`)
        .run();
    for (let i = 0; i < 9; i++)
      await db
        .prepare(
          "INSERT INTO lessons(id,user_id,lead_id,student_name,subject,lesson_date,status,booking_date,created_at,updated_at) VALUES (?,'u','imported-0','Legacy student','English','10.09.26','scheduled','2026-09-04',1,1)",
        )
        .bind(`lesson-${i}`)
        .run();
    await db
      .prepare(
        "INSERT INTO activity_events(id,user_id,lead_id,event_type,source_key,event_date,occurred_at) VALUES ('historical','u','imported-0','lead_created','legacy:lead:0','2026-09-04',1)",
      )
      .run();
  }
  for (const migration of migrations.filter((m) => m >= '0014'))
    for (const s of statements(
      readFileSync(new URL(`migrations/${migration}`, root), 'utf8'),
    ))
      await db.prepare(s).run();
  const repo = new D1LeadRepository(drizzle(db, { schema }));
  const run = async (action, data = {}, leadId, entityId, extra = {}) =>
    executeLeadCommand(
      repo,
      'u',
      {
        commandId: crypto.randomUUID(),
        version: leadId ? (await repo.load('u', leadId)).lead.version : 0,
        action,
        data,
        ...(leadId ? { leadId } : {}),
        ...(entityId ? { entityId } : {}),
        ...extra,
      },
      NOW,
    );
  const create = (data = {}) =>
    run('create', {
      name: 'Test lead',
      subject: 'English',
      responseDate: '2026-09-08',
      ...data,
    });
  const book = (id, data = {}) =>
    run(
      'lesson_book',
      {
        subject: 'English',
        teacherName: 'Teacher',
        lessonDate: '2026-09-10',
        lessonTime: '18:00',
        lessonPlatform: 'Google Meet',
        meetingLink: 'https://meet.google.com/test',
        bookingDate: '2026-09-08',
        ...data,
      },
      id,
    );
  const rows = async (sql, ...params) =>
    (
      await db
        .prepare(sql)
        .bind(...params)
        .all()
    ).results;
  return { db, repo, run, create, book, rows };
}

void test('additive migration preserves 24 leads / 5 students / 9 lessons and historical events', async (t) => {
  const f = await fixture(t, true);
  for (const [table, count] of [
    ['leads', 24],
    ['students', 5],
    ['lessons', 9],
    ['activity_events', 1],
    ['lesson_reminders', 18],
  ])
    assert.equal((await f.rows(`SELECT count(*) n FROM ${table}`))[0].n, count);
  const a = await f.repo.load('u', 'imported-0');
  assert.equal(a.lead.responseAt, null);
  assert.equal(a.lead.subject, '');
  assert.equal(leadDetail(a, NOW).lessons[0].lessonDate, '2026-09-10');
  assert.equal(leadDetail(a, NOW).lessons[0].status, 'booked');
  assert.equal(leadDetail(a, NOW).lessons[0].reminders[0].state, 'needs-data');
  await assert.rejects(f.create({ phone: '0671234567' }), /Знайдено збіг/);
  await f.run('archive', {}, 'imported-0');
  assert.equal(
    (
      await f.rows(
        "SELECT count(*) n FROM activity_events WHERE event_type='lead_created' AND cancelled_at IS NULL",
      )
    )[0].n,
    1,
  );
  await f.run('restore', {}, 'imported-0');
  assert.equal((await f.repo.load('u', 'imported-0')).lead.archivedAt, null);
  await assert.rejects(
    f.db
      .prepare(
        "INSERT INTO lead_import_guards(lead_id,user_id) VALUES ('imported-0','u')",
      )
      .run(),
    /Повторний імпорт/,
  );
});
void test('duplicate phone/Telegram normalization, explicit acknowledgement, archive and owner isolation', async (t) => {
  const f = await fixture(t);
  const id = await f.create({
    phone: '+38 (067) 123-45-67',
    telegramUsername: '@ExampleUser',
  });
  await assert.rejects(f.create({ phone: '0671234567' }), /Знайдено збіг/);
  await assert.rejects(
    f.create({ telegramUsername: 'https://t.me/exampleuser' }),
    /Знайдено збіг/,
  );
  await f.run('archive', {}, id);
  await assert.rejects(f.create({ phone: '00380671234567' }), /Знайдено збіг/);
  await f.create({ phone: '0671234567', duplicateState: 'possible' });
  assert.equal(await f.repo.load('other', id), null);
  await assert.rejects(
    executeLeadCommand(
      f.repo,
      'other',
      {
        commandId: crypto.randomUUID(),
        leadId: id,
        version: 1,
        action: 'archive',
      },
      NOW,
    ),
    /не знайдено/,
  );
});
void test('one lead, several students/lessons and repeated booking never creates a lead; retries are idempotent', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.run('student_create', { name: 'Child 1', grade: 1 }, id);
  await f.run(
    'student_create',
    { name: 'Child 2', ageGroup: 'Дошкільнята' },
    id,
  );
  let a = await f.repo.load('u', id);
  await f.book(id, { studentId: a.students[0].id });
  await f.book(id, { studentId: a.students[1].id });
  a = await f.repo.load('u', id);
  const command = {
    commandId: crypto.randomUUID(),
    leadId: id,
    version: a.lead.version,
    action: 'lesson_book',
    data: {
      subject: 'Math',
      lessonDate: '2026-09-12',
      bookingDate: '2026-09-09',
    },
  };
  await executeLeadCommand(f.repo, 'u', command, NOW);
  await executeLeadCommand(f.repo, 'u', command, NOW);
  a = await f.repo.load('u', id);
  assert.equal(a.students.length, 2);
  assert.equal(a.lessons.length, 3);
  assert.equal((await f.rows('SELECT count(*) n FROM leads'))[0].n, 1);
  assert.equal(
    (
      await f.rows(
        "SELECT count(*) n FROM activity_events WHERE event_type='lesson_booked'",
      )
    )[0].n,
    3,
  );
  await assert.rejects(
    executeLeadCommand(
      f.repo,
      'u',
      { ...command, data: { ...command.data, subject: 'Different' } },
      NOW,
    ),
    /вже використано/,
  );
});
void test('blank subject, invalid grade and hostile payloads are rejected without writes', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.create({ subject: '  ' }), /Предмет/);
  const id = await f.create();
  for (const grade of [0, 12, 1.5, '2'])
    await assert.rejects(
      f.run('student_create', { name: 'Child', grade }, id),
      /Клас/,
    );
  await f.run(
    'student_create',
    { name: 'Adult', grade: null, ageGroup: 'Дорослий' },
    id,
  );
  await assert.rejects(f.book(id, { subject: ' ' }), /Предмет/);
  await assert.rejects(
    f.book(id, { studentId: 'another-lead-student' }),
    /належати/,
  );
  await assert.rejects(
    f.book(id, { meetingLink: 'javascript:alert(1)' }),
    /посилання/,
  );
  await assert.rejects(
    f.run('update', { userId: 'other' }, id),
    /Невідоме поле/,
  );
  await assert.rejects(
    f.run('update', { responseDate: '2026-02-30' }, id),
    /дата/,
  );
  assert.equal((await f.repo.load('u', id)).lessons.length, 0);
});
void test('reminder defaults, needs-data, independent markers and reschedule inheritance', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.book(id, { teacherName: '', meetingLink: '' });
  let a = await f.repo.load('u', id);
  const old = a.lessons[0];
  assert.deepEqual(
    a.reminders.map((r) => r.offsetMinutes),
    [1440, 60],
  );
  assert.equal(leadDetail(a, NOW).lessons[0].reminders[0].state, 'needs-data');
  assert.equal(leadDetail(a, NOW).lessons[0].reminders[0].text, null);
  await assert.rejects(
    f.run('reminder_mark', { state: 'sent' }, id, a.reminders[0].id),
    /Доповніть/,
  );
  await f.run(
    'lesson_update',
    { teacherName: 'Teacher', meetingLink: 'https://meet.google.com/test' },
    id,
    old.id,
  );
  a = await f.repo.load('u', id);
  await f.run(
    'reminder_update',
    { enabled: true, offsetMinutes: 120 },
    id,
    a.reminders[0].id,
  );
  await f.run('reminder_mark', { state: 'sent' }, id, a.reminders[0].id);
  await f.run('reminder_mark', { state: 'skipped' }, id, a.reminders[1].id);
  await f.run(
    'reminder_update',
    { enabled: false, offsetMinutes: 30 },
    id,
    a.reminders[1].id,
  );
  await f.run(
    'lesson_reschedule',
    { lessonDate: '2026-09-11', reason: 'Змінився графік' },
    id,
    old.id,
  );
  a = await f.repo.load('u', id);
  const replacement = a.lessons.find((l) => l.rescheduledFromId === old.id);
  assert.equal(a.lessons.find((l) => l.id === old.id).status, 'rescheduled');
  assert.ok(replacement);
  assert.equal(replacement.bookingDate, old.bookingDate);
  const fresh = a.reminders.filter((r) => r.lessonId === replacement.id);
  assert.deepEqual(
    fresh.map((r) => [r.enabled, r.offsetMinutes, r.sentAt, r.skippedAt]),
    [
      [true, 120, null, null],
      [false, 30, null, null],
    ],
  );
  assert.equal(
    a.reminders.find((r) => r.id === `${old.id}:reminder:1`).sentAt,
    NOW,
  );
  assert.equal(
    (
      await f.rows(
        "SELECT count(*) n FROM activity_events WHERE event_type='lesson_booked'",
      )
    )[0].n,
    1,
  );
  assert.equal(
    (
      await f.rows(
        "SELECT count(*) n FROM activity_events WHERE event_type='lesson_rescheduled'",
      )
    )[0].n,
    1,
  );
  await assert.rejects(
    f.run(
      'lesson_reschedule',
      { lessonDate: '2026-09-12', reason: 'Again' },
      id,
      old.id,
    ),
    /уже/,
  );
});
void test('follow-up overdue, first reply duration, lifecycle events and archive keep historical metrics', async (t) => {
  const f = await fixture(t);
  const responseAt = NOW - 7200;
  const id = await f.create({
    responseAt,
    nextAction: 'Написати',
    nextContactAt: NOW - 1,
  });
  assert.equal(
    (
      await f.repo.list(
        'u',
        { archived: false, overdue: true, search: '', offset: 0 },
        NOW,
      )
    ).total,
    1,
  );
  await f.run('first_reply', { at: NOW - 3600 }, id);
  assert.equal(
    leadDetail(await f.repo.load('u', id), NOW).lead.waitingSeconds,
    3600,
  );
  await assert.rejects(f.run('first_reply', { at: NOW }, id), /уже/);
  for (const status of ['completed', 'cancelled', 'no-show']) {
    await f.book(id);
    const a = await f.repo.load('u', id);
    const lesson = a.lessons.find((l) => l.status === 'booked');
    await f.run(
      'lesson_status',
      { status, reason: 'Test reason' },
      id,
      lesson.id,
    );
  }
  const types = (await f.rows('SELECT event_type FROM activity_events')).map(
    (r) => r.event_type,
  );
  for (const type of [
    'lead_created',
    'first_reply_recorded',
    'lesson_booked',
    'lesson_completed',
    'lesson_cancelled',
    'lesson_no_show',
  ])
    assert.ok(types.includes(type), type);
  await f.run('archive', {}, id);
  assert.equal(
    (
      await f.repo.list(
        'u',
        { archived: false, overdue: true, search: '', offset: 0 },
        NOW,
      )
    ).total,
    0,
  );
  await assert.rejects(f.book(id), /відновіть/);
  assert.equal(
    (
      await f.rows(
        "SELECT count(*) n FROM activity_events WHERE event_type='lesson_booked' AND cancelled_at IS NULL",
      )
    )[0].n,
    3,
  );
  await f.run('restore', {}, id);
  assert.equal((await f.repo.load('u', id)).lead.archivedAt, null);
});
void test('optimistic concurrency and D1 batch failure roll back records/events together', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const a = await f.repo.load('u', id);
  const command = {
    leadId: id,
    version: a.lead.version,
    action: 'lesson_book',
    data: { subject: 'Math', lessonDate: '2026-09-10' },
  };
  const outcomes = await Promise.allSettled(
    [1, 2].map(() =>
      executeLeadCommand(
        f.repo,
        'u',
        { ...command, commandId: crypto.randomUUID() },
        NOW,
      ),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await f.repo.load('u', id)).lessons.length, 1);
  const before = await f.rows('SELECT count(*) n FROM lead_commands');
  await assert.rejects(
    f.repo.commit(
      {
        lead: { ...(await f.repo.load('u', id)).lead, version: 99 },
        create: false,
        students: [],
        lessons: [],
        reminders: [],
        messages: [],
        events: [],
      },
      {
        id: crypto.randomUUID(),
        userId: 'u',
        leadId: id,
        expectedVersion: 0,
        requestJson: '{}',
        createdAt: NOW,
      },
    ),
    /іншому пристрої/,
  );
  assert.deepEqual(
    await f.rows('SELECT count(*) n FROM lead_commands'),
    before,
  );
  assert.notEqual((await f.repo.load('u', id)).lead.version, 99);
});
void test('CRM messages edit/delete/export without external messaging or fake first reply', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.run(
    'message_create',
    { sender: 'me', body: 'Hello\nSecond line', sentAt: NOW - 1 },
    id,
  );
  let a = await f.repo.load('u', id);
  assert.equal(a.lead.firstReplyAt, null);
  assert.match(exportConversation(a), /Hello\nSecond line/);
  await f.run(
    'message_update',
    { sender: 'lead', body: 'Edited', sentAt: NOW - 2 },
    id,
    a.messages[0].id,
  );
  a = await f.repo.load('u', id);
  assert.match(exportConversation(a), /Edited/);
  assert.doesNotMatch(exportConversation(a), /Hello/);
  await f.run('message_delete', {}, id, a.messages[0].id);
  assert.doesNotMatch(exportConversation(await f.repo.load('u', id)), /Edited/);
  assert.equal(
    (
      await f.rows(
        'SELECT count(*) n FROM lead_messages WHERE deleted_at IS NOT NULL',
      )
    )[0].n,
    1,
  );
});
void test('long CRM history is server-paginated with a stable owner-scoped cursor', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  for (let index = 5; index >= 1; index -= 1)
    await f.run(
      'message_create',
      { sender: index % 2 ? 'lead' : 'me', body: `Message ${index}`, sentAt: NOW - index },
      id,
    );
  const latest = await f.repo.load('u', id, { messageLimit: 2 });
  assert.deepEqual(latest.messages.map((message) => message.body), ['Message 2', 'Message 1']);
  assert.deepEqual(latest.messagePage, {
    hasMore: true,
    before: { sentAt: NOW - 2, id: latest.messages[0].id },
  });
  const middle = await f.repo.loadMessages('u', id, {
    limit: 2,
    before: latest.messagePage.before,
  });
  assert.deepEqual(middle.messages.map((message) => message.body), ['Message 4', 'Message 3']);
  assert.equal(middle.hasMore, true);
  const oldest = await f.repo.loadMessages('u', id, {
    limit: 2,
    before: middle.before,
  });
  assert.deepEqual(oldest.messages.map((message) => message.body), ['Message 5']);
  assert.equal(oldest.hasMore, false);
  assert.equal(await f.repo.loadMessages('other', id, { limit: 2 }), null);
  assert.equal((await f.repo.load('u', id)).messages.length, 5);
});
void test('CRM pages handle tied timestamps, deletions and stale cards without extra writes', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.db.batch(Array.from({ length: 95 }, (_, index) => f.db.prepare(
    'INSERT INTO lead_messages(id,user_id,lead_id,sender,body,sent_at,created_at,updated_at,deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(`message-${String(index).padStart(3, '0')}`, 'u', id, 'lead', `Body ${index}`, NOW - 1, NOW, NOW, index === 45 ? NOW : null)));
  const latest = await f.repo.load('u', id, { messageLimit: 30 });
  assert.equal(latest.messages.length, 30);
  assert.equal(latest.messages[0].id, 'message-065');
  const beforeReads = await f.rows('SELECT count(*) n FROM lead_commands');
  const originalBatch = f.repo.db.batch.bind(f.repo.db);
  const batches = [];
  const pageQueries = [];
  f.repo.db.batch = (queries) => {
    batches.push(queries.length);
    if (queries.length === 2) pageQueries.push(queries[1].toSQL());
    return originalBatch(queries);
  };
  let cursor = latest.messagePage.before;
  const ids = latest.messages.map((message) => message.id);
  while (cursor) {
    const page = await f.repo.loadMessages('u', id, { limit: 30, before: cursor, version: latest.lead.version });
    assert.ok(page.messages.length <= 30);
    ids.unshift(...page.messages.map((message) => message.id));
    cursor = page.before;
  }
  assert.deepEqual(batches, [2, 2, 2]);
  const query = pageQueries[0];
  const plan = await f.rows(`EXPLAIN QUERY PLAN ${query.sql}`, ...query.params);
  assert.match(JSON.stringify(plan), /lead_messages_history_idx/);
  assert.doesNotMatch(JSON.stringify(plan), /USE TEMP B-TREE|SCAN lead_messages/);
  assert.equal(ids.length, 94);
  assert.equal(new Set(ids).size, 94);
  assert.deepEqual(ids, [...ids].sort());
  assert.ok(!ids.includes('message-045'));
  assert.deepEqual(await f.rows('SELECT count(*) n FROM lead_commands'), beforeReads);
  assert.equal(await f.repo.loadMessages('other', id, { limit: 30, version: latest.lead.version }), null);
  assert.equal(await f.repo.loadMessages('u', 'missing', { limit: 30 }), null);
  await f.run('message_update', { sender: 'me', body: 'Old message edited', sentAt: NOW - 2 }, id, 'message-000');
  await assert.rejects(f.repo.loadMessages('u', id, {
    limit: 30, before: latest.messagePage.before, version: latest.lead.version,
  }), (error) => error.status === 409);
  assert.match(exportConversation(await f.repo.load('u', id)), /Old message edited/);
  assert.doesNotMatch(exportConversation(await f.repo.load('u', id)), /Body 45\n/);
});
void test('HTTP validation: origin, malformed JSON, size limit; Kyiv DST rejects gaps/ambiguity', async () => {
  await assert.rejects(
    commandBody(
      new Request('https://example.test/api/leads', {
        method: 'POST',
        body: '{}',
      }),
    ),
    (e) => e.status === 403,
  );
  await assert.rejects(
    commandBody(
      new Request('https://example.test/api/leads', {
        method: 'POST',
        headers: {
          origin: 'https://example.test',
          'content-type': 'application/json',
        },
        body: '[',
      }),
    ),
    /JSON/,
  );
  await assert.rejects(
    commandBody(
      new Request('https://example.test/api/leads', {
        method: 'POST',
        headers: {
          origin: 'https://example.test',
          'content-type': 'application/json',
        },
        body: ' '.repeat(65537),
      }),
    ),
    (e) => e.status === 413,
  );
  assert.equal(lessonEpoch('2026-03-29', '03:30'), null);
  assert.equal(lessonEpoch('2026-10-25', '03:30'), null);
  assert.equal(
    lessonEpoch('2026-09-10', '18:00'),
    Date.parse('2026-09-10T15:00:00Z') / 1000,
  );
});
void test('business-date corrections preserve one metric and source chat attribution preserves invite case', async (t) => {
  const f = await fixture(t);
  await f.db
    .prepare(
      "INSERT INTO telegram_accounts(id,user_id,account_number,name,created_at,updated_at) VALUES ('tg','u',1,'TG1',1,1)",
    )
    .run();
  await f.db
    .prepare(
      "INSERT INTO chats(id,user_id,platform,name,link,normalized_link,workflow_status,telegram_account_id,created_at,updated_at) VALUES ('source','u','telegram','Chat','https://t.me/+CaseSensitive','https://t.me/+CaseSensitive','ready','tg',1,1)",
    )
    .run();
  const id = await f.create({
    sourceChatLink: 'https://www.t.me/+CaseSensitive/#fragment',
  });
  const e = (
    await f.rows(
      "SELECT * FROM activity_events WHERE event_type='lead_created'",
    )
  )[0];
  assert.equal(e.chat_id, 'source');
  assert.equal(e.telegram_account_id, 'tg');
  await f.run('update', { responseDate: '2026-09-07' }, id);
  assert.equal(
    (
      await f.rows(
        "SELECT event_date FROM activity_events WHERE event_type='lead_created'",
      )
    )[0].event_date,
    '2026-09-07',
  );
  await f.book(id);
  const a = await f.repo.load('u', id);
  await f.run(
    'lesson_update',
    { bookingDate: '2026-09-06' },
    id,
    a.lessons[0].id,
  );
  const booked = await f.rows(
    "SELECT event_date FROM activity_events WHERE event_type='lesson_booked'",
  );
  assert.deepEqual(booked, [{ event_date: '2026-09-06' }]);
  await assert.rejects(
    f.run('lesson_update', { lessonTime: '19:00' }, id, a.lessons[0].id),
    /перенесення/,
  );
});
void test('failure after aggregate update rolls back changes and command receipt', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const a = await f.repo.load('u', id);
  const receipt = {
    id: crypto.randomUUID(),
    userId: 'u',
    leadId: id,
    expectedVersion: a.lead.version,
    requestJson: '{}',
    createdAt: NOW,
  };
  const badMessage = {
    id: crypto.randomUUID(),
    userId: 'u',
    leadId: id,
    sender: 'me',
    body: '',
    sentAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
  await assert.rejects(
    f.repo.commit(
      {
        lead: {
          ...a.lead,
          name: 'Must roll back',
          version: a.lead.version + 1,
        },
        create: false,
        students: [],
        lessons: [],
        reminders: [],
        messages: [badMessage],
        events: [],
      },
      receipt,
    ),
  );
  assert.equal((await f.repo.load('u', id)).lead.name, a.lead.name);
  assert.equal(await f.repo.receipt('u', receipt.id), null);
});
void test('reminder sent/skipped events exist once and disabled reminders cannot be marked', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.book(id);
  const a = await f.repo.load('u', id);
  await f.run('reminder_mark', { state: 'sent' }, id, a.reminders[0].id);
  await assert.rejects(
    f.run('reminder_mark', { state: 'sent' }, id, a.reminders[0].id),
    /вже оброблено/,
  );
  await f.run(
    'reminder_update',
    { enabled: false, offsetMinutes: 60 },
    id,
    a.reminders[1].id,
  );
  await assert.rejects(
    f.run('reminder_mark', { state: 'skipped' }, id, a.reminders[1].id),
    /вимкнено/,
  );
  await f.run(
    'reminder_update',
    { enabled: true, offsetMinutes: 60 },
    id,
    a.reminders[1].id,
  );
  await f.run('reminder_mark', { state: 'skipped' }, id, a.reminders[1].id);
  assert.deepEqual(
    (
      await f.rows(
        "SELECT event_type FROM activity_events WHERE event_type LIKE 'reminder_%' ORDER BY event_type",
      )
    ).map((e) => e.event_type),
    ['reminder_sent', 'reminder_skipped'],
  );
});
void test('native booking resolves selected pending curator event atomically without double metric', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.db
    .prepare(
      "INSERT INTO curator_requests(id,user_id,lead_id,status,submitted_at,submitted_date,created_at,updated_at) VALUES ('request','u',?,'pending',1,'2026-09-07',1,1)",
    )
    .bind(id)
    .run();
  await f.db
    .prepare(
      `INSERT INTO activity_events(id,user_id,lead_id,event_type,occurred_at,event_date,metadata_json,source_key) VALUES ('pending','u',?,'curator_booking_pending',1,'2026-09-07','{"curatorRequestId":"request","status":"pending"}','legacy:curator-request:test')`,
    )
    .bind(id)
    .run();
  await assert.rejects(f.book(id), /Оберіть активний запит/);
  await f.book(id, { curatorRequestId: 'request' });
  assert.equal(
    (await f.rows("SELECT status FROM curator_requests WHERE id='request'"))[0]
      .status,
    'confirmed',
  );
  const active = await f.rows(
    "SELECT event_type FROM activity_events WHERE event_type IN ('curator_booking_pending','lesson_booked') AND cancelled_at IS NULL",
  );
  assert.deepEqual(active, [{ event_type: 'lesson_booked' }]);
  assert.equal(
    (
      await f.rows(
        "SELECT cancelled_at FROM activity_events WHERE id='pending'",
      )
    )[0].cancelled_at,
    NOW,
  );
});

void test('manual curator request is dated, idempotent and resolves into one lesson', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.run('curator_submit', { submittedDate: '2026-09-07' }, id);
  let aggregate = await f.repo.load('u', id);
  assert.equal(aggregate.curatorRequests.length, 1);
  assert.equal(aggregate.curatorRequests[0].status, 'pending');
  assert.equal(aggregate.curatorRequests[0].submittedDate, '2026-09-07');
  assert.equal(
    (await f.rows("SELECT count(*) n FROM activity_events WHERE event_type='curator_booking_pending' AND cancelled_at IS NULL"))[0].n,
    1,
  );
  await assert.rejects(f.run('curator_submit', { submittedDate: '2026-09-08' }, id), /вже є активний/);
  await assert.rejects(f.run('curator_submit', { submittedDate: '2026-09-09' }, id), /вже є активний/);
  const requestId = aggregate.curatorRequests[0].id;
  await f.book(id, { curatorRequestId: requestId });
  aggregate = await f.repo.load('u', id);
  assert.equal((await f.rows("SELECT status FROM curator_requests WHERE id=?", requestId))[0].status, 'confirmed');
  assert.equal(aggregate.lessons.length, 1);
  assert.equal(
    (await f.rows("SELECT count(*) n FROM activity_events WHERE event_type='curator_booking_pending' AND cancelled_at IS NULL"))[0].n,
    0,
  );
  assert.equal(
    (await f.rows("SELECT count(*) n FROM activity_events WHERE event_type='lesson_booked' AND cancelled_at IS NULL"))[0].n,
    1,
  );
});

void test('direct API cannot clear a known response date; correction keeps canonical event metadata aligned', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await assert.rejects(
    f.run('update', { responseDate: null }, id),
    /Дата відгуку/,
  );
  await f.run('update', { responseDate: '2026-09-07' }, id);
  const [e] = await f.rows(
    "SELECT event_date,metadata_json FROM activity_events WHERE event_type='lead_created'",
  );
  assert.equal(e.event_date, JSON.parse(e.metadata_json).responseDate);
  await assert.rejects(f.create({ phone: '123+456789' }), /телефон/);
  let deep = {};
  for (let i = 0; i < 100; i++) deep = { nested: deep };
  await assert.rejects(f.run('update', deep, id), /вкладеність/);
});

void test('incomplete imported lesson can acquire time without rescheduling or changing student identity', async (t) => {
  const f = await fixture(t, true);
  await f.run(
    'lesson_update',
    {
      lessonTime: '18:00',
      teacherName: 'Teacher',
      lessonPlatform: 'Meet',
      meetingLink: 'https://meet.example.test',
    },
    'imported-0',
    'lesson-0',
  );
  let a = await f.repo.load('u', 'imported-0');
  const lesson = a.lessons.find((l) => l.id === 'lesson-0');
  assert.equal(lesson.studentName, 'Legacy student');
  assert.equal(lesson.rescheduledFromId, null);
  assert.equal(a.lessons.length, 9);
  assert.equal(
    leadDetail(a, NOW).lessons.find((l) => l.id === 'lesson-0').reminders[0]
      .state,
    'pending',
  );
  await f.run(
    'lesson_reschedule',
    { lessonDate: '2026-09-11', reason: 'New time' },
    'imported-0',
    'lesson-0',
  );
  a = await f.repo.load('u', 'imported-0');
  assert.equal(
    a.lessons.find((l) => l.rescheduledFromId === 'lesson-0').studentName,
    'Legacy student',
  );
});

void test('past lesson reminder has no sendable text and marking sent is rejected', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.book(id, { lessonDate: '2026-09-07' });
  const a = await f.repo.load('u', id);
  const reminder = leadDetail(a, NOW).lessons[0].reminders[0];
  assert.equal(reminder.state, 'expired');
  assert.equal(reminder.text, null);
  await assert.rejects(
    f.run('reminder_mark', { state: 'sent' }, id, reminder.id),
    /після початку/,
  );
  await f.run('reminder_mark', { state: 'skipped' }, id, reminder.id);
});

void test('concurrent identical retry succeeds when receipt appears between initial lookup and aggregate load', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  const command = {
    commandId: crypto.randomUUID(),
    leadId: id,
    version: 1,
    action: 'lesson_book',
    data: { subject: 'Math', lessonDate: '2026-09-10' },
  };
  const racing = Object.create(f.repo);
  let intercepted = false;
  racing.receipt = async (...args) => {
    if (!intercepted) {
      intercepted = true;
      await executeLeadCommand(f.repo, 'u', command, NOW);
      return null;
    }
    return f.repo.receipt(...args);
  };
  assert.equal(await executeLeadCommand(racing, 'u', command, NOW), id);
  assert.equal((await f.repo.load('u', id)).lessons.length, 1);
});

void test('repeat sync guards persisted parents and rolls back a whole conflicting import chunk', async (t) => {
  const { legacyLeadGuards } =
    await import('../lib/leads/data/import-guards.ts');
  const f = await fixture(t, true);
  await f.run('update', { note: 'Cloud edit' }, 'imported-0');
  const before = await f.repo.load('u', 'imported-1');
  const record = { id: 'student-0', leadId: 'imported-1' };
  await assert.rejects(
    f.db.batch([
      ...legacyLeadGuards(f.db, 'students', record, 'u'),
      f.db.prepare(
        "UPDATE students SET lead_id='imported-1' WHERE id='student-0'",
      ),
    ]),
    /Повторний імпорт/,
  );
  assert.equal(
    (await f.rows("SELECT lead_id FROM students WHERE id='student-0'"))[0]
      .lead_id,
    'imported-0',
  );
  assert.equal(
    (await f.repo.load('u', 'imported-1')).lead.version,
    before.lead.version,
  );
  await assert.rejects(
    f.db.batch(
      legacyLeadGuards(
        f.db,
        'events',
        { id: 'different-id', leadId: null, sourceKey: 'legacy:lead:0' },
        'u',
      ),
    ),
    /Повторний імпорт/,
  );
  assert.equal((await f.repo.load('u', 'imported-0')).lead.note, 'Cloud edit');
});

void test('paged backup rejects intervening writes including child edits and isolates owner revisions', async (t) => {
  const { backupManifest, backupPage } =
    await import('../lib/backups/export.ts');
  const f = await fixture(t);
  const id = await f.create();
  const manifest = await backupManifest(f.db, 'u');
  assert.equal(
    (await backupPage(f.db, 'u', 'leads', '', manifest.revision)).rows.length,
    1,
  );
  const other = await backupManifest(f.db, 'other');
  await f.run('student_create', { name: 'Child', grade: 4 }, id);
  await assert.rejects(
    backupPage(f.db, 'u', 'leads', '', manifest.revision),
    /змінилися/,
  );
  assert.equal((await backupManifest(f.db, 'other')).revision, other.revision);
});

void test('schema 5 backup round trip retains all domain fields, provenance, receipts and archived events', async (t) => {
  const { BACKUP_TABLES, backupManifest, backupPage } =
    await import('../lib/backups/export.ts');
  const f = await fixture(t);
  const id = await f.create({
    responseAt: NOW - 7200,
    qualification: 'A',
    familyQualification: 'B',
    nextAction: 'Call',
    nextContactAt: NOW + 3600,
  });
  await f.run('first_reply', { at: NOW - 3600 }, id);
  await f.run('student_create', { name: 'Child', grade: 5 }, id);
  await f.book(id, { studentId: (await f.repo.load('u', id)).students[0].id });
  let a = await f.repo.load('u', id);
  await f.run('reminder_mark', { state: 'sent' }, id, a.reminders[0].id);
  await f.run(
    'lesson_reschedule',
    { lessonDate: '2026-09-11', reason: 'Changed' },
    id,
    a.lessons[0].id,
  );
  await f.run(
    'message_create',
    { sender: 'lead', body: 'Internal history', sentAt: NOW },
    id,
  );
  await f.run('archive', {}, id);
  await f.db
    .prepare(
      "INSERT INTO legacy_imports(id,user_id,original_filename,sha256,source_schema_version,byte_size,summary_json,created_at,updated_at) VALUES ('import','u','source.json','hash',1,2,'{}',1,1)",
    )
    .run();
  await f.db
    .prepare("INSERT INTO legacy_import_chunks VALUES ('import',0,'{}')")
    .run();
  await f.db
    .prepare(
      "UPDATE leads SET source_import_id='import',legacy_payload_json='{}' WHERE id=?",
    )
    .bind(id)
    .run();
  const manifest = await backupManifest(f.db, 'u');
  const snapshot = {};
  for (const table of BACKUP_TABLES)
    snapshot[table] = (
      await backupPage(f.db, 'u', table, '', manifest.revision)
    ).rows;
  const restored = await fixture(t);
  // Restore into an empty database with the same seeded owner. Deferred FKs
  // handle replacement chains regardless of UUID ordering. Insert managed_at
  // last to avoid applying live duplicate-entry policy to an exact snapshot.
  const statements = [restored.db.prepare('PRAGMA defer_foreign_keys=ON')];
  const managed = [];
  for (const table of BACKUP_TABLES)
    for (const original of snapshot[table]) {
      const row = { ...original };
      if (table === 'leads') {
        managed.push([row.managed_at, row.id]);
        row.managed_at = null;
      }
      const columns = Object.keys(row);
      statements.push(
        restored.db
          .prepare(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
          )
          .bind(...Object.values(row)),
      );
    }
  for (const [at, leadId] of managed)
    statements.push(
      restored.db
        .prepare('UPDATE leads SET managed_at=? WHERE id=?')
        .bind(at, leadId),
    );
  await restored.db.batch(statements);
  for (const table of BACKUP_TABLES) {
    const revision = (await backupManifest(restored.db, 'u')).revision;
    assert.deepEqual(
      (await backupPage(restored.db, 'u', table, '', revision)).rows,
      snapshot[table],
      table,
    );
  }
  assert.deepEqual(await restored.rows('PRAGMA foreign_key_check'), []);
  a = await restored.repo.load('u', id);
  assert.equal(a.lead.archivedAt, NOW);
  assert.equal(a.lessons.length, 2);
  const receipt = (
    await restored.rows(
      "SELECT request_json FROM lead_commands WHERE json_extract(request_json,'$.action')='lesson_book'",
    )
  )[0];
  assert.equal(
    await executeLeadCommand(
      restored.repo,
      'u',
      JSON.parse(receipt.request_json),
      NOW,
    ),
    id,
  );
  assert.equal((await restored.repo.load('u', id)).lessons.length, 2);
});

void test('Ukrainian names are searchable regardless of case without changing stored names', async (t) => {
  const f = await fixture(t);
  const id = await f.create({ name: 'ІРИНА Ґалаґан' });
  const result = await f.repo.list(
    'u',
    { archived: false, overdue: false, search: 'ірина ґал', offset: 0 },
    NOW,
  );
  assert.equal(result.leads[0]?.id, id);
  assert.equal((await f.repo.load('u', id)).lead.name, 'ІРИНА Ґалаґан');
});

void test('curator state race rolls back the booking, receipt and event even without a lead version change', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.db
    .prepare(
      "INSERT INTO curator_requests(id,user_id,lead_id,status,submitted_at,submitted_date,created_at,updated_at) VALUES ('request','u',?,'pending',1,'2026-09-07',1,1)",
    )
    .bind(id)
    .run();
  const racing = Object.create(f.repo);
  racing.commit = async (changes, receipt) => {
    await f.db
      .prepare(
        "UPDATE curator_requests SET status='cancelled' WHERE id='request'",
      )
      .run();
    return f.repo.commit(changes, receipt);
  };
  await assert.rejects(
    executeLeadCommand(
      racing,
      'u',
      {
        commandId: crypto.randomUUID(),
        leadId: id,
        version: 1,
        action: 'lesson_book',
        data: {
          curatorRequestId: 'request',
          subject: 'English',
          lessonDate: '2026-09-10',
        },
      },
      NOW,
    ),
    /іншому пристрої/,
  );
  assert.equal((await f.repo.load('u', id)).lessons.length, 0);
  assert.equal((await f.rows('SELECT count(*) n FROM lead_commands'))[0].n, 1);
  assert.equal(
    (
      await f.rows(
        "SELECT count(*) n FROM activity_events WHERE event_type='lesson_booked'",
      )
    )[0].n,
    0,
  );
});

void test('curator cancellation preserves history, cancels only its provisional metric and rejects repeat resolution', async (t) => {
  const f = await fixture(t);
  const id = await f.create();
  await f.db
    .prepare(
      "INSERT INTO curator_requests(id,user_id,lead_id,status,submitted_at,submitted_date,created_at,updated_at) VALUES ('request','u',?,'pending',1,'2026-09-07',1,1)",
    )
    .bind(id)
    .run();
  await f.db
    .prepare(
      `INSERT INTO activity_events(id,user_id,lead_id,event_type,occurred_at,event_date,metadata_json,source_key) VALUES ('pending','u',?,'curator_booking_pending',1,'2026-09-07','{"curatorRequestId":"request"}','legacy:request')`,
    )
    .bind(id)
    .run();
  await assert.rejects(
    f.run('curator_cancel', { reason: '' }, id, 'request'),
    /Причина/,
  );
  await f.run('curator_cancel', { reason: 'No longer needed' }, id, 'request');
  assert.equal(
    (await f.rows("SELECT status FROM curator_requests WHERE id='request'"))[0]
      .status,
    'cancelled',
  );
  assert.equal(
    (
      await f.rows(
        "SELECT cancelled_at FROM activity_events WHERE id='pending'",
      )
    )[0].cancelled_at,
    NOW,
  );
  await assert.rejects(
    f.run('curator_cancel', { reason: 'Again' }, id, 'request'),
    /не знайдено/,
  );
  await f.book(id);
  assert.deepEqual(
    await f.rows(
      "SELECT event_type FROM activity_events WHERE event_type IN ('lesson_booked','curator_booking_pending') AND cancelled_at IS NULL",
    ),
    [{ event_type: 'lesson_booked' }],
  );
});

void test('HTTP JSON media type must be exact, while charset parameters are accepted', async () => {
  const request = (type) =>
    new Request('https://example.test/api/leads', {
      method: 'POST',
      headers: { origin: 'https://example.test', 'content-type': type },
      body: '{}',
    });
  await assert.rejects(
    commandBody(request('application/json-evil')),
    (e) => e.status === 415,
  );
  assert.deepEqual(
    await commandBody(request('application/json; charset=utf-8')),
    {},
  );
});

void test('unknown imported business dates remain null during unrelated edits and reschedule', async (t) => {
  const f = await fixture(t, true);
  await f.db
    .prepare("UPDATE leads SET response_date=NULL WHERE id='imported-0'")
    .run();
  await f.db
    .prepare("UPDATE lessons SET booking_date=NULL WHERE id='lesson-0'")
    .run();
  await f.run('update', { note: 'Cloud note' }, 'imported-0');
  await f.run(
    'lesson_update',
    { teacherName: 'Teacher', lessonTime: '18:00' },
    'imported-0',
    'lesson-0',
  );
  await f.run(
    'lesson_reschedule',
    { lessonDate: '2026-09-11', reason: 'Changed' },
    'imported-0',
    'lesson-0',
  );
  const a = await f.repo.load('u', 'imported-0');
  assert.equal(a.lead.responseDate, null);
  assert.equal(
    a.lessons.find((l) => l.rescheduledFromId === 'lesson-0').bookingDate,
    null,
  );
});
