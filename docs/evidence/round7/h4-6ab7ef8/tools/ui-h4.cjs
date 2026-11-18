// Round 7 · H4: F-26 / F-21 residual / F-27 / F-22 on the real exported RN-Web bundle + isolated API (wallet_test, :3994).
// "Lost" responses and the 409 "en curso" are simulated with page.route (the request reaches the real server and its answer
// is dropped, or it never leaves); the 404s are REAL API answers. Below the OTP threshold only: no code is involved.
// Usage: EV_OUT=<evidence dir> EV_TEST_PASSWORD=<test value> ONLY=S1,S2,... node tools/ui-h4.cjs
const { chromium, L, ok, call, mkUser, balances, dbLedger, newPage, login, origin, choose, toReview, flush, psql, crypto } = require('./lib.cjs');
const FORBID = /Continuar con transferencia|Elegir otro destinatario|Cambiar beneficiario|Transferir dinero|Elegir beneficiario/;
function wire(p, net) {
  return p.route('**/v1/transfers**', async (route) => {
    const r = route.request(); const m = r.method(); const u = new URL(r.url()).pathname.replace('/v1', '');
    const kind = m === 'POST' && u === '/transfers' ? 'create' : m === 'GET' && /^\/transfers\/[0-9a-f-]{36}$/.test(u) ? 'get' : null;
    if (!kind) return route.continue();
    const mode = net[kind] || 'pass'; net.log.push(`${kind}:${mode}`);
    if (kind === 'create') net.creates.push((r.headers()['idempotency-key'] || '-').slice(0, 8));
    if (mode === 'pass') return route.continue();
    if (mode === 'abort') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    if (mode === '409') return route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'La solicitud idempotente está en curso; reintenta con la misma llave.' }) });
    return route.continue();
  });
}
const names = async (p) => (await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\n/g, ' ').slice(0, 50)))).filter(Boolean);
async function audit(p, label) { const t = await p.text(); const b = await names(p); const bad = b.filter((n) => FORBID.test(n)); L(`AUDIT ${label}: notice=${/Transferencia (en verificación|pendiente de autorizar)|Registro de transferencia dañado|No pudimos comprobar tus transferencias/.test(t)} forbidden=${JSON.stringify(bad)} | buttons=${JSON.stringify(b.map((x) => x.slice(0, 40)))}`); return { t, bad }; }
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
const ls = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')).map((k) => [k, localStorage.getItem(k)])));
const cnt = (email) => Number(psql(`select count(*) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`));
const rows = (email) => psql(`select coalesce(string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at),'(none)') from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
const uid = async (u) => (await call(u.token, '/auth/me')).b.id;
const logout = async (p) => { await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); };
const has = async (p, name) => (await p.getByRole('button', { name, exact: true }).count()) > 0;
const tab = async (p, name) => { await p.getByRole('tab', { name }).first().click(); await p.waitForTimeout(1500); };
async function sendOnce(p, amount, concept, ref) {
  // Home keeps the last destination (card + "Continuar con transferencia") or offers "Transferir dinero".
  if (await has(p, 'Transferir dinero, elegir beneficiario')) { await p.getByRole('button', { name: 'Transferir dinero, elegir beneficiario' }).click(); await p.waitForTimeout(1200); await p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().click(); await p.waitForTimeout(500); }
  await toReview(p, amount, concept, ref); await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3500);
}
async function seedAndRestart(p, u, value) {
  const id = await uid(u);
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [`ss:wallet.transfer-recovery.${id}`, value]);
  p.reqs.length = 0; await p.reload(); await p.waitForTimeout(4500);
  return id;
}
const mkPayload = (u, amount, ref, extra = {}) => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amount, concept: 'H4', reference: ref, ...extra });

(async () => {
  const browser = await chromium.launch();
  const SEL = (process.env.ONLY || 'S1,S1b,S2,S3,S3b,S4,S5,S6').split(',');

  // S1: original F-21 (response lost AFTER it was applied, network down) + F-27 (no create on foreground)
  if (SEL.includes('S1')) { L('\n===== S1: F-21 original, respuesta perdida tras aplicarse; F-27 primer plano =====');
    const u = await mkUser('Sara Uno'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'S1', '8101');
    net.create = 'lost-after'; net.get = 'abort'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    net.create = 'abort'; await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2000);
    let a = await audit(p, 'S1 Home (sin red)'); await p.shot('S1-inicio-aviso');
    ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'Home: only the notice, no new-transfer entry');
    ok(/Descartar este intento/.test(a.t), 'discard offered for an attempt that could not be verified');
    net.create = 'pass'; net.get = 'pass'; const before = net.creates.length;
    await foreground(p); await foreground(p);
    L('creates sent by 2 foreground returns (network back):', net.creates.length - before, '| DB', rows(u.email));
    ok(net.creates.length - before === 0, 'F-27: 0 POST /transfers without a tap');
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(3500);
    const t = await p.shot('S1-verificado'); const b1 = await balances(u);
    L('after the tap: receipt', /Transferencia completada/.test(t), '| keys', JSON.stringify(net.creates), '| DB', rows(u.email), '|', dbLedger(u.email), '| principal debit', b0.checking - b1.checking);
    ok(cnt(u.email) === 1 && new Set(net.creates).size === 1 && b0.checking - b1.checking === 30025n, '1 transfer, 1 key, 1 debit of 30025');
    ok(Object.keys(await ls(p)).length === 0, 'record cleared once resolved');
    await p.context().close(); }

  // S1b: response lost BEFORE it was applied; the user reviews Movimientos and discards explicitly (F-26 c), then transfers once
  if (SEL.includes('S1b')) { L('\n===== S1b: respuesta perdida antes de aplicarse; revisar Movimientos y descartar =====');
    const u = await mkUser('Sara Dos'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'S1b', '8102');
    net.create = 'abort'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2000);
    net.create = 'pass'; const before = net.creates.length; await foreground(p); await foreground(p);
    L('DB after lost-before + 2 foreground returns with network back:', rows(u.email), '| creates without tap', net.creates.length - before);
    ok(cnt(u.email) === 0 && net.creates.length - before === 0, 'F-27: nothing created or debited without a tap');
    await tab(p, 'Movimientos'); const mv = await p.shot('S1b-movimientos-revisados'); L('Movimientos shows a -$300.25 charge:', /-\$300\.25/.test(mv)); await tab(p, 'Inicio');
    const snap = await ls(p);
    await p.btn('Descartar este intento').click(); await p.waitForTimeout(800);
    const dlg = await p.shot('S1b-dialogo-descartar'); ok(/¿Descartar este intento\?/.test(dlg) && /Revisa primero Movimientos: si el cargo aparece, la transferencia ya se realizó\. Descartar no la cancela ni la revierte\./.test(dlg), 'confirmation dialog with the warning');
    L('dialog role:', await p.getByRole('dialog').count(), 'aria-modal:', await p.locator('[aria-modal="true"]').count());
    await p.btn('Conservar intento').click(); await p.waitForTimeout(800);
    ok(JSON.stringify(await ls(p)) === JSON.stringify(snap) && /Transferencia en verificación/.test(await p.text()), 'Conservar keeps the record and the notice');
    await p.btn('Descartar este intento').click(); await p.waitForTimeout(800); await p.btn('Descartar intento').click(); await p.waitForTimeout(1500);
    const home = await p.shot('S1b-descartado'); ok(/Descartaste manualmente el seguimiento/.test(home) && Object.keys(await ls(p)).length === 0, 'discarded: note on Home and no record left');
    await sendOnce(p, '120.00', 'S1b nueva', '8103'); const b1 = await balances(u);
    L('new transfer after discard: receipt', /Transferencia completada/.test(await p.text()), '| DB', rows(u.email), '|', dbLedger(u.email), '| debit', b0.checking - b1.checking);
    ok(cnt(u.email) === 1 && b0.checking - b1.checking === 12000n, 'exactly one transfer and one debit after the discard');
    await p.context().close(); }

  // S2: E4 — 409 "en curso" on the retry after a response lost post-commit
  if (SEL.includes('S2')) { L('\n===== S2 (E4): 409 "en curso" en el reintento =====');
    const u = await mkUser('Eva Cuatro'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'E4', '7404');
    net.create = 'lost-after'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const snap = await ls(p);
    net.create = '409'; await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.shot('S2-E4-409-sigue-en-M09');
    ok(/Estamos verificando/.test(t) && !/No se pudo completar|Revisa tu saldo antes de reintentar/.test(t), 'retry 409 stays on M09 (uncertain), never M11');
    ok(JSON.stringify(await ls(p)) === JSON.stringify(snap), 'record kept byte-identical');
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    const a = await audit(p, 'S2 Home tras 409'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'Home offers no second attempt');
    net.create = 'pass'; await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(3500);
    const b1 = await balances(u); L('resolved: receipt', /Transferencia completada/.test(await p.text()), '| keys', JSON.stringify(net.creates), '| DB', rows(u.email), '|', dbLedger(u.email), '| debit', b0.checking - b1.checking);
    ok(cnt(u.email) === 1 && new Set(net.creates).size === 1 && b0.checking - b1.checking === 30025n, 'E4: 1 transfer, 1 debit');
    await p.context().close(); }

  // S3: (a) GET of a stored id answers a REAL 404 -> released, then exactly one transfer
  if (SEL.includes('S3')) { L('\n===== S3: GET 404 real del transferId guardado =====');
    const u = await mkUser('Eva Tres'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    const id = await uid(u);
    await seedAndRestart(p, u, JSON.stringify({ key: crypto.randomUUID(), payload: mkPayload(u, '33333', '5'), userId: id, transferId: crypto.randomUUID() }));
    const t = await p.shot('S3-404-liberado'); L('requests:', JSON.stringify(p.reqs.filter((r) => /transfers/.test(r))));
    ok(/El servidor no tiene registro de la operación de \$333\.33 MXN \(Ref: 5\)/.test(t) && Object.keys(await ls(p)).length === 0, 'released with a clear note; no record left');
    ok(net.creates.length === 0, 'releasing sends nothing');
    await sendOnce(p, '100.00', 'S3 nueva', '8301'); const b1 = await balances(u);
    L('new transfer: DB', rows(u.email), '| debit', b0.checking - b1.checking); ok(cnt(u.email) === 1 && b0.checking - b1.checking === 10000n, 'exactly one transfer after the release');
    await p.context().close(); }

  // S3b: replay of an attempt without id answers a REAL 404 (beneficiary not found) — only after the tap (F-27)
  if (SEL.includes('S3b')) { L('\n===== S3b: repetición con 404 real "Beneficiario no encontrado" =====');
    const u = await mkUser('Eva Tresb'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email);
    const id = await uid(u);
    await seedAndRestart(p, u, JSON.stringify({ key: crypto.randomUUID(), payload: mkPayload(u, '33333', '6', { beneficiaryId: crypto.randomUUID() }), userId: id }));
    await foreground(p);
    let a = await audit(p, 'S3b Home tras reinicio'); ok(net.creates.length === 0, 'F-27: restart + foreground send no create');
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.shot('S3b-404-beneficiario-M11'); L('after tap: creates', net.creates.length, '| M11', /No se pudo completar/.test(t), '| reason', /Beneficiario no encontrado/.test(t), '| record left', Object.keys(await ls(p)).length);
    ok(/Beneficiario no encontrado/.test(t) && Object.keys(await ls(p)).length === 0, 'definitive 404 on the replay releases the record');
    await p.btn('Volver al inicio').click(); await p.waitForTimeout(1500);
    a = await audit(p, 'S3b Home tras liberar'); ok(/Transferir dinero/.test(JSON.stringify(await names(p))), 'flow enabled again'); L('DB', rows(u.email));
    await p.context().close(); }

  // S4: (b) damaged record -> readable notice -> explicit discard -> one transfer
  if (SEL.includes('S4')) { L('\n===== S4: registro corrupto =====');
    const u = await mkUser('Tomas Corrupto'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email);
    await seedAndRestart(p, u, '{"key":"x","payload":');
    const a = await audit(p, 'S4 Home'); await p.shot('S4-registro-danado');
    ok(/Registro de transferencia dañado/.test(a.t) && !/Unexpected|JSON/.test(a.t) && a.bad.length === 0, 'plain-words notice, no parser text, no new-transfer entry');
    await p.btn('Descartar este intento').click(); await p.waitForTimeout(800); await p.btn('Descartar intento').click(); await p.waitForTimeout(1500);
    ok(Object.keys(await ls(p)).length === 0 && /Descartaste manualmente/.test(await p.text()), 'discarded');
    await sendOnce(p, '100.00', 'S4 nueva', '8401'); L('DB', rows(u.email)); ok(cnt(u.email) === 1, 'one transfer after the discard');
    await p.context().close(); }

  // S5: (d) unreadable secure store: fail closed at start-up and at confirm time; discard cannot delete -> says so
  if (SEL.includes('S5')) { L('\n===== S5: SecureStore ilegible =====');
    const u = await mkUser('Tomas Ilegible'); const p = await newPage(browser, { h: 929, init: () => { const wrap = () => { const s = window.__ss; if (!s || s.__h4) return; const g = s.get, d = s.del; s.get = async (k, o) => { if (localStorage.getItem('h4-unreadable') && String(k).startsWith('wallet.transfer-recovery')) throw new Error('SecureStore unavailable'); return g(k, o); }; s.del = async (k, o) => { if (localStorage.getItem('h4-unreadable') && String(k).startsWith('wallet.transfer-recovery')) throw new Error('SecureStore unavailable'); return d(k, o); }; s.__h4 = true; }; wrap(); setTimeout(wrap, 0); } });
    const net = { log: [], creates: [] }; await wire(p, net); await login(p, u.email);
    // at confirm time
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '100.00', 'S5', '8501');
    await p.evaluate(() => localStorage.setItem('h4-unreadable', '1'));
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2000);
    let t = await p.shot('S5-confirmar-ilegible'); ok(/No pudimos comprobar si tienes una transferencia en verificación/.test(t) && net.creates.length === 0, 'guard fails closed: message and 0 POST');
    // at start-up
    await p.reload(); await p.waitForTimeout(4500);
    const a = await audit(p, 'S5 Home ilegible'); await p.shot('S5-inicio-ilegible'); ok(/No pudimos comprobar tus transferencias/.test(a.t) && a.bad.length === 0, 'Home explains it and blocks new transfers');
    await p.btn('Descartar este intento').click(); await p.waitForTimeout(800); await p.btn('Descartar intento').click(); await p.waitForTimeout(1500);
    t = await p.shot('S5-descartar-fallido'); ok(/No pudimos descartar el registro en este dispositivo/.test(t) && !/Descartaste manualmente/.test(t), 'discard failure is reported, no fake success');
    await p.evaluate(() => localStorage.removeItem('h4-unreadable'));
    await p.btn('Reintentar comprobación').click(); await p.waitForTimeout(2500);
    L('store readable again -> Home buttons:', JSON.stringify(await names(p)));
    ok(/Transferir dinero|Continuar con transferencia/.test(JSON.stringify(await names(p))), 'store readable again: flow available (no record existed)');
    L('DB', rows(u.email)); await p.context().close(); }

  // S6: F-22 + logout keeps the record; B never touches A's record; A resumes by tap with the same key
  if (SEL.includes('S6')) { L('\n===== S6: F-22, cerrar sesión conserva, B no toca el registro de A =====');
    const A = await mkUser('Ana Prueba'); const B = await mkUser('Beto Prueba'); const p = await newPage(browser, { h: 929 }); const net = { log: [], creates: [] }; await wire(p, net); await login(p, A.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'A incierto', '7001');
    net.create = 'abort'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    const aKey = `ss:wallet.transfer-recovery.${await uid(A)}`; const snapA = (await ls(p))[aKey]; const recKey = JSON.parse(snapA).key.slice(0, 8);
    await logout(p); ok((await ls(p))[aKey] === snapA, 'A logout keeps A record byte-identical');
    net.create = 'pass'; p.reqs.length = 0; await login(p, B.email);
    let a = await audit(p, 'S6 B Home'); ok(!/Transferencia en verificación/.test(a.t), 'B does not see A notice');
    L('B requests on /transfers during login:', p.reqs.filter((r) => /\/transfers/.test(r)).length);
    await sendOnce(p, '150.00', 'B normal', '7002'); ok((await ls(p))[aKey] === snapA, 'A record unchanged after B transferred');
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); await logout(p);
    ok((await ls(p))[aKey] === snapA, 'B logout did not delete/replace A record');
    const before = net.creates.length; await login(p, A.email); await p.waitForTimeout(2000);
    a = await audit(p, 'S6 A vuelve'); ok(/Transferencia en verificación/.test(a.t) && net.creates.length === before, 'A sees the notice; no create sent without a tap (F-27)');
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(3500);
    const keys = net.creates.slice(before); L('A tap: receipt', /Transferencia completada/.test(await p.text()), '| keys', JSON.stringify(keys), 'same as stored', keys[0] === recKey, '| A', rows(A.email), '|', dbLedger(A.email), '| B', rows(B.email));
    ok(cnt(A.email) === 1 && cnt(B.email) === 1 && keys.length === 1 && keys[0] === recKey, 'A resumed with the same key; 1 transfer each');
    await p.context().close(); }

  await browser.close(); flush(process.env.LOGNAME2 || 'logs/ui-h4.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
