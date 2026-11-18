import React from 'react';
import assert from 'node:assert/strict';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, PixelRatio, ScrollView, StyleSheet } from 'react-native';
import TestRenderer from 'react-test-renderer';
import App from '../App';
import { formatMoney } from '../src/money';

jest.mock('../App', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
  return jest.requireActual('../App');
});

const mockSecureValues = new Map<string, string>();
// F-22: recovery records live under one key per user ("wallet.transfer-recovery.<userId>"); the bare key is the legacy
// (pre-round-8) slot. These helpers see both, so "no record left" means none under any key.
const RECOVERY_KEY = 'wallet.transfer-recovery';
const recoveryKeyOf = (userId: string) => `${RECOVERY_KEY}.${userId}`;
const storedRecovery = () => [...mockSecureValues.entries()].find(([key]) => key === RECOVERY_KEY || key.startsWith(`${RECOVERY_KEY}.`))?.[1];
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

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn(() => Promise.resolve()) }));

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
    assert.match(visible(), /Iniciar sesión/);
    assert.match(visible(), /exclusivamente desde la versión web/);
    assert.doesNotMatch(visible(), /Crear cuenta|Registrarme/);

    const input = renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' });
    await TestRenderer.act(async () => { input!.props.onChangeText('correo-inválido'); });
    const submit = renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === 'Iniciar sesión').length > 0);
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
    await TestRenderer.act(async () => { findButton('Iniciar sesión').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    secureStore.deleteItemAsync.mockClear();
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });

    const logout = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/auth/logout')) as [RequestInfo | URL, RequestInit?] | undefined;
    assert.ok(logout);
    assert.deepEqual(JSON.parse(String(logout[1]?.body)), { client: 'mobile', refreshToken: 'refresh-secret' });
    assert.equal((logout[1]?.headers as Record<string, string>).Authorization, 'Bearer access-secret');
    // Round 8 (F-21/F-22): logout deletes the refresh token only; a pending-transfer record is never deleted by it.
    assert.deepEqual(Array.from(secureStore.deleteItemAsync.mock.calls, ([key]) => String(key)), ['wallet.refresh-token']);
    assert.match(JSON.stringify(renderer!.toJSON()), /Iniciar sesión/);
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
    const login = renderer!.root.findAll((node) => typeof node.props.onPress === 'function').find((node) => node.findAll((child) => String(child.type).includes('Text') && child.props.children === 'Iniciar sesión').length > 0)!;
    await TestRenderer.act(async () => { login.props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    secureStore.deleteItemAsync.mockClear();
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });

    assert.equal(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/auth/logout')).length, 1);
    assert.deepEqual(Array.from(secureStore.deleteItemAsync.mock.calls, ([key]) => String(key)), ['wallet.refresh-token']);
    assert.match(JSON.stringify(renderer!.toJSON()), /Iniciar sesión/);
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    {
      const homeScreen = JSON.stringify(renderer!.toJSON());
      const balanceIndex = homeScreen.indexOf('Saldo disponible');
      const transferEntryIndex = homeScreen.indexOf('Transferir dinero');
      assert.ok(balanceIndex >= 0 && transferEntryIndex >= 0, 'home screen must show both the account balance and the transfer entry point');
      assert.ok(balanceIndex < transferEntryIndex, 'the account balance must render above the transfer entry point, matching the approved M02 composition');
    }
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
    assert.ok(beneficiaryButton);
    await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
    const amountInput = renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' });
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
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('123'); });
    await TestRenderer.act(async () => { button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
    const createCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/transfers')) as [RequestInfo | URL, RequestInit?][];
    assert.equal(createCalls().length, 1);
    const first = createCalls()[0];
    assert.ok(first);
    const firstBody = String(first[1]?.body);
    const firstPayload = JSON.parse(firstBody);
    const firstKey = (first[1]?.headers as Record<string, string>)['Idempotency-Key'];
    const persisted = JSON.parse(mockSecureValues.get(recoveryKeyOf('u1'))!);
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
    assert.equal(JSON.parse(mockSecureValues.get(recoveryKeyOf('u1'))!).transferId, 'transfer-1');
    assert.equal(renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.value, '');
    assert.doesNotMatch([...mockSecureValues.values()].join('|'), /654321|demoOnlyCode/);
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('654321'); });
    await TestRenderer.act(async () => { button('Autorizar transferencia').props.onPress(); });
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Grace Hopper'));
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('folio-1'));
    assert.equal(storedRecovery(), undefined);
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
    assert.ok(beneficiaryButton);
    await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('50.00'); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Ahorro'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('914'); });
    await TestRenderer.act(async () => { button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('914823'); });
    await TestRenderer.act(async () => { button('Autorizar transferencia').props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

    assert.equal(confirmCalls, 1, 'an uncertain result must not retry the confirm POST automatically');
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('Grace Hopper'), 'the real receipt must be shown, not a dead-end error screen');
    assert.ok(JSON.stringify(renderer!.toJSON()).includes('folio-2'));
    assert.equal(storedRecovery(), undefined);

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
      await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
      await TestRenderer.act(async () => { await Promise.resolve(); });
      await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
      await TestRenderer.act(async () => { await Promise.resolve(); });
      await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
      assert.ok(beneficiaryButton);
      await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
      await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
      await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('100.00'); });
      await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Abono'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('1546'); });
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
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
    const movement = renderer!.root.findAll((node) => node.props.accessibilityLabel?.endsWith(', Cargo'))[0];
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
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
    await TestRenderer.act(async () => { renderer!.root.find((node) => /^Principal \(•• \d{4}\), cambiar cuenta$/.test(node.props.accessibilityLabel ?? '')).props.onPress(); });
    await TestRenderer.act(async () => { renderer!.root.find((node) => /^Ahorro \(•• \d{4}\), .*ver sus movimientos$/.test(node.props.accessibilityLabel ?? '')).props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.ok(calls.some((url) => url.includes('/accounts/own-2/movements?limit=20')));
    assert.match(visible(), /Farmacia/);
    assert.ok(renderer!.root.find((node) => /^Ahorro \(•• \d{4}\), cambiar cuenta$/.test(node.props.accessibilityLabel ?? '')));

    const movement = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.endsWith(', Cargo'))[0]!;
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
    await wait();
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0]!.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });

    assert.match(visible(), /PASO 1 DE 2/);
    assert.match(visible(), /50% completado/);
    assert.match(visible(), /Beneficiario destino/);
    assert.match(visible(), /Grace Hopper/);
    assert.match(visible(), /"Principal •• 8412"/);
    assert.doesNotMatch(visible(), /Límite diario/, 'the API exposes no daily limit, so none may be shown');
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('850.00'); });

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
    assert.equal(renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.value, '850.00', 'typed amount survives changing the beneficiary');

    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('131126'); });
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

type FlowHandler = (url: string, init?: RequestInit) => Response | Promise<Response | undefined> | undefined;
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
  await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
  await wait();
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Transferir dinero, elegir beneficiario' }).props.onPress(); });
  await wait();
  await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Carlos'))[0]!.props.onPress(); });
  await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText(options.amount); });
  await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('131126'); });
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
      if (url.endsWith('/transfers/transfer-flow/cancel')) return Response.json(flowTransfer({ status: 'cancelled' }));
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
    await flow.wait();
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

    await TestRenderer.act(async () => { flow.button('Solicitar un código nuevo').props.onPress(); });
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
    assert.match(uncertain, /" \(Ref: ",.{0,140}"children":\["131126"\]\},"\)"/);
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
    const persisted = storedRecovery();
    assert.ok(persisted);
    await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Hola, /);
    assert.equal(storedRecovery(), persisted, 'the unresolved attempt must stay recoverable');
    // F-21: Home re-checks the attempt on its own, only by replaying the SAME key (never a new attempt).
    const creates = flow.calls.filter((call) => call.url.endsWith('/transfers'));
    assert.ok(creates.length >= 1 && creates.length <= 2);
    assert.equal(new Set(creates.map((call) => (call.init?.headers as Record<string, string>)['Idempotency-Key'])).size, 1);
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
    // Round 7 H2: the optional receipt actions are real (native share sheet); no unsupported claims.
    assert.match(receipt, /Opciones de comprobante \(opcional\)/);
    assert.match(receipt, /"Compartir comprobante"/);
    assert.match(receipt, /"Guardar PDF"/);
    assert.doesNotMatch(receipt, /Descargar PDF|cifrad|auditada/);
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
    assert.match(rejected, /supera lo disponible hoy según el límite diario de demostración/, 'round 7 · 7: the limit reason is explained with the amount');
    assert.match(rejected, /Tu dinero está intacto/);
    assert.match(rejected, /"Principal •• 8412"/);
    assert.match(rejected, /"\$12,450.00 MXN"/);
    assert.match(rejected, /"Monto solicitado"/);
    assert.match(rejected, /"\$6,000.00 MXN"/);
    assert.match(rejected, /"Importe debitado"/);
    assert.match(rejected, /"\$0.00 MXN"/);
    assert.doesNotMatch(rejected, /comisión/);
    await TestRenderer.act(async () => { flow.button('Modificar monto o cuenta').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /PASO 1 DE 2/);
    assert.equal(flow.renderer.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.value, '6000.00');
    assert.equal(storedRecovery(), undefined);
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
    assert.match(visible, /exclusivamente desde la versión web de Billetera MXN/);
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
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
    await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
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
  await TestRenderer.act(async () => { button('Iniciar sesión').props.onPress(); });
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
      const row = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.endsWith(', Abono'))[0]!;
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
    const row = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.endsWith(', Abono'))[0]!;
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
    assert.equal(storedRecovery(), undefined, 'a terminal attempt leaves no recovery record');
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
    assert.equal(storedRecovery(), undefined, 'the legacy record was migrated to its owner and removed once resolved');
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
  // F-20: names carry the visible detail after the action ("…, Disponible: $X MXN"), so a prefix up to a comma is enough.
  const press = async (label: string) => { await TestRenderer.act(async () => { app.renderer.root.findAll((node) => typeof node.props.onPress === 'function' && (node.props.accessibilityLabel === label || String(node.props.accessibilityLabel ?? '').startsWith(`${label}, `)))[0]!.props.onPress(); }); await app.wait(); };
  const fill = async (amount: string) => {
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText(amount); });
    await TestRenderer.act(async () => { app.renderer.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.onChangeText('Ahorro mensual'); app.renderer.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.onChangeText('1546'); });
  };
  const choose = async (prefix: string) => { await TestRenderer.act(async () => { app.renderer.root.findAll((node) => node.props.accessibilityLabel?.startsWith(`Seleccionar ${prefix}`) && typeof node.props.onPress === 'function')[0]!.props.onPress(); }); await app.wait(); };
  const continueButton = () => app.button('Continuar');
  return { ...app, press, fill, choose, continueButton, createBodies };
}

