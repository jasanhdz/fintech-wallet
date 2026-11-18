// F-12: leaving the code step while the confirm is in flight (response delayed after / before the server applies it).
const { chromium, L, api, apiLogin, newPage, login, toDetails, fill, psql, fs, SP, seedUsers, bal, log } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch();
  for (const mode of ['after-server', 'before-server']) {
    const u = await seedUsers(Date.now().toString().slice(-6) + mode[0]); const email = u.ana.email;
    const page = await newPage(browser, { h: 844 }); await login(page, email);
    await toDetails(page, 'Carlos'); const ref = mode === 'after-server' ? '811001' : '811002';
    await fill(page, '5000', 'Prueba F12', ref);
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(800);
    await page.btn('Continuar a verificación').click(); await page.waitForTimeout(2500);
    const code = ((await page.evaluate(() => document.body.innerText)).match(/prueba: (\d{6})/) || [])[1];
    await page.getByLabel('Código de confirmación').fill(code);
    const before = await bal(email);
    await page.route('**/v1/transfers/*/confirm', async (route) => {
      if (mode === 'after-server') { const r = await route.fetch(); await new Promise((x) => setTimeout(x, 4000)); await route.fulfill({ response: r }); }
      else { await new Promise((x) => setTimeout(x, 4000)); await route.continue(); }
    });
    await page.btn('Autorizar transferencia').click(); await page.waitForTimeout(1200);
    const t1 = await page.shot(`F12-${mode}-1-enviando`);
    const info = () => page.evaluate(() => [...document.querySelectorAll('[role=button]')].filter((e) => /Cancelar y volver/.test(e.getAttribute('aria-label') || e.innerText)).map((e) => { const r = e.getBoundingClientRect(); return { dis: e.getAttribute('aria-disabled'), tab: e.getAttribute('tabindex'), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }));
    const els = await info(); L(mode, 'arrow+cancel elements in flight', JSON.stringify(els));
    for (const e of els) { await page.mouse.click(e.x, e.y); await page.waitForTimeout(300); }
    L(mode, 'clicked both with real mouse events; screen now has code step:', /Código de confirmación/.test(await page.text()));
    await page.waitForTimeout(800);
    const t2 = await page.shot(`F12-${mode}-2-tras-clic`);
    L(mode, 'after clicking cancel+arrow, screen:', t2.split('\n').filter(Boolean).slice(0, 5).join(' | '));
    L(mode, 'cancel POSTs so far:', page.reqs.filter((r) => r.includes('/cancel')).length, '| DB during:', psql(`select status||':'||amount_minor from transfers t join users u on u.id=t.owner_id where u.email='${email}' and t.reference='${ref}'`));
    await page.waitForTimeout(5000);
    const t3 = await page.shot(`F12-${mode}-3-final`);
    L(mode, 'final screen:', t3.split('\n').filter(Boolean).slice(0, 4).join(' | '));
    L(mode, 'POST /transfers:', page.reqs.filter((r) => r.startsWith('POST /transfers ')).length, 'cancel:', page.reqs.filter((r) => r.includes('/cancel')).length, 'confirm:', page.reqs.filter((r) => r.includes('/confirm')).length);
    L(mode, 'DB rows:', psql(`select string_agg(status||':'||amount_minor, ' ') from transfers t join users u on u.id=t.owner_id where u.email='${email}' and t.reference='${ref}'`), '| ledger entries:', psql(`select count(*)||'/'||coalesce(sum(le.signed_amount_minor),0) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${email}' and t.reference='${ref}'`));
    L(mode, 'balances before', before, 'after', await bal(email));
    await page.context().close();
  }
  await browser.close();
  fs.writeFileSync(`${SP}/s7.txt`, log.join('\n'));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
