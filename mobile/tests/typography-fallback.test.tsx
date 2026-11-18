import React from 'react';
import assert from 'node:assert/strict';
import { StyleSheet, Text } from 'react-native';
import TestRenderer from 'react-test-renderer';

// Separate file: the typeface decision is made once per app start (module state).
jest.mock('expo-font', () => ({
  isLoaded: () => false,
  // Only Inter fails; icon fonts (also loaded through expo-font) keep working.
  loadAsync: (map: Record<string, unknown> | string) => (typeof map === 'object' && Object.keys(map).some((name) => name.startsWith('Inter_')) ? Promise.reject(new Error('font asset unavailable')) : Promise.resolve()),
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => {
  const ReactNative = jest.requireActual('react-native') as typeof import('react-native');
  return { SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children, SafeAreaView: ReactNative.View };
});

it('falls back to the system font with real weights when Inter cannot be loaded, and the app still opens', async () => {
  process.env.EXPO_PUBLIC_API_URL = 'https://wallet.test/v1';
  const App = (jest.requireActual('../App') as { default: React.ComponentType }).default;
  let renderer: TestRenderer.ReactTestRenderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(<App />); });
  await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const title = renderer!.root.findAllByType(Text).map((node) => ({ text: node.props.children, style: StyleSheet.flatten(node.props.style) ?? {} })).find((entry) => entry.text === 'Iniciar sesión' && entry.style.fontSize === 28);
  assert.ok(title, 'login renders without Inter');
  assert.equal(title.style.fontFamily, undefined, 'no reference to a family that was never registered');
  assert.equal(title.style.fontWeight, '600');
  await TestRenderer.act(async () => { renderer!.unmount(); });
});
