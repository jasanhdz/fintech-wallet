// Font loading probes (FONT-03/05/06).
import type { Page } from '@playwright/test';

export const INTER_WEIGHTS = ['400', '500', '600', '700'] as const;

/** Forces the four Inter weights to load, then reports every Inter FontFace and its status. */
export async function interFaces(page: Page) {
  return page.evaluate(async (weights) => {
    await Promise.all(weights.map((weight) => document.fonts.load(`${weight} 16px Inter`)));
    await document.fonts.ready;
    return Array.from(document.fonts).filter((face) => face.family.replace(/["']/g, '') === 'Inter').map((face) => ({ weight: String(face.weight), status: face.status }));
  }, [...INTER_WEIGHTS]);
}

/** Canvas width of a text with Inter vs Arial and `document.fonts.check`. */
export async function interMetrics(page: Page, text: string) {
  return page.evaluate(async (sample) => {
    await document.fonts.load('600 30px Inter');
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = '600 30px Inter';
    const inter = context.measureText(sample).width;
    context.font = '600 30px Arial';
    const arial = context.measureText(sample).width;
    return { check: document.fonts.check('600 30px Inter'), inter, arial };
  }, text);
}

export async function fontFamilies(page: Page, selectors: string[]) {
  return page.evaluate((list) => Object.fromEntries(list.map((selector) => {
    const element = document.querySelector(selector);
    return [selector, element ? getComputedStyle(element).fontFamily : null];
  })), selectors);
}
