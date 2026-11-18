// Accessibility probes reused by the screen specs (A11Y-01…05, A11Y-08/09). Pure page.evaluate helpers;
// contrast maths lives in contrast.ts.
import type { Page } from '@playwright/test';
import { collectTextSamples, contrastRatio, isLargeText, parseColor } from './contrast.js';

export type FocusStop = { name: string; tag: string; outlineStyle: string; outlineWidth: number; outlineColor: string; background: string; ratio: number };

/**
 * A11Y-01/02: tabs from the top of the document until focus wraps (or `max` stops) and records, for every
 * stop, its accessible name and the computed :focus-visible outline against the surrounding background.
 */
export async function tabOrder(page: Page, max = 40): Promise<FocusStop[]> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.locator('body').focus();
  const stops: FocusStop[] = [];
  let first: string | null = null;
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press('Tab');
    // Let the (reduced-motion, 0.01 ms) transitions settle so the computed focus style is the final one.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Sampling right after Tab could catch a running (0.01 ms) outline transition under load; wait for it to end.
    await page.evaluate(() => Promise.all((document.activeElement?.getAnimations() ?? []).map((animation) => animation.finished.catch(() => undefined))));
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const labelled = element.getAttribute('aria-labelledby');
      const labels = (element as HTMLInputElement).labels;
      const name = (element.getAttribute('aria-label')
        ?? (labelled ? labelled.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : null)
        ?? (labels && labels.length ? labels[0]!.textContent : null)
        ?? element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const style = getComputedStyle(element);
      let background = 'rgb(255, 255, 255)';
      for (let node = element.parentElement; node; node = node.parentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) { background = bg; break; }
      }
      const id = `${element.tagName}|${name}|${element.id}`;
      return { id, name, tag: element.tagName.toLowerCase(), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor, background };
    });
    if (!stop) break;
    if (first === stop.id) break;
    first ??= stop.id;
    const ratio = stop.outlineStyle === 'none' ? 0 : contrastRatio(parseColor(stop.outlineColor), parseColor(stop.background));
    stops.push({ name: stop.name, tag: stop.tag, outlineStyle: stop.outlineStyle, outlineWidth: stop.outlineWidth, outlineColor: stop.outlineColor, background: stop.background, ratio: Math.round(ratio * 100) / 100 });
  }
  return stops;
}

/** A11Y-04: every visible text node meets 4.5:1 (3:1 when large). Returns the failures and the sample count. */
export async function contrastFailures(page: Page) {
  const samples = await collectTextSamples(page);
  const failures = samples.map((sample) => {
    const ratio = contrastRatio(parseColor(sample.color), parseColor(sample.background));
    const required = isLargeText(sample.fontSize, sample.fontWeight) ? 3 : 4.5;
    return { ...sample, ratio: Math.round(ratio * 100) / 100, required };
  }).filter((item) => item.ratio < item.required);
  return { checked: samples.length, failures };
}

/** A11Y-09: html[lang], exactly one h1 and no skipped heading levels. */
export async function headingOutline(page: Page) {
  return page.evaluate(() => {
    const levels = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter((node) => (node as HTMLElement).offsetParent !== null || getComputedStyle(node).position === 'fixed').map((node) => Number(node.tagName.slice(1)));
    const skips = levels.filter((level, index) => index > 0 && level > levels[index - 1]! + 1);
    return { lang: document.documentElement.lang, h1: levels.filter((level) => level === 1).length, levels, skips: skips.length };
  });
}

/** A11Y-05: clipped text (overflow hidden + scrollWidth > clientWidth) without an accessible full value. */
export async function clippedText(page: Page) {
  return page.evaluate(() => Array.from(document.body.querySelectorAll('*')).filter((element) => {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || element.closest('.sr-only')) return false;
    if (!/(hidden|clip)/.test(`${style.overflowX} ${style.overflow}`)) return false;
    if (!(element.textContent ?? '').trim()) return false;
    return element.scrollWidth > element.clientWidth + 1 && !element.getAttribute('title');
  }).map((element) => `${element.tagName.toLowerCase()}.${String((element as HTMLElement).className).split(' ').join('.')}`));
}
