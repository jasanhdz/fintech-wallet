// Pass 9 · item 2: corrupted / unreadable record at submit time (fail closed) and 5xx while the notice is shown. API 3991.
const { chromium, L, ok, call, mkUser, balances, newPage, login, origin, choose, toReview, flush, psql, crypto } = require('./lib.cjs');
const rows = (email) => psql(`select coalesce(string_agg(t.status||':'||t.amount_minor, ' | ' order by t.created_at),'(none)') from transfers t join users u on u.id=t.owner_id where u.email='${email}'`);
const uid = async (u) => (await call(u.token, '/auth/me')).b.id;
const foreground = async (p) => { await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(400); await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }); await p.waitForTimeout(2500); };
(async () => {
  const browser = await chromium.launch();
  for (const kind of ['corrupt', 'unreadable']) {
    L(`\n===== T (${kind}) =====`);
    const u = await mkUser('Tomas Prueba'); const p = await newPage(browser, { h: 929 }); await login(p, u.email); const id = await uid(u);
    if (kind === 'corrupt') await p.evaluate(([k, v]) => localStorage.setItem(k, v), [`ss:wallet.transfer-recovery.${id}`, '{"key":"x","payload":']);
    else await p.evaluate(() => { const g = window.__ss.get; window.__ss.get = async (k, o) => { if (String(k).startsWith('wallet.transfer-recovery')) throw new Error('SecureStore unavailable'); return g(k, o); }; });
    if (kind === 'corrupt') { await p.reload(); await p.waitForTimeout(4000); L('  app screen after restart with corrupt record shows raw error text:', /Unexpected end of JSON input/.test(await p.text())); await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500); }
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '100.00', 'T', '6001');
    p.reqs.length = 0; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.shot(`T-${kind}-confirmar`);
    L('message "No pudimos comprobar si tienes una transferencia en verificación":', /No pudimos comprobar si tienes una transferencia/.test(t), '| POST /transfers sent', p.reqs.filter((r) => /^POST \/transfers key/.test(r)).length, '| DB', rows(u.email));
    L('  controls on screen:', JSON.stringify((await p.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\n/g, ' ').slice(0, 40)))).filter(Boolean)));
    await p.btn('Confirmar transferencia').click().catch(() => null); await p.waitForTimeout(1500);
    L('  second tap -> POST sent', p.reqs.filter((r) => /^POST \/transfers key/.test(r)).length, '(0 = blocked every time; the record is unreadable so no escape in the UI)');
    await p.context().close();
  }
  { L('\n===== T (500 mientras el aviso está visible) =====');
    const u = await mkUser('Tomas Quinientos'); const p = await newPage(browser, { h: 929 }); let mode = 'lost-after'; await p.route('**/v1/transfers**', async (route) => { const r = route.request(); const isCreate = r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/transfers'); const isGet = r.method() === 'GET'; if (mode === 'lost-after' && isCreate) { await route.fetch(); return route.abort('connectionreset'); } if (mode === '500' && (isCreate || isGet)) return route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'x' }) }); return route.continue(); });
    await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '100.00', 'T5', '6002');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500); mode = '500';
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(2500);
    let t = await p.text(); L('Home with 500 from API: notice', /Transferencia en verificación/.test(t), '| "Sin respuesta por ahora"', /Sin respuesta por ahora/.test(t), '| forbidden entries', /Continuar con transferencia|Elegir otro destinatario|Transferir dinero/.test(t));
    mode = 'pass'; await foreground(p); t = await p.text(); L('API back + foreground -> receipt:', /Transferencia completada/.test(t), '| DB', rows(u.email));
    await p.context().close(); }
  await browser.close(); flush('logs/ui-f21d.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
