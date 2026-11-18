// WF-T2 [I] scenarios against the real APIs of SPEC §5.10 (P1 fixture on; P2 fixture off), wallet_test on 55433.
// Synthetic users (@example.test) are created through the public API; nothing is seeded in the database.
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { recordMetric } from './helpers/evidence.js';
import { settle, shoot, V1440, watch } from './helpers/screen.js';

const P1 = { api: 'http://127.0.0.1:3301', web: 'http://127.0.0.1:5301' };
const P2 = { api: 'http://127.0.0.1:3302', web: 'http://127.0.0.1:5302' };
const profiles = (process.env.WF_PROFILES ?? 'P1').split(',').map((item) => item.trim());
type Account = { id: string; kind: 'checking' | 'savings'; name: string; clabe: string; availableBalanceMinor: string };
type Movement = { id: string; transferId?: string; type: 'debit' | 'credit'; amountMinor: string; concept: string; reference: string; occurredAt: string; counterparty?: { name: string; ownAccountId?: string } };

async function apiUser(api: APIRequestContext, fullName: string) {
  const unique = crypto.randomUUID();
  const email = `wf-t2-${unique}@example.test`;
  const password = `Sintetica-${unique}`;
  const csrf = await api.get('v1/auth/csrf');
  expect(csrf.ok()).toBeTruthy();
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const registration = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrfToken }, data: { fullName, email, password } });
  expect(registration.status()).toBe(201);
  const { accessToken } = await registration.json() as { accessToken: string };
  const auth = { Authorization: `Bearer ${accessToken}` };
  const accounts = (await (await api.get('v1/accounts', { headers: auth })).json() as { items: Account[] }).items;
  return { email, password, auth, accounts };
}

async function transfer(api: APIRequestContext, auth: Record<string, string>, body: Record<string, string>) {
  const response = await api.post('v1/transfers', { headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() }, data: body });
  expect(response.status(), 'transfer below the OTP threshold completes').toBe(201);
  return response.json() as Promise<{ id: string; amountMinor: string; concept: string; reference: string }>;
}

/** Business day `YYYY-MM-DD` of an instant in the demo business zone (America/Mexico_City). */
const businessDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const previousDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

async function login(page: Page, email: string, password: string) {
  // The pre-login session probe is answered locally so it never spends the shared refresh limiter.
  await page.route('**/v1/auth/refresh', (route) => route.fulfill({ status: 204, body: '' }));
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.unroute('**/v1/auth/refresh');
}

