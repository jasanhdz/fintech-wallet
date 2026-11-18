// F-15 independent: M07 actions in viewport at 844/884 and reachable by scroll at 763 (844-47-34), three variants.
const { chromium, L, newPage, login, toDetails, fill, seedUsers, fs, SP, log } = require('./lib.cjs');
const blur = (p) => p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
const box = async (page, name) => { const b = await page.getByRole('button', { name }).first().boundingBox().catch(() => null); return b ? [Math.round(b.y), Math.round(b.y + b.height)] : null; };
(async () => {
  const s = await seedUsers('e15' + Date.now().toString().slice(-5)); const browser = await chromium.launch(); let fail = 0;
  for (const h of [844, 884, 763]) for (const [who, amt, prim, tag] of [['Carlos', '850', /Confirmar transferencia/, 'normal'], ['Cuenta de ahorro demo', '1500', /Confirmar transferencia/, 'propias'], ['Carlos', '6000', /Continuar a verificación/, 'umbral']]) {
    const page = await newPage(browser, { h }); await login(page, s.ana.email); await toDetails(page, who); await fill(page, amt, 'Comida', '1313');
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(1000); await blur(page);
    let m = await box(page, prim), d = await box(page, 'Modificar datos'); let line = `E15 h=${h} ${tag}: primary y=${m} modificar y=${d}`;
    if (h === 763) { await page.evaluate(() => document.querySelectorAll('div').forEach((x) => { if (x.scrollHeight > x.clientHeight + 1 && getComputedStyle(x).overflowY !== 'visible') x.scrollTop = x.scrollHeight; })); await page.waitForTimeout(300);
      // also real wheel scroll
      m = await box(page, prim); d = await box(page, 'Modificar datos'); const ok = m && d && d[1] <= h && m[0] >= 0; line += ` | after scroll primary=${m} modificar=${d} reachable=${ok}`; if (!ok) fail++; }
    else if (!(m && d && d[1] <= h)) fail++;
    L(line); await page.screenshot({ path: `${SP}/shots/E15-${tag}-${h}.png` }); await page.context().close(); }
  L('E15 failures', fail); await browser.close(); fs.writeFileSync(`${SP}/e15.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
