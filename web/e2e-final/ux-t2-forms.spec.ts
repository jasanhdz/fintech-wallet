// UX-T2 acceptance [F] (docs/web-ux-polish/SPEC.md §5.5, §7.2–7.3): long-form pattern (FM-02/03/05/06/07), W08 source
// selection (TF-01), summary sticky ≥1024 / collapsible <1024 (TF-02/TF-03), W07 summary next to the actions (FM-04) and
// W10 single indicator (FM-01). Simulated API; synthetic data only. No assertion here touches request bodies or keys:
// the golden trace and the functional suites keep covering them.
import { expect, test, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockState } from './helpers/mock-api.js';
import { recordMetric } from './helpers/evidence.js';
import { box } from './helpers/geometry.js';
import { newPage, settle, V1440, V390, type Viewport } from './helpers/screen.js';

const [checking, savings] = data.accounts() as [data.Account, data.Account];

async function open(page: Page, path: string, initial: Partial<MockState> = {}) {
  const api = await installMockApi(page, initial);
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await settle(page);
  return api;
}

/** Visible primary of the page and the fixed bottom navigation (when present). */
async function primaryAndNav(page: Page, name: string | RegExp) {
  const primary = page.getByRole('button', { name });
  const nav = page.locator('.shell-bottom-nav');
  return { primary: await box(primary), nav: (await nav.isVisible()) ? await box(nav) : null };
}

