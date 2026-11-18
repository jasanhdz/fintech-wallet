// Pass 9 · item 6a: F-25 avatars (user + beneficiary) at 100/130/200 % (CSS approximation of fontScale, NOT native Dynamic Type), widest initials "WW".
const { chromium, L, ok, call, mkUser, registerUser, newPage, login, origin, choose, fill, toReview, flush } = require('./lib.cjs');
async function avatars(p, label) {
  const r = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-testid="user-avatar"],[data-testid="beneficiary-avatar"]').forEach((c) => {
      const t = c.querySelector('div[dir=auto],span') || c; const cr = c.getBoundingClientRect(); const tr = t.getBoundingClientRect();
      const clipped = tr.left < cr.left - 0.5 || tr.right > cr.right + 0.5 || tr.top < cr.top - 0.5 || tr.bottom > cr.bottom + 0.5 || c.scrollWidth > c.clientWidth + 1 || t.scrollWidth > t.clientWidth + 1;
      out.push({ id: c.getAttribute('data-testid'), text: t.innerText, box: `${Math.round(cr.width)}x${Math.round(cr.height)}`, textBox: `${Math.round(tr.width)}x${Math.round(tr.height)}`, clipped, round: getComputedStyle(c).borderRadius });
    });
    const small = []; document.querySelectorAll('button,[role=button],[role=tab]').forEach((e) => { const b = e.getBoundingClientRect(); if (b.width && (b.width < 43.5 || b.height < 43.5)) small.push(((e.getAttribute('aria-label') || e.innerText || '').replace(/\n/g, ' ').slice(0, 36)) + ` ${Math.round(b.width)}x${Math.round(b.height)}`); });
    return { out, small, sw: document.documentElement.scrollWidth };
  });
  L(`  AVATARS ${label}: n=${r.out.length} clipped=${r.out.filter((x) => x.clipped).length} scrollW=${r.sw} ${JSON.stringify(r.out.map((x) => `${x.id.slice(0, 4)}:${x.text}:${x.box}/${x.textBox}${x.clipped ? ' CLIPPED' : ''}`))} | targets<44: ${JSON.stringify(r.small)}`);
  return r;
}
(async () => {
  const browser = await chromium.launch();
  for (const scale of [1, 1.3, 2]) {
    L(`===== F-25 scale ${scale} =====`);
    const u = await mkUser('Wendy Wu', 'wu'); const c = await registerUser('Wanda Wu', 'bw'); const cacc = (await call(c.token, '/accounts')).b.items.find((a) => a.kind === 'checking');
    u.w = (await call(u.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Wanda Wu', alias: 'Wanda', clabe: cacc.clabe }) })).b;
    const p = await newPage(browser, { h: 929, scale }); await login(p, u.email); const tag = scale === 1 ? '' : `-x${scale}`;
    await p.shot(`F25-M02${tag}`); await avatars(p, 'M02 Inicio');
    await origin(p, /^Cuenta principal/); await p.getByLabel(/Elegir beneficiario/i).first().click(); await p.waitForTimeout(1200); await p.shot(`F25-M05${tag}`); await avatars(p, 'M05 picker (header + tarjetas)');
    await p.getByLabel(/^Seleccionar Wanda/).first().click(); await p.waitForTimeout(500);
    await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000); await fill(p, '850.00', 'Comida', '1234'); await p.shot(`F25-M06${tag}`); await avatars(p, 'M06 datos');
    await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1000); await p.shot(`F25-M07${tag}`); await avatars(p, 'M07 revision');
    await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000); await p.shot(`F25-M10${tag}`); await avatars(p, 'M10 comprobante');
    await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(2000); await p.shot(`F25-M03${tag}`); await avatars(p, 'M03 movimientos');
    L('  errs', p.errs.length);
    await p.context().close();
  }
  await browser.close(); flush('logs/ui-f25.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
