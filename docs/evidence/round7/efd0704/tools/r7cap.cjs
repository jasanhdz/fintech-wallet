// Round 7 (H1) render evidence: drives the REAL exported RN-web bundle (expo export --platform web) against the isolated
// API on wallet_test. NOT native evidence. The demo code is blurred on screen and never written to the logs.
// Usage: R7_API_PORT=3794 R7_WEB_PORT=8794 R7_TEST_PASSWORD=<test-only> node r7cap.cjs <outDir> <label>
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs');
const crypto = require('crypto');
const [OUT, LABEL] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const API = `http://127.0.0.1:${process.env.R7_API_PORT || '3794'}/v1`;
const ORIGIN = `http://localhost:${process.env.R7_WEB_PORT || '8794'}`;
const PW = process.env.R7_TEST_PASSWORD; if (!PW) throw new Error('Set R7_TEST_PASSWORD');
const H = { m02: 929, m05: 884, m06: 899, m07: 884, m07u: 931, m08: 884, m09: 918, m10: 1149, m11: 884, m12: 884 };
const lines = []; const L = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };
const run = `${LABEL}${String(Date.now()).slice(-6)}`;
let userNo = 0;

async function call(token, path, init = {}) {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  return { s: r.status, b: r.status === 204 ? null : await r.json().catch(() => null) };
}
async function user() {
  userNo += 1;
  const email = `ana${userNo}.r7.${run}@example.test`;
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: ORIGIN } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrf.json();
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: ORIGIN, cookie }, body: JSON.stringify({ fullName: 'Ana López', email, password: PW }) });
  // The auth routes are rate limited (10/min): wait for the window instead of failing the run.
  if (res.status === 429) { L('auth rate limit: waiting 61 s'); await new Promise((r) => setTimeout(r, 61_000)); userNo -= 1; return user(); }
  if (!res.ok) throw new Error('register ' + res.status);
  const token = (await res.json()).accessToken;
  const acc = (await call(token, '/accounts')).b.items;
  const pr = acc.find((a) => a.kind === 'checking'); const sv = acc.find((a) => a.kind === 'savings');
  const own = (await call(token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabe: sv.clabe }) })).b;
  const toPr = (await call(token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta principal demo', alias: 'Principal demo', clabe: pr.clabe }) })).b;
  return { email, token, pr, sv, own, toPr };
}
const xfer = (u, from, to, amountMinor) => call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: from.id, destinationType: 'beneficiary', beneficiaryId: to.id, amountMinor, concept: 'Ajuste', reference: '1' }) });

