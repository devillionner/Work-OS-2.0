import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  normalizeGeneratedWranglerConfig,
  normalizeGeneratedWranglerFile,
} from '../scripts/normalize-wrangler-config.mjs';

void test('generated Wrangler config drops only obsolete legacy_env', () => {
  const normalized = normalizeGeneratedWranglerConfig({
    name: 'work-os-2-staging',
    legacy_env: true,
    compatibility_date: '2026-09-02',
    d1_databases: [{ binding: 'DB' }],
  });
  assert.equal('legacy_env' in normalized, false);
  assert.equal(normalized.name, 'work-os-2-staging');
  assert.equal(normalized.compatibility_date, '2026-09-02');
  assert.deepEqual(normalized.d1_databases, [{ binding: 'DB' }]);
});

void test("generated Wrangler file is normalized once and then stays stable", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "work-os-wrangler-"));
  const file = path.join(directory, "wrangler.json");
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });

  await writeFile(file, JSON.stringify({
    name: "work-os-2-staging",
    legacy_env: true,
    vars: { GOOGLE_CLIENT_ID: "test-client" },
  }), "utf8");

  assert.equal(await normalizeGeneratedWranglerFile(file), true);
  const parsed = JSON.parse(await readFile(file, "utf8"));
  assert.equal("legacy_env" in parsed, false);
  assert.equal(parsed.name, "work-os-2-staging");
  assert.deepEqual(parsed.vars, { GOOGLE_CLIENT_ID: "test-client" });
  assert.equal(await normalizeGeneratedWranglerFile(file), false);
});
