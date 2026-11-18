// WF-T5 acceptance [F]: W10 código (vacío, incompleto, completo, verificando, incorrecto, expirado, intentos agotados; mapping of
// confirm answers; countdown), W11 (enviando, verificando resultado, resultado desconocido as distinct states; copy per real
// action; «Volver al Inicio» keeps the record) and W12 (comprobante beneficiario y entre cuentas propias; folio; clipboard).
// Simulated API (helpers/mock-api.ts) with a fixed clock; synthetic data only. [I] lives in t5-integration.spec.ts.
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockApi, type MockState } from './helpers/mock-api.js';
import { recordMetric } from './helpers/evidence.js';
import { box, near, styles } from './helpers/geometry.js';
import { a11yBasics, newPage, reflow, responsive, runningAnimations, settle, shoot, sideBySide, sideBySideHtml, V1440, V390, V768, viewportR, watch, withShell, type Viewport } from './helpers/screen.js';

const REF = {
  W10_EMPTY: 'w10_c_digo_de_confirmaci_n',
  W10_COMPLETE: 'w10_c_digo_completo',
  W10_INCOMPLETE: 'w10_c_digo_incompleto',
  W10_VERIFYING: 'w10_verificando',
  W10_WRONG: 'w10_c_digo_incorrecto',
  W10_EXPIRED: 'w10_c_digo_expirado',
  W10_EXHAUSTED: 'w10_intentos_agotados',
  W11_SENDING: 'w11_enviando',
  W11_VERIFYING: 'w11_verificando_resultado',
  W12: 'w12_comprobante_850_mxn',
  W12_OWN: 'w12_comprobante_entre_cuentas_propias',
} as const;
/** HTML-only references are laid out at 1280 CSS px and rendered at the round's reference density (D-C1). */
const R_HTML: Viewport = { label: 'R', width: 1280, height: 1024, dpr: 1.25 };
const NOW = new Date('2026-11-17T16:00:00.000Z');
const wide = (viewport: Viewport) => viewport.width >= 1024;
const font = (locator: Locator) => styles(locator, ['font-size', 'line-height', 'font-weight', 'color'] as const);
const problem = (status: number, detail: string, title = 'Unprocessable Entity') => ({ status, body: data.problem(status, detail, title) });
const nonGet = (api: MockApi) => api.nonGet().filter((item) => item.path !== '/v1/auth/refresh').map((item) => `${item.method} ${item.path}`);
const [checking, savings] = data.accounts() as [data.Account, data.Account];
const beneficiary = data.beneficiary();
const tail = (clabeMasked: string) => clabeMasked.slice(-4);

const awaiting = (overrides: Partial<data.Transfer> = {}) => data.transfer({
  status: 'awaiting_confirmation', amountMinor: '412345', concept: 'Honorarios de prueba', reference: '204801', completedAt: null, receiptReference: null,
  createdAt: '2026-11-17T15:59:00.000Z', expiresAt: '2026-11-17T16:04:09.000Z', demoOnlyCode: '246810', ...overrides,
});
const completed = (overrides: Partial<data.Transfer> = {}) => data.transfer({ amountMinor: '412345', concept: 'Honorarios de prueba', reference: '204801', completedAt: '2026-11-17T16:00:30.000Z', receiptReference: null, ...overrides });

