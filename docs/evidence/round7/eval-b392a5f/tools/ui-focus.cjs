// Does a real mouse tap focus the inputs on the RN-Web render? M06 amount (control) vs M08 hidden code input (tap on the visual boxes).
const { chromium, L, mkUser, newPage, login, origin, choose, toReview, flush } = require('./lib.cjs');
const rewrite = (p) => p.route('http://127.0.0.1:3991/**', (r) => r.continue({ url: r.request().url().replace(':3991', ':3992') }));
(async () => {
  const browser = await chromium.launch(); const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p);
  await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo');
  await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1000);
  const amt = p.getByLabel('Monto a transferir', { exact: true }); const b = await amt.boundingBox();
  await p.mouse.click(b.x + 30, b.y + b.height / 2); await p.waitForTimeout(300);
  L('M06 amount: mouse tap focuses input:', await amt.evaluate((e) => document.activeElement === e)); await p.keyboard.type('12', { delay: 60 }); L('  typed "12" ->', JSON.stringify(await amt.inputValue()));
  await amt.fill('2000.00'); await p.getByLabel('Concepto de pago', { exact: true }).fill('Foco'); await p.getByLabel(/Referencia numérica/).first().fill('9');
  await p.getByRole('button', { name: /^Continuar(?! con| a )/ }).click(); await p.waitForTimeout(1000); await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2000);
  const input = p.getByLabel('Código de confirmación', { exact: true }); const ib = await input.boundingBox();
  const hit = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName} aria-label=${e.getAttribute('aria-label') || ''} pe=${getComputedStyle(e).pointerEvents}` : null; }, [ib.x + 40, ib.y + ib.height / 2]);
  L('M08 hidden input box', JSON.stringify({ y: Math.round(ib.y), h: Math.round(ib.height) }), '| element at tap point:', hit);
  await p.mouse.click(ib.x + 40, ib.y + ib.height / 2); await p.waitForTimeout(300);
  L('M08 mouse tap on boxes area: input focused:', await input.evaluate((e) => document.activeElement === e));
  await p.keyboard.type('123456', { delay: 60 }); L('  typed "123456" ->', (await input.inputValue()).length, 'digits');
  await input.focus(); await p.keyboard.type('123456', { delay: 60 }); L('  after programmatic focus(), typed "123456" ->', (await input.inputValue()).length, 'digits', '| Autorizar enabled', (await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled')) !== 'true');
  await p.keyboard.press('Backspace'); L('  Backspace ->', (await input.inputValue()).length); await p.keyboard.press('Backspace'); L('  Backspace ->', (await input.inputValue()).length);
  await input.fill(''); await p.keyboard.insertText('12 34-56'); L('  insertText "12 34-56" ->', (await input.inputValue()).length, 'digits (6 expected)');
  await browser.close(); flush('logs/ui-focus.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
