// WF-T1 acceptance: W01 (login), W02 (register), W14 (session expired / access unavailable / not found).
// [F] scenarios use the simulated API (helpers/mock-api.ts); [I] scenarios use the real P1/P2 APIs of §5.10.
import { expect, request as playwrightRequest, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockApi } from './helpers/mock-api.js';
import { capturePath, recordCapture, recordMetric } from './helpers/evidence.js';
import { box, horizontalOverflow, near, styles } from './helpers/geometry.js';
import { composeSideBySide, referenceViewport } from './helpers/side-by-side.js';
import { clippedText, contrastFailures, headingOutline, tabOrder } from './helpers/a11y.js';

const WEB_ORIGIN = 'http://127.0.0.1:5301';
const API_ORIGIN = 'http://127.0.0.1:3301';
const REF = {
  W01: 'w01_login_demostraci_n',
  W02: 'w02_registro',
  W14_EXPIRED: 'w14_sesi_n_vencida',
  W14_ACCESS: 'w14_acceso_no_autorizado',
} as const;
type Viewport = { label: string; width: number; height: number; dpr: number };
const R = referenceViewport(REF.W01); // all four T1 references are 1600×1280 → 1280×1024 @1.25
const VIEWPORTS: Viewport[] = [
  { label: '1440', width: 1440, height: 960, dpr: 1 },
  { label: 'R', width: R.width, height: R.height, dpr: R.dpr },
  { label: '768', width: 768, height: 1024, dpr: 1 },
  { label: '390', width: 390, height: 844, dpr: 1 },
];
/** Inventory (docs/web-fidelity-final/actions-inventory.md) in tab order. */
const INVENTORY = {
  W01: ['Saltar al contenido', 'Correo electrónico', 'Contraseña', 'Mostrar contraseña', 'Iniciar sesión', 'Regístrate aquí'],
  W02: ['Saltar al contenido', 'Nombre completo', 'Correo electrónico', 'Contraseña', 'Mostrar contraseña', 'Confirmar contraseña', 'Mostrar confirmación', 'Crear cuenta', 'Inicia sesión'],
  W14_EXPIRED: ['Saltar al contenido', 'Iniciar sesión'],
  W14_PENDING: ['Saltar al contenido', 'Iniciar sesión y retomar la verificación'],
  W14_ACCESS: ['Saltar al contenido', 'Volver al inicio'],
} as const;
const ATTEMPT_KEY = `wallet:web:transfer-attempt:${data.user.id}`;
const pendingBody = { sourceAccountId: data.ids.checking, destinationType: 'beneficiary', beneficiaryId: data.ids.beneficiary, amountMinor: '123456', concept: 'Pago de prueba pendiente', reference: '4321' };

/** FONT-04 + FN-17: foreign hosts and console/page errors (provoked HTTP failures are listed, not hidden). */
function watch(page: Page) {
  const foreign: string[] = []; const errors: string[] = []; const provoked: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return;
    const origin = new URL(url).origin;
    if (![WEB_ORIGIN, API_ORIGIN, 'http://127.0.0.1:5302', 'http://127.0.0.1:3302'].includes(origin)) foreign.push(url);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/^Failed to load resource: (the server responded with a status of (401|403|404|409|429)|net::ERR_(INTERNET_DISCONNECTED|FAILED|CONNECTION_RESET))/.test(message.text())) provoked.push(message.text());
    else errors.push(message.text());
  });
  return { foreign, errors, provoked };
}

async function newPage(browser: Browser, viewport: Viewport, baseURL = WEB_ORIGIN): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
  return { context, page: await context.newPage() };
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Reduced motion still runs 0.01 ms transitions: wait two frames so computed styles are final.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function shoot(page: Page, name: string, row: { scenario: string; screen: string; state: string; reference: string }, viewport: Viewport) {
  await settle(page);
  const file = capturePath(`${name}-${viewport.width}x${viewport.height}@${viewport.dpr}.png`);
  await page.screenshot({ path: file, fullPage: true });
  recordCapture({ ...row, level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file });
  return file;
}

