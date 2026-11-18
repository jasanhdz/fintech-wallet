import React from 'react';
import assert from 'node:assert/strict';
import TestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('../App', () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
  return jest.requireActual('../App');
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
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
    secureStore.getItemAsync.mockResolvedValueOnce(null).mockResolvedValue('refresh-secret');
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
    assert.equal(secureStore.deleteItemAsync.mock.calls.length, 1);
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
    secureStore.getItemAsync.mockResolvedValueOnce(null).mockResolvedValue('refresh-secret');
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
    assert.equal(secureStore.deleteItemAsync.mock.calls.length, 1);
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
  it('blocks invalid amounts and retries an uncertain create with the identical key and payload', async () => {
    const secureStore = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock };
    secureStore.getItemAsync.mockResolvedValueOnce(null);
    let sends = 0;
    const fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return Response.json({ accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresIn: 300, user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' } });
      if (url.endsWith('/accounts')) return Response.json({ items: [{ id: 'source-1', name: 'Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '125000', clabe: '000000000000000000', clabeMasked: '••••0000' }] });
      if (url.endsWith('/beneficiaries')) return Response.json({ items: [{ id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }] });
      if (url.endsWith('/transfers')) {
        sends += 1;
        if (sends === 1) throw new Error('offline');
        return Response.json({ id: 'transfer-1', status: 'awaiting_confirmation', sourceAccountId: 'source-1', destination: { id: 'beneficiary-1', name: 'Grace Hopper', alias: 'Grace', clabeMasked: '••••1234', destinationAccountId: 'dest-1' }, amountMinor: '1234', currency: 'MXN', concept: 'Comida', reference: '123', createdAt: new Date().toISOString(), demoOnlyCode: '654321' }, { status: 202 });
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
    await TestRenderer.act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Elegir beneficiario' }).props.onPress(); });
    await TestRenderer.act(async () => { await Promise.resolve(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const beneficiaryButton = renderer!.root.findAll((node) => node.props.accessibilityLabel?.startsWith('Seleccionar Grace'))[0];
    assert.ok(beneficiaryButton);
    await TestRenderer.act(async () => { beneficiaryButton.props.onPress(); });
    await TestRenderer.act(async () => { button('Continuar con transferencia').props.onPress(); });
    const amountInput = renderer!.root.findByProps({ accessibilityLabel: 'Importe' });
    await TestRenderer.act(async () => { amountInput.props.onChangeText('12.345'); });
    assert.equal(renderer!.root.findAll((node) => node.props.accessibilityRole === 'button').some((node) => node.findAll((child) => child.props.children === 'Revisar transferencia').length > 0), false);
    await TestRenderer.act(async () => { amountInput.props.onChangeText('12.34'); renderer!.root.findByProps({ accessibilityLabel: 'Concepto' }).props.onChangeText('Comida'); renderer!.root.findByProps({ accessibilityLabel: 'Referencia' }).props.onChangeText('123'); });
    await TestRenderer.act(async () => { button('Revisar transferencia').props.onPress(); });
    await TestRenderer.act(async () => { button('Confirmar transferencia').props.onPress(); });
    const createCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/transfers')) as [RequestInfo | URL, RequestInit?][];
    assert.equal(createCalls().length, 1);
    const first = createCalls()[0];
    assert.ok(first);
    const firstPayload = JSON.parse(String(first[1]?.body));
    assert.equal(firstPayload.amountMinor, '1234');
    await TestRenderer.act(async () => { button('Reintentar el mismo envío').props.onPress(); });
    const second = createCalls()[1];
    assert.ok(second);
    assert.equal((second[1]?.headers as Record<string, string>)['Idempotency-Key'], (first[1]?.headers as Record<string, string>)['Idempotency-Key']);
    assert.deepEqual(JSON.parse(String(second[1]?.body)), firstPayload);
    assert.match(JSON.stringify(renderer!.toJSON()), /654321/);
    await TestRenderer.act(async () => { renderer!.unmount(); });
    delete (global as { fetch?: typeof fetch }).fetch;
  });
});
