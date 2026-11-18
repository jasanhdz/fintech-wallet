// WF-T3 [I] FN-02 / W06-F3 / W07-F2 against the real P1 API of SPEC §5.10 (wallet_test on 55433). Synthetic users
// (@example.test) are created through the public API; nothing is seeded in the database. Full CLABEs are only compared
// as booleans so they never reach the test output (EV-03).
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { recordMetric } from './helpers/evidence.js';
import { settle, shoot, V1440, watch } from './helpers/screen.js';

const P1 = { api: 'http://127.0.0.1:3301', web: 'http://127.0.0.1:5301' };
type Account = { id: string; clabe: string };

/** CLABE with a valid control digit (weights 3-7-1) built in the test from a 17-digit prefix. */
function clabeFrom(prefix17: string) {
  const sum = [...prefix17].reduce((total, digit, index) => total + ((Number(digit) * [3, 7, 1][index % 3]!) % 10), 0);
  return `${prefix17}${(10 - (sum % 10)) % 10}`;
}

async function apiUser(fullName: string) {
  const api = await playwrightRequest.newContext({ baseURL: P1.api, extraHTTPHeaders: { Origin: P1.web } });
  try {
    const unique = crypto.randomUUID();
    const email = `wf-t3-${unique}@example.test`;
    const password = `Sintetica-${unique}`;
    const { csrfToken } = await (await api.get('v1/auth/csrf')).json() as { csrfToken: string };
    const registration = await api.post('v1/auth/register', { headers: { 'X-CSRF-Token': csrfToken }, data: { fullName, email, password } });
    expect(registration.status()).toBe(201);
    const { accessToken } = await registration.json() as { accessToken: string };
    const accounts = (await (await api.get('v1/accounts', { headers: { Authorization: `Bearer ${accessToken}` } })).json() as { items: Account[] }).items;
    return { email, password, accounts };
  } finally { await api.dispose(); }
}

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

