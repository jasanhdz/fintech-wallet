// Item 11: capture the states equivalent to the Stitch references at the same viewport (390 x (ref height * 390 / ref width)), 2x, plus keyboard approximation.
// API#1 (:3897, threshold 500000) for most; M08 expirado through API#3 (:3899, 8 s). Keyboard = viewport shortened by 336 px (approximation, not iOS).
const { chromium, L, call, mkUser, xfer, balances, newPage, login, origin, choose, fill, toReview, flush, psql } = require('./lib.cjs');
const rewrite = (p, port) => p.route('http://127.0.0.1:3897/**', (r) => r.continue({ url: r.request().url().replace(':3897', ':' + port) }));
const vis = async (p, name) => { const b = await p.getByRole('button', { name }).first().boundingBox().catch(() => null); const vh = p.viewportSize().height; return b ? `${Math.round(b.y)}-${Math.round(b.y + b.height)} of ${vh}${b.y + b.height <= vh ? ' (inside)' : ' (outside)'}` : 'n/a'; };
(async () => {
  const browser = await chromium.launch();
  { const u = await mkUser(); const p = await newPage(browser, { h: 929 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await p.shot('F-M02');
    await p.setViewportSize({ width: 390, height: 884 }); await p.btn('Cambiar').click(); await p.waitForTimeout(1200); await p.shot('F-M05');
    await p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().click(); await p.waitForTimeout(500);
    await p.setViewportSize({ width: 390, height: 899 }); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000);
    await fill(p, '850.00', 'Pago servicio', '131126'); await p.shot('F-M06');
    await p.getByLabel('Monto a transferir', { exact: true }).focus(); await p.setViewportSize({ width: 390, height: 899 - 336 }); await p.waitForTimeout(500);
    L('KEYBOARD approx M06 (viewport 563): Continuar', await vis(p, /^Continuar$/)); await p.shot('F-M06-teclado', { keepFocus: true });
    await p.setViewportSize({ width: 390, height: 884 }); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1000); await p.shot('F-M07');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000); await p.setViewportSize({ width: 390, height: 1149 }); await p.shot('F-M10');
    await p.context().close(); }
  { const u = await mkUser(); const p = await newPage(browser, { h: 931 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '6000.00', 'Pago servicio', '131126'); await p.shot('F-M07-umbral');
    await p.setViewportSize({ width: 390, height: 884 }); await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500); await p.shot('F-M08-vigente');
    const input = p.getByLabel('Código de confirmación', { exact: true }); await input.click(); await p.keyboard.insertText('12'); await p.shot('F-M08-incompleto', { keepFocus: true });
    await p.setViewportSize({ width: 390, height: 884 - 336 }); await p.waitForTimeout(500); L('KEYBOARD approx M08 (viewport 548): Autorizar', await vis(p, 'Autorizar transferencia'), '| Cancelar', await vis(p, 'Cancelar y volver a revisar')); await p.shot('F-M08-teclado', { keepFocus: true });
    await p.setViewportSize({ width: 390, height: 884 }); await input.fill(''); await p.keyboard.insertText('000000'); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(1500); await p.shot('F-M08-incorrecto');
    await p.context().close(); }
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p, 3899); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Pago servicio', '131126');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(10500); await p.shot('F-M08-expirado'); await p.context().close(); }
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Pago servicio', '131126');
    await p.route('**/v1/transfers', async (r) => { if (r.request().method() === 'POST') { await new Promise((x) => setTimeout(x, 4000)); } await r.continue(); });
    await p.setViewportSize({ width: 390, height: 918 }); await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(800); await p.shot('F-M09-enviando');
    await p.waitForTimeout(4500); await p.context().close(); }
  { const u = await mkUser(); const p = await newPage(browser, { h: 918 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Pago servicio', '131126');
    await p.route('**/v1/transfers', async (r) => { if (r.request().method() === 'POST') { await r.fetch(); await r.abort('connectionreset'); } else await r.continue(); });
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await p.shot('F-M09-verificando');
    await p.setViewportSize({ width: 390, height: 884 });
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.shot('F-M12-cortina');
    await p.context().close(); }
  { const u = await mkUser();
    const p = await newPage(browser, { h: 884 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '4000.00', 'Pago servicio', '131126');
    await xfer(u, u.pr, u.own, '499999'); await xfer(u, u.pr, u.own, '499999'); await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await p.shot('F-M11-saldo-insuficiente'); await p.context().close(); }
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await login(p, u.email);
    await p.route('**/v1/auth/me', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await p.route('**/v1/auth/refresh', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await p.evaluate(() => { const f = (s) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); }; f('hidden'); setTimeout(() => f('visible'), 300); }); await p.waitForTimeout(3000); await p.shot('F-M12-sesion-vencida'); await p.context().close(); }
  await browser.close(); flush('logs/ui-fid.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
