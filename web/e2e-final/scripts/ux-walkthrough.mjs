// UX polish walkthrough (docs/web-ux-polish/SPEC.md §7.3 FLOW-01/02/03, manual review aid). Drives the real P1 stack
// (API 3301 + wallet_test, web 5301 started with serve.mjs) through login → inicio → beneficiario → transferencia bajo y
// sobre el umbral → código → comprobante → historial → cerrar sesión → sesión vencida, at several viewports, and saves
// full-page and viewport captures under docs/evidence/web-ux/<dir>/captures/<viewport>/ (PNG, not versioned).
// Synthetic users (@example.test) are created through the public API. Passwords, OTPs and CLABEs are never printed.
// Usage: node web/e2e-final/scripts/ux-walkthrough.mjs [evidenceDir] [widths...]   e.g. ux-t2 1440 390
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, request } from '@playwright/test';
import { ROOT } from './env-lib.mjs';

const API = 'http://127.0.0.1:3301';
const WEB = 'http://127.0.0.1:5301';
const dir = process.argv[2] ?? 'ux-t2';
const widths = (process.argv.slice(3).length ? process.argv.slice(3) : ['1440', '1024', '768', '390', '320']).map(Number);
const HEIGHT = { 1440: 900, 1280: 800, 1024: 768, 768: 1024, 390: 844, 320: 640 };
const out = resolve(ROOT, 'docs/evidence/web-ux', dir);
const report = [];

const sleep = (ms, unref = false) => new Promise((done) => { const timer = setTimeout(done, ms); if (unref) timer.unref(); });

function clabeFrom(prefix17) {
  const sum = [...prefix17].reduce((total, digit, index) => total + ((Number(digit) * [3, 7, 1][index % 3]) % 10), 0);
  return `${prefix17}${(10 - (sum % 10)) % 10}`;
}

async function apiUser(fullName) {
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Origin: WEB } });
  try {
    for (let attempt = 0; ; attempt += 1) {
      const unique = crypto.randomUUID();
      const email = `ux-walk-${unique}@example.test`;
      const password = `Sintetica-${unique}`;
      const { csrfToken } = await (await api.get('v1/auth/csrf')).json();
      const registration = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrfToken }, data: { fullName, email, password } });
      if (registration.status() === 429 && attempt < 3) { await sleep(61_000); continue; }
      if (registration.status() !== 201) throw new Error(`register ${registration.status()}`);
      const { accessToken } = await registration.json();
      const accounts = (await (await api.get('v1/accounts', { headers: { Authorization: `Bearer ${accessToken}` } })).json()).items;
      const policy = await (await api.get('v1/transfer-policy', { headers: { Authorization: `Bearer ${accessToken}` } })).json();
      return { email, password, accounts, policy };
    }
  } finally { await api.dispose(); }
}