describe('round 6 · B/C/D: origin = destination is decided by account identity before sending', () => {
  it('M05: from Ahorro, the own "Cuenta de ahorro demo" beneficiary is disabled and explained; Carlos stays available', async () => {
    const app = await sameAccountApp();
    await app.press('Ahorro •• 5719');
    await app.press('Transferir dinero, elegir beneficiario');
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
    await app.press('Transferir dinero, elegir beneficiario');
    await app.choose('Cuenta de ahorro demo');
    // Home tab changed after choosing the destination: the combination becomes invalid.
    await app.press('Ahorro •• 5719');
    assert.match(app.visible(), /Es la misma cuenta de origen seleccionada/);
    // Round 7 · 1: Home no longer offers "Continuar" for this pair; back on Principal, M06 can still be made invalid.
    assert.equal(Boolean(app.button('Continuar con transferencia')), false);
    await app.press('Cuenta Principal •• 8412');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.press('Cambiar cuenta de origen');
    await app.press('Usar Ahorro •• 5719 como cuenta de origen, es el destino elegido');
    await app.fill('100');
    assert.match(app.visible(), /La cuenta de origen y el destino son la misma cuenta/);
    assert.equal(app.continueButton().props.disabled, true);
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    assert.doesNotMatch(app.visible(), /Revisar transferencia|Saldo posterior estimado/, 'D: no review or estimate for an invalid combination');
    // M06 origin selector: choosing Principal makes it valid again (own accounts that differ are allowed).
    await app.press('Usar Cuenta Principal •• 8412 como cuenta de origen');
    assert.doesNotMatch(app.visible(), /La cuenta de origen y el destino son la misma cuenta/);
    assert.notEqual(app.continueButton().props.disabled, true);
    // ...and back to Ahorro invalidates it again.
    await app.press('Usar Ahorro •• 5719 como cuenta de origen, es el destino elegido');
    assert.equal(app.continueButton().props.disabled, true);
    assert.equal(app.createBodies.length, 0);
    await app.finish();
  });

  it('round 7 · 1: M02 with origin Ahorro and saved destination Ahorro offers "Elegir otro destinatario" (to M05), never "Continuar"', async () => {
    const app = await sameAccountApp();
    await app.press('Transferir dinero, elegir beneficiario');
    await app.choose('Cuenta de ahorro demo');
    assert.ok(app.button('Continuar con transferencia'), 'Principal -> Ahorro is a valid pair');
    assert.equal(Boolean(app.button('Elegir otro destinatario')), false);
    await app.press('Ahorro •• 5719');
    assert.match(app.visible(), /Es la misma cuenta de origen seleccionada/);
    assert.equal(Boolean(app.button('Continuar con transferencia')), false, 'an incompatible pair never shows "Continuar con transferencia"');
    await TestRenderer.act(async () => { app.button('Elegir otro destinatario').props.onPress(); });
    await app.wait();
    const picker = app.visible();
    assert.match(picker, /Elegir beneficiario/);
    assert.match(picker, /Un destino que es esta misma cuenta no está disponible/);
    assert.ok(app.renderer.root.findAll((node) => String(node.props.accessibilityLabel ?? '').startsWith('Usar Cuenta Principal •• 8412 como cuenta de origen')).length > 0, 'M05 offers changing the origin');
    assert.doesNotMatch(picker, /Revisar transferencia|Datos de la operación/);
    // Choosing another destination (Carlos) from M05 makes Home valid again.
    await app.choose('Carlos');
    assert.ok(app.button('Continuar con transferencia'));
    assert.equal(app.createBodies.length, 0);
    await app.finish();
  });

  it('Principal -> Ahorro (different own accounts) stays valid, shows the BigInt estimate and sends that exact payload', async () => {
    const app = await sameAccountApp();
    await app.press('Transferir dinero, elegir beneficiario');
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
    await app.press('Transferir dinero, elegir beneficiario');
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
    assert.ok(app.renderer.root.findAll((node) => String(node.props.accessibilityLabel ?? '').startsWith('Usar Cuenta Principal •• 8412 como cuenta de origen, '))[0], 'the origin selector is open');
    assert.equal(app.renderer.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.value, '100');
    assert.equal(app.renderer.root.findByProps({ accessibilityLabel: 'Concepto de pago' }).props.value, 'Ahorro mensual');
    assert.equal(app.renderer.root.findByProps({ accessibilityLabel: 'Referencia numérica (hasta 7 dígitos)' }).props.value, '1546');
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
    await app.press('Transferir dinero, elegir beneficiario');
    assert.match(app.visible(), /No hay destinos disponibles desde Ahorro •• 5719/);
    await app.press('Usar Cuenta Principal •• 8412 como cuenta de origen');
    assert.doesNotMatch(app.visible(), /No hay destinos disponibles/);
    await app.choose('Cuenta de ahorro demo');
    assert.match(app.visible(), /DESTINO SELECCIONADO/);
    await app.finish();
  });
});

const demoPolicy = (overrides: Record<string, unknown> = {}) => ({ currency: 'MXN', businessDate: '2026-11-13', businessTimeZone: 'America/Mexico_City', dailyLimitMinor: '2000000', dailyUsedMinor: '175156', dailyRemainingMinor: '1824844', otpThresholdMinor: '500000', otpExpirySeconds: 300, otpMaxAttempts: 5, demoOnly: true, ...overrides });

describe('round 6 · H: server transfer policy, threshold variant and real code expiry', () => {
  it('M06 shows the server daily limit and remaining amount (demo) and blocks an amount above what is left today', async () => {
    const flow = await startTransferFlow((url) => (url.endsWith('/transfer-policy') ? Response.json(demoPolicy()) : undefined), { amount: '18248.45', accounts: () => [{ ...flowAccount, availableBalanceMinor: '5000000' }] });
    // startTransferFlow pressed Continuar before the policy arrived (the API would still reject it); back to details.
    await TestRenderer.act(async () => { flow.button('Modificar datos').props.onPress(); });
    await flow.wait();
    const details = flow.visible();
    assert.match(details, /"Límite diario: ","\$20,000.00 MXN"/);
    assert.match(details, /"\$18,248.44 MXN"/);
    assert.match(details, /límites de demostración/);
    assert.match(details, /supera lo disponible hoy/);
    assert.equal(flow.button('Continuar').props.disabled, true);
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Monto a transferir' }).props.onChangeText('18248.44'); });
    assert.notEqual(flow.button('Continuar').props.disabled, true);
    await flow.finish();
  });

  it.each([
    ['5000.00', true],
    ['4999.99', false],
  ])('M07 with %s against a 500000 threshold (BigInt >=) requires code: %s', async (amount, otp) => {
    const flow = await startTransferFlow((url) => (url.endsWith('/transfer-policy') ? Response.json(demoPolicy({ dailyRemainingMinor: '2000000' })) : undefined), { amount });
    await flow.wait();
    const review = flow.visible();
    if (otp) {
      assert.match(review, /Operación mayor o igual a \$5,000.00 MXN requiere código de autorización/);
      assert.ok(flow.button('Continuar a verificación'));
    } else {
      assert.doesNotMatch(review, /requiere código de autorización/);
      assert.ok(flow.button('Confirmar transferencia'));
    }
    await flow.finish();
  });

  it('M08 counts down from Transfer.expiresAt, then shows the real expired state; "Solicitar nuevo código" cancels and creates a new attempt with a new key', async () => {
    const keys: string[] = [];
    let created = 0;
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        keys.push((init.headers as Record<string, string>)['Idempotency-Key']!);
        created += 1;
        // First attempt: 2 s left. Second attempt: a fresh 5-minute code.
        const expiresAt = new Date(Date.now() + (created === 1 ? 1500 : 300_000)).toISOString();
        return Response.json({ ...flowTransfer({ id: `tr-otp-${created}`, expiresAt }), demoOnlyCode: '123456' }, { status: 202 });
      }
      if (url.endsWith('/cancel')) return Response.json(flowTransfer({ id: 'tr-otp-1', status: 'cancelled' }));
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /El código expira en /);
    assert.match(flow.visible(), /"00:0[12]"/);
    await flow.wait(2200);
    const expired = flow.visible();
    assert.match(expired, /El código ha expirado/);
    assert.equal(flow.button('Autorizar transferencia').props.disabled, true);
    await TestRenderer.act(async () => { flow.button('Solicitar un código nuevo').props.onPress(); });
    await flow.wait();
    const cancelCalls = flow.calls.filter((call) => call.url.endsWith('/transfers/tr-otp-1/cancel'));
    assert.equal(cancelCalls.length, 1);
    assert.equal(cancelCalls[0]!.init?.method, 'POST');
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1], 'a new code is a new attempt with a new Idempotency-Key');
    assert.match(flow.visible(), /"0[45]:[0-5]\d"/);
    assert.doesNotMatch(flow.visible(), /El código ha expirado/);
    await flow.finish();
  });
});

describe('round 6 · G (F-10): leaving the code step cancels the pending attempt', () => {
  it('"Cancelar y volver a revisar" cancels the pending transfer, clears the recovery record and a new confirm uses a new key', async () => {
    const keys: string[] = [];
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') {
        keys.push((init.headers as Record<string, string>)['Idempotency-Key']!);
        return Response.json({ ...flowTransfer({ id: `tr-${keys.length}` }), demoOnlyCode: '123456' }, { status: 202 });
      }
      if (url.endsWith('/cancel')) return Response.json(flowTransfer({ id: 'tr-1', status: 'cancelled' }));
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.ok(storedRecovery());
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    await flow.wait();
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/transfers/tr-1/cancel') && call.init?.method === 'POST').length, 1);
    assert.equal(storedRecovery(), undefined);
    assert.match(flow.visible(), /Revisar transferencia/);
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
    await flow.finish();
  });

  it('never cancels or abandons the attempt while the confirm outcome is uncertain (F-06 wins)', async () => {
    let getBlocked = true;
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-u' }), demoOnlyCode: '123456' }, { status: 202 });
      if (url.endsWith('/confirm')) throw new Error('lost');
      if (url.endsWith('/transfers/tr-u') && getBlocked) throw new Error('offline');
      if (url.endsWith('/transfers/tr-u')) return Response.json(flowTransfer({ id: 'tr-u', status: 'completed', completedAt: '2026-11-13T20:32:00.000Z' }));
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('123456'); });
    await TestRenderer.act(async () => { flow.button('Autorizar transferencia').props.onPress(); });
    await flow.wait();
    assert.equal(flow.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Solicitar un código nuevo').length, 0, 'no new code while uncertain');
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    await flow.wait();
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/cancel')).length, 0);
    assert.match(flow.visible(), /Código de confirmación/);
    getBlocked = false;
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/);
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/cancel')).length, 0);
    await flow.finish();
  });
});

describe('round 6 · I: keyboard never hides the primary action', () => {
  const insideScroll = (renderer: TestRenderer.ReactTestRenderer, title: string) => renderer.root.findAllByType(ScrollView).some((scroll) => scroll.findAll((node) => String(node.type).includes('Text') && node.props.children === title).length > 0);

  it('M06 and M08 keep Continuar / Autorizar outside the scroll view inside a KeyboardAvoidingView, and a tap outside closes the keyboard', async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ ...flowTransfer(), demoOnlyCode: '123456' }, { status: 202 });
      return undefined;
    }, { amount: '6000' });
    await TestRenderer.act(async () => { flow.button('Modificar datos').props.onPress(); });
    const avoiding = flow.renderer.root.findAllByType(KeyboardAvoidingView);
    assert.equal(avoiding.length, 1);
    assert.equal(insideScroll(flow.renderer, 'Continuar'), false, 'M06 Continuar is in the footer above the keyboard');
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const area = flow.renderer.root.findAll((node) => node.props.testID === 'dismiss-keyboard' && typeof node.props.onResponderRelease === 'function')[0]!;
    await TestRenderer.act(async () => { area.props.onResponderRelease(); });
    assert.equal(dismiss.mock.calls.length, 1);
    dismiss.mockRestore();
    await TestRenderer.act(async () => { flow.button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.ok(flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }));
    assert.equal(insideScroll(flow.renderer, 'Autorizar transferencia'), false, 'M08 Autorizar is anchored above the keyboard');
    assert.equal(insideScroll(flow.renderer, 'Cancelar y volver a revisar'), false);
    await flow.finish();
  });

  it('M01 sits in a KeyboardAvoidingView with a scrollable form and closes the keyboard on outside taps', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    assert.equal(renderer!.root.findAllByType(KeyboardAvoidingView).length, 1);
    assert.equal(renderer!.root.findAllByType(ScrollView)[0]!.props.keyboardShouldPersistTaps, 'handled');
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    await TestRenderer.act(async () => { renderer!.root.findAll((node) => node.props.testID === 'dismiss-keyboard' && typeof node.props.onResponderRelease === 'function')[0]!.props.onResponderRelease(); });
    assert.equal(dismiss.mock.calls.length, 1);
    dismiss.mockRestore();
    await TestRenderer.act(async () => { renderer!.unmount(); });
  });
});

