// Pass 10 · criteria 3, 6, 7: intento pendiente de código (awaiting_confirmation) con M08, F-22 (usuario B no toca el registro de A).
// The demo OTP is read into memory only; it is never printed (screens masked).
const H = require('./h10.cjs');
const { chromium, L, ok, call, mkUser, newPage, login, wire, uid, rec, setRec, audit, fg, nCreates, q, summary, toConfirm, flush, psql, crypto } = H;
const WHICH = (process.env.EV_SC || 'otp-normal,otp-lost,otp-reload-newcode,otp-cancel-fails,f22').split(',');
const has = (x) => WHICH.includes(x);
const goHome = async (p) => { if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); } };
const setup = async (browser) => { const u = await mkUser('Ana López'); const id = await uid(u); const p = await newPage(browser, { h: 929 }); const net = {}; await wire(p, net); await login(p, u.email); return { u, id, p, net, d: q(u.email) }; };
const readCode = async (p) => { const t = await p.evaluate(() => document.body.innerText); const m = t.match(/Código asignado para esta prueba:\s*(\d{6})/); return m ? m[1] : null; };
const typeCode = async (p, code) => { const inp = p.getByLabel('Código de confirmación').first(); await inp.focus(); await inp.fill(code); await p.waitForTimeout(400); };
const m08 = (t) => /Autorizar transferencia|Código de confirmación|código de autorización/i.test(t);
const status = (email) => psql(`select coalesce(string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at),'(none)') from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
(async () => {
  const browser = await chromium.launch();
  if (has('otp-normal')) {
    L('\n===== otp-normal: $6,000.00 (>= threshold) -> 202 -> M08 -> code -> completed =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p, '6000.00', 'Sobre umbral', '6001'); await p.btn(/Continuar a verificación|Confirmar transferencia/).click().catch(async () => { await p.btn('Continuar a verificación').click(); }); await p.waitForTimeout(3000);
    let t = await p.text(); ok(m08(t), 'otp-normal: M08 shown'); L('DB:', status(u.email), 'debits', d.debits()); ok(d.debits() === 0, 'otp-normal: pending attempt has 0 debits/ledger');
    const code = await readCode(p); ok(Boolean(code), 'otp-normal: demo code present in the 202 response (not printed)');
    const R = JSON.parse(await rec(p, id)); ok(R.consent?.otp === 'required' && !JSON.stringify(R).includes(code), 'otp-normal: consent.otp=required and the record does not contain the code');
    await typeCode(p, code); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
    t = await p.text(); ok(/Transferencia exitosa|Comprobante|Folio/.test(t), 'otp-normal: receipt'); const s = await summary(u, 'final'); ok(s.n === 1 && s.debits === 1, 'otp-normal: 1 transfer, 1 debit'); ok((await rec(p, id)) === null, 'otp-normal: record released after the server confirmed completed');
    await p.context().close();
  }
  if (has('otp-lost')) {
    L('\n===== otp-lost: first send (202, awaiting_confirmation) response lost -> M09 -> explicit resend -> must ask for the code (M08) =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p, '6000.00', 'Sobre umbral', '6002'); net.create = 'lost-after'; await p.btn(/Continuar a verificación/).click(); await p.waitForTimeout(3000);
    let t = await p.text(); ok(/Estamos verificando/.test(t), 'otp-lost: M09'); L('DB:', status(u.email), 'debits', d.debits());
    net.create = 'abort'; net.get = 'abort'; await goHome(p); const n0 = nCreates(net);
    net.create = 'pass'; net.get = 'pass'; await fg(p); await p.reload(); await p.waitForTimeout(4000); await wire(p, net); await goHome(p);
    ok(nCreates(net) === n0 && d.debits() === 0, `otp-lost: foreground/reload sent 0 new POST (creates ${nCreates(net) - n0}); still pending and 0 debits`);
    const R0 = await rec(p, id);
    await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(900); t = await p.text();
    ok(/código de autorización|Si el servidor pide un código/.test(t), 'otp-lost: the review tells that the code is required'); await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(3500);
    t = await p.text(); ok(m08(t), 'otp-lost: resend answered 202 -> M08 asks for the code (the resend cannot skip it)'); ok(d.debits() === 0, 'otp-lost: still 0 debits before the code');
    ok(nCreates(net) === n0 + 1 && net.creates[n0].key === JSON.parse(R0).key && net.creates[n0].body === JSON.stringify(JSON.parse(R0).payload) && net.creates[0].body === net.creates[n0].body, 'otp-lost: resend = 1 POST, same key as the stored record and the first send, byte-identical body');
    const code = await readCode(p); ok(Boolean(code), 'otp-lost: code recovered by the idempotent replay'); await typeCode(p, code); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
    t = await p.text(); ok(/Transferencia exitosa|Comprobante|Folio/.test(t), 'otp-lost: receipt after authorizing'); const s = await summary(u, 'final'); ok(s.n === 1 && s.debits === 1, 'otp-lost: 1 transfer, 1 debit');
    await p.context().close();
  }
  if (has('otp-reload-newcode')) {
    L('\n===== otp-reload-newcode: M08 -> reload (start-up reads, opens M08 without the code) -> "Solicitar un código nuevo" =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p, '6000.00', 'Sobre umbral', '6003'); await p.btn(/Continuar a verificación/).click(); await p.waitForTimeout(3000);
    const R0 = JSON.parse(await rec(p, id)); const n0 = nCreates(net); await p.reload(); await p.waitForTimeout(4500); await wire(p, net);
    let t = await p.text(); ok(m08(t), 'otp-reload: start-up reopens M08 for the pending attempt'); ok(nCreates(net) === n0 && !(await readCode(p)), 'otp-reload: start-up sent 0 POST and the code is not stored (not shown)');
    // new code with the cancel and the read failing: nothing is created
    net.cancel = 'abort'; net.get = 'abort'; await p.btn('Solicitar un código nuevo').click(); await p.waitForTimeout(2500);
    ok(nCreates(net) === n0 && d.n() === 1, 'otp-reload: "Solicitar un código nuevo" with cancel+read failing creates nothing'); await p.shot('ev10-3-newcode-uncertain');
    ok(JSON.parse(await rec(p, id)).key === R0.key, 'otp-reload: record unchanged (old key)');
    net.cancel = 'pass'; net.get = 'pass'; await p.btn('Solicitar un código nuevo').click(); await p.waitForTimeout(3500);
    ok(nCreates(net) === n0 + 1 && net.creates[n0].key !== R0.key, 'otp-reload: with the old attempt confirmed cancelled, exactly 1 new create with a NEW key (explicit user action)');
    L('DB:', status(u.email)); const code = await readCode(p); await typeCode(p, code); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
    const s2 = await summary(u, 'final'); ok(s2.n === 2 && s2.debits === 1, 'otp-reload: cancelled + completed, 1 debit'); ok((await rec(p, id)) === null, 'otp-reload: record released once completed');
    await p.context().close();
  }
  if (has('otp-cancel-fails')) {
    L('\n===== otp-cancel-fails: M08 -> "Cancelar y volver a revisar" with cancel and read failing =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p, '6000.00', 'Sobre umbral', '6004'); await p.btn(/Continuar a verificación/).click(); await p.waitForTimeout(3000);
    const R0 = await rec(p, id); net.cancel = 'abort'; net.get = 'abort'; await p.getByRole('button', { name: /Cancelar y volver a revisar/ }).first().click(); await p.waitForTimeout(2500);
    const a = await audit(p, 'after cancel failure'); ok(a.bad.length === 0 && /pendiente de autorizar/.test(a.t), 'otp-cancel-fails: Home pending notice, no entry to another attempt');
    ok((await rec(p, id)) === R0 && nCreates(net) === 1, 'otp-cancel-fails: record intact, 0 extra POST'); L('DB:', status(u.email));
    await fg(p); await p.reload(); await p.waitForTimeout(3500); await goHome(p); const a2 = await audit(p, 'after reload'); ok(a2.bad.length === 0, 'otp-cancel-fails: still no entry after reload/foreground');
    ok(d.n() === 1 && d.debits() === 0, 'otp-cancel-fails: 1 awaiting_confirmation, 0 debits');
    // Home pending -> Continuar (read only) -> M08 without the code
    net.cancel = 'pass'; net.get = 'pass'; const n1 = nCreates(net);
    if (!(await p.getByRole('button', { name: 'Continuar con la transferencia pendiente' }).count())) { await p.getByRole('tab', { name: /Inicio/ }).click().catch(() => null); await p.waitForTimeout(1000); }
    await p.btn('Continuar con la transferencia pendiente').click(); await p.waitForTimeout(2500);
    ok(m08(await p.text()) && nCreates(net) === n1 && !(await readCode(p)), 'otp-cancel-fails: Home "Continuar" is a read: M08 without the code, 0 POST');
    await p.getByRole('button', { name: /Cancelar y volver a revisar/ }).first().click(); await p.waitForTimeout(3000);
    ok(d.n() === 1 && psql(`select status from transfers t join users u on u.id=t.owner_id where u.email='${u.email}'`) === 'cancelled', 'otp-cancel-fails: with the server reachable the cancel is confirmed -> cancelled, no debit'); ok((await rec(p, id)) === null, 'otp-cancel-fails: record released only after the confirmed cancel');
    await p.context().close();
  }
  if (has('f22')) {
    L('\n===== f22: A leaves an uncertain attempt; B signs in on the same device, transfers; A returns =====');
    const A = await setup(browser); const { p, net, u, id, d } = A;
    await toConfirm(p); net.create = 'lost-before'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); net.create = 'abort'; await goHome(p); const RA = await rec(p, id);
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); ok((await rec(p, id)) === RA, 'f22: logout kept A record byte-identical');
    const B = await mkUser('Beto López'); const idB = await uid(B); const dB = q(B.email); net.create = 'pass'; net.get = 'pass'; net.creates.length = 0; p.reqs.length = 0;
    await login(p, B.email); await p.waitForTimeout(2500); let t = await p.text(); ok(!/Transferencia en verificación|pendiente de autorizar/.test(t) && /Transferir dinero|Continuar con transferencia/.test(t), 'f22: B sees no notice and is not blocked');
    await toConfirm(p, '150.00', 'Pago B', '7001'); await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3500);
    ok(net.creates.length === 1 && net.creates[0].key !== JSON.parse(RA).key, 'f22: B sent 1 create with its own key (not A key)');
    L('B requests touching /transfers:', JSON.stringify(p.reqs.filter((r) => /transfers/.test(r))));
    ok((await rec(p, id)) === RA, 'f22: A record byte-identical after B session'); await goHome(p).catch(() => null);
    await p.btn('Volver al inicio').click().catch(() => null); await p.waitForTimeout(800);
    await p.btn('Cerrar sesión').click().catch(() => null); await p.waitForTimeout(1500);
    ok((await rec(p, id)) === RA, 'f22: A record byte-identical after B logout');
    await summary(B, 'B final'); ok(dB.n() === 1 && dB.debits() === 1, 'f22: B 1 transfer / 1 debit');
    await login(p, u.email); await p.waitForTimeout(2500); t = await p.text(); ok(/Transferencia en verificación/.test(t), 'f22: A sees their notice again');
    net.creates.length = 0; await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(900); await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(3500);
    ok(net.creates.length === 1 && net.creates[0].key === JSON.parse(RA).key && net.creates[0].body === JSON.stringify(JSON.parse(RA).payload), 'f22: A resend = original key and bytes');
    const s = await summary(u, 'A final'); ok(s.n === 1 && s.debits === 1, 'f22: A 1 transfer / 1 debit');
    await p.context().close();
  }
  await browser.close(); flush('logs/ui-ev10-3' + (process.env.EV_SC ? '-' + process.env.EV_SC.replace(/[^a-z0-9]+/gi, '_') : '') + '.txt');
})().catch((e) => { console.error('FAILED', e); H.flush('logs/ui-ev10-3-failed.txt'); process.exitCode = 1; });
