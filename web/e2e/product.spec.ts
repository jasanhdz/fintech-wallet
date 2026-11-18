import { expect, test } from '@playwright/test';

test('login and registration screens render responsively without browser errors @visual', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page).toHaveTitle('Billetera — Tus cuentas');
  await expect(page.getByRole('heading', { name: 'Qué gusto verte.' })).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await page.screenshot({ path: 'test-results/web-login-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Regístrate' }).click();
  await expect(page.getByRole('heading', { name: 'Empieza por aquí.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/web-register-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('.auth-side')).toBeVisible();
  await expect(page.getByRole('button', { name: /Crear cuenta/ })).toBeVisible();
  expect(consoleErrors).toEqual([]);
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

  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: /Iniciar sesión/ }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: /Hola, Web/ })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('heading', { name: /Hola, Web/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tus cuentas' })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});
