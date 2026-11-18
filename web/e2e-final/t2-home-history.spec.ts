// WF-T2 acceptance: W03 (Inicio + aviso pendiente), W04 (Historial) and W05 (Comprobante desde el historial).
// [F] scenarios use the simulated API (helpers/mock-api.ts, overridden per scenario with page.route);
// [I] scenarios (t2-integration.spec.ts) use the real P1/P2 APIs of SPEC §5.10.
import { expect, test, type Page, type Route } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi } from './helpers/mock-api.js';
import { capturePath, recordCapture, recordMetric } from './helpers/evidence.js';
import { composeSideBySide } from './helpers/side-by-side.js';
import { box, near, styles } from './helpers/geometry.js';
import { a11yBasics, newPage, reflow, responsive, runningAnimations, settle, shoot, sideBySide, V1440, V390, V768, viewportR, watch, withShell, type Viewport } from './helpers/screen.js';
import { clippedText } from './helpers/a11y.js';

const REF = {
  W03: 'w03_inicio_y_cuentas_corregido',
  W03_EMPTY: 'w03_inicio_sin_saldo',
  W03_PENDING: 'w03_operaci_n_pendiente_de_verificaci_n',
  W04: 'w04_historial_con_movimientos',
  W04_LOADING: 'w04_cargando',
  W04_EMPTY: 'w04_sin_movimientos',
  W04_NO_RESULTS: 'w04_sin_resultados',
  W04_MORE_ERROR: 'w04_error_al_cargar_m_s',
  W05: 'w05_comprobante_de_transferencia',
} as const;
const ATTEMPT_KEY = `wallet:web:transfer-attempt:${data.user.id}`;
const SYN_KEY = '5f0c1e2d-0000-4000-8000-00000000abcd';
const pendingBody = { sourceAccountId: data.ids.checking, destinationType: 'beneficiary', beneficiaryId: data.ids.beneficiary, amountMinor: '45075', concept: 'Pago pendiente de prueba', reference: '7788' };
const savings = data.accounts()[1]!;
const otherClabe = data.maskClabe(data.clabeFrom('64618000000000864'));

/** F-W03-1: three movements of the first account with counterparty (beneficiary, own account, beneficiary). */
const recent = (): data.Movement[] => [
  data.movement({ id: 'mv-r1', transferId: data.ids.transfer1, amountMinor: '12300', concept: 'Pago de prueba', reference: '4321', occurredAt: '2026-11-17T16:00:01.000Z' }),
  data.movement({ id: 'mv-r2', transferId: data.ids.transfer2, type: 'credit', amountMinor: '45075', concept: 'Traspaso de prueba', reference: '1200', occurredAt: '2026-11-16T15:10:00.000Z', counterparty: { name: savings.name, clabeMasked: savings.clabeMasked, ownAccountId: savings.id } }),
  data.movement({ id: 'mv-r3', transferId: '9c4a0000-0000-4000-8000-000000000403', amountMinor: '9990', concept: 'Servicio de prueba', reference: '55', occurredAt: '2026-11-15T17:20:00.000Z', counterparty: { name: 'Persona Prueba Tres', clabeMasked: otherClabe } }),
];

/** F-W04-1: 25 movements (page 1 = 20 with nextCursor, page 2 = 5); every 4th is a third-party credit. */
function history25(): data.Movement[] {
  return Array.from({ length: 25 }, (_, index) => {
    const n = index + 1;
    const occurredAt = new Date(Date.parse('2026-11-17T17:00:00.000Z') - index * 3_600_000 * 7).toISOString();
    if (n % 4 === 2) return data.movement({ id: `mv-h${n}`, transferId: `9c4a0000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`, type: 'credit', amountMinor: String(10000 + n * 137), concept: `Abono de prueba ${n}`, reference: String(9000 + n), occurredAt, counterparty: { name: 'Persona Prueba Cuatro', clabeMasked: otherClabe } });
    if (n % 4 === 3) return data.movement({ id: `mv-h${n}`, transferId: `9c4a0000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`, type: 'credit', amountMinor: String(20000 + n * 211), concept: `Traspaso propio ${n}`, reference: String(7000 + n), occurredAt, counterparty: { name: savings.name, clabeMasked: savings.clabeMasked, ownAccountId: savings.id } });
    return data.movement({ id: `mv-h${n}`, transferId: `9c4a0000-0000-4000-8000-0000000005${String(n).padStart(2, '0')}`, amountMinor: String(5000 + n * 173), concept: `Envío de prueba ${n}`, reference: String(100 + n), occurredAt });
  });
}

type MovementCall = { url: URL };
/** Paged movements endpoint honouring `type`, `from`, `to`, `cursor` and `limit` over a fixed list. */
async function routeMovements(page: Page, list: () => data.Movement[], options: { failCursor?: { remaining: number }; hold?: Promise<void>; failFirst?: { remaining: number } } = {}) {
  const calls: MovementCall[] = [];
  await page.route(/\/v1\/accounts\/[^/]+\/movements/, async (route: Route) => {
    const url = new URL(route.request().url());
    calls.push({ url });
    if (options.hold) await options.hold;
    const cursor = url.searchParams.get('cursor');
    if (options.failFirst && options.failFirst.remaining > 0 && !cursor) { options.failFirst.remaining -= 1; return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) }); }
    if (cursor && options.failCursor && options.failCursor.remaining > 0) { options.failCursor.remaining -= 1; return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) }); }
    const type = url.searchParams.get('type');
    const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const filtered = list().filter((item) => (!type || item.type === type) && (!from || item.occurredAt >= from) && (!to || item.occurredAt <= to));
    const start = cursor ? Number.parseInt(cursor.replace('c', ''), 10) : 0;
    const items = filtered.slice(start, start + limit);
    const nextCursor = start + limit < filtered.length ? `c${start + limit}` : null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor }) });
  });
  return calls;
}

async function open(page: Page, path: string, initial: Parameters<typeof installMockApi>[1] = {}) {
  const api = await installMockApi(page, initial);
  await page.goto(path);
  return api;
}

const seedAttempt = (page: Page, record: unknown) => page.addInitScript(({ userId, key, value }) => {
  if (sessionStorage.getItem('wf-t2-seeded')) return;
  sessionStorage.setItem('wf-t2-seeded', '1');
  sessionStorage.setItem('wallet:web:active-user', userId);
  sessionStorage.setItem(key, value);
}, { userId: data.user.id, key: ATTEMPT_KEY, value: JSON.stringify(record) });

const font = (selector: ReturnType<Page['locator']>) => styles(selector, ['font-size', 'line-height', 'font-weight', 'letter-spacing', 'color', 'text-transform'] as const);
const wide = (viewport: Viewport) => viewport.width >= 1024;

// ───────────────────────────── W03 ─────────────────────────────
// UX-T3 (D-UX-2, HM-03): one history link in the activity section, in its heading.
const W03_CONTENT = ['Transferir', 'Mover entre mis cuentas', 'Ver historial completo'];

