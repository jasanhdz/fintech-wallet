const h = require('./lib.cjs'); const { L, psql } = h;
const CONT = /^Continuar[^a-zA-Z]*$/;
const rows = (email, ref) => psql(`select string_agg(t.status||':'||t.amount_minor,' ' order by t.created_at) from transfers t join users u on u.id=t.owner_id where u.email='${email}' and t.reference='${ref}'`);
(async () => {
  const run = 'e' + Date.now().toString().slice(-6);
  const u = await h.seedUsers(run); const E = u.ana.email;
  const browser = await h.chromium.launch();
  const wait = () => new Promise((r) => setTimeout(r, 6500));
  const go = async (p, ben, amt, concept, ref) => { await h.toDetails(p, ben); await h.fill(p, amt, concept, ref); await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900); };
  let p;
  // ---- F: big balances > 2^53 minor units (test DB only, synthetic user)
  psql(`update accounts set balance_minor=900719925474099399 where id='${u.pr.id}'`);
  psql(`update accounts set balance_minor=1234567890123456789 where id='${u.sv.id}'`);
  const tok = await h.apiLogin(E); const a = (await h.api(tok, '/accounts')).b.items;
  L('F API balances (strings):', a.map((x) => x.name + '=' + x.availableBalanceMinor).join(' '), '| Number() round-trip of principal:', String(Number('900719925474099399')));
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, E);
  const home = await p.shot('F-home-big'); L('F home money tokens:', (home.match(/[-+]?\$[\d,]+\.\d\d/g) || []).join(' '));
  await p.getByRole('button', { name: /^Ahorro/ }).first().click(); await p.waitForTimeout(500);
  L('F ahorro tab:', ((await p.shot('F-home-big-ahorro')).match(/[-+]?\$[\d,]+\.\d\d/g) || []).join(' '));
  await p.getByRole('button', { name: /^Cuenta principal/ }).first().click(); await p.waitForTimeout(500);
  await go(p, 'Carlos', '100.10', 'Grande', '7001');
  const rv = await p.shot('F-review-big'); L('F review money tokens:', (rv.match(/[-+]?\$[\d,]+\.\d\d/g) || []).join(' '));
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  const rc = await p.shot('F-receipt-big'); L('F receipt money tokens:', (rc.match(/[-+]?\$[\d,]+\.\d\d/g) || []).join(' '), '| DB bal:', h.bal(E));
  await p.context().close(); await wait();

  // ---- reverse race: response delayed AFTER server processed; user taps Cancelar meanwhile
  p = await h.newPage(browser, { h: 1100 }); await h.login(p, u.carlos.email);
  { const ct = u.carlos.token; }
  await h.toDetails(p, 'Ana'); await h.fill(p, '5000', 'Carrera2', '7002'); await p.getByRole('button', { name: CONT }).click(); await p.waitForTimeout(900);
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const code = ((await p.text()).match(/prueba: (\d{6})/) || [])[1]; await p.getByLabel('Código de confirmación').fill(code);
  await p.route('**/v1/transfers/*/confirm', async (r) => { const x = await r.fetch(); await new Promise((y) => setTimeout(y, 3500)); await r.fulfill({ response: x }); });
  const b0 = h.bal(u.carlos.email);
  await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(1200);
  await p.getByLabel('Cancelar y volver a revisar').last().click().catch((e) => L('race2 cancel click failed')); await p.waitForTimeout(1500);
  const mid = await p.shot('race2-mid'); L('Race2 mid (after tapping Cancelar, confirm response still pending): DB', rows(u.carlos.email, '7002'), '| screen:', mid.split('\n').filter(Boolean).slice(0, 5).join(' | '));
  await p.waitForTimeout(4000);
  const fin = await p.shot('race2-final'); L('Race2 final: DB', rows(u.carlos.email, '7002'), '| bal', b0, '->', h.bal(u.carlos.email), '| screen:', fin.split('\n').filter(Boolean).slice(0, 6).join(' | '), '| cancel POSTs:', p.reqs.filter((r) => /cancel/.test(r)).join(','));
  await p.context().close(); await wait();

  // ---- I: long texts, 130% scale approximation, reduced viewport (keyboard approximation)
  const longName = 'Ana María de los Ángeles López-Hernández de la Cruz y Villaseñor';
  const tl = await h.register(longName, `larga.ev.${run}@example.test`);
  const la = (await h.api(tl, '/accounts')).b.items; const lpr = la.find((x) => x.kind === 'checking');
  await h.api(tl, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Beneficiario con un nombre extraordinariamente largo para probar el desbordamiento de texto', alias: 'Alias muy largo de prueba para la lista', clabe: u.cm.clabe }) });
  p = await h.newPage(browser, { h: 844 }); await h.login(p, `larga.ev.${run}@example.test`);
  const overflow = async (name) => { const o = await p.evaluate(() => { const out = []; document.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) out.push(e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent || '').slice(0, 30) + ' r=' + Math.round(r.right)); }); return { sw: document.documentElement.scrollWidth, items: out.slice(0, 5) }; }); L(`I ${name}: scrollWidth=${o.sw} overflowing=${JSON.stringify(o.items)}`); };
  await p.shot('I-long-home'); await overflow('home');
  await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1500); await p.shot('I-long-picker'); await overflow('picker');
  await p.getByLabel(/^Seleccionar Beneficiario con/).first().click(); await p.waitForTimeout(400); await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
  await p.getByLabel('Importe').fill('1250.55'); await p.getByLabel('Concepto').fill('Pago de servicios del departamento 40ch'.slice(0, 40)); await p.getByLabel('Referencia').fill('1234567');
  await p.shot('I-long-details'); await overflow('details');
  // keyboard approx: viewport shrinks 336px while a field is focused; footer button must remain reachable
  await p.getByLabel('Concepto').focus(); await p.setViewportSize({ width: 390, height: 844 - 336 }); await p.waitForTimeout(600);
  const cont = p.getByRole('button', { name: CONT }); await cont.scrollIntoViewIfNeeded().catch(() => {});
  const bb = await cont.boundingBox();
  L('I keyboard-approx (viewport 508px): Continuar box y+h =', bb && Math.round(bb.y + bb.height), 'in viewport:', Boolean(bb && bb.y + bb.height <= 508 && bb.y >= 0));
  await p.shot('I-long-details-keyboard');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelectorAll('div,span,input').forEach((e) => { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs) e.style.fontSize = `${fs * 1.3}px`; const lh = parseFloat(getComputedStyle(e).lineHeight); if (lh) e.style.lineHeight = `${lh * 1.3}px`; }));
  await p.waitForTimeout(500); await p.shot('I-long-details-130'); await overflow('details@130%');
  const b2 = await p.getByRole('button', { name: CONT }).boundingBox(); L('I 130%: Continuar box y+h=', b2 && Math.round(b2.y + b2.height), '(viewport 844) visible without scrolling:', Boolean(b2 && b2.y + b2.height <= 844));
  await p.context().close();
  await browser.close();
  h.fs.writeFileSync(`${h.SP}/ev/s5.txt`, h.log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
