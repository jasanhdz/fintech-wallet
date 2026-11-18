// Round 7 H2 render evidence: drives the REAL exported RN-web bundle (expo export --platform web, SecureStore shim from
// round6/71bd7e5/tools/patch.py) to M10 and captures the receipt actions in their states. NOT native evidence.
// The API is answered by Playwright (page.route) with fixed demo data, so no database is touched. navigator.share is
// replaced by a stub per state (hang = sheet open, abort = user closed it, reject = failure); nothing leaves the page.
// Usage: node h2cap.cjs <outDir> <designMobileDir>    (bundle served at http://localhost:${H2_WEB_PORT:-8795},
//        exported with EXPO_PUBLIC_API_URL=http://127.0.0.1:${H2_API_PORT:-3795}/v1; nothing listens on that port)
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [OUT, DESIGN] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = `http://localhost:${process.env.H2_WEB_PORT || '8795'}`;
const API = `http://127.0.0.1:${process.env.H2_API_PORT || '3795'}/v1`;
const lines = []; const L = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };

const FOLIO = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const user = { id: '00000000-0000-4000-8000-0000000000a1', fullName: 'Ana López', email: 'ana.h2@example.test' };
const principal = (balance) => ({ id: '00000000-0000-4000-8000-0000000000b1', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: balance, clabe: '646180000000008412', clabeMasked: '646•••••••••••8412' });
const beneficiary = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Carlos Ruiz', alias: 'Carlos', clabeMasked: '646•••••••••••0028', destinationAccountId: '00000000-0000-4000-8000-0000000000d1' };
const transfer = { id: FOLIO, status: 'completed', sourceAccountId: principal('0').id, destination: beneficiary, amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', createdAt: '2026-11-13T20:31:59.000Z', completedAt: '2026-11-13T20:32:00.000Z', expiresAt: null, receiptReference: FOLIO };
const policy = { currency: 'MXN', businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpThresholdMinor: '500000', otpExpirySeconds: 300, otpMaxAttempts: 5, demoOnly: true };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1300 }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } };
    window.__shareMode = 'hang'; window.__shared = [];
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value(data) {
      window.__shared.push(data);
      if (window.__shareMode === 'hang') return new Promise((resolve) => { window.__release = resolve; });
      if (window.__shareMode === 'abort') return Promise.reject(new DOMException('Share canceled', 'AbortError'));
      return Promise.reject(new Error('NotAllowedError: simulated failure'));
    } });
  });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  let completed = false; const calls = [];
  await p.route(`${API}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const pathName = url.pathname.replace(/^\/v1/, '');
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls.push(`${req.method()} ${pathName}`);
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (pathName === '/auth/login') return json(200, { accessToken: 'demo-access', refreshToken: 'demo-refresh', tokenType: 'Bearer', expiresIn: 900, user });
    if (pathName === '/auth/me') return json(200, user);
    if (pathName === '/accounts') return json(200, { items: [principal(completed ? '1160000' : '1245000')] });
    if (pathName.endsWith('/movements')) return json(200, { items: [], nextCursor: null });
    if (pathName === '/beneficiaries') return json(200, { items: [beneficiary] });
    if (pathName === '/transfer-policy') return json(200, policy);
    if (pathName === '/transfers' && req.method() === 'POST') { completed = true; return json(201, transfer); }
    if (pathName === `/transfers/${FOLIO}`) return json(200, transfer);
    return json(404, { message: 'not mocked' });
  });
  const btn = (name) => p.getByRole('button', { name, exact: false }).first();
  async function shot(name) {
    await p.waitForTimeout(400);
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 1600) });
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    fs.writeFileSync(`${OUT}/${name}.txt`, await p.evaluate(() => document.body.innerText));
    const disabled = await p.evaluate(() => [...document.querySelectorAll('[role=button][aria-disabled=true]')].map((e) => e.innerText || e.getAttribute('aria-label')).filter(Boolean));
    const busy = await p.evaluate(() => [...document.querySelectorAll('[role=progressbar],[aria-busy=true]')].map((e) => e.getAttribute('aria-label') || 'busy'));
    L(`SHOT ${name} scrollW=${await p.evaluate(() => document.documentElement.scrollWidth)} disabled=[${disabled.join(' | ')}] busy=[${busy.join(' | ')}] errs=${errs.length}`);
  }
  const visibleText = () => p.evaluate(() => document.body.innerText);

  await p.goto(ORIGIN + '/'); await p.getByLabel('Correo electrónico').waitFor({ timeout: 20000 });
  await p.getByLabel('Correo electrónico').fill(user.email); await p.getByLabel('Contraseña', { exact: true }).fill('not-a-real-password');
  await btn('Iniciar sesión').click(); await p.waitForTimeout(2000);
  await p.getByLabel('Transferir dinero, elegir beneficiario').first().click(); await p.waitForTimeout(800);
  await p.getByLabel(/^Seleccionar Carlos/).first().click(); await p.waitForTimeout(300);
  await btn('Continuar con transferencia').click(); await p.waitForTimeout(400);
  await p.getByLabel('Monto a transferir', { exact: true }).fill('850.00'); await p.getByLabel('Concepto de pago', { exact: true }).fill('Comida'); await p.getByLabel(/Referencia numérica/).first().fill('131126');
  await p.waitForTimeout(400); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
  await btn('Confirmar transferencia').click(); await p.waitForTimeout(1500);
  L('M10 reached:', /Transferencia completada/.test(await visibleText()));

  await shot('M10-H2-normal');
  // Sheet open (navigator.share pending): both actions disabled, indicator on the pressed one, live status text.
  await btn('Compartir comprobante').click(); await p.waitForTimeout(300);
  await shot('M10-H2-en-curso');
  const shared = await p.evaluate(() => window.__shared[0]);
  const sharedText = `${shared?.title ?? ''}\n${shared?.text ?? ''}`;
  L('shared payload has folio:', sharedText.includes(FOLIO), '| demo notice:', sharedText.includes('Comprobante interno de demostración — no es un comprobante bancario oficial'), '| full CLABE:', /646180000000/.test(sharedText), '| e-mail:', sharedText.includes(user.email), '| ids:', /0000-4000-8000/.test(sharedText));
  fs.writeFileSync(`${OUT}/shared-text.txt`, sharedText);
  // User closes the sheet: no failure message, actions enabled again.
  await p.evaluate(() => window.__release()); await p.waitForTimeout(300);
  L('after close: error shown =', /No se pudo|no está disponible/.test(await visibleText()), '| busy text =', /Abriendo la hoja/.test(await visibleText()));
  await p.evaluate(() => { window.__shareMode = 'abort'; }); await btn('Compartir comprobante').click(); await p.waitForTimeout(300);
  L('after AbortError (cancel): error shown =', /No se pudo/.test(await visibleText()));
  await p.evaluate(() => { window.__shareMode = 'reject'; }); await btn('Compartir comprobante').click(); await p.waitForTimeout(300);
  await shot('M10-H2-error');
  await btn('Compartir PDF').click(); await p.waitForTimeout(300);
  await shot('M10-H2-pdf-web');
  L('API calls:', calls.join(', '));
  L('page errors:', errs.length ? errs.join(' / ') : 'none');

  // Side by side: Stitch m10_transferencia_completada_2 | normal | en curso | error | PDF en web.
  const url = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  const W = 300;
  const panel = (title, f) => `<figure style="margin:0"><figcaption style="color:#fff;width:${W}px;padding-bottom:4px">${title}</figcaption><img src="${url(f)}" style="width:${W}px;display:block;background:#fff"></figure>`;
  const ref = path.join(DESIGN, 'm10_transferencia_completada_2', 'screen.png');
  const composer = await browser.newPage({ deviceScaleFactor: 1 });
  await composer.setContent(`<html><body style="margin:0;background:#777;font:13px system-ui"><div id="sbs" style="display:inline-flex;gap:12px;padding:12px;align-items:flex-start">${[
    panel('Stitch · m10_transferencia_completada_2', ref), panel('Normal (RN-Web)', `${OUT}/M10-H2-normal.png`), panel('En curso: hoja abierta', `${OUT}/M10-H2-en-curso.png`),
    panel('Error al compartir (reintentable)', `${OUT}/M10-H2-error.png`), panel('PDF en web: mensaje', `${OUT}/M10-H2-pdf-web.png`)].join('')}</div></body></html>`);
  await composer.waitForTimeout(200);
  await composer.locator('#sbs').screenshot({ path: `${OUT}/M10-H2--lado-a-lado.jpg`, type: 'jpeg', quality: 72 });
  fs.writeFileSync(`${OUT}/capture-h2.txt`, lines.join('\n') + '\n');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
