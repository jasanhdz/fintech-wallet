// Round 8 G-B: helpers for the RN-Web render (exported bundle, SecureStore shim -> localStorage) against an isolated API on
// wallet_test. Adapted from docs/evidence/round7/h5-17b7163/tools/lib.cjs. Ports 3971 (API) / 8971 (static web).
// Env: EV_API_PORT, EV_WEB_PORT, EV_TEST_PASSWORD (test-only, never written), EV_OUT (evidence dir).
// Never printed: passwords, OTP codes, idempotency keys (only an 8-hex SHA-256 fingerprint), full CLABEs.
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const API_PORT = process.env.EV_API_PORT || '3971', WEB_PORT = process.env.EV_WEB_PORT || '8971';
const API = `http://127.0.0.1:${API_PORT}/v1`, ORIGIN = `http://localhost:${WEB_PORT}`;
const PW = process.env.EV_TEST_PASSWORD; if (!PW) throw new Error('Set EV_TEST_PASSWORD (test-only value)');
const OUT = process.env.EV_OUT || '.'; fs.mkdirSync(OUT + '/shots', { recursive: true });
const run = String(Date.now()).slice(-7);
const DB = ['exec', '-i', 'fintech-wallet-postgres-1', 'psql', '-U', 'postgres', '-d', 'wallet_test', '-At', '-v', 'ON_ERROR_STOP=1'];
const psql = (q) => execSync(`docker ${DB.join(' ')} -c ${JSON.stringify(q)}`).toString().trim();
const lines = []; const L = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : typeof x === 'bigint' ? x.toString() : JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))).join(' '); console.log(s); lines.push(s); };
let fails = 0;
const ok = (c, what) => { if (!c) fails += 1; L(c ? 'PASS' : 'FAIL', what); return c; };
const fp = (key) => (key ? crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8) : '-');
let userNo = 0;
async function call(token, path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  return { s: r.status, b: r.status === 204 ? null : await r.json().catch(() => null) };
}
async function registerUser(fullName, tag) {
  userNo += 1;
  const email = `${tag || 'u'}${userNo}.r8m.${run}@example.test`;
  for (;;) {
    const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: ORIGIN } });
    const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); const { csrfToken } = await csrf.json();
    const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: ORIGIN, cookie }, body: JSON.stringify({ fullName, email, password: PW }) });
    if (res.status === 429) { L('auth rate limit: waiting 61 s'); await new Promise((r) => setTimeout(r, 61000)); continue; }
    if (!res.ok) throw new Error('register ' + res.status);
    const token = (await res.json()).accessToken;
    return { email, token, fullName };
  }
}
// A second, independent session of the same user (another device): mobile login, no local state.
async function otherSession(u) {
  for (;;) {
    const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: u.email, password: PW, client: 'mobile' }) });
    if (res.status === 429) { L('auth rate limit: waiting 61 s'); await new Promise((r) => setTimeout(r, 61000)); continue; }
    if (!res.ok) throw new Error('login ' + res.status);
    return (await res.json()).accessToken;
  }
}
async function mkUser(fullName = 'Ana López', tag) {
  const u = await registerUser(fullName, tag);
  const acc = (await call(u.token, '/accounts')).b.items;
  u.pr = acc.find((a) => a.kind === 'checking'); u.sv = acc.find((a) => a.kind === 'savings');
  u.own = (await call(u.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabe: u.sv.clabe }) })).b;
  u.id = (await call(u.token, '/auth/me')).b.id;
  return u;
}
const balances = async (u) => Object.fromEntries((await call(u.token, '/accounts')).b.items.map((a) => [a.kind, BigInt(a.availableBalanceMinor)]));
// ---- DB checks (wallet_test only) ----
const db = {
  transfers: (u) => psql(`select coalesce(string_agg(status||':'||amount_minor||':'||coalesce(left(client_attempt_id::text,8),'null'), ' | ' order by created_at),'(none)') from transfers where owner_id='${u.id}'`),
  count: (u) => Number(psql(`select count(*) from transfers where owner_id='${u.id}'`)),
  byAttempt: (u, attemptId) => Number(psql(`select count(*) from transfers where owner_id='${u.id}' and client_attempt_id='${attemptId}'`)),
  debits: (u) => psql(`select count(*)||' debit(s) total '||coalesce(-sum(le.signed_amount_minor),0) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id where t.owner_id='${u.id}' and le.account_id='${u.pr.id}' and le.signed_amount_minor<0`),
  debitCount: (u) => Number(psql(`select count(*) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id where t.owner_id='${u.id}' and le.account_id='${u.pr.id}' and le.signed_amount_minor<0`)),
  unbalanced: (u) => Number(psql(`select count(*) from (select lt.id from ledger_transactions lt join ledger_entries le on le.ledger_transaction_id=lt.id join transfers t on t.id=lt.reference_id where t.owner_id='${u.id}' group by lt.id having sum(le.signed_amount_minor)<>0) x`)),
  maxDebitsPerAttempt: (u) => Number(psql(`select coalesce(max(n),0) from (select t.client_attempt_id, count(*) n from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id where t.owner_id='${u.id}' and le.signed_amount_minor<0 and le.account_id='${u.pr.id}' group by t.client_attempt_id, t.id) x`)),
  closures: (u) => psql(`select coalesce(string_agg(status||':'||coalesce(left(client_attempt_id::text,8),'null')||coalesce(':'||problem_status,''), ' | ' order by closed_at),'(none)') from transfer_attempt_closures where owner_id='${u.id}'`),
  epoch: (u) => psql(`select coalesce((select epoch::text from transfer_send_gates where owner_id='${u.id}'),'0 (no row)')`),
  audit: (u) => psql(`select coalesce(string_agg(action||coalesce(' '||nullif(metadata::text,'{}'),''), ' | ' order by created_at, id),'(none)') from audit_events where actor_id='${u.id}' and action like 'transfer.%'`),
  auditRaw: (u) => psql(`select coalesce(string_agg(metadata::text, ' '),'') from audit_events where actor_id='${u.id}'`),
};
function dbReport(u, label) {
  const r = { transfers: db.transfers(u), debits: db.debits(u), unbalanced: db.unbalanced(u), maxDebitsPerAttempt: db.maxDebitsPerAttempt(u), closures: db.closures(u), epoch: db.epoch(u), audit: db.audit(u) };
  L(`DB ${label}: transfers=[${r.transfers}] | ${r.debits} | unbalanced tx=${r.unbalanced} | max debits/attempt=${r.maxDebitsPerAttempt} | closures=[${r.closures}] | epoch=${r.epoch}`);
  L(`AUDIT ${label}: ${r.audit}`);
  const raw = db.auditRaw(u);
  ok(!/\b\d{18}\b/.test(raw) && !/key|code|otp|clabe/i.test(raw.replace(/"via"/g, '')), `${label}: audit metadata without keys, key_hash, OTP or 18-digit CLABE`);
  ok(r.unbalanced === 0 && r.maxDebitsPerAttempt <= 1, `${label}: every ledger transaction sums 0 and <= 1 debit per attempt`);
  return r;
}

