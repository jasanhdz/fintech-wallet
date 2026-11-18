// WF-T3 acceptance: W06 (directorio de beneficiarios, vacío, sin resultados, cargando, error, textos largos) and W07
// (alta: base, campos inválidos, CLABE incorrecta, duplicado, destino no disponible, guardando, error recuperable).
// [F] scenarios use the simulated API (helpers/mock-api.ts + per-scenario page.route); [I] FN-02 lives in
// t3-integration.spec.ts against the real P1 API.
import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockApi } from './helpers/mock-api.js';
import { recordMetric } from './helpers/evidence.js';
import { box, near, styles } from './helpers/geometry.js';
import { clippedText } from './helpers/a11y.js';
import { a11yBasics, newPage, reflow, responsive, runningAnimations, settle, shoot, sideBySide, sideBySideHtml, V1440, V390, V768, viewportR, watch, withShell, type Viewport } from './helpers/screen.js';

const REF = {
  W06: 'w06_directorio_de_beneficiarios_1',
  W06_EMPTY: 'w06_sin_beneficiarios',
  W07: 'w07_agregar_beneficiario',
  W07_INVALID: 'w07_campos_inv_lidos',
  W07_CHECKSUM: 'w07_clabe_incorrecta',
  W07_DUPLICATE: 'w07_beneficiario_duplicado',
  W07_UNAVAILABLE: 'w07_destino_no_disponible',
  W07_SAVING: 'w07_guardando',
  W07_RECOVERABLE: 'w07_error_recuperable',
} as const;

const wide = (viewport: Viewport) => viewport.width >= 1024;
const font = (locator: Locator) => styles(locator, ['font-size', 'line-height', 'font-weight', 'letter-spacing', 'color', 'text-transform'] as const);
const problem = (status: number, detail: string, title = 'Error') => ({ status, body: data.problem(status, detail, title) });

const fifthClabe = data.clabeFrom('64618000000000575');
const second = data.beneficiary({ id: '8b3f0000-0000-4000-8000-000000000202', name: 'Persona Prueba Cinco', alias: 'Cinco', clabeMasked: data.maskClabe(fifthClabe), destinationAccountId: '7a2e0000-0000-4000-8000-000000000302' });
const two = () => [data.beneficiary(), second];
/** Synthetic CLABEs for W07: valid control digit (accepted by the client) and the same prefix with a wrong one. */
const newClabe = data.clabeFrom('64618000000000686');
const wrongDigitClabe = `${newClabe.slice(0, 17)}${(Number(newClabe[17]) + 1) % 10}`;
const typed = { name: 'Persona Prueba Seis', alias: 'Seis', clabe: newClabe };
/** Bodies are compared by SHA-256 so a failure never prints a full CLABE (EV-03). */
const typedSha = createHash('sha256').update(JSON.stringify(typed)).digest('hex');

async function open(page: Page, path: string, initial: Parameters<typeof installMockApi>[1] = {}) {
  const api = await installMockApi(page, initial);
  await page.goto(path);
  return api;
}

const beneficiaryPosts = (api: MockApi) => api.requests.filter((item) => item.method === 'POST' && item.path === '/v1/beneficiaries');
/** POSTs seen by the hold route of F-W07-6 (the mock records a request only once it is released). */
let heldPosts = 0;

