// WF-T4 acceptance [F]: W08 (datos: beneficiario, propias, errores, sin beneficiarios, sin segunda cuenta, origen = destino,
// textos largos), W09 (revisión normal, requiere código, propias, propias con código, política no disponible) and W13 (saldo
// insuficiente y límite diario en create y en confirm, política no disponible). Simulated API (helpers/mock-api.ts);
// [I] FN-03…FN-11/FN-15 live in t4-integration.spec.ts. Bodies are compared by value (synthetic data only).
import { expect, test, type Locator, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockApi, type MockState } from './helpers/mock-api.js';
import { recordMetric } from './helpers/evidence.js';
import { box, near, styles } from './helpers/geometry.js';
import { clippedText } from './helpers/a11y.js';
import { a11yBasics, newPage, reflow, responsive, settle, shoot, sideBySide, sideBySideHtml, V1440, V390, V768, viewportR, watch, withShell, type Viewport } from './helpers/screen.js';

const REF = {
  W08: 'w08_formulario_de_transferencia',
  W08_OWN: 'w08_entre_mis_cuentas',
  W08_ERRORS: 'w08_errores_en_formulario',
  W08_EMPTY: 'w08_sin_beneficiarios',
  W08_ONE: 'w08_sin_segunda_cuenta_propia',
  W09: 'w09_revisar_transferencia',
  W09_CODE: 'w09_revisi_n_6_000_mxn',
  W09_OWN: 'w09_revisi_n_entre_cuentas_propias',
  W13_BALANCE: 'w13_saldo_insuficiente',
  W13_LIMIT: 'w13_l_mite_diario',
} as const;
/** W09 own accounts only exists as code.html (1280 wide, rendered at the round's reference density). */
const R_HTML: Viewport = { label: 'R', width: 1280, height: 1024, dpr: 1.25 };

const wide = (viewport: Viewport) => viewport.width >= 1024;
const font = (locator: Locator) => styles(locator, ['font-size', 'line-height', 'font-weight', 'letter-spacing', 'color', 'text-transform'] as const);
const nonGet = (api: MockApi) => api.nonGet().filter((item) => item.path !== '/v1/auth/refresh');
const posts = (api: MockApi) => api.requests.filter((item) => item.method === 'POST' && item.path === '/v1/transfers');
const problem = (status: number, detail: string, title = 'Error') => ({ status, body: data.problem(status, detail, title) });
const tail = (clabeMasked: string) => clabeMasked.slice(-4);

const second = data.beneficiary({ id: '8b3f0000-0000-4000-8000-000000000202', name: 'Persona Prueba Cinco', alias: 'Cinco', destinationAccountId: '7a2e0000-0000-4000-8000-000000000302' });
/** A beneficiary registered with the CLABE of the user's own checking account (D-7). */
const ownCheckingBeneficiary = data.beneficiary({ id: '8b3f0000-0000-4000-8000-000000000203', name: 'Persona Prueba Uno', alias: 'Mi cuenta principal', destinationAccountId: data.ids.checking, ownAccountId: data.ids.checking });
const [checking, savings] = data.accounts() as [data.Account, data.Account];

// UX-T2 (D-UX-6): with two accounts the source is an inline radio group; its tab stop is the checked account.
const ENTRY = [checking.name, 'A un beneficiario', 'Entre mis cuentas'];
const FIELDS = ['Importe a transferir', 'Concepto', 'Referencia numérica'];
/**
 * UX-T2 (SPEC §5.5, D-UX-6): the footer reads «Cancelar» then the primary (secondary left, primary right); <1024 the
 * summary after the form is collapsed behind a toggle named «{título} · {importe o sin importe}».
 */
const footerStops = (viewport: Viewport, summary: string, enabled = true) => [
  'Cancelar', ...(enabled ? ['Continuar a revisión'] : []), ...(wide(viewport) ? [] : [summary]),
];
const SUMMARY_LINKS = { amount: 'Importe a transferir', concept: 'Concepto', reference: 'Referencia numérica' };

async function open(page: Page, path: string, initial: Partial<MockState> = {}) {
  const api = await installMockApi(page, initial);
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return api;
}

async function fill(page: Page, values: { amount?: string; concept?: string; reference?: string }) {
  if (values.amount !== undefined) await page.getByLabel('Importe a transferir').fill(values.amount);
  if (values.concept !== undefined) await page.getByLabel('Concepto').fill(values.concept);
  if (values.reference !== undefined) await page.getByLabel('Referencia numérica').fill(values.reference);
}
const toReview = (page: Page) => page.getByRole('button', { name: /Continuar a revisión/ }).click();
const send = (page: Page) => page.getByRole('button', { name: /^(Confirmar transferencia|Continuar a verificación)$/ }).click();

async function describedText(input: Locator) {
  return input.evaluate((element) => (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? `#missing:${id}`).join(' | '));
}

const settled = (locator: Locator) => locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined))));