test.describe('UX-T2 · Formularios', () => {
  test('TF-01 origen: radiogroup inline con 2 cuentas (1 clic); con 4 cuentas «Cambiar cuenta» abre la lista; ORD-02 principal por defecto', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    // API order reversed (savings first): the principal (checking) is still the default source.
    await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { accounts: [savings, checking] });
    const sources = page.getByRole('radiogroup', { name: 'Cuenta de origen' });
    await expect(sources.getByRole('radio')).toHaveCount(2);
    await expect(sources.getByRole('radio', { checked: true })).toHaveAccessibleName(checking.name);
    await expect(page.getByRole('button', { name: 'Cambiar cuenta' })).toHaveCount(0);
    await sources.getByRole('radio', { name: savings.name }).click();
    await expect(sources.getByRole('radio', { name: savings.name })).toHaveAttribute('aria-checked', 'true');
    await context.close();

    const four = await newPage(browser, V1440);
    const extra = [data.account({ id: '7a2e0000-0000-4000-8000-000000000103', name: 'Gastos', kind: 'checking' }), data.account({ id: '7a2e0000-0000-4000-8000-000000000104', name: 'Viajes', kind: 'savings' })];
    await open(four.page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`, { accounts: [savings, ...extra, checking] });
    const change = four.page.getByRole('button', { name: 'Cambiar cuenta' });
    await expect(change).toHaveAttribute('aria-expanded', 'false');
    await expect(four.page.getByRole('radiogroup', { name: 'Cuenta de origen' })).toHaveCount(0);
    await change.click();
    await expect(four.page.getByRole('radiogroup', { name: 'Cuenta de origen' }).getByRole('radio')).toHaveCount(4);
    recordMetric('UX-T2 TF-01', { twoAccounts: 'radiogroup inline, principal por defecto', fourAccounts: 'Cambiar cuenta → lista' });
    await four.context.close();
  });

  test('FM-02/FM-03/FM-05 W08: sin errores antes de enviar; foco al primer inválido visible; resumen con un botón por campo', async ({ browser }) => {
    for (const viewport of [V1440, V390] as Viewport[]) {
      const { context, page } = await newPage(browser, viewport);
      await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      await page.getByLabel('Importe a transferir').fill('abc');
      await page.getByLabel('Referencia numérica').fill('x');
      await page.getByLabel('Concepto').focus();
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.getByRole('button', { name: 'Continuar a revisión' }).click();
      const amount = page.getByLabel('Importe a transferir');
      await expect(amount).toBeFocused();
      const field = await box(amount); const message = await box(page.locator('#tf-amount-error'));
      const viewportHeight = viewport.height;
      expect(field.y).toBeGreaterThanOrEqual(0); expect(message.y + message.height).toBeLessThanOrEqual(viewportHeight);
      const nav = await page.locator('.shell-bottom-nav').isVisible() ? await box(page.locator('.shell-bottom-nav')) : null;
      const bar = viewport.width < 1024 ? await box(page.locator('.action-bar')) : null;
      if (bar) expect(message.y + message.height).toBeLessThanOrEqual(bar.y + 1);
      if (nav) expect(message.y + message.height).toBeLessThanOrEqual(nav.y + 1);
      const summary = page.locator('#tf-error-summary');
      await expect(summary.getByRole('button')).toHaveText(['Importe a transferir', 'Concepto', 'Referencia numérica']);
      await summary.getByRole('button', { name: 'Referencia numérica' }).click();
      await expect(page.getByLabel('Referencia numérica')).toBeFocused();
      // Correcting a field removes its error on the next input; the others stay.
      await page.getByLabel('Referencia numérica').fill('12');
      await expect(page.getByLabel('Referencia numérica')).not.toHaveAttribute('aria-invalid', 'true');
      await expect(summary.getByRole('button')).toHaveText(['Importe a transferir', 'Concepto']);
      await context.close();
    }
  });

  test('FM-06/FM-07/TF-02 W08: ActionBar pegajosa <1024 y estática ≥1024 y en 390×500; resumen sticky ≥1024 y colapsable <1024', async ({ browser }) => {
    const metrics: Record<string, unknown> = {};
    {
      const { context, page } = await newPage(browser, V390);
      await open(page, '/transfers/new', { beneficiaries: [] });
      for (const where of ['top', 'middle', 'bottom'] as const) {
        await page.evaluate((position) => window.scrollTo(0, position === 'top' ? 0 : position === 'middle' ? document.documentElement.scrollHeight / 2 - innerHeight / 2 : document.documentElement.scrollHeight), where);
        await page.waitForTimeout(50);
        const { primary, nav } = await primaryAndNav(page, 'Continuar a revisión');
        expect(primary.y, `primary visible (${where})`).toBeGreaterThanOrEqual(0);
        expect(primary.y + primary.height, `primary above the bottom nav (${where})`).toBeLessThanOrEqual((nav?.y ?? 844) + 1);
        metrics[`390-${where}`] = primary;
      }
      // FM-07: the disabled primary has its reason inside the ActionBar, linked by aria-describedby.
      const reason = page.locator('.action-bar #tf-continue-reason');
      await expect(reason).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continuar a revisión' })).toHaveAttribute('aria-describedby', 'tf-continue-reason');
      // TF-02 <1024: collapsed summary behind a ≥44 px toggle.
      const toggle = page.locator('.tf-summary-toggle');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect((await box(toggle)).height).toBeGreaterThanOrEqual(44);
      await expect(page.locator('#tf-summary-body')).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#tf-summary-body')).toBeVisible();
      await expect(page.locator('#tf-summary-body')).toContainText('Elige un destinatario');
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, { label: 'short', width: 390, height: 500, dpr: 1 });
      await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      expect(await page.locator('.action-bar').evaluate((element) => getComputedStyle(element).position)).toBe('static');
      await context.close();
    }
    {
      const { context, page } = await newPage(browser, V1440);
      await open(page, `/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
      expect(await page.locator('.action-bar').evaluate((element) => getComputedStyle(element).position)).toBe('static');
      await expect(page.locator('.tf-summary-toggle')).toBeHidden();
      const aside = page.getByRole('complementary', { name: 'Resumen previo' });
      expect(await aside.evaluate((element) => [getComputedStyle(element).position, getComputedStyle(element).top])).toEqual(['sticky', '32px']);
      await page.evaluate(() => window.scrollTo(0, 400));
      await page.waitForTimeout(50);
      const stuck = await box(aside);
      expect(stuck.y).toBeGreaterThanOrEqual(31);
      metrics.summarySticky = stuck;
      await context.close();
    }
    recordMetric('UX-T2 FM-06 TF-02', metrics);
  });

  test('FM-04 W07: 404 → foco en CLABE con su mensaje; resumen inmediatamente antes de las acciones; sin banner sobre la tarjeta', async ({ browser }) => {
    for (const viewport of [V1440, V390] as Viewport[]) {
      const { context, page } = await newPage(browser, viewport);
      const api = await open(page, '/beneficiaries/new', { beneficiaries: [] });
      api.state.overrides.set('POST /beneficiaries', { status: 404, body: data.problem(404, 'No se encontró una cuenta interna.', 'Not Found') });
      await page.getByLabel('Nombre completo o razón social').fill('Persona Prueba Siete');
      await page.getByLabel('Alias o nombre corto').fill('Siete');
      await page.getByLabel('CLABE de 18 dígitos').fill(data.account().clabe);
      await page.getByRole('button', { name: 'Guardar beneficiario' }).click();
      const clabe = page.getByLabel('CLABE de 18 dígitos');
      await expect(clabe).toBeFocused();
      await expect(page.locator('#clabe-unavailable')).toBeVisible();
      const summary = page.locator('#bn-summary');
      await expect(summary).toHaveAttribute('role', 'alert');
      expect(await summary.evaluate((element) => element.nextElementSibling?.classList.contains('form-footer'))).toBe(true);
      const card = await box(page.locator('.bn-form-card'));
      expect((await box(summary)).y).toBeGreaterThan(card.y);
      await context.close();
    }
  });
});
