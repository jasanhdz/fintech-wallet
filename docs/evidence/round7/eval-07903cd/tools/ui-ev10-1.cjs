// Pass 10 · criteria 1, 2, 3, 6, 7. FIRST SEND answered by a non-business 4xx / 5xx / lost response, applied or not applied by the server.
// For each case: M09 (never M11), record byte-identical, no way to another attempt from M09/Inicio/Movimientos/tabs/reload/relogin/foreground,
// "Verificar" never POSTs, then the explicit consented resend: same key + same bytes, 1 transfer, 1 debit. Real bundle + real API + wallet_test.
const H = require('./h10.cjs');
const { chromium, L, ok, mkUser, newPage, login, wire, uid, rec, audit, fg, nCreates, q, summary, toConfirm, flush, IN_PROGRESS } = H;
const CASES = (process.env.EV_CASES ? process.env.EV_CASES.split(',') : ['409-applied', '409-notapplied', '400', '401', '403', '429-rate', '500-applied', 'lost-after', 'lost-before']);
const MODE = {
  '409-applied': ['exec-err:409:' + IN_PROGRESS, true], '409-notapplied': ['err:409:' + IN_PROGRESS, false],
  '400': ['err:400:Datos de transferencia inválidos.', false], '401': ['err:401:La sesión expiró.', false], '403': ['err:403:Acceso denegado.', false],
  '429-rate': ['err:429:Demasiadas solicitudes. Inténtalo más tarde.', false], '500-applied': ['exec-err:500:Ocurrió un problema.', true],
  'lost-after': ['lost-after', true], 'lost-before': ['lost-before', false],
};
(async () => {
  const browser = await chromium.launch();
  for (const tag of CASES) {
    const [mode, applied] = MODE[tag];
    L(`\n===== CASE ${tag}: first send -> ${mode.slice(0, 40)} (server applied it: ${applied}) =====`);
    const u = await mkUser('Ana López'); const id = await uid(u); const d = q(u.email);
    const p = await newPage(browser, { h: 929 }); const net = {}; await wire(p, net); await login(p, u.email);
    await toConfirm(p);
    net.create = mode; net.get = 'pass';
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    let t = await p.text();
    ok(/Estamos verificando/.test(t) && !/No se pudo completar la transferencia|Tu dinero está intacto|Revisa tu saldo/.test(t), `${tag}: M09 "Estamos verificando", never M11`);
    await p.shot(`ev10-1-${tag}-m09`);
    const R0 = await rec(p, id); const rj = JSON.parse(R0);
    ok(Boolean(R0) && !rj.transferId, `${tag}: record stored before send, no transferId (${Object.keys(rj).join(',')})`);
    L(`DB after first send: ${d.rows()} debits=${d.debits()} (applied expected ${applied})`);
    // --- M09 exits and every other path (network refuses everything meanwhile)
    net.create = 'abort'; net.get = 'abort';
    let a = await audit(p, 'M09'); ok(a.bad.length === 0, `${tag}: M09 offers no new-transfer entry`);
    await p.btn('Ver movimientos').click(); await p.waitForTimeout(1500);
    a = await audit(p, 'after "Ver movimientos" (M09)'); ok(a.bad.length === 0, `${tag}: Movimientos from M09 has no new-transfer entry`);
    await p.getByRole('tab', { name: /Inicio/ }).click().catch(() => null); await p.waitForTimeout(1500);
    t = await p.text();
    if (!/Transferencia en verificación/.test(t)) { if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500); } }
    a = await audit(p, 'Inicio'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), `${tag}: Inicio only shows the notice`);
    await p.shot(`ev10-1-${tag}-inicio`);
    await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1200); a = await audit(p, 'Movimientos tab'); ok(a.bad.length === 0, `${tag}: Movimientos tab no entry`);
    await p.getByRole('tab', { name: /Inicio/ }).click(); await p.waitForTimeout(800);
    await p.getByRole('button', { name: /^Ahorro ••/ }).first().click().catch(() => null); await p.waitForTimeout(500); a = await audit(p, 'account tab Ahorro'); ok(a.bad.length === 0, `${tag}: account switch no entry`);
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2000);
    t = await p.text(); L('"Verificar" offline ->', /Esta operación aún no tiene número/.test(t) ? 'no-id text' : /Estamos verificando/.test(t) ? 'M09' : 'other');
    ok(nCreates(net) === 1, `${tag}: POST /transfers count still 1 after Verificar/exits`);
    ok((await rec(p, id)) === R0, `${tag}: record byte-identical after exits`);
    // reload + logout/login + foreground with network down
    await p.reload(); await p.waitForTimeout(4000); await wire(p, net);
    t = await p.text(); a = await audit(p, 'after reload'); ok(a.bad.length === 0, `${tag}: reload no entry`);
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); }
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); await login(p, u.email); await p.waitForTimeout(1200);
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); }
    a = await audit(p, 'after logout/login'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), `${tag}: relogin still locked`);
    ok((await rec(p, id)) === R0, `${tag}: record byte-identical after reload and logout/login`);
    // --- network back: reading must NOT create (criterion 7)
    net.create = 'pass'; net.get = 'pass'; const c0 = nCreates(net);
    await fg(p); await fg(p); await fg(p); await p.reload(); await p.waitForTimeout(4000); await wire(p, net);
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); }
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); await login(p, u.email); await p.waitForTimeout(2500);
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); }
    if (await p.getByRole('button', { name: /Verificar estado de la transferencia/ }).count()) { await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500); }
    ok(nCreates(net) === c0, `${tag}: network back, 3x foreground + start-up + login + "Verificar" -> 0 POST /transfers (creates ${nCreates(net) - c0})`);
    ok((await rec(p, id)) === R0, `${tag}: record byte-identical (reads did not resolve or touch it)`);
    await summary(u, 'before the explicit resend');
    ok(d.n() === (applied ? 1 : 0), `${tag}: DB ${applied ? '1 transfer (applied)' : '0 transfers (never applied): reads did not create one'}`);
    await p.shot(`ev10-1-${tag}-network-back`);
    // --- explicit resend: opens review, nothing sent; back; confirm sends the SAME key and bytes
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); }
    t = await p.text(); if (!(await p.getByRole('button', { name: 'Reenviar la misma transferencia' }).count())) { await p.getByRole('tab', { name: /Inicio/ }).click().catch(() => null); await p.waitForTimeout(1000); }
    const cb = nCreates(net);
    await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(1200);
    t = await p.text(); await p.shot(`ev10-1-${tag}-resend-review`);
    ok(/300[.,]25/.test(t) && /Prueba Ev10/.test(t) && /9001/.test(t) && /Confirmaste esta transferencia el/.test(t), `${tag}: resend review shows the ORIGINAL data and the registered consent`);
    ok(nCreates(net) === cb, `${tag}: opening the resend review sent nothing`);
    await p.btn('Volver sin reenviar').click(); await p.waitForTimeout(1000);
    ok(nCreates(net) === cb && (await rec(p, id)) === R0, `${tag}: "Volver sin reenviar" sent nothing and left the record unchanged`);
    await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(800);
    await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(3500);
    const sent = net.creates.slice(cb);
    ok(sent.length === 1, `${tag}: the resend tap sent exactly 1 POST (got ${sent.length})`);
    const first = net.creates[0];
    ok(sent[0].key === first.key && sent[0].key === rj.key, `${tag}: resend Idempotency-Key == first send == stored record (${first.key.slice(0, 8)})`);
    ok(sent[0].body === first.body && sent[0].body === JSON.stringify(rj.payload), `${tag}: resend body is byte-identical to the first send and to JSON.stringify(record.payload) (${sent[0].body.length} bytes)`);
    t = await p.text(); await p.shot(`ev10-1-${tag}-after-resend`);
    ok(/Transferencia exitosa|Comprobante|Folio|Completad/.test(t), `${tag}: resend reaches the receipt`);
    const rid = (t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [''])[0];
    const dbid = H.psql(`select t.id from transfers t join users u on u.id=t.owner_id where u.email='${u.email}' limit 1`);
    L(`receipt folio ${rid.slice(0, 8)} == DB transfer ${dbid.slice(0, 8)} : ${rid === dbid}`);
    const s = await summary(u, 'after the resend');
    ok(s.n === 1 && s.debits === 1, `${tag}: 1 transfer, 1 debit in DB`);
    ok((await rec(p, id)) === null, `${tag}: record released only now (server confirmed completed)`);
    await p.context().close();
  }
  await browser.close(); flush('logs/ui-ev10-1' + (process.env.EV_CASES ? '-' + process.env.EV_CASES.replace(/[^a-z0-9]+/gi, '_') : '') + '.txt');
})().catch((e) => { console.error('FAILED', e); H.flush('logs/ui-ev10-1-failed.txt'); process.exitCode = 1; });
