import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { request, refreshSession, setAccessToken, setCsrfToken, setSessionExpiredHandler } from '../src/api.js';
import { SessionProvider, useSession } from '../src/session.js';

const user = { id: 'user-1', email: 'person@example.test', fullName: 'Test User' };
const auth = (accessToken: string) => ({ accessToken, user });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number) => new Response(JSON.stringify({ type: 'about:blank', title: 'Unauthorized', status, requestId: 'req-1' }), { status });
const csrf = () => ok({ csrfToken: 'csrf-test' });

let testDom: JSDOM | undefined;
function installDom() {
  if (!testDom) {
    testDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
    Object.assign(globalThis, { window: testDom.window, document: testDom.window.document, HTMLElement: testDom.window.HTMLElement });
  }
}

function SessionView() {
  const { hydrated, session } = useSession();
  return createElement('div', null, hydrated ? (session?.user.fullName || 'login') : 'loading');
}

test('hydrates a web session through CSRF and cookie refresh', async () => {
  const calls: Array<[string, RequestInit]> = [];
  globalThis.fetch = (async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    calls.push([path, init]);
    return path.endsWith('/auth/csrf') ? csrf() : ok(auth('fresh-access'));
  }) as typeof fetch;
  const session = await refreshSession();
  assert.equal(session?.accessToken, 'fresh-access');
  const refreshCall = calls[1]!;
  assert.deepEqual(JSON.parse(String(refreshCall[1].body)), { client: 'web' });
  assert.equal(refreshCall[1].credentials, 'include');
});

test('204 without a refresh cookie hydrates to login without logging an error', async () => {
  installDom();
  const { cleanup, render, screen } = await import('@testing-library/react');
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  globalThis.fetch = (async (input) => new URL(String(input)).pathname.endsWith('/auth/csrf') ? csrf() : new Response(null, { status: 204 })) as typeof fetch;
  render(createElement(SessionProvider, null, createElement(SessionView)));
  await screen.findByText('login');
  assert.deepEqual(errors, []);
  cleanup(); console.error = originalError;
});

test('provider hydrates a cookie session into in-memory context', async () => {
  installDom();
  const { cleanup, render, screen } = await import('@testing-library/react');
  globalThis.fetch = (async (input) => new URL(String(input)).pathname.endsWith('/auth/csrf') ? csrf() : ok(auth('cookie-access'))) as typeof fetch;
  render(createElement(SessionProvider, null, createElement(SessionView)));
  await screen.findByText('Test User');
  cleanup();
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

test('concurrent 401 responses share a single refresh and retry only once each', async () => {
  setAccessToken('parallel-expired');
  let refreshes = 0;
  const attempts = new Map<string, number>();
  globalThis.fetch = (async (input, init = {}) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/csrf')) return csrf();
    if (path.endsWith('/auth/refresh')) { refreshes += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return ok(auth('parallel-fresh')); }
    const attempt = (attempts.get(path) || 0) + 1;
    attempts.set(path, attempt);
    if (attempt === 1) return problem(401);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer parallel-fresh');
    return ok({ path });
  }) as typeof fetch;
  await Promise.all([request('/accounts'), request('/auth/me')]);
  assert.equal(refreshes, 1);
  assert.deepEqual([...attempts.values()], [2, 2]);
  setAccessToken(undefined);
  setSessionExpiredHandler(undefined);
});

test('logout sends the current in-memory access token, CSRF token, and cookie credentials', async () => {
  const calls: RequestInit[] = [];
  setAccessToken('logout-access');
  setCsrfToken('logout-csrf');
  globalThis.fetch = (async (_input, init = {}) => {
    calls.push(init);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  await request<void>('/auth/logout', { method: 'POST' });
  const call = calls[0]!;
  assert.equal(new Headers(call.headers).get('Authorization'), 'Bearer logout-access');
  assert.equal(new Headers(call.headers).get('X-CSRF-Token'), 'logout-csrf');
  assert.equal(call.credentials, 'include');
  setAccessToken(undefined);
  setSessionExpiredHandler(undefined);
});
