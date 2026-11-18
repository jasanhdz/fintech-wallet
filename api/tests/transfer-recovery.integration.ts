import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env'), quiet: true });
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { jwtVerify } from 'jose';
import { Client } from 'pg';
import { dataSource } from '../src/db/data-source.js';
import { assertSafeTestDatabase, assertSafeTestMigrator } from '../src/db/test-database-guard.js';
import { createApp } from '../src/http/app.js';
import { ensureDemoClearingAccount } from '../src/db/clearing-account.js';
import { transferAttemptRecoveryUpSql } from '../src/db/migrations/1763000009000-TransferAttemptRecovery.js';
import { hashSecret } from '../src/security/crypto.js';

/**
 * Round 8 (F-26) — authoritative recovery of transfer attempts, real API + PostgreSQL wallet_test.
 * Each `R8-xx` subtest maps to the rubric in SPEC.md §R8.13. Fixture amounts and limits are demo/test values only.
 */

type Json = Record<string, unknown>;
type Account = { id: string; kind: string; clabe: string; availableBalanceMinor: string };
type User = { label: string; email: string; password: string; token: string; headers: Record<string, string>; userId: string; principal: Account; savings: Account };
type Summary = { attemptId: string | null; transferId: string | null; status: string; amountMinor: string | null; createdAt: string; closedAt: string | null; completedAt: string | null; expiresAt: string | null; problem: { status: number; detail: string } | null; destination: { name: string; clabeMasked: string; ownAccountId?: string } | null; sourceAccountId: string | null };
type Page = { items: Summary[]; nextCursor: string | null; sendEpoch: string };
type VoidResult = { resolution: 'transfer_found' | 'rejected' | 'voided'; attempt: Summary };
type VoidAllResult = { sendEpoch: string; advanced: boolean; closedTransferIds: string[] };

const VOIDED = 'urn:billetera:problem:transfer-attempt-voided';
const REJECTED = 'urn:billetera:problem:transfer-attempt-rejected';
const CONFLICT = 'urn:billetera:problem:transfer-attempt-conflict';
const PASSWORD = 'correct horse battery staple';

