// Pass 10 · regression: share/PDF only for completed (receipt after an explicit resend offers them; M09 pending and M04 detail do not).
const H = require('./h10.cjs');
const { chromium, L, ok, mkUser, mkRecipient, newPage, login, wire, uid, audit, toConfirm, flush, xfer } = H;
(async () => {
  const browser = await chromium.launch();
  const u = await mkUser('Ana López'); const p = await newPage(browser, { h: 929 }); const net = {}; await wire(p, net); await login(p, u.email);
  await toConfirm(p); net.create = 'lost-before'; await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
  let t = await p.text(); ok(/Estamos verificando/.test(t), 'M09 shown');
  L('M09 (unresolved) share/PDF actions:', await p.getByRole('button', { name: /Compartir|PDF/ }).count());
  ok((await p.getByRole('button', { name: /Compartir|PDF/ }).count()) === 0, 'M09 pending: no share/PDF');
  net.create = 'pass'; await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(800); await p.btn('Reenviar la misma transferencia').click(); await p.waitForTimeout(3500);
  t = await p.text(); ok(/Transferencia exitosa|Comprobante|Folio/.test(t), 'receipt after the explicit resend');
  L('M10 (completed) actions:', await p.getByRole('button', { name: /Compartir|PDF/ }).count()); ok((await p.getByRole('button', { name: /Compartir|PDF/ }).count()) >= 2, 'M10 completed: share + PDF offered');
  await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(2000);
  await p.getByRole('button', { name: /Traspaso a/ }).first().click(); await p.waitForTimeout(1500);
  const n = await p.getByRole('button', { name: /Compartir|PDF/ }).count(); L('M04 detail share/PDF actions:', n); ok(n === 0, 'M04 detail: no share/PDF');
  await p.shot('ev10-4-m04-detalle');
  await browser.close(); flush('logs/ui-ev10-4.txt');
})().catch((e) => { console.error('FAILED', e); H.flush('logs/ui-ev10-4-failed.txt'); process.exitCode = 1; });
