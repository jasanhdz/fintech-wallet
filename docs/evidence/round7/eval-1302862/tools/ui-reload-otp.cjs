// Reopen (page reload = cold start with the same SecureStore shim) while the code step is open: the same attempt must be resumed with its
// original key, the code box recovered by the idempotent replay (never stored), and no second attempt created.
const { chromium, L, mkUser, newPage, login, origin, choose, toReview, dbRows, psql, flush } = require('./lib.cjs');
const rewrite = (p) => p.route('http://127.0.0.1:3897/**', (r) => r.continue({ url: r.request().url().replace(':3897', ':3898') }));
(async () => {
  const browser = await chromium.launch(); const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p);
  await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Reabre', '31');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2000);
  const stored = await p.evaluate(() => localStorage.getItem('ss:wallet.transfer-recovery') || ''); L('record keeps the demo code?', /\d{6}/.test(stored.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '')) && /demoOnlyCode/.test(stored));
  p.reqs.length = 0; await p.reload(); await p.waitForTimeout(5000);
  const t = await p.text();
  L('after reload: code step', /Código de confirmación/.test(t), '| demo code box recovered', /Código asignado para esta prueba/.test(t), '| rows', dbRows(u.email).replace(/\n/g, ' | '), '| POST /transfers replays', p.reqs.filter((r) => /^POST \/transfers key/.test(r)).length, '| countdown', (t.match(/El código expira en\s*\n?\s*(\d\d:\d\d)/) || [])[1]);
  await browser.close(); flush('logs/ui-reload-otp.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
