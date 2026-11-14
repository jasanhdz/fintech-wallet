import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { App } from '../src/App.js';

test('web renders the BOOT-00 placeholder copy', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(App()));
  assert.equal(dom.window.document.querySelector('main')?.textContent, 'Entorno preparado. Diseño pendiente');
  await act(async () => root.unmount());
  dom.window.close();
});
