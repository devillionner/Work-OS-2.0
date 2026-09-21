import assert from 'node:assert/strict';
import test from 'node:test';
import { readBoundedMultipartForm } from '../lib/http-form.ts';

function multipartRequest(size) {
  const form = new FormData();
  form.set('leadId', 'lead-1');
  form.set('file', new Blob([new Uint8Array(size)], { type: 'text/plain' }), 'note.txt');
  return new Request('http://localhost/upload', { method: 'POST', body: form });
}

void test('bounded multipart parser accepts a small form without Content-Length', async () => {
  const request = multipartRequest(32);
  assert.equal(request.headers.get('content-length'), null);
  const parsed = await readBoundedMultipartForm(request, 16 * 1024);
  assert.ok(parsed instanceof FormData);
  assert.equal(parsed.get('leadId'), 'lead-1');
  const file = parsed.get('file');
  assert.ok(file instanceof File);
  assert.equal(file.size, 32);
});

void test('bounded multipart parser rejects chunked bodies before form parsing', async () => {
  const request = multipartRequest(4096);
  assert.equal(request.headers.get('content-length'), null);
  const parsed = await readBoundedMultipartForm(request, 1024);
  assert.ok(parsed instanceof Response);
  assert.equal(parsed.status, 413);
  assert.match(await parsed.text(), /завеликий/);
});

void test('bounded multipart parser rejects the wrong media type', async () => {
  const parsed = await readBoundedMultipartForm(
    new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    1024,
  );
  assert.ok(parsed instanceof Response);
  assert.equal(parsed.status, 415);
});
