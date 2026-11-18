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
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
  await press('Iniciar sesión');
  await wait(60);
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
  return { renderer: renderer!, visible, pressables, button, press, wait, calls, creates, homeOffersNewTransfer, toHome, toReview, transferOnce, finish };
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
