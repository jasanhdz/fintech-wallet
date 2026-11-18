// Builds per-state side-by-side (Stitch | app) and a difference overlay (CSS mix-blend-mode: difference) with Playwright.
// Usage: node compose.cjs <shotsDir> <refRoot> <outDir> <mapping.json>
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [shots, refRoot, out, mappingFile] = process.argv.slice(2);
const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const dataUrl = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [state, ref] of Object.entries(mapping)) {
    const refFile = path.join(refRoot, ref, 'screen.png'); const appFile = path.join(shots, `${state}.png`);
    if (!fs.existsSync(appFile)) { console.log('missing', state); continue; }
    const W = 390; // logical width per panel (evidence copy)
    const html = `<html><body style="margin:0;background:#888;font:14px system-ui">
      <div id="sbs" style="display:flex;gap:12px;padding:12px;width:${W * 2 + 36}px;align-items:flex-start">
        <figure style="margin:0"><figcaption style="color:#fff">Stitch · ${ref}</figcaption><img src="${dataUrl(refFile)}" style="width:${W}px;display:block;background:#fff"></figure>
        <figure style="margin:0"><figcaption style="color:#fff">App (RN-web) · ${state}</figcaption><img src="${dataUrl(appFile)}" style="width:${W}px;display:block;background:#fff"></figure>
      </div>
      <div id="diff" style="position:relative;width:${W}px;margin:12px;background:#000">
        <img src="${dataUrl(refFile)}" style="width:${W}px;display:block">
        <img src="${dataUrl(appFile)}" style="width:${W}px;display:block;position:absolute;left:0;top:0;mix-blend-mode:difference">
      </div></body></html>`;
    await page.setContent(html); await page.waitForTimeout(150);
    await page.locator('#sbs').screenshot({ path: path.join(out, `${state}--lado-a-lado.jpg`), type: 'jpeg', quality: 72 });
    await page.locator('#diff').screenshot({ path: path.join(out, `${state}--diferencia.jpg`), type: 'jpeg', quality: 72 });
    console.log('composed', state);
  }
  await browser.close();
})();
