import React from 'react';
import assert from 'node:assert/strict';
import { StyleSheet, Text } from 'react-native';
import TestRenderer from 'react-test-renderer';

// Separate file: the typeface decision is made once per app start (module state). F-17: a download that hangs (no error,
// no answer) must not leave the user on the loading view for long; the safe system-font fallback takes over at 2.5 s.
jest.mock('expo-font', () => ({
  isLoaded: () => false,
  // Inter never settles; icon fonts (also loaded through expo-font) keep working.
  loadAsync: (map: Record<string, unknown> | string) => (typeof map === 'object' && Object.keys(map).some((name) => name.startsWith('Inter_')) ? new Promise(() => undefined) : Promise.resolve()),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

const loginTitle = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map((node) => ({ text: node.props.children, style: StyleSheet.flatten(node.props.style) ?? {} })).find((entry) => entry.text === 'Iniciar sesión' && entry.style.fontSize === 28);
const flush = async () => { for (let i = 0; i < 5; i += 1) await TestRenderer.act(async () => { await Promise.resolve(); }); };

afterEach(() => { jest.useRealTimers(); });

it('a hanging Inter download falls back to the system font after 2.5 s (not 6 s) and the login opens', async () => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
  const { FONT_LOAD_TIMEOUT_MS } = jest.requireActual('../src/typography') as typeof import('../src/typography');
  assert.ok(FONT_LOAD_TIMEOUT_MS <= 2500, `timeout ${FONT_LOAD_TIMEOUT_MS} ms`);
  const App = (jest.requireActual('../App') as { default: React.ComponentType }).default;
  let renderer: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
  await TestRenderer.act(async () => { jest.advanceTimersByTime(2400); });
  await flush();
  assert.equal(loginTitle(renderer!), undefined, 'still loading at 2.4 s');
  assert.ok(renderer!.root.findAllByProps({ accessibilityLabel: 'Cargando' }).length > 0, 'with a visible loading indicator');
  await TestRenderer.act(async () => { jest.advanceTimersByTime(100); });
  await flush();
  const title = loginTitle(renderer!);
  assert.ok(title, 'login renders at 2.5 s without Inter');
  assert.equal(title.style.fontFamily, undefined, 'system font: no reference to a family that never registered');
  assert.equal(title.style.fontWeight, '600', 'with its real weight');
  await TestRenderer.act(async () => { renderer!.unmount(); });
});
