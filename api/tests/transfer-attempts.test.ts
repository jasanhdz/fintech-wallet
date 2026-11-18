import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeAttemptCursor, parseAttemptCursor, parseAttemptQuery } from '../src/transfers/attempts.js';
import { parseAttemptHeaders, parseEpoch } from '../src/transfers/faults.js';

const id = '3f6c1a52-8f0e-4c4b-9a59-1b2b7d0e9c11';
const at = '2026-11-17T08:00:00.123456Z';

test('attempt cursor round-trips canonically and rejects any alteration', () => {
  const cursor = encodeAttemptCursor({ at, kind: 'transfer', id });
  assert.deepEqual(parseAttemptCursor(cursor), { at, kind: 'transfer', id });
  assert.deepEqual(parseAttemptCursor(encodeAttemptCursor({ at, kind: 'closure', id })), { at, kind: 'closure', id });
  const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const bad of [
    `${cursor}A`, cursor.slice(0, -2), 'not base64!', '', 'x'.repeat(513),
    json({ at, kind: 'other', id }), json({ at: '2026-11-17T08:00:00.123Z', kind: 'transfer', id }), json({ at, kind: 'transfer', id: 'nope' }),
    json({ at, kind: 'transfer', id, extra: 1 }), json({ kind: 'transfer', at, id }), json([at, 'transfer', id]), json({ at, kind: 'transfer' }),
  ]) assert.throws(() => parseAttemptCursor(bad), (error: { status?: number }) => error.status === 400, `cursor ${bad.slice(0, 40)}`);
});

test('attempt query validates status list, dates, attemptId and limit 1..50', () => {
  assert.deepEqual(parseAttemptQuery({}), { statuses: undefined, from: undefined, to: undefined, attemptId: undefined, limit: 20, cursor: undefined });
  const parsed = parseAttemptQuery({ status: 'rejected,voided', from: '2026-11-17T00:00:00Z', to: '2026-11-17T23:59:59.999Z', attemptId: id.toUpperCase(), limit: '50' });
  assert.deepEqual(parsed.statuses, ['rejected', 'voided']); assert.equal(parsed.attemptId, id); assert.equal(parsed.limit, 50);
  assert.equal(parseAttemptQuery({ limit: '1' }).limit, 1);
  for (const query of [
    { limit: '0' }, { limit: '51' }, { limit: 'x' }, { limit: '01' }, { limit: ['1', '2'] },
    { status: '' }, { status: 'completed,' }, { status: 'processing' }, { status: ['completed'] },
    { from: '2026-11-17' }, { from: 'yesterday' }, { from: '2026-11-18T00:00:00Z', to: '2026-11-17T00:00:00Z' },
    { attemptId: 'abc' }, { cursor: 'Zm9v' },
  ]) assert.throws(() => parseAttemptQuery(query as Record<string, unknown>), (error: { status?: number }) => error.status === 400, JSON.stringify(query));
});

test('Transfer-Attempt-Id and Transfer-Send-Epoch are both-or-none, UUID and bigint decimal', () => {
  assert.equal(parseAttemptHeaders(undefined, undefined), undefined);
  assert.deepEqual(parseAttemptHeaders(id.toUpperCase(), '0'), { attemptId: id, epoch: 0n });
  assert.deepEqual(parseAttemptHeaders(id, '9223372036854775807'), { attemptId: id, epoch: 9223372036854775807n });
  for (const [attemptId, epoch] of [[id, undefined], [undefined, '0'], ['', '0'], ['not-a-uuid', '0'], [id, ''], [id, '01'], [id, '-1'], [id, '1.0'], [id, '9223372036854775808'], [id, '12345678901234567890']] as const) {
    assert.throws(() => parseAttemptHeaders(attemptId, epoch), (error: { status?: number }) => error.status === 400, `${attemptId} ${epoch}`);
  }
  assert.equal(parseEpoch(5), undefined); assert.equal(parseEpoch('7'), 7n);
});
