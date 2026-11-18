// M08 hidden input: real key presses (type), paste-like insertText, Backspace; tests the controlled input on RN-Web (native keyboard still pending).
const { chromium, L, mkUser, newPage, login, origin, choose, toReview, flush } = require('./lib.cjs');
const rewrite = (p) => p.route('http://127.0.0.1:3897/**', (r) => r.continue({ url: r.request().url().replace(':3897', ':3898') }));
(async () => {
  const browser = await chromium.launch(); const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await rewrite(p);
  await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '2000.00', 'Tecleo', '78');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2000);
  const input = p.getByLabel('Código de confirmación', { exact: true }); const val = async () => (await input.inputValue());
  await p.mouse.click(195, 700 - 0); // tap on the visual boxes area (hit target is the overlaid input)
  const box = await input.boundingBox(); L('input box', JSON.stringify({ y: Math.round(box.y), h: Math.round(box.height) }));
  await p.mouse.click(box.x + 40, box.y + box.height / 2); L('focused after tapping the boxes area:', await input.evaluate((e) => document.activeElement === e));
  await p.keyboard.type('12', { delay: 80 }); await p.waitForTimeout(200); L('type "12" (80 ms/key) -> length', (await val()).length, 'text', /Faltan 4 dígitos/.test(await p.text()));
  await p.keyboard.type('3', { delay: 80 }); L('type "3" -> length', (await val()).length, '(3 expected)');
  await p.keyboard.press('Backspace'); L('Backspace -> length', (await val()).length, '(2 expected)', /Faltan 4 dígitos/.test(await p.text()));
  await p.keyboard.type('3456', { delay: 80 }); L('type "3456" -> length', (await val()).length, '(6 expected)', /Código completo/.test(await p.text()));
  await p.keyboard.type('9', { delay: 80 }); L('7th digit ignored -> length', (await val()).length, '(6 expected)');
  for (let i = 0; i < 6; i++) await p.keyboard.press('Backspace'); L('6x Backspace -> length', (await val()).length);
  await p.keyboard.insertText('12 34-56'); L('paste "12 34-56" -> length', (await val()).length, '(6 expected, digits only)');
  await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace'); L('select all + delete -> length', (await val()).length);
  await browser.close(); flush('logs/ui-type.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
