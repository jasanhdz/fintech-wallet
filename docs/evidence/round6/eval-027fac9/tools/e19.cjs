// F-19 independent: for EVERY element with aria-label and visible text on each screen, label must contain the visible text (WCAG 2.5.3).
const { chromium, L, newPage, login, toDetails, fill, seedUsers, fs, SP, log } = require('./lib.cjs');
let bad = 0, n = 0; const norm = (v) => v.toLocaleLowerCase('es-MX').replace(/\s+/g, ' ').trim();
async function scan(page, screen) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')].filter((e) => e.offsetParent !== null && e.tagName !== 'INPUT').map((e) => {
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const texts = []; let x; while ((x = w.nextNode())) { const t = x.textContent.replace(/[-]/g, '').trim(); if (t) texts.push(t); }
    return { role: e.getAttribute('role'), label: e.getAttribute('aria-label'), texts }; }));
  for (const r of rows) { if (!r.texts.length) { L(`ICON ${screen}: [${r.role}] "${r.label}" (icon only)`); continue; }
    n++; const lab = norm(r.label); const first = r.texts.find((t) => /\p{L}{3,}/u.test(t)) || r.texts[0];
    const okFirst = lab.includes(norm(first)); const missing = r.texts.filter((t) => /\p{L}{3,}/u.test(t) && !lab.includes(norm(t)));
    if (!okFirst) bad++; L(`${okFirst ? 'OK  ' : 'DIFF'} ${screen}: [${r.role}] label="${r.label.slice(0, 80)}" | first visible="${first.slice(0, 60)}" | other text nodes not in label: ${JSON.stringify(missing.slice(0, 5))}`); } }
(async () => {
  const s = await seedUsers('e19' + Date.now().toString().slice(-5)); const browser = await chromium.launch();
  let page = await newPage(browser); await page.goto('http://localhost:8711/'); await page.waitForTimeout(1500); await scan(page, 'M01');
  await login(page, s.ana.email); await scan(page, 'M02');
  await page.getByRole('tab', { name: /Movimientos/ }).click(); await page.waitForTimeout(1200); await scan(page, 'M03');
  await page.getByLabel(/cambiar cuenta$/).first().click(); await page.waitForTimeout(300); await scan(page, 'M03 selector');
  await page.getByRole('button', { name: /^Cuenta principal/ }).first().click().catch(() => {}); await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Abono|^Cargo|Comida|Abono honorarios/ }).first().click().catch(() => {}); await page.waitForTimeout(1200); await scan(page, 'M04');
  await page.context().close();
  page = await newPage(browser); await login(page, s.ana.email);
  await page.getByRole('button', { name: /Cuenta principal/ }).first().click(); await page.waitForTimeout(300);
  await page.getByLabel('Elegir beneficiario').click(); await page.waitForTimeout(1200); await scan(page, 'M05');
  await page.getByLabel(/^Seleccionar Carlos/).first().click(); await page.waitForTimeout(400); await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1200); await scan(page, 'M06');
  await page.getByLabel('Cambiar cuenta de origen').click(); await page.waitForTimeout(300); await scan(page, 'M06 selector');
  await fill(page, '6000', 'Comida', '1313'); await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900); await scan(page, 'M07 umbral');
  await page.btn('Continuar a verificación').click(); await page.waitForTimeout(2500); await scan(page, 'M08');
  await page.btn('Cancelar y volver a revisar').click(); await page.waitForTimeout(1000);
  // normal path to M10
  await page.btn('Modificar datos').click(); await page.waitForTimeout(800); await fill(page, '850', 'Comida', '1313'); await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900); await scan(page, 'M07');
  await page.btn('Confirmar transferencia').click(); await page.waitForTimeout(2500); await scan(page, 'M10');
  await page.context().close();
  L(`E19 checked ${n} controls with visible text, ${bad} DIFF`); await browser.close(); fs.writeFileSync(`${SP}/e19.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error(e); process.exit(1); });
