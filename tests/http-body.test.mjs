import assert from 'node:assert/strict';
import test from 'node:test';

import { readBoundedText } from '../lib/http-body.ts';

function streamRequest(parts, onCancel) {
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index >= parts.length) return controller.close();
      controller.enqueue(new TextEncoder().encode(parts[index++]));
    },
    cancel() {
      index = parts.length;
      onCancel?.();
    },
  });
  return new Request('https://work-os.example/api/test', {
    method: 'POST',
    body,
    duplex: 'half',
  });
}

void test('bounded text reads chunked bodies without Content-Length', async () => {
  const result = await readBoundedText(streamRequest(['hello ', 'world']), 32);
  assert.equal(result, 'hello world');
});
void test('bounded text stops an oversized chunked body with the requested 413 copy', async () => {
  let cancelled = false;
  const result = await readBoundedText(
    streamRequest(['12345678', 'abcdefgh'], () => { cancelled = true; }),
    10,
    'CSV завеликий.',
  );
  assert.ok(result instanceof Response);
  assert.equal(result.status, 413);
  assert.match(await result.text(), /CSV завеликий/);
  assert.equal(cancelled, true);
});

void test('bounded text validates its byte limit before reading', async () => {
  await assert.rejects(
    readBoundedText(streamRequest(['ok']), 0),
    /positive safe integer/,
  );
});
