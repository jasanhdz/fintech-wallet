// WF-T5 [I] against the real APIs of SPEC §5.10 (wallet_test on 55433). P1: FN-10 + W12-F2 + FN-12 (código correcto tras uno
// incorrecto; comprobante de la operación correcta; historial actualizado) and I-W11-6 (respuesta perdida real → resultado
// desconocido → «Reintentar el mismo envío» → mismo id, un solo movimiento). P3 (demo-only process settings
// OTP_EXPIRY_SECONDS=5, OTP_MAX_ATTEMPTS=2): W10-F4 expiración real → V9 and agotados real → V10, balances unchanged.
// Synthetic users through the public API; the demo code is only typed into the page; keys and CLABEs never reach the output.
import { createHash } from 'node:crypto';
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { recordMetric } from './helpers/evidence.js';
import { shoot, V1440, watch } from './helpers/screen.js';

const PROFILE = { P1: { api: 'http://127.0.0.1:3301', web: 'http://127.0.0.1:5301' }, P3: { api: 'http://127.0.0.1:3303', web: 'http://127.0.0.1:5303' } };
const profiles = (process.env.WF_PROFILES ?? 'P1').split(',').map((item) => item.trim());
type Account = { id: string; name: string; clabe: string; availableBalanceMinor: string };
type User = { email: string; password: string; auth: Record<string, string>; accounts: Account[] };
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function apiUser(api: APIRequestContext, fullName: string): Promise<User> {
  const unique = crypto.randomUUID();
  const email = `wf-t5-${unique}@example.test`;
  const password = `Sintetica-${unique}`;
  const { csrfToken } = await (await api.get('v1/auth/csrf')).json() as { csrfToken: string };
  const registration = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrfToken }, data: { fullName, email, password } });
  expect(registration.status()).toBe(201);
  const { accessToken } = await registration.json() as { accessToken: string };
  const auth = { Authorization: `Bearer ${accessToken}` };
  return { email, password, auth, accounts: await accountsOf(api, auth) };
}
const accountsOf = async (api: APIRequestContext, auth: Record<string, string>) => (await (await api.get('v1/accounts', { headers: auth })).json() as { items: Account[] }).items;
const balances = async (api: APIRequestContext, auth: Record<string, string>) => Object.fromEntries((await accountsOf(api, auth)).map((account) => [account.id, account.availableBalanceMinor]));

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

type Posted = { path: string; body: string; key: string | null; status: number; response: Record<string, unknown> };
/** Records every transfer POST without altering it (keys are compared, never printed). */
function recordPosts(page: Page) {
  const posts: Posted[] = [];
  page.on('response', async (response) => {
    const request = response.request();
    const path = new URL(response.url()).pathname;
    if (request.method() !== 'POST' || !path.startsWith('/v1/transfers')) return;
    posts.push({ path, body: request.postData() ?? '', key: request.headers()['idempotency-key'] ?? null, status: response.status(), response: await response.json().catch(() => ({})) as Record<string, unknown> });
  });
  return posts;
}

