// Round 6 G2 evidence: drives the REAL exported RN-web bundle (:8711) against the isolated API (:3711, wallet_test).
// Not native evidence. Usage: node capture.cjs <seed.json> <outDir>
const { chromium } = require('/Users/jasanhernandez/Develop/fintech-wallet/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const API = 'http://127.0.0.1:3711/v1';
const APP = 'http://localhost:8711/';
const psql = (q) => execSync(`docker exec -i fintech-wallet-postgres-1 psql -U postgres -d wallet_test -At -c ${JSON.stringify(q)}`).toString().trim();
const logLines = []; const allErrors = [];
const log = (...a) => { const s = a.join(' '); console.log(s); logLines.push(s); };
// Logical heights of each Stitch reference (PNG height * 390 / PNG width).
const REF = JSON.parse(fs.readFileSync(`${__dirname}/refs.json`, 'utf8'));
const heightFor = (ref) => Math.round(REF[ref].h * 390 / REF[ref].w);

async function apiLogin(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: seed.password, client: 'mobile' }) });
  return (await r.json()).accessToken;
}
async function apiCall(token, path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const balances = () => psql(`select a.name||'='||a.balance_minor from accounts a join users u on u.id=a.owner_id where u.email='${seed.ana.email}' order by a.kind`).replace(/\n/g, ' ');
const transfersByRef = (ref) => psql(`select status||':'||amount_minor from transfers t join users u on u.id=t.owner_id where u.email='${seed.ana.email}' and t.reference='${ref}' order by t.created_at`).replace(/\n/g, ' ');

(async () => {
  const browser = await chromium.launch();
  async function newPage(ref) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: heightFor(ref) }, deviceScaleFactor: 2, locale: 'es-MX', timezoneId: 'America/Mexico_City' });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.__ss = { get: async (k) => localStorage.getItem('ss:' + k), set: async (v, k) => { localStorage.setItem('ss:' + k, v); }, del: async (k) => { localStorage.removeItem('ss:' + k); } }; });
    page.errs = []; page.reqs = [];
    page.on('pageerror', (e) => { page.errs.push(e.message); allErrors.push('pageerror: ' + e.message); });
    page.on('console', (m) => { if (m.type() === 'error') { page.errs.push(m.text()); allErrors.push('console: ' + m.text().slice(0, 160)); } });
    page.on('request', (r) => { if (r.url().includes(':3711')) page.reqs.push(`${r.method()} ${r.url().replace(API, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => m.slice(0, 4))} key=${(r.headers()['idempotency-key'] || '-').slice(0, 8)}`); });
    page.btn = (name) => page.getByRole('button', { name, exact: false }).first();
    page.shot = async (state, ref, masks = []) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${state}.png`, mask: masks.map((m) => page.locator(m)), maskColor: '#172b4d' });
      const text = await page.evaluate(() => document.body.innerText);
      fs.writeFileSync(`${OUT}/${state}.txt`, text);
      const bad = /undefined|NaN|Invalid Date/.test(text);
      log(`SHOT ${state} ref=${ref} badText=${bad}`);
      return text;
    };
    page.setViewport = (ref) => page.setViewportSize({ width: 390, height: heightFor(ref) });
    return page;
  }
  async function login(page, email = seed.ana.email) {
    await page.goto(APP); await page.waitForTimeout(1500);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(seed.password);
    await page.btn('Iniciar sesión').click(); await page.waitForTimeout(2500);
  }
  async function toDetails(page, beneficiary, origin = /Cuenta principal/) {
    await page.getByRole('button', { name: origin }).first().click(); await page.waitForTimeout(400);
    await page.getByLabel('Elegir beneficiario').click(); await page.waitForTimeout(1200);
    await page.getByLabel(new RegExp(`^Seleccionar ${beneficiary}`)).first().click(); await page.waitForTimeout(400);
    await page.btn('Continuar con transferencia').click(); await page.waitForTimeout(1200);
  }
  async function fill(page, amount, concept, ref) {
    await page.getByLabel('Importe').fill(amount); await page.getByLabel('Concepto').fill(concept); await page.getByLabel('Referencia').fill(ref);
    await page.waitForTimeout(300);
  }
  const otpMask = ['text=/Código asignado para esta prueba/'];

  // ---------- M01
  let p = await newPage('m01_iniciar_sesi_n_2');
  await p.goto(APP); await p.waitForTimeout(1500);
  await p.shot('M01-login', 'm01_iniciar_sesi_n_2');
  await p.getByLabel('Correo electrónico').fill(seed.ana.email); await p.getByLabel('Contraseña', { exact: true }).fill('incorrecta-de-prueba');
  await p.btn('Iniciar sesión').click(); await p.waitForTimeout(1500);
  await p.setViewport('m01_iniciar_sesi_n_1');
  await p.shot('M01-error-credenciales', 'm01_iniciar_sesi_n_1', ['input']);
  await p.route('**/v1/auth/login', (r) => r.abort('failed'));
  await p.btn('Iniciar sesión').click(); await p.waitForTimeout(1200);
  await p.shot('M01-error-sin-red', 'm01_iniciar_sesi_n_1', ['input']);
  await p.context().close();

  // ---------- M02 / M03 / M04
  p = await newPage('m02_inicio_y_cuentas'); await login(p);
  await p.shot('M02-inicio', 'm02_inicio_y_cuentas');
  await p.setViewport('m03_ltimos_20_movimientos');
  await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1500);
  await p.shot('M03-movimientos', 'm03_ltimos_20_movimientos');
  await p.setViewport('m04_detalle_de_movimiento');
  await p.getByRole('button', { name: /^Cargo \$850\.00/ }).first().click(); await p.waitForTimeout(1500);
  const m04sent = await p.shot('M04-detalle-enviada', 'm04_detalle_de_movimiento');
  await p.btn('Volver a movimientos').click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: /^Abono \$1,000\.00/ }).first().click(); await p.waitForTimeout(1200);
  const m04recv = await p.shot('M04-detalle-recibida', 'm04_detalle_de_movimiento');
  log('M04 sent has Para/Enviada/-$850.00:', /Para/.test(m04sent) && /Enviada/.test(m04sent) && /-\$850\.00/.test(m04sent), '| received has De/Recibida/+$1,000.00/Carlos:', /\bDe\b/.test(m04recv) && /Recibida/.test(m04recv) && /\+\$1,000\.00/.test(m04recv) && /Carlos Ruiz/.test(m04recv));
  log('M04 reqs (no GET for received):', p.reqs.filter((r) => r.includes('/transfers/')).join(' | '));
  await p.context().close();

  // ---------- M05 (Principal: both available) and Ahorro (own destination disabled)
  p = await newPage('m05_elegir_beneficiario_2'); await login(p);
  await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1500);
  await p.shot('M05-beneficiarios', 'm05_elegir_beneficiario_2');
  await p.getByLabel('Volver a inicio').click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: /^Ahorro/ }).first().click(); await p.waitForTimeout(500);
  await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1500);
  await p.setViewport('m05_elegir_beneficiario_1');
  const m05own = await p.shot('M05-origen-ahorro-destino-incompatible', 'm05_elegir_beneficiario_1');
  const ownDisabled = await p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().getAttribute('aria-disabled');
  log('M05 Ahorro: own beneficiary aria-disabled=', ownDisabled, '| explained:', /Es tu cuenta de origen/.test(m05own));
  // ---------- M06 invalid combination (Ahorro -> own Ahorro) by changing origin after choosing destination
  await p.getByLabel('Volver a inicio').click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Cuenta principal/ }).first().click(); await p.waitForTimeout(400);
  await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1200);
  await p.getByLabel(/^Seleccionar Cuenta de ahorro demo/).first().click(); await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Ahorro/ }).first().click(); await p.waitForTimeout(400);
  await p.btn('Continuar con transferencia').click(); await p.waitForTimeout(1200);
  await fill(p, '100', 'Ahorro', '1546');
  await p.setViewport('m06_datos_de_transferencia');
  const m06bad = await p.shot('M06-origen-igual-destino', 'm06_datos_de_transferencia');
  const contDisabled = await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).getAttribute('aria-disabled');
  log('M06 same-account: blocked=', contDisabled, '| message:', /misma cuenta/.test(m06bad), '| estimate shown:', /Saldo posterior estimado/.test(m06bad));
  await p.getByLabel('Cambiar cuenta de origen').click(); await p.waitForTimeout(400);
  await p.shot('M06-selector-origen', 'm06_datos_de_transferencia');
  await p.getByLabel(/^Usar Cuenta principal/).click(); await p.waitForTimeout(400);
  log('M06 after Principal: blocked=', await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).getAttribute('aria-disabled'));
  log('M06 POSTs to /transfers so far:', p.reqs.filter((r) => r.startsWith('POST /transfers')).length);
  await p.context().close();

  // ---------- M06 / M07 / M10: Principal -> Ahorro $1,500 (own accounts) with exact DB checks
  const before = balances();
  const totalBefore = psql(`select sum(a.balance_minor) from accounts a join users u on u.id=a.owner_id where u.email='${seed.ana.email}'`);
  p = await newPage('m06_datos_de_transferencia'); await login(p);
  await toDetails(p, 'Cuenta de ahorro demo');
  await fill(p, '1500', 'Traspaso ahorro', '774411');
  await p.shot('M06-datos-propias', 'm06_datos_de_transferencia');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(800);
  await p.setViewport('m07_revisar_transferencia_2');
  await p.shot('M07-revision-propias', 'm07_revisar_transferencia_2');
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  await p.setViewport('m10_transferencia_completada_2');
  const receipt = await p.shot('M10-comprobante-propias', 'm10_transferencia_completada_2');
  const after = balances();
  const totalAfter = psql(`select sum(a.balance_minor) from accounts a join users u on u.id=a.owner_id where u.email='${seed.ana.email}'`);
  const ledger = psql(`select coalesce(sum(le.signed_amount_minor),0)||'/'||count(*) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id join users u on u.id=t.owner_id where u.email='${seed.ana.email}' and t.reference='774411'`);
  log('E2E Principal->Ahorro 1500: before', before, '| after', after, '| total', totalBefore, '->', totalAfter, '| ledger sum/count', ledger, '| transfers', transfersByRef('774411'));
  await p.btn('Ver últimos movimientos').click(); await p.waitForTimeout(1500);
  const hist = await p.evaluate(() => document.body.innerText);
  log('History shows Traspaso a Cuenta de ahorro demo -$1,500.00:', /Traspaso a Cuenta de ahorro demo/.test(hist) && /-\$1,500\.00/.test(hist), '| receipt shows -$1,500.00:', /-\$1,500\.00/.test(receipt));
  await p.context().close();

  // ---------- M06 / M07 $850 to Carlos (reference composition)
  p = await newPage('m06_datos_de_transferencia'); await login(p);
  await toDetails(p, 'Carlos');
  await fill(p, '850.00', 'Comida', '131126');
  await p.shot('M06-datos', 'm06_datos_de_transferencia');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(800);
  await p.setViewport('m07_revisar_transferencia_2');
  await p.shot('M07-revision', 'm07_revisar_transferencia_2');
  // M09 Enviando: hold the request for 2.5 s, then let it through.
  await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') { await new Promise((r) => setTimeout(r, 2500)); await route.continue(); } else await route.continue(); });
  await p.setViewport('m09_procesando_y_recuperaci_n_1');
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(700);
  const sending = await p.shot('M09-enviando', 'm09_procesando_y_recuperaci_n_1');
  log('M09 sending neutral:', /Enviando transferencia/.test(sending) && !/Verificando|Protección contra duplicados|No intentes/.test(sending));
  await p.waitForTimeout(3500);
  await p.setViewport('m10_transferencia_completada_1');
  await p.shot('M10-comprobante', 'm10_transferencia_completada_1');
  await p.context().close();

  // ---------- M09 uncertain: response lost after the server committed; verify with the SAME key; reload mid-way
  p = await newPage('m09_procesando_y_recuperaci_n_2'); await login(p);
  await toDetails(p, 'Carlos');
  await fill(p, '120', 'Libros', '552211');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(800);
  let lose = true;
  await p.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST' && lose) { await route.fetch(); await route.abort('failed'); } else await route.continue(); });
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(2500);
  await p.shot('M09-verificando', 'm09_procesando_y_recuperaci_n_2');
  log('M09 DB after lost response:', transfersByRef('552211'));
  // re-entry: reload the app (same browser storage) while the outcome is unknown
  await p.reload(); await p.waitForTimeout(3500);
  const reentry = await p.evaluate(() => document.body.innerText);
  log('Reentry after reload resumed to:', /Transferencia completada/.test(reentry) ? 'receipt' : /verificando/.test(reentry) ? 'verifying' : reentry.slice(0, 120).replace(/\n/g, ' | '));
  lose = false;
  if (/verificando/i.test(reentry)) { await p.btn('Verificar estado de la transferencia').click(); await p.waitForTimeout(2500); }
  const keysUsed = [...new Set(p.reqs.filter((r) => r.startsWith('POST /transfers ')).map((r) => r.split('key=')[1]))];
  log('M09 POST /transfers keys used:', keysUsed.join(','), '| DB rows:', transfersByRef('552211'));
  await p.context().close();

  // ---------- M07 threshold variant, M08 OTP (empty, typed, countdown, expired via clock), new code = cancel + new key
  p = await newPage('m07_revisar_transferencia_6_000_mxn_verificaci_n');
  await p.clock.install();
  await login(p);
  await toDetails(p, 'Carlos');
  await fill(p, '6000', 'Comida', '131126');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(1200);
  await p.shot('M07-revision-umbral', 'm07_revisar_transferencia_6_000_mxn_verificaci_n');
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  await p.setViewport('m08_c_digo_de_confirmaci_n_2');
  await p.shot('M08-codigo-vacio', 'm08_c_digo_de_confirmaci_n_2', otpMask);
  const code = ((await p.evaluate(() => document.body.innerText)).match(/prueba: (\d{6})/) || [])[1];
  await p.getByLabel('Código de confirmación').fill(code || '000000');
  await p.setViewport('m08_c_digo_de_confirmaci_n_c_digo_vigente');
  await p.shot('M08-codigo-vigente', 'm08_c_digo_de_confirmaci_n_c_digo_vigente', otpMask);
  const firstId = psql(`select t.id from transfers t join users u on u.id=t.owner_id where u.email='${seed.ana.email}' and t.amount_minor=600000 and t.status='awaiting_confirmation' order by t.created_at desc limit 1`);
  await p.clock.fastForward('05:05');
  psql(`update otp_challenges set expires_at=now() - interval '1 second' where transfer_id='${firstId}'`);
  await p.waitForTimeout(1500);
  await p.setViewport('m08_c_digo_de_confirmaci_n_c_digo_expirado');
  const expired = await p.shot('M08-codigo-expirado', 'm08_c_digo_de_confirmaci_n_c_digo_expirado', otpMask);
  log('M08 expired banner:', /El código ha expirado/.test(expired));
  await p.btn('Solicitar nuevo código').click(); await p.waitForTimeout(3000);
  log('M08 new code reqs:', p.reqs.filter((r) => /POST \/transfers/.test(r)).join(' | '));
  log('M08 DB after new code (first must be expired/cancelled, second pending):', psql(`select status from transfers where id='${firstId}'`), '|', transfersByRef('131126'));
  // leave the code step: G cancels the pending attempt
  await p.btn('Cancelar y volver a revisar').click(); await p.waitForTimeout(1500);
  log('G leave OTP -> DB:', transfersByRef('131126'), '| cancel reqs:', p.reqs.filter((r) => r.includes('/cancel')).length);
  await p.context().close();

  // ---------- Closed (expired) after relaunch with a pending attempt that expired server-side
  p = await newPage('m11_transferencia_rechazada'); await login(p);
  await toDetails(p, 'Carlos');
  await fill(p, '6000', 'Comida', '131127');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(800);
  await p.btn('Continuar a verificación').click(); await p.waitForTimeout(2500);
  const pendingId = psql(`select t.id from transfers t join users u on u.id=t.owner_id where u.email='${seed.ana.email}' and t.reference='131127' order by t.created_at desc limit 1`);
  psql(`update otp_challenges set expires_at=now() - interval '1 second' where transfer_id='${pendingId}'`);
  await p.reload(); await p.waitForTimeout(3500);
  const closed = await p.shot('M11-intento-expirado', 'm11_transferencia_rechazada');
  log('Closed after relaunch:', /expiró/.test(closed), '| DB:', psql(`select status from transfers where id='${pendingId}'`));
  await p.context().close();

  // ---------- M11 real rejection: balance spent from another session after the app read it
  p = await newPage('m11_transferencia_rechazada'); await login(p);
  await toDetails(p, 'Carlos');
  await fill(p, '4000', 'Renta', '778899');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(800);
  const token = await apiLogin(seed.ana.email);
  const accs = (await apiCall(token, '/accounts')).body.items;
  const main = accs.find((a) => a.kind === 'checking');
  // Leave $1,000.00 using amounts below the demo OTP threshold (each one completes immediately).
  let left = BigInt(main.availableBalanceMinor) - 100000n; const spent = [];
  while (left > 0n) { const chunk = left > 400000n ? 400000n : left; const moved = await apiCall(token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceAccountId: main.id, destinationType: 'beneficiary', beneficiaryId: seed.ownBeneficiaryId, amountMinor: chunk.toString(), concept: 'Ajuste prueba', reference: '1' }) }); spent.push(`${chunk}:${moved.status}`); left -= chunk; }
  log('Out-of-band spend (another session, same user):', spent.join(' '), '| balances now', balances());
  await p.btn(/Confirmar transferencia|Continuar a verificación/).click(); await p.waitForTimeout(2500);
  const rejected = await p.shot('M11-rechazada-saldo', 'm11_transferencia_rechazada');
  log('M11 real 422:', rejected.split('\n').filter(Boolean).slice(0, 8).join(' | '));
  await p.btn('Modificar monto o cuenta').click(); await p.waitForTimeout(1200);
  const edit = await p.evaluate(() => document.body.innerText);
  log('M11 -> edit keeps data:', /Renta/.test(await p.getByLabel('Concepto').inputValue()) && (await p.getByLabel('Importe').inputValue()) === '4000', '| on details:', /Datos de la operación/.test(edit));
  await p.context().close();

  // ---------- M12 privacy curtain (visibilitychange) and session-expired notice (401 on refresh, simulated)
  p = await newPage('m12_privacidad_en_segundo_plano'); await login(p);
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(800);
  const curtain = await p.shot('M12-privacidad', 'm12_privacidad_en_segundo_plano');
  log('M12 curtain hides balances:', !/\$\d/.test(curtain));
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(800);
  await p.route('**/v1/accounts', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
  await p.route('**/v1/auth/refresh', (r) => r.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Unauthorized', status: 401 }) }));
  await p.getByLabel('Actualizar cuentas').click(); await p.waitForTimeout(2500);
  await p.setViewport('m12_privacidad_y_sesi_n');
  await p.shot('M12-sesion-vencida', 'm12_privacidad_y_sesi_n');
  await p.context().close();

  // ---------- M05 empty (fresh user without beneficiaries)
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: 'http://localhost:8711' } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrf.json();
  const emptyEmail = `luis.g2.${seed.run}.${Date.now() % 100000}@example.test`;
  await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: 'http://localhost:8711', cookie }, body: JSON.stringify({ fullName: 'Luis Prueba', email: emptyEmail, password: seed.password }) });
  p = await newPage('m05_elegir_beneficiario_1'); await login(p, emptyEmail);
  await p.getByLabel('Elegir beneficiario').click(); await p.waitForTimeout(1500);
  await p.shot('M05-vacio', 'm05_elegir_beneficiario_1');
  await p.context().close();

  // ---------- fontScale-like check: 130 % text on M06 and M08 (CSS approximation, not native fontScale)
  p = await newPage('m06_datos_de_transferencia'); await login(p);
  await toDetails(p, 'Carlos');
  await fill(p, '850', 'Pago de servicios del departamento', '131126');
  await p.evaluate(() => document.querySelectorAll('div,span,input').forEach((e) => { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs) e.style.fontSize = `${fs * 1.3}px`; const lh = parseFloat(getComputedStyle(e).lineHeight); if (lh) e.style.lineHeight = `${lh * 1.3}px`; }));
  await p.waitForTimeout(500);
  await p.shot('I-texto-130-M06', 'm06_datos_de_transferencia');
  const box = await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).boundingBox();
  log('I 130% M06 Continuar visible in viewport:', Boolean(box && box.y + box.height <= heightFor('m06_datos_de_transferencia')));
  // keyboard-open approximation: shrink the viewport by a typical iOS keyboard (336 px) and check the footer button
  await p.setViewportSize({ width: 390, height: heightFor('m06_datos_de_transferencia') - 336 });
  await p.waitForTimeout(500);
  await p.shot('I-viewport-reducido-M06', 'm06_datos_de_transferencia');
  const box2 = await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).boundingBox();
  log('I reduced viewport M06 Continuar visible:', Boolean(box2 && box2.y + box2.height <= heightFor('m06_datos_de_transferencia') - 336));
  await p.context().close();

  log('console/page errors:', allErrors.length, allErrors.slice(0, 12).join(' || ')); log('final balances', balances());
  fs.writeFileSync(`${OUT}/runlog.txt`, logLines.join('\n') + '\n');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); fs.writeFileSync(`${OUT}/runlog.txt`, logLines.join('\n') + '\nFAIL ' + e.stack + '\n'); process.exit(1); });
