const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const SP = process.env.EV_SP;
const API = 'http://127.0.0.1:3711/v1', APP = 'http://localhost:8711/';
const PW = process.env.EV_TEST_PASSWORD;
const psql = (q) => execSync(`docker exec -i fintech-wallet-postgres-1 psql -U postgres -d wallet_test -At -c ${JSON.stringify(q)}`).toString().trim();
const log = []; const L = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };
async function api(token, path, init = {}) { const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) } }); let b = null; try { b = await r.json(); } catch {} return { s: r.status, b }; }
async function apiLogin(email) { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW, client: 'mobile' }) }); return (await r.json()).accessToken; }
async function register(fullName, email) {
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: 'http://localhost:8711' } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); const { csrfToken } = await csrf.json();
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: 'http://localhost:8711', cookie }, body: JSON.stringify({ fullName, email, password: PW }) });
  if (!res.ok) throw new Error('register ' + res.status); return (await res.json()).accessToken;
}
async function newPage(browser, { h = 844, tz = 'America/Mexico_City', init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: h }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: tz });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } }; });
  if (init) await page.addInitScript(init);
  page.errs = []; page.reqs = [];
  page.on('pageerror', (e) => page.errs.push('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errs.push('console ' + m.text().slice(0, 140)); });
  page.on('request', (r) => { if (r.url().includes(':3711')) page.reqs.push(`${r.method()} ${r.url().replace(API, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => m.slice(0, 4))} key=${(r.headers()['idempotency-key'] || '-').slice(0, 8)}`); });
  page.btn = (name) => page.getByRole('button', { name, exact: false }).first();
  page.text = () => page.evaluate(() => document.body.innerText);
  page.shot = async (name, opts = {}) => { await page.waitForTimeout(400); await page.screenshot({ path: `${SP}/shots/${name}.png`, ...opts }); const t = await page.text(); fs.writeFileSync(`${SP}/shots/${name}.txt`, t); const bad = (t.match(/undefined|NaN|Invalid Date|\[object/g) || []); L(`SHOT ${name} bad=${JSON.stringify(bad)}`); return t; };
  return page;
}
async function login(page, email) {
  await page.goto(APP); await page.waitForTimeout(1500);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PW);
  await page.btn('Iniciar sesión').click(); await page.waitForTimeout(2500);
}
async function toDetails(page, beneficiary, origin = /Cuenta principal/) {
  await page.getByRole('button', { name: origin }).first().click(); await page.waitForTimeout(400);
  await page.getByLabel('Elegir beneficiario').click(); await page.waitForTimeout(1200);
  await page.getByLabel(new RegExp(`^Seleccionar ${beneficiary}`)).first().click(); await page.waitForTimeout(400);
  await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1200);
}
async function fill(page, amount, concept, ref) { await page.getByLabel('Importe').fill(amount); await page.getByLabel('Concepto').fill(concept); await page.getByLabel('Referencia').fill(ref); await page.waitForTimeout(300); }
async function seedUsers(run) {
  const ana = await register('Ana López', `ana.ev.${run}@example.test`); const carlos = await register('Carlos Ruiz', `carlos.ev.${run}@example.test`);
  const aAcc = (await api(ana, '/accounts')).b.items, cAcc = (await api(carlos, '/accounts')).b.items;
  const pr = aAcc.find((a) => a.kind === 'checking'), sv = aAcc.find((a) => a.kind === 'savings'), cm = cAcc.find((a) => a.kind === 'checking') ?? cAcc[0];
  const own = (await api(ana, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabe: sv.clabe }) })).b;
  const toC = (await api(ana, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Carlos Ruiz', alias: 'Carlos', clabe: cm.clabe }) })).b;
  const toA = (await api(carlos, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Ana López', alias: 'Ana', clabe: pr.clabe }) })).b;
  const T = (t, body) => api(t, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
  await T(carlos, { sourceAccountId: cm.id, destinationType: 'beneficiary', beneficiaryId: toA.id, amountMinor: '100000', concept: 'Abono honorarios', reference: '994012' });
  await T(ana, { sourceAccountId: pr.id, destinationType: 'beneficiary', beneficiaryId: toC.id, amountMinor: '85000', concept: 'Comida', reference: '131126' });
  return { run, ana: { email: `ana.ev.${run}@example.test`, token: ana }, carlos: { email: `carlos.ev.${run}@example.test`, token: carlos }, pr, sv, cm, own, toC, toA };
}
const bal = (email) => psql(`select string_agg(a.name||'='||a.balance_minor, ' ' order by a.kind) from accounts a join users u on u.id=a.owner_id where u.email='${email}'`);
module.exports = { chromium, psql, L, log, api, apiLogin, register, newPage, login, toDetails, fill, seedUsers, bal, SP, API, APP, PW, fs };
