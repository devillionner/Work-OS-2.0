import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../migrations/', import.meta.url);

void test('D1 migration SQL is LF-only for remote trigger parsing', () => {
  const migrations = readdirSync(migrationDirectory).filter((name) =>
    name.endsWith('.sql'),
  );
  assert.ok(migrations.length > 0);
  for (const migration of migrations) {
    const sql = readFileSync(new URL(migration, migrationDirectory), 'utf8');
    assert.equal(
      sql.includes('\r'),
      false,
      `${migration} contains CRLF/CR bytes; Cloudflare D1 remote trigger parsing requires LF`,
    );
  }
});
