import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { dataSource } from '../src/db/data-source.js';
import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import { createApp } from '../src/http/app.js';

test('movement history is owner-scoped, ledger-backed and keyset-paginated in wallet_test', async (t) => {
  const url = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  process.env.DATABASE_URL = url.toString(); process.env.APP_ENV = 'development'; process.env.WEB_ORIGIN = 'http://localhost:5173';
  process.env.DEMO_FIXTURE_ENABLED = 'true'; process.env.DEMO_PRIMARY_BALANCE_MINOR = '100000'; process.env.DEMO_SAVINGS_BALANCE_MINOR = '0';
  process.env.OTP_THRESHOLD_MINOR = '9223372036854775807'; process.env.DAILY_TRANSFER_LIMIT_MINOR = '9223372036854775807';
  // Round 8: new mandatory setting (demo example, not approved policy); a local .env older than R8 lacks it.
  process.env.IDEMPOTENCY_RECORD_RETENTION_DAYS ??= '30';
  let server: ReturnType<typeof createServer> | undefined;
  const source = dataSource(url.toString()); await source.initialize();
  t.after(async () => { if (server?.listening) await new Promise<void>((resolveClose, reject) => server!.close((error) => error ? reject(error) : resolveClose())); if (source.isInitialized) await source.destroy(); });
  server = createServer(createApp()); await new Promise<void>((resolveListen) => server!.listen(0, '127.0.0.1', resolveListen));
  const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/v1`;
  async function register(label: string) {
    const csrfResponse = await fetch(`${base}/auth/csrf`); const csrf = (await csrfResponse.json() as { csrfToken: string }).csrfToken;
    const cookie = csrfResponse.headers.getSetCookie().find((value) => value.startsWith('wallet_csrf='))!.split(';')[0]!;
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie, origin: 'http://localhost:5173' }, body: JSON.stringify({ fullName: label, email: `${label}-${crypto.randomUUID()}@example.test`, password: 'correct horse battery staple' }) });
    assert.equal(response.status, 201); return (await response.json() as { accessToken: string }).accessToken;
  }
  const token = await register('history-owner'); const foreignToken = await register('history-other');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const own = (await (await fetch(`${base}/accounts`, { headers })).json() as { items: Array<{ id: string; kind: string }> }).items;
  const foreign = (await (await fetch(`${base}/accounts`, { headers: { authorization: `Bearer ${foreignToken}` } })).json() as { items: Array<{ id: string }> }).items[0]!;
  const notOwned = await fetch(`${base}/accounts/${foreign.id}/movements`, { headers }); assert.equal(notOwned.status, 404);
  const account = own.find((item) => item.kind === 'checking')!; const destination = own.find((item) => item.kind === 'savings')!;
  for (let index = 0; index < 25; index++) {
    const response = await fetch(`${base}/transfers`, { method: 'POST', headers: { ...headers, 'idempotency-key': crypto.randomUUID() + crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: account.id, destinationType: 'own_account', destinationAccountId: destination.id, amountMinor: '1', concept: `movement ${index}`, reference: String(index + 1) }) });
    const responseBody = await response.json() as { status?: string; detail?: string }; assert.equal(response.status, 201, responseBody.detail ?? 'transfer failed'); assert.equal(responseBody.status, 'completed');
  }
  const collected: Array<{ id: string; transferId: string; type: string; amountMinor: string }> = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: '20' }); if (cursor) params.set('cursor', cursor);
    const response = await fetch(`${base}/accounts/${account.id}/movements?${params}`, { headers }); assert.equal(response.status, 200);
    const page = await response.json() as { items: typeof collected; nextCursor: string | null };
    collected.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(collected.length, 25); assert.equal(new Set(collected.map((item) => item.id)).size, 25);
  assert.ok(collected.every((item) => item.type === 'debit' && item.amountMinor === '1'));
  const credit = await fetch(`${base}/accounts/${destination.id}/movements?type=credit&from=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`, { headers });
  assert.equal(credit.status, 200); const credits = await credit.json() as { items: Array<{ type: string; amountMinor: string }>; nextCursor: string | null };
  assert.equal(credits.items.length, 20); assert.ok(credits.items.every((item) => item.type === 'credit' && item.amountMinor === '1')); assert.ok(credits.nextCursor);
  const unfiltered = await fetch(`${base}/accounts/${destination.id}/movements`, { headers }); assert.equal((await (unfiltered.json() as Promise<{ items: unknown[] }>)).items.length, 20);
  const throughTomorrow = await fetch(`${base}/accounts/${destination.id}/movements?to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, { headers }); assert.equal((await throughTomorrow.json() as { items: unknown[] }).items.length, 20);
  const fromTomorrow = await fetch(`${base}/accounts/${destination.id}/movements?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, { headers }); assert.equal((await fromTomorrow.json() as { items: unknown[] }).items.length, 0);
  for (const invalid of ['limit=0', 'limit=101', 'type=opening', 'cursor=oops', 'from=not-a-date', 'from=2025-01-02T00%3A00%3A00Z&to=2025-01-01T00%3A00%3A00Z']) {
    const response = await fetch(`${base}/accounts/${account.id}/movements?${invalid}`, { headers }); assert.equal(response.status, 400, invalid);
  }
  const beyond = await fetch(`${base}/accounts/${account.id}/movements?limit=100`, { headers }); assert.equal((await beyond.json() as { items: unknown[] }).items.length, 25);
  const ledgerCount = await source.query("SELECT count(*)::int AS n FROM ledger_entries e JOIN ledger_transactions l ON l.id=e.ledger_transaction_id JOIN transfers t ON t.id=l.reference_id WHERE e.account_id=$1 AND l.reference_type='transfer' AND t.status='completed'", [account.id]);
  assert.equal(ledgerCount[0].n, collected.length);
});
