import React from 'react';
import assert from 'node:assert/strict';
import { ActivityIndicator, AppState } from 'react-native';
import TestRenderer from 'react-test-renderer';
import App from '../App';

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
beforeEach(() => {
  mockSecureValues.clear();
  const store = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock; setItemAsync: jest.Mock; deleteItemAsync: jest.Mock };
  store.getItemAsync.mockReset().mockImplementation((key: string) => Promise.resolve(mockSecureValues.get(key) ?? null));
  store.setItemAsync.mockReset().mockImplementation((key: string, value: string) => { mockSecureValues.set(key, value); return Promise.resolve(); });
  store.deleteItemAsync.mockReset().mockImplementation((key: string) => { mockSecureValues.delete(key); return Promise.resolve(); });
});
let mockExpoCryptoUuidCalls = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `expo-crypto-uuid-${++mockExpoCryptoUuidCalls}`),
}));
beforeEach(() => { mockExpoCryptoUuidCalls = 0; });

jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

describe('mobile login', () => {
  it('shows login only, explains web-only registration, and validates before API access', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });

    const visible = () => JSON.stringify(renderer!.toJSON());
    assert.match(visible(), /Inicia sesión/);
    assert.match(visible(), /exclusivamente desde el panel web/);
    assert.doesNotMatch(visible(), /Crear cuenta|Registrarme/);

    const input = renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' });
    await TestRenderer.act(async () => { input!.props.onChangeText('correo-inválido'); });
    const submit = renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === 'Ingresar').length > 0);
    await TestRenderer.act(async () => { submit!.props.onPress(); });
    assert.match(visible(), /Ingresa un correo válido/);
    assert.equal(fetchSpy.mock.calls.length, 0);

    await TestRenderer.act(async () => { renderer!.unmount(); });
    fetchSpy.mockRestore();
  });
});

describe('mobile logout', () => {
  it('revokes the server session with bearer and refresh credentials, then clears local state', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as {
      getItemAsync: jest.Mock;
      setItemAsync: jest.Mock;
      deleteItemAsync: jest.Mock;
    };
    const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({
        accessToken: 'access-secret', refreshToken: 'refresh-secret', tokenType: 'Bearer', expiresIn: 300,
        user: { id: 'user-1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
      });
      if (url.endsWith('/accounts')) return Response.json({ items: [] });
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      throw new Error('Unexpected API request');
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const input = renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' });
    const password = renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' });
    await TestRenderer.act(async () => {
      input.props.onChangeText('ada@example.com');
      password.props.onChangeText('a-long-password');
    });
    const findButton = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { findButton('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    secureStore.deleteItemAsync.mockClear();
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });

    const logout = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/auth/logout')) as [RequestInfo | URL, RequestInit?] | undefined;
    assert.ok(logout);
    assert.deepEqual(JSON.parse(String(logout[1]?.body)), { client: 'mobile', refreshToken: 'refresh-secret' });
    assert.equal((logout[1]?.headers as Record<string, string>).Authorization, 'Bearer access-secret');
    assert.equal(secureStore.deleteItemAsync.mock.calls.length, 2);
    assert.match(JSON.stringify(renderer!.toJSON()), /Inicia sesión/);
    assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Ada Lovelace|access-secret|refresh-secret/);

    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('clears local credentials and UI when logout cannot reach the API', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as {
      getItemAsync: jest.Mock;
      setItemAsync: jest.Mock;
      deleteItemAsync: jest.Mock;
    };
    const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(input).endsWith('/auth/login')) return Response.json({
        accessToken: 'access-secret', refreshToken: 'refresh-secret', tokenType: 'Bearer', expiresIn: 300,
        user: { id: 'user-1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
      });
      if (String(input).endsWith('/accounts')) return Response.json({ items: [] });
      throw new Error('offline');
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com');
      renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('a-long-password');
    });
    const login = renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === 'Ingresar').length > 0)!;
    await TestRenderer.act(async () => { login.props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    secureStore.deleteItemAsync.mockClear();
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });

    assert.equal(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/auth/logout')).length, 1);
    assert.equal(secureStore.deleteItemAsync.mock.calls.length, 2);
    assert.match(JSON.stringify(renderer!.toJSON()), /Inicia sesión/);
    assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Ada Lovelace|access-secret|refresh-secret/);

    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

