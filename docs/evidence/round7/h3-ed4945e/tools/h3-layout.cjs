// R7 H3 · F-15 (M07 action positions with real account names at 390x844/884/763), F-25 (avatar initials at 200 %, CSS
// approximation of fontScale) and F-24 (pasting a code with separators) on the real RN-Web bundle + wallet_test API.
// Usage: EV_OUT=<dir> H3_VARIANT=before|after node h3-layout.cjs
const { chromium, L, ok, mkUser, mkRecipient, newPage, login, origin, choose, toReview, box, flush } = require('./lib.cjs');
const variant = process.env.H3_VARIANT || 'after';
const tag = variant === 'before' ? 'antes' : 'despues';
// Avatar = the element whose own text is the user's initials; compares the text box with its circle/pill container.
const avatars = (p, initials) => p.evaluate((ini) => [...document.querySelectorAll('div[dir=auto]')].filter((e) => e.innerText === ini).map((t) => { const c = t.parentElement.getBoundingClientRect(); const r = t.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(t).fontSize); const inside = r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5 && r.left >= c.left - 0.5 && r.right <= c.right + 0.5; return { font: fs, text: `${Math.round(r.width)}x${Math.round(r.height)}`, box: `${Math.round(c.width)}x${Math.round(c.height)}`, inside }; }), initials);
(async () => {
  const browser = await chromium.launch(); const u = await mkUser(); await mkRecipient(u);
  L(`===== variant ${variant} =====`);
  // ---- F-15
  for (const [label, dest, amount, primary] of [['normal (Carlos Ruiz, 850.00)', 'Carlos', '850.00', 'Confirmar transferencia'], ['propias (Ahorro, 850.00)', 'Cuenta de ahorro demo', '850.00', 'Confirmar transferencia'], ['umbral (Ahorro, 6000.00)', 'Cuenta de ahorro demo', '6000.00', 'Continuar a verificación']]) {
    for (const h of [844, 884, 763]) {
      const p = await newPage(browser, { h, variant }); await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, dest); await toReview(p, amount);
      const prim = await box(p, primary); const mod = await box(p, 'Modificar datos');
      const fits = [prim, mod].every((b) => b !== 'n/a' && Number(b.split('-')[1]) <= h);
      L(`F-15 M07 ${label} @390x${h}: primary ${prim} / Modificar ${mod} -> both inside without scrolling: ${fits}`);
      if (variant === 'after') ok(fits, `F-15 ${label} @${h}`);
      if (h === 844 && label.startsWith('umbral')) { await p.shot(`F15-M07-umbral-844-${tag}`); const sizes = await p.evaluate(() => { const s = new Set(); document.querySelectorAll('div[dir=auto]').forEach((e) => { if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !/ionicons|material/i.test(getComputedStyle(e).fontFamily)) s.add(parseFloat(getComputedStyle(e).fontSize)); }); return [...s].sort((a, b) => a - b); }); L('  M07 umbral text sizes (px):', sizes); }
      await p.context().close();
    }
  }
  // ---- F-25 at 200 % (and 100 % reference)
  for (const scale of [1, 2]) {
    const p = await newPage(browser, { h: 929, scale, variant }); await login(p, u.email);
    await p.applyScale(); await p.waitForTimeout(300);
    const home = await avatars(p, 'AL'); await p.shot(`F25-M02-x${scale}-${tag}`);
    await origin(p, /^Cuenta principal/); await choose(p, 'Carlos'); await toReview(p, '850.00');
    await p.applyScale(); await p.waitForTimeout(300);
    const m07 = await avatars(p, 'AL'); await p.shot(`F25-M07-x${scale}-${tag}`);
    L(`F-25 avatar @${scale * 100}%: Home ${JSON.stringify(home)} | M07 header ${JSON.stringify(m07)}`);
    if (variant === 'after') ok([...home, ...m07].length >= 2 && [...home, ...m07].every((a) => a.inside), `F-25 initials inside their avatar @${scale * 100}%`);
    const tapTargets = await p.evaluate(() => [...document.querySelectorAll('[role=button]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width && (r.width < 44 || r.height < 44)).length);
    L(`  M07 @${scale * 100}%: buttons smaller than 44 px: ${tapTargets}; scrollWidth ${await p.evaluate(() => document.documentElement.scrollWidth)}`);
    await p.context().close();
  }
  // ---- F-24: paste into the code input (M08)
  { const p = await newPage(browser, { h: 884, variant }); await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '6000.00');
    await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
    const input = p.getByLabel('Código de confirmación', { exact: true });
    for (const pasted of ['12 34-56', '12a3456789', '123456']) {
      await input.fill(''); await input.focus(); await p.keyboard.insertText(pasted); await p.waitForTimeout(200);
      const v = await input.inputValue();
      L(`F-24 paste ${JSON.stringify(pasted)} -> ${v.length} digits${v === '123456' ? ' (123456)' : ''} | maxLength attr ${await input.getAttribute('maxlength')} | autocomplete ${await input.getAttribute('autocomplete')}`);
      if (variant === 'after') ok(v === '123456', `F-24 paste ${pasted}`);
    }
    await input.fill('');
    await p.context().close(); }
  await browser.close(); flush(`logs/h3-layout-${tag}.txt`);
})().catch((e) => { console.error('FAILED', e.message); flush(`logs/h3-layout-${tag}-failed.txt`); process.exit(1); });
