import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../components/leads/workspace.tsx', import.meta.url), 'utf8');

void test('Leads list exposes keyboard search and one-step filter reset', () => {
  assert.match(source, /const searchInput = useRef<HTMLInputElement>\(null\)/);
  assert.match(source, /event\.key === '\/'[\s\S]*searchInput\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === 'Escape' && search[\s\S]*setSearch\(''\)[\s\S]*setQuery\(''\)[\s\S]*setOffset\(0\)/);
  assert.match(source, /document\.querySelector\('\[data-slot="dialog-content"\]'\)/);
  assert.match(source, />Скинути фільтри<\/Button>/);
  assert.match(source, /setFilter\('active'\)[\s\S]*setSearch\(''\)[\s\S]*setQuery\(''\)[\s\S]*setOffset\(0\)/);
});
