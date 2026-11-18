// Evaluator (pass 8, code 1302862) shared helpers. Real exported RN-Web bundle + isolated API on wallet_test.
// Env: EV_API_PORT (3897), EV_WEB_PORT (8897), EV_TEST_PASSWORD (test-only), EV_OUT (output dir for shots/logs).
// The demo OTP is only read from the DOM/response into memory; every log/screenshot masks it.
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const API_PORT = process.env.EV_API_PORT || '3897', WEB_PORT = process.env.EV_WEB_PORT || '8897';
const API = `http://127.0.0.1:${API_PORT}/v1`, ORIGIN = `http://localhost:${WEB_PORT}`;
const PW = process.env.EV_TEST_PASSWORD; if (!PW) throw new Error('Set EV_TEST_PASSWORD (test-only value)');
const OUT = process.env.EV_OUT || '.'; fs.mkdirSync(OUT + '/shots', { recursive: true });
const run = String(Date.now()).slice(-7);
const psql = (q) => execSync(`docker exec -i fintech-wallet-postgres-1 psql -U postgres -d wallet_test -At -c ${JSON.stringify(q)}`).toString().trim();
const lines = []; const L = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : typeof x === 'bigint' ? x.toString() : JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))).join(' '); console.log(s); lines.push(s); };
const ok = (c, what) => L(c ? 'PASS' : 'FAIL', what);
const mask = (s) => String(s).replace(/"demoOnlyCode":"\d+"/g, '"demoOnlyCode":"••••••"');
let userNo = 0;
async function call(token, path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
  return { s: r.status, b: r.status === 204 ? null : await r.json().catch(() => null) };
}
async function registerUser(fullName, tag) {
  userNo += 1;
  const email = `${tag || 'u'}${userNo}.ev8.${run}@example.test`;
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
async function mkUser(fullName = 'Ana López', tag) {
  const u = await registerUser(fullName, tag);
  const acc = (await call(u.token, '/accounts')).b.items;
  u.pr = acc.find((a) => a.kind === 'checking'); u.sv = acc.find((a) => a.kind === 'savings');
  u.own = (await call(u.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabe: u.sv.clabe }) })).b;
  u.toPr = (await call(u.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta principal demo', alias: 'Principal demo', clabe: u.pr.clabe }) })).b;
  return u;
}
// A second synthetic user to act as an external recipient.
async function mkRecipient(u, name = 'Carlos Ruiz') {
  const c = await registerUser(name, 'rcp');
  const acc = (await call(c.token, '/accounts')).b.items; c.pr = acc.find((a) => a.kind === 'checking');
  u.carlos = (await call(u.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name, alias: 'Carlos', clabe: c.pr.clabe }) })).b;
  u.recipient = c; return c;
}
const xfer = (u, from, to, amountMinor, extra = {}) => call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: from.id, destinationType: 'beneficiary', beneficiaryId: to.id, amountMinor, concept: 'Ajuste', reference: '1', ...extra }) });
const balances = async (u) => Object.fromEntries((await call(u.token, '/accounts')).b.items.map((a) => [a.kind, BigInt(a.availableBalanceMinor)]));
const dbRows = (email) => psql(`select t.status||':'||t.amount_minor from transfers t join users u on u.id=t.owner_id where u.email='${email}' order by t.created_at`);
const dbLedger = (email) => psql(`select count(*)||' rows sum '||coalesce(sum(le.signed_amount_minor),0) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${email}'`);

