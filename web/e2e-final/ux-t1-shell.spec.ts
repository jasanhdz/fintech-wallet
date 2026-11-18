// UX-T1 acceptance [F] (docs/web-ux-polish/SPEC.md §7.2): shell and navigation (SH-01…SH-11), client account order
// (ORD-02), skip link / landmarks / focus not obscured / icon names (A11Y-06/07/08/14), centred containers (SP-07) and
// the shell's own spacing scale (SP-03, chrome part). Simulated API; synthetic data only.
import { expect, test, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockState } from './helpers/mock-api.js';
import { recordMetric } from './helpers/evidence.js';
import { newPage, settle } from './helpers/screen.js';
import { NOW, UX_VIEWPORTS } from './helpers/ux-scenarios.js';
import { duplicateChrome, focusObscured, offScaleSpacing, overlayBleed } from './helpers/ux-metrics.js';

const VIEWPORTS = UX_VIEWPORTS.filter((viewport) => viewport.label !== 'zoom200');
const [checking, savings] = data.accounts() as [data.Account, data.Account];
const reversed = () => [savings, checking];

async function open(page: Page, path: string, initial: Partial<MockState> = {}) {
  await page.clock.setFixedTime(NOW);
  const api = await installMockApi(page, { movements: [data.movement()], ...initial });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await settle(page);
  return api;
}