describe('round 6 · M01/M12 states', () => {
  it.each([
    [401, { title: 'Unauthorized', detail: 'Credenciales inválidas.' }, /Credenciales no válidas/],
    [429, { title: 'Too Many Requests', detail: 'Demasiados intentos. Intenta más tarde.' }, /Acceso bloqueado temporalmente/],
  ])('login %s shows the matching M01 error card', async (status, body, title) => {
    const fetchSpy = jest.fn(async () => Response.json(body, { status }));
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('x'); });
    const submit = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button' && node.findAll((child) => child.props.children === 'Iniciar sesión').length > 0)[0]!;
    await TestRenderer.act(async () => { submit.props.onPress(); });
    assert.match(JSON.stringify(renderer!.toJSON()), title);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });

  it('a revoked session returns to login with the "sesión ha expirado" notice (M12 variant)', async () => {
    mockSecureValues.set('wallet.refresh-token', 'refresh');
    let refreshes = 0;
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) { refreshes += 1; return refreshes === 1 ? Response.json({ accessToken: 'access', refreshToken: 'refresh-2', tokenType: 'Bearer', expiresIn: 300, user: { id: 'exp-user', fullName: 'Ana López', email: 'ana@example.com' } }) : Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 }); }
      if (url.endsWith('/accounts')) return Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 });
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      return Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 });
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    const screen = JSON.stringify(renderer!.toJSON());
    assert.match(screen, /Tu sesión ha expirado/);
    assert.match(screen, /Iniciar sesión/);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

