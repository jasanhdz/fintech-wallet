// Scenario registry of docs/web-ux-polish/SPEC.md §7.4 (visual review «antes»/«después»). Each scenario drives the
// app with the simulated API ([F]) to one screen state. Selectors are roles/labels so later tandas keep them working;
// a tanda that renames a control updates the driver here (never the network replies). Synthetic data only.
import { expect, type Page, type Route } from '@playwright/test';
import * as data from '../fixtures/data.js';
import { installMockApi, type MockApi, type MockState } from './mock-api.js';

export type UxScenario = { id: string; screen: string; state: string; open: (page: Page) => Promise<void> };

export const NOW = new Date('2026-11-17T16:00:00.000Z');
const problem = (status: number, detail: string, title = 'Error') => ({ status, body: data.problem(status, detail, title) });
const [checking, savings] = data.accounts() as [data.Account, data.Account];
const otherClabe = data.maskClabe(data.clabeFrom('64618000000000864'));

async function mock(page: Page, initial: Partial<MockState> = {}): Promise<MockApi> {
  await page.clock.setFixedTime(NOW);
  return installMockApi(page, initial);
}
const never = () => new Promise<void>(() => undefined);
const h1 = (page: Page, name?: string | RegExp) => expect(page.getByRole('heading', { level: 1, ...(name ? { name } : {}) }).first()).toBeVisible();

const seedRecord = (page: Page, record: unknown) => page.addInitScript(({ userId, key, raw }) => {
  if (sessionStorage.getItem('ux-seeded')) return;
  sessionStorage.setItem('ux-seeded', '1');
  sessionStorage.setItem('wallet:web:active-user', userId);
  sessionStorage.setItem(key, raw);
}, { userId: data.user.id, key: `wallet:web:transfer-attempt:${data.user.id}`, raw: JSON.stringify(record) });
const pendingRecord = (transferId?: string) => ({
  key: 'synthetic-key-ux-0000000000000001',
  body: { sourceAccountId: data.ids.checking, destinationType: 'beneficiary', beneficiaryId: data.ids.beneficiary, amountMinor: '45075', concept: 'Pago pendiente de prueba', reference: '7788' },
  ...(transferId ? { transferId } : {}),
});

// ── W03 / W04 data ──
const recent = (): data.Movement[] => [
  data.movement({ id: 'mv-r1', transferId: data.ids.transfer1, amountMinor: '12300', concept: 'Pago de prueba', reference: '4321', occurredAt: '2026-11-17T16:00:01.000Z' }),
  data.movement({ id: 'mv-r2', transferId: data.ids.transfer2, type: 'credit', amountMinor: '45075', concept: 'Traspaso de prueba', reference: '1200', occurredAt: '2026-11-16T15:10:00.000Z', counterparty: { name: savings.name, clabeMasked: savings.clabeMasked, ownAccountId: savings.id } }),
  data.movement({ id: 'mv-r3', transferId: '9c4a0000-0000-4000-8000-000000000403', amountMinor: '9990', concept: 'Servicio de prueba', reference: '55', occurredAt: '2026-11-15T17:20:00.000Z', counterparty: { name: 'Persona Prueba Tres', clabeMasked: otherClabe } }),
];
function history(count: number, debitsOnly = false): data.Movement[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    const occurredAt = new Date(Date.parse('2026-11-17T17:00:00.000Z') - index * 3_600_000 * 7).toISOString();
    const transferId = `9c4a0000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`;
    if (!debitsOnly && n % 4 === 2) return data.movement({ id: `mv-h${n}`, transferId, type: 'credit', amountMinor: String(10000 + n * 137), concept: `Abono de prueba ${n}`, reference: String(9000 + n), occurredAt, counterparty: { name: 'Persona Prueba Cuatro', clabeMasked: otherClabe } });
    if (!debitsOnly && n % 4 === 3) return data.movement({ id: `mv-h${n}`, transferId, type: 'credit', amountMinor: String(20000 + n * 211), concept: `Traspaso propio ${n}`, reference: String(7000 + n), occurredAt, counterparty: { name: savings.name, clabeMasked: savings.clabeMasked, ownAccountId: savings.id } });
    return data.movement({ id: `mv-h${n}`, transferId, amountMinor: String(5000 + n * 173), concept: `Envío de prueba ${n}`, reference: String(100 + n), occurredAt });
  });
}
/** Paged movements honouring `type`, `cursor` and `limit`; optional hold or failures (first page / next pages). */
async function routeMovements(page: Page, list: data.Movement[], options: { hold?: boolean; failFirst?: boolean; failCursor?: boolean } = {}) {
  await page.route(/\/v1\/accounts\/[^/]+\/movements/, async (route: Route) => {
    const url = new URL(route.request().url());
    if (options.hold) await never();
    const cursor = url.searchParams.get('cursor');
    const fail = () => route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) });
    if (options.failFirst && !cursor) return fail();
    if (options.failCursor && cursor) return fail();
    const type = url.searchParams.get('type');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const filtered = list.filter((item) => !type || item.type === type);
    const start = cursor ? Number.parseInt(cursor.replace('c', ''), 10) : 0;
    const items = filtered.slice(start, start + limit);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor: start + limit < filtered.length ? `c${start + limit}` : null }) });
  });
}
const historyPath = `/accounts/${data.ids.checking}/movements`;

