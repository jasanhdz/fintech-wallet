// G3 checks on the exported RN-web bundle (:8790) + isolated API (:3790, wallet_test). Not native evidence.
// F-11 long name + text scale, M07 actions at 390x844/884, folio layout, Inter actually rendered.
// Usage: G3_TEST_PASSWORD=... node extras.cjs <seed.json> <outDir>
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs');
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const API = 'http://127.0.0.1:3790/v1'; const APP = 'http://localhost:8790/'; const lines = []; const log = (...a) => { const s = a.join(' '); console.log(s); lines.push(s); };
const LONG = 'Ana María de los Ángeles López-Hernández de la Cruz y Villaseñor';
async function register(fullName, email) {
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: 'http://localhost:8790' } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); const { csrfToken } = await csrf.json();
  const r = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: 'http://localhost:8790', cookie }, body: JSON.stringify({ fullName, email, password: seed.password }) });
  if (!r.ok) throw new Error('register ' + r.status);
}
(async () => {
  const browser = await chromium.launch();
  const page = async (h = 844) => { const ctx = await browser.newContext({ viewport: { width: 390, height: h }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: 'America/Mexico_City' }); const p = await ctx.newPage(); await p.addInitScript(() => { window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } }; }); return p; };
  const login = async (p, email) => { await p.goto(APP); await p.waitForTimeout(1500); await p.getByLabel('Correo electrónico').fill(email); await p.getByLabel('Contraseña', { exact: true }).fill(seed.password); await p.getByRole('button', { name: 'Iniciar sesión' }).first().click(); await p.waitForTimeout(2500); };
  const scale = (p, f) => p.evaluate((f) => document.querySelectorAll('div,span,input').forEach((e) => { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs) e.style.fontSize = `${fs * f}px`; const lh = parseFloat(getComputedStyle(e).lineHeight); if (lh) e.style.lineHeight = `${lh * f}px`; }), f);

  // Inter is really used (not only declared)
  let p = await page(); await p.goto(APP); await p.waitForTimeout(2000);
  const fontInfo = await p.evaluate(async () => { await document.fonts.ready; return { loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family), titleFamily: getComputedStyle([...document.querySelectorAll('div[dir=auto]')].find((e) => e.textContent === 'Iniciar sesión')).fontFamily, check: document.fonts.check('16px Inter_600SemiBold') }; });
  log('FONTS loaded faces:', fontInfo.loaded.filter((f) => /Inter/.test(f)).join(','), '| title family:', fontInfo.titleFamily, '| document.fonts.check(Inter_600SemiBold):', fontInfo.check);
  await p.context().close();

  // F-11: 64-character name, 100 / 130 / 200 % text
  const email = `largo.g3.${seed.run}.${Date.now() % 100000}@example.test`; await register(LONG, email);
  for (const f of [1, 1.3, 2]) {
    p = await page(); await login(p, email); if (f !== 1) { await scale(p, f); await p.waitForTimeout(400); }
    const b = await p.getByRole('button', { name: 'Cerrar sesión' }).boundingBox();
    const g = await p.evaluate(() => { const e = [...document.querySelectorAll('div[dir=auto]')].find((d) => d.textContent.startsWith('Hola, ')); const r = e.getBoundingClientRect(); return { right: Math.round(r.right), lines: Math.round(r.height / parseFloat(getComputedStyle(e).lineHeight)), overflowX: document.documentElement.scrollWidth > window.innerWidth }; });
    log(`F-11 text ${Math.round(f * 100)}%: logout x=${Math.round(b.x)}..${Math.round(b.x + b.width)} (viewport 390) visible=${b.x >= 0 && b.x + b.width <= 390} | greeting right=${g.right} lines=${g.lines} | horizontal overflow=${g.overflowX}`);
    await p.screenshot({ path: `${OUT}/F11-nombre-largo-${Math.round(f * 100)}.png` });
    await p.getByRole('button', { name: 'Cerrar sesión' }).click(); await p.waitForTimeout(1500);
    log(`F-11 text ${Math.round(f * 100)}%: logout works ->`, /Iniciar sesión/.test(await p.evaluate(() => document.body.innerText)));
    await p.context().close();
  }

  // M07 (F-13): actions within the first screen at 390x884 (reference height) and 390x844; 130 % text reachable by scroll
  for (const h of [884, 844]) {
    p = await page(h); await login(p, seed.ana.email);
    await p.getByLabel('Transferir dinero, elegir beneficiario').click(); await p.waitForTimeout(1200); await p.getByLabel(/^Seleccionar Carlos/).first().click(); await p.waitForTimeout(300);
    await p.getByRole('button', { name: 'Continuar con transferencia' }).click(); await p.waitForTimeout(1000);
    await p.getByLabel('Monto a transferir').fill('850.00'); await p.getByLabel('Concepto de pago').fill('Comida'); await p.getByLabel('Referencia numérica').fill('131126');
    await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(1200);
    const c = await p.getByRole('button', { name: 'Confirmar transferencia' }).boundingBox(); const m = await p.getByRole('button', { name: 'Modificar datos' }).boundingBox();
    log(`F-13 M07 390x${h}: Confirmar bottom=${Math.round(c.y + c.height)} Modificar bottom=${Math.round(m.y + m.height)} both visible=${c.y + c.height <= h && m.y + m.height <= h}`);
    await p.screenshot({ path: `${OUT}/F13-M07-390x${h}.png` });
    if (h === 844) { await scale(p, 1.3); await p.waitForTimeout(400); await p.getByRole('button', { name: 'Modificar datos' }).scrollIntoViewIfNeeded(); const m2 = await p.getByRole('button', { name: 'Modificar datos' }).boundingBox(); log(`F-13 M07 130% text: actions reachable by scrolling, Modificar within viewport after scroll=${m2.y >= 0 && m2.y + m2.height <= h}`); await p.screenshot({ path: `${OUT}/F13-M07-130.png` }); }
    await p.context().close();
  }

  // Folio: full UUID on the M04 detail, no horizontal overflow, label on one line
  p = await page(); await login(p, seed.ana.email); await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1500);
  await p.getByRole('button', { name: /^Cargo / }).first().click(); await p.waitForTimeout(1500);
  const folio = await p.evaluate(() => { const v = document.querySelector('[data-testid=folio-value]'); const label = [...document.querySelectorAll('div[dir=auto]')].find((e) => e.textContent === 'Folio interno'); const r = v.getBoundingClientRect(); return { text: v.textContent, right: Math.round(r.right), lines: Math.round(r.height / parseFloat(getComputedStyle(v).lineHeight)), labelLines: Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight)), overflowX: document.documentElement.scrollWidth > window.innerWidth, userSelect: getComputedStyle(v).userSelect }; });
  log(`FOLIO M04: "${folio.text}" uuid=${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(folio.text)} right=${folio.right} lines=${folio.lines} labelLines=${folio.labelLines} overflowX=${folio.overflowX} userSelect=${folio.userSelect}`);
  await p.screenshot({ path: `${OUT}/folio-M04.png` });
  await p.context().close();
  fs.writeFileSync(`${OUT}/extras-log.txt`, lines.join('\n') + '\n');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
