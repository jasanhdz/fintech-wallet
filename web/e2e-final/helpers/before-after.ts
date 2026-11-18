// «Antes | después» composition (docs/web-ux-polish/SPEC.md §5.10): the UX-T0 baseline capture and the current
// capture of the same scenario × viewport at the same scale on an offline about:blank page (like composeSideBySide).
import { existsSync, readFileSync } from 'node:fs';
import type { Browser } from '@playwright/test';

export async function composeBeforeAfter(browser: Browser, beforePng: string, afterPng: string, outFile: string, caption: string) {
  if (!existsSync(beforePng)) return null;
  const encode = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, offline: true });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><body style="margin:0;background:#888;display:flex;gap:16px;padding:16px;align-items:flex-start;font:14px sans-serif">
    <figure style="margin:0"><figcaption style="color:#fff">Antes (UX-T0) · ${caption}</figcaption><img src="${encode(beforePng)}" style="width:760px;display:block"></figure>
    <figure style="margin:0"><figcaption style="color:#fff">Después · ${caption}</figcaption><img src="${encode(afterPng)}" style="width:760px;display:block"></figure></body>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: outFile, fullPage: true });
  await context.close();
  return outFile;
}
