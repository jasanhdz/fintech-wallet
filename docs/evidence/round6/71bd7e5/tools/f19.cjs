// F-19: on the RN-web render, every button/radio/tab whose accessible name (aria-label) is set must contain its first
// visible text with a word (WCAG 2.5.3 label in name, what voice control matches). Also lists the M06 field names.
// Usage: node f19.cjs <outDir>
const { chromium, fs, L, log, seed, newPage, login, toDetails, fill } = require('./g4lib.cjs');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
let failures = 0, checked = 0;
async function scan(page, screen) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[role=button],[role=radio],[role=tab],button')].filter((e) => e.getAttribute('aria-label') && e.offsetParent !== null).map((e) => {
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const texts = []; let n;
    while ((n = walker.nextNode())) { const t = n.textContent.trim(); if (t) texts.push(t); }
    return { label: e.getAttribute('aria-label'), shown: texts.find((t) => /\p{L}{3,}/u.test(t)) || '' };
  }));
  const norm = (v) => v.toLocaleLowerCase('es-MX').replace(/\s+/g, ' ').trim();
  for (const row of rows) {
    if (!row.shown) continue; checked += 1;
    const ok = norm(row.label).includes(norm(row.shown));
    if (!ok) failures += 1;
    L(`${ok ? 'OK  ' : 'FAIL'} ${screen}: name "${row.label}" | visible "${row.shown}"`);
  }
}
(async () => {
  const s = await seed('f19' + Date.now().toString().slice(-5));
  const browser = await chromium.launch();
  const page = await newPage(browser); await login(page, s.anaEmail);
  await scan(page, 'M02');
  await page.getByRole('tab', { name: /Movimientos/ }).click(); await page.waitForTimeout(1200);
  await page.getByLabel(/cambiar cuenta$/).first().click(); await page.waitForTimeout(300);
  await scan(page, 'M03 selector abierto');
  await page.getByRole('tab', { name: /Inicio/ }).click(); await page.waitForTimeout(800);
  await toDetails(page, 'Carlos');
  await page.getByLabel('Cambiar cuenta de origen').click(); await page.waitForTimeout(300);
  await scan(page, 'M06 selector abierto');
  L('M06 field names:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.getAttribute('aria-label')))));
  await fill(page, '6000', 'Comida', '1313');
  await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900);
  await page.btn('Continuar a verificación').click(); await page.waitForTimeout(2500);
  await scan(page, 'M08');
  const voice = page.getByRole('button', { name: 'Solicitar nuevo código de demostración', exact: true });
  L(`M08 a voice command "Solicitar nuevo código de demostración" finds ${await voice.count()} control(s)`);
  await page.btn('Cancelar y volver a revisar').click(); await page.waitForTimeout(1000);
  L(`F19 checked ${checked} named controls, ${failures} without their visible text`);
  await browser.close(); fs.writeFileSync(`${OUT}/f19-log.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
