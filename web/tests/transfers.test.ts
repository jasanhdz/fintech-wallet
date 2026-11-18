import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mxnInputSchema, parseMxnToMinor, transferCreateRequestSchema, transferConfirmRequestSchema } from '@fintech-wallet/shared';
import { requestTransfer } from '../src/api.js';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../src/session.js';
import { NewTransferPage } from '../src/transfers.js';
import { activateTransferUser, clearAllTransferDrafts, readTransferDraft, saveTransferDraft } from '../src/transfer-attempt.js';
import { JSDOM } from 'jsdom';

const sourceAccountId = '00000000-0000-4000-8000-000000000001';
const beneficiaryId = '00000000-0000-4000-8000-000000000002';

test('transfer form accepts only exact positive MXN values and preserves minor units as strings', () => {
  assert.equal(mxnInputSchema.safeParse('123456789012345.67').success, true);
  assert.equal(parseMxnToMinor('123456789012345.67'), '12345678901234567');
  assert.equal(mxnInputSchema.safeParse('1.001').success, false);
  assert.equal(mxnInputSchema.safeParse('0').success, false);
});

test('transfer variants and OTP follow shared OpenAPI validation', () => {
  assert.equal(transferCreateRequestSchema.safeParse({ sourceAccountId, destinationType: 'beneficiary', beneficiaryId, amountMinor: '1', concept: 'Pago', reference: '1234567' }).success, true);
  assert.equal(transferCreateRequestSchema.safeParse({ sourceAccountId, destinationType: 'own_account', destinationAccountId: sourceAccountId, amountMinor: '1', concept: 'Pago', reference: '1', extra: true }).success, false);
  assert.equal(transferConfirmRequestSchema.safeParse({ code: '123456' }).success, true);
  assert.equal(transferConfirmRequestSchema.safeParse({ code: '12345' }).success, false);
});

test('create retries forward identical payload and idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: 'transfer-id' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const key = 'attempt-key';
    const body = JSON.stringify({ sourceAccountId, destinationType: 'beneficiary', beneficiaryId, amountMinor: '2500', concept: 'Pago', reference: '42' });
    await requestTransfer('/transfers', key, { method: 'POST', body });
    await requestTransfer('/transfers', key, { method: 'POST', body });
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      assert.equal(headers.get('Idempotency-Key'), key);
      assert.equal(call.init?.body, body);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('transfer recovery is session-persisted, exact, and isolated when the user changes', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: dom.window.sessionStorage });
  const draft = { key: 'attempt-key', body: { sourceAccountId, destinationType: 'beneficiary', beneficiaryId, amountMinor: '2500', concept: 'Pago', reference: '42' }, transferId: 'transfer-id' };
  activateTransferUser('user-a');
  saveTransferDraft('user-a', { ...draft, demoOnlyCode: 'secret' } as typeof draft);
  assert.deepEqual(readTransferDraft('user-a'), draft);
  assert.equal(dom.window.sessionStorage.getItem('wallet:web:transfer-attempt:user-a')?.includes('secret'), false);
  assert.equal(readTransferDraft('user-b'), null);
  activateTransferUser('user-b');
  assert.equal(readTransferDraft('user-a'), null);
  clearAllTransferDrafts();
  dom.window.close();
});

test('transfer UI renders contract-backed destination choices with accessible labels', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/auth/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 });
    if (path.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'access', user: { id: 'user', email: 'test@example.test', fullName: 'Test Person' } }), { status: 200 });
    if (path.endsWith('/accounts')) return new Response(JSON.stringify({ items: [
      { id: sourceAccountId, name: 'Cuenta diaria', kind: 'checking', currency: 'MXN', availableBalanceMinor: '50000', clabe: '002010077777777771', clabeMasked: '••••7771' },
      { id: beneficiaryId, name: 'Ahorro', kind: 'savings', currency: 'MXN', availableBalanceMinor: '20000', clabe: '002010077777777771', clabeMasked: '••••7771' },
    ] }), { status: 200 });
    if (path.endsWith('/beneficiaries')) return new Response(JSON.stringify({ items: [{ id: '00000000-0000-4000-8000-000000000003', name: 'Ana López', alias: 'Renta', clabeMasked: '••••7771', destinationAccountId: beneficiaryId }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const { cleanup, render, screen, fireEvent } = await import('@testing-library/react');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client }, createElement(SessionProvider, null,
    createElement(MemoryRouter, { initialEntries: ['/transfers/new'] }, createElement(Routes, null,
      createElement(Route, { path: '/transfers/new', element: createElement(NewTransferPage) }))))));
  // WF-T4 (W08 redesign): the selects became labelled radio groups (D-8); the same choices stay accessible.
  await screen.findByRole('heading', { name: 'Transferir dinero' });
  assert.ok(screen.getByRole('group', { name: 'Cuenta de origen' }));
  const recipients = screen.getByRole('radiogroup', { name: 'Destinatario' });
  assert.ok(recipients);
  // UX-T2 (D-UX-6): the two source accounts are an inline radio group; the recipient list has one beneficiary.
  assert.equal(screen.getByRole('radiogroup', { name: 'Cuenta de origen' }).querySelectorAll('[role="radio"]').length, 2);
  assert.equal(recipients.querySelectorAll('[role="radio"]').length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Entre mis cuentas' }));
  const destinations = screen.getByRole('radiogroup', { name: 'Cuenta de destino' });
  assert.ok(destinations);
  // D-7: the source account is listed but cannot be chosen as destination; the other account is preselected.
  const radios = [...destinations.querySelectorAll('[role="radio"]')];
  assert.equal(radios.length, 2);
  assert.equal(radios.filter((radio) => radio.getAttribute('aria-disabled') === 'true').length, 1);
  assert.equal(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true').length, 1);
  assert.ok(screen.getByRole('button', { name: 'A un beneficiario' }));
  assert.ok(screen.getByLabelText('Importe a transferir'));
  cleanup(); client.clear(); dom.window.close();
});
