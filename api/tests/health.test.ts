import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createApp } from '../src/http/app.js';

let server: Server;
let baseUrl: string;
before(async () => {
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

test('health returns status and propagates request ID', async () => {
  const response = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': 'test-request-42' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'test-request-42');
  assert.deepEqual(await response.json(), { status: 'ok', requestId: 'test-request-42' });
});

test('invalid request ID is replaced; not found uses RFC 7807', async () => {
  const response = await fetch(`${baseUrl}/missing`, { headers: { 'x-request-id': 'invalid value' } });
  const body = await response.json() as { status: number; title: string; requestId: string };
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);
  assert.equal(body.status, 404);
  assert.equal(body.title, 'Not Found');
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
});
