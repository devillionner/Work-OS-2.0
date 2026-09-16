import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const appMeta = readFileSync(join(root, 'lib', 'app-meta.ts'), 'utf8');
const releaseDialog = readFileSync(join(root, 'components', 'app-release-dialog.tsx'), 'utf8');

void test('release notes stay short and understandable for people', () => {
  const block = appMeta.match(/export const APP_CHANGES = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'APP_CHANGES must stay a simple string list');
  const changes = [...block[1].matchAll(/'([^'\n]+)'/g)].map((match) => match[1]);
  assert.ok(changes.length >= 1 && changes.length <= 6, 'Keep the release dialog focused on at most six important changes');

  const technicalJargon = /(?:\b(?:D1|SQL|API|SHA|commit|staging|Cloudflare|Miniflare|revision|payload|baseline|backfill|legacy|migration)\b|коміт|стейджинг|ревіз|міграц|бекфіл|легасі|owner[- ]?scope)/i;
  for (const change of changes) {
    assert.ok(change.length <= 150, `Release note is too long: ${change}`);
    assert.ok(/[.!?]$/.test(change), `Release note should read as a complete sentence: ${change}`);
    assert.ok((change.match(/[.!?]/g) || []).length <= 2, `Release note has too many sentences: ${change}`);
    assert.doesNotMatch(change, /;/, 'Prefer short sentences over semicolon-heavy release notes');
    assert.doesNotMatch(change, technicalJargon, `Technical implementation detail leaked into release copy: ${change}`);
  }
});

void test('release dialog introduces changes in plain language', () => {
  assert.match(releaseDialog, /Коротко про те, що стало зручніше в цій версії\./);
  assert.doesNotMatch(releaseDialog, /Короткі нотатки поточного релізу/);
});
