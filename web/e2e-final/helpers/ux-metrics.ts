// UX polish measurement helpers (docs/web-ux-polish/SPEC.md §5.10). Pure page.evaluate probes that return
// offenders (empty array = PASS); they never assert by themselves so the baseline («antes») can record failures.
import type { Page, Request } from '@playwright/test';

/** §5.3 spacing scale (px). `padding-block: 2px` is allowed only on `.chip`. */
export const SPACE_SCALE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96];
/** §5.3 radii: 0, xs 4, sm 8, auth input 10, md 12, lg 16, full (9999 / ≥ half the box). */
export const RADII = [0, 4, 8, 10, 12, 16, 9999];
/** §5.3 type scale as `size/line-height` pairs (px). */
export const TYPE_PAIRS = ['40/48', '32/40', '30/38', '24/32', '20/28', '16/24', '14/20', '12/18', '11/16', '13/18'];

type Offender = { element: string; property: string; value: string };

/** Short, stable description of an element for offender lists. */
const DESCRIBE = `(element) => {
  const cls = typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
  const id = element.id ? '#' + element.id : '';
  return element.tagName.toLowerCase() + id + cls;
}`;

/**
 * SP-03: computed padding/margin/gap of visible elements inside the shell chrome and `main` outside the scale.
 * Centred auto margins (equal left/right) and `.sr-only` are ignored; negative margins are always offenders.
 */
export async function offScaleSpacing(page: Page): Promise<Offender[]> {
  return page.evaluate(({ scale, describe }) => {
    const name = new Function(`return ${describe}`)() as (element: Element) => string;
    const roots = Array.from(document.querySelectorAll('main, .shell-sidebar, .shell-topbar, .shell-bottom-nav, aside.shell-sidebar, header.shell-topbar, nav.shell-bottom-nav'));
    const seen = new Set<Element>();
    const out: Array<{ element: string; property: string; value: string }> = [];
    const onScale = (value: number) => scale.some((step) => Math.abs(step - value) < 0.51);
    for (const root of roots) {
      for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        if (seen.has(element)) continue; seen.add(element);
        if (element.closest('.sr-only, svg')) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const props = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
        if (/(flex|grid)/.test(style.display)) props.push('row-gap', 'column-gap');
        const marginLeft = parseFloat(style.marginLeft); const marginRight = parseFloat(style.marginRight);
        const centred = Math.abs(marginLeft - marginRight) < 0.51 && marginLeft > 0;
        for (const prop of props) {
          const raw = style.getPropertyValue(prop);
          if (raw === 'normal' || raw === 'auto' || raw === '') continue;
          // Browsers resolve flex `margin-top:auto` to a pixel value in computed style.
          // Auto margins are explicitly allowed by SPEC §5.3, so preserve that layout
          // rule instead of treating the consumed free space as authored spacing.
          if (element.classList.contains('shell-sidebar-bottom') && prop === 'margin-top') continue;
          const value = parseFloat(raw);
          if (Number.isNaN(value)) continue;
          if (prop.startsWith('margin') && value < 0) { out.push({ element: name(element), property: prop, value: raw }); continue; }
          if ((prop === 'margin-left' || prop === 'margin-right') && (centred || value > 96)) continue;
          if (element.classList.contains('chip') && (prop === 'padding-top' || prop === 'padding-bottom') && Math.abs(value - 2) < 0.51) continue;
          if (!onScale(value)) out.push({ element: name(element), property: prop, value: raw });
        }
      }
    }
    return out;
  }, { scale: SPACE_SCALE, describe: DESCRIBE });
}

/** SP-04: border radii outside {0,4,8,10 (auth inputs only),12,16,9999}; a radius ≥ half the box counts as «full». */
export async function radiiOutside(page: Page): Promise<Offender[]> {
  return page.evaluate(({ radii, describe }) => {
    const name = new Function(`return ${describe}`)() as (element: Element) => string;
    const out: Array<{ element: string; property: string; value: string }> = [];
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (element.closest('svg')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      for (const prop of ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']) {
        const raw = style.getPropertyValue(prop);
        if (raw.includes('%')) { if (raw !== '50%') out.push({ element: name(element), property: prop, value: raw }); continue; }
        const value = parseFloat(raw);
        if (Number.isNaN(value) || value === 0) continue;
        if (value >= Math.min(rect.width, rect.height) / 2 - 0.5) continue;
        const allowed = radii.filter((step) => step !== 10 || element.closest('.auth-input'));
        if (!allowed.some((step) => Math.abs(step - value) < 0.51)) out.push({ element: name(element), property: prop, value: raw });
        break;
      }
    }
    return out;
  }, { radii: RADII, describe: DESCRIBE });
}

