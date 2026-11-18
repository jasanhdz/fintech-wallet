// R7 H3 · F-21/F-22 on the real RN-Web bundle + real API/PostgreSQL (wallet_test). Reproduces the evaluator's scenario
// (eval-1302862/tools/ui-m02-m09.cjs, second block): Principal -> "Cuenta de ahorro demo", $300.25, the create response is
// lost AFTER the server applied it, "Ir al inicio". Usage: EV_OUT=<dir> H3_VARIANT=before|after node h3-f21.cjs
const { chromium, L, ok, balances, dbRows, dbLedger, mkUser, newPage, login, origin, choose, toReview, flush } = require('./lib.cjs');
const variant = process.env.H3_VARIANT || 'after';
const tag = variant === 'before' ? 'antes' : 'despues';
const count = (p, name) => p.getByRole('button', { name, exact: false }).count();
const entries = async (p) => ({ continuar: await count(p, 'Continuar con transferencia'), transferir: await p.getByRole('button', { name: /^Transferir dinero/ }).count(), cambiar: await count(p, 'Cambiar beneficiario'), verificar: await count(p, 'Verificar estado de la transferencia'), pendiente: await count(p, 'Continuar con la transferencia pendiente') });
// Loses POST /transfers responses AFTER the API applied them (route.fetch reaches the server first) while lose(n) is true.
const loseCreates = async (p, lose, keys) => { let n = 0; await p.route('**/v1/transfers', async (route) => { if (route.request().method() !== 'POST') return route.fallback(); keys.push(route.request().headers()['idempotency-key']); n += 1; const resp = await route.fetch({ url: p.mapUrl(route.request().url()) }); if (lose(n)) { await route.abort('connectionreset'); return; } await route.fulfill({ response: resp }); }); };
const db = (u) => `transfers [${dbRows(u.email).replace(/\n/g, ' | ')}] ledger ${dbLedger(u.email)}`;
(async () => {
  const browser = await chromium.launch();
  L(`===== variant ${variant} =====`);
  // ---- A. Evaluator's scenario: only the original response is lost.
  { const u = await mkUser(); const p = await newPage(browser, { h: 929, variant }); await login(p, u.email);
    const b0 = await balances(u); const keys = [];
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Prueba doble', '4401');
    await loseCreates(p, (n) => n === 1, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.shot(`A-M09-${tag}`);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(3000);
    const t = await p.shot(`A-tras-ir-al-inicio-${tag}`);
    const e = await entries(p);
    L('A after "Ir al inicio": receipt shown', /Transferencia completada/.test(t), '| notice', /Transferencia en verificación/.test(t), '| entries', e, '| record', await p.recovery());
    if (e.continuar) { // the evaluator's probe: create a SECOND attempt through the visible action
      await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
      await p.getByLabel('Monto a transferir', { exact: true }).fill('300.25'); await p.getByLabel('Concepto de pago', { exact: true }).fill('Prueba doble'); await p.getByLabel(/Referencia numérica/).first().fill('4401');
      await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1200);
      await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
      await p.shot(`A-segundo-intento-${tag}`);
      L('A second attempt sent through "Continuar con transferencia"');
    } else if (/Transferencia completada/.test(t)) {
      await p.btn('Ir al inicio').click(); await p.waitForTimeout(2000);
      const t2 = await p.shot(`A-inicio-rehabilitado-${tag}`);
      L('A back on Home: notice', /Transferencia en verificación/.test(t2), '| entries', await entries(p), '| record', await p.recovery());
    }
    const b1 = await balances(u);
    L('A keys', keys.map((k) => k.slice(0, 8)), 'distinct', new Set(keys).size, '| POST /transfers', keys.length);
    L('A principal', b0.checking, '->', b1.checking, '(debit', b0.checking - b1.checking, ') savings', b0.savings, '->', b1.savings);
    L('A DB', db(u));
    L('A page errors', p.errs);
    if (variant === 'after') ok(new Set(keys).size === 1 && b0.checking - b1.checking === 30025n, 'A: one key, one debit of 300.25');
    await p.context().close(); }
  if (variant === 'before') { await browser.close(); flush(`logs/h3-f21-${tag}.txt`); return; }
  // ---- B. Home's own re-check is lost too: Home stays locked; logout keeps the record; signing in resumes it.
  { const u = await mkUser(); const p = await newPage(browser, { h: 929, variant }); await login(p, u.email);
    const b0 = await balances(u); const keys = [];
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Bloqueo', '4402');
    let offline = true; await loseCreates(p, () => offline, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(3000);
    const t = await p.shot(`B-inicio-bloqueado-${tag}`);
    const e = await entries(p);
    L('B Home locked: notice', /Transferencia en verificación/.test(t), '| "Sin respuesta por ahora"', /Sin respuesta por ahora/.test(t), '| entries', e, '| record', await p.recovery());
    ok(e.continuar === 0 && e.transferir === 0 && e.cambiar === 0 && e.verificar === 1, 'B: Home offers no new-attempt entry, only "Verificar estado"');
    // Movements tab and back: still locked (no entry appears on return).
    await p.getByRole('tab', { name: /Movimientos/ }).click().catch(() => p.getByText('Movimientos', { exact: true }).last().click()); await p.waitForTimeout(1200);
    await p.getByRole('tab', { name: /Inicio/ }).click().catch(() => p.getByText('Inicio', { exact: true }).last().click()); await p.waitForTimeout(2500);
    L('B after Movimientos -> Inicio: entries', await entries(p), '| POST so far', keys.length);
    await p.getByLabel('Cerrar sesión').click(); await p.waitForTimeout(2000);
    L('B after "Cerrar sesión": login shown', /Iniciar sesión/.test(await p.text()), '| record', await p.recovery());
    ok((await p.recovery()).length === 1, 'B: logout keeps the own record');
    offline = false;
    await login(p, u.email); await p.waitForTimeout(3000);
    const t2 = await p.shot(`B-reanudado-tras-reentrar-${tag}`);
    L('B after signing in again: receipt', /Transferencia completada/.test(t2), '| record', await p.recovery());
    const b1 = await balances(u);
    L('B keys', keys.map((k) => k.slice(0, 8)), 'distinct', new Set(keys).size, '| POST /transfers', keys.length, '| principal debit', b0.checking - b1.checking);
    L('B DB', db(u));
    ok(new Set(keys).size === 1 && b0.checking - b1.checking === 30025n, 'B: one key, one debit');
    await p.context().close(); }
  // ---- C. F-22: A leaves an unresolved attempt and signs out; B signs in on the same device, transfers, signs out; A resumes.
  { const a = await mkUser('Ana López', 'fa'); const b = await mkUser('Beatriz Ruiz', 'fb');
    const p = await newPage(browser, { h: 929, variant }); await login(p, a.email);
    const a0 = await balances(a); const keys = [];
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '300.25', 'Usuario A', '4403');
    await loseCreates(p, () => true, keys);
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    await p.btn('Ir al inicio (revisar saldo después)').click(); await p.waitForTimeout(3000);
    await p.getByLabel('Cerrar sesión').click(); await p.waitForTimeout(1500);
    const recA = await p.recovery(); L('C A signed out: records', recA);
    await p.unroute('**/v1/transfers');
    await login(p, b.email);
    const tb = await p.shot(`C-usuario-B-${tag}`);
    L('C B Home: sees A notice', /Transferencia en verificación|pendiente de autorizar/.test(tb), '| entries', await entries(p));
    await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '10.00', 'Usuario B', '1');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
    L('C B transfer completed', /Transferencia completada/.test(await p.text()));
    await p.btn('Ir al inicio').click(); await p.waitForTimeout(1500);
    await p.getByLabel('Cerrar sesión').click(); await p.waitForTimeout(1500);
    const recAfterB = await p.recovery(); L('C after B signs out: records', recAfterB);
    ok(JSON.stringify(recAfterB) === JSON.stringify(recA), 'C: B never deletes nor replaces A\'s record');
    const aKeys = []; await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') aKeys.push(route.request().headers()['idempotency-key']); await route.fallback(); });
    await login(p, a.email); await p.waitForTimeout(3000);
    const ta = await p.shot(`C-usuario-A-reanuda-${tag}`);
    const a1 = await balances(a);
    L('C A resumes: receipt', /Transferencia completada/.test(ta), '| replay key equals original', aKeys.length > 0 && aKeys.every((k) => k === keys[0]), '| record', await p.recovery());
    L('C A DB', db(a), '| A principal debit', a0.checking - a1.checking, '| B DB', db(b));
    ok(a0.checking - a1.checking === 30025n, 'C: A debited once');
    await p.context().close(); }
  await browser.close(); flush(`logs/h3-f21-${tag}.txt`);
})().catch((e) => { console.error('FAILED', e.message); flush(`logs/h3-f21-${tag}-failed.txt`); process.exit(1); });
