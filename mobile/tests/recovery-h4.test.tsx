import React from 'react';
import assert from 'node:assert/strict';
import TestRenderer from 'react-test-renderer';
import App from '../App';

// Round 7 · H4 (pass 9): F-26 (safe way out of a record that never resolves), F-21 residual (an unverified 4xx on a retry
// keeps the record), F-27 (no creating POST without a tap) and F-28 (guard coverage).

jest.mock('../App', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
  return jest.requireActual('../App');
});

const mockSecureValues = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureValues.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => { mockSecureValues.set(key, value); return Promise.resolve(); }),
  deleteItemAsync: jest.fn((key: string) => { mockSecureValues.delete(key); return Promise.resolve(); }),
}));
type StoreMock = { getItemAsync: jest.Mock; setItemAsync: jest.Mock; deleteItemAsync: jest.Mock };
const store = () => jest.requireMock('expo-secure-store') as StoreMock;
const resetStore = () => {
  store().getItemAsync.mockReset().mockImplementation((key: string) => Promise.resolve(mockSecureValues.get(key) ?? null));
  store().setItemAsync.mockReset().mockImplementation((key: string, value: string) => { mockSecureValues.set(key, value); return Promise.resolve(); });
  store().deleteItemAsync.mockReset().mockImplementation((key: string) => { mockSecureValues.delete(key); return Promise.resolve(); });
};
beforeEach(() => { mockSecureValues.clear(); resetStore(); });
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `h4-new-key-${++mockUuid}`) }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

const USER = 'user-h4';
const OTHER = 'user-other';
const LEGACY = 'wallet.transfer-recovery';
const ownKey = (id = USER) => `${LEGACY}.${id}`;
const account = { id: 'source-1', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1245000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' };
const beneficiary = { id: 'beneficiary-1', name: 'Carlos Ruiz', alias: 'Carlos', clabeMasked: '000•••••••••••0028', destinationAccountId: 'dest-1' };
const storedPayload = { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '30025', concept: 'Comida', reference: '4401' };
const STORED_KEY = 'stored-key-0001-abcd';
const record = (extra: Record<string, unknown> = {}) => JSON.stringify({ key: STORED_KEY, payload: storedPayload, userId: USER, ...extra });
const transferBody = (overrides: Record<string, unknown> = {}) => ({ id: 'tr-new', status: 'completed', sourceAccountId: 'source-1', destination: beneficiary, amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', createdAt: '2026-11-13T20:30:00.000Z', completedAt: '2026-11-13T20:31:00.000Z', receiptReference: 'R-NEW', ...overrides });
const problem = (status: number, detail: string) => Response.json({ title: 'Error', detail }, { status });

type Call = { url: string; init?: RequestInit };
type Handler = (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;
const keyOf = (call: Call) => (call.init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'];
const isCreate = (call: Call) => call.url.endsWith('/transfers') && call.init?.method === 'POST';

async function signIn(seed: Record<string, string>, handler: Handler) {
  for (const [key, value] of Object.entries(seed)) mockSecureValues.set(key, value);
  const calls: Call[] = [];
  const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const handled = await handler(url, init);
    if (handled) return handled;
    if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: USER, fullName: 'Ana López', email: 'ana@example.com' } });
    if (url.endsWith('/auth/me')) return Response.json({ id: USER, fullName: 'Ana López', email: 'ana@example.com' });
    if (url.endsWith('/accounts')) return Response.json({ items: [account] });
    if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/beneficiaries')) return Response.json({ items: [beneficiary] });
    if (url.endsWith('/transfer-policy')) return Response.json({ currency: 'MXN', otpThresholdMinor: '500000', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpExpirySeconds: 300, otpMaxAttempts: 5, businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City' });
    // A NEW attempt (any key other than the stored one) completes; GET of its id answers the same.
    if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json(transferBody(), { status: 201 });
    if (url.endsWith('/transfers/tr-new')) return Response.json(transferBody());
    throw new Error(`Unexpected API request: ${url}`);
  });
  Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
  let renderer: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
  const visible = () => JSON.stringify(renderer!.toJSON());
  const pressables = (text: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && (node.props.accessibilityLabel === text || node.findAll((child) => String(child.type).includes('Text') && child.props.children === text).length > 0));
  const button = (title: string) => {
    const found = pressables(title)[0];
    assert.ok(found, `button "${title}" is present`);
    return found;
  };
  const press = async (title: string) => { await TestRenderer.act(async () => { button(title).props.onPress(); }); };
  const wait = (ms = 40) => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
  await press('Iniciar sesión');
  await wait(60);
  const creates = () => calls.filter(isCreate);
  const homeOffersNewTransfer = () => pressables('Transferir dinero, elegir beneficiario').length > 0;
  const finish = async () => { await TestRenderer.act(async () => { renderer!.unmount(); }); delete (global as { fetch?: typeof fetch }).fetch; };
  /** Leaves M09 for Home when the app landed there (e.g. a check without answer at start-up). */
  const toHome = async () => { if (pressables('Ir al inicio (revisar saldo después)').length) { await press('Ir al inicio (revisar saldo después)'); await wait(60); } };
  /** A complete new transfer (Carlos Ruiz, $850.00) from Home. */
  const transferOnce = async () => {
    await press('Transferir dinero, elegir beneficiario');
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
    await press('Continuar con transferencia');
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('850.00'); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('131126'); });
    await press('Continuar');
    await press('Confirmar transferencia');
    await wait(60);
  };
  return { renderer: renderer!, visible, pressables, button, press, wait, calls, creates, homeOffersNewTransfer, toHome, transferOnce, finish };
}

