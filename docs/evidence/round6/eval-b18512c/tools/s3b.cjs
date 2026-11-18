const h = require('./lib.cjs'); const { L, psql } = h;
const CONT = /^Continuar[^a-zA-Z]*$/;
const rows = (email, ref) => psql(`select string_agg(t.status||':'||t.amount_minor,' ' order by t.created_at) from transfers t join users u on u.id=t.owner_id where u.email='${email}' and t.reference='${ref}'`);
const allTexts = [];
(async () => {
  const run = 'c' + Date.now().toString().slice(-6);
  const u = await h.seedUsers(run); const E = u.ana.email;
  const browser = await h.chromium.launch();
  const wait = () => new Promise((r) => setTimeout(r, 6500));
  const keys = (p) => [...new Set(p.reqs.filter((r) => r.startsWith('POST /transfers ')).map((r) => r.split('key=')[1]))];
  const go = async (p, ben, amt, concept, ref) => { await h.toDetails(p, ben); await h.fill(p, amt, concept, ref); await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900); };
  let p;
  { const ct = u.carlos.token; await h.api(ct,'/transfers',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({sourceAccountId:u.cm.id,destinationType:'beneficiary',beneficiaryId:u.toA.id,amountMinor:'450000',concept:'topup',reference:'9'})}); }
  // E4: expired on server while user sits in OTP: confirm with correct code
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '5000', 'Otp dos', '4444');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const id4 = psql(`select t.id from transfers t join users u on u.id=t.owner_id where u.email='${E}' and t.reference='4444' order by t.created_at desc limit 1`);
  const code4 = ((await p.evaluate(() => document.body.innerText)).match(/prueba: (\d{6})/) || [])[1];
  psql(`update otp_challenges set expires_at=now()-interval '1 second' where transfer_id='${id4}'`);
  await p.getByLabel('Código de confirmación').fill(code4); await p.waitForTimeout(300);
  const b4 = h.bal(E);
  await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(2500);
  const t6 = await p.shot('E4-expired-confirm', { mask: [p.locator('text=/Código asignado para esta prueba/')] }); allTexts.push(t6);
  L('E4 expired confirm: screen:', t6.split('\n').filter(Boolean).join(' | ').replace(/\d{6}/g, '######').slice(0, 500));
  L('E4 DB:', rows(E, '4444'), '| balances unchanged:', b4 === h.bal(E), '| ledger rows:', psql(`select count(*) from ledger_entries e join ledger_transactions lt on lt.id=e.ledger_transaction_id where lt.reference_id='${id4}'`));
  await p.context().close(); await wait();

  // E4b: relaunch with expired pending -> closed screen ; E5 relaunch with cancelled pending
  for (const [kind, ref] of [['expired', '5555'], ['cancelled', '6666']]) {
    p = await h.newPage(browser, { h: 1000 }); await h.login(p, E);
    await go(p, 'Carlos', '5000', 'Otp ' + kind, ref);
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
    const id = psql(`select t.id from transfers t join users u on u.id=t.owner_id where u.email='${E}' and t.reference='${ref}' order by t.created_at desc limit 1`);
    if (kind === 'expired') psql(`update otp_challenges set expires_at=now()-interval '1 second' where transfer_id='${id}'`);
    else { const tk = await h.apiLogin(E); await h.api(tk, `/transfers/${id}/cancel`, { method: 'POST' }); }
    await p.reload(); await p.waitForTimeout(3500);
    const tt = await p.shot('E5-relaunch-' + kind); allTexts.push(tt);
    L(`E5 ${kind} after relaunch: DB ${rows(E, ref)} | screen: ${tt.split('\n').filter(Boolean).join(' | ').slice(0, 420)}`);
    await p.context().close(); await wait();
  }
  L('"Consultando operación" anywhere:', allTexts.some((t) => /Consultando operaci/i.test(t)));
  L('Totals: transfers by status for Ana:', psql(`select string_agg(reference||':'||status,' ' order by t.created_at) from transfers t join users u on u.id=t.owner_id where u.email='${E}'`));
  await browser.close();
  h.fs.writeFileSync(`${h.SP}/ev/s3b-e.txt`, h.log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
