import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildLegacyMigrationDataset } from '../lib/legacy-migration.ts';

void test('legacy migration maps lead subject into the domain row', () => {
  const lead = {
    id: 'lead-subject-1',
    name: 'Test lead',
    subject: 'Англійська мова',
    platform: 'whatsapp',
    createdAt: 1_788_795_292_407,
    createdDate: '07.09.26',
  };
  const dataset = buildLegacyMigrationDataset(JSON.stringify({
    storage: { 'shared-leads-v1': JSON.stringify([lead]) },
  }), 'lead-subject-test-user');

  assert.equal(dataset.leads.length, 1);
  assert.equal(dataset.leads[0].subject, 'Англійська мова');
});

void test('legacy lead upsert persists and refreshes the subject column', () => {
  const route = readFileSync(new URL('../app/api/imports/legacy/migrate/route.ts', import.meta.url), 'utf8');
  assert.match(route, /platform,subject,source_chat_id/);
  assert.match(route, /subject=excluded\.subject/);
  assert.match(route, /row\.platform,row\.subject,row\.sourceChatId/);
});