describe('mobile beneficiary selection', () => {
  it('loads the authenticated directory, searches locally and retains the selected masked destination without transferring', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({
        accessToken: 'access-secret', refreshToken: 'refresh-secret', tokenType: 'Bearer', expiresIn: 300,
        user: { id: 'user-select', fullName: 'Ada Lovelace', email: 'ada@example.com' },
      });
      if (url.endsWith('/accounts')) return Response.json({ items: [] });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [
        { id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••••••••••••1234', destinationAccountId: 'account-1' },
        { id: 'beneficiary-2', name: 'Katherine Johnson', alias: 'KJ', clabeMasked: '••••••••••••••5678', destinationAccountId: 'account-2' },
      ] });
      throw new Error('Unexpected API request');
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com');
      renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('a-long-password');
    });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    assert.ok(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/beneficiaries')));
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const list = JSON.stringify(renderer!.toJSON());
    assert.match(list, /"Todos \(","2","\)"/);
    assert.match(list, /CONTACTOS DISPONIBLES/);
    assert.match(list, /"Billetera MXN •• ","1234"/);
    assert.doesNotMatch(list, /No tienes beneficiarios guardados|Frecuentes|anti-fraude|dos factores/);
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Buscar beneficiario' }).props.onChangeText('KJ'); });
    assert.match(JSON.stringify(renderer!.toJSON()), /Katherine Johnson/);
    assert.doesNotMatch(JSON.stringify(renderer!.toJSON()), /Grace Hopper/);
    const selection = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button').find((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Katherine'))!;
    await TestRenderer.act(async () => { selection.props.onPress(); });
    assert.match(JSON.stringify(renderer!.toJSON()), /Katherine Johnson/);
    assert.match(JSON.stringify(renderer!.toJSON()), /5678/);
    assert.equal(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/transfers')).length, 0);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

describe('mobile transfer attempt', () => {
  it('recovers an uncertain create after a true unmount/remount', async () => {
    mockSecureValues.clear();
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    let sends = 0;
    const logicalRows = new Set<string>();
    let serverTransfer: Record<string, unknown> | null = null;
    const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'access-2', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 300, user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [{ id: 'source-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '125000', clabe: '000000000000000000', clabeMasked: '••••0000' }] });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [{ id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }] });
      if (url.endsWith('/transfers')) {
        sends += 1;
        logicalRows.add((init?.headers as Record<string, string>)['Idempotency-Key'] ?? '');
        serverTransfer ??= { id: 'transfer-1', status: 'awaiting_confirmation', sourceAccountId: 'source-1', destination: { id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }, amountMinor: '1234', currency: 'MXN', concept: 'Comida', reference: '123', createdAt: new Date().toISOString() };
        if (sends === 1) throw new Error('response lost after server commit');
        return Response.json({ ...serverTransfer, demoOnlyCode: '654321' }, { status: 202 });
      }
      if (url.endsWith('/transfers/transfer-1')) return Response.json(serverTransfer);
      if (url.endsWith('/transfers/transfer-1/confirm')) {
        serverTransfer = { ...serverTransfer, status: 'completed', receiptReference: 'folio-1' };
        return Response.json(serverTransfer);
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com');
      renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('a-long-password');
    });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    {
      const homeScreen = JSON.stringify(renderer!.toJSON());
      const balanceIndex = homeScreen.indexOf('Saldo disponible');
      const transferEntryIndex = homeScreen.indexOf('Transferir dinero');
      assert.ok(balanceIndex >= 0 && transferEntryIndex >= 0, 'home screen must show both the account balance and the transfer entry point');
      assert.ok(balanceIndex < transferEntryIndex, 'the account balance must render above the transfer entry point, matching the approved M02 composition');
    }
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
    assert.ok(beneficiaryButton);
    await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
    const amountInput = renderer!.root.findByProps({ accessibilityLabel: 'Importe' });
    const findReviewButton = () => renderer!.root.findAll((node) => node.props.accessibilityRole === 'button').find((node) => node.findAll((child) => child.props.children === 'Continuar').length > 0);
    await TestRenderer.act(async () => { amountInput.props.onChangeText('12.345'); });
    const invalidAmountReviewButton = findReviewButton();
    assert.ok(invalidAmountReviewButton, 'the invalid amount should keep the review action visible');
    assert.equal(invalidAmountReviewButton.props.accessibilityState?.disabled, true);
    assert.equal(invalidAmountReviewButton.findAllByType(ActivityIndicator).length, 0, 'an invalid amount must not make the review action look busy');
    await TestRenderer.act(async () => { amountInput.props.onChangeText('12.34'); });
    const reviewButton = findReviewButton();
    assert.ok(reviewButton, 'the incomplete form should keep the review action visible');
    assert.equal(reviewButton.props.accessibilityState?.disabled, true);
    assert.equal(reviewButton.findAllByType(ActivityIndicator).length, 0, 'validation-disabled review action must not look busy');
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('123'); });
    await TestRenderer.act(async () => { button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
    const createCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/transfers')) as [RequestInfo | URL, RequestInit?][];
    assert.equal(createCalls().length, 1);
    const first = createCalls()[0];
    assert.ok(first);
    const firstBody = String(first[1]?.body);
    const firstPayload = JSON.parse(firstBody);
    const firstKey = (first[1]?.headers as Record<string, string>)['Idempotency-Key'];
    const persisted = JSON.parse(mockSecureValues.get('wallet.transfer-recovery')!);
    assert.equal(persisted.key, firstKey);
    assert.equal(JSON.stringify(persisted.payload), firstBody);
    assert.equal(firstPayload.amountMinor, '1234');
    await TestRenderer.act(async () => { renderer!.unmount(); });
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    const second = createCalls()[1];
    assert.ok(second);
    assert.equal((second[1]?.headers as Record<string, string>)['Idempotency-Key'], firstKey);
    assert.equal(String(second[1]?.body), firstBody);
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('654321'));
    assert.equal(sends, 2);
    assert.equal(logicalRows.size, 1);
    assert.equal(JSON.parse(mockSecureValues.get('wallet.transfer-recovery')!).transferId, 'transfer-1');
    assert.equal(renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.value, '');
    assert.doesNotMatch([...mockSecureValues.values()].join('|'), /654321|demoOnlyCode/);
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('654321'); });
    await TestRenderer.act(async () => { button('Autorizar transferencia').props.onPress(); });
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Grace Hopper'));
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('folio-1'));
    assert.equal(mockSecureValues.has('wallet.transfer-recovery'), false);
    assert.doesNotMatch([...mockSecureValues.values()].join('|'), /654321|demoOnlyCode/);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('recovers an uncertain confirm by re-querying the transfer instead of leaving a dead end, without a second confirm POST', async () => {
    mockSecureValues.clear();
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    let confirmCalls = 0;
    let serverTransfer: Record<string, unknown> = { id: 'transfer-2', status: 'awaiting_confirmation', sourceAccountId: 'source-1', destination: { id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }, amountMinor: '5000', currency: 'MXN', concept: 'Ahorro', reference: '914', createdAt: new Date().toISOString() };
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [{ id: 'source-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '125000', clabe: '000000000000000000', clabeMasked: '••••0000' }] });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [{ id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }] });
      if (url.endsWith('/transfers')) return Response.json({ ...serverTransfer, demoOnlyCode: '914823' }, { status: 202 });
      if (url.endsWith('/transfers/transfer-2/confirm')) {
        confirmCalls += 1;
        // The server processes the confirm and consumes the OTP challenge, but the client never sees this response
        // (e.g. the connection drops on a real device right after the server commits).
        serverTransfer = { ...serverTransfer, status: 'completed', receiptReference: 'folio-2' };
        throw new Error('Network request failed');
      }
      if (url.endsWith('/transfers/transfer-2')) return Response.json(serverTransfer);
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com');
      renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('a-long-password');
    });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
    assert.ok(beneficiaryButton);
    await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Importe' }).props.onChangeText('50.00'); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Ahorro'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('914'); });
    await TestRenderer.act(async () => { button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('914823'); });
    await TestRenderer.act(async () => { button('Autorizar transferencia').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

    assert.equal(confirmCalls, 1, 'an uncertain result must not retry the confirm POST automatically');
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Grace Hopper'), 'the real receipt must be shown, not a dead-end error screen');
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('folio-2'));
    assert.equal(mockSecureValues.has('wallet.transfer-recovery'), false);

    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('falls back to expo-crypto for the idempotency key when globalThis.crypto.randomUUID is unavailable, matching Hermes on a real device', async () => {
    mockSecureValues.clear();
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    const serverTransfer = { id: 'transfer-3', status: 'awaiting_confirmation' as const, sourceAccountId: 'source-1', destination: { id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }, amountMinor: '10000', currency: 'MXN', concept: 'Abono', reference: '1546', createdAt: new Date().toISOString() };
    let createCalls = 0;
    let observedIdempotencyKey = '';
    const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [{ id: 'source-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1000000', clabe: '000000000000000000', clabeMasked: '••••0000' }] });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [{ id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }] });
      if (url.endsWith('/transfers')) {
        createCalls += 1;
        observedIdempotencyKey = (init?.headers as Record<string, string>)['Idempotency-Key'] ?? '';
        return Response.json({ ...serverTransfer, demoOnlyCode: '552134' }, { status: 202 });
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });

    const originalCrypto = globalThis.crypto;
    // This is the exact condition that crashed on the real iPhone: Hermes does not expose
    // globalThis.crypto.randomUUID. getRandomValues is kept so other Web Crypto consumers
    // (none in this app today) would still see a realistic partial shape.
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: originalCrypto?.getRandomValues?.bind(originalCrypto) } });
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => { unhandledRejections.push(reason); };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      let renderer: TestRenderer.ReactTestRenderer;
      await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
      await TestRenderer.act(async () => {
        renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com');
        renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('a-long-password');
      });
      const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
      await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
      await TestRenderer.act(async () => { await Promise.resolve(); });
      await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
      await TestRenderer.act(async () => { await Promise.resolve(); });
      await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
      assert.ok(beneficiaryButton);
      await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
      await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
      await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Importe' }).props.onChangeText('100.00'); });
      await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Abono'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('1546'); });
      await TestRenderer.act(async () => { button('Continuar').props.onPress(); });

      // This is the exact tap that crashed with "Uncaught (in promise): No se pudo crear una
      // clave segura para el intento." on the real device.
      await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
      await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

      assert.deepEqual(unhandledRejections, [], 'generating the idempotency key must never produce an unhandled promise rejection');
      assert.equal(createCalls, 1, 'the transfer must still be created exactly once via the expo-crypto fallback');
      assert.equal(observedIdempotencyKey, 'expo-crypto-uuid-1', 'the Idempotency-Key must come from the expo-crypto fallback, not globalThis.crypto');
      assert.ok(renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }), 'the flow must proceed to the OTP screen, not get stuck behind the crash');

      await TestRenderer.act(async () => { renderer!.unmount(); });
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
      delete (global as { fetch?: typeof fetch }).fetch;
    }
  });
});