// ── W06 / W07 data ──
function beneficiaries(count: number): data.Beneficiary[] {
  const names = ['Persona Prueba Dos', 'Persona Prueba Cinco', 'Persona Prueba Siete', 'Persona Prueba Ocho', 'Persona Prueba Nueve'];
  return Array.from({ length: count }, (_, index) => index === 0 ? data.beneficiary() : data.beneficiary({
    id: `8b3f0000-0000-4000-8000-00000000020${index + 1}`, name: names[index]!, alias: names[index]!.split(' ').at(-1)!,
    clabeMasked: data.maskClabe(data.clabeFrom(`6461800000000057${index}`)), destinationAccountId: `7a2e0000-0000-4000-8000-00000000030${index + 1}`,
  }));
}
const W07_LABELS = ['Nombre completo o razón social', 'Alias o nombre corto', 'CLABE de 18 dígitos'] as const;
const newClabe = data.clabeFrom('64618000000000686');
const wrongDigitClabe = `${newClabe.slice(0, 17)}${(Number(newClabe[17]) + 1) % 10}`;
const typed = { name: 'Persona Prueba Seis', alias: 'Seis', clabe: newClabe };
async function fillBeneficiary(page: Page, values: { name: string; alias: string; clabe: string }) {
  await page.getByLabel(W07_LABELS[0]).fill(values.name);
  await page.getByLabel(W07_LABELS[1]).fill(values.alias);
  await page.getByLabel(W07_LABELS[2]).fill(values.clabe);
}
const saveBeneficiary = (page: Page) => page.getByRole('button', { name: 'Guardar beneficiario' }).click();
async function w07(page: Page, reach?: (api: MockApi) => Promise<void>) {
  const api = await mock(page);
  await page.goto('/beneficiaries/new');
  await h1(page);
  await reach?.(api);
}

// ── W08 / W09 / W13 ──
async function fillTransfer(page: Page, values: { amount?: string; concept?: string; reference?: string }) {
  if (values.amount !== undefined) await page.getByLabel('Importe a transferir').fill(values.amount);
  if (values.concept !== undefined) await page.getByLabel('Concepto').fill(values.concept);
  if (values.reference !== undefined) await page.getByLabel('Referencia numérica').fill(values.reference);
}
const toReview = (page: Page) => page.getByRole('button', { name: /Continuar a revisión/ }).click();
const send = (page: Page) => page.getByRole('button', { name: /^(Confirmar transferencia|Continuar a verificación|Enviar transferencia)$/ }).click();
async function w08(page: Page, path: string, initial: Partial<MockState>, values: { amount?: string; concept?: string; reference?: string }) {
  await mock(page, initial);
  await page.goto(path);
  await h1(page);
  await fillTransfer(page, values);
}
async function w09(page: Page, path: string, values: { amount: string; concept: string; reference: string }, initial: Partial<MockState> = {}) {
  await w08(page, path, initial, values);
  await toReview(page);
  await h1(page, 'Revisa y confirma tu transferencia');
}

