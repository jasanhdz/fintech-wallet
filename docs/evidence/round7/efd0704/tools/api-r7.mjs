// Round 7 (H1) · integration evidence against the REAL API + PostgreSQL (wallet_test only, via `npm run dev:api:testdb`).
// Registers fresh synthetic users (*.r7.*@example.test) and documents the server behaviour the mobile client follows.
// The demo OTP (demoOnlyCode, APP_ENV=development only) is used to confirm but is NEVER printed: every log line masks it.
// Usage: R7_API_PORT=3794 R7_WEB_PORT=8794 R7_TEST_PASSWORD=<test-only> node api-r7.mjs
import { randomUUID } from 'node:crypto';
const API = `http://127.0.0.1:${process.env.R7_API_PORT || '3794'}/v1`;
const ORIGIN = `http://localhost:${process.env.R7_WEB_PORT || '8794'}`;
const PASSWORD = process.env.R7_TEST_PASSWORD; if (!PASSWORD) throw new Error('Set R7_TEST_PASSWORD (test-only value)');
const run = String(Date.now()).slice(-7);
const mask = (value) => JSON.stringify(value, (key, v) => (key === 'demoOnlyCode' ? '••••••' : v));
const log = (...parts) => console.log(parts.map((p) => (typeof p === 'string' ? p : mask(p))).join(' '));
let failures = 0;
const check = (ok, what) => { if (!ok) failures += 1; log(ok ? 'PASS' : 'FAIL', what); };

