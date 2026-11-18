// Items 2-5: M07 threshold/bar, M08 code states, expiry, attempts, cancel, new code. Runs against API#2 (EV_API_PORT=3992:
// threshold 123456, expiry 90 s (API#3 :3993 = 8 s for the expiry block), 3 attempts, daily limit 1,500,000) through the bundle exported for :3991 (requests are rewritten).
const { chromium, L, ok, call, mkUser, balances, dbRows, dbLedger, psql, newPage, login, origin, choose, fill, toReview, box, flush, crypto } = require('./lib.cjs');
const rewrite = (p, port = 3992) => p.route('http://127.0.0.1:3991/**', (r) => r.continue({ url: r.request().url().replace(':3991', ':' + port) }));
const readCode = async (p) => { const t = await p.evaluate(() => document.body.innerText); const m = t.match(/Código asignado para esta prueba:\s*(\d{6})/); return m ? m[1] : null; };
const wrongOf = (c) => (c === '000000' ? '111111' : '000000');
const pendingCount = (email) => psql(`select count(*) from transfers t join users x on x.id=t.owner_id where x.email='${email}' and t.status='awaiting_confirmation'`);
(async () => {
  const browser = await chromium.launch();
  const pol = (await call((await mkUser('Probe', 'pol')).token, '/transfer-policy')).b;
  L('API#2 policy', { otpThresholdMinor: pol.otpThresholdMinor, otpExpirySeconds: pol.otpExpirySeconds, otpMaxAttempts: pol.otpMaxAttempts, dailyLimitMinor: pol.dailyLimitMinor });
  if (!process.env.SKIP_O1) {
  // ---- O1. threshold from policy at review, bar proportions, F-15 positions
  for (const [amount, expectOtp] of [['1234.55', false], ['1234.56', true], ['1234.57', true]]) {
    const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, amount);
    const t = await p.text();
    const hasPrimary = await p.getByRole('button', { name: 'Continuar a verificación' }).count();
    const hasConfirm = await p.getByRole('button', { name: 'Confirmar transferencia' }).count();
    ok(Boolean(hasPrimary) === expectOtp && Boolean(hasConfirm) === !expectOtp, `M07 amount ${amount} (policy threshold 1,234.56): code variant=${Boolean(hasPrimary)} (expected ${expectOtp}); chip text: ${/mayor o igual a \$1,234\.56/.test(t)}`);
    if (amount === '1234.56') await p.shot('M07-umbral-politica-API2');
    // bar proportions
    const bar = await p.evaluate(() => { const b = document.querySelector('[data-testid="estimate-bar"]'); if (!b) return null; const w = b.getBoundingClientRect().width; return { total: Math.round(w), kids: [...b.children].map((k) => Math.round(k.getBoundingClientRect().width * 100) / 100), ariaHidden: b.getAttribute('aria-hidden'), hiddenAncestor: !!b.closest('[aria-hidden="true"]'), bg: [...b.children].map((k) => getComputedStyle(k).backgroundColor) }; });
    const expectRemaining = ((1000000 - Math.round(parseFloat(amount) * 100)) / 1000000);
    L(`  bar ${amount}: widths=${JSON.stringify(bar.kids)} of ${bar.total}px; remaining share=${(bar.kids[0] / bar.total).toFixed(4)} expected ${expectRemaining.toFixed(4)}; aria-hidden=${bar.ariaHidden || bar.hiddenAncestor}; colors=${JSON.stringify(bar.bg)}`);
    await p.context().close();
  }
  // bar at 3000.00 (70/30), and at 10000.00 -> 0 remaining; no alarming colors (record rgb)
  for (const amount of ['3000.00', '9999.99', '10000.00']) {
    const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000);
    await fill(p, amount); const cont = p.getByRole('button', { name: /^Continuar(?! con| a )/ }); const dis = await cont.getAttribute('aria-disabled');
    if (dis === 'true') { L(`  amount ${amount}: Continuar disabled (daily limit/balance) - bar not reachable`); await p.context().close(); continue; }
    await cont.click(); await p.waitForTimeout(1000);
    const bar = await p.evaluate(() => { const b = document.querySelector('[data-testid="estimate-bar"]'); if (!b) return null; const w = b.getBoundingClientRect().width; return { total: w, kids: [...b.children].map((k) => k.getBoundingClientRect().width), bg: [...b.children].map((k) => getComputedStyle(k).backgroundColor) }; });
    L(`  bar ${amount}: ${bar ? `remaining ${(bar.kids[0] / bar.total * 100).toFixed(2)}% spent-segment ${(bar.kids[1] / bar.total * 100).toFixed(2)}% colors=${JSON.stringify(bar.bg)}` : 'no estimate card'}`);
    if (amount === '3000.00') await p.shot('M07-barra-70-30');
    await p.context().close();
  }
  // F-15: threshold variant actions at 844 with real account names
  { const u = await mkUser(); const p = await newPage(browser, { h: 844 }); await rewrite(p); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00');
    L('F-15 M07 umbral @390x844: Continuar a verificación', await box(p, 'Continuar a verificación'), '| Modificar datos', await box(p, 'Modificar datos'), '(viewport height 844)');
    await p.shot('M07-umbral-844');
    await p.mouse.move(195, 400); await p.mouse.wheel(0, 3000); await p.waitForTimeout(500);
    L('  after scrolling to the end: Continuar', await box(p, 'Continuar a verificación'), '| Modificar', await box(p, 'Modificar datos'));
    await p.shot('M07-umbral-844-desplazado');
    await p.context().close(); }

  }
  // ---- O2. M08 states
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p); await login(p, u.email);
    const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Prueba codigo', '8801');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
    const code = await readCode(p); ok(Boolean(code), 'M08 shows the demo code box (dev only)');
    const input = p.getByLabel('Código de confirmación', { exact: true });
    const t0 = await p.shot('M08-vacio');
    L('M08 empty: Autorizar disabled =', await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled'), '| countdown text =', (t0.match(/El código expira en\s*\n?\s*(\d\d:\d\d)/) || [])[1], '(expiry 90 s -> 01:2x-01:30 expected)', '| threshold note:', /mayor o igual a \$1,234\.56/.test(t0));
    await input.click(); await p.keyboard.type('12'); await p.waitForTimeout(300);
    const t1 = await p.shot('M08-incompleto', { keepFocus: true }); L('M08 incomplete "12":', /Faltan 4 dígitos/.test(t1), '| Autorizar disabled =', await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled'));
    await p.keyboard.insertText('3 4-5'); await p.waitForTimeout(200); L('  after typing "3 4-5" (insertText): value length =', (await input.inputValue()).length, '(digits only expected 5)');
    await p.keyboard.press('Backspace'); L('  Backspace -> length', (await input.inputValue()).length, 'text', /Faltan 2 dígitos/.test(await p.text()));
    await input.fill(''); await p.keyboard.insertText('12a3456789'); L('  paste "12a3456789" -> value length', (await input.inputValue()).length, '(max 6, digits only)');
    await input.fill(''); await p.keyboard.insertText(wrongOf(code)); await p.waitForTimeout(300);
    const t2 = await p.shot('M08-completo', { keepFocus: true }); L('M08 complete:', /Código completo/.test(t2), '| Autorizar disabled =', await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled'));
    // verifying: delay the confirm
    await p.route('**/v1/transfers/*/confirm', async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue(); });
    await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(700);
    const tv = await p.shot('M08-verificando', { keepFocus: true });
    L('M08 verifying: "Verificando código…"', /Verificando código/.test(tv), '| "Enviando transferencia" present', /Enviando transferencia/.test(tv), '| input editable', await input.isEditable(), '| exits disabled: Cancelar', await p.getByRole('button', { name: 'Cancelar y volver a revisar' }).first().getAttribute('aria-disabled'));
    await p.waitForTimeout(3000);
    const tw = await p.shot('M08-incorrecto');
    L('M08 wrong code (422): message', /Código incorrecto/.test(tw), '| mentions max attempts (3):', /Tras 3 intentos/.test(tw), '| input cleared', (await input.inputValue()).length === 0, '| balances', String((await balances(u)).checking), 'unchanged', (await balances(u)).checking === b0.checking);
    await p.unroute('**/v1/transfers/*/confirm');
    await input.fill(''); await p.keyboard.insertText(wrongOf(code)); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(1500);
    L('  2nd wrong ->', /Código incorrecto/.test(await p.text()) ? 'still "incorrecto"' : 'other state');
    await input.fill(''); await p.keyboard.insertText(wrongOf(code)); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(1500);
    const tl = await p.shot('M08-intentos-agotados');
    L('M08 3rd wrong -> locked state:', /Se agotaron los intentos/.test(tl), '| input editable', await input.isEditable(), '| Autorizar disabled', await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled'), '| demo code still shown', /Código asignado/.test(tl), '| "Solicitar un código nuevo"', await p.getByRole('button', { name: 'Solicitar un código nuevo' }).count());
    // with the correct code after lock -> server must refuse (API direct)
    const pend = psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' and t.status='awaiting_confirmation'`);
    const lockedConfirm = await call(u.token, `/transfers/${pend}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code }) });
    L('  API: correct code after lockout ->', lockedConfirm.s, '(429 expected) | balances unchanged', (await balances(u)).checking === b0.checking);
    // new code: observe the request sequence
    p.reqs.length = 0;
    await p.getByRole('button', { name: 'Solicitar un código nuevo' }).first().click(); await p.waitForTimeout(3000);
    L('  new code requests:', JSON.stringify(p.reqs.filter((r) => /POST \/transfers/.test(r)).map((r) => r.replace(/\/[0-9a-f]{4}/, '/id'))));
    L('  DB after new code:', dbRows(u.email).replace(/\n/g, ' | '), '| pending=', pendingCount(u.email), '| balances unchanged', (await balances(u)).checking === b0.checking);
    const code2 = await readCode(p); const tn = await p.shot('M08-codigo-nuevo');
    L('  new attempt: fresh countdown & code box:', Boolean(code2), 'differs from old:', code2 !== code, '| data kept: amount 2,000.00', /2,000\.00/.test(tn), '| recipient', /Cuenta de ahorro demo/.test(tn));
    // old code must not authorize the new attempt
    const oldTry = code2 === code ? null : await call(u.token, `/transfers/${psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' and t.status='awaiting_confirmation'`)}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code }) });
    L('  OLD code on NEW attempt ->', oldTry ? oldTry.s : 'collision, skipped', '| balances unchanged', (await balances(u)).checking === b0.checking, '| old attempt row status:', psql(`select status from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' order by t.created_at limit 1`));
    // authorize with the new code through the UI (new attempt has all 3 attempts available; wait: the old wrong try consumed 1)
    await p.getByLabel('Código de confirmación', { exact: true }).fill(''); await p.keyboard.insertText(code2); await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3000);
    const tr = await p.shot('M10-tras-codigo-nuevo');
    L('  authorize new code -> receipt:', /Transferencia completada/.test(tr), '| DB:', dbRows(u.email).replace(/\n/g, ' | '), '| ledger', dbLedger(u.email), '| debit', b0.checking - (await balances(u)).checking);
    await p.context().close(); }

  // ---- O3. real expiry (8 s)
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p, 3993); await login(p, u.email);
    const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Expira', '8802');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(1500);
    const code = await readCode(p);
    const c1 = (await p.text()).match(/El código expira en\s*\n?\s*(\d\d:\d\d)/)?.[1];
    await p.waitForTimeout(9500);
    const te = await p.shot('M08-expirado');
    L('M08 expiry: countdown at start', c1, '| expired banner', /El código ha expirado/.test(te), '| input editable', await p.getByLabel('Código de confirmación', { exact: true }).isEditable(), '| Autorizar disabled', await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled'), '| demo code hidden', !/Código asignado/.test(te));
    const pend = psql(`select t.id from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' and t.status='awaiting_confirmation'`);
    const late = await call(u.token, `/transfers/${pend}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code }) });
    L('  API: correct code after expiry ->', late.s, late.b?.detail, '| DB status now:', psql(`select status from transfers where id='${pend}'`), '| balances unchanged', (await balances(u)).checking === b0.checking);
    p.reqs.length = 0;
    await p.getByRole('button', { name: 'Solicitar un código nuevo' }).first().click(); await p.waitForTimeout(3000);
    L('  new code after expiry: requests', JSON.stringify(p.reqs.filter((r) => /POST \/transfers/.test(r)).map((r) => r.replace(/\/[0-9a-f]{4}/, '/id'))), '| DB', dbRows(u.email).replace(/\n/g, ' | '), '| balances unchanged', (await balances(u)).checking === b0.checking);
    await p.context().close(); }

  // ---- O4. cancel from M08
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p); await login(p, u.email);
    const b0 = await balances(u);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Cancela', '8803');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(1500);
    p.reqs.length = 0; await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(2000);
    const t = await p.shot('M07-tras-cancelar');
    L('M08 cancel: requests', JSON.stringify(p.reqs.filter((r) => /cancel/.test(r)).map((r) => r.replace(/\/[0-9a-f]{4}/, '/id'))), '| back at review', /Revisar transferencia|Modificar datos/.test(t), '| data kept (Cancela / 8803 / 2,000.00)', /Cancela/.test(t) && /8803/.test(t) && /2,000\.00/.test(t), '| DB', dbRows(u.email).replace(/\n/g, ' | '), '| balances unchanged', (await balances(u)).checking === b0.checking);
    await p.context().close(); }

  // ---- O5. new code with an uncertain previous attempt: nothing may be created
  { const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p); await login(p, u.email);
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Incierto', '8804');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(1500);
    await p.route('**/v1/transfers/*/cancel', (r) => r.abort('connectionreset'));
    await p.route(/\/v1\/transfers\/[0-9a-f-]{36}$/, (r) => r.abort('connectionreset'));
    p.reqs.length = 0; await p.getByRole('button', { name: 'Solicitar un código nuevo' }).first().click(); await p.waitForTimeout(2500);
    const t = await p.shot('M08-codigo-nuevo-incierto');
    L('M08 new code with unreadable previous attempt: POST /transfers (create) =', p.reqs.filter((r) => /^POST \/transfers key/.test(r)).length, '| message shown', /No pudimos confirmar que el intento anterior/.test(t), '| pending rows =', pendingCount(u.email), '| still on code step', /Código de confirmación/.test(t));
    await p.context().close(); }
  await browser.close(); flush('logs/ui-otp.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
