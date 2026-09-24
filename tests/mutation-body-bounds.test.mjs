import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function routeFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.isFile() && entry.name === 'route.ts' ? [path] : [];
  });
}

void test('mutation routes do not bypass bounded body readers', () => {
  const violations = [];
  for (const path of routeFiles(fileURLToPath(new URL('../app/api', import.meta.url)))) {
    const source = readFileSync(path, 'utf8');
    if (!/export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source)) continue;
    for (const call of ['text', 'json', 'arrayBuffer', 'formData']) {
      if (source.includes(`request.${call}()`)) violations.push(`${path}: request.${call}()`);
    }
  }
  assert.deepEqual(violations, []);
});
