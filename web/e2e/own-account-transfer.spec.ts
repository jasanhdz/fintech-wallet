import { expect, test } from '@playwright/test';

test('registers with the development fixture and transfers between own accounts', async ({ page }) => {
  const email = `own-transfer-${crypto.randomUUID()}@example.test`;
  const password = `Local-test-${crypto.randomUUID()}-Aa1`;
  let accountIds: string[] = [];
  let fundedAccounts: string[] = [];
  let beneficiaryCount = -1;
  let demoOnlyCode: string | undefined;
  let transferId = '';

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
      fundedAccounts = data.items.filter((account) => BigInt(account.availableBalanceMinor) >= 1n).map((account) => account.id);
    } catch { /* Ignore unrelated/non-JSON responses. */ }
  });
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname !== '/v1/transfers' || response.request().method() !== 'POST' || !response.ok()) return;
    try {
      const transfer = await response.json() as { id: string; demoOnlyCode?: string };
      transferId = transfer.id;
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
  await expect.poll(() => accountIds.length).toBeGreaterThanOrEqual(2);
  expect(accountIds.length, 'La fixture local debe devolver dos cuentas propias').toBe(2);
  expect(fundedAccounts.length, 'La fixture local debe financiar al menos una cuenta propia con 1 minor unit').toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Transferir', exact: true }).first().click();
  await expect.poll(() => beneficiaryCount).toBe(0);
  await expect(page.getByRole('heading', { name: 'Aún no tienes beneficiarios' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entre mis cuentas' })).toBeVisible();
  await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
  const sourceId = fundedAccounts[0];
  const destinationId = accountIds.find((id) => id !== sourceId);
  expect(destinationId).toBeTruthy();
  await page.getByLabel('Cuenta de origen').selectOption(sourceId);
  await page.getByLabel('Cuenta de destino').selectOption(destinationId!);
  await page.getByLabel('Importe en MXN').fill('0.01');
  await page.getByLabel('Concepto').fill('Transferencia propia E2E');
  await page.getByLabel('Referencia numérica').fill('204201');
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toContainText('Transferencia propia E2E');
  await expect(page.getByRole('region', { name: 'Revisión de transferencia' })).toContainText('204201');
  await page.getByRole('button', { name: /Enviar transferencia/ }).click();

  const confirmation = page.getByLabel('Código de confirmación de 6 dígitos');
  if (await confirmation.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await expect.poll(() => demoOnlyCode).toMatch(/^\d{6}$/);
    await confirmation.fill(demoOnlyCode!);
    await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
  expect(transferId).toBeTruthy();
  const receipt = page.getByRole('heading', { name: 'Comprobante interno' }).locator('..');
  await expect(receipt).toContainText('Transferencia propia E2E');
  await expect(receipt).toContainText('204201');

  await page.getByRole('link', { name: 'Volver a mis cuentas', exact: true }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.locator(`a[href="/accounts/${sourceId}/movements"]`).click();
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  const transferRow = page.getByRole('row').filter({ hasText: 'Transferencia propia E2E' });
  await expect(transferRow).toContainText('Cargo');
  await expect(transferRow).toContainText('Completado');
  await transferRow.getByRole('link', { name: 'Ver detalle' }).click();
  await expect(page).toHaveURL(new RegExp(`/transfers/${transferId}/movement-receipt$`));
  await expect(page.getByRole('heading', { name: 'Comprobante interno' })).toBeVisible();
  await expect(page.locator('.receipt-card')).toContainText('Transferencia propia E2E');
});
