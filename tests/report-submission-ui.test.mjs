import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/reports-workspace.tsx', import.meta.url), 'utf8');

void test('reports editor exposes the last final submission time without replacing last-change metadata', () => {
  assert.match(source,/Остання зміна:/);
  assert.match(source,/Остання фінальна здача:/);
  assert.match(source,/(data|editorData)\??\.selected\??\.submittedAt/);
  assert.match(source,/ще не здано/);
});