test.describe('WF-T2 [I] P1', () => {
  test('W03-F3, W04-F1/F3/F5, W05-F1, FN-12, FN-13 and I-W03-10 against the real API', async ({ browser }) => {
    test.setTimeout(180_000);
    const api = await playwrightRequest.newContext({ baseURL: P1.api, extraHTTPHeaders: { Origin: P1.web } });
    const metrics: Record<string, unknown> = {};
    let ownerEmail = ''; let ownerPassword = ''; let checking!: Account; let savings!: Account;
    let thirdPartyTransferId = '';
    try {
      const owner = await apiUser(api, 'Persona Prueba Integración');
      const sender = await apiUser(api, 'Persona Prueba Remitente');
      ownerEmail = owner.email; ownerPassword = owner.password;
      checking = owner.accounts.find((account) => account.kind === 'checking')!;
      savings = owner.accounts.find((account) => account.kind === 'savings')!;
      expect(owner.accounts).toHaveLength(2);
      // Third-party credit into the owner's checking account (D-10 [I]).
      const csrf = await api.get('v1/auth/csrf');
      const { csrfToken } = await csrf.json() as { csrfToken: string };
      const beneficiary = await api.post('v1/beneficiaries', { headers: { ...sender.auth, 'X-CSRF-Token': csrfToken }, data: { name: 'Persona Prueba Integración', alias: 'Integración', clabe: checking.clabe } });
      expect(beneficiary.status()).toBe(201);
      const beneficiaryId = (await beneficiary.json() as { id: string }).id;
      const senderChecking = sender.accounts.find((account) => account.kind === 'checking')!;
      thirdPartyTransferId = (await transfer(api, sender.auth, { sourceAccountId: senderChecking.id, destinationType: 'beneficiary', beneficiaryId, amountMinor: '2500', concept: 'Abono de tercero', reference: '31' })).id;
      // 21 own-account transfers (checking → savings), all far below the OTP threshold.
      for (let index = 1; index <= 21; index += 1) {
        await transfer(api, owner.auth, { sourceAccountId: checking.id, destinationType: 'own_account', destinationAccountId: savings.id, amountMinor: String(100 + index), concept: `Traspaso integración ${index}`, reference: String(5000 + index) });
      }
    } finally { await api.dispose(); }

    const context = await browser.newContext({ baseURL: P1.web, viewport: { width: V1440.width, height: V1440.height }, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const seen = watch(page);
    const accountResponses: Account[][] = [];
    const movementPages: Movement[][] = [];
    const transferGets: string[] = [];
    page.on('response', async (response) => {
      const url = new URL(response.url());
      if (!response.ok() || response.request().method() !== 'GET') return;
      try {
        if (url.pathname === '/v1/accounts') accountResponses.push((await response.json() as { items: Account[] }).items);
        else if (/\/v1\/accounts\/[^/]+\/movements$/.test(url.pathname) && url.searchParams.get('limit') === '20') movementPages.push((await response.json() as { items: Movement[] }).items);
      } catch { /* non-JSON */ }
    });
    page.on('request', (request) => { const path = new URL(request.url()).pathname; if (request.method() === 'GET' && path.startsWith('/v1/transfers/')) transferGets.push(path); });
    await login(page, ownerEmail, ownerPassword);

    // W03-F3: consolidated balance = exact bigint sum of the API balances; activity shows the last own transfer.
    await expect(page.getByRole('region', { name: 'Tus cuentas' }).locator('article')).toHaveCount(2);
    const apiAccounts = accountResponses.at(-1)!;
    const sum = apiAccounts.reduce((total, account) => total + BigInt(account.availableBalanceMinor), 0n);
    const totalText = await page.getByRole('region', { name: 'Saldo consolidado' }).locator('[data-amount]').innerText();
    expect(totalText.replace(/[^0-9]/g, '')).toBe(sum.toString());
    const activity = page.getByRole('region', { name: 'Actividad Reciente' });
    await expect(activity.locator('tbody tr').first()).toContainText('Traspaso integración 21');
    await expect(activity.locator('tbody tr').first()).toContainText('−$1.21 MXN');
    await expect(activity.locator('tbody tr').first()).toContainText(savings.name);
    await settle(page);
    await shoot(page, 'I-W03-cuentas', { scenario: 'I-W03-9', screen: 'W03', state: 'P1 real tras transferencias', reference: 'w03_inicio_y_cuentas_corregido' }, V1440, 'I');
    metrics['W03-F3'] = { accounts: apiAccounts.length, consolidatedEqualsBigIntSum: true, firstActivity: 'Traspaso integración 21 · −$1.21 MXN' };

    // W04-F1 [I]: 22 movements on checking → 20 + «Cargar más» → 22, unique ids, newest first.
    await page.getByRole('link', { name: 'Ver historial completo' }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${checking.id}/movements$`));
    const rows = page.locator('tbody tr.hist-row');
    await expect(rows).toHaveCount(20);
    await page.getByRole('button', { name: 'Cargar más movimientos' }).click();
    await expect(rows).toHaveCount(22);
    await expect(page.getByRole('button', { name: 'Cargar más movimientos' })).toHaveCount(0);
    const allMovements = movementPages.flat();
    expect(new Set(allMovements.map((item) => item.id)).size).toBe(22);
    const concepts = await rows.locator('.hist-concept .hist-wrap').allTextContents();
    expect(concepts).toEqual(allMovements.map((item) => item.concept));
    await shoot(page, 'I-W04-historial', { scenario: 'I-W04-8', screen: 'W04', state: 'P1 real, 22 movimientos tras «Cargar más»', reference: 'w04_historial_con_movimientos' }, V1440, 'I');
    metrics['W04-F1 [I]'] = { pages: movementPages.length, rows: 22, unique: true, order: 'igual a la API' };

    // W04-F5 [I]: third-party credit → inline panel without GET /transfers/{id}.
    const creditRow = rows.filter({ hasText: 'Abono de tercero' });
    await creditRow.getByRole('button', { name: 'Ver detalle' }).click();
    await expect(creditRow.getByRole('button', { name: 'Ver detalle' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('tr.hist-inline:not([hidden])')).toContainText('Persona Prueba Remitente');
    expect(transferGets.filter((path) => path.includes(thirdPartyTransferId))).toEqual([]);
    metrics['W04-F5 [I] tercero'] = { inline: true, getTransfers: 0 };

    // W04-F3 [I]: filter by the real business day of the newest movement, then by the previous day.
    const newest = allMovements[0]!;
    const day = businessDay(newest.occurredAt);
    await page.getByLabel('Desde').fill(day);
    await page.getByLabel('Hasta').fill(day);
    await expect(rows.first()).toContainText(newest.concept);
    await page.getByLabel('Desde').fill(previousDay(day));
    await page.getByLabel('Hasta').fill(previousDay(day));
    await expect(page.locator('.hist-empty')).toContainText('No encontramos movimientos con los filtros seleccionados');
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(rows).toHaveCount(20);
    metrics['W04-F3 [I]'] = { day, included: newest.concept, previousDay: previousDay(day), previousDayRows: 0 };

    // W04-F5 / FN-13 / W05-F1 [I]: own row → W05 with GET /transfers/{transferId of the row}.
    const own = allMovements.find((item) => item.concept === 'Traspaso integración 20')!;
    const transferResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/v1/transfers/${own.transferId}` && response.request().method() === 'GET');
    await rows.filter({ hasText: 'Traspaso integración 20' }).getByRole('link', { name: 'Ver detalle' }).click();
    const detail = await (await transferResponse).json() as { amountMinor: string; concept: string; reference: string; receiptReference?: string; id: string };
    await expect(page.getByRole('heading', { level: 1, name: 'Comprobante de transferencia' })).toBeVisible();
    const card = page.locator('article.mr-card');
    expect(detail.amountMinor).toBe(own.amountMinor);
    expect(detail.concept).toBe(own.concept);
    expect(detail.reference).toBe(own.reference);
    await expect(card.locator('.mr-amount-panel [data-amount]')).toHaveText('$1.20 MXN');
    await expect(card.locator('.mr-detail dd')).toHaveText([/\d{1,2} de [a-z]+ de \d{4}, \d{2}:\d{2}/, own.concept, own.reference]);
    await expect(card.locator('.mr-folio-value').first()).toHaveText(detail.receiptReference || detail.id);
    await shoot(page, 'I-W05-comprobante', { scenario: 'I-W05-5', screen: 'W05', state: 'P1 real desde historial', reference: 'w05_comprobante_de_transferencia' }, V1440, 'I');
    await card.getByRole('link', { name: 'Volver a Movimientos' }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${checking.id}/movements$`));
    metrics['FN-13 / W05-F1 [I]'] = { get: 'GET /v1/transfers/{transferId de la fila}', equal: ['amountMinor', 'concept', 'reference'], back: '/accounts/{checking}/movements' };

    // FN-12 [I]: a transfer made in the UI is the first row of «Ver movimientos» without reloading.
    await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Transferir' }).click();
    await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
    // WF-T4 (W08 D-8): origin = first account (checking) by default; the destination radio is chosen by name.
    await expect(page.getByRole('group', { name: 'Cuenta de origen' })).toContainText(checking.name);
    await page.getByRole('radiogroup', { name: 'Cuenta de destino' }).getByRole('radio', { name: savings.name, exact: true }).click();
    await page.getByLabel('Importe a transferir').fill('0.33');
    await page.getByLabel('Concepto').fill('Prueba FN-12');
    await page.getByLabel('Referencia numérica').fill('1212');
    await page.getByRole('button', { name: /Continuar a revisión/ }).click();
    await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
    await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Ver movimientos' }).click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${checking.id}/movements$`));
    await expect(rows.first()).toContainText('Prueba FN-12');
    await expect(rows.first()).toContainText('Ref. 1212');
    await expect(rows.first().locator('[data-amount]')).toHaveText('−$0.33 MXN');
    metrics['FN-12 [I]'] = { firstRow: 'Prueba FN-12 · Ref. 1212 · −$0.33 MXN', reload: false };

    // I-W03-10: real lost response (server applies the transfer, the browser never sees the answer).
    const balanceBefore = BigInt(accountResponses.at(-1)!.find((account) => account.id === checking.id)!.availableBalanceMinor);
    let lost = false;
    await page.route('**/v1/transfers', async (route) => {
      if (route.request().method() !== 'POST' || lost) return route.fallback();
      lost = true;
      await route.fetch();
      await route.abort('connectionreset');
    });
    await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Transferir' }).click();
    await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
    // WF-T4 (W08 D-8): origin = first account (checking) by default; the destination radio is chosen by name.
    await expect(page.getByRole('group', { name: 'Cuenta de origen' })).toContainText(checking.name);
    await page.getByRole('radiogroup', { name: 'Cuenta de destino' }).getByRole('radio', { name: savings.name, exact: true }).click();
    await page.getByLabel('Importe a transferir').fill('0.47');
    await page.getByLabel('Concepto').fill('Respuesta perdida');
    await page.getByLabel('Referencia numérica').fill('4747');
    await page.getByRole('button', { name: /Continuar a revisión/ }).click();
    await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
    // WF-T5: W11-V3 «Resultado desconocido» (was «Estamos verificando el resultado»).
    await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Inicio' }).click();
    const notice = page.getByRole('region', { name: 'Estamos verificando el resultado de tu transferencia' });
    await expect(notice).toContainText('$0.47 MXN (Entre mis cuentas)');
    await expect(notice.getByText('Se repetirá la misma solicitud con su misma clave de operación.')).toBeVisible();
    await settle(page);
    await shoot(page, 'I-W03-aviso-pendiente', { scenario: 'I-W03-10', screen: 'W03', state: 'aviso tras respuesta perdida real', reference: 'w03_operaci_n_pendiente_de_verificaci_n' }, V1440, 'I');
    await notice.getByRole('link', { name: 'Retomar verificación' }).click();
    await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: 'Ver movimientos' }).click();
    await expect(rows.first()).toContainText('Respuesta perdida');
    await expect(rows.filter({ hasText: 'Respuesta perdida' })).toHaveCount(1);
    await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Inicio' }).click();
    await expect(page.getByRole('region', { name: 'Estamos verificando el resultado de tu transferencia' })).toHaveCount(0);
    await expect.poll(() => accountResponses.at(-1)!.find((account) => account.id === checking.id)!.availableBalanceMinor).toBe((balanceBefore - 47n).toString());
    metrics['I-W03-10'] = { notice: '$0.47 MXN (Entre mis cuentas)', retake: 'mismo POST con la misma clave → 201 reproducido', debits: 1, balanceDelta: '-47' };
    expect(seen.foreign).toEqual([]);
    expect(seen.errors.filter((text) => !/ERR_CONNECTION_RESET|Failed to load resource/.test(text))).toEqual([]);
    recordMetric('WF-T2 [I] P1', { ...metrics, provoked: seen.provoked.length });
    await context.close();
  });
});