describe('F-11: long dynamic data never pushes controls off screen', () => {
  const LONG_NAME = 'Ana María de los Ángeles López-Hernández de la Cruz y Villaseñor';
  const flat = (style: unknown) => StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) ?? {};

  it.each([1, 2])('M02 with a 63-character name (fontScale %s) keeps the greeting flexible and "Cerrar sesión" fixed in the same row', async (fontScale) => {
    assert.ok(LONG_NAME.length >= 63, "the 63+ character name from the F-11 report");
    const fontScaleSpy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: `long-${fontScale}`, fullName: LONG_NAME, email: 'ana@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount] });
      if (url.includes('/movements?limit=20')) return Response.json({ items: [], nextCursor: null });
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected API request: ${url}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: fetchSpy });
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); renderer!.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    const submit = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button' && node.findAll((child) => child.props.children === 'Iniciar sesión').length > 0)[0]!;
    await TestRenderer.act(async () => { submit.props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    const greeting = renderer!.root.findAllByProps({ testID: 'home-greeting' })[0]!;
    assert.equal(greeting.props.numberOfLines, 2, 'the greeting wraps to two lines and then ellipsizes instead of overflowing');
    assert.notEqual(greeting.props.allowFontScaling, false, 'Dynamic Type is respected, not disabled');
    const row = renderer!.root.findAllByProps({ testID: 'home-greeting-row' })[0]!;
    assert.equal(flat(row.props.style).flexDirection, 'row');
    const copy = row.findAll((node) => flat(node.props.style).flex === 1 && node.findAllByProps({ testID: 'home-greeting' }).length > 0)[0]!;
    assert.ok(copy, 'the greeting column takes the free space');
    assert.equal(flat(copy.props.style).minWidth, 0, 'and may shrink below its text width');
    const logout = row.findAll((node) => node.props.accessibilityLabel === 'Cerrar sesión' && typeof node.props.onPress === 'function')[0]!;
    assert.ok(logout, 'logout lives in the same row as the greeting');
    const logoutStyle = flat(typeof logout.props.style === 'function' ? logout.props.style({ pressed: false }) : logout.props.style);
    assert.equal(logoutStyle.flexShrink, 0, 'the logout target never shrinks below its 44 pt size');
    assert.ok(Number(logoutStyle.width) >= 44, "44 pt minimum touch target");
    await TestRenderer.act(async () => { logout.props.onPress(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.match(JSON.stringify(renderer!.toJSON()), /Iniciar sesión/, 'logout stays reachable and works with the long name');
    await TestRenderer.act(async () => { renderer!.unmount(); });
    fontScaleSpy.mockRestore();
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});

describe('F-12: no exit from the code step while the confirm is in flight', () => {
  it('disables "Cancelar y volver a revisar" and the header arrow until the confirm answers, never cancels and lands on the receipt', async () => {
    let releaseConfirm: (() => void) | undefined;
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-slow' }), demoOnlyCode: '123456' }, { status: 202 });
      if (url.endsWith('/confirm')) return new Promise<Response>((resolve) => { releaseConfirm = () => resolve(Response.json(flowTransfer({ id: 'tr-slow', status: 'completed', completedAt: '2026-11-13T20:32:00.000Z' }))); });
      if (url.endsWith('/transfers/tr-slow')) return Response.json(flowTransfer({ id: 'tr-slow', status: 'completed', completedAt: '2026-11-13T20:32:00.000Z' }));
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Código de confirmación' }).props.onChangeText('123456'); });
    await TestRenderer.act(async () => { flow.button('Autorizar transferencia').props.onPress(); });
    await flow.wait();
    assert.ok(releaseConfirm, 'the confirm request is pending');
    const cancelButton = flow.button('Cancelar y volver a revisar');
    assert.equal(cancelButton.props.disabled, true);
    const arrow = flow.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Cancelar y volver a revisar' && typeof node.props.onPress === 'function')[0]!;
    assert.equal(arrow.props.disabled, true);
    assert.equal(arrow.props.accessibilityState.disabled, true);
    // Even a press that slips through (e.g. a queued tap) must not leave the step or cancel the attempt.
    await TestRenderer.act(async () => { cancelButton.props.onPress(); arrow.props.onPress(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /"Revisar transferencia"/);
    assert.match(flow.visible(), /Código de confirmación/);
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/cancel')).length, 0);
    await TestRenderer.act(async () => { releaseConfirm!(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/);
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/cancel')).length, 0);
    await flow.finish();
  });
});

describe('F-14: the OTP threshold of M07 comes from the server policy, never from a constant', () => {
  it.each([
    // [policy threshold, amount, requires code]
    ['123456', '1234.56', true],
    ['123456', '1234.55', false],
    ['123456', '4999.99', true],
    ['1000000', '6000.00', false],
    ['1000000', '10000.00', true],
  ])('threshold %s minor, amount %s -> requires code: %s', async (threshold, amount, otp) => {
    const flow = await startTransferFlow((url) => (url.endsWith('/transfer-policy') ? Response.json(demoPolicy({ otpThresholdMinor: threshold, dailyRemainingMinor: '2000000', dailyLimitMinor: '2000000' })) : undefined), { amount });
    await flow.wait();
    const review = flow.visible();
    const label = formatMoney(threshold, { currency: true });
    if (otp) {
      assert.ok(review.includes(`Operación mayor o igual a ${label} requiere código de autorización`), `M07 names the server threshold ${label}`);
      assert.ok(flow.button('Continuar a verificación'));
      assert.equal(flow.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.findAll((child) => child.props.children === 'Confirmar transferencia').length > 0).length, 0);
    } else {
      assert.doesNotMatch(review, /requiere código de autorización/);
      assert.ok(flow.button('Confirmar transferencia'));
    }
    await flow.finish();
  });
});

describe('F-15: the M07 threshold variant keeps both actions within 390x844', () => {
  const flat = (style: unknown) => StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) ?? {};
  const styleOf = (renderer: TestRenderer.ReactTestRenderer, testID: string) => flat(renderer.root.findAllByProps({ testID })[0]!.props.style);
  // Measured on the RN-web render (docs/evidence/round6/71bd7e5/checks/f15-*.txt): the two-line threshold pill made the
  // variant 36 px taller and pushed "Modificar datos" to y=812-856. The hero (-8 px) and the gap above the actions
  // (-12 px) are tighter only in that variant, so it ends at y=836 like the own-accounts variant.
  it.each([
    ['6000.00', true],
    ['850.00', false],
  ])('amount %s (threshold variant: %s) uses the matching hero padding and gap above the actions', async (amount, threshold) => {
    const flow = await startTransferFlow((url) => (url.endsWith('/transfer-policy') ? Response.json(demoPolicy({ dailyRemainingMinor: '2000000' })) : undefined), { amount });
    await flow.wait();
    const hero = styleOf(flow.renderer, 'review-hero');
    const estimate = styleOf(flow.renderer, 'estimate-card');
    if (threshold) {
      assert.match(flow.visible(), /requiere código de autorización/);
      assert.equal(hero.paddingVertical, 12);
      assert.equal(estimate.marginBottom, 12);
      assert.ok(flow.button('Continuar a verificación'));
    } else {
      assert.doesNotMatch(flow.visible(), /requiere código de autorización/);
      assert.equal(hero.paddingVertical, undefined, 'the other variants keep the Stitch p-4 hero');
      assert.equal(hero.padding, 16);
      assert.equal(estimate.marginBottom, 24, 'and the Stitch gap above the actions');
      assert.ok(flow.button('Confirmar transferencia'));
    }
    assert.ok(flow.button('Modificar datos'));
    await flow.finish();
  });
});

describe('F-16: with large text (fontScale 1.3 / 2) label-value rows and amounts wrap instead of overflowing sideways', () => {
  // The test renderer has no layout engine, so this locks the structure that makes wrapping possible; the measured
  // result (0 boxes outside 390 px at 100/130/200 % on M01-M11 with long data) is in the RN-web evidence (f16-log.txt).
  const flat = (style: unknown) => StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) ?? {};
  type Node = TestRenderer.ReactTestInstance;
  const hostText = (renderer: TestRenderer.ReactTestRenderer, text: string) => renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.children === text)[0];
  const rowOf = (node: Node) => { let current: Node | null = node.parent; while (current && !(String(current.type) === 'View' && flat(current.props.style).flexDirection === 'row')) current = current.parent; return current; };
  // A row whose label sits next to a value: it must wrap, and its value must be allowed to shrink.
  const assertWrappingRow = (renderer: TestRenderer.ReactTestRenderer, label: string) => {
    const text = hostText(renderer, label);
    assert.ok(text, `"${label}" is rendered`);
    const row = rowOf(text)!;
    assert.equal(flat(row.props.style).flexWrap, 'wrap', `the "${label}" row wraps its value below the label when both do not fit`);
    const value = row.children.filter((child): child is Node => typeof child !== 'string' && !child.findAll((inner) => inner.props.children === label).length).pop()!;
    assert.equal(flat(value.props.style).flexShrink, 1, `the "${label}" value can shrink`);
  };
  // Amount + currency: siblings in a wrapping row (a currency nested inside the amount Text cannot move below it).
  const assertAmountLine = (renderer: TestRenderer.ReactTestRenderer, currency: string) => {
    const unit = hostText(renderer, currency);
    assert.ok(unit, `${currency} is rendered`);
    assert.notEqual(String(unit.parent?.type), 'Text', 'the currency is not nested in the amount text');
    const row = rowOf(unit)!;
    assert.equal(flat(row.props.style).flexWrap, 'wrap');
    const amount = row.findAll((node) => String(node.type) === 'Text' && node.props.numberOfLines === 1)[0]!;
    assert.equal(flat(amount.props.style).flexShrink, 1);
    assert.equal(flat(amount.props.style).minWidth, 0, 'the amount box never exceeds its row');
  };
  let fontScaleSpy: jest.SpyInstance | undefined;
  afterEach(() => { fontScaleSpy?.mockRestore(); });

  it.each([1.3, 2])('M06, M07 (threshold) and M08 at fontScale %s', async (fontScale) => {
    fontScaleSpy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfer-policy')) return Response.json(demoPolicy({ dailyRemainingMinor: '2000000' }));
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-big' }), demoOnlyCode: '123456' }, { status: 202 });
      if (url.endsWith('/cancel')) return Response.json(flowTransfer({ id: 'tr-big', status: 'cancelled' }));
      return undefined;
    }, { amount: '6000.00' });
    await flow.wait();
    // M07
    for (const label of ['Concepto', 'Referencia numérica', 'Tipo de operación']) assertWrappingRow(flow.renderer, label);
    assertAmountLine(flow.renderer, 'MXN');
    // M06
    await TestRenderer.act(async () => { flow.button('Modificar datos').props.onPress(); });
    await flow.wait();
    for (const label of ['Cuenta de origen', 'Beneficiario destino']) {
      const row = rowOf(hostText(flow.renderer, label)!)!;
      assert.equal(flat(row.props.style).flexWrap, 'wrap', `the "${label}" header lets its link move below`);
      assert.equal(flat(hostText(flow.renderer, label)!.props.style).flexShrink, 1);
    }
    const alias = hostText(flow.renderer, 'Carlos')!;
    assert.equal(flat(rowOf(alias)!.props.style).flexWrap, 'wrap', 'a long alias moves below the beneficiary name');
    // M08
    await TestRenderer.act(async () => { flow.button('Continuar').props.onPress(); });
    await TestRenderer.act(async () => { flow.button('Continuar a verificación').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Código de confirmación/);
    assertAmountLine(flow.renderer, 'MXN');
    const amountBlock = flow.renderer.root.findAllByProps({ testID: 'otp-amount-line' })[0]!.parent!;
    assert.equal(flat(amountBlock.props.style).maxWidth, '100%', 'the amount may use the whole width instead of half of it');
    assert.equal(flat(rowOf(amountBlock)!.props.style).flexWrap, 'wrap', 'and moves below the recipient when needed');
    await flow.finish();
  });

  it.each([1.3, 2])('M10 and M04 (folio, type, amount) at fontScale %s', async (fontScale) => {
    fontScaleSpy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
    const UUID = '12089d0f-0c30-43fd-aab6-b877c6a1f1e2';
    const done = flowTransfer({ id: UUID, status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: UUID });
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json(done, { status: 201 });
      if (url.endsWith(`/transfers/${UUID}`)) return Response.json(done);
      if (url.includes('/movements?limit=20')) return Response.json({ items: [{ id: 'mv-out', transferId: UUID, type: 'debit', amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', status: 'completed', occurredAt: '2026-11-13T20:32:00.123Z', counterparty: { name: 'Carlos Ruiz', clabeMasked: '000•••••••••••0028' } }], nextCursor: null });
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/);
    assertAmountLine(flow.renderer, 'MXN');
    await TestRenderer.act(async () => { flow.button('Ver últimos movimientos').props.onPress(); });
    await flow.wait();
    const row = flow.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.endsWith(', Cargo'))[0]!;
    await TestRenderer.act(async () => { row.props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia enviada"/);
    assertAmountLine(flow.renderer, 'MXN');
    for (const label of ['Concepto', 'Referencia', 'Tipo de operación']) assertWrappingRow(flow.renderer, label);
    const folio = flow.renderer.root.findAll((node) => String(node.type) === 'Text' && node.props.testID === 'folio-value')[0]!;
    assert.equal(flat(rowOf(folio)!.props.style).flexWrap, 'wrap', 'a UUID that does not fit next to "Folio interno" moves below it');
    assert.equal(flat(folio.props.style).flexBasis, 0, 'and stays beside the label while its longest segment fits');
    await flow.finish();
  });

  it.each([1.3, 2])('M11 at fontScale %s', async (fontScale) => {
    fontScaleSpy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(fontScale);
    const flow = await startTransferFlow((url) => (url.endsWith('/transfers') ? Response.json({ title: 'Unprocessable Entity', detail: 'Saldo insuficiente.' }, { status: 422 }) : undefined), { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    for (const label of ['Saldo disponible', 'Monto solicitado']) assertWrappingRow(flow.renderer, label);
    await flow.finish();
  });
});

describe('F-19: the accessible name of every control contains its visible text (voice control "label in name")', () => {
  type Node = TestRenderer.ReactTestInstance;
  const norm = (value: string) => value.toLocaleLowerCase('es-MX').replace(/\s+/g, ' ').trim();
  const textOf = (node: Node): string => node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
  // Top-level visible texts of a control, in order (nested Text spans belong to their parent text).
  const visibleTexts = (control: Node) => control.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text').map(textOf).filter((text) => text.trim());
  const checked: string[] = [];
  const assertLabelInName = (renderer: TestRenderer.ReactTestRenderer, screen: string) => {
    const controls = renderer.root.findAll((node) => typeof node.props.onPress === 'function' && typeof node.props.accessibilityLabel === 'string' && typeof node.type !== 'string', { deep: false });
    assert.ok(controls.length > 0, `${screen}: labelled controls found`);
    for (const control of controls) {
      // The name a user reads on the control: its first text with a word (icon-only controls have none).
      const shown = visibleTexts(control).find((text) => /\p{L}{3,}/u.test(text));
      if (!shown) continue;
      const label = control.props.accessibilityLabel as string;
      assert.ok(norm(label).includes(norm(shown)), `${screen}: label "${label}" does not contain the visible text "${shown}"`);
      checked.push(`${screen}: ${label}`);
    }
  };
  const fieldLabels = ['Monto a transferir', 'Concepto de pago', 'Referencia numérica (hasta 7 dígitos)'];

  it('M02, M05, M06 (origin selector closed and open, fields) and M07', async () => {
    const app = await sameAccountApp();
    assertLabelInName(app.renderer, 'M02');
    await app.press('Transferir dinero, elegir beneficiario');
    assertLabelInName(app.renderer, 'M05');
    await app.choose('Carlos');
    assertLabelInName(app.renderer, 'M02 con destino');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.wait();
    assertLabelInName(app.renderer, 'M06');
    await app.press('Cambiar cuenta de origen');
    assertLabelInName(app.renderer, 'M06 selector abierto');
    assert.ok(app.renderer.root.findByProps({ accessibilityLabel: 'Listo, cerrar las cuentas de origen' }), 'the open selector names its "Listo" text');
    for (const label of fieldLabels) {
      const input = app.renderer.root.findAll((node) => String(node.type) === 'TextInput' && node.props.accessibilityLabel === label);
      assert.equal(input.length, 1, `input named "${label}"`);
      assert.ok(app.visible().includes(label), `"${label}" is the visible field label`);
    }
    await app.fill('100');
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    await app.wait();
    assertLabelInName(app.renderer, 'M07');
    await app.finish();
  });

  it('M08 with a valid and with an expired code', async () => {
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-lbl', expiresAt: new Date(Date.now() + 1500).toISOString() }), demoOnlyCode: '123456' }, { status: 202 });
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assertLabelInName(flow.renderer, 'M08');
    assert.equal(flow.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Solicitar un código nuevo' && typeof node.props.onPress === 'function', { deep: false }).length, 1);
    await flow.wait(2200);
    assert.match(flow.visible(), /El código ha expirado/);
    assertLabelInName(flow.renderer, 'M08 expirado');
    assert.equal(flow.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Solicitar un código nuevo' && typeof node.props.onPress === 'function', { deep: false }).length, 1);
    await flow.finish();
  });

  it('M03 (account picker open) and M04', async () => {
    const app = await loginWith((url) => {
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount, savingsAccount] });
      if (url.includes('/movements?limit=20')) return Response.json({ items: [{ id: 'mv-out', transferId: 'tr-x', type: 'debit', amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', status: 'completed', occurredAt: '2026-11-13T20:32:00.123Z', counterparty: { name: 'Carlos Ruiz', clabeMasked: '000•••••••••••0028' } }], nextCursor: null });
      if (url.endsWith('/transfers/tr-x')) return Response.json(flowTransfer({ id: 'tr-x', status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z' }));
      return undefined;
    });
    const tab = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function').find((node) => node.findAll((child) => child.props.children === 'Movimientos').length > 0)!;
    await TestRenderer.act(async () => { tab.props.onPress(); });
    await app.wait();
    const picker = app.renderer.root.find((node) => /^Cuenta Principal \(•• 8412\), cambiar cuenta$/.test(node.props.accessibilityLabel ?? ''));
    await TestRenderer.act(async () => { picker.props.onPress(); });
    assertLabelInName(app.renderer, 'M03');
    const row = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.endsWith(', Cargo'))[0]!;
    await TestRenderer.act(async () => { row.props.onPress(); });
    await app.wait();
    assert.match(app.visible(), /"Transferencia enviada"/);
    assertLabelInName(app.renderer, 'M04');
    await app.finish();
    // Guard against a vacuous pass: the scan really covered the controls whose names changed.
    for (const expected of ['Transferir dinero, elegir beneficiario', 'Última actualización de saldo', 'Listo, cerrar las cuentas de origen', 'Solicitar un código nuevo', 'cambiar cuenta', 'ver sus movimientos']) {
      assert.ok(checked.some((entry) => entry.includes(expected)), `checked a control named "${expected}"`);
    }
  });
});

describe('round 7 · real folios (UUID) on M04 and M10', () => {
  const UUID = 'f915ada2-ba25-4eee-9e1b-ca75c9a47872';
  const folioChecks = (renderer: TestRenderer.ReactTestRenderer) => {
    const folio = renderer.root.findAll((node) => node.props.testID === 'folio-value' && node.props.selectable !== undefined)[0]!;
    assert.ok(folio, 'folio text rendered');
    assert.equal(folio.props.children, UUID, 'the complete UUID is shown, never shortened or replaced by a mock');
    assert.equal(folio.props.selectable, true, 'the folio can be selected and copied (no fake copy button)');
    assert.equal(folio.props.numberOfLines, undefined, 'it wraps instead of being cut');
    assert.equal(folio.props.accessibilityLabel, `Folio ${UUID}`);
    const style = StyleSheet.flatten(folio.props.style);
    assert.equal(style.flexShrink, 1, 'the value shrinks/wraps inside its row');
    let row: TestRenderer.ReactTestInstance | null = folio;
    for (let level = 0; level < 6 && row && row.findAll((node) => node.props.children === 'Folio interno').length === 0; level += 1) row = row.parent;
    assert.ok(row, 'the folio sits in the "Folio interno" row');
    const label = row.findAll((node) => node.props.children === 'Folio interno' && node.props.style)[0]!;
    assert.equal(StyleSheet.flatten(label.props.style).flexShrink, 0, 'the label never wraps under a long folio');
    const json = JSON.stringify(renderer.toJSON());
    assert.doesNotMatch(json, /DEMO-0001|content_copy/);
  };

  it('M10 shows the full folio of a completed transfer', async () => {
    const done = flowTransfer({ id: UUID, status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: UUID });
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json(done, { status: 201 });
      if (url.endsWith(`/transfers/${UUID}`)) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/);
    folioChecks(flow.renderer);
    await flow.finish();
  });

  it('M04 shows the full folio of a sent movement in the accent colour', async () => {
    const app = await loginWith((url) => {
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount] });
      if (url.includes('/accounts/source-1/movements?limit=20')) return Response.json({ items: [{ id: 'mv-out', transferId: UUID, type: 'debit', amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', status: 'completed', occurredAt: '2026-11-13T20:32:00.123Z', counterparty: { name: 'Carlos Ruiz', clabeMasked: '000•••••••••••0028' } }], nextCursor: null });
      if (url.endsWith(`/transfers/${UUID}`)) return Response.json(flowTransfer({ id: UUID, status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: UUID }));
      return undefined;
    });
    const row = app.renderer.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.endsWith(', Cargo'))[0]!;
    await TestRenderer.act(async () => { row.props.onPress(); });
    await app.wait();
    assert.match(app.visible(), /"Transferencia enviada"/);
    folioChecks(app.renderer);
    const folio = app.renderer.root.findAllByProps({ testID: 'folio-value' })[0]!;
    assert.equal(StyleSheet.flatten(folio.props.style).color, '#0037b0');
    await app.finish();
  });
});

describe('round 7 · 2: readable type scale (>= 12 pt secondary, >= 14 pt help, errors and key data)', () => {
  type Node = TestRenderer.ReactTestInstance;
  const flat = (style: unknown) => (StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) ?? {}) as { fontSize?: number; lineHeight?: number };
  const textOf = (node: Node): string => node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
  // Every rendered text (icons excluded: vector icons are glyphs, not copy) must be >= 12 pt with a line height that fits it.
  const scan = (renderer: TestRenderer.ReactTestRenderer, screen: string) => {
    const texts = renderer.root.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text' && !String(node.parent?.type).match(/Icon/) && /\p{L}|\d/u.test(textOf(node)));
    assert.ok(texts.length > 5, `${screen}: texts found`);
    for (const node of texts) {
      const style = flat(node.props.style);
      if (style.fontSize === undefined) continue; // platform default (14)
      assert.ok(style.fontSize >= 12, `${screen}: "${textOf(node).slice(0, 60)}" is ${style.fontSize} pt (< 12)`);
      if (style.lineHeight !== undefined) assert.ok(style.lineHeight >= style.fontSize, `${screen}: "${textOf(node).slice(0, 40)}" line height ${style.lineHeight} < ${style.fontSize}`);
    }
  };
  const sizeOf = (renderer: TestRenderer.ReactTestRenderer, pattern: RegExp) => {
    const node = renderer.root.findAll((candidate) => String(candidate.type) === 'Text' && String(candidate.parent?.type) !== 'Text' && pattern.test(textOf(candidate)))[0];
    assert.ok(node, `text ${pattern} rendered`);
    return flat(node.props.style).fontSize ?? 14;
  };

  it('M02, M05, M06 (limit and daily remaining), M07 (secondary data) and M08 (help, countdown)', async () => {
    const app = await sameAccountApp();
    scan(app.renderer, 'M02');
    assert.ok(sizeOf(app.renderer, /^Movimientos$/) >= 13, 'tab bar labels are at least 13 pt');
    await app.press('Transferir dinero, elegir beneficiario');
    scan(app.renderer, 'M05');
    await app.choose('Carlos');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.wait();
    await app.fill('6000');
    scan(app.renderer, 'M06');
    assert.ok(sizeOf(app.renderer, /^Límite diario:/) >= 12);
    assert.ok(sizeOf(app.renderer, /^Disponible hoy:/) >= 12);
    assert.ok(sizeOf(app.renderer, /^Los beneficiarios se registran/) >= 12);
    await TestRenderer.act(async () => { app.continueButton().props.onPress(); });
    scan(app.renderer, 'M07');
    assert.ok(sizeOf(app.renderer, /^Concepto$/) >= 14, 'M07 secondary labels match their values (14 pt)');
    assert.ok(sizeOf(app.renderer, /^CUENTA DE ORIGEN$/) >= 12);
    assert.ok(sizeOf(app.renderer, /^El envío aún no está confirmado/) >= 12);
    assert.ok(sizeOf(app.renderer, /requiere código de autorización/) >= 12);
    await app.finish();
  });

  it('M08 help/countdown, M11 messages and M10 receipt date are body size (14 pt)', async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ ...flowTransfer({ expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '742890' }, { status: 202 });
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    scan(flow.renderer, 'M08');
    assert.ok(sizeOf(flow.renderer, /^Ingresa el código/) >= 14);
    assert.ok(sizeOf(flow.renderer, /^El código expira en/) >= 14);
    assert.ok(sizeOf(flow.renderer, /^Código asignado para esta prueba/) >= 14);
    await flow.finish();

    const done = flowTransfer({ id: 'transfer-done', status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'f2b6a1f0-1b2c-4d5e-8f90-0123456789ab' });
    const receipt = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json(done, { status: 201 });
      if (url.endsWith('/transfers/transfer-done')) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { receipt.button('Confirmar transferencia').props.onPress(); });
    await receipt.wait();
    scan(receipt.renderer, 'M10');
    assert.ok(sizeOf(receipt.renderer, /13 de noviembre de 2026/) >= 14, 'receipt date');
    assert.ok(sizeOf(receipt.renderer, /^f2b6a1f0/) >= 14, 'folio');
    await receipt.finish();

    const rejected = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ title: 'Unprocessable Entity', detail: 'Saldo insuficiente.' }, { status: 422 });
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { rejected.button('Confirmar transferencia').props.onPress(); });
    await rejected.wait();
    scan(rejected.renderer, 'M11');
    assert.ok(sizeOf(rejected.renderer, /^No se aplicó ningún cargo/) >= 14);
    await rejected.finish();
  });

  it('the same-account warning on M06 is body size', async () => {
    const app = await sameAccountApp();
    await app.press('Transferir dinero, elegir beneficiario');
    await app.choose('Cuenta de ahorro demo');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.press('Cambiar cuenta de origen');
    await app.press('Usar Ahorro •• 5719 como cuenta de origen, es el destino elegido');
    assert.ok(sizeOf(app.renderer, /^La cuenta de origen y el destino son la misma cuenta/) >= 14);
    await app.finish();
  });
});

describe('round 7 · 3: M07 estimated-balance bar shows the real split, neutral and decorative', () => {
  it('blue = balance after the transfer / current balance, neutral = amount / current balance, hidden from assistive tech', async () => {
    const flow = await startTransferFlow(() => undefined, { amount: '850.00' });
    await flow.wait();
    assert.match(flow.visible(), /"\$12,450.00"," - ","\$850.00"," = ","\$11,600.00"," MXN"/);
    const bar = flow.renderer.root.findAll((node) => node.props.testID === 'estimate-bar' && String(node.type) === 'View')[0]!;
    assert.equal(bar.props.accessibilityElementsHidden, true);
    assert.equal(bar.props.importantForAccessibility, 'no-hide-descendants');
    const [remaining, spent] = bar.children as TestRenderer.ReactTestInstance[];
    const remainingStyle = StyleSheet.flatten(remaining!.props.style);
    const spentStyle = StyleSheet.flatten(spent!.props.style);
    // 1,160,000 / 1,245,000 = 93.17 % (BigInt basis points, as in the Stitch reference).
    assert.equal(remainingStyle.width, '93.17%');
    assert.equal(remainingStyle.backgroundColor, '#0037b0');
    assert.equal(spentStyle.flex, 1);
    assert.ok(!['#ffb4a8', '#ba1a1a', '#8f0001', '#ffdad5', '#b22217'].includes(String(spentStyle.backgroundColor)), `the used share is not an alarm red (${String(spentStyle.backgroundColor)})`);
    await flow.finish();
  });
});

describe('round 7 · 4: M07/M08 code states follow the server (threshold, expiry, attempts)', () => {
  const policyHandler = (url: string) => (url.endsWith('/transfer-policy') ? Response.json(demoPolicy({ dailyRemainingMinor: '2000000' })) : undefined);
  const codeInput = (flow: { renderer: TestRenderer.ReactTestRenderer }) => flow.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Código de confirmación' && typeof node.props.onChangeText === 'function')[0]!;
  const type = async (flow: { renderer: TestRenderer.ReactTestRenderer }, value: string) => { await TestRenderer.act(async () => { codeInput(flow).props.onChangeText(value); }); };
  const authorize = (flow: { renderer: TestRenderer.ReactTestRenderer }) => flow.renderer.root.findAll((node) => node.props.accessibilityRole === 'button').find((node) => node.findAll((child) => child.props.children === 'Autorizar transferencia').length > 0)!;

  // The client only predicts the variant from GET /transfer-policy (amount >= otpThresholdMinor, as the API applies it).
  it.each([
    ['4999.99', '499999', false],
    ['5000.00', '500000', true],
    ['5000.01', '500001', true],
  ])('review of %s (%s minor) against the 500000 policy threshold predicts a code: %s', async (amount, _minor, otp) => {
    const flow = await startTransferFlow(policyHandler, { amount });
    await flow.wait();
    assert.equal(Boolean(flow.button('Continuar a verificación')), otp);
    assert.equal(Boolean(flow.button('Confirmar transferencia')), !otp);
    assert.equal(/requiere código de autorización/.test(flow.visible()), otp);
    await flow.finish();
  });

  it('the server answer wins over the prediction: 202 awaiting_confirmation opens M08, 201 completed opens the receipt', async () => {
    const otpFlow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-202', amountMinor: '499999', expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '000000' }, { status: 202 });
      return policyHandler(url);
    }, { amount: '4999.99' });
    await otpFlow.wait();
    await TestRenderer.act(async () => { otpFlow.button('Confirmar transferencia').props.onPress(); });
    await otpFlow.wait();
    assert.match(otpFlow.visible(), /"Código de confirmación"/, 'predicted no code, the server asked for one: M08');
    assert.match(otpFlow.visible(), /"\$4,999.99"/);
    await otpFlow.finish();

    const done = flowTransfer({ id: 'tr-201', status: 'completed', amountMinor: '500000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'R-201' });
    const directFlow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json(done, { status: 201 });
      if (url.endsWith('/transfers/tr-201')) return Response.json(done);
      return policyHandler(url);
    }, { amount: '5000.00' });
    await directFlow.wait();
    await TestRenderer.act(async () => { directFlow.button('Continuar a verificación').props.onPress(); });
    await directFlow.wait();
    assert.match(directFlow.visible(), /"Transferencia completada"/, 'predicted a code, the server completed it: receipt');
    assert.doesNotMatch(directFlow.visible(), /"Código de confirmación"/);
    await directFlow.finish();
  });

  it('one hidden accessible input: one-time-code autofill, paste of 6 digits, delete, digits only; incomplete and complete states', async () => {
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '742890' }, { status: 202 });
      return policyHandler(url);
    }, { amount: '6000.00' });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Continuar a verificación').props.onPress(); });
    await flow.wait();
    const inputs = flow.renderer.root.findAll((node) => String(node.type) === 'TextInput');
    assert.equal(inputs.length, 1, 'a single native input behind the six boxes');
    const input = codeInput(flow);
    assert.equal(input.props.autoComplete, 'one-time-code');
    assert.equal(input.props.textContentType, 'oneTimeCode');
    assert.equal(input.props.keyboardType, 'number-pad');
    assert.equal(input.props.maxLength, 6);
    const boxes = flow.renderer.root.findAll((node) => String(node.type) === 'View' && node.props.accessibilityElementsHidden === true && node.props.pointerEvents === 'none');
    assert.ok(boxes.length >= 1, 'the six boxes are hidden from assistive technologies');
    await type(flow, '74');
    assert.match(flow.visible(), /Faltan 4 dígitos/);
    assert.equal(authorize(flow).props.accessibilityState?.disabled, true);
    await type(flow, '74 28-90x1');
    assert.equal(codeInput(flow).props.value, '742890', 'pasted text keeps only the first 6 digits');
    assert.match(flow.visible(), /Código completo. Ya puedes autorizar./);
    assert.equal(authorize(flow).props.accessibilityState?.disabled, false);
    await type(flow, '74289');
    assert.match(flow.visible(), /Falta 1 dígito/);
    await flow.finish();
  });

  it('wrong code (422) keeps the attempt with a clear message and the server attempt limit; verifying is its own state', async () => {
    let release: (() => void) | null = null;
    let confirms = 0;
    const flow = await startTransferFlow(async (url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '742890' }, { status: 202 });
      if (url.endsWith('/confirm')) {
        confirms += 1;
        await new Promise<void>((resolve) => { release = resolve; });
        return Response.json({ title: 'Unprocessable Entity', detail: 'Código incorrecto.' }, { status: 422 });
      }
      return policyHandler(url);
    }, { amount: '6000.00' });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Continuar a verificación').props.onPress(); });
    await flow.wait();
    await type(flow, '111111');
    await TestRenderer.act(async () => { authorize(flow).props.onPress(); });
    await flow.wait();
    const verifying = flow.visible();
    assert.match(verifying, /Verificando código…/);
    assert.doesNotMatch(verifying, /Enviando transferencia|Estamos verificando si tu transferencia/, 'verifying the code is not the sending or uncertain screen');
    assert.equal(codeInput(flow).props.editable, false);
    await TestRenderer.act(async () => { release!(); });
    await flow.wait();
    const wrong = flow.visible();
    assert.match(wrong, /Código incorrecto. Verifica los 6 dígitos/);
    assert.match(wrong, /Tras 5 intentos fallidos/);
    assert.equal(codeInput(flow).props.value, '');
    assert.equal(Boolean(flow.button('Reintentar envío del mismo código')), false, 'a wrong code is never replayed');
    assert.equal(confirms, 1);
    await flow.finish();
  });

  it('attempts exhausted (429): own state, input and Autorizar disabled, demo code hidden; a new code closes the attempt first', async () => {
    const order: string[] = [];
    let created = 0;
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') { created += 1; order.push(`create-${created}`); return Response.json({ ...flowTransfer({ id: `tr-lock-${created}`, expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: created === 1 ? '111111' : '222222' }, { status: 202 }); }
      if (url.endsWith('/transfers/tr-lock-1/confirm')) return Response.json({ title: 'Too Many Requests', detail: 'Se agotaron los intentos.' }, { status: 429 });
      if (url.endsWith('/transfers/tr-lock-1/cancel')) { order.push('cancel-1'); return Response.json(flowTransfer({ id: 'tr-lock-1', status: 'cancelled' })); }
      return policyHandler(url);
    }, { amount: '6000.00' });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Continuar a verificación').props.onPress(); });
    await flow.wait();
    await type(flow, '999999');
    await TestRenderer.act(async () => { authorize(flow).props.onPress(); });
    await flow.wait();
    const locked = flow.visible();
    assert.match(locked, /Se agotaron los intentos para este código/);
    assert.match(locked, /no movió dinero/);
    assert.doesNotMatch(locked, /111111/);
    assert.equal(codeInput(flow).props.editable, false);
    assert.equal(authorize(flow).props.accessibilityState?.disabled, true);
    assert.ok(flow.button('Cancelar y volver a revisar'), 'a useful exit remains');
    await TestRenderer.act(async () => { flow.button('Solicitar un código nuevo').props.onPress(); });
    await flow.wait();
    assert.deepEqual(order, ['create-1', 'cancel-1', 'create-2'], 'the locked attempt is cancelled before the new one exists');
    assert.doesNotMatch(flow.visible(), /Se agotaron los intentos/);
    assert.match(flow.visible(), /222222/);
    await flow.finish();
  });

  it.each([
    [422, 'Unprocessable Entity', 'Saldo insuficiente.'],
    [429, 'Too Many Requests', 'Se excedió el límite diario.'],
  ])('a %s business rejection at confirm time goes to M11 with no debit and closes the pending attempt', async (status, title, detail) => {
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-biz', expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '742890' }, { status: 202 });
      if (url.endsWith('/transfers/tr-biz/confirm')) return Response.json({ title, detail }, { status });
      if (url.endsWith('/transfers/tr-biz/cancel')) return Response.json(flowTransfer({ id: 'tr-biz', status: 'cancelled' }));
      return policyHandler(url);
    }, { amount: '6000.00' });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Continuar a verificación').props.onPress(); });
    await flow.wait();
    await type(flow, '742890');
    await TestRenderer.act(async () => { authorize(flow).props.onPress(); });
    await flow.wait();
    const rejected = flow.visible();
    assert.match(rejected, /No se pudo completar la transferencia/);
    assert.match(rejected, /Tu dinero está intacto/);
    assert.match(rejected, /"\$6,000.00 MXN"/);
    assert.equal(flow.calls.filter((call) => call.url.endsWith('/transfers/tr-biz/cancel')).length, 1);
    assert.equal(storedRecovery(), undefined);
    await flow.finish();
  });
});

