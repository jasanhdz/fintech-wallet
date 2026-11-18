// Shared scenario plumbing for the screen specs from WF-T2 on (same rules as t1-access.spec.ts): contexts with
// es-MX/America/Mexico_City/reduced motion, FONT-04/FN-17 watcher, captures + manifest, side by side at the
// reference viewport R, RESP-01/02, A11Y-01/02/04/09 and A11Y-05 reflow.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { capturePath, recordCapture } from './evidence.js';
import { horizontalOverflow } from './geometry.js';
import { composeSideBySide, composeSideBySideHtml, referenceViewport } from './side-by-side.js';
import { clippedText, contrastFailures, headingOutline, tabOrder } from './a11y.js';

export const WEB_ORIGIN = 'http://127.0.0.1:5301';
export const API_ORIGIN = 'http://127.0.0.1:3301';
export type Viewport = { label: string; width: number; height: number; dpr: number };
export const V1440: Viewport = { label: '1440', width: 1440, height: 960, dpr: 1 };
export const V768: Viewport = { label: '768', width: 768, height: 1024, dpr: 1 };
export const V390: Viewport = { label: '390', width: 390, height: 844, dpr: 1 };

/** Viewport R of an approved reference (SPEC §5.3, D-C1: 1280 CSS px wide at the PNG density). */
export function viewportR(reference: string): Viewport {
  const r = referenceViewport(reference);
  return { label: 'R', width: r.width, height: r.height, dpr: r.dpr };
}

export const viewportsFor = (reference: string): Viewport[] => [V1440, viewportR(reference), V768, V390];

/** FONT-04 + FN-17: foreign hosts and console/page errors (provoked HTTP failures are listed, not hidden). */
export function watch(page: Page) {
  const foreign: string[] = []; const errors: string[] = []; const provoked: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return;
    const origin = new URL(url).origin;
    // WF-T4: every round port (P1…P4, SPEC §5.10) is first-party; anything else is foreign.
    if (![WEB_ORIGIN, API_ORIGIN, 'http://127.0.0.1:5302', 'http://127.0.0.1:3302', 'http://127.0.0.1:5303', 'http://127.0.0.1:3303', 'http://127.0.0.1:5304', 'http://127.0.0.1:3304'].includes(origin)) foreign.push(url);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (/^Failed to load resource: (the server responded with a status of (401|403|404|409|422|429|500|503)|net::ERR_(INTERNET_DISCONNECTED|FAILED|CONNECTION_RESET))/.test(message.text())) provoked.push(message.text());
    else errors.push(message.text());
  });
  return { foreign, errors, provoked };
}

export async function newPage(browser: Browser, viewport: Viewport, baseURL = WEB_ORIGIN): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
  return { context, page: await context.newPage() };
}

export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.scrollTo(0, 0));
}

export type Row = { scenario: string; screen: string; state: string; reference: string };

export async function shoot(page: Page, name: string, row: Row, viewport: Viewport, level: 'F' | 'I' = 'F') {
  await settle(page);
  const file = capturePath(`${name}-${viewport.width}x${viewport.height}@${viewport.dpr}.png`);
  await page.screenshot({ path: file, fullPage: true });
  recordCapture({ ...row, level, viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file });
  return file;
}

/** Viewport-only capture at R composed next to the approved reference PNG (SPEC §5.11). */
export async function sideBySide(browser: Browser, page: Page, name: string, row: Row, viewport: Viewport) {
  await settle(page);
  const product = capturePath(`${name}-R-viewport-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: product });
  const composed = await composeSideBySide(browser, row.reference, product, capturePath(`${name}-sbs.png`));
  recordCapture({ ...row, state: `${row.state} · lado a lado`, level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file: composed.file });
  return composed;
}

/** Same as `sideBySide` for approved variants that only exist as `code.html` (SPEC §5.11, structure and copy). */
export async function sideBySideHtml(browser: Browser, page: Page, name: string, row: Row, viewport: Viewport) {
  await settle(page);
  const product = capturePath(`${name}-R-viewport-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: product });
  const composed = await composeSideBySideHtml(browser, row.reference, product, capturePath(`${name}-sbs.png`), viewport);
  recordCapture({ ...row, state: `${row.state} · lado a lado (HTML)`, level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file: composed.file });
  return composed;
}

export async function responsive(page: Page) {
  const overflow = await horizontalOverflow(page);
  expect(overflow.scrollWidth, 'RESP-01').toBeLessThanOrEqual(overflow.innerWidth);
  expect(overflow.offenders, 'RESP-02').toEqual([]);
  return overflow;
}

export async function a11yBasics(page: Page, inventory: readonly string[]) {
  const outline = await headingOutline(page);
  expect(outline.lang, 'A11Y-09 lang').toBe('es');
  expect(outline.h1, 'A11Y-09 one h1').toBe(1);
  expect(outline.skips, 'A11Y-09 no skipped levels').toBe(0);
  // Colours are read from computed styles: let any running (0.01 ms, reduced motion) CSS transition end first.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished.catch(() => undefined))));
  const contrast = await contrastFailures(page);
  expect(contrast.failures, 'A11Y-04').toEqual([]);
  // Reset the sequential-focus starting point to the top of the document (a removed or filled control would
  // otherwise make the first Tab start mid-page).
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); window.getSelection()?.removeAllRanges(); });
  const stops = await tabOrder(page, 80);
  expect(stops.map((stop) => stop.name), 'A11Y-01 tab order = inventory').toEqual([...inventory]);
  for (const stop of stops) {
    expect(stop.outlineStyle, `A11Y-02 ${stop.name}`).not.toBe('none');
    expect(stop.outlineWidth, `A11Y-02 ${stop.name}`).toBeGreaterThanOrEqual(2);
    expect(stop.ratio, `A11Y-02 ${JSON.stringify(stop)}`).toBeGreaterThanOrEqual(3);
  }
  return { outline, contrastChecked: contrast.checked, tabOrder: stops.map((stop) => stop.name) };
}

/** A11Y-05: 200 % zoom equivalent (640×512) and 320 px reflow. */
export async function reflow(browser: Browser, open: (page: Page) => Promise<void>) {
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

/** Shell around the content stops (actions-inventory.md «Shell autenticado»). */
export function withShell(content: readonly string[], wide: boolean) {
  return wide
    ? ['Saltar al contenido', 'Inicio', 'Movimientos', 'Beneficiarios', 'Transferir', 'Cerrar sesión', ...content]
    : ['Saltar al contenido', 'Cerrar sesión', ...content, 'Inicio', 'Movimientos', 'Beneficiarios', 'Transferir'];
}

/** A11Y-10: no running animation on spinners/skeletons/progress with reduced motion. */
export async function runningAnimations(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((element) => {
    const style = getComputedStyle(element);
    return style.animationName !== 'none' && parseFloat(style.animationDuration) > 0.001 && style.animationPlayState === 'running';
  }).map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`));
}