test.describe('WF-T2 [I] P2', () => {
  test('W03-V5 [I] registro real sin saldo (fixture off) → banner, una cuenta $0.00 MXN y «Transferir» deshabilitado con razón', async ({ browser }) => {
    test.skip(!profiles.includes('P2'), 'requires WF_PROFILES to include P2');
    const context = await browser.newContext({ baseURL: P2.web, viewport: { width: V1440.width, height: V1440.height }, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const unique = crypto.randomUUID();
    await page.route('**/v1/auth/refresh', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto('/register');
    await page.getByLabel('Nombre completo').fill('Persona Prueba Cero');
    await page.getByLabel('Correo electrónico').fill(`wf-t2-p2-${unique}@example.test`);
    await page.getByLabel('Contraseña', { exact: true }).fill(`Sintetica-${unique}`);
    await page.getByLabel('Confirmar contraseña', { exact: true }).fill(`Sintetica-${unique}`);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole('region', { name: 'Tu cuenta está creada' })).toBeVisible();
    await expect(page.getByText('0 Registros')).toBeVisible();
    const card = page.getByRole('region', { name: 'Tus cuentas' }).locator('article');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('$0.00 MXN');
    await expect(card.getByRole('button', { name: /Transferir/ })).toBeDisabled();
    await settle(page);
    await shoot(page, 'I-W03-sin-saldo-P2', { scenario: 'I-W02-5/W03', screen: 'W03', state: 'P2 real sin saldo', reference: 'w03_inicio_sin_saldo' }, V1440, 'I');
    recordMetric('W03-V5 [I] P2', { accounts: 1, balance: '$0.00 MXN', transferDisabledWithReason: true });
    await context.close();
  });
});
