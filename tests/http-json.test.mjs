import assert from 'node:assert/strict';
import test from 'node:test';
import { readJsonObject, sameOrigin } from '../lib/http-json.ts';

function request(body, headers = {}) {
  return new Request('https://work-os.example/api/test', {
    method: 'POST',
    body,
    headers: { origin: 'https://work-os.example', ...headers },
  });
}

test('bounded JSON helper accepts objects and charset content type', async () => {
  const result = await readJsonObject(request('{"action":"save"}', { 'content-type': 'application/json; charset=utf-8' }), 1024);
  assert.equal(result instanceof Response, false);
  assert.deepEqual(result, { action: 'save' });
});

test('bounded JSON helper rejects wrong media type, arrays, malformed and oversized bodies', async () => {
  const wrongType = await readJsonObject(request('{}', { 'content-type': 'text/plain' }), 1024);
  assert.equal(wrongType instanceof Response && wrongType.status, 415);

  const array = await readJsonObject(request('[]', { 'content-type': 'application/json' }), 1024);
  assert.equal(array instanceof Response && array.status, 400);

  const malformed = await readJsonObject(request('{', { 'content-type': 'application/json' }), 1024);
  assert.equal(malformed instanceof Response && malformed.status, 400);

  const oversized = await readJsonObject(request(JSON.stringify({ value: 'x'.repeat(64) }), { 'content-type': 'application/json' }), 32);
  assert.equal(oversized instanceof Response && oversized.status, 413);

  const declared = await readJsonObject(request('{}', { 'content-type': 'application/json', 'content-length': '2048' }), 1024);
  assert.equal(declared instanceof Response && declared.status, 413);
});

test('same-origin helper requires the exact request origin', () => {
  assert.equal(sameOrigin(request('{}', { 'content-type': 'application/json' })), true);
  assert.equal(sameOrigin(new Request('https://work-os.example/api/test', { method: 'POST', headers: { origin: 'https://evil.example' } })), false);
  assert.equal(sameOrigin(new Request('https://work-os.example/api/test', { method: 'POST' })), false);
});
