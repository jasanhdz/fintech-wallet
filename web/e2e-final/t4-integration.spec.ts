// WF-T4 [I] against the real APIs of SPEC §5.10 (wallet_test on 55433): FN-03, FN-04, FN-05, FN-08, FN-10, FN-15 (P1),
// I-W08-9 + FN-11 saldo (P2, fixture off) and FN-11 límite (P4, DAILY_TRANSFER_LIMIT_MINOR=100000, demo-only process
// setting). Synthetic users are created through the public API; nothing is seeded. CLABEs, codes and keys never reach the
// output: bodies are compared as objects without CLABEs and the demo code is only typed into the page.
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { recordMetric } from './helpers/evidence.js';
import { settle, shoot, V1440, watch } from './helpers/screen.js';

const PROFILE = { P1: { api: 'http://127.0.0.1:3301', web: 'http://127.0.0.1:5301' }, P2: { api: 'http://127.0.0.1:3302', web: 'http://127.0.0.1:5302' }, P4: { api: 'http://127.0.0.1:3304', web: 'http://127.0.0.1:5304' } };
const profiles = (process.env.WF_PROFILES ?? 'P1').split(',').map((item) => item.trim());
type Account = { id: string; name: string; clabe: string; availableBalanceMinor: string };
type User = { email: string; password: string; auth: Record<string, string>; accounts: Account[] };

async function apiUser(api: APIRequestContext, fullName: string): Promise<User> {
  const unique = crypto.randomUUID();
  const email = `wf-t4-${unique}@example.test`;
  const password = `Sintetica-${unique}`;
  const { csrfToken } = await (await api.get('v1/auth/csrf')).json() as { csrfToken: string };
  const registration = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrfToken }, data: { fullName, email, password } });
  expect(registration.status()).toBe(201);
  const { accessToken } = await registration.json() as { accessToken: string };
  const auth = { Authorization: `Bearer ${accessToken}` };
  return { email, password, auth, accounts: await accountsOf(api, auth) };
}
const accountsOf = async (api: APIRequestContext, auth: Record<string, string>) => (await (await api.get('v1/accounts', { headers: auth })).json() as { items: Account[] }).items;

