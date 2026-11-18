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
  const url = new URL(movementQuery(accountId, { from: '2026-05-01', to: '2026-05-31', type: 'credit' }, 'next-token'), 'https://wallet.test');
  assert.equal(url.pathname, `/accounts/${accountId}/movements`);
  assert.equal(url.searchParams.get('from'), '2026-05-01T00:00:00.000Z');
  assert.equal(url.searchParams.get('to'), '2026-05-31T23:59:59.999Z');
  assert.equal(url.searchParams.get('type'), 'credit');
  assert.equal(url.searchParams.get('cursor'), 'next-token');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.has('offset'), false);
});

test('movement history renders rows, applies filters, pages by cursor, and preserves rows on retry error', async () => {
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
      if (failNext) { failNext = false; return new Response(JSON.stringify({ title: 'Unavailable', status: 503, requestId: 'req-1' }), { status: 503 }); }
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
    await screen.findByText('Pago recibido');
    assert.ok(screen.getByRole('link', { name: 'Ver detalle' }));
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'credit' } });
    await screen.findByText('Pago recibido');
    assert.ok(calls.some((call) => call.includes('type=credit')));
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más movimientos' }));
    await screen.findByText('Segundo movimiento');
    assert.ok(calls.some((call) => call.includes('cursor=cursor-2')));
    failNext = true;
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar movimientos' }));
    await screen.findByRole('alert');
    assert.ok(screen.getByText('Segundo movimiento'));
    fireEvent.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    await screen.findByText('Segundo movimiento');
  } finally {
    cleanup(); client.clear(); dom.window.close(); globalThis.fetch = originalFetch;
  }
});
