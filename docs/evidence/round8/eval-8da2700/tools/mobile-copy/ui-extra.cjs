// Evaluator R8 extra render scenarios (L: M09 sees a closure made by another client; N: one tap = one POST, double tap). Helpers copied from the Generator tools/ui-r8.cjs (read, not trusted).
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
  const SEL = (process.env.ONLY || 'L,N').split(',');

  if (SEL.includes('L')) { L('\n===== L: M09 "Verificar" ve un cierre hecho por otro cliente: no libera; Anular confirma =====');
    const u = await mkUser('Lola Cierre'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await start(p, '210.00', 'L cierre', '8401');
    net.create = 'abort'; await click(p, 'Confirmar transferencia'); net.create = 'pass';
    const r = await own(p, u);
    // another client voids this identity (key from the record, only to drive the server; never printed)
    const vres = await call(u.token, '/transfer-attempts/void', { method: 'POST', body: JSON.stringify({ idempotencyKey: r.key, attemptId: r.attemptId }) });
    ok(vres.s === 200 && vres.b.resolution === 'voided', 'other client voided the identity (server side)');
    const mark = p.reqs.length; await click(p, 'Verificar estado de la transferencia', 3000); let t = await p.shot('L-m09-cierre');
    L('requests:', JSON.stringify(p.reqs.slice(mark)));
    ok(writes(p, mark).length === 0 && !!(await own(p, u)) && await blocked(p), 'Verificar only read; the record is NOT released by reading a closure; still blocked');
    ok(/anulad/i.test(t) && await has(p, VOID), 'the closure is explained and "Anular" is offered');
    await click(p, VOID, 1500); await click(p, VOID, 3500); t = await p.shot('L-anulada');
    ok(t.includes(VOIDED_TEXT) && !(await own(p, u)), 'Anular (200) is the terminal result that releases');
    await click(p, 'Volver al inicio'); ok(!(await blocked(p)), '"Transferir" returns only after the verified release');
    const b1 = await balances(u); dbReport(u, 'L'); ok(db.count(u) === 0 && b0.checking === b1.checking, 'L: 0 transfers, balance unchanged');
    await p.context().close(); }

  if (SEL.includes('N')) { L('\n===== N: un toque = un POST (doble toque en Confirmar) =====');
    const u = await mkUser('Nico Toque'); const p = await newPage(browser); const net = newNet(); await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await start(p, '99.00', 'N un toque', '8402');
    await p.btn('Confirmar transferencia').dblclick(); await p.waitForTimeout(3500);
    ok(net.creates.length === 1, `double tap on Confirmar -> ${net.creates.length} POST /transfers`);
    const r = await own(p, u); L('record after receipt:', r ? 'present' : 'released');
    const b1 = await balances(u); dbReport(u, 'N'); ok(db.count(u) === 1 && b0.checking - b1.checking === 9900n, 'N: 1 transfer, 1 debit');
    await p.context().close(); }
  await browser.close(); flush('logs/ui-extra.txt'); L('FAILURES:', failures());
})().catch((e) => { console.error('ERROR', String(e).slice(0, 300)); process.exit(1); });