describe('mobile movement history', () => {
  it('retries the first page, loads the next cursor, and opens the authenticated transfer receipt', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    let firstPageAttempts = 0;
    const calls: string[] = [];
    const transfer = { id: 'transfer-1', status: 'completed', sourceAccountId: 'own-1', destination: { id: 'beneficiary', name: 'Grace', alias: 'Grace', clabeMasked: '••1234', destinationAccountId: 'other' }, amountMinor: '90071992547409931234', currency: 'MXN', concept: 'Pago', reference: '4', createdAt: '2026-11-14T12:00:00.000Z', receiptReference: 'folio-1' };
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'movement-user', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [
        { id: 'own-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '10000', clabe: '000000000000000000', clabeMasked: '••0000' },
        { id: 'own-2', name: 'Ahorro', kind: 'savings', currency: 'MXN', availableBalanceMinor: '2500', clabe: '111111111111111111', clabeMasked: '••1111' },
      ] });
      if (url.includes('/accounts/own-1/movements?limit=20')) {
        if (!url.includes('cursor=')) {
          firstPageAttempts += 1;
          if (firstPageAttempts === 1) throw new Error('offline');
          return Response.json({ items: [{ id: 'movement-1', transferId: 'transfer-1', type: 'debit', amountMinor: '90071992547409931234', currency: 'MXN', concept: 'Pago', reference: '4', status: 'completed', occurredAt: '2026-11-14T12:00:00.000Z' }], nextCursor: 'next / cursor' });
        }
        return Response.json({ items: [], nextCursor: null });
      }
      if (url.endsWith('/transfers/transfer-1')) return Response.json(transfer);
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.match(JSON.stringify(renderer!.toJSON()), /125\.00/);
    assert.match(JSON.stringify(renderer!.toJSON()), /100\.00/);
    assert.match(JSON.stringify(renderer!.toJSON()), /Sin conexión|No pudimos conectar/);
    await TestRenderer.act(async () => { button('Reintentar').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const movementsTab = renderer!.root.findAll((node) => node.props.accessibilityRole === 'tab').find((node) => node.findAll((child) => child.props.children === 'Movimientos').length > 0);
    assert.ok(movementsTab);
    await TestRenderer.act(async () => { movementsTab.props.onPress(); });
    assert.match(JSON.stringify(renderer!.toJSON()), /Últimos movimientos/);
    assert.match(JSON.stringify(renderer!.toJSON()), /900,719,925,474,099,312\.34/);
    await TestRenderer.act(async () => { button('Cargar más movimientos').props.onPress(); });
    assert.ok(calls.some((url) => url.endsWith('cursor=next%20%2F%20cursor')));
    const movement = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Cargo '))[0];
    assert.ok(movement);
    await TestRenderer.act(async () => { movement.props.onPress(); });
    assert.ok(calls.some((url) => url.endsWith('/transfers/transfer-1')));
    assert.match(JSON.stringify(renderer!.toJSON()), /folio-1/);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
  it('M03/M04: groups by relative day, switches account from the balance card, and opens a signed detail that can go home', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    const calls: string[] = [];
    const now = new Date();
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'm03-user', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [
        { id: 'own-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '10000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' },
        { id: 'own-2', name: 'Ahorro', kind: 'savings', currency: 'MXN', availableBalanceMinor: '2500', clabe: '111111111111111111', clabeMasked: '111•••••••••••1111' },
      ] });
      if (url.includes('/accounts/own-1/movements?limit=20')) return Response.json({ items: [{ id: 'm-1', transferId: 't-1', type: 'credit', amountMinor: '50000', currency: 'MXN', concept: 'Honorarios', reference: '994012', status: 'completed', occurredAt: now.toISOString() }], nextCursor: null });
      if (url.includes('/accounts/own-2/movements?limit=20')) return Response.json({ items: [{ id: 'm-2', transferId: 't-2', type: 'debit', amountMinor: '43050', currency: 'MXN', concept: 'Farmacia', reference: '781204', status: 'completed', occurredAt: now.toISOString() }], nextCursor: null });
      if (url.endsWith('/transfers/t-2')) return Response.json({ id: 't-2', status: 'completed', sourceAccountId: 'own-2', destination: { id: 'b-1', name: 'Farmacia Central', alias: 'Farmacia', clabeMasked: '222•••••••••••5931', destinationAccountId: 'other' }, amountMinor: '43050', currency: 'MXN', concept: 'Farmacia', reference: '781204', createdAt: '2026-11-13T20:32:00.000Z', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'DEMO-0001' });
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const movementsTab = renderer!.root.findAll((node) => node.props.accessibilityRole === 'tab').find((node) => node.findAll((child) => child.props.children === 'Movimientos').length > 0)!;
    await TestRenderer.act(async () => { movementsTab.props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const visible = () => JSON.stringify(renderer!.toJSON());
    assert.match(visible(), /HOY \(/);
    assert.match(visible(), /"AL"/);
    assert.match(visible(), /Puedes consultar más movimientos en la web/);
    assert.match(visible(), /Honorarios/);
    assert.doesNotMatch(visible(), /Ciclo/);
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cuenta Principal, cambiar cuenta' }).props.onPress(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Ver movimientos de Ahorro' }).props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.ok(calls.some((url) => url.includes('/accounts/own-2/movements?limit=20')));
    assert.match(visible(), /Farmacia/);
    assert.ok(renderer!.root.findByProps({ accessibilityLabel: 'Cuenta Ahorro, cambiar cuenta' }));

    const movement = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.startsWith('Cargo '))[0]!;
    await TestRenderer.act(async () => { movement.props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    const detail = visible();
    assert.match(detail, /"Detalle"/);
    assert.match(detail, /"-\$430\.50"/);
    assert.match(detail, /13 de noviembre de 2026, 14:32 hrs/);
    assert.match(detail, /Tiempo del Centro de México/);
    assert.match(detail, /"Ahorro"," •• ","1111"/);
    assert.match(detail, /"Farmacia Central"," •• 5931"/);
    assert.match(detail, /DEMO-0001/);
    assert.match(detail, /Transferencia interna/);
    assert.doesNotMatch(detail, /"completed"/);
    await TestRenderer.act(async () => { button('Ir al inicio').props.onPress(); });
    assert.match(visible(), /Hola, /);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

describe('mobile beneficiary picker (M05)', () => {
  it('shows the alternate empty state once, without the list chrome or unsupported security copy', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'empty-user', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [] });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [] });
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const visible = JSON.stringify(renderer!.toJSON());
    assert.match(visible, /No tienes beneficiarios guardados/);
    assert.equal(visible.match(/se registran y administran únicamente/g)?.length, 1, 'the web-only management message must appear exactly once');
    assert.doesNotMatch(visible, /Todos \(|CONTACTOS DISPONIBLES|Seguridad bancaria|anti-fraude|dos factores|banca web corporativa/);
    assert.match(visible, /"Transferir"/);
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Volver a inicio' }).props.onPress(); });
    assert.match(JSON.stringify(renderer!.toJSON()), /Hola, /);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

describe('mobile transfer details (M06)', () => {
  it('changes the beneficiary from the details step, keeps typed data and sends the new destination', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    const createBodies: Array<Record<string, unknown>> = [];
    const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'm06-user', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [{ id: 'source-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1245000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' }] });
      if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [
        { id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' },
        { id: 'beneficiary-2', name: 'Katherine Johnson', alias: 'KJ', clabeMasked: '••••5678', destinationAccountId: 'dest-2' },
      ] });
      if (url.endsWith('/transfers')) {
        createBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ id: 'transfer-m06', status: 'awaiting_confirmation', sourceAccountId: 'source-1', destination: { id: 'beneficiary-2', name: 'Katherine Johnson', alias: 'KJ', clabeMasked: '••••5678', destinationAccountId: 'dest-2' }, amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', createdAt: new Date().toISOString() }, { status: 202 });
      }
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const visible = () => JSON.stringify(renderer!.toJSON());
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    const wait = () => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ada@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0]!.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });

    assert.match(visible(), /PASO 1 DE 2/);
    assert.match(visible(), /50% completado/);
    assert.match(visible(), /Beneficiario destino/);
    assert.match(visible(), /Grace Hopper/);
    assert.match(visible(), /"Principal •• 8412"/);
    assert.doesNotMatch(visible(), /Límite diario/, 'the API exposes no daily limit, so none may be shown');
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Importe' }).props.onChangeText('850.00'); });

    // Back from the picker returns to the details step, not Home.
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cambiar beneficiario' }).props.onPress(); });
    await wait();
    assert.match(visible(), /Elegir beneficiario/);
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Volver a datos de transferencia' }).props.onPress(); });
    assert.match(visible(), /Beneficiario destino/);

    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cambiar beneficiario' }).props.onPress(); });
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Katherine'))[0]!.props.onPress(); });
    assert.match(visible(), /Katherine Johnson/);
    assert.doesNotMatch(visible(), /Grace Hopper/);
    assert.equal(renderer!.root.findByProps({ accessibilityLabel: 'Importe' }).props.value, '850.00', 'typed amount survives changing the beneficiary');

    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('131126'); });
    await TestRenderer.act(async () => { button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
    await wait();
    assert.equal(createBodies.length, 1);
    assert.equal(createBodies[0]!.beneficiaryId, 'beneficiary-2');
    assert.equal(createBodies[0]!.amountMinor, '85000');
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

type FlowHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
const flowAccount = { id: 'source-1', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1245000', clabe: '000000000000008412', clabeMasked: '000•••••••••••8412' };
const flowBeneficiary = { id: 'beneficiary-1', name: 'Carlos Ruiz', alias: 'Carlos', clabeMasked: '000•••••••••••0028', destinationAccountId: 'dest-1' };
const flowTransfer = (overrides: Record<string, unknown> = {}) => ({ id: 'transfer-flow', status: 'awaiting_confirmation', sourceAccountId: 'source-1', destination: flowBeneficiary, amountMinor: '600000', currency: 'MXN', concept: 'Comida', reference: '131126', createdAt: '2026-11-13T20:30:00.000Z', ...overrides });

async function startTransferFlow(handler: FlowHandler, options: { amount: string; accounts?: () => unknown[] }) {
  mockSecureValues.clear();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const handled = await handler(url, init);
    if (handled) return handled;
    if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: `flow-${options.amount}-${Math.random()}`, fullName: 'Ana López', email: 'ana@example.com' } });
    if (url.endsWith('/accounts')) return Response.json({ items: options.accounts ? options.accounts() : [flowAccount] });
    if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/beneficiaries')) return Response.json({ items: [flowBeneficiary] });
    throw new Error(`Unexpected API request: ${url}`);
  });
  Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
  let renderer: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
  const visible = () => JSON.stringify(renderer!.toJSON());
  const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
  const wait = (ms = 30) => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
  await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
  await wait();
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
  await wait();
  await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
  await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Importe' }).props.onChangeText(options.amount); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('131126'); });
  await TestRenderer.act(async () => { button('Continuar').props.onPress(); });
  const finish = async () => { await TestRenderer.act(async () => { renderer!.unmount(); }); delete (global as { fetch?: typeof fetch }).fetch; };
  return { renderer: renderer!, visible, button, wait, calls, finish };
}

