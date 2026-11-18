import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTransferDemoCode } from '../src/transfer-presentation.js';

test('preserves the create-response demo code when an awaiting status GET omits it', () => {
  const fresh = { id: 't-1', status: 'awaiting_confirmation' as const, amountMinor: '100' };
  const merged = mergeTransferDemoCode(fresh, { demoOnlyCode: '123456' });
  assert.deepEqual(merged, { ...fresh, demoOnlyCode: '123456' });
});

test('does not carry a demo code into a fresh code or terminal status', () => {
  const awaitingWithCode = { id: 't-1', status: 'awaiting_confirmation' as const, demoOnlyCode: '654321' };
  const completed = { id: 't-1', status: 'completed' as const };
  assert.equal(mergeTransferDemoCode(awaitingWithCode, { demoOnlyCode: '123456' }).demoOnlyCode, '654321');
  assert.deepEqual(mergeTransferDemoCode(completed, { demoOnlyCode: '123456' }), completed);
});