const SCREENS = [
  { path: '/accounts', name: 'W03' },
  { path: `/accounts/${data.ids.checking}/movements`, name: 'W04' },
  { path: '/beneficiaries', name: 'W06' },
  { path: `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, name: 'W08' },
];

test.describe('UX-T1 · Shell', () => {
  for (const viewport of VIEWPORTS) {
    test(`SH-01…SH-04, SH-07/08, SP-03 (chrome) ${viewport.width}x${viewport.height}`, async ({ browser }) => {
      const metrics: Record<string, unknown> = {};
      for (const screen of SCREENS) {
        const { context, page } = await newPage(browser, viewport);
        await open(page, screen.path);
        const wide = viewport.width >= 1024;
        // SH-01
        const chrome = await duplicateChrome(page);
        // SPEC §5.4 hides the mobile demo chip below 360 px; it remains the single
        // visible chrome chip at every other authenticated demo viewport.
        expect(chrome, `SH-01 ${screen.name}`).toEqual({ brand: 1, demo: viewport.width < 360 ? 0 : 1, logout: 1, user: wide ? 1 : 0 });
        // SH-02 / SH-03 / SH-04
        const aside = page.locator('aside.shell-sidebar');
        const topbar = page.locator('header.shell-topbar');
        const bottom = page.locator('nav.shell-bottom-nav');
        if (wide) {
          await expect(topbar).toBeHidden();
          await expect(bottom).toBeHidden();
          const box = (await aside.boundingBox())!;
          expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, 256, viewport.height]);
          expect(await aside.evaluate((element) => [getComputedStyle(element).position, getComputedStyle(element).backgroundColor])).toEqual(['fixed', 'rgb(255, 255, 255)']);
          const links = aside.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link');
          await expect(links).toHaveText(['Inicio', 'Movimientos', 'Beneficiarios', 'Transferir']);
          for (const link of await links.all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await expect(aside.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
          expect((await aside.getByRole('button', { name: 'Cerrar sesión' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        } else {
          await expect(aside).toBeHidden();
          expect(await topbar.evaluate((element) => [getComputedStyle(element).position, element.getBoundingClientRect().height, getComputedStyle(element).backgroundColor])).toEqual(['static', 56, 'rgb(255, 255, 255)']);
          const logout = topbar.getByRole('button', { name: 'Cerrar sesión' });
          await expect(logout).toContainText('Salir');
          const logoutBox = (await logout.boundingBox())!;
          expect(logoutBox.width).toBeGreaterThanOrEqual(44); expect(logoutBox.height).toBeGreaterThanOrEqual(44);
          expect(await bottom.evaluate((element) => [getComputedStyle(element).position, getComputedStyle(element).backgroundColor])).toEqual(['fixed', 'rgb(255, 255, 255)']);
          const items = bottom.getByRole('link');
          await expect(items).toHaveText(['Inicio', 'Movimientos', 'Beneficiarios', 'Transferir']);
          for (const item of await items.all()) {
            const box = (await item.boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBe(56);
            expect(await item.locator('span').evaluate((element) => element.scrollWidth <= element.clientWidth), 'SH-04 label not clipped').toBe(true);
          }
          await expect(page.getByRole('button', { name: 'Salir' })).toHaveCount(0);
        }
        // SH-07 / SH-08
        const bleed = await overlayBleed(page);
        expect(bleed.translucent, `SH-07 ${screen.name}`).toEqual([]);
        expect(bleed.leaks, `SH-08 ${screen.name}`).toEqual([]);
        expect(bleed.h1Hits, `SH-08 h1 ${screen.name}`).toEqual([]);
        // SP-03 for the chrome itself (the screens' own spacing is measured in ux-capture metrics).
        const chromeSpacing = (await offScaleSpacing(page)).filter((item) => /shell-(sidebar|topbar|bottom|nav|brand|user|logout|avatar)|brand-tile/.test(item.element));
        expect(chromeSpacing, `SP-03 chrome ${screen.name}`).toEqual([]);
        metrics[screen.name] = { chrome, bleed };
        await context.close();
      }
      recordMetric(`UX-T1 shell ${viewport.width}x${viewport.height}`, metrics);
    });
  }

  test('SH-01 without demoOnly: no «Demostración» in the chrome', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[1]!, VIEWPORTS[5]!]) {
      const { context, page } = await newPage(browser, viewport);
      await open(page, '/accounts', { policy: data.policy({ demoOnly: false }) });
      expect((await duplicateChrome(page)).demo).toBe(0);
      await context.close();
    }
  });

  test('SH-05 viewport-fit=cover and the safe-area inset is padding outside the 56 px row', async ({ browser }) => {
    const { context, page } = await newPage(browser, VIEWPORTS[1]!);
    await open(page, '/accounts');
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');
    await page.addStyleTag({ content: '.shell-bottom-nav{padding-bottom:34px}' });
    const nav = page.locator('nav.shell-bottom-nav');
    await expect.poll(async () => (await nav.boundingBox())!.height).toBe(90); // style recalculation settles asynchronously
    for (const item of await nav.getByRole('link').all()) expect((await item.boundingBox())!.height).toBe(56);
    await context.close();
  });

  test('SH-06 the last focusable of main stays above the bottom navigation', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[0]!, VIEWPORTS[1]!, VIEWPORTS[2]!]) {
      for (const screen of SCREENS) {
        const { context, page } = await newPage(browser, viewport);
        await open(page, screen.path);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const result = await page.evaluate(() => {
          const focusables = Array.from(document.querySelectorAll<HTMLElement>('main a[href], main button, main input, main select')).filter((element) => element.getBoundingClientRect().height > 0);
          const last = focusables.at(-1)!.getBoundingClientRect();
          const nav = document.querySelector('nav.shell-bottom-nav')!.getBoundingClientRect();
          return { lastBottom: Math.round(last.bottom), navTop: Math.round(nav.top) };
        });
        expect(result.lastBottom, `SH-06 ${screen.name} ${viewport.width}`).toBeLessThanOrEqual(result.navTop);
        await context.close();
      }
    }
  });

  for (const viewport of [VIEWPORTS[5]!, VIEWPORTS[1]!]) {
    test(`SH-09 one logout control → one POST /v1/auth/logout → /login; back shows no account data ${viewport.width}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const api = await open(page, '/accounts');
      await expect(page.getByText('$7,345.00').first()).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar sesión' }).filter({ visible: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(api.requests.filter((item) => item.method === 'POST' && item.path === '/v1/auth/logout')).toHaveLength(1);
      await page.goBack();
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText('$7,345.00')).toHaveCount(0);
      await context.close();
    });
  }

  test('SH-10 / ORD-02 with /accounts answering [savings, checking]: principal first everywhere', async ({ browser }) => {
    const { context, page } = await newPage(browser, VIEWPORTS[5]!);
    const api = await open(page, '/accounts', { accounts: reversed() });
    const sidebar = page.locator('aside.shell-sidebar');
    await expect(sidebar.getByRole('link', { name: 'Movimientos' })).toHaveAttribute('href', `/accounts/${checking.id}/movements`);
    await expect(sidebar.locator('.shell-user-account')).toHaveText(`Cuenta •• ${checking.clabeMasked.slice(-4)}`);
    const cards = page.locator('.home-account');
    await expect(cards.first()).toHaveAttribute('aria-label', checking.name);
    await expect(cards.first()).toHaveClass(/is-first/);
    await expect(cards.first().getByRole('link', { name: 'Transferir' })).toHaveAttribute('href', `/transfers/new?source=${checking.id}`);
    await expect.poll(() => api.requests.filter((item) => item.method === 'GET' && item.path.endsWith('/movements')).map((item) => item.path)).toContain(`/v1/accounts/${checking.id}/movements`);
    expect(api.requests.filter((item) => item.path === `/v1/accounts/${savings.id}/movements`)).toHaveLength(0);
    await page.goto(`/accounts/${savings.id}/movements`);
    await expect(page.locator('#hist-account option').first()).toHaveAttribute('value', checking.id);
    await page.goto('/transfers/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Transferir dinero' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Cuenta de origen' })).toContainText(checking.name);
    await context.close();
  });

  test('SH-11 in-app navigation moves focus to the new h1 and updates the title', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[5]!, VIEWPORTS[1]!]) {
      const { context, page } = await newPage(browser, viewport);
      await open(page, '/accounts');
      const nav = page.getByRole('navigation', { name: 'Navegación principal' }).filter({ visible: true });
      for (const [label, h1, title] of [['Beneficiarios', 'Mis beneficiarios', 'Beneficiarios'], ['Movimientos', 'Historial de movimientos', 'Movimientos'], ['Transferir', 'Transferir dinero', 'Transferir'], ['Inicio', `Hola, ${data.user.fullName}`, 'Inicio']] as const) {
        await nav.getByRole('link', { name: label }).click();
        const heading = page.getByRole('heading', { level: 1, name: h1 });
        await expect(heading).toBeFocused();
        await expect(page).toHaveTitle(`${title} · Billetera MXN`);
      }
      // A CTA inside main that changes the route.
      await page.locator('.home-account').first().getByRole('link', { name: 'Transferir' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Transferir dinero' })).toBeFocused();
      await context.close();
    }
  });
});

