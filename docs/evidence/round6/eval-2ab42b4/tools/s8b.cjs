const { chromium, L, newPage, login, fs, SP, log, APP } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch(); const seed = JSON.parse(fs.readFileSync(`${SP}/seed-r6b.json`, 'utf8'));
  let page = await newPage(browser, { h: 884 }); await login(page, seed.ana.email);
  L('home document.fonts loaded:', JSON.stringify(await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family))));
  const cdp = await page.context().newCDPSession(page); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '*' }); const r = {};
  for (const id of nodeIds) { try { const cs = await cdp.send('CSS.getComputedStyleForNode', { nodeId: id }); const ff = cs.computedStyle.find((p) => p.name === 'font-family').value; if (!/Inter_700Bold/.test(ff)) continue; const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: id }); for (const f of fonts) r[f.familyName + '|' + f.postScriptName] = (r[f.familyName + '|' + f.postScriptName] || 0) + f.glyphCount; } catch {} }
  L('nodes styled Inter_700Bold render with platform font:', JSON.stringify(r));
  await page.context().close();
  // hang: usable after timeout, no screenshot (Playwright waits for document.fonts)
  page = await newPage(browser, { h: 844 }); await page.route(/\.ttf/, () => new Promise(() => {}));
  const t0 = Date.now(); await page.goto(APP, { waitUntil: 'commit' }); await page.waitForTimeout(1500);
  L('hang t=1.5s body text:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 80)));
  await page.getByLabel('Correo electrónico').waitFor({ timeout: 15000 }); L('hang: login rendered after', Date.now() - t0, 'ms');
  await page.getByLabel('Correo electrónico').fill(seed.ana.email); await page.getByLabel('Contraseña', { exact: true }).fill(process.env.EV_TEST_PASSWORD);
  await page.btn('Iniciar sesión').click(); await page.waitForTimeout(3000);
  L('hang: after login:', (await page.evaluate(() => document.body.innerText)).split('\n').filter(Boolean).slice(0, 4).join(' | '));
  await browser.close(); console.log(log.join('\n'));
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
