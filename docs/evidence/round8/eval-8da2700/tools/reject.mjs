// R8-09 terminal typed rejections + header validation 400s + web (no headers) re-evaluation. 3955: no OTP, huge limit; 3956: daily limit 500.
import * as E from './lib8.mjs';
const { L, ok, q, one, call, send, voidA, listA, epochOf, ownBody, newKey, uuid, T_REJECTED, T_VOIDED } = E;
const port = E.PORT;
const u = await E.register('rej' + port); const epoch = await epochOf(u);
const sec = (await call(u.token, '/accounts')).b;
const cnt0 = await E.counts(u.id);
if (port === 3955) {
  L('== 422 saldo insuficiente con cabeceras');
  const key = newKey(), attemptId = uuid(); const bal0 = await E.balOf(u);
  const r = await send(u, ownBody(u, 2000000), { key, attemptId, epoch });
  ok(r.s === 422 && r.b.type === T_REJECTED && r.ct.startsWith('application/problem+json'), '422 typed transfer-attempt-rejected', { s: r.s, t: r.b.type });
  const c = await E.counts(u.id); const cl = await q('select status,problem_status from transfer_attempt_closures where owner_id=$1', [u.id]);
  ok(c.transfers === 0 && c.entries === 0 && cl.length === 1 && cl[0].status === 'rejected' && cl[0].problem_status === 422 && (await E.balOf(u)).checking === bal0.checking, '1 rejected closure, 0 transfers/entries, balance unchanged', cl);
  // fund the balance, replay -> still rejected same status
  const donor = await E.register('donor' + port);
  await q('update accounts set balance_minor = balance_minor + 5000000 where id=$1', [u.pr.id]).catch((e) => L('(cannot fund via runtime role: ' + e.message + ')'));
  const r2 = await send(u, ownBody(u, 2000000), { key, attemptId, epoch });
  ok(r2.s === 422 && r2.b.type === T_REJECTED && r2.b.detail === r.b.detail, 'after funding: replay still 422 rejected (terminal for the identity)', { s: r2.s });
  ok((await E.counts(u.id)).transfers === 0, 'still 0 transfers');
  const r3 = await send(u, ownBody(u, 2000000), { key }); ok(r3.s === 422 && r3.b.type === T_REJECTED, 'same key WITHOUT headers -> still typed rejected (key closed)');
  const r4 = await send(u, ownBody(u, 2000001), { key, attemptId, epoch }); ok(r4.s === 409, 'same key, other payload -> 409', r4.s);
  const r5 = await send(u, ownBody(u, 2000000), { key: newKey(), attemptId, epoch }); ok(r5.s === 409 && r5.b.type === E.T_CONFLICT, 'same identity, other key -> 409 conflict', { s: r5.s, t: r5.b.type });
  const vv = await voidA(u, key, attemptId); ok(vv.s === 200 && vv.b.resolution === 'rejected', 'void on rejected -> resolution rejected (no new closure)', vv.b?.resolution);
  ok((await E.auditCount(u.id, 'transfer.attempt_rejected')) === 1, '1 audit transfer.attempt_rejected');
  // 8 concurrent rejected
  const k2 = newKey(), a2 = uuid(); const rs = await Promise.all(Array.from({ length: 8 }, () => send(u, ownBody(u, 9000000), { key: k2, attemptId: a2, epoch })));
  ok(rs.every((x) => x.s === 422 && x.b.type === T_REJECTED) && (await q('select 1 from transfer_attempt_closures where owner_id=$1 and client_attempt_id=$2', [u.id, a2])).length === 1, '8 concurrent rejected -> 8 x 422 typed, 1 closure');
  L('== 404 beneficiario inexistente');
  const k3 = newKey(), a3 = uuid(); const r6 = await send(u, ownBody(u, 100, { destinationType: 'beneficiary', beneficiaryId: uuid() }), { key: k3, attemptId: a3, epoch });
  ok(r6.s === 404 && r6.b.type === T_REJECTED, '404 typed rejected');
  L('== web-style (no headers) 422 re-evaluated, no closure');
  const before = (await q('select count(*)::int n from transfer_attempt_closures where owner_id=$1', [u.id]))[0].n;
  const k4 = newKey(); const w1 = await send(u, ownBody(u, 90000000), { key: k4 }); ok(w1.s === 422 && w1.b.type === 'about:blank', 'no headers: 422 about:blank');
  ok((await q('select count(*)::int n from transfer_attempt_closures where owner_id=$1', [u.id]))[0].n === before, 'no closure for header-less rejection');
  await q('update accounts set balance_minor = balance_minor + 100000000 where id=$1', [u.pr.id]).catch(() => {});
  const w2 = await send(u, ownBody(u, 90000000), { key: k4 }); ok(w2.s === 201, 'header-less: same key re-evaluated after funding -> 201 (as before round 8)', w2.s);
  L('== header validation 400, nothing written');
  const c0 = await E.counts(u.id); const bad = [];
  const h = (attemptId, epochv) => send(u, ownBody(u, 100), { key: newKey(), attemptId, epoch: epochv });
  bad.push(['only attempt id', await h(uuid(), undefined)], ['only epoch', await h(undefined, '0')], ['attempt id not uuid', await h('abc', '0')], ['epoch 01', await h(uuid(), '01')], ['epoch -1', await h(uuid(), '-1')], ['epoch 1.5', await h(uuid(), '1.5')], ['epoch 20 digits', await h(uuid(), '99999999999999999999')], ['epoch > bigint', await h(uuid(), '9223372036854775808')], ['epoch empty', await h(uuid(), '')], ['epoch future', await h(uuid(), '5')]);
  for (const [n, r] of bad) ok(r.s === 400, `${n} -> 400`, r.s);
  ok(JSON.stringify(await E.counts(u.id)) === JSON.stringify(c0), 'nothing written by the 400s');
  const short = await send(u, ownBody(u, 100), { key: 'short', attemptId: uuid(), epoch }); ok(short.s === 400, 'short idempotency key -> 400');
  const vk = await call(u.token, '/transfer-attempts/void', { method: 'POST', body: JSON.stringify({ idempotencyKey: 'x' }) }); ok(vk.s === 400, 'void with short key -> 400');
  const vx = await call(u.token, '/transfer-attempts/void', { method: 'POST', body: JSON.stringify({ idempotencyKey: newKey(), extra: 1 }) }); ok(vx.s === 400, 'void with unknown field -> 400');
  const va = await call(u.token, '/transfer-attempts/void-all', { method: 'POST', body: JSON.stringify({ fromEpoch: 'x' }) }); ok(va.s === 400, 'void-all bad fromEpoch -> 400');
  const un = await call(null, '/transfer-attempts'); ok(un.s === 401, 'list without token -> 401');
  const un2 = await call(null, '/transfer-attempts/void', { method: 'POST', body: '{}' }); ok(un2.s === 401, 'void without token -> 401');
}
if (port === 3956) {
  L('== 429 limite diario con cabeceras');
  const key = newKey(), attemptId = uuid(); const usage0 = await q('select outgoing_minor::text o from daily_limit_usage where owner_id=$1', [u.id]);
  const r = await send(u, ownBody(u, 600), { key, attemptId, epoch });
  ok(r.s === 429 && r.b.type === T_REJECTED, '429 typed rejected', { s: r.s, t: r.b.type });
  const r2 = await send(u, ownBody(u, 600), { key, attemptId, epoch }); ok(r2.s === 429 && r2.b.type === T_REJECTED, 'replay same 429');
  ok(JSON.stringify(await q('select outgoing_minor::text o from daily_limit_usage where owner_id=$1', [u.id])) === JSON.stringify(usage0) && (await E.counts(u.id)).transfers === 0, 'no consumption of daily limit, 0 transfers');
  const l = await listA(u, { status: 'rejected' }); ok(l.b.items.length === 1 && l.b.items[0].problem.status === 429, 'listed as rejected with problem 429');
}
await E.done();