describe('mobile transfer review (M07)', () => {
  it('shows the origin → destination card, metadata and the BigInt balance calculation without unsupported fee claims', async () => {
    const flow = await startTransferFlow(() => undefined, { amount: '850.00' });
    const review = flow.visible();
    assert.match(review, /"Paso 2 de 2"/);
    assert.match(review, /"Revisar transferencia"/);
    assert.match(review, /CUENTA DE ORIGEN/);
    assert.match(review, /"Cuenta Principal •• 8412"/);
    assert.match(review, /TRANSFERENCIA INTERNA/);
    assert.match(review, /"Carlos Ruiz \(Carlos\) •• 0028"/);
    assert.match(review, /"Referencia numérica"/);
    assert.match(review, /"\$12,450.00"," - ","\$850.00"," = ","\$11,600.00"," MXN"/);
    assert.match(review, /"\$11,600.00"," MXN"/);
    assert.doesNotMatch(review, /Sin costo de comisión|Revisa tu transferencia/);
    assert.ok(flow.button('Confirmar transferencia'));
    await flow.finish();
  });
});

describe('mobile confirmation code (M08)', () => {
  it('vigente: shows the security context, the demo code and enables authorization only with 6 digits, without QA tooling', async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ ...flowTransfer(), demoOnlyCode: '742890' }, { status: 202 });
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const screen = flow.visible();
    assert.match(screen, /"Transferir"/);
    assert.doesNotMatch(screen, /"TRANSFERIR"|"Para"/, 'the legacy "← Volver … TRANSFERIR" header and duplicate destination card are gone');
    assert.match(screen, /Confirmación de seguridad/);
    assert.match(screen, /Monto extraordinario/);
    assert.match(screen, /"Carlos Ruiz •• 0028"/);
    assert.match(screen, /CÓDIGO DE DEMOSTRACIÓN/);
    assert.match(screen, /"Código de confirmación"/);
    assert.match(screen, /742890/);
    assert.doesNotMatch(screen, /Pruebas de validación|Simular|expira en|\$5,000/);
    const authorize = () => flow.renderer.root.findAll((node) => node.props.accessibilityRole === 'button').find((node) => node.findAll((child) => child.props.children === 'Autorizar transferencia').length > 0)!;
    assert.equal(authorize().props.accessibilityState?.disabled, true);
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('742890'); });
    assert.equal(authorize().props.accessibilityState?.disabled, false);
    assert.ok(flow.renderer.root.findByProps({ accessibilityLabel: 'Cancelar y volver a revisar' }));
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    assert.match(flow.visible(), /"Paso 2 de 2"/);
    await flow.finish();
  });

  it('expirado: disables authorization, hides the stale code and requests a new code with a new attempt key', async () => {
    let creates = 0;
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) {
        creates += 1;
        return Response.json({ ...flowTransfer({ id: `transfer-exp-${creates}` }), demoOnlyCode: creates === 1 ? '111111' : '222222' }, { status: 202 });
      }
      if (url.endsWith('/transfers/transfer-exp-1/confirm')) return Response.json({ title: 'Unprocessable Entity', detail: 'El código expiró.' }, { status: 422 });
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('111111'); });
    await TestRenderer.act(async () => { flow.button('Autorizar transferencia').props.onPress(); });
    await flow.wait();
    const expired = flow.visible();
    assert.match(expired, /El código ha expirado. Por seguridad solicita uno nuevo para continuar./);
    assert.doesNotMatch(expired, /111111/, 'the expired demo code must no longer be offered');
    assert.equal(flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.editable, false);
    const authorize = flow.renderer.root.findAll((node) => node.props.accessibilityRole === 'button').find((node) => node.findAll((child) => child.props.children === 'Autorizar transferencia').length > 0)!;
    assert.equal(authorize.props.accessibilityState?.disabled, true);
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/confirm')).length, 1);

    await TestRenderer.act(async () => { flow.button('Solicitar nuevo código de demostración').props.onPress(); });
    await flow.wait();
    const creations = flow.calls.filter((call) => call.url.endsWith('/transfers'));
    assert.equal(creations.length, 2);
    const keyOf = (call: { init?: RequestInit }) => (call.init?.headers as Record<string, string>)['Idempotency-Key'];
    assert.notEqual(keyOf(creations[0]!), keyOf(creations[1]!));
    assert.equal(String(creations[1]!.init?.body), String(creations[0]!.init?.body));
    const renewed = flow.visible();
    assert.doesNotMatch(renewed, /ha expirado/);
    assert.match(renewed, /222222/);
    assert.equal(flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.value, '');
    await flow.finish();
  });

  it('F-06: an uncertain confirm cannot be abandoned into a second attempt until the original transfer status is known', async () => {
    let serverStatus = 'awaiting_confirmation';
    let statusReadable = false;
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ ...flowTransfer({ id: 'transfer-f06' }), demoOnlyCode: '742890' }, { status: 202 });
      if (url.endsWith('/transfers/transfer-f06/confirm')) {
        // The server applies the confirmation but the response is lost.
        serverStatus = 'completed';
        throw new Error('Network request failed');
      }
      if (url.endsWith('/transfers/transfer-f06')) {
        if (!statusReadable) throw new Error('Network request failed');
        return Response.json(flowTransfer({ id: 'transfer-f06', status: serverStatus, completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'DEMO-F06' }));
      }
      return undefined;
    }, { amount: '6000.00' });
    const creations = () => flow.calls.filter((call) => call.url.endsWith('/transfers'));
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('742890'); });
    await TestRenderer.act(async () => { flow.button('Autorizar transferencia').props.onPress(); });
    await flow.wait();
    assert.ok(flow.button('Reintentar envío del mismo código'), 'the uncertain confirm keeps its attempt for a same-key retry');

    // Leaving while the outcome is still unknown must not drop back to the review step.
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /"Paso 2 de 2"/, 'cannot return to review while the confirm outcome is unknown');
    assert.ok(flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }), 'stays on the confirmation step');
    assert.match(flow.visible(), /evitar un cargo doble/);
    assert.ok(flow.button('Reintentar envío del mismo código'), 'the original confirm attempt key is preserved');
    const reviewConfirm = flow.button('Confirmar transferencia');
    if (reviewConfirm) await TestRenderer.act(async () => { reviewConfirm.props.onPress(); });
    await flow.wait();
    assert.equal(creations().length, 1, 'no second transfer attempt may be created');

    // Once the original transfer can be read, leaving resolves it instead of starting over.
    statusReadable = true;
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/);
    assert.match(flow.visible(), /DEMO-F06/);
    assert.equal(creations().length, 1);
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/confirm')).length, 1);
    await flow.finish();
  });
});

