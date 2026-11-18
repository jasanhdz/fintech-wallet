// Pass 9 · items 2 and 3: per-user record (F-22), legacy slot migration, privacy of the record, lock-in risk (records that never resolve),
// server-side expiry/cancel, and the unverified-4xx exit. API 3991. The demo OTP is never printed.
const { chromium, L, ok, call, mkUser, balances, dbRows, dbLedger, newPage, login, origin, choose, toReview, flush, psql, crypto } = require('./lib.cjs');
const FORBID = /Continuar con transferencia|Elegir otro destinatario|Cambiar beneficiario|Transferir dinero|Nueva transferencia|Elegir beneficiario/;
function wire(p, net) {
  return p.route('**/v1/transfers**', async (route) => {
    const r = route.request(); const m = r.method(); const u = new URL(r.url()).pathname.replace('/v1', '');
    const kind = m === 'POST' && u === '/transfers' ? 'create' : m === 'GET' && /^\/transfers\/[0-9a-f-]{36}$/.test(u) ? 'get' : /\/confirm$/.test(u) ? 'confirm' : /\/cancel$/.test(u) ? 'cancel' : null;
    if (!kind) return route.continue();
    const mode = net[kind] || 'pass'; net.log.push(`${kind}:${mode}`);
    if (mode === 'pass') return route.continue();
    if (mode === 'abort') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    if (mode === '409') { return route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'La solicitud idempotente está en curso; reintenta con la misma llave.' }) }); }
    return route.continue();
  });
}
const names = async (p) => (await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 60)))).filter(Boolean);
async function audit(p, label) { const t = await p.text(); const b = await names(p); const bad = b.filter((n) => FORBID.test(n)); L(`AUDIT ${label}: notice=${/Transferencia (en verificación|pendiente de autorizar)/.test(t)} forbidden=${JSON.stringify(bad)} | buttons=${JSON.stringify(b.map((x) => x.replace(/\n/g, ' ').slice(0, 40)))}`); return { t, bad }; }
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
const ls = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')).map((k) => [k, localStorage.getItem(k)])));
const cnt = (email) => Number(psql(`select count(*) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`));
const rows = (email) => psql(`select string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
const uid = async (u) => (await call(u.token, '/auth/me')).b.id;
const keysIn = (p) => [...new Set(p.reqs.filter((r) => /^POST \/transfers key/.test(r)).map((r) => r.split('key=')[1]))];
const logout = async (p) => { await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); };
const mkPayload = (u, amount, ref) => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amount, concept: 'Legacy', reference: ref });

(async () => {
  const browser = await chromium.launch();
  const SEL = (process.env.ONLY || 'D1,D2,E').split(',');
  // ---------- D1: F-22, two users on one device
  if (SEL.includes('D1')) { L('\n===== D1 (F-22): A deja un intento incierto; B inicia sesión, transfiere y cierra sesión; A reanuda =====');
    const A = await mkUser('Ana Prueba'); const B = await mkUser('Beto Prueba'); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, A.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'A incierto', '7001');
    net.create = 'lost-after'; net.get = 'abort'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); net.create = 'abort';
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1500);
    const A_id = await uid(A); const aKey = `ss:wallet.transfer-recovery.${A_id}`; const snapA = (await ls(p))[aKey];
    const rec = JSON.parse(snapA); L('A record fields:', JSON.stringify(Object.keys(rec)), '| payload fields', JSON.stringify(Object.keys(rec.payload)), '| userId matches A', rec.userId === A_id, '| contains tokens/otp/clabe?', /refresh|accessToken|demoOnlyCode|clabe|password|\b\d{18}\b/i.test(snapA));
    await logout(p); const afterA = await ls(p); ok(afterA[aKey] === snapA, 'A logout keeps A record byte-identical');
    // B on the same device
    net.create = 'pass'; net.get = 'pass'; p.reqs.length = 0; await login(p, B.email);
    let a = await audit(p, 'B Home'); ok(!/Transferencia (en verificación|pendiente)/.test(a.t), 'B does not see A notice');
    L('B session requests touching A record id: ', p.reqs.filter((r) => /transfers\/[0-9a-f]{4}/.test(r)).length, '(GET/POST on transfers during B login; expected 0)');
    ok((await ls(p))[aKey] === snapA, 'A record unchanged while B is signed in');
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '150.00', 'B normal', '7002');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3500);
    L('B transfer receipt:', /Transferencia completada/.test(await p.text()), '| B rows', rows(B.email));
    ok((await ls(p))[aKey] === snapA, 'A record unchanged after B transferred');
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); await logout(p);
    const end = await ls(p); L('after B explicit logout: A record byte-identical =', end[aKey] === snapA, '| record entries', Object.keys(end).length, '| legacy slot present', 'ss:wallet.transfer-recovery' in end);
    ok(end[aKey] === snapA, 'B logout did not delete/replace A record (F-22)');
    // A returns, network back
    p.reqs.length = 0; await login(p, A.email); await p.waitForTimeout(3500);
    const tA = await p.shot('F22-A-reanuda');
    L('A returns: receipt shown', /Transferencia completada/.test(tA), '| keys used', keysIn(p).length, 'same as stored', keysIn(p)[0] === rec.key.slice(0, 8), '| A rows', rows(A.email), '|', dbLedger(A.email), '| B rows', rows(B.email));
    ok(cnt(A.email) === 1 && cnt(B.email) === 1 && keysIn(p)[0] === rec.key.slice(0, 8), 'A resumed with the same key; 1 transfer each');
    L('record entries after A resolved:', Object.keys(await ls(p)).length);
    await p.context().close(); }

  // ---------- D2: legacy single slot migration (pre-round-8 key `wallet.transfer-recovery`)
  if (SEL.includes('D2')) { L('\n===== D2: hueco único antiguo =====');
    const L1 = await mkUser('Luis Uno'); const L2 = await mkUser('Laura Dos'); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net);
    const id1 = await uid(L1); const legacyKey = crypto.randomUUID(); const legacy = JSON.stringify({ key: legacyKey, payload: mkPayload(L1, '12345', '7'), userId: id1 });
    await p.addInitScript((v) => { if (!localStorage.getItem('ss:wallet.transfer-recovery') && !sessionStorage.getItem('seeded')) { localStorage.setItem('ss:wallet.transfer-recovery', v); sessionStorage.setItem('seeded', '1'); } }, legacy);
    await login(p, L2.email); // other user first
    let a = await audit(p, 'L2 Home with legacy slot of L1'); ok(!/Transferencia (en verificación|pendiente)/.test(a.t), 'L2 does not see L1 legacy record');
    let s = await ls(p); ok(s['ss:wallet.transfer-recovery'] === legacy && Object.keys(s).length === 1, 'legacy slot not read/replaced/deleted by L2 (still byte-identical, no new key)');
    await logout(p); s = await ls(p); ok(s['ss:wallet.transfer-recovery'] === legacy, 'still intact after L2 logout');
    p.reqs.length = 0; await login(p, L1.email); await p.waitForTimeout(3500);
    s = await ls(p); const t = await p.text();
    L('L1 signs in: receipt', /Transferencia completada/.test(t), '| legacy slot gone', !('ss:wallet.transfer-recovery' in s), '| per-user key present/cleared', Object.keys(s).length, '| keys used', keysIn(p).length, 'matches legacy key', keysIn(p)[0] === legacyKey.slice(0, 8), '| L1 rows', rows(L1.email));
    ok(cnt(L1.email) === 1 && rows(L1.email) === 'completed:12345', 'L1 legacy attempt resumed with its own key, 1 transfer');
    await p.context().close();
    // legacy WITHOUT userId (written before round 7): goes to whoever signs in first
    const L3 = await mkUser('Lola Tres'); const L4 = await mkUser('Lalo Cuatro'); const p2 = await newPage(browser, { h: 929 }); await wire(p2, { log: [] });
    const legacy2 = JSON.stringify({ key: crypto.randomUUID(), payload: mkPayload(L3, '23456', '8') });
    await p2.addInitScript((v) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ss:wallet.transfer-recovery', v); sessionStorage.setItem('seeded', '1'); } }, legacy2);
    await login(p2, L4.email); await p2.waitForTimeout(3500);
    a = await audit(p2, 'L4 signs in first with a userId-less legacy record of L3'); const s2 = await ls(p2);
    L('  record now under L4 key:', Object.keys(s2).some((k) => k.includes(' ') === false && k !== 'ss:wallet.transfer-recovery'), '| L4 rows', rows(L4.email) || '(none)', '| L3 rows', rows(L3.email) || '(none)');
    await p2.shot('F26-legacy-sin-userId-L4'); const nb = await names(p2); L('  L4 controls to leave this state:', JSON.stringify(nb.map((x) => x.replace(/\n/g, ' ').slice(0, 40))));
    await p2.context().close(); }

  // ---------- E: lock-in risk
  if (SEL.includes('E')) {
    async function injected(label, mutate, opts = {}) {
      L(`\n===== E (${label}) =====`);
      const u = await mkUser('Eva Prueba'); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email);
      const id = await uid(u); const rec = mutate({ key: crypto.randomUUID(), payload: mkPayload(u, '33333', '5'), userId: id });
      await p.evaluate(([k, v]) => localStorage.setItem(k, v), [`ss:wallet.transfer-recovery.${id}`, typeof rec === 'string' ? rec : JSON.stringify(rec)]);
      p.reqs.length = 0; await p.reload(); await p.waitForTimeout(4500);
      let t = await p.text(); L('after restart with the record: screen', /Código de confirmación/.test(t) ? 'M08' : /Estamos verificando|No pudimos confirmar|Verificando/.test(t) ? 'M09' : /Transferencia en verificación/.test(t) ? 'Home notice' : /Transferencia completada/.test(t) ? 'receipt' : 'other', '| reqs', JSON.stringify(p.reqs.map((r) => r.replace(/ key=-$/, ''))));
      await p.shot(`E-${label}-arranque`);
      if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500); }
      let a = await audit(p, `${label} Home`);
      for (let i = 0; i < 2; i++) { await foreground(p); }
      await logout(p); await login(p, u.email); await p.waitForTimeout(3000);
      if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500); }
      a = await audit(p, `${label} Home after foreground x2 + logout/login`); await p.shot(`E-${label}-inicio`);
      const locked = /Transferencia (en verificación|pendiente)/.test(a.t) && a.bad.length === 0;
      L(`RESULT ${label}: still locked after foreground x2 and a new login = ${locked} | transfers in DB ${cnt(u.email)}`);
      // can the user get out by any UI control? list every control incl. text hints
      L('  any discard/cancel control on Home:', /descart|cancelar esta|olvidar|eliminar/i.test(a.t));
      await p.context().close(); return { locked, u };
    }
    await injected('404-transferId-inexistente', (r) => ({ ...r, transferId: crypto.randomUUID(), status: 'processing' }));
    await injected('404-beneficiario-inexistente', (r) => ({ ...r, payload: { ...r.payload, beneficiaryId: crypto.randomUUID() } }));
    await injected('registro-corrupto', () => '{"key":"x","payload":');

    // E4: unverified 4xx on retry (409 in-flight) -> "Volver al inicio" clears the record while the first attempt applied
    { L('\n===== E4: 409 "en curso" en el reintento tras respuesta perdida (aplicada) =====');
      const u = await mkUser('Eva Cuatro'); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email); const b0 = await balances(u);
      await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'E4', '7404');
      net.create = 'lost-after'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
      net.create = '409'; await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
      const t = await p.shot('E4-M11-no-verificado'); L('retry answered 409: screen M11 unverified =', /Revisa tu saldo antes de reintentar/.test(t), '| DB:', rows(u.email), '| record entries', Object.keys(await ls(p)).length);
      await p.btn('Volver al inicio').click(); await p.waitForTimeout(1500);
      const a = await audit(p, 'Home after leaving M11 (unverified)'); L('record entries after leaving M11:', Object.keys(await ls(p)).length);
      net.create = 'pass';
      if (!/Transferencia (en verificación|pendiente)/.test(a.t)) {
        L('=> guard bypassed: the app lets the user start another transfer while the first one is applied but not verified');
        await p.btn('Transferir dinero').click().catch(() => null); await p.waitForTimeout(800);
        await choose(p, 'Cuenta de ahorro demo').catch(() => null);
        await toReview(p, '300.25', 'E4 segundo', '7405'); await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3500);
        L('second transfer receipt:', /Transferencia completada/.test(await p.text()), '| DB:', rows(u.email), '| ledger', dbLedger(u.email), '| principal delta', b0.checking - (await balances(u)).checking);
      }
      await p.context().close(); }

    // E5: server-side expiry / cancel while the notice is visible -> resolves by itself
    for (const how of ['expired', 'cancelled']) {
      L(`\n===== E5 (${how}): intento pendiente de código resuelto por el servidor =====`);
      const u = await mkUser('Eva Cinco'); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email);
      await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '6000.00', `E5 ${how}`, '7501'); await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
      net.cancel = 'abort'; net.get = 'abort'; await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(2500);
      let a = await audit(p, `${how}: Home while pending`); ok(/pendiente de autorizar/.test(a.t), 'pending-to-authorize notice');
      if (how === 'expired') psql(`update otp_challenges set expires_at = now() - interval '1 minute' where transfer_id in (select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}')`);
      else { const id = psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}'`); const r = await call(u.token, `/transfers/${id}/cancel`, { method: 'POST' }); L('  cancelled by API:', r.s); }
      net.cancel = 'pass'; net.get = 'pass'; await foreground(p);
      const t = await p.shot(`E5-${how}-resuelto`); L('  resolved on foreground: closed screen =', /No se movió dinero/.test(t), '| title:', (t.match(/El código de esta operación expiró|Operación cancelada/) || [])[0], '| DB:', rows(u.email), '| record entries', Object.keys(await ls(p)).length);
      const nb = await names(p); L('  exit controls:', JSON.stringify(nb.map((x) => x.replace(/\n/g, ' ').slice(0, 40))));
      await p.btn('Volver al inicio').click().catch(() => null); await p.waitForTimeout(1200);
      a = await audit(p, `${how}: Home after closing`); L('  flow enabled again =', !/Transferencia (en verificación|pendiente)/.test(a.t));
      await p.context().close(); }
  }
  await browser.close(); flush(process.env.LOGNAME2 || 'logs/ui-f21c.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
