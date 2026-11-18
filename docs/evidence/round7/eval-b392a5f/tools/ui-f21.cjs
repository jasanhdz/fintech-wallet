// Pass 9 · item 1/3: F-21 (no second attempt while one is unresolved/pending) and F-22 (per-user record), real RN-Web bundle + real API/PG.
// Adapted from eval-1302862/tools/ui-m02-m09.cjs. The demo OTP is read into memory only and never printed.
const { chromium, L, ok, call, mkUser, balances, dbRows, dbLedger, newPage, login, origin, choose, toReview, flush, psql } = require('./lib.cjs');

const FORBID = /Continuar con transferencia|Elegir otro destinatario|Cambiar beneficiario|Transferir dinero|Nueva transferencia|Elegir beneficiario/;
const readCode = async (p) => { const t = await p.evaluate(() => document.body.innerText); const m = t.match(/Código asignado para esta prueba:\s*(\d{6})/); return m ? m[1] : null; };
// Network controller. create/get/confirm/cancel: 'pass' | 'lost-after' (server applies, response dropped) | 'lost-before' (server never sees it) | 'abort' (offline) | '409' (in-flight conflict body)
function wire(p, net) {
  return p.route('**/v1/transfers**', async (route) => {
    const r = route.request(); const m = r.method(); const u = new URL(r.url()).pathname.replace('/v1', '');
    const kind = m === 'POST' && u === '/transfers' ? 'create' : m === 'GET' && /^\/transfers\/[0-9a-f-]{36}$/.test(u) ? 'get' : /\/confirm$/.test(u) ? 'confirm' : /\/cancel$/.test(u) ? 'cancel' : null;
    if (!kind) return route.continue();
    const mode = net[kind] || 'pass'; net.log.push(`${kind}:${mode}`);
    if (mode === 'pass') return route.continue();
    if (mode === 'abort' || mode === 'lost-before') return route.abort('connectionreset');
    if (mode === 'lost-after') { await route.fetch(); return route.abort('connectionreset'); }
    if (mode === '409') { await route.fetch().catch(() => null); return route.fulfill({ status: 409, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, detail: 'La solicitud idempotente está en curso; reintenta con la misma llave.' }) }); }
    if (mode === '404') return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Not Found', status: 404, detail: 'Transferencia no encontrada.' }) });
    return route.continue();
  });
}
const names = async (p) => (await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 60)))).filter(Boolean);
async function audit(p, label) {
  const t = await p.text(); const b = await names(p); const tabs = await p.getByRole('tab').evaluateAll((els) => els.map((e) => (e.innerText || '').trim()));
  const bad = [...b, ...tabs].filter((n) => FORBID.test(n));
  L(`AUDIT ${label}: notice=${/Transferencia (en verificación|pendiente de autorizar)/.test(t)} forbidden-controls=${JSON.stringify(bad)} | buttons=${JSON.stringify(b.map((x) => x.slice(0, 32)))}`);
  return { t, bad };
}
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
const keysOf = (p) => [...new Set(p.reqs.filter((r) => /^POST \/transfers key/.test(r)).map((r) => r.split('key=')[1]))];
const dbCount = (email) => Number(psql(`select count(*) from transfers t join users u on u.id=t.owner_id where u.email='${email}'`));
const recKeys = (p) => p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')));