/** SP-05: visible text-bearing elements whose font-size/line-height pair or weight is outside §5.3. */
export async function typographyOutside(page: Page): Promise<Offender[]> {
  return page.evaluate(({ pairs, describe }) => {
    const name = new Function(`return ${describe}`)() as (element: Element) => string;
    const out: Array<{ element: string; property: string; value: string }> = [];
    const seen = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement;
      if (!element || !node.textContent?.trim() || element.closest('.sr-only, [hidden], option, script, style')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0) continue;
      const size = Math.round(parseFloat(style.fontSize) * 100) / 100;
      const line = style.lineHeight === 'normal' ? 'normal' : String(Math.round(parseFloat(style.lineHeight) * 100) / 100);
      const pair = `${size}/${line}`;
      const weight = Number(style.fontWeight);
      const key = `${name(element)}|${pair}|${weight}`;
      if (seen.has(key)) continue; seen.add(key);
      if (!pairs.includes(pair)) out.push({ element: name(element), property: 'font-size/line-height', value: pair });
      if (weight < 400 || weight > 700 || weight % 100 !== 0) out.push({ element: name(element), property: 'font-weight', value: String(weight) });
    }
    return out;
  }, { pairs: TYPE_PAIRS, describe: DESCRIBE });
}

/**
 * A11Y-12: visible interactive elements smaller than `min` (both sides); with `minHeight` (≥1024 rule) buttons,
 * inputs and selects must also be ≥ `minHeight` tall. Links inside running text (`p` with other text) are exempt.
 */
export async function touchTargets(page: Page, min: number, minHeight = min) {
  return page.evaluate(({ min, minHeight, describe }) => {
    const name = new Function(`return ${describe}`)() as (element: Element) => string;
    const out: Array<{ element: string; width: number; height: number }> = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], [tabindex]:not([tabindex="-1"])'));
    for (const element of nodes) {
      if (element.closest('.sr-only') || element.classList.contains('skip-link')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 && !element.matches('input')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // The W10 code input is a transparent overlay over the six boxes; it is measured by its container.
      if (element.tagName === 'A') {
        const paragraph = element.closest('p');
        if (paragraph && (paragraph.textContent ?? '').trim() !== (element.textContent ?? '').trim()) continue;
      }
      const control = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName) || element.getAttribute('role') === 'button';
      const width = Math.round(rect.width); const height = Math.round(rect.height);
      if (width < min - 0.5 || height < min - 0.5 || (control && height < minHeight - 0.5)) out.push({ element: name(element), width, height });
    }
    return out;
  }, { min, minHeight, describe: DESCRIBE });
}

export type OverlayRect = { element: string; position: string; top: number; bottom: number; left: number; right: number; background: string; backdrop: string };

