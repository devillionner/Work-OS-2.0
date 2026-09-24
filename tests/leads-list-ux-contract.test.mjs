import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../components/leads/workspace.tsx', import.meta.url), 'utf8');
const listDomain = await readFile(new URL('../lib/leads/data/list.ts', import.meta.url), 'utf8');
const searchAliases = await readFile(new URL('../lib/leads/data/search.ts', import.meta.url), 'utf8');

test('CRM list keeps compact response, curator and needs-details filters', () => {
  for (const contract of [
    "['responses', 'Усі відгуки']",
    "['curator', 'У куратора']",
    "['needs-details', 'Потрібно уточнити']",
    "view: LeadListView",
    "if (options.view === 'responses')",
    "if (options.view === 'curator')",
    "if (options.view === 'needs-details')",
  ]) assert.match(workspace + listDomain, new RegExp(escapeRegExp(contract)));
});

test('CRM search covers operator-facing fields and state aliases', () => {
  for (const field of [
    'l.name',
    'l.subject',
    'l.note',
    'l.teacher_name',
    'l.next_action',
    'l.telegram_username',
    'l.platform',
    'l.source_chat_link',
    'l.status',
    'l.funnel_stage',
    'x.teacher_name',
    'x.student_name',
    's.name',
  ]) assert.ok(listDomain.includes(field), `missing searchable field: ${field}`);

  for (const alias of ['response', 'clarification', 'booked', 'reminder', 'lesson', 'result', 'curator'])
    assert.ok(searchAliases.includes(alias), `missing state alias: ${alias}`);
});

test('CRM keyboard and reset affordances remain available without remount navigation', () => {
  assert.match(workspace, /event\.key === '\/'/);
  assert.match(workspace, /event\.key === 'Escape' && search/);
  assert.match(workspace, /searchInput\.current\?\.focus\(\)/);
  assert.match(workspace, /Скинути фільтри/);
  assert.match(workspace, /onClick=\{resetListControls\}/);
  assert.doesNotMatch(workspace, /router\.refresh\(/);
  assert.doesNotMatch(workspace, /key=\{syncRevision\}/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
