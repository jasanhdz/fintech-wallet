import React from 'react';
import assert from 'node:assert/strict';
import TestRenderer from 'react-test-renderer';
import App from '../App';

// Round 7 · H5: recovery of an uncertain attempt without ever debiting twice.
// 1 (F-21) an unconfirmed 4xx on ANY send keeps the attempt in verification with its record intact.

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
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `h5-new-key-${++mockUuid}`) }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

const USER = 'user-h5';
const LEGACY = 'wallet.transfer-recovery';
const ownKey = (id = USER) => `${LEGACY}.${id}`;
const account = { id: 'source-1', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1245000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' };
const beneficiary = { id: 'beneficiary-1', name: 'Carlos Ruiz', alias: 'Carlos', clabeMasked: '000•••••••••••0028', destinationAccountId: 'dest-1' };
const transferBody = (overrides: Record<string, unknown> = {}) => ({ id: 'tr-new', status: 'completed', sourceAccountId: 'source-1', destination: beneficiary, amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', createdAt: '2026-11-13T20:30:00.000Z', completedAt: '2026-11-13T20:31:00.000Z', receiptReference: 'R-NEW', ...overrides });
const problem = (status: number, detail: string) => Response.json({ title: 'Error', detail }, { status });
const IN_PROGRESS = 'La solicitud idempotente está en curso; reintenta con la misma llave.';

type Call = { url: string; init?: RequestInit };
type Handler = (url: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>;
const keyOf = (call: Call) => (call.init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'];
const isCreate = (call: Call) => call.url.endsWith('/transfers') && call.init?.method === 'POST';
const M11 = /No se pudo completar la transferencia|Revisa tu saldo antes de reintentar|Modificar monto o cuenta|Tu dinero está intacto/;
const NEW_TRANSFER_ENTRIES = ['Transferir dinero, elegir beneficiario', 'Continuar con transferencia', 'Cambiar beneficiario', 'Elegir otro destinatario'];

async function signIn(seed: Record<string, string>, handler: Handler, options: { restore?: boolean } = {}) {
  for (const [key, value] of Object.entries(seed)) mockSecureValues.set(key, value);
  // restore: the app starts with a stored session (refresh token) instead of the login form.
  if (options.restore) mockSecureValues.set('wallet.refresh-token', 'refresh-stored');
  const calls: Call[] = [];
  const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const handled = await handler(url, init);
    if (handled) return handled;
    if (url.endsWith('/auth/login') || url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: USER, fullName: 'Ana López', email: 'ana@example.com' } });
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    if (url.endsWith('/auth/me')) return Response.json({ id: USER, fullName: 'Ana López', email: 'ana@example.com' });
    if (url.endsWith('/accounts')) return Response.json({ items: [account] });
    if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/beneficiaries')) return Response.json({ items: [beneficiary] });
    if (url.endsWith('/transfer-policy')) return Response.json({ currency: 'MXN', otpThresholdMinor: '500000', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpExpirySeconds: 300, otpMaxAttempts: 5, businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City' });
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
  const press = async (title: string) => { await TestRenderer.act(async () => { button(title).props.onPress(); }); };
  const wait = (ms = 40) => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  const logIn = async () => {
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await press('Iniciar sesión');
    await wait(60);
  };
  if (options.restore) await wait(60); else await logIn();
  const creates = () => calls.filter(isCreate);
  const homeOffersNewTransfer = () => NEW_TRANSFER_ENTRIES.some((entry) => pressables(entry).length > 0);
  const finish = async () => { await TestRenderer.act(async () => { renderer!.unmount(); }); delete (global as { fetch?: typeof fetch }).fetch; };
  /** Leaves M09 for Home when the app landed there (e.g. a read without answer at start-up). */
  const toHome = async () => { if (pressables('Ir al inicio (revisar saldo después)').length) { await press('Ir al inicio (revisar saldo después)'); await wait(60); } };
  /** From Home to the review step of a new transfer (Carlos Ruiz, $850.00). */
  const toReview = async (amount = '850.00') => {
    await press('Transferir dinero, elegir beneficiario');
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
    await press('Continuar con transferencia');
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText(amount); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('131126'); });
    await press('Continuar');
  };
  /** A complete new transfer from Home. */
  const transferOnce = async () => { await toReview(); await press('Confirmar transferencia'); await wait(60); };
  return { renderer: renderer!, visible, pressables, button, press, wait, calls, creates, homeOffersNewTransfer, toHome, toReview, transferOnce, logIn, finish };
}

const UNCONFIRMED_4XX: Array<[string, () => Response]> = [
  ['409 "en curso"', () => problem(409, IN_PROGRESS)],
  ['401', () => problem(401, 'Unauthorized')],
  ['403', () => problem(403, 'Forbidden')],
  ['400', () => problem(400, 'Datos de transferencia inválidos.')],
  ['429 rate limit', () => problem(429, 'Demasiadas solicitudes.')],
];

describe('H5 · 1 (F-21): an unconfirmed 4xx keeps the attempt in verification on ANY send', () => {
  for (const [label, answer] of UNCONFIRMED_4XX) {
    it(`first send answered ${label}: M09 (never M11), the record stays byte-identical and no exit of M09 deletes it`, async () => {
      const app = await signIn({}, (url, init) => (isCreate({ url, init }) ? answer() : undefined));
      await app.transferOnce();
      const screen = app.visible();
      assert.match(screen, /Estamos verificando si tu transferencia se completó/);
      assert.doesNotMatch(screen, M11);
      const stored = mockSecureValues.get(ownKey());
      assert.ok(stored, 'the record written before the send is still there');
      assert.equal(JSON.parse(stored).key, keyOf(app.creates()[0]!));
      // Header arrow ("Ir al inicio") and the explicit exit: neither deletes the record nor offers a new attempt.
      await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Ir al inicio' && typeof node.props.onPress === 'function')[0]!.props.onPress(); });
      await app.wait(60);
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.ok(!app.homeOffersNewTransfer());
      assert.equal(app.creates().length, 1, 'nothing else was sent');
      await app.finish();
    });
  }

  it('a confirmed business rejection (422) of the first send is the only 4xx that opens M11 and releases the record', async () => {
    const app = await signIn({}, (url, init) => (isCreate({ url, init }) ? problem(422, 'Saldo insuficiente.') : undefined));
    await app.transferOnce();
    assert.match(app.visible(), /Tu dinero está intacto/);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.finish();
  });
});

const storedPayload = { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '30025', concept: 'Comida', reference: '4401' };
const STORED_KEY = 'stored-key-0001-abcd';
const record = (extra: Record<string, unknown> = {}) => JSON.stringify({ key: STORED_KEY, payload: storedPayload, userId: USER, ...extra });
const tabTo = async (app: Awaited<ReturnType<typeof signIn>>, name: string) => {
  await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityRole === 'tab' && node.findAll((child) => child.props.children === name).length > 0)[0]!.props.onPress(); });
  await app.wait(60);
};
const NOT_FOUND = /El servidor no encuentra esta operación. No podemos confirmar si se realizó un cargo: revisa Movimientos y tu saldo./;
const RELEASE_CLAIMS = /El servidor no tiene registro|Ya puedes hacer otra transferencia|dejamos de darle seguimiento|Descartaste|no se realizó (ningún )?cargo|Tu dinero está intacto/;

