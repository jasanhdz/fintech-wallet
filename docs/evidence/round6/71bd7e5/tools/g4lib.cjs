// Round 6 G4 evidence helpers: drive the REAL exported RN-web bundle against the isolated API on wallet_test.
// Not native evidence. Ports come from env (defaults 3793/8793); the test password only from G4_TEST_PASSWORD.
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs');
const API_PORT = process.env.G4_API_PORT || '3793';
const WEB_PORT = process.env.G4_WEB_PORT || '8793';
const API = `http://127.0.0.1:${API_PORT}/v1`;
const ORIGIN = `http://localhost:${WEB_PORT}`;
const APP = `${ORIGIN}/`;
const PW = process.env.G4_TEST_PASSWORD;
if (!PW) throw new Error('Set G4_TEST_PASSWORD (any test-only value; never written to disk)');
const log = [];
const L = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };

async function api(token, path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  let b = null; try { b = await r.json(); } catch { /* 204 */ }
  return { s: r.status, b };
}
async function register(fullName, email) {
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: ORIGIN } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrf.json();
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: ORIGIN, cookie }, body: JSON.stringify({ fullName, email, password: PW }) });
  if (!res.ok) throw new Error('register ' + res.status);
  return (await res.json()).accessToken;
}
const transfer = (token, body) => api(token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });

// Ana (name configurable) with Principal + Ahorro, beneficiaries Carlos / own savings / optional long one, one received and one sent movement.
async function seed(run, { name = 'Ana López', longBeneficiary = null } = {}) {
  const anaEmail = `ana.g4.${run}@example.test`, carlosEmail = `carlos.g4.${run}@example.test`;
  const ana = await register(name, anaEmail); const carlos = await register('Carlos Ruiz', carlosEmail);
  const aAcc = (await api(ana, '/accounts')).b.items, cAcc = (await api(carlos, '/accounts')).b.items;
  const pr = aAcc.find((a) => a.kind === 'checking'), sv = aAcc.find((a) => a.kind === 'savings'), cm = cAcc.find((a) => a.kind === 'checking') ?? cAcc[0];
  await api(ana, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabe: sv.clabe }) });
  const toC = (await api(ana, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Carlos Ruiz', alias: 'Carlos', clabe: cm.clabe }) })).b;
  if (longBeneficiary) await api(ana, '/beneficiaries', { method: 'POST', body: JSON.stringify({ ...longBeneficiary, clabe: (cAcc.find((a) => a.id !== cm.id) ?? cm).clabe }) }).then((r) => { if (r.s !== 201) L('long beneficiary', r.s, JSON.stringify(r.b).slice(0, 200)); });
  const toA = (await api(carlos, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Ana López', alias: 'Ana', clabe: pr.clabe }) })).b;
  await transfer(carlos, { sourceAccountId: cm.id, destinationType: 'beneficiary', beneficiaryId: toA.id, amountMinor: '100000', concept: 'Abono honorarios', reference: '994012' });
  await transfer(ana, { sourceAccountId: pr.id, destinationType: 'beneficiary', beneficiaryId: toC.id, amountMinor: '85000', concept: 'Comida', reference: '131126' });
  return { anaEmail, carlosEmail, ana, pr, sv };
}

async function newPage(browser, { h = 844, w = 390 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } }; });
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('pageerror ' + e.message));
  page.btn = (name) => page.getByRole('button', { name, exact: false }).first();
  return page;
}
async function login(page, email) {
  await page.goto(APP); await page.getByLabel('Correo electrónico').waitFor({ timeout: 15000 });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(PW);
  await page.btn('Iniciar sesión').click(); await page.waitForTimeout(2500);
}
// Works with the labels before and after F-19 (visible text in the accessible name).
const label = async (page, ...names) => { for (const n of names) { const l = page.getByLabel(n, { exact: true }); if (await l.count()) return l.first(); } return page.getByLabel(names[0]).first(); };
async function toDetails(page, beneficiaryPrefix, origin = /Cuenta principal/) {
  await page.getByRole('button', { name: origin }).first().click(); await page.waitForTimeout(300);
  await page.getByLabel(/Elegir beneficiario/i).first().click(); await page.waitForTimeout(1200);
  await page.getByLabel(new RegExp(`^Seleccionar ${beneficiaryPrefix}`)).first().click(); await page.waitForTimeout(400);
  await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1200);
}
async function fill(page, amount, concept, ref) {
  await (await label(page, 'Monto a transferir', 'Importe')).fill(amount);
  await (await label(page, 'Concepto de pago', 'Concepto')).fill(concept);
  await (await label(page, 'Referencia numérica', 'Referencia')).fill(ref);
  await page.waitForTimeout(300);
}
const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
// CSS approximation of 130/200 % text (not native fontScale): scales font-size and line-height of every text node box.
const scale = (page, f) => page.evaluate((f) => { document.querySelectorAll('div,span,input,button').forEach((e) => { const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); if (fs && !e.dataset.s) { e.dataset.s = '1'; e.style.fontSize = `${fs * f}px`; const lh = parseFloat(cs.lineHeight); if (lh) e.style.lineHeight = `${lh * f}px`; } }); }, f);
// Every rendered box whose rectangle leaves the viewport horizontally (same rule as the evaluator's s6.cjs).
const overflow = (page) => page.evaluate(() => {
  const W = window.innerWidth; const bad = [];
  document.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && (r.right > W + 1 || r.left < -1)) bad.push(`${e.tagName}:${(e.innerText || e.getAttribute('aria-label') || '').slice(0, 30).replace(/\n/g, ' ')} L${Math.round(r.left)} R${Math.round(r.right)}`); });
  return { docScrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 8), nbad: bad.length };
});
const box = async (page, name) => { const b = await page.getByRole('button', { name }).first().boundingBox().catch(() => null); return b ? { top: Math.round(b.y), bottom: Math.round(b.y + b.height), left: Math.round(b.x), right: Math.round(b.x + b.width) } : null; };

module.exports = { chromium, fs, L, log, api, register, transfer, seed, newPage, login, label, toDetails, fill, blur, scale, overflow, box, API, APP, PW };
