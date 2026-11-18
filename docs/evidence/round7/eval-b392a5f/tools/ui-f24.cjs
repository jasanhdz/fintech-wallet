// Pass 9 · item 5: F-24 code entry: pasted values with separators, letters, > 6 digits; typing and deleting; DOM attributes. The real code is never printed.
const { chromium, L, ok, mkUser, balances, newPage, login, origin, choose, toReview, flush, psql } = require('./lib.cjs');
const readCode = async (p) => { const t = await p.evaluate(() => document.body.innerText); const m = t.match(/Código asignado para esta prueba:\s*(\d{6})/); return m ? m[1] : null; };
(async () => {
  const browser = await chromium.launch();
  const u = await mkUser(); const p = await newPage(browser, { h: 884 }); await login(p, u.email);
  await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '6000.00', 'Prueba pegado', '9301');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const code = await readCode(p); const input = p.getByLabel('Código de confirmación', { exact: true });
  const attrs = await input.evaluate((e) => ({ tag: e.tagName, maxlength: e.getAttribute('maxlength'), autocomplete: e.getAttribute('autocomplete'), inputmode: e.getAttribute('inputmode'), type: e.getAttribute('type'), ariaLabel: e.getAttribute('aria-label') }));
  L('input attrs:', JSON.stringify(attrs)); ok(attrs.maxlength === null && attrs.autocomplete === 'one-time-code' && attrs.inputmode === 'numeric' && attrs.ariaLabel === 'Código de confirmación', 'no maxLength; oneTimeCode, numeric keyboard and accessible name kept');
  const boxes = async () => (await p.evaluate(() => document.querySelector('input[aria-label="Código de confirmación"]').value));
  const paste = async (s) => { await input.fill(''); await input.click(); await p.keyboard.insertText(s); await p.waitForTimeout(250); return boxes(); };
  const cases = [['12 34-56', '123456'], ['12a3456789', '123456'], ['123456', '123456'], ['1234567890', '123456'], [' 742-890 ', '742890'], ['١٢٣٤٥٦', ''], ['12', '12']];
  for (const [inp, exp] of cases) { const v = await paste(inp); ok(v === exp, `paste ${JSON.stringify(inp)} -> ${JSON.stringify(v)} (expected ${JSON.stringify(exp)})`); }
  // typing digit by digit then deleting
  await input.fill(''); await input.focus(); for (const ch of '1234567') await p.keyboard.type(ch); await p.waitForTimeout(200);
  L('typed 1234567 ->', JSON.stringify(await boxes())); ok((await boxes()) === '123456', 'typing a 7th digit is ignored');
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); L('after 2 backspaces ->', JSON.stringify(await boxes())); ok((await boxes()) === '1234', 'backspace deletes');
  await p.keyboard.type('x9'); L('typing letter x then 9 ->', JSON.stringify(await boxes())); ok((await boxes()) === '12349', 'letters ignored, digit accepted');
  const t = await p.text(); L('M08 text shows "Faltan 1 dígito":', /Faltan 1 d/.test(t));
  // authorize with the real code pasted WITH separators (functional)
  const sep = `${code.slice(0, 2)} ${code.slice(2, 4)}-${code.slice(4)}`; await paste(sep);
  L('Autorizar enabled with a pasted separated real code:', (await p.getByRole('button', { name: 'Autorizar transferencia' }).getAttribute('aria-disabled')) !== 'true');
  await p.btn('Autorizar transferencia').click(); await p.waitForTimeout(3500);
  L('receipt:', /Transferencia completada/.test(await p.text()), '| DB:', psql(`select string_agg(t.status||':'||t.amount_minor, '|') from transfers t join users x on x.id=t.owner_id where x.email='${u.email}'`));
  await browser.close(); flush('logs/ui-f24.txt');
})().catch((e) => { console.error('FAILED', e.stack || e.message); process.exit(1); });
