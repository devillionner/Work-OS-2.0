import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const historyDialog = readFileSync(
  new URL('../components/leads/history.tsx', import.meta.url),
  'utf8',
);

void test('lead history loading state is announced and cannot be dismissed mid-request', () => {
  assert.match(historyDialog, /<output aria-live="polite">Завантаження історії…<\/output>/);
  assert.match(historyDialog, /<Button variant="outline" onClick=\{onClose\} disabled=\{busy\}>Закрити<\/Button>/);
  assert.match(historyDialog, /showCloseButton=\{!busy\}/);
  assert.match(historyDialog, /if \(!next && !busy\) onClose\(\)/);
});