/** Layout checks of the visible page: horizontal overflow, small targets (<44 below 1024), overlays hiding the focus. */
async function audit(page, width) {
  return page.evaluate((min) => {
    const visible = (element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden'; };
    const small = [...document.querySelectorAll('a[href],button,input,select,[role="radio"],[tabindex="0"]')].filter(visible).filter((element) => {
      if (element.closest('p') && element.tagName === 'A' && element.closest('p').textContent.trim() !== element.textContent.trim()) return false;
      const box = element.getBoundingClientRect();
      return box.height + 0.5 < min || box.width + 0.5 < (min === 44 ? 44 : 24);
    }).map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${[...element.classList].join('.')}:${Math.round(element.getBoundingClientRect().width)}x${Math.round(element.getBoundingClientRect().height)} «${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}»`);
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      h1: [...document.querySelectorAll('h1')].filter(visible).map((h) => h.textContent.trim()),
      smallTargets: small.slice(0, 12),
    };
  }, width < 1024 ? 44 : 36);
}

async function run(width) {
  const height = HEIGHT[width] ?? 900;
  const vp = `${width}x${height}`;
  mkdirSync(resolve(out, 'captures', vp), { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce', baseURL: WEB });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console ${message.text().slice(0, 140)}`); });
  let step = 0;
  const shots = [];
  async function shot(name) {
    step += 1;
    process.stderr.write(`${width} ${step} ${name}\n`);
    await page.waitForTimeout(250);
    const base = `${String(step).padStart(2, '0')}-${name}`;
    await page.screenshot({ path: resolve(out, 'captures', vp, `${base}.png`), fullPage: true });
    if (width < 1024) await page.screenshot({ path: resolve(out, 'captures', vp, `${base}-viewport.png`) });
    shots.push({ name: base, url: new URL(page.url()).pathname, ...(await audit(page, width)) });
  }

  const other = await apiUser('Persona Destino Recorrido');
  const owner = await apiUser('Ana Recorrido Pruebas');
  const threshold = BigInt(owner.policy.otpThresholdMinor);

  // W01: idle, client errors, then a real login.
  await page.goto('/login');
  await page.getByRole('heading', { name: 'Iniciar sesión' }).waitFor();
  await shot('w01-login');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await shot('w01-login-errores');
  await page.getByLabel('Correo electrónico').fill(owner.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL(/\/accounts$/);
  await page.locator('.home-account').first().waitFor();
  await page.locator('.home-activity, .home-empty-state').first().waitFor();
  await shot('w03-inicio');

  // W06 empty → W07 errors → W07 saved → W06 list.
  await page.goto('/beneficiaries');
  await page.locator('.bn-empty').waitFor();
  await shot('w06-vacio');
  await page.getByRole('link', { name: 'Agregar beneficiario' }).click();
  await page.getByRole('heading', { name: 'Agregar nuevo beneficiario' }).waitFor();
  await shot('w07-inicial');
  await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
  await shot('w07-errores');
  await page.locator('#name').fill('Persona Destino Recorrido');
  await page.locator('#alias').fill('Destino');
  await page.locator('#clabe').fill(clabeFrom('99900000000000001'));
  await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
  await page.locator('.form-summary').waitFor();
  await shot('w07-no-encontrada');
  await page.locator('#clabe').fill(other.accounts[0].clabe);
  await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
  await page.waitForURL(/\/beneficiaries$/);
  await page.locator('.bn-card').first().waitFor();
  await shot('w06-lista');

  // W08 below the threshold: empty submit (errors), then a valid transfer.
  await page.goto('/transfers/new');
  await page.getByRole('heading', { name: 'Transferir dinero' }).waitFor();
  const sourceChecked = await page.locator('#tf-source-options [role="radio"][aria-checked="true"]').innerText().catch(() => '');
  await shot('w08-inicial');
  await page.getByRole('button', { name: 'Continuar a revisión' }).click();
  await shot('w08-errores');
  await page.locator('#tf-recipient-options [role="radio"]').first().click();
  const below = (threshold / 10n) > 0n ? threshold / 10n : 100n;
  await page.locator('#tf-amount').fill(`${below / 100n}.${String(below % 100n).padStart(2, '0')}`);
  await page.locator('#tf-concept').fill('Pago recorrido');
  await page.locator('#tf-reference').fill('1234567');
  if (width < 1024) { await page.locator('.tf-summary-toggle').click(); }
  await shot('w08-completo');
  await page.getByRole('button', { name: 'Continuar a revisión' }).click();
  await page.getByRole('heading', { name: 'Revisa y confirma tu transferencia' }).waitFor();
  await shot('w09-normal');
  await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
  await page.waitForURL(/\/status$/);
  await page.getByRole('heading', { name: '¡Transferencia completada con éxito!' }).waitFor();
  await shot('w12-comprobante');

  // W08 above the threshold → W09 código → W10 → W12.
  await page.goto('/transfers/new');
  await page.getByRole('heading', { name: 'Transferir dinero' }).waitFor();
  await page.locator('#tf-recipient-options [role="radio"]').first().click().catch(() => undefined);
  const above = threshold + 100n;
  await page.locator('#tf-amount').fill(`${above / 100n}.${String(above % 100n).padStart(2, '0')}`);
  await page.locator('#tf-concept').fill('Pago con código');
  await page.locator('#tf-reference').fill('7654321');
  await page.getByRole('button', { name: 'Continuar a revisión' }).click();
  await page.getByRole('heading', { name: 'Revisa y confirma tu transferencia' }).waitFor();
  await shot('w09-codigo');
  await page.getByRole('button', { name: 'Continuar a verificación' }).click();
  await page.locator('#cf-otp').waitFor();
  await shot('w10-vacio');
  const demoCodeShown = await page.locator('.cf-demo-code strong').count() > 0;
  const code = demoCodeShown ? (await page.locator('.cf-demo-code strong').innerText()).trim() : '';
  await page.locator('#cf-otp').fill('000000' === code ? '111111' : '000000');
  await page.getByRole('button', { name: /Autorizar transferencia/ }).click();
  await page.locator('#cf-wrong').waitFor();
  await shot('w10-incorrecto');
  await page.locator('#cf-otp').fill(code);
  await shot('w10-completo');
  await page.getByRole('button', { name: /Autorizar transferencia/ }).click();
  await page.getByRole('heading', { name: '¡Transferencia completada con éxito!' }).waitFor();
  await shot('w12-comprobante-codigo');

  // W04 from the receipt, then the home with both transfers.
  await page.getByRole('link', { name: 'Ver movimientos' }).click();
  await page.locator('.hist-table, .hist-empty').first().waitFor();
  await shot('w04-historial');
  await page.getByRole('button', { name: 'Salidas' }).click();
  await page.waitForTimeout(400);
  await shot('w04-filtro');
  await page.goto('/accounts');
  await page.locator('.home-activity-table').waitFor();
  await shot('w03-inicio-con-movimientos');

  // Logout (one control per viewport).
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL(/\/login$/);
  await shot('w01-tras-salir');

  // FLOW-03: real API 401 + refresh 401 → W14.
  await page.getByLabel('Correo electrónico').fill(owner.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL(/\/accounts$/);
  await context.clearCookies();
  await page.route(`${API}/v1/**`, (route) => {
    const headers = { ...route.request().headers() };
    if (headers.authorization) headers.authorization = 'Bearer invalido';
    return route.continue({ headers });
  });
  await page.getByRole('link', { name: 'Beneficiarios' }).first().click();
  await page.waitForURL(/\/session-expired$/, { timeout: 15_000 }).catch(() => undefined);
  await shot('w14-sesion-vencida');

  report.push({ viewport: vp, sourceDefault: sourceChecked.split('\n')[0], demoCodeShown, consoleErrors: errors.filter((line) => !/401|Unauthorized|Failed to load resource/.test(line)), shots });
  await browser.close();
}

for (const width of widths) {
  try { await Promise.race([run(width), sleep(240_000, true).then(() => { throw new Error('walkthrough timeout (240 s)'); })]); }
  catch (error) { report.push({ viewport: width, failed: String(error?.message ?? error).split('\n').slice(0, 3).join(' ') }); }
}
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, `walkthrough-${widths.join('-')}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.map((entry) => ({ viewport: entry.viewport, failed: entry.failed, source: entry.sourceDefault, demoCodeShown: entry.demoCodeShown, consoleErrors: entry.consoleErrors?.length, issues: entry.shots?.filter((shot) => shot.overflowX || shot.smallTargets.length || shot.h1.length !== 1).map((shot) => `${shot.name}${shot.overflowX ? ' overflowX' : ''}${shot.h1.length !== 1 ? ` h1=${shot.h1.length}` : ''}${shot.smallTargets.length ? ` small=${shot.smallTargets.join(' | ')}` : ''}`) })), null, 2));