// ───────────────────────────── W06 ─────────────────────────────
test.describe('W06 · Beneficiarios', () => {
  for (const viewport of [V1440, viewportR(REF.W06), V768, V390]) {
    test(`W06-V1/V2/F1 lista ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, '/beneficiaries', { beneficiaries: two() });
      const grid = page.getByRole('region', { name: 'Tus beneficiarios' });
      await expect(grid.locator('article')).toHaveCount(2);
      await settle(page);
      const metrics: Record<string, unknown> = {};
      // V1 header + toolbar
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mis beneficiarios');
      expect(await font(page.locator('h1'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px', 'font-weight': '600' } : { 'font-size': '24px', 'line-height': '32px', 'font-weight': '600' });
      await expect(page.locator('.bn-header p')).toHaveText('Envía dinero a cuentas registradas en Billetera MXN');
      const search = page.getByRole('searchbox', { name: 'Buscar beneficiarios' });
      await expect(search).toHaveAttribute('placeholder', 'p. ej. nombre, alias o terminación');
      await expect(page.locator('.bn-search svg[data-icon="search"]')).toHaveCount(1);
      const add = page.getByRole('link', { name: 'Agregar beneficiario' });
      await expect(add).toHaveAttribute('href', '/beneficiaries/new');
      await expect(add.locator('svg[data-icon="add"]')).toHaveCount(1);
      expect(await styles(add, ['background-color', 'color', 'height', 'border-radius', 'font-size', 'font-weight'] as const)).toMatchObject({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', height: '44px', 'border-radius': '12px', 'font-size': '14px', 'font-weight': '500' });
      const [searchBox, addBox] = [await box(search), await box(add)];
      expect(near(searchBox.height, 44)).toBe(true);
      if (viewport.width >= 640) { expect(near(searchBox.y, addBox.y)).toBe(true); expect(addBox.x).toBeGreaterThan(searchBox.x + searchBox.width); }
      metrics.toolbar = { search: searchBox, add: addBox };
      // V2 cards
      const cards = grid.locator('article');
      const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
      // UX-T3 (D-UX-4): auto-fill grid of ≥320 px columns → two in a row from 768 px, one below 640 px.
      if (viewport.width >= 768) { expect(near(a.y, b.y)).toBe(true); expect(near(b.x - (a.x + a.width), 24)).toBe(true); expect(near(a.width, b.width)).toBe(true); }
      else { expect(near(a.x, b.x)).toBe(true); expect(near(a.width, b.width)).toBe(true); }
      const cardStyle = await styles(cards.nth(0), ['border-radius', 'background-color', 'box-shadow', 'padding-top', 'padding-left'] as const);
      expect(cardStyle).toMatchObject({ 'border-radius': '12px', 'background-color': 'rgb(255, 255, 255)', 'box-shadow': 'rgba(0, 0, 0, 0.05) 0px 1px 2px 0px' });
      const avatar = cards.nth(0).locator('.bn-avatar');
      await expect(avatar).toHaveText('PP');
      expect(await styles(avatar, ['width', 'height', 'border-radius', 'background-color'] as const)).toEqual({ width: '48px', height: '48px', 'border-radius': '9999px', 'background-color': 'rgb(233, 237, 255)' });
      await expect(cards.nth(0).getByRole('heading', { level: 2 })).toHaveText('Persona Prueba Dos');
      expect(await font(cards.nth(0).getByRole('heading', { level: 2 }))).toMatchObject({ 'font-size': '20px', 'line-height': '28px', 'font-weight': '600' });
      const chip = cards.nth(0).locator('.bn-alias');
      await expect(chip).toHaveText('Alias: Prueba Dos');
      expect(await styles(chip, ['border-radius', 'background-color', 'color'] as const)).toEqual({ 'border-radius': '9999px', 'background-color': 'rgb(233, 237, 255)', color: 'rgb(67, 70, 85)' });
      const panel = cards.nth(0).locator('.bn-account');
      await expect(panel.locator('p').first()).toHaveText('Cuenta destino Billetera MXN');
      expect(await styles(panel, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(249, 249, 255)' });
      const tail = data.beneficiary().clabeMasked.slice(-4);
      await expect(panel.locator('[data-clabe]')).toHaveText(`•••• ${tail}`);
      expect(await styles(panel.locator('[data-clabe]'), ['font-size', 'font-variant-numeric'] as const)).toEqual({ 'font-size': '13px', 'font-variant-numeric': 'tabular-nums' });
      // The full masked form (3 + 4 digits) is never shown; only the last four.
      await expect(page.getByText(data.beneficiary().clabeMasked)).toHaveCount(0);
      const transfer = cards.nth(0).getByRole('link', { name: 'Transferir a Persona Prueba Dos' });
      await expect(transfer).toHaveText('Transferir');
      await expect(transfer.locator('svg[data-icon="arrowForward"]')).toHaveCount(1);
      await expect(transfer).toHaveAttribute('href', `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      const transferStyle = await styles(transfer, ['height', 'border-radius', 'border-top-width', 'border-top-color', 'color', 'background-color'] as const);
      expect(Number.parseFloat(transferStyle.height)).toBeGreaterThanOrEqual(44);
      expect(transferStyle).toMatchObject({ 'border-radius': '12px', 'border-top-width': '1px', color: 'rgb(29, 78, 216)', 'background-color': 'rgb(241, 243, 255)' });
      const transferBox = await box(transfer);
      const inset = Number.parseFloat(cardStyle['padding-left']) * 2 + 2; // padding + 1 px border on each side
      expect(near(transferBox.width, a.width - inset)).toBe(true);
      metrics.cards = { a, b, cardStyle, transfer: transferBox, transferStyle };
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(['Buscar beneficiarios', 'Agregar beneficiario', 'Transferir a Persona Prueba Dos', 'Transferir a Persona Prueba Cinco'], wide(viewport)));
      await shoot(page, 'W06-lista', { scenario: 'F-W06-1', screen: 'W06', state: 'dos beneficiarios', reference: REF.W06 }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W06-lista', { scenario: 'F-W06-1', screen: 'W06', state: 'dos beneficiarios', reference: REF.W06 }, viewport)).differentPixelRatio;
      // F1: local search (name, alias, last four) without requests.
      const before = api.requests.length;
      await search.fill('cinco');
      await expect(grid.locator('article')).toHaveCount(1);
      await expect(grid.locator('article h2')).toHaveText('Persona Prueba Cinco');
      await search.fill(tail);
      await expect(grid.locator('article h2')).toHaveText('Persona Prueba Dos');
      await search.fill('PRUEBA DOS');
      await expect(grid.locator('article h2')).toHaveText('Persona Prueba Dos');
      // UX-T3 (D-UX-4, BN-02): a single result keeps the card width of the grid (it is no longer stretched to the row).
      const single = await box(grid.locator('article'));
      expect(near(single.width, a.width)).toBe(true);
      await expect(page.getByRole('status').filter({ hasText: 'de 2 beneficiarios' })).toHaveText('1 de 2 beneficiarios');
      expect(api.requests.length).toBe(before);
      metrics.search = { requestsDuringSearch: api.requests.length - before, singleWidthRatio: single.width / (await box(page.locator('.bn-page'))).width };
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W06-V1-V2-F1 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  test('W06-F1 «Transferir» abre W08 con el beneficiario preseleccionado', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const seen = watch(page);
    const api = await open(page, '/beneficiaries', { beneficiaries: two() });
    await page.getByRole('link', { name: 'Transferir a Persona Prueba Cinco' }).click();
    await expect(page).toHaveURL(`/transfers/new?beneficiaryId=${second.id}`);
    // WF-T4: W08 shows the preselected beneficiary as the «Destinatario» card (D-8); the query only sets the initial value.
    await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card')).toContainText('Persona Prueba Cinco');
    await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card')).toContainText('Alias: Cinco');
    expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    recordMetric('W06-F1 transferir', { url: `/transfers/new?beneficiaryId=${second.id}`, preselected: second.id });
    await context.close();
  });

  for (const viewport of [V1440, viewportR(REF.W06_EMPTY), V768, V390]) {
    test(`W06-V3 vacío ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      await open(page, '/beneficiaries', { beneficiaries: [] });
      const empty = page.getByRole('region', { name: 'Aún no tienes beneficiarios registrados' });
      await expect(empty).toBeVisible();
      await settle(page);
      await expect(empty.locator('.bn-empty-icon svg[data-icon="groupOutlined"]')).toHaveCount(1);
      expect(await styles(empty.locator('.bn-empty-icon'), ['width', 'height', 'border-radius'] as const)).toEqual({ width: '64px', height: '64px', 'border-radius': '9999px' });
      await expect(empty.locator('p')).toHaveText('Registra a tus contactos con cuenta en Billetera MXN para enviarles dinero y tenerlos siempre a la mano.');
      const cta = empty.getByRole('link', { name: 'Agregar beneficiario' });
      await expect(cta).toHaveText('Agregar beneficiario');
      await expect(cta).toHaveAttribute('href', '/beneficiaries/new');
      await expect(cta.locator('svg[data-icon="personAddOutlined"]')).toHaveCount(1);
      // UX-T3 (D-UX-4, BN-03): the empty state has no disabled search bar and exactly one add link (the card CTA).
      await expect(page.getByRole('searchbox', { name: 'Buscar beneficiarios' })).toHaveCount(0);
      await expect(page.locator('.bn-toolbar')).toHaveCount(0);
      await expect(page.locator('a[href="/beneficiaries/new"]')).toHaveCount(1);
      const [headerBox, emptyBox] = [await box(page.locator('.bn-header')), await box(empty)];
      expect(near(emptyBox.y - (headerBox.y + headerBox.height), 24)).toBe(true);
      const metrics = { header: headerBox, empty: emptyBox, responsive: await responsive(page), a11y: await a11yBasics(page, withShell(['Agregar beneficiario'], wide(viewport))) };
      await shoot(page, 'W06-vacio', { scenario: 'F-W06-2', screen: 'W06', state: 'vacío', reference: REF.W06_EMPTY }, viewport);
      const sbs = viewport.label === 'R' ? (await sideBySide(browser, page, 'W06-vacio', { scenario: 'F-W06-2', screen: 'W06', state: 'vacío', reference: REF.W06_EMPTY }, viewport)).differentPixelRatio : undefined;
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W06-V3 ${viewport.label}`, { ...metrics, sideBySide: sbs });
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W06), V768, V390]) {
    test(`W06-V4 sin resultados ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, '/beneficiaries', { beneficiaries: two() });
      await expect(page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article')).toHaveCount(2);
      const search = page.getByRole('searchbox', { name: 'Buscar beneficiarios' });
      await search.fill('sin coincidencia');
      const none = page.getByRole('region', { name: 'No encontramos beneficiarios con esa búsqueda' });
      await expect(none).toBeVisible();
      await expect(none.locator('svg[data-icon="manageSearch"]')).toHaveCount(1);
      await expect(page.getByRole('status').filter({ hasText: 'de 2 beneficiarios' })).toHaveText('0 de 2 beneficiarios');
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell(['Buscar beneficiarios', 'Agregar beneficiario', 'Limpiar búsqueda'], wide(viewport))) };
      await shoot(page, 'W06-sin-resultados', { scenario: 'F-W06-3', screen: 'W06', state: 'sin resultados', reference: REF.W06 }, viewport);
      await none.getByRole('button', { name: 'Limpiar búsqueda' }).click();
      await expect(search).toHaveValue('');
      await expect(search).toBeFocused();
      await expect(page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article')).toHaveCount(2);
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W06-V4 ${viewport.label}`, { ...metrics, clear: 'Limpiar búsqueda → valor vacío, foco en el buscador, 2 tarjetas' });
      await context.close();
    });
  }

  test('W06-F2 cargando (skeleton aria-busy) y error con «Intentar de nuevo»', async ({ browser }) => {
    for (const viewport of [viewportR(REF.W06), V390]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      let calls = 0;
      await installMockApi(page, { beneficiaries: two() });
      await page.route('**/v1/beneficiaries', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        calls += 1;
        if (calls <= 2) { await hold; return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) }); }
        return route.fallback();
      });
      await page.goto('/beneficiaries');
      const loading = page.getByRole('region', { name: 'Cargando beneficiarios' });
      await expect(loading).toHaveAttribute('aria-busy', 'true');
      expect(await runningAnimations(page), 'A11Y-10').toEqual([]);
      await responsive(page);
      await shoot(page, 'W06-cargando', { scenario: 'F-W06-4', screen: 'W06', state: 'cargando', reference: REF.W06 }, viewport);
      release();
      const failure = page.getByRole('region', { name: 'No pudimos cargar tus beneficiarios' });
      await expect(failure.getByRole('alert')).toHaveText('Servicio no disponible por el momento.');
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell(['Buscar beneficiarios', 'Agregar beneficiario', 'Intentar de nuevo'], wide(viewport))) };
      await shoot(page, 'W06-error', { scenario: 'F-W06-5', screen: 'W06', state: 'error', reference: REF.W06 }, viewport);
      await failure.getByRole('button', { name: 'Intentar de nuevo' }).click();
      await expect(page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article')).toHaveCount(2);
      expect(calls).toBeGreaterThanOrEqual(3); // initial + 1 automatic retry (QueryClient retry: 1) + manual retry
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W06-F2 ${viewport.label}`, { ...metrics, loading: 'aria-busy=true, 2 skeletons, sin animación', error: 'alert + Intentar de nuevo → GET /v1/beneficiaries', calls, provoked: seen.provoked });
      await context.close();
    }
  });

  test('W06 A11Y-06 textos largos y A11Y-05 reflow', async ({ browser }) => {
    const long = data.beneficiary({ name: `Persona ${'Muy Larga '.repeat(12)}`.slice(0, 120), alias: `Alias ${'extenso '.repeat(10)}`.slice(0, 80) });
    expect(long.name).toHaveLength(120); expect(long.alias).toHaveLength(80);
    const metrics: Record<string, unknown> = {};
    for (const viewport of [V1440, viewportR(REF.W06), V768, V390]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      await open(page, '/beneficiaries', { beneficiaries: [long, second] });
      await expect(page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article')).toHaveCount(2);
      await settle(page);
      await responsive(page);
      expect(await clippedText(page)).toEqual([]);
      const chip = page.locator('.bn-alias').first();
      await expect(chip).toHaveAttribute('title', `Alias: ${long.alias}`);
      await expect(page.getByRole('heading', { name: long.name })).toBeVisible();
      await shoot(page, 'W06-textos-largos', { scenario: 'F-W06-6', screen: 'W06', state: 'textos largos', reference: REF.W06 }, viewport);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      metrics[viewport.label] = 'sin desborde; nombre completo visible (ajuste de línea); alias truncado con title';
      await context.close();
    }
    metrics.reflow = await reflow(browser, async (page) => { await installMockApi(page, { beneficiaries: [long, second] }); await page.goto('/beneficiaries'); await expect(page.getByRole('region', { name: 'Tus beneficiarios' }).locator('article')).toHaveCount(2); await settle(page); });
    metrics.reflowEmpty = await reflow(browser, async (page) => { await installMockApi(page, { beneficiaries: [] }); await page.goto('/beneficiaries'); await expect(page.getByRole('region', { name: 'Aún no tienes beneficiarios registrados' })).toBeVisible(); await settle(page); });
    recordMetric('W06 A11Y-05/06', metrics);
  });
});

// ───────────────────────────── W07 ─────────────────────────────
type W07State = {
  id: string; name: string; scenario: string; reference: string; html: boolean;
  /** Prepares the mock and drives the form into the state; returns what the assertions need. */
  reach(page: Page, api: MockApi): Promise<void | (() => void)>;
  verify(page: Page, api: MockApi, viewport: Viewport): Promise<Record<string, unknown>>;
  content: string[];
};

const FIELD_LABELS = ['Nombre completo o razón social', 'Alias o nombre corto', 'CLABE de 18 dígitos'] as const;
const BASE_CONTENT = ['Beneficiarios', ...FIELD_LABELS, 'Cancelar', 'Guardar beneficiario'];
/** UX-T2 (SPEC §5.5, FM-05): the error summary before the actions has one button per invalid field. */
const SUMMARY_STOPS = { name: FIELD_LABELS[0], alias: FIELD_LABELS[1], clabeLength: FIELD_LABELS[2], clabeChecksum: FIELD_LABELS[2] };

async function fill(page: Page, values: { name: string; alias: string; clabe: string }) {
  await page.getByLabel(FIELD_LABELS[0]).fill(values.name);
  await page.getByLabel(FIELD_LABELS[1]).fill(values.alias);
  await page.getByLabel(FIELD_LABELS[2]).fill(values.clabe);
}
const save = (page: Page) => page.getByRole('button', { name: 'Guardar beneficiario' }).click();

async function describedText(input: Locator) {
  return input.evaluate((element) => (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? `#missing:${id}`).join(' | '));
}