async function expectPrimary(button: Locator) {
  expect(await styles(button, ['background-color', 'color', 'border-radius', 'font-size', 'font-weight'] as const)).toMatchObject({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', 'border-radius': '12px', 'font-size': '14px', 'font-weight': '500' });
  expect(near((await box(button)).height, 44, 0.5) || (await box(button)).height >= 44).toBe(true);
}

// ───────────────────────────── W08 ─────────────────────────────
test.describe('W08 · Datos de transferencia', () => {
  for (const viewport of [V1440, viewportR(REF.W08), V768, V390]) {
    test(`W08-V1…V4 beneficiario ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      await fill(page, { amount: '850', concept: 'Comida', reference: '204801' });
      await settle(page);
      const metrics: Record<string, unknown> = {};
      // V1
      await expect(page.locator('.tf-breadcrumb')).toHaveText('Transferir/Nueva transferencia');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferir dinero');
      expect(await font(page.locator('h1'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px', 'font-weight': '600' } : { 'font-size': '24px', 'line-height': '32px', 'font-weight': '600' });
      await expect(page.locator('.tf-header .page-subtitle')).toHaveText('Envía fondos a un beneficiario registrado o entre tus cuentas propias.');
      const [main, summary] = [await box(page.locator('.tf-card')), await box(page.getByRole('complementary', { name: 'Resumen previo' }))];
      if (wide(viewport)) {
        expect(near(main.y, summary.y)).toBe(true);
        const ratio = main.width / (main.width + summary.width);
        expect(ratio).toBeGreaterThan(0.6); expect(ratio).toBeLessThan(0.72);
      } else expect(summary.y).toBeGreaterThan(main.y + main.height);
      metrics.layout = { main, summary };
      // V2 sections
      await expect(page.locator('.tf-label')).toHaveText(['1.Cuenta de origen', '2.Tipo de destino', '3.Destinatario', '4.Importe a transferir', '5.Concepto', '6.Referencia numérica']);
      expect(await font(page.locator('#tf-source-label'))).toMatchObject({ 'font-size': '11px', 'line-height': '16px', 'font-weight': '600', 'letter-spacing': '0.44px', 'text-transform': 'uppercase' });
      const sourceCard = page.getByRole('radiogroup', { name: 'Cuenta de origen' }).getByRole('radio', { checked: true });
      expect(await styles(sourceCard, ['border-radius'] as const)).toEqual({ 'border-radius': '12px' });
      expect(await styles(sourceCard.locator('.tf-tile'), ['background-color', 'width'] as const)).toEqual({ 'background-color': 'rgb(0, 55, 176)', width: '44px' });
      await expect(sourceCard).toContainText(checking.name);
      await expect(sourceCard.locator('[data-clabe]')).toHaveText(`•••• ${tail(checking.clabeMasked)}`);
      await expect(sourceCard.locator('.tf-meta-caps')).toHaveText('Saldo disponible');
      await expect(sourceCard.locator('[data-amount]')).toHaveText('$7,345.00 MXN');
      const segmented = page.locator('.tf-segmented button');
      await expect(segmented).toHaveText(['A un beneficiario', 'Entre mis cuentas']);
      await expect(segmented.nth(0)).toHaveAttribute('aria-pressed', 'true');
      await expect(segmented.nth(0).locator('svg[data-icon="personOutlined"]')).toHaveCount(1);
      await expect(segmented.nth(1).locator('svg[data-icon="syncAlt"]')).toHaveCount(1);
      const recipient = page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card');
      expect(await styles(recipient.locator('.tf-avatar'), ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(0, 109, 64)', color: 'rgb(255, 255, 255)' });
      await expect(recipient.locator('.tf-avatar')).toHaveText('PP');
      await expect(recipient.locator('.tf-alias')).toHaveText('Alias: Prueba Dos');
      await expect(recipient.locator('[data-clabe]')).toHaveText(`Cuenta •••• ${tail(data.beneficiary().clabeMasked)}`);
      await expect(page.getByRole('button', { name: 'Buscar otro beneficiario' })).toHaveAttribute('aria-expanded', 'false');
      // V3
      await expect(page.locator('#tf-amount-daily')).toHaveText('Disponible hoy: $30,000.00 MXN (demostración)');
      const amount = page.getByLabel('Importe a transferir');
      expect(await styles(amount, ['height', 'background-color', 'border-radius', 'font-size', 'font-variant-numeric'] as const)).toEqual({ height: '56px', 'background-color': 'rgb(241, 243, 255)', 'border-radius': '8px', 'font-size': '20px', 'font-variant-numeric': 'tabular-nums' });
      await expect(page.locator('.tf-amount-currency')).toHaveText('$');
      await expect(page.locator('.tf-amount-badge')).toHaveText('MXN');
      await expect(page.locator('#tf-concept-count')).toHaveText('6 / 40');
      await expect(page.locator('#tf-reference-hint')).toHaveText('Hasta 7 dígitos');
      const [concept, reference] = [await box(page.getByLabel('Concepto')), await box(page.getByLabel('Referencia numérica'))];
      if (viewport.width >= 640) expect(near(concept.y, reference.y)).toBe(true); else expect(reference.y).toBeGreaterThan(concept.y);
      const proceed = page.getByRole('button', { name: 'Continuar a revisión' });
      await expectPrimary(proceed);
      await expect(proceed.locator('svg[data-icon="arrowForward"]')).toHaveCount(1);
      const cancel = page.getByRole('link', { name: 'Cancelar' });
      await expect(cancel).toHaveAttribute('href', '/accounts');
      expect(await styles(cancel, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(255, 255, 255)' });
      if (wide(viewport)) expect((await box(proceed)).x).toBeGreaterThan((await box(cancel)).x + (await box(cancel)).width);
      // V4 summary: 7,345.00 − 850.00 = 6,495.00 → 88.4 % (BigInt, truncated to one decimal)
      const aside = page.getByRole('complementary', { name: 'Resumen previo' });
      await expect(aside.locator('.tf-summary-total dd')).toHaveText('$850.00 MXN');
      await expect(aside.locator('.tf-projection-head strong')).toHaveText('$6,495.00 MXN');
      await expect(aside.locator('.tf-projection-note')).toHaveText('Representa el 88.4% de tu saldo disponible actual');
      expect(await aside.locator('.tf-bar span').evaluate((element) => (element as HTMLElement).style.width)).toBe('88.42%');
      await expect(aside).not.toContainText(/Comisión|Tiempo estimado|cifrad|Inmediato/i);
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell([...ENTRY, 'Buscar otro beneficiario', ...FIELDS, ...footerStops(viewport, 'Resumen previo · $850.00 MXN')], wide(viewport)));
      await shoot(page, 'W08-beneficiario', { scenario: 'F-W08-1', screen: 'W08', state: 'beneficiario seleccionado', reference: REF.W08 }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W08-beneficiario', { scenario: 'F-W08-1', screen: 'W08', state: 'beneficiario seleccionado', reference: REF.W08 }, viewport)).differentPixelRatio;
      expect(nonGet(api)).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W08-V1-V4 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W08_OWN), V768, V390]) {
    test(`W08-V5 entre mis cuentas ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, '/transfers/new?type=own_account');
      await fill(page, { amount: '1500', concept: 'Traspaso a ahorro', reference: '204803' });
      await settle(page);
      await expect(page.locator('.tf-segmented button').nth(1)).toHaveAttribute('aria-pressed', 'true');
      const group = page.getByRole('radiogroup', { name: 'Cuenta de destino' });
      await expect(page.getByRole('group', { name: 'Cuenta de destino' }).locator('.tf-section-head')).toContainText('1 cuenta disponible');
      const radios = group.getByRole('radio');
      await expect(radios).toHaveCount(2);
      await expect(radios.nth(0)).toHaveAccessibleName(savings.name);
      await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
      await expect(radios.nth(0).locator('[data-clabe]')).toHaveText(`N° •• ${tail(savings.clabeMasked)}`);
      await expect(radios.nth(0).locator('.tf-card-amount')).toHaveText('Saldo actual$2,150.75 MXN');
      // D-7: the source is listed, disabled, with its chip and visible reason linked by aria-describedby.
      await expect(radios.nth(1)).toHaveAccessibleName(checking.name);
      await expect(radios.nth(1)).toHaveAttribute('aria-disabled', 'true');
      await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'false');
      await expect(radios.nth(1).locator('.tf-origin-chip')).toHaveText('Origen actual');
      await expect(radios.nth(1)).toHaveAccessibleDescription('No es posible transferir a la misma cuenta de origen');
      await radios.nth(1).click({ force: true });
      await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'false');
      const aside = page.getByRole('complementary', { name: 'Resumen proyectado' });
      await expect(aside.locator('dl > div')).toHaveText(['Monto a traspasar$1,500.00 MXN', `Saldo final en origen (•• ${tail(checking.clabeMasked)})$5,845.00 MXN`, `Saldo final en destino (•• ${tail(savings.clabeMasked)})$3,650.75 MXN`]);
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell([...ENTRY, savings.name, ...FIELDS, ...footerStops(viewport, 'Resumen proyectado · $1,500.00 MXN')], wide(viewport))) } as Record<string, unknown>;
      await shoot(page, 'W08-propias', { scenario: 'F-W08-2', screen: 'W08', state: 'entre mis cuentas', reference: REF.W08_OWN }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W08-propias', { scenario: 'F-W08-2', screen: 'W08', state: 'entre mis cuentas', reference: REF.W08_OWN }, viewport)).differentPixelRatio;
      expect(nonGet(api)).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W08-V5 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W08_ERRORS), V768, V390]) {
    test(`W08-V6 errores ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await fill(page, { amount: '0', reference: 'REF-99X' });
      await toReview(page);
      // UX-T2 (SPEC §5.5): one summary inside the form, right before the actions (no page banner).
      await expect(page.locator('.tf-error-banner')).toHaveCount(0);
      const banner = page.locator('#tf-error-summary');
      await expect(banner).toHaveAttribute('role', 'alert');
      await expect(banner.locator('.form-summary-title')).toHaveText('Corrige los 3 campos marcados para continuar');
      await expect(banner.locator('.form-summary-link')).toHaveText(['Importe a transferir', 'Concepto', 'Referencia numérica']);
      expect(await banner.evaluate((element) => element.nextElementSibling?.classList.contains('form-footer'))).toBe(true);
      expect(await styles(banner, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)' });
      await expect(page.getByLabel('Importe a transferir')).toBeFocused();
      const expectations: Array<[string, string]> = [['Importe a transferir', 'Ingresa un monto válido mayor a $0.00 MXN'], ['Concepto', 'El concepto de transferencia es requerido'], ['Referencia numérica', 'Ingresa una referencia numérica de hasta 7 dígitos']];
      for (const [label, message] of expectations) {
        const input = page.getByLabel(label);
        await expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(await describedText(input)).toContain(message);
        await settled(input);
        const invalid = await styles(input, ['border-top-color', 'box-shadow'] as const);
        expect(invalid).toEqual({ 'border-top-color': 'rgb(186, 26, 26)', 'box-shadow': 'rgb(186, 26, 26) 0px 0px 0px 1px inset' });
      }
      await expect(page.locator('.tf-label.is-error')).toHaveCount(3);
      for (const label of await page.locator('.tf-label.is-error').all()) {
        expect(await styles(label, ['color'] as const)).toEqual({ color: 'rgb(186, 26, 26)' });
        await expect(label.locator('.tf-required')).toHaveText('*');
      }
      await expect(page.locator('.tf-field-error svg[data-icon="report"]')).toHaveCount(3);
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell([...ENTRY, 'Buscar otro beneficiario', ...FIELDS, SUMMARY_LINKS.amount, SUMMARY_LINKS.concept, SUMMARY_LINKS.reference, ...footerStops(viewport, 'Resumen previo · sin importe')], wide(viewport))) } as Record<string, unknown>;
      await shoot(page, 'W08-errores', { scenario: 'F-W08-3', screen: 'W08', state: 'errores (importe 0, concepto vacío, REF-99X)', reference: REF.W08_ERRORS }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W08-errores', { scenario: 'F-W08-3', screen: 'W08', state: 'errores', reference: REF.W08_ERRORS }, viewport)).differentPixelRatio;
      // W08-F2: errors clear as each field is corrected; the chip counts what is left.
      await fill(page, { amount: '12.50' });
      await expect(banner.locator('.form-summary-title')).toHaveText('Corrige los 2 campos marcados para continuar');
      await expect(page.getByLabel('Importe a transferir')).not.toHaveAttribute('aria-invalid', 'true');
      await fill(page, { concept: 'Comida' });
      await expect(banner.locator('.form-summary-title')).toHaveText('Corrige el campo marcado para continuar');
      await fill(page, { reference: '204801' });
      await expect(banner).toHaveCount(0);
      expect(nonGet(api)).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W08-V6 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W08_EMPTY), V768, V390]) {
    test(`W08-V7 sin beneficiarios ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, '/transfers/new', { beneficiaries: [] });
      await fill(page, { amount: '3500' });
      await settle(page);
      const panel = page.locator('.tf-empty');
      expect(await styles(panel, ['background-color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)', 'border-radius': '12px' });
      await expect(panel.locator('svg[data-icon="personAddOutlined"]')).toHaveCount(1);
      await expect(panel.getByRole('heading', { level: 2 })).toHaveText('No tienes beneficiarios registrados en tu cuenta');
      await expect(panel.locator('p')).toHaveText('Registra primero un beneficiario de Billetera MXN.');
      const add = panel.getByRole('link', { name: 'Agregar nuevo beneficiario' });
      await expect(add).toHaveText('Agregar nuevo beneficiario');
      await expect(add).toHaveAttribute('href', '/beneficiaries/new');
      await expect(panel.getByRole('button', { name: 'Transferir a cuenta propia' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Resumen previo' }).locator('.tf-missing')).toHaveText('Elige un destinatario');
      const proceed = page.getByRole('button', { name: 'Continuar a revisión' });
      await expect(proceed).toBeDisabled();
      await expect(proceed).toHaveAccessibleDescription('Registra un beneficiario o transfiere entre tus cuentas para continuar.');
      await expect(page.locator('#tf-continue-reason')).toBeVisible();
      expect(await styles(proceed, ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(224, 232, 255)', color: 'rgb(116, 118, 134)' });
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell([...ENTRY, 'Agregar nuevo beneficiario', 'Transferir a cuenta propia', ...FIELDS, ...footerStops(viewport, 'Resumen previo · $3,500.00 MXN', false)], wide(viewport))) } as Record<string, unknown>;
      await shoot(page, 'W08-sin-beneficiarios', { scenario: 'F-W08-4', screen: 'W08', state: 'sin beneficiarios', reference: REF.W08_EMPTY }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W08-sin-beneficiarios', { scenario: 'F-W08-4', screen: 'W08', state: 'sin beneficiarios', reference: REF.W08_EMPTY }, viewport)).differentPixelRatio;
      // «Transferir a cuenta propia» switches the destination type, keeping the amount.
      await panel.getByRole('button', { name: 'Transferir a cuenta propia' }).click();
      await expect(page.locator('.tf-segmented button').nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Importe a transferir')).toHaveValue('3500');
      await expect(page.getByRole('button', { name: 'Continuar a revisión' })).toBeEnabled();
      expect(nonGet(api)).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W08-V7 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  test('W08-V7 con una sola cuenta: sin «Transferir a cuenta propia»', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    await open(page, '/transfers/new', { beneficiaries: [], accounts: [data.account()] });
    await expect(page.locator('.tf-empty')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transferir a cuenta propia' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cambiar cuenta' })).toHaveCount(0);
    recordMetric('W08-V7 una cuenta', { ownAccountButton: false, changeAccount: false });
    await context.close();
  });

  for (const viewport of [V1440, viewportR(REF.W08_ONE), V768, V390]) {
    test(`W08-V8 sin segunda cuenta propia ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, '/transfers/new?type=own_account', { accounts: [data.account()] });
      await fill(page, { amount: '12500' });
      await settle(page);
      const panel = page.locator('.tf-info-panel');
      await expect(panel.getByRole('heading', { level: 2 })).toHaveText('No cuentas con otra cuenta propia disponible');
      await expect(panel.locator('p')).toHaveText('Para transferir entre tus cuentas necesitas al menos dos cuentas de Billetera MXN. Puedes continuar transfiriendo a un beneficiario registrado.');
      await expect(page.getByRole('radiogroup', { name: 'Cuenta de destino' })).toHaveCount(0);
      const proceed = page.getByRole('button', { name: 'Continuar a revisión' });
      await expect(proceed).toBeDisabled();
      await expect(proceed).toHaveAccessibleDescription('Necesitas una segunda cuenta propia para transferir entre tus cuentas.');
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell(['A un beneficiario', 'Entre mis cuentas', 'Transferir a un beneficiario', ...FIELDS, ...footerStops(viewport, 'Resumen proyectado · $12,500.00 MXN', false)], wide(viewport))) } as Record<string, unknown>;
      await shoot(page, 'W08-sin-segunda-cuenta', { scenario: 'F-W08-5', screen: 'W08', state: 'sin segunda cuenta propia', reference: REF.W08_ONE }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W08-sin-segunda-cuenta', { scenario: 'F-W08-5', screen: 'W08', state: 'sin segunda cuenta propia', reference: REF.W08_ONE }, viewport)).differentPixelRatio;
      await panel.getByRole('button', { name: 'Transferir a un beneficiario' }).click();
      await expect(page.locator('.tf-segmented button').nth(0)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('Importe a transferir')).toHaveValue('12500');
      expect(nonGet(api)).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W08-V8 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  test('W08-F1 preselección por query y radiogroups con teclado; W08-F3 origen = destino por identidad', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const seen = watch(page);
    const api = await open(page, `/transfers/new?source=${data.ids.savings}&beneficiaryId=${ownCheckingBeneficiary.id}`, { beneficiaries: [data.beneficiary(), second, ownCheckingBeneficiary] });
    const metrics: Record<string, unknown> = {};
    // ?source= → savings; the beneficiary that resolves to checking is valid from savings (FN-05).
    await expect(page.getByRole('radiogroup', { name: 'Cuenta de origen' }).getByRole('radio', { checked: true })).toContainText(savings.name);
    const card = page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card');
    await expect(card).toContainText(ownCheckingBeneficiary.name);
    await expect(card.locator('.tf-option-reason')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continuar a revisión' })).toBeEnabled();
    // Switch the source to checking with the keyboard: the same beneficiary becomes blocked with its reason.
    // UX-T2 (D-UX-6): two accounts → the source radio group is always visible (no «Cambiar cuenta»).
    await expect(page.getByRole('button', { name: 'Cambiar cuenta' })).toHaveCount(0);
    const sources = page.getByRole('radiogroup', { name: 'Cuenta de origen' });
    await expect(sources.getByRole('radio', { name: savings.name })).toHaveAttribute('aria-checked', 'true');
    await sources.getByRole('radio', { name: savings.name }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(sources.getByRole('radio', { name: checking.name })).toHaveAttribute('aria-checked', 'true');
    await expect(sources.getByRole('radio', { name: checking.name })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sources.getByRole('radio', { name: checking.name })).toBeFocused();
    await expect(card.locator('.tf-option-reason')).toHaveText('Este beneficiario corresponde a la cuenta de origen');
    const proceed = page.getByRole('button', { name: 'Continuar a revisión' });
    await expect(proceed).toBeDisabled();
    await expect(proceed).toHaveAccessibleDescription(/Este beneficiario corresponde a la cuenta de origen/);
    // The list shows it disabled (not selectable) with the reason; arrows skip it; Space selects.
    await page.getByRole('button', { name: 'Buscar otro beneficiario' }).click();
    const list = page.getByRole('radiogroup', { name: 'Destinatario' });
    const blocked = list.getByRole('radio', { name: ownCheckingBeneficiary.name });
    await expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await expect(blocked).toHaveAccessibleDescription('Este beneficiario corresponde a la cuenta de origen');
    await blocked.click({ force: true });
    await expect(blocked).toHaveAttribute('aria-checked', 'false');
    await list.getByRole('radio', { name: 'Persona Prueba Dos' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('radio', { name: 'Persona Prueba Cinco' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('radio', { name: 'Persona Prueba Dos' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press(' ');
    await expect(list.getByRole('radio', { name: 'Persona Prueba Dos' })).toHaveAttribute('aria-checked', 'true');
    await expect(proceed).toBeEnabled();
    metrics.identity = 'savings → own-checking beneficiary allowed; checking → blocked with reason; arrows skip disabled';
    await shoot(page, 'W08-origen-igual-destino', { scenario: 'F-W08-6', screen: 'W08', state: 'beneficiario = cuenta origen (lista abierta)', reference: REF.W08 }, V1440);
    // ?type=own_account with ?source=savings → checking is the only (preselected) destination.
    await page.goto(`/transfers/new?type=own_account&source=${data.ids.savings}`);
    const own = page.getByRole('radiogroup', { name: 'Cuenta de destino' });
    await expect(own.getByRole('radio', { name: checking.name })).toHaveAttribute('aria-checked', 'true');
    await expect(own.getByRole('radio', { name: savings.name })).toHaveAttribute('aria-disabled', 'true');
    expect(nonGet(api)).toEqual([]);
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    recordMetric('W08-F1-F3', metrics);
    await context.close();
  });

  test('W08-F2 FN-06/FN-07: importes y referencia validados en cliente; valores conservados al cambiar de pestaña', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const seen = watch(page);
    const api = await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
    await fill(page, { concept: 'Prueba', reference: '1' });
    const rejected: Record<string, string> = {};
    for (const raw of ['', '0', '-1', 'abc', '10.999', '1,000']) {
      await fill(page, { amount: raw });
      await toReview(page);
      rejected[raw || "''"] = (await page.locator('#tf-amount-error').textContent()) ?? '';
    }
    expect(rejected).toEqual({ "''": 'Ingresa un monto válido mayor a $0.00 MXN', '0': 'Ingresa un monto válido mayor a $0.00 MXN', '-1': 'Ingresa un monto válido mayor a $0.00 MXN', abc: 'Ingresa un monto válido mayor a $0.00 MXN', '10.999': 'Usa como máximo dos decimales y sin comas', '1,000': 'Usa como máximo dos decimales y sin comas' });
    for (const raw of ['REF-99X', '12a']) {
      await fill(page, { amount: '10', reference: raw });
      await toReview(page);
      await expect(page.locator('#tf-reference-error')).toHaveText('Ingresa una referencia numérica de hasta 7 dígitos');
    }
    await expect(page.getByLabel('Referencia numérica')).toHaveAttribute('maxlength', '7');
    await expect(page.getByLabel('Concepto')).toHaveAttribute('maxlength', '40');
    await fill(page, { concept: '   ' });
    await toReview(page);
    await expect(page.locator('#tf-concept-error')).toHaveText('El concepto de transferencia es requerido');
    await fill(page, { concept: 'x'.repeat(40) });
    await expect(page.locator('#tf-concept-count')).toHaveText('40 / 40');
    // Tabs keep everything that was captured.
    await fill(page, { amount: '10.5', concept: 'Conservado', reference: '42' });
    await page.getByRole('button', { name: 'Entre mis cuentas' }).click();
    await page.getByRole('button', { name: 'A un beneficiario' }).click();
    await expect(page.getByLabel('Importe a transferir')).toHaveValue('10.5');
    await expect(page.getByLabel('Concepto')).toHaveValue('Conservado');
    await expect(page.getByLabel('Referencia numérica')).toHaveValue('42');
    await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card')).toContainText('Persona Prueba Dos');
    expect(nonGet(api)).toEqual([]);
    // Accepted values are sent in minor units as strings: 10 → 1000, 10.5 → 1050, 10.50 → 1050.
    const sent: string[] = [];
    for (const raw of ['10', '10.5', '10.50']) {
      const { context: ctx, page: p } = await newPage(browser, V1440);
      const mock = await open(p, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      await fill(p, { amount: raw, concept: 'Importe', reference: '7' });
      await toReview(p);
      await send(p);
      await expect(p.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible();
      sent.push((JSON.parse(posts(mock)[0]!.body!) as { amountMinor: string }).amountMinor);
      await ctx.close();
    }
    expect(sent).toEqual(['1000', '1050', '1050']);
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    recordMetric('W08-F2 FN-06 FN-07', { rejected, accepted: { '10': sent[0], '10.5': sent[1], '10.50': sent[2] } });
    await context.close();
  });

  test('W08-F4 / D-5: un importe mayor al saldo pasa a W09 (sin bloqueo cliente) y W09-V4 lo indica', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const api = await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { policy: data.policy({ otpThresholdMinor: '99999999' }) });
    await fill(page, { amount: '8000', concept: 'Mayor al saldo', reference: '8' });
    await expect(page.getByRole('complementary', { name: 'Resumen previo' }).locator('.tf-projection-note')).toHaveText('El importe supera el saldo disponible actual');
    await toReview(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa y confirma tu transferencia');
    await expect(page.locator('.tr-exceeds')).toHaveText('El importe supera el saldo disponible actual');
    await expect(page.getByRole('button', { name: 'Confirmar transferencia' })).toBeEnabled();
    expect(nonGet(api)).toEqual([]);
    recordMetric('W08-F4', { amount: '8000 > 7345', review: 'W09 con «El importe supera el saldo disponible actual»' });
    await context.close();
  });

  test('W08 A11Y-06 textos largos y A11Y-05 reflow', async ({ browser }) => {
    const long = data.beneficiary({ name: `Persona ${'Muy Larga '.repeat(12)}`.slice(0, 120), alias: `Alias ${'extenso '.repeat(10)}`.slice(0, 80) });
    const longAccounts = [data.account({ name: `Cuenta ${'nombre largo '.repeat(4)}`.slice(0, 40) }), data.account({ id: data.ids.savings, name: `Ahorro ${'nombre largo '.repeat(4)}`.slice(0, 40), kind: 'savings', availableBalanceMinor: '215075' })];
    const metrics: Record<string, unknown> = {};
    for (const viewport of [V1440, viewportR(REF.W08), V768, V390]) {
      for (const type of ['beneficiary', 'own_account'] as const) {
        const { context, page } = await newPage(browser, viewport);
        const seen = watch(page);
        await open(page, type === 'beneficiary' ? `/transfers/new?beneficiaryId=${long.id}` : '/transfers/new?type=own_account', { beneficiaries: [long], accounts: longAccounts });
        await fill(page, { amount: '10', concept: 'C'.repeat(40), reference: '1234567' });
        await settle(page);
        await responsive(page);
        expect(await clippedText(page)).toEqual([]);
        if (type === 'beneficiary') {
          await expect(page.locator('.tf-select-card .tf-alias')).toHaveAttribute('title', `Alias: ${long.alias}`);
          await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card .t-headline-sm')).toHaveAttribute('title', long.name);
        }
        await shoot(page, `W08-textos-largos-${type}`, { scenario: 'F-W08-7', screen: 'W08', state: `textos largos (${type})`, reference: REF.W08 }, viewport);
        await toReview(page);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa y confirma tu transferencia');
        await settle(page);
        await responsive(page);
        expect(await clippedText(page)).toEqual([]);
        await shoot(page, `W09-textos-largos-${type}`, { scenario: 'F-W08-7', screen: 'W09', state: `textos largos (${type})`, reference: type === 'beneficiary' ? REF.W09 : REF.W09_OWN }, viewport);
        expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
        await context.close();
      }
      metrics[viewport.label] = 'sin desborde; nombres truncados con title o con ajuste de línea';
    }
    metrics.reflowW08 = await reflow(browser, async (page) => { await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`); await fill(page, { amount: '0', reference: 'x' }); await toReview(page); await settle(page); });
    metrics.reflowW08Own = await reflow(browser, async (page) => { await open(page, '/transfers/new?type=own_account'); await settle(page); });
    metrics.reflowW09 = await reflow(browser, async (page) => { await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`); await fill(page, { amount: '7000', concept: 'Reflow', reference: '1' }); await toReview(page); await settle(page); });
    metrics.reflowW09Own = await reflow(browser, async (page) => { await open(page, '/transfers/new?type=own_account'); await fill(page, { amount: '15', concept: 'Reflow', reference: '1' }); await toReview(page); await settle(page); });
    recordMetric('W08/W09 A11Y-05/06', metrics);
  });
});

// ───────────────────────────── W09 ─────────────────────────────
async function review(page: Page, path: string, values: { amount: string; concept: string; reference: string }, initial: Partial<MockState> = {}) {
  const api = await open(page, path, initial);
  await fill(page, values);
  await toReview(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa y confirma tu transferencia');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  return api;
}

test.describe('W09 · Revisión', () => {
  for (const viewport of [V1440, viewportR(REF.W09), V768, V390]) {
    test(`W09-V1…V5 normal ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '850', concept: '  Comida ', reference: '204801' });
      await settle(page);
      const metrics: Record<string, unknown> = {};
      await expect(page.locator('.tr-crumbs .tf-breadcrumb')).toHaveText('TransferirPaso 2 de 2: Revisión');
      await expect(page.locator('.tr-crumbs .tr-steps span')).toHaveCount(2);
      await expect(page.locator('.tr-eyebrow')).toHaveText('Confirmación requerida');
      expect(await font(page.locator('.tr-eyebrow'))).toMatchObject({ 'font-size': '11px', 'text-transform': 'uppercase', color: 'rgb(0, 55, 176)' });
      expect(await font(page.locator('h1'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px' } : { 'font-size': '24px', 'line-height': '32px' });
      await expect(page.locator('.tr-title > p').last()).toHaveText('Verifica los detalles antes de procesar el envío. El dinero aún no ha sido debitado.');
      const card = page.locator('.tr-main-card');
      if (viewport.width >= 1024) expect(near((await box(card)).width, 768)).toBe(true);
      expect(await styles(card.locator('.tr-banner'), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)' });
      await expect(card.locator('.tr-banner h2')).toHaveText('Revisa los datos antes de enviar');
      await expect(card.locator('.tr-banner p').first()).toHaveText('Verifica los detalles antes de continuar. La operación aún no ha sido enviada ni debitada.');
      await expect(card.locator('#tr-amount-label')).toHaveText('Monto a transferir');
      await expect(card.locator('.tr-amount')).toHaveText('$850.00 MXN');
      expect(await font(card.locator('.tr-amount'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '40px', 'font-weight': '600' } : { 'font-size': '32px', 'font-weight': '600' });
      await expect(card.locator('.tr-kind-chip')).toHaveText('Transferencia interna');
      const parties = card.locator('.tr-party');
      await expect(parties.nth(0)).toContainText('Cuenta de origen');
      await expect(parties.nth(0).locator('.tr-party-name')).toHaveText(`${checking.name}(•• ${tail(checking.clabeMasked)})`);
      await expect(parties.nth(0)).toContainText('Saldo actual: $7,345.00 MXN');
      await expect(parties.nth(1).locator('.tr-party-name')).toHaveText('Persona Prueba DosPrueba Dos');
      await expect(parties.nth(1)).toContainText(`Billetera MXN (•• ${tail(data.beneficiary().clabeMasked)})`);
      expect(await styles(parties.nth(0), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)' });
      // FN-08: the review shows the trimmed concept that will be sent.
      await expect(card.locator('.tr-meta dd')).toHaveText(['Comida', '204801']);
      await expect(card.locator('.tr-meta svg[data-icon="notes"]')).toHaveCount(1);
      await expect(card.locator('.tr-meta svg[data-icon="tag"]')).toHaveCount(1);
      await expect(card.locator('.tr-estimate-title')).toHaveText('Saldo estimado post-operación');
      await expect(card.locator('.tr-formula')).toHaveText('$7,345.00 − $850.00 =');
      expect(await styles(card.locator('.tr-formula .tr-error-text'), ['color'] as const)).toEqual({ color: 'rgb(186, 26, 26)' });
      await expect(card.locator('.tr-estimate-value')).toHaveText('$6,495.00 MXN');
      expect(await font(card.locator('.tr-estimate-value'))).toMatchObject({ 'font-size': '20px', 'font-weight': '600' });
      const footer = card.locator('.tr-footer');
      // UX-T2 (D-UX-7, RV-01): ≥1024 footer with the primary on the right; <1024 the primary lives in the sticky ActionBar.
      await expect(footer.getByRole('button')).toHaveText(wide(viewport) ? ['Modificar datos', 'Confirmar transferencia'] : ['Modificar datos']);
      await expect(footer.getByRole('button', { name: 'Modificar datos' }).locator('svg[data-icon="edit"]')).toHaveCount(1);
      const confirmButton = page.getByRole('button', { name: 'Confirmar transferencia' });
      await expect(confirmButton).toHaveCount(1);
      await expectPrimary(confirmButton);
      if (wide(viewport)) expect((await box(confirmButton)).x).toBeGreaterThan((await box(footer.getByRole('button', { name: 'Modificar datos' }))).x + 200);
      else expect(await confirmButton.evaluate((element) => Boolean(element.closest('.action-bar')))).toBe(true);
      await expect(page.locator('main')).not.toContainText(/Comisión|SPEI|Tipo de cambio|Fecha estimada|Folio/);
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(['Modificar datos', 'Confirmar transferencia'], wide(viewport)));
      await shoot(page, 'W09-normal', { scenario: 'F-W09-1', screen: 'W09', state: 'beneficiario bajo umbral', reference: REF.W09 }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W09-normal', { scenario: 'F-W09-1', screen: 'W09', state: 'beneficiario bajo umbral', reference: REF.W09 }, viewport)).differentPixelRatio;
      // W09-F3: «Modificar datos» returns to W08 with every value and no write request.
      await page.getByRole('button', { name: 'Modificar datos' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferir dinero');
      await expect(page.getByLabel('Importe a transferir')).toHaveValue('850');
      await expect(page.getByLabel('Concepto')).toHaveValue('  Comida ');
      await expect(page.getByLabel('Referencia numérica')).toHaveValue('204801');
      await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card')).toContainText('Persona Prueba Dos');
      expect(nonGet(api)).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W09-V1-V5 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W09_CODE), V768, V390]) {
    test(`W09-V6 requiere código ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      // Threshold from the simulated policy (700000): exactly the threshold already requires the code (>=).
      const api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '7000', concept: 'Servicios profesionales', reference: '204802' },
        { createReplies: [{ status: 202, body: data.transfer({ status: 'awaiting_confirmation', amountMinor: '700000', concept: 'Servicios profesionales', reference: '204802', completedAt: null, receiptReference: null, expiresAt: '2026-11-17T16:05:00.000Z' }) }] });
      await settle(page);
      const metrics: Record<string, unknown> = {};
      const side = page.getByRole('complementary', { name: 'Se requiere código de confirmación' });
      await expect(side.locator('p')).toHaveText('Como el importe es igual o mayor al umbral configurado ($7,000.00 MXN, demostración), te pediremos un código de confirmación en el siguiente paso.');
      await expect(side.getByRole('button')).toHaveText(wide(viewport) ? ['Continuar a verificación', 'Modificar datos'] : ['Modificar datos']);
      await expectPrimary(page.getByRole('button', { name: 'Continuar a verificación' }));
      await expect(page.locator('.tr-footer')).toHaveCount(0);
      await expect(page.locator('.tr-steps-wide span')).toHaveCount(2);
      const [mainBox, sideBox] = [await box(page.locator('.tr-col-main')), await box(side)];
      if (wide(viewport)) { expect(near(mainBox.y, sideBox.y)).toBe(true); expect(mainBox.width / (mainBox.width + sideBox.width)).toBeGreaterThan(0.6); }
      else expect(sideBox.y).toBeGreaterThan(mainBox.y + mainBox.height - 1);
      metrics.layout = { main: mainBox, side: sideBox };
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(wide(viewport) ? ['Continuar a verificación', 'Modificar datos'] : ['Modificar datos', 'Continuar a verificación'], wide(viewport)));
      await shoot(page, 'W09-codigo', { scenario: 'F-W09-2', screen: 'W09', state: 'importe ≥ umbral (política)', reference: REF.W09_CODE }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W09-codigo', { scenario: 'F-W09-2', screen: 'W09', state: 'importe ≥ umbral', reference: REF.W09_CODE }, viewport)).differentPixelRatio;
      await page.getByRole('button', { name: 'Continuar a verificación' }).click();
      await expect(page.getByLabel('Código de confirmación de 6 dígitos')).toBeVisible();
      expect(posts(api)).toHaveLength(1);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W09-V6 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  test('W09-F2: la variante depende sólo de la política; la respuesta del servidor prevalece; SC-05 sin «demostración» si demoOnly=false', async ({ browser }) => {
    const metrics: Record<string, unknown> = {};
    // Just below the threshold → normal review; the server still answers 202 → W10.
    let { context, page } = await newPage(browser, V1440);
    let api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '6999.99', concept: 'Bajo umbral', reference: '1' }, { createReplies: [{ status: 202, body: data.transfer({ status: 'awaiting_confirmation', completedAt: null, receiptReference: null, expiresAt: '2026-11-17T16:05:00.000Z' }) }] });
    await expect(page.locator('.tr-footer').getByRole('button', { name: 'Confirmar transferencia' })).toBeVisible();
    await send(page);
    await expect(page.getByLabel('Código de confirmación de 6 dígitos')).toBeVisible();
    metrics.belowThreshold202 = 'W09 normal → 202 → W10';
    await context.close();
    // Predicted code but the server completes (201) → W12.
    ({ context, page } = await newPage(browser, V1440));
    api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '7000', concept: 'Umbral', reference: '2' }, { policy: data.policy({ demoOnly: false }) });
    await expect(page.getByRole('complementary', { name: 'Se requiere código de confirmación' }).locator('p')).toHaveText('Como el importe es igual o mayor al umbral configurado ($7,000.00 MXN), te pediremos un código de confirmación en el siguiente paso.');
    await expect(page.locator('main')).not.toContainText(/demostraci/i);
    await send(page);
    await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible();
    expect(posts(api)).toHaveLength(1);
    metrics.predicted201 = 'W09 código → 201 → W12; sin «demostración» con demoOnly=false';
    await context.close();
    // Policy unavailable → neutral copy and «Confirmar transferencia» (F-W09-5).
    ({ context, page } = await newPage(browser, V1440));
    const seen = watch(page);
    api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '70000', concept: 'Sin política', reference: '3' }, { policy: problem(503, 'Servicio no disponible.', 'Service Unavailable'), createReplies: [{ status: 202, body: data.transfer({ status: 'awaiting_confirmation', completedAt: null, receiptReference: null, expiresAt: '2026-11-17T16:05:00.000Z' }) }] });
    await expect(page.locator('.tr-neutral')).toHaveText('Puede requerir un código de confirmación.');
    await expect(page.getByRole('button', { name: 'Confirmar transferencia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar a verificación' })).toHaveCount(0);
    await expect(page.locator('#tf-amount-daily')).toHaveCount(0);
    await shoot(page, 'W09-sin-politica', { scenario: 'F-W09-5', screen: 'W09', state: 'política no disponible', reference: REF.W09 }, V1440);
    await send(page);
    await expect(page.getByLabel('Código de confirmación de 6 dígitos')).toBeVisible();
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    metrics.noPolicy = { provoked: seen.provoked.length, copy: 'Puede requerir un código de confirmación.', response: '202 → W10' };
    recordMetric('W09-F2', metrics);
    await context.close();
  });

  for (const viewport of [V1440, R_HTML, V768, V390]) {
    test(`W09-V7 cuentas propias ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await review(page, '/transfers/new?type=own_account', { amount: '1500', concept: 'Traspaso a ahorro', reference: '204803' });
      await settle(page);
      const metrics: Record<string, unknown> = {};
      await expect(page.locator('.tr-stepper li')).toHaveText(['1. Configuración de envío(completado)', '', '2Revisión y confirmación']);
      await expect(page.locator('.tr-step-current')).toHaveAttribute('aria-current', 'step');
      await expect(page.locator('.tr-own-banner p')).toHaveText('El traspaso entre tus cuentas aún no ha sido confirmado.');
      await expect(page.locator('.tr-step-chip')).toHaveText('Paso 2 de 2');
      const breakdown = page.getByRole('region', { name: 'Desglose de la operación' });
      await expect(breakdown.locator('.tr-hero-amount')).toHaveText('$1,500.00 MXN');
      expect(await styles(breakdown.locator('.tr-hero-amount'), ['color', 'font-size'] as const)).toEqual({ color: 'rgb(0, 55, 176)', 'font-size': viewport.width >= 768 ? '40px' : '32px' });
      await expect(breakdown.locator('.tr-node')).toHaveText([
        `Cuenta origen${checking.name}•• ${tail(checking.clabeMasked)}Saldo disponible:$7,345.00 MXN`,
        `Cuenta destino${savings.name}•• ${tail(savings.clabeMasked)}Saldo actual:$2,150.75 MXN`,
      ]);
      await expect(breakdown.locator('.tr-meta-strip dd')).toHaveText(['Traspaso a ahorro', '204803']);
      const projection = page.getByRole('region', { name: 'Proyección estimada' });
      await expect(projection.locator('.tr-projection-card')).toHaveText([
        `${checking.name}Cargo$7,345.00 − $1,500.00Nuevo saldo:$5,845.00 MXN`,
        `${savings.name}Abono$2,150.75 + $1,500.00Nuevo saldo:$3,650.75 MXN`,
      ]);
      await expect(page.locator('main')).not.toContainText(/Distribución patrimonial|Comisión|Fecha valor|Inmediat/);
      const summary = page.getByRole('complementary', { name: 'Resumen' });
      await expect(summary.locator('dl > div')).toHaveText(['Titular:Persona Prueba Uno', 'Tipo de traspaso:Entre cuentas propias', 'Total a debitar:$1,500.00 MXN']);
      // UX-T2 (D-UX-7): <1024 the primary moves to the sticky ActionBar after the summary.
      await expect(summary.getByRole('button')).toHaveText(wide(viewport) ? ['Confirmar transferencia', 'Modificar datos'] : ['Modificar datos']);
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(wide(viewport) ? ['Confirmar transferencia', 'Modificar datos'] : ['Modificar datos', 'Confirmar transferencia'], wide(viewport)));
      await shoot(page, 'W09-propias', { scenario: 'F-W09-3', screen: 'W09', state: 'cuentas propias', reference: REF.W09_OWN }, viewport);
      if (viewport.label === 'R') await sideBySideHtml(browser, page, 'W09-propias', { scenario: 'F-W09-3', screen: 'W09', state: 'cuentas propias', reference: REF.W09_OWN }, viewport);
      await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
      await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible();
      expect(JSON.parse(posts(api)[0]!.body!)).toEqual({ sourceAccountId: checking.id, destinationType: 'own_account', destinationAccountId: savings.id, amountMinor: '150000', concept: 'Traspaso a ahorro', reference: '204803' });
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W09-V7 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  test('W09 F-W09-4 propias con importe ≥ umbral', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    await review(page, '/transfers/new?type=own_account', { amount: '7000', concept: 'Propias umbral', reference: '4' });
    const summary = page.getByRole('complementary', { name: 'Resumen' });
    await expect(summary.locator('.tr-code-note')).toHaveText('Como el importe es igual o mayor al umbral configurado ($7,000.00 MXN, demostración), te pediremos un código de confirmación en el siguiente paso.');
    await expect(summary.getByRole('button')).toHaveText(['Continuar a verificación', 'Modificar datos']);
    await expect(page.locator('.tr-new-balance').first()).toHaveText('Nuevo saldo:$345.00 MXN');
    await shoot(page, 'W09-propias-codigo', { scenario: 'F-W09-4', screen: 'W09', state: 'propias ≥ umbral', reference: REF.W09_OWN }, V1440);
    recordMetric('W09 F-W09-4', { cta: 'Continuar a verificación', note: 'umbral de la política (demostración)' });
    await context.close();
  });

  test('W09-F1 / FN-15 [F]: doble clic emite un solo POST con el cuerpo revisado (FN-08)', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '12.30', concept: ' Doble clic ', reference: '4321' });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') await hold; await route.fallback(); });
    await page.getByRole('button', { name: 'Confirmar transferencia' }).dblclick();
    // WF-T5 (W11-V1): while the POST is in flight W09 gives way to «Enviando transferencia» with a disabled bar.
    await expect(page.getByRole('button', { name: 'Enviando transferencia…' })).toBeDisabled();
    release();
    await expect(page.getByRole('heading', { name: 'Transferencia completada' })).toBeVisible();
    expect(posts(api)).toHaveLength(1);
    expect(JSON.parse(posts(api)[0]!.body!)).toEqual({ sourceAccountId: checking.id, destinationType: 'beneficiary', beneficiaryId: data.ids.beneficiary, amountMinor: '1230', concept: 'Doble clic', reference: '4321' });
    recordMetric('W09-F1 FN-15 [F]', { posts: 1, body: 'igual a la revisión (concepto recortado)' });
    await context.close();
  });
});

// ───────────────────────────── W13 ─────────────────────────────
async function rejectAtCreate(page: Page, reply: { status: number; body: unknown }, initial: Partial<MockState> = {}, amount = '8000') {
  const api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount, concept: 'Rechazo', reference: '913' }, { ...initial, createReplies: [reply] });
  await send(page);
  return api;
}

test.describe('W13 · Rechazos', () => {
  for (const viewport of [V1440, viewportR(REF.W13_BALANCE), V768, V390]) {
    test(`W13-V1/V2/V5 saldo insuficiente ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await rejectAtCreate(page, problem(422, 'Saldo insuficiente.', 'Unprocessable Entity'), { policy: data.policy({ otpThresholdMinor: '99999999' }) });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferencia rechazada: Saldo insuficiente');
      await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
      await settle(page);
      const metrics: Record<string, unknown> = {};
      // The balance shown is the one read after the rejection.
      const postIndex = api.requests.findIndex((item) => item.method === 'POST' && item.path === '/v1/transfers');
      expect(api.requests.slice(postIndex + 1).some((item) => item.method === 'GET' && item.path === '/v1/accounts')).toBe(true);
      expect(await styles(page.locator('.rj-icon'), ['background-color', 'color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)', color: 'rgb(186, 26, 26)', 'border-radius': '9999px' });
      await expect(page.locator('.rj-icon svg[data-icon="walletOutlined"]')).toHaveCount(1);
      await expect(page.locator('.rj-header p')).toHaveText('El monto solicitado supera los fondos disponibles en tu cuenta.');
      const card = page.locator('.rj-card');
      if (viewport.width >= 1024) expect(near((await box(card)).width, 576)).toBe(true);
      await expect(card.getByRole('alert')).toHaveText('Fondos preservadosNo se realizó ningún cargo por este intento. Tu saldo permanece intacto.');
      expect(await styles(card.getByRole('alert'), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)' });
      await expect(card.locator('.rj-breakdown > div')).toHaveText([
        'Desglose de operaciónMXN', 'Monto solicitado$8,000.00 MXN', 'Saldo disponible en cuenta$7,345.00 MXN',
        'Faltante para completarFaltan $655.00 MXN', 'Saldo final de la cuentaIntacto$7,345.00 MXN',
      ]);
      expect(await styles(card.locator('.rj-row-missing'), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)' });
      expect(await styles(card.locator('.rj-intact'), ['background-color', 'color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(152, 246, 187)', color: 'rgb(0, 115, 69)', 'border-radius': '9999px' });
      const modify = card.getByRole('button', { name: 'Modificar monto' });
      await expectPrimary(modify);
      await expect(modify.locator('svg[data-icon="edit"]')).toHaveCount(1);
      const home = card.getByRole('link', { name: 'Volver al inicio' });
      await expect(home).toHaveAttribute('href', '/accounts');
      expect(await styles(home, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(224, 232, 255)' });
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(['Modificar monto', 'Volver al inicio'], wide(viewport)));
      await shoot(page, 'W13-saldo', { scenario: 'F-W13-1', screen: 'W13', state: '422 «Saldo insuficiente.» en create', reference: REF.W13_BALANCE }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W13-saldo', { scenario: 'F-W13-1', screen: 'W13', state: 'saldo insuficiente', reference: REF.W13_BALANCE }, viewport)).differentPixelRatio;
      // W13-F1: back to W08 with every field and the focus on the amount; no write request.
      const before = nonGet(api).length;
      await modify.click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferir dinero');
      await expect(page.getByLabel('Importe a transferir')).toBeFocused();
      await expect(page.getByLabel('Importe a transferir')).toHaveValue('8000');
      await expect(page.getByLabel('Concepto')).toHaveValue('Rechazo');
      await expect(page.getByLabel('Referencia numérica')).toHaveValue('913');
      await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card')).toContainText('Persona Prueba Dos');
      expect(nonGet(api).length).toBe(before);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W13-V1-V2 ${viewport.label}`, { ...metrics, provoked: seen.provoked });
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W13_LIMIT), V768, V390]) {
    test(`W13-V3/V4/V5 límite diario ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      await rejectAtCreate(page, problem(429, 'Se excedió el límite diario.', 'Too Many Requests'), { policy: data.policy({ dailyLimitMinor: '2000000', dailyUsedMinor: '1950000', dailyRemainingMinor: '50000' }) }, '850');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferencia rechazada: Límite diario alcanzado');
      await settle(page);
      const metrics: Record<string, unknown> = {};
      await expect(page.locator('.rj-chip')).toHaveText('Operación no procesada');
      expect(await styles(page.locator('.rj-chip'), ['border-radius', 'background-color', 'color'] as const)).toEqual({ 'border-radius': '9999px', 'background-color': 'rgb(255, 218, 214)', color: 'rgb(147, 0, 10)' });
      await expect(page.locator('.rj-header p')).toHaveText('El monto solicitado excede el disponible diario de transferencias.');
      await expect(page.getByRole('alert')).toHaveText('Rechazo confirmado: No se realizó ningún cargo por este intento.');
      await expect(page.locator('#rj-limits-title')).toHaveText('Desglose de límites y montos');
      await expect(page.locator('.rj-limits-panel > div')).toHaveText([
        'Límite diario configurado (demostración)$20,000.00 MXN', '', 'Monto acumulado enviado hoy$19,500.00 MXN', 'Disponible restante hoy$500.00 MXN', '',
        'Monto solicitado en esta operación$850.00 MXN', 'Cargo aplicado$0.00 MXN (sin débito)',
      ]);
      expect(await page.locator('.rj-used').evaluate((element) => (element as HTMLElement).style.width)).toBe('97.5%');
      expect(await styles(page.locator('.rj-remaining'), ['color'] as const)).toEqual({ color: 'rgb(0, 109, 64)' });
      expect(await styles(page.locator('.rj-requested'), ['color'] as const)).toEqual({ color: 'rgb(186, 26, 26)' });
      await expect(page.locator('.rj-info')).toHaveText('La operación no pudo completarse porque supera el disponible diario de $500.00 MXN. Tu límite se restablece al iniciar el siguiente día de negocio (America/Mexico_City).');
      await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/accounts');
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(['Modificar monto', 'Volver al inicio'], wide(viewport)));
      await shoot(page, 'W13-limite', { scenario: 'F-W13-2', screen: 'W13', state: '429 «Se excedió el límite diario.» en create', reference: REF.W13_LIMIT }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W13-limite', { scenario: 'F-W13-2', screen: 'W13', state: 'límite diario', reference: REF.W13_LIMIT }, viewport)).differentPixelRatio;
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W13-V3-V4 ${viewport.label}`, { ...metrics, provoked: seen.provoked });
      await context.close();
    });
  }

  test('W13 F-W13-4 sin política: se ocultan las filas de límite; demoOnly=false sin «(demostración)»; otros 422/429 no son W13', async ({ browser }) => {
    const metrics: Record<string, unknown> = {};
    let { context, page } = await newPage(browser, V1440);
    const api = await installMockApi(page, { createReplies: [problem(429, 'Se excedió el límite diario.', 'Too Many Requests')] });
    await page.goto(`/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
    await fill(page, { amount: '10', concept: 'Sin política', reference: '1' });
    await toReview(page);
    api.state.policy = problem(503, 'Servicio no disponible.', 'Service Unavailable');
    await send(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Transferencia rechazada: Límite diario alcanzado');
    await expect(page.locator('.rj-limits-panel > div')).toHaveText(['Monto solicitado en esta operación$10.00 MXN', 'Cargo aplicado$0.00 MXN (sin débito)']);
    await expect(page.locator('.rj-limit-bar')).toHaveCount(0);
    await expect(page.locator('.rj-info')).toHaveText('La operación supera el disponible diario de transferencias. Tu límite se restablece al iniciar el siguiente día de negocio.');
    await shoot(page, 'W13-limite-sin-politica', { scenario: 'F-W13-4', screen: 'W13', state: 'política no disponible', reference: REF.W13_LIMIT }, V1440);
    metrics.noPolicy = 'filas de límite ocultas; sólo mensaje';
    await context.close();
    ({ context, page } = await newPage(browser, V1440));
    await rejectAtCreate(page, problem(429, 'Se excedió el límite diario.', 'Too Many Requests'), { policy: data.policy({ demoOnly: false, otpThresholdMinor: '99999999' }) });
    await expect(page.locator('.rj-limits-panel')).toContainText('Límite diario configurado$30,000.00 MXN');
    await expect(page.locator('main')).not.toContainText(/demostraci/i);
    metrics.sc05 = 'demoOnly=false → sin «(demostración)»';
    await context.close();
    // A 422 whose detail is not balance/limit keeps the existing generic message (no W13, no «sin cargo» claim).
    ({ context, page } = await newPage(browser, V1440));
    await rejectAtCreate(page, problem(422, 'La cuenta de origen no está disponible.', 'Unprocessable Entity'), { policy: data.policy({ otpThresholdMinor: '99999999' }) });
    await expect(page.getByRole('alert')).toContainText('La cuenta de origen no está disponible.');
    await expect(page.getByRole('heading', { level: 1, name: /Transferencia rechazada/ })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/ningún cargo/);
    metrics.other422 = 'aviso genérico existente; sin W13';
    await context.close();
    // A lost response is never a rejection: W11 «Estamos verificando el resultado» (unchanged).
    ({ context, page } = await newPage(browser, V1440));
    await rejectAtCreate(page, 'abort' as unknown as { status: number; body: unknown }, { policy: data.policy({ otpThresholdMinor: '99999999' }) });
    await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible(); // WF-T5 W11-V3
    await expect(page.locator('main')).not.toContainText(/ningún cargo/);
    metrics.network = 'error de conexión → W11 (no W13)';
    recordMetric('W13 F-W13-4 y no-rechazos', metrics);
    await context.close();
  });

  test('W13 F-W13-3: 422 saldo y 429 límite en confirm → W13; «Modificar monto» vuelve a W08 con los datos del intento', async ({ browser }) => {
    const metrics: Record<string, unknown> = {};
    for (const [reply, title] of [[problem(422, 'Saldo insuficiente.', 'Unprocessable Entity'), 'Transferencia rechazada: Saldo insuficiente'], [problem(429, 'Se excedió el límite diario.', 'Too Many Requests'), 'Transferencia rechazada: Límite diario alcanzado']] as const) {
      const { context, page } = await newPage(browser, V1440);
      const seen = watch(page);
      const awaiting = data.transfer({ status: 'awaiting_confirmation', amountMinor: '700000', concept: 'Confirmación', reference: '77', completedAt: null, receiptReference: null, expiresAt: '2026-11-17T16:05:00.000Z', demoOnlyCode: '246810' });
      const api = await review(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { amount: '7000', concept: 'Confirmación', reference: '77' }, { createReplies: [{ status: 202, body: awaiting }], confirmReplies: [reply] });
      await send(page);
      await page.getByLabel('Código de confirmación de 6 dígitos').fill('246810');
      await page.getByRole('button', { name: /^Autorizar transferencia de / }).click(); // WF-T5: W10 CTA
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.locator('main')).toContainText('$7,000.00 MXN');
      await shoot(page, `W13-confirm-${reply.status}`, { scenario: 'F-W13-3', screen: 'W13', state: `${reply.status} en confirm`, reference: reply.status === 422 ? REF.W13_BALANCE : REF.W13_LIMIT }, V1440);
      const before = nonGet(api).length;
      await page.getByRole('button', { name: 'Modificar monto' }).click();
      await expect(page).toHaveURL(/\/transfers\/new$/);
      await expect(page.getByLabel('Importe a transferir')).toBeFocused();
      await expect(page.getByLabel('Importe a transferir')).toHaveValue('7000.00');
      await expect(page.getByLabel('Concepto')).toHaveValue('Confirmación');
      await expect(page.getByLabel('Referencia numérica')).toHaveValue('77');
      await expect(page.getByRole('group', { name: 'Destinatario' }).locator('.tf-select-card')).toContainText('Persona Prueba Dos');
      expect(nonGet(api).length).toBe(before);
      expect(await page.evaluate((id) => sessionStorage.getItem(`wallet:web:transfer-attempt:${id}`), data.user.id)).toBeNull();
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      metrics[String(reply.status)] = `${title} → Modificar monto → W08 con importe 7000.00, concepto y referencia`;
      await context.close();
    }
    recordMetric('W13 F-W13-3', metrics);
  });
});
