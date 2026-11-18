import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request, refreshSession, setAccessToken, setSessionExpiredHandler } from '../src/api.js';

const user = { id: 'user-1', email: 'person@example.test', fullName: 'Test User' };
const auth = (accessToken: string) => ({ accessToken, user });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number) => new Response(JSON.stringify({ type: 'about:blank', title: 'Unauthorized', status, requestId: 'req-1' }), { status });
const csrf = () => ok({ csrfToken: 'csrf-test' });

test('hydrates a web session through CSRF and cookie refresh', async () => {
  const calls: Array<[string, RequestInit]> = [];
  globalThis.fetch = (async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    calls.push([path, init]);
    return path.endsWith('/auth/csrf') ? csrf() : ok(auth('fresh-access'));
  }) as typeof fetch;
  const session = await refreshSession();
  assert.equal(session.accessToken, 'fresh-access');
  const refreshCall = calls[1]!;
  assert.deepEqual(JSON.parse(String(refreshCall[1].body)), { client: 'web' });
  assert.equal(refreshCall[1].credentials, 'include');
});

test('revoked refresh rejects and network failure remains recoverable', async () => {
  globalThis.fetch = (async (input) => new URL(String(input)).pathname.endsWith('/auth/csrf') ? csrf() : problem(401)) as typeof fetch;
  await assert.rejects(refreshSession());
  globalThis.fetch = (async () => { throw new TypeError('offline'); }) as typeof fetch;
  await assert.rejects(refreshSession(), /No fue posible conectar/);
});

test('a 401 rotates once and retries the same request with the fresh access token', async () => {
  const paths: string[] = [];
  const authHeaders: string[] = [];
  setAccessToken('expired-access');
  globalThis.fetch = (async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith('/auth/csrf')) return csrf();
    if (path.endsWith('/auth/refresh')) return ok(auth('rotated-access'));
    authHeaders.push(new Headers(init.headers).get('Authorization') || '');
    return authHeaders.length === 1 ? problem(401) : ok({ items: [] });
  }) as typeof fetch;
  const result = await request<{ items: unknown[] }>('/accounts');
  assert.deepEqual(result, { items: [] });
  assert.deepEqual(authHeaders, ['Bearer expired-access', 'Bearer rotated-access']);
  assert.equal(paths.filter((path) => path.endsWith('/auth/refresh')).length, 1);
  assert.equal(paths.filter((path) => path.endsWith('/accounts')).length, 2);
  setSessionExpiredHandler(undefined);
  setAccessToken(undefined);
});