/** Visible fixed/sticky elements (skip link excluded) with their rects and background/backdrop. */
export async function overlayRects(page: Page): Promise<OverlayRect[]> {
  return page.evaluate((describe) => {
    const name = new Function(`return ${describe}`)() as (element: Element) => string;
    return Array.from(document.body.querySelectorAll('*')).filter((element) => {
      const style = getComputedStyle(element);
      if (!/^(fixed|sticky)$/.test(style.position) || style.display === 'none' || style.visibility === 'hidden') return false;
      if (element.classList.contains('skip-link') || element.closest('.sr-only')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).map((element) => {
      const style = getComputedStyle(element); const rect = element.getBoundingClientRect();
      return { element: name(element), position: style.position, top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), background: style.backgroundColor, backdrop: style.backdropFilter || 'none' };
    });
  }, DESCRIBE);
}

/**
 * SH-07/SH-08: overlays with translucent background or backdrop-filter, and, after scrolling 300 px, the
 * `elementFromPoint` probe at 9 points of each overlay (it must hit the overlay or a descendant). Also reports
 * whether the `h1` intersects an overlay at scrollY = 0.
 */
export async function overlayBleed(page: Page) {
  return page.evaluate(async (describe) => {
    const name = new Function(`return ${describe}`)() as (element: Element) => string;
    const alpha = (color: string) => { const match = /rgba?\(([^)]+)\)/.exec(color); if (!match) return 1; const parts = match[1]!.split(/[ ,/]+/).filter(Boolean); return parts.length > 3 ? Number(parts[3]) : 1; };
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const overlays = () => Array.from(document.body.querySelectorAll('*')).filter((element) => {
      const style = getComputedStyle(element);
      if (!/^(fixed|sticky)$/.test(style.position) || style.display === 'none' || style.visibility === 'hidden') return false;
      if (element.classList.contains('skip-link') || element.closest('.sr-only')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    window.scrollTo(0, 0); await frame();
    const h1 = document.querySelector('main h1');
    const h1Rect = h1?.getBoundingClientRect();
    const h1Hits = h1Rect ? overlays().filter((element) => { const r = element.getBoundingClientRect(); return !(r.bottom <= h1Rect.top || r.top >= h1Rect.bottom || r.right <= h1Rect.left || r.left >= h1Rect.right) && !element.contains(h1); }).map(name) : [];
    const translucent = overlays().filter((element) => { const style = getComputedStyle(element); return alpha(style.backgroundColor) < 1 || (style.backdropFilter && style.backdropFilter !== 'none'); })
      .map((element) => ({ element: name(element), background: getComputedStyle(element).backgroundColor, backdrop: getComputedStyle(element).backdropFilter }));
    window.scrollTo(0, 300); await frame();
    const leaks: Array<{ element: string; point: string; hit: string }> = [];
    for (const element of overlays()) {
      const rect = element.getBoundingClientRect();
      for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) {
        const x = rect.left + rect.width * fx; const y = rect.top + rect.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== element && !element.contains(hit)) leaks.push({ element: name(element), point: `${Math.round(x)},${Math.round(y)}`, hit: name(hit) });
      }
    }
    window.scrollTo(0, 0); await frame();
    return { translucent, leaks, h1Hits };
  }, DESCRIBE);
}

/**
 * A11Y-08 (WCAG 2.4.11): tabs through the page and reports every focused element that is outside the viewport or
 * intersects a fixed/sticky overlay that does not contain it.
 */
export async function focusObscured(page: Page, max = 60) {
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); window.scrollTo(0, 0); });
  const out: Array<{ element: string; reason: string }> = [];
  let first: string | null = null;
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press('Tab');
    const probe = await page.evaluate(async (describe) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const name = new Function(`return ${describe}`)() as (element: Element) => string;
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const id = `${name(element)}|${element.textContent?.trim().slice(0, 30) ?? ''}`;
      if (element.classList.contains('skip-link')) return { id, reason: null };
      const rect = element.getBoundingClientRect();
      // Transparent overlay inputs (W10) are measured by their visible parent.
      const box = getComputedStyle(element).opacity === '0' || Number(getComputedStyle(element).opacity) < 0.05 ? element.parentElement!.getBoundingClientRect() : rect;
      if (box.top < -0.5 || box.left < -0.5 || box.bottom > innerHeight + 0.5 || box.right > innerWidth + 0.5) return { id, reason: `outside viewport (${Math.round(box.top)},${Math.round(box.bottom)})` };
      const covering = Array.from(document.body.querySelectorAll('*')).filter((node) => {
        const style = getComputedStyle(node);
        if (!/^(fixed|sticky)$/.test(style.position) || style.display === 'none' || style.visibility === 'hidden' || node.contains(element) || node.classList.contains('skip-link')) return false;
        const r = node.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !(r.bottom <= box.top + 0.5 || r.top >= box.bottom - 0.5 || r.right <= box.left + 0.5 || r.left >= box.right - 0.5);
      });
      return { id, reason: covering.length ? `under ${covering.map(name).join(', ')}` : null };
    }, DESCRIBE);
    if (!probe) break;
    if (first === probe.id) break;
    first ??= probe.id;
    if (probe.reason) out.push({ element: probe.id, reason: probe.reason });
  }
  return out;
}

