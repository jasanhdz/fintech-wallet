import { expect, test } from '@playwright/test';

async function capture(page: import('@playwright/test').Page, name: string) {
  await page.screenshot({
    path: `test-results/visual/${name}-${page.viewportSize()?.width ?? 'full'}.png`,
    fullPage: false,
    mask: [
      page.locator('input:not(.otp-input), select'),
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
      page.locator('input:not(.otp-input), select'),
      ...Array.from({ length: 6 }, (_, index) => page.locator('.otp-box').nth(index)),
      page.locator('[data-sensitive]'),
      page.locator('.masked-clabe, .notice strong, dt:has-text("Folio interno") + dd, dt:has-text("Referencia") + dd'),
      page.locator('.balance-value, .account-balance, .amount-debit, .amount-credit, dt:has-text("Importe") + dd, .receipt-amount strong'),
    ],
    maskColor: '#172b4d',
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

test('registers with the development fixture and transfers between own accounts', async ({ page }) => {
  const email = `own-transfer-${crypto.randomUUID()}@example.test`;
  const password = `Local-test-${crypto.randomUUID()}-Aa1`;
  let accountIds: string[] = [];
  let fundedAccounts: string[] = [];
  const balancesByAccount = new Map<string, string>();
  let beneficiaryCount = -1;
  let demoOnlyCode: string | undefined;
  let transferStatus: string | undefined;
  let transferId = '';
  let confirmationResponseStatus: number | undefined;
  let confirmedStatus: string | undefined;

  page.on('response', async (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/v1/beneficiaries' && response.request().method() === 'GET' && response.ok()) {
      try { beneficiaryCount = (await response.json() as { items: unknown[] }).items.length; } catch { /* Ignore unrelated/non-JSON responses. */ }
      return;
    }
    if (pathname !== '/v1/accounts' || !response.ok()) return;
    try {
      const data = await response.json() as { items: Array<{ id: string; clabe: string; availableBalanceMinor: string }> };
      accountIds = data.items.map((account) => account.id);
      for (const account of data.items) balancesByAccount.set(account.id, account.availableBalanceMinor);
      fundedAccounts = data.items.filter((account) => BigInt(account.availableBalanceMinor) >= 1n).map((account) => account.id);
    } catch { /* Ignore unrelated/non-JSON responses. */ }
  });
  page.on('response', async (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.endsWith('/confirm') && response.request().method() === 'POST') {
      confirmationResponseStatus = response.status();
      if (response.ok()) {
        try { confirmedStatus = (await response.json() as { status: string }).status; } catch { /* Ignore unrelated/non-JSON responses. */ }
      }
      return;
    }
    if (pathname !== '/v1/transfers' || response.request().method() !== 'POST' || !response.ok()) return;
    try {
      const transfer = await response.json() as { id: string; status: string; demoOnlyCode?: string };
      transferId = transfer.id;
      transferStatus = transfer.status;
      demoOnlyCode = transfer.demoOnlyCode;
    } catch { /* Ignore unrelated/non-JSON responses. */ }
  });

  // Avoid spending the shared auth limiter on the pre-registration session probe.
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 204 }));
  await page.goto('/register');
  await page.getByLabel('Nombre completo').fill('Own Account QA');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Crea una contraseña').fill(password);
  await page.getByRole('button', { name: /Crear cuenta/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('region', { name: 'Tus cuentas' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Actividad reciente' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Inicio' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await capture(page, 'W03-cuentas-own');
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('region', { name: 'Actividad reciente' }), 'W03-actividad-reciente-own');
  // F-03: tablet-width coverage (~768px) alongside the existing mobile/desktop viewports for the accounts/history journey.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole('region', { name: 'Tus cuentas' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  await capture(page, 'W03-cuentas-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('.app-rail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await capture(page, 'W03-cuentas-own');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => accountIds.length).toBeGreaterThanOrEqual(2);
  expect(accountIds.length, 'La fixture local debe devolver dos cuentas propias').toBe(2);
  expect(fundedAccounts.length, 'La fixture local debe financiar al menos una cuenta propia con 1 minor unit').toBeGreaterThan(0);

  const sourceId = fundedAccounts[0];
  await page.locator(`.account-history-link[href="/accounts/${sourceId}/movements"]`).click();
  await expect(page.getByRole('heading', { name: 'Movimientos', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sin movimientos' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, 'W04-historial-vacio-own');
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  await capture(page, 'W04-historial-vacio-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W04-historial-vacio-own');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: /Volver a mis cuentas/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  await page.getByRole('link', { name: 'Transferir', exact: true }).first().click();
  await expect.poll(() => beneficiaryCount).toBe(0);
  await expect(page.getByRole('heading', { name: 'Aún no tienes beneficiarios' })).toBeVisible();
  await capture(page, 'W06-beneficiarios-vacio-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W06-beneficiarios-vacio-own');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Entre mis cuentas' })).toBeVisible();
  await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
  const destinationId = accountIds.find((id) => id !== sourceId);
  expect(destinationId).toBeTruthy();
  await page.getByLabel('Cuenta de origen').selectOption(sourceId);
  await page.getByLabel('Cuenta de destino').selectOption(destinationId!);
  const rejectedAmountMinor = BigInt(balancesByAccount.get(sourceId) ?? '0') + 1n;
  const rejectedAmountInput = `${rejectedAmountMinor / 100n}.${(rejectedAmountMinor % 100n).toString().padStart(2, '0')}`;
  if (BigInt(process.env.OTP_THRESHOLD_MINOR ?? '0') > rejectedAmountMinor) {
    await page.getByLabel('Importe en MXN').fill(rejectedAmountInput);
    await page.getByLabel('Concepto').fill('Rechazo sin débito E2E');
    await page.getByLabel('Referencia numérica').fill('204200');
    await page.getByRole('button', { name: /Continuar a revisión/ }).click();
    await page.getByRole('button', { name: /Enviar transferencia/ }).click();
    await expect(page.getByRole('alert')).toContainText(/no se realizó ningún débito/i);
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, 'W13-rechazo-sin-debito-own');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await capture(page, 'W13-rechazo-sin-debito-own');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Editar' }).click();
  }
  await page.getByLabel('Importe en MXN').fill('0.01');
  await page.getByLabel('Concepto').fill('Transferencia propia E2E');
  await page.getByLabel('Referencia numérica').fill('204201');
  await capture(page, 'W08-formulario-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W08-formulario-own');
  await page.setViewportSize({ width: 390, height: 844 });
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('complementary', { name: 'Resumen de transferencia' }), 'W08-resumen-own');
  // F-04: keyboard tab order for the transfer data form, in addition to the existing /access-denied coverage.
  await page.getByLabel('Referencia numérica').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /Continuar a revisión/ })).toBeFocused();
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'W09-review-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'W09-review-own');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('complementary', { name: 'Resumen de transferencia' }), 'W09-resumen-own');
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toContainText('Transferencia propia E2E');
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toContainText('204201');
  await page.getByRole('button', { name: /Enviar transferencia/ }).click();
  await expect.poll(() => transferStatus).toBeTruthy();

  const confirmation = page.getByLabel('Código de confirmación de 6 dígitos');
  if (transferStatus === 'awaiting_confirmation') {
    await expect(confirmation).toBeVisible();
    await expect.poll(() => demoOnlyCode).toMatch(/^\d{6}$/);
    await capture(page, 'W10-otp-own');
    await page.setViewportSize({ width: 1440, height: 960 });
    await capture(page, 'W10-otp-own');
    await page.setViewportSize({ width: 390, height: 844 });
    await confirmation.fill(`${(Number(demoOnlyCode![0]) + 1) % 10}${demoOnlyCode!.slice(1)}`);
    await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
    await expect(page.getByText(/No se confirmó la respuesta/)).toBeVisible();
    await capture(page, 'W10-otp-error-own');
    await page.setViewportSize({ width: 1440, height: 960 });
    await capture(page, 'W10-otp-error-own');
    await page.setViewportSize({ width: 390, height: 844 });
    await confirmation.fill(demoOnlyCode!);
    await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
    await expect.poll(() => confirmationResponseStatus).toBe(200);
    await expect.poll(() => confirmedStatus).toBe('completed');
    transferStatus = confirmedStatus;
  }
  expect(transferStatus, 'La transferencia debe quedar completada tras confirmación o creación directa').toBe('completed');

  await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
  expect(transferId).toBeTruthy();
  const receipt = page.locator('.receipt-card');
  await expect(receipt).toContainText('Transferencia propia E2E');
  await expect(receipt).toContainText('204201');
  await capture(page, 'W12-recibo-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W12-recibo-own');
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole('link', { name: 'Volver a mis cuentas', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  const recentSuccessfulTransfer = page.getByRole('region', { name: 'Actividad reciente' }).getByRole('row').filter({ hasText: 'Transferencia propia E2E' });
  await expect(recentSuccessfulTransfer).toContainText('Cargo');
  await expect(recentSuccessfulTransfer).toContainText('Completado');
  await capture(page, 'W03-cuentas-transfer-completada-own');
  await captureAfterScrollIfOutsideViewport(page, page.getByRole('region', { name: 'Actividad reciente' }), 'W03-actividad-reciente-transfer-completada-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W03-cuentas-transfer-completada-own');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(`.account-history-link[href="/accounts/${sourceId}/movements"]`).click();
  await expect(page.getByRole('heading', { name: 'Movimientos', exact: true })).toBeVisible();
  const transferRow = page.getByRole('row').filter({ hasText: 'Transferencia propia E2E' });
  await expect(transferRow).toContainText('Cargo');
  await expect(transferRow).toContainText('Completado');
  await transferRow.getByRole('link', { name: 'Ver detalle' }).click();
  await expect(page).toHaveURL(new RegExp(`/transfers/${transferId}/movement-receipt$`));
  await expect(page.locator('.movement-page > h1', { hasText: 'Comprobante interno' })).toBeVisible();
  await expect(page.locator('.receipt-card')).toContainText('Transferencia propia E2E');
  await capture(page, 'W04-detalle-own');
  await page.setViewportSize({ width: 1440, height: 960 });
  await capture(page, 'W04-detalle-own');
});