(async () => {
  const browser = await chromium.launch();
  async function page(h, { scale = 1 } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: h }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } }; });
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
    p.scaleFactor = scale;
    p.btn = (name) => p.getByRole('button', { name, exact: false }).first();
    return p;
  }
  // CSS approximation of fontScale (not native Dynamic Type).
  const applyScale = (p) => (p.scaleFactor === 1 ? null : p.evaluate((f) => { document.querySelectorAll('div,span,input').forEach((e) => { const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); if (fs && !e.dataset.s) { e.dataset.s = '1'; e.style.fontSize = `${fs * f}px`; const lh = parseFloat(cs.lineHeight); if (lh) e.style.lineHeight = `${lh * f}px`; } }); }, p.scaleFactor));
  async function shot(p, name, { keepFocus = false } = {}) {
    await p.waitForTimeout(500);
    if (!keepFocus) await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await applyScale(p);
    // Blur the demo-code notice: the code value never appears in captures.
    await p.evaluate(() => { document.querySelectorAll('div[dir=auto]').forEach((e) => { if (/^Código asignado para esta prueba/.test(e.innerText || '')) e.style.filter = 'blur(6px)'; }); });
    await p.screenshot({ path: `${OUT}/${name}.png` });
    const text = (await p.evaluate(() => document.body.innerText)).replace(/\b\d{6}\b/g, '••••••');
    fs.writeFileSync(`${OUT}/${name}.txt`, text);
    const sizes = await p.evaluate(() => { const s = new Map(); document.querySelectorAll('div[dir=auto]').forEach((e) => { if (!e.children.length || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { const f = parseFloat(getComputedStyle(e).fontSize); if (f && /\p{L}|\d/u.test(e.innerText) && !/ionicons|material/i.test(getComputedStyle(e).fontFamily)) s.set(f, (s.get(f) || 0) + 1); } }); return [...s.entries()].sort((a, b) => a[0] - b[0]); });
    const over = await p.evaluate(() => document.documentElement.scrollWidth);
    L(`SHOT ${name} minFont=${sizes[0]?.[0]} fonts=${sizes.map(([f, n]) => `${f}x${n}`).join(',')} scrollW=${over} errs=${p.errs.length}`);
  }
  async function login(p, u) {
    await new Promise((r) => setTimeout(r, 7_000)); // stay under the auth rate limit (register + login per user)
    await p.goto(ORIGIN + '/'); await p.getByLabel('Correo electrónico').waitFor({ timeout: 20000 });
    await p.getByLabel('Correo electrónico').fill(u.email); await p.getByLabel('Contraseña', { exact: true }).fill(PW);
    await p.btn('Iniciar sesión').click(); await p.waitForTimeout(2500);
  }
  const choose = async (p, prefix) => { await p.getByLabel(/Elegir beneficiario/i).first().click(); await p.waitForTimeout(1200); await p.getByLabel(new RegExp(`^Seleccionar ${prefix}`)).first().click(); await p.waitForTimeout(400); };
  const fill = async (p, amount) => { await p.getByLabel('Monto a transferir', { exact: true }).fill(amount); await p.getByLabel('Concepto de pago', { exact: true }).fill('Comida'); await p.getByLabel(/Referencia numérica/).first().fill('131126'); await p.waitForTimeout(400); };
  const box = async (p, name) => { const b = await p.getByRole('button', { name }).first().boundingBox().catch(() => null); return b ? `${Math.round(b.y)}-${Math.round(b.y + b.height)}` : 'n/a'; };

  // M02: valid pair and incompatible pair (origin Ahorro, destination the own savings beneficiary).
  { const u = await user(); const p = await page(H.m02); await login(p, u); await choose(p, 'Cuenta de ahorro demo'); await shot(p, 'M02-par-valido');
    await p.getByRole('button', { name: /^Cuenta de ahorro/ }).first().click().catch(async () => { await p.getByRole('button', { name: /ahorro/i }).first().click(); });
    await p.waitForTimeout(600); await shot(p, 'M02-incompatible');
    L('M02 incompatible: "Elegir otro destinatario"', await p.getByRole('button', { name: 'Elegir otro destinatario' }).count(), '"Continuar con transferencia"', await p.getByRole('button', { name: 'Continuar con transferencia' }).count());
    const target = p.getByRole('button', { name: 'Elegir otro destinatario' });
    if (await target.count()) { await target.click(); await p.waitForTimeout(1200); await shot(p, 'M05-desde-incompatible'); }
    await p.context().close(); }

  // M06/M07/M08/M10 at 100 %, 130 % and 200 % (CSS approximation), M06 with the keyboard focus on the amount.
  for (const scale of [1, 1.3, 2]) {
    const tag = scale === 1 ? '' : `-x${scale}`;
    const u = await user(); const p = await page(H.m06, { scale }); await login(p, u);
    await p.getByRole('button', { name: /principal/i }).first().click(); await p.waitForTimeout(300);
    await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
    await fill(p, '850.00'); await shot(p, `M06-datos${tag}`);
    if (scale === 1) { await p.getByLabel('Monto a transferir', { exact: true }).focus(); await shot(p, 'M06-teclado-enfocado', { keepFocus: true }); }
    await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
    await p.setViewportSize({ width: 390, height: H.m07 }); await shot(p, `M07-revision${tag}`);
    if (scale === 1) L('M07 normal @884: Confirmar', await box(p, 'Confirmar transferencia'), 'Modificar', await box(p, 'Modificar datos'));
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.setViewportSize({ width: 390, height: H.m10 }); await shot(p, `M10-comprobante${tag}`);
    await p.context().close();

    const v = await user(); const q = await page(H.m07u, { scale }); await login(q, v);
    await q.getByRole('button', { name: /principal/i }).first().click(); await choose(q, 'Cuenta de ahorro demo'); await q.btn('Continuar con transferencia').click(); await q.waitForTimeout(1200);
    await fill(q, '6000.00'); await q.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await q.waitForTimeout(1500);
    await shot(q, `M07-umbral${tag}`);
    if (scale === 1) { await q.setViewportSize({ width: 390, height: 844 }); await q.waitForTimeout(300); L('M07 umbral @844: Continuar', await box(q, 'Continuar a verificación'), 'Modificar', await box(q, 'Modificar datos')); await q.mouse.move(195, 400); await q.mouse.wheel(0, 2000); await q.waitForTimeout(500); L('M07 umbral @844 after scrolling: Continuar', await box(q, 'Continuar a verificación'), 'Modificar', await box(q, 'Modificar datos')); await shot(q, 'M07-umbral-844-desplazado'); await q.mouse.wheel(0, -2000); await q.setViewportSize({ width: 390, height: H.m07u }); }
    await q.btn('Continuar a verificación').click(); await q.waitForTimeout(2500);
    await q.setViewportSize({ width: 390, height: H.m08 }); await shot(q, `M08-vacio${tag}`);
    if (scale === 1) {
      const input = q.getByLabel('Código de confirmación', { exact: true });
      await input.fill('12'); await shot(q, 'M08-incompleto', { keepFocus: true });
      await input.fill('000000'); await shot(q, 'M08-completo');
      await q.btn('Autorizar transferencia').click(); await q.waitForTimeout(1500); await shot(q, 'M08-incorrecto');
      for (let i = 0; i < 4; i += 1) { await input.fill('000000'); await q.btn('Autorizar transferencia').click(); await q.waitForTimeout(1200); }
      await shot(q, 'M08-intentos-agotados');
      const before = await call(v.token, '/accounts');
      await q.btn('Solicitar un código nuevo').click({ timeout: 5000 }).catch(() => L('control not present in this build')); await q.waitForTimeout(2500); await shot(q, 'M08-codigo-nuevo');
      const after = await call(v.token, '/accounts');
      L('M08 new code: balances unchanged', JSON.stringify(before.b.items.map((a) => a.availableBalanceMinor)) === JSON.stringify(after.b.items.map((a) => a.availableBalanceMinor)));
    }
    await q.context().close();
  }

  // M11: insufficient balance (amount above the balance, below the threshold) and daily limit.
  { const u = await user();
    await xfer(u, u.pr, u.own, '499999'); await xfer(u, u.pr, u.own, '499999'); // Principal 2 cents left
    const p = await page(H.m11); await login(p, u);
    await p.getByRole('button', { name: /principal/i }).first().click(); await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
    await fill(p, '100.00');
    // Client-side warning before sending (the balance shown is already below the amount).
    await shot(p, 'M06-saldo-insuficiente');
    await p.context().close(); }
  { const u = await user();
    for (const [from, to] of [[u.pr, u.own], [u.pr, u.own], [u.sv, u.toPr], [u.sv, u.toPr]]) await xfer(u, from, to, '499999');
    const p = await page(H.m11); await login(p, u);
    await p.getByRole('button', { name: /principal/i }).first().click(); await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1500);
    await fill(p, '0.04'); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
    // Another device uses the remaining limit meanwhile: the API answers 429 "Se excedió el límite diario".
    await xfer(u, u.pr, u.own, '4');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await shot(p, 'M11-limite-diario');
    await p.context().close(); }
  { const u = await user(); const p = await page(H.m11); await login(p, u);
    await p.getByRole('button', { name: /principal/i }).first().click(); await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
    await fill(p, '4000.00'); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
    await xfer(u, u.pr, u.own, '499999'); await xfer(u, u.pr, u.own, '499999'); // the balance is spent elsewhere meanwhile
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await shot(p, 'M11-saldo-insuficiente');
    await p.context().close(); }

  // M09: lost response -> "Ir al inicio" -> pending notice on Home -> verify (same key).
  { const u = await user(); const p = await page(H.m09); await login(p, u);
    await p.getByRole('button', { name: /principal/i }).first().click(); await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
    await fill(p, '300.25'); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
    const keys = [];
    await p.route('**/v1/transfers', async (route) => { keys.push(route.request().headers()['idempotency-key']); const resp = await route.fetch(); if (keys.length === 1) { await route.abort('connectionreset'); return; } await route.fulfill({ response: resp }); });
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await shot(p, 'M09-verificando');
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    await p.setViewportSize({ width: 390, height: H.m02 }); await shot(p, 'M02-aviso-pendiente');
    await p.btn('Verificar estado de la transferencia').click({ timeout: 5000 }).catch(() => L('control not present in this build')); await p.waitForTimeout(3000); await shot(p, 'M09-resuelto');
    const acc = (await call(u.token, '/accounts')).b.items.map((a) => `${a.kind}=${a.availableBalanceMinor}`).join(' ');
    const rows = (await call(u.token, `/accounts/${u.pr.id}/movements?limit=20`)).b.items.filter((m) => m.amountMinor === '30025').length;
    L(`M09: keys=${keys.length} distinct=${new Set(keys).size} balances ${acc} movements(30025)=${rows}`);
    // M12: hidden document (RN-web AppState maps visibilitychange) shows the curtain.
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.setViewportSize({ width: 390, height: H.m12 }); await shot(p, 'M12-cortina');
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(1500); await shot(p, 'M12-regreso');
    await p.context().close(); }

  await browser.close();
  fs.writeFileSync(`${OUT}/capture-log.txt`, lines.join('\n') + '\n');
})().catch((e) => { console.error('FAILED', e.message); fs.writeFileSync(`${OUT}/capture-log.txt`, lines.join('\n') + `\nFAILED ${e.message}\n`); process.exitCode = 1; });