describe('round 7 · 5: "Solicitar un código nuevo" never leaves two open attempts', () => {
  const policyHandler = (url: string) => (url.endsWith('/transfer-policy') ? Response.json(demoPolicy({ dailyRemainingMinor: '2000000' })) : undefined);
  const otpFlow = async (handler: FlowHandler) => {
    const flow = await startTransferFlow((url, init) => handler(url, init) ?? policyHandler(url), { amount: '6000.00' });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Continuar a verificación').props.onPress(); });
    await flow.wait();
    return flow;
  };
  const creates = (flow: { calls: Array<{ url: string; init?: RequestInit }> }) => flow.calls.filter((call) => call.url.endsWith('/transfers') && call.init?.method === 'POST');

  it('creates nothing when neither the cancel nor the status read of the previous attempt answers', async () => {
    const flow = await otpFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-a', expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '111111' }, { status: 202 });
      if (url.endsWith('/transfers/tr-a/cancel') || url.endsWith('/transfers/tr-a')) throw new TypeError('Network request failed');
      return undefined;
    });
    await TestRenderer.act(async () => { flow.button('Solicitar un código nuevo').props.onPress(); });
    await flow.wait();
    assert.equal(creates(flow).length, 1, 'no second attempt while the first one may still be open');
    assert.match(flow.visible(), /No pudimos confirmar que el intento anterior quedó cancelado/);
    assert.match(flow.visible(), /111111/, 'the original attempt and its code stay on screen');
    await flow.finish();
  });

  it('when the cancel is refused (409) and the attempt is completed, shows its receipt and creates nothing', async () => {
    const done = flowTransfer({ id: 'tr-b', status: 'completed', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'R-B' });
    const flow = await otpFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-b', expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '111111' }, { status: 202 });
      if (url.endsWith('/transfers/tr-b/cancel')) return Response.json({ title: 'Conflict', detail: 'La transferencia ya no puede cancelarse.' }, { status: 409 });
      if (url.endsWith('/transfers/tr-b')) return Response.json(done);
      return undefined;
    });
    await TestRenderer.act(async () => { flow.button('Solicitar un código nuevo').props.onPress(); });
    await flow.wait();
    assert.equal(creates(flow).length, 1);
    assert.match(flow.visible(), /"Transferencia completada"/);
    await flow.finish();
  });

  it('after a confirmed cancel, the new attempt keeps amount, origin, destination, concept and reference with a new key', async () => {
    let created = 0;
    const flow = await otpFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') { created += 1; return Response.json({ ...flowTransfer({ id: `tr-c${created}`, expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '111111' }, { status: 202 }); }
      if (url.endsWith('/transfers/tr-c1/cancel')) return Response.json(flowTransfer({ id: 'tr-c1', status: 'cancelled' }));
      return undefined;
    });
    await TestRenderer.act(async () => { flow.button('Solicitar un código nuevo').props.onPress(); });
    await flow.wait();
    const [first, second] = creates(flow);
    assert.ok(first && second);
    assert.deepEqual(JSON.parse(String(second.init?.body)), JSON.parse(String(first.init?.body)));
    assert.deepEqual(JSON.parse(String(first.init?.body)), { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '600000', concept: 'Comida', reference: '131126' });
    const key = (call: { init?: RequestInit }) => (call.init?.headers as Record<string, string>)['Idempotency-Key'];
    assert.notEqual(key(first), key(second));
    const cancelIndex = flow.calls.findIndex((call) => call.url.endsWith('/transfers/tr-c1/cancel'));
    const secondIndex = flow.calls.indexOf(second);
    assert.ok(cancelIndex >= 0 && cancelIndex < secondIndex, 'cancel answered before the new attempt was created');
    // The new code is confirmed against the NEW attempt only.
    await TestRenderer.act(async () => { flow.renderer.root.findAll((node) => node.props.accessibilityLabel === 'Código de confirmación' && typeof node.props.onChangeText === 'function')[0]!.props.onChangeText('111111'); });
    assert.equal(flow.calls.filter((call) => call.url.includes('/transfers/tr-c1/confirm')).length, 0);
    await flow.finish();
  });
});

