const h = require('./lib.cjs'); const { L } = h;
const CONT = /^Continuar[^a-zA-Z]*$/;
(async () => {
  const run = 'b' + Date.now().toString().slice(-6);
  const u = await h.seedUsers(run);
  const browser = await h.chromium.launch();
  const posts = (p) => p.reqs.filter((r) => r.startsWith('POST /transfers')).length;
  // ---- B: Ahorro origin, own beneficiary blocked at selector
  let p = await h.newPage(browser, { h: 1000 }); await h.login(p, u.ana.email);
  await p.getByRole('button', { name: /^Ahorro/ }).first().click(); await p.waitForTimeout(500);
  await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1500);
  const m05 = await p.shot('B-M05-ahorro');
  const own = p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first();
  L('B selector: own aria-disabled=', await own.getAttribute('aria-disabled'), '| carlos disabled=', await p.getByLabel(/^Seleccionar Carlos/).first().getAttribute('aria-disabled'));
  await own.click({ force: true }).catch(() => {}); await p.waitForTimeout(500);
  L('B after clicking blocked row still on picker:', /Elegir beneficiario/.test(await p.text()), '| explanation:', m05.split('\n').filter((l) => /origen|misma|tu cuenta/i.test(l)).join(' / '));
  // pick Carlos with Ahorro as origin: valid
  await p.getByLabel(/^Seleccionar Carlos/).first().click(); await p.waitForTimeout(500);
  await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
  await h.fill(p, '50', 'Pago', '1001');
  const t1 = await p.shot('B-M06-ahorro-carlos-valid'); L('B valid Ahorro->Carlos: estimate shown=', /Saldo posterior estimado/.test(t1), 'Continuar disabled=', await p.getByRole('button', { name: CONT }).getAttribute('aria-disabled'));
  await p.context().close(); await new Promise((r) => setTimeout(r, 7000));

  // ---- B2/B3: Principal -> own, then change origin to Ahorro
  p = await h.newPage(browser, { h: 1000 }); await h.login(p, u.ana.email);
  await h.toDetails(p, 'Cuenta de ahorro demo'); await h.fill(p, '100', 'Ahorro', '1546');
  const t2 = await p.shot('B-M06-principal-own-valid'); L('B2 Principal->Ahorro valid: estimate shown=', /Saldo posterior estimado/.test(t2), '| disabled=', await p.getByRole('button', { name: CONT }).getAttribute('aria-disabled'));
  await p.getByLabel('Cambiar cuenta de origen').click(); await p.waitForTimeout(500);
  await p.shot('B-M06-selector');
  await p.getByLabel(/^Usar Ahorro/).click(); await p.waitForTimeout(500);
  const t3 = await p.shot('B-M06-ahorro-own-blocked');
  L('B3 Ahorro->own: disabled=', await p.getByRole('button', { name: CONT }).getAttribute('aria-disabled'), '| estimate shown=', /Saldo posterior estimado/.test(t3), '| msg=', /misma cuenta/.test(t3));
  await p.getByRole('button', { name: CONT }).click({ force: true }).catch(() => {}); await p.waitForTimeout(600);
  L('B3 forced click -> still on details:', /Datos de la operación/.test(await p.text()), '| POST /transfers count:', posts(p));
  // change beneficiary link while blocked
  L('B3 "Cambiar beneficiario" present:', await p.getByLabel(/Cambiar beneficiario/).count());
  // back to Principal: valid again
  await p.getByLabel(/^Usar Cuenta principal/).click(); await p.waitForTimeout(400);
  L('B3 back to Principal: disabled=', await p.getByRole('button', { name: CONT }).getAttribute('aria-disabled'));
  // Real Principal->Ahorro through UI: debit/credit exact
  const before = h.bal(u.ana.email);
  await h.fill(p, '300.25', 'Traspaso', '7001');
  await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900);
  await p.shot('B-M07-review-own');
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  const rc = await p.shot('B-M10-receipt-own');
  const after = h.bal(u.ana.email);
  L('B4 balances before:', before, '| after:', after);
  L('B4 ledger:', h.psql(`select string_agg(e.signed_amount_minor::text||'@'||a.name, ',' order by e.signed_amount_minor) from ledger_entries e join ledger_transactions lt on lt.id=e.ledger_transaction_id join transfers t on t.id=lt.reference_id join accounts a on a.id=e.account_id where t.reference='7001' and t.owner_id=(select id from users where email='${u.ana.email}')`));
  const sum=(x)=>[...x.matchAll(/=(\d+)/g)].reduce((a,m)=>a+BigInt(m[1]),0n); L('B4 total before/after:', String(sum(before)), String(sum(after)));
  L('B4 receipt lines:', rc.split('\n').filter((l) => /\$|Para|Cuenta/.test(l)).join(' | '));
  await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(1500);
  const histP = await p.shot('B-hist-principal');
  await p.getByRole('button', { name: /^Ahorro/ }).first().click().catch(() => {}); await p.waitForTimeout(1500);
  const histA = await p.shot('B-hist-ahorro');
  L('B4 history principal:', histP.split('\n').filter((l) => /\$|Traspaso|Ahorro/.test(l)).join(' | '));
  L('B4 history ahorro:', histA.split('\n').filter((l) => /\$|Traspaso|Cuenta principal|De /.test(l)).join(' | '));
  await p.context().close(); await new Promise((r) => setTimeout(r, 7000));

  // ---- C: server 422 same-account (client check bypassed by response rewrite): Modificar resolves reason
  p = await h.newPage(browser, { h: 1000 }); await h.login(p, u.ana.email);
  await h.toDetails(p, 'Cuenta de ahorro demo'); await h.fill(p, '77.70', 'Concepto largo de prueba', '2468');
  await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900);
  await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') await route.fulfill({ status: 422, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Unprocessable Entity', status: 422, detail: 'El origen y destino deben ser distintos.' }) }); else await route.continue(); });
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(1500);
  const rej = await p.shot('C-M11-rejected');
  await p.btn('Modificar monto o cuenta').click(); await p.waitForTimeout(1000);
  const ed = await p.shot('C-after-modificar');
  L('C after Modificar: selector shown=', /Cuenta de origen/.test(ed) && (await p.getByLabel(/^Usar /).count()) > 0, '| amount=', await p.getByLabel('Importe').inputValue(), 'concept=', await p.getByLabel('Concepto').inputValue(), 'ref=', await p.getByLabel('Referencia').inputValue());
  L('C usar buttons:', await p.getByLabel(/^Usar /).count());
  await p.unroute('**/v1/transfers');
  // keep same combination -> warning on review?
  L('C Continuar disabled now (combo same as rejected)=', await p.getByRole('button', { name: CONT }).getAttribute('aria-disabled'));
  await p.context().close(); await new Promise((r) => setTimeout(r, 7000));

  // ---- C2: insufficient funds rejection (real, 422) -> Modificar -> same combo warns
  p = await h.newPage(browser, { h: 1000 }); await h.login(p, u.ana.email);
  await h.toDetails(p, 'Carlos'); await h.fill(p, '400', 'Renta', '778899');
  await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900);
  const tok = await h.apiLogin(u.ana.email); const main = (await h.api(tok, '/accounts')).b.items.find((a) => a.kind === 'checking');
  let left = BigInt(main.availableBalanceMinor) - 10000n;
  while (left > 0n) { const c = left > 400000n ? 400000n : left; await h.api(tok, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: main.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: c.toString(), concept: 'drain', reference: '9' }) }); left -= c; }
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
  const r2 = await p.shot('C2-M11-insufficient');
  await p.btn('Modificar monto o cuenta').click(); await p.waitForTimeout(1000);
  await p.shot('C2-after-modificar');
  await p.getByRole('button', { name: CONT }).click({ force: true }).catch(() => {}); await p.waitForTimeout(800);
  const rv = await p.shot('C2-review-same-combo');
  L('C2 rejected text:', r2.split('\n').filter(Boolean).slice(0, 14).join(' | '));
  L('C2 review warns on repeated combo:', rv.split('\n').filter((l) => /rechaz|mismo|misma|anterior/i.test(l)).join(' / ') || '(no warning)');
  L('C2 balance chips: $ lines in M11:', r2.split('\n').filter((l) => /\$/.test(l)).join(' | '));
  await p.context().close(); await new Promise((r) => setTimeout(r, 7000));

  // ---- C3: empty destinations: a user whose only beneficiary is the own savings account, origin Ahorro
  const solo = await h.register('Solo Prueba', `solo.ev.${run}@example.test`);
  const sa = (await h.api(solo, '/accounts')).b.items; const ssv = sa.find((a) => a.kind === 'savings');
  if (ssv) {
    await h.api(solo, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Mi ahorro', alias: 'ah', clabe: ssv.clabe }) });
    p = await h.newPage(browser, { h: 1000 }); await h.login(p, `solo.ev.${run}@example.test`);
    await p.getByRole('button', { name: /^Ahorro/ }).first().click(); await p.waitForTimeout(500);
    await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1500);
    const e = await p.shot('C3-no-destinations');
    L('C3 only-own-beneficiary + Ahorro origin text:', e.split('\n').filter(Boolean).join(' | ').slice(0, 500));
    await p.context().close();
  } else L('C3 skipped: new users have no savings account');
  L('accounts for a freshly registered user:', JSON.stringify(sa.map((a) => a.kind)));
  await browser.close();
  h.fs.writeFileSync(`${h.SP}/ev/s2-bcd.txt`, h.log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