(async () => {
  const browser = await chromium.launch();
  for (const [tag, mode] of [['A-after', 'lost-after'], ['B-before', 'lost-before']]) {
    const u = await mkUser(); const p = await newPage(browser, { h: 929 }); const net = { log: [] }; await wire(p, net); await login(p, u.email);
    L(`\n===== SCENARIO ${tag}: response lost (${mode}); Principal -> Ahorro $300.25 =====`);
    const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Prueba F21', '9001');
    net.create = mode; net.get = 'abort'; // after the first lost response the network stays down
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    L('M09 shown:', /Estamos verificando|Verificando/.test(await p.text()));
    L('DB after lost response:', dbRows(u.email) || '(no rows)', '| ledger', dbLedger(u.email));
    net.create = 'abort';
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(2500);
    await p.setViewportSize({ width: 390, height: 929 });
    await p.shot(`F21-${tag}-inicio-bloqueado`);
    let a = await audit(p, 'Home (offline)'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'Home: only notice, no entry to a new transfer');
    // other entry points: Movimientos tab, movement detail, account tabs, back to Inicio
    await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1200);
    a = await audit(p, 'Movimientos'); ok(a.bad.length === 0, 'Movimientos: no new-transfer entry');
    const firstMv = p.getByRole('button', { name: /Cargo|Abono|\$/ }).first(); if (await firstMv.count()) { await firstMv.click().catch(() => null); await p.waitForTimeout(1200); await audit(p, 'detalle de movimiento'); }
    await p.getByRole('button', { name: /Volver a movimientos|Movimientos/ }).first().click().catch(() => null); await p.waitForTimeout(500);
    await p.getByRole('tab', { name: /Inicio/ }).click().catch(() => null); await p.waitForTimeout(1500);
    a = await audit(p, 'Inicio otra vez'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'Home again still locked');
    // account tab switch (the other own account) + "Cerrar sesión"-less checks
    await p.getByRole('button', { name: /^Ahorro ••/ }).first().click().catch(() => null); await p.waitForTimeout(500);
    a = await audit(p, 'Inicio, cuenta de ahorro'); ok(a.bad.length === 0, 'account tab switch does not reopen a new-transfer entry');
    // tap the one action while offline: stays locked
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    const tt = await p.text(); L('after "Verificar" offline -> screen:', /Estamos verificando|No pudimos confirmar/.test(tt) ? 'M09 status' : /Transferencia en verificación/.test(tt) ? 'Home notice' : 'other');
    await p.shot(`F21-${tag}-verificar-offline`);
    // reload (app restart) while offline: recovery record is read; still no new-attempt path
    await p.reload(); await p.waitForTimeout(4000); await wire(p, net);
    L('record keys after reload:', JSON.stringify((await recKeys(p)).map((k) => k.replace(/[0-9a-f-]{36}/, '<userId>'))));
    const tr = await p.text(); L('after reload offline: screen is', /Estamos verificando|No pudimos confirmar|Verificando/.test(tr) ? 'M09 status' : /Transferencia en verificación/.test(tr) ? 'Home notice' : 'other');
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500); }
    a = await audit(p, 'Home after reload (offline)'); ok(a.bad.length === 0, 'after reload no new-transfer entry');
    // new login keeps blocked? (logout + login same user)
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500);
    L('record kept after explicit logout:', JSON.stringify((await recKeys(p)).map((k) => k.replace(/[0-9a-f-]{36}/, '<userId>'))));
    await login(p, u.email); await p.waitForTimeout(1500);
    const tl = await p.text(); L('after relogin offline:', /Estamos verificando|Verificando/.test(tl) ? 'M09 status' : /Transferencia en verificación/.test(tl) ? 'Home notice' : 'other');
    if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500); }
    a = await audit(p, 'Home after relogin (offline)'); ok(a.bad.length === 0, 'after relogin no new-transfer entry');
    L('DB while offline:', dbRows(u.email) || '(no rows)', '| transfers', dbCount(u.email));
    // network back; foreground resolves by itself
    net.create = 'pass'; net.get = 'pass'; p.reqs.length = 0;
    await foreground(p);
    const t2 = await p.shot(`F21-${tag}-resuelto-primer-plano`);
    L('foreground resolved -> receipt:', /Transferencia completada/.test(t2), '| keys used on replay', JSON.stringify(keysOf(p).length), '| requests:', JSON.stringify(p.reqs.map((r) => r.replace(/ key=-$/, ''))));
    L('RESULT balances principal', b0.checking, '->', (await balances(u)).checking, '| DB:', dbRows(u.email), '| ledger', dbLedger(u.email), '| transfers', dbCount(u.email));
    ok(dbCount(u.email) === 1, `${tag}: exactly 1 transfer`);
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500);
    a = await audit(p, 'Home after resolution'); ok(/Continuar con transferencia|Elegir otro destinatario/.test((await names(p)).join('|')) || !/Transferencia en verificación/.test(a.t), 'flow enabled again after resolution (notice gone)');
    L('record keys after resolution:', JSON.stringify((await recKeys(p)).length));
    L('errs', p.errs.length, JSON.stringify(p.errs.slice(0, 3)));
    await p.context().close();
  }
  await browser.close(); flush('logs/ui-f21.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
