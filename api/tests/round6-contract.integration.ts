import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
import { dataSource } from '../src/db/data-source.js';
import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import { createApp } from '../src/http/app.js';

type Account = { id: string; name: string; kind: string; clabe: string; availableBalanceMinor: string };
type Beneficiary = { id: string; name: string; destinationAccountId: string; ownAccountId?: string; clabeMasked: string };
type Transfer = { id: string; status: string; createdAt: string; completedAt: string | null; expiresAt: string | null; receiptReference: string | null; demoOnlyCode?: string; destination: Record<string, unknown> };
type Movement = { id: string; transferId: string; type: string; amountMinor: string; occurredAt: string; reference: string; counterparty: { name: string; clabeMasked: string; ownAccountId?: string } };

const isoMillisZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('round 6 contract: own-account identity, transfer policy, OTP expiry/cancel lifecycle, receipts and history in wallet_test', async (t) => {
  const testUrl = assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  process.env.DATABASE_URL = testUrl.toString(); process.env.APP_ENV = 'development'; process.env.WEB_ORIGIN = 'http://localhost:5173';
  process.env.DEMO_FIXTURE_ENABLED = 'true'; process.env.DEMO_PRIMARY_BALANCE_MINOR = '5000000'; process.env.DEMO_SAVINGS_BALANCE_MINOR = '100000';
  process.env.BUSINESS_TIME_ZONE = 'America/Mexico_City'; process.env.DAILY_TRANSFER_LIMIT_MINOR = '2000000'; process.env.OTP_THRESHOLD_MINOR = '500000';
  process.env.OTP_EXPIRY_SECONDS = '300'; process.env.OTP_MAX_ATTEMPTS = '5';
  const source = dataSource(testUrl.toString()); await source.initialize();
  const server = createServer(createApp()); await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  t.after(async () => { if (server.listening) await new Promise<void>((closed, reject) => server.close((error) => error ? reject(error) : closed())); if (source.isInitialized) await source.destroy(); });
  const address = server.address(); assert(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}/v1`;

  async function register(fullName: string) {
    const csrfResponse = await fetch(`${base}/auth/csrf`); const csrf = (await csrfResponse.json() as { csrfToken: string }).csrfToken;
    const cookie = csrfResponse.headers.getSetCookie().find((value) => value.startsWith('wallet_csrf='))!.split(';')[0]!;
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, cookie, origin: 'http://localhost:5173' }, body: JSON.stringify({ fullName, email: `r6-${crypto.randomUUID()}@example.test`, password: 'correct horse battery staple' }) });
    assert.equal(response.status, 201);
    const token = (await response.json() as { accessToken: string }).accessToken;
    const userId = String((await jwtVerify(token, new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))).payload.sub);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const accounts = (await (await fetch(`${base}/accounts`, { headers })).json() as { items: Account[] }).items;
    return { headers, userId, fullName, principal: accounts.find((a) => a.kind === 'checking')!, savings: accounts.find((a) => a.kind === 'savings')! };
  }
  const key = () => crypto.randomUUID() + crypto.randomUUID();
  const alice = await register('Alicia Ronda Seis'); const bob = await register('Bruno Ronda Seis');
  assert.ok(alice.principal && alice.savings && bob.principal, 'fixture registration must create principal and savings accounts');
  const post = (who: typeof alice, body: Record<string, string>, idempotencyKey = key()) => fetch(`${base}/transfers`, { method: 'POST', headers: { ...who.headers, 'idempotency-key': idempotencyKey }, body: JSON.stringify(body) });
  const confirm = (who: typeof alice, id: string, code: string, idempotencyKey = key()) => fetch(`${base}/transfers/${id}/confirm`, { method: 'POST', headers: { ...who.headers, 'idempotency-key': idempotencyKey }, body: JSON.stringify({ code }) });
  const cancel = (who: typeof alice, id: string) => fetch(`${base}/transfers/${id}/cancel`, { method: 'POST', headers: who.headers });
  const balances = async (...ids: string[]) => new Map<string, bigint>((await source.query('SELECT id,balance_minor::text AS b FROM accounts WHERE id=ANY($1::uuid[])', [ids])).map((row: { id: string; b: string }) => [row.id, BigInt(row.b)] as const));
  const ledgerFor = async (transferId: string) => source.query("SELECT le.account_id,le.signed_amount_minor::text AS amount FROM ledger_transactions lt JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE lt.reference_type='transfer' AND lt.reference_id=$1", [transferId]) as Promise<Array<{ account_id: string; amount: string }>>;
  const transferCount = async (userId: string) => Number((await source.query('SELECT count(*)::int AS n FROM transfers WHERE owner_id=$1', [userId]))[0].n);
  const movements = async (who: typeof alice, accountId: string) => (await (await fetch(`${base}/accounts/${accountId}/movements?limit=100`, { headers: who.headers })).json() as { items: Movement[] }).items;

  // --- Beneficiary identity: ownAccountId only when the beneficiary resolves to an account of the same user.
  const ownBenResponse = await fetch(`${base}/beneficiaries`, { method: 'POST', headers: alice.headers, body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro', clabe: alice.savings.clabe }) });
  assert.equal(ownBenResponse.status, 201); const ownBen = await ownBenResponse.json() as Beneficiary;
  assert.equal(ownBen.ownAccountId, alice.savings.id); assert.equal(ownBen.destinationAccountId, alice.savings.id);
  const thirdBenResponse = await fetch(`${base}/beneficiaries`, { method: 'POST', headers: alice.headers, body: JSON.stringify({ name: 'Bruno tercero', alias: 'Bruno', clabe: bob.principal.clabe }) });
  assert.equal(thirdBenResponse.status, 201); const thirdBen = await thirdBenResponse.json() as Beneficiary;
  assert.equal('ownAccountId' in thirdBen, false, 'a third-party beneficiary must never carry ownAccountId');
  const listed = (await (await fetch(`${base}/beneficiaries`, { headers: alice.headers })).json() as { items: Beneficiary[] }).items;
  assert.equal(listed.find((b) => b.id === ownBen.id)?.ownAccountId, alice.savings.id);
  assert.equal('ownAccountId' in listed.find((b) => b.id === thirdBen.id)!, false);
  const fetchedOwn = await (await fetch(`${base}/beneficiaries/${ownBen.id}`, { headers: alice.headers })).json() as Beneficiary;
  assert.equal(fetchedOwn.ownAccountId, alice.savings.id);

  // --- Origin = destination resolved through the beneficiary is rejected by the server, with no side effects.
  const beforeSelf = await balances(alice.principal.id, alice.savings.id); const countBeforeSelf = await transferCount(alice.userId);
  const savingsToSavings = await post(alice, { sourceAccountId: alice.savings.id, destinationType: 'beneficiary', beneficiaryId: ownBen.id, amountMinor: '100', concept: 'Ahorro a ahorro', reference: '5719' });
  assert.equal(savingsToSavings.status, 422);
  assert.deepEqual(await balances(alice.principal.id, alice.savings.id), beforeSelf); assert.equal(await transferCount(alice.userId), countBeforeSelf);
  const principalToSavingsViaBen = await post(alice, { sourceAccountId: alice.principal.id, destinationType: 'beneficiary', beneficiaryId: ownBen.id, amountMinor: '1000', concept: 'Principal a ahorro', reference: '1' });
  assert.equal(principalToSavingsViaBen.status, 201);
  const viaBen = await principalToSavingsViaBen.json() as Transfer;
  assert.equal(viaBen.status, 'completed'); assert.equal(viaBen.destination.ownAccountId, alice.savings.id);

  // --- Principal -> Ahorro (own_account): exact debit/credit in minor units, total conserved, balanced ledger.
  const amount = 123456n;
  const before = await balances(alice.principal.id, alice.savings.id);
  const exactResponse = await post(alice, { sourceAccountId: alice.principal.id, destinationType: 'own_account', destinationAccountId: alice.savings.id, amountMinor: amount.toString(), concept: 'Ahorro mensual', reference: '4445' });
  assert.equal(exactResponse.status, 201); const exact = await exactResponse.json() as Transfer;
  assert.equal(exact.status, 'completed'); assert.match(exact.createdAt, isoMillisZ); assert.match(exact.completedAt!, isoMillisZ); assert.equal(exact.expiresAt, null);
  const after = await balances(alice.principal.id, alice.savings.id);
  assert.equal(before.get(alice.principal.id)! - after.get(alice.principal.id)!, amount, 'principal debited exactly');
  assert.equal(after.get(alice.savings.id)! - before.get(alice.savings.id)!, amount, 'savings credited exactly');
  assert.equal(before.get(alice.principal.id)! + before.get(alice.savings.id)!, after.get(alice.principal.id)! + after.get(alice.savings.id)!, 'total conserved');
  const exactLedger = await ledgerFor(exact.id);
  assert.equal(exactLedger.length, 2);
  assert.equal(BigInt(exactLedger.find((e) => e.account_id === alice.principal.id)!.amount), -amount);
  assert.equal(BigInt(exactLedger.find((e) => e.account_id === alice.savings.id)!.amount), amount);

  // --- Receipt and history agree: sent movement on origin, received movement on destination, correct counterparty.
  const receipt = await (await fetch(`${base}/transfers/${exact.id}`, { headers: alice.headers })).json() as Transfer;
  assert.equal(receipt.status, 'completed'); assert.equal(receipt.receiptReference, exact.id); assert.equal(receipt.completedAt, exact.completedAt);
  const sent = (await movements(alice, alice.principal.id)).find((m) => m.transferId === exact.id)!;
  const received = (await movements(alice, alice.savings.id)).find((m) => m.transferId === exact.id)!;
  assert.equal(sent.type, 'debit'); assert.equal(sent.amountMinor, amount.toString()); assert.equal(sent.reference, '4445');
  assert.equal(sent.counterparty.ownAccountId, alice.savings.id); assert.equal(sent.counterparty.name, alice.savings.name); assert.match(sent.counterparty.clabeMasked, /^\d{3}•+\d{4}$/);
  assert.equal(received.type, 'credit'); assert.equal(received.amountMinor, amount.toString());
  assert.equal(received.counterparty.ownAccountId, alice.principal.id); assert.equal(received.counterparty.name, alice.principal.name);
  for (const movement of [sent, received]) { assert.match(movement.occurredAt, isoMillisZ, 'occurredAt uses the ECMAScript date-time string format (ms + Z)'); assert.ok(Number.isFinite(Date.parse(movement.occurredAt))); }

  // --- Cross-user: sender sees the beneficiary; recipient sees the sender's name and masked CLABE, never an ownAccountId.
  const crossResponse = await post(alice, { sourceAccountId: alice.principal.id, destinationType: 'beneficiary', beneficiaryId: thirdBen.id, amountMinor: '50000', concept: 'Pago a Bruno', reference: '77' });
  assert.equal(crossResponse.status, 201); const cross = await crossResponse.json() as Transfer;
  const crossSent = (await movements(alice, alice.principal.id)).find((m) => m.transferId === cross.id)!;
  assert.equal(crossSent.counterparty.name, 'Bruno tercero'); assert.equal('ownAccountId' in crossSent.counterparty, false);
  const crossReceived = (await movements(bob, bob.principal.id)).find((m) => m.transferId === cross.id)!;
  assert.equal(crossReceived.type, 'credit'); assert.equal(crossReceived.counterparty.name, alice.fullName); assert.equal('ownAccountId' in crossReceived.counterparty, false);
  assert.ok(crossReceived.counterparty.clabeMasked.endsWith(alice.principal.clabe.slice(-4)));
  assert.equal((await fetch(`${base}/transfers/${cross.id}`, { headers: bob.headers })).status, 404, 'the recipient still cannot read the sender-owned transfer');

  // --- Uncertain create retried with the same key never creates a second transfer.
  const uncertainKey = key(); const uncertainBody = { sourceAccountId: alice.principal.id, destinationType: 'own_account', destinationAccountId: alice.savings.id, amountMinor: '700', concept: 'Incierto', reference: '9' };
  const countBeforeUncertain = await transferCount(alice.userId);
  const lost = await post(alice, uncertainBody, uncertainKey); assert.equal(lost.status, 201); await lost.body?.cancel();
  const retried = await post(alice, uncertainBody, uncertainKey); assert.equal(retried.status, 201); const retriedDto = await retried.json() as Transfer;
  const retriedAgain = await post(alice, uncertainBody, uncertainKey); assert.equal((await retriedAgain.json() as Transfer).id, retriedDto.id);
  assert.equal(await transferCount(alice.userId), countBeforeUncertain + 1); assert.equal((await ledgerFor(retriedDto.id)).length, 2);

  // --- Server transfer policy (demo configuration, not approved production policy).
  assert.equal((await fetch(`${base}/transfer-policy`)).status, 401);
  const policyResponse = await fetch(`${base}/transfer-policy`, { headers: alice.headers }); assert.equal(policyResponse.status, 200);
  const policy = await policyResponse.json() as Record<string, unknown>;
  const usage = await source.query("SELECT business_date::text AS day,outgoing_minor::text AS used FROM daily_limit_usage WHERE owner_id=$1 AND business_date=(now() AT TIME ZONE 'America/Mexico_City')::date", [alice.userId]);
  const used = BigInt(usage[0].used);
  assert.equal(used, 1000n + amount + 50000n + 700n);
  assert.deepEqual(policy, { currency: 'MXN', businessDate: usage[0].day, businessTimeZone: 'America/Mexico_City', dailyLimitMinor: '2000000', dailyUsedMinor: used.toString(), dailyRemainingMinor: (2000000n - used).toString(), otpThresholdMinor: '500000', otpExpirySeconds: 300, otpMaxAttempts: 5, demoOnly: true });
  const bobPolicy = await (await fetch(`${base}/transfer-policy`, { headers: bob.headers })).json() as { dailyUsedMinor: string };
  assert.equal(bobPolicy.dailyUsedMinor, '0', 'daily usage is per authenticated user');

  // --- OTP pending exposes expiresAt; confirm retried with the same key (uncertain) completes once (F-06 server side).
  const otpBody = { sourceAccountId: alice.principal.id, destinationType: 'own_account', destinationAccountId: alice.savings.id, amountMinor: '600000', concept: 'Con OTP', reference: '600' };
  const pendingResponse = await post(alice, otpBody); assert.equal(pendingResponse.status, 202); const pending = await pendingResponse.json() as Transfer;
  assert.equal(pending.status, 'awaiting_confirmation'); assert.match(pending.expiresAt!, isoMillisZ);
  const ttl = (Date.parse(pending.expiresAt!) - Date.parse(pending.createdAt)) / 1000; assert.ok(ttl > 295 && ttl <= 301, `expiresAt must be createdAt + OTP_EXPIRY_SECONDS, got ${ttl}s`);
  const wrongCode = pending.demoOnlyCode === '000000' ? '000001' : '000000'; const wrongKey = key();
  assert.equal((await confirm(alice, pending.id, wrongCode, wrongKey)).status, 422);
  const wrongReplay = await confirm(alice, pending.id, wrongCode, wrongKey);
  assert.equal(wrongReplay.status, 422, 'replaying a failed confirm key must replay the failure, never an empty 200');
  const confirmKey = key(); const beforeConfirm = await balances(alice.principal.id, alice.savings.id);
  const firstConfirm = await confirm(alice, pending.id, pending.demoOnlyCode!, confirmKey); assert.equal(firstConfirm.status, 200); await firstConfirm.body?.cancel();
  const confirmRetry = await confirm(alice, pending.id, pending.demoOnlyCode!, confirmKey); assert.equal(confirmRetry.status, 200);
  assert.equal((await confirmRetry.json() as Transfer).status, 'completed');
  assert.equal((await confirm(alice, pending.id, pending.demoOnlyCode!)).status, 409, 'a new confirm key on a completed attempt is a conflict');
  const afterConfirm = await balances(alice.principal.id, alice.savings.id);
  assert.equal(beforeConfirm.get(alice.principal.id)! - afterConfirm.get(alice.principal.id)!, 600000n); assert.equal((await ledgerFor(pending.id)).length, 2);
  const freshPendingResponse = await post(alice, otpBody, key()); assert.equal(freshPendingResponse.status, 202); const freshPending = await freshPendingResponse.json() as Transfer;
  assert.equal((await cancel(alice, pending.id)).status, 409, 'a completed transfer cannot be cancelled');

  // --- Explicit cancel: idempotent, auditable, owner-only; a cancelled attempt never moves money.
  const beforeCancel = await balances(alice.principal.id, alice.savings.id);
  assert.equal((await cancel(bob, freshPending.id)).status, 404);
  const cancelled = await cancel(alice, freshPending.id); assert.equal(cancelled.status, 200); assert.equal((await cancelled.json() as Transfer).status, 'cancelled');
  const cancelledAgain = await cancel(alice, freshPending.id); assert.equal(cancelledAgain.status, 200); assert.equal((await cancelledAgain.json() as Transfer).status, 'cancelled');
  assert.equal((await confirm(alice, freshPending.id, freshPending.demoOnlyCode!)).status, 409);
  assert.equal(((await (await fetch(`${base}/transfers/${freshPending.id}`, { headers: alice.headers })).json()) as Transfer).status, 'cancelled');
  assert.deepEqual(await balances(alice.principal.id, alice.savings.id), beforeCancel); assert.equal((await ledgerFor(freshPending.id)).length, 0);
  const cancelledRow = await source.query('SELECT status,closed_at FROM transfers WHERE id=$1', [freshPending.id]); assert.equal(cancelledRow[0].status, 'cancelled'); assert.ok(cancelledRow[0].closed_at);
  const cancelAudit = await source.query("SELECT count(*)::int AS n FROM audit_events WHERE resource_id=$1 AND action='transfer.cancelled'", [freshPending.id]); assert.equal(cancelAudit[0].n, 1, 'cancel is audited exactly once');
  await assert.rejects(source.query("UPDATE transfers SET status='completed' WHERE id=$1", [freshPending.id]), /terminal state/, 'the database forbids leaving a terminal state');
  await assert.rejects(source.query("UPDATE transfers SET closed_at=NULL WHERE id=$1", [freshPending.id]), /transfers_closed_at_check/);

  // --- Deterministic expiry: lazily materialized on read, with no balance effects; confirm afterwards never moves money.
  const expiringResponse = await post(alice, otpBody); assert.equal(expiringResponse.status, 202); const expiring = await expiringResponse.json() as Transfer;
  await source.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1", [expiring.id]);
  const beforeExpiry = await balances(alice.principal.id, alice.savings.id);
  const expiredRead = await (await fetch(`${base}/transfers/${expiring.id}`, { headers: alice.headers })).json() as Transfer;
  assert.equal(expiredRead.status, 'expired');
  assert.equal((await confirm(alice, expiring.id, expiring.demoOnlyCode!)).status, 409);
  const expiredCancel = await cancel(alice, expiring.id); assert.equal(expiredCancel.status, 200); assert.equal((await expiredCancel.json() as Transfer).status, 'expired', 'cancel on an expired attempt keeps it expired');
  assert.deepEqual(await balances(alice.principal.id, alice.savings.id), beforeExpiry); assert.equal((await ledgerFor(expiring.id)).length, 0);
  const expiryAudit = await source.query("SELECT count(*)::int AS n FROM audit_events WHERE resource_id=$1 AND action='transfer.expired'", [expiring.id]); assert.equal(expiryAudit[0].n, 1);

  // Confirm hitting an expired code closes the attempt as expired; replaying that key replays the 422.
  const lateResponse = await post(alice, otpBody); const late = await lateResponse.json() as Transfer;
  await source.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1", [late.id]);
  const lateKey = key(); const lateConfirm = await confirm(alice, late.id, late.demoOnlyCode!, lateKey);
  assert.equal(lateConfirm.status, 422); assert.equal((await lateConfirm.json() as { detail: string }).detail, 'El código expiró.');
  assert.equal((await confirm(alice, late.id, late.demoOnlyCode!, lateKey)).status, 422);
  assert.equal((await source.query('SELECT status FROM transfers WHERE id=$1', [late.id]))[0].status, 'expired');
  assert.equal((await ledgerFor(late.id)).length, 0);

  // A stale pending attempt is swept when the owner starts another attempt; its create key replays the terminal state.
  const orphanKey = key(); const orphanBody = { ...otpBody, reference: '4446' };
  const orphan = await (await post(alice, orphanBody, orphanKey)).json() as Transfer;
  await source.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1", [orphan.id]);
  const next = await post(alice, { ...otpBody, reference: '4447' }); assert.equal(next.status, 202); await next.body?.cancel();
  assert.equal((await source.query('SELECT status FROM transfers WHERE id=$1', [orphan.id]))[0].status, 'expired');
  const orphanReplay = await post(alice, orphanBody, orphanKey); assert.equal(orphanReplay.status, 200);
  const orphanReplayDto = await orphanReplay.json() as Transfer; assert.equal(orphanReplayDto.id, orphan.id); assert.equal(orphanReplayDto.status, 'expired'); assert.equal(orphanReplayDto.demoOnlyCode, undefined);
});