describe('mobile uncertain result (M09)', () => {
  it('explains the uncertain attempt, verifies it by replaying the same key and never creates a second attempt', async () => {
    let creates = 0;
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) {
        creates += 1;
        if (creates === 1) throw new Error('response lost');
        return Response.json({ ...flowTransfer({ amountMinor: '85000' }), demoOnlyCode: '913245' }, { status: 202 });
      }
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const uncertain = flow.visible();
    assert.match(uncertain, /"Detalle"/);
    assert.match(uncertain, /Protección contra duplicados activa/);
    assert.match(uncertain, /Estamos verificando si tu transferencia se completó/);
    assert.match(uncertain, /No pudimos confirmar el resultado de la operación de .*"\$850.00"," MXN".*" a ".*"Carlos Ruiz •• 0028"/);
    assert.match(uncertain, /\(Ref: 131126\)/);
    assert.match(uncertain, /No intentes enviar el dinero nuevamente/);
    assert.match(uncertain, /"Monto en verificación"/);
    assert.match(uncertain, /"En verificación de estado"/);
    assert.doesNotMatch(uncertain, /Banxico|SPEI|interbancaria|DEMO-0001|"awaiting_confirmation"/);
    await TestRenderer.act(async () => { flow.button('Verificar estado de la transferencia').props.onPress(); });
    await flow.wait();
    const creations = flow.calls.filter((call) => call.url.endsWith('/transfers'));
    assert.equal(creations.length, 2);
    const keyOf = (call: { init?: RequestInit }) => (call.init?.headers as Record<string, string>)['Idempotency-Key'];
    assert.equal(keyOf(creations[1]!), keyOf(creations[0]!), 'verification must replay the original attempt key');
    assert.ok(flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }));
    await flow.finish();
  });

  it('"Ir al inicio" leaves the uncertain screen but keeps the recovery record for the next launch', async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) throw new Error('response lost');
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const persisted = mockSecureValues.get('wallet.transfer-recovery');
    assert.ok(persisted);
    await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Hola, /);
    assert.equal(mockSecureValues.get('wallet.transfer-recovery'), persisted, 'the unresolved attempt must stay recoverable');
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/transfers')).length, 1);
    await flow.finish();
  });
});

describe('mobile completed receipt (M10)', () => {
  const completedTransfer = flowTransfer({ id: 'transfer-done', status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'DEMO-0001' });

  it('shows the signed receipt and the new balance re-read from the API after completion', async () => {
    let completed = false;
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) { completed = true; return Response.json(completedTransfer, { status: 201 }); }
      if (url.endsWith('/transfers/transfer-done')) return Response.json(completedTransfer);
      return undefined;
    }, { amount: '850.00', accounts: () => [{ ...flowAccount, availableBalanceMinor: completed ? '1160000' : '1245000' }] });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const receipt = flow.visible();
    assert.match(receipt, /"Detalle"/);
    assert.match(receipt, /"Transferencia completada"/);
    assert.match(receipt, /"-\$850.00"/);
    assert.match(receipt, /13 de noviembre de 2026, 14:32 hrs/);
    assert.match(receipt, /DETALLE DE OPERACIÓN/);
    assert.match(receipt, /Confirmada y aplicada/);
    assert.match(receipt, /"Carlos Ruiz"/);
    assert.match(receipt, /"•• 0028"/);
    assert.match(receipt, /"•• 8412"/);
    assert.match(receipt, /DEMO-0001/);
    assert.match(receipt, /"Nuevo saldo disponible en ","Cuenta Principal",":"/);
    assert.match(receipt, /"\$11,600.00"/);
    assert.doesNotMatch(receipt, /\$12,450.00/, 'the pre-transfer balance must never be presented as the new balance');
    assert.doesNotMatch(receipt, /Compartir|Descargar PDF|cifrad|auditada/);
    await TestRenderer.act(async () => { flow.button('Ver últimos movimientos').props.onPress(); });
    assert.match(flow.visible(), /Últimos movimientos/);
    await flow.finish();
  });

  it('hides the new balance when the post-transfer account read fails', async () => {
    let completed = false;
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) { completed = true; return Response.json(completedTransfer, { status: 201 }); }
      if (url.endsWith('/transfers/transfer-done')) return Response.json(completedTransfer);
      if (url.endsWith('/accounts') && completed) return Response.json({ title: 'Service Unavailable' }, { status: 503 });
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait(60);
    const receipt = flow.visible();
    assert.match(receipt, /"Transferencia completada"/);
    assert.doesNotMatch(receipt, /Nuevo saldo disponible/);
    assert.doesNotMatch(receipt, /\$12,450.00/);
    await flow.finish();
  });
});

describe('mobile rejected transfer (M11)', () => {
  it('shows the API reason, the untouched balance and lets the user edit the same data without a recovery record', async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ title: 'Unprocessable Entity', detail: 'Se excedió el límite diario.' }, { status: 422 });
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const rejected = flow.visible();
    assert.match(rejected, /"Transferir"/);
    assert.doesNotMatch(rejected, /"TRANSFERIR"/);
    assert.match(rejected, /No se pudo completar la transferencia/);
    assert.match(rejected, /Se excedió el límite diario./);
    assert.match(rejected, /Tu dinero está intacto/);
    assert.match(rejected, /"Cuenta Principal •• 8412"/);
    assert.match(rejected, /"\$12,450.00 MXN"/);
    assert.match(rejected, /"Monto solicitado"/);
    assert.match(rejected, /"\$6,000.00 MXN"/);
    assert.match(rejected, /"Importe debitado"/);
    assert.match(rejected, /"\$0.00 MXN"/);
    assert.doesNotMatch(rejected, /comisión/);
    await TestRenderer.act(async () => { flow.button('Modificar monto o cuenta').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /PASO 1 DE 2/);
    assert.equal(flow.renderer.root.findByProps({ accessibilityLabel: 'Importe' }).props.value, '6000.00');
    assert.equal(mockSecureValues.has('wallet.transfer-recovery'), false);
    await flow.finish();
  });

  for (const [status, title, detail] of [[401, 'Unauthorized', 'Sesión vencida.'], [409, 'Conflict', 'La llave de idempotencia ya se usó con otros datos.'], [429, 'Too Many Requests', 'Demasiadas solicitudes.']] as const) {
    it(`F-09: a ${status} answer does not claim the money is intact`, async () => {
      const flow = await startTransferFlow((url) => {
        if (url.endsWith('/transfers')) return Response.json({ title, detail }, { status });
        return undefined;
      }, { amount: '6000.00' });
      await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
      await flow.wait();
      const rejected = flow.visible();
      assert.match(rejected, /No se pudo completar la transferencia/);
      assert.ok(rejected.includes(detail));
      assert.doesNotMatch(rejected, /Tu dinero está intacto|No se aplicó ningún cargo|Importe debitado|Ningún dinero fue retirado|"\$0.00 MXN"/);
      assert.match(rejected, /Revisa tu saldo antes de reintentar/);
      assert.match(rejected, /Consulta tus movimientos antes de volver a enviar/);
      await flow.finish();
    });
  }
});

