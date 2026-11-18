import { expect, request as playwrightRequest, test } from '@playwright/test';
import { Client } from 'pg';
import { assertSafeTestDatabase } from '../../api/src/db/test-database-guard.js';

async function capture(page: import('@playwright/test').Page, name: string, fullPage = false) {
  await page.screenshot({
    path: `test-results/visual/${name}-${page.viewportSize()?.width ?? 'full'}.png`,
    fullPage,
    mask: [
      page.locator('input:not(.otp-input)'),
      page.locator('select'),
      ...Array.from({ length: 6 }, (_, index) => page.locator('.otp-box').nth(index)),
      page.locator('[data-sensitive]'),
      page.locator('.masked-clabe, .notice strong, dt:has-text("Folio interno") + dd, dt:has-text("Referencia") + dd'),
      page.locator('.balance-value, .account-balance, .consolidated-balance strong, .amount-debit, .amount-credit, dt:has-text("Importe") + dd, .receipt-amount strong'),
    ],
    maskColor: '#172b4d',
  });
}

async function captureAfterScrollIfOutsideViewport(page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, name: string) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport || (box.y >= 0 && box.y + box.height <= viewport.height)) return;
  await locator.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/visual/${name}-${viewport.width}-scroll.png`,
    fullPage: false,
    mask: [
      page.locator('input:not(.otp-input)'),
      page.locator('select'),
      ...Array.from({ length: 6 }, (_, index) => page.locator('.otp-box').nth(index)),
      page.locator('[data-sensitive]'),
      page.locator('.masked-clabe, .notice strong, dt:has-text("Folio interno") + dd, dt:has-text("Referencia") + dd'),
      page.locator('.balance-value, .account-balance, .amount-debit, .amount-credit, dt:has-text("Importe") + dd, .receipt-amount strong'),
    ],
    maskColor: '#172b4d',
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

test('login and registration screens render responsively without browser errors @visual', async ({ page }) => {
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page).toHaveTitle('Billetera — Tus cuentas');
  await expect(page.getByRole('heading', { name: 'Qué gusto verte.' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await page.screenshot({ path: 'test-results/visual/web-login-mobile-390.png', fullPage: false });
  await page.getByRole('link', { name: 'Regístrate' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza por aquí.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/visual/web-register-mobile-390.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('.auth-page-centered')).toBeVisible();
  await expect(page.getByRole('button', { name: /Crear cuenta/ })).toBeVisible();
  await capture(page, 'W02-registro');
  await page.getByRole('link', { name: 'Inicia sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Qué gusto verte.' })).toBeVisible();
  await capture(page, 'W01-login');
  expect(consoleErrors).toEqual([]);
});

test('a browser without a refresh cookie sees the real login and registration screens @visual', async ({ page }) => {
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Qué gusto verte.' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await page.getByRole('link', { name: 'Regístrate' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza por aquí.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Crear cuenta/ })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('W10 OTP screen captures six separately masked cells at responsive widths @visual', async ({ page }) => {
  const unique = crypto.randomUUID();
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('OTP Visual QA');
  await page.getByLabel('Correo electrónico').fill(`otp-visual-${unique}@example.test`);
  await page.getByLabel('Crea una contraseña').fill(`Local-test-${unique}-Aa1`);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  const transferId = crypto.randomUUID();
  const sourceAccountId = crypto.randomUUID();
  const destinationAccountId = crypto.randomUUID();
  await page.route('**/v1/transfers', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({
      id: transferId,
      status: 'awaiting_confirmation',
      sourceAccountId,
      destination: { id: destinationAccountId, name: 'Cuenta de prueba', kind: 'savings', currency: 'MXN', availableBalanceMinor: '0', clabeMasked: '••••1234' },
      amountMinor: '1', currency: 'MXN', concept: 'Captura OTP', reference: '1', createdAt: new Date().toISOString(), demoOnlyCode: '419682',
    }) })
    : route.continue());

  await page.locator('.welcome-row').getByRole('link', { name: /Transferir/ }).click();
  await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
  await page.getByLabel('Cuenta de origen').selectOption({ index: 1 });
  await page.getByLabel('Cuenta de destino').selectOption({ index: 2 });
  await page.getByLabel('Importe en MXN').fill('0.01');
  await page.getByLabel('Concepto').fill('Captura OTP');
  await page.getByLabel('Referencia numérica').fill('104201');
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await page.getByRole('button', { name: /Enviar transferencia/ }).click();

  const otpInput = page.getByLabel('Código de confirmación de 6 dígitos');
  await expect(otpInput).toBeVisible();
  await otpInput.fill('419682');
  await expect(page.locator('.otp-box')).toHaveCount(6);
  await expect(page.locator('.otp-box.filled')).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W10-otp');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W10-otp');
});

test('an expired authenticated session shows the real session-expired screen responsively @visual', async ({ page }) => {
  // Create a real synthetic owner in wallet_test, then expire its browser cookie while retaining same-tab recovery.
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  const unique = crypto.randomUUID();
  const userEmail = `session-recovery-${unique}@example.test`;
  const userPassword = `Local-test-${unique}-Aa1`;
  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('Session Recovery QA');
  await page.getByLabel('Correo electrónico').fill(userEmail);
  await page.getByLabel('Crea una contraseña').fill(userPassword);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  const recoveryUserId = await page.evaluate(() => sessionStorage.getItem('wallet:web:active-user'));
  expect(Boolean(recoveryUserId && /^[0-9a-f-]{36}$/i.test(recoveryUserId))).toBeTruthy();
  await page.context().clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/session-expired');
  await expect(page).toHaveURL(/\/session-expired$/);
  await expect(page.getByRole('heading', { name: 'Tu sesión venció' })).toBeVisible();
  await capture(page, 'W14-session-expired');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W14-session-expired');
  const recoveryKey = crypto.randomUUID();
  const recoveryTransferId = crypto.randomUUID();
  const recoveryBody = {
    sourceAccountId: crypto.randomUUID(), destinationType: 'beneficiary', beneficiaryId: crypto.randomUUID(),
    amountMinor: '123456', concept: 'Contexto visual', reference: '1234',
  };
  await page.evaluate(({ userId, key, body }) => {
    sessionStorage.setItem(`wallet:web:transfer-attempt:${userId}`, JSON.stringify({ key, body }));
  }, { userId: recoveryUserId!, key: recoveryKey, body: recoveryBody });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Transferencia pendiente' })).toBeVisible();
  await expect(page.getByText('No se muestran datos de autenticación ni identificadores del intento.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W14-session-expired-pending');
  await captureAfterScrollIfOutsideViewport(page, page.locator('.session-pending-card'), 'W14-session-expired-pending-context');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W14-session-expired-pending');
  await page.getByRole('link', { name: 'Iniciar sesión y recuperar intento' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(({ userId, key }) => sessionStorage.getItem(`wallet:web:transfer-attempt:${userId}`)?.includes(key), { userId: recoveryUserId, key: recoveryKey })).toBeTruthy();
  let recoveredKey = '';
  let recoveredBody = '';
  await page.route('**/v1/transfers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    recoveredKey = route.request().headers()['idempotency-key'] ?? '';
    recoveredBody = route.request().postData() ?? '';
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({
      id: recoveryTransferId, status: 'awaiting_confirmation', sourceAccountId: recoveryBody.sourceAccountId,
      destination: { id: recoveryBody.beneficiaryId, name: 'Beneficiario visual', alias: 'Visual', destinationAccountId: recoveryBody.beneficiaryId, clabeMasked: '••••1234' },
      amountMinor: recoveryBody.amountMinor, currency: 'MXN', concept: recoveryBody.concept, reference: recoveryBody.reference, createdAt: new Date().toISOString(),
    }) });
  });
  await page.getByLabel('Correo electrónico').fill(userEmail);
  await page.getByLabel('Contraseña').fill(userPassword);
  await page.getByRole('button', { name: /Iniciar sesión/ }).click();
  await expect(page).toHaveURL(new RegExp(`/transfers/${recoveryTransferId}/status$`), { timeout: 15_000 });
  expect(recoveredKey === recoveryKey).toBeTruthy();
  expect(recoveredBody === JSON.stringify(recoveryBody)).toBeTruthy();
  await expect(page.getByLabel('Código de confirmación de 6 dígitos')).toBeVisible();
  await page.goto('/access-denied');
  await expect(page.getByRole('heading', { name: 'Acceso no disponible' })).toBeVisible();
  await expect(page.getByText('No tienes permiso para consultar esta sección o el enlace no es válido.')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W14-access-denied');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('link', { name: /Volver al inicio/ })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Billetera, inicio' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /Volver al inicio/ })).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W14-access-denied');
});

test('registers, logs in and reads only accounts returned by the API', async ({ page }) => {
  const email = `web-${crypto.randomUUID()}@example.test`;
  const password = `Local-test-${crypto.randomUUID()}-Aa1`;
  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('Web QA User');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Crea una contraseña').fill(password);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: /Hola, Web/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tus cuentas' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Saldo consolidado' })).toBeVisible();
  const consolidatedBalance = page.getByRole('region', { name: 'Saldo consolidado' });
  await expect(page.getByLabel(/pesos mexicanos$/)).toBeVisible();
  await expect(consolidatedBalance.locator('strong')).toHaveText(/MXN$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W03-cuentas');
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('region', { name: 'Actividad reciente' }), 'W03-actividad-reciente');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W03-cuentas');

  await page.evaluate(() => {
    const userId = sessionStorage.getItem('wallet:web:active-user');
    if (!userId) throw new Error('Authenticated user scope missing');
    sessionStorage.setItem(`wallet:web:transfer-attempt:${userId}`, JSON.stringify({ key: 'logout-pending-key', body: { destinationType: 'own_account' } }));
  });
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('wallet:web:transfer-attempt:')))).toBeFalsy();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /Iniciar sesión/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: /Hola, Web/ })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: /Hola, Web/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tus cuentas' })).toBeVisible({ timeout: 15_000 });
  // A real backend session is restored from its HttpOnly cookie after reload.
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(['wallet:web:active-user']);
  await page.evaluate(() => {
    sessionStorage.setItem('wallet:web:active-user', 'different-user-scope');
    sessionStorage.setItem('wallet:web:transfer-attempt:different-user-scope', JSON.stringify({ key: 'other-user-key', body: { destinationType: 'own_account' } }));
  });
  await page.reload();
  await expect(page).toHaveURL(/\/accounts$/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('wallet:web:transfer-attempt:')))).toBeFalsy();
});

test('registers a real internal beneficiary and displays only a masked CLABE', async ({ page }) => {
  const unique = crypto.randomUUID();
  const destinationEmail = `destination-${unique}@example.test`;
  const destinationPassword = `Local-test-${unique}-Aa1`;
  const ownerEmail = `owner-${unique}@example.test`;
  const ownerPassword = `Local-test-${unique}-Aa1`;
  const apiBase = 'http://127.0.0.1:3100';
  const origin = 'http://127.0.0.1:5174';
  const destinationApi = await playwrightRequest.newContext({ baseURL: apiBase, extraHTTPHeaders: { Origin: origin } });
  let destinationClabe = '';

  try {
    const csrfResponse = await destinationApi.get('v1/auth/csrf');
    expect(csrfResponse.ok()).toBeTruthy();
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const registrationResponse = await destinationApi.post('v1/auth/register', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { fullName: 'Beneficiary Destination', email: destinationEmail, password: destinationPassword },
    });
    expect(registrationResponse.status()).toBe(201);
    const destinationSession = await registrationResponse.json() as { accessToken: string };
    const accountsResponse = await destinationApi.get('v1/accounts', {
      headers: { Authorization: `Bearer ${destinationSession.accessToken}` },
    });
    expect(accountsResponse.ok()).toBeTruthy();
    const destinationAccounts = await accountsResponse.json() as { items: Array<{ clabe: string }> };
    destinationClabe = destinationAccounts.items[0].clabe;
    expect(destinationClabe).toMatch(/^\d{18}$/);
  } finally {
    await destinationApi.dispose();
  }

  // This flow tests beneficiary creation, not the empty-session refresh probe; preserve auth limiter capacity for its real registration.
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('Beneficiary Owner');
  await page.getByLabel('Correo electrónico').fill(ownerEmail);
  await page.getByLabel('Crea una contraseña').fill(ownerPassword);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.getByRole('link', { name: 'Beneficiarios' }).click();
  await expect(page.getByRole('heading', { name: 'Beneficiarios', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W06-beneficiarios-vacio');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W06-beneficiarios-vacio');
  await page.locator('a.primary-button[href="/beneficiaries/new"]').click();
  await expect(page.getByRole('heading', { name: 'Agregar beneficiario' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W07-alta');
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('button', { name: /Guardar beneficiario/ }), 'W07-acciones');
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('complementary', { name: 'Vista previa del beneficiario' }), 'W07-preview');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W07-alta');

  await page.getByLabel('Nombre del beneficiario').fill('Beneficiary Destination');
  await page.getByLabel('Alias').fill('Cuenta de prueba');
  await page.getByLabel('CLABE interbancaria').fill('002010077777777770');
  await page.getByRole('button', { name: /Guardar beneficiario/ }).click();
  await expect(page.getByText('CLABE inválida.')).toBeVisible();
  await expect(page).toHaveURL(/\/beneficiaries\/new$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W07-error');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W07-error');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByLabel('CLABE interbancaria').fill(destinationClabe);
  await page.getByRole('button', { name: /Guardar beneficiario/ }).click();
  await expect(page).toHaveURL(/\/beneficiaries$/);
  await expect(page.getByText(/agregado correctamente/i)).toBeVisible();
  const beneficiaryCard = page.getByRole('region', { name: 'Tus beneficiarios' });
  await expect(beneficiaryCard.getByRole('heading', { name: 'Beneficiary Destination' })).toBeVisible();
  const maskedClabe = destinationClabe.replace(/^(\d{3})\d{11}(\d{4})$/, '$1•••••••••••$2');
  await expect(beneficiaryCard.getByText(`CLABE · ${maskedClabe}`)).toBeVisible();
  await expect(beneficiaryCard.getByText(destinationClabe, { exact: true })).toHaveCount(0);
  await expect(page.getByText(destinationClabe, { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W06-beneficiarios-listado');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W06-beneficiarios-listado');
});

test('retries an uncertain real transfer with identical idempotency key and shows one receipt', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    // The deliberately aborted POST and unauthenticated bootstrap probes are expected browser diagnostics.
    if (message.type() === 'error' && message.text() !== 'Failed to load resource: net::ERR_FAILED' && !/status of 401 \(Unauthorized\)/.test(message.text())) browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  const emptyRefreshProbe = (route: import('@playwright/test').Route) => route.fulfill({ status: 204 });
  await page.route('**/auth/refresh', emptyRefreshProbe);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflowPages: string[] = [];
  const expectNoHorizontalOverflow = async () => {
    const dimensions = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll('body *')].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > viewportWidth + 1 ? [{ tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className : '', left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }] : [];
      });
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: viewportWidth, offenders };
    });
    if (dimensions.scrollWidth > dimensions.clientWidth) overflowPages.push(`${new URL(page.url()).pathname}: ${dimensions.scrollWidth} > ${dimensions.clientWidth}; ${JSON.stringify(dimensions.offenders)}`);
  };

  const unique = crypto.randomUUID();
  const apiBase = 'http://127.0.0.1:3100';
  const origin = 'http://127.0.0.1:5174';
  const api = await playwrightRequest.newContext({ baseURL: apiBase, extraHTTPHeaders: { Origin: origin } });
  const destinationEmail = `destination-${unique}@example.test`;
  const destinationPassword = `Local-test-${unique}-Aa1`;
  const ownerEmail = `owner-${unique}@example.test`;
  const ownerPassword = `Local-test-${unique}-Aa1`;
  let sourceBalance = 0n;
  let sourceAccountId = '';
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname !== '/v1/accounts' || !response.ok()) return;
    try {
      const data = await response.json() as { items: Array<{ id: string; availableBalanceMinor: string }> };
      if (data.items[0]) {
        sourceBalance = BigInt(data.items[0].availableBalanceMinor);
        sourceAccountId = data.items[0].id;
      }
    } catch { /* Ignore unrelated/non-JSON responses. */ }
  });
  let destinationClabe = '';
  try {
    const csrf = await api.get('v1/auth/csrf');
    expect(csrf.ok()).toBeTruthy();
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const registration = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrfToken }, data: { fullName: 'Transfer Destination', email: destinationEmail, password: destinationPassword } });
    expect(registration.status()).toBe(201);
    const { accessToken } = await registration.json() as { accessToken: string };
    const accountResponse = await api.get('v1/accounts', { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(accountResponse.ok()).toBeTruthy();
    const destinationAccounts = await accountResponse.json() as { items: Array<{ clabe: string }> };
    destinationClabe = destinationAccounts.items[0].clabe;
    expect(destinationClabe).toMatch(/^\d{18}$/);
  } finally {
    await api.dispose();
  }

  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('Transfer Owner');
  await page.getByLabel('Correo electrónico').fill(ownerEmail);
  await page.getByLabel('Crea una contraseña').fill(ownerPassword);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // Read the real source balance through the authenticated UI session without exposing financial values.
  await expect.poll(() => sourceBalance > 1n).toBeTruthy();

  await page.getByRole('link', { name: 'Beneficiarios' }).click();
  await expect(page.getByRole('heading', { name: 'Beneficiarios', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow();
  await page.locator('a.primary-button[href="/beneficiaries/new"]').click();
  await expect(page.getByRole('heading', { name: 'Agregar beneficiario' })).toBeVisible();
  await expectNoHorizontalOverflow();
  await page.getByLabel('Nombre del beneficiario').fill('Transfer Destination');
  await page.getByLabel('Alias').fill('Transfer test');
  await page.getByLabel('CLABE interbancaria').fill(destinationClabe);
  await page.getByRole('button', { name: /Guardar beneficiario/ }).click();
  await expect(page).toHaveURL(/\/beneficiaries$/);

  await page.getByRole('link', { name: 'Transferir' }).click();
  await expect(page.getByLabel('Cuenta de origen')).toBeVisible();
  await expectNoHorizontalOverflow();
  await capture(page, 'W08-formulario');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W08-formulario');
  await page.setViewportSize({ width: 390, height: 844 });
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('complementary', { name: 'Resumen de transferencia' }), 'W08-resumen');
  await page.getByLabel('Cuenta de origen').selectOption({ index: 1 });
  await page.getByLabel('Beneficiario').selectOption({ index: 1 });
  await page.getByLabel('Importe en MXN').fill('0.01');
  await page.getByLabel('Concepto').fill('Prueba idempotente');
  await page.getByLabel('Referencia numérica').fill('804201');
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'W09-review');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'W09-review');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('complementary', { name: 'Resumen de transferencia' }), 'W09-resumen');
  await expectNoHorizontalOverflow();

  const observed: Array<{ key: string | undefined; body: string; status: number; transferId: string; transfer: Record<string, unknown> }> = [];
  let confirmationResponseStatus: number | undefined;
  let confirmedStatus: string | undefined;
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname.endsWith('/confirm') && response.request().method() === 'POST') {
      confirmationResponseStatus = response.status();
      if (response.ok()) {
        try { confirmedStatus = (await response.json() as { status: string }).status; } catch { /* Ignore unrelated/non-JSON responses. */ }
      }
    }
  });
  await page.route('**/v1/transfers', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const transfer = await response.json() as Record<string, unknown>;
    observed.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() ?? '', status: response.status(), transferId: String(transfer.id), transfer });
    if (observed.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: /Enviar transferencia/ }).click();
  await expect(page.getByRole('heading', { name: 'Estamos verificando el resultado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu envío sigue en verificación' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'W11-resultado-incierto', false);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'W11-resultado-incierto', false);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('complementary', { name: 'Datos del mismo intento pendiente' }), 'W11-datos-intento');
  // A full reload must recover the exact persisted attempt; the first POST was committed server-side.
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'wallet_refresh')).toBeTruthy();
  await page.unroute('**/auth/refresh', emptyRefreshProbe);
  await page.reload();
  await expect(page).toHaveURL(/\/(?:login|transfers\/new)$/);
  if (new URL(page.url()).pathname === '/login') {
    await page.getByLabel('Correo electrónico').fill(ownerEmail);
    await page.getByLabel('Contraseña').fill(ownerPassword);
    await page.getByRole('button', { name: /Iniciar sesión/ }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await page.goto('/transfers/new');
  }
  await expect(page).toHaveURL(/\/transfers\/[^/]+\/status$/, { timeout: 15_000 });
  await expect.poll(() => observed.length).toBe(2);
  expect(observed[0].key).toBeTruthy();
  expect(observed[1].key).toBe(observed[0].key);
  expect(observed[1].body).toBe(observed[0].body);
  expect(observed.map((item) => item.transferId)).toEqual([observed[0].transferId, observed[0].transferId]);
  expect(observed.every((item) => item.status >= 200 && item.status < 300)).toBeTruthy();
  expect(observed[1].transfer).toEqual(observed[0].transfer);

  const transfer = observed[1].transfer as { status: string; demoOnlyCode?: string };
  if (transfer.status === 'awaiting_confirmation') {
    expect(transfer.demoOnlyCode).toBeTruthy();
    const storedAttempt = await page.evaluate(() => Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith('wallet:web:transfer-attempt:'))
      .map(([, value]) => value).join(''));
    expect(storedAttempt).toContain(observed[0].key!);
    expect(storedAttempt).toContain(observed[0].body);
    expect(storedAttempt).toContain(observed[0].transferId);
    expect(storedAttempt).not.toContain(transfer.demoOnlyCode!);
    await page.getByLabel('Código de confirmación de 6 dígitos').fill(transfer.demoOnlyCode!);
    await capture(page, 'W10-otp');
    await page.setViewportSize({ width: 1440, height: 960 });
    await capture(page, 'W10-otp');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
    await expect.poll(() => confirmationResponseStatus).toBe(200);
    await expect.poll(() => confirmedStatus).toBe('completed');
  }
  await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('wallet:web:transfer-attempt:')))).toBeFalsy();
  const receipt = page.locator('.receipt-card');
  await expect(receipt).toContainText('Prueba idempotente');
  await expect(receipt).toContainText('804201');
  await expect(receipt.locator('.receipt-status')).toHaveText('Completada');
  await capture(page, 'W12-recibo');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W12-recibo');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow();

  const transferId = observed[1].transferId;
  expect(sourceAccountId).toBeTruthy();
  const databaseUrl = assertSafeTestDatabase(process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL, process.env.DATABASE_URL).toString();
  const database = new Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const ledger = await database.query<{ transfer_count: string; posting_count: string; net: string; amount: string; statuses: string }>(
      `SELECT count(DISTINCT t.id)::text AS transfer_count, count(le.id)::text AS posting_count,
        COALESCE(sum(le.signed_amount_minor), 0)::text AS net, max(t.amount_minor)::text AS amount,
        string_agg(DISTINCT t.status, ',') AS statuses
       FROM transfers t LEFT JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id
       LEFT JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.id=$1`, [transferId],
    );
    expect(ledger.rows[0]).toMatchObject({ transfer_count: '1', posting_count: '2', net: '0', amount: '1', statuses: 'completed' });
  } finally { await database.end(); }
  await page.getByRole('link', { name: 'Volver a mis cuentas', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.locator(`.account-history-link[href="/accounts/${sourceAccountId}/movements"]`).click();
  await expect(page).toHaveURL(`/accounts/${sourceAccountId}/movements`);
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expectNoHorizontalOverflow();
  await capture(page, 'W04-historial');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W04-historial');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Tipo').selectOption('debit');
  const transferRow = page.getByRole('row').filter({ hasText: 'Prueba idempotente' });
  await expect(transferRow).toContainText('Cargo');
  await expect(transferRow).toContainText('Completado');
  await transferRow.getByRole('link', { name: 'Ver detalle' }).click();
  await expect(page).toHaveURL(new RegExp(`/transfers/${transferId}/movement-receipt$`));
  await expect(page.locator('.movement-page > h1', { hasText: 'Comprobante interno' })).toBeVisible();
  const movementReceipt = page.locator('.receipt-card');
  await expect(movementReceipt).toContainText('Prueba idempotente');
  await expect(movementReceipt).toContainText('804201');
  await expect(movementReceipt).toContainText('Completada');
  await expectNoHorizontalOverflow();
  await capture(page, 'W04-detalle');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W04-detalle');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.setViewportSize({ width: 1440, height: 960 });
  await expectNoHorizontalOverflow();
  expect(overflowPages).toEqual([]);
  expect(browserErrors).toEqual([]);
});
