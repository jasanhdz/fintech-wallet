// Evaluator R8 (code 8da2700): shared helpers. Real API process (start-api.sh) + PostgreSQL wallet_test ONLY.
// Never prints OTP codes, idempotency keys, key hashes or full CLABEs (masked by `sanitize`).
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
const require = createRequire('/Users/jasanhernandez/Develop/fintech-wallet-g1/package.json');
const pg = require('pg');

const envText = readFileSync('/Users/jasanhernandez/Develop/fintech-wallet/.env', 'utf8');
const envGet = (k) => (envText.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1];
export const RUNTIME_URL = envGet('TEST_DATABASE_URL');
export const MIGRATOR_URL = envGet('TEST_MIGRATOR_DATABASE_URL');
if (!/wallet_runtime_test:.*@localhost:55432\/wallet_test$/.test(RUNTIME_URL) || !/wallet_migrator_test:.*@localhost:55432\/wallet_test$/.test(MIGRATOR_URL)) throw new Error('refusing: not wallet_test');
export const PORT = Number(process.env.EV_API_PORT || 3951);
export const API = `http://127.0.0.1:${PORT}/v1`;
export const ORIGIN = 'http://localhost:8951';
export const PW = process.env.EV_TEST_PASSWORD || 'Eval-R8-' + randomUUID();
const OUT = process.env.EV_OUT || '.';
mkdirSync(OUT + '/logs', { recursive: true });
const LOGFILE = process.env.EV_LOG || `${OUT}/logs/probe.txt`;
writeFileSync(LOGFILE, '');
const knownSecrets = new Set();
export const sanitize = (s) => String(s)
  .replace(/\b\d{18}\b/g, '<clabe18>').replace(/"demoOnlyCode":"\d+"/g, '"demoOnlyCode":"******"')
  .replace(/[0-9a-f]{64}/g, '<hash64>');
export const L = (...a) => {
  let s = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x, (k, v) => typeof v === 'bigint' ? v.toString() : v)).join(' ');
  for (const k of knownSecrets) s = s.split(k).join('<secret>');
  s = sanitize(s); console.log(s); appendFileSync(LOGFILE, s + '\n');
};
export let pass = 0, fail = 0;
export const ok = (c, what, extra) => { if (c) pass++; else fail++; L(c ? 'PASS' : 'FAIL', what, c || extra === undefined ? '' : extra); return !!c; };
export const secret = (v) => { knownSecrets.add(v); return v; };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uuid = () => randomUUID();
export const newKey = () => secret(randomUUID() + randomUUID());

export async function dbClient(which = 'runtime') {
  const c = new pg.Client({ connectionString: which === 'runtime' ? RUNTIME_URL : MIGRATOR_URL });
  await c.connect(); return c;
}
export const db = await dbClient('runtime');
export const q = async (sql, params = []) => (await db.query(sql, params)).rows;
export const one = async (sql, params = []) => (await q(sql, params))[0];

export async function call(token, path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  const text = await r.text(); let b = null; try { b = text ? JSON.parse(text) : null; } catch { b = { raw: text }; }
  if (b && typeof b.demoOnlyCode === 'string') secret(b.demoOnlyCode);
  return { s: r.status, b, ct: r.headers.get('content-type') || '', text };
}

