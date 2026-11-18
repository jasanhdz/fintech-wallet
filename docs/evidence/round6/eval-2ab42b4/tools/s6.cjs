// F-11: long name / long data on every screen, 100/130/200 % text (CSS approximation, not native fontScale).
const L6 = require('./lib.cjs');
const { chromium, L, api, register, newPage, login, toDetails, fill, psql, fs, SP, PW } = L6;
const NAME = 'Ana María de los Ángeles López-Hernández de la Cruz y Villaseñor';
const BENEF = 'Corporativo Internacional de Servicios Profesionales y Consultoría Estratégica Integral del Sureste S.A. de C.V.';
const ALIAS = 'Proveedor principal de materiales y servicios generales del corporativo regional';
const CONCEPT = 'Pago de servicios del departamento 40ch';
const overflow = (page) => page.evaluate(() => {
  const W = window.innerWidth; const bad = [];
  document.querySelectorAll('*').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && (r.right > W + 1 || r.left < -1)) bad.push(`${e.tagName}:${(e.innerText || e.getAttribute('aria-label') || '').slice(0, 30).replace(/\n/g, ' ')} L${Math.round(r.left)} R${Math.round(r.right)}`); });
  return { docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, bad: bad.slice(0, 6), nbad: bad.length };
});
const scale = (page, f) => page.evaluate((f) => { document.querySelectorAll('div,span,input,button').forEach((e) => { const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); if (fs && !e.dataset.s) { e.dataset.s = '1'; e.style.fontSize = `${fs * f}px`; const lh = parseFloat(cs.lineHeight); if (lh) e.style.lineHeight = `${lh * f}px`; } }); }, f);
const box = async (page, name) => { const b = await page.getByRole('button', { name }).first().boundingBox().catch(() => null); return b ? `${name}: x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.width)} h=${Math.round(b.height)} right=${Math.round(b.x + b.width)}` : `${name}: NOT FOUND`; };
(async () => {
  const run = Date.now().toString().slice(-6);
  const email = `larga.ev.${run}@example.test`;
  const tok = await register(NAME, email);
  const accs = (await api(tok, '/accounts')).b.items; const pr = accs.find((a) => a.kind === 'checking');
  const carlosTok = await register('Carlos Ruiz', `carlos.larga.${run}@example.test`);
  const cm = (await api(carlosTok, '/accounts')).b.items.find((a) => a.kind === 'checking');
  const bn = (await api(tok, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: BENEF, alias: ALIAS, clabe: cm.clabe }) }));
  L('beneficiary create', bn.s, JSON.stringify(bn.b).slice(0, 120));
  const browser = await chromium.launch();
  for (const f of [1, 1.3, 2]) {
    const page = await newPage(browser, { h: 844 }); await login(page, email);
    const tag = `F11-x${f}`;
    await scale(page, f); await page.waitForTimeout(300);
    const t = await page.shot(`${tag}-home`);
    const o = await overflow(page);
    L(tag, 'HOME overflow', JSON.stringify(o), '| greeting:', t.split('\n').find((l) => l.startsWith('Hola')), '|', await box(page, 'Cerrar sesión'));
    await page.context().close();
  }
  // Long data on all flow screens (100 % and 200 %).
  for (const f of [1, 2]) {
    const page = await newPage(browser, { h: 844 }); await login(page, email);
    const tag = `D-x${f}`;
    await page.getByRole('button', { name: /Cuenta principal/ }).first().click().catch(() => {}); await page.waitForTimeout(300);
    await page.getByLabel('Elegir beneficiario').click(); await page.waitForTimeout(1200);
    if (f > 1) await scale(page, f);
    await page.shot(`${tag}-M05`); L(tag, 'M05', JSON.stringify(await overflow(page)));
    await page.getByLabel(/^Seleccionar /).first().click(); await page.waitForTimeout(500);
    await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1200);
    await fill(page, '850', CONCEPT, '1234567');
    if (f > 1) await scale(page, f);
    await page.shot(`${tag}-M06`); L(tag, 'M06', JSON.stringify(await overflow(page)), await box(page, /^Continuar[^a-zA-Z]*$/));
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(800);
    if (f > 1) await scale(page, f);
    await page.shot(`${tag}-M07`); L(tag, 'M07', JSON.stringify(await overflow(page)), await box(page, 'Confirmar transferencia'), await box(page, 'Modificar datos'));
    await page.btn('Confirmar transferencia').click(); await page.waitForTimeout(2500);
    if (f > 1) await scale(page, f);
    await page.shot(`${tag}-M10`); L(tag, 'M10', JSON.stringify(await overflow(page)));
    await page.btn('Ver últimos movimientos').click().catch(() => {}); await page.waitForTimeout(1500);
    if (f > 1) await scale(page, f);
    await page.shot(`${tag}-M03`); L(tag, 'M03', JSON.stringify(await overflow(page)));
    await page.getByRole('button', { name: /^Cargo/ }).first().click(); await page.waitForTimeout(1200);
    if (f > 1) await scale(page, f);
    await page.shot(`${tag}-M04`); L(tag, 'M04', JSON.stringify(await overflow(page)));
    await page.context().close();
  }
  // OTP screen long data (>= threshold), fresh page
  { const page = await newPage(browser, { h: 844 }); await login(page, email);
    await page.getByLabel('Elegir beneficiario').click(); await page.waitForTimeout(1200);
    await page.getByLabel(/^Seleccionar /).first().click(); await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1000);
    await fill(page, '5000', CONCEPT, '7654321'); await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(800);
    await page.shot('D-M07-umbral'); L('D M07 umbral', JSON.stringify(await overflow(page)));
    await page.btn('Continuar a verificación').click(); await page.waitForTimeout(2500);
    await page.shot('D-M08'); L('D M08', JSON.stringify(await overflow(page)));
    await page.btn('Cancelar y volver a revisar').click(); await page.waitForTimeout(1000);
    await page.context().close(); }
  await browser.close();
  fs.writeFileSync(`${SP}/s6.txt`, L6.log.join('\n'));
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
