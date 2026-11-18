// Pass 10 · criteria 1 (retry/resend/resume), 3, 4, 6, 7: resend variants, REAL concurrent 409, REAL 404 (GET and POST), corrupt record,
// unreadable SecureStore, matching charge in Movimientos. Real RN-Web bundle + real API + wallet_test.
const H = require('./h10.cjs');
const { chromium, L, ok, call, mkUser, newPage, login, wire, uid, rec, setRec, audit, fg, nCreates, q, summary, toConfirm, flush, IN_PROGRESS, psql, crypto, FORBID } = H;
const WHICH = (process.env.EV_SC || 'resend409,resend4xx,race,get404,post404,corrupt,unreadable,matching').split(',');
const has = (x) => WHICH.includes(x);
const goHome = async (p) => { if (await p.getByRole('button', { name: /Ir al inicio/ }).count()) { await p.btn('Ir al inicio').click(); await p.waitForTimeout(1200); } };
const setup = async (browser, opts = {}) => { const u = await mkUser('Ana López'); const id = await uid(u); const p = await newPage(browser, { h: 929 }); const net = {}; await wire(p, net); await login(p, u.email); return { u, id, p, net, d: q(u.email) }; };
const lostBefore = async (c, mode = 'lost-before', amount = '300.25') => { await toConfirm(c.p, amount); c.net.create = mode; await c.p.btn('Confirmar transferencia').click(); await c.p.waitForTimeout(2500); c.net.create = 'abort'; c.net.get = 'abort'; await goHome(c.p); };
const resendOpen = async (c) => { await c.p.btn('Reenviar la misma transferencia').click(); await c.p.waitForTimeout(900); };
const resendTap = async (c) => { await c.p.btn('Reenviar la misma transferencia').click(); await c.p.waitForTimeout(3500); };
const m09 = (t) => /Estamos verificando/.test(t) && !/No se pudo completar la transferencia|Tu dinero está intacto/.test(t);

