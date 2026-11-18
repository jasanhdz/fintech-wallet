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
  // E1 Enviando then completed
  let p = await h.newPage(browser, { h: 1000 }); await h.login(p, E);
  await go(p, 'Carlos', '150', 'Normal', '1111');
  await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); } else await route.continue(); });
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(800);
  const t1 = await p.shot('E1-enviando'); allTexts.push(t1);
  await p.waitForTimeout(3500); const t1b = await p.shot('E1-completada'); allTexts.push(t1b);
  L('E1 sending screen lines:', t1.split('\n').filter(Boolean).join(' | ').slice(0, 400));
  L('E1 normal flow shows "Consultando"/"Verificando":', /Consultando|Verificando/i.test(t1 + t1b), '| keys:', keys(p).length, '| DB:', rows(E, '1111'));
  await p.context().close(); await wait();

  // E2 Verificando via lost response; same key; reload recovery
  p = await h.newPage(browser, { h: 1000 }); await h.login(p, E);
  await go(p, 'Carlos', '120', 'Libros', '2222');
  let lose = true;
  await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST' && lose) { await route.fetch(); await route.abort('failed'); } else await route.continue(); });
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
  const t2 = await p.shot('E2-verificando'); allTexts.push(t2);
  L('E2 verifying screen:', t2.split('\n').filter(Boolean).join(' | ').slice(0, 500));
  L('E2 DB after lost response:', rows(E, '2222'));
  await p.reload(); await p.waitForTimeout(3500);
  const t2r = await p.shot('E2-after-reload'); allTexts.push(t2r);
  L('E2 after reload:', /verific/i.test(t2r) ? 'verifying screen' : t2r.split('\n').filter(Boolean).slice(0, 6).join(' | '));
  lose = false;
  if (/Verificar/i.test(t2r)) { await p.btn('Verificar estado').click().catch(async () => p.btn('Verificar').click()); await p.waitForTimeout(2500); }
  const t2c = await p.shot('E2-resolved'); allTexts.push(t2c);
  L('E2 POST keys across attempt+reload+retry:', keys(p).join(','), '(count', keys(p).length + ') | DB:', rows(E, '2222'), '| resolved screen:', /Transferencia completada/.test(t2c));
  await p.context().close(); await wait();

  // E4/E5/G: OTP flows
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '6000', 'Otp uno', '3333');
  const t3 = await p.shot('E3-review-otp'); allTexts.push(t3);
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const t4 = await p.shot('G-otp-empty', { mask: [p.locator('text=/Código asignado para esta prueba/')] }); allTexts.push(t4);
  L('G OTP screen lines:', t4.split('\n').filter(Boolean).join(' | ').replace(/\d{6}/g, '######').slice(0, 700));
  L('G DB pending:', rows(E, '3333'));
  // leave with "Cancelar y volver a revisar"
  await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(1500);
  L('G after leave (Cancelar y volver): DB:', rows(E, '3333'), '| screen:', (await p.shot('G-after-leave')).split('\n').filter(Boolean).slice(0,4).join(' | '));
  // go again -> new attempt, other key; leave by header back arrow
  await p.btn('Continuar a verificación').click().catch(() => p.btn('Confirmar transferencia').click()); await p.waitForTimeout(2500);
  L('G second attempt DB:', rows(E, '3333'));
  await p.getByLabel('Cancelar y volver a revisar').first().click(); await p.waitForTimeout(1500);
  L('G after header back: DB:', rows(E, '3333'));
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const code = ((await p.evaluate(() => document.body.innerText)).match(/prueba: (\d{6})/) || [])[1];
  await p.getByLabel('Código de confirmación').fill(code || '000000'); await p.waitForTimeout(300);
  const balBefore = h.bal(E);
  await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3000);
  const t5 = await p.shot('G-completed-after-retries'); allTexts.push(t5);
  L('G third attempt confirmed: DB:', rows(E, '3333'), '| balances:', balBefore, '->', h.bal(E));
  L('G keys of POST /transfers (distinct per attempt):', keys(p).join(','), '| cancel POSTs:', p.reqs.filter((r) => /\/cancel/.test(r)).length);
  await p.context().close(); await wait();

  // E4: expired on server while user sits in OTP: confirm with correct code
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '6000', 'Otp dos', '4444');
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
    await go(p, 'Carlos', '6000', 'Otp ' + kind, ref);
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
  h.fs.writeFileSync(`${h.SP}/ev/s3-e-g.txt`, h.log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
