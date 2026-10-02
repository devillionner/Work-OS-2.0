import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

void test('LEAD-23 exposes bounded media upload, preview/download and delete controls', () => {
  const conversation = source('components/leads/conversation.tsx');
  const route = source('app/api/leads/attachments/route.ts');
  const domain = source('lib/leads/attachments.ts');
  const workspace = source('components/leads/workspace.tsx');
  const css = source('app/globals.css');

  assert.match(conversation, /type="file"/);
  assert.match(conversation, /multiple/);
  assert.match(conversation, /accept="image\/jpeg,image\/png,image\/webp,image\/gif,image\/bmp,image\/heic,image\/heif,audio\/\*,video\/\*,application\/pdf/);
  assert.match(conversation, /fetch\('\/api\/leads\/attachments'/);
  assert.match(conversation, /method: 'POST'/);
  assert.match(conversation, /method: 'DELETE'/);
  assert.match(conversation, /Прикріпити файл/);
  assert.match(conversation, /lead-attachment-preview/);
  assert.match(conversation, /Видалити файл/);
  // The conversation keeps its draft/scroll state across lead mutations, so it is not re-keyed by version.
  assert.match(workspace, /<Conversation detail=\{current\} mutate=\{mutate\} onChanged=\{reload\}/);
  assert.doesNotMatch(workspace, /<Conversation key=\{current\.lead\.version\}/);
  assert.match(css, /\.lead-attachments/);

  assert.match(route, /createLeadAttachment/);
  assert.match(route, /readLeadAttachment/);
  assert.match(route, /deleteLeadAttachment/);
  assert.match(route, /Cache-Control': 'private, no-store'/);
  assert.match(route, /X-Content-Type-Options': 'nosniff'/);
  assert.match(route, /assertSameOrigin\(request\)/);

  assert.match(domain, /MAX_LEAD_ATTACHMENT_BYTES = 10 \* 1024 \* 1024/);
  assert.match(domain, /LEAD_ATTACHMENT_CHUNK_BYTES = 240_000/);
  assert.match(domain, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(domain, /lead_write_guards/);
  assert.match(domain, /image\/svg\+xml/);
  assert.match(domain, /text\/html/);
});
