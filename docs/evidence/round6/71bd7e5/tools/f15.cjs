// F-15: M07 actions (primary + "Modificar datos") inside the viewport at 390x844 and 390x884 for the normal, own-account
// and threshold variants; at 390x763 (844 minus an iPhone 14 safe area of 47 + 34) the scroll must still reach both.
// Usage: node f15.cjs <outDir>
const { chromium, fs, L, log, seed, newPage, login, toDetails, fill, blur, box } = require('./g4lib.cjs');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const s = await seed('f15' + Date.now().toString().slice(-5));
  const browser = await chromium.launch();
  let fail = 0;
  for (const h of [844, 884, 763]) for (const [who, amount, primary, tag] of [['Carlos', '850', /Confirmar transferencia/, 'normal'], ['Cuenta de ahorro demo', '1500', /Confirmar transferencia/, 'propias'], ['Carlos', '6000', /Continuar a verificación/, 'umbral']]) {
    const page = await newPage(browser, { h }); await login(page, s.anaEmail); await toDetails(page, who); await fill(page, amount, 'Comida', '1313');
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(1000); await blur(page);
    let main = await box(page, primary), mod = await box(page, 'Modificar datos');
    const inside = Boolean(main && mod && main.bottom <= h && mod.bottom <= h);
    let line = `F15 ${h} ${tag}: primary ${JSON.stringify(main)} modificar ${JSON.stringify(mod)} | both inside without scroll: ${inside}`;
    if (h === 763) {
      // Scroll every scroll container to its end (what a user does on a phone with safe areas) and re-measure.
      await page.evaluate(() => document.querySelectorAll('div').forEach((d) => { if (d.scrollHeight > d.clientHeight + 1 && getComputedStyle(d).overflowY !== 'visible') d.scrollTop = d.scrollHeight; }));
      await page.waitForTimeout(300);
      main = await box(page, primary); mod = await box(page, 'Modificar datos');
      const reach = Boolean(main && mod && mod.bottom <= h && main.top >= 0);
      line += ` | after scrolling to the end: primary ${JSON.stringify(main)} modificar ${JSON.stringify(mod)} reachable: ${reach}`;
      if (!reach) fail += 1;
    } else if (!inside) fail += 1;
    L(line);
    await page.screenshot({ path: `${OUT}/F15-M07-${tag}-${h}.png` });
    await page.context().close();
  }
  L(`F15 failures: ${fail}`);
  await browser.close(); fs.writeFileSync(`${OUT}/f15-log.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