test.describe('W03 · Inicio', () => {

  for (const viewport of [V1440, viewportR(REF.W03), V768, V390]) {
    test(`W03-V1…V4 con saldo ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const api = await open(page, '/accounts', { movements: recent() });
      await expect(page.getByRole('heading', { level: 1, name: `Hola, ${data.user.fullName}` })).toBeVisible();
      const activity = page.getByRole('region', { name: 'Actividad Reciente' });
      await expect(activity.locator('tbody tr')).toHaveCount(3);
      await settle(page);
      const metrics: Record<string, unknown> = {};
      // V1 header
      const eyebrow = page.locator('.home-eyebrow');
      await expect(eyebrow).toHaveText('Resumen financiero');
      const eyebrowFont = await font(eyebrow);
      expect(eyebrowFont).toMatchObject({ 'font-size': '11px', 'line-height': '16px', 'font-weight': '600', 'letter-spacing': '0.44px', 'text-transform': 'uppercase' });
      const h1Font = await font(page.locator('h1'));
      expect(h1Font).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px', 'font-weight': '600' } : { 'font-size': '24px', 'line-height': '32px', 'font-weight': '600' });
      await expect(page.locator('.home-date')).toHaveText('Martes, 17 de noviembre de 2026');
      await expect(page.locator('.home-date svg[data-icon="calendarOutlined"]')).toHaveCount(1);
      const total = page.getByRole('region', { name: 'Saldo consolidado' });
      await expect(total.locator('.home-total-tile svg[data-icon="walletOutlined"]')).toHaveCount(1);
      await expect(total.locator('[data-amount]')).toHaveText('$9,495.75 MXN');
      expect(await font(total.locator('.home-total-value'))).toMatchObject({ 'font-size': '20px', 'line-height': '28px', 'font-weight': '600' });
      expect(await font(total.locator('.home-suffix'))).toMatchObject({ 'font-size': '12px', 'font-weight': '500' });
      metrics.header = { eyebrowFont, h1Font, totalBox: await box(total) };
      // V2 account cards
      const cards = page.getByRole('region', { name: 'Tus cuentas' }).locator('article');
      await expect(cards).toHaveCount(2);
      const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
      if (wide(viewport)) { expect(near(a.y, b.y)).toBe(true); expect(near(b.x - (a.x + a.width), 24)).toBe(true); }
      else { expect(near(a.x, b.x)).toBe(true); expect(near(b.y - (a.y + a.height), 24)).toBe(true); }
      const cardStyle = await styles(cards.nth(0), ['border-radius', 'padding-top', 'padding-left', 'background-color', 'box-shadow'] as const);
      expect(cardStyle).toMatchObject({ 'border-radius': '16px', 'padding-top': '24px', 'padding-left': '24px', 'background-color': 'rgb(255, 255, 255)' });
      const bar = await cards.nth(0).evaluate((element) => { const style = getComputedStyle(element, '::before'); return { height: style.height, background: style.backgroundColor, content: style.content }; });
      expect(bar).toEqual({ height: '4px', background: 'rgb(0, 55, 176)', content: '""' });
      const secondBar = await cards.nth(1).evaluate((element) => getComputedStyle(element, '::before').content);
      expect(secondBar).toBe('none');
      await expect(cards.nth(0).locator('.home-account-chip')).toHaveText('Cuenta Principal');
      await expect(cards.nth(0).locator('.home-account-dot')).toHaveCount(1);
      const tail = data.accounts()[0]!.clabeMasked.slice(-4);
      await expect(cards.nth(0).locator('[data-clabe]')).toHaveText(`•••• ${tail}`);
      expect(await font(cards.nth(0).locator('[data-clabe]'))).toMatchObject({ 'font-size': '13px' });
      expect(await font(cards.nth(0).locator('.home-account-balance > span'))).toMatchObject({ 'font-size': '11px', 'font-weight': '600', 'text-transform': 'uppercase' });
      await expect(cards.nth(0).locator('[data-amount]')).toHaveText('$7,345.00 MXN');
      const amountFont = await font(cards.nth(0).locator('.home-balance-value'));
      expect(amountFont).toMatchObject(viewport.width >= 768 ? { 'font-size': '40px', 'font-weight': '600' } : { 'font-size': '32px', 'font-weight': '600' });
      expect(await font(cards.nth(0).locator('.home-balance-value .home-suffix'))).toMatchObject({ 'font-size': '16px', 'font-weight': '500', color: 'rgb(67, 70, 85)' });
      // V3 CTAs
      const transfer = cards.nth(0).getByRole('link', { name: 'Transferir' });
      await expect(transfer).toHaveAttribute('href', `/transfers/new?source=${data.ids.checking}`);
      const move = cards.nth(1).getByRole('link', { name: 'Mover entre mis cuentas' });
      await expect(move).toHaveAttribute('href', `/transfers/new?type=own_account&source=${data.ids.savings}`);
      expect(await styles(transfer, ['background-color', 'color', 'height', 'border-radius', 'font-size', 'font-weight'] as const)).toMatchObject({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', height: '44px', 'border-radius': '12px', 'font-size': '14px', 'font-weight': '500' });
      expect(await styles(move, ['background-color', 'color'] as const)).toMatchObject({ 'background-color': 'rgb(224, 232, 255)', color: 'rgb(20, 27, 44)' });
      const ctaBox = await box(transfer); const inner = a.width - 48;
      expect(near(ctaBox.width, inner)).toBe(true);
      // V4 activity
      expect(await font(activity.getByRole('heading', { level: 2 }))).toMatchObject({ 'font-size': '20px', 'line-height': '28px', 'font-weight': '600' });
      await expect(activity.locator('.home-section-title .chip')).toHaveText('Últimos movimientos');
      await expect(activity.getByRole('link', { name: 'Ver historial completo' })).toHaveAttribute('href', `/accounts/${data.ids.checking}/movements`);
      await expect(activity.locator(`a[href="/accounts/${data.ids.checking}/movements"]`)).toHaveCount(1);
      const rows = activity.locator('tbody tr');
      await expect(rows.nth(0)).toContainText('Persona Prueba Dos');
      await expect(rows.nth(0)).toContainText('17 de noviembre de 2026, 10:00');
      await expect(rows.nth(0)).toContainText('Pago de prueba');
      await expect(rows.nth(0)).toContainText('Ref: 4321');
      await expect(rows.nth(0).locator('.chip')).toHaveText('Completada');
      await expect(rows.nth(0).locator('[data-amount]')).toHaveText('−$123.00 MXN');
      await expect(rows.nth(1).locator('[data-amount]')).toHaveText('+$450.75 MXN');
      expect((await styles(rows.nth(1).locator('.home-activity-amount'), ['color'] as const)).color).toBe('rgb(0, 109, 64)');
      await expect(rows.nth(1)).toContainText(`•••• ${savings.clabeMasked.slice(-4)}`);
      if (viewport.width >= 768) {
        const th = activity.locator('th').first();
        expect(await styles(th, ['background-color', 'font-size', 'font-weight', 'text-transform'] as const)).toMatchObject({ 'background-color': 'rgb(241, 243, 255)', 'font-size': '11px', 'font-weight': '600', 'text-transform': 'uppercase' });
        await expect(activity.locator('th')).toHaveText(['Detalle / Beneficiario', 'Concepto & Referencia', 'Estado', 'Monto']);
      }
      await expect(activity.locator('.home-activity-footer')).toContainText('Mostrando los últimos 3 movimientos');
      await expect(activity.locator('.home-activity-footer a')).toHaveCount(0);
      metrics.cards = { a, b, cardStyle, bar, amountFont, cta: ctaBox };
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell(W03_CONTENT, wide(viewport)));
      // REC-03: no write requests on mount
      expect(api.nonGet().filter((item) => item.method !== 'POST' || item.path !== '/v1/auth/refresh')).toEqual([]);
      await shoot(page, 'W03-con-saldo', { scenario: 'F-W03-1', screen: 'W03', state: 'con saldo', reference: REF.W03 }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W03-con-saldo', { scenario: 'F-W03-1', screen: 'W03', state: 'con saldo', reference: REF.W03 }, viewport)).differentPixelRatio;
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W03-V1-V4 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W03_EMPTY), V768, V390]) {
    test(`W03-V5 sin saldo ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      await open(page, '/accounts', { accounts: [data.account({ availableBalanceMinor: '0' })], movements: [] });
      await expect(page.getByRole('region', { name: 'Tu cuenta está creada' })).toContainText('Tu cuenta principal está lista para operar.');
      await expect(page.getByRole('heading', { name: 'Cuentas Disponibles' })).toBeVisible();
      await expect(page.locator('.home-column-heading .chip')).toHaveText('1 cuenta activa');
      expect(await page.locator('.home-column-heading .chip').innerText()).toBe('1 CUENTA ACTIVA');
      await expect(page.getByText('0 Registros')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Aún no tienes movimientos registrados' })).toBeVisible();
      const card = page.getByRole('region', { name: 'Tus cuentas' }).locator('article');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('$0.00 MXN');
      const disabled = card.getByRole('button', { name: /Transferir/ });
      await expect(disabled).toBeDisabled();
      const reasonId = await disabled.getAttribute('aria-describedby');
      await expect(page.locator(`[id="${reasonId}"]`)).toHaveText('(Disponible cuando la cuenta tenga saldo)');
      await expect(page.locator(`[id="${reasonId}"]`)).toBeVisible();
      expect(await styles(disabled, ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(224, 232, 255)', color: 'rgb(116, 118, 134)' });
      if (wide(viewport)) {
        const [left, right] = [await box(page.locator('.home-empty-column').nth(0)), await box(page.locator('.home-empty-column').nth(1))];
        expect(near(left.y, right.y)).toBe(true);
        expect(right.width / left.width).toBeGreaterThan(1.3);
      }
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell([], wide(viewport))) };
      await shoot(page, 'W03-sin-saldo', { scenario: 'F-W03-2', screen: 'W03', state: 'sin saldo', reference: REF.W03_EMPTY }, viewport);
      const sbs = viewport.label === 'R' ? (await sideBySide(browser, page, 'W03-sin-saldo', { scenario: 'F-W03-2', screen: 'W03', state: 'sin saldo', reference: REF.W03_EMPTY }, viewport)).differentPixelRatio : undefined;
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W03-V5 ${viewport.label}`, { ...metrics, sideBySide: sbs });
      await context.close();
    });
  }

  test('W03-F2 cargando (skeleton aria-busy), error de cuentas con reintento y error de actividad que conserva cuentas', async ({ browser }) => {
    for (const viewport of [viewportR(REF.W03), V390]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      let accountsCalls = 0;
      const api = await open(page, '/accounts', { movements: recent() });
      await page.route('**/v1/accounts', async (route) => {
        accountsCalls += 1;
        if (accountsCalls <= 2) { await hold; return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) }); }
        return route.fallback();
      });
      await page.reload();
      const loading = page.getByRole('region', { name: 'Cargando cuentas' });
      await expect(loading).toHaveAttribute('aria-busy', 'true');
      expect(await runningAnimations(page), 'A11Y-10').toEqual([]);
      await shoot(page, 'W03-cargando', { scenario: 'F-W03-3', screen: 'W03', state: 'cargando', reference: REF.W03 }, viewport);
      release();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('No pudimos cargar tus cuentas');
      await expect(alert).toContainText('Servicio no disponible por el momento.');
      await responsive(page);
      await shoot(page, 'W03-error-cuentas', { scenario: 'F-W03-4', screen: 'W03', state: 'error de cuentas', reference: REF.W03 }, viewport);
      await alert.getByRole('button', { name: 'Intentar de nuevo' }).click();
      await expect(page.getByRole('region', { name: 'Tus cuentas' }).locator('article')).toHaveCount(2);
      expect(accountsCalls).toBeGreaterThanOrEqual(3); // initial + 1 automatic retry (QueryClient retry: 1) + manual retry
      // F-W03-5: activity fails, accounts stay, retry recovers.
      let failActivity = true;
      await page.route(/\/v1\/accounts\/[^/]+\/movements/, (route) => failActivity ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) }) : route.fallback());
      await page.reload();
      const activity = page.getByRole('region', { name: 'Actividad Reciente' });
      await expect(activity.getByRole('alert')).toContainText('No pudimos cargar la actividad reciente.');
      await expect(page.getByRole('region', { name: 'Tus cuentas' }).locator('article')).toHaveCount(2);
      await responsive(page);
      await shoot(page, 'W03-error-actividad', { scenario: 'F-W03-5', screen: 'W03', state: 'error de actividad', reference: REF.W03 }, viewport);
      failActivity = false;
      await activity.getByRole('button', { name: 'Intentar de nuevo' }).click();
      await expect(activity.locator('tbody tr')).toHaveCount(3);
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W03-F2 ${viewport.label}`, { loading: 'aria-busy=true, skeletons, no animation', accountsError: 'alert + Intentar de nuevo → GET /v1/accounts', activityError: 'cuentas conservadas + reintento', provoked: seen.provoked });
      await context.close();
    }
  });

  for (const withTransferId of [false, true]) {
    for (const viewport of [V1440, viewportR(REF.W03_PENDING), V768, V390]) {
      test(`W03-V6/F1 aviso pendiente ${withTransferId ? 'con' : 'sin'} transferId ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
        const { context, page } = await newPage(browser, viewport);
        const seen = watch(page);
        const record = withTransferId ? { key: SYN_KEY, body: pendingBody, transferId: data.ids.transfer1 } : { key: SYN_KEY, body: pendingBody };
        await seedAttempt(page, record);
        const transfers = new Map([[data.ids.transfer1, data.transfer({ amountMinor: '45075', concept: pendingBody.concept, reference: pendingBody.reference })]]);
        const api = await open(page, '/accounts', { movements: recent(), transfers });
        const notice = page.getByRole('region', { name: 'Estamos verificando el resultado de tu transferencia' });
        await expect(notice).toBeVisible();
        await expect(page.getByRole('region', { name: 'Tus cuentas' }).locator('article')).toHaveCount(2);
        await settle(page);
        const stored = await page.evaluate((key) => sessionStorage.getItem(key), ATTEMPT_KEY);
        expect(stored).toBe(JSON.stringify(record));
        await expect(notice.locator('.chip')).toHaveText('En verificación');
        expect(await notice.locator('.chip').innerText()).toBe('EN VERIFICACIÓN');
        expect(await styles(notice.locator('.chip'), ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(255, 219, 205)', color: 'rgb(122, 43, 0)' });
        await expect(notice).toContainText('Tienes una transferencia pendiente de verificación por $450.75 MXN (Beneficiario Billetera).');
        await expect(notice).toContainText('Ocurrió una interrupción durante el proceso.');
        // REC-05 / H-W1: no promise that nothing is sent again nor that the same attempt is merely consulted.
        await expect(notice).not.toContainText(/no se enviar|consultar[aá] el mismo intento|sin duplicar/i);
        const left = await notice.evaluate((element) => { const style = getComputedStyle(element, '::before'); return { width: style.width, background: style.backgroundColor }; });
        expect(left).toEqual({ width: '4px', background: 'rgb(122, 43, 0)' });
        expect(await styles(notice.locator('.home-pending-icon'), ['background-color', 'width', 'height'] as const)).toEqual({ 'background-color': 'rgb(255, 219, 205)', width: '40px', height: '40px' });
        await expect(notice.locator('.home-pending-icon svg[data-icon="syncProblem"]')).toHaveCount(1);
        const noticeBox = await box(notice); const mainContent = await box(page.locator('.home'));
        expect(near(noticeBox.width, mainContent.width)).toBe(true);
        const firstCard = await box(page.getByRole('region', { name: 'Tus cuentas' }).locator('article').first());
        expect(noticeBox.y + noticeBox.height).toBeLessThan(firstCard.y);
        const cta = notice.getByRole('link', { name: withTransferId ? 'Consultar estado' : 'Retomar verificación' });
        await expect(cta).toHaveAttribute('href', '/transfers/new');
        if (!withTransferId) {
          await expect(notice.getByText('Se repetirá la misma solicitud con su misma clave de operación.')).toBeVisible();
          await expect(cta).toHaveAttribute('aria-describedby', 'home-pending-repeat');
        } else {
          await expect(notice.getByText(/Se repetirá/)).toHaveCount(0);
        }
        if (wide(viewport)) { const ctaBox = await box(cta); const text = await box(notice.locator('.home-pending-text')); expect(ctaBox.x).toBeGreaterThan(text.x + text.width); }
        const metrics: Record<string, unknown> = { left, notice: noticeBox };
        metrics.responsive = await responsive(page);
        metrics.a11y = await a11yBasics(page, withShell([withTransferId ? 'Consultar estado' : 'Retomar verificación', ...W03_CONTENT], wide(viewport)));
        const name = `W03-pendiente-${withTransferId ? 'con' : 'sin'}-transferId`;
        await shoot(page, name, { scenario: withTransferId ? 'F-W03-7' : 'F-W03-6', screen: 'W03', state: `aviso pendiente ${withTransferId ? 'con' : 'sin'} transferId`, reference: REF.W03_PENDING }, viewport);
        if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, name, { scenario: withTransferId ? 'F-W03-7' : 'F-W03-6', screen: 'W03', state: 'aviso pendiente', reference: REF.W03_PENDING }, viewport)).differentPixelRatio;
        // REC-03: mounting W03 with the record emitted no write; the key never appears in the DOM.
        const writesBefore = api.nonGet().filter((item) => item.path !== '/v1/auth/refresh');
        expect(writesBefore).toEqual([]);
        expect(await page.content()).not.toContain(SYN_KEY);
        if (viewport === V1440) {
          // F1: the CTA only navigates; /transfers/new then runs the existing recovery logic (unchanged).
          await cta.click();
          await expect(page).toHaveURL(/\/transfers\/[^/]+\/status$/);
          const writes = api.nonGet().filter((item) => item.path !== '/v1/auth/refresh');
          const gets = api.requests.filter((item) => item.method === 'GET' && item.path === `/v1/transfers/${data.ids.transfer1}`);
          if (withTransferId) { expect(writes).toEqual([]); expect(gets.length).toBeGreaterThanOrEqual(1); }
          else {
            expect(writes.map((item) => `${item.method} ${item.path}`)).toEqual(['POST /v1/transfers']);
            expect(writes[0]!.idempotencyKey).toBe(SYN_KEY);
            expect(writes[0]!.body).toBe(JSON.stringify(pendingBody));
          }
          metrics.afterClick = withTransferId ? 'GET /v1/transfers/:id only' : 'POST /v1/transfers with the stored key and identical body (copy «Se repetirá la misma solicitud…» is literal)';
        }
        expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
        recordMetric(`W03-V6-F1 ${withTransferId ? 'con' : 'sin'} transferId ${viewport.label}`, metrics);
        await context.close();
      });
    }
  }

  test('W03 A11Y-06 textos largos y A11Y-05 reflow', async ({ browser }) => {
    const longName = 'Nombre Largo '.repeat(10).trim().slice(0, 120);
    const longAccount = 'Cuenta con un nombre muy largo de prueba'.slice(0, 40);
    const movements = [data.movement({ concept: 'Concepto de cuarenta caracteres exactos!', counterparty: { name: 'Persona '.repeat(15).trim().slice(0, 120), clabeMasked: otherClabe } })];
    const user = { ...data.user, fullName: longName };
    const accounts = [data.account({ name: longAccount }), data.account({ id: data.ids.savings, name: `${longAccount.slice(0, 38)} 2`, kind: 'savings', clabeMasked: savings.clabeMasked, clabe: savings.clabe })];
    const results: Record<string, unknown> = {};
    for (const viewport of [V1440, V390]) {
      const { context, page } = await newPage(browser, viewport);
      await open(page, '/accounts', { user, accounts, movements });
      await expect(page.getByRole('region', { name: 'Actividad Reciente' }).locator('tbody tr')).toHaveCount(1);
      await settle(page);
      await responsive(page);
      expect(await clippedText(page)).toEqual([]);
      await expect(page.locator('.home-account-name').first()).toHaveAttribute('title', longAccount);
      await shoot(page, 'W03-textos-largos', { scenario: 'F-W03-8', screen: 'W03', state: 'textos largos', reference: REF.W03 }, viewport);
      results[viewport.label] = 'sin desbordes; truncados con title';
      await context.close();
    }
    results.reflow = await reflow(browser, async (page) => { await open(page, '/accounts', { movements: recent() }); await expect(page.getByRole('region', { name: 'Actividad Reciente' }).locator('tbody tr')).toHaveCount(3); await settle(page); });
    results.reflowEmpty = await reflow(browser, async (page) => { await open(page, '/accounts', { accounts: [data.account({ availableBalanceMinor: '0' })], movements: [] }); await expect(page.getByText('0 Registros')).toBeVisible(); await settle(page); });
    recordMetric('W03 A11Y-05/06', results);
  });
});

// ───────────────────────────── W04 ─────────────────────────────
const HISTORY = `/accounts/${data.ids.checking}/movements`;
const W04_FILTERS = ['Cuenta', 'Todos', 'Entradas', 'Salidas'];
/** Chromium `type=date`: one stop per segment (día, mes, año) plus the calendar button, all named by the label. */
const DATES = ['Desde', 'Desde', 'Desde', 'Desde', 'Hasta', 'Hasta', 'Hasta', 'Hasta'];


test.describe('W04 · Historial', () => {
  for (const viewport of [V1440, viewportR(REF.W04), V768, V390]) {
    test(`W04-V1…V4 con movimientos ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
          const api = await installMockApi(page, {});
      const calls = await routeMovements(page, history25);
      await page.goto(HISTORY);
      await expect(page.getByRole('heading', { level: 1, name: 'Historial de movimientos' })).toBeVisible();
      const table = page.locator('table.hist-table');
      await expect(table.locator('tbody tr.hist-row')).toHaveCount(20);
      await settle(page);
      const metrics: Record<string, unknown> = {};
      // V1
      const selector = page.getByLabel('Cuenta', { exact: true });
      await expect(selector).toHaveValue(data.ids.checking);
      await expect(selector.locator('option')).toHaveText([`Cuenta Principal (•••• ${data.accounts()[0]!.clabeMasked.slice(-4)})`, `Ahorro (•••• ${savings.clabeMasked.slice(-4)})`]);
      expect(await font(page.locator('.hist-account label'))).toMatchObject({ 'font-size': '11px', 'font-weight': '600', 'text-transform': 'uppercase' });
      await expect(page.locator('.hist-account svg[data-icon="unfoldMore"]')).toHaveCount(1);
      if (viewport.width >= 768) { const h1 = await box(page.locator('h1')); const sel = await box(page.locator('.hist-account')); expect(sel.x).toBeGreaterThan(h1.x + 200); }
      // V2
      const segment = page.getByRole('group', { name: 'Tipo de movimiento' });
      await expect(segment.getByRole('button')).toHaveText(['Todos', 'Entradas', 'Salidas']);
      await expect(segment.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
      expect(await styles(segment, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)' });
      expect(await styles(segment.getByRole('button', { name: 'Todos' }), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(255, 255, 255)' });
      await expect(page.getByLabel('Desde')).toHaveAttribute('type', 'date');
      await expect(page.getByLabel('Hasta')).toHaveAttribute('type', 'date');
      await expect(page.locator('.hist-date svg[data-icon="calendarOutlined"]')).toHaveCount(2);
      // UX-T3 (HI-03): «Limpiar filtros» only exists with an active filter.
      await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0);
      // V3
      if (wide(viewport)) {
        await expect(table.locator('th')).toHaveText(['Fecha y hora', 'Contraparte y detalle', 'Concepto', 'Estado', 'Importe', 'Acción']);
        expect(await styles(table.locator('th').first(), ['background-color', 'font-size', 'font-weight', 'text-transform'] as const)).toMatchObject({ 'background-color': 'rgb(241, 243, 255)', 'font-size': '11px', 'font-weight': '600', 'text-transform': 'uppercase' });
        const rowBox = await box(table.locator('tbody tr.hist-row').first());
        expect(rowBox.height).toBeGreaterThanOrEqual(52);
        // Every column visible without clipping at R (the reference clips ACCIÓN; the product must not).
        const tableBox = await box(table); const action = await box(table.locator('tbody tr.hist-row').first().getByRole('link', { name: 'Ver detalle' }));
        expect(action.x + action.width).toBeLessThanOrEqual(tableBox.x + tableBox.width - 16);
        metrics.row = rowBox; metrics.action = action;
      }
      const first = table.locator('tbody tr.hist-row').first();
      await expect(first.locator('.hist-when')).toContainText('17/11/2026');
      await expect(first.locator('.hist-when')).toContainText('11:00');
      await expect(first).toContainText('Persona Prueba Dos');
      await expect(first).toContainText('Envío de prueba 1');
      await expect(first).toContainText('Ref. 101');
      await expect(first.locator('.chip')).toHaveText('Completada');
      expect(await styles(first.locator('.chip'), ['background-color', 'color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(152, 246, 187)', color: 'rgb(0, 115, 69)', 'border-radius': '9999px' });
      await expect(first.locator('[data-amount]')).toHaveText('−$51.73 MXN');
      expect(await styles(first.locator('.hist-party-icon'), ['background-color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(233, 237, 255)', 'border-radius': '9999px' });
      const credit = table.locator('tbody tr.hist-row').nth(1);
      await expect(credit.locator('[data-amount]')).toHaveText('+$102.74 MXN');
      expect(await styles(credit.locator('.hist-party-icon'), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(152, 246, 187)' });
      expect((await styles(credit.locator('.hist-amount'), ['color'] as const)).color).toBe('rgb(0, 109, 64)');
      expect(await font(first.locator('.hist-suffix'))).toMatchObject({ 'font-size': '12px' });
      expect(await styles(first.locator('.hist-detail'), ['color'] as const)).toEqual({ color: 'rgb(0, 55, 176)' });
      // V4
      const more = page.getByRole('button', { name: 'Cargar más movimientos' });
      await expect(more).toBeVisible();
      expect(await styles(more, ['background-color', 'height', 'border-radius'] as const)).toMatchObject({ 'background-color': 'rgb(224, 232, 255)', height: '44px', 'border-radius': '12px' });
      // UX-T3 (D-UX-3, HI-04): «Cargar más» and the count live in the card footer.
      const moreBox = await box(more); const card = await box(page.locator('.hist-card'));
      expect(moreBox.y).toBeGreaterThan(card.y); expect(moreBox.y + moreBox.height).toBeLessThanOrEqual(card.y + card.height);
      await expect(page.locator('.hist-footer')).toContainText('Mostrando 20 movimientos');
      await expect(page.locator('#hist-count')).toHaveAttribute('role', 'status');
      metrics.responsive = await responsive(page);
      const rowsStops = Array.from({ length: 20 }, () => 'Ver detalle');
      const segmentsStops = DATES;
      metrics.a11y = await a11yBasics(page, withShell([...W04_FILTERS, ...segmentsStops, ...rowsStops, 'Cargar más movimientos'], wide(viewport)));
      await shoot(page, 'W04-con-movimientos', { scenario: 'F-W04-1', screen: 'W04', state: 'con movimientos', reference: REF.W04 }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = (await sideBySide(browser, page, 'W04-con-movimientos', { scenario: 'F-W04-1', screen: 'W04', state: 'con movimientos', reference: REF.W04 }, viewport)).differentPixelRatio;
      // F1: load more accumulates page 2 without duplicates, order kept.
      await more.click();
      await expect(table.locator('tbody tr.hist-row')).toHaveCount(25);
      await expect(page.locator('#hist-count')).toContainText('Se cargaron 5 movimientos más.');
      expect(await page.evaluate(() => document.activeElement !== document.body), 'HI-04 focus kept').toBe(true);
      const ids = await table.locator('tbody tr.hist-row .hist-concept .hist-wrap').allTextContents();
      expect(ids).toEqual(history25().map((item) => item.concept));
      await expect(page.getByText('Mostrando 25 movimientos')).toBeVisible();
      await expect(more).toHaveCount(0);
      expect(calls.map((call) => call.url.searchParams.get('cursor'))).toEqual([null, 'c20']);
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W04-V1-V4 F1 ${viewport.label}`, metrics);
      await context.close();
    });
  }

  test('W04-F2 Entradas/Salidas, fechas de día de negocio (D-4), Limpiar y Restablecer reinician la acumulación', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const seen = watch(page);
      await installMockApi(page, {});
    const calls = await routeMovements(page, history25);
    await page.goto(HISTORY);
    const rows = page.locator('tbody tr.hist-row');
    await expect(rows).toHaveCount(20);
    await page.getByRole('button', { name: 'Cargar más movimientos' }).click();
    await expect(rows).toHaveCount(25);
    await page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Entradas' }).click();
    await expect(rows).toHaveCount(12);
    expect(calls.at(-1)!.url.searchParams.get('type')).toBe('credit');
    expect(calls.at(-1)!.url.searchParams.has('cursor')).toBe(false);
    await page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Salidas' }).click();
    await expect(rows).toHaveCount(13);
    expect(calls.at(-1)!.url.searchParams.get('type')).toBe('debit');
    // D-4: Desde = Hasta = 16/11/2026 → [2026-11-16T06:00Z, 2026-11-17T05:59:59.999Z]
    await page.getByLabel('Desde').fill('2026-11-16');
    await page.getByLabel('Hasta').fill('2026-11-16');
    await expect.poll(() => calls.at(-1)!.url.searchParams.get('to')).toBe('2026-11-17T05:59:59.999Z');
    expect(calls.at(-1)!.url.searchParams.get('from')).toBe('2026-11-16T06:00:00.000Z');
    expect(calls.at(-1)!.url.searchParams.get('type')).toBe('debit');
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(rows).toHaveCount(20);
    const cleared = calls.at(-1)!.url.searchParams;
    expect(['from', 'to', 'type', 'cursor'].filter((name) => cleared.has(name))).toEqual([]);
    await expect(page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Desde')).toHaveValue('');
    expect(seen.errors).toEqual([]);
    recordMetric('W04-F2', { credit: 'type=credit', debit: 'type=debit', dates: { from: '2026-11-16T06:00:00.000Z', to: '2026-11-17T05:59:59.999Z' }, cleared: 'sin from/to/type/cursor', restartsAccumulation: true });
  });

  test('W04-F3 [F] borde de día de negocio: 23:30 de D incluido, 00:30 de D+1 excluido', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
      const late = data.movement({ id: 'mv-late', concept: 'Movimiento 23:30', occurredAt: '2026-11-17T05:30:00.000Z' }); // 23:30 of 16/11 (UTC-6)
    const early = data.movement({ id: 'mv-early', concept: 'Movimiento 00:30', occurredAt: '2026-11-17T06:30:00.000Z' }); // 00:30 of 17/11
    await installMockApi(page, {});
    await routeMovements(page, () => [early, late]);
    await page.goto(HISTORY);
    await expect(page.locator('tbody tr.hist-row')).toHaveCount(2);
    await page.getByLabel('Desde').fill('2026-11-16');
    await page.getByLabel('Hasta').fill('2026-11-16');
    await expect(page.locator('tbody tr.hist-row')).toHaveCount(1);
    await expect(page.locator('tbody tr.hist-row')).toContainText('Movimiento 23:30');
    await expect(page.locator('tbody tr.hist-row .hist-when')).toContainText('16/11/2026');
    await expect(page.locator('tbody tr.hist-row .hist-when')).toContainText('23:30');
    recordMetric('W04-F3 [F]', { day: '2026-11-16', included: '23:30 (05:30Z of 17/11)', excluded: '00:30 of 17/11 (06:30Z)' });
  });

  for (const viewport of [V1440, viewportR(REF.W04_MORE_ERROR), V768, V390]) {
    test(`W04-V8/F1 error al cargar más conserva filas y Reintentar añade ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
          await installMockApi(page, {});
      await routeMovements(page, history25, { failCursor: { remaining: 2 } });
      await page.goto(HISTORY);
      const rows = page.locator('tbody tr.hist-row');
      await expect(rows).toHaveCount(20);
      await page.getByRole('button', { name: 'Cargar más movimientos' }).click();
      const banner = page.locator('.hist-more-error');
      await expect(banner).toBeVisible();
      await expect(banner).toHaveAttribute('role', 'alert');
      await expect(banner).toContainText('No pudimos cargar más movimientos.');
      await expect(banner).toContainText('Tus transacciones visibles se conservan.');
      await expect(banner.locator('svg[data-icon="syncProblem"]')).toHaveCount(1);
      expect(await styles(banner, ['background-color'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)' });
      const retry = banner.getByRole('button', { name: 'Reintentar' });
      await page.mouse.move(0, 0); await page.waitForTimeout(100); // resting colour: the pointer may hover the new banner button after «Cargar más»
      expect(await styles(retry, ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)' });
      await expect(rows).toHaveCount(20);
      await settle(page);
      const metrics: Record<string, unknown> = { responsive: await responsive(page) };
      metrics.a11y = await a11yBasics(page, withShell([...W04_FILTERS, ...DATES, ...Array.from({ length: 20 }, () => 'Ver detalle'), 'Reintentar'], wide(viewport)));
      await shoot(page, 'W04-error-cargar-mas', { scenario: 'F-W04-5', screen: 'W04', state: 'error al cargar más', reference: REF.W04_MORE_ERROR }, viewport);
      if (viewport.label === 'R') {
        // The reference shows the banner under four rows; with 20 real rows the banner is compared scrolled into view.
        metrics.sideBySide = (await sideBySide(browser, page, 'W04-error-cargar-mas', { scenario: 'F-W04-5', screen: 'W04', state: 'error al cargar más (inicio)', reference: REF.W04_MORE_ERROR }, viewport)).differentPixelRatio;
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(50);
        const product = capturePath(`W04-error-cargar-mas-R-viewport-bottom-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: product });
        const composed = await composeSideBySide(browser, REF.W04_MORE_ERROR, product, capturePath('W04-error-cargar-mas-banner-sbs.png'));
        recordCapture({ scenario: 'F-W04-5', screen: 'W04', state: 'error al cargar más · banner · lado a lado', level: 'F', viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, file: composed.file, reference: REF.W04_MORE_ERROR });
      }
      await retry.click();
      await expect(rows).toHaveCount(25);
      await expect(banner).toHaveCount(0);
      expect(seen.errors).toEqual([]);
      recordMetric(`W04-V8 ${viewport.label}`, { ...metrics, provoked: seen.provoked });
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W04_LOADING), V768, V390]) {
    test(`W04-V5 cargando ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
          await installMockApi(page, {});
      let release!: () => void;
      await routeMovements(page, history25, { hold: new Promise<void>((resolve) => { release = resolve; }) });
      await page.goto(HISTORY);
      // UX-T3 (D-UX-3, HI-05): skeleton + status line, no overlay card or progress bar over the table.
      const status = page.locator('.hist-loading-line');
      await expect(status).toHaveAttribute('role', 'status');
      await expect(status).toContainText('Obteniendo movimientos recientes…');
      await expect(page.locator('.hist-loading')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('.hist-skeleton-row')).toHaveCount(4);
      await expect(page.locator('.hist-loading-overlay')).toHaveCount(0);
      expect(await runningAnimations(page), 'A11Y-10').toEqual([]);
      await settle(page);
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell([...W04_FILTERS, ...DATES], wide(viewport))) };
      await shoot(page, 'W04-cargando', { scenario: 'F-W04-4', screen: 'W04', state: 'cargando', reference: REF.W04_LOADING }, viewport);
      const sbs = viewport.label === 'R' ? (await sideBySide(browser, page, 'W04-cargando', { scenario: 'F-W04-4', screen: 'W04', state: 'cargando', reference: REF.W04_LOADING }, viewport)).differentPixelRatio : undefined;
      release();
      await expect(page.locator('tbody tr.hist-row')).toHaveCount(20);
      expect(seen.errors).toEqual([]);
      recordMetric(`W04-V5 ${viewport.label}`, { ...metrics, sideBySide: sbs });
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W04_EMPTY), V768, V390]) {
    test(`W04-V6 vacío sin filtros ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
          await installMockApi(page, {});
      await routeMovements(page, () => []);
      await page.goto(HISTORY);
      await expect(page.getByRole('heading', { level: 2, name: 'Aún no tienes movimientos' })).toBeVisible();
      await expect(page.getByText('Las transacciones que realices o recibas en esta cuenta aparecerán en este historial.')).toBeVisible();
      expect(await styles(page.locator('.hist-empty-circle'), ['background-color', 'border-radius', 'width'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)', 'border-radius': '9999px', width: '64px' });
      await expect(page.locator('.hist-empty-circle svg[data-icon="receiptLongOutlined"]')).toHaveCount(1);
      await expect(page.getByLabel('Desde')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button')).toHaveCount(3);
      await settle(page);
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell(W04_FILTERS, wide(viewport))) };
      await shoot(page, 'W04-vacio', { scenario: 'F-W04-2', screen: 'W04', state: 'vacío', reference: REF.W04_EMPTY }, viewport);
      const sbs = viewport.label === 'R' ? (await sideBySide(browser, page, 'W04-vacio', { scenario: 'F-W04-2', screen: 'W04', state: 'vacío', reference: REF.W04_EMPTY }, viewport)).differentPixelRatio : undefined;
      expect(seen.errors).toEqual([]);
      recordMetric(`W04-V6 ${viewport.label}`, { ...metrics, sideBySide: sbs });
      await context.close();
    });
  }

  for (const viewport of [V1440, viewportR(REF.W04_NO_RESULTS), V768, V390]) {
    test(`W04-V7 sin resultados ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
          await installMockApi(page, {});
      const calls = await routeMovements(page, history25);
      await page.goto(HISTORY);
      await expect(page.locator('tbody tr.hist-row')).toHaveCount(20);
      await page.getByLabel('Desde').fill('2026-10-01');
      await page.getByLabel('Hasta').fill('2026-10-02');
      const empty = page.locator('.hist-empty');
      await expect(empty.getByRole('heading', { level: 2, name: 'No encontramos movimientos con los filtros seleccionados' })).toBeVisible();
      await expect(empty).toContainText('Prueba ajustando el rango de fechas o el tipo de operación.');
      await expect(empty.locator('svg[data-icon="manageSearch"]')).toHaveCount(1);
      await settle(page);
      const metrics = { responsive: await responsive(page), a11y: await a11yBasics(page, withShell([...W04_FILTERS, ...DATES, 'Limpiar filtros', 'Restablecer búsqueda'], wide(viewport))) };
      await shoot(page, 'W04-sin-resultados', { scenario: 'F-W04-3', screen: 'W04', state: 'sin resultados', reference: REF.W04_NO_RESULTS }, viewport);
      const sbs = viewport.label === 'R' ? (await sideBySide(browser, page, 'W04-sin-resultados', { scenario: 'F-W04-3', screen: 'W04', state: 'sin resultados', reference: REF.W04_NO_RESULTS }, viewport)).differentPixelRatio : undefined;
      await empty.getByRole('button', { name: 'Restablecer búsqueda' }).click();
      await expect(page.locator('tbody tr.hist-row')).toHaveCount(20);
      expect(['from', 'to', 'type', 'cursor'].filter((name) => calls.at(-1)!.url.searchParams.has(name))).toEqual([]);
      expect(seen.errors).toEqual([]);
      recordMetric(`W04-V7 ${viewport.label}`, { ...metrics, sideBySide: sbs, reset: 'Restablecer búsqueda → sin from/to/type/cursor' });
      await context.close();
    });
  }

  test('W04-F6 error inicial con «Intentar de nuevo» sin tabla; 404 y 403 → W14 (D-11)', async ({ browser }) => {
    for (const viewport of [viewportR(REF.W04), V390]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
          await installMockApi(page, {});
      await routeMovements(page, history25, { failFirst: { remaining: 2 } });
      await page.goto(HISTORY);
      const alert = page.locator('.hist-error');
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert).toContainText('No pudimos cargar los movimientos.');
      await expect(page.locator('table.hist-table')).toHaveCount(0);
      await settle(page);
      await responsive(page);
      await a11yBasics(page, withShell([...W04_FILTERS, ...DATES, 'Intentar de nuevo'], wide(viewport)));
      await shoot(page, 'W04-error-inicial', { scenario: 'F-W04-6', screen: 'W04', state: 'error inicial', reference: REF.W04_MORE_ERROR }, viewport);
      await alert.getByRole('button', { name: 'Intentar de nuevo' }).click();
      await expect(page.locator('tbody tr.hist-row')).toHaveCount(20);
      expect(seen.errors).toEqual([]);
      await context.close();
    }
    for (const status of [404, 403]) {
      const { context, page } = await newPage(browser, V1440);
      const api = await open(page, '/accounts', {});
      await expect(page.getByRole('heading', { level: 1, name: /Hola,/ })).toBeVisible();
      const before = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
      await page.route(/\/v1\/accounts\/[^/]+\/movements/, (route) => route.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify(data.problem(status, status === 404 ? 'Cuenta no encontrada.' : 'Sin permiso.', status === 404 ? 'Not Found' : 'Forbidden')) }));
      await page.goto('/accounts/7a2e0000-0000-4000-8000-000000000999/movements');
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso no disponible' })).toBeVisible();
      expect(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)))).toBe(before);
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
      await context.close();
    }
    recordMetric('W04-F6', { initialError: 'alert + Intentar de nuevo, sin tabla', '404': 'W14 Acceso no disponible', '403': 'W14 Acceso no disponible' });
  });

  test('W04-F4 selector lista sólo cuentas de GET /accounts y navega; W04-F5 [F] detalle propio → W05, abono de tercero → panel inline sin GET', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    const seen = watch(page);
      const transfers = new Map([[`9c4a0000-0000-4000-8000-000000000501`, data.transfer({ id: '9c4a0000-0000-4000-8000-000000000501', amountMinor: '5173', concept: 'Envío de prueba 1', reference: '101' })]]);
    const api = await installMockApi(page, { transfers });
    await routeMovements(page, history25);
    await page.goto(HISTORY);
    await expect(page.locator('tbody tr.hist-row')).toHaveCount(20);
    const selector = page.getByLabel('Cuenta', { exact: true });
    expect(await selector.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).toEqual([data.ids.checking, data.ids.savings]);
    // Third-party credit (row 2): inline panel, aria-expanded, no GET /transfers.
    const thirdParty = page.locator('tbody tr.hist-row').nth(1);
    const toggle = thirdParty.getByRole('button', { name: 'Ver detalle' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator(`#${await toggle.getAttribute('aria-controls')}`);
    await expect(panel).toBeVisible();
    for (const text of ['Persona Prueba Cuatro', '+$102.74 MXN', 'Abono de prueba 2', '9002', '17 de noviembre de 2026']) await expect(panel).toContainText(text);
    expect(api.requests.filter((item) => item.path.startsWith('/v1/transfers/'))).toEqual([]);
    await shoot(page, 'W04-detalle-inline', { scenario: 'F-W04-1', screen: 'W04', state: 'detalle inline de abono de tercero', reference: REF.W04 }, V1440);
    await toggle.click();
    await expect(panel).toBeHidden();
    // Own debit → W05 with GET /transfers/{transferId of the row}.
    await page.locator('tbody tr.hist-row').first().getByRole('link', { name: 'Ver detalle' }).click();
    await expect(page).toHaveURL(/\/transfers\/9c4a0000-0000-4000-8000-000000000501\/movement-receipt$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Comprobante de transferencia' })).toBeVisible();
    await expect.poll(() => api.requests.filter((item) => item.path === '/v1/transfers/9c4a0000-0000-4000-8000-000000000501').length).toBeGreaterThanOrEqual(1);
    await expect(page.locator('article.mr-card')).toContainText('Envío de prueba 1');
    await page.getByRole('link', { name: 'Volver a Movimientos' }).last().click();
    await expect(page).toHaveURL(new RegExp(`/accounts/${data.ids.checking}/movements$`));
    // F4: switching account navigates.
    await page.getByLabel('Cuenta', { exact: true }).selectOption(data.ids.savings);
    await expect(page).toHaveURL(new RegExp(`/accounts/${data.ids.savings}/movements$`));
    await expect(page.getByLabel('Cuenta', { exact: true })).toHaveValue(data.ids.savings);
    expect(seen.errors).toEqual([]);
    recordMetric('W04-F4-F5 [F]', { options: 2, inline: 'aria-expanded + panel, sin GET /transfers', own: 'GET /v1/transfers/:id → W05', back: 'Volver a Movimientos → cuenta de origen', switch: '/accounts/{savings}/movements' });
  });

  test('W04 A11Y-06 textos largos y A11Y-05 reflow', async ({ browser }) => {
    const longParty = 'Persona '.repeat(15).trim().slice(0, 120);
    const list = () => [data.movement({ concept: 'Concepto de cuarenta caracteres exactos!', counterparty: { name: longParty, clabeMasked: otherClabe } }), data.movement({ id: 'mv-x2', type: 'credit', concept: 'Abono con concepto largo de cuarenta ch', counterparty: { name: longParty, clabeMasked: otherClabe } })];
    const results: Record<string, unknown> = {};
    for (const viewport of [V1440, viewportR(REF.W04), V390]) {
      const { context, page } = await newPage(browser, viewport);
          await installMockApi(page, { accounts: [data.account({ name: 'Cuenta con un nombre muy largo de prueba' }), data.accounts()[1]!] });
      await routeMovements(page, list);
      await page.goto(HISTORY);
      await expect(page.locator('tbody tr.hist-row')).toHaveCount(2);
      await settle(page);
      await responsive(page);
      expect(await clippedText(page)).toEqual([]);
      await expect(page.locator('.hist-truncate').first()).toHaveAttribute('title', longParty);
      await shoot(page, 'W04-textos-largos', { scenario: 'F-W04-7', screen: 'W04', state: 'textos largos', reference: REF.W04 }, viewport);
      results[viewport.label] = 'sin desbordes; contraparte truncada con title';
      await context.close();
    }
    results.reflow = await reflow(browser, async (page) => { await installMockApi(page, {}); await routeMovements(page, history25); await page.goto(HISTORY); await expect(page.locator('tbody tr.hist-row')).toHaveCount(20); await settle(page); });
    recordMetric('W04 A11Y-05/06', results);
  });
});

// ───────────────────────────── W05 ─────────────────────────────
const RECEIPT_ID = data.ids.transfer1;
const W05_CONTENT = ['Volver a Movimientos', 'Volver a Movimientos', 'Ir a Inicio'];

test.describe('W05 · Comprobante desde el historial', () => {
  for (const own of [false, true]) {
    for (const viewport of own ? [V1440, V390] : [V1440, viewportR(REF.W05), V768, V390]) {
      test(`W05-V1…V5 ${own ? 'entre cuentas propias' : 'a beneficiario'} ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
        const { context, page } = await newPage(browser, viewport);
        const seen = watch(page);
        const transfer = own
          ? data.transfer({ destination: savings, amountMinor: '45075', concept: 'Traspaso de prueba', reference: '1200' })
          : data.transfer();
        const api = await open(page, `/transfers/${RECEIPT_ID}/movement-receipt`, { transfers: new Map([[RECEIPT_ID, transfer]]) });
        await expect(page.getByRole('heading', { level: 1, name: 'Comprobante de transferencia' })).toBeVisible();
        const cardLocator = page.locator('article.mr-card');
        await expect(cardLocator).toBeVisible();
        await settle(page);
        // V1
        const back = page.locator('.mr-back');
        await expect(back).toHaveAttribute('aria-label', 'Volver a Movimientos');
        expect(await styles(back, ['width', 'height', 'background-color', 'border-radius'] as const)).toEqual({ width: '44px', height: '44px', 'background-color': 'rgb(255, 255, 255)', 'border-radius': '12px' }); // UX-T3 DT-01: 44×44
        await expect(page.locator('.mr-eyebrow')).toHaveText('Folio interno•RCPT-SYN-0001');
        expect(await font(page.locator('h1'))).toMatchObject({ 'font-size': '20px', 'line-height': '28px', 'font-weight': '600' });
        await expect(page.locator('a[aria-current="page"]').first()).toHaveText('Movimientos');
        const card = await box(cardLocator);
        expect(card.width).toBeLessThanOrEqual(768 + 1);
        // V2
        await expect(cardLocator.locator('.mr-status h2')).toHaveText('Transferencia completada');
        await expect(cardLocator.locator('.mr-status p')).toHaveText('Operación registrada en Billetera MXN');
        expect(await styles(cardLocator.locator('.mr-status-tile'), ['background-color'] as const)).toEqual({ 'background-color': 'rgb(152, 246, 187)' });
        await expect(cardLocator.locator('.mr-status-tile svg[data-icon="checkCircleOutlined"]')).toHaveCount(1);
        await expect(cardLocator.locator('.mr-chip')).toHaveText('Completada');
        // V3
        const panel = cardLocator.locator('.mr-amount-panel');
        expect(await styles(panel, ['background-color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(241, 243, 255)', 'border-radius': '12px' });
        await expect(panel.locator('[data-amount]')).toHaveText(own ? '$450.75 MXN' : '$123.00 MXN');
        expect(await font(panel.locator('.mr-amount-value'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '40px', 'font-weight': '600' } : { 'font-size': '32px', 'font-weight': '600' });
        await expect(panel.locator('.mr-folio')).toContainText('RCPT-SYN-0001');
        // V4
        const parties = cardLocator.locator('.mr-party');
        await expect(parties.nth(0)).toContainText('Cuenta origen');
        await expect(parties.nth(0)).toContainText('Cuenta Principal');
        await expect(parties.nth(0)).toContainText(`Cuenta Billetera (•••• ${data.accounts()[0]!.clabeMasked.slice(-4)})`);
        await expect(parties.nth(1)).toContainText(own ? 'Ahorro' : 'Persona Prueba Dos');
        await expect(parties.nth(1)).toContainText(`Cuenta Billetera (•••• ${(own ? savings.clabeMasked : data.beneficiary().clabeMasked).slice(-4)})`);
        await expect(parties.nth(1)).toContainText('Tipo de abono:Transferencia interna');
        expect(await font(parties.nth(0).locator('.mr-party-name'))).toMatchObject({ 'font-size': '16px', 'font-weight': '600' });
        await expect(cardLocator).not.toContainText(/Comisi|Saldo después/);
        // V5
        const detail = cardLocator.locator('.mr-detail');
        await expect(detail.locator('h3')).toHaveText('Detalle de la operación');
        await expect(detail.locator('dt')).toHaveText(['Fecha y hora', 'Concepto', 'Referencia numérica']);
        await expect(detail.locator('dd')).toHaveText(['17 de noviembre de 2026, 10:00', transfer.concept, transfer.reference]);
        await expect(cardLocator.locator('.mr-actions').getByRole('link')).toHaveText(['Volver a Movimientos', 'Ir a Inicio']);
        expect(await styles(cardLocator.locator('.mr-actions .btn-outline'), ['background-color', 'border-top-color', 'border-top-width'] as const)).toEqual({ 'background-color': 'rgb(255, 255, 255)', 'border-top-color': 'rgb(196, 197, 215)', 'border-top-width': '1px' });
        await expect(cardLocator.locator('.mr-actions').getByRole('link', { name: 'Volver a Movimientos' })).toHaveAttribute('href', `/accounts/${data.ids.checking}/movements`);
        await expect(cardLocator.locator('.mr-actions').getByRole('link', { name: 'Ir a Inicio' })).toHaveAttribute('href', '/accounts');
        const metrics = { card, responsive: await responsive(page), a11y: await a11yBasics(page, withShell(W05_CONTENT, wide(viewport))) };
        expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
        const name = `W05-${own ? 'propias' : 'beneficiario'}`;
        await shoot(page, name, { scenario: own ? 'F-W05-2' : 'F-W05-1', screen: 'W05', state: own ? 'entre cuentas propias' : 'a beneficiario', reference: REF.W05 }, viewport);
        const sbs = viewport.label === 'R' ? (await sideBySide(browser, page, name, { scenario: 'F-W05-1', screen: 'W05', state: 'a beneficiario', reference: REF.W05 }, viewport)).differentPixelRatio : undefined;
        expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
        recordMetric(`W05-V1-V5 ${own ? 'propias' : 'beneficiario'} ${viewport.label}`, { ...metrics, sideBySide: sbs });
        await context.close();
      });
    }
  }

  test('W05-F2 error con «Intentar de nuevo»; 404/403 → W14 sin tocar el registro', async ({ browser }) => {
    for (const viewport of [viewportR(REF.W05), V390]) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      let fail = true;
          await installMockApi(page, { transfers: new Map([[RECEIPT_ID, data.transfer()]]) });
      await page.route(`**/v1/transfers/${RECEIPT_ID}`, (route) => fail ? route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible por el momento.', 'Service Unavailable')) }) : route.fallback());
      await page.goto(`/transfers/${RECEIPT_ID}/movement-receipt`);
      const alert = page.getByRole('alert');
      await expect(alert).toContainText('No pudimos consultar el comprobante.');
      await settle(page);
      await responsive(page);
      await a11yBasics(page, withShell(['Volver a Movimientos', 'Intentar de nuevo'], wide(viewport)));
      await shoot(page, 'W05-error', { scenario: 'F-W05-3', screen: 'W05', state: 'error de consulta', reference: REF.W05 }, viewport);
      fail = false;
      await alert.getByRole('button', { name: 'Intentar de nuevo' }).click();
      await expect(page.locator('article.mr-card')).toBeVisible();
      expect(seen.errors).toEqual([]);
      await context.close();
    }
    for (const status of [404, 403]) {
      const { context, page } = await newPage(browser, V1440);
      await seedAttempt(page, { key: SYN_KEY, body: pendingBody });
          const api = await installMockApi(page, {});
      await page.route('**/v1/transfers/9c4a0000-0000-4000-8000-000000000777', (route) => route.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify(data.problem(status, 'Transferencia no encontrada.', status === 404 ? 'Not Found' : 'Forbidden')) }));
      await page.goto('/transfers/9c4a0000-0000-4000-8000-000000000777/movement-receipt');
      await expect(page.getByRole('heading', { level: 1, name: 'Acceso no disponible' })).toBeVisible();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), ATTEMPT_KEY)).toBe(JSON.stringify({ key: SYN_KEY, body: pendingBody }));
      expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
      await context.close();
    }
    recordMetric('W05-F2', { error: 'alert + Intentar de nuevo → recupera', '404': 'W14, registro intacto', '403': 'W14, registro intacto' });
  });
});

// ───────────────────── REC-04 · no «sin cargo» from 404 or from Movimientos ─────────────────────
test('REC-04 GET /transfers/{id} 404 conserva el registro; Movimientos nunca resuelve intentos', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const record = { key: SYN_KEY, body: pendingBody, transferId: data.ids.transfer2 };
  await seedAttempt(page, record);
  // The record's transfer id is unknown to the mock → 404 on GET /transfers/{id}; a movement with the same concept exists.
  const api = await installMockApi(page, { movements: [data.movement({ transferId: data.ids.transfer2, concept: pendingBody.concept, reference: pendingBody.reference, amountMinor: pendingBody.amountMinor })] });
  await page.goto('/accounts');
  await expect(page.getByRole('region', { name: 'Estamos verificando el resultado de tu transferencia' })).toBeVisible();
  await page.getByRole('link', { name: 'Consultar estado' }).click();
  await expect(page).toHaveURL(/\/transfers\/new$/);
  await expect.poll(() => api.requests.filter((item) => item.method === 'GET' && item.path === `/v1/transfers/${data.ids.transfer2}`).length).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), ATTEMPT_KEY)).toBe(JSON.stringify(record));
  await page.getByRole('link', { name: 'Inicio', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Estamos verificando el resultado de tu transferencia' })).toBeVisible();
  expect(api.nonGet().filter((item) => item.path !== '/v1/auth/refresh')).toEqual([]);
  recordMetric('REC-04', { notFound: 'registro conservado byte a byte', movements: 'una coincidencia en Movimientos no oculta el aviso' });
});
