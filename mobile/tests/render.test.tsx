import React from 'react';
import assert from 'node:assert/strict';
import TestRenderer from 'react-test-renderer';
import App from '../App';

describe('mobile BOOT-00 render', () => {
  it('performs a React Native renderer render of the BOOT-00 copy', () => {
  let rendered: TestRenderer.ReactTestRenderer | undefined;
  TestRenderer.act(() => { rendered = TestRenderer.create(<App />); });
  const textNode = rendered?.root.findAll((node) => String(node.type) === 'Text')[0];
  assert.equal(textNode?.props.children, 'Entorno preparado. Diseño pendiente');
  TestRenderer.act(() => rendered?.unmount());
  });
});