async function register(tag) {
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: ORIGIN } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrf.json();
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: ORIGIN, cookie }, body: JSON.stringify({ fullName: `R7 ${tag}`, email: `${tag}.r7.${run}@example.test`, password: PASSWORD }) });
  if (!res.ok) throw new Error(`register ${res.status}`);
  return (await res.json()).accessToken;
}
const call = async (token, path, init = {}) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers } });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
};
const create = (token, key, body) => call(token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
const confirm = (token, id, code) => call(token, `/transfers/${id}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ code }) });
const balances = async (token) => Object.fromEntries((await call(token, '/accounts')).body.items.map((a) => [a.kind, BigInt(a.availableBalanceMinor)]));
async function setup(tag) {
  const token = await register(tag);
  const accounts = (await call(token, '/accounts')).body.items;
  const principal = accounts.find((a) => a.kind === 'checking'); const savings = accounts.find((a) => a.kind === 'savings');
  const toSavings = (await call(token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Ahorro propio', alias: 'Ahorro', clabe: savings.clabe }) })).body;
  const toPrincipal = (await call(token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Principal propia', alias: 'Principal', clabe: principal.clabe }) })).body;
  const body = (amountMinor, from = principal, to = toSavings, reference = '7001') => ({ sourceAccountId: from.id, destinationType: 'beneficiary', beneficiaryId: to.id, amountMinor, concept: 'Prueba R7', reference });
  return { token, principal, savings, toSavings, toPrincipal, body };
}

const policyOf = async (token) => (await call(token, '/transfer-policy')).body;

// ── 1. Threshold edges (REQ-XFER-11 "superior al umbral" vs API `amount >= threshold`) ──
{
  const u = await setup('edge');
  const policy = await policyOf(u.token);
  log('policy', { otpThresholdMinor: policy.otpThresholdMinor, otpExpirySeconds: policy.otpExpirySeconds, otpMaxAttempts: policy.otpMaxAttempts, dailyLimitMinor: policy.dailyLimitMinor, demoOnly: policy.demoOnly });
  for (const [amount, expectStatus, expectHttp] of [['499999', 'completed', 201], ['500000', 'awaiting_confirmation', 202], ['500001', 'awaiting_confirmation', 202]]) {
    const r = await create(u.token, randomUUID(), u.body(amount));
    check(r.status === expectHttp && r.body?.status === expectStatus, `edge ${amount} minor -> HTTP ${r.status} ${r.body?.status} (expected ${expectHttp} ${expectStatus}); demo code present: ${Boolean(r.body?.demoOnlyCode)}`);
    if (r.body?.status === 'awaiting_confirmation') { const c = await call(u.token, `/transfers/${r.body.id}/cancel`, { method: 'POST' }); check(c.body?.status === 'cancelled', `edge ${amount}: pending attempt cancelled (${c.body?.status})`); }
  }
}

// ── 2. "Solicitar un código nuevo": the old code cannot authorize anything after the cancel ──
{
  const u = await setup('newcode');
  const before = await balances(u.token);
  const a1 = await create(u.token, randomUUID(), u.body('600000'));
  const oldCode = a1.body.demoOnlyCode; // used, never printed
  const cancelled = await call(u.token, `/transfers/${a1.body.id}/cancel`, { method: 'POST' });
  check(cancelled.status === 200 && cancelled.body.status === 'cancelled', `attempt 1 cancelled before a new one (${cancelled.body?.status})`);
  const lateOld = await confirm(u.token, a1.body.id, oldCode);
  check(lateOld.status === 409, `confirming the CANCELLED attempt with its own code -> ${lateOld.status} ${lateOld.body?.detail}`);
  const a2 = await create(u.token, randomUUID(), u.body('600000'));
  check(a2.status === 202 && a2.body.id !== a1.body.id, `attempt 2 created with a new key (new id, HTTP ${a2.status})`);
  const crossed = oldCode === a2.body.demoOnlyCode ? { status: 'skipped (codes collided)' } : await confirm(u.token, a2.body.id, oldCode);
  check(crossed.status === 422 || String(crossed.status).startsWith('skipped'), `attempt 2 with the OLD code -> ${crossed.status} ${crossed.body?.detail ?? ''}`);
  const mid = await balances(u.token);
  check(mid.checking === before.checking && mid.savings === before.savings, `no money moved by the old code (principal ${mid.checking}, ahorro ${mid.savings})`);
  const ok = await confirm(u.token, a2.body.id, a2.body.demoOnlyCode);
  check(ok.status === 200 && ok.body.status === 'completed', `attempt 2 with its own code -> ${ok.status} ${ok.body?.status}`);
  const after = await balances(u.token);
  check(before.checking - after.checking === 600000n && after.savings - before.savings === 600000n, `exactly one debit/credit of 600000 (principal ${before.checking}->${after.checking}, ahorro ${before.savings}->${after.savings})`);
}

// ── 3. Attempts exhausted (OTP_MAX_ATTEMPTS) -> 429, then cancel works and nothing moved ──
{
  const u = await setup('lock');
  const before = await balances(u.token);
  const policy = await policyOf(u.token);
  const a = await create(u.token, randomUUID(), u.body('600000'));
  const wrong = a.body.demoOnlyCode === '000000' ? '111111' : '000000';
  const statuses = [];
  for (let i = 0; i < policy.otpMaxAttempts + 1; i += 1) statuses.push((await confirm(u.token, a.body.id, wrong)).status);
  check(statuses.slice(0, policy.otpMaxAttempts - 1).every((s) => s === 422) && statuses[policy.otpMaxAttempts - 1] === 429 && statuses[policy.otpMaxAttempts] === 429, `wrong codes -> ${statuses.join(',')} (422 until the ${policy.otpMaxAttempts}th, then 429)`);
  const right = await confirm(u.token, a.body.id, a.body.demoOnlyCode);
  check(right.status === 429, `even the right code after exhaustion -> ${right.status}`);
  const c = await call(u.token, `/transfers/${a.body.id}/cancel`, { method: 'POST' });
  check(c.body?.status === 'cancelled', `locked attempt can be cancelled (${c.body?.status})`);
  const after = await balances(u.token);
  check(after.checking === before.checking && after.savings === before.savings, 'balances unchanged');
}

// ── 4. M09: lost response -> same Idempotency-Key replay -> one transfer, one debit ──
{
  const u = await setup('m09');
  const before = await balances(u.token);
  const key = randomUUID();
  const first = await create(u.token, key, u.body('123456', u.principal, u.toSavings, '9091'));
  // The client "lost" this answer; the recovery replays the same key and payload (after a restart too).
  const replay = await create(u.token, key, u.body('123456', u.principal, u.toSavings, '9091'));
  const read = await call(u.token, `/transfers/${first.body.id}`);
  check(first.body.id === replay.body.id && read.body.status === 'completed', `replay with the same key -> same id, status ${read.body.status} (HTTP ${first.status}/${replay.status})`);
  const after = await balances(u.token);
  check(before.checking - after.checking === 123456n, `debited once (${before.checking}->${after.checking})`);
  const rows = (await call(u.token, `/accounts/${u.principal.id}/movements?limit=20`)).body.items.filter((m) => m.reference === '9091');
  check(rows.length === 1, `one movement row with reference 9091 in Principal (${rows.length})`);
  const otherPayload = await create(u.token, key, u.body('654321', u.principal, u.toSavings, '9091'));
  check(otherPayload.status === 409 || otherPayload.status === 422, `same key with another payload refused (${otherPayload.status})`);
}

// ── 5. M11: insufficient balance (422) and daily limit (429), nothing moved ──
{
  const u = await setup('m11');
  const before = await balances(u.token);
  const tooMuch = (before.checking + 1n).toString();
  const amount = BigInt(tooMuch) < 500000n ? tooMuch : null;
  const ins = amount ? await create(u.token, randomUUID(), u.body(amount)) : null;
  // Balance is above the OTP threshold: an OTP attempt is created, and the confirm answers 422 "Saldo insuficiente".
  const otp = amount ? null : await create(u.token, randomUUID(), u.body(tooMuch));
  const insConfirm = otp ? await confirm(u.token, otp.body.id, otp.body.demoOnlyCode) : null;
  const insufficient = ins ?? insConfirm;
  check(insufficient.status === 422 && /Saldo insuficiente/.test(insufficient.body?.detail ?? ''), `insufficient balance (${tooMuch} minor${otp ? ', OTP path: create 202 then confirm' : ''}) -> ${insufficient.status} ${insufficient.body?.detail}`);
  if (otp) await call(u.token, `/transfers/${otp.body.id}/cancel`, { method: 'POST' });
  const mid = await balances(u.token);
  check(mid.checking === before.checking && mid.savings === before.savings, 'nothing moved after the insufficient-balance rejection');
  // Fill today's demo limit with own transfers below the OTP threshold, then exceed it.
  const policy = await policyOf(u.token);
  const step = 499999n;
  let used = BigInt(policy.dailyUsedMinor);
  const limit = BigInt(policy.dailyLimitMinor);
  let fromPrincipal = true;
  while (used + step <= limit) {
    const r = await create(u.token, randomUUID(), fromPrincipal ? u.body(step.toString()) : u.body(step.toString(), u.savings, u.toPrincipal));
    if (r.status !== 201) { log('fill stopped', r.status, r.body?.detail); break; }
    used += step; fromPrincipal = !fromPrincipal;
  }
  const pre = await balances(u.token);
  const remaining = BigInt((await policyOf(u.token)).dailyRemainingMinor);
  const over = await create(u.token, randomUUID(), u.body((remaining + 100n).toString()));
  check(over.status === 429 && /límite diario/.test(over.body?.detail ?? ''), `daily limit: remaining ${remaining}, asking ${remaining + 100n} -> ${over.status} ${over.body?.detail}`);
  const post = await balances(u.token);
  check(post.checking === pre.checking && post.savings === pre.savings && post.checking + post.savings === before.checking + before.savings, 'nothing moved by the limit rejection; total of own accounts conserved');
}

log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exitCode = failures ? 1 : 0;