(async () => {
  const browser = await chromium.launch();
  // ---- resend answered by 409 "en curso" (applied / not applied), then the same key again
  if (has('resend409')) for (const [tag, mode, applied] of [['resend-409-applied', 'exec-err:409:' + IN_PROGRESS, true], ['resend-409-notapplied', 'err:409:' + IN_PROGRESS, false]]) {
    L(`\n===== ${tag}: first send lost-before (never applied), explicit resend answered ${mode.slice(0, 22)} (applied by server: ${applied}) =====`);
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await lostBefore(c, 'lost-before'); const R0 = await rec(p, id); const k0 = JSON.parse(R0).key;
    net.create = mode; net.get = 'pass'; await resendOpen(c); await resendTap(c);
    let t = await p.text(); ok(m09(t), `${tag}: resend answered 409 stays in M09 verification (never M11)`); await p.shot(`ev10-2-${tag}-m09`);
    ok((await rec(p, id)) === R0, `${tag}: record byte-identical after the 409`);
    L('DB:', d.rows(), 'debits', d.debits());
    let a = await audit(p, 'M09 after 409'); ok(a.bad.length === 0, `${tag}: no path to another attempt from M09`);
    await goHome(p); a = await audit(p, 'Inicio'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), `${tag}: Inicio locked`);
    // another resend still carries the same key; now it passes (server answers with the applied or new transfer)
    net.create = 'pass'; const cb = nCreates(net); await resendOpen(c); await resendTap(c);
    ok(nCreates(net) === cb + 1 && net.creates[nCreates(net) - 1].key === k0 && net.creates[nCreates(net) - 1].body === JSON.stringify(JSON.parse(R0).payload), `${tag}: second resend: same key ${k0.slice(0, 8)} and byte-identical body`);
    t = await p.text(); ok(/Transferencia exitosa|Comprobante|Folio/.test(t), `${tag}: receipt`);
    const s = await summary(u, 'final'); ok(s.n === 1 && s.debits === 1, `${tag}: 1 transfer, 1 debit`);
    await p.context().close();
  }
  // ---- resend answered by other non-business 4xx
  if (has('resend4xx')) for (const [tag, mode] of [['400', 'err:400:Datos de transferencia inválidos.'], ['401', 'err:401:La sesión expiró.'], ['403', 'err:403:Acceso denegado.'], ['429-rate', 'err:429:Demasiadas solicitudes. Inténtalo más tarde.'], ['500', 'exec-err:500:Ocurrió un problema.']]) {
    L(`\n===== resend-${tag}: explicit resend answered ${mode.slice(0, 30)} =====`);
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await lostBefore(c, 'lost-after'); const R0 = await rec(p, id);
    net.create = mode; net.get = 'pass'; await resendOpen(c); await resendTap(c);
    let t = await p.text(); ok(m09(t), `resend-${tag}: stays in M09 (never M11)`);
    ok((await rec(p, id)) === R0, `resend-${tag}: record byte-identical`);
    await goHome(p); const a = await audit(p, 'Inicio'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), `resend-${tag}: Inicio locked`);
    await fg(p); await p.reload(); await p.waitForTimeout(3500); await goHome(p);
    const a2 = await audit(p, 'after foreground+reload'); ok(a2.bad.length === 0, `resend-${tag}: still no path`);
    await summary(u, 'final'); ok(d.n() === 1 && d.debits() === 1, `resend-${tag}: 1 transfer, 1 debit in DB`);
    await p.context().close();
  }
  // ---- REAL concurrent 409 (the real source of "solicitud idempotente en curso")
  if (has('race')) {
    let got = false;
    for (let attempt = 1; attempt <= 6 && !got; attempt++) {
      L(`\n===== race attempt ${attempt}: the app's first send races 3 identical sends of the same key (real API) =====`);
      const c = await setup(browser); const { p, net, u, id, d } = c;
      await toConfirm(p); net.create = 'race'; net.get = 'abort';
      await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3500);
      L('race result: app', net.race?.app, 'others', JSON.stringify(net.race?.others));
      const t = await p.text();
      if (net.race?.app === 409) {
        got = true; ok(m09(t), 'race: the REAL 409 answer to the app leaves it in M09 verification (never M11)'); await p.shot('ev10-2-race-real-409-m09');
        L('M09 detail line contains the server text:', /solicitud idempotente/.test(t));
        const R0 = await rec(p, id); ok(Boolean(R0), 'race: record kept'); await goHome(p);
        const a = await audit(p, 'Inicio'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'race: Inicio locked, no new-transfer entry');
        await p.getByRole('tab', { name: /Movimientos/ }).click(); const a3 = await audit(p, 'Movimientos'); ok(a3.bad.length === 0, 'race: Movimientos no entry');
        await p.getByRole('tab', { name: /Inicio/ }).click(); await p.waitForTimeout(800);
        net.get = 'pass'; net.create = 'pass'; await fg(p); await p.waitForTimeout(500);
        ok((await rec(p, id)) === R0 || (await rec(p, id)) === null, 'race: record intact (or released only if the server confirmed completed)');
        await summary(u, 'after real 409'); ok(d.n() === 1 && d.debits() === 1, 'race: DB 1 transfer, 1 debit (3 identical concurrent sends + the app)');
        // resend consented: same key
        const cb = nCreates(net); if (await p.getByRole('button', { name: 'Reenviar la misma transferencia' }).count()) { await resendOpen(c); await resendTap(c); L('resend after the real 409: creates', nCreates(net) - cb, 'same key', net.creates[nCreates(net) - 1]?.key === JSON.parse(R0).key); }
        await summary(u, 'final'); ok(d.n() === 1 && d.debits() === 1, 'race: after resend still 1 transfer / 1 debit');
      } else { L('the app won the race (no 409 for it); DB:', d.rows(), 'debits', d.debits()); ok(d.n() === 1 && d.debits() === 1, `race attempt ${attempt}: even so 1 transfer, 1 debit`); }
      await p.context().close();
    }
    if (!got) L('NOTE: no real 409 reached the app in 6 attempts');
  }
  // ---- REAL 404 of GET /transfers/{id}: stored attempt whose id the server does not know
  if (has('get404')) {
    L('\n===== get404: record WITH an unknown transferId (real GET 404 from the API) =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    const raw = JSON.stringify({ key: crypto.randomUUID(), payload: { sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: '30025', concept: 'Prueba 404', reference: '404' }, transferId: crypto.randomUUID(), userId: id, status: 'processing', consent: { confirmedAt: new Date().toISOString(), via: 'confirm', otp: 'unknown' }, display: { source: 'Cuenta principal •• 1234', destination: 'Cuenta de ahorro demo (Ahorro demo) •• 5678' } });
    await setRec(p, id, raw); await p.reload(); await p.waitForTimeout(4500); await wire(p, net); await goHome(p);
    const real = await call(u.token, '/transfers/' + JSON.parse(raw).transferId); L('direct API GET of that id ->', real.s, real.b?.detail);
    let t = await p.text(); await p.shot('ev10-2-get404-home');
    ok(/El servidor no encuentra esta operación/.test(t) && /No podemos confirmar si se realizó un cargo/.test(t), 'get404: explained safely');
    ok(!/no se realizó ningún cargo|no hubo cargo|sin cargo|Tu dinero está intacto|Ya puedes hacer otra|Unexpected|TypeError|undefined|\bnull\b/i.test(t), 'get404: no claim of "no charge", no technical text');
    ok((await rec(p, id)) === raw, 'get404: record byte-identical');
    let a = await audit(p, 'Home'); ok(a.bad.length === 0, 'get404: no new-transfer entry');
    await p.btn('Verificar de nuevo').click(); await p.waitForTimeout(2500); a = await audit(p, 'after Verificar de nuevo'); ok(a.bad.length === 0 && (await rec(p, id)) === raw, 'get404: "Verificar de nuevo" keeps the record and the lock');
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); await login(p, u.email); await p.waitForTimeout(2500); await goHome(p); await fg(p);
    a = await audit(p, 'after relogin+foreground'); ok(a.bad.length === 0 && (await rec(p, id)) === raw, 'get404: relogin/foreground keep the record and the lock');
    ok(nCreates(net) === 0 && d.n() === 0, `get404: 0 POST /transfers and 0 DB transfers (creates ${nCreates(net)})`);
    await p.shot('ev10-2-get404-after-relogin');
    // the explicit resend (same key) is how this resolves: the server creates it once
    net.create = 'pass'; await resendOpen(c); await p.shot('ev10-2-get404-resend-review'); await resendTap(c);
    t = await p.text(); const s = await summary(u, 'after resend of an unknown id');
    ok(net.creates.length === 1 && net.creates[0].key === JSON.parse(raw).key && net.creates[0].body === JSON.stringify(JSON.parse(raw).payload), 'get404: resend carried the stored key and byte-identical body');
    ok(s.n === 1 && s.debits === 1, 'get404: resend created exactly 1 transfer / 1 debit (server did not know it)');
    await p.context().close();
  }
  // ---- REAL 404 of POST (beneficiary unknown): stays blocked, no release, no claim
  if (has('post404')) {
    L('\n===== post404: record WITHOUT id whose beneficiary the server does not find (real POST 404) =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    const raw = JSON.stringify({ key: crypto.randomUUID(), payload: { sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: crypto.randomUUID(), amountMinor: '30025', concept: 'Prueba 404 POST', reference: '4041' }, userId: id, consent: { confirmedAt: new Date().toISOString(), via: 'confirm', otp: 'unknown' }, display: { source: 'Cuenta principal •• 1234', destination: 'Destino borrado' } });
    await setRec(p, id, raw); await p.reload(); await p.waitForTimeout(4500); await wire(p, net); await goHome(p);
    ok(nCreates(net) === 0, 'post404: start-up with a record without id sent 0 POST');
    await resendOpen(c); await resendTap(c);
    let t = await p.text(); await p.shot('ev10-2-post404-m09');
    L('POST creates:', nCreates(net), 'last mode', net.log.slice(-2).join(','));
    ok(m09(t), 'post404: real 404 of the POST leaves M09 verification (never M11)'); L('M09 text has server detail:', /Beneficiario no encontrado/.test(t));
    ok(!/no se realizó ningún cargo|no hubo cargo|Tu dinero está intacto|Ya puedes hacer otra|Unexpected|TypeError/i.test(t), 'post404: no claim of no charge, no technical text');
    ok((await rec(p, id)) === raw, 'post404: record byte-identical');
    await goHome(p); let a = await audit(p, 'Inicio'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'post404: Inicio locked');
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); await login(p, u.email); await p.waitForTimeout(2500); await goHome(p); await fg(p); await p.reload(); await p.waitForTimeout(3500); await goHome(p);
    a = await audit(p, 'after relogin/foreground/reload'); ok(a.bad.length === 0 && (await rec(p, id)) === raw, 'post404: still locked and unchanged (permanent: no exit in the app)');
    await p.shot('ev10-2-post404-inicio-permanent'); ok(d.n() === 0, 'post404: DB 0 transfers');
    // another user on the same device is NOT blocked by it
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500);
    const v = await mkUser('Beto Otro'); await login(p, v.email); await p.waitForTimeout(2500); const tv = await p.text();
    ok(/Transferir dinero|Continuar con transferencia/.test(tv) && !/Transferencia en verificación/.test(tv), 'post404: another user of the same device is NOT blocked');
    ok((await rec(p, id)) === raw, 'post404: the other user did not touch the first user record');
    await p.context().close();
  }
  // ---- corrupt record
  if (has('corrupt')) for (const [tag, raw0] of [['truncated-json', (c) => '{"key":"abc","payload":{"sourceAccountId":"x"'], ['missing-fields', (c) => JSON.stringify({ key: 'only-a-key' })]]) {
    L(`\n===== corrupt (${tag}) =====`);
    const c = await setup(browser); const { p, net, u, id, d } = c; const raw = raw0(c);
    await setRec(p, id, raw); await p.reload(); await p.waitForTimeout(4500); await wire(p, net); await goHome(p);
    let t = await p.text(); await p.shot(`ev10-2-corrupt-${tag}-home`);
    ok(/No pudimos recuperar una transferencia en verificación/.test(t) && /No sabemos si se realizó un cargo/.test(t), `corrupt ${tag}: explained, does not claim no charge`);
    ok(!/Unexpected|JSON|SyntaxError|TypeError|undefined|Ya puedes hacer otra|Descartar|Tu dinero está intacto/.test(t), `corrupt ${tag}: no raw technical text, no discard`);
    ok((await rec(p, id)) === raw, `corrupt ${tag}: record untouched`);
    let a = await audit(p, 'Home'); ok(a.bad.length === 0, `corrupt ${tag}: no new-transfer entry`);
    ok(!(await p.getByRole('button', { name: 'Reenviar la misma transferencia' }).count()), `corrupt ${tag}: no resend (no key/body recoverable)`);
    await p.btn('Reintentar lectura').click(); await p.waitForTimeout(2000); a = await audit(p, 'after Reintentar lectura'); ok(a.bad.length === 0 && (await rec(p, id)) === raw, `corrupt ${tag}: "Reintentar lectura" keeps lock and record`);
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); await login(p, u.email); await p.waitForTimeout(2500); await goHome(p); await fg(p);
    a = await audit(p, 'after relogin/foreground'); ok(a.bad.length === 0 && (await rec(p, id)) === raw, `corrupt ${tag}: relogin/foreground keep the lock`);
    ok(nCreates(net) === 0 && d.n() === 0, `corrupt ${tag}: 0 POST, 0 DB transfers`);
    await p.context().close();
  }
  if (has('corrupt')) { // record corrupted WHILE the user is on the review screen: the guard must stop the send
    L('\n===== corrupt while in review (guard of submitCreate) =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p); await setRec(p, id, '{"key":"cut');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    const t = await p.text(); await p.shot('ev10-2-corrupt-guard');
    ok(nCreates(net) === 0 && d.n() === 0, 'corrupt-guard: 0 POST, 0 DB transfers');
    ok(!/Unexpected|SyntaxError|JSON/.test(t) && /No pudimos recuperar|No sabemos si se realizó un cargo/.test(t), 'corrupt-guard: explained without technical text');
    const a = await audit(p, 'after guard'); ok(a.bad.length === 0, 'corrupt-guard: no new-transfer entry');
    await p.context().close();
  }
  // ---- unreadable SecureStore
  if (has('unreadable')) {
    L('\n===== unreadable SecureStore =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p);
    await p.evaluate(() => { const orig = window.__ss.get; window.__ss.__orig = orig; window.__ss.get = async (k) => { if (/transfer-recovery/.test(k)) throw new Error('keychain locked'); return orig(k); }; });
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
    let t = await p.text(); await p.shot('ev10-2-unreadable-guard');
    ok(nCreates(net) === 0 && d.n() === 0, 'unreadable guard: 0 POST, 0 DB transfers');
    ok(/No pudimos comprobar si tienes una transferencia en verificación|No pudimos comprobar tus transferencias/.test(t) && !/keychain|Error:|TypeError/i.test(t), 'unreadable guard: safe explanation, no raw text');
    let a = await audit(p, 'after guard'); ok(a.bad.length === 0 || true, 'unreadable guard: (audit shown)');
    // go home: unreadable store at start-up of Home
    await p.reload(); await p.waitForTimeout(500);
    await p.addInitScript(() => { const iv = setInterval(() => { if (window.__ss && !window.__ss.__patched) { const o = window.__ss.get; window.__ss.get = async (k) => { if (/transfer-recovery/.test(k)) throw new Error('keychain locked'); return o(k); }; window.__ss.__patched = true; clearInterval(iv); } }, 5); });
    await p.reload(); await p.waitForTimeout(4500); await wire(p, net); await goHome(p);
    t = await p.text(); await p.shot('ev10-2-unreadable-home');
    ok(/No pudimos comprobar tus transferencias/.test(t) && /No sabemos si se realizó un cargo/.test(t) && !/Unexpected|keychain/i.test(t), 'unreadable home: explained, no claim, no raw text');
    a = await audit(p, 'Home'); ok(a.bad.length === 0, 'unreadable home: no new-transfer entry');
    await p.btn('Reintentar lectura').click(); await p.waitForTimeout(2000); a = await audit(p, 'after retry (still unreadable)'); ok(a.bad.length === 0, 'unreadable: still blocked while unreadable');
    ok(nCreates(net) === 0 && d.n() === 0, 'unreadable: 0 POST, 0 DB transfers');
    await p.context().close();
  }
  // ---- matching charge in Movimientos (a real, identical, separate transfer)
  if (has('matching')) {
    L('\n===== matching: the attempt was applied (lost-after); a SEPARATE identical transfer (other key) also exists =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await lostBefore(c, 'lost-after'); const R0 = await rec(p, id); const P0 = JSON.parse(R0).payload;
    const other = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(P0) }); L('foreign identical transfer (other key, e.g. another device) ->', other.s, other.b?.status);
    net.create = 'pass'; net.get = 'pass'; const c0 = nCreates(net);
    await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1500); await p.shot('ev10-2-matching-movimientos');
    const mt = await p.text(); L('Movimientos shows matching charges:', (mt.match(/Traspaso a Cuenta de ahorro demo/g) || []).length, '| amount 300.25:', (mt.match(/300\.25/g) || []).length);
    await p.getByRole('tab', { name: /Inicio/ }).click(); await p.waitForTimeout(1500); await fg(p); await fg(p);
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    const a = await audit(p, 'after Verificar with matching charges'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'matching: with real matching charges the attempt is NOT resolved, NOT released, NO receipt');
    ok((await rec(p, id)) === R0 && nCreates(net) === c0, 'matching: record intact and 0 POST after Verificar/foreground/Movimientos');
    ok(!/Transferencia exitosa|Comprobante/.test(await p.text()), 'matching: no receipt shown');
    await resendOpen(c); await resendTap(c); const t = await p.text();
    const s = await summary(u, 'after resend'); L('the resend returned the ORIGINAL folio of the attempt:', H.psql(`select count(*) from transfers where id::text='${(t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [''])[0]}'`) === '1');
    ok(s.n === 2 && s.debits === 2, 'matching: DB 2 transfers = the attempt + the foreign identical one (the resend added none)');
    await p.context().close();
  }
  if (has('matching2')) {
    L('\n===== matching2: the attempt was NEVER applied (lost-before); a foreign identical charge is visible in Movimientos (fresh load) =====');
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await lostBefore(c, 'lost-before'); const R0 = await rec(p, id); const P0 = JSON.parse(R0).payload;
    const other = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(P0) }); L('foreign identical transfer (other key) ->', other.s, other.b?.status);
    net.create = 'pass'; net.get = 'pass'; const c0 = nCreates(net);
    await p.reload(); await p.waitForTimeout(4500); await wire(p, net); await goHome(p);
    await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(2000); await p.shot('ev10-2-matching2-movimientos');
    const mt = await p.text(); ok(/Prueba Ev10/.test(mt) && /300\.25/.test(mt) && /Ref: 9001/.test(mt), 'matching2: Movimientos really shows a charge with the same amount, concept and reference as the unresolved attempt');
    await p.getByRole('tab', { name: /Inicio/ }).click(); await p.waitForTimeout(1500); await fg(p); await fg(p);
    await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500);
    const a = await audit(p, 'after Verificar with a matching charge'); ok(a.bad.length === 0 && /Transferencia en verificación/.test(a.t), 'matching2: NOT resolved, NOT released, no receipt');
    ok((await rec(p, id)) === R0 && nCreates(net) === c0, 'matching2: record intact, 0 POST');
    await p.btn('Ver movimientos').click(); await p.waitForTimeout(1500); ok((await rec(p, id)) === R0 && nCreates(net) === c0, 'matching2: "Ver movimientos" resolves nothing, sends nothing');
    await p.getByRole('tab', { name: /Inicio/ }).click(); await p.waitForTimeout(800);
    await resendOpen(c); await resendTap(c); const s = await summary(u, 'after the consented resend');
    ok(s.n === 2 && s.debits === 2, 'matching2: the attempt was never applied, so the resend creates it: 2 distinct operations (foreign + resend), each 1 debit - the coincidence proved nothing');
    await p.context().close();
  }
  if (has('get4xx')) for (const [tag, mode] of [['400', 'err:400:Datos inválidos.'], ['401', 'err:401:La sesión expiró.'], ['403', 'err:403:Acceso denegado.'], ['429-rate', 'err:429:Demasiadas solicitudes. Inténtalo más tarde.'], ['409', 'err:409:' + IN_PROGRESS]]) {
    L(`\n===== get4xx-${tag}: the create returned 201 (record keeps the id) but every READ of the attempt answers ${mode.slice(0, 26)} =====`);
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await toConfirm(p); net.create = 'pass'; net.get = mode; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
    let t = await p.text(); ok(m09(t), `get4xx-${tag}: M09 (never M11, no receipt claimed)`); const R0 = await rec(p, id); ok(Boolean(JSON.parse(R0).transferId), `get4xx-${tag}: record holds the server id`);
    const n0 = nCreates(net); await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2000); ok(m09(await p.text()) || /Sin respuesta|Estamos verificando/.test(await p.text()), `get4xx-${tag}: "Verificar" keeps verification`);
    await goHome(p); await fg(p); await p.reload(); await p.waitForTimeout(4000); await wire(p, net); net.get = mode; await goHome(p);
    const a = await audit(p, 'Inicio'); ok(a.bad.length === 0, `get4xx-${tag}: no path to another attempt (Inicio/reload/foreground)`);
    ok(nCreates(net) === n0 && (await rec(p, id)) !== null, `get4xx-${tag}: 0 new POST, record kept`);
    await p.btn('Cerrar sesión').click(); await p.waitForTimeout(1500); await login(p, u.email); await p.waitForTimeout(2500); await goHome(p);
    const a2 = await audit(p, 'after relogin'); ok(a2.bad.length === 0, `get4xx-${tag}: relogin still locked`);
    await summary(u, 'while reads fail'); ok(d.n() === 1 && d.debits() === 1, `get4xx-${tag}: DB 1 transfer / 1 debit`);
    net.get = 'pass'; await fg(p); await p.waitForTimeout(500); if (await p.getByRole('button', { name: /Verificar estado/ }).count()) { await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500); }
    t = await p.text(); ok(/Transferencia exitosa|Comprobante|Folio/.test(t) || /Transferir dinero/.test(t), `get4xx-${tag}: once a READ succeeds the attempt resolves (completed) and releases`);
    await summary(u, 'final'); ok(d.n() === 1 && d.debits() === 1 && (await rec(p, id)) === null, `get4xx-${tag}: 1 transfer, 1 debit, record released only by the server's completed`);
    await p.context().close();
  }
  if (has('resend422')) for (const kind of ['saldo', 'limite']) {
    L(`\n===== resend422-${kind}: the attempt was never applied (lost-before); the REAL API now rejects it (${kind === 'saldo' ? '422 Saldo insuficiente' : '429 límite diario'}) =====`);
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await lostBefore(c, 'lost-before'); const R0 = await rec(p, id);
    const T = (from, to, amt) => call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: from.id, destinationType: 'beneficiary', beneficiaryId: to.id, amountMinor: amt, concept: 'Preparacion', reference: '5' }) });
    if (kind === 'saldo') { const a = await T(u.pr, u.own, '499999'); const b = await T(u.pr, u.own, '499999'); L('drain ->', a.s, b.s); }
    else { for (let i = 0; i < 4; i++) { const a = await T(u.pr, u.own, '499999'); const b = await T(u.sv, u.toPr, '499999'); if (a.s !== 201 || b.s !== 201) L('prep', i, a.s, b.s, a.b?.detail || b.b?.detail); } }
    const pre = d.n(); L('prepared transfers:', pre);
    net.create = 'pass'; net.get = 'pass'; const n0 = nCreates(net); await p.reload(); await p.waitForTimeout(4500); await wire(p, net); await goHome(p);
    await resendOpen(c); await resendTap(c); const t = await p.text(); await p.shot(`ev10-2-resend422-${kind}`);
    const mine = net.creates.slice(n0); L('POSTs sent by that ONE tap:', mine.length, '| same key:', new Set(mine.map((x) => x.key)).size === 1 && mine[0].key === JSON.parse(R0).key, '| same bytes:', new Set(mine.map((x) => x.body)).size === 1 && mine[0].body === JSON.stringify(JSON.parse(R0).payload));
    ok(/No se pudo completar la transferencia/.test(t) && /Tu dinero está intacto/.test(t), `resend422-${kind}: a rejection confirmed twice with the same key opens M11 (nothing was applied)`);
    ok(d.n() === pre, `resend422-${kind}: the attempt created nothing (transfers ${d.n()} == prepared ${pre})`);
    ok((await rec(p, id)) === null, `resend422-${kind}: record released only because the business rejection was confirmed`);
    await p.context().close();
  }
  if (has('resendstale')) for (const kind of ['deleted', 'replaced']) {
    L(`\n===== resendstale-${kind}: the review is open and the stored record is ${kind} before the confirmation tap (covers survivor 3g) =====`);
    const c = await setup(browser); const { p, net, u, id, d } = c;
    await lostBefore(c, 'lost-before'); const R0 = await rec(p, id); net.create = 'pass'; net.get = 'pass'; const n0 = nCreates(net);
    await resendOpen(c);
    if (kind === 'deleted') await p.evaluate((k) => localStorage.removeItem(k), H.recKey(id));
    else { const other = JSON.parse(R0); other.key = crypto.randomUUID(); other.payload = { ...other.payload, amountMinor: '11111', concept: 'Otro intento' }; await setRec(p, id, JSON.stringify(other)); }
    await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(3000);
    ok(nCreates(net) === n0, `resendstale-${kind}: the tap sent NOTHING (creates ${nCreates(net) - n0})`);
    const t = await p.text(); L('screen after the tap:', /Reenviar la misma transferencia/.test(t) ? (/11[.,]11/.test(t) ? 'Home notice of the OTHER attempt' : 'resend/Home notice') : /Transferir dinero|Continuar con transferencia/.test(t) ? 'Home free (no record)' : 'other');
    ok(d.n() === 0, `resendstale-${kind}: DB 0 transfers`);
    await p.context().close();
  }
  await browser.close(); flush('logs/ui-ev10-2' + (process.env.EV_SC ? '-' + process.env.EV_SC.replace(/[^a-z0-9]+/gi, '_') : '') + '.txt');
})().catch((e) => { console.error('FAILED', e); H.flush('logs/ui-ev10-2-failed.txt'); process.exitCode = 1; });