export async function register(tag = 'u') {
  const email = `${tag.toLowerCase()}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
  for (;;) {
    const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: ORIGIN } });
    const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); const { csrfToken } = await csrf.json();
    const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: ORIGIN, cookie }, body: JSON.stringify({ fullName: 'Eval R8 ' + tag, email, password: PW }) });
    if (res.status === 429) { L('auth rate limit: waiting 62 s'); await sleep(62000); continue; }
    if (!res.ok) throw new Error('register ' + res.status);
    const token = (await res.json()).accessToken; secret(token);
    const u = { email, token, tag };
    const acc = (await call(token, '/accounts')).b.items;
    u.pr = acc.find((a) => a.kind === 'checking'); u.sv = acc.find((a) => a.kind === 'savings');
    for (const a of acc) knownSecrets.add(a.clabe);
    u.id = (await one('select id from users where email=$1', [email])).id;
    return u;
  }
}
export async function login(u) {
  for (;;) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: PW, client: 'mobile' }) });
    if (r.status === 429) { L('auth rate limit: waiting 62 s'); await sleep(62000); continue; }
    if (!r.ok) throw new Error('login ' + r.status);
    const token = secret((await r.json()).accessToken); return { ...u, token };
  }
}
export const ownBody = (u, amountMinor, extra = {}) => ({ sourceAccountId: u.pr.id, destinationType: 'own_account', destinationAccountId: u.sv.id, amountMinor: String(amountMinor), concept: 'Eval R8', reference: '8', ...extra });
export const epochOf = async (u) => (await call(u.token, '/transfer-policy')).b.sendEpoch;
export const send = (u, body, { key, attemptId, epoch, headers = {} }) => call(u.token, '/transfers', { method: 'POST', headers: { 'idempotency-key': key, ...(attemptId !== undefined ? { 'transfer-attempt-id': attemptId } : {}), ...(epoch !== undefined ? { 'transfer-send-epoch': String(epoch) } : {}), ...headers }, body: JSON.stringify(body) });
export const voidA = (u, key, attemptId) => call(u.token, '/transfer-attempts/void', { method: 'POST', body: JSON.stringify(attemptId ? { idempotencyKey: key, attemptId } : { idempotencyKey: key }) });
export const voidAll = (u, fromEpoch) => call(u.token, '/transfer-attempts/void-all', { method: 'POST', body: JSON.stringify({ fromEpoch: String(fromEpoch) }) });
export const listA = (u, params = {}) => call(u.token, '/transfer-attempts?' + new URLSearchParams(params));
export const confirmT = (u, id, code, key = newKey()) => call(u.token, `/transfers/${id}/confirm`, { method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify({ code }) });
export const T_VOIDED = 'urn:billetera:problem:transfer-attempt-voided';
export const T_REJECTED = 'urn:billetera:problem:transfer-attempt-rejected';
export const T_CONFLICT = 'urn:billetera:problem:transfer-attempt-conflict';

// ---- DB invariants (runtime role reads)
export const keyHashOf = async (key) => (await one("select encode(digest($1,'sha256'),'hex') h", [key]))?.h; // may not match app hashing; app uses HMAC. Not used for matching.
export const transfersOfAttempt = (uid, attemptId) => q('select id,status from transfers where owner_id=$1 and client_attempt_id=$2', [uid, attemptId]);
export const closuresOfAttempt = (uid, attemptId) => q('select id,status,problem_status from transfer_attempt_closures where owner_id=$1 and client_attempt_id=$2', [uid, attemptId]);
export const debitsOf = async (tid) => (await one("select count(*)::int n from ledger_transactions lt join ledger_entries le on le.ledger_transaction_id=lt.id where lt.reference_type='transfer' and lt.reference_id=$1 and le.entry_type='debit'", [tid])).n;
export const netOf = async (tid) => BigInt((await one("select coalesce(sum(le.signed_amount_minor),0)::text n from ledger_transactions lt join ledger_entries le on le.ledger_transaction_id=lt.id where lt.reference_type='transfer' and lt.reference_id=$1", [tid])).n);
export const userNet = async (uid) => BigInt((await one("select coalesce(sum(le.signed_amount_minor),0)::text n from transfers t join ledger_transactions lt on lt.reference_type='transfer' and lt.reference_id=t.id join ledger_entries le on le.ledger_transaction_id=lt.id where t.owner_id=$1", [uid])).n);
export const balOf = async (u) => Object.fromEntries((await q('select kind,balance_minor::text b from accounts where owner_id=$1', [u.id])).map((r) => [r.kind, BigInt(r.b)]));
export const gateEpoch = async (uid) => (await one('select epoch::text e from transfer_send_gates where owner_id=$1', [uid]))?.e ?? '0';
export const counts = async (uid) => one("select (select count(*)::int from transfers where owner_id=$1) transfers,(select count(*)::int from transfer_attempt_closures where owner_id=$1) closures,(select count(*)::int from transfers t join ledger_transactions lt on lt.reference_type='transfer' and lt.reference_id=t.id join ledger_entries le on le.ledger_transaction_id=lt.id where t.owner_id=$1) entries,(select count(*)::int from daily_limit_usage where owner_id=$1) usage_rows", [uid]);
export const auditCount = async (uid, action) => (await one('select count(*)::int n from audit_events where actor_id=$1 and action=$2', [uid, action])).n;
export const done = async () => { L(`SUMMARY pass=${pass} fail=${fail}`); await db.end(); process.exitCode = fail ? 1 : 0; };