async function addBeneficiary(api: APIRequestContext, auth: Record<string, string>, name: string, alias: string, clabe: string) {
  const { csrfToken } = await (await api.get('v1/auth/csrf')).json() as { csrfToken: string };
  const response = await api.post('v1/beneficiaries', { headers: { ...auth, 'X-CSRF-Token': csrfToken }, data: { name, alias, clabe } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ id: string; destinationAccountId: string; ownAccountId?: string }>;
}

async function login(browser: Browser, web: string, user: User) {
  const context = await browser.newContext({ baseURL: web, viewport: { width: V1440.width, height: V1440.height }, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/v1/auth/refresh', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.unroute('**/v1/auth/refresh');
  return { context, page };
}

type Posted = { body: Record<string, string>; status: number; response: Record<string, unknown> };
/** Records every POST /v1/transfers without altering it (FN-08). */
function recordCreates(page: Page) {
  const created: Posted[] = [];
  page.on('response', async (response) => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/v1/transfers') return;
    created.push({ body: JSON.parse(response.request().postData() ?? '{}') as Record<string, string>, status: response.status(), response: await response.json().catch(() => ({})) as Record<string, unknown> });
  });
  return created;
}

const fill = async (page: Page, amount: string, concept: string, reference: string) => {
  await page.getByLabel('Importe a transferir').fill(amount);
  await page.getByLabel('Concepto').fill(concept);
  await page.getByLabel('Referencia numérica').fill(reference);
};
const mxn = (minor: bigint) => `$${(minor / 100n).toLocaleString('en-US')}.${(minor % 100n).toString().padStart(2, '0')} MXN`;

test.describe('WF-T4 [I] P1', () => {
  test('FN-03 · FN-04 · FN-05 · FN-08 · FN-10 · FN-15 con la API real', async ({ browser }) => {
    test.setTimeout(240_000);
    const api = await playwrightRequest.newContext({ baseURL: PROFILE.P1.api, extraHTTPHeaders: { Origin: PROFILE.P1.web } });
    const metrics: Record<string, unknown> = {};
    try {
      const owner = await apiUser(api, 'Persona Prueba Transferencia');
      const other = await apiUser(api, 'Persona Prueba Receptora');
      // GET /v1/accounts does not guarantee an order: every step names its source with ?source= (D-8).
      const [checking, savings] = owner.accounts as [Account, Account];
      const toOther = await addBeneficiary(api, owner.auth, 'Persona Prueba Receptora', 'Receptora', other.accounts[0]!.clabe);
      const toOwnChecking = await addBeneficiary(api, owner.auth, 'Persona Prueba Transferencia', 'Mi principal', checking.clabe);
      expect(toOwnChecking.ownAccountId === checking.id || toOwnChecking.destinationAccountId === checking.id).toBe(true);
      const policy = await (await api.get('v1/transfer-policy', { headers: owner.auth })).json() as { otpThresholdMinor: string };
      const { context, page } = await login(browser, PROFILE.P1.web, owner);
      const seen = watch(page);
      const created = recordCreates(page);

      // FN-03 + FN-08 + FN-15: beneficiary below the threshold; W08 → W09 → POST (double click) → W12.
      const before = await accountsOf(api, owner.auth);
      await page.goto(`/transfers/new?source=${checking.id}&beneficiaryId=${toOther.id}`);
      await fill(page, '1.23', '  Envío FN-03 ', '303');
      await page.getByRole('button', { name: 'Continuar a revisión' }).click();
      const card = page.locator('.tr-main-card');
      await expect(card.locator('.tr-amount')).toHaveText('$1.23 MXN');
      await expect(card.locator('.tr-meta dd')).toHaveText(['Envío FN-03', '303']);
      await expect(card.locator('.tr-party').nth(1)).toContainText('Persona Prueba Receptora');
      await shoot(page, 'I-W09-normal', { scenario: 'I-W09-6', screen: 'W09', state: 'P1 real bajo umbral', reference: 'w09_revisar_transferencia' }, V1440, 'I');
      await page.getByRole('button', { name: 'Confirmar transferencia' }).dblclick();
      await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
      expect(created).toHaveLength(1);
      expect(created[0]!.body).toEqual({ sourceAccountId: checking.id, destinationType: 'beneficiary', beneficiaryId: toOther.id, amountMinor: '123', concept: 'Envío FN-03', reference: '303' });
      const first = created[0]!.response as { id: string; amountMinor: string; concept: string; reference: string; receiptReference?: string };
      expect([first.amountMinor, first.concept, first.reference]).toEqual(['123', 'Envío FN-03', '303']);
      // WF-T5: W12 card `.rc-card`; the amount moved to the centred header (`.rc-amount`).
      const receipt = page.locator('.rc-card');
      await expect(receipt).toContainText('Envío FN-03');
      await expect(receipt).toContainText('303');
      await expect(receipt).toContainText(first.receiptReference || first.id);
      await expect(page.locator('.rc-amount')).toHaveText('$1.23 MXN');
      const afterFn03 = await accountsOf(api, owner.auth);
      expect(BigInt(afterFn03.find((item) => item.id === checking.id)!.availableBalanceMinor)).toBe(BigInt(before.find((item) => item.id === checking.id)!.availableBalanceMinor) - 123n);
      await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Inicio' }).click();
      await expect(page.getByRole('region', { name: 'Tus cuentas' })).toContainText(mxn(BigInt(afterFn03.find((item) => item.id === checking.id)!.availableBalanceMinor)));
      metrics['FN-03/FN-08/FN-15'] = { posts: 1, bodyEqualsReview: true, receipt: 'id/folio, importe, concepto y referencia = respuesta', balanceDelta: '-123' };

      // FN-05: the beneficiary with the source's own CLABE is blocked from checking and valid from savings.
      await page.goto(`/transfers/new?source=${checking.id}&beneficiaryId=${toOwnChecking.id}`);
      const proceed = page.getByRole('button', { name: 'Continuar a revisión' });
      await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-option-reason')).toHaveText('Este beneficiario corresponde a la cuenta de origen');
      await expect(proceed).toBeDisabled();
      await shoot(page, 'I-W08-origen-igual-destino', { scenario: 'I-W08-8', screen: 'W08', state: 'P1 beneficiario = cuenta origen', reference: 'w08_formulario_de_transferencia' }, V1440, 'I');
      // UX-T2 (D-UX-6): the source radio group is inline with two accounts (no «Cambiar cuenta» step).
      await page.getByRole('radiogroup', { name: 'Cuenta de origen' }).locator(`[data-radio-id="${savings.id}"]`).click();
      await expect(proceed).toBeEnabled();
      await fill(page, '0.45', 'Identidad FN-05', '505');
      await proceed.click();
      await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
      await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
      expect(created.at(-1)!.status).toBe(201);
      expect(created.at(-1)!.body).toMatchObject({ sourceAccountId: savings.id, beneficiaryId: toOwnChecking.id, amountMinor: '45' });
      metrics['FN-05'] = { fromChecking: 'deshabilitado con razón', fromSavings: 201 };

      // FN-04: own accounts, two distinct accounts; both balances move in W03.
      const beforeOwn = await accountsOf(api, owner.auth);
      await page.goto(`/transfers/new?type=own_account&source=${checking.id}`);
      await expect(page.getByRole('radiogroup', { name: 'Cuenta de destino' }).locator(`[data-radio-id="${savings.id}"]`)).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radiogroup', { name: 'Cuenta de destino' }).locator(`[data-radio-id="${checking.id}"]`)).toHaveAttribute('aria-disabled', 'true');
      await fill(page, '0.67', 'Propias FN-04', '404');
      await page.getByRole('button', { name: 'Continuar a revisión' }).click();
      await expect(page.getByRole('region', { name: 'Desglose de la operación' }).locator('.tr-hero-amount')).toHaveText('$0.67 MXN');
      await shoot(page, 'I-W09-propias', { scenario: 'I-W09-6', screen: 'W09', state: 'P1 real propias', reference: 'w09_revisi_n_entre_cuentas_propias' }, V1440, 'I');
      await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
      await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
      expect(created.at(-1)!.body).toEqual({ sourceAccountId: checking.id, destinationType: 'own_account', destinationAccountId: savings.id, amountMinor: '67', concept: 'Propias FN-04', reference: '404' });
      const afterOwn = await accountsOf(api, owner.auth);
      const delta = (id: string) => BigInt(afterOwn.find((item) => item.id === id)!.availableBalanceMinor) - BigInt(beforeOwn.find((item) => item.id === id)!.availableBalanceMinor);
      expect([delta(checking.id), delta(savings.id)]).toEqual([-67n, 67n]);
      await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Inicio' }).click();
      for (const account of afterOwn) await expect(page.getByRole('region', { name: 'Tus cuentas' })).toContainText(mxn(BigInt(account.availableBalanceMinor)));
      metrics['FN-04'] = { checking: '-67', savings: '+67' };

      // FN-10: amount >= otpThresholdMinor read from the real policy → W09 code variant → 202 → W10 → code → W12.
      const threshold = BigInt(policy.otpThresholdMinor);
      // The order of GET /v1/accounts is not guaranteed: use ?source= with the account that can afford the threshold.
      const funded = (await accountsOf(api, owner.auth)).reduce((best, item) => BigInt(item.availableBalanceMinor) > BigInt(best.availableBalanceMinor) ? item : best);
      expect(BigInt(funded.availableBalanceMinor) >= threshold).toBe(true);
      await page.goto(`/transfers/new?source=${funded.id}&beneficiaryId=${toOther.id}`);
      await fill(page, `${threshold / 100n}.${(threshold % 100n).toString().padStart(2, '0')}`, 'Con código FN-10', '1010');
      await page.getByRole('button', { name: 'Continuar a revisión' }).click();
      await expect(page.getByRole('complementary', { name: 'Se requiere código de confirmación' })).toContainText(mxn(threshold));
      await shoot(page, 'I-W09-codigo', { scenario: 'I-W09-6', screen: 'W09', state: 'P1 real ≥ umbral', reference: 'w09_revisi_n_6_000_mxn' }, V1440, 'I');
      await page.getByRole('button', { name: 'Continuar a verificación' }).click();
      const otp = page.getByLabel('Código de confirmación de 6 dígitos');
      await expect(otp).toBeVisible({ timeout: 15_000 });
      const awaiting = created.at(-1)!;
      expect(awaiting.status).toBe(202);
      const code = String((awaiting.response as { demoOnlyCode?: string }).demoOnlyCode ?? '');
      expect(/^\d{6}$/.test(code)).toBe(true);
      await otp.fill(`${(Number(code[0]) + 1) % 10}${code.slice(1)}`);
      await page.getByRole('button', { name: /^Autorizar transferencia de / }).click();
      // WF-T5 (W10-V8): the real 422 «Código incorrecto.» is its own state (was the generic «No se confirmó…»).
      await expect(page.getByRole('alert').filter({ hasText: 'Código incorrecto' })).toBeVisible();
      await otp.fill(code);
      await page.getByRole('button', { name: /^Autorizar transferencia de / }).click();
      await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
      metrics['FN-10'] = { threshold: 'otpThresholdMinor de GET /v1/transfer-policy', create: 202, wrongCode: 'W10 conserva el intento (copia de W10 en WF-T5)', confirmed: 'W12' };
      expect(seen.foreign).toEqual([]);
      expect(seen.errors).toEqual([]);
      recordMetric('WF-T4 [I] P1', { ...metrics, provoked: seen.provoked.length });
      await context.close();
    } finally { await api.dispose(); }
  });
});

test.describe('WF-T4 [I] P2', () => {
  test('I-W08-9 sin segunda cuenta y FN-11 saldo insuficiente (422 real) sin cambio de saldo', async ({ browser }) => {
    test.skip(!profiles.includes('P2'), 'requires WF_PROFILES to include P2');
    test.setTimeout(120_000);
    const api = await playwrightRequest.newContext({ baseURL: PROFILE.P2.api, extraHTTPHeaders: { Origin: PROFILE.P2.web } });
    try {
      const owner = await apiUser(api, 'Persona Prueba Sin Saldo');
      const other = await apiUser(api, 'Persona Prueba Destino Dos');
      expect(owner.accounts).toHaveLength(1);
      const beneficiary = await addBeneficiary(api, owner.auth, 'Persona Prueba Destino Dos', 'Destino', other.accounts[0]!.clabe);
      const { context, page } = await login(browser, PROFILE.P2.web, owner);
      const seen = watch(page);
      const created = recordCreates(page);
      await page.goto('/transfers/new?type=own_account');
      await expect(page.locator('.tf-info-panel h2')).toHaveText('No cuentas con otra cuenta propia disponible');
      await expect(page.getByRole('button', { name: 'Continuar a revisión' })).toBeDisabled();
      await settle(page);
      await shoot(page, 'I-W08-sin-segunda-cuenta-P2', { scenario: 'I-W08-9', screen: 'W08', state: 'P2 real una cuenta', reference: 'w08_sin_segunda_cuenta_propia' }, V1440, 'I');
      await page.getByRole('button', { name: 'Transferir a un beneficiario' }).click();
      await page.getByRole('radiogroup', { name: 'Destinatario' }).locator(`[data-radio-id="${beneficiary.id}"]`).click();
      await fill(page, '10', 'Sin saldo FN-11', '1100');
      await page.getByRole('button', { name: 'Continuar a revisión' }).click();
      await expect(page.locator('.tr-exceeds')).toHaveText('El importe supera el saldo disponible actual');
      await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferencia rechazada: Saldo insuficiente');
      expect(created.map((item) => item.status)).toEqual([422]);
      await expect(page.locator('.rj-breakdown > div')).toHaveText(['Desglose de operaciónMXN', 'Monto solicitado$10.00 MXN', 'Saldo disponible en cuenta$0.00 MXN', 'Faltante para completarFaltan $10.00 MXN', 'Saldo final de la cuentaIntacto$0.00 MXN']);
      await settle(page);
      await shoot(page, 'I-W13-saldo-P2', { scenario: 'I-W13-5', screen: 'W13', state: 'P2 real 422', reference: 'w13_saldo_insuficiente' }, V1440, 'I');
      expect((await accountsOf(api, owner.auth))[0]!.availableBalanceMinor).toBe('0');
      await page.getByRole('link', { name: 'Volver al inicio' }).click();
      await expect(page.getByRole('region', { name: 'Tus cuentas' })).toContainText('$0.00 MXN');
      expect(seen.foreign).toEqual([]);
      expect(seen.errors).toEqual([]);
      recordMetric('WF-T4 [I] P2', { 'I-W08-9': 'panel + Continuar deshabilitado', 'FN-11 saldo': { create: 422, balanceAfter: '0' }, provoked: seen.provoked });
      await context.close();
    } finally { await api.dispose(); }
  });
});

test.describe('WF-T4 [I] P4', () => {
  test('FN-11 límite diario (429 real) con cifras de la política y sin cambio de saldo', async ({ browser }) => {
    test.skip(!profiles.includes('P4'), 'requires WF_PROFILES to include P4');
    test.setTimeout(120_000);
    const api = await playwrightRequest.newContext({ baseURL: PROFILE.P4.api, extraHTTPHeaders: { Origin: PROFILE.P4.web } });
    try {
      const owner = await apiUser(api, 'Persona Prueba Límite');
      const policy = await (await api.get('v1/transfer-policy', { headers: owner.auth })).json() as { dailyLimitMinor: string; dailyUsedMinor: string; dailyRemainingMinor: string; otpThresholdMinor: string; businessTimeZone: string };
      const amount = BigInt(policy.dailyLimitMinor) + 100n;
      expect(amount < BigInt(policy.otpThresholdMinor)).toBe(true);
      const before = await accountsOf(api, owner.auth);
      const { context, page } = await login(browser, PROFILE.P4.web, owner);
      const seen = watch(page);
      const created = recordCreates(page);
      await page.goto('/transfers/new?type=own_account');
      await expect(page.locator('#tf-amount-daily')).toHaveText(`Disponible hoy: ${mxn(BigInt(policy.dailyRemainingMinor))} (demostración)`);
      await fill(page, `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`, 'Límite FN-11', '1101');
      await page.getByRole('button', { name: 'Continuar a revisión' }).click();
      await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferencia rechazada: Límite diario alcanzado');
      expect(created.map((item) => item.status)).toEqual([429]);
      await expect(page.locator('.rj-limits-panel > div')).toHaveText([
        `Límite diario configurado (demostración)${mxn(BigInt(policy.dailyLimitMinor))}`, '', `Monto acumulado enviado hoy${mxn(BigInt(policy.dailyUsedMinor))}`,
        `Disponible restante hoy${mxn(BigInt(policy.dailyRemainingMinor))}`, '', `Monto solicitado en esta operación${mxn(amount)}`, 'Cargo aplicado$0.00 MXN (sin débito)',
      ]);
      await expect(page.locator('.rj-info')).toContainText(`(${policy.businessTimeZone})`);
      await settle(page);
      await shoot(page, 'I-W13-limite-P4', { scenario: 'I-W13-6', screen: 'W13', state: 'P4 real 429', reference: 'w13_l_mite_diario' }, V1440, 'I');
      const after = await accountsOf(api, owner.auth);
      expect(after.map((item) => item.availableBalanceMinor)).toEqual(before.map((item) => item.availableBalanceMinor));
      await page.getByRole('link', { name: 'Volver al inicio' }).click();
      for (const account of after) await expect(page.getByRole('region', { name: 'Tus cuentas' })).toContainText(mxn(BigInt(account.availableBalanceMinor)));
      expect(seen.foreign).toEqual([]);
      expect(seen.errors).toEqual([]);
      recordMetric('WF-T4 [I] P4', { 'FN-11 límite': { create: 429, figures: 'GET /v1/transfer-policy', balances: 'sin cambio' }, provoked: seen.provoked });
      await context.close();
    } finally { await api.dispose(); }
  });
});
