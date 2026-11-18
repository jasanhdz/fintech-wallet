import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { ApiError } from '../src/api.js';
import { BENEFICIARY_MESSAGES, beneficiarySaveFailure, clabeDigits, filterBeneficiaries, validateBeneficiary } from '../src/beneficiary-form.js';
import { BeneficiariesPage, NewBeneficiaryPage } from '../src/beneficiaries.js';
import { SessionProvider } from '../src/session.js';

/** Synthetic CLABE with a valid control digit (weights 3-7-1), built in the test. */
function clabeFrom(prefix17: string) {
  const sum = [...prefix17].reduce((total, digit, index) => total + ((Number(digit) * [3, 7, 1][index % 3]!) % 10), 0);
  return `${prefix17}${(10 - (sum % 10)) % 10}`;
}
const valid = clabeFrom('64618000000000953');
const wrongDigit = `${valid.slice(0, 17)}${(Number(valid[17]) + 1) % 10}`;
const problem = (status: number, detail = 'detalle') => new ApiError({ type: 'about:blank', title: 'Error', status, detail, instance: '/v1/beneficiaries', requestId: `req-${status}` });

test('W07-F1: empty fields and a wrong control digit are rejected in the client with the approved copy', () => {
  const empty = validateBeneficiary({ name: '  ', alias: '', clabe: '' });
  assert.equal(empty.kind, 'invalid');
  assert.deepEqual(empty.kind === 'invalid' && empty.errors, { name: BENEFICIARY_MESSAGES.name, alias: BENEFICIARY_MESSAGES.alias, clabe: BENEFICIARY_MESSAGES.clabeLength });
  const short = validateBeneficiary({ name: 'Persona', alias: 'P', clabe: '71096900' });
  assert.deepEqual(short.kind === 'invalid' && short.errors, { clabe: BENEFICIARY_MESSAGES.clabeLength });
  const checksum = validateBeneficiary({ name: 'Persona', alias: 'P', clabe: wrongDigit });
  assert.equal(checksum.kind, 'clabe-checksum');
  assert.deepEqual(checksum.kind === 'clabe-checksum' && checksum.errors, { clabe: BENEFICIARY_MESSAGES.clabeChecksum });
  const mixed = validateBeneficiary({ name: '', alias: 'P', clabe: wrongDigit });
  assert.equal(mixed.kind, 'invalid', 'a checksum error plus another field is the generic invalid state with N errors');
  assert.deepEqual(validateBeneficiary({ name: ' Persona Prueba ', alias: ' Prueba ', clabe: valid }), { kind: 'valid', body: { name: 'Persona Prueba', alias: 'Prueba', clabe: valid } });
  assert.equal(clabeDigits('646 180-000 0000 0095 3999'), '646180000000000953');
});

test('W07: POST /beneficiaries failures map to the contract statuses (409, 404, 422, 400, 401, 403, 5xx, network)', () => {
  assert.deepEqual(beneficiarySaveFailure(problem(409)), { kind: 'duplicate' });
  assert.deepEqual(beneficiarySaveFailure(problem(404)), { kind: 'not-found' });
  assert.deepEqual(beneficiarySaveFailure(problem(422)), { kind: 'clabe-checksum', errors: { clabe: BENEFICIARY_MESSAGES.clabeChecksum } });
  assert.deepEqual(beneficiarySaveFailure(problem(400, 'Datos de beneficiario inválidos.')), { kind: 'invalid', errors: {}, detail: 'Datos de beneficiario inválidos.' });
  assert.deepEqual(beneficiarySaveFailure(new ApiError({ type: 'about:blank', title: 'Bad Request', status: 400, instance: '/v1/beneficiaries', requestId: 'r', errors: [{ pointer: '/alias', detail: 'Alias inválido.' }] })), { kind: 'invalid', errors: { alias: 'Alias inválido.' } });
  assert.deepEqual(beneficiarySaveFailure(problem(401)), { kind: 'session' });
  assert.deepEqual(beneficiarySaveFailure(problem(403)), { kind: 'forbidden' });
  assert.deepEqual(beneficiarySaveFailure(problem(503)), { kind: 'recoverable' });
  assert.deepEqual(beneficiarySaveFailure(problem(429)), { kind: 'recoverable' });
  assert.deepEqual(beneficiarySaveFailure(new Error('No fue posible conectar.')), { kind: 'recoverable' });
});

test('W06-F1: local search by name, alias (accent and case insensitive) or the last four digits only', () => {
  const items = [
    { id: '1', name: 'Persona Prueba Dos', alias: 'Doña Prueba', clabeMasked: '646•••••••••••1234' },
    { id: '2', name: 'Otra Persona', alias: 'Oficina', clabeMasked: '646•••••••••••9876' },
  ];
  assert.deepEqual(filterBeneficiaries(items, 'dona').map((item) => item.id), ['1']);
  assert.deepEqual(filterBeneficiaries(items, 'OTRA').map((item) => item.id), ['2']);
  assert.deepEqual(filterBeneficiaries(items, '9876').map((item) => item.id), ['2']);
  assert.deepEqual(filterBeneficiaries(items, '646').map((item) => item.id), [], 'the bank prefix is not searchable, only the last four digits');
  assert.deepEqual(filterBeneficiaries(items, '  ').map((item) => item.id), ['1', '2']);
  assert.deepEqual(filterBeneficiaries(items, 'zzz'), []);
});