/** R capture (viewport only) composed next to the approved reference PNG. */
async function sideBySide(browser: Browser, page: Page, name: string, reference: string, row: { scenario: string; screen: string; state: string }, viewport: Viewport = { label: 'R', width: R.width, height: R.height, dpr: R.dpr }) {
  await settle(page);
  const product = capturePath(`${name}-R-viewport-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: product });
  const composed = await composeSideBySide(browser, reference, product, capturePath(`${name}-sbs${viewport.height === R.height ? '' : `-${viewport.height}`}.png`));
  recordCapture({ ...row, state: `${row.state} · lado a lado`, level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file: composed.file, reference });
  return composed;
}

async function responsive(page: Page) {
  const overflow = await horizontalOverflow(page);
  expect(overflow.scrollWidth, 'RESP-01').toBeLessThanOrEqual(overflow.innerWidth);
  expect(overflow.offenders, 'RESP-02').toEqual([]);
  return overflow;
}

async function a11yBasics(page: Page, inventory: readonly string[]) {
  const outline = await headingOutline(page);
  expect(outline.lang, 'A11Y-09 lang').toBe('es');
  expect(outline.h1, 'A11Y-09 one h1').toBe(1);
  expect(outline.skips, 'A11Y-09 no skipped levels').toBe(0);
  const contrast = await contrastFailures(page);
  expect(contrast.failures, 'A11Y-04').toEqual([]);
  const stops = await tabOrder(page);
  expect(stops.map((stop) => stop.name), 'A11Y-01 tab order = inventory').toEqual([...inventory]);
  for (const stop of stops) {
    expect(stop.outlineStyle, `A11Y-02 ${stop.name}`).not.toBe('none');
    expect(stop.outlineWidth, `A11Y-02 ${stop.name}`).toBeGreaterThanOrEqual(2);
    expect(stop.ratio, `A11Y-02 ${JSON.stringify(stop)}`).toBeGreaterThanOrEqual(3);
  }
  return { outline, contrastChecked: contrast.checked, tabOrder: stops };
}

/** A11Y-05: 200 % zoom equivalent (640×512) and 320 px reflow. */
async function reflow(browser: Browser, open: (page: Page) => Promise<void>) {
  const results: Record<string, unknown> = {};
  for (const viewport of [{ label: 'zoom200', width: 640, height: 512, dpr: 1 }, { label: 'reflow320', width: 320, height: 640, dpr: 1 }]) {
    const { context, page } = await newPage(browser, viewport);
    await open(page);
    const overflow = await responsive(page);
    const clipped = await clippedText(page);
    expect(clipped, `A11Y-05 ${viewport.label}`).toEqual([]);
    results[viewport.label] = { scrollWidth: overflow.scrollWidth, innerWidth: overflow.innerWidth, clipped };
    await context.close();
  }
  return results;
}

const fontOf = (locator: Locator) => styles(locator, ['font-size', 'font-weight', 'line-height', 'color'] as const);
const sessionAttempt = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), ATTEMPT_KEY);
const seedAttempt = (page: Page, record: unknown) => page.addInitScript(({ userId, key, value }) => {
  if (sessionStorage.getItem('wf-t1-seeded')) return;
  sessionStorage.setItem('wf-t1-seeded', '1');
  sessionStorage.setItem('wallet:web:active-user', userId);
  sessionStorage.setItem(key, value);
}, { userId: data.user.id, key: ATTEMPT_KEY, value: JSON.stringify(record) });

// ───────────────────────────── W01 ─────────────────────────────
test.describe('W01 · Iniciar sesión', () => {
  const openLogin = async (page: Page, initial: Parameters<typeof installMockApi>[1] = {}) => {
    const api = await installMockApi(page, { authenticated: false, ...initial });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
    return api;
  };

  test('W01-V1…V4 geometry and tokens at R', async ({ browser }) => {
    const { context, page } = await newPage(browser, VIEWPORTS[1]!);
    const seen = watch(page);
    await openLogin(page);
    await settle(page);
    const screen = await styles(page.locator('.auth-screen'), ['background-color'] as const);
    expect(screen['background-color']).toBe('rgb(246, 248, 251)');
    const tile = page.locator('.auth-brand-tile');
    const tileBox = await box(tile); const tileStyle = await styles(tile, ['border-radius', 'background-color'] as const);
    expect(near(tileBox.width, 48) && near(tileBox.height, 48)).toBe(true);
    expect(tileStyle).toEqual({ 'border-radius': '14px', 'background-color': 'rgb(29, 78, 216)' });
    await expect(tile.locator('svg[data-icon="walletOutlined"]')).toHaveCount(1);
    const brand = page.locator('.auth-brand-name');
    await expect(brand).toHaveText('Billetera MXN');
    expect(await fontOf(brand)).toMatchObject({ 'font-size': '20px', 'font-weight': '700' });
    await expect(page.getByText(/demostraci[oó]n/i)).toHaveCount(0); // E-G2
    const card = page.locator('.auth-card');
    const cardBox = await box(card);
    const cardStyle = await styles(card, ['border-top-left-radius', 'padding-top', 'padding-left', 'box-shadow', 'background-color'] as const);
    expect(near(cardBox.width, 440)).toBe(true);
    expect(cardStyle).toEqual({ 'border-top-left-radius': '16px', 'padding-top': '32px', 'padding-left': '32px', 'box-shadow': 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px', 'background-color': 'rgb(255, 255, 255)' });
    const h1 = page.getByRole('heading', { level: 1 });
    expect(await fontOf(h1)).toMatchObject({ 'font-size': '24px', 'font-weight': '700', 'line-height': '32px' });
    const subtitle = page.getByText('Ingresa tus credenciales para acceder a tus cuentas', { exact: true });
    expect(await fontOf(subtitle)).toMatchObject({ 'font-size': '14px', 'font-weight': '400', color: 'rgb(67, 70, 85)' });
    const fields = [] as Array<Record<string, unknown>>;
    for (const [label, icon] of [['Correo electrónico', 'mailOutlined'], ['Contraseña', 'lockOutlined']] as const) {
      const field = page.locator('.auth-field').filter({ has: page.getByText(label, { exact: true }) });
      const labelStyle = await fontOf(field.locator('label'));
      expect(labelStyle).toMatchObject({ 'font-size': '12px', 'font-weight': '600' });
      const input = field.locator('input');
      const inputBox = await box(input);
      const inputStyle = await styles(input, ['border-top-left-radius', 'border-top-width', 'border-top-color', 'background-color'] as const);
      expect(near(inputBox.height, 44)).toBe(true);
      expect(inputStyle).toEqual({ 'border-top-left-radius': '10px', 'border-top-width': '1px', 'border-top-color': 'rgb(226, 232, 240)', 'background-color': 'rgb(255, 255, 255)' });
      const iconBox = await box(field.locator(`svg[data-icon="${icon}"]`));
      expect(iconBox.width).toBe(20);
      expect(iconBox.x).toBeGreaterThan(inputBox.x);
      expect(iconBox.x + iconBox.width).toBeLessThan(inputBox.x + 44);
      fields.push({ label, labelStyle, inputBox, inputStyle, iconBox });
    }
    const eye = page.getByRole('button', { name: 'Mostrar contraseña' });
    const eyeBox = await box(eye); const passwordBox = await box(page.getByLabel('Contraseña', { exact: true }));
    expect(eyeBox.x).toBeGreaterThan(passwordBox.x + passwordBox.width - 48);
    const submit = page.getByRole('button', { name: 'Iniciar sesión' });
    const submitBox = await box(submit);
    const submitStyle = await styles(submit, ['background-color', 'color', 'border-top-left-radius', 'font-size', 'font-weight'] as const);
    expect(near(submitBox.height, 44)).toBe(true);
    expect(near(submitBox.width, cardBox.width - 64)).toBe(true);
    expect(submitStyle).toEqual({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', 'border-top-left-radius': '10px', 'font-size': '14px', 'font-weight': '500' });
    await expect(submit.locator('svg[data-icon="arrowForward"]')).toHaveCount(1);
    const footer = page.locator('.auth-footer');
    expect(await styles(footer, ['border-top-width', 'border-top-style'] as const)).toEqual({ 'border-top-width': '1px', 'border-top-style': 'solid' });
    await expect(footer).toHaveText('¿No tienes una cuenta? Regístrate aquí');
    const link = footer.getByRole('link', { name: 'Regístrate aquí' });
    expect(await fontOf(link)).toMatchObject({ 'font-size': '14px', 'font-weight': '600', color: 'rgb(29, 78, 216)' });
    await expect(page.getByText(/BIENVENIDO A BILLETERA|términos y aviso de privacidad/i)).toHaveCount(0);
    const sbs = await sideBySide(browser, page, 'W01-listo', REF.W01, { scenario: 'F-W01-1', screen: 'W01', state: 'listo' });
    // The reference PNG was rendered with a ~970 px tall viewport (card top at 332 CSS px); same layout at that height:
    const tall = await newPage(browser, { label: 'R970', width: 1280, height: 970, dpr: R.dpr });
    await openLogin(tall.page);
    const sbs970 = await sideBySide(browser, tall.page, 'W01-listo', REF.W01, { scenario: 'F-W01-1', screen: 'W01', state: 'listo (viewport 1280×970, altura de captura de la referencia)' }, { label: 'R970', width: 1280, height: 970, dpr: R.dpr });
    const cardTop970 = (await box(tall.page.locator('.auth-card'))).y;
    await tall.context.close();
    expect(seen.foreign).toEqual([]);
    expect(seen.errors).toEqual([]);
    recordMetric('W01-V1-V4 R', { screen, tile: { box: tileBox, ...tileStyle }, card: { box: cardBox, ...cardStyle }, h1: await fontOf(h1), fields, eye: eyeBox, submit: { box: submitBox, ...submitStyle }, informativePixelDiff: sbs.differentPixelRatio, at970: { cardTop: cardTop970, informativePixelDiff: sbs970.differentPixelRatio } });
    await context.close();
  });

  for (const viewport of VIEWPORTS) {
    test(`W01 listo ${viewport.label} ${viewport.width}x${viewport.height}: responsive, a11y and capture`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      await openLogin(page);
      const overflow = await responsive(page);
      await shoot(page, 'W01-listo', { scenario: 'F-W01-1', screen: 'W01', state: 'listo', reference: REF.W01 }, viewport);
      const a11y = await a11yBasics(page, INVENTORY.W01);
      expect(seen.errors).toEqual([]);
      expect(seen.foreign).toEqual([]);
      recordMetric(`W01 listo ${viewport.label}`, { overflow, ...a11y });
      await context.close();
    });
  }

  test('W01-F1 the eye toggles the secret field visibility with aria-pressed and label', async ({ page }) => {
    await openLogin(page);
    const input = page.getByLabel('Contraseña', { exact: true });
    await input.fill('Sintetica-Prueba-2026');
    const eye = page.getByRole('button', { name: 'Mostrar contraseña' });
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await expect(input).toHaveAttribute('type', 'password');
    await eye.click();
    const hide = page.getByRole('button', { name: 'Ocultar contraseña' });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(input).toHaveAttribute('type', 'text');
    await expect(hide.locator('svg[data-icon="visibilityOffOutlined"]')).toHaveCount(1);
    await hide.click();
    await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toHaveAttribute('aria-pressed', 'false');
    await expect(input).toHaveAttribute('type', 'password');
    recordMetric('W01-F1', { toggle: 'type oculto→visible→oculto', ariaPressed: ['false', 'true', 'false'], labels: ['Mostrar contraseña', 'Ocultar contraseña'] });
  });

  test('W01-F2 empty submit shows field errors without a request; sending state is disabled with a status', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[1]!, VIEWPORTS[3]!]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await openLogin(page);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      const email = page.getByLabel('Correo electrónico'); const password = page.getByLabel('Contraseña', { exact: true });
      for (const [input, id, text] of [[email, 'email', 'Ingresa tu correo electrónico.'], [password, 'password', 'Ingresa tu contraseña.']] as const) {
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(await input.getAttribute('aria-describedby')).toContain(`${id}-error`);
        await expect(page.locator(`#${id}-error`)).toHaveText(text);
        await expect(page.locator(`#${id}-error svg[data-icon="error"]`)).toHaveCount(1); // A11Y-08
      }
      await expect(email).toBeFocused();
      expect(api.nonGet().filter((item) => item.path === '/v1/auth/login')).toEqual([]);
      await shoot(page, 'W01-errores-campo', { scenario: 'F-W01-2', screen: 'W01', state: 'errores de campo', reference: REF.W01 }, viewport);
      await responsive(page);
      expect((await contrastFailures(page)).failures).toEqual([]);

      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/v1/auth/login', async (route) => { await gate; api.state.authenticated = true; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data.authResponse()) }); });
      await email.fill(data.user.email);
      await password.fill('Sintetica-Prueba-2026');
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      const busy = page.getByRole('button', { name: /Iniciando sesión…/ });
      await expect(busy).toBeDisabled();
      await expect(busy.locator('svg[data-icon="spinner"]')).toHaveCount(1);
      await expect(page.getByRole('status')).toHaveText('Iniciando sesión…');
      expect(await busy.getAttribute('aria-describedby')).toBe('login-status'); // A11Y-07
      await settle(page);
      expect(await styles(busy, ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(224, 232, 255)', color: 'rgb(116, 118, 134)' });
      expect(await busy.locator('svg').evaluate((node) => getComputedStyle(node).animationName)).toBe('none'); // A11Y-10
      await shoot(page, 'W01-enviando', { scenario: 'F-W01-3', screen: 'W01', state: 'enviando', reference: REF.W01 }, viewport);
      release();
      await expect(page).toHaveURL(/\/accounts$/);
      expect(seen.errors).toEqual([]);
      await context.close();
    }
    recordMetric('W01-F2', { emptySubmit: 'aria-invalid + describedby + icon, focus on first invalid, 0 POST /auth/login', busy: 'disabled, «Iniciando sesión…», spinner, role=status, aria-describedby' });
  });

  const failures = [
    { id: 'F-W01-4', state: '401 credenciales', name: 'W01-401', reply: { status: 401, body: data.problem(401, 'Credenciales inválidas.', 'Unauthorized') }, text: 'Correo o contraseña incorrectos.' },
    { id: 'F-W01-5', state: '429 demasiados intentos', name: 'W01-429', reply: { status: 429, body: data.problem(429, 'Intenta de nuevo más tarde.', 'Too Many Requests') }, text: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' },
    { id: 'F-W01-6', state: 'sin conexión', name: 'W01-sin-conexion', reply: 'offline' as const, text: 'No fue posible conectar. Revisa tu conexión e inténtalo de nuevo.' },
  ];
  test('W01-F3 401, 429 and offline show distinct alerts and keep the e-mail', async ({ browser }) => {
    const seenAll: Record<string, string[]> = {};
    for (const failure of failures) {
      for (const viewport of [VIEWPORTS[1]!, VIEWPORTS[3]!]) {
        const { context, page } = await newPage(browser, viewport);
        const seen = watch(page);
        const api = await openLogin(page);
        if (failure.reply === 'offline') await page.route('**/v1/auth/login', (route) => route.abort('internetdisconnected'));
        else api.state.overrides.set('POST /auth/login', failure.reply);
        await page.getByLabel('Correo electrónico').fill(data.user.email);
        await page.getByLabel('Contraseña', { exact: true }).fill('Sintetica-Prueba-2026');
        await page.getByRole('button', { name: 'Iniciar sesión' }).click();
        const alert = page.getByRole('alert');
        await expect(alert).toContainText(failure.text);
        await expect(alert.locator('svg[data-icon="error"]')).toHaveCount(1);
        if (failure.reply !== 'offline') await expect(alert).not.toContainText(failure.reply.body.detail!);
        await expect(page.getByLabel('Correo electrónico')).toHaveValue(data.user.email);
        await expect(page).toHaveURL(/\/login$/);
        await responsive(page);
        expect((await contrastFailures(page)).failures).toEqual([]);
        await shoot(page, failure.name, { scenario: failure.id, screen: 'W01', state: failure.state, reference: REF.W01 }, viewport);
        expect(seen.errors).toEqual([]);
        seenAll[`${failure.id} ${viewport.label}`] = seen.provoked;
        await context.close();
      }
    }
    expect(new Set(failures.map((item) => item.text)).size).toBe(3);
    recordMetric('W01-F3', { messages: failures.map((item) => ({ scenario: item.id, text: item.text })), provokedConsoleMessages: seenAll });
  });

  test('W01 A11Y-05 zoom 200 % and 320 px reflow', async ({ browser }) => {
    const results = await reflow(browser, async (page) => { await openLogin(page); });
    recordMetric('W01 A11Y-05', results);
  });
});