describe('H5 · 4 (F-26): no release without a confirmed final result and no discard', () => {
  for (const where of ['start-up', 'Home'] as const) {
    it(`GET of the stored attempt answers 404 (${where}): the record is kept byte-identical, Home explains it without claiming anything and offers only safe actions`, async () => {
      let reads = 0;
      const stored = record({ transferId: 'tr-gone' });
      const app = await signIn({ [ownKey()]: stored }, (url) => {
        if (url.endsWith('/transfers/tr-gone')) {
          reads += 1;
          if (where === 'Home' && reads === 1) throw new TypeError('Network request failed');
          return problem(404, 'Transferencia no encontrada.');
        }
        return undefined;
      });
      await app.toHome();
      await app.wait(60);
      assert.equal(mockSecureValues.get(ownKey()), stored, 'a 404 of the read never releases the record');
      const home = app.visible();
      assert.match(home, NOT_FOUND);
      assert.doesNotMatch(home, RELEASE_CLAIMS);
      assert.ok(!app.homeOffersNewTransfer(), 'still blocked: a 404 does not prove that nothing was charged');
      assert.equal(app.pressables('Descartar este intento').length, 0, 'there is no discard');
      assert.ok(app.pressables('Verificar de nuevo').length > 0);
      assert.ok(app.pressables('Ver movimientos').length > 0);
      assert.equal(app.creates().length, 0);
      // "Verificar de nuevo" only reads again.
      const before = reads;
      await app.press('Verificar de nuevo');
      await app.wait(60);
      assert.ok(reads > before, "it read the attempt again");
      assert.equal(app.creates().length, 0);
      assert.equal(mockSecureValues.get(ownKey()), stored);
      // "Ver movimientos" only reads; the block stays when coming back.
      await app.press('Ver movimientos');
      assert.match(app.visible(), /Últimos movimientos/);
      await tabTo(app, 'Inicio');
      assert.match(app.visible(), NOT_FOUND);
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.equal(app.creates().length, 0);
      await app.finish();
    });
  }

  it('a damaged record is explained without technical text; "Reintentar lectura" re-reads it, nothing is deleted or sent and there is no discard', async () => {
    const damaged = '{"key":"stored-key-0001-abcd","payl';
    const others = JSON.stringify({ key: 'other-key', payload: storedPayload, userId: 'user-other' });
    const app = await signIn({ [ownKey()]: damaged, [ownKey('user-other')]: others }, () => undefined);
    const home = app.visible();
    assert.match(home, /No pudimos recuperar los datos de una transferencia en verificación/);
    assert.match(home, /No sabemos si se realizó un cargo; no vuelvas a enviar hasta revisar Movimientos/);
    assert.doesNotMatch(home, /Unexpected|JSON|SyntaxError|Estamos verificando/);
    assert.doesNotMatch(home, RELEASE_CLAIMS);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(app.pressables('Descartar este intento').length, 0);
    assert.equal(app.pressables('Reenviar la misma transferencia').length, 0, 'its key and payload cannot be recovered: no resend');
    assert.ok(app.pressables('Ver movimientos').length > 0);
    await app.press('Reintentar lectura');
    await app.wait(60);
    assert.match(app.visible(), /No pudimos recuperar los datos de una transferencia en verificación/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(mockSecureValues.get(ownKey()), damaged, 'the damaged record is never deleted by the app');
    assert.equal(mockSecureValues.get(ownKey('user-other')), others);
    assert.equal(store().deleteItemAsync.mock.calls.filter(([key]) => String(key).startsWith(LEGACY)).length, 0);
    assert.equal(app.creates().length, 0);
    await app.finish();
  });

  it('a damaged record found by the guard when confirming sends nothing and Home shows the same explanation', async () => {
    const app = await signIn({}, () => undefined);
    await app.toReview();
    mockSecureValues.set(ownKey(), 'not json at all');
    await app.press('Confirmar transferencia');
    await app.wait();
    assert.equal(app.creates().length, 0);
    assert.match(app.visible(), /No pudimos recuperar los datos de una transferencia en verificación/);
    assert.doesNotMatch(app.visible(), /Unexpected|JSON/);
    assert.equal(mockSecureValues.get(ownKey()), 'not json at all');
    await app.finish();
  });

  it('an unreadable secure store blocks with an explanation; "Reintentar lectura" unblocks only once it can be read again', async () => {
    let unreadable = true;
    store().getItemAsync.mockImplementation((key: string) => (unreadable && key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : Promise.resolve(mockSecureValues.get(key) ?? null)));
    const app = await signIn({}, () => undefined);
    assert.match(app.visible(), /No pudimos comprobar tus transferencias/);
    assert.match(app.visible(), /No sabemos si se realizó un cargo; no vuelvas a enviar hasta revisar Movimientos/);
    assert.doesNotMatch(app.visible(), /keychain locked/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(app.pressables('Descartar este intento').length, 0);
    await app.press('Reintentar lectura');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer(), 'still unreadable: still blocked');
    unreadable = false;
    await app.press('Reintentar lectura');
    await app.wait(60);
    assert.ok(app.homeOffersNewTransfer(), 'readable again and no record: the flow is available');
    assert.doesNotMatch(app.visible(), /No pudimos comprobar tus transferencias/);
    assert.equal(app.creates().length, 0);
    assert.equal(store().deleteItemAsync.mock.calls.length, 0);
    await app.finish();
  });

  it('when the store is readable again and holds a record, "Reintentar lectura" shows that attempt (still blocked)', async () => {
    let unreadable = true;
    mockSecureValues.set(ownKey(), record());
    store().getItemAsync.mockImplementation((key: string) => (unreadable && key.startsWith(LEGACY) ? Promise.reject(new Error('keychain locked')) : Promise.resolve(mockSecureValues.get(key) ?? null)));
    const app = await signIn({}, () => undefined);
    assert.match(app.visible(), /No pudimos comprobar tus transferencias/);
    unreadable = false;
    await app.press('Reintentar lectura');
    await app.wait(60);
    assert.match(app.visible(), /Transferencia en verificación/);
    assert.match(app.visible(), /"\$300.25 MXN"/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(mockSecureValues.get(ownKey()), record());
    assert.equal(app.creates().length, 0);
    await app.finish();
  });

  it('a business rejection at confirm time releases the record only once the cancel of that attempt is confirmed', async () => {
    const pending = transferBody({ id: 'tr-otp', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
    const app = await signIn({}, (url, init) => {
      if (isCreate({ url, init })) return Response.json({ ...pending, demoOnlyCode: '000000' }, { status: 202 });
      if (url.endsWith('/transfers/tr-otp/confirm')) return problem(422, 'Saldo insuficiente.');
      if (url.endsWith('/transfers/tr-otp/cancel') || url.endsWith('/transfers/tr-otp')) throw new TypeError('Network request failed');
      return undefined;
    });
    await app.toReview('6000.00');
    await app.wait();
    await app.press('Continuar a verificación');
    await app.wait(60);
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('000000'); });
    await app.press('Autorizar transferencia');
    await app.wait(60);
    assert.match(app.visible(), /Tu dinero está intacto/, 'the confirm was rejected: it moved no money');
    const stored = mockSecureValues.get(ownKey());
    assert.ok(stored, 'the attempt may still be open (cancel not confirmed): its record stays');
    assert.equal(JSON.parse(stored).transferId, 'tr-otp');
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });
});

const NO_ID = /Esta operación aún no tiene número del servidor, así que no podemos consultarla. No podemos confirmar si se realizó un cargo. Para conocer su resultado sin riesgo de un cargo doble usa «Reenviar la misma transferencia»/;
const MOVEMENTS_CAVEAT = /En Movimientos revisa si aparece un cargo con estos datos; una coincidencia no prueba que sea este intento./;
const RESEND = 'Reenviar la misma transferencia';
const lostOnce = (then: () => Response | undefined = () => undefined) => {
  let sends = 0;
  return (url: string, init?: RequestInit) => {
    if (!isCreate({ url, init })) return undefined;
    sends += 1;
    if (sends === 1) throw new TypeError('Network request failed');
    return then();
  };
};
const withAppState = async (run: (emit: (state: string) => Promise<void>) => Promise<void>) => {
  const { AppState } = jest.requireActual('react-native') as typeof import('react-native');
  const listeners: Array<(state: string) => void> = [];
  const original = AppState.addEventListener;
  AppState.addEventListener = ((_type: string, listener: (state: string) => void) => { listeners.push(listener); return { remove: () => { listeners.splice(listeners.indexOf(listener), 1); } }; }) as unknown as typeof AppState.addEventListener;
  try { await run(async (state) => { await TestRenderer.act(async () => { listeners.forEach((listener) => listener(state)); }); }); }
  finally { AppState.addEventListener = original; }
};

describe('H5 · 2: verifying (consulting) never creates a transfer', () => {
  it('M09 "Verificar estado" of an attempt whose id never arrived sends nothing (no POST, no other key) and says why', async () => {
    const app = await signIn({}, lostOnce(() => Response.json(transferBody(), { status: 201 })));
    await app.transferOnce();
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
    const stored = mockSecureValues.get(ownKey());
    for (let tap = 0; tap < 3; tap += 1) { await app.press('Verificar estado de la transferencia'); await app.wait(); }
    assert.equal(app.creates().length, 1, '0 POST /transfers from verifying');
    assert.match(app.visible(), NO_ID);
    assert.equal(mockSecureValues.get(ownKey()), stored);
    assert.ok(app.pressables(RESEND).length > 0, 'the explicit resend is offered as a separate action');
    assert.ok(app.pressables('Ver movimientos').length > 0);
    await app.finish();
  });

  it('Home "Verificar estado" of a stored attempt without id sends nothing and explains it with the safe actions', async () => {
    const app = await signIn({ [ownKey()]: record() }, () => undefined);
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    assert.equal(app.creates().length, 0);
    assert.match(app.visible(), NO_ID);
    assert.equal(mockSecureValues.get(ownKey()), record());
    assert.ok(app.pressables('Ver movimientos').length > 0);
    assert.ok(app.pressables(RESEND).length > 0);
    assert.ok(!app.homeOffersNewTransfer());
    await app.finish();
  });

  it('with an id, verifying only reads it (GET), from Home and from M09', async () => {
    let reads = 0;
    const pending = transferBody({ id: 'tr-proc', status: 'processing', amountMinor: '30025', reference: '4401', completedAt: undefined });
    const app = await signIn({ [ownKey()]: record({ transferId: 'tr-proc' }) }, (url) => (url.endsWith('/transfers/tr-proc') ? (reads += 1, Response.json(pending)) : undefined));
    const before = reads;
    await app.toHome();
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    assert.ok(reads > before);
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/, 'processing: shown on M09');
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    assert.equal(app.creates().length, 0, 'never a POST /transfers');
    assert.equal(app.pressables(RESEND).length, 0, 'the server knows this attempt: nothing to resend');
    await app.finish();
  });

  for (const how of ['start-up', 'sign-in'] as const) {
    it(`an attempt waiting for its code is reopened (${how}) with a READ only: M08 without the code and 0 POST`, async () => {
      const pending = transferBody({ id: 'tr-wait', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
      const app = await signIn({ [ownKey()]: record({ transferId: 'tr-wait', status: 'awaiting_confirmation' }) }, (url, init) => {
        if (url.endsWith('/transfers/tr-wait')) return Response.json(pending);
        if (isCreate({ url, init })) return Response.json({ ...pending, demoOnlyCode: '000000' }, { status: 202 });
        return undefined;
      }, { restore: how === 'start-up' });
      assert.equal(app.creates().length, 0, 'no create is replayed to recover the code');
      assert.ok(app.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }));
      assert.match(app.visible(), /Por seguridad el código no se guarda en el dispositivo/);
      assert.doesNotMatch(app.visible(), /Código asignado para esta prueba/);
      await app.finish();
    });
  }

  it('"Continuar con la transferencia pendiente" on Home reads the attempt and opens M08 without sending anything', async () => {
    let reads = 0;
    const pending = transferBody({ id: 'tr-wait', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
    const app = await signIn({ [ownKey()]: record({ transferId: 'tr-wait', status: 'awaiting_confirmation' }) }, (url) => {
      if (url.endsWith('/transfers/tr-wait')) { reads += 1; if (reads === 1) throw new TypeError('Network request failed'); return Response.json(pending); }
      return undefined;
    });
    await app.toHome();
    await app.wait(60);
    await app.press('Continuar con la transferencia pendiente');
    await app.wait(60);
    assert.ok(app.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }));
    assert.equal(app.creates().length, 0);
    await app.finish();
  });
});

describe('H5 · 2b: a matching charge in Movimientos never resolves an attempt without id (only the same-key resend does)', () => {
  // The account shows a completed debit with exactly the attempt's amount, concept and reference, and its transfer has the
  // same origin and destination. That is NOT proof that it is this attempt: nothing may resolve, release or show a receipt
  // from it. The consented resend with the stored key is the authoritative reconciliation (the server returns the same
  // transfer if that key was applied).
  const applied = transferBody({ id: 'tr-applied', receiptReference: 'R-APPLIED' });
  const matchingDebit = { id: 'mv-1', transferId: 'tr-applied', type: 'debit', amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', status: 'completed', occurredAt: new Date().toISOString(), counterparty: { name: 'Carlos Ruiz', clabeMasked: beneficiary.clabeMasked } };
  const handler = () => {
    let sends = 0;
    return (url: string, init?: RequestInit) => {
      if (url.includes('/accounts/source-1/movements')) return Response.json({ items: [matchingDebit], nextCursor: null });
      if (url.endsWith('/transfers/tr-applied')) return Response.json(applied);
      if (!isCreate({ url, init })) return undefined;
      sends += 1;
      // 1st: the server applied it and the response was lost; 2nd (same key): the API returns the same transfer.
      if (sends === 1) throw new TypeError('response lost after the server applied it');
      return Response.json(applied, { status: 201 });
    };
  };
  const readsOfApplied = (app: Awaited<ReturnType<typeof signIn>>) => app.calls.filter((call) => call.url.endsWith('/transfers/tr-applied')).length;

  it('"Verificar" (M09 and Home), Home shown, and Movimientos never take the matching charge as this attempt; the record stays', async () => {
    const app = await signIn({}, handler());
    await app.transferOnce();
    const stored = mockSecureValues.get(ownKey());
    assert.ok(stored);
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    let screen = app.visible();
    assert.match(screen, /Estamos verificando si tu transferencia se completó/);
    assert.match(screen, NO_ID);
    assert.match(screen, MOVEMENTS_CAVEAT);
    assert.doesNotMatch(screen, /Transferencia completada|R-APPLIED|Tu dinero está intacto/);
    await app.press('Ir al inicio (revisar saldo después)');
    await app.wait(80);
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    await tabTo(app, 'Movimientos');
    assert.match(app.visible(), /Últimos movimientos/);
    await tabTo(app, 'Inicio');
    screen = app.visible();
    assert.match(screen, /Transferencia en verificación/);
    assert.match(screen, MOVEMENTS_CAVEAT);
    assert.doesNotMatch(screen, /Transferencia completada|R-APPLIED/);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(mockSecureValues.get(ownKey()), stored, 'never released by a match');
    assert.equal(app.creates().length, 1, 'verifying sent nothing');
    assert.equal(readsOfApplied(app), 0, 'the matching transfer is never read as if it were this attempt');
    await app.finish();
  });

  it('the consented resend with the stored key is what reconciles it: the server returns the same folio, one transfer', async () => {
    const app = await signIn({}, handler());
    await app.transferOnce();
    const firstKey = keyOf(app.creates()[0]!);
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    assert.ok(mockSecureValues.get(ownKey()));
    await app.press(RESEND);
    await app.wait();
    await app.press(RESEND);
    await app.wait(60);
    assert.match(app.visible(), /"Transferencia completada"/);
    assert.match(app.visible(), /R-APPLIED/, 'the same folio the server had applied');
    assert.equal(app.creates().length, 2);
    assert.equal(new Set(app.creates().map(keyOf)).size, 1);
    assert.equal(keyOf(app.creates()[1]!), firstKey);
    assert.equal(mockSecureValues.get(ownKey()), undefined, 'released by the server-confirmed result of the same key');
    await app.finish();
  });
});

describe('H5 · 3: "Reenviar la misma transferencia" is explicit, shows the original data and re-sends the same key and body', () => {
  it('the first send stores the user\'s consent with the attempt; the code authorization is recorded without the code', async () => {
    const pending = transferBody({ id: 'tr-otp', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
    const app = await signIn({}, (url, init) => {
      if (isCreate({ url, init })) return Response.json({ ...pending, demoOnlyCode: '000000' }, { status: 202 });
      if (url.endsWith('/transfers/tr-otp/confirm') || url.endsWith('/transfers/tr-otp')) throw new TypeError('Network request failed');
      return undefined;
    });
    const before = Date.now();
    await app.toReview('6000.00');
    await app.wait();
    await app.press('Continuar a verificación');
    await app.wait(60);
    const afterCreate = JSON.parse(mockSecureValues.get(ownKey())!);
    assert.equal(afterCreate.transferId, 'tr-otp');
    assert.equal(afterCreate.consent.via, 'confirm');
    assert.equal(afterCreate.consent.otp, 'required');
    const confirmedAt = Date.parse(afterCreate.consent.confirmedAt);
    assert.ok(confirmedAt >= before - 1000 && confirmedAt <= Date.now(), 'the time of the tap');
    assert.equal(afterCreate.display.source, 'Cuenta Principal •• 8412');
    assert.equal(afterCreate.display.destination, 'Carlos Ruiz (Carlos) •• 0028');
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('000000'); });
    await app.press('Autorizar transferencia');
    await app.wait(60);
    const afterConfirm = JSON.parse(mockSecureValues.get(ownKey())!);
    assert.equal(afterConfirm.consent.otp, 'authorized');
    assert.equal(afterConfirm.consent.confirmedAt, afterCreate.consent.confirmedAt);
    assert.doesNotMatch(mockSecureValues.get(ownKey())!, /000000|demoOnlyCode|"code"/);
    await app.finish();
  });

  it('opening it shows the original data and consent and sends nothing; "Volver sin reenviar" changes nothing', async () => {
    const stored = record({ consent: { confirmedAt: '2026-11-13T20:30:00.000Z', via: 'confirm', otp: 'unknown' }, display: { source: 'Cuenta Principal •• 8412', destination: 'Carlos Ruiz (Carlos) •• 0028' } });
    const app = await signIn({ [ownKey()]: stored }, () => undefined);
    await app.press(RESEND);
    await app.wait();
    const screen = app.visible();
    assert.match(screen, /"\$300.25"," MXN"/);
    assert.match(screen, /Cuenta Principal •• 8412/);
    assert.match(screen, /Carlos Ruiz \(Carlos\) •• 0028/);
    assert.match(screen, /"Comida"/);
    assert.match(screen, /"4401"/);
    assert.match(screen, /Confirmaste esta transferencia el 13 de noviembre de 2026, 14:30 hrs/);
    assert.match(screen, /misma clave de la operación: si ya se aplicó, el servidor devuelve esa misma transferencia y no se cobra dos veces/);
    assert.equal(app.creates().length, 0, 'opening the resend sends nothing');
    await app.press('Volver sin reenviar');
    await app.wait(60);
    assert.match(app.visible(), /Transferencia en verificación/);
    assert.equal(mockSecureValues.get(ownKey()), stored);
    assert.equal(app.creates().length, 0);
    await app.finish();
  });

  it('the confirmation tap sends EXACTLY the stored key and body (the same bytes the first send used), once', async () => {
    const app = await signIn({}, lostOnce(() => Response.json(transferBody({ id: 'tr-new' }), { status: 201 })));
    await app.transferOnce();
    const first = app.creates()[0]!;
    const stored = JSON.parse(mockSecureValues.get(ownKey())!);
    assert.equal(stored.key, keyOf(first));
    assert.equal(JSON.stringify(stored.payload), String(first.init?.body));
    await app.press(RESEND);
    await app.wait();
    assert.equal(app.creates().length, 1);
    await app.press(RESEND);
    await app.wait(60);
    assert.equal(app.creates().length, 2);
    const second = app.creates()[1]!;
    assert.equal(keyOf(second), keyOf(first), 'the original Idempotency-Key, never a new one');
    assert.equal(String(second.init?.body), String(first.init?.body), 'the original body, never re-captured');
    assert.match(app.visible(), /"Transferencia completada"/);
    assert.equal(mockSecureValues.get(ownKey()), undefined, 'completed: released');
    await app.finish();
  });

  it('a resend of a stored record (after a restart) sends the record\'s key and payload as stored', async () => {
    const app = await signIn({ [ownKey()]: record() }, (url, init) => (isCreate({ url, init }) ? Response.json(transferBody({ id: 'tr-new', amountMinor: '30025', reference: '4401' }), { status: 201 }) : undefined));
    await app.press(RESEND);
    await app.wait();
    await app.press(RESEND);
    await app.wait(60);
    assert.equal(app.creates().length, 1);
    assert.equal(keyOf(app.creates()[0]!), STORED_KEY);
    assert.equal(String(app.creates()[0]!.init?.body), JSON.stringify(storedPayload));
    await app.finish();
  });

  it('a resend answered 202 (code required) goes to M08: the resend cannot skip the code', async () => {
    const pending = transferBody({ id: 'tr-otp', status: 'awaiting_confirmation', amountMinor: '30025', reference: '4401', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
    const app = await signIn({ [ownKey()]: record({ consent: { confirmedAt: '2026-11-13T20:30:00.000Z', via: 'confirm', otp: 'authorized' } }) }, (url, init) => (isCreate({ url, init }) ? Response.json({ ...pending, demoOnlyCode: '000000' }, { status: 202 }) : undefined));
    await app.press(RESEND);
    await app.wait();
    assert.match(app.visible(), /Ya habías autorizado su código. Si el servidor vuelve a pedirlo, tendrás que ingresarlo de nuevo/);
    await app.press(RESEND);
    await app.wait(60);
    assert.ok(app.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }));
    assert.equal(app.calls.filter((call) => call.url.endsWith('/confirm')).length, 0, 'no confirm without the user typing the code');
    assert.equal(JSON.parse(mockSecureValues.get(ownKey())!).transferId, 'tr-otp');
    await app.finish();
  });

  for (const [label, answer] of UNCONFIRMED_4XX) {
    it(`a resend answered ${label} stays in verification with the record intact and no path to another attempt`, async () => {
      const stored = record();
      const app = await signIn({ [ownKey()]: stored }, (url, init) => (isCreate({ url, init }) ? answer() : undefined));
      await app.press(RESEND);
      await app.wait();
      await app.press(RESEND);
      await app.wait(60);
      assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
      assert.doesNotMatch(app.visible(), M11);
      assert.equal(mockSecureValues.get(ownKey()), stored);
      await app.press('Ir al inicio (revisar saldo después)');
      await app.wait(60);
      assert.ok(!app.homeOffersNewTransfer());
      assert.equal(mockSecureValues.get(ownKey()), stored);
      assert.ok(app.creates().every((call) => keyOf(call) === STORED_KEY));
      await app.finish();
    });
  }

  it('a resend answered 422 twice (business rejection of the same key, re-confirmed in the same tap) releases the record: M11 with no debit', async () => {
    const app = await signIn({ [ownKey()]: record() }, (url, init) => (isCreate({ url, init }) ? problem(422, 'Saldo insuficiente.') : undefined));
    await app.press(RESEND);
    await app.wait();
    await app.press(RESEND);
    await app.wait(60);
    assert.equal(app.creates().length, 2, 'the rejection is re-confirmed once with the same key and body');
    assert.ok(app.creates().every((call) => keyOf(call) === STORED_KEY && String(call.init?.body) === JSON.stringify(storedPayload)));
    assert.match(app.visible(), /Tu dinero está intacto/);
    assert.equal(mockSecureValues.get(ownKey()), undefined);
    await app.press('Volver al inicio');
    await app.wait(60);
    assert.ok(app.homeOffersNewTransfer());
    await app.finish();
  });

  it('a resend whose 422 came from the earlier send of the same key still being applied shows that transfer (no claim of "no debit", no new charge)', async () => {
    let sends = 0;
    const app = await signIn({ [ownKey()]: record() }, (url, init) => {
      if (!isCreate({ url, init })) return undefined;
      sends += 1;
      // 1st: the server was still applying the earlier send of this key (balance already used) -> 422;
      // 2nd: the earlier send has committed -> the same key returns it.
      return sends === 1 ? problem(422, 'Saldo insuficiente.') : Response.json(transferBody({ id: 'tr-new', amountMinor: '30025', reference: '4401' }), { status: 201 });
    });
    await app.press(RESEND);
    await app.wait();
    await app.press(RESEND);
    await app.wait(60);
    assert.match(app.visible(), /"Transferencia completada"/);
    assert.doesNotMatch(app.visible(), /Tu dinero está intacto/);
    assert.equal(app.creates().length, 2);
    assert.equal(new Set(app.creates().map(keyOf)).size, 1);
    await app.finish();
  });

  it('a FIRST send answered 422 is final at once (no other send of that key can exist): one POST, M11', async () => {
    const app = await signIn({}, (url, init) => (isCreate({ url, init }) ? problem(422, 'Saldo insuficiente.') : undefined));
    await app.transferOnce();
    assert.equal(app.creates().length, 1);
    assert.match(app.visible(), /Tu dinero está intacto/);
    await app.finish();
  });

  it('a legacy record (no owner) whose resend answers 404 is kept: no release, no claim', async () => {
    const legacy = JSON.stringify({ key: STORED_KEY, payload: { ...storedPayload, beneficiaryId: 'beneficiary-of-someone-else' } });
    const app = await signIn({ [LEGACY]: legacy }, (url, init) => (isCreate({ url, init }) ? problem(404, 'Beneficiario no encontrado.') : undefined));
    await app.press(RESEND);
    await app.wait();
    await app.press(RESEND);
    await app.wait(60);
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
    assert.doesNotMatch(app.visible(), M11);
    assert.equal(JSON.parse(mockSecureValues.get(ownKey())!).key, STORED_KEY, 'migrated to its owner and kept');
    assert.equal(mockSecureValues.get(LEGACY), undefined);
    await app.finish();
  });

  it('after a GET 404 the resend is offered; it re-sends the same key and the server answers with ONE transfer', async () => {
    const stored = record({ transferId: 'tr-gone' });
    const app = await signIn({ [ownKey()]: stored }, (url, init) => {
      if (url.endsWith('/transfers/tr-gone')) return problem(404, 'Transferencia no encontrada.');
      if (isCreate({ url, init })) return Response.json(transferBody({ id: 'tr-new', amountMinor: '30025', reference: '4401' }), { status: 201 });
      return undefined;
    });
    await app.toHome();
    assert.match(app.visible(), NOT_FOUND);
    await app.press(RESEND);
    await app.wait();
    await app.press(RESEND);
    await app.wait(60);
    assert.equal(app.creates().length, 1);
    assert.equal(keyOf(app.creates()[0]!), STORED_KEY);
    assert.match(app.visible(), /"Transferencia completada"/);
    await app.finish();
  });
});

describe('H5 · 5 (F-27): nothing creates or debits on its own — only reads', () => {
  it('a record without id, network back: start-up, foreground x3, Home shown again, sign-out + sign-in send 0 creates', async () => {
    await withAppState(async (emit) => {
      const app = await signIn({ [ownKey()]: record() }, () => undefined, { restore: true });
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.equal(app.creates().length, 0, 'start-up');
      for (let cycle = 0; cycle < 3; cycle += 1) { await emit('background'); await emit('active'); await app.wait(60); }
      assert.ok(app.calls.some((call) => call.url.endsWith('/auth/me')), 'the foreground re-check ran');
      assert.equal(app.creates().length, 0, 'foreground');
      await tabTo(app, 'Movimientos');
      await tabTo(app, 'Inicio');
      assert.equal(app.creates().length, 0, 'Home shown again');
      await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });
      await app.wait(60);
      await app.logIn();
      assert.match(app.visible(), /Transferencia en verificación/);
      assert.equal(app.creates().length, 0, 'sign-in');
      assert.equal(mockSecureValues.get(ownKey()), record());
      await app.finish();
    });
  });

  it('a record WITH id waiting for its code: start-up, foreground and sign-in only read it (GET), 0 creates', async () => {
    await withAppState(async (emit) => {
      let reads = 0;
      const pending = transferBody({ id: 'tr-wait', status: 'awaiting_confirmation', amountMinor: '600000', expiresAt: new Date(Date.now() + 120_000).toISOString(), completedAt: undefined, receiptReference: undefined });
      const app = await signIn({ [ownKey()]: record({ transferId: 'tr-wait', status: 'awaiting_confirmation' }) }, (url, init) => {
        if (url.endsWith('/transfers/tr-wait')) { reads += 1; return Response.json(pending); }
        if (url.endsWith('/transfers/tr-wait/cancel')) throw new TypeError('Network request failed');
        if (isCreate({ url, init })) return Response.json({ ...pending, demoOnlyCode: '000000' }, { status: 202 });
        return undefined;
      }, { restore: true });
      assert.equal(app.creates().length, 0, 'start-up');
      for (let cycle = 0; cycle < 2; cycle += 1) { await emit('background'); await emit('active'); await app.wait(60); }
      assert.equal(app.creates().length, 0, 'foreground');
      assert.ok(reads >= 1);
      await app.finish();
    });
  });
});

