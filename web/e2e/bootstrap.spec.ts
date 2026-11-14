import { expect, test } from '@playwright/test';

test('web preparation message renders without browser console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Fintech Wallet — BOOT-00');
  await expect(page.getByRole('main')).toContainText('Entorno preparado. Diseño pendiente');
  expect(consoleErrors).toEqual([]);
});