// ───────────────────────────── W02 ─────────────────────────────
test.describe('W02 · Crear cuenta', () => {
  const openRegister = async (page: Page, initial: Parameters<typeof installMockApi>[1] = {}) => {
    const api = await installMockApi(page, { authenticated: false, ...initial });
    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1, name: 'Crea tu cuenta' })).toBeVisible();
    return api;
  };
  const fill = async (page: Page, values: { fullName: string; email: string; password: string; confirm: string }) => {
    await page.getByLabel('Nombre completo').fill(values.fullName);
    await page.getByLabel('Correo electrónico').fill(values.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(values.password);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill(values.confirm);
  };

  test('W02-V1…V3 geometry and tokens at R', async ({ browser }) => {
    const { context, page } = await newPage(browser, VIEWPORTS[1]!);
    const seen = watch(page);
    await openRegister(page);
    await settle(page);
    expect((await styles(page.locator('.auth-screen'), ['background-color'] as const))['background-color']).toBe('rgb(246, 248, 251)');
    const tileBox = await box(page.locator('.auth-brand-tile'));
    expect(near(tileBox.width, 48) && near(tileBox.height, 48)).toBe(true);
    await expect(page.getByText(/demostraci[oó]n/i)).toHaveCount(0); // E-G2
    const card = page.locator('.auth-card');
    const cardBox = await box(card);
    const cardStyle = await styles(card, ['border-top-left-radius', 'padding-top', 'box-shadow'] as const);
    expect(near(cardBox.width, 440)).toBe(true);
    expect(cardStyle).toEqual({ 'border-top-left-radius': '16px', 'padding-top': '32px', 'box-shadow': 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px' });
    const h1 = page.getByRole('heading', { level: 1 });
    const h1Style = await styles(h1, ['font-size', 'line-height', 'font-weight', 'text-align'] as const);
    expect(h1Style).toEqual({ 'font-size': '20px', 'line-height': '28px', 'font-weight': '600', 'text-align': 'center' });
    await expect(page.getByText('Crea tu cuenta en Billetera MXN', { exact: true })).toHaveCSS('text-align', 'center');
    const labels = await page.locator('.auth-field label').allTextContents();
    expect(labels).toEqual(['Nombre completo', 'Correo electrónico', 'Contraseña', 'Confirmar contraseña']);
    // SPEC is silent on W02 label/input/footer type: the approved PNG renders them at 16/24/400 (body-lg).
    expect(await fontOf(page.locator('.auth-field label').first())).toMatchObject({ 'font-size': '16px', 'font-weight': '400', 'line-height': '24px', color: 'rgb(20, 27, 44)' });
    expect(await fontOf(page.locator('.auth-field input').first())).toMatchObject({ 'font-size': '16px' });
    expect(await fontOf(page.locator('.auth-footer p'))).toMatchObject({ 'font-size': '16px', color: 'rgb(67, 70, 85)' });
    expect(await fontOf(page.locator('.auth-footer a'))).toMatchObject({ 'font-size': '16px', color: 'rgb(29, 78, 216)' });
    for (const input of await page.locator('.auth-field input').all()) {
      expect(near((await box(input)).height, 44)).toBe(true);
      expect(await styles(input, ['border-top-left-radius', 'border-top-color'] as const)).toEqual({ 'border-top-left-radius': '10px', 'border-top-color': 'rgb(226, 232, 240)' });
    }
    await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mostrar confirmación' })).toBeVisible();
    const password = page.getByLabel('Contraseña', { exact: true });
    expect(await password.getAttribute('aria-describedby')).toBe('password-help');
    await expect(page.locator('#password-help')).toHaveText('Usa al menos 12 caracteres.');
    const submit = page.getByRole('button', { name: 'Crear cuenta' });
    const submitBox = await box(submit);
    expect(near(submitBox.height, 44) && near(submitBox.width, cardBox.width - 64)).toBe(true);
    expect(await styles(submit, ['background-color', 'border-top-left-radius'] as const)).toEqual({ 'background-color': 'rgb(29, 78, 216)', 'border-top-left-radius': '10px' });
    await expect(page.locator('.auth-footer')).toHaveText('¿Ya tienes una cuenta? Inicia sesión');
    await expect(page.getByText(/BIENVENIDO|Empieza por aquí|términos y aviso/i)).toHaveCount(0);
    const sbs = await sideBySide(browser, page, 'W02-listo', REF.W02, { scenario: 'F-W02-1', screen: 'W02', state: 'listo' });
    expect(seen.errors).toEqual([]); expect(seen.foreign).toEqual([]);
    recordMetric('W02-V1-V3 R', { card: { box: cardBox, ...cardStyle }, h1: h1Style, labels, submit: submitBox, informativePixelDiff: sbs.differentPixelRatio });
    await context.close();
  });

  for (const viewport of VIEWPORTS) {
    test(`W02 listo ${viewport.label} ${viewport.width}x${viewport.height}: responsive, a11y and capture`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      await openRegister(page);
      const overflow = await responsive(page);
      await shoot(page, 'W02-listo', { scenario: 'F-W02-1', screen: 'W02', state: 'listo', reference: REF.W02 }, viewport);
      const a11y = await a11yBasics(page, INVENTORY.W02);
      expect(seen.errors).toEqual([]);
      recordMetric(`W02 listo ${viewport.label}`, { overflow, ...a11y });
      await context.close();
    });
  }

  test('W02-F1 empty and mismatched confirmation stay client-side; the body has only the three contract fields', async ({ browser }) => {
    const { context, page } = await newPage(browser, VIEWPORTS[1]!);
    const api = await openRegister(page);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    for (const id of ['fullName', 'email', 'password', 'confirmPassword']) {
      await expect(page.locator(`#${id}`)).toHaveAttribute('aria-invalid', 'true');
      expect(await page.locator(`#${id}`).getAttribute('aria-describedby')).toContain(`${id}-error`);
    }
    expect(await page.locator('#password').getAttribute('aria-describedby')).toBe('password-error password-help');
    await shoot(page, 'W02-errores-campo', { scenario: 'F-W02-1', screen: 'W02', state: 'errores de campo', reference: REF.W02 }, VIEWPORTS[1]!);
    await fill(page, { fullName: 'Persona Prueba Uno', email: data.user.email, password: 'Sintetica-Prueba-2026', confirm: 'Sintetica-Prueba-2027' });
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.locator('#confirmPassword-error')).toHaveText('Las contraseñas no coinciden.');
    await expect(page.locator('#confirmPassword')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#password')).not.toHaveAttribute('aria-invalid', 'true');
    expect(api.nonGet().filter((item) => item.path === '/v1/auth/register')).toEqual([]);
    await shoot(page, 'W02-contrasenas-distintas', { scenario: 'F-W02-2', screen: 'W02', state: 'contraseñas distintas', reference: REF.W02 }, VIEWPORTS[1]!);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill('Sintetica-Prueba-2026');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    const sent = api.nonGet().filter((item) => item.path === '/v1/auth/register');
    expect(sent).toHaveLength(1);
    const body = JSON.parse(sent[0]!.body!) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['email', 'fullName', 'password']);
    expect(body.fullName).toBe('Persona Prueba Uno');
    recordMetric('W02-F1', { clientOnly: 'confirmación distinta → error, 0 POST', sentFields: 'fullName, email y la contraseña (3 campos del contrato; la confirmación nunca se envía)' });
    await context.close();
  });

  test('W02-F2 409 shows the server detail, keeps name/e-mail and clears both secret fields; W02 creating state', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[1]!, VIEWPORTS[3]!]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await openRegister(page);
      api.state.overrides.set('POST /auth/register', { status: 409, body: data.problem(409, 'No fue posible crear la cuenta con esos datos.', 'Conflict') });
      await fill(page, { fullName: 'Persona Prueba Uno', email: data.user.email, password: 'Sintetica-Prueba-2026', confirm: 'Sintetica-Prueba-2026' });
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(page.getByRole('alert')).toContainText('No fue posible crear la cuenta con esos datos.');
      await expect(page.getByRole('alert')).not.toContainText(/existe|registrad/i);
      await expect(page.getByLabel('Nombre completo')).toHaveValue('Persona Prueba Uno');
      await expect(page.getByLabel('Correo electrónico')).toHaveValue(data.user.email);
      await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
      await expect(page.getByLabel('Confirmar contraseña', { exact: true })).toHaveValue('');
      await responsive(page);
      expect((await contrastFailures(page)).failures).toEqual([]);
      await shoot(page, 'W02-409', { scenario: 'F-W02-3', screen: 'W02', state: '409 correo no disponible', reference: REF.W02 }, viewport);

      api.state.overrides.delete('POST /auth/register');
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/v1/auth/register', async (route) => { await gate; api.state.authenticated = true; await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(data.authResponse()) }); });
      await page.getByLabel('Contraseña', { exact: true }).fill('Sintetica-Prueba-2026');
      await page.getByLabel('Confirmar contraseña', { exact: true }).fill('Sintetica-Prueba-2026');
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      const busy = page.getByRole('button', { name: /Creando tu cuenta…/ });
      await expect(busy).toBeDisabled();
      await expect(page.getByRole('status')).toHaveText('Creando tu cuenta…');
      await shoot(page, 'W02-creando', { scenario: 'F-W02-4', screen: 'W02', state: 'creando', reference: REF.W02 }, viewport);
      release();
      await expect(page).toHaveURL(/\/accounts$/);
      expect(seen.errors).toEqual([]);
      await context.close();
    }
    recordMetric('W02-F2', { detail: 'No fue posible crear la cuenta con esos datos.', kept: ['Nombre completo', 'Correo electrónico'], cleared: ['Contraseña', 'Confirmar contraseña'] });
  });

  test('W02 A11Y-05 zoom 200 % and 320 px reflow', async ({ browser }) => {
    const results = await reflow(browser, async (page) => { await openRegister(page); });
    recordMetric('W02 A11Y-05', results);
  });
});