describe('H5 · 6 (F-28): coverage found missing by the H5 mutations', () => {
  it('M09 "Verificar" whose GET answers 404 keeps the record, explains it and offers the resend (no release from M09 either)', async () => {
    let reads = 0;
    const stored = record({ transferId: 'tr-gone' });
    const app = await signIn({ [ownKey()]: stored }, (url) => {
      if (url.endsWith('/transfers/tr-gone')) { reads += 1; if (reads === 1) throw new TypeError('Network request failed'); return problem(404, 'Transferencia no encontrada.'); }
      return undefined;
    });
    // The start-up read had no answer: M09.
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/);
    await app.press('Verificar estado de la transferencia');
    await app.wait(60);
    assert.equal(reads, 2);
    assert.match(app.visible(), /Estamos verificando si tu transferencia se completó/, 'still M09');
    assert.match(app.visible(), NOT_FOUND);
    assert.doesNotMatch(app.visible(), RELEASE_CLAIMS);
    assert.equal(mockSecureValues.get(ownKey()), stored);
    assert.ok(app.pressables('Verificar de nuevo').length > 0);
    assert.ok(app.pressables(RESEND).length > 0);
    assert.equal(app.creates().length, 0);
    await app.press('Ir al inicio (revisar saldo después)');
    await app.wait(60);
    assert.ok(!app.homeOffersNewTransfer());
    assert.equal(mockSecureValues.get(ownKey()), stored);
    await app.finish();
  });
});
