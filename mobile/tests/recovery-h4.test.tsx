import React from 'react';
import assert from 'node:assert/strict';
import { AppState } from 'react-native';
import TestRenderer from 'react-test-renderer';
import App from '../App';

// Round 7 · H4 (pass 9): F-26 (safe way out of a record that never resolves), F-21 residual (an unverified 4xx on a retry
// keeps the record), F-27 (no creating POST without a tap) and F-28 (guard coverage).

jest.mock('../App', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
  return jest.requireActual('../App');
});

// Round 8 (contract 0.4.0): TransferPolicy carries sendEpoch (the app sends nothing without it) and an attempt without a
// transfer id is looked up, read only, in GET /transfer-attempts?attemptId=. Fallbacks used by the mocks below.
const R8_POLICY = { currency: 'MXN', businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpThresholdMinor: '500000', otpExpirySeconds: 300, otpMaxAttempts: 5, demoOnly: true, sendEpoch: '0' };
function round8Default(url: string): Response | undefined {
  if (url.endsWith('/transfer-policy')) return Response.json(R8_POLICY);
  if (url.includes('/transfer-attempts?')) return Response.json({ items: [], nextCursor: null, sendEpoch: '0' });
  return undefined;
}

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
const LEGACY = 'wallet.transfer-recovery';
const ownKey = (id = USER) => `${LEGACY}.${id}`;
const account = { id: 'source-1', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1245000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' };
const beneficiary = { id: 'beneficiary-1', name: 'Carlos Ruiz', alias: 'Carlos', clabeMasked: '000•••••••••••0028', destinationAccountId: 'dest-1' };
const storedPayload = { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '30025', concept: 'Comida', reference: '4401' };
const STORED_KEY = 'stored-key-0001-abcd';
// Round 8 (§R8.7): fixtures are records written by the current build (v2: identity, key, epoch, payload, owner). A record
// without identity (H3-H5 build) is upgraded on read (§R8.8) and is covered by tests/recovery-r8.test.tsx.
const STORED_ATTEMPT = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const record = (extra: Record<string, unknown> = {}) => JSON.stringify({ v: 2, attemptId: STORED_ATTEMPT, key: STORED_KEY, sendEpoch: '0', payload: storedPayload, userId: USER, ...extra });
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
    if (url.endsWith('/transfer-policy')) return Response.json({ currency: 'MXN', otpThresholdMinor: '500000', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpExpirySeconds: 300, otpMaxAttempts: 5, sendEpoch: '0', businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City' });
    // A NEW attempt (any key other than the stored one) completes; GET of its id answers the same.
    if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json(transferBody(), { status: 201 });
    if (url.endsWith('/transfers/tr-new')) return Response.json(transferBody());
    { const r8 = round8Default(url); if (r8) return r8; }
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
  const homeOffersNewTransfer = () => ['Transferir dinero, elegir beneficiario', 'Continuar con transferencia', 'Cambiar beneficiario', 'Elegir otro destinatario'].some((entry) => pressables(entry).length > 0);
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
  // H5 (F-26): retired — a 404 of GET /transfers/{id} no longer releases the record nor says "Ya puedes hacer otra
  // transferencia" (it cannot prove that nothing was charged). Replaced by tests/recovery-h5.test.tsx "H5 · 4 (F-26)".

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
      // H5: the replay is the explicit resend (reviewed, then confirmed).
      await app.press('Reenviar la misma transferencia'); await app.press('Reenviar la misma transferencia'); await app.wait(60);
      await app.toHome();
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.ok(!app.homeOffersNewTransfer());
      assert.ok(app.creates().every((call) => keyOf(call) === STORED_KEY));
      await app.finish();
    });
  }

  // H5 (F-26): retired — a 404 to the create of a stored attempt no longer releases it (only 422 / 429 "límite diario"
  // do). Replaced by tests/recovery-h5.test.tsx (legacy record, explicit resend answered 404).
});

describe('H4 · F-26 (b)/(c)/(d): an attempt waiting for its code', () => {
  // H5 (F-26): retired — the explicit discard ("Descartar este intento" and its dialog) no longer exists. The damaged
  // record, the guard that finds it and the dialog-cancel tests are replaced by tests/recovery-h5.test.tsx "H5 · 4".

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

  // H5 (F-26): retired — replaced by tests/recovery-h5.test.tsx (unreadable store: blocked, "Reintentar lectura" unblocks
  // only once the store can be read again; nothing is ever deleted).
});

