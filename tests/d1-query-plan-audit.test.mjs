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
