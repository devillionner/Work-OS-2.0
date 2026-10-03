import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { localDatabase } from './helpers/local-d1.mjs';

// D1 bills rows read, so a query that walks a whole table is paid again on every call. Every static
// SELECT/UPDATE in lib/ and app/api/ is planned against the real schema and must use an index.
// INSERT/DELETE plans are skipped: their SCAN lines are foreign-key checks that run only on parent deletes.
// Queries with ${…} are not planned here; tests/d1-poll-budget.test.mjs measures the polled ones.
const ROOTS = ['lib', 'app/api'];

function sourceFiles(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, files);
    else if (/\.(ts|tsx|mjs)$/.test(name)) files.push(path);
  }
  return files;
}

void test('static SELECT/UPDATE queries never scan a whole table', async (t) => {
  const db = await localDatabase(t);
  const offenders = [];
  let planned = 0;
  for (const file of ROOTS.flatMap(root => sourceFiles(root))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/prepare\(\s*`([^`]*)`/g)) {
      const sql = match[1];
      if (sql.includes('${') || !/^\s*(SELECT|WITH|UPDATE)/i.test(sql) || /^\s*WITH[\s\S]*\bINSERT\s+INTO\b/i.test(sql)) continue;
      const numbered = [...sql.matchAll(/\?(\d+)/g)].map(item => Number(item[1]));
      const params = numbered.length ? Math.max(...numbered) : (sql.match(/\?/g) || []).length;
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...Array(params).fill(null)).all();
      planned += 1;
      const scans = plan.results.map(row => row.detail)
        // CTE/subquery results and json_each lists are small derived sets, not stored tables.
        .filter(detail => /^SCAN \w+$/.test(detail) && !/^SCAN (j|item|json_each|co|b|guard)$/.test(detail));
      if (scans.length) offenders.push(`${file}:${source.slice(0, match.index).split('\n').length} ${scans.join('; ')}`);
    }
  }
  assert.ok(planned > 150, `only ${planned} queries were planned; the extractor must keep finding them`);
  assert.deepEqual(offenders, []);
});

// Both patterns below caused real staging incidents (2026-10-02, docs/TODO.md): a `json_each` list
// joined to a table without CROSS JOIN let SQLite choose to scan the table once per list item instead
// of driving the search from the small list, and a bare COUNT(*)/SUM over `chats` re-read the whole
// owner's chat table on every dashboard open instead of using the chat_queue_counts read model.
void test('json_each is never joined to a table without CROSS JOIN', () => {
  const offenders = [];
  for (const file of ROOTS.flatMap(root => sourceFiles(root))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/prepare\(\s*`([^`]*)`/g)) {
      const sql = match[1];
      // A JOIN directly after a json_each(...) alias (no CROSS in between) risks SQLite scanning the
      // joined table once per list item instead of driving the search from the small json_each list.
      if (/json_each\([^()]*\)\s+(?:\w+\s+)?JOIN\b/i.test(sql)) {
        offenders.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'use `json_each(...) alias CROSS JOIN table` so the list drives the index lookup');
});

void test('chats is never aggregated with a bare COUNT(*)/SUM instead of the chat_queue_counts read model', () => {
  const offenders = [];
  for (const file of ROOTS.flatMap(root => sourceFiles(root))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/prepare\(\s*`([^`]*)`/g)) {
      const sql = match[1];
      // A GROUP BY breakdown (e.g. archive reasons in a date range) is a different, index-planned
      // question that chat_queue_counts cannot answer; only the ungrouped owner-wide grand total —
      // the dashboard regression this guards against — must go through the read model instead.
      if (/\bFROM\s+chats\b/i.test(sql) && /\b(COUNT\(\*\)|SUM\()/i.test(sql) && !/\bGROUP BY\b/i.test(sql)) {
        offenders.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'read chat totals from chat_queue_counts (migration 0039), not a bare COUNT(*)/SUM over chats');
});