describe('H4 · F-21 residual: an unverified 4xx never opens a path to a second attempt', () => {
  const lostThen = (second: () => Response) => {
    let sends = 0;
    return (url: string, init?: RequestInit) => {
      if (!(url.endsWith('/transfers') && init?.method === 'POST')) return undefined;
      sends += 1;
      if (sends === 1) throw new TypeError('response lost after the server applied it');
      return second();
    };
  };
  const retryAnswers: Array<[string, () => Response]> = [
    ['409 "en curso"', () => problem(409, 'La solicitud idempotente está en curso; reintenta con la misma llave.')],
    ['401', () => problem(401, 'Unauthorized')],
    ['403', () => problem(403, 'Forbidden')],
    ['429 rate limit', () => problem(429, 'Demasiadas solicitudes.')],
    ['400 (validated before the key lookup)', () => problem(400, 'Datos de transferencia inválidos.')],
  ];
  for (const [label, answer] of retryAnswers) {
    it(`retrying an uncertain attempt that answers ${label} keeps it uncertain on M09 (not M11), keeps the record and Home offers no second attempt`, async () => {
      const app = await signIn({}, lostThen(answer));
      await app.transferOnce();
      assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
      const stored = mockSecureValues.get(ownKey());
      assert.ok(stored);
      // H5: the retry of the same attempt is the explicit resend (reviewed, then confirmed).
      await app.press('Reenviar la misma transferencia');
      await app.press('Reenviar la misma transferencia');
      await app.wait(60);
      const screen = app.visible();
      assert.doesNotMatch(screen, /No se pudo completar la transferencia|Revisa tu saldo antes de reintentar|Modificar monto o cuenta/);
      assert.match(screen, /Estamos verificando si tu transferencia se completó/);
      assert.equal(mockSecureValues.get(ownKey()), stored, 'the record persists unchanged');
      await app.press('Ir al inicio (revisar saldo después)');
      await app.wait(60);
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.ok(!app.homeOffersNewTransfer());
      assert.equal(app.pressables('Continuar con transferencia').length, 0);
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.equal(new Set(app.creates().map(keyOf)).size, 1, 'only the original key was ever sent');
      await app.finish();
    });
  }

  // H5 (F-21): the first send no longer opens M11 for an unverified 4xx; it stays in verification (see recovery-h5).
  it('a first send answered with an unverified 4xx stays in verification on M09 and its exits keep the record (no edit path)', async () => {
    const app = await signIn({}, (url, init) => (url.endsWith('/transfers') && init?.method === 'POST' ? problem(429, 'Demasiadas solicitudes.') : undefined));
    await app.transferOnce();
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
    assert.doesNotMatch(app.visible(), /Revisa tu saldo antes de reintentar/);
    assert.equal(app.pressables('Modificar monto o cuenta').length, 0);
    const stored = mockSecureValues.get(ownKey());
    assert.ok(stored);
    await app.press('Ir al inicio (revisar saldo después)');
    await app.wait(60);
    assert.equal(mockSecureValues.get(ownKey()), stored);
    assert.match(app.visible(), /Transferencia en verificación/);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });

  it('a confirmed rejection (422 "Saldo insuficiente") on the retry releases the record: M11 with no debit and the flow enabled again', async () => {
    // R8 (§R8.7): only the typed rejection of this identity is terminal.
    const app = await signIn({}, lostThen(() => Response.json({ type: 'urn:billetera:problem:transfer-attempt-rejected', title: 'Error', detail: 'Saldo insuficiente.' }, { status: 422 })));
    await app.transferOnce();
    await app.press('Reenviar la misma transferencia');
    await app.press('Reenviar la misma transferencia');
    await app.wait(60);
    assert.match(app.visible(), /Tu dinero está intacto/);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.press('Volver al inicio');
    await app.wait();
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });
});

const withAppState = async (run: (emit: (state: string) => Promise<void>) => Promise<void>) => {
  const listeners: Array<(state: string) => void> = [];
  const original = AppState.addEventListener;
  AppState.addEventListener = ((_type: string, listener: (state: string) => void) => { listeners.push(listener); return { remove: () => { listeners.splice(listeners.indexOf(listener), 1); } }; }) as unknown as typeof AppState.addEventListener;
  try { await run(async (state) => { await TestRenderer.act(async () => { listeners.forEach((listener) => listener(state)); }); }); }
  finally { AppState.addEventListener = original; }
};

