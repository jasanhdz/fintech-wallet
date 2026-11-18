// WF-T0 acceptance: FONT-03…07, SH-01…09, RESP-01 on /accounts ([F], simulated API).
import { expect, test, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi } from './helpers/mock-api.js';
import { capturePath, recordCapture, recordMetric } from './helpers/evidence.js';
import { INTER_WEIGHTS, fontFamilies, interFaces, interMetrics } from './helpers/fonts.js';
import { box, horizontalOverflow, near, styles } from './helpers/geometry.js';
import { composeSideBySide, referenceViewport } from './helpers/side-by-side.js';

const WEB_ORIGIN = 'http://127.0.0.1:5301';
const API_ORIGIN = 'http://127.0.0.1:3301';
const W03_REFERENCE = 'w03_inicio_y_cuentas_corregido';

/** FONT-04: every request must stay on the Web or API origin (or be an inline data/blob URL). */
function trackForeignHosts(page: Page) {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return;
    const origin = new URL(url).origin;
    if (origin !== WEB_ORIGIN && origin !== API_ORIGIN) foreign.push(url);
  });
  return foreign;
}

function trackPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function openAccounts(page: Page, demoOnly = true) {
  const api = await installMockApi(page, { policy: data.policy({ demoOnly }) });
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.shell-user-account').filter({ visible: true }).or(page.locator('.shell-bottom-nav')).first()).toBeVisible();
  return api;
}

test.describe('FONT · Inter self-hosted', () => {
  for (const route of ['/login', '/accounts'] as const) {
    test(`FONT-03/04/05 ${route}`, async ({ page }) => {
      const foreign = trackForeignHosts(page);
      const fontResponses: Array<{ url: string; status: number }> = [];
      page.on('response', (response) => { if (response.url().includes('/fonts/')) fontResponses.push({ url: response.url(), status: response.status() }); });
      await installMockApi(page, { authenticated: route === '/accounts' });
      await page.goto(route);
      await expect(page.locator('main#contenido')).toBeVisible();
      if (route === '/accounts') await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      else await expect(page.getByRole('button', { name: /Iniciar sesión/ })).toBeVisible();
      const faces = await interFaces(page);
      for (const weight of INTER_WEIGHTS) expect(faces.filter((face) => face.weight === weight && face.status === 'loaded'), `Inter ${weight} loaded`).toHaveLength(1);
      await expect.poll(() => fontResponses.length).toBeGreaterThanOrEqual(4);
      for (const response of fontResponses) {
        expect(new URL(response.url).origin).toBe(WEB_ORIGIN);
        expect(response.status).toBe(200);
      }
      const selectors = route === '/login' ? ['body', 'button', 'input'] : ['body', 'h1', 'button'];
      const families = await fontFamilies(page, selectors);
      for (const selector of selectors) expect(families[selector], `${selector} font-family`).toMatch(/^"?Inter"?(,|$)/);
      expect(foreign).toEqual([]);
      recordMetric(`FONT-03-04-05 ${route}`, { faces, fontResponses: fontResponses.map((item) => ({ path: new URL(item.url).pathname, status: item.status })), families, foreignRequests: foreign });
    });
  }

  test('FONT-06 Inter renders with real metrics', async ({ page }) => {
    await installMockApi(page);
    await page.goto('/accounts');
    const metrics = await interMetrics(page, 'Billetera MXN');
    expect(metrics.check).toBe(true);
    expect(Math.abs(metrics.inter - metrics.arial)).toBeGreaterThanOrEqual(1);
    recordMetric('FONT-06', metrics);
  });

  test('FONT-07 amounts and masked CLABEs use tabular numerals', async ({ page }) => {
    await openAccounts(page);
    await expect(page.locator('[data-amount]').first()).toBeVisible();
    const result = await page.evaluate(() => {
      const nodes = new Set<Element>(Array.from(document.querySelectorAll('[data-amount], [data-clabe]')));
      for (const element of Array.from(document.body.querySelectorAll('*'))) {
        const ownText = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('');
        if (/•{2,}\s?[0-9]{4}/.test(ownText)) nodes.add(element);
      }
      return Array.from(nodes).map((element) => ({ text: (element.textContent ?? '').replace(/[0-9]/g, '#').slice(0, 40), numeric: getComputedStyle(element).fontVariantNumeric }));
    });
    expect(result.length).toBeGreaterThan(0);
    for (const item of result) expect(item.numeric, item.text).toContain('tabular-nums');
    recordMetric('FONT-07', { checked: result.length, items: result });
  });
});

