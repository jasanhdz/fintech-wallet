// Items 6, 7, 8: M09 (Enviando vs Verificando, lost responses, reload/recovery), M11 (insufficient balance, daily limit, connection error != rejection),
// M12 (curtain on hidden, expired session, recovery bound to its user). API#1 (EV_API_PORT=3991, threshold 500000, limit 2,000,000).
const { chromium, L, ok, call, mkUser, balances, dbRows, dbLedger, psql, newPage, login, origin, choose, fill, toReview, xfer, flush, crypto, API } = require('./lib.cjs');
const rec = (p) => p.evaluate(() => { const v = (()=>{const k=Object.keys(localStorage).find((x)=>x.startsWith('ss:wallet.transfer-recovery'));return k?localStorage.getItem(k):null})(); if (!v) return null; const o = JSON.parse(v); return { userIdSet: Boolean(o.userId), hasTransferId: Boolean(o.transferId), key: (o.key || '').slice(0, 8) }; });
const loseFirst = (p, keys, { applyFirst = true, delay = 0 } = {}) => { let n = 0; return p.route('**/v1/transfers', async (route) => { if (route.request().method() !== 'POST') return route.continue(); keys.push(route.request().headers()['idempotency-key']); n += 1; if (delay) await new Promise((x) => setTimeout(x, delay)); if (n === 1) { if (applyFirst) await route.fetch(); await route.abort('connectionreset'); return; } await route.continue(); }); };
const hide = (p, state) => p.evaluate((s) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s }); document.dispatchEvent(new Event('visibilitychange')); }, state);
(async () => {
  const browser = await chromium.launch();
  if (!process.env.SKIP_M09) {
  // ---- M09: Enviando vs Verificando
  { const u = await mkUser(); const p = await newPage(browser, { h: 918 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Enviando', '9101');
    await p.route('**/v1/transfers', async (r) => { if (r.request().method() === 'POST') await new Promise((x) => setTimeout(x, 3000)); await r.continue(); });
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(900);
    const te = await p.shot('M09-enviando');
    L('M09 Enviando: "Enviando transferencia…"', /Enviando transferencia/.test(te), '| "Verificando" present', /Verificando|verificando/.test(te), '| exits disabled (back arrow aria-disabled):', await p.getByRole('button', { name: /Volver|Cancelar|Ir al inicio/ }).first().getAttribute('aria-disabled'));
    await p.waitForTimeout(3500); L('  -> then', /Transferencia completada/.test(await p.text()) ? 'receipt' : 'other'); await p.context().close(); }
  // ---- M09: lost response after processing; reload mid-way; recovery
  { const u = await mkUser(); const p = await newPage(browser, { h: 918 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Perdida', '9102');
    const keys = []; await loseFirst(p, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.text(); L('M09 lost-after-apply: verifying text', /Estamos verificando/.test(t), '| claims (intacto/debitado/no se movió)', /intacto|debitado|No se movió|ningún cargo/i.test(t), '| DB', dbRows(u.email), '| record', JSON.stringify(await rec(p)));
    await p.unroute('**/v1/transfers');
    const keys2 = []; await p.route('**/v1/transfers', (r) => { if (r.request().method() === 'POST') keys2.push(r.request().headers()['idempotency-key']); return r.continue(); });
    await p.reload(); await p.waitForTimeout(4500);
    const tr = await p.shot('M09-tras-recarga');
    L('  after reload (same storage): screen =', /Transferencia completada/.test(tr) ? 'receipt (resolved)' : /Estamos verificando|Verificando resultado/.test(tr) ? 'verifying' : /Transferencia en verificación/.test(tr) ? 'home notice' : 'other', '| POST /transfers replays with key', JSON.stringify(keys2.map((k) => k.slice(0, 8))), 'original', keys[0].slice(0, 8), '| DB', dbRows(u.email), '| ledger', dbLedger(u.email), '| record', JSON.stringify(await rec(p)));
    await p.context().close(); }
  // ---- M09: lost response BEFORE the server applied it
  { const u = await mkUser(); const p = await newPage(browser, { h: 918 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Previa', '9103');
    const keys = []; await loseFirst(p, keys, { applyFirst: false });
    const b0 = await balances(u);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    L('M09 lost-before-apply: DB rows', JSON.stringify(dbRows(u.email)), '(none expected) | balances unchanged', (await balances(u)).checking === b0.checking);
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(3500);
    L('  retry: keys', JSON.stringify(keys.map((k) => k.slice(0, 8))), 'same key', keys[0] === keys[1], '| receipt', /Transferencia completada/.test(await p.text()), '| DB', dbRows(u.email), '| debit', b0.checking - (await balances(u)).checking);
    await p.context().close(); }

  }
  // ---- M11
  { const u = await mkUser();
    const p = await newPage(browser, { h: 884 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '4000.00', 'Saldo', '9201');
    await xfer(u, u.pr, u.own, '499999'); await xfer(u, u.pr, u.own, '499999'); // the balance is spent elsewhere meanwhile (2 cents left)
    const b = await balances(u); L('M11 prep: principal balance now', b.checking);
    const b0 = await balances(u);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.shot('M11-saldo-insuficiente');
    L('M11 insufficient: reason shows requested $4,000.00 + balance', /\$4,000\.00/.test(t) && /supera el saldo disponible/.test(t), '| "Tu dinero está intacto"', /Tu dinero está intacto/.test(t), '| "Ningún dinero fue retirado"', /Ningún dinero fue retirado/.test(t), '| corrective action "Modificar monto o cuenta"', await p.getByRole('button', { name: 'Modificar monto o cuenta' }).count(), '| balances unchanged', (await balances(u)).checking === b0.checking, '| DB', dbRows(u.email).replace(/\n/g, ' | '));
    await p.btn('Modificar monto o cuenta').click(); await p.waitForTimeout(1000); const td = await p.text();
    L('  corrective: back to datos with amount kept', /4000|4,000/.test(await p.getByLabel('Monto a transferir', { exact: true }).inputValue()) || /Saldo insuficiente/.test(td), '| inline "Saldo insuficiente"', /Saldo insuficiente para este importe/.test(td));
    await p.context().close(); }
  { const u = await mkUser(); for (const [f, t] of [[u.pr, u.own], [u.pr, u.own], [u.sv, u.toPr], [u.sv, u.toPr]]) await xfer(u, f, t, '499999');
    const pol = (await call(u.token, '/transfer-policy')).b; L('M11 limit prep: dailyRemaining', pol.dailyRemainingMinor);
    const p = await newPage(browser, { h: 884 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '0.04', 'Limite', '9202');
    await xfer(u, u.pr, u.own, '4', { reference: '3' }); // consume the remaining limit on "another device"
    const b0 = await balances(u);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.shot('M11-limite-diario');
    L('M11 daily limit: reason with amounts', /límite diario de demostración/.test(t) && /\$0\.04/.test(t), '| "disponibles hoy"', /disponibles hoy/.test(t), '| row "Disponible hoy (límite diario)"', /Disponible hoy \(límite diario\)/.test(t), '| "no se debitó"/intacto', /Tu dinero está intacto|Ningún dinero fue retirado/.test(t), '| action', await p.getByRole('button', { name: 'Modificar monto o cuenta' }).count(), '| balances unchanged', (await balances(u)).checking === b0.checking);
    await p.context().close(); }
  // connection error != rejection ; 409 / 500 are not "rejected with intact money"
  for (const [label, handler] of [['connection error (reset before server)', (r) => r.abort('connectionreset')], ['HTTP 500', (r) => r.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'x', status: 500 }) })], ['HTTP 409', (r) => r.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Conflict', detail: 'Conflicto de idempotencia', status: 409 }) })]]) {
    const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Conexion', '9203');
    await p.route('**/v1/transfers', (r) => (r.request().method() === 'POST' ? handler(r) : r.continue()));
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.shot('M11-' + label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30));
    L(`M11 vs ${label}: screen =`, /Estamos verificando/.test(t) ? 'M09 verificando' : /No se pudo completar la transferencia/.test(t) ? 'M11 rechazo' : 'other', '| "Tu dinero está intacto"', /Tu dinero está intacto/.test(t), '| "Revisa tu saldo antes de reintentar"', /Revisa tu saldo antes de reintentar/.test(t));
    await p.context().close();
  }

  // ---- M12
  { const A = await mkUser('Ana López', 'a'); const B = await mkUser('Beto Pérez', 'b');
    const p = await newPage(browser, { h: 884 }); await login(p, A.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Sesion', '9301');
    const keys = []; await loseFirst(p, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1200);
    await p.unroute('**/v1/transfers');
    // curtain
    await hide(p, 'hidden'); await p.waitForTimeout(500); const tc = await p.shot('M12-cortina');
    L('M12 curtain (document hidden ~ background): "Contenido oculto por privacidad"', /Contenido oculto por privacidad/.test(tc), '| balances/name/amount visible', /\$\d{1,3}(,\d{3})*\.\d\d/.test(tc) || /Ana López|Beto|9301|300\.25/.test(tc), '| biometric claims', /biom|Face ID|huella/i.test(tc));
    // expired session: me/refresh/logout -> 401
    await p.route('**/v1/auth/me', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await p.route('**/v1/auth/refresh', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await p.route('**/v1/auth/logout', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await hide(p, 'visible'); await p.waitForTimeout(3000);
    const te = await p.shot('M12-sesion-vencida');
    L('M12 expired session: "Tu sesión ha expirado"', /Tu sesión ha expirado/.test(te), '| login form', /Iniciar sesión nuevamente/.test(te), '| record kept (bound to user)', JSON.stringify(await rec(p)));
    await p.unroute('**/v1/auth/me'); await p.unroute('**/v1/auth/refresh'); await p.unroute('**/v1/auth/logout');
    // another user logs in on the same device
    await login(p, B.email);
    const tb = await p.shot('M12-otro-usuario');
    L('M12 user B signs in: sees pending notice/verifying of A', /Transferencia en verificación|Estamos verificando|Código de confirmación/.test(tb), '| Home of B visible', /Hola, Beto/.test(tb), '| record still there', JSON.stringify(await rec(p)), '| A debit untouched in DB', dbRows(A.email));
    await p.getByRole('button', { name: 'Cerrar sesión' }).click(); await p.waitForTimeout(1500);
    L('  B logs out explicitly -> A record', JSON.stringify(await rec(p)), '(null = A\'s unresolved attempt record was deleted by B)');
    await login(p, A.email);
    const ta = await p.shot('M12-A-vuelve');
    L('M12 user A signs in again: pending notice/verifying', /Transferencia en verificación|Estamos verificando|Transferencia completada/.test(ta), '| DB', dbRows(A.email), '| balance A principal', (await balances(A)).checking);
    await p.context().close(); }
  { // A resumes when record is kept (no B logout)
    const A = await mkUser('Ana López', 'c'); const B = await mkUser('Beto Pérez', 'd');
    const p = await newPage(browser, { h: 884 }); await login(p, A.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Reanuda', '9302');
    const keys = []; await loseFirst(p, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1200); await p.unroute('**/v1/transfers');
    const k2 = []; await p.route('**/v1/transfers', (r) => { if (r.request().method() === 'POST') k2.push(r.request().headers()['idempotency-key']); return r.continue(); });
    await p.route('**/v1/auth/me', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await p.route('**/v1/auth/refresh', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
    await hide(p, 'hidden'); await hide(p, 'visible'); await p.waitForTimeout(3000);
    await p.unroute('**/v1/auth/me'); await p.unroute('**/v1/auth/refresh');
    await login(p, A.email); await p.waitForTimeout(2500);
    const ta = await p.shot('M12-mismo-usuario-reanuda');
    L('M12 same user after expiry: resumed ->', /Transferencia completada/.test(ta) ? 'receipt' : /Estamos verificando/.test(ta) ? 'verifying' : 'other', '| replay key same as original', k2[0] === keys[0], '| DB', dbRows(A.email), '| ledger', dbLedger(A.email));
    await p.context().close(); }
  // explicit logout from Home with a pending notice
  { const A = await mkUser('Ana López', 'e');
    const p = await newPage(browser, { h: 884 }); await login(p, A.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Logout', '9303');
    const keys = []; await loseFirst(p, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(1200);
    await p.getByRole('button', { name: 'Cerrar sesión' }).click(); await p.waitForTimeout(1500);
    L('Explicit logout from Home WITH a pending (applied, unverified) transfer: record after logout', JSON.stringify(await rec(p)), '| DB', dbRows(A.email));
    await login(p, A.email); const t = await p.text();
    L('  login again: notice or recovery shown', /Transferencia en verificación|Estamos verificando/.test(t), '| Home offers new transfer (Transferir dinero)', /Transferir dinero/.test(t), '| principal movements show the 30025 debit', /300\.25/.test(t));
    await p.context().close(); }
  await browser.close(); flush('logs/ui-m09-m12.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
