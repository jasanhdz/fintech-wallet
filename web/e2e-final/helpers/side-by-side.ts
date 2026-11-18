// Side-by-side composition (SPEC §5.11): reference screen.png and product capture at the same scale on
// an offline about:blank page, plus an informative pixel-difference metric (not a criterion).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { DESIGN_DIR } from './evidence.js';

export type SideBySide = { file: string; differentPixelRatio: number | null };

/**
 * @param referenceFolder approved folder under design/web (read-only, never copied into the repo)
 * @param productPng product capture taken at viewport R with the reference DPR
 */
export async function composeSideBySide(browser: Browser, referenceFolder: string, productPng: string, outFile: string): Promise<SideBySide> {
  const reference = `data:image/png;base64,${readFileSync(resolve(DESIGN_DIR, referenceFolder, 'screen.png')).toString('base64')}`;
  const product = `data:image/png;base64,${readFileSync(productPng).toString('base64')}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, offline: true });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><body style="margin:0;background:#888;display:flex;gap:16px;padding:16px;align-items:flex-start;font:14px sans-serif">
    <figure style="margin:0"><figcaption style="color:#fff">Referencia · ${referenceFolder}</figcaption><img id="ref" src="${reference}" style="width:760px;display:block"></figure>
    <figure style="margin:0"><figcaption style="color:#fff">Producto</figcaption><img id="prod" src="${product}" style="width:760px;display:block"></figure></body>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
  const differentPixelRatio = await page.evaluate(() => {
    const [a, b] = [document.getElementById('ref') as HTMLImageElement, document.getElementById('prod') as HTMLImageElement];
    const width = 320;
    const height = Math.round(width * a.naturalHeight / a.naturalWidth);
    const draw = (image: HTMLImageElement) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, width, Math.round(width * image.naturalHeight / image.naturalWidth));
      return context.getImageData(0, 0, width, height).data;
    };
    const [pa, pb] = [draw(a), draw(b)];
    let different = 0;
    for (let index = 0; index < pa.length; index += 4) {
      const delta = Math.abs(pa[index]! - pb[index]!) + Math.abs(pa[index + 1]! - pb[index + 1]!) + Math.abs(pa[index + 2]! - pb[index + 2]!);
      if (delta > 48) different += 1;
    }
    return different / (width * height);
  });
  await page.screenshot({ path: outFile, fullPage: true });
  await context.close();
  return { file: outFile, differentPixelRatio };
}

/**
 * Variants without a PNG (SPEC §5.11): the approved `code.html` is rendered offline (no Tailwind/fonts from a CDN,
 * so only structure and copy are comparable) at the product viewport and composed next to the product capture.
 */
export async function composeSideBySideHtml(browser: Browser, referenceFolder: string, productPng: string, outFile: string, viewport: { width: number; height: number; dpr: number }): Promise<SideBySide> {
  const html = readFileSync(resolve(DESIGN_DIR, referenceFolder, 'code.html'), 'utf8');
  const renderContext = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.dpr, offline: true, javaScriptEnabled: false });
  const renderPage = await renderContext.newPage();
  await renderPage.setContent(html, { waitUntil: 'domcontentloaded' });
  const rendered = await renderPage.screenshot({ fullPage: true });
  await renderContext.close();
  const reference = `data:image/png;base64,${rendered.toString('base64')}`;
  const product = `data:image/png;base64,${readFileSync(productPng).toString('base64')}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, offline: true });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><body style="margin:0;background:#888;display:flex;gap:16px;padding:16px;align-items:flex-start;font:14px sans-serif">
    <figure style="margin:0"><figcaption style="color:#fff">Referencia HTML sin red (sin PNG) · ${referenceFolder}</figcaption><img src="${reference}" style="width:760px;display:block"></figure>
    <figure style="margin:0"><figcaption style="color:#fff">Producto</figcaption><img src="${product}" style="width:760px;display:block"></figure></body>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: outFile, fullPage: true });
  await context.close();
  return { file: outFile, differentPixelRatio: null };
}

/** Reference viewport R from the PNG width (1280 CSS px wide): DPR = width/1280, height = pngHeight/DPR. */
export function referenceViewport(referenceFolder: string) {
  const png = readFileSync(resolve(DESIGN_DIR, referenceFolder, 'screen.png'));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const dpr = width / 1280;
  return { width: 1280, height: Math.round(height / dpr), dpr, pngWidth: width, pngHeight: height };
}