describe('mobile background privacy (M12)', () => {
  it('replaces every balance with the branded privacy curtain in the background and restores the session on return', async () => {
    const listeners: Array<(state: string) => void> = [];
    // jest-expo already replaces addEventListener with a mock, so restore the exact original instead of mockRestore().
    const originalAddEventListener = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, listener: (state: string) => void) => {
      listeners.push(listener);
      return { remove: () => { listeners.splice(listeners.indexOf(listener), 1); } };
    }) as unknown as typeof AppState.addEventListener;
    try {
      const flow = await startTransferFlow((url) => {
        if (url.endsWith('/auth/me')) return Response.json({ id: 'u', fullName: 'Ana López', email: 'ana@example.com' });
        return undefined;
      }, { amount: '850.00' });
      assert.match(flow.visible(), /\$12,450.00/);
      await TestRenderer.act(async () => { listeners.forEach((listener) => listener('background')); });
      const curtain = flow.visible();
      assert.match(curtain, /Contenido oculto por privacidad/);
      assert.match(curtain, /Privacidad en segundo plano/);
      assert.equal(curtain.match(/"Billetera MXN"/g)?.length, 2, 'top bar and curtain card both carry the brand, as in the reference');
      assert.doesNotMatch(curtain, /\$12,450.00|8412|Carlos Ruiz|Ana López|"AL"/);
      assert.doesNotMatch(curtain, /256|biométric|SSL|Blindaje/);
      await TestRenderer.act(async () => { listeners.forEach((listener) => listener('active')); });
      await flow.wait();
      assert.match(flow.visible(), /"Paso 2 de 2"/, 'returning to the foreground resumes the same step');
      await flow.finish();
    } finally {
      AppState.addEventListener = originalAddEventListener;
    }
  });
});

describe('mobile login reference (M01)', () => {
  it('keeps the web-only registration notice and the technical-demo footer without unsupported claims', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const visible = JSON.stringify(renderer!.toJSON());
    assert.match(visible, /"¿No tienes cuenta\?"/);
    assert.match(visible, /exclusivamente desde el panel web de Billetera MXN/);
    assert.match(visible, /Billetera MXN • Demostración técnica/);
    assert.doesNotMatch(visible, /SIMULAR ESTADO|Versión \d|cifrada|SPEI|Alfanumérica/);
    await TestRenderer.act(async () => { renderer!.unmount(); });
  });
});

describe('mobile home reference (M02)', () => {
  it('shows the real update time, a primary transfer action and only the latest three movements with a link to the full list', async () => {
    const today = new Date();
    const items = ['Comida', 'Nómina', 'Renta', 'Farmacia'].map((concept, index) => ({ id: `home-m-${index}`, transferId: `home-t-${index}`, type: index === 1 ? 'credit' : 'debit', amountMinor: `${(index + 1) * 10000}`, currency: 'MXN', concept, reference: `${index + 1}`, status: 'completed', occurredAt: today.toISOString() }));
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'home-user', fullName: 'Ana López', email: 'ana@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount, { id: 'source-2', name: 'Ahorro', kind: 'savings', currency: 'MXN', availableBalanceMinor: '500000', clabe: '000000000000005931', clabeMasked: '000•••••••••••5931' }] });
      if (url.includes('/movements?limit=20')) return Response.json({ items, nextCursor: null });
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const visible = () => JSON.stringify(renderer!.toJSON());
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const home = visible();
    assert.match(home, /"Hola, ","Ana López"/);
    assert.match(home, /Actualizado hoy, \d{2}:\d{2} hrs/);
    assert.match(home, /"•• ","8412"/);
    assert.match(home, /"•• ","5931"/);
    assert.match(home, /Última actualización de saldo/);
    assert.match(home, /"Saldo total ","\$17,450.00"," MXN"/);
    assert.match(home, /"Transferir dinero"/);
    assert.match(home, /Actividad reciente/);
    assert.match(home, /Comida/);
    assert.match(home, /Renta/);
    assert.doesNotMatch(home, /Farmacia/, 'home shows only the latest three movements');
    assert.doesNotMatch(home, /Tus cuentas|Cargar más movimientos/);
    assert.equal(home.match(/\$12,450.00/g)?.length, 1, 'the selected balance appears once');
    await TestRenderer.act(async () => { button('Ver los últimos 20 movimientos').props.onPress(); });
    assert.match(visible(), /Últimos movimientos/);
    assert.match(visible(), /Farmacia/);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('F-08: opens on the principal account listed first even when the API returns savings first, with short tab labels', async () => {
    const savings = { id: 'source-2', name: 'Ahorro', kind: 'savings', currency: 'MXN', availableBalanceMinor: '500000', clabe: '000000000000005931', clabeMasked: '000•••••••••••5931' };
    const principal = { ...flowAccount, name: 'Cuenta principal', clabe: '000000000000000618', clabeMasked: '000•••••••••••0618' };
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'home-order-user', fullName: 'Ana López', email: 'ana@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [savings, principal] });
      if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const tabs = renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && /^(Cuenta principal|Ahorro) •• /.test(node.props.accessibilityLabel ?? ''));
    assert.deepEqual(tabs.map((tab) => tab.props.accessibilityLabel), ['Cuenta principal •• 0618', 'Ahorro •• 5931'], 'principal tab comes first');
    assert.equal(tabs[0]!.props.accessibilityState?.selected, true, 'home opens on the principal account');
    const home = JSON.stringify(renderer!.toJSON());
    assert.match(home, /"Principal"/, 'the tab uses the short reference label');
    assert.match(home, /CUENTA PRINCIPAL/);
    assert.equal(home.match(/\$12,450.00/g)?.length, 1, 'the principal balance is the one shown');
    const digits = tabs[0]!.findAll((node) => String(node.type).includes('Text') && Array.isArray(node.props.children) && node.props.children[0] === '•• ' && node.props.children[1] === '0618');
    assert.ok(digits.length > 0 && digits.every((node) => node.props.numberOfLines === 1), 'the tab digits never wrap');
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

// Round 6 (G2) regressions reproduced from the iPhone recording.
function installHermesLikeIntl() {
  const original = Intl.DateTimeFormat;
  class HermesLike {
    resolvedOptions() { return { timeZone: 'America/Mexico_City' }; }
    // The parts observed on device produced "a de undefined de 8, undefined:undefined hrs".
    formatToParts() { return [{ type: 'day', value: 'a' }, { type: 'year', value: '8' }]; }
    format() { return 'a'; }
  }
  Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, writable: true, value: HermesLike });
  return () => Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, writable: true, value: original });
}

async function loginWith(handler: FlowHandler) {
  mockSecureValues.clear();
  const calls: string[] = [];
  const fetchSpy = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    const handled = await handler(url, init);
    if (handled) return handled;
    if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: `g2-${Math.random()}`, fullName: 'Ana López', email: 'ana@example.com' } });
    throw new Error(`Unexpected API request: ${url}`);
  });
  Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
  let renderer: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
  const visible = () => JSON.stringify(renderer!.toJSON());
  const button = (title: string) => renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === title).length > 0)!;
  const wait = (ms = 30) => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
  await TestRenderer.act(async () => { button('Ingresar').props.onPress(); });
  await wait();
  const finish = async () => { await TestRenderer.act(async () => { renderer!.unmount(); }); delete (global as { fetch?: typeof fetch }).fetch; };
  return { renderer: renderer!, visible, button, wait, calls, finish };
}

