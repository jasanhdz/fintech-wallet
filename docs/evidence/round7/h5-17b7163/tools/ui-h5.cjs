// Round 7 · H5: recovery of an uncertain attempt on the real exported RN-Web bundle + isolated API (wallet_test, :3971).
// "Lost" responses and the 409 "en curso" are simulated with page.route (the request reaches the real server and its answer
// is dropped, or it never leaves, or it is answered with the API's real 409 body); every 404 is a REAL API answer.
// Below the OTP threshold unless stated. DB checks: 1 row, ledger rows sum 0, exactly one debit of the source account.
// Usage: EV_OUT=<evidence dir> EV_TEST_PASSWORD=<test value> ONLY=A,B,... node tools/ui-h5.cjs
const { chromium, L, ok, call, mkUser, balances, dbLedger, newPage, login, origin, choose, toReview, flush, psql, crypto } = require('./lib.cjs');
const FORBID = /Continuar con transferencia|Elegir otro destinatario|Cambiar beneficiario|Transferir dinero|Elegir beneficiario|Descartar/;
const RESEND = 'Reenviar la misma transferencia';
function wire(p, net) {
  return p.route('**/v1/transfers**', async (route) => {
    const r = route.request(); const m = r.method(); const u = new URL(r.url()).pathname.replace('/v1', '');
    const kind = m === 'POST' && u === '/transfers' ? 'create' : m === 'GET' && /^\/transfers\/[0-9a-f-]{36}$/.test(u) ? 'get' : null;
    if (!kind) return route.continue();
    const mode = net[kind] || 'pass'; net.log.push(`${kind}:${mode}`);
    if (kind === 'create') { net.creates.push((r.headers()['idempotency-key'] || '-').slice(0, 8)); net.bodies.push(r.postData() || ''); }
    if (mode === 'pass') return route.continue();
    if (mode === 'abort') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    if (mode === '409') return route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'La solicitud idempotente está en curso; reintenta con la misma llave.' }) });
    return route.continue();
  });
}
const newNet = () => ({ log: [], creates: [], bodies: [] });
const names = async (p) => (await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\n/g, ' ').slice(0, 50)))).filter(Boolean);
async function audit(p, label) { const t = await p.text(); const b = await names(p); const bad = b.filter((n) => FORBID.test(n)); L(`AUDIT ${label}: notice=${/Transferencia (en verificación|pendiente de autorizar)|No pudimos recuperar|No pudimos comprobar tus transferencias/.test(t)} forbidden=${JSON.stringify(bad)} | buttons=${JSON.stringify(b.map((x) => x.slice(0, 40)))}`); return { t, bad, b }; }
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
const ls = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')).map((k) => [k, localStorage.getItem(k)])));
const cnt = (email) => Number(psql(`select count(*) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`));
const rows = (email) => psql(`select coalesce(string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at),'(none)') from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
const debits = (email, accountId) => psql(`select count(*)||' debit(s) total '||coalesce(-sum(le.signed_amount_minor),0) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${email}' and le.account_id='${accountId}' and le.signed_amount_minor<0`);
const uid = async (u) => (await call(u.token, '/auth/me')).b.id;
const logout = async (p) => { await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); };
const has = async (p, name) => (await p.getByRole('button', { name, exact: true }).count()) > 0;
const tab = async (p, name) => { await p.getByRole('tab', { name }).first().click(); await p.waitForTimeout(1500); };
const resendOpen = async (p) => { await p.btn(RESEND).click(); await p.waitForTimeout(1200); };
const resendConfirm = async (p) => { await p.btn(RESEND).click(); await p.waitForTimeout(3500); };
// Button names carry the icon glyph first; compare the visible title.
const hasName = (list, title) => list.some((x) => x.trim().endsWith(title));
async function sendOnce(p, amount, concept, ref) {
  if (await has(p, 'Transferir dinero, elegir beneficiario')) { await p.getByRole('button', { name: 'Transferir dinero, elegir beneficiario' }).click(); await p.waitForTimeout(1200); await p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().click(); await p.waitForTimeout(500); }
  await toReview(p, amount, concept, ref); await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3500);
}
async function seedAndRestart(p, u, value) {
  const id = await uid(u);
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [`ss:wallet.transfer-recovery.${id}`, value]);
  p.reqs.length = 0; await p.reload(); await p.waitForTimeout(4500);
  return id;
}
const mkPayload = (u, amount, ref, extra = {}) => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amount, concept: 'H5', reference: ref, ...extra });
const consentNow = () => ({ confirmedAt: new Date().toISOString(), via: 'confirm', otp: 'unknown' });
function dbOk(u, b0, b1, amount, label) {
  const n = cnt(u.email); const led = dbLedger(u.email); const deb = debits(u.email, u.pr.id); const diff = b0.checking - b1.checking;
  L(`DB ${label}: rows=${rows(u.email)} | ledger ${led} | ${deb} | principal debit ${diff}`);
  ok(n === 1 && /^2 rows sum 0$/.test(led) && /^1 debit\(s\) total /.test(deb) && diff === BigInt(amount), `${label}: 1 transfer, 2 ledger rows summing 0, exactly one debit of ${amount}`);
}