test.describe('SH · authenticated shell ≥1024', () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  test('SH-01/02/03/05/09 geometry, tokens and demo labelling (demoOnly true)', async ({ page }) => {
    const errors = trackPageErrors(page);
    const foreign = trackForeignHosts(page);
    await openAccounts(page, true);
    const aside = page.locator('aside.shell-sidebar');
    const asideBox = await box(aside);
    const asideStyle = await styles(aside, ['position', 'background-color', 'box-shadow'] as const);
    expect(near(asideBox.width, 256)).toBe(true);
    expect(near(asideBox.height, 960)).toBe(true);
    expect(asideBox.x).toBe(0);
    expect(asideStyle.position).toBe('fixed');
    expect(asideStyle['background-color']).toBe('rgb(255, 255, 255)');
    expect(asideStyle['box-shadow']).toBe('none');

    const brand = aside.locator('.shell-brand');
    // UX-T1 (D-UX-1): brand block ≥ 64 px; with demoOnly the chip sits under the name, so the block grows with it.
    const brandBox = await box(brand);
    expect(brandBox.height).toBeGreaterThanOrEqual(64);
    expect(brandBox.height).toBeLessThanOrEqual(88);
    await expect(brand.locator('.brand-tile svg')).toHaveCount(1);
    const brandName = brand.locator('.shell-brand-name');
    await expect(brandName).toHaveText('Billetera MXN');
    const brandStyle = await styles(brandName, ['font-size', 'font-weight'] as const);
    expect(brandStyle).toEqual({ 'font-size': '16px', 'font-weight': '600' });
    await expect(brand.getByText('Demostración', { exact: true })).toBeVisible();

    const nav = aside.getByRole('navigation', { name: 'Navegación principal' });
    const links = nav.getByRole('link');
    await expect(links).toHaveText(['Inicio', 'Movimientos', 'Beneficiarios', 'Transferir']);
    const linkMetrics = await links.evaluateAll((items) => items.map((item) => {
      const svg = item.querySelector('svg');
      const label = item.querySelector('span');
      const style = getComputedStyle(item);
      return { name: item.textContent, current: item.getAttribute('aria-current'), svgSize: svg ? svg.getBoundingClientRect().width : 0, svgHidden: svg?.getAttribute('aria-hidden'), fontSize: label ? getComputedStyle(label).fontSize : null, background: style.backgroundColor, color: style.color, radius: style.borderTopLeftRadius };
    }));
    for (const item of linkMetrics) {
      expect(item.svgSize).toBe(20);
      expect(item.svgHidden).toBe('true');
      expect(item.fontSize).toBe('14px');
      expect(item.radius).toBe('12px');
      if (item.name === 'Inicio') expect(item).toMatchObject({ current: 'page', background: 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)' });
      else expect(item).toMatchObject({ current: null, color: 'rgb(67, 70, 85)' });
    }

    const topbar = page.locator('header.shell-topbar');
    await expect(topbar).toBeHidden();
    await expect(page.getByRole('button', { name: /notificaci|campana|ayuda/i })).toHaveCount(0);

    const shellImages = await page.evaluate(() => ({
      images: Array.from(document.querySelectorAll('aside.shell-sidebar img')).map((image) => ({ complete: (image as HTMLImageElement).complete, width: (image as HTMLImageElement).naturalWidth })),
      text: `${(document.querySelector('aside.shell-sidebar') as HTMLElement).innerText}\n${(document.querySelector('header.shell-topbar') as HTMLElement).innerText}`,
    }));
    expect(shellImages.images.every((image) => image.complete && image.width > 0)).toBe(true);
    expect(shellImages.text).not.toMatch(/\bimg\b/i);
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
    recordMetric('SH-01-02-03-05-09 demoOnly=true', { aside: { box: asideBox, ...asideStyle }, brandStyle, links: linkMetrics, shellImages: shellImages.images.length });
    const file = capturePath('SH-shell-1440x960-demo.png');
    await page.screenshot({ path: file });
    recordCapture({ scenario: 'F-SH-1', screen: 'Shell', state: 'demoOnly true', level: 'F', viewport: '1440x960', dpr: 1, file, reference: W03_REFERENCE });
  });

  test('SH-02/05 no demo labelling when demoOnly is false', async ({ page }) => {
    await openAccounts(page, false);
    await expect(page.locator('aside.shell-sidebar .shell-user-account')).toBeVisible();
    await expect(page.getByText(/demostraci[oó]n/i)).toHaveCount(0);
    recordMetric('SH-02-05 demoOnly=false', { demoWordCount: 0 });
  });

  test('SH-04 user card and logout', async ({ page }) => {
    const api = await openAccounts(page);
    const card = page.locator('aside.shell-sidebar .shell-user-card');
    await expect(card.locator('.shell-avatar')).toHaveText('PP');
    await expect(card.locator('.shell-user-name')).toHaveText(data.user.fullName);
    const tail = data.accounts()[0]!.clabeMasked.slice(-4);
    await expect(card.locator('.shell-user-account')).toHaveText(`Cuenta •• ${tail}`);
    await page.locator('aside.shell-sidebar').getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(api.nonGet().map((item) => `${item.method} ${item.path}`)).toContain('POST /v1/auth/logout');
    recordMetric('SH-04', { initials: 'PP', account: 'Cuenta •• ####', logout: 'POST /v1/auth/logout → /login' });
  });

  test('SH-07 skip link is the first focusable element and focuses main', async ({ page }) => {
    await openAccounts(page);
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveText('Saltar al contenido');
    await expect(focused).toBeInViewport({ ratio: 1 });
    const skipBox = await box(focused);
    expect(skipBox.y).toBeGreaterThanOrEqual(0);
    expect(skipBox.y + skipBox.height).toBeLessThanOrEqual(960);
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('contenido');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
    recordMetric('SH-07', { firstFocusable: 'Saltar al contenido', box: skipBox, focusAfterEnter: 'main#contenido' });
  });

  test('SH-08 document title per route', async ({ page }) => {
    const api = await installMockApi(page, { authenticated: false });
    const titles: Record<string, string> = {};
    const visit = async (path: string, expected: string) => {
      await page.goto(path);
      await expect(page).toHaveTitle(`${expected} · Billetera MXN`);
      titles[path.replace(/[0-9a-f-]{36}/g, ':id')] = await page.title();
    };
    await visit('/login', 'Iniciar sesión');
    await visit('/register', 'Crear cuenta');
    await visit('/session-expired', 'Sesión vencida');
    await visit('/access-denied', 'Acceso no disponible');
    await visit('/ruta-inexistente', 'Página no encontrada');
    api.state.authenticated = true;
    await visit('/accounts', 'Inicio');
    await visit(`/accounts/${data.ids.checking}/movements`, 'Movimientos');
    await visit(`/transfers/${data.ids.transfer1}/movement-receipt`, 'Comprobante');
    await visit('/beneficiaries', 'Beneficiarios');
    await visit('/beneficiaries/new', 'Nuevo beneficiario');
    await visit('/transfers/new', 'Transferir');
    recordMetric('SH-08', titles);
  });
});