describe('round 6 · A: business dates never render undefined (Hermes-like Intl)', () => {
  it('M04: a RECEIVED movement shows "De", "+", "Recibida" and a valid business date without reading the sender-only transfer', async () => {
    const restore = installHermesLikeIntl();
    try {
      const app = await loginWith((url) => {
        if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount] });
        if (url.includes('/accounts/source-1/movements?limit=20')) return Response.json({ items: [{ id: 'mv-in', transferId: 'tr-in', type: 'credit', amountMinor: '125000', currency: 'MXN', concept: 'Honorarios', reference: '994012', status: 'completed', occurredAt: '2026-11-13T20:32:00.123Z', counterparty: { name: 'Beto Destino', clabeMasked: '646•••••••••••1234' } }], nextCursor: null });
        if (url.includes('/transfers/')) return Response.json({ title: 'Not Found', status: 404 }, { status: 404 });
        return undefined;
      });
      const movementsTab = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'tab').find((node) => node.findAll((child) => child.props.children === 'Movimientos').length > 0)!;
      await TestRenderer.act(async () => { movementsTab.props.onPress(); });
      await app.wait();
      assert.match(app.visible(), /"De Beto Destino"/);
      const row = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.startsWith('Abono '))[0]!;
      await TestRenderer.act(async () => { row.props.onPress(); });
      await app.wait();
      const detail = app.visible();
      assert.match(detail, /"Transferencia recibida"/);
      assert.match(detail, /"Recibida"/);
      assert.match(detail, /"\+\$1,250.00"/);
      assert.match(detail, /"De"/);
      assert.match(detail, /"Beto Destino"," •• 1234"/);
      assert.match(detail, /"Cuenta destino"/);
      assert.match(detail, /13 de noviembre de 2026, 14:32 hrs/);
      assert.match(detail, /Tiempo del Centro de México/);
      assert.doesNotMatch(detail, /undefined|NaN|Invalid Date/);
      assert.equal(app.calls.filter((url) => url.includes('/transfers/')).length, 0, 'the receiver cannot read the sender transfer');
      await app.finish();
    } finally { restore(); }
  });

  it('M10: the receipt of a SENT transfer shows "Para", "-" and a valid business date', async () => {
    const restore = installHermesLikeIntl();
    try {
      const done = flowTransfer({ id: 'transfer-done', status: 'completed', amountMinor: '85000', createdAt: '2026-11-13T20:31:59.000Z', completedAt: '2026-11-13T20:32:00.456Z', receiptReference: 'transfer-done' });
      const flow = await startTransferFlow((url) => {
        if (url.endsWith('/transfers')) return Response.json(done, { status: 201 });
        if (url.endsWith('/transfers/transfer-done')) return Response.json(done);
        return undefined;
      }, { amount: '850.00' });
      await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
      await flow.wait();
      const receipt = flow.visible();
      assert.match(receipt, /"Transferencia completada"/);
      assert.match(receipt, /"-\$850.00"/);
      assert.match(receipt, /"Para"/);
      assert.match(receipt, /13 de noviembre de 2026, 14:32 hrs \(Tiempo del Centro de México\)/);
      assert.doesNotMatch(receipt, /undefined|NaN|Invalid Date/);
      await flow.finish();
    } finally { restore(); }
  });

  it('shows "Fecha no disponible" instead of a broken date when the timestamp is invalid', async () => {
    const app = await loginWith((url) => {
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount] });
      if (url.includes('/movements?limit=20')) return Response.json({ items: [{ id: 'mv-x', transferId: 'tr-x', type: 'credit', amountMinor: '100', currency: 'MXN', concept: 'Sin fecha', reference: '1', status: 'completed', occurredAt: 'not-a-date', counterparty: { name: 'Beto', clabeMasked: '646•••••••••••1234' } }], nextCursor: null });
      return undefined;
    });
    const row = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.startsWith('Abono '))[0]!;
    await TestRenderer.act(async () => { row.props.onPress(); });
    const detail = app.visible();
    assert.match(detail, /Fecha no disponible/);
    assert.doesNotMatch(detail, /undefined|NaN|Invalid Date|Tiempo del Centro/);
    await app.finish();
  });
});

describe('round 6 · F: one money format everywhere', () => {
  it('groups thousands on Home, account tabs and totals even when BigInt#toLocaleString does not group (Hermes)', async () => {
    const original = BigInt.prototype.toLocaleString;
    BigInt.prototype.toLocaleString = function toLocaleString(this: bigint) { return this.toString(); };
    try {
      const app = await loginWith((url) => {
        if (url.endsWith('/accounts')) return Response.json({ items: [{ ...flowAccount, availableBalanceMinor: '994000' }, { ...flowAccount, id: 'savings-1', name: 'Ahorro', kind: 'savings', availableBalanceMinor: '505000', clabeMasked: '646•••••••••••5719' }] });
        if (url.includes('/movements?limit=20')) return Response.json({ items: [{ id: 'mv-1', transferId: 't1', type: 'debit', amountMinor: '1500000', currency: 'MXN', concept: 'Renta', reference: '1', status: 'completed', occurredAt: '2026-11-13T20:32:00.000Z', counterparty: { name: 'Carlos Ruiz', clabeMasked: '000•••••••••••0028' } }], nextCursor: null });
        return undefined;
      });
      const home = app.visible();
      assert.match(home, /\$9,940.00/);
      assert.match(home, /\$14,990.00/);
      assert.match(home, /-\$15,000.00 MXN/);
      assert.doesNotMatch(home, /\$9940\.00|\$5050\.00|\$15000\.00|\$14990\.00/);
      await app.finish();
    } finally {
      BigInt.prototype.toLocaleString = original;
    }
  });
});

describe('round 6 · E: sending, verifying, completed, rejected, expired and cancelled are distinct', () => {
  it('a normal request in flight is "Enviando" with neutral copy, never the uncertain-result screen', async () => {
    let release: (response: Response) => void = () => undefined;
    const done = flowTransfer({ id: 'tr-10', status: 'completed', amountMinor: '1000', completedAt: '2026-11-13T20:32:00.000Z' });
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return new Promise<Response>((resolve) => { release = resolve; });
      if (url.endsWith('/transfers/tr-10')) return Response.json(done);
      return undefined;
    }, { amount: '10' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    const sending = flow.visible();
    assert.match(sending, /Enviando transferencia…/);
    assert.doesNotMatch(sending, /Verificando|Consultando operación|Protección contra duplicados|No intentes enviar|No pudimos confirmar|intacto/);
    await TestRenderer.act(async () => { release(Response.json(done, { status: 201 })); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/);
    await flow.finish();
  });

  it('only a lost response turns into "Verificando resultado" and the retry reuses the same key', async () => {
    const keys: string[] = [];
    let attempts = 0;
    let release: (response: Response) => void = () => undefined;
    const done = flowTransfer({ id: 'tr-11', status: 'completed', amountMinor: '1000', completedAt: '2026-11-13T20:32:00.000Z' });
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        keys.push((init.headers as Record<string, string>)['Idempotency-Key']!);
        attempts += 1;
        if (attempts === 1) throw new Error('network lost');
        return new Promise<Response>((resolve) => { release = resolve; });
      }
      if (url.endsWith('/transfers/tr-11')) return Response.json(done);
      return undefined;
    }, { amount: '10' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Estamos verificando si tu transferencia se completó/);
    await TestRenderer.act(async () => { flow.button('Verificar estado de la transferencia').props.onPress(); });
    // Loading button renders an ActivityIndicator; the title says what is happening to the same attempt.
    assert.match(flow.visible(), /Verificando resultado…/);
    await TestRenderer.act(async () => { release(Response.json(done, { status: 201 })); });
    await flow.wait();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.match(flow.visible(), /"Transferencia completada"/);
    await flow.finish();
  });

  it.each([
    ['expired', /El código de esta operación expiró/],
    ['cancelled', /Operación cancelada/],
  ])('an API status "%s" shows a closed attempt without postings, never the receipt', async (status, title) => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json(flowTransfer({ id: 'tr-closed', status, amountMinor: '600000' }), { status: 200 });
      return undefined;
    }, { amount: '6000' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const screen = flow.visible();
    assert.match(screen, title);
    assert.match(screen, /No se movió dinero/);
    assert.doesNotMatch(screen, /Transferencia completada|Confirmada y aplicada|Nuevo saldo/);
    assert.equal(mockSecureValues.get('wallet.transfer-recovery'), undefined, 'a terminal attempt leaves no recovery record');
    await flow.finish();
  });

  it('checking an uncertain attempt that the server expired goes to the closed screen', async () => {
    mockSecureValues.set('wallet.refresh-token', 'refresh');
    mockSecureValues.set('wallet.transfer-recovery', JSON.stringify({ key: 'key-1', payload: { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '600000', concept: 'Comida', reference: '131126' }, transferId: 'tr-exp' }));
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return Response.json({ accessToken: 'access', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 300, user: { id: 'restart-user', fullName: 'Ana López', email: 'ana@example.com' } });
      if (url.endsWith('/transfers/tr-exp')) return Response.json(flowTransfer({ id: 'tr-exp', status: 'expired' }));
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount] });
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    assert.match(JSON.stringify(renderer!.toJSON()), /El código de esta operación expiró/);
    assert.equal(mockSecureValues.get('wallet.transfer-recovery'), undefined);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

const savingsAccount = { id: 'savings-1', name: 'Ahorro', kind: 'savings', currency: 'MXN', availableBalanceMinor: '500000', clabe: '646000000000005719', clabeMasked: '646•••••••••••5719' };
const ownSavingsBeneficiary = { id: 'b-own', name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabeMasked: '646•••••••••••5719', destinationAccountId: 'savings-1', ownAccountId: 'savings-1' };

