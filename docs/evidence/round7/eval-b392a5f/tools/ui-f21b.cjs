// Pass 9 · items 1 and 4: awaiting_confirmation pending code, M08 exits, new code, confirm-time rejections. API 3991 (threshold $5,000.00).
const { chromium, L, ok, call, mkUser, balances, dbRows, dbLedger, newPage, login, origin, choose, toReview, flush, psql, crypto } = require('./lib.cjs');
const FORBID = /Continuar con transferencia|Elegir otro destinatario|Cambiar beneficiario|Transferir dinero|Nueva transferencia|Elegir beneficiario/;
const readCode = async (p) => { const t = await p.evaluate(() => document.body.innerText); const m = t.match(/Código asignado para esta prueba:\s*(\d{6})/); return m ? m[1] : null; };
function wire(p, net) {
  return p.route('**/v1/transfers**', async (route) => {
    const r = route.request(); const m = r.method(); const u = new URL(r.url()).pathname.replace('/v1', '');
    const kind = m === 'POST' && u === '/transfers' ? 'create' : m === 'GET' && /^\/transfers\/[0-9a-f-]{36}$/.test(u) ? 'get' : /\/confirm$/.test(u) ? 'confirm' : /\/cancel$/.test(u) ? 'cancel' : null;
    if (!kind) return route.continue();
    const mode = net[kind] || 'pass'; net.log.push(`${kind}:${mode}`);
    if (mode === 'pass') return route.continue();
    if (mode === 'abort') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    if (mode === 'slow') { await new Promise((r2) => setTimeout(r2, 3500)); return route.continue(); }
    return route.continue();
  });
}
const names = async (p) => (await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 60)))).filter(Boolean);
async function audit(p, label) { const t = await p.text(); const b = await names(p); const bad = b.filter((n) => FORBID.test(n)); L(`AUDIT ${label}: notice=${/Transferencia (en verificación|pendiente de autorizar)/.test(t)} forbidden=${JSON.stringify(bad)}`); return { t, bad }; }
const rows = (email) => psql(`select string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
const debits = (email) => psql(`select count(*)||' debit(s)' from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${email}' and le.signed_amount_minor<0`);
const recKeys = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')).length);
const dismissToOtp = async (p, amount, concept, ref) => { await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, amount, concept, ref); await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500); };

