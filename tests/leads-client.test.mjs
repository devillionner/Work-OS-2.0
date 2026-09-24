import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandClient } from '../lib/leads/client/commands.ts';

void test('unknown transport outcome retries identical body and prevents a changed payload from creating a second booking', async () => {
  const bodies = [];
  let fail = true;
  const send = createCommandClient(async (_url, options) => {
    bodies.push(options.body);
    if (fail) throw new Error('Connection lost after commit');
    return Response.json({ id: 'lead' });
  });
  const lead = { id: 'lead', version: 2 };
  await assert.rejects(
    send('lesson_book', { subject: 'Math' }, lead),
    /Connection lost/,
  );
  assert.equal(bodies[0], bodies[1]);
  fail = false;
  await assert.rejects(
    send('lesson_book', { subject: 'English' }, { ...lead, version: 3 }),
    /Нову дію ще не виконано/,
  );
  assert.equal(bodies[2], bodies[0]);
  await send('lesson_book', { subject: 'English' }, { ...lead, version: 3 });
  assert.notEqual(
    JSON.parse(bodies[3]).commandId,
    JSON.parse(bodies[0]).commandId,
  );
  assert.equal(JSON.parse(bodies[3]).version, 3);
});

void test('minute precision editing preserves unchanged timestamps and rejects ambiguous Kyiv wall time', async () => {
  const { datetimeValue, epochValue } =
    await import('../lib/leads/client/form-values.ts');
  const original = Date.parse('2026-09-08T12:00:37Z') / 1000;
  const form = new FormData();
  form.set('at', datetimeValue(original));
  assert.equal(epochValue(form, 'at', original), original);
  form.set('at', '2026-10-25T03:30');
  assert.throws(() => epochValue(form, 'at'), /неоднозначний/);
});

void test('delivery journal survives a reload and is cleared only after a definitive response', async () => {
  let stored = null;
  const journal = {
    read: () => stored,
    write: (value) => {
      stored = value;
    },
  };
  const first = createCommandClient(async () => {
    throw new Error('Disconnected');
  }, journal);
  await assert.rejects(
    first('lesson_book', { subject: 'Math' }, { id: 'lead', version: 4 }),
  );
  const original = stored.body;
  let sent;
  const reloaded = createCommandClient(async (_url, options) => {
    sent = options.body;
    return Response.json({ id: 'lead' });
  }, journal);
  await reloaded(
    'lesson_book',
    { subject: 'Math' },
    { id: 'lead', version: 4 },
  );
  assert.equal(sent, original);
  assert.equal(stored, null);
});

void test('definitive stale conflict clears the journal and never replays the stale command', async () => {
  let stored = null;
  const bodies = [];
  let stale = true;
  const journal = {
    read: () => stored,
    write: (value) => {
      stored = value;
    },
  };
  const send = createCommandClient(async (_url, options) => {
    bodies.push(options.body);
    if (stale) {
      return Response.json({ error: 'Запис уже змінено. Оновіть картку.' }, { status: 409 });
    }
    return Response.json({ id: 'lead' });
  }, journal);

  await assert.rejects(
    send('update', { note: 'stale' }, { id: 'lead', version: 7 }),
    /Запис уже змінено/,
  );
  assert.equal(stored, null);
  const staleCommandId = JSON.parse(bodies[0]).commandId;

  stale = false;
  await send('update', { note: 'fresh' }, { id: 'lead', version: 8 });
  assert.notEqual(JSON.parse(bodies[1]).commandId, staleCommandId);
  assert.equal(JSON.parse(bodies[1]).version, 8);
  assert.equal(stored, null);
});

void test('transient HTTP failures preserve the original command for an identical retry', async () => {
  for (const status of [408, 429, 503]) {
    let stored = null;
    const bodies = [];
    let transient = true;
    const journal = {
      read: () => stored,
      write: (value) => {
        stored = value;
      },
    };
    const send = createCommandClient(async (_url, options) => {
      bodies.push(options.body);
      if (transient) return Response.json({ error: `temporary ${status}` }, { status });
      return Response.json({ id: 'lead' });
    }, journal);
    const lead = { id: 'lead', version: 11 };

    await assert.rejects(send('lesson_book', { subject: 'Math' }, lead));
    assert.ok(stored, `status ${status} must keep the pending journal`);
    const original = stored.body;

    transient = false;
    await send('lesson_book', { subject: 'Math' }, lead);
    assert.equal(bodies[1], original, `status ${status} must retry the identical command body`);
    assert.equal(stored, null);
  }
});