describe('round 7 · 6/8: unresolved attempts, background curtain and expired sessions', () => {
  const login = (id: string) => Response.json({ accessToken: `access-${id}`, refreshToken: `refresh-${id}`, tokenType: 'Bearer', expiresIn: 300, user: { id, fullName: 'Ana López', email: 'ana@example.com' } });
  const keyOf = (call: { init?: RequestInit }) => (call.init?.headers as Record<string, string>)['Idempotency-Key'];
  const withAppState = async (run: (emit: (state: string) => Promise<void>) => Promise<void>) => {
    const listeners: Array<(state: string) => void> = [];
    const original = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, listener: (state: string) => void) => { listeners.push(listener); return { remove: () => { listeners.splice(listeners.indexOf(listener), 1); } }; }) as unknown as typeof AppState.addEventListener;
    try { await run(async (state) => { await TestRenderer.act(async () => { listeners.forEach((listener) => listener(state)); }); }); }
    finally { AppState.addEventListener = original; }
  };

  it('M09 "Ir al inicio" keeps a pending notice on Home; verifying replays the same key and lands on the receipt with one row', async () => {
    let sends = 0;
    const done = flowTransfer({ id: 'tr-lost', status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'R-LOST' });
    const flow = await startTransferFlow((url, init) => {
      // F-21: Home re-checks on its own when shown; that replay is lost too, so the notice stays until "Verificar".
      if (url.endsWith('/transfers') && init?.method === 'POST') { sends += 1; if (sends <= 2) throw new TypeError('response lost after the server applied it'); return Response.json(done, { status: 201 }); }
      if (url.endsWith('/transfers/tr-lost')) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    const uncertain = flow.visible();
    assert.match(uncertain, /Estamos verificando si tu transferencia se completó/);
    assert.doesNotMatch(uncertain, /intacto|No se movió dinero|debitado|Transferencia completada/, 'nothing is claimed while the outcome is unknown');
    await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
    await flow.wait();
    const home = flow.visible();
    assert.match(home, /Transferencia en verificación/);
    assert.match(home, /"\$850.00 MXN"/);
    assert.match(home, /"131126"/);
    assert.doesNotMatch(home, /intacto|debitado/);
    await TestRenderer.act(async () => { flow.button('Verificar estado de la transferencia').props.onPress(); });
    await flow.wait(60);
    assert.match(flow.visible(), /"Transferencia completada"/);
    const creates = flow.calls.filter((call) => call.url.endsWith('/transfers') && call.init?.method === 'POST');
    assert.equal(creates.length, 3);
    assert.equal(new Set(creates.map(keyOf)).size, 1, 'the same Idempotency-Key: one logical row, no second debit');
    assert.equal(storedRecovery(), undefined);
    await TestRenderer.act(async () => { flow.button('Ir al inicio').props.onPress(); });
    assert.doesNotMatch(flow.visible(), /Transferencia en verificación/);
    await flow.finish();
  });

  it('M12: the curtain covers balances on iOS "inactive" (app switcher) as well as "background"', async () => {
    await withAppState(async (emit) => {
      const flow = await startTransferFlow((url) => (url.endsWith('/auth/me') ? Response.json({ id: 'u', fullName: 'Ana López', email: 'ana@example.com' }) : undefined), { amount: '850.00' });
      await TestRenderer.act(async () => { flow.button('Modificar datos').props.onPress(); });
      assert.match(flow.visible(), /\$12,450.00/);
      await emit('inactive');
      assert.match(flow.visible(), /Contenido oculto por privacidad/);
      assert.doesNotMatch(flow.visible(), /\$12,450.00|8412|Carlos Ruiz|Ana López/);
      assert.doesNotMatch(flow.visible(), /biométric|Face ID|huella/i);
      await emit('active');
      await flow.wait();
      assert.match(flow.visible(), /PASO 1 DE 2/, 'back to the same step with a valid session');
      await flow.finish();
    });
  });

  it('M12: an expired session keeps the pending record bound to its user; the same user resumes it after signing in, another user never sees it', async () => {
    await withAppState(async (emit) => {
      let user = 'user-a';
      let sends = 0;
      let meStatus = 200;
      const flow = await startTransferFlow((url, init) => {
        if (url.endsWith('/auth/login')) return login(user);
        if (url.endsWith('/auth/me')) return meStatus === 200 ? Response.json({ id: user, fullName: 'Ana López', email: 'ana@example.com' }) : Response.json({ title: 'Unauthorized' }, { status: 401 });
        if (url.endsWith('/auth/refresh') || url.endsWith('/auth/logout')) return Response.json({ title: 'Unauthorized' }, { status: 401 });
        // The original response and Home's own re-check (same key) are both lost.
        if (url.endsWith('/transfers') && init?.method === 'POST') { sends += 1; if (sends <= 2) throw new TypeError('response lost'); return Response.json({ ...flowTransfer({ id: 'tr-a', expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '000000' }, { status: 202 }); }
        return undefined;
      }, { amount: '850.00' });
      await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
      await flow.wait();
      await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
      await flow.wait();
      const record = JSON.parse(mockSecureValues.get(recoveryKeyOf('user-a'))!);
      assert.equal(record.userId, 'user-a');
      // The session expires while the app is in the background.
      meStatus = 401;
      await emit('background');
      await emit('active');
      await flow.wait(60);
      assert.match(flow.visible(), /Tu sesión ha expirado/);
      assert.ok(mockSecureValues.get(recoveryKeyOf('user-a')), 'an expired session does not forget an unresolved attempt');
      const signIn = async () => {
        await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); flow.renderer.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
        await TestRenderer.act(async () => { flow.button('Iniciar sesión nuevamente').props.onPress(); });
        await flow.wait(60);
      };
      // Another user signs in on this device: the record is neither shown nor consumed.
      user = 'user-b'; meStatus = 200;
      await signIn();
      assert.doesNotMatch(flow.visible(), /Estamos verificando|Código de confirmación|Transferencia en verificación/);
      assert.equal(sends, 2, 'no replay under another user');
      assert.equal(JSON.parse(mockSecureValues.get(recoveryKeyOf('user-a'))!).userId, 'user-a');
      // That session also expires; the original user signs in and the attempt resumes with its original key.
      meStatus = 401;
      await emit('background');
      await emit('active');
      await flow.wait(60);
      user = 'user-a'; meStatus = 200;
      await signIn();
      assert.equal(sends, 3);
      const creates = flow.calls.filter((call) => call.url.endsWith('/transfers') && call.init?.method === 'POST');
      assert.equal(new Set(creates.map(keyOf)).size, 1);
      assert.match(flow.visible(), /"Código de confirmación"/);
      await flow.finish();
    });
  });
});

describe('round 8 · F-21/F-22: one unresolved attempt at a time, bound to its user', () => {
  const login = (id: string) => Response.json({ accessToken: `access-${id}`, refreshToken: `refresh-${id}`, tokenType: 'Bearer', expiresIn: 300, user: { id, fullName: 'Ana López', email: 'ana@example.com' } });
  const keyOf = (call: { init?: RequestInit }) => (call.init?.headers as Record<string, string>)['Idempotency-Key'];
  const creates = (flow: { calls: Array<{ url: string; init?: RequestInit }> }) => flow.calls.filter((call) => call.url.endsWith('/transfers') && call.init?.method === 'POST');
  const done = flowTransfer({ id: 'tr-once', status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: 'R-ONCE' });
  const pressables = (flow: { renderer: TestRenderer.ReactTestRenderer }, text: string) => flow.renderer.root.findAll((node) => typeof node.props.onPress === 'function' && (node.props.accessibilityLabel === text || node.findAll((child) => String(child.type).includes('Text') && child.props.children === text).length > 0));
  const assertNoNewAttemptEntry = (flow: { renderer: TestRenderer.ReactTestRenderer }) => {
    for (const entry of ['Continuar con transferencia', 'Transferir dinero', 'Transferir dinero, elegir beneficiario', 'Cambiar beneficiario', 'Elegir otro destinatario']) assert.equal(pressables(flow, entry).length, 0, `Home must not offer "${entry}" while an attempt is unresolved`);
  };
  const withAppState = async (run: (emit: (state: string) => Promise<void>) => Promise<void>) => {
    const listeners: Array<(state: string) => void> = [];
    const original = AppState.addEventListener;
    AppState.addEventListener = ((_type: string, listener: (state: string) => void) => { listeners.push(listener); return { remove: () => { listeners.splice(listeners.indexOf(listener), 1); } }; }) as unknown as typeof AppState.addEventListener;
    try { await run(async (state) => { await TestRenderer.act(async () => { listeners.forEach((listener) => listener(state)); }); }); }
    finally { AppState.addEventListener = original; }
  };
  const signIn = async (flow: Awaited<ReturnType<typeof startTransferFlow>>, title = 'Iniciar sesión') => {
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Correo electrónico' }).props.onChangeText('ana@example.com'); flow.renderer.root.findByProps({ accessibilityLabel: 'Contraseña' }).props.onChangeText('password'); });
    await TestRenderer.act(async () => { flow.button(title).props.onPress(); });
    await flow.wait(60);
  };

  it('Home with an unresolved attempt offers no way to start another one (neither the kept destination nor "Transferir dinero"); its action resumes the same key', async () => {
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') throw new TypeError('response lost');
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
    await flow.wait();
    const home = flow.visible();
    assert.match(home, /Transferencia en verificación/);
    assert.match(home, /Podrás hacer otra transferencia cuando conozcamos su resultado/);
    assert.doesNotMatch(home, /DESTINO SELECCIONADO/);
    assertNoNewAttemptEntry(flow);
    assert.ok(pressables(flow, 'Verificar estado de la transferencia').length > 0, 'the only transfer action resumes the pending attempt');
    await TestRenderer.act(async () => { flow.button('Verificar estado de la transferencia').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Estamos verificando si tu transferencia se completó/);
    assert.ok(creates(flow).length >= 2);
    assert.equal(new Set(creates(flow).map(keyOf)).size, 1, '0 POST /transfers with a different Idempotency-Key');
    await flow.finish();
  });

  it('defence in depth: confirming a new attempt while this user has a stored unresolved one sends nothing new and shows that attempt instead', async () => {
    const pending = { key: 'pending-key', payload: { sourceAccountId: 'source-1', destinationType: 'beneficiary', beneficiaryId: 'beneficiary-1', amountMinor: '30025', concept: 'Prueba doble', reference: '4401' }, userId: 'user-guard' };
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/auth/login')) return login('user-guard');
      if (url.endsWith('/transfers') && init?.method === 'POST') throw new TypeError('offline');
      return undefined;
    }, { amount: '850.00' });
    // E.g. written by a previous run of the app for this same user (the review step was reached before it was read).
    mockSecureValues.set(recoveryKeyOf('user-guard'), JSON.stringify(pending));
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.ok(creates(flow).every((call) => keyOf(call) === 'pending-key'), 'no POST with a new key');
    assert.ok(creates(flow).every((call) => JSON.parse(String(call.init?.body)).amountMinor === '30025'), 'only the stored attempt is replayed');
    assert.match(flow.visible(), /Transferencia en verificación/);
    assert.match(flow.visible(), /"\$300.25 MXN"/);
    assert.equal(JSON.parse(mockSecureValues.get(recoveryKeyOf('user-guard'))!).key, 'pending-key', 'the stored attempt is not overwritten');
    assertNoNewAttemptEntry(flow);
    await flow.finish();
  });

  it('"Cerrar sesión" keeps the user\'s own record; signing in again resumes it with the same key and lands on the real result', async () => {
    let sends = 0;
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/auth/login')) return login('user-a');
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      if (url.endsWith('/transfers') && init?.method === 'POST') { sends += 1; if (sends <= 2) throw new TypeError('response lost'); return Response.json(done, { status: 201 }); }
      if (url.endsWith('/transfers/tr-once')) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
    await flow.wait();
    const record = mockSecureValues.get(recoveryKeyOf('user-a'));
    assert.ok(record);
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Iniciar sesión/);
    assert.equal(mockSecureValues.get(recoveryKeyOf('user-a')), record, 'an explicit logout does not delete the own pending record');
    await signIn(flow);
    assert.match(flow.visible(), /"Transferencia completada"/);
    assert.equal(sends, 3);
    assert.equal(new Set(creates(flow).map(keyOf)).size, 1);
    assert.equal(storedRecovery(), undefined, 'resolved: the record is gone');
    await flow.finish();
  });

  it('another user signing in and out on the device (even after transferring) never deletes nor replaces user A\'s record', async () => {
    const aRecord = JSON.stringify({ key: 'a-key', payload: { sourceAccountId: 'a-source', destinationType: 'beneficiary', beneficiaryId: 'a-ben', amountMinor: '30025', concept: 'A', reference: '1' }, userId: 'user-a' });
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/auth/login')) return login('user-b');
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json(done, { status: 201 });
      if (url.endsWith('/transfers/tr-once')) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    // Round 7 wrote the single (legacy) slot; it belongs to user A.
    mockSecureValues.set(RECOVERY_KEY, aRecord);
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /"Transferencia completada"/, 'B is not blocked by A\'s record');
    assert.ok(creates(flow).every((call) => keyOf(call) !== 'a-key'), 'A\'s attempt is never replayed under B');
    await TestRenderer.act(async () => { flow.button('Ir al inicio').props.onPress(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /Transferencia en verificación|pendiente de autorizar/);
    await TestRenderer.act(async () => { flow.renderer.root.findByProps({ accessibilityLabel: 'Cerrar sesión' }).props.onPress(); });
    await flow.wait();
    assert.equal(mockSecureValues.get(RECOVERY_KEY), aRecord, 'B\'s logout leaves A\'s record untouched');
    assert.equal(mockSecureValues.get(recoveryKeyOf('user-b')), undefined);
    await flow.finish();
  });

  it('Home resolves the attempt by itself (same key): completed -> receipt, record cleared, the transfer flow is offered again', async () => {
    let sends = 0;
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') { sends += 1; if (sends === 1) throw new TypeError('response lost after the server applied it'); return Response.json(done, { status: 201 }); }
      if (url.endsWith('/transfers/tr-once')) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
    await flow.wait(60);
    assert.match(flow.visible(), /"Transferencia completada"/, 'the real result is shown');
    assert.match(flow.visible(), /R-ONCE/);
    assert.equal(sends, 2);
    assert.equal(new Set(creates(flow).map(keyOf)).size, 1);
    assert.equal(storedRecovery(), undefined);
    await TestRenderer.act(async () => { flow.button('Ir al inicio').props.onPress(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /Transferencia en verificación/);
    assert.ok(pressables(flow, 'Continuar con transferencia').length > 0, 'the flow is enabled again');
    await flow.finish();
  });

  it('returning to the foreground with a valid session re-checks the pending attempt with the same key', async () => {
    await withAppState(async (emit) => {
      let sends = 0;
      const flow = await startTransferFlow((url, init) => {
        if (url.endsWith('/auth/me')) return Response.json({ id: 'u', fullName: 'Ana López', email: 'ana@example.com' });
        if (url.endsWith('/transfers') && init?.method === 'POST') { sends += 1; if (sends <= 2) throw new TypeError('response lost'); return Response.json(done, { status: 201 }); }
        if (url.endsWith('/transfers/tr-once')) return Response.json(done);
        return undefined;
      }, { amount: '850.00' });
      await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
      await flow.wait();
      await TestRenderer.act(async () => { flow.button('Ir al inicio (revisar saldo después)').props.onPress(); });
      await flow.wait();
      assert.match(flow.visible(), /Transferencia en verificación/);
      assert.match(flow.visible(), /Sin respuesta por ahora/);
      assert.equal(sends, 2);
      await emit('background');
      await emit('active');
      await flow.wait(60);
      assert.equal(sends, 3);
      assert.equal(new Set(creates(flow).map(keyOf)).size, 1);
      assert.match(flow.visible(), /"Transferencia completada"/);
      await flow.finish();
    });
  });

  it('leaving the code step when the cancel cannot be confirmed keeps the attempt; Home only offers to continue it', async () => {
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return Response.json({ ...flowTransfer({ id: 'tr-open', expiresAt: new Date(Date.now() + 120_000).toISOString() }), demoOnlyCode: '111111' }, { status: 202 });
      if (url.endsWith('/transfers/tr-open/cancel') || url.endsWith('/transfers/tr-open')) throw new TypeError('Network request failed');
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Cancelar y volver a revisar').props.onPress(); });
    await flow.wait();
    const home = flow.visible();
    assert.match(home, /Transferencia pendiente de autorizar/);
    assert.ok(pressables(flow, 'Continuar con la transferencia pendiente').length > 0);
    assertNoNewAttemptEntry(flow);
    assert.equal(JSON.parse(storedRecovery()!).transferId, 'tr-open', 'the possibly open attempt stays recorded');
    assert.equal(creates(flow).length, 1);
    await flow.finish();
  });
});

describe('round 7 · 7: M11 reasons, real amounts and "no debit" only for confirmed business rejections', () => {
  const run = async (respond: () => Response) => {
    const flow = await startTransferFlow((url, init) => {
      if (url.endsWith('/transfers') && init?.method === 'POST') return respond();
      if (url.endsWith('/transfer-policy')) return Response.json(demoPolicy({ dailyUsedMinor: '1950000', dailyRemainingMinor: '50000' }));
      return undefined;
    }, { amount: '850.00' });
    await flow.wait();
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait(60);
    return flow;
  };

  it('daily limit (429 "Se excedió el límite diario"): limit reason with today\'s remaining amount, no debit, a way to fix it', async () => {
    const flow = await run(() => Response.json({ title: 'Too Many Requests', detail: 'Se excedió el límite diario.' }, { status: 429 }));
    const screen = flow.visible();
    assert.match(screen, /supera lo disponible hoy según el límite diario de demostración/);
    assert.match(screen, /"\$850.00 MXN"/);
    assert.match(screen, /"\$500.00 MXN"/, 'remaining today from GET /transfer-policy');
    assert.match(screen, /Disponible hoy \(límite diario\)/);
    assert.match(screen, /Tu dinero está intacto/);
    assert.match(screen, /"Importe debitado"/);
    assert.ok(flow.button('Modificar monto o cuenta'));
    await flow.finish();
  });

  it('insufficient balance (422): balance reason with the requested and available amounts and no debit', async () => {
    const flow = await run(() => Response.json({ title: 'Unprocessable Entity', detail: 'Saldo insuficiente.' }, { status: 422 }));
    const screen = flow.visible();
    assert.match(screen, /supera el saldo disponible actual en tu cuenta/);
    assert.match(screen, /"\$850.00 MXN"/);
    assert.match(screen, /"\$12,450.00 MXN"/);
    assert.match(screen, /Ningún dinero fue retirado/);
    await flow.finish();
  });

  it('a connection error is never presented as a rejection', async () => {
    const flow = await run(() => { throw new TypeError('Network request failed'); });
    const screen = flow.visible();
    assert.doesNotMatch(screen, /No se pudo completar la transferencia|intacto|debitado|Ningún dinero/);
    assert.match(screen, /Estamos verificando si tu transferencia se completó/);
    await flow.finish();
  });

  it('a 429 that is not the daily limit (e.g. a rate limit) does not claim the money is intact', async () => {
    const flow = await run(() => Response.json({ title: 'Too Many Requests', detail: 'Intenta de nuevo más tarde.' }, { status: 429 }));
    const screen = flow.visible();
    assert.doesNotMatch(screen, /Tu dinero está intacto|Importe debitado/);
    assert.match(screen, /Revisa tu saldo antes de reintentar/);
    await flow.finish();
  });
});

describe('F-20: composite controls name ALL their visible content (amount with sign, status, date; alias, last digits)', () => {
  type Node = TestRenderer.ReactTestInstance;
  const norm = (value: string) => value.toLocaleLowerCase('es-MX').replace(/\s+/g, ' ').trim();
  const textOf = (node: Node): string => node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
  const hidden = (node: Node | null): boolean => { for (let current = node; current; current = current.parent) if (current.props.accessibilityElementsHidden) return true; return false; };
  // Icon glyphs (vector-icon fonts) and decorative avatars (initials, hidden from assistive technologies) are not part of the name.
  const isIcon = (node: Node) => /ionicons|material/i.test(JSON.stringify(node.props.style ?? ''));
  const visibleTexts = (control: Node) => control.findAll((node) => String(node.type) === 'Text' && String(node.parent?.type) !== 'Text' && !hidden(node) && !isIcon(node)).map(textOf).filter((text) => /\p{L}|\d/u.test(text));
  const assertAllInName = (renderer: TestRenderer.ReactTestRenderer, screen: string, filter: (label: string) => boolean) => {
    const controls = renderer.root.findAll((node) => typeof node.props.onPress === 'function' && typeof node.props.accessibilityLabel === 'string' && typeof node.type !== 'string' && filter(node.props.accessibilityLabel), { deep: false });
    assert.ok(controls.length > 0, `${screen}: composite controls found`);
    for (const control of controls) {
      const label = norm(control.props.accessibilityLabel as string);
      for (const shown of visibleTexts(control)) assert.ok(label.includes(norm(shown)), `${screen}: name "${control.props.accessibilityLabel}" omits the visible "${shown}"`);
    }
    return controls.length;
  };
  const today = new Date().toISOString();
  const movements = [
    { id: 'm1', transferId: 't1', type: 'debit', amountMinor: '85000', currency: 'MXN', concept: 'Comida', reference: '131126', status: 'completed', occurredAt: today, counterparty: { name: 'Carlos Ruiz', clabeMasked: '000•••••••••••1231' } },
    { id: 'm2', transferId: 't2', type: 'credit', amountMinor: '150000', currency: 'MXN', concept: 'Nómina', reference: '7', status: 'processing', occurredAt: today, counterparty: { name: 'Empresa Demo', clabeMasked: '000•••••••••••9911' } },
    { id: 'm3', transferId: 't3', type: 'debit', amountMinor: '30025', currency: 'MXN', concept: 'Ahorro', reference: '1546', status: 'completed', occurredAt: today, counterparty: { name: 'Ahorro', clabeMasked: '646•••••••••••5719', ownAccountId: 'savings-1' } },
  ];

  it('M02 and M03 movement rows, M03 account options', async () => {
    const app = await loginWith((url) => {
      if (url.endsWith('/accounts')) return Response.json({ items: [flowAccount, savingsAccount] });
      if (url.includes('/movements?limit=20')) return Response.json({ items: movements, nextCursor: null });
      return undefined;
    });
    const rows = (label: string) => /, (Cargo|Abono)$/.test(label);
    assert.equal(assertAllInName(app.renderer, 'M02', rows), 3);
    const carlos = app.renderer.root.findAll((node) => /^A Carlos Ruiz, /.test(node.props.accessibilityLabel ?? '') && typeof node.props.onPress === 'function')[0]!;
    assert.match(carlos.props.accessibilityLabel, /-\$850\.00 MXN/);
    assert.match(carlos.props.accessibilityLabel, /Completado/);
    assert.match(carlos.props.accessibilityLabel, /•• 1231 · Comida/);
    await TestRenderer.act(async () => { app.button('Ver los últimos 20 movimientos').props.onPress(); });
    await app.wait();
    assert.equal(assertAllInName(app.renderer, 'M03', rows), 3);
    const pending = app.renderer.root.findAll((node) => /^De Empresa Demo, /.test(node.props.accessibilityLabel ?? '') && typeof node.props.onPress === 'function')[0]!;
    assert.match(pending.props.accessibilityLabel, /\+\$1,500\.00 MXN/);
    assert.match(pending.props.accessibilityLabel, /En proceso/);
    assert.match(pending.props.accessibilityLabel, /HOY|Hoy|hoy/);
    await TestRenderer.act(async () => { app.renderer.root.findAll((node) => /cambiar cuenta$/.test(node.props.accessibilityLabel ?? '') && typeof node.props.onPress === 'function')[0]!.props.onPress(); });
    assert.equal(assertAllInName(app.renderer, 'M03 account options', (label) => label.endsWith('ver sus movimientos')), 2);
    await app.finish();
  });

  it('M05 beneficiary cards (incl. the incompatible one) and M06 origin options', async () => {
    const app = await sameAccountApp();
    await app.press('Ahorro •• 5719');
    await app.press('Transferir dinero, elegir beneficiario');
    assert.equal(assertAllInName(app.renderer, 'M05', (label) => label.startsWith('Seleccionar ')), 2);
    assert.ok(assertAllInName(app.renderer, 'M05 origin options', (label) => label.startsWith('Usar ')) >= 2);
    await app.choose('Carlos');
    await TestRenderer.act(async () => { app.button('Continuar con transferencia').props.onPress(); });
    await app.press('Cambiar cuenta de origen');
    assert.equal(assertAllInName(app.renderer, 'M06 origin options', (label) => label.startsWith('Usar ')), 2);
    await app.finish();
  });
});

describe('round 7 H2: M10 receipt share and PDF actions', () => {
  const PDF_URI = 'file:///cache/Print/receipt.pdf';
  const folio = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  const done = flowTransfer({ id: folio, status: 'completed', amountMinor: '85000', completedAt: '2026-11-13T20:32:00.000Z', receiptReference: folio, demoOnlyCode: '742890' });
  const mocks = () => ({ print: jest.requireMock('expo-print').printToFileAsync as jest.Mock, available: jest.requireMock('expo-sharing').isAvailableAsync as jest.Mock, share: jest.requireMock('expo-sharing').shareAsync as jest.Mock, remove: jest.requireMock('expo-file-system/legacy').deleteAsync as jest.Mock });
  const completedFlow = async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json(done, { status: 201 });
      if (url.endsWith(`/transfers/${folio}`)) return Response.json(done);
      return undefined;
    }, { amount: '850.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    return flow;
  };
  beforeEach(() => {
    const m = mocks();
    m.print.mockReset().mockResolvedValue({ uri: PDF_URI, numberOfPages: 1 });
    m.available.mockReset().mockResolvedValue(true);
    m.share.mockReset().mockResolvedValue(undefined);
    m.remove.mockReset().mockResolvedValue(undefined);
  });

  it('"Guardar PDF" generates from the confirmed transfer, shows the generating state, blocks double taps and cleans up', async () => {
    const m = mocks();
    let close!: () => void;
    m.share.mockImplementation(() => new Promise<void>((resolve) => { close = resolve; }));
    const flow = await completedFlow();
    const pdf = flow.button('Guardar PDF');
    await TestRenderer.act(async () => { pdf.props.onPress(); pdf.props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /Generando el PDF del comprobante…/);
    assert.equal(m.print.mock.calls.length, 1, 'a double tap generates once');
    const html = String(m.print.mock.calls[0][0].html);
    assert.ok(html.includes(folio) && html.includes('Comprobante interno de demostración'));
    assert.ok(!html.includes('742890') && !html.includes('ana@example.com') && !html.includes('000000000000008412'));
    assert.equal(flow.renderer.root.findAll((node) => node.type === ActivityIndicator && node.props.accessibilityLabel === 'Guardar PDF').length, 1, 'busy indicator named after the action');
    assert.equal(flow.button('Compartir comprobante').props.disabled, true, 'the other action waits too');
    await TestRenderer.act(async () => { close(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /Generando|No se pudo/, 'closing the sheet restores the UI without a failure message');
    assert.equal(JSON.stringify(m.remove.mock.calls[0]), JSON.stringify([PDF_URI, { idempotent: true }]));
    await flow.finish();
  });

  it('a generation error shows a retryable Spanish message', async () => {
    const m = mocks();
    m.print.mockRejectedValueOnce(new Error('disk /var/x'));
    const flow = await completedFlow();
    await TestRenderer.act(async () => { flow.button('Guardar PDF').props.onPress(); });
    await flow.wait();
    assert.match(flow.visible(), /No se pudo generar el PDF del comprobante. Inténtalo de nuevo./);
    assert.doesNotMatch(flow.visible(), /\/var\//);
    await TestRenderer.act(async () => { flow.button('Guardar PDF').props.onPress(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /No se pudo generar/);
    assert.equal(m.share.mock.calls.length, 1);
    await flow.finish();
  });

  it('pending (code step) and uncertain screens offer no receipt actions', async () => {
    const flow = await startTransferFlow((url) => {
      if (url.endsWith('/transfers')) return Response.json({ ...flowTransfer(), demoOnlyCode: '742890' }, { status: 202 });
      return undefined;
    }, { amount: '6000.00' });
    await TestRenderer.act(async () => { flow.button('Confirmar transferencia').props.onPress(); });
    await flow.wait();
    assert.doesNotMatch(flow.visible(), /Compartir comprobante|Guardar PDF|Opciones de comprobante/);
    await flow.finish();
  });
});