const settled = (locator: Locator) => locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))));

async function expectInvalidRing(input: Locator) {
  await settled(input);
  // UX-T2 (SPEC §5.5, A11Y-05): 1 px error border + 1 px inset = 2 px error edge; the focus ring is the outline.
  expect(await styles(input, ['box-shadow', 'border-top-color', 'height', 'border-radius'] as const)).toMatchObject({ 'box-shadow': 'rgb(186, 26, 26) 0px 0px 0px 1px inset', 'border-top-color': 'rgb(186, 26, 26)', height: '44px', 'border-radius': '8px' });
}

const W07_STATES: W07State[] = [
  {
    id: 'base', name: 'idle', scenario: 'F-W07-1', reference: REF.W07, html: false, content: BASE_CONTENT,
    async reach() { /* initial state */ },
    async verify(page, api, viewport) {
      const metrics: Record<string, unknown> = {};
      const crumb = page.getByRole('navigation', { name: 'Ruta de navegación' });
      await expect(crumb.getByRole('link', { name: 'Beneficiarios' })).toHaveAttribute('href', '/beneficiaries');
      await expect(crumb.locator('svg[data-icon="arrowBack"]')).toHaveCount(1);
      await expect(crumb.locator('[aria-current="page"]')).toHaveText('Nuevo registro');
      // UX-T2 (D-UX-5): the breadcrumb is the page header's eyebrow; the extra «Registro de contacto» eyebrow is gone.
      await expect(page.locator('.bn-eyebrow')).toHaveCount(0);
      expect(await crumb.evaluate((element) => element.parentElement?.classList.contains('page-header'))).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agregar nuevo beneficiario');
      expect(await font(page.locator('h1'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px', 'font-weight': '600' } : { 'font-size': '24px', 'line-height': '32px', 'font-weight': '600' });
      await expect(page.locator('.bn-form-header .page-subtitle')).toHaveText('Registra una cuenta de Billetera MXN para transferir fondos.');
      // V2 card, banner, fields
      const card = page.getByRole('region', { name: 'Datos del beneficiario' });
      await expect(card.locator('.bn-info')).toHaveText('Solo se admiten cuentas de Billetera MXN.');
      await expect(card.locator('.bn-info svg[data-icon="infoOutlined"]')).toHaveCount(1);
      await expect(page.locator('#name-meta')).toHaveText('Obligatorio');
      await expect(page.locator('#alias-meta')).toHaveText('Para identificarlo fácil');
      await expect(page.locator('#clabe-meta')).toHaveText('0 / 18');
      await expect(page.locator('#clabe-help')).toHaveText('18 dígitos numéricos');
      for (const label of FIELD_LABELS) {
        const input = page.getByLabel(label);
        expect(await styles(input, ['height', 'border-radius', 'background-color'] as const)).toEqual({ height: '44px', 'border-radius': '8px', 'background-color': 'rgb(241, 243, 255)' });
        await expect(input).toHaveAttribute('aria-required', 'true');
      }
      await page.getByLabel('CLABE de 18 dígitos').fill('64 618');
      await expect(page.getByLabel('CLABE de 18 dígitos')).toHaveValue('64618');
      await expect(page.locator('#clabe-meta')).toHaveText('5 / 18');
      await page.getByLabel('CLABE de 18 dígitos').fill('');
      // V3 actions + help
      const cancel = page.getByRole('link', { name: 'Cancelar' });
      const submit = page.getByRole('button', { name: 'Guardar beneficiario' });
      await expect(cancel).toHaveAttribute('href', '/beneficiaries');
      await expect(submit.locator('svg[data-icon="personAddOutlined"]')).toHaveCount(1);
      expect(await styles(cancel, ['background-color', 'border-top-color', 'border-top-width', 'height', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(255, 255, 255)', 'border-top-color': 'rgb(196, 197, 215)', 'border-top-width': '1px', height: '44px', 'border-radius': '12px' });
      expect(await styles(submit, ['background-color', 'color', 'height', 'border-radius', 'font-size', 'font-weight'] as const)).toEqual({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', height: '44px', 'border-radius': '12px', 'font-size': '14px', 'font-weight': '500' });
      const help = page.getByRole('complementary', { name: '¿Dónde obtener la CLABE interna?' });
      await expect(help).toContainText('Pide al titular su CLABE de Billetera MXN de 18 dígitos.');
      expect(await styles(help, ['background-color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(233, 237, 255)', 'border-radius': '12px' });
      const [cardBox, helpBox, cancelBox, submitBox] = [await box(card), await box(help), await box(cancel), await box(submit)];
      const content = await box(page.locator('.bn-form-layout'));
      if (wide(viewport)) {
        // ≈ 8/12 of the layout with a 24 px gap; help card on the right, top-aligned; actions right-aligned.
        expect(near(cardBox.width, (content.width - 11 * 24) / 12 * 8 + 7 * 24)).toBe(true);
        expect(near(helpBox.y, cardBox.y)).toBe(true);
        expect(helpBox.x).toBeGreaterThan(cardBox.x + cardBox.width);
        expect(near(submitBox.x + submitBox.width, cardBox.x + cardBox.width - 24)).toBe(true);
        expect(near(submitBox.y, cancelBox.y)).toBe(true);
      } else {
        // RESP-04: stacked below 1024 px, main content first in DOM and on screen.
        expect(helpBox.y).toBeGreaterThan(cardBox.y + cardBox.height);
        expect(await page.evaluate(() => { const main = document.querySelector('.bn-form-card'); const help = document.querySelector('.bn-help'); return Boolean(main && help && main.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING); })).toBe(true);
      }
      metrics.geometry = { card: cardBox, help: helpBox, cancel: cancelBox, submit: submitBox, content };
      expect(beneficiaryPosts(api)).toEqual([]);
      return metrics;
    },
  },
  {
    id: 'invalidos', name: 'campos inválidos', scenario: 'F-W07-2', reference: REF.W07_INVALID, html: true, content: ['Beneficiarios', ...FIELD_LABELS, SUMMARY_STOPS.name, SUMMARY_STOPS.alias, SUMMARY_STOPS.clabeLength, 'Cancelar', 'Guardar beneficiario'],
    async reach(page) { await page.getByLabel(FIELD_LABELS[2]).fill('71096900'); await save(page); },
    async verify(page, api) {
      // UX-T2 (SPEC §5.5, FM-04/05): one summary right before the actions, one button per invalid field.
      const banner = page.getByRole('alert').filter({ hasText: 'Revisa los 3 campos señalados antes de continuar' });
      await expect(banner).toBeVisible();
      expect(await banner.evaluate((element) => element.nextElementSibling?.classList.contains('form-footer'))).toBe(true);
      expect(await styles(banner, ['background-color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)', 'border-radius': '8px' });
      await expect(banner.locator('.form-summary-link')).toHaveText([...FIELD_LABELS]);
      const expected = { [FIELD_LABELS[0]]: 'Ingresa el nombre completo o razón social del titular.', [FIELD_LABELS[1]]: 'Asigna un alias para identificar al contacto.', [FIELD_LABELS[2]]: 'Ingresa los 18 dígitos numéricos de la cuenta.' };
      for (const label of FIELD_LABELS) {
        const input = page.getByLabel(label);
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(await describedText(input)).toContain(expected[label]);
        await expectInvalidRing(input);
        await expect(input.locator('xpath=..').locator('svg[data-icon="error"]')).toHaveCount(1);
      }
      await expect(page.getByLabel(FIELD_LABELS[0])).toBeFocused();
      await expect(page.locator('#clabe-meta')).toHaveText('8 / 18');
      expect(beneficiaryPosts(api)).toEqual([]);
      // Editing a field clears its error and updates N.
      await page.getByLabel(FIELD_LABELS[1]).fill('Seis');
      await expect(page.getByRole('alert').filter({ hasText: 'Revisa los 2 campos señalados antes de continuar' })).toBeVisible();
      // FM-01: no «valid» state per field; the neutral hint stays.
      await expect(page.locator('#alias-meta')).toHaveText('Para identificarlo fácil');
      await page.getByLabel(FIELD_LABELS[1]).fill('');
      await save(page);
      await expect(banner.locator('.form-summary-link')).toHaveCount(3);
      return { banner: await box(banner), summary: '3 campos (2 tras corregir el alias)', postsWithoutValidData: 0 };
    },
  },
  {
    id: 'clabe-incorrecta', name: 'CLABE incorrecta', scenario: 'F-W07-3', reference: REF.W07_CHECKSUM, html: true, content: ['Beneficiarios', ...FIELD_LABELS, SUMMARY_STOPS.clabeChecksum, 'Cancelar', 'Guardar beneficiario'],
    async reach(page) { await fill(page, { ...typed, clabe: wrongDigitClabe }); await save(page); },
    async verify(page, api) {
      const banner = page.getByRole('alert').filter({ hasText: 'Verifica la información capturada' });
      await expect(banner).toBeVisible();
      await expect(banner.locator('.form-summary-icon svg[data-icon="error"]')).toHaveCount(1);
      const clabe = page.getByLabel(FIELD_LABELS[2]);
      await expect(clabe).toHaveAttribute('aria-invalid', 'true');
      expect(await describedText(clabe)).toContain('La CLABE debe contener exactamente 18 dígitos y un dígito verificador válido. Revisa los números ingresados.');
      await expect(clabe).toBeFocused();
      await expectInvalidRing(clabe);
      expect((await styles(page.locator('label[for="clabe"]'), ['color'] as const)).color).toBe('rgb(186, 26, 26)');
      const counter = page.locator('#clabe-meta');
      await expect(counter).toHaveText('18 / 18');
      expect(await styles(counter, ['color'] as const)).toEqual({ color: 'rgb(186, 26, 26)' });
      // FM-01: valid fields keep their neutral hint (no «Formato válido», no check icon).
      await expect(page.locator('#name-meta')).toHaveText('Obligatorio');
      await expect(page.locator('#alias-meta')).toHaveText('Para identificarlo fácil');
      await expect(page.locator('.bn-input svg[data-icon="checkCircleOutlined"]')).toHaveCount(0);
      await expect(page.getByLabel(FIELD_LABELS[0])).not.toHaveAttribute('aria-invalid', 'true');
      expect(beneficiaryPosts(api)).toEqual([]);
      return { banner: await box(banner), noRequest: true };
    },
  },
  {
    id: 'duplicado', name: 'duplicado (409)', scenario: 'F-W07-4', reference: REF.W07_DUPLICATE, html: true,
    content: ['Beneficiarios', ...FIELD_LABELS, 'Modificar datos', 'Ver en directorio'],
    async reach(page, api) { api.state.overrides.set('POST /beneficiaries', problem(409, 'El beneficiario ya está registrado.', 'Conflict')); await fill(page, typed); await save(page); },
    async verify(page, api) {
      const banner = page.getByRole('alert').filter({ hasText: 'Beneficiario duplicado' });
      await expect(banner).toContainText('Ya tienes registrado un beneficiario con esta misma CLABE.');
      const clabe = page.getByLabel(FIELD_LABELS[2]);
      // FM-04: a server answer about the CLABE focuses the CLABE; the summary sits right before the actions.
      await expect(clabe).toBeFocused();
      expect(await banner.evaluate((element) => element.nextElementSibling?.classList.contains('form-footer'))).toBe(true);
      await expect(page.locator('#clabe-meta')).toHaveText('Cuenta ya registrada');
      await expect(clabe).toHaveAttribute('aria-invalid', 'true');
      expect(await describedText(clabe)).toContain('Cuenta ya registrada');
      for (const label of FIELD_LABELS) await expect(page.getByLabel(label)).toHaveAttribute('readonly', '');
      await expect(page.getByLabel(FIELD_LABELS[0])).toHaveValue(typed.name);
      const directory = page.getByRole('link', { name: 'Ver en directorio' });
      await expect(directory).toHaveAttribute('href', '/beneficiaries');
      await expect(page.getByRole('button', { name: 'Guardar beneficiario' })).toHaveCount(0);
      expect(beneficiaryPosts(api).map((item) => item.bodySha256)).toEqual([typedSha]);
      return { banner: await box(banner) };
    },
  },
  {
    id: 'destino-no-disponible', name: 'destino no disponible (404)', scenario: 'F-W07-5', reference: REF.W07_UNAVAILABLE, html: true, content: BASE_CONTENT,
    async reach(page, api) { api.state.overrides.set('POST /beneficiaries', problem(404, 'No se encontró una cuenta interna.', 'Not Found')); await fill(page, typed); await save(page); },
    async verify(page, api) {
      const banner = page.getByRole('alert').filter({ hasText: 'Destino no disponible en la plataforma' });
      await expect(banner).toContainText('Esta cuenta no pertenece a Billetera MXN. Revisa la CLABE de 18 dígitos e intenta nuevamente.');
      const clabe = page.getByLabel(FIELD_LABELS[2]);
      await expect(clabe).toBeFocused();
      await expect(clabe).toHaveAttribute('aria-invalid', 'true');
      expect(await describedText(clabe)).toContain('No encontrada');
      expect(await clabe.inputValue() === newClabe, 'CLABE kept').toBe(true);
      expect(beneficiaryPosts(api)).toHaveLength(1);
      // Editing the CLABE returns to the idle state (banner gone, «Guardar beneficiario» again).
      return { banner: await box(banner) };
    },
  },
  {
    id: 'guardando', name: 'guardando', scenario: 'F-W07-6', reference: REF.W07_SAVING, html: true, content: ['Beneficiarios', ...FIELD_LABELS],
    async reach(page, api) {
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      api.state.overrides.set('POST /beneficiaries', { status: 201, body: data.beneficiary({ id: '8b3f0000-0000-4000-8000-000000000203', name: typed.name, alias: typed.alias, clabeMasked: data.maskClabe(newClabe) }) });
      heldPosts = 0;
      await page.route('**/v1/beneficiaries', async (route) => { if (route.request().method() === 'POST') { heldPosts += 1; await hold; } return route.fallback(); });
      await fill(page, typed); await save(page);
      return release;
    },
    async verify(page, api) {
      const submit = page.getByRole('button', { name: 'Guardando beneficiario…' });
      await expect(submit).toBeDisabled();
      await expect(submit.locator('svg[data-icon="spinner"]')).toHaveCount(1);
      const status = page.getByRole('status').filter({ hasText: 'Registrando y validando datos en Billetera MXN. Por favor no cierres esta ventana.' });
      await expect(status).toBeVisible();
      await expect(submit).toHaveAttribute('aria-describedby', 'bn-saving-text');
      const cancel = page.getByRole('button', { name: 'Cancelar' });
      await expect(cancel).toBeDisabled();
      await expect(cancel).toHaveAttribute('aria-describedby', 'bn-saving-text');
      await expect(page.locator('#bn-saving-text')).toBeVisible();
      await expect(page.locator('form.bn-form')).toHaveAttribute('aria-busy', 'true');
      for (const label of FIELD_LABELS) await expect(page.getByLabel(label)).toHaveAttribute('readonly', '');
      await settled(submit);
      expect(await styles(submit, ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(224, 232, 255)', color: 'rgb(116, 118, 134)' });
      expect(await runningAnimations(page), 'A11Y-10').toEqual([]);
      // A second click while saving sends nothing more.
      await submit.click({ force: true });
      expect(heldPosts).toBe(1);
      expect(beneficiaryPosts(api)).toEqual([]);
      return { saving: 'botón deshabilitado + spinner, campos readonly, form aria-busy, role=status' };
    },
  },
  {
    id: 'error-recuperable', name: 'error recuperable (503)', scenario: 'F-W07-7', reference: REF.W07_RECOVERABLE, html: true, content: ['Beneficiarios', ...FIELD_LABELS, 'Cancelar', 'Reintentar guardar'],
    async reach(page, api) { api.state.overrides.set('POST /beneficiaries', problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')); await fill(page, typed); await save(page); },
    async verify(page, api) {
      const banner = page.getByRole('alert').filter({ hasText: 'No pudimos guardar al beneficiario en este momento' });
      await expect(banner).toContainText('Ocurrió un problema de conexión temporal. Conservamos la información ingresada para que puedas reintentar.');
      await expect(banner).toBeFocused();
      await expect(page.getByLabel(FIELD_LABELS[0])).toHaveValue(typed.name);
      await expect(page.getByLabel(FIELD_LABELS[1])).toHaveValue(typed.alias);
      expect(await page.getByLabel(FIELD_LABELS[2]).inputValue() === typed.clabe, 'CLABE kept').toBe(true);
      const retry = page.getByRole('button', { name: 'Reintentar guardar' });
      await settled(retry);
      expect(await styles(retry, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(29, 78, 216)' });
      await expect(retry.locator('svg[data-icon="sync"]')).toHaveCount(1);
      expect(beneficiaryPosts(api)).toHaveLength(1);
      return { banner: await box(banner) };
    },
  },
];

test.describe('W07 · Alta de beneficiario', () => {
  for (const state of W07_STATES) {
    for (const viewport of [V1440, viewportR(REF.W07), V768, V390]) {
      test(`W07 ${state.name} ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
        const { context, page } = await newPage(browser, viewport);
        const seen = watch(page);
        const api = await open(page, '/beneficiaries/new', { beneficiaries: two() });
        await expect(page.getByRole('heading', { level: 1, name: 'Agregar nuevo beneficiario' })).toBeVisible();
        const release = await state.reach(page, api);
        const metrics = await state.verify(page, api, viewport);
        await page.mouse.move(0, 0); // captures without the hover colour of the last clicked button
        metrics.responsive = await responsive(page);
        metrics.a11y = await a11yBasics(page, withShell(state.content, wide(viewport)));
        const name = `W07-${state.id}`;
        const row = { scenario: state.scenario, screen: 'W07', state: state.name, reference: state.reference };
        await shoot(page, name, row, viewport);
        if (viewport.label === 'R') metrics.sideBySide = state.html ? (await sideBySideHtml(browser, page, name, row, viewport)).differentPixelRatio : (await sideBySide(browser, page, name, row, viewport)).differentPixelRatio;
        if (release) {
          release();
          await expect(page).toHaveURL(/\/beneficiaries$/);
          await expect(page.getByRole('status').filter({ hasText: 'agregado' })).toHaveText('Beneficiario “Seis” agregado.');
        }
        expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
        recordMetric(`W07 ${state.name} ${viewport.label}`, { ...metrics, provoked: seen.provoked });
        await context.close();
      });
    }
  }

  test('W07-F1 acciones: «Reintentar guardar» reenvía los mismos valores (503 y red), «Modificar datos» enfoca la CLABE, «Ver en directorio» y «Cancelar» → /beneficiaries; 201 → aviso en W06', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const seen = watch(page);
    const api = await open(page, '/beneficiaries/new', { beneficiaries: two() });
    await fill(page, typed);
    api.state.overrides.set('POST /beneficiaries', problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable'));
    await save(page);
    await expect(page.getByRole('button', { name: 'Reintentar guardar' })).toBeVisible();
    api.state.overrides.set('POST /beneficiaries', 'abort');
    await page.getByRole('button', { name: 'Reintentar guardar' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos guardar al beneficiario en este momento' })).toBeVisible();
    api.state.overrides.set('POST /beneficiaries', problem(409, 'El beneficiario ya está registrado.', 'Conflict'));
    await page.getByRole('button', { name: 'Reintentar guardar' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Beneficiario duplicado' })).toBeVisible();
    const bodies = beneficiaryPosts(api).map((item) => item.bodySha256);
    expect(bodies).toEqual([typedSha, typedSha, typedSha]);
    await page.getByRole('button', { name: 'Modificar datos' }).click();
    await expect(page.getByLabel(FIELD_LABELS[2])).toBeFocused();
    await expect(page.getByLabel(FIELD_LABELS[2])).not.toHaveAttribute('readonly', '');
    await expect(page.getByRole('alert')).toHaveCount(0);
    // 404 → edit the CLABE → idle; then 201 → W06 with the notice and the masked new card.
    api.state.overrides.set('POST /beneficiaries', problem(404, 'No se encontró una cuenta interna.', 'Not Found'));
    await save(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Destino no disponible en la plataforma' })).toBeVisible();
    await page.getByLabel(FIELD_LABELS[2]).fill(newClabe.slice(0, 17));
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByLabel(FIELD_LABELS[2]).fill(newClabe);
    const created = data.beneficiary({ id: '8b3f0000-0000-4000-8000-000000000204', name: typed.name, alias: typed.alias, clabeMasked: data.maskClabe(newClabe) });
    api.state.overrides.set('POST /beneficiaries', { status: 201, body: created });
    api.state.beneficiaries = [...two(), created];
    await save(page);
    await expect(page).toHaveURL(/\/beneficiaries$/);
    const notice = page.getByRole('status').filter({ hasText: 'agregado' });
    await expect(notice).toHaveText('Beneficiario “Seis” agregado.');
    await expect(page.getByRole('heading', { name: typed.name })).toBeVisible();
    await expect(page.getByText(`•••• ${newClabe.slice(-4)}`)).toBeVisible();
    expect(await page.content()).not.toContain(newClabe);
    await shoot(page, 'W06-aviso-alta', { scenario: 'F-W07-1', screen: 'W06', state: 'aviso de alta', reference: REF.W06 }, V1440);
    // «Ver en directorio» and «Cancelar» navigate without requests.
    await page.goto('/beneficiaries/new');
    await page.getByRole('link', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/\/beneficiaries$/);
    await page.goto('/beneficiaries/new');
    api.state.overrides.set('POST /beneficiaries', problem(409, 'El beneficiario ya está registrado.', 'Conflict'));
    await fill(page, typed); await save(page);
    await page.getByRole('link', { name: 'Ver en directorio' }).click();
    await expect(page).toHaveURL(/\/beneficiaries$/);
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    recordMetric('W07-F1', { retryBodies: 'idénticos (503 → red abortada → 409)', modify: 'foco en CLABE, editable', created: 'W06 con aviso «Beneficiario “Seis” agregado.» y •••• NNNN', provoked: seen.provoked });
    await context.close();
  });

  test('W07 A11Y-05 reflow (base y campos inválidos)', async ({ browser }) => {
    const base = await reflow(browser, async (page) => { await installMockApi(page); await page.goto('/beneficiaries/new'); await expect(page.getByRole('heading', { level: 1 })).toBeVisible(); await settle(page); });
    const invalid = await reflow(browser, async (page) => { await installMockApi(page); await page.goto('/beneficiaries/new'); await save(page); await expect(page.getByRole('alert')).toBeVisible(); await settle(page); });
    recordMetric('W07 A11Y-05', { base, invalid });
  });
});
