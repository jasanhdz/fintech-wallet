// UI driver for the golden-trace scenarios. Selectors may be updated when screens are redesigned
// (WF-T4/T5); the network expectations in network-golden.json must not change (REC-02).
import { expect, type Page } from '@playwright/test';

export type TransferInput = { amount: string; concept: string; reference: string };

/** W08 → W09 with the first own account as source and the first beneficiary as destination. */
export async function fillBeneficiaryTransfer(page: Page, input: TransferInput) {
  await page.goto('/transfers/new');
  // WF-T4 (W08 redesign, D-8): the source defaults to the first account (was `selectOption({ index: 1 })`) and the
  // beneficiary is the first radio of «Destinatario» (was the first option of the select). Same body, same trace.
  await expect(page.getByRole('group', { name: 'Cuenta de origen' })).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Destinatario' }).getByRole('radio').first().click();
  await page.getByLabel('Importe a transferir').fill(input.amount);
  await page.getByLabel('Concepto').fill(input.concept);
  await page.getByLabel('Referencia numérica').fill(input.reference);
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
}

export async function sendFromReview(page: Page) {
  // WF-T4: W09 CTA «Confirmar transferencia» (or «Continuar a verificación» when the policy predicts a code).
  await page.getByRole('button', { name: /^(Confirmar transferencia|Continuar a verificación)$/ }).click();
}

export async function expectUncertain(page: Page) {
  // WF-T5: W11-V3 «Resultado desconocido» (was «Estamos verificando el resultado»).
  await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible();
}

export async function retryUncertain(page: Page) {
  // WF-T5 (W11-F1): the button names what it does — the same POST with the record's key and body.
  await page.getByRole('button', { name: 'Reintentar el mismo envío' }).click();
}

export async function expectCompleted(page: Page) {
  await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible();
}

export async function enterCode(page: Page, code: string) {
  await page.getByLabel('Código de confirmación de 6 dígitos').fill(code);
  // WF-T5: W10 CTA «Autorizar transferencia de {importe}» (was «Confirmar transferencia»). Same confirm POST.
  await page.getByRole('button', { name: /^Autorizar transferencia de / }).click();
}

export async function expectRejected(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: /^Transferencia rechazada: (Saldo insuficiente|Límite diario alcanzado)$/ })).toBeVisible();
}

export async function editAfterRejection(page: Page) {
  // WF-T4: W13 «Modificar monto» returns to W08 with every value; W08 → W09 sends no request (REC-02 unchanged).
  await page.getByRole('button', { name: 'Modificar monto' }).click();
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /^(Salir|Cerrar sesión)$/ }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function resumeFromSessionExpired(page: Page) {
  await page.goto('/session-expired');
  await page.getByRole('link', { name: /Iniciar sesión y (recuperar intento|retomar la verificación)/ }).first().click();
  await expect(page).toHaveURL(/\/login$/);
}

export async function login(page: Page, email: string, password: string) {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Iniciar sesión/ }).click();
}
