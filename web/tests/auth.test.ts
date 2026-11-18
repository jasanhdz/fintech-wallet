import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import { ApiError, request, setAccessToken, setSessionExpiredHandler } from '../src/api.js';
import { SessionProvider, useSession } from '../src/session.js';
import { BAD_CREDENTIALS_MESSAGE, NETWORK_MESSAGE, RATE_LIMITED_MESSAGE, loginFailure, registerFailure, validateLogin, validateRegister } from '../src/auth-forms.js';

const problem = (status: number, detail: string) => new ApiError({ type: 'about:blank', title: 'Error', status, detail, instance: '/v1/test', requestId: `req-${status}` });

test('W01 login validation reports each empty or malformed field and builds the contract body', () => {
  assert.deepEqual(validateLogin({ email: '', password: '' }).errors, { email: 'Ingresa tu correo electrónico.', password: 'Ingresa tu contraseña.' });
  assert.deepEqual(validateLogin({ email: 'persona@', password: 'x' }).errors, { email: 'Ingresa un correo electrónico válido.' });
  const valid = validateLogin({ email: ' persona@example.test ', password: 'secreto' });
  assert.deepEqual(valid.errors, {});
  assert.deepEqual(valid.body, { email: 'persona@example.test', password: 'secreto', client: 'web' });
});

test('W02 register validation enforces ≥12 characters and a matching confirmation that is never sent', () => {
  const empty = validateRegister({ fullName: ' ', email: '', password: '', confirmPassword: '' });
  assert.deepEqual(Object.keys(empty.errors).sort(), ['confirmPassword', 'email', 'fullName', 'password']);
  assert.equal(validateRegister({ fullName: 'Persona', email: 'p@example.test', password: 'corta', confirmPassword: 'corta' }).errors.password, 'La contraseña debe tener al menos 12 caracteres.');
  const mismatch = validateRegister({ fullName: 'Persona', email: 'p@example.test', password: 'Sintetica-2026', confirmPassword: 'Sintetica-2027' });
  assert.deepEqual(mismatch.errors, { confirmPassword: 'Las contraseñas no coinciden.' });
  assert.equal(mismatch.body, undefined);
  const valid = validateRegister({ fullName: ' Persona Prueba ', email: 'p@example.test', password: 'Sintetica-2026', confirmPassword: 'Sintetica-2026' });
  assert.deepEqual(valid.body, { fullName: 'Persona Prueba', email: 'p@example.test', password: 'Sintetica-2026' });
  assert.deepEqual(Object.keys(valid.body!).sort(), ['email', 'fullName', 'password']);
});

test('W01-F3 maps 401, 429 and connectivity to distinct messages without echoing the server detail for 401', () => {
  assert.deepEqual(loginFailure(problem(401, 'Credenciales inválidas.')), { message: BAD_CREDENTIALS_MESSAGE, requestId: 'req-401' });
  assert.deepEqual(loginFailure(new Error('La sesión ya no está disponible. Inicia sesión de nuevo.')), { message: BAD_CREDENTIALS_MESSAGE });
  assert.deepEqual(loginFailure(problem(429, 'Intenta de nuevo más tarde.')), { message: RATE_LIMITED_MESSAGE, requestId: 'req-429' });
  assert.deepEqual(loginFailure(new Error(NETWORK_MESSAGE)), { message: NETWORK_MESSAGE });
  assert.notEqual(BAD_CREDENTIALS_MESSAGE, RATE_LIMITED_MESSAGE);
});

test('W02-F2 shows the 409 detail verbatim', () => {
  assert.deepEqual(registerFailure(problem(409, 'No fue posible crear la cuenta con esos datos.')), { message: 'No fue posible crear la cuenta con esos datos.', requestId: 'req-409' });
  assert.equal(registerFailure(new Error(NETWORK_MESSAGE)).message, NETWORK_MESSAGE);
});

let testDom: JSDOM | undefined;
function installDom() {
  if (!testDom) {
    testDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
    Object.assign(globalThis, { window: testDom.window, document: testDom.window.document, HTMLElement: testDom.window.HTMLElement, sessionStorage: testDom.window.sessionStorage });
  }
}

function ExpiredView() {
  const { hydrated, session, expired } = useSession();
  return createElement('div', null, hydrated ? `${session ? 'in' : 'out'}:${expired ? 'expired' : 'fresh'}` : 'loading');
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const user = { id: 'user-exp', email: 'person@example.test', fullName: 'Test User' };

test('W14-F2 an unrecoverable 401 marks the session expired and keeps the same-tab transfer record', async () => {
  installDom();
  const { act, cleanup, render, screen } = await import('@testing-library/react');
  let refreshes = 0;
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/csrf')) return json(200, { csrfToken: 'csrf' });
    if (path.endsWith('/auth/refresh')) { refreshes += 1; return refreshes === 1 ? json(200, { accessToken: 'first', user }) : new Response(null, { status: 204 }); }
    return json(401, { type: 'about:blank', title: 'Unauthorized', status: 401, requestId: 'req' });
  }) as typeof fetch;
  render(createElement(SessionProvider, null, createElement(ExpiredView)));
  await screen.findByText('in:fresh');
  const record = JSON.stringify({ key: 'synthetic-key', body: { destinationType: 'own_account', amountMinor: '100', concept: 'c', reference: '1' } });
  sessionStorage.setItem(`wallet:web:transfer-attempt:${user.id}`, record);
  await act(async () => { await assert.rejects(request('/accounts')); });
  await screen.findByText('out:expired');
  assert.equal(sessionStorage.getItem(`wallet:web:transfer-attempt:${user.id}`), record);
  cleanup(); setAccessToken(undefined); setSessionExpiredHandler(undefined); sessionStorage.clear();
});

test('a browser that never had a session is not marked expired', async () => {
  installDom();
  const { cleanup, render, screen } = await import('@testing-library/react');
  globalThis.fetch = (async (input) => new URL(String(input)).pathname.endsWith('/auth/csrf') ? json(200, { csrfToken: 'csrf' }) : new Response(null, { status: 204 })) as typeof fetch;
  render(createElement(SessionProvider, null, createElement(ExpiredView)));
  await screen.findByText('out:fresh');
  cleanup(); setSessionExpiredHandler(undefined);
});
