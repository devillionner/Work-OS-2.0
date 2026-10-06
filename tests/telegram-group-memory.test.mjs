import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BARREN_RESCAN_MS,
  MAX_REVISIT_GROUPS,
  PRODUCTIVE_RESCAN_MS,
  SCAN_MEMORY_RETENTION_MS,
  groupRescanDueAt,
  isGroupScanDue,
  parseScanMemory,
  productiveGroupsDue,
  rememberScannedGroups,
} from '../scripts/telegram-group-memory.mjs';

// Operator goal 2026-10-06: the autonomous run has to find chats EVERY day, not sweep once and go quiet for a
// week. Measured on the runner's own log, only 101 of 865 scanned Telegram groups ever held a WhatsApp
// invite — those are the ones worth reopening daily; the rest keep the week-long cooldown.

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);

void test('a group that posted invites comes back after a day, a barren one after a week', () => {
  assert.equal(groupRescanDueAt({ at: NOW, invites: 3 }), NOW + PRODUCTIVE_RESCAN_MS);
  assert.equal(groupRescanDueAt({ at: NOW, invites: 0 }), NOW + BARREN_RESCAN_MS);

  const memory = rememberScannedGroups({}, [{ username: 'Productive', invites: 2 }, { username: 'barren', invites: 0 }], NOW);
  const dayLater = NOW + PRODUCTIVE_RESCAN_MS + 1;
  assert.equal(isGroupScanDue(memory, 'productive', NOW + 1), false, 'nothing is rescanned in the same hour');
  assert.equal(isGroupScanDue(memory, 'PRODUCTIVE', dayLater), true, 'invite sources return the next day');
  assert.equal(isGroupScanDue(memory, 'barren', dayLater), false, 'a group without invites keeps the week');
  assert.equal(isGroupScanDue(memory, 'barren', NOW + BARREN_RESCAN_MS + 1), true);
  assert.equal(isGroupScanDue(memory, 'never-seen', NOW), true);
});

void test('a group that stops posting falls back to the week-long cooldown by itself', () => {
  let memory = rememberScannedGroups({}, [{ username: 'fading', invites: 4 }], NOW);
  const nextDay = NOW + PRODUCTIVE_RESCAN_MS + 1;
  assert.deepEqual(productiveGroupsDue(memory, nextDay), ['fading']);
  // The revisit found nothing this time: the next scan is a week out, not another day.
  memory = rememberScannedGroups(memory, [{ username: 'fading', invites: 0 }], nextDay);
  assert.deepEqual(productiveGroupsDue(memory, nextDay + PRODUCTIVE_RESCAN_MS + 1), []);
  assert.equal(isGroupScanDue(memory, 'fading', nextDay + BARREN_RESCAN_MS + 1), true);
});

void test('the daily revisit list is oldest first and bounded, so a run has a known cost', () => {
  let memory = {};
  for (let index = 0; index < MAX_REVISIT_GROUPS + 10; index += 1) {
    memory = rememberScannedGroups(memory, [{ username: `group${index}`, invites: 1 }], NOW - index * 60_000);
  }
  memory = rememberScannedGroups(memory, [{ username: 'quiet', invites: 0 }], NOW - 5 * 60_000);
  const due = productiveGroupsDue(memory, NOW + PRODUCTIVE_RESCAN_MS + 1);
  assert.equal(due.length, MAX_REVISIT_GROUPS);
  assert.ok(!due.includes('quiet'), 'a group without invites is never revisited daily');
  assert.equal(due[0], `group${MAX_REVISIT_GROUPS + 9}`, 'the longest unscanned group goes first');
});

void test('the pre-2026-10-06 file (a bare timestamp per group) still reads as a barren scan', () => {
  const memory = parseScanMemory({ Legacy: NOW, broken: 'x', nested: { at: NOW, invites: 7 }, skipped: null });
  assert.deepEqual(memory.legacy, { at: NOW, invites: 0 });
  assert.deepEqual(memory.nested, { at: NOW, invites: 7 });
  assert.ok(!('broken' in memory) && !('skipped' in memory));
  assert.equal(isGroupScanDue(memory, 'legacy', NOW + PRODUCTIVE_RESCAN_MS + 1), false, 'a legacy entry keeps the week');
});

void test('scan memory keeps a productive history far past the cooldown but drops what is long gone', () => {
  const stale = { ancient: { at: NOW - SCAN_MEMORY_RETENTION_MS - 1, invites: 9 }, lastWeek: { at: NOW - BARREN_RESCAN_MS - 1, invites: 1 } };
  const memory = rememberScannedGroups(stale, [{ username: 'fresh', invites: 0 }], NOW);
  assert.ok(!('ancient' in memory), 'a month-old scan is forgotten');
  assert.ok('lastWeek' in memory, 'an expired cooldown is not an expired record');
  assert.deepEqual(memory.fresh, { at: NOW, invites: 0 });
});
