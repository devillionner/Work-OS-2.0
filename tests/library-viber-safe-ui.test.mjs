import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

void test('Library exposes Viber safe-note only as a non-publication My Notes flow',async()=>{
  const source=await readFile(new URL('../components/library-workspace.tsx',import.meta.url),'utf8');
  assert.match(source,/Viber safe-mode · «Мої нотатки»/);
  assert.match(source,/action:'viber-safe-note'/);
  assert.match(source,/action:'cancel-viber-safe-note'/);
  assert.match(source,/не створює publication fact/);
  assert.match(source,/Реальні Viber-чати тут недоступні/);
  assert.match(source,/cleanLibraryPlatforms\(selected\.platforms\)\.includes\('viber'\)/);
  assert.match(source,/fetch\('\/api\/messenger-automation',\{cache:'no-store'\}\)/);
});