test.describe('UX-T1 · Accesibilidad del shell', () => {
  test('A11Y-06 skip link first, visible on focus, moves focus to main#contenido', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[5]!, VIEWPORTS[1]!]) {
      const { context, page } = await newPage(browser, viewport);
      await open(page, '/accounts');
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Saltar al contenido' });
      await expect(skip).toBeFocused();
      const box = (await skip.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      await page.keyboard.press('Enter');
      await expect(page.locator('main#contenido')).toBeFocused();
      await context.close();
    }
  });

  test('A11Y-07 one main, visible navs uniquely named, the hidden one display:none', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[5]!, VIEWPORTS[1]!]) {
      const { context, page } = await newPage(browser, viewport);
      await open(page, '/accounts');
      const result = await page.evaluate(() => {
        const navs = Array.from(document.querySelectorAll('nav'));
        const visible = navs.filter((nav) => nav.getBoundingClientRect().height > 0);
        const hidden = navs.filter((nav) => nav.getBoundingClientRect().height === 0);
        return { mains: document.querySelectorAll('main').length, labels: visible.map((nav) => nav.getAttribute('aria-label')), hiddenDisplay: hidden.map((nav) => getComputedStyle(nav.closest('aside') ?? nav).display) };
      });
      expect(result.mains).toBe(1);
      expect(result.labels.every(Boolean)).toBe(true);
      expect(new Set(result.labels).size).toBe(result.labels.length);
      expect(result.hiddenDisplay.every((value) => value === 'none')).toBe(true);
      await context.close();
    }
  });

  test('A11Y-08 focus is never obscured by the chrome (390 and 1440)', async ({ browser }) => {
    const results: Record<string, unknown> = {};
    for (const viewport of [VIEWPORTS[1]!, VIEWPORTS[5]!]) {
      for (const screen of SCREENS) {
        const { context, page } = await newPage(browser, viewport);
        await open(page, screen.path);
        const obscured = await focusObscured(page);
        results[`${screen.name} ${viewport.width}`] = obscured;
        expect(obscured, `A11Y-08 ${screen.name} ${viewport.width}`).toEqual([]);
        await context.close();
      }
    }
    recordMetric('UX-T1 A11Y-08', results);
  });

  test('A11Y-14 icon-only buttons are named and decorative SVGs are hidden', async ({ browser }) => {
    for (const viewport of [VIEWPORTS[5]!, VIEWPORTS[1]!]) {
      for (const screen of SCREENS) {
        const { context, page } = await newPage(browser, viewport);
        await open(page, screen.path);
        const result = await page.evaluate(() => ({
          unnamed: Array.from(document.querySelectorAll('button, a[href]')).filter((element) => !(element.textContent ?? '').trim() && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map((element) => element.outerHTML.slice(0, 80)),
          svgs: Array.from(document.querySelectorAll('svg')).filter((svg) => svg.getAttribute('aria-hidden') !== 'true' && !svg.getAttribute('aria-label') && !svg.getAttribute('role')).length,
        }));
        expect(result.unnamed, `A11Y-14 ${screen.name}`).toEqual([]);
        expect(result.svgs, `A11Y-14 svg ${screen.name}`).toBe(0);
        await context.close();
      }
    }
  });
});