/** SH-01: visible chrome duplicates (brand, demo chip/label, logout controls, user initials/name blocks). */
export async function duplicateChrome(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0 && !element.closest('.sr-only, [aria-hidden="true"]'); };
    const own = (element: Element) => Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('').trim();
    const all = Array.from(document.body.querySelectorAll('*')).filter(visible);
    const brand = all.filter((element) => own(element) === 'Billetera MXN').length;
    const chrome = Array.from(document.querySelectorAll('.shell-sidebar, .shell-topbar, .shell-bottom-nav, header, aside, nav')).filter((element) => !element.closest('main'));
    const demo = new Set(chrome.flatMap((root) => Array.from(root.querySelectorAll('*')).filter(visible).filter((element) => /^demostraci[oó]n$/i.test(own(element))))).size;
    const logout = Array.from(document.querySelectorAll('button, a')).filter(visible).filter((element) => /^(cerrar sesi[oó]n|salir)$/i.test((element.getAttribute('aria-label') ?? element.textContent ?? '').trim())).length;
    // A user block is a `[data-user-block]` or an avatar outside one (initials + name count once).
    const user = Array.from(document.querySelectorAll('.shell-avatar, [data-user-block]')).filter((element) => !(element.matches('.shell-avatar') && element.closest('[data-user-block]')))
      .filter((element) => { const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0; }).length;
    return { brand, demo, logout, user };
  });
}

/**
 * SP-08: left edge of the `h1` against the first content block after the page header, plus same-row sibling cards
 * (`[data-align-row] > *`, W03 cuentas, W06 tarjetas, W12 partes) top/height/bottom of their footer actions.
 */
export async function edgeAlignment(page: Page) {
  return page.evaluate(() => {
    const h1 = document.querySelector('main h1');
    if (!h1) return { h1Left: null, blockLeft: null, delta: null, block: null };
    const h1Left = h1.getBoundingClientRect().left;
    const header = h1.closest('header') ?? h1;
    let block: Element | null = null;
    for (let node: Element | null = header; node && !block; node = node.parentElement) {
      if (node.tagName === 'MAIN') break;
      for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        const rect = sibling.getBoundingClientRect(); const style = getComputedStyle(sibling);
        if (rect.width > 0 && rect.height > 0 && style.position !== 'absolute' && !sibling.classList.contains('sr-only')) { block = sibling; break; }
      }
    }
    const blockLeft = block ? block.getBoundingClientRect().left : null;
    return { h1Left: Math.round(h1Left), blockLeft: blockLeft === null ? null : Math.round(blockLeft), delta: blockLeft === null ? null : Math.round(Math.abs(h1Left - blockLeft)), block: block ? `${block.tagName.toLowerCase()}.${String(block.className).split(' ')[0]}` : null };
  });
}

/** CLS accumulated (layout-shift entries without recent input) while `action` runs and `settleMs` after it. */
export async function clsDuring(page: Page, action: () => Promise<void>, settleMs = 300) {
  await page.evaluate(() => {
    const w = window as unknown as { __uxCls: number; __uxClsObserver?: PerformanceObserver };
    w.__uxCls = 0;
    w.__uxClsObserver?.disconnect();
    w.__uxClsObserver = new PerformanceObserver((list) => { for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!entry.hadRecentInput) w.__uxCls += entry.value; });
    w.__uxClsObserver.observe({ type: 'layout-shift', buffered: false });
  }).catch(() => undefined);
  await action();
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => Math.round(((window as unknown as { __uxCls?: number }).__uxCls ?? 0) * 10000) / 10000).catch(() => null);
}

/** Install before navigation: CLS of the whole page life (buffered), read with `readCls`. */
export async function trackCls(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __uxClsTotal: number };
    w.__uxClsTotal = 0;
    try {
      new PerformanceObserver((list) => { for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!entry.hadRecentInput) w.__uxClsTotal += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* unsupported */ }
  });
}
export const readCls = (page: Page) => page.evaluate(() => Math.round(((window as unknown as { __uxClsTotal?: number }).__uxClsTotal ?? 0) * 10000) / 10000);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** `(method, route template)` of an API request: UUIDs → `:id`; query keys kept (values dropped). */
export function routeTemplate(request: Request) {
  const url = new URL(request.url());
  const keys = [...new Set(url.searchParams.keys())].sort();
  return `${request.method()} ${url.pathname.replace(UUID, ':id')}${keys.length ? `?${keys.join('&')}` : ''}`;
}

/** NET-02 / T0-08: records every `/v1/` request template of the page; call `.reads()` for the sorted set. */
export function readTraffic(page: Page) {
  const seen = new Set<string>();
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/v1/')) seen.add(routeTemplate(request)); });
  return { reads: () => [...seen].sort() };
}
