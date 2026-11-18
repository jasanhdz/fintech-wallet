// Before | after side by side (same scenario, pre-fix bundle 261decc vs fixed bundle ed4945e). Usage: node h3-compose.cjs <evidenceDir>
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet-g1/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const dir = process.argv[2]; const shots = path.join(dir, 'shots'); const out = path.join(dir, 'lado-a-lado'); fs.mkdirSync(out, { recursive: true });
const url = (f) => `data:image/png;base64,${fs.readFileSync(path.join(shots, f)).toString('base64')}`;
const pairs = [
  ['F21-inicio-tras-M09', 'A-tras-ir-al-inicio-antes.png', 'A-tras-ir-al-inicio-despues.png', 'F-21 · Inicio tras "Ir al inicio" (respuesta perdida tras aplicarse)'],
  ['F21-segundo-intento-vs-bloqueo', 'A-segundo-intento-antes.png', 'B-inicio-bloqueado-despues.png', 'F-21 · antes: 2.º intento con otra llave (doble débito) · después: Inicio sin entrada a otro intento'],
  ['F21-flujo-rehabilitado', 'A-M09-despues.png', 'A-inicio-rehabilitado-despues.png', 'F-21 (después) · M09 | Inicio tras resolverse (flujo rehabilitado)'],
  ['F15-M07-umbral-844', 'F15-M07-umbral-844-antes.png', 'F15-M07-umbral-844-despues.png', 'F-15 · M07 umbral 390x844 con nombres reales'],
  ['F25-M02-200', 'F25-M02-x2-antes.png', 'F25-M02-x2-despues.png', 'F-25 · Inicio a 200 % (aprox. CSS)'],
  ['F25-M07-200', 'F25-M07-x2-antes.png', 'F25-M07-x2-despues.png', 'F-25 · M07 a 200 % (aprox. CSS)'],
];
const W = 360;
(async () => {
  const browser = await chromium.launch(); const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, a, b, title] of pairs) {
    if (!fs.existsSync(path.join(shots, a)) || !fs.existsSync(path.join(shots, b))) { console.log('missing', name); continue; }
    const before = /antes/.test(a) ? 'Antes (261decc)' : 'Después (ed4945e)';
    await page.setContent(`<html><body style="margin:0;background:#666;font:13px system-ui"><div id="sbs" style="display:inline-block;padding:12px"><div style="color:#fff;font-weight:600;margin-bottom:8px;max-width:${2 * W + 12}px">${title}</div><div style="display:flex;gap:12px;align-items:flex-start"><figure style="margin:0"><figcaption style="color:#fff">${before} · ${a}</figcaption><img src="${url(a)}" style="width:${W}px;display:block"></figure><figure style="margin:0"><figcaption style="color:#fff">Después (ed4945e) · ${b}</figcaption><img src="${url(b)}" style="width:${W}px;display:block"></figure></div></div></body></html>`);
    await page.waitForTimeout(150);
    await page.locator('#sbs').screenshot({ path: path.join(out, `${name}--lado-a-lado.jpg`), type: 'jpeg', quality: 75 });
    console.log('composed', name);
  }
  await browser.close();
})();
