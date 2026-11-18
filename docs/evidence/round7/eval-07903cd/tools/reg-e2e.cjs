// Item 12: E2E UI + DB, Principal -> Ahorro exact $300.25 (single POST), total conserved; origin=destination: no POST and no row.
const { chromium, L, ok, mkUser, balances, dbRows, dbLedger, psql, newPage, login, origin, choose, toReview, flush } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch();
  const u = await mkUser(); const p = await newPage(browser, { h: 929 }); await login(p, u.email);
  const b0 = await balances(u);
  await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'E2E exacto', '5555');
  const rv = await p.text(); L('review text:', rv.match(/\$[\d,]+\.\d\d - \$[\d,]+\.\d\d = \$[\d,]+\.\d\d MXN/)?.[0]);
  p.reqs.length = 0; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  const b1 = await balances(u); const t = await p.text();
  ok(b0.checking - b1.checking === 30025n && b1.savings - b0.savings === 30025n, `principal ${b0.checking}->${b1.checking}, ahorro ${b0.savings}->${b1.savings} (exact 30025)`);
  ok(b0.checking + b0.savings === b1.checking + b1.savings, `total conserved ${b0.checking + b0.savings} = ${b1.checking + b1.savings}`);
  L('POST /transfers count:', p.reqs.filter((r) => /^POST \/transfers key/.test(r)).length, '| DB', dbRows(u.email), '| ledger', dbLedger(u.email), '| receipt', /Transferencia completada/.test(t), '| new balance on receipt', /\$9,699\.75/.test(t));
  await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(2000); const m = await p.text();
  L('history shows the debit:', /-\$300\.25/.test(m));
  // origin = destination
  await p.btn('Inicio').click().catch(() => {}); await p.waitForTimeout(800);
  p.reqs.length = 0; await p.getByRole('button', { name: /Transferir dinero|Cambiar/ }).first().click().catch(() => {}); await p.waitForTimeout(800);
  await p.context().close();
  const q = await newPage(browser, { h: 929 }); await login(q, u.email);
  await origin(q, /^Ahorro ••/); await q.getByLabel(/Elegir beneficiario/i).first().click(); await q.waitForTimeout(1200);
  const dis = await q.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().getAttribute('aria-disabled');
  await q.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().click({ force: true }).catch(() => {}); await q.waitForTimeout(500);
  L('origin Ahorro: own-savings beneficiary disabled =', dis, '| POST /transfers', q.reqs.filter((r) => /^POST \/transfers/.test(r)).length, '| rows with source=destination in DB', psql(`select count(*) from transfers where source_account_id=destination_account_id`));
  await q.context().close(); await browser.close(); flush('logs/e2e.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
