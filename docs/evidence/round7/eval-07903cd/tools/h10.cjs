// Pass 10 helpers on top of lib.cjs: network controller for the exported RN-Web bundle, record/DB probes, lock audit.
// Modes per request kind (create | get | confirm | cancel):
//   pass | abort (never reaches the server) | lost-before | lost-after (server applies, response dropped)
//   err:<status>[:<detail>]       answer with a problem+json, server NOT reached
//   exec-err:<status>[:<detail>]  server really executes the request, then the client receives the error (e.g. applied but 409/500)
const lib = require('./lib.cjs');
const { psql, call, L, ok } = lib;
const FORBID = /Continuar con transferencia|Elegir otro destinatario|Cambiar beneficiario|Transferir dinero|Nueva transferencia|Elegir beneficiario|Descartar|Ya puedes hacer otra|Hacer otra transferencia|Elegir otro/;
const problem = (status, detail) => JSON.stringify({ type: 'about:blank', title: status === 409 ? 'Conflict' : 'Error', status, detail });
function wire(p, net) {
  net.log = net.log || []; net.creates = net.creates || [];
  return p.route('**/v1/transfers**', async (route) => {
    const r = route.request(); const m = r.method(); const u = new URL(r.url()).pathname.replace('/v1', '');
    const kind = m === 'POST' && u === '/transfers' ? 'create' : m === 'GET' && /^\/transfers\/[0-9a-f-]{36}$/.test(u) ? 'get' : /\/confirm$/.test(u) ? 'confirm' : /\/cancel$/.test(u) ? 'cancel' : null;
    if (!kind) return route.continue();
    const mode = net[kind] || 'pass';
    if (kind === 'create') net.creates.push({ key: r.headers()['idempotency-key'], body: r.postData(), mode });
    net.log.push(`${kind}:${mode}`);
    if (mode === 'pass') return route.continue();
    if (mode === 'race') { // REAL concurrent sends of the same key and bytes: the app's request races 3 identical ones; its real answer (201 or the real 409) is delivered
      const h = r.headers(); const [resp, ...others] = await Promise.all([route.fetch(), ...[1, 2, 3].map(() => fetch(r.url(), { method: 'POST', headers: { 'content-type': 'application/json', authorization: h.authorization, 'idempotency-key': h['idempotency-key'] }, body: r.postData() }))]);
      net.race = { app: resp.status(), others: others.map((o) => o.status) }; return route.fulfill({ response: resp });
    }
    if (mode === 'abort' || mode === 'lost-before') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    const mm = mode.match(/^(exec-)?err:(\d+)(?::(.*))?$/);
    if (mm) { if (mm[1]) await route.fetch().catch(() => null); return route.fulfill({ status: Number(mm[2]), contentType: 'application/problem+json', body: problem(Number(mm[2]), mm[3] || 'Error simulado') }); }
    return route.continue();
  });
}
const IN_PROGRESS = 'La solicitud idempotente está en curso; reintenta con la misma llave.'; // real body of api/src/http/app.ts:131
const uid = async (u) => (await call(u.token, '/auth/me')).b.id;
const recKey = (id) => `ss:wallet.transfer-recovery.${id}`;
const rec = (p, id) => p.evaluate((k) => localStorage.getItem(k), recKey(id));
const setRec = (p, id, raw) => p.evaluate(([k, v]) => localStorage.setItem(k, v), [recKey(id), raw]);
const names = async (p) => (await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 70)))).filter(Boolean);
const tabsOf = (p) => p.getByRole('tab').evaluateAll((els) => els.map((e) => (e.innerText || '').trim()));
async function audit(p, label) {
  const t = await p.text(); const b = await names(p); const tabs = await tabsOf(p);
  const bad = [...b, ...tabs].filter((n) => FORBID.test(n));
  L(`AUDIT ${label}: forbidden=${JSON.stringify(bad)} buttons=${JSON.stringify(b.map((x) => x.slice(0, 34)))}`);
  return { t, bad, b };
}
const fg = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
const nCreates = (net) => net.creates.length;
const q = (email) => ({
  rows: () => psql(`select coalesce(string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at),'(none)') from transfers t join users u on u.id=t.owner_id where u.email='${email}'`),
  n: () => Number(psql(`select count(*) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`)),
  debits: () => Number(psql(`select count(*) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${email}' and le.entry_type='debit'`)),
  ledger: () => psql(`select count(*)||' rows sum '||coalesce(sum(le.signed_amount_minor),0) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${email}'`),
  idem: () => psql(`select count(*) from idempotency_records r join users u on u.id=r.user_id where u.email='${email}' and r.operation='create-transfer'`),
});
async function summary(u, tag) {
  const d = q(u.email); const bal = await lib.balances(u);
  L(`DB ${tag}: transfers=${d.n()} [${d.rows()}] debits=${d.debits()} ledger=${d.ledger()} idem=${d.idem()} balances principal=${bal.checking} ahorro=${bal.savings}`);
  return { n: d.n(), debits: d.debits(), bal };
}
// standard: Principal -> Ahorro demo, review, ready to confirm
async function toConfirm(p, amount = '300.25', concept = 'Prueba Ev10', ref = '9001', prefix = 'Cuenta de ahorro demo') {
  await lib.origin(p, /^Cuenta principal/); await lib.choose(p, prefix); await lib.toReview(p, amount, concept, ref);
}
module.exports = { ...lib, FORBID, wire, IN_PROGRESS, uid, recKey, rec, setRec, names, tabsOf, audit, fg, nCreates, q, summary, toConfirm };
