// Item 2: text scale 100/130/200 % (CSS approximation of fontScale, NOT native Dynamic Type) with LONG data on M02-M11 + M12.
// Long data: user name 63 chars, beneficiary 112, alias 79, concept 39. Reports scrollWidth, offscreen elements and min font per shot.
const { chromium, L, call, mkUser, mkRecipient, registerUser, xfer, balances, newPage, login, origin, choose, fill, toReview, flush, psql } = require('./lib.cjs');
const LONG_USER = 'Ana María de los Ángeles López-Hernández de la Cruz y Villaseñor';
const LONG_BEN = 'Constructora y Servicios Profesionales del Centro de México Sociedad Anónima de Capital Variable Sucursal Norte';
const LONG_ALIAS = 'Proveedor principal de materiales y servicios generales de mantenimiento del inmueble central';
const LONG_CONCEPT = 'Pago de servicios profesionales de nov';
const wordy = 'Ana'.padEnd(0);
(async () => {
  const browser = await chromium.launch();
  for (const scale of [1, 1.3, 2]) {
    const tag = scale === 1 ? '' : `-x${scale}`;
    L(`===== scale ${scale} =====`);
    const u = await mkUser(LONG_USER, 'lg');
    const c = await registerUser('Carlos Ruiz', 'rc'); const cacc = (await call(c.token, '/accounts')).b.items.find((a) => a.kind === 'checking');
    u.long = (await call(u.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: LONG_BEN.slice(0, 112), alias: LONG_ALIAS.slice(0, 79), clabe: cacc.clabe }) })).b;
    // history so M02/M03/M04 carry long counterparty data
    await xfer(u, u.pr, u.long, '85000', { concept: LONG_CONCEPT, reference: '1234567' });
    // --- flow A: normal (under threshold) M02 -> M05 -> M06 -> M07 -> M10 -> M03 -> M04
    { const p = await newPage(browser, { h: 929, scale }); await login(p, u.email);
      await p.shot(`M02-inicio${tag}`);
      await origin(p, /^Cuenta principal/);
      await p.getByLabel(/Elegir beneficiario/i).first().click(); await p.waitForTimeout(1200); await p.shot(`M05-picker${tag}`);
      await p.getByLabel(new RegExp('^Seleccionar Constructora')).first().click(); await p.waitForTimeout(500); await p.shot(`M02-destino-largo${tag}`);
      await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000);
      await fill(p, '850.00', LONG_CONCEPT, '1234567'); await p.shot(`M06-datos${tag}`);
      await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1000); await p.shot(`M07-revision${tag}`);
      await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000); await p.shot(`M10-comprobante${tag}`);
      await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(2000); await p.shot(`M03-movimientos${tag}`);
      await p.getByRole('button', { name: /A Constructora/ }).first().click().catch(() => L('  M04: movement button not found')); await p.waitForTimeout(1500); await p.shot(`M04-detalle${tag}`);
      await p.context().close(); }
    // --- flow B: threshold M07 -> M08 states
    { const p = await newPage(browser, { h: 931, scale }); await login(p, u.email);
      await origin(p, /^Cuenta principal/); await choose(p, 'Constructora'); await toReview(p, '6000.00', LONG_CONCEPT, '1234567'); await p.shot(`M07-umbral${tag}`);
      await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500); await p.shot(`M08-codigo${tag}`);
      const input = p.getByLabel('Código de confirmación', { exact: true }); await input.fill('000000'); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(1500); await p.shot(`M08-incorrecto${tag}`);
      for (let i = 0; i < 4; i += 1) { await input.fill('000000').catch(() => {}); await p.btn('Autorizar transferencia').click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(1200); }
      await p.shot(`M08-intentos-agotados${tag}`);
      await p.context().close(); }
    // --- flow C: M09 verifying + pending notice on Home
    { const p = await newPage(browser, { h: 918, scale }); await login(p, u.email);
      await origin(p, /^Cuenta principal/); await choose(p, 'Constructora'); await toReview(p, '300.25', LONG_CONCEPT, '1234567');
      await p.route('**/v1/transfers', async (r) => { if (r.request().method() === 'POST') { await r.fetch(); await r.abort('connectionreset'); } else await r.continue(); });
      await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await p.shot(`M09-verificando${tag}`);
      await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1200); await p.shot(`M02-aviso-pendiente${tag}`);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.shot(`M12-cortina${tag}`);
      await p.context().close(); }
    // --- flow D: M11 insufficient balance with long data
    { const v = await mkUser(LONG_USER, 'lm'); const c2 = await registerUser('Carlos Ruiz', 'rd'); const cacc2 = (await call(c2.token, '/accounts')).b.items.find((a) => a.kind === 'checking');
      v.long = (await call(v.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: LONG_BEN.slice(0, 112), alias: LONG_ALIAS.slice(0, 79), clabe: cacc2.clabe }) })).b;
      const p = await newPage(browser, { h: 884, scale }); await login(p, v.email);
      await origin(p, /^Cuenta principal/); await choose(p, 'Constructora'); await toReview(p, '4000.00', LONG_CONCEPT, '1234567');
      await xfer(v, v.pr, v.own, '499999'); await xfer(v, v.pr, v.own, '499999'); // balance spent elsewhere meanwhile
      await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); await p.shot(`M11-saldo-insuficiente${tag}`);
      await p.context().close(); }
  }
  await browser.close(); flush('logs/ui-overflow.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
