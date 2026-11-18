const { chromium, L, newPage, login, toDetails, fill, seedUsers, bal, psql, fs, SP, log } = require('./lib.cjs');
(async () => {
  const s = await seedUsers('e2e' + Date.now().toString().slice(-5)); const browser = await chromium.launch();
  const total = () => psql(`select sum(a.balance_minor) from accounts a join users u on u.id=a.owner_id where u.email='${s.ana.email}'`);
  L('before', bal(s.ana.email), 'total', total());
  let page = await newPage(browser, { h: 884 }); await login(page, s.ana.email);
  await toDetails(page, 'Cuenta de ahorro demo'); await fill(page, '300.25', 'Traspaso', '300250');
  await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900);
  L('review:', (await page.text()).split('\n').filter((l) => /Cálculo|Saldo posterior|\$300|Transferencia interna/.test(l)).join(' | '));
  await page.btn('Confirmar transferencia').click(); await page.waitForTimeout(2500);
  L('receipt has -$300.25:', /-\$300\.25/.test(await page.text()), '| POST /transfers:', page.reqs.filter((r) => r.startsWith('POST /transfers')).length);
  L('after', bal(s.ana.email), 'total', total(), '| ledger', psql(`select coalesce(sum(le.signed_amount_minor),0)||'/'||count(*) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id where t.reference='300250'`).slice(0,60));
  await page.context().close();
  // origin = destination
  page = await newPage(browser, { h: 844 }); await login(page, s.ana.email);
  await page.getByRole('button', { name: /^Ahorro/ }).first().click(); await page.waitForTimeout(500);
  await page.getByLabel('Elegir beneficiario').click(); await page.waitForTimeout(1200);
  const row = page.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first(); L('Ahorro->Ahorro row aria-disabled:', await row.getAttribute('aria-disabled'));
  await row.click({ force: true }).catch(() => {}); await page.waitForTimeout(600);
  L('still on picker:', /Elegir beneficiario/.test(await page.text()), '| POST /transfers:', page.reqs.filter((r) => r.startsWith('POST /transfers')).length);
  const rows = psql(`select count(*) from transfers t join users u on u.id=t.owner_id where u.email='${s.ana.email}' and t.source_account_id=t.destination_account_id`).trim(); L('DB rows with source=destination:', rows);
  fs.writeFileSync(`${SP}/e2e.txt`, log.join('\n') + '\n'); await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