async function newPage(browser, { w = 390, h = 929, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: 'America/Mexico_City', permissions: [] });
  const p = await ctx.newPage();
  // SecureStore shim (web only, exported copy): localStorage under "ss:<key>". "ss-unreadable" = the store fails to read
  // the recovery keys (simulated unreadable Keychain).
  await p.addInitScript(() => {
    const unreadable = (k) => localStorage.getItem('ss-unreadable') === '1' && String(k).startsWith('wallet.transfer-recovery');
    window.__ss = {
      get: async (k) => { if (unreadable(k)) throw new Error('secure store unavailable'); return localStorage.getItem('ss:' + k); },
      set: async (v, k) => { localStorage.setItem('ss:' + k, v); },
      del: async (k) => { localStorage.removeItem('ss:' + k); },
    };
  });
  if (init) await p.addInitScript(init);
  p.errs = []; p.reqs = [];
  p.on('pageerror', (e) => p.errs.push('pageerror ' + e.message));
  p.on('request', (r) => {
    if (!/127\.0\.0\.1:39[0-9]{2}/.test(r.url())) return;
    const h = r.headers();
    const path = r.url().replace(/^http:\/\/127\.0\.0\.1:\d+\/v1/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => m.slice(0, 8));
    p.reqs.push(`${r.method()} ${path}${h['idempotency-key'] ? ` key#${fp(h['idempotency-key'])}` : ''}${h['transfer-attempt-id'] ? ` attempt=${h['transfer-attempt-id'].slice(0, 8)}` : ''}${h['transfer-send-epoch'] ? ` epoch=${h['transfer-send-epoch']}` : ''}`);
  });
  p.btn = (name) => p.getByRole('button', { name, exact: false }).first();
  p.text = async () => (await p.evaluate(() => document.body.innerText)).replace(/\b\d{6}\b/g, '••••••');
  p.shot = async (name) => {
    await p.waitForTimeout(500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.screenshot({ path: `${OUT}/shots/${name}.png` });
    const t = await p.text(); fs.writeFileSync(`${OUT}/shots/${name}.txt`, t);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth }));
    L(`SHOT ${name} scrollW=${m.sw} errs=${p.errs.length}`);
    return t;
  };
  return p;
}
async function login(p, email) {
  await new Promise((r) => setTimeout(r, 6500));
  await p.goto(ORIGIN + '/'); await p.getByLabel('Correo electrónico').waitFor({ timeout: 20000 });
  await p.getByLabel('Correo electrónico').fill(email); await p.getByLabel('Contraseña', { exact: true }).fill(PW);
  await p.btn('Iniciar sesión').click(); await p.waitForTimeout(3000);
}
const origin = async (p, re) => { await p.getByRole('button', { name: re }).first().click(); await p.waitForTimeout(300); };
const choose = async (p, prefix) => { await p.getByLabel(/Elegir beneficiario/i).first().click(); await p.waitForTimeout(1200); await p.getByLabel(new RegExp(`^Seleccionar ${prefix}`)).first().click(); await p.waitForTimeout(400); };
const fill = async (p, amount, concept, ref) => { await p.getByLabel('Monto a transferir', { exact: true }).fill(amount); await p.getByLabel('Concepto de pago', { exact: true }).fill(concept); await p.getByLabel(/Referencia numérica/).first().fill(ref); await p.waitForTimeout(400); };
const toReview = async (p, amount, concept, ref) => { await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200); await fill(p, amount, concept, ref); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1500); };
const flush = (name) => fs.writeFileSync(`${OUT}/${name}`, lines.join('\n') + '\n');
module.exports = { chromium, spawn, psql, DB, L, ok, fp, call, mkUser, otherSession, balances, db, dbReport, newPage, login, origin, choose, fill, toReview, flush, API, ORIGIN, OUT, fs, crypto, lines, failures: () => fails };