async function sameAccountApp(options: { beneficiaries?: unknown[]; onCreate?: (body: Record<string, string>) => Response } = {}) {
  const createBodies: Array<Record<string, string>> = [];
  const app = await loginWith((url, init) => {
    if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount, savingsAccount] });
    if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
    if (url.endsWith('/beneficiaries')) return Response.json({ items: options.beneficiaries ?? [ownSavingsBeneficiary, flowBeneficiary] });
    if (url.endsWith('/transfer-policy')) return Response.json({ currency: 'MXN', businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City', dailyLimitMinor: '2000000', dailyUsedMinor: '0', dailyRemainingMinor: '2000000', otpThresholdMinor: '500000', otpExpirySeconds: 300, otpMaxAttempts: 5, demoOnly: true });
    if (url.endsWith('/transfers') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      createBodies.push(body);
      return options.onCreate ? options.onCreate(body) : Response.json(flowTransfer({ id: 'tr-ok', status: 'completed', sourceAccountId: body.sourceAccountId, destination: ownSavingsBeneficiary, amountMinor: body.amountMinor, completedAt: '2026-11-13T20:32:00.000Z' }), { status: 201 });
    }
    if (url.endsWith('/transfers/tr-ok')) return Response.json(flowTransfer({ id: 'tr-ok', status: 'completed', destination: ownSavingsBeneficiary, amountMinor: createBodies[0]?.amountMinor ?? '100', completedAt: '2026-11-13T20:32:00.000Z' }));
    return undefined;
  });
  const press = async (label: string) => { await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: label }).props.onPress(); }); await app.wait(); };
  const fill = async (amount: string) => {
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Importe' }).props.onChangeText(amount); });
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Ahorro mensual'); app.renderer.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('1546'); });
  };
  const choose = async (prefix: string) => { await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith(`Seleccionar ${prefix}`) && typeof node.props.onPress === 'function')[0]!.props.onPress(); }); await app.wait(); };
  const continueButton = () => app.button('Continuar');
  return { ...app, press, fill, choose, continueButton, createBodies };
}

describe('round 6 · B/C/D: origin = destination is decided by account identity before sending', () => {
  it('M05: from Ahorro, the own "Cuenta de ahorro demo" beneficiary is disabled and explained; Carlos stays available', async () => {
    const app = await sameAccountApp();
    await app.press('Ahorro •• 5719');
    await app.press('Elegir beneficiario');
    const own = app.renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Cuenta de ahorro demo') && typeof node.props.onPress === 'function')[0]!;
    assert.equal(own.props.disabled, true);
    assert.match(own.props.accessibilityLabel, /misma cuenta de origen/);
    await TestRenderer.act(async () => { own.props.onPress(); });
    assert.match(app.visible(), /Elegir beneficiario/, 'tapping the incompatible destination does nothing');
    assert.match(app.visible(), /Es tu cuenta de origen/);
    const carlos = app.renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos') && typeof node.props.onPress === 'function')[0]!;
    assert.notEqual(carlos.props.disabled, true);
    await app.finish();
  });

  it('changing the origin to the destination account (Home tab or M06 selector) invalidates the beneficiary and blocks Continuar; no POST', async () => {
    const app = await sameAccountApp();
    await app.press('Elegir beneficiario');
    await app.choose('Cuenta de ahorro demo');
    // Home tab changed after choosing the destination: the combination becomes invalid.
    await app.press('Ahorro •• 5719');
    assert.match(app.visible(), /Es la misma cuenta de origen seleccionada/);
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.fill('100');
    assert.match(app.visible(), /La cuenta de origen y el destino son la misma cuenta/);
    assert.equal(app.continueButton().props.disabled, true);
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    assert.doesNotMatch(app.visible(), /Revisar transferencia|Saldo posterior estimado/, 'D: no review or estimate for an invalid combination');
    // M06 origin selector: choosing Principal makes it valid again (own accounts that differ are allowed).
    await app.press('Cambiar cuenta de origen');
    await app.press('Usar Cuenta Principal •• 8412 como cuenta de origen');
    assert.doesNotMatch(app.visible(), /La cuenta de origen y el destino son la misma cuenta/);
    assert.notEqual(app.continueButton().props.disabled, true);
    // ...and back to Ahorro invalidates it again.
    await app.press('Usar Ahorro •• 5719 como cuenta de origen, es el destino elegido');
    assert.equal(app.continueButton().props.disabled, true);
    assert.equal(app.createBodies.length, 0);
    await app.finish();
  });

  it('Principal -> Ahorro (different own accounts) stays valid, shows the BigInt estimate and sends that exact payload', async () => {
    const app = await sameAccountApp();
    await app.press('Elegir beneficiario');
    await app.choose('Cuenta de ahorro demo');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.fill('100');
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    assert.match(app.visible(), /Saldo posterior estimado/);
    assert.match(app.visible(), /"\$12,450.00"," - ","\$100.00"," = ","\$12,350.00"," MXN"/);
    await TestRenderer.act(async () => { app.button('Confirmar transferencia').props.onPress(); });
    await app.wait();
    assert.equal(app.createBodies.length, 1);
    assert.deepEqual(app.createBodies[0], { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'b-own', amountMinor: '10000', concept: 'Ahorro mensual', reference: '1546' });
    await app.finish();
  });

  it('M11: "Modificar monto o cuenta" after an origin=destination 422 opens the origin selector, keeps the data and warns before resending the same combination', async () => {
    // An older beneficiary payload without ownAccountId: only the API can detect the conflict.
    const legacy = { ...ownSavingsBeneficiary, ownAccountId: undefined };
    const app = await sameAccountApp({ beneficiaries: [legacy], onCreate: () => Response.json({ title: 'Unprocessable', status: 422, detail: 'El origen y destino deben ser distintos.' }, { status: 422 }) });
    await app.press('Ahorro •• 5719');
    await app.press('Elegir beneficiario');
    await app.choose('Cuenta de ahorro demo');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.fill('100');
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    await TestRenderer.act(async () => { app.button('Confirmar transferencia').props.onPress(); });
    await app.wait();
    assert.match(app.visible(), /El origen y destino deben ser distintos/);
    await TestRenderer.act(async () => { app.button('Modificar monto o cuenta').props.onPress(); });
    const details = app.visible();
    assert.match(details, /Datos de la operación/);
    assert.ok(app.renderer.root.findByProps({ accessibilityLabel: 'Usar Cuenta Principal •• 8412 como cuenta de origen' }), 'the origin selector is open');
    assert.equal(app.renderer.root.findByProps({ accessibilityLabel: 'Importe' }).props.value, '100');
    assert.equal(app.renderer.root.findByProps({ accessibilityLabel: 'Concepto' }).props.value, 'Ahorro mensual');
    assert.equal(app.renderer.root.findByProps({ accessibilityLabel: 'Referencia' }).props.value, '1546');
    // Resending the very same combination is not silent.
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    assert.match(app.visible(), /iguales a los del intento rechazado/);
    await TestRenderer.act(async () => { app.button('Modificar datos').props.onPress(); });
    await app.press('Usar Cuenta Principal •• 8412 como cuenta de origen');
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    assert.doesNotMatch(app.visible(), /iguales a los del intento rechazado/);
    assert.match(app.visible(), /"Cuenta Principal •• 8412"/);
    await app.finish();
  });

  it('M05: when every destination is the origin itself, an explanatory empty state offers changing the origin', async () => {
    const app = await sameAccountApp({ beneficiaries: [ownSavingsBeneficiary] });
    await app.press('Ahorro •• 5719');
    await app.press('Elegir beneficiario');
    assert.match(app.visible(), /No hay destinos disponibles desde Ahorro •• 5719/);
    await app.press('Usar Cuenta Principal •• 8412 como cuenta de origen');
    assert.doesNotMatch(app.visible(), /No hay destinos disponibles/);
    await app.choose('Cuenta de ahorro demo');
    assert.match(app.visible(), /DESTINO SELECCIONADO/);
    await app.finish();
  });
});