describe('H4 · F-26 (a): only a definitive negative from the server releases a record automatically', () => {
  for (const where of ['start-up', 'Home'] as const) {
    it(`GET of the stored attempt answers 404 (${where}): the record is released, Home says why and exactly one new transfer goes through with a new key`, async () => {
      let reads = 0;
      const app = await signIn({ [ownKey()]: record({ transferId: 'tr-gone' }) }, (url) => {
        if (url.endsWith('/transfers/tr-gone')) {
          reads += 1;
          // "Home": the first read (start-up) gets no answer; the one made when Home is shown gets the 404.
          if (where === 'Home' && reads === 1) throw new TypeError('Network request failed');
          return problem(404, 'Transferencia no encontrada.');
        }
        return undefined;
      });
      await app.toHome();
      assert.equal(reads, where === 'Home' ? 2 : 1);
      assert.equal(mockSecureValues.get(ownKey()), undefined, 'released');
      assert.match(app.visible(), /El servidor no tiene registro de la operación de \$300.25 MXN \(Ref: 4401\)/);
      assert.match(app.visible(), /Ya puedes hacer otra transferencia/);
      assert.doesNotMatch(app.visible(), /Transferencia en verificación/);
      assert.equal(app.creates().length, 0, 'releasing never sends anything');
      assert.ok(app.homeOffersNewTransfer(), 'the transfer flow is enabled again');
      await app.transferOnce();
      assert.match(app.visible(), /"Transferencia completada"/);
      assert.equal(app.creates().length, 1);
      assert.notEqual(keyOf(app.creates()[0]!), STORED_KEY);
      await app.finish();
    });
  }

  for (const [label, answer] of [
    ['HTTP 500', () => problem(500, 'Ocurrió un error interno.')],
    ['no answer', () => { throw new TypeError('Network request failed'); }],
    ['HTTP 409', () => problem(409, 'Conflicto.')],
    ['HTTP 401', () => problem(401, 'Unauthorized')],
  ] as const) {
    it(`GET of the stored attempt answers ${label}: the record is kept byte-identical and Home offers no new transfer`, async () => {
      const stored = record({ transferId: 'tr-unknown' });
      const app = await signIn({ [ownKey()]: stored }, (url) => (url.endsWith('/transfers/tr-unknown') ? answer() : undefined));
      await app.toHome();
      await app.wait(60);
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.ok(!app.homeOffersNewTransfer());
      assert.equal(app.creates().length, 0);
      assert.doesNotMatch(app.visible(), /El servidor no tiene registro/);
      await app.finish();
    });
  }

  for (const [label, answer] of [
    ['HTTP 500', () => problem(500, 'Ocurrió un error interno.')],
    ['no answer', () => { throw new TypeError('Network request failed'); }],
  ] as const) {
    it(`the replay of an attempt without id answers ${label}: the record is kept and only the same key is used`, async () => {
      const stored = record();
      const app = await signIn({ [ownKey()]: stored }, (url, init) => (url.endsWith('/transfers') && init?.method === 'POST' && keyOf({ url, init }) === STORED_KEY ? answer() : undefined));
      if (app.pressables('Verificar estado de la transferencia').length) { await app.press('Verificar estado de la transferencia'); await app.wait(60); }
      await app.toHome();
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.ok(!app.homeOffersNewTransfer());
      assert.ok(app.creates().every((call) => keyOf(call) === STORED_KEY));
      await app.finish();
    });
  }

  it('a legacy record without owner is migrated to the user signed in; when its replay answers 404 it is released (M11 explains it) and the flow is enabled again', async () => {
    const legacy = JSON.stringify({ key: STORED_KEY, payload: { ...storedPayload, beneficiaryId: 'beneficiary-of-someone-else' } });
    const app = await signIn({ [LEGACY]: legacy }, (url, init) => (url.endsWith('/transfers') && init?.method === 'POST' && keyOf({ url, init }) === STORED_KEY ? problem(404, 'Beneficiario no encontrado.') : undefined));
    if (app.pressables('Verificar estado de la transferencia').length) { await app.press('Verificar estado de la transferencia'); await app.wait(60); }
    assert.match(app.visible(), /No se pudo completar la transferencia/);
    assert.match(app.visible(), /Beneficiario no encontrado/);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    assert.equal(mockSecureValues.get(LEGACY), undefined);
    await app.press('Volver al inicio');
    await app.wait();
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });
});

