// Inter: which faces are fetched and actually rendered (CDP platform fonts), mixed weights, fallback on failure/hang.
const { chromium, L, newPage, login, fs, SP, log, APP } = require('./lib.cjs');
const platform = async (page, selectors) => {
  const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 }); const out = {};
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '*' });
  for (const id of nodeIds) {
    try { const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id });
      for (const f of fonts) { const k = `${f.familyName}|custom=${f.isCustomFont}`; out[k] = (out[k] || 0) + f.glyphCount; } } catch {}
  }
  return out;
};
const combos = (page) => page.evaluate(() => { const m = {}; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) { if (!n.textContent.trim()) continue; const cs = getComputedStyle(n.parentElement); const k = `${cs.fontFamily.split(',')[0].replace(/"/g, '')}|w=${cs.fontWeight}`; m[k] = (m[k] || 0) + 1; } return m; });
(async () => {
  const browser = await chromium.launch();
  // 1. normal
  let page = await newPage(browser, { h: 844 }); const ttf = [];
  page.on('response', (r) => { if (/\.ttf/.test(r.url())) ttf.push(`${r.status()} ${r.url().split('/').pop()}`); });
  await page.goto(APP); await page.waitForTimeout(2500);
  L('NORMAL ttf responses:', [...new Set(ttf)].join(' ; '));
  L('NORMAL document.fonts loaded:', JSON.stringify(await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight))));
  L('NORMAL (family|weight) of text nodes on login:', JSON.stringify(await combos(page)));
  L('NORMAL platform fonts login:', JSON.stringify(await platform(page, '*')));
  await page.shot('inter-login-normal');
  await page.context().close();
  // 2. logged-in screens: weights mixing
  const seed = JSON.parse(fs.readFileSync(`${SP}/seed-r6b.json`, 'utf8'));
  page = await newPage(browser, { h: 884 }); await login(page, seed.ana.email);
  L('NORMAL home combos:', JSON.stringify(await combos(page)));
  L('NORMAL home platform fonts:', JSON.stringify(await platform(page)));
  await page.getByRole('tab', { name: /Movimientos/ }).click(); await page.waitForTimeout(1200);
  L('NORMAL movimientos combos:', JSON.stringify(await combos(page)));
  await page.context().close();
  // 3. abort
  for (const mode of ['abort', 'hang']) {
    page = await newPage(browser, { h: 844 });
    await page.route(/\.ttf/, (route) => (mode === 'abort' ? route.abort('failed') : new Promise(() => {})));
    const t0 = Date.now(); await page.goto(APP);
    let ready = null; for (let i = 0; i < 40; i++) { if (await page.getByLabel('Correo electrónico').count()) { ready = Date.now() - t0; break; } await page.waitForTimeout(500); }
    await page.waitForTimeout(500);
    L(`FALLBACK ${mode}: login visible after ${ready} ms (null = never)`);
    L(`FALLBACK ${mode}: combos`, JSON.stringify(await combos(page)));
    L(`FALLBACK ${mode}: platform fonts`, JSON.stringify(await platform(page)));
    await page.shot(`inter-fallback-${mode}`);
    if (ready) { await login(page, seed.ana.email); L(`FALLBACK ${mode}: logged in, home shows:`, (await page.text()).split('\n').filter(Boolean).slice(0, 4).join(' | ')); }
    await page.context().close();
  }
  await browser.close(); fs.writeFileSync(`${SP}/s8.txt`, log.join('\n'));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