describe('H4 · F-27: an attempt whose id never arrived is never re-sent without a tap', () => {
  it('start-up, Home shown again and returns to the foreground send 0 creates; "Verificar estado" sends 0 too and only the confirmed resend sends one with the same key', async () => {
    await withAppState(async (emit) => {
      const app = await signIn({ [ownKey()]: record() }, (url, init) => (url.endsWith('/transfers') && init?.method === 'POST' && keyOf({ url, init }) === STORED_KEY ? Response.json(transferBody({ id: 'tr-stored', amountMinor: '30025', reference: '4401' }), { status: 201 }) : url.endsWith('/transfers/tr-stored') ? Response.json(transferBody({ id: 'tr-stored', amountMinor: '30025', reference: '4401' })) : undefined));
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.equal(app.creates().length, 0, 'start-up / sign-in sends nothing');
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await emit('background');
        await emit('active');
        await app.wait(60);
      }
      assert.ok(app.calls.some((call) => call.url.endsWith('/auth/me')), 'the foreground re-check ran');
      assert.equal(app.creates().length, 0, 'returning to the foreground sends nothing');
      // Home shown again (Movimientos -> Inicio).
      const tab = (name: string) => app.renderer.root.findAll((node) => node.props.accessibilityRole === 'tab' && node.findAll((child) => child.props.children === name).length > 0)[0]!;
      await TestRenderer.act(async () => { tab('Movimientos').props.onPress(); });
      await app.wait();
      await TestRenderer.act(async () => { tab('Inicio').props.onPress(); });
      await app.wait(60);
      assert.equal(app.creates().length, 0, 'showing Home sends nothing');
      assert.equal(mockSecureValues.get(ownKey()), record());
      await app.press('Verificar estado de la transferencia');
      await app.wait(60);
      assert.equal(app.creates().length, 0, 'H5: verifying never sends a create');
      await app.press('Reenviar la misma transferencia');
      await app.press('Reenviar la misma transferencia');
      await app.wait(60);
      assert.equal(app.creates().length, 1);
      assert.equal(keyOf(app.creates()[0]!), STORED_KEY);
      assert.match(app.visible(), /"Transferencia completada"/);
      assert.equal(mockSecureValues.get(ownKey()), undefined);
      await app.finish();
    });
  });

  it('after "Ir al inicio" from M09 (response lost before it was applied) the foreground sends nothing until the tap', async () => {
    await withAppState(async (emit) => {
      let sends = 0;
      const app = await signIn({}, (url, init) => {
        if (url.endsWith('/transfers') && init?.method === 'POST') { sends += 1; if (sends === 1) throw new TypeError('Network request failed'); }
        return undefined;
      });
      await app.transferOnce();
      await app.press('Ir al inicio (revisar saldo después)');
      await app.wait(60);
      await emit('background');
      await emit('active');
      await app.wait(60);
      assert.equal(sends, 1, '0 creates without a tap');
      assert.match(app.visible(), /Transferencia en verificación/);
      await app.press('Verificar estado de la transferencia');
      await app.wait(60);
      assert.equal(sends, 1, 'H5: verifying never sends a create');
      await app.press('Reenviar la misma transferencia');
      await app.press('Reenviar la misma transferencia');
      await app.wait(60);
      assert.equal(sends, 2);
      assert.equal(new Set(app.creates().map(keyOf)).size, 1);
      await app.finish();
    });
  });
});

describe('H4 · F-28: guard coverage', () => {
  const toReview = async (app: Awaited<ReturnType<typeof signIn>>) => {
    await app.press('Transferir dinero, elegir beneficiario');
    await app.wait();
    await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
    await app.press('Continuar con transferencia');
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('850.00'); });
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); app.renderer.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('131126'); });
    await app.press('Continuar');
    assert.match(app.visible(), /"Paso 2 de 2"/);
  };

  it('(1) when the secure store cannot be read at confirm time the guard fails closed: 0 POST /transfers and a clear message', async () => {
    const app = await signIn({}, () => undefined);
    await toReview(app);
    store().getItemAsync.mockImplementation((key: string) => (key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : Promise.resolve(mockSecureValues.get(key) ?? null)));
    await app.press('Confirmar transferencia');
    await app.wait();
    assert.equal(app.creates().length, 0, 'nothing is sent while it cannot be checked');
    assert.match(app.visible(), /No pudimos comprobar si tienes una transferencia en verificación. Para evitar un cargo doble no enviamos nada/);
    assert.doesNotMatch(app.visible(), /keychain locked/);
    assert.equal(mockSecureValues.get(ownKey()), undefined, 'no record was written either');
    await app.finish();
  });

  it('(2) "Solicitar un código nuevo" without a previous attempt does not bypass the guard: a stored unresolved attempt still blocks the new key', async () => {
    const app = await signIn({}, () => undefined);
    await toReview(app);
    // An unresolved attempt of this user exists (e.g. written by another run of the app) and there is no attempt in memory.
    mockSecureValues.set(ownKey(), record());
    const flow = app.renderer.root.findAll((node) => typeof node.props.onRequestNewCode === 'function')[0];
    assert.ok(flow);
    assert.equal(flow.props.transfer, null, 'no previous attempt in memory');
    await TestRenderer.act(async () => { flow.props.onRequestNewCode(); });
    await app.wait(60);
    assert.ok(app.creates().every((call) => keyOf(call) === STORED_KEY), 'no POST with a new key');
    assert.equal(app.creates().length, 0);
    assert.equal(mockSecureValues.get(ownKey()), record(), 'the stored attempt is not replaced');
    assert.match(app.visible(), /Transferencia en verificación/);
    await app.finish();
  });
});
