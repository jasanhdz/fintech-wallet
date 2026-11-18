const h = require('./lib.cjs'); const { L, psql } = h;
const CONT = /^Continuar[^a-zA-Z]*$/;
const rows = (email, ref) => psql(`select string_agg(t.status||':'||t.amount_minor,' ' order by t.created_at) from transfers t join users u on u.id=t.owner_id where u.email='${email}' and t.reference='${ref}'`);
(async () => {
  const run = 'd' + Date.now().toString().slice(-6);
  const u = await h.seedUsers(run); const E = u.ana.email;
  { const ct = u.carlos.token; for (let i = 0; i < 2; i++) await h.api(ct, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: u.cm.id, destinationType: 'beneficiary', beneficiaryId: u.toA.id, amountMinor: '450000', concept: 'topup', reference: '9' }) }); }
  const browser = await h.chromium.launch();
  const wait = () => new Promise((r) => setTimeout(r, 6500));
  const go = async (p, ben, amt, concept, ref) => { await h.toDetails(p, ben); await h.fill(p, amt, concept, ref); await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900); };
  const getCode = async (p) => ((await p.text()).match(/prueba: (\d{6})/) || [])[1];
  let p;
  // ---- F-06: confirm uncertain (server applied, response lost, recovery GET blocked)
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '5000', 'F06', '6001');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const id = psql(`select t.id from transfers t join users u on u.id=t.owner_id where u.email='${E}' and t.reference='6001' order by t.created_at desc limit 1`);
  const code = await getCode(p);
  let blockGet = true;
  await p.route('**/v1/transfers/*/confirm', async (r) => { await r.fetch(); await r.abort('failed'); });
  await p.route(/\/v1\/transfers\/[0-9a-f-]{36}$/, async (r) => { if (blockGet) await r.abort('failed'); else await r.continue(); });
  await p.getByLabel('Código de confirmación').fill(code); await p.waitForTimeout(200);
  const nPostBefore = p.reqs.filter((r) => r.startsWith('POST /transfers ')).length;
  await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(2500);
  const f1 = await p.shot('F06-uncertain', { mask: [p.locator('text=/Código asignado para esta prueba/')] });
  L('F06 uncertain screen:', f1.split('\n').filter(Boolean).join(' | ').replace(/\d{6}/g, '######').slice(0, 800));
  L('F06 DB after lost confirm response:', rows(E, '6001'));
  // try to start a new attempt: solicitar nuevo código
  await p.btn('Solicitar nuevo código').click().catch(() => {}); await p.waitForTimeout(1500);
  L('F06 after "Solicitar nuevo código": POST /transfers (create) count delta:', p.reqs.filter((r) => r.startsWith('POST /transfers ')).length - nPostBefore, '| cancel POSTs:', p.reqs.filter((r) => /\/cancel/.test(r)).length, '| DB:', rows(E, '6001'));
  await p.getByLabel('Cancelar y volver a revisar').first().click(); await p.waitForTimeout(1500);
  L('F06 after "Cancelar y volver" (GET blocked): cancel POSTs:', p.reqs.filter((r) => /\/cancel/.test(r)).length, '| screen:', (await p.text()).split('\n').filter(Boolean).slice(0, 6).join(' | ').replace(/\d{6}/g, '######'));
  blockGet = false;
  await p.getByLabel('Cancelar y volver a revisar').first().click().catch(() => {}); await p.waitForTimeout(2000);
  const f2 = await p.shot('F06-after-unblock');
  L('F06 after GET unblocked: screen:', f2.split('\n').filter(Boolean).slice(0, 8).join(' | '), '| cancel POSTs:', p.reqs.filter((r) => /\/cancel/.test(r)).length, '| creates:', p.reqs.filter((r) => r.startsWith('POST /transfers ')).length - nPostBefore, '| DB transfers with ref 6001:', rows(E, '6001'), '| total completed 500000 for ref:', psql(`select count(*) from transfers where id='${id}' and status='completed'`));
  await p.context().close(); await wait();

  // ---- H: policy from server (intercept /transfer-policy to different numbers)
  p = await h.newPage(browser, { h: 1100 });
  await p.route('**/v1/transfer-policy', async (r) => { const x = await r.fetch(); const j = await x.json(); Object.assign(j, { otpThresholdMinor: '123456', dailyLimitMinor: '300000', dailyRemainingMinor: '300000', dailyUsedMinor: '0', otpExpirySeconds: 60 }); await r.fulfill({ response: x, json: j }); });
  await h.login(p, E);
  await h.toDetails(p, 'Carlos'); await h.fill(p, '1500', 'Pol', '6002');
  const hd = await p.shot('H-details-policy-mock');
  L('H M06 with mocked policy: shows daily limit $3,000.00:', /\$3,000\.00/.test(hd), '| lines:', hd.split('\n').filter((l) => /límite|Disponible hoy/i.test(l)).join(' / '));
  await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900);
  const hr = await p.shot('H-review-policy-mock');
  L('H review with mocked threshold $1,234.56 (amount 1,500 >= threshold):', hr.split('\n').filter((l) => /verificación|umbral|\$1,234\.56|Continuar a/i.test(l)).join(' / '));
  await p.getByLabel('Cancelar y volver').first().click().catch(() => {});
  await p.btn('Modificar datos').click().catch(() => {}); await p.waitForTimeout(600);
  await h.fill(p, '3500', 'Pol', '6002');
  const hl = await p.shot('H-over-daily-mock');
  L('H amount 3,500 > mocked remaining 3,000:', hl.split('\n').filter((l) => /límite|supera|Continuar/i.test(l)).join(' / '), '| Continuar disabled=', await p.getByRole('button', { name: CONT }).getAttribute('aria-disabled'));
  await p.context().close(); await wait();

  // ---- OTP boundary + countdown/expiry with server expiresAt rewritten to +8s
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '4999.99', 'Bajo umbral', '6003');
  const lowReview = await p.shot('H-review-4999.99');
  L('H 4999.99 review button:', lowReview.split('\n').filter((l) => /Confirmar transferencia|Continuar a verificación/.test(l)).join('/'));
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  L('H 4999.99 DB:', rows(E, '6003'));
  await p.context().close(); await wait();
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await p.route('**/v1/transfers', async (r) => { if (r.request().method() !== 'POST') return r.continue(); const x = await r.fetch(); const j = await x.json(); j.expiresAt = new Date(Date.now() + 8000).toISOString(); await r.fulfill({ response: x, json: j }); });
  await go(p, 'Carlos', '5000.00', 'En umbral', '6004');
  const tr = await p.shot('H-review-5000');
  L('H 5000.00 review button:', tr.split('\n').filter((l) => /Confirmar transferencia|Continuar a verificación/.test(l)).join('/'));
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(1500);
  const c1 = (await p.text()).match(/expira en (\d\d:\d\d)/i)?.[1]; await p.waitForTimeout(3000); const c2 = (await p.text()).match(/expira en (\d\d:\d\d)/i)?.[1];
  L('H countdown samples (should decrease):', c1, '->', c2);
  await p.waitForTimeout(6000);
  const ex = await p.shot('H-countdown-expired', { mask: [p.locator('text=/Código asignado para esta prueba/')] });
  L('H after countdown reached 0:', ex.split('\n').filter((l) => /expir|nuevo código|Autorizar/i.test(l)).join(' / '), '| Autorizar disabled=', await p.getByRole('button', { name: /Autorizar transferencia/ }).getAttribute('aria-disabled'));
  L('H DB for 6004 (server not expired yet):', rows(E, '6004'));
  await p.context().close(); await wait();

  // ---- C4: repeated rejected combination warning
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '100', 'Repite', '6005');
  await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') await route.fulfill({ status: 422, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unprocessable Entity', status: 422, detail: 'Se excedió el límite diario.' }) }); else await route.continue(); });
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(1500);
  await p.shot('C4-rejected'); await p.btn('Modificar monto o cuenta').click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900);
  const c4 = await p.shot('C4-review-same-combo');
  L('C4 review after Modificar with same combo:', c4.split('\n').filter((l) => /rechaz|mismo|misma|anterior|vuelve|ya fue|límite/i.test(l)).join(' / ') || '(no warning)');
  await p.context().close(); await wait();

  // ---- Race: Cancelar while confirm in flight
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  await go(p, 'Carlos', '5000', 'Carrera', '6006');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const code6 = await getCode(p); await p.getByLabel('Código de confirmación').fill(code6);
  await p.route('**/v1/transfers/*/confirm', async (r) => { await new Promise((x) => setTimeout(x, 3000)); await r.continue(); });
  const b6 = h.bal(E);
  await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(800);
  await p.getByLabel('Cancelar y volver a revisar').last().click().catch((e) => L('race: cancel click failed', e.message.split('\n')[0])); await p.waitForTimeout(5000);
  const r6 = await p.shot('race-final');
  L('Race (leave OTP while confirm in flight): DB', rows(E, '6006'), '| balances', b6, '->', h.bal(E), '| final screen:', r6.split('\n').filter(Boolean).slice(0, 8).join(' | '));
  L('Race cancel POSTs:', p.reqs.filter((r) => /\/cancel/.test(r)).length);
  await p.context().close();
  await browser.close();
  h.fs.writeFileSync(`${h.SP}/ev/s4.txt`, h.log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