(async () => {
  const browser = await chromium.launch();
  const SEL = (process.env.ONLY || 'A,B,C,C2,D,D2,E,E2,F').split(',');

  // (a) response lost AFTER it was applied (no transferId): verify creates nothing and the record stays (a matching charge in
  // Movimientos is not proof); the consented resend with the same key returns the SAME folio -> receipt, one row, one debit
  if (SEL.includes('A')) { L('\n===== A: respuesta perdida tras aplicarse; Verificar no crea ni resuelve; reenvío con la misma llave -> mismo folio =====');
    const u = await mkUser('Ana Aplicada'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'A aplicada', '8201');
    net.create = 'lost-after'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    let t = await p.shot('A-M09-respuesta-perdida'); ok(/Estamos verificando/.test(t) && !/No se pudo completar|Tu dinero está intacto/.test(t), 'M09 without any claim');
    const appliedId = psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}'`);
    L('DB right after the lost response:', rows(u.email), '| applied id', appliedId.slice(0, 8));
    const snap = await ls(p); net.create = 'pass';
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    t = await p.shot('A-M09-verificar-sin-id');
    ok(net.creates.length === 1 && /no podemos consultarla/.test(t) && /una coincidencia no prueba que sea este intento/.test(t) && !/Transferencia completada/.test(t), 'M09 "Verificar": 0 POST, no receipt, caveat about Movimientos');
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2500);
    await foreground(p);
    const a = await audit(p, 'A Home'); await p.shot('A-inicio-aviso');
    ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t) && /una coincidencia no prueba que sea este intento/.test(a.t), 'Home: notice only (no new transfer, no discard) and the Movimientos caveat');
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    await tab(p, 'Movimientos'); const mv = await p.shot('A-movimientos-informativo'); L('Movimientos shows the -$300.25 charge:', /-\$300\.25/.test(mv)); await tab(p, 'Inicio');
    ok(JSON.stringify(await ls(p)) === JSON.stringify(snap) && net.creates.length === 1 && /Transferencia en verificación/.test(await p.text()), 'after Verificar (M09+Home), foreground and Movimientos: record byte-identical, still 0 new POST, not resolved by the matching charge');
    await resendOpen(p); await resendConfirm(p); t = await p.shot('A-reenvio-mismo-folio'); const b1 = await balances(u);
    L('resend: keys', JSON.stringify(net.creates), '| same body', net.bodies[0] === net.bodies[1], '| receipt', /Transferencia completada/.test(t), '| same folio as applied', t.includes(appliedId));
    ok(net.creates.length === 2 && net.creates[0] === net.creates[1] && net.bodies[0] === net.bodies[1] && /Transferencia completada/.test(t) && t.includes(appliedId), 'same-key resend returned the SAME transfer (folio) already applied');
    dbOk(u, b0, b1, 30025, 'A'); ok(Object.keys(await ls(p)).length === 0, 'record released only by the server result of the same key');
    L('page errors (simulated network drops):', JSON.stringify(p.errs));
    await p.context().close(); }

  // (b) response lost BEFORE it was applied (no id) -> verify creates nothing -> explicit resend with the same key -> 1 transfer
  if (SEL.includes('B')) { L('\n===== B: respuesta perdida antes de aplicarse; consultar no crea; reenvío explícito =====');
    const u = await mkUser('Beto Antes'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'B antes', '8202');
    net.create = 'abort'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    net.create = 'pass'; const snap = await ls(p);
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    let t = await p.shot('B-M09-verificar-sin-id');
    ok(net.creates.length === 1 && cnt(u.email) === 0 && /no podemos consultarla/.test(t) && /una coincidencia no prueba que sea este intento/.test(t), 'verify: 0 POST, DB 0 rows, says it cannot confirm');
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    await foreground(p); await foreground(p); await tab(p, 'Movimientos'); await tab(p, 'Inicio');
    ok(net.creates.length === 1 && cnt(u.email) === 0, 'F-27: 2 foreground returns + Home shown again with the network back: 0 POST, DB 0 rows');
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    ok(net.creates.length === 1, 'Home "Verificar": 0 POST');
    await resendOpen(p); t = await p.shot('B-reenvio-datos-originales');
    ok(/\$300\.25/.test(t) && /Cuenta Principal •• \d{4}/i.test(t) && /Cuenta de ahorro demo/.test(t) && /B antes/.test(t) && /8202/.test(t) && /Confirmaste esta transferencia el/.test(t) && net.creates.length === 1, 'resend review shows the original data and consent; opening it sends nothing');
    await p.btn('Volver sin reenviar').click(); await p.waitForTimeout(1200);
    ok(JSON.stringify(await ls(p)) === JSON.stringify(snap) && net.creates.length === 1, '"Volver sin reenviar": record identical, 0 POST');
    await resendOpen(p); await resendConfirm(p); t = await p.shot('B-reenviado-comprobante'); const b1 = await balances(u);
    L('resend: keys', JSON.stringify(net.creates), '| same body', net.bodies[0] === net.bodies[1], '| receipt', /Transferencia completada/.test(t));
    ok(net.creates.length === 2 && net.creates[0] === net.creates[1] && net.bodies[0] === net.bodies[1] && /Transferencia completada/.test(t), 'the confirmed resend sent exactly the original key and body');
    dbOk(u, b0, b1, 30025, 'B');
    await p.context().close(); }

  // (c) 409 "en curso" (real API body) on the resend after a response lost post-commit -> stays in verification; no second attempt
  if (SEL.includes('C')) { L('\n===== C: 409 "en curso" en el reenvío =====');
    const u = await mkUser('Carla Curso'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'C curso', '8203');
    net.create = 'lost-after'; net.get = 'pass'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const snap = await ls(p);
    net.create = '409'; await resendOpen(p); await resendConfirm(p);
    let t = await p.shot('C-409-sigue-en-M09');
    ok(/Estamos verificando/.test(t) && /en curso/.test(t) && !/No se pudo completar|Revisa tu saldo antes de reintentar|Tu dinero está intacto/.test(t), '409 keeps M09 (never M11)');
    ok(JSON.stringify(await ls(p)) === JSON.stringify(snap), 'record byte-identical');
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2500);
    const a = await audit(p, 'C Home tras 409'); await p.shot('C-inicio-tras-409');
    ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t) && JSON.stringify(await ls(p)) === JSON.stringify(snap), 'Home: notice only, no path to a second attempt, record identical');
    net.create = 'pass'; await resendOpen(p); await resendConfirm(p);
    t = await p.shot('C-resuelto'); const b1 = await balances(u);
    L('keys', JSON.stringify(net.creates), '| receipt', /Transferencia completada/.test(t));
    ok(new Set(net.creates).size === 1, 'only the original key was ever sent'); dbOk(u, b0, b1, 30025, 'C');
    await p.context().close(); }

  // (c2) 409 "en curso" on the FIRST send (simulated; nothing reaches the server) -> verification, record kept; resend -> 1 transfer
  if (SEL.includes('C2')) { L('\n===== C2: 409 "en curso" en el primer envío =====');
    const u = await mkUser('Carla Primero'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'C2 primero', '8204');
    net.create = '409'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    let t = await p.shot('C2-primer-envio-409'); const snap = await ls(p);
    ok(/Estamos verificando/.test(t) && !/No se pudo completar|Revisa tu saldo/.test(t) && Object.keys(snap).length === 1, 'first send 409: M09, record kept');
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2500);
    const a = await audit(p, 'C2 Home'); ok(a.bad.length === 0 && JSON.stringify(await ls(p)) === JSON.stringify(snap), 'Home blocked, record identical');
    net.create = 'pass'; await resendOpen(p); await resendConfirm(p); const b1 = await balances(u);
    ok(new Set(net.creates).size === 1 && /Transferencia completada/.test(await p.text()), 'resend with the same key completes'); dbOk(u, b0, b1, 30025, 'C2');
    await p.context().close(); }

  // (d) REAL GET 404 of a stored transferId -> record kept, no release; resend with the same key -> exactly one transfer
  if (SEL.includes('D')) { L('\n===== D: GET 404 real; se conserva; reenvío idempotente =====');
    const u = await mkUser('Dora Cuatro'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    const id = await uid(u); const key = crypto.randomUUID();
    const value = JSON.stringify({ key, payload: mkPayload(u, '33333', '5'), userId: id, transferId: crypto.randomUUID(), consent: consentNow() });
    await seedAndRestart(p, u, value);
    await foreground(p);
    let a = await audit(p, 'D Home 404'); await p.shot('D-404-conservado');
    L('requests:', JSON.stringify(p.reqs.filter((r) => /transfers/.test(r))));
    ok(/El servidor no encuentra esta operación\. No podemos confirmar si se realizó un cargo: revisa Movimientos y tu saldo\./.test(a.t) && !/El servidor no tiene registro|Ya puedes hacer otra transferencia/.test(a.t), 'GET 404: explained without claiming anything');
    ok((await ls(p))[`ss:wallet.transfer-recovery.${id}`] === value && a.bad.length === 0 && net.creates.length === 0, 'record byte-identical, still blocked, 0 POST');
    ok(hasName(a.b, 'Verificar de nuevo') && hasName(a.b, 'Ver movimientos') && hasName(a.b, RESEND), 'actions: Verificar de nuevo, Ver movimientos, Reenviar la misma transferencia');
    await p.btn('Verificar de nuevo').click(); await p.waitForTimeout(2000); ok(net.creates.length === 0 && (await ls(p))[`ss:wallet.transfer-recovery.${id}`] === value, '"Verificar de nuevo" only reads');
    await resendOpen(p); await resendConfirm(p); const b1 = await balances(u);
    ok(net.creates.length === 1 && net.creates[0] === key.slice(0, 8) && /Transferencia completada/.test(await p.text()), 'resend sent the stored key -> completed');
    dbOk(u, b0, b1, 33333, 'D');
    await p.context().close(); }

  // (d2) GET 404 but the key WAS already applied (wrong stored id): the resend returns that same transfer -> still one debit
  if (SEL.includes('D2')) { L('\n===== D2: GET 404 con la llave ya aplicada: el reenvío devuelve la misma transferencia =====');
    const u = await mkUser('Dora Aplicada'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    const id = await uid(u); const key = crypto.randomUUID(); const payload = mkPayload(u, '44444', '6');
    const applied = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload) });
    L('applied directly through the API with the stored key:', applied.s, applied.b?.status, '| DB', rows(u.email));
    await seedAndRestart(p, u, JSON.stringify({ key, payload, userId: id, transferId: crypto.randomUUID(), consent: consentNow() }));
    ok(/El servidor no encuentra esta operación/.test(await p.text()), 'GET 404 shown');
    await resendOpen(p); await resendConfirm(p); const t = await p.shot('D2-reenvio-devuelve-la-misma'); const b1 = await balances(u);
    ok(/Transferencia completada/.test(t) && t.includes(applied.b.id), 'resend returned the transfer already applied with that key (same folio)');
    dbOk(u, b0, b1, 44444, 'D2');
    await p.context().close(); }

  // (e) damaged record: blocked with an explanation, 0 POST, never deleted
  if (SEL.includes('E')) { L('\n===== E: registro corrupto =====');
    const u = await mkUser('Elena Corrupto'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, u.email);
    const id = await seedAndRestart(p, u, '{"key":"x","payload":');
    const a = await audit(p, 'E Home'); await p.shot('E-registro-danado');
    ok(/No pudimos recuperar los datos de una transferencia en verificación/.test(a.t) && /No sabemos si se realizó un cargo; no vuelvas a enviar hasta revisar Movimientos/.test(a.t) && !/Unexpected|JSON|SyntaxError/.test(a.t), 'plain-language explanation, no technical text');
    ok(a.bad.length === 0 && !hasName(a.b, RESEND) && hasName(a.b, 'Reintentar lectura') && hasName(a.b, 'Ver movimientos'), 'no new transfer, no resend, no discard; Reintentar lectura + Ver movimientos');
    await p.btn('Reintentar lectura').click(); await p.waitForTimeout(2000); await p.btn('Ver movimientos').click(); await p.waitForTimeout(1500); await tab(p, 'Inicio');
    ok((await ls(p))[`ss:wallet.transfer-recovery.${id}`] === '{"key":"x","payload":' && net.creates.length === 0 && cnt(u.email) === 0, 'record never deleted, 0 POST, DB 0 rows');
    await p.context().close(); }

  // (e2) unreadable SecureStore: guard fails closed, Home blocked, "Reintentar lectura" unblocks once it can be read
  if (SEL.includes('E2')) { L('\n===== E2: SecureStore ilegible =====');
    const u = await mkUser('Elena Ilegible'); const p = await newPage(browser, { h: 929, init: () => { const wrap = () => { const s = window.__ss; if (!s || s.__h5) return; const g = s.get, d = s.del; s.get = async (k, o) => { if (localStorage.getItem('h5-unreadable') && String(k).startsWith('wallet.transfer-recovery')) throw new Error('SecureStore unavailable'); return g(k, o); }; s.del = async (k, o) => { if (localStorage.getItem('h5-unreadable') && String(k).startsWith('wallet.transfer-recovery')) throw new Error('SecureStore unavailable'); return d(k, o); }; s.__h5 = true; }; wrap(); setTimeout(wrap, 0); } });
    const net = newNet(); await wire(p, net); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '100.00', 'E2', '8205');
    await p.evaluate(() => localStorage.setItem('h5-unreadable', '1'));
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2000);
    let t = await p.shot('E2-confirmar-ilegible'); ok(/No pudimos comprobar si tienes una transferencia en verificación/.test(t) && net.creates.length === 0, 'guard fails closed: message and 0 POST');
    await p.reload(); await p.waitForTimeout(4500);
    const a = await audit(p, 'E2 Home ilegible'); await p.shot('E2-inicio-ilegible');
    ok(/No pudimos comprobar tus transferencias/.test(a.t) && a.bad.length === 0 && hasName(a.b, 'Reintentar lectura'), 'Home explains it and blocks; no discard');
    await p.btn('Reintentar lectura').click(); await p.waitForTimeout(2000); ok(/No pudimos comprobar tus transferencias/.test(await p.text()), 'still unreadable -> still blocked');
    await p.evaluate(() => localStorage.removeItem('h5-unreadable')); await p.btn('Reintentar lectura').click(); await p.waitForTimeout(2500);
    ok(/Transferir dinero|Continuar con transferencia/.test(JSON.stringify(await names(p))), 'readable again (no record): flow available');
    ok(net.creates.length === 0 && cnt(u.email) === 0, '0 POST, DB 0 rows');
    await p.context().close(); }

  // (f) F-22 / logout: A's record survives A's logout and B's whole session; A resumes by the explicit resend, same key
  if (SEL.includes('F')) { L('\n===== F: F-22, cerrar sesión conserva, B no toca el registro de A =====');
    const A = await mkUser('Ana Prueba'); const B = await mkUser('Beto Prueba'); const p = await newPage(browser, { h: 929 }); const net = newNet(); await wire(p, net); await login(p, A.email);
    const a0 = await balances(A); const bb0 = await balances(B);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'A incierto', '7001');
    net.create = 'abort'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    const aKey = `ss:wallet.transfer-recovery.${await uid(A)}`; const snapA = (await ls(p))[aKey]; const recKey = JSON.parse(snapA).key.slice(0, 8);
    await logout(p); ok((await ls(p))[aKey] === snapA, 'A logout keeps A record byte-identical');
    net.create = 'pass'; p.reqs.length = 0; await login(p, B.email);
    let a = await audit(p, 'F B Home'); ok(!/Transferencia en verificación/.test(a.t), 'B does not see A notice');
    L('B requests on /transfers during login:', p.reqs.filter((r) => /\/transfers/.test(r)).length);
    await sendOnce(p, '150.00', 'B normal', '7002'); ok((await ls(p))[aKey] === snapA, 'A record unchanged after B transferred');
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); await logout(p);
    ok((await ls(p))[aKey] === snapA, 'B logout did not delete/replace A record');
    const before = net.creates.length; await login(p, A.email); await p.waitForTimeout(2000);
    a = await audit(p, 'F A vuelve'); ok(/Transferencia en verificación/.test(a.t) && net.creates.length === before, 'A sees the notice; 0 POST on sign-in');
    await resendOpen(p); await resendConfirm(p);
    const keys = net.creates.slice(before); L('A resend: receipt', /Transferencia completada/.test(await p.text()), '| keys', JSON.stringify(keys), 'same as stored', keys[0] === recKey);
    ok(keys.length === 1 && keys[0] === recKey, 'A resumed with the same key');
    dbOk(A, a0, await balances(A), 30025, 'F/A'); dbOk(B, bb0, await balances(B), 15000, 'F/B');
    await p.context().close(); }

  await browser.close(); flush(process.env.LOGNAME2 || 'logs/ui-h5.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
