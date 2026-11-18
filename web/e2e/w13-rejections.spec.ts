import { expect, test, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import { assertSafeTestDatabase } from '../../api/src/db/test-database-guard.js';

type BrowserFixture = { userId: string; accounts: Array<{ id: string; availableBalanceMinor: string }> };

async function registerSyntheticUser(page: Page, label: string): Promise<BrowserFixture> {
  const userEmail = `${label}-${crypto.randomUUID()}@example.test`;
  const userPassword = `Local-test-${crypto.randomUUID()}-Aa1`;
  const fixture: BrowserFixture = { userId: '', accounts: [] };
  page.on('response', async (response) => {
    const path = new URL(response.url()).pathname;
    if (!response.ok()) return;
    try {
      if (path === '/v1/auth/register') fixture.userId = (await response.json() as { user: { id: string } }).user.id;
      if (path === '/v1/accounts') fixture.accounts = (await response.json() as { items: BrowserFixture['accounts'] }).items;
    } catch { /* Ignore unrelated API payloads. */ }
  });
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('Visual Rejection QA');
  await page.getByLabel('Correo electrónico').fill(userEmail);
  await page.getByLabel('Crea una contraseña').fill(userPassword);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect.poll(() => fixture.accounts.length).toBeGreaterThanOrEqual(2);
  expect(fixture.userId).toMatch(/^[0-9a-f-]{36}$/i);
  return fixture;
}

async function setSyntheticUserDailyUsage(userId: string, dailyLimitMinor: string) {
  const databaseUrl = assertSafeTestDatabase(
    process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL,
    process.env.DATABASE_URL,
  ).toString();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO daily_limit_usage(owner_id,business_date,currency,outgoing_minor)
       VALUES($1,(now() AT TIME ZONE $2)::date,'MXN',$3)
       ON CONFLICT(owner_id,business_date,currency)
       DO UPDATE SET outgoing_minor=EXCLUDED.outgoing_minor`,
      [userId, process.env.BUSINESS_TIME_ZONE ?? 'America/Mexico_City', dailyLimitMinor],
    );
  } finally { await client.end(); }
}

async function openOwnTransfer(page: Page, accounts: BrowserFixture['accounts'], amount: string, reference: string) {
  await page.locator('.welcome-row').getByRole('link', { name: /Transferir/ }).click();
  await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
  await page.getByLabel('Cuenta de origen').selectOption(accounts[0]!.id);
  await page.getByLabel('Cuenta de destino').selectOption(accounts[1]!.id);
  await page.getByLabel('Importe en MXN').fill(amount);
  await page.getByLabel('Concepto').fill('Prueba visual de rechazo');
  await page.getByLabel('Referencia numérica').fill(reference);
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await page.getByRole('button', { name: /Enviar transferencia/ }).click();
}

function rejectionMasks(page: Page): Locator[] {
  return [
    page.locator('input:not(.otp-input), select'),
    ...Array.from({ length: 6 }, (_, index) => page.locator('.otp-box').nth(index)),
    page.locator('[data-sensitive]'),
    page.locator('.masked-clabe, .notice strong, dt:has-text("Folio interno") + dd, dt:has-text("Referencia") + dd'),
    page.locator('.balance-value, .account-balance, .consolidated-balance strong, .amount-debit, .amount-credit, dt:has-text("Importe") + dd, .receipt-amount strong'),
  ];
}

async function captureResponsiveRejection(page: Page, name: string) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 960 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: `test-results/visual/${name}-${viewport.width}.png`,
      fullPage: false,
      mask: rejectionMasks(page),
      maskColor: '#172b4d',
    });
  }
}

async function captureRejectionBreakdown(page: Page, name: string) {
  const viewport = { width: 390, height: 844 };
  await page.setViewportSize(viewport);
  await page.locator('.rejection-breakdown').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/visual/${name}-390-breakdown.png`, fullPage: true, mask: rejectionMasks(page), maskColor: '#172b4d' });
  await page.evaluate(() => window.scrollTo(0, 0));
}