describe('H4 · F-26 (b)/(c)/(d): damaged or unreadable records and the explicit discard', () => {
  it('a damaged (truncated JSON) record is explained in plain words, never as a parser error; discarding it after confirming deletes only this user\'s record and enables one new transfer', async () => {
    const othersRecord = JSON.stringify({ key: 'other-key-0001-abcd', payload: storedPayload, userId: OTHER });
    const othersLegacy = JSON.stringify({ key: 'other-legacy-0001', payload: storedPayload, userId: OTHER });
    const app = await signIn({ [ownKey()]: '{"key":"stored-key-0001-abcd","payl', [ownKey(OTHER)]: othersRecord, [LEGACY]: othersLegacy }, () => undefined);
    const home = app.visible();
    assert.match(home, /Registro de transferencia dañado/);
    assert.match(home, /No pudimos leer los datos guardados de una transferencia anterior/);
    assert.doesNotMatch(home, /Unexpected|JSON|SyntaxError|Estamos verificando/);
    assert.ok(!app.homeOffersNewTransfer());
    await app.press('Descartar este intento');
    const dialog = app.visible();
    assert.match(dialog, /¿Descartar este intento\?/);
    assert.match(dialog, /Revisa primero Movimientos: si el cargo aparece, la transferencia ya se realizó. Descartar no la cancela ni la revierte./);
    await app.press('Descartar intento');
    await app.wait();
    assert.equal(mockSecureValues.get(ownKey()), undefined, 'this user\'s record is gone');
    assert.equal(mockSecureValues.get(ownKey(OTHER)), othersRecord, 'another user\'s record is untouched');
    assert.equal(mockSecureValues.get(LEGACY), othersLegacy, 'another user\'s legacy slot is untouched');
    assert.match(app.visible(), /Descartaste manualmente el seguimiento de una transferencia anterior/);
    assert.doesNotMatch(app.visible(), /¿Descartar este intento\?/);
    assert.ok(app.homeOffersNewTransfer());
    await app.transferOnce();
    assert.match(app.visible(), /"Transferencia completada"/);
    assert.equal(app.creates().length, 1, 'exactly one new attempt');
    await app.finish();
  });

  it('a damaged record found by the guard when confirming sends nothing and shows the same notice on Home', async () => {
    const app = await signIn({}, () => undefined);
    await app.press('Transferir dinero, elegir beneficiario');
    await app.wait();
    await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
    await app.press('Continuar con transferencia');
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('850.00'); });
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); app.renderer.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('131126'); });
    await app.press('Continuar');
    mockSecureValues.set(ownKey(), 'not json at all');
    await app.press('Confirmar transferencia');
    await app.wait();
    assert.equal(app.creates().length, 0);
    assert.match(app.visible(), /Registro de transferencia dañado/);
    assert.doesNotMatch(app.visible(), /Unexpected|JSON/);
    await app.finish();
  });

  it('cancelling the confirmation keeps the record and the notice exactly as they were', async () => {
    const stored = record();
    const app = await signIn({ [ownKey()]: stored }, (url, init) => (url.endsWith('/transfers') && init?.method === 'POST' && keyOf({ url, init }) === STORED_KEY ? (() => { throw new TypeError('Network request failed'); })() : undefined));
    await app.toHome();
    const sent = app.creates().length;
    await app.press('Descartar este intento');
    assert.match(app.visible(), /¿Descartar este intento\?/);
    await app.press('Conservar intento');
    await app.wait();
    assert.doesNotMatch(app.visible(), /¿Descartar este intento\?/);
    assert.equal(mockSecureValues.get(ownKey()), stored);
    assert.match(app.visible(), /Transferencia en verificación/);
    assert.doesNotMatch(app.visible(), /Descartaste manualmente/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(app.creates().length, sent, 'cancelling sends nothing');
    await app.finish();
  });

  it('an attempt the server confirms is waiting for its code offers no discard (its way out is the confirmed cancel in M08)', async () => {
    const pending = transferBody({ id: 'tr-wait', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
    let reads = 0;
    const app = await signIn({ [ownKey()]: record({ transferId: 'tr-wait', status: 'awaiting_confirmation' }) }, (url) => {
      // Start-up read fails (so M08 is not reopened); Home's read confirms "awaiting_confirmation".
      if (url.endsWith('/transfers/tr-wait')) { reads += 1; if (reads === 1) throw new TypeError('Network request failed'); return Response.json(pending); }
      return undefined;
    });
    await app.toHome();
    await app.wait(60);
    assert.match(app.visible(), /Transferencia pendiente de autorizar/);
    assert.equal(app.pressables('Descartar este intento').length, 0);
    assert.ok(app.pressables('Continuar con la transferencia pendiente').length > 0);
    await app.finish();
  });

  it('an unreadable secure store fails closed; the discard tries to delete and, when it cannot, says so without claiming success', async () => {
    const stored = record();
    mockSecureValues.set(ownKey(), stored);
    store().getItemAsync.mockImplementation((key: string) => (key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : Promise.resolve(mockSecureValues.get(key) ?? null)));
    store().deleteItemAsync.mockImplementation((key: string) => (key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : (mockSecureValues.delete(key), Promise.resolve())));
    const app = await signIn({}, (url, init) => (url.endsWith('/transfers') && init?.method === 'POST' && keyOf({ url, init }) === STORED_KEY ? (() => { throw new TypeError('Network request failed'); })() : undefined));
    assert.match(app.visible(), /No pudimos comprobar tus transferencias/);
    assert.doesNotMatch(app.visible(), /keychain locked/);
    assert.ok(!app.homeOffersNewTransfer());
    await app.press('Descartar este intento');
    await app.press('Descartar intento');
    await app.wait();
    assert.ok(store().deleteItemAsync.mock.calls.some(([key]) => key === ownKey()), 'the discard tried to delete this user\'s record');
    assert.match(app.visible(), /No pudimos descartar el registro en este dispositivo/);
    assert.doesNotMatch(app.visible(), /Descartaste manualmente/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(mockSecureValues.get(ownKey()), stored);
    assert.equal(app.creates().length, 0);
    // The store works again: "Reintentar comprobación" reads the (still present) record and shows it.
    resetStore();
    await app.press('Reintentar comprobación');
    await app.wait(60);
    await app.toHome();
    assert.match(app.visible(), /Transferencia en verificación/);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });
});
