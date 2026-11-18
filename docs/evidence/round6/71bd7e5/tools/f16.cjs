// F-16: no horizontal overflow at 100 / 130 / 200 % text (CSS approximation of fontScale, NOT native Dynamic Type) on
// M01, M02, M03, M04 (sent and received), M05, M06 (origin selector open), M07 (normal and threshold), M08, M09, M10, M11,
// with long data (63-character name, 112-character beneficiary, 79-character alias, 39-character concept, real UUIDs).
// Usage: node f16.cjs <outDir>
const { chromium, fs, L, log, api, transfer, seed, newPage, login, toDetails, fill, blur, scale, overflow } = require('./g4lib.cjs');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const NAME = 'Ana María de los Ángeles López-Hernández de la Cruz y Villaseñor';
const BENEF = 'Corporativo Internacional de Servicios Profesionales y Consultoría Estratégica Integral del Sureste S.A. de C.V.';
const ALIAS = 'Proveedor principal de materiales y servicios generales del corporativo regional';
const CONCEPT = 'Pago de servicios del departamento 40ch';
const FACTORS = (process.env.G4_FACTORS || '1,1.3,2').split(',').map(Number);
let total = 0;
async function check(page, f, state) {
  if (f !== 1) await scale(page, f);
  await page.waitForTimeout(250); await blur(page);
  const o = await overflow(page); total += o.nbad;
  L(`x${f} ${state} ${JSON.stringify(o)}`);
  await page.screenshot({ path: `${OUT}/x${f}-${state}.png`, fullPage: false });
}
(async () => {
  const browser = await chromium.launch();
  for (const f of FACTORS) {
    // Fresh users per factor: each pass spends and drains test balance.
    const s = await seed('f16' + String(f).replace('.', '') + Date.now().toString().slice(-5), { name: NAME, longBeneficiary: { name: BENEF, alias: ALIAS } });
    // M01 (empty and wrong credentials)
    let page = await newPage(browser);
    await page.goto(require('./g4lib.cjs').APP); await page.getByLabel('Correo electrónico').waitFor();
    await check(page, f, 'M01-login');
    await page.getByLabel('Correo electrónico').fill(s.anaEmail); await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta-de-prueba');
    await page.btn('Iniciar sesión').click(); await page.waitForTimeout(1500);
    await check(page, f, 'M01-credenciales');
    await page.context().close();
    // M02, M05, M06, M07, M10, M03, M04
    page = await newPage(browser); await login(page, s.anaEmail);
    await check(page, f, 'M02-inicio');
    await page.getByLabel(/Elegir beneficiario/i).first().click(); await page.waitForTimeout(1200);
    await check(page, f, 'M05-beneficiarios');
    await page.getByLabel(/^Seleccionar Corporativo/).first().click(); await page.waitForTimeout(400);
    await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1200);
    await fill(page, '850', CONCEPT, '1234567');
    await page.getByLabel('Cambiar cuenta de origen').click(); await page.waitForTimeout(300);
    await check(page, f, 'M06-datos-selector');
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900);
    await check(page, f, 'M07-revision');
    await page.btn('Confirmar transferencia').click(); await page.waitForTimeout(2500);
    await check(page, f, 'M10-comprobante');
    await page.btn('Ver últimos movimientos').click(); await page.waitForTimeout(1500);
    await check(page, f, 'M03-movimientos');
    await page.getByRole('button', { name: /^Cargo/ }).first().click(); await page.waitForTimeout(1200);
    await check(page, f, 'M04-enviada');
    await page.getByLabel('Volver a movimientos').first().click(); await page.waitForTimeout(800);
    await page.getByRole('button', { name: /^Abono/ }).first().click(); await page.waitForTimeout(1200);
    await check(page, f, 'M04-recibida');
    await page.context().close();
    // M07 threshold + M08
    page = await newPage(browser); await login(page, s.anaEmail);
    await toDetails(page, 'Corporativo'); await fill(page, '5000', CONCEPT, '7654321');
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900);
    await check(page, f, 'M07-umbral');
    await page.btn('Continuar a verificación').click(); await page.waitForTimeout(2500);
    await check(page, f, 'M08-codigo');
    await page.btn('Cancelar y volver a revisar').click(); await page.waitForTimeout(1000);
    await page.context().close();
    // M09 (create request lost) and M11 (balance drained between review and send)
    page = await newPage(browser); await login(page, s.anaEmail);
    await toDetails(page, 'Corporativo'); await fill(page, '100', CONCEPT, '5551212');
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900);
    await page.route(/\/v1\/transfers$/, (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
    await page.btn('Confirmar transferencia').click(); await page.waitForTimeout(2000);
    await check(page, f, 'M09-verificando');
    await page.context().close();
    page = await newPage(browser); await login(page, s.anaEmail);
    await toDetails(page, 'Corporativo'); await fill(page, '1000', CONCEPT, '4441212');
    await page.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await page.waitForTimeout(900);
    const accounts = (await api(s.ana, '/accounts')).b.items; const pr = accounts.find((a) => a.kind === 'checking');
    const own = (await api(s.ana, '/beneficiaries')).b.items.find((b) => b.ownAccountId);
    const drain = BigInt(pr.availableBalanceMinor) - 50000n; // leave $500.00
    if (drain > 0n) {
      // Move it to savings in chunks below the demo OTP threshold.
      let left = drain; let i = 0;
      while (left > 0n && i < 40) { const chunk = left > 499999n ? 499999n : left; await transfer(s.ana, { sourceAccountId: pr.id, destinationType: 'beneficiary', beneficiaryId: own.id, amountMinor: chunk.toString(), concept: 'Ajuste prueba', reference: String(100 + i) }); left -= chunk; i += 1; }
    }
    await page.btn('Confirmar transferencia').click(); await page.waitForTimeout(2000);
    await check(page, f, 'M11-rechazada');
    await page.context().close();
  }
  L(`F16 total overflowing boxes: ${total}`);
  await browser.close(); fs.writeFileSync(`${OUT}/f16-log.txt`, log.join('\n') + '\n');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