test('round 8: authoritative transfer-attempt recovery (R8-01..R8-14) in wallet_test', async (t) => {
  const testUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  const migratorUrl = assertSafeTestMigrator(process.env.TEST_MIGRATOR_DATABASE_URL, testUrl);
  Object.assign(process.env, {
    DATABASE_URL: testUrl.toString(), APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:5173',
    DEMO_FIXTURE_ENABLED: 'true', DEMO_PRIMARY_BALANCE_MINOR: '100000000', DEMO_SAVINGS_BALANCE_MINOR: '100000',
    BUSINESS_TIME_ZONE: 'America/Mexico_City', DAILY_TRANSFER_LIMIT_MINOR: '900000000000', OTP_THRESHOLD_MINOR: '500000',
    OTP_EXPIRY_SECONDS: '300', OTP_MAX_ATTEMPTS: '5', IDEMPOTENCY_RECORD_RETENTION_DAYS: '30',
  });

  // Everything printed by this process (test + in-process API) is kept to prove R8-13 (no keys/OTP/CLABE in logs).
  const captured: string[] = [];
  const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const name of ['log', 'error', 'warn', 'info'] as const) {
    console[name] = (...args: unknown[]) => { captured.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ')); originals[name](...args); };
  }
  const usedKeys = new Set<string>(); const seenCodes = new Set<string>(); const knownClabes = new Set<string>(); const users: User[] = [];

  const source = dataSource(testUrl.toString()); await source.initialize();
  let server: ReturnType<typeof createServer> | undefined; let base = '';
  const startServer = async () => { server = createServer(createApp()); await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done)); const address = server.address(); assert(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}/v1`; };
  const stopServer = async () => { if (!server?.listening) return; const closing = new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done())); server.closeAllConnections(); await closing; };
  /** A new API process-equivalent (fresh app, fresh rate limiters) on the same database. */
  const restart = async () => { await stopServer(); await startServer(); };
  t.after(async () => { await stopServer(); if (source.isInitialized) await source.destroy(); Object.assign(console, originals); });
  await startServer();

  const q = async <T = Json>(sql: string, parameters: unknown[] = []) => await source.query(sql, parameters) as T[];
  const key = () => { const value = crypto.randomUUID() + crypto.randomUUID(); usedKeys.add(value); return value; };
  const uuid = () => crypto.randomUUID();
  const fixture = (section: string, user: User) => console.log(JSON.stringify({ event: 'r8.fixture', section, userId: user.userId, principal: user.principal.id, savings: user.savings.id }));

  async function register(label: string): Promise<User> {
    const csrfResponse = await fetch(`${base}/auth/csrf`); const csrf = (await csrfResponse.json() as { csrfToken: string }).csrfToken;
    const cookie = csrfResponse.headers.getSetCookie().find((value) => value.startsWith('wallet_csrf='))!.split(';')[0]!;
    const email = `r8-${label}-${uuid()}@example.test`;
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie, origin: 'http://localhost:5173' }, body: JSON.stringify({ fullName: `R8 ${label}`, email, password: PASSWORD }) });
    assert.equal(response.status, 201, `register ${label}`);
    const token = (await response.json() as { accessToken: string }).accessToken;
    return await session(label, email, token);
  }
  async function session(label: string, email: string, token: string): Promise<User> {
    const userId = String((await jwtVerify(token, new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))).payload.sub);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const accounts = (await (await fetch(`${base}/accounts`, { headers })).json() as { items: Account[] }).items;
    for (const account of accounts) knownClabes.add(account.clabe);
    const user = { label, email, password: PASSWORD, token, headers, userId, principal: accounts.find((a) => a.kind === 'checking')!, savings: accounts.find((a) => a.kind === 'savings')! };
    assert.ok(user.principal && user.savings, 'fixture registration creates principal and savings');
    users.push(user); return user;
  }
  async function mobileLogin(user: User, label: string): Promise<User> {
    const response = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password, client: 'mobile' }) });
    assert.equal(response.status, 200, 'mobile login');
    return await session(label, user.email, (await response.json() as { accessToken: string }).accessToken);
  }

  const own = (user: User, amountMinor: string): Json => ({ sourceAccountId: user.principal.id, destinationType: 'own_account', destinationAccountId: user.savings.id, amountMinor, concept: 'R8 prueba', reference: '8' });
  const fromSavings = (user: User, amountMinor: string): Json => ({ sourceAccountId: user.savings.id, destinationType: 'own_account', destinationAccountId: user.principal.id, amountMinor, concept: 'R8 desde ahorro', reference: '81' });
  type SendOptions = { key: string; attemptId?: string; epoch?: string; signal?: AbortSignal };
  const post = (user: User, body: Json, options: SendOptions) => fetch(`${base}/transfers`, { method: 'POST', signal: options.signal, headers: { ...user.headers, 'idempotency-key': options.key, ...(options.attemptId !== undefined ? { 'transfer-attempt-id': options.attemptId } : {}), ...(options.epoch !== undefined ? { 'transfer-send-epoch': options.epoch } : {}) }, body: JSON.stringify(body) });
  const postJson = async (user: User, body: Json, options: SendOptions) => { const response = await post(user, body, options); const json = await response.json() as Json; if (typeof json.demoOnlyCode === 'string') seenCodes.add(json.demoOnlyCode); return { status: response.status, json, contentType: response.headers.get('content-type') ?? '' }; };
  const voidAttempt = async (user: User, idempotencyKey: string, attemptId?: string) => { const response = await fetch(`${base}/transfer-attempts/void`, { method: 'POST', headers: user.headers, body: JSON.stringify(attemptId ? { idempotencyKey, attemptId } : { idempotencyKey }) }); return { status: response.status, json: await response.json() as VoidResult & Json }; };
  const voidAll = async (user: User, fromEpoch: string) => { const response = await fetch(`${base}/transfer-attempts/void-all`, { method: 'POST', headers: user.headers, body: JSON.stringify({ fromEpoch }) }); return { status: response.status, json: await response.json() as VoidAllResult & Json }; };
  const list = async (user: User, params: Record<string, string> = {}) => { const response = await fetch(`${base}/transfer-attempts?${new URLSearchParams(params)}`, { headers: user.headers }); const json = await response.json() as Page & Json; return { status: response.status, json, contentType: response.headers.get('content-type') ?? '' }; };
  const epochOf = async (user: User) => { const policy = await (await fetch(`${base}/transfer-policy`, { headers: user.headers })).json() as { sendEpoch: string }; assert.match(policy.sendEpoch, /^(0|[1-9][0-9]*)$/); return policy.sendEpoch; };
  const confirm = (user: User, id: string, code: string) => fetch(`${base}/transfers/${id}/confirm`, { method: 'POST', headers: { ...user.headers, 'idempotency-key': key() }, body: JSON.stringify({ code }) });
  const expectProblem = (result: { status: number; json: Json; contentType?: string }, status: number, type: string, label: string) => {
    assert.equal(result.status, status, `${label}: status ${JSON.stringify(result.json)}`);
    assert.equal(result.json.type, type, `${label}: problem type`); assert.equal(result.json.status, status);
    if (result.contentType !== undefined) assert.equal(result.contentType.split(';')[0], 'application/problem+json');
  };

  // --- Database reads (runtime role) used as the authoritative evidence of each case.
  const transfersByAttempt = (userId: string, attemptId: string) => q<{ id: string; status: string }>('SELECT id,status FROM transfers WHERE owner_id=$1 AND client_attempt_id=$2', [userId, attemptId]);
  const closuresBy = (userId: string, where: { attemptId?: string; key?: string }) => q<{ id: string; status: string; problem_status: number | null }>('SELECT id,status,problem_status FROM transfer_attempt_closures WHERE owner_id=$1 AND (client_attempt_id=$2::uuid OR key_hash=$3)', [userId, where.attemptId ?? null, where.key ? hashSecret(where.key) : null]);
  const postings = (transferId: string) => q<{ account_id: string; amount: string; entry_type: string }>("SELECT le.account_id,le.signed_amount_minor::text AS amount,le.entry_type FROM ledger_transactions lt JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE lt.reference_type='transfer' AND lt.reference_id=$1", [transferId]);
  const debitsOf = async (transferId: string) => (await postings(transferId)).filter((row) => row.entry_type === 'debit').length;
  const netOf = async (transferId: string) => (await postings(transferId)).reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const ownerNet = async (userId: string) => BigInt((await q<{ net: string }>("SELECT COALESCE(sum(le.signed_amount_minor),0)::text AS net FROM transfers t JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.owner_id=$1", [userId]))[0]!.net);
  const balances = async (user: User) => Object.fromEntries((await q<{ id: string; b: string }>('SELECT id,balance_minor::text AS b FROM accounts WHERE owner_id=$1 ORDER BY id', [user.userId])).map((row) => [row.id, row.b]));
  const usage = async (user: User) => q('SELECT business_date::text AS day,outgoing_minor::text AS amount FROM daily_limit_usage WHERE owner_id=$1 ORDER BY business_date', [user.userId]);
  const counts = async (user: User) => (await q<{ transfers: number; closures: number; entries: number }>("SELECT (SELECT count(*)::int FROM transfers WHERE owner_id=$1) AS transfers,(SELECT count(*)::int FROM transfer_attempt_closures WHERE owner_id=$1) AS closures,(SELECT count(*)::int FROM transfers t JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.owner_id=$1) AS entries", [user.userId]))[0]!;
  const snapshot = async (user: User) => ({ balances: await balances(user), usage: await usage(user), counts: await counts(user) });
  const audits = (userId: string, action: string) => q<{ resource_id: string; resource_type: string; metadata: Json }>('SELECT resource_id,resource_type,metadata FROM audit_events WHERE actor_id=$1 AND action=$2 ORDER BY created_at,id', [userId, action]);
  const gateEpoch = async (userId: string) => (await q<{ epoch: string }>('SELECT epoch::text AS epoch FROM transfer_send_gates WHERE owner_id=$1', [userId]))[0]?.epoch ?? '0';
  /**
   * Random start offset in [minMs, maxMs]. Alternating a near-zero and a few-ms offset per iteration makes the
   * concurrent requests overlap while both interleavings (either side first) are exercised, instead of one fixed winner.
   */
  const after = async <T>(minMs: number, maxMs: number, run: () => Promise<T>) => { await sleep(minMs + Math.floor(Math.random() * (maxMs - minMs + 1))); return await run(); };
  /** Even iterations start the send a few ms late (void side usually first); odd ones start the void late (send usually first). */
  const offsets = (i: number): { send: [number, number]; close: [number, number] } => (i % 2 === 0 ? { send: [2, 6], close: [0, 0] } : { send: [0, 0], close: [6, 12] });
  const waitFor = async (condition: () => Promise<boolean>, label: string, timeoutMs = 15_000) => { const started = Date.now(); while (Date.now() - started < timeoutMs) { if (await condition()) return; await sleep(20); } throw new Error(`timed out waiting for ${label}`); };
  const blockedBy = async (pid: number) => (await q<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])).map((row) => row.pid);
  const lockAccount = async (accountId: string) => { const client = new Client({ connectionString: testUrl.toString() }); await client.connect(); await client.query('BEGIN'); await client.query('SELECT 1 FROM accounts WHERE id=$1 FOR UPDATE', [accountId]); const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number; return { client, pid, release: async () => { await client.query('ROLLBACK'); await client.end(); } }; };
  const fund = async (accountId: string, amount: bigint) => { const clearing = await ensureDemoClearingAccount((sql, parameters) => source.query(sql, parameters)); const tx = await q<{ id: string }>("INSERT INTO ledger_transactions(reference_type,reference_id) VALUES('opening',$1) RETURNING id", [accountId]); await q("INSERT INTO ledger_entries(ledger_transaction_id,account_id,signed_amount_minor,entry_type) VALUES($1,$2,$3,'opening'),($1,$4,$5,'opening')", [tx[0]!.id, accountId, amount.toString(), clearing, (-amount).toString()]); await q('UPDATE accounts SET balance_minor=balance_minor+$1 WHERE id=$2', [amount.toString(), accountId]); await q('UPDATE accounts SET balance_minor=balance_minor-$1 WHERE id=$2', [amount.toString(), clearing]); };
  const forbiddenNames = new Set(['demoOnlyCode', 'code', 'idempotencyKey', 'keyHash', 'key_hash', 'requestId', 'clabe']);
  const assertPrivate = (value: unknown, where: string) => {
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') { assert.ok(!/^\d{18}$/.test(node), `${where}: 18-digit value at ${path}`); return; }
      if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
      if (node && typeof node === 'object') for (const [name, child] of Object.entries(node)) { assert.ok(!forbiddenNames.has(name), `${where}: forbidden field ${path}.${name}`); walk(child, `${path}.${name}`); }
    };
    walk(value, '$');
    const text = JSON.stringify(value);
    for (const used of usedKeys) assert.ok(!text.includes(used) && !text.includes(hashSecret(used)), `${where}: contains an idempotency key or its hash`);
  };

  await t.test('R8-01 migration 1763000009000: applied, idempotent, catalog, grants and DB guards', async () => {
    const migrator = new Client({ connectionString: migratorUrl.toString() }); await migrator.connect();
    try {
      const applied = await migrator.query("SELECT name FROM migrations WHERE name='TransferAttemptRecovery1763000009000'");
      assert.equal(applied.rows.length, 1, 'db:migrate:test applied 1763000009000 to wallet_test');
      await migrator.query('BEGIN'); await migrator.query(transferAttemptRecoveryUpSql); await migrator.query('COMMIT');
      console.log(JSON.stringify({ event: 'r8.migration.rerun', ok: true }));
      const column = await migrator.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_name='transfers' AND column_name='client_attempt_id'");
      assert.deepEqual(column.rows[0], { data_type: 'uuid', is_nullable: 'YES' });
      const tables = (await migrator.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('transfer_send_gates','transfer_attempt_closures') ORDER BY 1")).rows.map((row) => row.table_name);
      assert.deepEqual(tables, ['transfer_attempt_closures', 'transfer_send_gates']);
      const indexes = (await migrator.query("SELECT indexname,indexdef FROM pg_indexes WHERE indexname IN ('transfers_owner_attempt_uidx','transfer_attempt_closures_owner_key_uidx','transfer_attempt_closures_owner_attempt_uidx','transfer_attempt_closures_owner_closed_idx') ORDER BY 1")).rows as Array<{ indexname: string; indexdef: string }>;
      assert.equal(indexes.length, 4); assert.match(indexes.find((i) => i.indexname === 'transfers_owner_attempt_uidx')!.indexdef, /UNIQUE.*\(owner_id, client_attempt_id\) WHERE \(client_attempt_id IS NOT NULL\)/);
      const checks = (await migrator.query("SELECT conname FROM pg_constraint WHERE conrelid IN ('transfer_send_gates'::regclass,'transfer_attempt_closures'::regclass) AND contype='c' ORDER BY 1")).rows.map((row) => row.conname);
      assert.deepEqual(checks, ['transfer_attempt_closures_amount_check', 'transfer_attempt_closures_problem_status_check', 'transfer_attempt_closures_rejected_check', 'transfer_attempt_closures_status_check', 'transfer_send_gates_epoch_check']);
      const triggers = (await migrator.query("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('transfers_attempt_id_immutable','transfer_send_gates_monotonic','transfer_attempt_closures_append_only','transfer_attempt_closures_cross_guard','idempotency_records_closed_key_guard','transfers_closed_attempt_guard') ORDER BY 1")).rows.map((row) => row.tgname);
      assert.equal(triggers.length, 6, `round-8 triggers present: ${triggers.join(',')}`);
      const privileges = (await migrator.query(`SELECT tbl, priv, has_table_privilege('wallet_runtime_test', tbl, priv) AS granted FROM (VALUES
        ('transfer_send_gates','SELECT'),('transfer_send_gates','INSERT'),('transfer_send_gates','UPDATE'),('transfer_send_gates','DELETE'),('transfer_send_gates','TRUNCATE'),
        ('transfer_attempt_closures','SELECT'),('transfer_attempt_closures','INSERT'),('transfer_attempt_closures','UPDATE'),('transfer_attempt_closures','DELETE'),('transfer_attempt_closures','TRUNCATE')) AS p(tbl, priv)`)).rows as Array<{ tbl: string; priv: string; granted: boolean }>;
      const expected: Record<string, boolean> = { SELECT: true, INSERT: true, UPDATE: true, DELETE: false, TRUNCATE: false };
      for (const row of privileges) assert.equal(row.granted, row.tbl === 'transfer_attempt_closures' && row.priv === 'UPDATE' ? false : expected[row.priv], `${row.tbl} ${row.priv}`);
    } finally { await migrator.end(); }

    // Runtime-role guards on real rows.
    const user = await register('migration'); fixture('R8-01', user);
    const epoch = await epochOf(user);
    const sentKey = key(); const sentAttempt = uuid();
    const sent = await postJson(user, own(user, '100'), { key: sentKey, attemptId: sentAttempt, epoch });
    assert.equal(sent.status, 201); const transferId = String(sent.json.id);
    const voided = await voidAttempt(user, key(), uuid()); assert.equal(voided.json.resolution, 'voided');
    const closureId = (await closuresBy(user.userId, { attemptId: voided.json.attempt.attemptId! }))[0]!.id;
    await assert.rejects(q("UPDATE transfer_attempt_closures SET problem_detail='x' WHERE id=$1", [closureId]), /permission denied|append-only/);
    await assert.rejects(q('DELETE FROM transfer_attempt_closures WHERE id=$1', [closureId]), /permission denied|append-only/);
    assert.equal((await voidAll(user, epoch)).json.advanced, true);
    await assert.rejects(q('UPDATE transfer_send_gates SET epoch=epoch-1 WHERE owner_id=$1', [user.userId]), /only stay or advance by one/);
    await assert.rejects(q('UPDATE transfer_send_gates SET epoch=epoch+2 WHERE owner_id=$1', [user.userId]), /only stay or advance by one/);
    await assert.rejects(q('DELETE FROM transfer_send_gates WHERE owner_id=$1', [user.userId]), /permission denied/);
    await assert.rejects(q('UPDATE transfers SET client_attempt_id=gen_random_uuid() WHERE id=$1', [transferId]), /immutable/);
    await assert.rejects(q("UPDATE transfers SET status='cancelled',closed_at=now() WHERE id=$1", [transferId]), /terminal state/);
    // Cross guards (defence in depth under the service locks).
    await assert.rejects(q("INSERT INTO transfer_attempt_closures(owner_id,key_hash,status) VALUES($1,$2,'voided')", [user.userId, hashSecret(sentKey)]), /already executed/);
    const voidedKey = key(); assert.equal((await voidAttempt(user, voidedKey)).json.resolution, 'voided');
    await assert.rejects(q("INSERT INTO idempotency_records(user_id,operation,key_hash,payload_hash,transfer_id,response_status,response_snapshot,expires_at) VALUES($1,'create-transfer',$2,$3,$4,201,'{}',now())", [user.userId, hashSecret(voidedKey), 'x'.repeat(64), transferId]), /key is closed/);
    await assert.rejects(q("INSERT INTO transfers(owner_id,source_account_id,destination_account_id,amount_minor,concept,reference,status,client_attempt_id) VALUES($1,$2,$3,1,'x','1','awaiting_confirmation',$4)", [user.userId, user.principal.id, user.savings.id, voided.json.attempt.attemptId]), /identity that is closed/);
  });

  await t.test('R8-03 authoritative listing: 45+ attempts, keyset pages, filters, 400s and privacy', async () => {
    await restart();
    const user = await register('listing'); fixture('R8-03', user);
    const ben = await fetch(`${base}/beneficiaries`, { method: 'POST', headers: user.headers, body: JSON.stringify({ name: 'Ahorro propio R8', alias: 'Ahorro', clabe: user.savings.clabe }) });
    assert.equal(ben.status, 201); const beneficiaryId = (await ben.json() as { id: string }).id;
    const epoch = await epochOf(user);
    const withHeaders = () => ({ key: key(), attemptId: uuid(), epoch });
    for (let i = 0; i < 16; i += 1) { const body = i % 2 ? own(user, String(100 + i)) : { sourceAccountId: user.principal.id, destinationType: 'beneficiary', beneficiaryId, amountMinor: String(200 + i), concept: 'R8 beneficiario', reference: '82' }; assert.equal((await postJson(user, body, withHeaders())).status, 201); }
    for (let i = 0; i < 4; i += 1) assert.equal((await postJson(user, own(user, String(300 + i)), { key: key() })).status, 201);
    for (let i = 0; i < 6; i += 1) assert.equal((await postJson(user, own(user, '600000'), withHeaders())).status, 202);
    for (let i = 0; i < 4; i += 1) { const pending = await postJson(user, own(user, '700000'), withHeaders()); assert.equal(pending.status, 202); await q("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1", [pending.json.id]); }
    for (let i = 0; i < 4; i += 1) { const pending = await postJson(user, own(user, '800000'), withHeaders()); assert.equal(pending.status, 202); assert.equal((await fetch(`${base}/transfers/${pending.json.id}/cancel`, { method: 'POST', headers: user.headers })).status, 200); }
    for (let i = 0; i < 5; i += 1) expectProblem(await postJson(user, fromSavings(user, '200000'), withHeaders()), 422, REJECTED, 'rejected fixture');
    for (let i = 0; i < 6; i += 1) assert.equal((await voidAttempt(user, key(), uuid())).json.resolution, 'voided');

    const warm = await list(user, { limit: '50' }); assert.equal(warm.status, 200); // runs expireDue for the forced-past OTPs
    const expected = (await q<{ ident: string; status: string }>(`SELECT COALESCE(x.transfer_id::text,'attempt:'||x.attempt_id::text) AS ident,x.status FROM (
        SELECT 'transfer' AS kind,id,created_at AS at,client_attempt_id AS attempt_id,id AS transfer_id,status::text FROM transfers WHERE owner_id=$1
        UNION ALL SELECT 'closure',id,closed_at,client_attempt_id,NULL,status::text FROM transfer_attempt_closures WHERE owner_id=$1) x
      ORDER BY x.at DESC,x.kind DESC,x.id DESC`, [user.userId]));
    assert.ok(expected.length >= 45, `at least 45 attempts (got ${expected.length})`);
    const byStatus = expected.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {});
    assert.deepEqual(byStatus, { completed: 20, awaiting_confirmation: 6, expired: 4, cancelled: 4, rejected: 5, voided: 6 });
    const ident = (item: Summary) => item.transferId ?? `attempt:${item.attemptId}`;

    const pages: Summary[][] = []; let cursor: string | null = null; let insertedDuringPaging = 0;
    do {
      const page = await list(user, { limit: '10', ...(cursor ? { cursor } : {}) });
      assert.equal(page.status, 200); assertPrivate(page.json, 'listing page'); assert.equal(page.json.sendEpoch, epoch);
      assert.ok(page.json.items.length <= 10); pages.push(page.json.items); cursor = page.json.nextCursor;
      if (pages.length === 1) for (let i = 0; i < 3; i += 1) { assert.equal((await postJson(user, own(user, String(900 + i)), withHeaders())).status, 201); insertedDuringPaging += 1; }
    } while (cursor);
    const paged = pages.flat().map(ident);
    assert.equal(insertedDuringPaging, 3);
    assert.deepEqual(paged, expected.map((row) => row.ident), 'limit=10 pages equal the direct DB order, unaffected by attempts created while paging');
    assert.equal(new Set(paged).size, paged.length, 'no duplicates');
    assert.deepEqual(pages.map((page) => page.length), [10, 10, 10, 10, 5]);
    for (const item of pages.flat()) {
      assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      if (item.transferId) { assert.ok(item.destination && item.amountMinor && item.sourceAccountId); assert.equal(item.problem, null); }
      else { assert.equal(item.destination, null); assert.ok(item.closedAt); }
      if (item.status === 'rejected') assert.deepEqual(item.problem, { status: 422, detail: 'Saldo insuficiente.' });
      if (item.status === 'awaiting_confirmation') assert.ok(item.expiresAt);
    }
    const all = (await list(user, { limit: '50' })).json.items; assert.equal(all.length, 48);

    const statusFilter = await list(user, { status: 'rejected,voided', limit: '50' });
    assert.deepEqual(statusFilter.json.items.map(ident), all.filter((item) => ['rejected', 'voided'].includes(item.status)).map(ident));
    assert.equal(statusFilter.json.items.length, 11);
    assert.equal((await list(user, { status: 'awaiting_confirmation', limit: '50' })).json.items.length, 6);
    const target = all.find((item) => item.attemptId && item.status === 'expired')!;
    assert.deepEqual((await list(user, { attemptId: target.attemptId! })).json.items.map(ident), [ident(target)]);
    assert.deepEqual((await list(user, { attemptId: uuid() })).json.items, []);
    const from = all[30]!.createdAt; const to = all[10]!.createdAt;
    const windowed = (await list(user, { from, to, limit: '50' })).json.items.map(ident);
    const dbWindow = (await q<{ ident: string }>(`SELECT COALESCE(x.transfer_id::text,'attempt:'||x.attempt_id::text) AS ident FROM (
        SELECT 'transfer' AS kind,id,created_at AS at,client_attempt_id AS attempt_id,id AS transfer_id FROM transfers WHERE owner_id=$1
        UNION ALL SELECT 'closure',id,closed_at,client_attempt_id,NULL FROM transfer_attempt_closures WHERE owner_id=$1) x
      WHERE x.at >= $2::timestamptz AND x.at <= $3::timestamptz ORDER BY x.at DESC,x.kind DESC,x.id DESC`, [user.userId, from, to])).map((row) => row.ident);
    assert.deepEqual(windowed, dbWindow); assert.ok(windowed.length >= 15);

    const firstPage = await list(user, { limit: '10' }); const good = firstPage.json.nextCursor!;
    const altered = `${good.slice(0, 5)}${good[5] === 'A' ? 'B' : 'A'}${good.slice(6)}`;
    const invalidParams: Array<Record<string, string>> = [{ limit: '0' }, { limit: '51' }, { limit: 'x' }, { cursor: altered }, { cursor: `${good}x` }, { from: to, to: from }, { status: 'processing' }, { attemptId: 'nope' }];
    for (const params of invalidParams) {
      const bad = await list(user, params); expectProblem(bad, 400, 'about:blank', `invalid ${JSON.stringify(params)}`);
    }
  });

  await t.test('R8-04 lost response on send (destination account locked), API restart, authoritative read and replay', async () => {
    await restart();
    const user = await register('lost-send'); fixture('R8-04', user);
    const before = await balances(user); const epoch = await epochOf(user);
    const sendKey = key(); const attemptId = uuid(); const body = own(user, '12345');
    const lock = await lockAccount(user.savings.id);
    const controller = new AbortController();
    const inflight = post(user, body, { key: sendKey, attemptId, epoch, signal: controller.signal }).then(() => 'answered', (error: Error) => error.name);
    await waitFor(async () => (await blockedBy(lock.pid)).length > 0, 'POST blocked on the destination account lock');
    controller.abort();
    assert.equal(await inflight, 'AbortError', 'client never received the response');
    assert.equal((await transfersByAttempt(user.userId, attemptId)).length, 0, 'nothing committed while the account is locked');
    await lock.release();
    await waitFor(async () => (await transfersByAttempt(user.userId, attemptId)).length === 1, 'server finished the aborted request');
    await restart();
    const read = await list(user, { attemptId, limit: '1' });
    assert.equal(read.status, 200); assert.equal(read.json.items.length, 1); const item = read.json.items[0]!;
    assert.equal(item.attemptId, attemptId); assert.equal(item.status, 'completed'); assert.ok(item.transferId);
    const replay = await postJson(user, body, { key: sendKey, attemptId, epoch });
    assert.equal(replay.status, 201); assert.equal(replay.json.id, item.transferId);
    const rows = await transfersByAttempt(user.userId, attemptId); assert.equal(rows.length, 1);
    assert.equal(await debitsOf(item.transferId!), 1); assert.equal(await netOf(item.transferId!), 0n);
    const after = await balances(user);
    assert.equal(BigInt(before[user.principal.id]!) - BigInt(after[user.principal.id]!), 12345n);
    assert.equal(BigInt(after[user.savings.id]!) - BigInt(before[user.savings.id]!), 12345n);
  });

  await t.test('R8-05 lost response on void and void-all: repeated calls are no-ops', async () => {
    await restart();
    const user = await register('lost-void'); fixture('R8-05', user);
    const voidKey = key(); const attemptId = uuid();
    const first = await fetch(`${base}/transfer-attempts/void`, { method: 'POST', headers: user.headers, body: JSON.stringify({ idempotencyKey: voidKey, attemptId }) }); await first.body?.cancel();
    const second = await fetch(`${base}/transfer-attempts/void`, { method: 'POST', headers: user.headers, body: JSON.stringify({ idempotencyKey: voidKey, attemptId }) }); await second.body?.cancel();
    const third = await voidAttempt(user, voidKey, attemptId);
    assert.deepEqual([first.status, second.status, third.status], [200, 200, 200]);
    assert.equal(third.json.resolution, 'voided'); assert.equal(third.json.attempt.attemptId, attemptId); assertPrivate(third.json, 'void response');
    const closures = await closuresBy(user.userId, { key: voidKey }); assert.equal(closures.length, 1); assert.equal(closures[0]!.status, 'voided');
    const voidAudits = await audits(user.userId, 'transfer.attempt_voided'); assert.equal(voidAudits.length, 1);
    assert.equal(voidAudits[0]!.resource_id, closures[0]!.id); assert.equal(voidAudits[0]!.resource_type, 'transfer_attempt');
    const epoch = await epochOf(user);
    const results = [await voidAll(user, epoch), await voidAll(user, epoch), await voidAll(user, epoch)];
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
    assert.deepEqual(results.map((r) => r.json.advanced), [true, false, false]);
    assert.equal(await gateEpoch(user.userId), (BigInt(epoch) + 1n).toString());
    assert.ok(results.every((r) => r.json.sendEpoch === (BigInt(epoch) + 1n).toString()));
    const advanced = await audits(user.userId, 'transfer.send_epoch_advanced'); assert.equal(advanced.length, 1);
    assert.deepEqual(advanced[0]!.metadata, { from: epoch, to: (BigInt(epoch) + 1n).toString(), closedCount: 0 });
    expectProblem(await voidAll(user, (BigInt(epoch) + 5n).toString()), 400, 'about:blank', 'future fromEpoch');
  });

  await t.test('R8-06 send vs void races: forced orders, held send, 50 concurrent identities, void-all vs POST', async () => {
    await restart();
    const user = await register('races'); fixture('R8-06', user);
    const epoch = await epochOf(user);
    // (a) void first → late POST vetoed.
    const aKey = key(); const aAttempt = uuid();
    assert.equal((await voidAttempt(user, aKey, aAttempt)).json.resolution, 'voided');
    expectProblem(await postJson(user, own(user, '101'), { key: aKey, attemptId: aAttempt, epoch }), 409, VOIDED, '(a) late POST');
    assert.equal((await transfersByAttempt(user.userId, aAttempt)).length, 0);
    // (b) POST confirmed first → void finds it.
    const bKey = key(); const bAttempt = uuid(); const beforeB = await balances(user);
    const bPost = await postJson(user, own(user, '102'), { key: bKey, attemptId: bAttempt, epoch }); assert.equal(bPost.status, 201);
    const bVoid = await voidAttempt(user, bKey, bAttempt);
    assert.equal(bVoid.json.resolution, 'transfer_found'); assert.equal(bVoid.json.attempt.transferId, bPost.json.id); assert.equal(bVoid.json.attempt.status, 'completed');
    assert.equal(await debitsOf(String(bPost.json.id)), 1);
    assert.equal(BigInt(beforeB[user.principal.id]!) - BigInt((await balances(user))[user.principal.id]!), 102n);
    // (c) POST holds the gate and waits on an account lock; void waits on the gate; the POST commits; void reports it.
    const cKey = key(); const cAttempt = uuid();
    const lock = await lockAccount(user.savings.id);
    const cPost = postJson(user, own(user, '103'), { key: cKey, attemptId: cAttempt, epoch });
    await waitFor(async () => (await blockedBy(lock.pid)).length === 1, 'POST waiting on the account lock');
    const postPid = (await blockedBy(lock.pid))[0]!;
    const cVoid = voidAttempt(user, cKey, cAttempt);
    await waitFor(async () => (await blockedBy(postPid)).length > 0, 'void waiting on the send gate held by the POST');
    await lock.release();
    const [cPosted, cVoided] = await Promise.all([cPost, cVoid]);
    assert.equal(cPosted.status, 201); assert.equal(cVoided.json.resolution, 'transfer_found');
    assert.equal(cVoided.json.attempt.transferId, cPosted.json.id, 'void never hides the executed send');
    assert.equal(await debitsOf(String(cPosted.json.id)), 1); assert.equal((await closuresBy(user.userId, { key: cKey })).length, 0);

    const outcomes = { executed: 0, voided: 0 };
    const identities: Array<{ attemptId: string; key: string }> = [];
    for (let i = 0; i < 50; i += 1) {
      const raceKey = key(); const raceAttempt = uuid(); identities.push({ attemptId: raceAttempt, key: raceKey });
      const { send, close } = offsets(i);
      const [sent, voided] = await Promise.all([after(...send, () => postJson(user, own(user, String(1000 + i)), { key: raceKey, attemptId: raceAttempt, epoch })), after(...close, () => voidAttempt(user, raceKey, raceAttempt))]);
      if (sent.status === 201) { assert.equal(voided.json.resolution, 'transfer_found', `iteration ${i}`); assert.equal(voided.json.attempt.transferId, sent.json.id); outcomes.executed += 1; }
      else { expectProblem(sent, 409, VOIDED, `iteration ${i}`); assert.equal(voided.json.resolution, 'voided'); outcomes.voided += 1; }
    }
    for (const identity of identities) {
      const rows = await transfersByAttempt(user.userId, identity.attemptId); const closed = await closuresBy(user.userId, identity);
      assert.equal(rows.length + closed.length, 1, 'exactly one of transfer or closure per identity');
      if (rows[0]) { assert.equal(await debitsOf(rows[0].id), 1); assert.equal(await netOf(rows[0].id), 0n); }
    }
    console.log(JSON.stringify({ event: 'r8.race.post_vs_void', iterations: 50, ...outcomes }));
    assert.ok(outcomes.executed > 0 && outcomes.voided > 0, 'both interleavings were exercised');

    const allOutcomes = { executed: 0, vetoed: 0 };
    for (let i = 0; i < 20; i += 1) {
      const current = await epochOf(user); const raceKey = key(); const raceAttempt = uuid();
      const { send, close } = offsets(i);
      const [sent, all] = await Promise.all([after(...send, () => postJson(user, own(user, String(2000 + i)), { key: raceKey, attemptId: raceAttempt, epoch: current })), after(...close, () => voidAll(user, current))]);
      assert.equal(all.json.advanced, true);
      const rows = await transfersByAttempt(user.userId, raceAttempt);
      if (sent.status === 201) { assert.equal(rows.length, 1); assert.equal(rows[0]!.status, 'completed'); assert.equal(await debitsOf(rows[0]!.id), 1); allOutcomes.executed += 1; }
      else { expectProblem(sent, 409, VOIDED, `void-all iteration ${i}`); assert.equal(rows.length, 0); allOutcomes.vetoed += 1; }
      assert.equal((await closuresBy(user.userId, { key: raceKey, attemptId: raceAttempt })).length, 0);
    }
    console.log(JSON.stringify({ event: 'r8.race.post_vs_void_all', iterations: 20, ...allOutcomes }));
    assert.ok(allOutcomes.executed > 0 && allOutcomes.vetoed > 0, 'both interleavings were exercised');
    assert.equal(await ownerNet(user.userId), 0n);
  });

  await t.test('R8-07 late send vetoed after void and after void-all', async () => {
    await restart();
    const user = await register('late-send'); fixture('R8-07', user);
    const epoch = await epochOf(user); const lateKey = key(); const lateAttempt = uuid(); const body = own(user, '5000');
    assert.equal((await voidAttempt(user, lateKey, lateAttempt)).json.resolution, 'voided');
    const before = await snapshot(user);
    expectProblem(await postJson(user, body, { key: lateKey, attemptId: lateAttempt, epoch }), 409, VOIDED, 'same epoch');
    expectProblem(await postJson(user, body, { key: lateKey, attemptId: lateAttempt, epoch: await epochOf(user) }), 409, VOIDED, 'current epoch');
    expectProblem(await postJson(user, body, { key: lateKey }), 409, VOIDED, 'same key without headers');
    assert.deepEqual(await snapshot(user), before, 'no rows, balances or daily usage change');
    assert.equal((await voidAll(user, epoch)).json.advanced, true); const next = (BigInt(epoch) + 1n).toString();
    expectProblem(await postJson(user, body, { key: lateKey, attemptId: lateAttempt, epoch: next }), 409, VOIDED, 'voided identity with the new epoch');
    const beforeOld = await snapshot(user);
    expectProblem(await postJson(user, body, { key: key(), attemptId: uuid(), epoch }), 409, VOIDED, 'old epoch, new key');
    assert.deepEqual(await snapshot(user), beforeOld);
    expectProblem(await postJson(user, body, { key: key(), attemptId: uuid(), epoch: (BigInt(next) + 1n).toString() }), 400, 'about:blank', 'future epoch');
    expectProblem(await postJson(user, body, { key: key(), attemptId: uuid() }), 400, 'about:blank', 'only one header');
    expectProblem(await postJson(user, body, { key: key(), epoch: next }), 400, 'about:blank', 'only the other header');
    const fresh = await postJson(user, body, { key: key(), attemptId: uuid(), epoch: next }); assert.equal(fresh.status, 201);
  });

  await t.test('R8-08 voiding OTP-pending attempts, confirm vs void race, void-all scope', async () => {
    await restart();
    const user = await register('pending'); const other = await register('pending-other'); fixture('R8-08', user); fixture('R8-08-other', other);
    const epoch = await epochOf(user);
    const pendingKey = key(); const pendingAttempt = uuid();
    const pending = await postJson(user, own(user, '600000'), { key: pendingKey, attemptId: pendingAttempt, epoch }); assert.equal(pending.status, 202);
    const voided = await voidAttempt(user, pendingKey, pendingAttempt);
    assert.equal(voided.json.resolution, 'transfer_found'); assert.equal(voided.json.attempt.status, 'cancelled'); assertPrivate(voided.json, 'void of pending');
    const cancelledAudit = (await audits(user.userId, 'transfer.cancelled')).filter((row) => row.resource_id === pending.json.id);
    assert.deepEqual(cancelledAudit.map((row) => row.metadata), [{ via: 'void' }]);
    const late = await confirm(user, String(pending.json.id), String(pending.json.demoOnlyCode)); assert.equal(late.status, 409);
    assert.equal((await postings(String(pending.json.id))).length, 0);
    const expiringKey = key(); const expiringAttempt = uuid();
    const expiring = await postJson(user, own(user, '600001'), { key: expiringKey, attemptId: expiringAttempt, epoch }); assert.equal(expiring.status, 202);
    await q("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1", [expiring.json.id]);
    const expiredVoid = await voidAttempt(user, expiringKey, expiringAttempt);
    assert.equal(expiredVoid.json.attempt.status, 'expired');
    assert.deepEqual((await audits(user.userId, 'transfer.expired')).filter((row) => row.resource_id === expiring.json.id).map((row) => row.metadata), [{ via: 'void' }]);

    const outcomes = { completed: 0, cancelled: 0 };
    for (let i = 0; i < 20; i += 1) {
      const raceKey = key(); const raceAttempt = uuid();
      const created = await postJson(user, own(user, String(500000 + i)), { key: raceKey, attemptId: raceAttempt, epoch }); assert.equal(created.status, 202);
      const [confirmed, raced] = await Promise.all([after(...(i % 2 === 0 ? [0, 1] as [number, number] : [10, 20] as [number, number]), () => confirm(user, String(created.json.id), String(created.json.demoOnlyCode))), voidAttempt(user, raceKey, raceAttempt)]);
      const entries = await postings(String(created.json.id));
      if (confirmed.status === 200) { assert.equal(raced.json.attempt.status, 'completed'); assert.equal(entries.length, 2); assert.equal(await debitsOf(String(created.json.id)), 1); outcomes.completed += 1; }
      else { assert.equal(confirmed.status, 409); assert.equal(raced.json.attempt.status, 'cancelled'); assert.equal(entries.length, 0); outcomes.cancelled += 1; }
      assert.equal(raced.json.resolution, 'transfer_found');
    }
    console.log(JSON.stringify({ event: 'r8.race.confirm_vs_void', iterations: 20, ...outcomes }));
    assert.ok(outcomes.completed > 0 && outcomes.cancelled > 0, 'both interleavings were exercised');

    const mine: string[] = []; const theirs: string[] = [];
    for (let i = 0; i < 3; i += 1) mine.push(String((await postJson(user, own(user, '650000'), { key: key(), attemptId: uuid(), epoch })).json.id));
    mine.push(String((await postJson(user, own(user, '650001'), { key: key() })).json.id)); // header-less (web-like) pending is closed too (D4)
    const otherEpoch = await epochOf(other);
    for (let i = 0; i < 2; i += 1) theirs.push(String((await postJson(other, own(other, '650000'), { key: key(), attemptId: uuid(), epoch: otherEpoch })).json.id));
    const all = await voidAll(user, epoch);
    assert.equal(all.json.advanced, true); assert.deepEqual([...all.json.closedTransferIds].sort(), [...mine].sort());
    const states = await q<{ id: string; status: string }>('SELECT id,status FROM transfers WHERE id=ANY($1::uuid[])', [[...mine, ...theirs]]);
    for (const row of states) assert.equal(row.status, mine.includes(row.id) ? 'cancelled' : 'awaiting_confirmation');
    assert.equal(await gateEpoch(other.userId), otherEpoch);
    const viaAll = (await audits(user.userId, 'transfer.cancelled')).filter((row) => mine.includes(row.resource_id));
    assert.equal(viaAll.length, 4); assert.ok(viaAll.every((row) => row.metadata.via === 'void_all'));
    assert.deepEqual((await audits(user.userId, 'transfer.send_epoch_advanced')).at(-1)!.metadata, { from: epoch, to: (BigInt(epoch) + 1n).toString(), closedCount: 4 });
    assert.equal(await ownerNet(user.userId), 0n);
  });

  await t.test('R8-09 terminal rejections with headers, header-less re-evaluation, and 8 concurrent sends of one key', async () => {
    await restart();
    const user = await register('rejections'); fixture('R8-09', user);
    const epoch = await epochOf(user);
    const rejectCase = async (label: string, body: Json, status: number, setup?: () => void, teardown?: () => void) => {
      const caseKey = key(); const caseAttempt = uuid(); const before = await snapshot(user);
      setup?.(); const result = await postJson(user, body, { key: caseKey, attemptId: caseAttempt, epoch }); teardown?.();
      expectProblem(result, status, REJECTED, label);
      const closures = await closuresBy(user.userId, { key: caseKey }); assert.equal(closures.length, 1); assert.equal(closures[0]!.status, 'rejected'); assert.equal(closures[0]!.problem_status, status);
      const after = await snapshot(user);
      assert.deepEqual(after.balances, before.balances); assert.deepEqual(after.usage, before.usage);
      assert.equal(after.counts.transfers, before.counts.transfers); assert.equal(after.counts.entries, before.counts.entries); assert.equal(after.counts.closures, before.counts.closures + 1);
      const audit = (await audits(user.userId, 'transfer.attempt_rejected')).filter((row) => row.resource_id === closures[0]!.id);
      assert.deepEqual(audit.map((row) => row.metadata), [{ status }]);
      return { caseKey, caseAttempt, body, result };
    };
    const insufficient = await rejectCase('422 balance', fromSavings(user, '200000'), 422);
    assert.equal(insufficient.result.json.detail, 'Saldo insuficiente.');
    await rejectCase('429 daily limit', own(user, '2'), 429, () => { process.env.DAILY_TRANSFER_LIMIT_MINOR = '1'; }, () => { process.env.DAILY_TRANSFER_LIMIT_MINOR = '900000000000'; });
    await rejectCase('404 beneficiary', { sourceAccountId: user.principal.id, destinationType: 'beneficiary', beneficiaryId: uuid(), amountMinor: '10', concept: 'R8 sin beneficiario', reference: '83' }, 404);

    const webKey = key(); const webBody = fromSavings(user, '300000');
    const closuresBefore = (await counts(user)).closures;
    expectProblem(await postJson(user, webBody, { key: webKey }), 422, 'about:blank', 'header-less 422');
    assert.equal((await counts(user)).closures, closuresBefore, 'header-less rejection leaves no closure');
    await fund(user.savings.id, 1_000_000n);
    expectProblem(await postJson(user, insufficient.body, { key: insufficient.caseKey, attemptId: insufficient.caseAttempt, epoch }), 422, REJECTED, 'replay after funding stays rejected');
    assert.equal((await transfersByAttempt(user.userId, insufficient.caseAttempt)).length, 0);
    const reevaluated = await postJson(user, webBody, { key: webKey }); assert.equal(reevaluated.status, 201, 'header-less 422 is re-evaluated as today');
    expectProblem(await postJson(user, own(user, '999'), { key: insufficient.caseKey, attemptId: insufficient.caseAttempt, epoch }), 409, 'about:blank', 'rejected key with another payload');
    expectProblem(await postJson(user, own(user, '999'), { key: key(), attemptId: insufficient.caseAttempt, epoch }), 409, CONFLICT, 'rejected identity with another key');

    for (const withIdentity of [true, false]) {
      const sameKey = key(); const sameAttempt = uuid(); const body = own(user, withIdentity ? '777' : '778');
      const responses = await Promise.all(Array.from({ length: 8 }, () => postJson(user, body, withIdentity ? { key: sameKey, attemptId: sameAttempt, epoch } : { key: sameKey })));
      assert.deepEqual(responses.map((r) => r.status), Array.from({ length: 8 }, () => 201), `8 concurrent sends (${withIdentity ? 'headers' : 'no headers'}) never answer 409 in progress`);
      const ids = new Set(responses.map((r) => r.json.id)); assert.equal(ids.size, 1);
      const transferId = String(responses[0]!.json.id);
      assert.equal((await q('SELECT 1 FROM idempotency_records WHERE user_id=$1 AND key_hash=$2', [user.userId, hashSecret(sameKey)])).length, 1);
      assert.equal(await debitsOf(transferId), 1); assert.equal(await netOf(transferId), 0n);
      if (withIdentity) assert.equal((await transfersByAttempt(user.userId, sameAttempt)).length, 1);
    }
    const otherKey = key(); const boundAttempt = uuid();
    assert.equal((await postJson(user, own(user, '779'), { key: otherKey, attemptId: boundAttempt, epoch })).status, 201);
    expectProblem(await postJson(user, own(user, '779'), { key: key(), attemptId: boundAttempt, epoch }), 409, CONFLICT, 'identity bound to another key');
    expectProblem(await postJson(user, own(user, '779'), { key: otherKey, attemptId: uuid(), epoch }), 409, CONFLICT, 'key bound to another identity');
    assert.equal(await ownerNet(user.userId), 0n);
  });

  await t.test('R8-10 OTP threshold preserved (amount >= threshold): 4,999.99 → 201, 5,000.00 → 202, 5,000.01 → 202', async () => {
    await restart();
    const user = await register('threshold'); fixture('R8-10', user);
    const epoch = await epochOf(user);
    for (const headers of [true, false]) {
      const statuses: number[] = [];
      for (const amount of ['499999', '500000', '500001']) statuses.push((await postJson(user, own(user, amount), headers ? { key: key(), attemptId: uuid(), epoch } : { key: key() })).status);
      assert.deepEqual(statuses, [201, 202, 202], headers ? 'with headers' : 'without headers');
    }
  });

  await t.test('R8-11 isolation between users', async () => {
    await restart();
    const alice = await register('iso-a'); const bob = await register('iso-b'); fixture('R8-11-a', alice); fixture('R8-11-b', bob);
    const aliceEpoch = await epochOf(alice); const aliceKey = key(); const aliceAttempt = uuid(); const body = own(alice, '4321');
    const sent = await postJson(alice, body, { key: aliceKey, attemptId: aliceAttempt, epoch: aliceEpoch }); assert.equal(sent.status, 201);
    const alicePending = await postJson(alice, own(alice, '600000'), { key: key(), attemptId: uuid(), epoch: aliceEpoch }); assert.equal(alicePending.status, 202);
    const bobList = await list(bob, { limit: '50' }); assert.deepEqual(bobList.json.items, []);
    const foreign = await list(bob, { attemptId: aliceAttempt }); const missing = await list(bob, { attemptId: uuid() });
    assert.deepEqual(foreign.json, missing.json, 'a foreign attemptId behaves like a nonexistent one');
    const bobVoid = await voidAttempt(bob, aliceKey); assert.equal(bobVoid.json.resolution, 'voided', 'void with a foreign key closes it only in the caller scope');
    const replay = await postJson(alice, body, { key: aliceKey, attemptId: aliceAttempt, epoch: aliceEpoch });
    assert.equal(replay.status, 201); assert.equal(replay.json.id, sent.json.id);
    const bobAll = await voidAll(bob, await epochOf(bob)); assert.equal(bobAll.json.advanced, true); assert.deepEqual(bobAll.json.closedTransferIds, []);
    assert.equal(await gateEpoch(alice.userId), aliceEpoch);
    assert.equal((await q<{ status: string }>('SELECT status FROM transfers WHERE id=$1', [alicePending.json.id]))[0]!.status, 'awaiting_confirmation');
    assert.equal((await fetch(`${base}/transfers/${sent.json.id}`, { headers: bob.headers })).status, 404);
    assert.equal((await closuresBy(alice.userId, { key: aliceKey })).length, 0);
  });

  await t.test('R8-12 expiration policy: replay indefinite, retention days configurable', async () => {
    await restart();
    const user = await register('expiration'); fixture('R8-12', user);
    const epoch = await epochOf(user); const oldKey = key(); const oldAttempt = uuid(); const body = own(user, '2468');
    const sent = await postJson(user, body, { key: oldKey, attemptId: oldAttempt, epoch }); assert.equal(sent.status, 201);
    await q("UPDATE idempotency_records SET expires_at=now()-interval '45 days' WHERE user_id=$1 AND key_hash=$2", [user.userId, hashSecret(oldKey)]);
    const before = await counts(user);
    const replay = await postJson(user, body, { key: oldKey, attemptId: oldAttempt, epoch });
    assert.equal(replay.status, 201); assert.equal(replay.json.id, sent.json.id); assert.equal(replay.json.status, 'completed');
    const found = await voidAttempt(user, oldKey, oldAttempt); assert.equal(found.json.resolution, 'transfer_found'); assert.equal(found.json.attempt.transferId, sent.json.id);
    assert.deepEqual(await counts(user), before, 'no new rows after an expired retention date');
    process.env.IDEMPOTENCY_RECORD_RETENTION_DAYS = '2';
    try {
      const pending = await postJson(user, own(user, '600000'), { key: key(), attemptId: uuid(), epoch }); assert.equal(pending.status, 202);
      assert.equal((await confirm(user, String(pending.json.id), String(pending.json.demoOnlyCode))).status, 200);
      const rows = await q<{ operation: string; delta: string }>("SELECT operation,(expires_at-created_at)::text AS delta FROM idempotency_records WHERE user_id=$1 AND transfer_id=$2 ORDER BY operation", [user.userId, pending.json.id]);
      assert.deepEqual(rows, [{ operation: 'confirm-transfer', delta: '2 days' }, { operation: 'create-transfer', delta: '2 days' }]);
    } finally { process.env.IDEMPOTENCY_RECORD_RETENTION_DAYS = '30'; }
  });

  await t.test('R8-14 recovery from another client: applied and never-arrived sends', async () => {
    await restart();
    const owner = await register('other-client'); fixture('R8-14', owner);
    const deviceA = await mobileLogin(owner, 'device-a'); const deviceB = await mobileLogin(owner, 'device-b');
    const epoch = await epochOf(deviceA);
    const appliedKey = key(); const appliedAttempt = uuid(); const appliedBody = own(deviceA, '1111');
    const lost = await post(deviceA, appliedBody, { key: appliedKey, attemptId: appliedAttempt, epoch }); await lost.body?.cancel(); // response lost
    const neverKey = key(); const neverAttempt = uuid(); const neverBody = own(deviceA, '2222'); // persisted locally, never reached the server
    const seen = await list(deviceB, { limit: '50' });
    const applied = seen.json.items.find((item) => item.attemptId === appliedAttempt);
    assert.ok(applied?.transferId, 'device B sees the applied attempt with its attemptId');
    assert.equal(seen.json.items.some((item) => item.attemptId === neverAttempt), false);
    const all = await voidAll(deviceB, seen.json.sendEpoch); assert.equal(all.json.advanced, true);
    const readBack = await list(deviceA, { attemptId: appliedAttempt, limit: '1' });
    assert.equal(readBack.json.items[0]?.transferId, applied!.transferId);
    const replay = await postJson(deviceA, appliedBody, { key: appliedKey, attemptId: appliedAttempt, epoch });
    assert.equal(replay.status, 201, 'an executed send is never hidden by a later epoch'); assert.equal(replay.json.id, applied!.transferId);
    expectProblem(await postJson(deviceA, neverBody, { key: neverKey, attemptId: neverAttempt, epoch }), 409, VOIDED, 'never-arrived send after void-all');
    assert.equal((await transfersByAttempt(owner.userId, neverAttempt)).length, 0);
    assert.equal(await debitsOf(applied!.transferId!), 1); assert.equal(await netOf(applied!.transferId!), 0n); assert.equal(await ownerNet(owner.userId), 0n);
  });

  await t.test('R8-13 audit and privacy across the whole suite (audit metadata and process logs)', async () => {
    const userIds = [...new Set(users.map((user) => user.userId))];
    const events = await q<{ action: string; metadata: Json }>('SELECT action,metadata FROM audit_events WHERE actor_id=ANY($1::uuid[])', [userIds]);
    const actions = new Set(events.map((event) => event.action));
    for (const action of ['transfer.attempt_voided', 'transfer.attempt_rejected', 'transfer.cancelled', 'transfer.expired', 'transfer.send_epoch_advanced']) assert.ok(actions.has(action), `audit has ${action}`);
    const closureHashes = (await q<{ key_hash: string }>('SELECT key_hash FROM transfer_attempt_closures WHERE owner_id=ANY($1::uuid[])', [userIds])).map((row) => row.key_hash);
    const recordHashes = (await q<{ key_hash: string }>('SELECT key_hash FROM idempotency_records WHERE user_id=ANY($1::uuid[])', [userIds])).map((row) => row.key_hash);
    const secrets = [...usedKeys, ...[...usedKeys].map(hashSecret), ...closureHashes, ...recordHashes, ...knownClabes];
    const auditDump = JSON.stringify(events);
    for (const secret of secrets) assert.ok(!auditDump.includes(secret), 'audit metadata contains no key, key hash or CLABE');
    assert.ok(!/(?<!\d)\d{18}(?!\d)/.test(auditDump), 'no 18-digit value in audit metadata');
    // OTP codes are 6 digits: match them as standalone tokens (not inside UUID hex or the amountMinor of transfer.created).
    const token = (value: string) => new RegExp(`(?<![0-9a-fA-F])${value}(?![0-9a-fA-F])`);
    const metadataWithoutAmounts = JSON.stringify(events.map((event) => { const { amountMinor: _amount, ...rest } = event.metadata; void _amount; return rest; }));
    for (const code of seenCodes) assert.ok(!token(code).test(metadataWithoutAmounts), 'audit metadata contains no OTP');
    assert.ok(events.every((event) => !Object.keys(event.metadata).some((name) => /code|otp|key|clabe/i.test(name))), 'no secret-like metadata fields');
    const logs = captured.join('\n');
    for (const secret of secrets) assert.ok(!logs.includes(secret), 'process logs contain no key, key hash or CLABE');
    for (const code of seenCodes) assert.ok(!token(code).test(logs), 'process logs contain no OTP');
    assert.ok(!/(?<!\d)\d{18}(?!\d)/.test(logs), 'no 18-digit value in process logs');
    console.log(JSON.stringify({ event: 'r8.privacy', auditEvents: events.length, keysChecked: usedKeys.size, codesChecked: seenCodes.size, clabesChecked: knownClabes.size, logLines: captured.length }));
  });
});
