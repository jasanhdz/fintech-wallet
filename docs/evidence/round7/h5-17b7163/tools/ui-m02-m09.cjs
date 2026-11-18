// Items 1 and 6: M02 incompatible/valid pairs, and the pending notice on Home after "Ir al inicio" from M09 (double-attempt probe).
const { chromium, L, ok, call, mkUser, balances, dbRows, dbLedger, newPage, login, origin, choose, fill, toReview, box, flush } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch();
  // ---- 1a. M02 pairs
  { const u = await mkUser(); const p = await newPage(browser, { h: 929 }); await login(p, u.email);
    // valid: Principal -> Ahorro
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo');
    L('M02 Principal->Ahorro: Continuar', await p.getByRole('button', { name: 'Continuar con transferencia' }).count(), 'Elegir otro destinatario', await p.getByRole('button', { name: 'Elegir otro destinatario' }).count());
    await p.shot('M02-par-valido');
    // Ahorro -> Ahorro (incompatible)
    await origin(p, /^Ahorro ••/);
    const cont = await p.getByRole('button', { name: 'Continuar con transferencia' }).count(); const other = await p.getByRole('button', { name: 'Elegir otro destinatario' }).count();
    L('M02 Ahorro->Ahorro: Continuar', cont, 'Elegir otro destinatario', other); ok(cont === 0 && other === 1, 'incompatible pair offers only "Elegir otro destinatario"');
    L('  warning text present:', (await p.text()).includes('Es la misma cuenta de origen seleccionada.'));
    await p.shot('M02-incompatible');
    p.reqs.length = 0;
    await p.getByRole('button', { name: 'Elegir otro destinatario' }).click(); await p.waitForTimeout(1500);
    const t = await p.text(); L('  after tap -> picker?', /Elegir beneficiario/.test(t), '| review reached?', /Revisar transferencia|Confirmar transferencia/.test(t), '| POST /transfers', p.reqs.filter((r) => r.startsWith('POST /transfers')).length);
    await p.shot('M05-desde-incompatible');
    // from the picker: Ahorro->Principal beneficiary is valid
    await p.getByLabel(/^Seleccionar Cuenta principal demo/).first().click(); await p.waitForTimeout(800);
    L('M02 Ahorro->Principal: Continuar', await p.getByRole('button', { name: 'Continuar con transferencia' }).count(), 'Elegir otro destinatario', await p.getByRole('button', { name: 'Elegir otro destinatario' }).count());
    await p.shot('M02-ahorro-a-principal');
    // switching origin to Principal while destination = Principal (own) -> incompatible again
    await origin(p, /^Cuenta principal/);
    L('M02 Principal->Principal: Continuar', await p.getByRole('button', { name: 'Continuar con transferencia' }).count(), 'Elegir otro destinatario', await p.getByRole('button', { name: 'Elegir otro destinatario' }).count());
    L('  errs', p.errs.length);
    await p.context().close(); }

  // ---- 1b/6. pending notice + second attempt probe (sub-threshold, applied-but-response-lost)
  { const u = await mkUser(); const p = await newPage(browser, { h: 918 }); await login(p, u.email);
    const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Prueba doble', '4401');
    const keys = []; let n = 0;
    await p.route('**/v1/transfers', async (route) => { if (route.request().method() !== 'POST') return route.continue(); keys.push(route.request().headers()['idempotency-key']); n += 1; const resp = await route.fetch(); if (n === 1) { await route.abort('connectionreset'); return; } await route.fulfill({ response: resp }); });
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t9 = await p.shot('M09-verificando');
    L('M09 text has "Estamos verificando":', /Estamos verificando/.test(t9), '| "Enviando transferencia":', /Enviando transferencia/.test(t9), '| claims intact/debited:', /dinero está intacto|se debitó|fue debitado|no se cobró/i.test(t9));
    L('DB after lost response:', dbRows(u.email).replace(/\n/g, ' | '), '| ledger', dbLedger(u.email));
    const ssBefore = await p.evaluate(() => (()=>{const k=Object.keys(localStorage).find((x)=>x.startsWith('ss:wallet.transfer-recovery'));return k?localStorage.getItem(k):null})() ? 'present' : 'absent');
    L('recovery record before leaving:', ssBefore);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    await p.setViewportSize({ width: 390, height: 929 });
    const th = await p.shot('M02-aviso-pendiente');
    const cont = await p.getByRole('button', { name: 'Continuar con transferencia' }).count();
    L('HOME with pending notice: notice shown', /Transferencia en verificación/.test(th), '| "Continuar con transferencia" present:', cont, '| "Verificar estado" present:', await p.getByRole('button', { name: /Verificar estado de la transferencia/ }).count(), '| claims intact:', /dinero está intacto|se debitó/i.test(th));
    // Probe: use the visible "Continuar con transferencia" to create a SECOND attempt
    if (cont) {
      await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
      const dt = await p.text(); L('  details form after Continuar: amount field value =', JSON.stringify(await p.getByLabel('Monto a transferir', { exact: true }).inputValue()), '| warning about the pending attempt on this screen:', /verificaci[oó]n|pendiente|no la env/i.test(dt));
      await fill(p, '300.25', 'Prueba doble', '4401');
      await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
      const rv = await p.text(); L('  review shows warning about pending attempt:', /verificaci[oó]n|pendiente de verificar|no la env/i.test(rv));
      await p.shot('M07-segundo-intento-con-pendiente');
      await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
      L('  second create sent: POST /transfers keys =', JSON.stringify(keys.map((k) => k.slice(0, 8))), 'distinct =', new Set(keys).size);
      const rec = await p.evaluate(() => (()=>{const k=Object.keys(localStorage).find((x)=>x.startsWith('ss:wallet.transfer-recovery'));return k?localStorage.getItem(k):null})()); L('  recovery record after second attempt:', rec ? 'present (' + (JSON.parse(rec).key === keys[0] ? 'FIRST key' : 'SECOND key') + ')' : 'absent');
      await p.shot('M10-tras-segundo-intento');
    }
    const b1 = await balances(u);
    L('RESULT balances principal', b0.checking, '->', b1.checking, '(debit', b0.checking - b1.checking, ')', 'savings', b0.savings, '->', b1.savings);
    L('DB transfers:', dbRows(u.email).replace(/\n/g, ' | '), '| ledger', dbLedger(u.email));
    await p.context().close(); }
  // ---- 1b'. Same but via the notice action ("Verificar estado") = same key
  { const u = await mkUser(); const p = await newPage(browser, { h: 918 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Verifica', '4402');
    const keys = []; let n = 0;
    await p.route('**/v1/transfers', async (route) => { if (route.request().method() !== 'POST') return route.continue(); keys.push(route.request().headers()['idempotency-key']); n += 1; const resp = await route.fetch(); if (n === 1) { await route.abort('connectionreset'); return; } await route.fulfill({ response: resp }); });
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1200);
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500); L('  after Verificar: POST count', keys.length, '| still in verification', /Transferencia en verificación/.test(await p.text())); await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(1200); await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(3500); // H5: Verificar only reads; the same-key resend reconciles it
    const t = await p.shot('M09-resuelto-desde-aviso');
    L('VERIFY via notice: keys', keys.length, 'distinct', new Set(keys).size, '| shows receipt:', /Transferencia completada/.test(t), '| DB:', dbRows(u.email).replace(/\n/g, ' | '), '| ledger', dbLedger(u.email));
    // reload during recovery: new page (same localStorage) -> store state
    await p.context().close(); }
  await browser.close(); flush('logs/ui-m02-m09.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
