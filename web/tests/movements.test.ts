import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { movementQuery, MovementsPage } from '../src/movements.js';
import { SessionProvider } from '../src/session.js';

const accountId = '00000000-0000-4000-8000-000000000001';
const movement = { id: 'move-1', transferId: 'transfer-1', type: 'credit', amountMinor: '2500', currency: 'MXN', concept: 'Pago recibido', reference: '42', status: 'completed', occurredAt: '2026-05-01T12:00:00.000Z' };

test('movement query uses contract filters, limit and cursor without offset', () => {
  const url = new URL(movementQuery(accountId, { from: '2026-05-01', to: '2026-05-31', type: 'credit' }, 'next-token', 'UTC'), 'https://wallet.test');
  assert.equal(url.pathname, `/accounts/${accountId}/movements`);
  assert.equal(url.searchParams.get('from'), '2026-05-01T00:00:00.000Z');
  assert.equal(url.searchParams.get('to'), '2026-05-31T23:59:59.999Z');
  assert.equal(url.searchParams.get('type'), 'credit');
  assert.equal(url.searchParams.get('cursor'), 'next-token');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.has('offset'), false);
});

test('D-4: date filters are business days [00:00, 24:00) of the policy time zone', () => {
  const url = new URL(movementQuery(accountId, { from: '2026-11-17', to: '2026-11-17', type: '' }, undefined, 'America/Mexico_City'), 'https://wallet.test');
  // 00:00 and 24:00 (minus 1 ms, the API bound is inclusive) of 17/11 in Mexico City (UTC-6).
  assert.equal(url.searchParams.get('from'), '2026-11-17T06:00:00.000Z');
  assert.equal(url.searchParams.get('to'), '2026-11-18T05:59:59.999Z');
  assert.equal(url.searchParams.has('type'), false);
  const inside = Date.parse('2026-11-18T05:30:00.000Z'); // 23:30 of 17/11 business time
  const outside = Date.parse('2026-11-18T06:30:00.000Z'); // 00:30 of 18/11 business time
  assert.ok(inside >= Date.parse(url.searchParams.get('from')!) && inside <= Date.parse(url.searchParams.get('to')!));
  assert.ok(outside > Date.parse(url.searchParams.get('to')!));
  const dst = new URL(movementQuery(accountId, { from: '2026-03-08', to: '2026-03-08', type: '' }, undefined, 'America/New_York'), 'https://wallet.test');
  assert.equal(dst.searchParams.get('from'), '2026-03-08T05:00:00.000Z');
  assert.equal(dst.searchParams.get('to'), '2026-03-09T03:59:59.999Z');
});

test('movement history renders rows, applies filters, accumulates pages by cursor, and keeps rows when the next page fails', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let failNext = false;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/auth/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 });
    if (url.pathname.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'access', user: { id: 'user', email: 'test@example.test', fullName: 'Test Person' } }), { status: 200 });
    if (url.pathname.endsWith('/movements')) {
      if (failNext && url.searchParams.has('cursor')) { failNext = false; return new Response(JSON.stringify({ title: 'Unavailable', status: 503, requestId: 'req-1' }), { status: 503 }); }
      if (url.searchParams.has('cursor')) return new Response(JSON.stringify({ items: [{ ...movement, id: 'move-2', concept: 'Segundo movimiento' }], nextCursor: null }), { status: 200 });
      return new Response(JSON.stringify({ items: [movement], nextCursor: 'cursor-2' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const { cleanup, render, screen, fireEvent } = await import('@testing-library/react');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    render(createElement(QueryClientProvider, { client }, createElement(SessionProvider, null,
      createElement(MemoryRouter, { initialEntries: [`/accounts/${accountId}/movements`] }, createElement(Routes, null,
        createElement(Route, { path: '/accounts/:accountId/movements', element: createElement(MovementsPage) }))))));
    await screen.findAllByText('Pago recibido');
    // A credit from a third party (no counterparty.ownAccountId) opens an inline panel, never GET /transfers (D-10).
    const detail = screen.getByRole('button', { name: 'Ver detalle' });
    assert.equal(detail.getAttribute('aria-expanded'), 'false');
    fireEvent.click(detail);
    assert.equal(detail.getAttribute('aria-expanded'), 'true');
    assert.ok(!calls.some((call) => call.includes('/transfers/')));
    fireEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    await screen.findAllByText('Pago recibido');
    assert.ok(calls.some((call) => call.includes('type=credit')));
    assert.equal(screen.getByRole('button', { name: 'Entradas' }).getAttribute('aria-pressed'), 'true');
    failNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más movimientos' }));
    await screen.findByText('No pudimos cargar más movimientos.');
    assert.ok(screen.getAllByText('Pago recibido').length > 0, 'page 1 rows survive a failed page 2');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findAllByText('Segundo movimiento');
    assert.ok(screen.getAllByText('Pago recibido').length > 0, 'pages accumulate (D-9)');
    assert.ok(calls.some((call) => call.includes('cursor=cursor-2')));
  } finally {
    cleanup(); client.clear(); dom.window.close(); globalThis.fetch = originalFetch;
  }
});
