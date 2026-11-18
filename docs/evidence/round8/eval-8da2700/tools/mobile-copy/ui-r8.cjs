// Round 8 · G-B (R8-21 [W], R8-20 [W]): authoritative recovery on the exported RN-Web bundle + isolated API (:3971) on
// wallet_test. Lost responses are simulated with page.route: "abort" = the request never leaves; "lost-after" = it reaches the
// real server, which answers, and the answer is dropped; "held" = it is forwarded to the real server outside the page (it
// keeps running there) and the page sees a dropped connection. Every 404/409/void/void-all answer is a REAL API answer.
// Usage: EV_OUT=<evidence dir> EV_TEST_PASSWORD=<test value> ONLY=A,B,... node tools/ui-r8.cjs
const { chromium, spawn, DB, L, ok, fp, call, mkUser, otherSession, balances, db, dbReport, newPage, login, origin, choose, toReview, flush, API, crypto, failures } = require('./lib.cjs');
const RESEND = 'Reenviar la misma transferencia';
const VOID = 'Anular esta transferencia';
const NEW_ENTRY = 'Transferir dinero, elegir beneficiario';
const VOIDED_TEXT = 'Transferencia anulada. No se realizó ningún cargo por esta operación.';
const VOID_CONFIRM = 'Si ya se aplicó, te mostraremos su resultado y no se cancelará el cargo. Si no se aplicó, quedará anulada y ya no podrá aplicarse aunque llegue después.';
const NO_CHARGE = /No se realizó ningún cargo|Tu dinero está intacto|Ningún dinero fue retirado|No se movió dinero/;
const FORBIDDEN_TEXT = /No la envíes de nuevo|No intentes enviar el dinero nuevamente|Podrás hacer otra transferencia cuando conozcamos su resultado/;

function wire(p, net) {
  return p.route('**/v1/transfers', async (route) => {
    const r = route.request();
    if (r.method() !== 'POST') return route.continue();
    const h = r.headers();
    net.creates.push({ key: fp(h['idempotency-key']), attempt: h['transfer-attempt-id'] || '-', epoch: h['transfer-send-epoch'] || '-', body: r.postData() || '' });
    net.captured = { headers: { 'content-type': 'application/json', authorization: h.authorization, 'idempotency-key': h['idempotency-key'], 'transfer-attempt-id': h['transfer-attempt-id'], 'transfer-send-epoch': h['transfer-send-epoch'] }, body: r.postData() || '' };
    const mode = net.create || 'pass'; net.log.push(`create:${mode}`);
    if (mode === 'pass') return route.continue();
    if (mode === 'abort') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    if (mode === 'held') {
      const started = Date.now();
      net.held = fetch(`${API}/transfers`, { method: 'POST', headers: net.captured.headers, body: net.captured.body }).then(async (res) => { const b = await res.json().catch(() => null); net.heldResult = { status: res.status, ms: Date.now() - started, id: b && b.id, state: b && b.status }; return net.heldResult; });
      return route.abort('connectionreset');
    }
    return route.continue();
  });
}
const newNet = () => ({ log: [], creates: [] });
// The late arrival of a captured send (same key, identity, epoch and body), straight to the API.
const replay = async (net) => { const res = await fetch(`${API}/transfers`, { method: 'POST', headers: net.captured.headers, body: net.captured.body }); const b = await res.json().catch(() => null); return { s: res.status, type: b && b.type, id: b && b.id }; };
const has = async (p, name) => (await p.getByRole('button', { name, exact: false }).count()) > 0;
// Home offers a new transfer through "Transferir dinero" or, when a destination is kept, "Continuar con transferencia".
const blocked = async (p) => !(await has(p, NEW_ENTRY)) && !(await has(p, 'Continuar con transferencia'));
const recs = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')).map((k) => [k, localStorage.getItem(k)])));
const own = async (p, u) => { const v = (await recs(p))[`ss:wallet.transfer-recovery.${u.id}`]; try { return v ? JSON.parse(v) : null; } catch { return v ? { damaged: true } : null; } };
const click = async (p, name, ms = 2500) => { await p.btn(name).click(); await p.waitForTimeout(ms); };
const toHome = async (p) => { if (await has(p, 'Ir al inicio (revisar saldo después)')) await click(p, 'Ir al inicio (revisar saldo después)'); };
const tab = async (p, name) => { await p.getByRole('tab', { name }).first().click(); await p.waitForTimeout(1500); };
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
const writes = (p, from = 0) => p.reqs.slice(from).filter((r) => /^POST \/(transfers|transfer-attempts)/.test(r));
async function start(p, amount, concept, ref) { await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, amount, concept, ref); }
async function restart(p) { p.reqs.length = 0; await p.reload(); await p.waitForTimeout(5000); }
const payloadOf = (u, amount, ref, concept = 'R8') => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amount, concept, reference: ref });
const policyEpoch = async (u) => (await call(u.token, '/transfer-policy')).b.sendEpoch;
const send = (u, payload, { key = crypto.randomUUID(), attemptId, epoch } = {}) => call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': key, ...(attemptId ? { 'Transfer-Attempt-Id': attemptId, 'Transfer-Send-Epoch': epoch } : {}) }, body: JSON.stringify(payload) });
async function seed(p, u, value, slot) { await p.evaluate(([k, v]) => localStorage.setItem(k, v), [slot || `ss:wallet.transfer-recovery.${u.id}`, value]); }

