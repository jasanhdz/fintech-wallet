// Pass 9 · item 6b: states to compare with design/mobile (M02 baseline, M02 with pending notice (no direct Stitch reference), M07 threshold, M08).
const { chromium, L, mkUser, newPage, login, origin, choose, toReview, flush } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch();
  if (!process.env.ONLY3) { const u = await mkUser(); const p = await newPage(browser, { h: 929 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await p.shot('F-M02');
    await toReview(p, '300.25', 'Pago servicio', '131126');
    await p.route('**/v1/transfers', async (r) => { if (r.request().method() === 'POST') { await r.fetch(); await r.abort('connectionreset'); } else await r.continue(); });
    await p.route('**/v1/transfers/*', (r) => r.abort('connectionreset'));
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2500); await p.setViewportSize({ width: 390, height: 929 }); await p.shot('F-M02-aviso');
    await p.context().close(); }
  if (!process.env.ONLY3) { const u = await mkUser(); const p = await newPage(browser, { h: 931 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '6000.00', 'Pago servicio', '131126'); await p.shot('F-M07-umbral');
    await p.setViewportSize({ width: 390, height: 884 }); await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500); await p.shot('F-M08-vigente');
    const input = p.getByLabel('Código de confirmación', { exact: true }); await input.fill(''); await p.keyboard.insertText('000000'); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(1500); await p.shot('F-M08-incorrecto');
    await p.context().close(); }
  { const u = await mkUser(); const p = await newPage(browser, { h: 929 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '6000.00', 'Pago servicio', '131126');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
    await p.route('**/v1/transfers/**', (r) => r.abort('connectionreset'));
    await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(2500); await p.setViewportSize({ width: 390, height: 929 }); await p.shot('F-M02-pendiente-codigo');
    await p.context().close(); }
  await browser.close(); flush(process.env.ONLY3 ? 'logs/ui-fid9-part3.txt' : 'logs/ui-fid9.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
