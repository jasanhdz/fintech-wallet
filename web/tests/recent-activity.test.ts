import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { AccountsPage, recentMovementsPath, sumAvailableBalanceMinor } from '../src/routes.js';
import { SessionProvider } from '../src/session.js';

test('recent activity requests three real movements for the first account and renders their details', async () => {
  const accountId = '00000000-0000-4000-8000-000000000001';
  assert.equal(recentMovementsPath(accountId), `/accounts/${accountId}/movements?limit=3`);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
  const originalFetch = globalThis.fetch;
  const movementRequests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/auth/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf' }), { status: 200 });
    if (url.pathname.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'access', user: { id: 'user-1', email: 'test@example.test', fullName: 'Ana López' } }), { status: 200 });
    if (url.pathname === '/v1/accounts') return new Response(JSON.stringify({ items: [{ id: accountId, kind: 'checking', name: 'Cuenta principal', currency: 'MXN', availableBalanceMinor: '12345', clabeMasked: '****1234' }] }), { status: 200 });
    if (url.pathname.endsWith('/movements')) {
      movementRequests.push(url.pathname + url.search);
      return new Response(JSON.stringify({ items: [{ id: 'movement-1', type: 'debit', amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '123', status: 'completed', occurredAt: '2026-11-13T20:32:00.000Z' }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const { cleanup, render, screen } = await import('@testing-library/react');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    render(createElement(QueryClientProvider, { client }, createElement(SessionProvider, null,
      createElement(MemoryRouter, null, createElement(AccountsPage)))));
    const row = await screen.findByRole('row', { name: /Comida/ });
    assert.match(row.textContent || '', /13 nov 2026/i);
    assert.match(row.textContent || '', /Cargo/);
    assert.match(row.textContent || '', /850\.00/);
    assert.equal(movementRequests.length, 1);
    assert.equal(new URL(`https://wallet.test${movementRequests[0]}`).searchParams.get('limit'), '3');
    assert.ok(screen.getByRole('link', { name: /Ver historial completo/ }));
  } finally {
    cleanup(); client.clear(); dom.window.close(); globalThis.fetch = originalFetch;
  }
});

test('consolidated balance sums two accounts exactly in minor units', () => {
  const accounts = [
    { id: 'checking', kind: 'checking', name: 'Cuenta principal', currency: 'MXN', availableBalanceMinor: '10001', clabeMasked: '****0001' },
    { id: 'savings', kind: 'savings', name: 'Ahorro', currency: 'MXN', availableBalanceMinor: '2099', clabeMasked: '****0002' },
  ] as Parameters<typeof sumAvailableBalanceMinor>[0];

  assert.equal(sumAvailableBalanceMinor(accounts), 12100n);
});