// ── W10 / W11 / W12 ──
const awaiting = (overrides: Partial<data.Transfer> = {}) => data.transfer({
  status: 'awaiting_confirmation', amountMinor: '412345', concept: 'Honorarios de prueba', reference: '204801', completedAt: null, receiptReference: null,
  createdAt: '2026-11-17T15:59:00.000Z', expiresAt: '2026-11-17T16:04:09.000Z', demoOnlyCode: '246810', ...overrides,
});
const completed = (overrides: Partial<data.Transfer> = {}) => data.transfer({ amountMinor: '412345', concept: 'Honorarios de prueba', reference: '204801', completedAt: '2026-11-17T16:00:30.000Z', receiptReference: null, ...overrides });
async function openStatus(page: Page, transfer: data.Transfer, initial: Partial<MockState> = {}) {
  await mock(page, { transfers: new Map([[transfer.id, transfer]]), ...initial });
  await page.goto(`/transfers/${transfer.id}/status`);
  await h1(page);
}
const otp = (page: Page) => page.getByLabel('Código de confirmación de 6 dígitos');
const authorize = (page: Page) => page.getByRole('button', { name: /^Autorizar transferencia/ });
async function w10(page: Page, state: 'vacio' | 'completo' | 'verificando' | 'incorrecto' | 'expirado' | 'agotados') {
  if (state === 'expirado') return openStatus(page, awaiting({ status: 'expired' }));
  const replies: Record<string, MockState['confirmReplies']> = { incorrecto: [problem(422, 'Código incorrecto.', 'Unprocessable Entity')], agotados: [problem(429, 'Se agotaron los intentos.', 'Too Many Requests')] };
  await openStatus(page, awaiting(), { confirmReplies: replies[state] ?? [] });
  if (state === 'vacio') return;
  await otp(page).fill('246810');
  if (state === 'completo') return;
  if (state === 'verificando') {
    await page.route('**/v1/transfers/*/confirm', async () => { await never(); });
    await authorize(page).click();
    await expect(page.getByRole('button', { name: /Verificando/ })).toBeDisabled();
    return;
  }
  await authorize(page).click();
  if (state === 'incorrecto') await expect(page.getByRole('alert').filter({ hasText: 'Código incorrecto' }).first()).toBeVisible();
  else await h1(page, 'Operación suspendida');
}
const w11Values = { amount: '912.34', concept: 'Pago de prueba', reference: '7788' };

// ── Access ──
async function anonymous(page: Page, path: string, initial: Partial<MockState> = {}) {
  await mock(page, { authenticated: false, ...initial });
  await page.goto(path);
  await h1(page);
}

