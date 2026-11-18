// Round 7: per-state panels "Stitch | antes (7219339) | después (efd0704)" plus a difference overlay antes vs después
// (CSS mix-blend-mode: difference; black = identical). States without a "before" capture show only Stitch | después.
// Usage: node compose-r7.cjs <beforeDir> <afterDir> <refRoot> <outDir> <mapping.json> [extraState ...]
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [before, after, refRoot, out, mappingFile, ...extra] = process.argv.slice(2);
const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
for (const state of extra) mapping[state] = mapping[state.replace(/-x[\d.]+$/, '')] ?? null;
fs.mkdirSync(out, { recursive: true });
const url = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const W = 360;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [state, ref] of Object.entries(mapping)) {
    const a = path.join(after, `${state}.png`); if (!fs.existsSync(a)) { console.log('missing', state); continue; }
    const b = path.join(before, `${state}.png`); const r = ref ? path.join(refRoot, ref, 'screen.png') : null;
    const panel = (title, f) => `<figure style="margin:0"><figcaption style="color:#fff;width:${W}px">${title}</figcaption><img src="${url(f)}" style="width:${W}px;display:block;background:#fff"></figure>`;
    const panels = [r && fs.existsSync(r) ? panel(`Stitch · ${ref}`, r) : '', fs.existsSync(b) ? panel('Antes · 7219339', b) : '', panel(`Después · efd0704 · ${state}`, a)].join('');
    const diff = fs.existsSync(b) ? `<div id="diff" style="position:relative;width:${W}px;margin:12px;background:#000"><img src="${url(b)}" style="width:${W}px;display:block"><img src="${url(a)}" style="width:${W}px;display:block;position:absolute;left:0;top:0;mix-blend-mode:difference"></div>` : '';
    await page.setContent(`<html><body style="margin:0;background:#777;font:13px system-ui"><div id="sbs" style="display:inline-flex;gap:12px;padding:12px;align-items:flex-start">${panels}</div>${diff}</body></html>`);
    await page.waitForTimeout(150);
    await page.locator('#sbs').screenshot({ path: path.join(out, `${state}--lado-a-lado.jpg`), type: 'jpeg', quality: 70 });
    if (diff) await page.locator('#diff').screenshot({ path: path.join(out, `${state}--diferencia.jpg`), type: 'jpeg', quality: 70 });
    console.log('composed', state);
  }
  await browser.close();
})();
