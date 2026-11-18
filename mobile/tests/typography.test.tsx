import React from 'react';
import assert from 'node:assert/strict';
import { StyleSheet, Text } from 'react-native';
import TestRenderer from 'react-test-renderer';
import { INTER_FAMILIES, interFamily, withInter } from '../src/typography';

const mockFont = { loaded: false, load: jest.fn<Promise<void>, [Record<string, unknown>]>() };
jest.mock('expo-font', () => ({
  isLoaded: () => mockFont.loaded,
  loadAsync: (map: Record<string, unknown>) => mockFont.load(map),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

const flat = (style: unknown) => StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) ?? {};
const textStyles = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map((node) => ({ text: node.props.children, style: flat(node.props.style) }));
const loginTitle = (renderer: TestRenderer.ReactTestRenderer) => textStyles(renderer).find((entry) => entry.text === 'Iniciar sesión' && entry.style.fontSize === 28);

describe('Inter typography', () => {
  beforeEach(() => { mockFont.loaded = false; mockFont.load.mockReset(); });

  it('maps every weight to its own Inter family and drops fontWeight (no faux bold, no ignored weight on Android)', () => {
    const sheet = withInter({ title: { fontSize: 20, fontWeight: '600' as const }, body: { fontSize: 14 }, nested: { fontWeight: '700' as const, color: '#000' }, mono: { fontFamily: 'Menlo', fontWeight: '700' as const }, box: { padding: 4 } });
    assert.deepEqual(sheet.title, { fontSize: 20, fontFamily: 'Inter_600SemiBold' });
    assert.deepEqual(sheet.body, { fontSize: 14, fontFamily: 'Inter_400Regular' });
    assert.deepEqual(sheet.nested, { color: '#000', fontFamily: 'Inter_700Bold' });
    assert.deepEqual(sheet.mono, { fontFamily: 'Menlo', fontWeight: '700' });
    assert.deepEqual(sheet.box, { padding: 4 });
    assert.equal(interFamily('bold'), INTER_FAMILIES['700']);
    assert.equal(interFamily(500), INTER_FAMILIES['500']);
    assert.equal(interFamily(undefined), INTER_FAMILIES['400']);
  });

  it('waits for Inter (400/500/600/700) before rendering the app, then every text uses an Inter family without fontWeight', async () => {
    let resolveFonts: (() => void) | undefined;
    mockFont.load.mockImplementation(() => new Promise<void>((resolve) => { resolveFonts = resolve; }));
    process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
    const App = (jest.requireActual('../App') as { default: React.ComponentType }).default;
    let renderer: TestRenderer.ReactTestRenderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
    assert.equal(mockFont.load.mock.calls.length, 1);
    assert.deepEqual(Object.keys(mockFont.load.mock.calls[0]![0]).sort(), ['Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold', 'Inter_700Bold']);
    assert.equal(loginTitle(renderer!), undefined, 'nothing is drawn with a fallback font while Inter loads');
    assert.ok(renderer!.root.findAllByProps({ accessibilityLabel: 'Cargando' }).length > 0);
    await TestRenderer.act(async () => { resolveFonts!(); await Promise.resolve(); });
    await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const title = loginTitle(renderer!);
    assert.ok(title, 'login renders once fonts are ready');
    assert.equal(title.style.fontFamily, 'Inter_600SemiBold');
    assert.equal(title.style.fontWeight, undefined);
    const families = new Set(textStyles(renderer!).map((entry) => entry.style.fontFamily).filter(Boolean));
    for (const family of families) assert.ok(/^Inter_|Menlo|monospace|ionicons|material/i.test(String(family)), `unexpected family ${String(family)}`);
    const withoutFamily = textStyles(renderer!).filter((entry) => !entry.style.fontFamily && typeof entry.text === 'string');
    assert.deepEqual(withoutFamily, [], 'every top-level text names a family');
    await TestRenderer.act(async () => { renderer!.unmount(); });
  });
});
