// Side by side (Stitch | capture) + difference overlay (mix-blend-mode: difference) + mean abs difference per state.
// Usage: node compose-ev8.cjs <shotsDir> <designMobileRoot> <outDir> <mapping.json>
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [shots, refRoot, out, mappingFile] = process.argv.slice(2);
const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
fs.mkdirSync(out, { recursive: true });
const url = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const W = 360;
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [state, ref] of Object.entries(mapping)) {
    const a = path.join(shots, `${state}.png`); const r = path.join(refRoot, ref, 'screen.png');
    if (!fs.existsSync(a) || !fs.existsSync(r)) { console.log('missing', state, fs.existsSync(a), fs.existsSync(r)); continue; }
    await page.setContent(`<html><body style="margin:0;background:#777;font:13px system-ui"><div id="sbs" style="display:inline-flex;gap:12px;padding:12px;align-items:flex-start"><figure style="margin:0"><figcaption style="color:#fff;width:${W}px">Stitch · ${ref}</figcaption><img src="${url(r)}" style="width:${W}px;display:block"></figure><figure style="margin:0"><figcaption style="color:#fff;width:${W}px">Captura · ${state}</figcaption><img src="${url(a)}" style="width:${W}px;display:block"></figure><div id="diff" style="position:relative;width:${W}px;background:#000;margin-top:21px"><img id="i1" src="${url(r)}" style="width:${W}px;display:block"><img id="i2" src="${url(a)}" style="width:${W}px;display:block;position:absolute;left:0;top:0;mix-blend-mode:difference"></div></div></body></html>`);
    await page.waitForTimeout(150);
    const mean = await page.evaluate(() => { const c = document.createElement('canvas'); const i1 = document.getElementById('i1'), i2 = document.getElementById('i2'); const w = 360, h = Math.min(i1.clientHeight, i2.clientHeight); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i1, 0, 0, w, h); const A = x.getImageData(0, 0, w, h).data; x.clearRect(0, 0, w, h); x.drawImage(i2, 0, 0, w, h); const B = x.getImageData(0, 0, w, h).data; let s = 0; for (let k = 0; k < A.length; k += 4) s += Math.abs(A[k] - B[k]) + Math.abs(A[k + 1] - B[k + 1]) + Math.abs(A[k + 2] - B[k + 2]); return { mean: (s / (A.length / 4) / 3).toFixed(2), hRef: i1.clientHeight, hMine: i2.clientHeight }; });
    await page.locator('#sbs').screenshot({ path: path.join(out, `${state}--lado-a-lado.jpg`), type: 'jpeg', quality: 72 });
    console.log(`${state} vs ${ref}: mean diff ${mean.mean}/255 (heights at 360 px wide: ref ${mean.hRef}, mine ${mean.hMine})`);
  }
  await browser.close();
})();