test.describe('SH-06 · shell below 1024', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    test(`SH-06 ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openAccounts(page);
      await expect(page.locator('aside.shell-sidebar')).toBeHidden();
      const bar = page.locator('nav.shell-bottom-nav');
      await expect(bar).toBeVisible();
      expect((await styles(bar, ['position'] as const)).position).toBe('fixed');
      const items = bar.locator('a, button');
      await expect(items).toHaveText(['Inicio', 'Movimientos', 'Beneficiarios', 'Transferir']);
      const sizes = await items.evaluateAll((nodes) => nodes.map((node) => { const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }));
      for (const size of sizes) { expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44); }
      const barHeight = (await box(bar)).height;
      const paddingBottom = parseFloat((await styles(page.locator('main#contenido'), ['padding-bottom'] as const))['padding-bottom']);
      expect(paddingBottom).toBeGreaterThanOrEqual(barHeight + 16);
      recordMetric(`SH-06 ${viewport.width}`, { barHeight, paddingBottom, sizes });
    });
  }
});

test.describe('RESP-01 · /accounts without horizontal scroll', () => {
  const reference = referenceViewport(W03_REFERENCE);
  const viewports = [
    { label: '1440', width: 1440, height: 960, dpr: 1 },
    { label: 'R', width: reference.width, height: reference.height, dpr: reference.dpr },
    { label: '768', width: 768, height: 1024, dpr: 1 },
    { label: '390', width: 390, height: 844, dpr: 1 },
  ];
  for (const viewport of viewports) {
    test(`RESP-01 /accounts ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const context = await browser.newContext({ baseURL: WEB_ORIGIN, viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
      const page = await context.newPage();
      await openAccounts(page);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await horizontalOverflow(page);
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      const file = capturePath(`W03-accounts-${viewport.width}x${viewport.height}@${viewport.dpr}.png`);
      await page.screenshot({ path: file, fullPage: true });
      recordCapture({ scenario: 'F-W03-1', screen: 'W03', state: 'con saldo (shell WF-T0)', level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file, reference: W03_REFERENCE });
      let sideBySide: { file: string; differentPixelRatio: number | null } | undefined;
      if (viewport.label === 'R') {
        const viewportFile = capturePath(`W03-accounts-R-viewport.png`);
        await page.screenshot({ path: viewportFile });
        sideBySide = await composeSideBySide(browser, W03_REFERENCE, viewportFile, capturePath('W03-con-saldo-sbs.png'));
        recordCapture({ scenario: 'F-W03-1', screen: 'W03', state: 'lado a lado (informativo; W03 se rediseña en WF-T2)', level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file: sideBySide.file, reference: W03_REFERENCE });
      }
      recordMetric(`RESP-01 /accounts ${viewport.label}`, { ...overflow, referencePng: viewport.label === 'R' ? `${reference.pngWidth}x${reference.pngHeight}` : undefined, informativePixelDiff: sideBySide?.differentPixelRatio });
      await context.close();
    });
  }
});
