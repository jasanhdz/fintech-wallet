import * as E from './lib8.mjs';
const { L, ok, q, one, call, send, voidA, listA, epochOf, ownBody, newKey, uuid, confirmT } = E;
const which = process.env.EV_CASE;
if (which === 'forced') { // API 3951: default 30 days; force expires_at to the past
  const u = await E.register('exp'); const key = newKey(), attemptId = uuid(), epoch = await epochOf(u);
  const p = await send(u, ownBody(u, 100), { key, attemptId, epoch });
  const row = await one("select extract(epoch from (expires_at-created_at))/86400 d from idempotency_records where user_id=$1 and operation='create-transfer'", [u.id]);
  ok(Math.round(row.d) === 30, 'retention 30 days (env value) on create', row.d);
  await q("update idempotency_records set expires_at = now() - interval '45 days' where user_id=$1", [u.id]);
  const before = await E.counts(u.id), bal = await E.balOf(u);
  const rp = await send(u, ownBody(u, 100), { key, attemptId, epoch }); ok((rp.s === 201 || rp.s === 200) && rp.b.id === p.b.id, 'replay with expires_at 45 days in the past -> same id/status', rp.s);
  const v = await voidA(u, key, attemptId); ok(v.b.resolution === 'transfer_found' && v.b.attempt.transferId === p.b.id, 'void -> transfer_found with expired record');
  const rp2 = await send(u, ownBody(u, 100), { key }); ok(rp2.b.id === p.b.id, 'replay without headers also same id');
  const after = await E.counts(u.id); ok(JSON.stringify(before) === JSON.stringify(after) && (await E.balOf(u)).checking === bal.checking, '0 new rows, balance unchanged', after);
  // thresholds (F-23 unchanged)
  const mk = async (amt) => (await send(u, ownBody(u, amt), { key: newKey(), attemptId: uuid(), epoch })).s;
  const t = [await mk(499999), await mk(500000), await mk(500001)]; ok(JSON.stringify(t) === '[201,202,202]', '4,999.99 -> 201, 5,000.00 -> 202, 5,000.01 -> 202', t);
}
if (which === 'retention2') { // API 3953: retention 2 days, threshold 1000
  const u = await E.register('exp2'); const epoch = await epochOf(u); const key = newKey();
  const p = await send(u, ownBody(u, 2000), { key, attemptId: uuid(), epoch }); ok(p.s === 202, 'create 202');
  const c = await confirmT(u, p.b.id, p.b.demoOnlyCode); ok(c.s === 200, 'confirm 200', c.s);
  const rows = await q("select operation, extract(epoch from (expires_at-created_at))/86400 d from idempotency_records where user_id=$1 order by operation", [u.id]);
  ok(rows.length === 2 && rows.every((r) => Math.round(r.d * 1000) / 1000 === 2), 'create and confirm rows: expires_at - created_at = 2 days', rows);
}
if (which === 'noretention') { // API 3954: variable unset
  const u = await E.register('exp0'); const epoch = await epochOf(u);
  const pol = await call(u.token, '/transfer-policy'); ok(pol.s === 200, 'API up and GET /transfer-policy 200 without the variable', pol.s);
  const bal = await E.balOf(u); const c0 = await E.counts(u.id);
  const key = newKey(); const p = await send(u, ownBody(u, 100), { key, attemptId: uuid(), epoch });
  L('POST /transfers without variable ->', p.s, JSON.stringify(p.b));
  ok(p.s === 500, 'POST /transfers -> 500 (documented deviation)');
  const p400 = await send(u, { ...ownBody(u, 100), concept: '' }, { key: newKey() }); L('POST invalid body ->', p400.s);
  const pweb = await send(u, ownBody(u, 100), { key: newKey() }); L('POST without headers (web) ->', pweb.s);
  const c1 = await E.counts(u.id); ok(JSON.stringify(c0) === JSON.stringify(c1) && (await E.balOf(u)).checking === bal.checking, 'nothing written; balance unchanged', c1);
  const v = await voidA(u, key, uuid()); ok(v.s === 200 && v.b.resolution === 'voided', 'void still works (500 case has an exit: voided)', v.s);
  const l = await listA(u); ok(l.s === 200, 'list works');
  const va = await call(u.token, '/accounts'); ok(va.s === 200, 'accounts works');
}
await E.done();
