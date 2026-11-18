// F-17 independent: time until login usable, normal / ttf aborted / ttf hanging; fonts really rendered (CDP).
const { chromium, L, newPage, fs, SP, log, APP } = require('./lib.cjs');
const platform = async (page) => { const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); const { root } = await cdp.send('DOM.getDocument', { depth: -1 }); const out = {}; const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '*' });
  for (const id of nodeIds) { try { const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id }); for (const f of fonts) out[f.familyName + '|custom=' + f.isCustomFont] = (out[f.familyName + '|custom=' + f.isCustomFont] || 0) + f.glyphCount; } catch {} } return out; };
(async () => { const browser = await chromium.launch();
  for (const mode of ['normal', 'abort', 'hang']) for (let r = 1; r <= 4; r++) { const page = await newPage(browser); if (mode !== 'normal') await page.route(/\.ttf/, (rt) => (mode === 'abort' ? rt.abort('failed') : new Promise(() => {})));
    const t0 = Date.now(); await page.goto(APP); await page.getByLabel('Correo electrónico').waitFor({ timeout: 20000 }); const ready = Date.now() - t0; await page.waitForTimeout(300);
    L(`E17 ${mode} run${r}: login usable ${ready} ms`, r === 1 ? JSON.stringify(await platform(page)) : '');
    if (r === 1) { const cdp = await page.context().newCDPSession(page); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SP}/shots/E17-login-${mode}.png`, Buffer.from(data, 'base64')); }
    if (mode === 'hang' && r === 1) { // blank before? check at 1.5s in a fresh page
    }
    await page.context().close(); }
  // while hung: what does the user see at 1.0 s?
  { const page = await newPage(browser); await page.route(/\.ttf/, () => new Promise(() => {})); await page.goto(APP); await page.waitForTimeout(1200); const cdp = await page.context().newCDPSession(page); const t = await page.evaluate(() => document.body.innerText); L('E17 hang @1.2s visible text:', JSON.stringify(t.slice(0, 80))); const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SP}/shots/E17-hang-1s.png`, Buffer.from(data, 'base64')); await page.context().close(); }
  await browser.close(); fs.writeFileSync(`${SP}/e17.txt`, log.join('\n') + '\n'); })().catch((e) => { console.error(e); process.exit(1); });
