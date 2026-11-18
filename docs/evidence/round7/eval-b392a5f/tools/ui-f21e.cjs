// Pass 9 · item 2/3: session expiry while the record exists (M12) keeps the record; the same user resumes with the same key. API 3991.
const { chromium, L, ok, call, mkUser, balances, newPage, login, origin, choose, toReview, flush, psql } = require('./lib.cjs');
const ls = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('ss:wallet.transfer-recovery')).map((k) => [k, localStorage.getItem(k)])));
const rows = (email) => psql(`select coalesce(string_agg(t.status||':'||t.amount_minor, ' | '),'(none)') from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
(async () => {
  const browser = await chromium.launch();
  const A = await mkUser('Ana Vencida'); const p = await newPage(browser, { h: 929 }); let mode = 'lost-after'; let expired = false;
  await p.route('**/v1/**', async (route) => { const r = route.request(); const u = new URL(r.url()).pathname.replace('/v1', '');
    if (expired && /^\/auth\/(me|refresh|logout)$/.test(u)) return route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401, detail: 'x' }) });
    if (/^\/transfers/.test(u)) { if (mode === 'offline') return route.abort('connectionreset'); if (mode === 'lost-after' && r.method() === 'POST' && u === '/transfers') { await route.fetch(); return route.abort('connectionreset'); } }
    return route.continue(); });
  await login(p, A.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Vence', '7701');
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); mode = 'offline';
  await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500);
  const before = await ls(p); L('record before expiry:', Object.keys(before).length);
  expired = true; await foreground(p);
  const t = await p.text(); L('after expiry + foreground: login form', /Tu sesión ha expirado|Iniciar sesión/.test(t), '| record kept', Object.keys(await ls(p)).length === 1, '| byte-identical', JSON.stringify(await ls(p)) === JSON.stringify(before));
  ok(JSON.stringify(await ls(p)) === JSON.stringify(before), 'session expiry keeps the user record');
  expired = false; mode = 'pass'; await login(p, A.email); await p.waitForTimeout(3500);
  L('A signs in again: receipt', /Transferencia completada/.test(await p.text()), '| DB', rows(A.email), '| record entries', Object.keys(await ls(p)).length);
  ok(rows(A.email) === 'completed:30025', 'resumed, 1 transfer');
  await browser.close(); flush('logs/ui-f21e.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
