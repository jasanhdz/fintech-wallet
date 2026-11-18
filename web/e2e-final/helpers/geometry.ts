// Geometry/style helpers for [F] assertions (SPEC §7.0 tolerances: boxes ±2 px, radii ±1 px).
import type { Locator, Page } from '@playwright/test';

export type Box = { x: number; y: number; width: number; height: number };
export const near = (actual: number, expected: number, tolerance = 2) => Math.abs(actual - expected) <= tolerance;

export async function box(locator: Locator): Promise<Box> {
  const value = await locator.boundingBox();
  if (!value) throw new Error('element has no box (not visible)');
  return value;
}

/** Selected computed style properties of the first matching element. */
export async function styles<K extends string>(locator: Locator, properties: readonly K[]): Promise<Record<K, string>> {
  return locator.first().evaluate((element, props) => {
    const computed = getComputedStyle(element);
    return Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)])) as Record<string, string>;
  }, properties as readonly string[]) as Promise<Record<K, string>>;
}

/** RESP-01/RESP-02: page-level horizontal overflow and elements past the right edge. */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const offenders: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      if (rect.right > innerWidth + 1) offenders.push(`${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.className && typeof element.className === 'string' ? `.${element.className.split(' ').join('.')}` : ''} right=${Math.round(rect.right)}`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, offenders: offenders.slice(0, 20) };
  });
}
