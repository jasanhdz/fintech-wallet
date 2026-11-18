// Item 10 (double tap): two DOM clicks on "Compartir comprobante" in the same tick and 40 ms apart while the sheet (navigator.share stub) is open.
const { chromium, L, mkUser, newPage, login, origin, choose, toReview, flush } = require('./lib.cjs');
(async () => {
  const browser = await chromium.launch(); const u = await mkUser(); const p = await newPage(browser, { h: 1149 });
  await p.addInitScript(() => { window.__n = 0; navigator.share = () => { window.__n += 1; return new Promise((r) => setTimeout(r, 1500)); }; });
  await login(p, u.email); await origin(p, /^Cuenta principal/); await choose(p, 'Cuenta de ahorro demo'); await toReview(p, '100.00', 'Doble', '77');
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  const sel = 'SHARE';
  const find = () => [...document.querySelectorAll('[role=button]')].find((e) => /Compartir comprobante/.test(e.innerText || e.getAttribute('aria-label') || ''));
  L('share buttons found:', await p.evaluate(() => [...document.querySelectorAll('[role=button]')].filter((e) => /Compartir comprobante/.test(e.innerText || e.getAttribute('aria-label') || '')).length));
  await p.evaluate(() => { const el = [...document.querySelectorAll('[role=button]')].find((e) => /Compartir comprobante/.test(e.innerText || e.getAttribute('aria-label') || '')); el.click(); el.click(); }); await p.waitForTimeout(300);
  L('same-tick double click -> navigator.share calls:', await p.evaluate(() => window.__n), '| busy label present:', /Abriendo la hoja para compartir/.test(await p.text()));
  await p.waitForTimeout(1800);
  await p.evaluate(() => { window.__n = 0; });
  // while the sheet is open: what does the busy button expose? (name, disabled, busy)
  await p.evaluate(() => { [...document.querySelectorAll('[role=button]')].find((e) => /Compartir comprobante/.test(e.innerText)).click(); }); await p.waitForTimeout(200);
  L('busy buttons:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('[role=button]')].filter((e) => /Compartir|PDF/.test(e.innerText + (e.getAttribute('aria-label') || '')) || e.querySelector('[role=progressbar]')).map((e) => ({ text: (e.innerText || '').slice(0, 30), label: e.getAttribute('aria-label'), disabled: e.getAttribute('aria-disabled'), busy: e.getAttribute('aria-busy') })))));
  await p.waitForTimeout(1800);
  await p.evaluate(() => { window.__n = 0; });
  await p.getByRole('button', { name: 'Compartir comprobante' }).click(); await p.waitForTimeout(150); await p.getByRole('button', { name: /PDF/ }).first().click({ force: true }); await p.waitForTimeout(300);
  L('share text then PDF while busy -> navigator.share calls:', await p.evaluate(() => window.__n), '(1 expected; PDF on web would add a message only)');
  await p.waitForTimeout(1800); L('after sheet closes: busy cleared', !/Abriendo la hoja/.test(await p.text()));
  await browser.close(); flush('logs/ui-dbltap.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
