// F-15: M07 action positions at 390x844 (no safe area), 390x884 and a simulated safe-area viewport (844-47-34=763), three variants, real account names.
const { chromium, L, mkUser, mkRecipient, newPage, login, origin, choose, toReview, box, flush } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch(); const u = await mkUser(); await mkRecipient(u);
  for (const [label, dest, amount, primary] of [['normal (Carlos Ruiz, 850.00)', 'Carlos', '850.00', 'Confirmar transferencia'], ['propias (Ahorro, 850.00)', 'Cuenta de ahorro demo', '850.00', 'Confirmar transferencia'], ['umbral (Ahorro, 6000.00)', 'Cuenta de ahorro demo', '6000.00', 'Continuar a verificación']]) {
    for (const h of [844, 884, 763]) {
      const p = await newPage(browser, { h }); await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, dest); await toReview(p, amount);
      const first = `${await box(p, primary)} / ${await box(p, 'Modificar datos')}`;
      await p.mouse.move(195, 300); await p.mouse.wheel(0, 3000); await p.waitForTimeout(400);
      L(`M07 ${label} @390x${h}: primary / Modificar = ${first} ; after scrolling to the end = ${await box(p, primary)} / ${await box(p, 'Modificar datos')}`);
      if (h === 844 && label.startsWith('umbral')) { await p.mouse.wheel(0, -3000); await p.waitForTimeout(300); await p.shot('M07-umbral-844-real-names'); }
      await p.context().close();
    }
  }
  // M06 with keyboard approximation (viewport shortened by 336 px) and amount focused
  { const p = await newPage(browser, { h: 899 }); await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000);
    await p.getByLabel('Monto a transferir', { exact: true }).fill('850.00'); await p.getByLabel('Concepto de pago', { exact: true }).fill('Teclado'); await p.getByLabel(/Referencia numérica/).first().fill('1');
    await p.getByLabel('Monto a transferir', { exact: true }).focus(); await p.setViewportSize({ width: 390, height: 899 - 336 }); await p.waitForTimeout(500);
    const b = await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).first().boundingBox(); L('M06 keyboard approx (viewport 563, amount focused): Continuar', b ? `${Math.round(b.y)}-${Math.round(b.y + b.height)} (inside: ${b.y + b.height <= 563})` : 'n/a');
    await p.shot('M06-teclado-aprox', { keepFocus: true }); await p.context().close(); }
  await browser.close(); flush('logs/ui-f15.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
