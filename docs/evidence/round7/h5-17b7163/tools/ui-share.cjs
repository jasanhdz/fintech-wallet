// Item 10: M10 share/PDF on the RN-Web render (native sheet/expo-print/expo-sharing are NOT exercised here; see jest + native pending),
// and the real receipt HTML (malicious concept) rendered in Chromium -> printed to PDF.
const { chromium, L, ok, call, mkUser, balances, dbRows, newPage, login, origin, choose, toReview, flush, fs, OUT } = require('./lib.cjs');
const { execSync } = require('child_process');
(async () => {
  const browser = await chromium.launch();
  const u = await mkUser(); await require('./lib.cjs').mkRecipient(u);
  const p = await newPage(browser, { h: 1149 });
  await p.addInitScript(() => { window.__shared = []; window.__mode = 'ok'; navigator.share = (data) => { window.__shared.push(data); if (window.__mode === 'cancel') return Promise.reject(Object.assign(new Error('Share canceled'), { name: 'AbortError' })); if (window.__mode === 'error') return Promise.reject(new Error('boom /private/var/secret/path.pdf')); if (window.__mode === 'slow') return new Promise((r) => setTimeout(r, 1500)); return Promise.resolve(); }; });
  await login(p, u.email);
  await origin(p, /^Cuenta principal/); await choose(p, 'Carlos'); await toReview(p, '850.00', '<b>Comida</b> & "x"', '131126');
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  const t = await p.shot('M10-comprobante');
  L('M10 actions: Compartir comprobante', await p.getByRole('button', { name: 'Compartir comprobante' }).count(), '| PDF button label (web)', (await p.getByRole('button', { name: /PDF/ }).first().innerText()), '| caption', /Opciones de comprobante \(opcional\)/.test(t), '| disclaimer on screen', /demostración técnica interna/.test(t));
  const share = p.getByRole('button', { name: 'Compartir comprobante' });
  // normal share
  await share.click(); await p.waitForTimeout(600);
  const shared = await p.evaluate(() => window.__shared);
  const text = (shared[0]?.text || shared[0]?.message || '') + '';
  L('share text: calls', shared.length, '| has disclaimer', /no es un comprobante bancario oficial/.test(text), '| masked ends', /•• \d{4}/.test(text), '| full 18-digit CLABE', /\b\d{18}\b/.test(text), '| UUID folio present', /[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), '| email', /@example\.test/.test(text), '| token-like (eyJ)', /eyJ/.test(text));
  fs.writeFileSync(`${OUT}/logs/shared-text-web.txt`, text.replace(/\b\d{6}\b/g, '••••••'));
  // cancel
  await p.evaluate(() => { window.__mode = 'cancel'; }); await share.click(); await p.waitForTimeout(600);
  L('cancel (AbortError): error alert shown', await p.getByRole('alert').count() > 0 && /No se pudo/.test(await p.text()), '| button enabled again', await share.getAttribute('aria-disabled') !== 'true');
  // error then retry
  await p.evaluate(() => { window.__mode = 'error'; }); await share.click(); await p.waitForTimeout(600);
  const te = await p.shot('M10-error-compartir');
  L('error: message', /No se pudo abrir la hoja para compartir/.test(te), '| leaks path/internals', /private|secret|boom/.test(te));
  await p.evaluate(() => { window.__mode = 'ok'; }); await share.click(); await p.waitForTimeout(600);
  L('retry after error: error cleared', !/No se pudo abrir la hoja/.test(await p.text()));
  // double tap
  await p.evaluate(() => { window.__mode = 'slow'; window.__shared.length = 0; }); await share.click(); await share.click({ force: true }).catch(() => {}); await p.waitForTimeout(300);
  L('double tap: calls to navigator.share during the first sheet', await p.evaluate(() => window.__shared.length), '| other action disabled meanwhile', await p.getByRole('button', { name: /PDF/ }).first().getAttribute('aria-disabled'), '| live status', /Abriendo la hoja para compartir/.test(await p.text()));
  await p.waitForTimeout(1500);
  // PDF on web
  await p.evaluate(() => { window.__mode = 'ok'; }); await p.getByRole('button', { name: /PDF/ }).first().click(); await p.waitForTimeout(600);
  L('PDF on web:', (await p.text()).match(/El PDF del comprobante[^\n]*/)?.[0]);
  // sharing unavailable
  await p.evaluate(() => { navigator.share = undefined; }); await share.click(); await p.waitForTimeout(500);
  L('navigator.share missing:', (await p.text()).match(/Compartir no está disponible[^\n]*/)?.[0]);
  // not offered while pending verification: lost response screen
  const v = await mkUser(); const q = await newPage(browser, { h: 918 }); await login(q, v.email);
  await origin(q, /^Cuenta principal/); await choose(q, 'Cuenta de ahorro demo'); await toReview(q, '300.25', 'Pend', '9401');
  await q.route('**/v1/transfers', async (r) => { if (r.request().method() === 'POST') { await r.fetch(); await r.abort('connectionreset'); } else await r.continue(); });
  await q.btn('Confirmar transferencia').click(); await q.waitForTimeout(2500);
  L('M09 (unverified) offers share actions:', (await q.getByRole('button', { name: /Compartir|PDF/ }).count()) > 0);
  // M04 movement detail: no PDF
  await q.unroute('**/v1/transfers'); await q.btn('Reenviar la misma transferencia').click(); await q.waitForTimeout(1200); await q.btn('Reenviar la misma transferencia').click(); await q.waitForTimeout(3000); // H5: same-key resend reconciles it
  await q.btn('Ver últimos movimientos').click(); await q.waitForTimeout(2000);
  await q.getByRole('button', { name: /Traspaso a/ }).first().click(); await q.waitForTimeout(1500);
  L('M04 detail offers share/PDF:', (await q.getByRole('button', { name: /Compartir|PDF/ }).count()) > 0);
  await q.context().close(); await p.context().close();
  // ---- Real receipt HTML (malicious fields) rendered in Chromium + PDF
  const html = fs.readFileSync(`${OUT}/artifacts/receipt-malicious.html`, 'utf8');
  const ctx = await browser.newContext(); const page = await ctx.newPage(); let dialogs = 0; page.on('dialog', async (d) => { dialogs += 1; await d.dismiss(); });
  await page.setContent(html); await page.waitForTimeout(500);
  const dom = await page.evaluate(() => ({ scripts: document.querySelectorAll('script').length, imgs: document.querySelectorAll('img').length, bold: document.querySelectorAll('td b, th b').length, text: document.body.innerText }));
  L('HTML render: <script> elements', dom.scripts, '| <img> elements', dom.imgs, '| injected <b> elements', dom.bold, '| alert dialogs fired', dialogs, '| literal payload visible as text', /<img src=x onerror=alert\(1\)>/.test(dom.text) && /<script>alert\("x"\)<\/script>/.test(dom.text));
  await page.screenshot({ path: `${OUT}/shots/receipt-html-malicious.png`, fullPage: true });
  await page.pdf({ path: `${OUT}/artifacts/receipt-malicious.pdf`, format: 'A4' });
  try { const txt = execSync(`pdftotext -layout ${OUT}/artifacts/receipt-malicious.pdf -`).toString(); fs.writeFileSync(`${OUT}/logs/receipt-pdf-text.txt`, txt); L('PDF text extracted (pdftotext): lines', txt.split('\n').length, '| has disclaimer', /no es un comprobante bancario oficial/.test(txt), '| 987654', /987654/.test(txt), '| 646180000000001231', /646180000000001231/.test(txt)); } catch (e) { L('pdftotext not available:', String(e.message).slice(0, 60)); }
  await ctx.close(); await browser.close(); flush('logs/ui-share.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