test('W13 insufficient-balance rejection is captured responsively for a synthetic wallet_test user @visual', async ({ page }) => {
  const fixture = await registerSyntheticUser(page, 'w13-insufficient');
  const sourceBalance = BigInt(fixture.accounts[0]!.availableBalanceMinor);
  const otpThreshold = BigInt(process.env.OTP_THRESHOLD_MINOR ?? '1');
  const amountMinor = sourceBalance + 1n > otpThreshold ? sourceBalance + 1n : otpThreshold;
  const amount = `${amountMinor / 100n}.${(amountMinor % 100n).toString().padStart(2, '0')}`;
  let demoOnlyCode: string | undefined;
  let createStatus: number | undefined;
  let confirmationStatus: number | undefined;
  page.on('response', async (response) => {
    if (response.request().method() !== 'POST') return;
    const path = new URL(response.url()).pathname;
    if (path.endsWith('/confirm')) { confirmationStatus = response.status(); return; }
    if (path !== '/v1/transfers') return;
    createStatus = response.status();
    if (response.ok()) {
      try { demoOnlyCode = (await response.json() as { demoOnlyCode?: string }).demoOnlyCode; } catch { /* Ignore non-JSON responses. */ }
    }
  });

  await openOwnTransfer(page, fixture.accounts, amount, '913401');
  const confirmation = page.getByLabel('Código de confirmación de 6 dígitos');
  const rejection = page.getByRole('alert');
  await expect(confirmation).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => createStatus).toBe(202);
  await expect.poll(() => demoOnlyCode).toMatch(/^\d{6}$/);
  await confirmation.fill(demoOnlyCode!);
  await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
  await expect(page.getByRole('heading', { name: 'Transferencia no realizada' })).toBeVisible();
  await expect(rejection).toContainText(/saldo insuficiente|no se realizó ningún débito/i);
  await expect(rejection.locator('.rejection-breakdown')).toContainText('Importe solicitado');
  await expect(rejection.locator('.rejection-breakdown')).toContainText('Saldo disponible sin débito');
  await expect.poll(() => confirmationStatus).toBe(422);
  await captureResponsiveRejection(page, 'W13-saldo-insuficiente');
  await captureRejectionBreakdown(page, 'W13-saldo-insuficiente');
});

test('W13 configured demo daily-limit rejection is captured responsively for a synthetic wallet_test user @visual', async ({ page }) => {
  const fixture = await registerSyntheticUser(page, 'w13-daily-limit');
  const limit = process.env.DAILY_TRANSFER_LIMIT_MINOR;
  expect(limit).toMatch(/^[1-9][0-9]*$/);
  expect(BigInt(process.env.OTP_THRESHOLD_MINOR ?? '0')).toBeGreaterThan(1n);
  await setSyntheticUserDailyUsage(fixture.userId, limit!);
  let createStatus: number | undefined;
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/v1/transfers' && response.request().method() === 'POST') createStatus = response.status();
  });
  await openOwnTransfer(page, fixture.accounts, '0.01', '913402');
  await expect(page.getByRole('heading', { name: 'Transferencia no realizada' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/límite diario configurado|no se realizó ningún débito/i);
  await expect(page.getByRole('alert').locator('.rejection-breakdown')).toContainText('Importe solicitado');
  await expect(page.getByRole('alert').locator('.rejection-breakdown')).toContainText('Límite diario de demostración alcanzado');
  await expect(page.getByRole('alert').locator('.rejection-breakdown')).not.toContainText(/uso acumulado|disponible del límite/i);
  await expect.poll(() => createStatus).toBe(429);
  await captureResponsiveRejection(page, 'W13-limite-diario-demo');
  await captureRejectionBreakdown(page, 'W13-limite-diario-demo');
});
