// Items 2 and 9 (F-20): for every interactive element on M02-M10: (a) does its accessible name (aria-label) contain ALL the visible text
// of the control? (b) is the touch target >= 44 css px (pt) in both dimensions? Real data: sent, received and own-account movements.
const { chromium, L, call, mkUser, mkRecipient, xfer, newPage, login, origin, choose, fill, toReview, flush } = require('./lib.cjs');
const norm = (s) => s.toLowerCase().replace(/[\s,.:·•–—-]+/g, ' ').replace(/\$/g, '').trim();
async function audit(p, name) {
  const r = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('[role=button],[role=tab],[role=radio],button,a,input,textarea,[tabindex="0"]').forEach((e) => {
      const rc = e.getBoundingClientRect(); if (!rc.width || !rc.height) return;
      const style = getComputedStyle(e); if (style.visibility === 'hidden' || style.opacity === '0') return;
      const label = e.getAttribute('aria-label') || ''; const own = e.tagName === 'INPUT' ? '' : e.innerText || '';
      out.push({ tag: e.tagName, role: e.getAttribute('role') || e.tagName, label, text: own, w: Math.round(rc.width), h: Math.round(rc.height), disabled: e.getAttribute('aria-disabled') === 'true' });
    });
    return out;
  });
  const missing = []; const small = [];
  for (const c of r) {
    const parts = c.text.replace(/[\uE000-\uF8FF]/gu, '').split('\n').map((x) => x.trim()).filter(Boolean); // icon-font glyphs are not text
    const nl = norm(c.label || c.text);
    const lost = c.label ? parts.filter((part) => !nl.includes(norm(part))) : [];
    if (lost.length) missing.push(`${(c.label).slice(0, 70)} :: missing ${JSON.stringify(lost.slice(0, 3))}`);
    if ((c.w < 44 || c.h < 44) && !/INPUT|TEXTAREA/.test(c.tag)) small.push(`${(c.label || c.text).replace(/\n/g, ' ').slice(0, 40)} ${c.w}x${c.h}`);
  }
  L(`AUDIT ${name}: controls=${r.length} label-missing-visible-text=${missing.length} touch<44=${small.length}`);
  missing.slice(0, 6).forEach((m) => L('   LABEL', m)); small.slice(0, 8).forEach((m) => L('   SMALL', m));
}
(async () => {
  const browser = await chromium.launch();
  const u = await mkUser('Ana López', 'lb'); const c = await mkRecipient(u, 'Carlos Ruiz');
  await xfer(u, u.pr, u.carlos, '85000', { concept: 'Comida', reference: '131126' });
  await xfer(u, u.pr, u.own, '30025', { concept: 'Ahorro mensual', reference: '2' });
  const back = (await call(c.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Ana López', alias: 'Ana', clabe: u.pr.clabe }) })).b;
  await call(c.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': require('crypto').randomUUID() }, body: JSON.stringify({ sourceAccountId: c.pr.id, destinationType: 'beneficiary', beneficiaryId: back.id, amountMinor: '100000', concept: 'Abono honorarios', reference: '994012' }) });
  const p = await newPage(browser, { h: 929 }); await login(p, u.email);
  await origin(p, /^Cuenta principal/); await p.waitForTimeout(800); await audit(p, 'M02 inicio (sin destino)');
  await p.getByLabel(/Elegir beneficiario/i).first().click(); await p.waitForTimeout(1200); await audit(p, 'M05 picker');
  const names = await p.evaluate(() => [...document.querySelectorAll('[aria-label^="Seleccionar"]')].map((e) => e.getAttribute('aria-label')));
  L('  beneficiary labels:', names);
  await p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().click(); await p.waitForTimeout(600); await audit(p, 'M02 con destino');
  await origin(p, /^Ahorro ••/); await audit(p, 'M02 incompatible');
  await origin(p, /^Cuenta principal/);
  await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000);
  await p.getByRole('button', { name: /Cambiar cuenta de origen/ }).click(); await p.waitForTimeout(500); await audit(p, 'M06 datos (origen abierto)');
  const opts = await p.evaluate(() => [...document.querySelectorAll('[role=radio]')].map((e) => e.getAttribute('aria-label'))); L('  origin option labels:', opts);
  await fill(p, '850.00'); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1000); await audit(p, 'M07 revisión');
  await p.btn('Modificar datos').click(); await p.waitForTimeout(500); await fill(p, '6000.00'); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1000); await audit(p, 'M07 umbral');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500); await audit(p, 'M08 código');
  await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(1500);
  await p.btn('Modificar datos').click(); await p.waitForTimeout(500); await fill(p, '100.00'); await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(800);
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000); await audit(p, 'M10 comprobante');
  await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(2000); await audit(p, 'M03 lista');
  const rows = await p.evaluate(() => [...document.querySelectorAll('[role=button]')].map((e) => e.getAttribute('aria-label') || '').filter((x) => /Abono|Cargo/.test(x))); L('  movement labels:', rows);
  await p.getByRole('button', { name: /Abono honorarios|De Carlos/ }).first().click().catch(() => {}); await p.waitForTimeout(1500); await audit(p, 'M04 detalle recibido');
  await p.context().close(); await browser.close(); flush('logs/ui-labels.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