function gate() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function openStatus(page: Page, transfer: data.Transfer, initial: Partial<MockState> = {}) {
  await page.clock.setFixedTime(NOW);
  const api = await installMockApi(page, { transfers: new Map([[transfer.id, transfer]]), ...initial });
  await page.goto(`/transfers/${transfer.id}/status`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return api;
}
const otp = (page: Page) => page.getByLabel('Código de confirmación de 6 dígitos');
const authorize = (page: Page) => page.getByRole('button', { name: /^Autorizar transferencia/ });
async function describedText(locator: Locator) {
  return locator.evaluate((element) => (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? `#missing:${id}`).join(' | '));
}

// ───────────────────────────── W10 ─────────────────────────────
type W10State = 'vacio' | 'incompleto' | 'completo' | 'verificando' | 'incorrecto' | 'expirado' | 'agotados';
const W10_REF: Record<W10State, { folder: string; html: boolean }> = {
  vacio: { folder: REF.W10_EMPTY, html: false }, incompleto: { folder: REF.W10_INCOMPLETE, html: false }, completo: { folder: REF.W10_COMPLETE, html: false },
  verificando: { folder: REF.W10_VERIFYING, html: true }, incorrecto: { folder: REF.W10_WRONG, html: true }, expirado: { folder: REF.W10_EXPIRED, html: true },
  agotados: { folder: REF.W10_EXHAUSTED, html: false },
};
const W10_STOPS: Record<W10State, string[]> = {
  vacio: ['Código de confirmación de 6 dígitos'],
  incompleto: ['Código de confirmación de 6 dígitos'],
  completo: ['Código de confirmación de 6 dígitos', 'Autorizar transferencia de $4,123.45 MXN'],
  verificando: ['Código de confirmación de 6 dígitos'],
  incorrecto: ['Código de confirmación de 6 dígitos', 'Autorizar transferencia de $4,123.45 MXN'],
  expirado: ['Volver al inicio'],
  agotados: ['Volver al inicio'],
};

/** Drives W10 to a state; returns a release for the held confirm (verificando). */
async function toW10State(page: Page, state: W10State): Promise<{ api: MockApi; release?: () => void }> {
  if (state === 'expirado') return { api: await openStatus(page, awaiting({ status: 'expired' })) };
  const replies: Record<string, MockState['confirmReplies']> = {
    incorrecto: [problem(422, 'Código incorrecto.')], agotados: [problem(429, 'Se agotaron los intentos.', 'Too Many Requests')],
  };
  const api = await openStatus(page, awaiting(), { confirmReplies: replies[state] ?? [] });
  if (state === 'vacio') return { api };
  await otp(page).fill(state === 'incompleto' ? '246' : '246810');
  if (state === 'incompleto' || state === 'completo') return { api };
  if (state === 'verificando') {
    const held = gate();
    await page.route('**/v1/transfers/*/confirm', async (route) => { await held.promise; await route.fallback(); });
    await authorize(page).click();
    await expect(page.getByRole('button', { name: 'Verificando…' })).toBeDisabled();
    return { api, release: held.release };
  }
  await authorize(page).click();
  if (state === 'incorrecto') await expect(page.getByRole('alert').filter({ hasText: 'Código incorrecto' })).toBeVisible();
  else await expect(page.getByRole('heading', { level: 1, name: 'Operación suspendida' })).toBeVisible();
  return { api };
}

test.describe('W10 · Código de confirmación', () => {
  for (const state of Object.keys(W10_REF) as W10State[]) {
    const ref = W10_REF[state];
    for (const viewport of [V1440, ref.html ? R_HTML : viewportR(ref.folder), V768, V390]) {
      test(`W10 ${state} ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
        const { context, page } = await newPage(browser, viewport);
        const seen = watch(page);
        const { api, release } = await toW10State(page, state);
        const metrics: Record<string, unknown> = {};
        const exhausted = state === 'agotados';
        // V1 · breadcrumb, card header, countdown, two columns.
        await expect(page.locator('.cf-crumbs')).toHaveText('TransferirConfirmación');
        const h1 = page.getByRole('heading', { level: 1 });
        await expect(h1).toHaveText(exhausted ? 'Operación suspendida' : 'Código de confirmación');
        expect(await font(h1)).toMatchObject({ 'font-size': '20px', 'line-height': '28px', 'font-weight': '600' });
        const code = page.locator('.cf-code-card');
        const side = page.getByRole('complementary', { name: 'Resumen de orden' });
        const [codeBox, sideBox] = [await box(code), await box(side)];
        if (wide(viewport)) {
          expect(near(codeBox.y, sideBox.y)).toBe(true);
          expect(codeBox.x).toBeLessThan(sideBox.x);
          const ratio = codeBox.width / (codeBox.width + sideBox.width);
          expect(ratio).toBeGreaterThan(0.55); expect(ratio).toBeLessThan(0.62);
        } else expect(sideBox.y).toBeGreaterThan(codeBox.y + codeBox.height - 1); // RESP-04: main content first
        metrics.layout = { codeBox, sideBox };
        if (!exhausted) {
          expect(await styles(page.locator('.cf-tile'), ['width', 'height', 'background-color', 'color'] as const)).toEqual({ width: '48px', height: '48px', 'background-color': 'rgb(224, 232, 255)', color: 'rgb(0, 55, 176)' });
          // UX-T2 (D-UX-8, CD-01): no eyebrow repeating the h1; the demo chip sits beside the h1.
          await expect(page.locator('.cf-head-text')).toHaveText('Código de confirmaciónDemo');
          await expect(page.locator('.cf-code-card').getByText('Código de confirmación', { exact: true })).toHaveCount(1);
          await expect(page.locator('.cf-timer')).toContainText('Expira en');
          await expect(page.locator('.cf-timer-chip')).toHaveText(state === 'expirado' ? '00:00 min' : '04:09 min');
          // V2 · intro sentence with amount and destination.
          await expect(page.locator('.cf-intro')).toHaveText(`Ingresa el código de 6 dígitos para autorizar la transferencia de $4,123.45 MXN a ${beneficiary.name} (•• ${tail(beneficiary.clabeMasked)}).`);
        }
        // V2 · six aria-hidden boxes over one accessible input (A11Y-11).
        const boxes = page.locator('.cf-box');
        await expect(boxes).toHaveCount(6);
        await expect(page.locator('input#cf-otp')).toHaveCount(1);
        await expect(otp(page)).toHaveAttribute('autocomplete', 'one-time-code');
        await expect(otp(page)).toHaveAttribute('inputmode', 'numeric');
        for (const index of [0, 5]) await expect(boxes.nth(index)).toHaveAttribute('aria-hidden', 'true');
        const first = await styles(boxes.first(), ['height', 'border-radius', 'background-color', 'font-size', 'font-weight', 'color'] as const);
        if (!['incorrecto', 'expirado', 'agotados'].includes(state)) expect(first).toMatchObject({ height: viewport.width < 640 ? '52px' : '56px', 'border-radius': '8px', 'background-color': 'rgb(241, 243, 255)', 'font-weight': '600', color: 'rgb(0, 55, 176)' });
        if (viewport.label === 'R' && !exhausted) expect(near((await box(boxes.first())).width, 72, 2.5)).toBe(true);
        metrics.box = { ...first, width: (await box(boxes.first())).width };
        // V6 · order summary.
        await expect(side.locator('.cf-summary-head h2')).toHaveText('Resumen de orden');
        await expect(side.locator('.cf-summary-head .chip')).toHaveText({ vacio: 'Pendiente de confirmación', incompleto: 'Pendiente de confirmación', completo: 'Pendiente de confirmación', verificando: 'Pendiente de confirmación', incorrecto: 'Pendiente de confirmación', expirado: 'Expirada', agotados: 'No ejecutada' }[state]);
        await expect(side.locator('.cf-amount-panel')).toHaveText('Monto a transferir$4,123.45 MXN');
        await expect(side.locator('.cf-rows dt')).toHaveText(['Destinatario', 'Cuenta origen', 'Concepto', 'Referencia', 'Creada']);
        await expect(side.locator('.cf-rows dd').nth(0)).toHaveText(`${beneficiary.name}Cuenta •• ${tail(beneficiary.clabeMasked)}`);
        await expect(side.locator('.cf-rows dd').nth(1)).toHaveText(`${checking.name}•• ${tail(checking.clabeMasked)}`);
        await expect(side.locator('.cf-rows dd').nth(4)).toHaveText('09:59');
        // State specifics.
        // UX-T2: the primary is rendered in the card (≥1024) or in the sticky ActionBar (<1024); only one is visible.
        const button = page.locator('.cf-submit:visible');
        if (state === 'vacio' || state === 'incompleto') {
          await expect(button).toBeDisabled();
          await expect(button).toHaveText('Autorizar transferencia');
          expect(await describedText(button)).toBe(state === 'vacio' ? 'Al completar los 6 dígitos se habilitará la autorización.' : 'Código incompleto (3 de 6 dígitos ingresados). Al completar los 6 dígitos se habilitará la autorización.');
          await expect(page.locator('.cf-state-chip')).toHaveText(state === 'vacio' ? '0/6 dígitos' : '3/6 dígitos');
          if (state === 'incompleto') {
            await expect(page.locator('.cf-length')).toHaveText('Código incompleto (3 de 6 dígitos ingresados). Al completar los 6 dígitos se habilitará la autorización.');
            await expect(boxes.nth(3)).toHaveClass(/is-cursor/);
            await expect(page.locator('.cf-box.is-filled')).toHaveCount(3);
          }
        }
        if (state === 'completo' || state === 'incorrecto') {
          await expect(button).toBeEnabled();
          await expect(button).toHaveText('Autorizar transferencia de $4,123.45 MXN');
          await expect(button.locator('svg[data-icon="lockOutlined"]')).toHaveCount(1);
          await page.mouse.move(0, 0); await page.waitForTimeout(100); // resting colour (the pointer may still hover the sticky ActionBar after the click)
          expect(await styles(button, ['background-color', 'color', 'border-radius', 'font-size', 'font-weight'] as const)).toMatchObject({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', 'border-radius': '12px', 'font-size': '14px', 'font-weight': '500' });
          expect((await box(button)).height).toBeGreaterThanOrEqual(44);
        }
        if (state === 'completo') {
          const chip = page.locator('.cf-state-chip');
          await expect(chip).toHaveText('Código completo');
          expect(await styles(chip, ['background-color', 'color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(152, 246, 187)', color: 'rgb(0, 115, 69)', 'border-radius': '9999px' });
          // FM-01: exactly one visible «completo» indicator (the chip); the length line is empty.
          await expect(page.locator('.cf-length')).toHaveText('');
          await expect(page.getByText(/completo|Longitud válida/i).filter({ visible: true })).toHaveCount(1);
          await expect(page.locator('.cf-demo-code')).toHaveText('Código de demostración: 246810'); // V5 (synthetic code, screen only)
        }
        if (state === 'verificando') {
          await expect(button).toHaveText('Verificando…');
          await expect(otp(page)).toHaveAttribute('readonly', '');
          await expect(page.getByRole('status').filter({ hasText: 'Validando código…' })).toHaveText('Validando código… Por favor no cierres ni recargues esta ventana.');
          expect(await runningAnimations(page), 'A11Y-10').toEqual([]);
        }
        if (state === 'incorrecto') {
          await expect(page.locator('#cf-wrong')).toHaveText('Código incorrectoEl código ingresado no coincide. Revisa e ingresa nuevamente.');
          await expect(page.locator('.cf-boxes')).toHaveClass(/is-wrong/);
          expect(await styles(boxes.first(), ['color'] as const)).toEqual({ color: 'rgb(186, 26, 26)' });
          await expect(otp(page)).toBeFocused();
          expect(await otp(page).evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([0, 6]);
          await expect(otp(page)).toHaveAttribute('aria-invalid', 'true');
        }
        if (state === 'expirado') {
          await expect(page.getByRole('alert')).toHaveText('Código expiradoEl código de confirmación venció. Este intento se cerró sin cargo.');
          await expect(otp(page)).toBeDisabled();
          // UX-T2 (D-UX-8, CD-01): a closed attempt has no «Autorizar…» button; «Volver al inicio» is the only primary.
          await expect(page.locator('.cf-submit')).toHaveCount(0);
          await expect(page.locator('.cf-length')).toHaveText('El código ya no puede ingresarse.');
          await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/accounts');
        }
        if (exhausted) {
          const card = page.locator('.cf-suspended');
          expect(await styles(card, ['border-left-width', 'border-left-color'] as const)).toEqual({ 'border-left-width': '4px', 'border-left-color': 'rgb(186, 26, 26)' });
          await expect(card.locator('.cf-suspended-tile svg[data-icon="gppBadOutlined"]')).toHaveCount(1);
          await expect(card).toContainText('Se agotó el número de intentos permitidos para este código. La transferencia no se realizó.');
          await expect(card.locator('.cf-no-charge')).toHaveText(`No se realizó ningún cargo a tu cuentaSaldo disponible actual:$7,345.00 MXN`);
          await expect(page.locator('.cf-locked')).toHaveText('Bloqueado');
          await expect(page.locator('.cf-submit')).toHaveCount(0);
          await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveCount(1);
          await expect(otp(page)).toBeDisabled();
        }
        // E-W10-1 / D-12: no resend and no «Volver a revisar» (deferred), no excluded claims.
        await expect(page.locator('main')).not.toContainText(/Solicitar nuevo código|Volver a revisar|SMS|SPEI|Banxico|Comisi|Instituci|Cambiar método/);
        metrics.responsive = await responsive(page);
        metrics.a11y = await a11yBasics(page, withShell(W10_STOPS[state], wide(viewport)));
        await shoot(page, `W10-${state}`, { scenario: `F-W10-${state}`, screen: 'W10', state, reference: ref.folder }, viewport);
        if (viewport.label === 'R') metrics.sideBySide = ref.html ? await sideBySideHtml(browser, page, `W10-${state}`, { scenario: `F-W10-${state}`, screen: 'W10', state, reference: ref.folder }, viewport)
          : await sideBySide(browser, page, `W10-${state}`, { scenario: `F-W10-${state}`, screen: 'W10', state, reference: ref.folder }, viewport);
        release?.();
        if (state === 'verificando') await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
        // Only the confirm POSTs this state required; never a cancel or a second create.
        expect(nonGet(api)).toEqual(['vacio', 'incompleto', 'completo', 'expirado'].includes(state) ? [] : ['POST /v1/transfers/9c4a0000-0000-4000-8000-000000000401/confirm']);
        expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
        recordMetric(`W10-${state} ${viewport.label} ${viewport.width}x${viewport.height}`, metrics);
        await context.close();
      });
    }
  }

  test('W10 A11Y-05 reflow (completo, agotados) and paste of six digits', async ({ browser }) => {
    const results: Record<string, unknown> = {};
    results.completo = await reflow(browser, async (page) => { await toW10State(page, 'completo'); await settle(page); });
    results.agotados = await reflow(browser, async (page) => { await toW10State(page, 'agotados'); await settle(page); });
    const { context, page } = await newPage(browser, V1440);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5301' });
    await openStatus(page, awaiting());
    await page.evaluate(() => navigator.clipboard.writeText('13-57 92'));
    await otp(page).focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(otp(page)).toHaveValue('135792');
    await expect(page.locator('.cf-box.is-filled')).toHaveCount(6);
    results.paste = 'pegar «13-57 92» → 135792 en el único input';
    recordMetric('W10 A11Y-05/A11Y-11', results);
    await context.close();
  });

  test('W10-F1 mapping: 409 → GET completed → W12; 422 expiró → GET expired → V9; red → aviso; same key for the same code', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const seen = watch(page);
    // 409: read-only GET decides.
    let api = await openStatus(page, awaiting(), { confirmReplies: [problem(409, 'La transferencia ya no puede confirmarse.', 'Conflict')] });
    await page.route(`**/v1/transfers/${data.ids.transfer1}`, async (route) => {
      if (api.requests.some((item) => item.path.endsWith('/confirm'))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(completed()) });
      return route.fallback();
    });
    await otp(page).fill('246810');
    await authorize(page).click();
    await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
    expect(nonGet(api)).toEqual([`POST /v1/transfers/${data.ids.transfer1}/confirm`]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // 422 «El código expiró.» → GET → expired → V9.
    api = await openStatus(page, awaiting(), { confirmReplies: [problem(422, 'El código expiró.')] });
    await page.route(`**/v1/transfers/${data.ids.transfer1}`, async (route) => {
      if (api.requests.some((item) => item.path.endsWith('/confirm'))) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(awaiting({ status: 'expired' })) });
      return route.fallback();
    });
    await otp(page).fill('246810');
    await authorize(page).click();
    await expect(page.getByRole('alert')).toContainText('Código expirado');
    expect(nonGet(api)).toEqual([`POST /v1/transfers/${data.ids.transfer1}/confirm`]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    // No answer → notice; retrying the same code reuses the same Idempotency-Key (logic unchanged).
    api = await openStatus(page, awaiting(), { confirmReplies: ['abort'] });
    await otp(page).fill('246810');
    await authorize(page).click();
    await expect(page.getByRole('alert')).toHaveText('No se confirmó la respuesta. Puedes reintentar el mismo código.');
    await authorize(page).click();
    await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
    const confirms = api.requests.filter((item) => item.path.endsWith('/confirm'));
    expect(confirms).toHaveLength(2);
    expect(confirms[0]!.idempotencyKey).toBe(confirms[1]!.idempotencyKey);
    expect(confirms[0]!.bodySha256).toBe(confirms[1]!.bodySha256);
    expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
    recordMetric('W10-F1', { conflict409: 'GET → completed → W12', expired422: 'GET → expired → V9', network: 'aviso; mismo código = misma clave', provoked: seen.provoked.length });
    await context.close();
  });

  test('W10-F2 countdown: at 00:00 one GET; V9 only when the server answers expired', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    // Server still says awaiting at 00:00 → no V9.
    let api = await openStatus(page, awaiting({ expiresAt: '2026-11-17T15:59:59.000Z' }));
    await expect(page.locator('.cf-timer-chip')).toHaveText('00:00 min');
    await expect.poll(() => api.requests.filter((item) => item.method === 'GET' && item.path === `/v1/transfers/${data.ids.transfer1}`).length).toBe(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(otp(page)).toBeEnabled();
    expect(await styles(page.locator('.cf-timer-chip'), ['background-color', 'color'] as const)).toEqual({ 'background-color': 'rgb(255, 218, 214)', color: 'rgb(147, 0, 10)' });
    // Server answers expired → V9.
    api = await openStatus(page, awaiting({ expiresAt: '2026-11-17T15:59:59.000Z' }));
    await page.route(`**/v1/transfers/${data.ids.transfer1}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(awaiting({ status: 'expired', expiresAt: '2026-11-17T15:59:59.000Z' })) }));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Código expirado');
    expect(nonGet(api)).toEqual([]);
    recordMetric('W10-F2', { atZero: 'un GET; V9 sólo con status expired', urgentChip: 'rgb(255, 218, 214) / rgb(147, 0, 10)' });
    await context.close();
  });

  test('W10 rejections in confirm still go to W13 and «Intentos agotados» keeps the record', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    await page.addInitScript(({ userId, key }) => {
      if (sessionStorage.getItem('wf-t5-seeded')) return;
      sessionStorage.setItem('wf-t5-seeded', '1');
      sessionStorage.setItem('wallet:web:active-user', userId);
      sessionStorage.setItem(key, JSON.stringify({ key: 'synthetic-key-0000000000000001', body: { sourceAccountId: 'a', destinationType: 'beneficiary', beneficiaryId: 'b', amountMinor: '412345', concept: 'Honorarios de prueba', reference: '204801' }, transferId: '9c4a0000-0000-4000-8000-000000000401' }));
    }, { userId: data.user.id, key: `wallet:web:transfer-attempt:${data.user.id}` });
    await openStatus(page, awaiting(), { confirmReplies: [problem(429, 'Se agotaron los intentos.', 'Too Many Requests')] });
    const before = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wallet:web:'))));
    await otp(page).fill('246810');
    await authorize(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Operación suspendida' })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wallet:web:'))))).toBe(before);
    await context.close();
    const second = await newPage(browser, V1440);
    await openStatus(second.page, awaiting(), { confirmReplies: [problem(422, 'Saldo insuficiente.')] });
    await otp(second.page).fill('246810');
    await authorize(second.page).click();
    await expect(second.page.getByRole('heading', { level: 1, name: 'Transferencia rechazada: Saldo insuficiente' })).toBeVisible();
    await second.context.close();
  });
});

