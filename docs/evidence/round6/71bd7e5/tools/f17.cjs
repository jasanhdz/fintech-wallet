// F-17: time until the login is usable when the Inter .ttf requests load normally, fail at once, or hang forever,
// and which font is actually rendered (CDP platform fonts). Usage: node f17.cjs <outDir>
const { chromium, fs, L, log, newPage, APP } = require('./g4lib.cjs');
const OUT = process.argv[2]; const TAG = process.env.G4_TAG || ''; fs.mkdirSync(OUT, { recursive: true });
const platformFonts = async (page) => {
  const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 }); const out = {};
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '*' });
  for (const id of nodeIds) { try { const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id }); for (const f of fonts) out[f.familyName] = (out[f.familyName] || 0) + f.glyphCount; } catch { /* text-less node */ } }
  return out;
};
(async () => {
  const browser = await chromium.launch();
  for (const mode of ['normal', 'abort', 'hang']) {
    for (let run = 1; run <= 3; run += 1) {
      const page = await newPage(browser);
      if (mode !== 'normal') await page.route(/\.ttf/, (route) => (mode === 'abort' ? route.abort('failed') : new Promise(() => {})));
      const t0 = Date.now(); await page.goto(APP);
      await page.getByLabel('Correo electrónico').waitFor({ timeout: 15000 });
      const ready = Date.now() - t0;
      await page.waitForTimeout(300);
      const fonts = run === 1 ? JSON.stringify(await platformFonts(page)) : '';
      L(`F17${TAG} ${mode} run${run}: login usable after ${ready} ms${fonts ? ` | rendered fonts ${fonts}` : ''}`);
      // Playwright's screenshot waits for document.fonts, which never settles while a .ttf hangs: use CDP directly.
      if (run === 1) { const cdp = await page.context().newCDPSession(page); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/F17${TAG}-login-${mode}.png`, Buffer.from(data, 'base64')); }
      await page.context().close();
    }
  }
  await browser.close(); fs.writeFileSync(`${OUT}/f17${TAG}-log.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
