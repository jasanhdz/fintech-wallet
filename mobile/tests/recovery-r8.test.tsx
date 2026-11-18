import React from 'react';
import assert from 'node:assert/strict';
import TestRenderer from 'react-test-renderer';
import App from '../App';

// Round 8 · G-B (SPEC §R8.7–§R8.9, rubric R8-15..R8-20, [U] level): authoritative recovery of transfer attempts on the
// mobile client. The API is mocked here; the real API + wallet_test evidence is the RN-Web render (docs/evidence/round8).

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
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => { throw new Error('globalThis.crypto.randomUUID is used in jest'); }) }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

const USER = 'user-r8';
const LEGACY = 'wallet.transfer-recovery';
const ownKey = (id = USER) => `${LEGACY}.${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const account = { id: 'source-1', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1245000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' };
const beneficiary = { id: 'beneficiary-1', name: 'Carlos Ruiz', alias: 'Carlos', clabeMasked: '000•••••••••••0028', destinationAccountId: 'dest-1' };
const transferBody = (overrides: Record<string, unknown> = {}) => ({ id: 'tr-new', status: 'completed', sourceAccountId: 'source-1', destination: beneficiary, amountMinor: '30025', currency: 'MXN', concept: 'Comida', reference: '4401', createdAt: '2026-11-13T20:30:00.000Z', completedAt: '2026-11-13T20:31:00.000Z', receiptReference: 'R-NEW', ...overrides });
const problem = (status: number, detail: string, type?: string) => Response.json({ ...(type ? { type } : {}), title: 'Error', detail }, { status });
const VOIDED_TYPE = 'urn:billetera:problem:transfer-attempt-voided';
const REJECTED_TYPE = 'urn:billetera:problem:transfer-attempt-rejected';
const CONFLICT_TYPE = 'urn:billetera:problem:transfer-attempt-conflict';
const policy = (sendEpoch: string | null) => ({ currency: 'MXN', otpThresholdMinor: '500000', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpExpirySeconds: 300, otpMaxAttempts: 5, businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City', demoOnly: true, ...(sendEpoch === null ? {} : { sendEpoch }) });
const summary = (overrides: Record<string, unknown> = {}) => ({ attemptId: null, transferId: null, status: 'voided', amountMinor: null, currency: 'MXN', concept: null, reference: null, sourceAccountId: null, destination: null, createdAt: '2026-11-13T20:30:00.000Z', completedAt: null, closedAt: '2026-11-13T20:30:00.000Z', expiresAt: null, problem: null, ...overrides });
const page = (items: unknown[] = [], sendEpoch = '7') => Response.json({ items, nextCursor: null, sendEpoch });

const storedPayload = { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '30025', concept: 'Comida', reference: '4401' };
const STORED_KEY = 'stored-key-0001-abcd';
const STORED_ATTEMPT = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const v2 = (extra: Record<string, unknown> = {}) => JSON.stringify({ v: 2, attemptId: STORED_ATTEMPT, key: STORED_KEY, sendEpoch: '3', payload: storedPayload, userId: USER, ...extra });
// A record written by the H3–H5 build (no identity, no epoch).
const legacy = (extra: Record<string, unknown> = {}) => JSON.stringify({ key: STORED_KEY, payload: storedPayload, userId: USER, consent: { confirmedAt: '2026-11-13T20:30:00.000Z', via: 'confirm', otp: 'unknown' }, ...extra });

type Call = { url: string; init?: RequestInit };
type Handler = (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;
const headersOf = (call: Call) => (call.init?.headers as Record<string, string> | undefined) ?? {};
const isCreate = (call: Call) => call.url.endsWith('/transfers') && call.init?.method === 'POST';
const isVoid = (call: Call) => call.url.endsWith('/transfer-attempts/void') && call.init?.method === 'POST';
const isVoidAll = (call: Call) => call.url.endsWith('/transfer-attempts/void-all') && call.init?.method === 'POST';
const isList = (call: Call) => call.url.includes('/transfer-attempts?');
const NEW_TRANSFER_ENTRIES = ['Transferir dinero, elegir beneficiario', 'Continuar con transferencia', 'Cambiar beneficiario', 'Elegir otro destinatario'];
const VOID_CONFIRM = /Si ya se aplicó, te mostraremos su resultado y no se cancelará el cargo. Si no se aplicó, quedará anulada y ya no podrá aplicarse aunque llegue después./;
const VOIDED = /Transferencia anulada. No se realizó ningún cargo por esta operación./;
const DEVICE_FAILED = /No pudimos actualizar este dispositivo/;
const NO_CHARGE_CLAIM = /No se realizó ningún cargo|Tu dinero está intacto|Ningún dinero fue retirado/;

async function signIn(seed: Record<string, string>, handler: Handler, options: { restore?: boolean; sendEpoch?: string | null } = {}) {
  for (const [key, value] of Object.entries(seed)) mockSecureValues.set(key, value);
  if (options.restore) mockSecureValues.set('wallet.refresh-token', 'refresh-stored');
  const sendEpoch = options.sendEpoch === undefined ? '7' : options.sendEpoch;
  const calls: Call[] = [];
  const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const handled = await handler(url, init);
    if (handled) return handled;
    if (url.endsWith('/auth/login') || url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'access-r8', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: USER, fullName: 'Ana López', email: 'ana@example.com' } });
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    if (url.endsWith('/auth/me')) return Response.json({ id: USER, fullName: 'Ana López', email: 'ana@example.com' });
    if (url.endsWith('/accounts')) return Response.json({ items: [account] });
    if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/beneficiaries')) return Response.json({ items: [beneficiary] });
    if (url.endsWith('/transfer-policy')) return Response.json(policy(sendEpoch));
    if (isList({ url, init })) return page([], sendEpoch ?? '0');
    if (isCreate({ url, init })) return Response.json(transferBody(), { status: 201 });
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
  const wait = (ms = 40) => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  // Under load (mutation runs with parallel workers) an automatic read may still be in flight when a test taps: wait up to
  // ~2 s for the button to be rendered before asserting it is there.
  const press = async (title: string) => {
    for (let tries = 0; tries < 40 && pressables(title).length === 0; tries += 1) await wait(50);
    await TestRenderer.act(async () => { button(title).props.onPress(); });
  };
  const logIn = async () => {
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await press('Iniciar sesión');
    await wait(60);
  };
  if (options.restore) await wait(60); else await logIn();
  const creates = () => calls.filter(isCreate);
  const voids = () => calls.filter(isVoid);
  const voidAlls = () => calls.filter(isVoidAll);
  const homeOffersNewTransfer = () => NEW_TRANSFER_ENTRIES.some((entry) => pressables(entry).length > 0);
  const finish = async () => { await TestRenderer.act(async () => { renderer!.unmount(); }); delete (global as { fetch?: typeof fetch }).fetch; };
  const toHome = async () => { if (pressables('Ir al inicio (revisar saldo después)').length) { await press('Ir al inicio (revisar saldo después)'); await wait(60); } };
  const toReview = async (amount = '300.25') => {
    await press('Transferir dinero, elegir beneficiario');
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
    await press('Continuar con transferencia');
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText(amount); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('4401'); });
    await press('Continuar');
    await wait();
  };
  const transferOnce = async () => { await toReview(); await press('Confirmar transferencia'); await wait(60); };
  /** Opens a confirmation screen (resend / void) and confirms it with its own button of the same title. */
  const confirmTwice = async (title: string) => { await press(title); await wait(); await press(title); await wait(80); };
  return { renderer: renderer!, visible, pressables, button, press, wait, calls, creates, voids, voidAlls, homeOffersNewTransfer, toHome, toReview, transferOnce, confirmTwice, logIn, finish };
}
type App = Awaited<ReturnType<typeof signIn>>;
const stored = () => { const raw = mockSecureValues.get(ownKey()); return raw ? JSON.parse(raw) as Record<string, unknown> : null; };
const tabTo = async (app: App, name: string) => {
  await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityRole === 'tab' && node.findAll((child) => child.props.children === name).length > 0)[0]!.props.onPress(); });
  await app.wait(60);
};
const withAppState = async (run: (emit: (state: string) => Promise<void>) => Promise<void>) => {
  const { AppState } = jest.requireActual('react-native') as typeof import('react-native');
  const listeners: Array<(state: string) => void> = [];
  const original = AppState.addEventListener;
  AppState.addEventListener = ((_type: string, listener: (state: string) => void) => { listeners.push(listener); return { remove: () => { listeners.splice(listeners.indexOf(listener), 1); } }; }) as unknown as typeof AppState.addEventListener;
  try { await run(async (state) => { await TestRenderer.act(async () => { listeners.forEach((listener) => listener(state)); }); }); }
  finally { AppState.addEventListener = original; }
};

describe('R8-15: identity and send (§R8.4-1, §R8.7)', () => {
  it('the v2 record (attemptId, key, sendEpoch, payload, userId) is persisted BEFORE the POST, which carries the three headers with its values', async () => {
    let atSend: Record<string, unknown> | null = null;
    const app = await signIn({}, (url, init) => { if (isCreate({ url, init })) { atSend = stored(); return Response.json(transferBody(), { status: 201 }); } return undefined; });
    await app.transferOnce();
    assert.equal(app.creates().length, 1);
    const sent = headersOf(app.creates()[0]!);
    assert.ok(atSend, 'the record existed when the POST left');
    const record = atSend as unknown as Record<string, unknown>;
    assert.equal(record.v, 2);
    assert.match(String(record.attemptId), UUID);
    assert.match(String(record.key), UUID);
    assert.notEqual(record.attemptId, record.key, 'identity and key are different UUIDs');
    assert.equal(record.sendEpoch, '7', 'the epoch of GET /transfer-policy loaded for the review');
    assert.equal(record.userId, USER);
    assert.deepEqual(record.payload, JSON.parse(String(app.creates()[0]!.init?.body)));
    assert.equal(sent['Idempotency-Key'], record.key);
    assert.equal(sent['Transfer-Attempt-Id'], record.attemptId);
    assert.equal(sent['Transfer-Send-Epoch'], '7');
    assert.match(app.visible(), /"Transferencia completada"/);
    await app.finish();
  });

  it('a resend carries the three headers with the STORED values (same key, identity, epoch and body bytes)', async () => {
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isCreate({ url, init }) ? Response.json(transferBody(), { status: 201 }) : undefined));
    await app.confirmTwice('Reenviar la misma transferencia');
    assert.equal(app.creates().length, 1);
    const sent = headersOf(app.creates()[0]!);
    assert.deepEqual([sent['Idempotency-Key'], sent['Transfer-Attempt-Id'], sent['Transfer-Send-Epoch']], [STORED_KEY, STORED_ATTEMPT, '3']);
    assert.equal(String(app.creates()[0]!.init?.body), JSON.stringify(storedPayload));
    await app.finish();
  });

  for (const [label, epoch] of [['missing', null], ['malformed', '01'], ['negative', '-1']] as const) {
    it(`a policy whose sendEpoch is ${label} sends NOTHING (fail closed): 0 POST, no record, a clear message`, async () => {
      const app = await signIn({}, () => undefined, { sendEpoch: epoch });
      await app.transferOnce();
      assert.equal(app.creates().length, 0);
      assert.equal(mockSecureValues.get(ownKey()), undefined, 'no record either');
      assert.match(app.visible(), /No pudimos preparar el envío con seguridad: falta la información de envío del servidor. No enviamos nada/);
      await app.finish();
    });
  }

  for (const variant of ['without transferId', 'with transferId'] as const) {
    it(`start-up, foreground x3, sign-in, Home and "Verificar" send 0 POST /transfers, 0 void and 0 void-all (${variant})`, async () => {
      await withAppState(async (emit) => {
        const seed = variant === 'with transferId' ? v2({ transferId: 'tr-proc', status: 'processing' }) : v2();
        const app = await signIn({ [ownKey()]: seed }, (url) => (url.endsWith('/transfers/tr-proc') ? Response.json(transferBody({ id: 'tr-proc', status: 'processing', completedAt: undefined })) : undefined), { restore: true });
        await app.toHome();
        for (let cycle = 0; cycle < 3; cycle += 1) { await emit('background'); await emit('active'); await app.wait(60); }
        assert.ok(app.calls.some((call) => call.url.endsWith('/auth/me')), 'the foreground re-check ran');
        await tabTo(app, 'Movimientos');
        await tabTo(app, 'Inicio');
        await app.press('Verificar estado de la transferencia');
        await app.wait(60);
        await app.toHome();
        await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });
        await app.wait(60);
        await app.logIn();
        await app.toHome();
        assert.equal(app.creates().length, 0, '0 POST /transfers');
        assert.equal(app.voids().length, 0, '0 void');
        assert.equal(app.voidAlls().length, 0, '0 void-all');
        assert.equal(mockSecureValues.get(ownKey()), seed, 'the record is untouched');
        await app.finish();
      });
    });
  }

  it('"Verificar" of an attempt without transferId only does GET /transfer-attempts?attemptId=<its id>&limit=1', async () => {
    const app = await signIn({ [ownKey()]: v2() }, () => undefined);
    const before = app.calls.length;
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    const made = app.calls.slice(before);
    assert.ok(made.length > 0);
    assert.ok(made.every((call) => (call.init?.method ?? 'GET') === 'GET'), 'reads only');
    assert.ok(made.some((call) => call.url.endsWith(`/transfer-attempts?attemptId=${STORED_ATTEMPT}&limit=1`)));
    assert.ok(!made.some((call) => /\/transfers\//.test(call.url)), 'there is no transfer id to read');
    assert.match(app.visible(), /El servidor aún no registra esta operación/);
    assert.ok(app.pressables('Anular esta transferencia').length > 0);
    assert.ok(app.pressables('Reenviar la misma transferencia').length > 0);
    await app.finish();
  });

  it('a listed item with a transfer id is stored and that transfer is read (GET): completed -> receipt and release', async () => {
    const app = await signIn({ [ownKey()]: v2() }, (url) => {
      if (url.includes(`/transfer-attempts?attemptId=${STORED_ATTEMPT}`)) return page([summary({ attemptId: STORED_ATTEMPT, transferId: 'tr-found', status: 'completed', amountMinor: '30025', closedAt: null })]);
      if (url.endsWith('/transfers/tr-found')) return Response.json(transferBody({ id: 'tr-found', receiptReference: 'R-FOUND' }));
      return undefined;
    });
    await app.wait(60);
    assert.match(app.visible(), /R-FOUND/);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    assert.equal(app.creates().length, 0);
    await app.finish();
  });
});

describe('R8-16: release rules (§R8.7) — only a terminal result decided by the server, then deletion + re-read null', () => {
  for (const status of ['completed', 'expired', 'cancelled'] as const) {
    it(`GET /transfers/{id} -> ${status}: released, the flow is offered again`, async () => {
      const app = await signIn({ [ownKey()]: v2({ transferId: 'tr-x', status: 'awaiting_confirmation' }) }, (url) => (url.endsWith('/transfers/tr-x') ? Response.json(transferBody({ id: 'tr-x', status, completedAt: status === 'completed' ? '2026-11-13T20:31:00.000Z' : undefined })) : undefined));
      await app.wait(60);
      assert.equal(mockSecureValues.get(ownKey()), undefined);
      await app.press(status === 'completed' ? 'Ir al inicio' : 'Volver al inicio');
      await app.wait(60);
      assert.ok(app.homeOffersNewTransfer());
      await app.finish();
    });
  }

  it('POST answered 409 transfer-attempt-voided: released and "Transferencia anulada. No se realizó ningún cargo…"', async () => {
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isCreate({ url, init }) ? problem(409, 'La transferencia fue anulada.', VOIDED_TYPE) : undefined));
    await app.confirmTwice('Reenviar la misma transferencia');
    assert.equal(app.creates().length, 1);
    assert.match(app.visible(), VOIDED);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });

  for (const status of [404, 422, 429] as const) {
    it(`POST answered ${status} transfer-attempt-rejected: ONE POST, M11, released`, async () => {
      const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isCreate({ url, init }) ? problem(status, status === 429 ? 'Se excedió el límite diario.' : status === 404 ? 'Beneficiario no encontrado.' : 'Saldo insuficiente.', REJECTED_TYPE) : undefined));
      await app.confirmTwice('Reenviar la misma transferencia');
      assert.equal(app.creates().length, 1, 'one tap = one POST');
      assert.match(app.visible(), /No se pudo completar la transferencia/);
      assert.equal(mockSecureValues.get(ownKey()), undefined);
      await app.finish();
    });
  }

  const NOT_RELEASING: Array<[string, () => Response]> = [
    ['422 without type', () => problem(422, 'Saldo insuficiente.')],
    ['429 without type (daily limit text)', () => problem(429, 'Se excedió el límite diario.')],
    ['429 rate limit', () => problem(429, 'Demasiadas solicitudes.')],
    ['409 "en curso"', () => problem(409, 'La solicitud idempotente está en curso; reintenta con la misma llave.')],
    ['409 transfer-attempt-conflict', () => problem(409, 'La identidad del intento no coincide.', CONFLICT_TYPE)],
    ['404 without type', () => problem(404, 'Beneficiario no encontrado.')],
    ['400', () => problem(400, 'Cabeceras inválidas.')],
    ['500', () => problem(500, 'Ocurrió un error interno.')],
    ['no answer', () => { throw new TypeError('Network request failed'); }],
  ];
  for (const [label, answer] of NOT_RELEASING) {
    it(`POST answered ${label}: ONE POST, M09, the record byte-identical, no "no charge" claim, Home still blocked`, async () => {
      const seed = v2();
      const app = await signIn({ [ownKey()]: seed }, (url, init) => (isCreate({ url, init }) ? answer() : undefined));
      await app.confirmTwice('Reenviar la misma transferencia');
      assert.equal(app.creates().length, 1);
      assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
      assert.doesNotMatch(app.visible(), NO_CHARGE_CLAIM);
      assert.equal(mockSecureValues.get(ownKey()), seed);
      if (label.includes('conflict')) {
        assert.match(app.visible(), /la identidad de esta operación no coincide/);
        assert.ok(app.pressables('Resolver con el servidor').length > 0, 'its way out is "Resolver con el servidor"');
        assert.equal(app.pressables('Reenviar la misma transferencia').length, 0);
      }
      await app.toHome();
      assert.ok(!app.homeOffersNewTransfer());
      assert.equal(mockSecureValues.get(ownKey()), seed);
      assert.equal(store().deleteItemAsync.mock.calls.filter(([key]) => String(key).startsWith(LEGACY)).length, 0, 'no deletion was even attempted');
      await app.finish();
    });
  }

  it('GET /transfers/{id} answered 404 never releases (start-up, Home and M09)', async () => {
    const seed = v2({ transferId: 'tr-gone' });
    const app = await signIn({ [ownKey()]: seed }, (url) => (url.endsWith('/transfers/tr-gone') ? problem(404, 'Transferencia no encontrada.') : undefined));
    await app.toHome();
    await tabTo(app, 'Movimientos');
    await tabTo(app, 'Inicio');
    assert.ok(app.calls.filter((call) => call.url.endsWith('/transfers/tr-gone')).length >= 2);
    assert.equal(mockSecureValues.get(ownKey()), seed);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(store().deleteItemAsync.mock.calls.filter(([key]) => String(key).startsWith(LEGACY)).length, 0);
    await app.finish();
  });

  it('a void answered 200 voided releases; the confirmation screen shows the mandatory text and only its own tap sends the void', async () => {
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isVoid({ url, init }) ? Response.json({ resolution: 'voided', attempt: summary({ attemptId: STORED_ATTEMPT }) }) : undefined));
    await app.press('Anular esta transferencia');
    await app.wait();
    assert.match(app.visible(), VOID_CONFIRM);
    assert.equal(app.voids().length, 0, 'opening the confirmation sends nothing');
    await app.press('Anular esta transferencia');
    await app.wait(80);
    assert.equal(app.voids().length, 1);
    assert.deepEqual(JSON.parse(String(app.voids()[0]!.init?.body)), { idempotencyKey: STORED_KEY, attemptId: STORED_ATTEMPT });
    assert.equal(app.voids()[0]!.init?.headers && (app.voids()[0]!.init?.headers as Record<string, string>).Authorization, 'Bearer access-r8');
    assert.match(app.visible(), VOIDED);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });

  it('"Volver sin anular" sends nothing and keeps everything', async () => {
    const seed = v2();
    const app = await signIn({ [ownKey()]: seed }, () => undefined);
    await app.press('Anular esta transferencia');
    await app.wait();
    await app.press('Volver sin anular');
    await app.wait(60);
    assert.equal(app.voids().length, 0);
    assert.equal(mockSecureValues.get(ownKey()), seed);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });

  it('a void answered 200 transfer_found (already applied) releases and shows that transfer: receipt, never "no charge"', async () => {
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => {
      if (isVoid({ url, init })) return Response.json({ resolution: 'transfer_found', attempt: summary({ attemptId: STORED_ATTEMPT, transferId: 'tr-applied', status: 'completed', amountMinor: '30025', closedAt: null }) });
      if (url.endsWith('/transfers/tr-applied')) return Response.json(transferBody({ id: 'tr-applied', receiptReference: 'R-APPLIED' }));
      return undefined;
    });
    await app.confirmTwice('Anular esta transferencia');
    assert.match(app.visible(), /"Transferencia completada"/);
    assert.match(app.visible(), /R-APPLIED/);
    assert.doesNotMatch(app.visible(), NO_CHARGE_CLAIM);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });

  it('a void answered 200 rejected releases and says why (typed rejection: no charge)', async () => {
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isVoid({ url, init }) ? Response.json({ resolution: 'rejected', attempt: summary({ attemptId: STORED_ATTEMPT, status: 'rejected', amountMinor: '30025', problem: { status: 422, detail: 'Saldo insuficiente.' } }) }) : undefined));
    await app.confirmTwice('Anular esta transferencia');
    assert.match(app.visible(), /El servidor ya había rechazado esta transferencia: Saldo insuficiente\.\. No se realizó ningún cargo|El servidor ya había rechazado esta transferencia: Saldo insuficiente/);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });

  for (const [label, answer] of [
    ['409 transfer-attempt-conflict', () => problem(409, 'La identidad del intento no coincide.', CONFLICT_TYPE)],
    ['500', () => problem(500, 'Ocurrió un error interno.')],
    ['no answer', () => { throw new TypeError('Network request failed'); }],
  ] as Array<[string, () => Response]>) {
    it(`a void answered ${label} does not release`, async () => {
      const seed = v2();
      const app = await signIn({ [ownKey()]: seed }, (url, init) => (isVoid({ url, init }) ? answer() : undefined));
      await app.confirmTwice('Anular esta transferencia');
      assert.equal(app.voids().length, 1);
      assert.equal(mockSecureValues.get(ownKey()), seed);
      assert.doesNotMatch(app.visible(), VOIDED);
      await app.toHome();
      if (app.pressables('Volver sin anular').length) { await app.press('Volver sin anular'); await app.wait(60); }
      assert.ok(!app.homeOffersNewTransfer());
      await app.finish();
    });
  }

  it('release needs the deletion to succeed: a failing delete keeps the block, shows the known result + "No pudimos actualizar este dispositivo" + "Reintentar"', async () => {
    let failDelete = true;
    store().deleteItemAsync.mockImplementation((key: string) => { if (failDelete && key.startsWith(LEGACY)) return Promise.reject(new Error('keychain busy')); mockSecureValues.delete(key); return Promise.resolve(); });
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isVoid({ url, init }) ? Response.json({ resolution: 'voided', attempt: summary({ attemptId: STORED_ATTEMPT }) }) : undefined));
    await app.confirmTwice('Anular esta transferencia');
    assert.match(app.visible(), VOIDED, 'the known result is shown');
    assert.match(app.visible(), DEVICE_FAILED);
    assert.ok(mockSecureValues.get(ownKey()));
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer(), 'still blocked');
    assert.match(app.visible(), DEVICE_FAILED);
    failDelete = false;
    await app.press('Reintentar');
    await app.wait(60);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    assert.ok(app.homeOffersNewTransfer(), 'released after the verified deletion');
    await app.finish();
  });

  it('release needs deleteItemAsync WITHOUT error: a delete that removes the value but reports an error keeps the block', async () => {
    store().deleteItemAsync.mockImplementation((key: string) => { mockSecureValues.delete(key); return key.startsWith(LEGACY) ? Promise.reject(new Error('keychain reported a failure')) : Promise.resolve(); });
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isVoid({ url, init }) ? Response.json({ resolution: 'voided', attempt: summary({ attemptId: STORED_ATTEMPT }) }) : undefined));
    await app.confirmTwice('Anular esta transferencia');
    assert.match(app.visible(), VOIDED);
    assert.match(app.visible(), DEVICE_FAILED);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer(), 'an error from the deletion is not a verified release');
    await app.finish();
  });

  it('release needs the re-read to return null: a delete that "succeeds" but leaves the record keeps the block', async () => {
    store().deleteItemAsync.mockImplementation(() => Promise.resolve());
    const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isCreate({ url, init }) ? problem(409, 'La transferencia fue anulada.', VOIDED_TYPE) : undefined));
    await app.confirmTwice('Reenviar la misma transferencia');
    assert.match(app.visible(), VOIDED);
    assert.match(app.visible(), DEVICE_FAILED);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });

  it('"Cancelar y volver a revisar" (confirmed cancel) still releases the record (H3–H5 rule kept)', async () => {
    const pending = transferBody({ id: 'tr-otp', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
    const app = await signIn({}, (url, init) => {
      if (isCreate({ url, init })) return Response.json({ ...pending, demoOnlyCode: '000000' }, { status: 202 });
      if (url.endsWith('/transfers/tr-otp/cancel')) return Response.json({ ...pending, status: 'cancelled' });
      return undefined;
    });
    await app.toReview('6000.00');
    await app.press('Continuar a verificación');
    await app.wait(60);
    assert.ok(mockSecureValues.get(ownKey()));
    await app.press('Cancelar y volver a revisar');
    await app.wait(60);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });
});

describe('R8-17: old, ownerless, damaged and unreadable records (§R8.8)', () => {
  it('a record without attemptId gets a NEW identity and legacy:true; key and payload bytes are kept; it is explained and voided by its key', async () => {
    const seed = legacy();
    const payloadBytes = JSON.stringify(JSON.parse(seed).payload);
    const app = await signIn({ [ownKey()]: seed }, (url, init) => (isVoid({ url, init }) ? Response.json({ resolution: 'voided', attempt: summary() }) : undefined));
    const upgraded = stored()!;
    assert.match(String(upgraded.attemptId), UUID);
    assert.equal(upgraded.legacy, true);
    assert.equal(upgraded.v, 2);
    assert.equal(upgraded.key, STORED_KEY);
    assert.equal(JSON.stringify(upgraded.payload), payloadBytes);
    assert.equal(upgraded.sendEpoch, undefined, 'no epoch until a resend reads the policy');
    assert.match(app.visible(), /Una versión anterior de la app no registró esta operación por número/);
    await app.confirmTwice('Anular esta transferencia');
    assert.deepEqual(JSON.parse(String(app.voids()[0]!.init?.body)), { idempotencyKey: STORED_KEY }, 'voided by its key (its first send carried no identity)');
    assert.match(app.visible(), VOIDED);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });

  it('a record without attemptId: the resend first reads the policy and PERSISTS its epoch, then sends key, new identity, epoch and the same body', async () => {
    let atSend: Record<string, unknown> | null = null;
    const app = await signIn({ [ownKey()]: legacy() }, (url, init) => { if (isCreate({ url, init })) { atSend = stored(); return Response.json(transferBody(), { status: 201 }); } return undefined; });
    const identity = stored()!.attemptId;
    await app.confirmTwice('Reenviar la misma transferencia');
    assert.equal(app.creates().length, 1);
    assert.equal((atSend as unknown as Record<string, unknown>).sendEpoch, '7', 'the epoch was stored before the POST');
    const sent = headersOf(app.creates()[0]!);
    assert.deepEqual([sent['Idempotency-Key'], sent['Transfer-Attempt-Id'], sent['Transfer-Send-Epoch']], [STORED_KEY, identity, '7']);
    assert.equal(String(app.creates()[0]!.init?.body), JSON.stringify(storedPayload));
    assert.match(app.visible(), /"Transferencia completada"/);
    await app.finish();
  });

  it('a record without attemptId whose policy read fails is not re-sent', async () => {
    const seed = legacy();
    const app = await signIn({ [ownKey()]: seed }, (url) => (url.endsWith('/transfer-policy') ? problem(500, 'Ocurrió un error interno.') : undefined));
    await app.confirmTwice('Reenviar la misma transferencia');
    assert.equal(app.creates().length, 0);
    assert.equal(stored()!.sendEpoch, undefined);
    await app.finish();
  });

  it('a record without userId (legacy slot) moves to the user signing in, says so, and is voided only in that user\'s scope', async () => {
    const seed = JSON.stringify({ key: STORED_KEY, payload: storedPayload });
    const app = await signIn({ [LEGACY]: seed }, (url, init) => (isVoid({ url, init }) ? Response.json({ resolution: 'voided', attempt: summary() }) : undefined));
    assert.equal(mockSecureValues.get(LEGACY), undefined);
    const moved = stored()!;
    assert.equal(moved.userId, USER);
    assert.equal(moved.ownerAssumed, true);
    assert.equal(moved.key, STORED_KEY);
    assert.match(app.visible(), /se guardó sin indicar a qué usuario pertenecía/);
    await app.confirmTwice('Anular esta transferencia');
    assert.equal((app.voids()[0]!.init?.headers as Record<string, string>).Authorization, 'Bearer access-r8', 'with the token of the user signed in');
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });

  it('a record in this user\'s key with another user\'s id is resolved as damaged (never sent)', async () => {
    const app = await signIn({ [ownKey()]: v2({ userId: 'someone-else' }) }, () => undefined);
    assert.match(app.visible(), /No pudimos recuperar los datos de una transferencia en verificación/);
    assert.equal(app.pressables('Reenviar la misma transferencia').length, 0);
    assert.ok(app.pressables('Resolver con el servidor').length > 0);
    await app.finish();
  });

  const resolveHandler = (overrides: { list?: () => Response; voidAll?: () => Response; afterList?: () => Response } = {}) => {
    let lists = 0;
    return (url: string, init?: RequestInit) => {
      if (url.endsWith('/transfer-attempts?limit=20')) { lists += 1; return lists === 1 ? (overrides.list?.() ?? page([summary({ attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', transferId: 'tr-a', status: 'completed', amountMinor: '30025', reference: '4401', closedAt: null })], '7')) : (overrides.afterList?.() ?? page([summary({ status: 'completed', transferId: 'tr-a', amountMinor: '30025', closedAt: null })], '8')); }
      if (isVoidAll({ url, init })) return overrides.voidAll?.() ?? Response.json({ sendEpoch: '8', advanced: true, closedTransferIds: [] });
      return undefined;
    };
  };

  it('a damaged record unblocks ONLY after "Resolver con el servidor" -> list -> explicit void-all (fromEpoch of the list) -> list -> verified deletion', async () => {
    const damaged = '{"key":"stored-key-0001-abcd","payl';
    const app = await signIn({ [ownKey()]: damaged }, resolveHandler());
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(app.voidAlls().length, 0, 'never automatic');
    await app.press('Resolver con el servidor');
    await app.wait(60);
    const screen = app.visible();
    assert.match(screen, /también se detienen las transferencias aún no aplicadas enviadas desde otros dispositivos y se cancelan las pendientes de código/);
    assert.match(screen, /Completada · Ref 4401/);
    assert.equal(app.voidAlls().length, 0, 'opening it only lists');
    assert.equal(mockSecureValues.get(ownKey()), damaged);
    await app.press('Anular pendientes y desbloquear');
    await app.wait(80);
    assert.equal(app.voidAlls().length, 1);
    assert.deepEqual(JSON.parse(String(app.voidAlls()[0]!.init?.body)), { fromEpoch: '7' });
    const lists = app.calls.filter((call) => call.url.endsWith('/transfer-attempts?limit=20'));
    assert.equal(lists.length, 2, 'listed before and after');
    assert.ok(app.calls.indexOf(lists[1]!) > app.calls.indexOf(app.voidAlls()[0]!));
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    assert.match(app.visible(), /este dispositivo quedó desbloqueado/);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });

  it('"Volver sin anular" from "Resolver con el servidor" sends no void-all and keeps the block', async () => {
    const damaged = 'not json';
    const app = await signIn({ [ownKey()]: damaged }, resolveHandler());
    await app.press('Resolver con el servidor');
    await app.wait(60);
    await app.press('Volver sin anular');
    await app.wait(60);
    assert.equal(app.voidAlls().length, 0);
    assert.equal(mockSecureValues.get(ownKey()), damaged);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });

  for (const [label, handler] of [
    ['the first list fails (no void-all can be sent)', resolveHandler({ list: () => problem(500, 'Ocurrió un error interno.') })],
    ['void-all fails', resolveHandler({ voidAll: () => problem(500, 'Ocurrió un error interno.') })],
    ['void-all answers 200 but the list read after it fails', resolveHandler({ afterList: () => problem(503, 'No disponible.') })],
  ] as const) {
    it(`a damaged record stays blocked when ${label}`, async () => {
      const damaged = 'not json';
      const app = await signIn({ [ownKey()]: damaged }, handler);
      await app.press('Resolver con el servidor');
      await app.wait(60);
      if (app.pressables('Anular pendientes y desbloquear').length) { await app.press('Anular pendientes y desbloquear'); await app.wait(80); }
      assert.equal(mockSecureValues.get(ownKey()), damaged);
      assert.equal(store().deleteItemAsync.mock.calls.filter(([key]) => String(key).startsWith(LEGACY)).length, 0);
      await app.finish();
    });
  }

  it('after void-all 200, a failed list read is retried WITHOUT a second void-all and then unblocks', async () => {
    let afterFails = true;
    const damaged = 'not json';
    const app = await signIn({ [ownKey()]: damaged }, resolveHandler({ afterList: () => (afterFails ? problem(503, 'No disponible.') : page([], '8')) }));
    await app.press('Resolver con el servidor');
    await app.wait(60);
    await app.press('Anular pendientes y desbloquear');
    await app.wait(80);
    assert.equal(mockSecureValues.get(ownKey()), damaged);
    afterFails = false;
    await app.press('Reintentar');
    await app.wait(80);
    assert.equal(app.voidAlls().length, 1);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });

  it('an unreadable store: "Reintentar lectura" and "Resolver con el servidor"; if the store still cannot be read after void-all the device stays blocked and explains it (D6)', async () => {
    store().getItemAsync.mockImplementation((key: string) => (key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : Promise.resolve(mockSecureValues.get(key) ?? null)));
    const app = await signIn({}, resolveHandler());
    assert.match(app.visible(), /No pudimos comprobar tus transferencias/);
    assert.ok(app.pressables('Reintentar lectura').length > 0);
    await app.press('Resolver con el servidor');
    await app.wait(60);
    await app.press('Anular pendientes y desbloquear');
    await app.wait(80);
    assert.equal(app.voidAlls().length, 1);
    assert.match(app.visible(), DEVICE_FAILED);
    assert.match(app.visible(), /puedes usar la web/);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });

  it('an unreadable store that can be deleted and re-read after void-all unblocks', async () => {
    let unreadable = true;
    store().getItemAsync.mockImplementation((key: string) => (unreadable && key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : Promise.resolve(mockSecureValues.get(key) ?? null)));
    store().deleteItemAsync.mockImplementation((key: string) => { unreadable = false; mockSecureValues.delete(key); return Promise.resolve(); });
    const app = await signIn({}, resolveHandler());
    await app.press('Resolver con el servidor');
    await app.wait(60);
    await app.press('Anular pendientes y desbloquear');
    await app.wait(80);
    assert.match(app.visible(), /este dispositivo quedó desbloqueado/);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });

  it('a GET 404 of a stored transferId: no "Verificar de nuevo"; Anular, Reenviar and Ver movimientos; "Anular" resolves it', async () => {
    const app = await signIn({ [ownKey()]: v2({ transferId: 'tr-gone' }) }, (url, init) => {
      if (url.endsWith('/transfers/tr-gone')) return problem(404, 'Transferencia no encontrada.');
      if (isVoid({ url, init })) return Response.json({ resolution: 'voided', attempt: summary({ attemptId: STORED_ATTEMPT }) });
      return undefined;
    });
    await app.toHome();
    assert.match(app.visible(), /El servidor no encuentra esta operación/);
    assert.equal(app.pressables('Verificar de nuevo').length, 0);
    assert.equal(app.pressables('Verificar estado de la transferencia').length, 0);
    for (const action of ['Anular esta transferencia', 'Reenviar la misma transferencia', 'Ver movimientos']) assert.ok(app.pressables(action).length > 0, action);
    await app.confirmTwice('Anular esta transferencia');
    assert.match(app.visible(), VOIDED);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });

  it('an identity the list shows closed (voided) is NOT released by the read; "Anular" confirms it', async () => {
    const seed = v2();
    const app = await signIn({ [ownKey()]: seed }, (url, init) => {
      if (url.includes(`/transfer-attempts?attemptId=${STORED_ATTEMPT}`)) return page([summary({ attemptId: STORED_ATTEMPT })]);
      if (isVoid({ url, init })) return Response.json({ resolution: 'voided', attempt: summary({ attemptId: STORED_ATTEMPT }) });
      return undefined;
    });
    await app.wait(60);
    assert.match(app.visible(), /El servidor registró esta operación como anulada/);
    assert.equal(mockSecureValues.get(ownKey()), seed);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(app.pressables('Reenviar la misma transferencia').length, 0);
    await app.confirmTwice('Anular esta transferencia');
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });
});

describe('R8-18 (F-29): the resend is checked against the stored record at the tap', () => {
  it('record DELETED between opening the resend review and the tap: 0 POST, Home free', async () => {
    const app = await signIn({ [ownKey()]: v2() }, () => undefined);
    await app.press('Reenviar la misma transferencia');
    await app.wait();
    mockSecureValues.delete(ownKey());
    await app.press('Reenviar la misma transferencia');
    await app.wait(60);
    assert.equal(app.creates().length, 0);
    assert.doesNotMatch(app.visible(), /Reenviar la misma transferencia/);
    assert.ok(app.homeOffersNewTransfer(), 'nothing is stored: Home is free');
    await app.finish();
  });

  it('record REPLACED (another key) between opening the resend review and the tap: 0 POST, Home shows the other attempt', async () => {
    const app = await signIn({ [ownKey()]: v2() }, () => undefined);
    await app.press('Reenviar la misma transferencia');
    await app.wait();
    const other = JSON.stringify({ v: 2, attemptId: '0b8f4d1e-2c3a-4b5d-9e6f-7a8b9c0d1e2f', key: 'other-key-0002-wxyz', sendEpoch: '3', payload: { ...storedPayload, amountMinor: '77700', reference: '9911' }, userId: USER });
    mockSecureValues.set(ownKey(), other);
    await app.press('Reenviar la misma transferencia');
    await app.wait(60);
    assert.equal(app.creates().length, 0);
    assert.match(app.visible(), /Transferencia en verificación/);
    assert.match(app.visible(), /"\$777.00 MXN"/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(mockSecureValues.get(ownKey()), other);
    await app.finish();
  });
});

describe('R8-19: one tap = one POST (§R8.9)', () => {
  for (const status of [422, 429] as const) {
    it(`a resend answered a typed ${status}: exactly 1 POST, M11, record released`, async () => {
      const app = await signIn({ [ownKey()]: v2() }, (url, init) => (isCreate({ url, init }) ? problem(status, status === 422 ? 'Saldo insuficiente.' : 'Se excedió el límite diario.', REJECTED_TYPE) : undefined));
      await app.confirmTwice('Reenviar la misma transferencia');
      assert.equal(app.creates().length, 1);
      assert.match(app.visible(), /Tu dinero está intacto/);
      assert.equal(mockSecureValues.get(ownKey()), undefined);
      await app.finish();
    });
  }

  it('a resend answered an untyped 422: exactly 1 POST, M09, record intact', async () => {
    const seed = v2();
    const app = await signIn({ [ownKey()]: seed }, (url, init) => (isCreate({ url, init }) ? problem(422, 'Saldo insuficiente.') : undefined));
    await app.confirmTwice('Reenviar la misma transferencia');
    assert.equal(app.creates().length, 1);
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
    assert.equal(mockSecureValues.get(ownKey()), seed);
    await app.finish();
  });
});

describe('R8-20 (F-30): texts and spacing', () => {
  const FORBIDDEN = /No la envíes de nuevo|No intentes enviar el dinero nuevamente|Podrás hacer otra transferencia cuando conozcamos su resultado/;
  it('M09 and Home name the safe ways out and never say the retired sentences', async () => {
    const app = await signIn({}, (url, init) => (isCreate({ url, init }) ? (() => { throw new TypeError('Network request failed'); })() : undefined));
    await app.transferOnce();
    let screen = app.visible();
    assert.doesNotMatch(screen, FORBIDDEN);
    assert.match(screen, /No hagas otra transferencia igual/);
    assert.match(screen, /Las salidas seguras son Verificar, Reenviar la misma transferencia \(misma clave\) y Anular esta transferencia/);
    await app.toHome();
    screen = app.visible();
    assert.doesNotMatch(screen, FORBIDDEN);
    assert.match(screen, /No hagas otra transferencia igual: las salidas seguras son «Verificar estado» \(sólo consulta\), «Reenviar la misma transferencia» \(misma clave: nunca cobra dos veces\) y «Anular esta transferencia»\. Podrás hacer otra transferencia cuando esta quede resuelta\./);
    await app.finish();
  });

  it('after a GET 404 on M09 there is no "Verificar de nuevo" button', async () => {
    let reads = 0;
    const app = await signIn({ [ownKey()]: v2({ transferId: 'tr-gone' }) }, (url) => {
      if (url.endsWith('/transfers/tr-gone')) { reads += 1; if (reads === 1) throw new TypeError('Network request failed'); return problem(404, 'Transferencia no encontrada.'); }
      return undefined;
    });
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    assert.match(app.visible(), /El servidor no encuentra esta operación/);
    assert.equal(app.pressables('Verificar de nuevo').length, 0);
    assert.equal(app.pressables('Verificar estado de la transferencia').length, 0);
    assert.ok(app.pressables('Anular esta transferencia').length > 0);
    await app.finish();
  });

  it('the resend review keeps >= 12 px between the consent box and the main button (style; measured in the RN-Web render)', async () => {
    const app = await signIn({ [ownKey()]: v2() }, () => undefined);
    await app.press('Reenviar la misma transferencia');
    await app.wait();
    const consent = app.renderer.root.findByProps({ testID: 'resend-consent' });
    const flat = ([] as unknown[]).concat(consent.props.style).flat(Infinity).filter(Boolean) as Array<Record<string, number>>;
    const marginBottom = Math.max(...flat.map((style) => style.marginBottom ?? 0));
    assert.ok(marginBottom >= 12, `consent box margin ${marginBottom}`);
    await app.finish();
  });
});