test.describe('UX-T1 · Contenedores', () => {
  const containers = [
    { path: '/accounts', selector: '.home', width: 1200 },
    { path: `/accounts/${data.ids.checking}/movements`, selector: '.hist', width: 1200 },
    { path: '/beneficiaries', selector: '.bn-page', width: 1200 },
    { path: '/beneficiaries/new', selector: '.bn-form-page', width: 1024 },
    { path: `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, selector: '.tf-page', width: 1024 },
  ];
  for (const viewport of [VIEWPORTS[4]!, VIEWPORTS[5]!, VIEWPORTS[6]!, VIEWPORTS[3]!, VIEWPORTS[1]!]) {
    test(`SP-07 page containers ${viewport.width}`, async ({ browser }) => {
      const results: Record<string, unknown> = {};
      for (const item of containers) {
        const { context, page } = await newPage(browser, viewport);
        await open(page, item.path);
        const geometry = await page.locator(item.selector).evaluate((element) => {
          const main = document.querySelector('main')!; const style = getComputedStyle(main);
          const area = main.getBoundingClientRect();
          const left = area.left + parseFloat(style.paddingLeft); const right = area.right - parseFloat(style.paddingRight);
          const rect = element.getBoundingClientRect();
          return { width: Math.round(rect.width), gapLeft: Math.round(rect.left - left), gapRight: Math.round(right - rect.right), available: Math.round(right - left), gutter: parseFloat(style.paddingLeft) };
        });
        results[item.selector] = geometry;
        if (geometry.available >= item.width) {
          expect(Math.abs(geometry.width - item.width), `SP-07 width ${item.selector}`).toBeLessThanOrEqual(1);
          expect(Math.abs(geometry.gapLeft - geometry.gapRight), `SP-07 centred ${item.selector}`).toBeLessThanOrEqual(1);
        } else {
          expect(Math.abs(geometry.width - geometry.available), `SP-07 full width ${item.selector}`).toBeLessThanOrEqual(1);
        }
        expect(geometry.gutter, 'gutter').toBe(viewport.width >= 1280 ? 32 : viewport.width >= 768 ? 24 : 16);
        await context.close();
      }
      recordMetric(`UX-T1 SP-07 ${viewport.width}`, results);
    });
  }
});