// ───────────────────────────── W11 ─────────────────────────────
const record = (transferId?: string) => ({
  key: 'synthetic-key-0000000000000002',
  body: { sourceAccountId: data.ids.checking, destinationType: 'beneficiary', beneficiaryId: data.ids.beneficiary, amountMinor: '91234', concept: 'Pago de prueba', reference: '7788' },
  ...(transferId ? { transferId } : {}),
});
const seedRecord = (page: Page, value: ReturnType<typeof record>) => page.addInitScript(({ userId, key, raw }) => {
  if (sessionStorage.getItem('wf-t5-seeded')) return;
  sessionStorage.setItem('wf-t5-seeded', '1');
  sessionStorage.setItem('wallet:web:active-user', userId);
  sessionStorage.setItem(key, raw);
}, { userId: data.user.id, key: `wallet:web:transfer-attempt:${data.user.id}`, raw: JSON.stringify(value) });
const PANEL_ROWS = ['Destinatario', 'Cuenta de origen', 'Monto', 'Referencia'];

async function sendingState(page: Page) {
  await page.clock.setFixedTime(NOW);
  const api = await installMockApi(page, { policy: data.policy({ otpThresholdMinor: '99999999' }) });
  const held = gate();
  await page.route('**/v1/transfers', async (route) => { if (route.request().method() === 'POST') await held.promise; await route.fallback(); });
  await page.goto(`/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
  await page.getByLabel('Importe a transferir').fill('912.34');
  await page.getByLabel('Concepto').fill('Pago de prueba');
  await page.getByLabel('Referencia numérica').fill('7788');
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Enviando transferencia' })).toBeVisible();
  return { api, release: held.release };
}

async function verifyingState(page: Page, kind: 'post' | 'get') {
  await page.clock.setFixedTime(NOW);
  seedRecord(page, record(kind === 'get' ? data.ids.transfer1 : undefined));
  const api = await installMockApi(page, { transfers: new Map([[data.ids.transfer1, completed({ amountMinor: '91234', concept: 'Pago de prueba', reference: '7788' })]]) });
  const held = gate();
  await page.route(kind === 'get' ? `**/v1/transfers/${data.ids.transfer1}` : '**/v1/transfers', async (route) => {
    if (kind === 'get' || route.request().method() === 'POST') await held.promise;
    await route.fallback();
  });
  await page.goto('/transfers/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Estamos verificando si tu transferencia se completó' })).toBeVisible();
  return { api, release: held.release };
}

async function unknownState(page: Page) {
  await page.clock.setFixedTime(NOW);
  const api = await installMockApi(page, { policy: data.policy({ otpThresholdMinor: '99999999' }), createReplies: ['abort'] });
  await page.goto(`/transfers/new?beneficiaryId=${data.ids.beneficiary}`);
  await page.getByLabel('Importe a transferir').fill('912.34');
  await page.getByLabel('Concepto').fill('Pago de prueba');
  await page.getByLabel('Referencia numérica').fill('7788');
  await page.getByRole('button', { name: /Continuar a revisión/ }).click();
  await page.getByRole('button', { name: 'Confirmar transferencia' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible();
  return api;
}

async function chipLook(page: Page) {
  const chip = page.locator('.vr-chip');
  return { text: await chip.innerText(), ...(await styles(chip, ['background-color', 'color'] as const)), animated: await page.locator('.vr-icon .spin').count(), icon: await page.locator('.vr-icon svg[data-icon]').getAttribute('data-icon'), h1: await page.locator('h1').innerText(), buttonDisabled: await page.locator('.vr-button').isDisabled() };
}

test.describe('W11 · Enviando, verificando y resultado desconocido', () => {
  for (const viewport of [V1440, viewportR(REF.W11_SENDING), V768, V390]) {
    test(`W11-V1 enviando ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const { api, release } = await sendingState(page);
      const metrics: Record<string, unknown> = {};
      const chip = page.locator('.sd-chip');
      await expect(chip).toHaveText('Enviando');
      expect(await styles(chip, ['background-color', 'color', 'text-transform'] as const)).toEqual({ 'background-color': 'rgb(224, 232, 255)', color: 'rgb(0, 55, 176)', 'text-transform': 'uppercase' });
      expect(await font(page.locator('h1'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px', 'font-weight': '600' } : { 'font-size': '24px', 'line-height': '32px' });
      await expect(page.locator('.sd-header p')).toHaveText('Por favor no cierres ni recargues esta ventana mientras se procesa la solicitud.');
      const card = page.locator('.sd-card');
      const cardBox = await box(card);
      if (viewport.width >= 768) expect(near(cardBox.width, 576)).toBe(true);
      await expect(card.locator('.sd-ring svg[data-icon="swap"]')).toHaveCount(1);
      await expect(card.locator('.sd-amount')).toHaveText('Monto a transferir$912.34 MXN');
      await expect(card.locator('.sd-panel dt')).toHaveText(['Destinatario', 'Cuenta de origen', 'Concepto', 'Referencia']);
      await expect(card.locator('.sd-panel dd').nth(0)).toHaveText(`${beneficiary.name}•• ${tail(beneficiary.clabeMasked)}`);
      await expect(card.locator('.sd-panel dd').nth(1)).toHaveText(`${checking.name}•• ${tail(checking.clabeMasked)}`);
      await expect(card.locator('.sd-panel dd').nth(2)).toHaveText('Pago de prueba');
      await expect(card.locator('.sd-panel dd').nth(3)).toHaveText('7788');
      await expect(page.getByRole('button', { name: 'Enviando transferencia…' })).toBeDisabled();
      expect(await runningAnimations(page), 'A11Y-10').toEqual([]);
      metrics.card = cardBox;
      metrics.responsive = await responsive(page);
      metrics.a11y = await a11yBasics(page, withShell([], wide(viewport)));
      await shoot(page, 'W11-enviando', { scenario: 'F-W11-1', screen: 'W11', state: 'enviando', reference: REF.W11_SENDING }, viewport);
      if (viewport.label === 'R') metrics.sideBySide = await sideBySide(browser, page, 'W11-enviando', { scenario: 'F-W11-1', screen: 'W11', state: 'enviando', reference: REF.W11_SENDING }, viewport);
      release();
      await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
      expect(nonGet(api)).toEqual(['POST /v1/transfers']);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W11-V1 ${viewport.label} ${viewport.width}x${viewport.height}`, metrics);
      await context.close();
    });

    test(`W11-V2/V3 verificando y desconocido ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
      const metrics: Record<string, unknown> = {};
      // V2 · record without transferId, POST of the same record held (F-W11-2).
      let { context, page } = await newPage(browser, viewport);
      let seen = watch(page);
      const verifying = await verifyingState(page, 'post');
      const v2 = await chipLook(page);
      expect(v2).toMatchObject({ text: 'VERIFICANDO RESULTADO', 'background-color': 'rgb(241, 243, 255)', color: 'rgb(67, 70, 85)', animated: 1, icon: 'sync', buttonDisabled: true });
      await expect(page.locator('.vr-heading p')).toHaveText('Hay un envío de esta pestaña sin resultado confirmado. Estamos consultando el resultado de tu operación.');
      await expect(page.locator('.vr-panel dt')).toHaveText(PANEL_ROWS);
      await expect(page.locator('.vr-panel dd')).toHaveText([`${beneficiary.name} (terminación ${tail(beneficiary.clabeMasked)})`, `${checking.name} (•• ${tail(checking.clabeMasked)})`, '$912.34 MXN', '7788']);
      await expect(page.locator('.vr-note')).toHaveText('Estamos repitiendo la misma solicitud con su misma clave de operación; no se crea un intento nuevo.');
      await expect(page.locator('.vr-button')).toHaveText('Reintentando el mismo envío…');
      if (viewport.width >= 768) expect(near((await box(page.locator('.vr-card'))).width, 576)).toBe(true);
      metrics.v2 = { ...v2, responsive: await responsive(page), a11y: await a11yBasics(page, withShell(['Volver al Inicio (conservarás un aviso visible para retomar la verificación)'], wide(viewport))) };
      await shoot(page, 'W11-verificando', { scenario: 'F-W11-2', screen: 'W11', state: 'verificando resultado', reference: REF.W11_VERIFYING }, viewport);
      if (viewport.label === 'R') metrics.v2sbs = await sideBySide(browser, page, 'W11-verificando', { scenario: 'F-W11-2', screen: 'W11', state: 'verificando resultado', reference: REF.W11_VERIFYING }, viewport);
      verifying.release();
      await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
      expect(nonGet(verifying.api)).toEqual(['POST /v1/transfers']);
      expect(verifying.api.requests.find((item) => item.method === 'POST' && item.path === '/v1/transfers')!.idempotencyKey).toBe('synthetic-key-0000000000000002');
      expect(seen.errors).toEqual([]);
      await context.close();
      // V3 · POST aborted (F-W11-4).
      ({ context, page } = await newPage(browser, viewport));
      seen = watch(page);
      const api = await unknownState(page);
      const v3 = await chipLook(page);
      expect(v3).toMatchObject({ text: 'RESULTADO DESCONOCIDO', 'background-color': 'rgb(255, 219, 205)', color: 'rgb(122, 43, 0)', animated: 0, icon: 'syncProblem', h1: 'No pudimos confirmar el resultado', buttonDisabled: false });
      // V4: the two states differ in chip text, chip colour, h1, animated vs static icon and disabled vs enabled button.
      for (const key of ['text', 'background-color', 'color', 'animated', 'icon', 'h1', 'buttonDisabled'] as const) expect(v3[key], `W11-V4 ${key}`).not.toEqual(v2[key]);
      await expect(page.locator('.vr-heading p')).toHaveText('La conexión se interrumpió antes de recibir respuesta. No envíes una transferencia nueva: verifica este mismo intento.');
      await expect(page.locator('.vr-note')).toHaveText('Se repetirá la misma solicitud con su misma clave de operación; no se crea un intento nuevo.');
      await expect(page.locator('main')).not.toContainText(/No reenviamos|no se enviará de nuevo|no hubo cargo|Monto en consulta|Entorno seguro/i);
      const home = page.getByRole('link', { name: 'Volver al Inicio (conservarás un aviso visible para retomar la verificación)' });
      await expect(home).toHaveAttribute('href', '/accounts');
      metrics.v3 = { ...v3, responsive: await responsive(page), a11y: await a11yBasics(page, withShell(['Reintentar el mismo envío', 'Volver al Inicio (conservarás un aviso visible para retomar la verificación)'], wide(viewport))) };
      await shoot(page, 'W11-desconocido', { scenario: 'F-W11-4', screen: 'W11', state: 'resultado desconocido', reference: REF.W11_VERIFYING }, viewport);
      if (viewport.label === 'R') metrics.v3sbs = await sideBySide(browser, page, 'W11-desconocido', { scenario: 'F-W11-4', screen: 'W11', state: 'resultado desconocido', reference: REF.W11_VERIFYING }, viewport);
      // «Reintentar el mismo envío» = the same POST (same key, same body).
      await page.getByRole('button', { name: 'Reintentar el mismo envío' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
      const creates = api.requests.filter((item) => item.method === 'POST' && item.path === '/v1/transfers');
      expect(creates).toHaveLength(2);
      expect(creates[1]!.idempotencyKey).toBe(creates[0]!.idempotencyKey);
      expect(creates[1]!.bodySha256).toBe(creates[0]!.bodySha256);
      expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
      recordMetric(`W11-V2/V3/V4 ${viewport.label} ${viewport.width}x${viewport.height}`, metrics);
      await context.close();
    });
  }

  test('W11-F1 copy per action: GET of a known id says «No reenviamos» and «Consultar estado»; F-W11-3 / F-W11-5', async ({ browser }) => {
    const metrics: Record<string, unknown> = {};
    // F-W11-3: record with transferId, GET held → V2 with the GET note.
    let { context, page } = await newPage(browser, V1440);
    const held = await verifyingState(page, 'get');
    await expect(page.locator('.vr-note')).toHaveText('No reenviamos tu transferencia. Consultamos el estado de este mismo intento.');
    await expect(page.locator('.vr-button')).toHaveText('Consultando…');
    held.release();
    await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
    expect(nonGet(held.api)).toEqual([]);
    metrics['F-W11-3'] = 'GET retenido → V2 «No reenviamos…»; sin POST';
    await context.close();
    // Status page: GET 503 → V3 «Consultar estado» (GET only).
    ({ context, page } = await newPage(browser, V1440));
    const api = await openStatusError(page);
    await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible();
    await expect(page.locator('.vr-heading p')).toHaveText('Recibimos una respuesta que no confirma el resultado. No envíes una transferencia nueva: verifica este mismo intento.');
    await expect(page.locator('.vr-note')).toHaveText('No reenviamos tu transferencia. Consultamos el estado de este mismo intento.');
    await page.getByRole('button', { name: 'Consultar estado' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
    expect(nonGet(api)).toEqual([]);
    metrics['F-W11-5 (estado)'] = 'GET 503 → V3 «Consultar estado» → GET → W12; sin POST';
    await context.close();
    // F-W11-5 on /transfers/new: record with id, GET 503 → V3 whose only action is the same-key POST (truthful copy).
    ({ context, page } = await newPage(browser, V1440));
    await page.clock.setFixedTime(NOW);
    seedRecord(page, record(data.ids.transfer1));
    const mount = await installMockApi(page, { overrides: new Map([[`GET /transfers/${data.ids.transfer1}`, problem(503, 'Servicio no disponible.', 'Service Unavailable')]]) });
    await page.goto('/transfers/new');
    await expect(page.getByRole('heading', { level: 1, name: 'No pudimos confirmar el resultado' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar el mismo envío' })).toBeVisible();
    await expect(page.locator('.vr-note')).toHaveText('Se repetirá la misma solicitud con su misma clave de operación; no se crea un intento nuevo.');
    expect(nonGet(mount)).toEqual([]);
    metrics['F-W11-5 (montaje)'] = 'GET 503 → V3 «Reintentar el mismo envío» (acción real: POST con la misma clave)';
    await context.close();
    recordMetric('W11-F1', metrics);
  });

  test('W11-F4 «Volver al Inicio» keeps the record and W03 shows the pending notice', async ({ browser }) => {
    const { context, page } = await newPage(browser, V1440);
    const api = await unknownState(page);
    const before = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wallet:web:transfer-attempt:'))));
    expect(before).not.toBe('[]');
    await page.getByRole('link', { name: /^Volver al Inicio/ }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await expect(page.getByRole('region', { name: 'Estamos verificando el resultado de tu transferencia' })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage).filter(([key]) => key.startsWith('wallet:web:transfer-attempt:'))))).toBe(before);
    expect(nonGet(api)).toEqual(['POST /v1/transfers']);
    recordMetric('W11-F4', { recordKept: true, w03Notice: true });
    await context.close();
  });
});

async function openStatusError(page: Page) {
  await page.clock.setFixedTime(NOW);
  let calls = 0;
  const api = await installMockApi(page, { transfers: new Map([[data.ids.transfer1, completed()]]) });
  await page.route(`**/v1/transfers/${data.ids.transfer1}`, async (route) => {
    calls += 1;
    // First read and its single react-query retry fail; the explicit «Consultar estado» succeeds.
    if (calls <= 2) return route.fulfill({ status: 503, contentType: 'application/problem+json', body: JSON.stringify(data.problem(503, 'Servicio no disponible.', 'Service Unavailable')) });
    return route.fallback();
  });
  await page.goto(`/transfers/${data.ids.transfer1}/status`);
  return api;
}

// ───────────────────────────── W12 ─────────────────────────────
const ownTransfer = () => completed({ destination: savings, concept: 'Traspaso a ahorro', reference: '9911', amountMinor: '150075' });

async function receipt(browser: Browser, viewport: Viewport, own: boolean) {
  const { context, page } = await newPage(browser, viewport);
  const seen = watch(page);
  const transfer = own ? ownTransfer() : completed();
  const api = await openStatus(page, transfer);
  await expect(page.getByRole('heading', { level: 1, name: '¡Transferencia completada con éxito!' })).toBeVisible();
  return { context, page, seen, api, transfer };
}

test.describe('W12 · Comprobante', () => {
  for (const own of [false, true]) {
    const ref = own ? REF.W12_OWN : REF.W12;
    for (const viewport of [V1440, viewportR(ref), V768, V390]) {
      test(`W12 ${own ? 'propias' : 'beneficiario'} ${viewport.label} ${viewport.width}x${viewport.height}@${viewport.dpr}`, async ({ browser }) => {
        const { context, page, seen, api, transfer } = await receipt(browser, viewport, own);
        const metrics: Record<string, unknown> = {};
        // V1 header.
        const check = page.locator('.rc-check');
        expect(await styles(check, ['width', 'height', 'background-color', 'border-radius'] as const)).toEqual({ width: '64px', height: '64px', 'background-color': 'rgb(152, 246, 187)', 'border-radius': '9999px' });
        await expect(check.locator('svg[data-icon="checkCircle"]')).toHaveCount(1);
        await expect(page.locator('.rc-chip')).toHaveText('Operación exitosa');
        expect(await font(page.locator('h1'))).toMatchObject(viewport.width >= 768 ? { 'font-size': '30px', 'line-height': '38px', 'font-weight': '600' } : { 'font-size': '24px', 'line-height': '32px' });
        await expect(page.locator('.rc-subtitle')).toHaveCount(own ? 1 : 0);
        if (own) await expect(page.locator('.rc-subtitle')).toHaveText('El traspaso entre tus cuentas ha sido aplicado.');
        const amount = page.locator('.rc-amount');
        await expect(amount).toHaveText(own ? '$1,500.75 MXN' : '$4,123.45 MXN');
        expect(await styles(amount, ['color', 'font-size'] as const)).toEqual({ color: 'rgb(0, 55, 176)', 'font-size': viewport.width < 768 ? '32px' : '40px' });
        // V2 card.
        const card = page.locator('.rc-card');
        const cardBox = await box(card);
        if (viewport.width >= 1024) expect(near(cardBox.width, 768)).toBe(true);
        expect(await styles(page.locator('.rc-bar'), ['height', 'background-color'] as const)).toEqual({ height: '8px', 'background-color': 'rgb(0, 55, 176)' });
        await expect(card.locator('.rc-head-text')).toHaveText(`Comprobante de transferencia${own ? 'Traspaso entre cuentas propias' : 'Transferencia interna Billetera MXN'}`);
        await expect(card.locator('.rc-folio-text')).toHaveText(`Folio interno${transfer.id}`); // D-13: receiptReference ?? id
        // V3 parties.
        await expect(card.locator('.rc-party')).toHaveText([
          `Cuenta de origen${checking.name}Terminación •• ${tail(checking.clabeMasked)}`,
          own ? `Cuenta de destino${savings.name}Terminación •• ${tail(savings.clabeMasked)}` : `Destinatario${beneficiary.name}Billetera MXN •• ${tail(beneficiary.clabeMasked)}`,
        ]);
        // V4 rows.
        await expect(card.locator('.rc-rows dt')).toHaveText(['Fecha y hora', 'Concepto', 'Referencia']);
        await expect(card.locator('.rc-rows dd')).toHaveText(['17 de noviembre de 2026, 10:00', transfer.concept, transfer.reference]);
        // V5 balances from GET /accounts.
        if (own) {
          await expect(card.locator('.rc-balances-title')).toHaveText('Saldos disponibles actuales');
          await expect(card.locator('.rc-balance-card')).toHaveText([
            `${checking.name} (•• ${tail(checking.clabeMasked)})− $1,500.75Saldo actual$7,345.00 MXN`,
            `${savings.name} (•• ${tail(savings.clabeMasked)})+ $1,500.75Saldo actual$2,150.75 MXN`,
          ]);
          await expect(card.locator('.rc-total')).toHaveText('Saldo total consolidadoSuma de los saldos disponibles de tus cuentas$9,495.75 MXN');
        } else await expect(card.locator('.rc-total')).toHaveText(`Saldo disponible actual${checking.name}$7,345.00 MXN`); // COPY-CHANGES UX-T3: sin «Cuenta Cuenta …»
        await expect(page.locator('main')).not.toContainText(/Comisi|CEP|Comprobante Oficial|Cifrado|Saldo posterior|DEMO-/);
        // V6 actions.
        await expect(page.locator('.rc-actions a')).toHaveText(['Volver al inicio', 'Ver movimientos']);
        await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/accounts');
        await expect(page.getByRole('link', { name: 'Ver movimientos' })).toHaveAttribute('href', `/accounts/${data.ids.checking}/movements`);
        expect(await styles(page.getByRole('link', { name: 'Volver al inicio' }), ['background-color', 'color', 'border-radius'] as const)).toEqual({ 'background-color': 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)', 'border-radius': '12px' });
        metrics.card = cardBox;
        metrics.responsive = await responsive(page);
        metrics.a11y = await a11yBasics(page, withShell(['Copiar folio', 'Volver al inicio', 'Ver movimientos'], wide(viewport)));
        await shoot(page, `W12-${own ? 'propias' : 'beneficiario'}`, { scenario: own ? 'F-W12-2' : 'F-W12-1', screen: 'W12', state: own ? 'propias' : 'beneficiario', reference: ref }, viewport);
        if (viewport.label === 'R') metrics.sideBySide = await sideBySide(browser, page, `W12-${own ? 'propias' : 'beneficiario'}`, { scenario: own ? 'F-W12-2' : 'F-W12-1', screen: 'W12', state: own ? 'propias' : 'beneficiario', reference: ref }, viewport);
        expect(nonGet(api)).toEqual([]);
        expect(seen.foreign).toEqual([]); expect(seen.errors).toEqual([]);
        recordMetric(`W12 ${own ? 'propias' : 'beneficiario'} ${viewport.label} ${viewport.width}x${viewport.height}`, metrics);
        await context.close();
      });
    }
  }

  test('W12-F1 folio: copy to clipboard with «Folio copiado»; long folio does not overflow at 390; reflow', async ({ browser }) => {
    const { context, page } = await newPage(browser, V390);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5301' });
    const long = completed({ receiptReference: `RCPT-${'7'.repeat(60)}` });
    await openStatus(page, long);
    await page.getByRole('button', { name: 'Copiar folio' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Folio copiado' })).toHaveText('Folio copiado');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(long.receiptReference);
    await responsive(page);
    const folio = await box(page.locator('.rc-folio-value'));
    expect(folio.x + folio.width).toBeLessThanOrEqual(390);
    await shoot(page, 'W12-folio-largo', { scenario: 'F-W12-3', screen: 'W12', state: 'folio largo', reference: REF.W12 }, V390);
    const results = await reflow(browser, async (p) => { await openStatus(p, ownTransfer()); await settle(p); });
    recordMetric('W12-F1', { clipboard: 'folio completo', status: 'Folio copiado', overflow390: false, reflow: results });
    await context.close();
  });
});