async function newPage(browser, { w = 390, h = 844, tz = 'America/Mexico_City', scale = 1, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: tz, permissions: [] });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } }; });
  if (init) await p.addInitScript(init);
  p.errs = []; p.reqs = []; p.scaleFactor = scale;
  p.on('pageerror', (e) => p.errs.push('pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errs.push('console ' + m.text().slice(0, 120)); });
  p.on('request', (r) => { if (/127\.0\.0\.1:389[789]/.test(r.url())) p.reqs.push(`${r.method()} ${r.url().replace(/^http:\/\/127\.0\.0\.1:389\d\/v1/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => m.slice(0, 4))} key=${(r.headers()['idempotency-key'] || '-').slice(0, 8)}`); });
  p.btn = (name) => p.getByRole('button', { name, exact: false }).first();
  p.text = async () => (await p.evaluate(() => document.body.innerText)).replace(/\b\d{6}\b/g, '••••••');
  p.applyScale = () => (p.scaleFactor === 1 ? null : p.evaluate((f) => { document.querySelectorAll('div,span,input').forEach((e) => { const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); if (fs && !e.dataset.s) { e.dataset.s = '1'; e.style.fontSize = `${fs * f}px`; const lh = parseFloat(cs.lineHeight); if (lh) e.style.lineHeight = `${lh * f}px`; } }); }, p.scaleFactor));
  p.shot = async (name, { keepFocus = false } = {}) => {
    await p.waitForTimeout(500);
    if (!keepFocus) await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.applyScale();
    await p.evaluate(() => { document.querySelectorAll('div[dir=auto]').forEach((e) => { if (/^Código asignado para esta prueba/.test(e.innerText || '')) e.style.filter = 'blur(7px)'; }); });
    await p.screenshot({ path: `${OUT}/shots/${name}.png` });
    const t = await p.text(); fs.writeFileSync(`${OUT}/shots/${name}.txt`, t);
    const m = await p.evaluate(() => {
      const s = new Map(); document.querySelectorAll('div[dir=auto],input,textarea').forEach((e) => { const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || e.tagName === 'INPUT'; if (!own) return; if (/ionicons|material/i.test(getComputedStyle(e).fontFamily)) return; const f = parseFloat(getComputedStyle(e).fontSize); if (f) s.set(f, (s.get(f) || 0) + 1); });
      const sw = document.documentElement.scrollWidth; const out = [];
      document.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && (r.right > innerWidth + 1 || r.left < -1)) { const cs = getComputedStyle(e); if (cs.position !== 'fixed' && e.tagName !== 'HTML') out.push((e.getAttribute('aria-label') || e.innerText || e.tagName).slice(0, 30) + '@' + Math.round(r.left) + '..' + Math.round(r.right)); } });
      return { sizes: [...s.entries()].sort((a, b) => a[0] - b[0]), sw, out: out.slice(0, 5), nOut: out.length };
    });
    L(`SHOT ${name} minFont=${m.sizes[0]?.[0]} scrollW=${m.sw} offscreen=${m.nOut}${m.nOut ? ' ' + JSON.stringify(m.out) : ''} errs=${p.errs.length}`);
    return t;
  };
  return p;
}
async function login(p, email) {
  await new Promise((r) => setTimeout(r, 6500));
  await p.goto(ORIGIN + '/'); await p.getByLabel('Correo electrónico').waitFor({ timeout: 20000 });
  await p.getByLabel('Correo electrónico').fill(email); await p.getByLabel('Contraseña', { exact: true }).fill(PW);
  await p.btn('Iniciar sesión').click(); await p.waitForTimeout(2500);
}
const origin = async (p, re) => { await p.getByRole('button', { name: re }).first().click(); await p.waitForTimeout(300); };
const choose = async (p, prefix) => { await p.getByLabel(/Elegir beneficiario/i).first().click(); await p.waitForTimeout(1200); await p.getByLabel(new RegExp(`^Seleccionar ${prefix}`)).first().click(); await p.waitForTimeout(400); };
const fill = async (p, amount, concept = 'Comida', ref = '131126') => { await p.getByLabel('Monto a transferir', { exact: true }).fill(amount); await p.getByLabel('Concepto de pago', { exact: true }).fill(concept); await p.getByLabel(/Referencia numérica/).first().fill(ref); await p.waitForTimeout(400); };
const toReview = async (p, amount, concept, ref) => { await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200); await fill(p, amount, concept, ref); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200); };
const box = async (p, name) => { const b = await p.getByRole('button', { name }).first().boundingBox().catch(() => null); return b ? `${Math.round(b.y)}-${Math.round(b.y + b.height)}` : 'n/a'; };
const flush = (name) => fs.writeFileSync(`${OUT}/${name}`, lines.join('\n') + '\n');
module.exports = { chromium, psql, L, ok, mask, call, mkUser, mkRecipient, registerUser, xfer, balances, dbRows, dbLedger, newPage, login, origin, choose, fill, toReview, box, flush, API, ORIGIN, PW, OUT, fs, crypto, lines };