export const SCENARIOS: UxScenario[] = [
  { id: 'W01-listo', screen: 'W01', state: 'listo', open: (page) => anonymous(page, '/login') },
  { id: 'W01-error', screen: 'W01', state: 'con error', open: async (page) => {
    await anonymous(page, '/login', { overrides: new Map([['POST /auth/login', problem(401, 'Correo o contraseña incorrectos.', 'Unauthorized')]]) });
    await page.getByLabel('Correo electrónico').fill('persona.uno@example.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('Sintetica-Prueba-2026');
    await page.getByRole('button', { name: /Iniciar sesión/ }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
  } },
  { id: 'W02-errores', screen: 'W02', state: 'con errores', open: async (page) => {
    await anonymous(page, '/register');
    await page.getByRole('button', { name: /Crear cuenta/ }).click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
  } },
  { id: 'W03-con-saldo', screen: 'W03', state: 'con saldo', open: async (page) => { await mock(page, { movements: recent() }); await page.goto('/accounts'); await h1(page); await expect(page.locator('main table tbody tr').first()).toBeVisible(); } },
  { id: 'W03-sin-saldo', screen: 'W03', state: 'sin saldo', open: async (page) => {
    await mock(page, { accounts: data.accounts().map((account) => ({ ...account, availableBalanceMinor: '0' })), movements: [] });
    await page.goto('/accounts'); await h1(page);
    await expect(page.getByText('Aún no tienes movimientos registrados')).toBeVisible();
  } },
  { id: 'W03-aviso-pendiente', screen: 'W03', state: 'con aviso pendiente', open: async (page) => {
    await seedRecord(page, pendingRecord());
    await mock(page, { movements: recent() }); await page.goto('/accounts'); await h1(page);
    await expect(page.getByText('Estamos verificando el resultado de tu transferencia')).toBeVisible();
  } },
  { id: 'W03-cargando', screen: 'W03', state: 'cargando', open: async (page) => {
    await mock(page, { movements: recent() });
    await page.route('**/v1/accounts', async () => { await never(); });
    await page.goto('/accounts'); await h1(page);
  } },
  { id: 'W04-con-movimientos', screen: 'W04', state: 'con movimientos (22)', open: async (page) => { await mock(page); await routeMovements(page, history(22)); await page.goto(historyPath); await h1(page); await expect(page.locator('main tbody tr').first()).toBeVisible(); } },
  { id: 'W04-vacio', screen: 'W04', state: 'vacío', open: async (page) => { await mock(page); await routeMovements(page, []); await page.goto(historyPath); await h1(page); await expect(page.getByText('Aún no tienes movimientos')).toBeVisible(); } },
  { id: 'W04-sin-resultados', screen: 'W04', state: 'sin resultados', open: async (page) => {
    await mock(page); await routeMovements(page, history(6, true)); await page.goto(historyPath); await h1(page);
    await expect(page.locator('main tbody tr').first()).toBeVisible();
    await page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Entradas' }).click();
    await expect(page.getByText('No encontramos movimientos con los filtros seleccionados')).toBeVisible();
  } },
  { id: 'W04-cargando', screen: 'W04', state: 'cargando', open: async (page) => { await mock(page); await routeMovements(page, [], { hold: true }); await page.goto(historyPath); await h1(page); } },
  { id: 'W04-error', screen: 'W04', state: 'error', open: async (page) => { await mock(page); await routeMovements(page, [], { failFirst: true }); await page.goto(historyPath); await h1(page); await expect(page.getByText('No pudimos cargar los movimientos.')).toBeVisible(); } },
  { id: 'W04-error-mas', screen: 'W04', state: 'error al cargar más', open: async (page) => {
    await mock(page); await routeMovements(page, history(22), { failCursor: true }); await page.goto(historyPath); await h1(page);
    await page.getByRole('button', { name: /Cargar más/ }).click();
    await expect(page.getByText('No pudimos cargar más movimientos.')).toBeVisible();
  } },
  { id: 'W05', screen: 'W05', state: 'comprobante', open: async (page) => {
    await mock(page, { transfers: new Map([[data.ids.transfer1, data.transfer()]]) });
    await page.goto(`/transfers/${data.ids.transfer1}/movement-receipt`); await h1(page);
    await expect(page.getByRole('link', { name: 'Ir a Inicio' })).toBeVisible();
  } },
  ...[1, 2, 5].map((count) => ({ id: `W06-lista-${count}`, screen: 'W06', state: `lista (${count})`, open: async (page: Page) => {
    await mock(page, { beneficiaries: beneficiaries(count) }); await page.goto('/beneficiaries'); await h1(page);
    await expect(page.locator('main article')).toHaveCount(count);
  } })),
  { id: 'W06-vacio', screen: 'W06', state: 'vacío', open: async (page) => { await mock(page, { beneficiaries: [] }); await page.goto('/beneficiaries'); await h1(page); await expect(page.locator('main a[href="/beneficiaries/new"]').first()).toBeVisible(); } },
  { id: 'W06-sin-resultados', screen: 'W06', state: 'sin resultados', open: async (page) => {
    await mock(page, { beneficiaries: beneficiaries(2) }); await page.goto('/beneficiaries'); await h1(page);
    await page.getByRole('searchbox', { name: 'Buscar beneficiarios' }).fill('sin coincidencia');
    await expect(page.getByText('No encontramos beneficiarios con esa búsqueda').first()).toBeVisible();
  } },
  { id: 'W07-inicial', screen: 'W07', state: 'inicial', open: (page) => w07(page) },
  { id: 'W07-invalidos', screen: 'W07', state: 'inválidos', open: (page) => w07(page, async () => { await page.getByLabel(W07_LABELS[2]).fill('71096900'); await saveBeneficiary(page); await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible(); }) },
  { id: 'W07-clabe-incorrecta', screen: 'W07', state: 'CLABE incorrecta', open: (page) => w07(page, async () => { await fillBeneficiary(page, { ...typed, clabe: wrongDigitClabe }); await saveBeneficiary(page); await expect(page.getByLabel(W07_LABELS[2])).toHaveAttribute('aria-invalid', 'true'); }) },
  { id: 'W07-duplicado', screen: 'W07', state: 'duplicado', open: (page) => w07(page, async (api) => { api.state.overrides.set('POST /beneficiaries', problem(409, 'El beneficiario ya está registrado.', 'Conflict')); await fillBeneficiary(page, typed); await saveBeneficiary(page); await expect(page.getByRole('link', { name: /Ver en directorio/ }).or(page.getByRole('button', { name: /Ver en directorio/ })).first()).toBeVisible(); }) },
  { id: 'W07-destino-no-disponible', screen: 'W07', state: 'destino no disponible', open: (page) => w07(page, async (api) => { api.state.overrides.set('POST /beneficiaries', problem(404, 'No se encontró una cuenta interna.', 'Not Found')); await fillBeneficiary(page, typed); await saveBeneficiary(page); await expect(page.getByLabel(W07_LABELS[2])).toHaveAttribute('aria-invalid', 'true'); }) },
  { id: 'W07-guardando', screen: 'W07', state: 'guardando', open: (page) => w07(page, async () => { await page.route('**/v1/beneficiaries', async (route) => { if (route.request().method() === 'POST') await never(); return route.fallback(); }); await fillBeneficiary(page, typed); await saveBeneficiary(page); await expect(page.getByRole('button', { name: /Guardando/ })).toBeDisabled(); }) },
  { id: 'W07-error-recuperable', screen: 'W07', state: 'error recuperable', open: (page) => w07(page, async (api) => { api.state.overrides.set('POST /beneficiaries', problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')); await fillBeneficiary(page, typed); await saveBeneficiary(page); await expect(page.getByRole('button', { name: 'Reintentar guardar' })).toBeVisible(); }) },
  { id: 'W08-beneficiario', screen: 'W08', state: 'beneficiario', open: (page) => w08(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, {}, { amount: '1250.50', concept: 'Pago de prueba', reference: '4321' }) },
  { id: 'W08-propias', screen: 'W08', state: 'propias', open: (page) => w08(page, '/transfers/new?type=own_account', {}, { amount: '1500', concept: 'Traspaso a ahorro', reference: '204803' }) },
  { id: 'W08-errores', screen: 'W08', state: 'errores', open: async (page) => { await w08(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, {}, { amount: '0', reference: 'REF-99X' }); await toReview(page); await expect(page.getByLabel('Importe a transferir')).toHaveAttribute('aria-invalid', 'true'); } },
  { id: 'W08-sin-beneficiarios', screen: 'W08', state: 'sin beneficiarios', open: (page) => w08(page, '/transfers/new', { beneficiaries: [] }, { amount: '3500' }) },
  { id: 'W08-sin-segunda-cuenta', screen: 'W08', state: 'sin segunda cuenta', open: (page) => w08(page, '/transfers/new?type=own_account', { accounts: [data.account()] }, { amount: '12500' }) },
  { id: 'W09-normal', screen: 'W09', state: 'normal', open: (page) => w09(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '1250', concept: 'Pago de prueba', reference: '4321' }) },
  { id: 'W09-codigo', screen: 'W09', state: 'código', open: (page) => w09(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '7000', concept: 'Servicios profesionales', reference: '204802' }) },
  { id: 'W09-propias', screen: 'W09', state: 'propias', open: (page) => w09(page, '/transfers/new?type=own_account', { amount: '1500', concept: 'Traspaso a ahorro', reference: '204803' }) },
  { id: 'W10-vacio', screen: 'W10', state: 'vacío', open: (page) => w10(page, 'vacio') },
  { id: 'W10-completo', screen: 'W10', state: 'completo', open: (page) => w10(page, 'completo') },
  { id: 'W10-verificando', screen: 'W10', state: 'verificando', open: (page) => w10(page, 'verificando') },
  { id: 'W10-incorrecto', screen: 'W10', state: 'incorrecto', open: (page) => w10(page, 'incorrecto') },
  { id: 'W10-expirado', screen: 'W10', state: 'expirado', open: (page) => w10(page, 'expirado') },
  { id: 'W10-agotados', screen: 'W10', state: 'agotados', open: (page) => w10(page, 'agotados') },
  { id: 'W11-enviando', screen: 'W11', state: 'enviando', open: async (page) => {
    await w09(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, w11Values, { policy: data.policy({ otpThresholdMinor: '99999999' }) });
    await page.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') await never(); return route.fallback(); });
    await send(page);
    await h1(page, 'Enviando transferencia');
  } },
  { id: 'W11-verificando', screen: 'W11', state: 'verificando', open: async (page) => {
    await seedRecord(page, pendingRecord(data.ids.transfer1));
    await mock(page, { transfers: new Map([[data.ids.transfer1, completed()]]) });
    await page.route(`**/v1/transfers/${data.ids.transfer1}`, async () => { await never(); });
    await page.goto('/transfers/new');
    await h1(page, 'Estamos verificando si tu transferencia se completó');
  } },
  { id: 'W11-desconocido', screen: 'W11', state: 'desconocido', open: async (page) => {
    await w09(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, w11Values, { policy: data.policy({ otpThresholdMinor: '99999999' }), createReplies: ['abort'] });
    await send(page);
    await h1(page, 'No pudimos confirmar el resultado');
  } },
  { id: 'W12-beneficiario', screen: 'W12', state: 'beneficiario', open: async (page) => { await openStatus(page, completed()); await h1(page, '¡Transferencia completada con éxito!'); } },
  { id: 'W12-propias', screen: 'W12', state: 'propias', open: async (page) => { await openStatus(page, completed({ destination: savings, concept: 'Traspaso a ahorro', reference: '9911', amountMinor: '150075' })); await h1(page, '¡Transferencia completada con éxito!'); } },
  { id: 'W13-saldo', screen: 'W13', state: 'saldo', open: async (page) => {
    await w09(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '8000', concept: 'Rechazo', reference: '913' }, { policy: data.policy({ otpThresholdMinor: '99999999' }), createReplies: [problem(422, 'Saldo insuficiente.', 'Unprocessable Entity')] });
    await send(page); await h1(page, 'Transferencia rechazada: Saldo insuficiente');
  } },
  { id: 'W13-limite', screen: 'W13', state: 'límite', open: async (page) => {
    await w09(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '850', concept: 'Rechazo', reference: '913' }, { policy: data.policy({ dailyLimitMinor: '2000000', dailyUsedMinor: '1950000', dailyRemainingMinor: '50000' }), createReplies: [problem(429, 'Se excedió el límite diario.', 'Too Many Requests')] });
    await send(page); await h1(page, 'Transferencia rechazada: Límite diario alcanzado');
  } },
  { id: 'W14-vencida', screen: 'W14', state: 'vencida', open: (page) => anonymous(page, '/session-expired') },
  { id: 'W14-vencida-pendiente', screen: 'W14', state: 'vencida con pendiente', open: async (page) => { await seedRecord(page, pendingRecord()); await anonymous(page, '/session-expired'); } },
  { id: 'W14-acceso-no-disponible', screen: 'W14', state: 'acceso no disponible', open: (page) => anonymous(page, '/access-denied') },
  { id: 'W14-no-encontrada', screen: 'W14', state: 'página no encontrada', open: (page) => anonymous(page, '/ruta-que-no-existe') },
];

/** §5.7 evidence viewports + zoom 200 % (640×512 @ DPR 2). */
export const UX_VIEWPORTS = [
  { label: '320', width: 320, height: 640, dpr: 1 },
  { label: '390', width: 390, height: 844, dpr: 1 },
  { label: '768', width: 768, height: 1024, dpr: 1 },
  { label: '1024', width: 1024, height: 768, dpr: 1 },
  { label: '1280', width: 1280, height: 800, dpr: 1 },
  { label: '1440', width: 1440, height: 900, dpr: 1 },
  { label: '1920', width: 1920, height: 1080, dpr: 1 },
  { label: 'zoom200', width: 640, height: 512, dpr: 2 },
] as const;
export const authenticatedScreen = (screen: string) => !['W01', 'W02', 'W14'].includes(screen);
export { checking, savings };
