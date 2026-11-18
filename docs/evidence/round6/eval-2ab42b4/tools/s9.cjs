// F-13: M07 actions visible at 390x844 and 390x884 (normal, own-accounts, threshold variants).
const { chromium, L, newPage, login, toDetails, fill, seedUsers, fs, SP, log } = require('./lib.cjs');
const bx = async (page, name) => { const b = await page.getByRole('button', { name }).first().boundingBox(); return b ? { top: Math.round(b.y), bottom: Math.round(b.y + b.height) } : null; };
(async () => {
  const u = await seedUsers('f13' + Date.now().toString().slice(-4)); const browser = await chromium.launch();
  for (const h of [844, 884]) for (const v of [['Carlos', '850', /Confirmar transferencia/, 'normal'], ['Cuenta de ahorro demo', '1500', /Confirmar transferencia/, 'propias'], ['Carlos', '6000', /Continuar a verificación/, 'umbral']]) {
    const page = await newPage(browser, { h }); await login(page, u.ana.email); await toDetails(page, v[0]); await fill(page, v[1], 'Comida', '1313' + h);
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(1000);
    const main = await bx(page, v[2]), mod = await bx(page, 'Modificar datos');
    L(`F13 ${h} ${v[3]}: primary`, JSON.stringify(main), 'Modificar', JSON.stringify(mod), '| all inside viewport:', Boolean(main && mod && main.bottom <= h && mod.bottom <= h));
    await page.shot(`F13-M07-${v[3]}-${h}`); await page.context().close();
  }
  await browser.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
