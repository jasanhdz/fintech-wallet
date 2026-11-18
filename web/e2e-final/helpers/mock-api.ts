// Network-simulated API for [F] scenarios: one `page.route` over `**/v1/**` that answers with typed
// fixtures and records every request (method, path, Idempotency-Key, body) for trace assertions.
import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import * as data from '../fixtures/data.js';

export type Reply = { status: number; body?: unknown } | 'abort';
export type RecordedRequest = { method: string; path: string; idempotencyKey: string | null; body: string | null; bodySha256: string | null; aborted: boolean };

export type MockState = {
  authenticated: boolean;
  user: data.User;
  accounts: data.Account[] | Reply;
  beneficiaries: data.Beneficiary[];
  policy: data.TransferPolicy | Reply;
  movements: data.Movement[];
  /** Consumed in order by POST /transfers; when empty, replies 201 completed. */
  createReplies: Reply[];
  /** Consumed in order by POST /transfers/{id}/confirm; when empty, replies 200 completed. */
  confirmReplies: Reply[];
  /** Known transfers for GET /transfers/{id}; unknown ids reply 404. */
  transfers: Map<string, data.Transfer>;
  /** Extra per-path overrides checked first: `${METHOD} ${path}` → reply. */
  overrides: Map<string, Reply>;
};

export type MockApi = { state: MockState; requests: RecordedRequest[]; nonGet(): RecordedRequest[] };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function installMockApi(page: Page, initial: Partial<MockState> = {}): Promise<MockApi> {
  const state: MockState = {
    authenticated: true,
    user: data.user,
    accounts: data.accounts(),
    beneficiaries: [data.beneficiary()],
    policy: data.policy(),
    movements: [data.movement()],
    createReplies: [],
    confirmReplies: [],
    transfers: new Map(),
    overrides: new Map(),
    ...initial,
  };
  const requests: RecordedRequest[] = [];

  const json = (route: Route, status: number, body?: unknown) => route.fulfill({
    status,
    contentType: status >= 400 ? 'application/problem+json' : 'application/json',
    body: body === undefined ? '' : JSON.stringify(body),
  });
  const reply = async (route: Route, value: Reply, record: RecordedRequest) => {
    if (value === 'abort') { record.aborted = true; return route.abort('connectionreset'); }
    if (value.status === 204) return route.fulfill({ status: 204, body: '' });
    return json(route, value.status, value.body);
  };

  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    const body = request.postData();
    const record: RecordedRequest = { method, path, idempotencyKey: request.headers()['idempotency-key'] ?? null, body, bodySha256: body === null ? null : sha256(body), aborted: false };
    requests.push(record);
    const local = path.replace(/^\/v1/, '');
    const override = state.overrides.get(`${method} ${local}`);
    if (override) return reply(route, override, record);

    if (method === 'GET' && local === '/auth/csrf') return json(route, 200, { csrfToken: 'synthetic-csrf' });
    if (method === 'POST' && local === '/auth/refresh') return state.authenticated ? json(route, 200, data.authResponse(state.user)) : route.fulfill({ status: 204, body: '' });
    if (method === 'POST' && local === '/auth/login') { state.authenticated = true; return json(route, 200, data.authResponse(state.user)); }
    if (method === 'POST' && local === '/auth/register') { state.authenticated = true; return json(route, 201, data.authResponse(state.user)); }
    if (method === 'POST' && local === '/auth/logout') { state.authenticated = false; return route.fulfill({ status: 204, body: '' }); }
    if (!state.authenticated) return json(route, 401, data.problem(401, 'Inicia sesión.', 'Unauthorized'));

    if (method === 'GET' && local === '/accounts') return Array.isArray(state.accounts) ? json(route, 200, { items: state.accounts }) : reply(route, state.accounts, record);
    if (method === 'GET' && /^\/accounts\/[^/]+\/movements$/.test(local)) {
      const limit = Number(url.searchParams.get('limit') ?? '20');
      return json(route, 200, { items: state.movements.slice(0, limit), nextCursor: null });
    }
    if (method === 'GET' && local === '/beneficiaries') return json(route, 200, { items: state.beneficiaries });
    if (method === 'GET' && local === '/transfer-policy') {
      const current = state.policy;
      return current === 'abort' || 'status' in current ? reply(route, current as Reply, record) : json(route, 200, current);
    }
    if (method === 'POST' && local === '/transfers') {
      const next = state.createReplies.shift() ?? { status: 201, body: data.transfer() };
      if (next !== 'abort' && next.status < 300) { const created = next.body as data.Transfer; state.transfers.set(created.id, created); }
      return reply(route, next, record);
    }
    const confirm = /^\/transfers\/([^/]+)\/confirm$/.exec(local);
    if (method === 'POST' && confirm) {
      const next = state.confirmReplies.shift() ?? { status: 200, body: data.transfer({ id: confirm[1] }) };
      if (next !== 'abort' && next.status < 300) state.transfers.set(confirm[1]!, next.body as data.Transfer);
      return reply(route, next, record);
    }
    const byId = /^\/transfers\/([^/]+)$/.exec(local);
    if (method === 'GET' && byId) {
      const found = state.transfers.get(byId[1]!);
      return found ? json(route, 200, found) : json(route, 404, data.problem(404, 'Transferencia no encontrada.', 'Not Found'));
    }
    return json(route, 404, data.problem(404, 'Recurso no encontrado.', 'Not Found'));
  });

  return { state, requests, nonGet: () => requests.filter((item) => item.method !== 'GET') };
}