// ───────────────────────────── W14 ─────────────────────────────
test.describe('W14 · Sesión vencida y acceso no disponible', () => {
  const openExpired = async (page: Page, withAttempt: boolean) => {
    if (withAttempt) await seedAttempt(page, { key: 'synthetic-seeded-attempt', body: pendingBody });
    const api = await installMockApi(page, { authenticated: false });
    await page.goto('/session-expired');
    await expect(page.getByRole('heading', { level: 1, name: 'Tu sesión venció' })).toBeVisible();
    return api;
  };
  const openAccess = async (page: Page) => {
    const api = await installMockApi(page, { authenticated: false });
    await page.goto('/access-denied');
    await expect(page.getByRole('heading', { level: 1, name: 'Acceso no disponible' })).toBeVisible();
    return api;
  };

  test('W14-V1/V2/V4 geometry and tokens at R; side by side', async ({ browser }) => {
    const metrics: Record<string, unknown> = {};
    for (const variant of ['expired', 'access'] as const) {
      const { context, page } = await newPage(browser, VIEWPORTS[1]!);
      const seen = watch(page);
      if (variant === 'expired') await openExpired(page, false); else await openAccess(page);
      await settle(page);
      expect((await styles(page.locator('.status-screen'), ['background-color'] as const))['background-color']).toBe('rgb(249, 249, 255)');
      const tileBox = await box(page.locator('.status-brand-tile'));
      expect(near(tileBox.width, 32) && near(tileBox.height, 32)).toBe(true);
      const brandName = page.locator('.status-brand-name');
      expect(await fontOf(brandName)).toMatchObject({ 'font-size': '16px', 'font-weight': '500' });
      await expect(page.getByText(/demostraci[oó]n/i)).toHaveCount(0);
      const main = await box(page.locator('main#contenido'));
      const card = page.locator('.status-card');
      const cardBox = await box(card);
      const cardStyle = await styles(card, ['border-top-left-radius', 'padding-top', 'box-shadow', 'text-align'] as const);
      expect(near(main.width, 448)).toBe(true);
      expect(near(cardBox.width, 400)).toBe(true);
      expect(cardStyle).toEqual({ 'border-top-left-radius': '12px', 'padding-top': '24px', 'box-shadow': 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px', 'text-align': 'center' });
      expect(near(cardBox.x + cardBox.width / 2, 640)).toBe(true);
      const icon = page.locator('.status-icon');
      const iconBox = await box(icon);
      const expectedIcon = variant === 'expired' ? { size: 64, name: 'lockClockOutlined', color: 'rgb(0, 55, 176)' } : { size: 56, name: 'lockOutlined', color: 'rgb(67, 70, 85)' };
      expect(near(iconBox.width, expectedIcon.size)).toBe(true);
      expect(await styles(icon, ['background-color', 'color', 'border-top-left-radius'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)', color: expectedIcon.color, 'border-top-left-radius': '9999px' });
      await expect(icon.locator(`svg[data-icon="${expectedIcon.name}"]`)).toHaveCount(1);
      const title = page.getByRole('heading', { level: 1 });
      expect(await fontOf(title)).toMatchObject({ 'font-size': '20px', 'font-weight': '600', 'line-height': '28px' });
      const text = variant === 'expired' ? 'Inicia sesión para continuar operando de forma segura.' : 'No tienes permisos para consultar esta sección o el enlace no es válido.';
      await expect(page.locator('.status-text')).toHaveText(text);
      const button = page.getByRole('link', { name: variant === 'expired' ? 'Iniciar sesión' : 'Volver al inicio' });
      const buttonBox = await box(button);
      expect(near(buttonBox.height, 44) && near(buttonBox.width, cardBox.width - 48)).toBe(true);
      expect(await styles(button, ['background-color', 'color', 'border-top-left-radius', 'font-size', 'font-weight'] as const)).toEqual({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', 'border-top-left-radius': '12px', 'font-size': '14px', 'font-weight': '500' });
      await expect(button.locator(`svg[data-icon="${variant === 'expired' ? 'arrowForward' : 'arrowBack'}"]`)).toHaveCount(1);
      await expect(button).toHaveAttribute('href', '/login');
      const name = variant === 'expired' ? 'W14-vencida' : 'W14-acceso';
      const reference = variant === 'expired' ? REF.W14_EXPIRED : REF.W14_ACCESS;
      const sbs = await sideBySide(browser, page, name, reference, { scenario: variant === 'expired' ? 'F-W14-1' : 'F-W14-3', screen: 'W14', state: variant === 'expired' ? 'sesión vencida' : 'acceso no disponible' });
      expect(seen.errors).toEqual([]); expect(seen.foreign).toEqual([]);
      metrics[variant] = { main, card: { box: cardBox, ...cardStyle }, tile: tileBox, icon: iconBox, button: buttonBox, informativePixelDiff: sbs.differentPixelRatio };
      await context.close();
    }
    recordMetric('W14-V1-V2-V4 R', metrics);
  });

  test('W14-V3 pending attempt summary inside the same card; button keeps the resume state', async ({ browser }) => {
    for (const viewport of VIEWPORTS) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await openExpired(page, true);
      const before = await sessionAttempt(page);
      const pending = page.locator('.status-card .status-pending');
      await expect(pending).toContainText('Tienes una transferencia pendiente de verificación por $1,234.56 MXN (a un beneficiario).');
      await expect(pending).toContainText('Concepto');
      await expect(pending).toContainText(pendingBody.concept);
      await expect(pending).toContainText(pendingBody.reference);
      expect(await styles(pending, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)' });
      expect(await pending.locator('[data-amount]').evaluate((node) => getComputedStyle(node).fontVariantNumeric)).toContain('tabular-nums');
      await expect(page.locator('.status-card')).toHaveCount(1);
      await expect(page.locator('aside, nav')).toHaveCount(0);
      await expect(page.getByText(/sin volver a enviar|consultará el mismo intento|evitar duplicados/i)).toHaveCount(0); // W14-F2 / REC-05
      expect((await pending.innerText()).match(/MXN/g), 'D-3 one MXN per amount').toHaveLength(1);
      await responsive(page);
      await shoot(page, 'W14-vencida-con-intento', { scenario: 'F-W14-2', screen: 'W14', state: 'sesión vencida con intento pendiente (V3, sin referencia propia)', reference: REF.W14_EXPIRED }, viewport);
      if (viewport.label === 'R') await sideBySide(browser, page, 'W14-vencida-con-intento', REF.W14_EXPIRED, { scenario: 'F-W14-2', screen: 'W14', state: 'sesión vencida con intento (contexto permitido)' });
      const a11y = await a11yBasics(page, INVENTORY.W14_PENDING);
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh'), 'REC-03 no writes on mount').toEqual([]);
      const link = page.getByRole('link', { name: 'Iniciar sesión y retomar la verificación' });
      await link.click();
      await expect(page).toHaveURL(/\/login$/);
      expect(await page.evaluate(() => (history.state as { usr?: { resumeTransfer?: boolean; from?: string } } | null)?.usr)).toEqual({ from: '/transfers/new', resumeTransfer: true });
      expect(await sessionAttempt(page)).toBe(before);
      expect(seen.errors).toEqual([]);
      recordMetric(`W14-V3 ${viewport.label}`, { a11y, recordUnchanged: true, resumeState: { from: '/transfers/new', resumeTransfer: true } });
      await context.close();
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`W14 vencida/acceso/no encontrada ${viewport.label}: responsive, a11y and captures`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await openExpired(page, false);
      await responsive(page);
      await shoot(page, 'W14-vencida', { scenario: 'F-W14-1', screen: 'W14', state: 'sesión vencida', reference: REF.W14_EXPIRED }, viewport);
      const expired = await a11yBasics(page, INVENTORY.W14_EXPIRED);
      await page.goto('/access-denied');
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso no disponible' })).toBeVisible();
      await responsive(page);
      await shoot(page, 'W14-acceso', { scenario: 'F-W14-3', screen: 'W14', state: 'acceso no disponible', reference: REF.W14_ACCESS }, viewport);
      const access = await a11yBasics(page, INVENTORY.W14_ACCESS);
      await page.goto('/ruta-que-no-existe');
      await expect(page.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeVisible();
      await expect(page).toHaveTitle('Página no encontrada · Billetera MXN');
      await expect(page.getByRole('link', { name: 'Volver al inicio' })).toBeVisible();
      await responsive(page);
      await shoot(page, 'W14-no-encontrada', { scenario: 'F-W14-NF', screen: 'W14', state: 'página no encontrada (estilo V4)', reference: REF.W14_ACCESS }, viewport);
      const notFound = await a11yBasics(page, INVENTORY.W14_ACCESS);
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh'), 'REC-03').toEqual([]);
      expect(seen.errors).toEqual([]); expect(seen.foreign).toEqual([]);
      recordMetric(`W14 ${viewport.label}`, { expired, access, notFound });
      await context.close();
    });
  }

  test('W14-F1 403 and 404 by id show «Acceso no disponible» and leave the record byte-identical', async ({ browser }) => {
    const record = JSON.stringify({ key: 'synthetic-seeded-attempt', body: pendingBody, transferId: data.ids.transfer2 });
    const cases = [
      { id: 'F-W14-3', path: '/accounts', setup: (api: MockApi) => { api.state.accounts = { status: 403, body: data.problem(403, 'Acceso denegado.', 'Forbidden') }; } },
      { id: 'F-W14-4', path: `/transfers/${data.ids.transfer2}/status`, setup: () => undefined },
      { id: 'F-W14-5', path: `/accounts/${data.ids.beneficiaryAccount}/movements`, setup: (api: MockApi) => { api.state.overrides.set(`GET /accounts/${data.ids.beneficiaryAccount}/movements`, { status: 404, body: data.problem(404, 'Cuenta no encontrada.', 'Not Found') }); } },
      { id: 'F-W14-5b', path: `/transfers/${data.ids.transfer2}/movement-receipt`, setup: () => undefined },
    ];
    const results: Record<string, unknown> = {};
    for (const item of cases) {
      const { context, page } = await newPage(browser, VIEWPORTS[1]!);
      const seen = watch(page);
      await page.addInitScript(({ userId, key, value }) => { sessionStorage.setItem('wallet:web:active-user', userId); if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value); }, { userId: data.user.id, key: ATTEMPT_KEY, value: record });
      const api = await installMockApi(page);
      item.setup(api);
      await page.goto(item.path);
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso no disponible' })).toBeVisible();
      await expect(page.getByText(/no encontrad|no existe|Acceso denegado|Cuenta no encontrada/i)).toHaveCount(0);
      await expect(page).toHaveTitle('Acceso no disponible · Billetera MXN');
      await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/accounts');
      expect(await sessionAttempt(page)).toBe(record);
      expect(api.nonGet().filter((request) => request.path !== '/v1/auth/refresh')).toEqual([]);
      if (item.id === 'F-W14-3') await shoot(page, 'W14-acceso-403-cuentas', { scenario: item.id, screen: 'W14', state: '403 en /accounts', reference: REF.W14_ACCESS }, VIEWPORTS[1]!);
      if (item.id === 'F-W14-4') await shoot(page, 'W14-acceso-404-transferencia', { scenario: item.id, screen: 'W14', state: '404 en /transfers/{id}/status', reference: REF.W14_ACCESS }, VIEWPORTS[1]!);
      expect(seen.errors).toEqual([]);
      results[item.id] = { path: item.path.replace(/[0-9a-f-]{36}/g, ':id'), recordByteIdentical: true, writes: 0, provoked: seen.provoked };
      await context.close();
    }
    recordMetric('W14-F1 [F]', results);
  });

  test('W14-F2 a 401 that cannot be refreshed keeps the record and shows the session-expired card', async ({ browser }) => {
    const { context, page } = await newPage(browser, VIEWPORTS[1]!);
    const seen = watch(page);
    const api = await installMockApi(page);
    await page.goto('/accounts');
    await expect(page.locator('aside.shell-sidebar .shell-user-account')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const record = JSON.stringify({ key: 'synthetic-seeded-attempt', body: pendingBody });
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: ATTEMPT_KEY, value: record });
    // The access token is rejected and the refresh cookie is gone: the next query gets 401 and refresh 204.
    api.state.authenticated = false;
    await page.locator('aside.shell-sidebar').getByRole('link', { name: 'Beneficiarios' }).click();
    await expect(page).toHaveURL(/\/session-expired$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tu sesión venció' })).toBeVisible();
    await expect(page.locator('.status-pending')).toContainText('Tienes una transferencia pendiente de verificación');
    expect(await sessionAttempt(page)).toBe(record);
    const nonGet = api.nonGet().map((item) => `${item.method} ${item.path}`);
    expect(nonGet.length).toBeGreaterThanOrEqual(2); // hydration refresh + refresh after the 401
    expect(new Set(nonGet)).toEqual(new Set(['POST /v1/auth/refresh']));
    await shoot(page, 'W14-vencida-por-401', { scenario: 'F-W14-6', screen: 'W14', state: '401 sin refresh → vencida con intento', reference: REF.W14_EXPIRED }, VIEWPORTS[1]!);
    expect(seen.errors).toEqual([]);
    recordMetric('W14-F2', { route: '/beneficiaries → 401 → refresh 204 → /session-expired', recordByteIdentical: true, nonGet, provoked: seen.provoked });
    await context.close();
  });
});

// ───────────────────────────── [I] real API ─────────────────────────────
const P1_API = 'http://127.0.0.1:3301';
const P2 = { api: 'http://127.0.0.1:3302', web: 'http://127.0.0.1:5302' };
const profiles = (process.env.WF_PROFILES ?? 'P1').split(',');

async function apiRegister(apiBase: string, origin: string, fullName: string) {
  const unique = crypto.randomUUID();
  const credentials = { email: `wf-t1-${unique}@example.test`, password: `Sintetica-${unique}` };
  const api = await playwrightRequest.newContext({ baseURL: apiBase, extraHTTPHeaders: { Origin: origin } });
  const csrf = await (await api.get('v1/auth/csrf')).json() as { csrfToken: string };
  const response = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrf.csrfToken }, data: { fullName, ...credentials } });
  expect(response.status()).toBe(201);
  const { accessToken } = await response.json() as { accessToken: string };
  return { api, csrf: csrf.csrfToken, accessToken, ...credentials };
}

test.describe('[I] W01/W02/W14 against the real API', () => {
  test('W01-F4 real login (P1) → /accounts; W14 unauthorised access to another user’s resources → V4 (I-W14-6)', async ({ page }) => {
    const seen = watch(page);
    const owner = await apiRegister(P1_API, WEB_ORIGIN, 'Persona Prueba Dueña');
    const auth = { Authorization: `Bearer ${owner.accessToken}`, 'X-CSRF-Token': owner.csrf };
    const accounts = (await (await owner.api.get('v1/accounts', { headers: auth })).json() as { items: Array<{ id: string }> }).items;
    expect(accounts.length).toBe(2);
    const transfer = await owner.api.post('v1/transfers', { headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() }, data: { sourceAccountId: accounts[0]!.id, destinationType: 'own_account', destinationAccountId: accounts[1]!.id, amountMinor: '100', concept: 'Prueba ajena', reference: '1' } });
    expect(transfer.status()).toBe(201);
    const transferId = (await transfer.json() as { id: string }).id;
    await owner.api.dispose();
    const visitor = await apiRegister(P1_API, WEB_ORIGIN, 'Persona Prueba Visitante');
    await visitor.api.dispose();

    await page.goto('/login');
    await page.getByLabel('Correo electrónico').fill(visitor.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(visitor.password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.locator('aside.shell-sidebar .shell-user-name')).toHaveText('Persona Prueba Visitante');
    const record = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wallet:web:transfer-attempt:'))));
    const visits: Record<string, string> = {};
    for (const path of [`/transfers/${transferId}/status`, `/accounts/${accounts[0]!.id}/movements`, `/transfers/${transferId}/movement-receipt`]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso no disponible' })).toBeVisible();
      await expect(page.getByText(/Prueba ajena|Persona Prueba Dueña/)).toHaveCount(0);
      expect(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wallet:web:transfer-attempt:'))))).toBe(record);
      visits[path.replace(/[0-9a-f-]{36}/g, ':id')] = 'Acceso no disponible';
    }
    expect(seen.errors).toEqual([]);
    recordMetric('W01-F4 + I-W14-6 [I]', { login: 'P1 real → /accounts', visits, provoked: seen.provoked });
  });

  test('W02-F3 real registration: P1 → two accounts', async ({ page }) => {
    const unique = crypto.randomUUID();
    await page.goto('/register');
    await page.getByLabel('Nombre completo').fill('Persona Prueba Registro');
    await page.getByLabel('Correo electrónico').fill(`wf-t1-reg-${unique}@example.test`);
    await page.getByLabel('Contraseña', { exact: true }).fill(`Sintetica-${unique}`);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill(`Sintetica-${unique}`);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole('region', { name: 'Tus cuentas' }).locator('article')).toHaveCount(2);
    recordMetric('W02-F3 P1 [I]', { accounts: 2 });
  });

  test('W02-F3 real registration: P2 (fixture off) → one account at $0.00 MXN', async ({ browser }) => {
    test.skip(!profiles.includes('P2'), 'requires WF_PROFILES to include P2');
    const context = await browser.newContext({ baseURL: P2.web, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
    const page = await context.newPage();
    const unique = crypto.randomUUID();
    await page.goto('/register');
    await page.getByLabel('Nombre completo').fill('Persona Prueba Sin Saldo');
    await page.getByLabel('Correo electrónico').fill(`wf-t1-p2-${unique}@example.test`);
    await page.getByLabel('Contraseña', { exact: true }).fill(`Sintetica-${unique}`);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill(`Sintetica-${unique}`);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    const cards = page.getByRole('region', { name: 'Tus cuentas' }).locator('article');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('$0.00 MXN');
    recordMetric('W02-F3 P2 [I]', { accounts: 1, balance: '$0.00 MXN' });
    await context.close();
  });
});