function setup(paths: string[], respond: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const dom = new JSDOM('<!doctype html><html lang="es"><body></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; path: string; body?: string }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? 'GET', path: url.pathname, body: init?.body ? String(init.body) : undefined });
    if (url.pathname.endsWith('/auth/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 });
    if (url.pathname.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'access', user: { id: 'user', email: 'test@example.test', fullName: 'Persona Prueba' } }), { status: 200 });
    if (url.pathname.endsWith('/accounts') || url.pathname.endsWith('/transfer-policy')) return new Response(JSON.stringify(url.pathname.endsWith('/accounts') ? { items: [] } : {}), { status: 200 });
    return respond(url, init);
  }) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = createElement(QueryClientProvider, { client }, createElement(SessionProvider, null,
    createElement(MemoryRouter, { initialEntries: paths }, createElement(Routes, null,
      createElement(Route, { path: '/beneficiaries', element: createElement(BeneficiariesPage) }),
      createElement(Route, { path: '/beneficiaries/new', element: createElement(NewBeneficiaryPage) })))));
  return { dom, calls, client, tree, restore: () => { client.clear(); dom.window.close(); globalThis.fetch = originalFetch; } };
}

test('W07: empty submit marks every field (aria-invalid + aria-describedby), focuses the first one and sends nothing', async () => {
  const env = setup(['/beneficiaries/new'], () => new Response('{}', { status: 500 }));
  const { cleanup, render, fireEvent } = await import('@testing-library/react');
  try {
    const screen = render(env.tree);
    const save = await screen.findByRole('button', { name: 'Guardar beneficiario' });
    fireEvent.click(save);
    await screen.findByText('Revisa los 3 campos señalados antes de continuar'); // UX-T2: summary title carries the count
    for (const [label, message] of [['Nombre completo o razón social', BENEFICIARY_MESSAGES.name], ['Alias o nombre corto', BENEFICIARY_MESSAGES.alias], ['CLABE de 18 dígitos', BENEFICIARY_MESSAGES.clabeLength]] as const) {
      const input = screen.getByLabelText(label);
      assert.equal(input.getAttribute('aria-invalid'), 'true');
      const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      assert.ok(described.includes(message), `${label} is described by its error`);
    }
    assert.equal(document.activeElement, screen.getByLabelText('Nombre completo o razón social'));
    assert.equal(document.querySelectorAll('#bn-summary .form-summary-link').length, 3); // FM-05: one button per invalid field
    assert.ok(!env.calls.some((call) => call.method === 'POST' && call.path.endsWith('/beneficiaries')), 'no POST /beneficiaries');
  } finally { cleanup(); env.restore(); }
});

test('W07: 503 keeps the values and «Reintentar guardar» resends exactly the same body; 409 offers «Modificar datos»', async () => {
  const replies = [503, 409];
  const env = setup(['/beneficiaries/new'], (url, init) => {
    if (url.pathname.endsWith('/beneficiaries') && init?.method === 'POST') {
      const status = replies.shift() ?? 500;
      return new Response(JSON.stringify({ type: 'about:blank', title: 'Error', status, detail: 'x', requestId: 'r' }), { status });
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  const { cleanup, render, fireEvent } = await import('@testing-library/react');
  try {
    const screen = render(env.tree);
    fireEvent.change(await screen.findByLabelText('Nombre completo o razón social'), { target: { value: 'Persona Prueba Tres' } });
    fireEvent.change(screen.getByLabelText('Alias o nombre corto'), { target: { value: 'Tres' } });
    fireEvent.change(screen.getByLabelText('CLABE de 18 dígitos'), { target: { value: valid } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar beneficiario' }));
    await screen.findByText('No pudimos guardar al beneficiario en este momento');
    assert.equal((screen.getByLabelText('CLABE de 18 dígitos') as HTMLInputElement).value, valid, 'values are kept');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar guardar' }));
    await screen.findByText('Beneficiario duplicado');
    const posts = env.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/beneficiaries'));
    assert.equal(posts.length, 2);
    assert.equal(posts[1]!.body, posts[0]!.body, 'retry resends the same values');
    assert.deepEqual(JSON.parse(posts[0]!.body!), { name: 'Persona Prueba Tres', alias: 'Tres', clabe: valid });
    assert.equal((screen.getByLabelText('CLABE de 18 dígitos') as HTMLInputElement).readOnly, true);
    assert.equal(screen.getByRole('link', { name: 'Ver en directorio' }).getAttribute('href'), '/beneficiaries');
    fireEvent.click(screen.getByRole('button', { name: 'Modificar datos' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(document.activeElement, screen.getByLabelText('CLABE de 18 dígitos'));
    assert.equal((screen.getByLabelText('CLABE de 18 dígitos') as HTMLInputElement).readOnly, false);
  } finally { cleanup(); env.restore(); }
});