(async () => {
  const browser = await chromium.launch();
  const SEL = (process.env.ONLY || 'A,B,C,D,E,F,G,H,J,K').split(',');

  if (SEL.includes('A')) { L('\n===== A: respuesta perdida DESPUÉS de aplicarse; Verificar lee GET /transfer-attempts?attemptId= y resuelve =====');
    const u = await mkUser('Ana Aplicada'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await start(p, '300.25', 'A aplicada', '8301');
    net.create = 'lost-after'; await click(p, 'Confirmar transferencia');
    let t = await p.shot('A-M09-respuesta-perdida'); const r = await own(p, u);
    ok(/Estamos verificando/.test(t) && !NO_CHARGE.test(t) && !FORBIDDEN_TEXT.test(t), 'M09 without claims and without the retired sentences');
    ok(r && r.v === 2 && /^[0-9a-f-]{36}$/.test(r.attemptId) && r.sendEpoch === net.creates[0].epoch && fp(r.key) === net.creates[0].key && r.attemptId === net.creates[0].attempt, 'record v2 matches the three headers of the POST');
    ok(db.byAttempt(u, r.attemptId) === 1, 'DB: the server applied it (1 transfer with that attempt id)');
    ok(await blocked(p) && !!(await own(p, u)), 'no way to a new transfer while unresolved (record kept)');
    const mark = p.reqs.length; await click(p, 'Verificar estado de la transferencia', 3500);
    t = await p.shot('A-verificar-resuelve');
    L('requests of "Verificar":', JSON.stringify(p.reqs.slice(mark)));
    ok(p.reqs.slice(mark).some((x) => x.startsWith(`GET /transfer-attempts?attemptId=${r.attemptId.slice(0, 8)}`)) && writes(p, mark).length === 0, '"Verificar": GET /transfer-attempts?attemptId= then GET of the transfer; 0 writes');
    ok(/Transferencia completada/.test(t) && !(await own(p, u)), 'receipt from the server result; record released');
    await click(p, 'Ir al inicio'); ok(!(await blocked(p)), '"Transferir" is back only after the terminal result + deletion');
    const b1 = await balances(u); L('principal debit', (b0.checking - b1.checking).toString());
    const rep = dbReport(u, 'A'); ok(db.count(u) === 1 && db.debitCount(u) === 1 && b0.checking - b1.checking === 30025n && rep.closures === '(none)', 'A: 1 transfer, 1 debit of 30025, no closure');
    await p.context().close(); }

  if (SEL.includes('B')) { L('\n===== B: respuesta perdida ANTES de aplicarse; Verificar no envía; Reenviar (misma identidad) =====');
    const u = await mkUser('Beto Antes'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await start(p, '300.25', 'B antes', '8302');
    net.create = 'abort'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    const r = await own(p, u); const mark = p.reqs.length;
    await click(p, 'Verificar estado de la transferencia');
    let t = await p.shot('B-M09-no-registrada');
    ok(/El servidor aún no registra esta operación/.test(t) && !NO_CHARGE.test(t) && writes(p, mark).length === 0 && db.count(u) === 0, 'Verificar: list empty -> explained, 0 writes, DB 0 transfers');
    ok(await has(p, VOID) && await has(p, RESEND), 'Anular and Reenviar are offered');
    await toHome(p); await foreground(p); await foreground(p); await tab(p, 'Movimientos'); await tab(p, 'Inicio');
    ok(await blocked(p) && writes(p, mark).length === 0, 'foreground x2 + Home again: 0 POST, 0 void, 0 void-all; still blocked');
    t = await p.shot('B-inicio-aviso'); ok(/No hagas otra transferencia igual/.test(t) && /Podrás hacer otra transferencia cuando esta quede resuelta\./.test(t) && !FORBIDDEN_TEXT.test(t), 'F-30 texts on Home');
    await click(p, RESEND, 1500);
    const consent = await p.getByTestId('resend-consent').boundingBox(); const primary = await p.getByRole('button', { name: RESEND }).first().boundingBox();
    const gap = Math.round(primary.y - (consent.y + consent.height)); await p.shot('B-reenvio-revision');
    L(`resend review 390x929: consent ${Math.round(consent.y)}..${Math.round(consent.y + consent.height)}, primary button top ${Math.round(primary.y)} -> gap ${gap} px`);
    ok(gap >= 12, `F-30 (d): >= 12 px between the consent box and the main button (${gap} px)`);
    await click(p, RESEND, 3500); t = await p.shot('B-reenviado');
    L('creates', JSON.stringify(net.creates.map((c) => ({ key: c.key, attempt: c.attempt.slice(0, 8), epoch: c.epoch }))));
    ok(net.creates.length === 2 && net.creates[0].key === net.creates[1].key && net.creates[0].attempt === net.creates[1].attempt && net.creates[0].epoch === net.creates[1].epoch && net.creates[0].body === net.creates[1].body && r.attemptId === net.creates[1].attempt, 'the resend sent the same key, identity, epoch and body bytes');
    ok(/Transferencia completada/.test(t) && !(await own(p, u)), 'receipt; released');
    const b1 = await balances(u); dbReport(u, 'B'); ok(db.count(u) === 1 && b0.checking - b1.checking === 30025n, 'B: 1 transfer, 1 debit');
    await p.context().close(); }

  if (SEL.includes('C')) { L('\n===== C: recarga de la app (arranque) con respuesta perdida, aplicada y no aplicada =====');
    const u = await mkUser('Cata Recarga'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email);
    await start(p, '120.00', 'C aplicada', '8303');
    net.create = 'lost-after'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    const r1 = await own(p, u);
    await restart(p); let t = await p.shot('C-recarga-aplicada');
    L('start-up requests:', JSON.stringify(p.reqs));
    ok(writes(p).length === 0, 'start-up: 0 POST /transfers, 0 void, 0 void-all');
    ok(/Transferencia completada/.test(t) && !(await own(p, u)) && db.byAttempt(u, r1.attemptId) === 1, 'start-up + Home read the list by identity and resolved it (receipt); released');
    await click(p, 'Ir al inicio');
    await start(p, '80.00', 'C no aplicada', '8304');
    net.create = 'abort'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    await restart(p); t = await p.shot('C-recarga-no-aplicada');
    ok(writes(p).length === 0 && await blocked(p) && /El servidor aún no registra esta operación/.test(t) && !NO_CHARGE.test(t), 'reload with a never-arrived send: only reads, explained, blocked');
    await foreground(p); await foreground(p); await foreground(p);
    ok(writes(p).length === 0, 'foreground x3: 0 writes');
    dbReport(u, 'C'); ok(db.count(u) === 1, 'C: one transfer (the applied one)');
    await p.context().close(); }

  if (SEL.includes('D')) { L('\n===== D: registro dañado -> Resolver con el servidor -> void-all -> listado -> desbloqueo =====');
    const u = await mkUser('Dora Dañada'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email);
    const e0 = await policyEpoch(u);
    const pending = await send(u, payloadOf(u, '600000', '8305', 'D pendiente'), { attemptId: crypto.randomUUID(), epoch: e0 });
    L('pending with code (API, other client):', pending.s, pending.b && pending.b.status);
    const late = { key: crypto.randomUUID(), attemptId: crypto.randomUUID(), epoch: e0 };
    await seed(p, u, '{"v":2,"attemptId":"' + late.attemptId + '","key":"' + late.key + '","sendEpo'); await restart(p);
    let t = await p.shot('D-inicio-danado');
    ok(/No pudimos recuperar los datos de una transferencia en verificación/.test(t) && await blocked(p) && !(await has(p, RESEND)), 'damaged: explained, blocked, no resend');
    ok(writes(p).length === 0, 'start-up: no void-all on its own');
    const mark = p.reqs.length; await click(p, 'Resolver con el servidor', 2500);
    t = await p.shot('D-resolver-listado');
    ok(/también se detienen las transferencias aún no aplicadas enviadas desde otros dispositivos y se cancelan las pendientes de código/.test(t) && /Pendiente de código/.test(t) && writes(p, mark).length === 0, 'Resolver: lists (pending with code shown) and explains; nothing written yet');
    await click(p, 'Anular pendientes y desbloquear', 3500); t = await p.shot('D-resuelto');
    L('requests:', JSON.stringify(p.reqs.slice(mark)));
    const seq = p.reqs.slice(mark).filter((x) => /transfer-attempts/.test(x));
    ok(seq.length === 3 && seq[0].startsWith('GET /transfer-attempts?limit=20') && seq[1].startsWith('POST /transfer-attempts/void-all') && seq[2].startsWith('GET /transfer-attempts?limit=20'), 'list -> void-all -> list');
    ok(/este dispositivo quedó desbloqueado/.test(t) && /Cancelada/.test(t) && !(await own(p, u)), 'after: pending cancelled in the list, record deleted');
    await click(p, 'Volver al inicio'); ok(!(await blocked(p)), 'unblocked');
    const lateRes = await send(u, payloadOf(u, '10000', '8306'), late);
    L('late send of the damaged record (old epoch):', lateRes.s, lateRes.b && lateRes.b.type);
    ok(lateRes.s === 409 && /transfer-attempt-voided/.test(lateRes.b.type), 'a send with the old epoch that arrives later is vetoed (409 transfer-attempt-voided)');
    const rep = dbReport(u, 'D');
    ok(String(BigInt(e0) + 1n) === rep.epoch && /transfer\.cancelled \{"via": "void_all"\}/.test(rep.audit) && /transfer\.send_epoch_advanced/.test(rep.audit) && db.debitCount(u) === 0, 'D: epoch +1, pending cancelled via void_all, audited, 0 debits');
    await p.context().close(); }

  if (SEL.includes('E')) { L('\n===== E: almacenamiento ilegible -> Resolver con el servidor; D6 mientras no se pueda leer =====');
    const u = await mkUser('Eva Ilegible'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email);
    const e0 = await policyEpoch(u);
    await p.evaluate(() => localStorage.setItem('ss-unreadable', '1')); await restart(p);
    let t = await p.shot('E-inicio-ilegible');
    ok(/No pudimos comprobar tus transferencias/.test(t) && await blocked(p) && await has(p, 'Reintentar lectura') && await has(p, 'Resolver con el servidor'), 'unreadable: explained, blocked, "Reintentar lectura" and "Resolver con el servidor"');
    await click(p, 'Reintentar lectura'); ok(await blocked(p), '"Reintentar lectura" while unreadable: still blocked');
    await click(p, 'Resolver con el servidor'); await click(p, 'Anular pendientes y desbloquear', 3500);
    t = await p.shot('E-d6-sigue-bloqueado');
    ok(/No pudimos actualizar este dispositivo/.test(t) && /puedes usar la web/.test(t), 'void-all done but the store still cannot be read: D6 explained');
    await click(p, 'Volver al inicio'); ok(await blocked(p), 'still blocked (D6)');
    await p.evaluate(() => localStorage.removeItem('ss-unreadable'));
    await click(p, 'Reintentar'); t = await p.shot('E-reintentar-ok');
    ok(!(await blocked(p)), 'store readable again: "Reintentar" (delete + re-read null) unblocks');
    const rep = dbReport(u, 'E'); ok(rep.epoch === String(BigInt(e0) + 1n), 'E: epoch advanced once');
    await p.context().close(); }

  if (SEL.includes('F')) { L('\n===== F: registro sin userId (ranura antigua) cuya llave ya se aplicó sin cabeceras -> Anular -> transfer_found =====');
    const u = await mkUser('Fito Sinusuario'); const p = await newPage(browser); const net = newNet(); await wire(p, net);
    const key = crypto.randomUUID(); const payload = payloadOf(u, '12345', '8307', 'F antiguo');
    const legacySend = await send(u, payload, { key }); L('legacy send (no headers):', legacySend.s, legacySend.b && legacySend.b.status);
    await p.goto(require('./lib.cjs').ORIGIN + '/'); await p.waitForTimeout(2000);
    await seed(p, u, JSON.stringify({ key, payload, consent: { confirmedAt: new Date().toISOString(), via: 'confirm', otp: 'unknown' } }), 'ss:wallet.transfer-recovery');
    await login(p, u.email); await p.waitForTimeout(1500);
    let t = await p.shot('F-inicio-sin-usuario'); const r = await own(p, u);
    ok(/se guardó sin indicar a qué usuario pertenecía/.test(t) && /Una versión anterior de la app no registró esta operación por número/.test(t) && await blocked(p), 'explained (no owner, older build), blocked');
    ok(r && r.userId === u.id && r.legacy === true && r.ownerAssumed === true && fp(r.key) === fp(key) && JSON.stringify(r.payload) === JSON.stringify(payload) && !(await recs(p))['ss:wallet.transfer-recovery'], 'moved to this user, new identity + legacy, same key and payload bytes');
    await click(p, VOID, 1500); t = await p.shot('F-anular-confirmacion'); ok(t.includes(VOID_CONFIRM), 'confirmation shows the mandatory text');
    const mark = p.reqs.length; await click(p, VOID, 3500); t = await p.shot('F-anulada-ya-aplicada');
    L('requests:', JSON.stringify(p.reqs.slice(mark)));
    ok(/Transferencia completada/.test(t) && !NO_CHARGE.test(t) && !(await own(p, u)), 'void -> transfer_found: its receipt is shown (no "no charge" claim); released');
    dbReport(u, 'F'); ok(db.count(u) === 1 && db.debitCount(u) === 1 && db.closures(u) === '(none)', 'F: still 1 transfer and 1 debit; no closure');
    await p.context().close(); }

  if (SEL.includes('G')) { L('\n===== G: GET 404 del transferId guardado -> sin "Verificar de nuevo"; Anular -> voided; envío tardío vetado =====');
    const u = await mkUser('Gael Cuatrocientos'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email);
    const ident = { key: crypto.randomUUID(), attemptId: crypto.randomUUID(), epoch: await policyEpoch(u) }; const payload = payloadOf(u, '4444', '8308', 'G 404');
    await seed(p, u, JSON.stringify({ v: 2, attemptId: ident.attemptId, key: ident.key, sendEpoch: ident.epoch, payload, userId: u.id, transferId: crypto.randomUUID(), consent: { confirmedAt: new Date().toISOString(), via: 'confirm', otp: 'unknown' } }));
    await restart(p); await toHome(p); await p.waitForTimeout(1500);
    let t = await p.shot('G-inicio-404');
    ok(/El servidor no encuentra esta operación/.test(t) && !(await has(p, 'Verificar de nuevo')) && !(await has(p, 'Verificar estado de la transferencia')) && await has(p, VOID) && await has(p, RESEND) && await has(p, 'Ver movimientos'), 'GET 404 (real): no "Verificar de nuevo"; Anular, Reenviar, Ver movimientos');
    ok(await blocked(p) && writes(p).length === 0, 'blocked; 0 writes');
    await click(p, VOID, 1500); await click(p, VOID, 3500); t = await p.shot('G-anulada');
    ok(t.includes(VOIDED_TEXT) && !(await own(p, u)), 'voided: mandatory text; released');
    await click(p, 'Volver al inicio'); ok(!(await blocked(p)), 'unblocked');
    const lateRes = await send(u, payload, ident); L('late send:', lateRes.s, lateRes.b && lateRes.b.type);
    ok(lateRes.s === 409 && /transfer-attempt-voided/.test(lateRes.b.type), 'the same send arriving later -> 409 transfer-attempt-voided');
    const rep = dbReport(u, 'G'); ok(db.count(u) === 0 && /^voided:/.test(rep.closures) && /transfer\.attempt_voided/.test(rep.audit), 'G: 0 transfers, 1 voided closure, audited');
    await p.context().close(); }

  if (SEL.includes('H')) { L('\n===== H: anulación de un envío que nunca llegó; su llegada tardía queda vetada =====');
    const u = await mkUser('Hugo Anula'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await start(p, '250.00', 'H anulada', '8309');
    net.create = 'abort'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    await click(p, 'Verificar estado de la transferencia');
    const mark = p.reqs.length; await click(p, VOID, 1500); let t = await p.shot('H-confirmacion');
    ok(t.includes(VOID_CONFIRM) && writes(p, mark).length === 0, 'confirmation screen with the mandatory text; nothing sent yet');
    await click(p, 'Volver sin anular', 1500); ok(writes(p, mark).length === 0 && await own(p, u), '"Volver sin anular": nothing sent, record kept');
    await click(p, VOID, 1500); await click(p, VOID, 3500); t = await p.shot('H-anulada');
    ok(t.includes(VOIDED_TEXT) && !(await own(p, u)), 'voided; released');
    const lateRes = await replay(net); L('late arrival of the original send:', lateRes.s, lateRes.type);
    ok(lateRes.s === 409 && /transfer-attempt-voided/.test(lateRes.type), 'late arrival vetoed (409 transfer-attempt-voided)');
    const b1 = await balances(u); dbReport(u, 'H'); ok(db.count(u) === 0 && b0.checking === b1.checking, 'H: 0 transfers, balance unchanged');
    await p.context().close(); }

  if (SEL.includes('J')) { L('\n===== J: carrera real — anular mientras el envío está retenido en el servidor (lock de cuenta) =====');
    const u = await mkUser('Juli Carrera'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await start(p, '333.33', 'J carrera', '8310');
    const lock = spawn('docker', [...DB, '-c', `BEGIN; SELECT id FROM accounts WHERE id='${u.pr.id}' FOR UPDATE; SELECT pg_sleep(10); COMMIT;`], { stdio: 'ignore' });
    const t0 = Date.now(); await new Promise((r) => setTimeout(r, 800));
    net.create = 'held'; await click(p, 'Confirmar transferencia', 1500); net.create = 'pass';
    ok(db.count(u) === 0, 'the send is held by the account lock (0 transfers yet)');
    await click(p, VOID, 1200); const tv = Date.now(); await p.btn(VOID).click();
    await p.shot('J-anulando');
    await new Promise((resolve) => lock.on('exit', resolve)); const tl = Date.now();
    await p.waitForTimeout(4000); const held = await net.held;
    const t = await p.shot('J-resultado');
    L(`timeline: lock released at +${tl - t0} ms; void tapped at +${tv - t0} ms; held POST -> ${held.status} ${held.state} after ${held.ms} ms`);
    ok(held.status === 201 && held.state === 'completed', 'the held send completed once the lock was released');
    ok(/Transferencia completada/.test(t) && !NO_CHARGE.test(t) && !(await own(p, u)), 'the void waited for it and answered transfer_found: the applied transfer is shown, never hidden; released');
    const b1 = await balances(u); const rep = dbReport(u, 'J');
    ok(db.count(u) === 1 && db.debitCount(u) === 1 && b0.checking - b1.checking === 33333n && rep.closures === '(none)', 'J: 1 transfer, 1 debit, no closure for the same key');
    await p.context().close(); }

  if (SEL.includes('K')) { L('\n===== K: recuperación desde otra sesión (sin registro local) con void-all =====');
    const u = await mkUser('Kari Otra'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email);
    await start(p, '210.00', 'K aplicada', '8311');
    net.create = 'lost-after'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    // A stays on M09 (Home would already resolve it by reading); B acts meanwhile; then A restarts.
    const r1 = await own(p, u);
    const tokenB = await otherSession(u);
    let list = (await call(tokenB, '/transfer-attempts?limit=20')).b;
    const seen = list.items.find((i) => i.attemptId === r1.attemptId);
    L('session B list:', JSON.stringify(list.items.map((i) => ({ attempt: i.attemptId && i.attemptId.slice(0, 8), status: i.status, transfer: i.transferId && i.transferId.slice(0, 8) }))), 'epoch', list.sendEpoch);
    ok(seen && seen.status === 'completed' && seen.transferId, 'session B sees the applied attempt of A with its attemptId');
    let va = await call(tokenB, '/transfer-attempts/void-all', { method: 'POST', body: JSON.stringify({ fromEpoch: list.sendEpoch }) }); L('B void-all:', va.s, JSON.stringify(va.b));
    await restart(p); let t = await p.shot('K-A-vuelve-aplicada');
    ok(/Transferencia completada/.test(t), 'A (reload): reads its identity -> the applied transfer (receipt)');
    ok(!(await own(p, u)) && writes(p).length === 0, 'A: released by the read, 0 writes');
    await click(p, 'Ir al inicio');
    await start(p, '90.00', 'K no llegó', '8312');
    net.create = 'abort'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    const r2 = await own(p, u); await toHome(p);
    list = (await call(tokenB, '/transfer-attempts?limit=20')).b;
    ok(!list.items.some((i) => i.attemptId === r2.attemptId), 'B does not see the never-arrived attempt');
    va = await call(tokenB, '/transfer-attempts/void-all', { method: 'POST', body: JSON.stringify({ fromEpoch: list.sendEpoch }) }); L('B void-all #2:', va.s, JSON.stringify(va.b));
    await click(p, RESEND, 1500); await click(p, RESEND, 3500); t = await p.shot('K-A-reenvio-vetado');
    L('A resend:', JSON.stringify(net.creates.map((c) => ({ attempt: c.attempt.slice(0, 8), epoch: c.epoch }))));
    ok(t.includes(VOIDED_TEXT) && !(await own(p, u)), 'A resend -> 409 transfer-attempt-voided: "Transferencia anulada…", released');
    await click(p, 'Volver al inicio'); ok(!(await blocked(p)), 'A unblocked');
    const rep = dbReport(u, 'K'); ok(db.count(u) === 1 && db.byAttempt(u, r2.attemptId) === 0 && db.debitCount(u) === 1, 'K: one transfer (the applied one), the vetoed one never created, 1 debit');
    L('epoch', rep.epoch);
    await p.context().close(); }

  await browser.close();
  L(`\nFAILURES: ${failures()}`);
  flush('logs/ui-r8.txt');
  process.exit(failures() ? 1 : 0);
})().catch((error) => { L('ERROR', error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error)); flush('logs/ui-r8.txt'); process.exit(2); });