/** W08 → W09 between own accounts, source and destination named by id (D-8). */
async function ownTransfer(page: Page, source: Account, destination: Account, amount: string, concept: string, reference: string) {
  await page.goto(`/transfers/new?type=own_account&source=${source.id}`);
  await page.getByRole('radiogroup', { name: 'Cuenta de destino' }).locator(`[data-radio-id="${destination.id}"]`).click();
  await page.getByLabel('Importe a transferir').fill(amount);
  await page.getByLabel('Concepto').fill(concept);
  await page.getByLabel('Referencia numérica').fill(reference);
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
}
const inputOf = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
const otp = (page: Page) => page.getByLabel('Código de confirmación de 6 dígitos');
const authorize = (page: Page) => page.getByRole('button', { name: /^Autorizar transferencia de / });
const wrongOf = (code: string) => `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;

test.describe('WF-T5 [I] P1', () => {
  test.skip(!profiles.includes('P1'), 'P1 not started');

  test('FN-10 · W12-F2 · FN-12: código incorrecto → correcto → comprobante de la misma operación → historial', async ({ browser }) => {
    test.setTimeout(180_000);
    const api = await playwrightRequest.newContext({ baseURL: PROFILE.P1.api, extraHTTPHeaders: { Origin: PROFILE.P1.web } });
    try {
      const owner = await apiUser(api, 'Persona Prueba Codigo');
      const policy = await (await api.get('v1/transfer-policy', { headers: owner.auth })).json() as { otpThresholdMinor: string };
      const [source, destination] = owner.accounts as [Account, Account];
      const before = await balances(api, owner.auth);
      const amount = BigInt(policy.otpThresholdMinor);
      expect(BigInt(before[source.id]!)).toBeGreaterThanOrEqual(amount);
      const { context, page } = await login(browser, PROFILE.P1.web, owner);
      const seen = watch(page);
      const posts = recordPosts(page);
      await ownTransfer(page, source, destination, inputOf(amount), 'Código T5', '5101');
      await page.getByRole('button', { name: /Continuar a verificación|Confirmar transferencia/ }).first().click();
      await expect(otp(page)).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => posts.some((item) => item.path === '/v1/transfers')).toBe(true);
      const created = posts.find((item) => item.path === '/v1/transfers')!;
      expect(created.status).toBe(202);
      const code = String(created.response.demoOnlyCode ?? '');
      expect(/^\d{6}$/.test(code)).toBe(true);
      await expect(page.locator('.cf-timer-chip')).toHaveText(/^0[0-5]:[0-5]\d min$/);
      await otp(page).fill(wrongOf(code));
      await authorize(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Código incorrecto' })).toBeVisible();
      await expect(otp(page)).toBeFocused();
      await shoot(page, 'I-W10-incorrecto', { scenario: 'I-W10-10', screen: 'W10', state: 'P1 código incorrecto real', reference: 'w10_c_digo_incorrecto' }, V1440, 'I');
      expect(await balances(api, owner.auth)).toEqual(before);
      await otp(page).fill(code);
      await authorize(page).click();
      await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible({ timeout: 15_000 });
      // W12-F2: the receipt is the confirmed operation: folio/id, amount, concept and reference = confirm response.
      const confirmed = posts.filter((item) => item.path.endsWith('/confirm')).at(-1)!;
      expect(confirmed.status).toBe(200);
      const result = confirmed.response as { id: string; amountMinor: string; concept: string; reference: string; receiptReference?: string | null };
      expect(result.id).toBe(created.response.id);
      await expect(page.locator('.rc-folio-value')).toHaveText(result.receiptReference || result.id);
      await expect(page.locator('.rc-amount')).toHaveText(`$${(amount / 100n).toLocaleString('en-US')}.${(amount % 100n).toString().padStart(2, '0')} MXN`);
      await expect(page.locator('.rc-rows dd').nth(1)).toHaveText('Código T5');
      await expect(page.locator('.rc-rows dd').nth(2)).toHaveText('5101');
      const after = await balances(api, owner.auth);
      expect(BigInt(after[source.id]!)).toBe(BigInt(before[source.id]!) - amount);
      expect(BigInt(after[destination.id]!)).toBe(BigInt(before[destination.id]!) + amount);
      await expect(page.locator('.rc-balance-card').first()).toContainText(`$${(BigInt(after[source.id]!) / 100n).toLocaleString('en-US')}.`);
      await shoot(page, 'I-W12-propias', { scenario: 'I-W12-5', screen: 'W12', state: 'P1 propias tras código', reference: 'w12_comprobante_entre_cuentas_propias' }, V1440, 'I');
      // FN-12: «Ver movimientos» → first row is this operation without a manual reload.
      await page.getByRole('link', { name: 'Ver movimientos' }).click();
      await expect(page).toHaveURL(new RegExp(`/accounts/${source.id}/movements$`));
      const firstRow = page.locator('tbody tr.hist-row').first();
      await expect(firstRow).toContainText('Código T5');
      await expect(firstRow).toContainText('5101');
      expect(posts.filter((item) => item.path === '/v1/transfers')).toHaveLength(1);
      expect(posts.filter((item) => item.path.endsWith('/confirm')).map((item) => item.status)).toEqual([422, 200]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric('WF-T5 [I] P1 FN-10/W12-F2/FN-12', { create: 202, confirms: [422, 200], receipt: 'id/folio, importe, concepto, referencia = respuesta de confirm', balances: 'origen −importe, destino +importe', history: 'primera fila = operación' });
      await context.close();
    } finally { await api.dispose(); }
  });

  test('I-W11-6: respuesta perdida real → resultado desconocido → «Reintentar el mismo envío» → mismo id, un movimiento', async ({ browser }) => {
    test.setTimeout(180_000);
    const api = await playwrightRequest.newContext({ baseURL: PROFILE.P1.api, extraHTTPHeaders: { Origin: PROFILE.P1.web } });
    try {
      const owner = await apiUser(api, 'Persona Prueba Perdida');
      const [source, destination] = owner.accounts as [Account, Account];
      const before = await balances(api, owner.auth);
      const { context, page } = await login(browser, PROFILE.P1.web, owner);
      const seen = watch(page);
      let lost = 0;
      const sent: Array<{ key: string | null; bodySha: string; status?: number; id?: string }> = [];
      await page.route('**/v1/transfers', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const entry = { key: route.request().headers()['idempotency-key'] ?? null, bodySha: sha256(route.request().postData() ?? '') };
        const response = await route.fetch();
        const body = await response.json().catch(() => ({})) as { id?: string };
        sent.push({ ...entry, status: response.status(), id: body.id });
        if (lost === 0) { lost += 1; return route.abort('connectionreset'); } // committed server-side, answer lost
        return route.fulfill({ response });
      });
      await ownTransfer(page, source, destination, '0.61', 'Perdida T5', '6161');
      await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.vr-note')).toHaveText('Se repetirá la misma solicitud con su misma clave de operación; no se crea un intento nuevo.');
      await shoot(page, 'I-W11-desconocido', { scenario: 'I-W11-6', screen: 'W11', state: 'P1 respuesta perdida real', reference: 'w11_verificando_resultado' }, V1440, 'I');
      await page.getByRole('button', { name: 'Reintentar el mismo envío' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible({ timeout: 15_000 });
      expect(sent).toHaveLength(2);
      expect(sent[1]!.key).toBe(sent[0]!.key);
      expect(sent[1]!.bodySha).toBe(sent[0]!.bodySha);
      expect(sent[1]!.id).toBe(sent[0]!.id);
      await expect(page.locator('.rc-folio-value')).toContainText(/.+/);
      const after = await balances(api, owner.auth);
      expect(BigInt(after[source.id]!)).toBe(BigInt(before[source.id]!) - 61n);
      await page.getByRole('link', { name: 'Ver movimientos' }).click();
      await expect(page.locator('tbody tr.hist-row').filter({ hasText: 'Perdida T5' })).toHaveCount(1);
      const detail = await api.get(`v1/transfers/${sent[0]!.id}`, { headers: owner.auth });
      expect(detail.status()).toBe(200);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric('WF-T5 [I] P1 I-W11-6', { posts: 2, sameKey: true, sameBodySha256: true, sameTransferId: true, movements: 1, balanceDelta: '-61', bodySha256: sent[0]!.bodySha });
      await context.close();
    } finally { await api.dispose(); }
  });
});

test.describe('WF-T5 [I] P3 (OTP_EXPIRY_SECONDS=5, OTP_MAX_ATTEMPTS=2, demo-only)', () => {
  test.skip(!profiles.includes('P3'), 'P3 not started');

  test('W10-F4 expiración real → V9; agotados real → V10; saldos sin cambio', async ({ browser }) => {
    test.setTimeout(180_000);
    const api = await playwrightRequest.newContext({ baseURL: PROFILE.P3.api, extraHTTPHeaders: { Origin: PROFILE.P3.web } });
    try {
      const owner = await apiUser(api, 'Persona Prueba Vencida');
      const policy = await (await api.get('v1/transfer-policy', { headers: owner.auth })).json() as { otpThresholdMinor: string; otpExpirySeconds: number; otpMaxAttempts: number };
      expect([policy.otpExpirySeconds, policy.otpMaxAttempts]).toEqual([5, 2]);
      const [source, destination] = owner.accounts as [Account, Account];
      const before = await balances(api, owner.auth);
      const amount = BigInt(policy.otpThresholdMinor);
      // Expiry: wait past expiresAt; the countdown's GET (or a confirm) gets the server's `expired`.
      let { context, page } = await login(browser, PROFILE.P3.web, owner);
      let seen = watch(page);
      let posts = recordPosts(page);
      await ownTransfer(page, source, destination, inputOf(amount), 'Vence T5', '5301');
      await page.getByRole('button', { name: /Continuar a verificación|Confirmar transferencia/ }).first().click();
      await expect(otp(page)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(6_000);
      await expect(page.getByRole('alert').filter({ hasText: 'Código expirado' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.cf-timer-chip')).toHaveText('00:00 min');
      await expect(otp(page)).toBeDisabled();
      await shoot(page, 'I-W10-expirado', { scenario: 'I-W10-11', screen: 'W10', state: 'P3 expiración real', reference: 'w10_c_digo_expirado' }, V1440, 'I');
      expect(posts.filter((item) => item.path.endsWith('/confirm') || item.path.endsWith('/cancel'))).toHaveLength(0);
      expect(await balances(api, owner.auth)).toEqual(before);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      await context.close();
      // Exhausted: two wrong codes (max attempts 2) → 422 then 429 → V10.
      ({ context, page } = await login(browser, PROFILE.P3.web, owner));
      seen = watch(page);
      posts = recordPosts(page);
      await ownTransfer(page, source, destination, inputOf(amount), 'Agota T5', '5302');
      await page.getByRole('button', { name: /Continuar a verificación|Confirmar transferencia/ }).first().click();
      await expect(otp(page)).toBeVisible({ timeout: 15_000 });
      // UX-T0: the response listener records the POST only after its JSON body resolves; wait for it (was a race).
      await expect.poll(() => posts.some((item) => item.path === '/v1/transfers')).toBe(true);
      const code = String(posts.find((item) => item.path === '/v1/transfers')!.response.demoOnlyCode ?? '');
      await otp(page).fill(wrongOf(code));
      await authorize(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Código incorrecto' })).toBeVisible();
      await otp(page).fill(wrongOf(wrongOf(code)));
      await authorize(page).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Operación suspendida' })).toBeVisible();
      await expect(page.locator('.cf-no-charge')).toContainText('No se realizó ningún cargo a tu cuenta');
      await expect(page.locator('.cf-no-charge')).toContainText(`$${(BigInt(before[source.id]!) / 100n).toLocaleString('en-US')}.`);
      await shoot(page, 'I-W10-agotados', { scenario: 'I-W10-12', screen: 'W10', state: 'P3 intentos agotados real', reference: 'w10_intentos_agotados' }, V1440, 'I');
      expect(posts.filter((item) => item.path.endsWith('/confirm')).map((item) => item.status)).toEqual([422, 429]);
      expect(await balances(api, owner.auth)).toEqual(before);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric('WF-T5 [I] P3 W10-F4', { expiry: 'espera > expiresAt → GET → expired → V9', exhausted: 'confirm 422 → 429 → V10', balancesUnchanged: true, cancelRequests: 0 });
      await context.close();
    } finally { await api.dispose(); }
  });
});