test.describe('WF-T3 [I] P1', () => {
  test('FN-02 · W06-F3 · W07-F2: alta real (201), duplicado (409), destino no disponible (404) y CLABE incorrecta sin petición', async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await apiUser('Persona Prueba Directorio');
    const other = await apiUser('Persona Prueba Destino');
    const destination = other.accounts[0]!.clabe;
    expect(/^\d{18}$/.test(destination)).toBe(true);
    const ownClabes = new Set([...owner.accounts, ...other.accounts].map((account) => account.clabe));
    let unknown = clabeFrom(`999${String(Date.now()).slice(-13)}0`.slice(0, 17));
    while (ownClabes.has(unknown)) unknown = clabeFrom(`999${String(Math.floor(Math.random() * 1e14)).padStart(14, '0')}`);
    const wrongDigit = `${unknown.slice(0, 17)}${(Number(unknown[17]) + 1) % 10}`;

    const context = await browser.newContext({ baseURL: P1.web, viewport: { width: V1440.width, height: V1440.height }, locale: 'es-MX', timezoneId: 'America/Mexico_City', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const seen = watch(page);
    const posts: number[] = [];
    page.on('response', (response) => { if (response.request().method() === 'POST' && new URL(response.url()).pathname === '/v1/beneficiaries') posts.push(response.status()); });
    const metrics: Record<string, unknown> = {};
    await login(page, owner.email, owner.password);

    // W06 before the first registration (fixture data never adds beneficiaries to a new user).
    await page.getByRole('navigation', { name: 'Navegación principal' }).first().getByRole('link', { name: 'Beneficiarios' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mis beneficiarios' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Aún no tienes beneficiarios registrados' })).toBeVisible();
    await settle(page);
    await shoot(page, 'I-W06-vacio', { scenario: 'I-W06-7', screen: 'W06', state: 'vacío [I]', reference: 'w06_sin_beneficiarios' }, V1440, 'I');

    // 201: the other synthetic user's real CLABE.
    await page.getByRole('region', { name: 'Aún no tienes beneficiarios registrados' }).getByRole('link', { name: 'Agregar beneficiario' }).click();
    await expect(page).toHaveURL(/\/beneficiaries\/new$/);
    const fill = async (clabe: string) => {
      await page.getByLabel('Nombre completo o razón social').fill('Persona Prueba Destino');
      await page.getByLabel('Alias o nombre corto').fill('Destino');
      await page.getByLabel('CLABE de 18 dígitos').fill(clabe);
    };
    await fill(destination);
    await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
    await expect(page).toHaveURL(/\/beneficiaries$/);
    await expect(page.getByRole('status').filter({ hasText: 'agregado' })).toHaveText('Beneficiario “Destino” agregado.');
    const card = page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article');
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: 'Persona Prueba Destino' })).toBeVisible();
    expect(await card.locator('[data-clabe]').innerText() === `•••• ${destination.slice(-4)}`, 'W06 shows only the last four digits').toBe(true);
    expect((await page.content()).includes(destination), 'the full CLABE never reaches the DOM').toBe(false);
    expect((await page.content()).includes(destination.slice(0, 3) + '•••'), 'the 3+4 mask from the API is not shown either').toBe(false);
    const transferHref = await card.getByRole('link', { name: 'Transferir a Persona Prueba Destino' }).getAttribute('href');
    expect(transferHref).toMatch(/^\/transfers\/new\?beneficiaryId=[0-9a-f-]{36}$/);
    await settle(page);
    await shoot(page, 'I-W06-alta', { scenario: 'I-W06-7', screen: 'W06', state: 'tras FN-02 (201)', reference: 'w06_directorio_de_beneficiarios_1' }, V1440, 'I');
    metrics.created = { status: posts.at(-1), notice: 'Beneficiario “Destino” agregado.', masked: '•••• NNNN (últimos 4)', fullClabeInDom: false };

    // 409: same CLABE again.
    await page.getByRole('link', { name: 'Agregar beneficiario' }).click();
    await fill(destination);
    await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
    const duplicate = page.getByRole('alert').filter({ hasText: 'Beneficiario duplicado' });
    await expect(duplicate).toContainText('Ya tienes registrado un beneficiario con esta misma CLABE.');
    await expect(page.locator('#clabe-meta')).toHaveText('Cuenta ya registrada');
    await expect(page.getByRole('link', { name: 'Ver en directorio' })).toHaveAttribute('href', '/beneficiaries');
    expect(posts.at(-1)).toBe(409);
    await settle(page);
    await shoot(page, 'I-W07-duplicado', { scenario: 'I-W07-8', screen: 'W07', state: 'duplicado (409 real)', reference: 'w07_beneficiario_duplicado' }, V1440, 'I');

    // 404: valid control digit, no Billetera MXN account.
    await page.getByRole('button', { name: 'Modificar datos' }).click();
    await expect(page.getByLabel('CLABE de 18 dígitos')).toBeFocused();
    await page.getByLabel('CLABE de 18 dígitos').fill(unknown);
    await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
    const unavailable = page.getByRole('alert').filter({ hasText: 'Destino no disponible en la plataforma' });
    await expect(unavailable).toContainText('Esta cuenta no pertenece a Billetera MXN. Revisa la CLABE de 18 dígitos e intenta nuevamente.');
    expect(posts.at(-1)).toBe(404);
    await settle(page);
    await shoot(page, 'I-W07-destino-no-disponible', { scenario: 'I-W07-8', screen: 'W07', state: 'destino no disponible (404 real)', reference: 'w07_destino_no_disponible' }, V1440, 'I');

    // Wrong control digit: W07 «CLABE incorrecta» and no request.
    const before = posts.length;
    await page.getByLabel('CLABE de 18 dígitos').fill(wrongDigit);
    await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Verifica la información capturada' })).toBeVisible();
    await page.waitForTimeout(300);
    expect(posts.length).toBe(before);
    await settle(page);
    await shoot(page, 'I-W07-clabe-incorrecta', { scenario: 'I-W07-8', screen: 'W07', state: 'CLABE incorrecta (sin petición)', reference: 'w07_clabe_incorrecta' }, V1440, 'I');

    // The directory still has exactly the one beneficiary.
    await page.getByRole('link', { name: 'Cancelar' }).click();
    await expect(page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article')).toHaveCount(1);
    metrics.sequence = posts;
    metrics.checksumWithoutRequest = true;
    expect(posts).toEqual([201, 409, 404]);
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    recordMetric('WF-T3 [I] FN-02', { ...metrics, provoked: seen.provoked });
    await context.close();
  });
});