(async () => {
  const browser = await chromium.launch();
  const SKIP = Number(process.env.SKIP || 0);
  // C1: pending code, cancel cannot be confirmed -> Home locked; continue -> authorize -> 1 debit
  if (SKIP < 1) { L('\n===== C1: sobre el umbral, "Cancelar y volver a revisar" sin poder confirmar la cancelación =====');
    const u = await mkUser(); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await dismissToOtp(p, '6000.00', 'Prueba umbral', '9101');
    const code = await readCode(p); ok(Boolean(code), 'M08 with demo code (not printed)');
    L('DB:', rows(u.email), '| ledger', dbLedger(u.email), '| record keys', await recKeys(p));
    net.cancel = 'abort'; net.get = 'abort';
    await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(3000);
    let a = await audit(p, 'after failed cancel'); ok(/Transferencia pendiente de autorizar/.test(a.t) && a.bad.length === 0, 'Home shows pending-to-authorize notice, no new-transfer entry');
    await p.shot('F21-C1-inicio-pendiente-de-autorizar');
    L('record kept:', await recKeys(p) === 1, '| DB still awaiting:', rows(u.email));
    await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(800); await audit(p, 'Movimientos'); await p.getByRole('tab', { name: /Inicio/ }).click(); await p.waitForTimeout(1500);
    await p.reload(); await p.waitForTimeout(4000); await wire(p, net);
    const tr = await p.text(); L('after reload with record (GET still failing): screen', /Código de confirmación/.test(tr) ? 'M08' : /Transferencia pendiente/.test(tr) ? 'Home notice' : /Estamos verificando|No pudimos/.test(tr) ? 'M09' : 'other');
    net.cancel = 'pass'; net.get = 'pass';
    await p.reload(); await p.waitForTimeout(4500); await wire(p, net);
    const t2 = await p.shot('F21-C1-reanudado-M08');
    const code2 = await readCode(p); L('reload with network back -> M08 resumed with code box:', /Código de confirmación/.test(t2), Boolean(code2), '| same code as before:', code2 === code);
    if (code2) { await p.getByLabel('Código de confirmación', { exact: true }).fill(''); await p.keyboard.insertText(code2); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500); }
    const t3 = await p.shot('F21-C1-comprobante');
    L('receipt:', /Transferencia completada/.test(t3), '| DB:', rows(u.email), '|', debits(u.email), '| balance delta', b0.checking - (await balances(u)).checking, '| record keys', await recKeys(p));
    ok(debits(u.email).startsWith('1 '), 'C1: exactly one debit');
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); a = await audit(p, 'Home after receipt');
    await p.context().close(); }

  // C2: cancel confirmed -> back to review, record cleared, new attempt allowed (cancelled one never moves money)
  if (SKIP < 2) { L('\n===== C2: cancelación confirmada =====');
    const u = await mkUser(); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await dismissToOtp(p, '6000.00', 'Prueba cancelar', '9102');
    p.reqs.length = 0;
    await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(3000);
    const t = await p.text(); L('after confirmed cancel: on review', /Confirmar|Continuar a verificación/.test(t) && !/Código de confirmación/.test(t), '| DB:', rows(u.email), '| record keys', await recKeys(p), '| reqs', JSON.stringify(p.reqs.map((r) => r.replace(/ key=-$/, ''))));
    ok(rows(u.email) === 'cancelled:600000' && (await recKeys(p)) === 0, 'cancel confirmed -> status cancelled, record deleted');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
    const code = await readCode(p); await p.getByLabel('Código de confirmación', { exact: true }).fill(''); await p.keyboard.insertText(code); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
    L('second attempt after cancel -> receipt', /Transferencia completada/.test(await p.text()), '| DB:', rows(u.email), '|', debits(u.email), '| delta', b0.checking - (await balances(u)).checking);
    ok(debits(u.email).startsWith('1 '), 'C2: one debit');
    await p.context().close(); }

  // C3: confirm in flight: exits disabled (F-12); lost confirm
  { L('\n===== C3: confirm en vuelo (F-12) y confirm perdido =====');
    const u = await mkUser(); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await dismissToOtp(p, '6000.00', 'Prueba vuelo', '9103');
    const code = await readCode(p); net.confirm = 'slow';
    await p.getByLabel('Código de confirmación', { exact: true }).fill(''); await p.keyboard.insertText(code); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(700);
    const dis = await p.getByRole('button', { name: 'Cancelar y volver a revisar' }).first().getAttribute('aria-disabled'); const dis2 = await p.getByRole('button', { name: 'Solicitar un código nuevo' }).first().getAttribute('aria-disabled').catch(() => 'n/a');
    L('while confirm is in flight: Cancelar aria-disabled =', dis, '| Solicitar código nuevo aria-disabled =', dis2);
    await p.btn('Cancelar y volver a revisar').click({ force: true }).catch(() => null); await p.waitForTimeout(4500);
    const tt = await p.text(); L('after confirm answered: receipt', /Transferencia completada/.test(tt), '| DB:', rows(u.email), '|', debits(u.email));
    ok(rows(u.email) === 'completed:600000' && debits(u.email).startsWith('1 '), 'C3: forced click during confirm did not cancel/duplicate');
    await p.context().close(); }

  // C4: new code. (i) cancel & read both fail -> nothing created; (ii) happy path, old code does not authorize new; 1 debit
  { L('\n===== C4: "Solicitar un código nuevo" =====');
    const u = await mkUser(); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
    await dismissToOtp(p, '6000.00', 'Prueba nuevo', '9104');
    const old = await readCode(p);
    net.cancel = 'abort'; net.get = 'abort'; p.reqs.length = 0;
    await p.getByRole('button', { name: 'Solicitar un código nuevo' }).first().click(); await p.waitForTimeout(3000);
    L('(i) cancel+read fail: POST /transfers (create) count =', p.reqs.filter((r) => /^POST \/transfers key/.test(r)).length, '| message', /No pudimos confirmar que el intento anterior/.test(await p.text()), '| DB:', rows(u.email), '| record keys', await recKeys(p));
    ok(rows(u.email) === 'awaiting_confirmation:600000', '(i) no second attempt created');
    net.cancel = 'pass'; net.get = 'pass'; p.reqs.length = 0;
    await p.getByRole('button', { name: 'Solicitar un código nuevo' }).first().click(); await p.waitForTimeout(3500);
    const keys = [...new Set(p.reqs.filter((r) => /^POST \/transfers key/.test(r)).map((r) => r.split('key=')[1]))];
    const nw = await readCode(p); L('(ii) happy: DB:', rows(u.email), '| create keys', keys.length, '| record keys', await recKeys(p), '| new code differs', nw !== old);
    const pendId = psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' and t.status='awaiting_confirmation'`);
    const cancelledId = psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' and t.status='cancelled'`);
    const oldOnNew = await call(u.token, `/transfers/${pendId}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code: old }) });
    const oldOnOld = await call(u.token, `/transfers/${cancelledId}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code: old }) });
    L('    old code on NEW attempt ->', oldOnNew.s, '| old code on CANCELLED attempt ->', oldOnOld.s, '| balance delta', b0.checking - (await balances(u)).checking);
    await p.getByLabel('Código de confirmación', { exact: true }).fill(''); await p.keyboard.insertText(nw); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
    L('    new code -> receipt', /Transferencia completada/.test(await p.text()), '| DB:', rows(u.email), '|', debits(u.email), '| delta', b0.checking - (await balances(u)).checking);
    ok(debits(u.email).startsWith('1 ') && oldOnNew.s === 422 && oldOnOld.s === 409, 'C4: one debit; old code rejected (422 new / 409 cancelled)');
    await p.context().close(); }

  // C5: confirm-time 422 saldo insuficiente (documented best-effort cancel + record deleted)
  for (const cancelMode of ['pass', 'abort']) {
    L(`\n===== C5 (cancel=${cancelMode}): saldo insuficiente al confirmar =====`);
    const u = await mkUser(); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email);
    await dismissToOtp(p, '6000.00', 'Prueba saldo', '9105');
    const code = await readCode(p);
    // drain the source so the 6,000.00 no longer fits (api, same user)
    for (let i = 0; i < 2; i++) { const r = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: '499999', concept: 'drena', reference: String(i + 1) }) }); L('  drain', r.s); }
    net.cancel = cancelMode;
    await p.getByLabel('Código de confirmación', { exact: true }).fill(''); await p.keyboard.insertText(code); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
    const t = await p.shot(`F21-C5-${cancelMode}-M11`); L('M11 shown:', /No se pudo completar la transferencia/.test(t), '| record keys', await recKeys(p), '| DB:', rows(u.email));
    await p.btn('Volver al inicio').click(); await p.waitForTimeout(1500);
    const a = await audit(p, 'Home after confirm-time rejection');
    L('  flow enabled after rejection (no notice):', !/Transferencia (en verificación|pendiente)/.test(a.t), '| old pending row remains:', rows(u.email));
    await p.context().close();
  }
  await browser.close(); flush(process.env.LOGNAME2 || 'logs/ui-f21b.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
