// R8-03 listing/pagination, R8-11 isolation, R8-13 privacy (API with OTP_THRESHOLD_MINOR=1000 on 3952).
import * as E from './lib8.mjs';
const { L, ok, q, one, call, send, voidA, voidAll, listA, epochOf, ownBody, newKey, uuid, sleep, confirmT, T_VOIDED, T_REJECTED } = E;
const u = await E.register('lst'), b = await E.register('lstb');
const made = []; // {attemptId,status expected}
const post = async (user, amount, extra = {}) => { const key = newKey(), attemptId = uuid(); const r = await send(user, ownBody(user, amount, extra), { key, attemptId, epoch: await epochOf(user) }); return { key, attemptId, r }; };
for (let i = 0; i < 12; i++) { const a = await post(u, 100 + i); made.push({ ...a, exp: 'completed' }); }
for (let i = 0; i < 8; i++) { const a = await post(u, 2000 + i); made.push({ ...a, exp: 'awaiting_confirmation' }); }
for (let i = 0; i < 6; i++) { const a = await post(u, 2100 + i); await q("update otp_challenges set expires_at = now() - interval '1 second' where transfer_id=$1", [a.r.b.id]); made.push({ ...a, exp: 'expired' }); }
for (let i = 0; i < 6; i++) { const a = await post(u, 2200 + i); const v = await voidA(u, a.key, a.attemptId); made.push({ ...a, exp: 'cancelled' }); }
for (let i = 0; i < 6; i++) { const key = newKey(), attemptId = uuid(); await voidA(u, key, attemptId); made.push({ key, attemptId, exp: 'voided' }); }
for (let i = 0; i < 4; i++) { const a = await post(u, 100, { destinationAccountId: u.pr.id }); made.push({ ...a, exp: 'rejected' }); } // insufficient funds 422
for (let i = 0; i < 4; i++) { const key = newKey(), attemptId = uuid(); await send(u, ownBody(u, 100, { destinationType: 'beneficiary', beneficiaryId: uuid() }), { key, attemptId, epoch: await epochOf(u) }); made.push({ key, attemptId, exp: 'rejected' }); }
L('made attempts', made.length);
ok(made.length >= 45, '>= 45 attempts covering completed/awaiting/expired/cancelled/rejected/voided');
const dbAll = await q(`select 'transfer' k,id,client_attempt_id a,status,created_at from transfers where owner_id=$1 union all select 'closure',id,client_attempt_id,status,closed_at from transfer_attempt_closures where owner_id=$1 order by created_at desc, k desc, id desc`, [u.id]);
// paginate limit=10 with new attempts created while paging
const seen = []; let cursor; let pages = 0; let injected = false;
for (;;) {
  const p = await listA(u, { limit: '10', ...(cursor ? { cursor } : {}) }); ok(p.s === 200, 'page ' + pages + ' 200'); pages++;
  seen.push(...p.b.items);
  if (!injected && pages === 2) { injected = true; await post(u, 111); await voidA(u, newKey(), uuid()); }
  if (!p.b.nextCursor) break; cursor = p.b.nextCursor;
}
const ids = seen.map((i) => i.transferId ?? ('c:' + i.attemptId));
ok(new Set(ids).size === ids.length, 'no duplicates across pages', ids.length);
const initial = dbAll.map((r) => r.k === 'transfer' ? r.id : 'c:' + r.a);
ok(initial.every((x) => ids.includes(x)), 'no omissions vs direct DB query (pre-injection set)');
ok(seen.length === initial.length, 'new attempts created while paging did not enter later pages', { seen: seen.length, initial: initial.length });
const order = seen.every((it, i) => i === 0 || seen[i - 1].createdAt >= it.createdAt);
ok(order, 'order createdAt DESC across pages');
const statuses = new Set(seen.map((i) => i.status)); ok(['completed', 'awaiting_confirmation', 'expired', 'cancelled', 'rejected', 'voided'].every((s) => statuses.has(s)), 'all 6 statuses present', [...statuses]);
// exact order check against DB
const dbOrder = dbAll.map((r) => r.k === 'transfer' ? r.id : 'c:' + r.a);
ok(JSON.stringify(dbOrder) === JSON.stringify(ids), 'order equals DB order (created_at DESC, kind DESC, id DESC)');
// filters
const f1 = await listA(u, { status: 'completed,expired', limit: '50' }); ok(f1.b.items.every((i) => ['completed', 'expired'].includes(i.status)) && f1.b.items.length === (await one("select count(*)::int n from transfers where owner_id=$1 and status in ('completed','expired')", [u.id])).n, 'status filter exact');
const f2 = await listA(u, { status: 'voided', limit: '50' }); ok(f2.b.items.length === (await one("select count(*)::int n from transfer_attempt_closures where owner_id=$1 and status='voided'", [u.id])).n, 'status=voided exact');
const f2b = await listA(u, { status: 'rejected', limit: '50' }); ok(f2b.b.items.length === 8 && f2b.b.items.every((i) => i.problem && [404, 422].includes(i.problem.status)), 'status=rejected 8 with problem');
const tgt = made[3]; const f3 = await listA(u, { attemptId: tgt.attemptId }); ok(f3.b.items.length === 1 && f3.b.items[0].attemptId === tgt.attemptId && f3.b.items[0].transferId === tgt.r.b.id, 'attemptId filter exact -> 1 item');
const f3b = await listA(u, { attemptId: uuid() }); ok(f3b.s === 200 && f3b.b.items.length === 0, 'unknown attemptId -> empty');
const mid = seen[Math.floor(seen.length / 2)].createdAt;
const f4 = await listA(u, { from: mid, limit: '50' }); const f5 = await listA(u, { to: mid, limit: '50' });
const dbFrom = (await one('select count(*)::int n from (select created_at a from transfers where owner_id=$1 union all select closed_at from transfer_attempt_closures where owner_id=$1) x where date_trunc($3, a) >= $2::timestamptz', [u.id, mid, 'milliseconds'])).n;
ok(f4.b.items.every((i) => i.createdAt >= mid) && f5.b.items.every((i) => i.createdAt <= mid) && f4.b.items.length + f5.b.items.length >= seen.length, 'from/to filters bound createdAt');
for (const [name, params] of [['limit=0', { limit: '0' }], ['limit=51', { limit: '51' }], ['limit=x', { limit: 'x' }], ['from>to', { from: '2030-01-02T00:00:00Z', to: '2030-01-01T00:00:00Z' }], ['bad status', { status: 'nope' }], ['bad attemptId', { attemptId: 'zzz' }], ['bad from', { from: 'yesterday' }]]) {
  const r = await listA(u, params); ok(r.s === 400, `${name} -> 400`, r.s);
}
const c1 = (await listA(u, { limit: '5' })).b.nextCursor;
const tamper = [c1.slice(0, -2) + 'AA', c1 + 'x', 'garbage', Buffer.from(JSON.stringify({ at: 'x', kind: 'transfer', id: 'x' })).toString('base64url'), Buffer.from(Buffer.from(c1, 'base64url').toString().replace('transfer', 'closure').replace('closure', 'transfer ')).toString('base64url')];
for (const [i, t] of tamper.entries()) { const r = await listA(u, { cursor: t }); ok(r.s === 400, `altered cursor #${i} -> 400`, r.s); }
// default limit 20
const d = await listA(u); ok(d.b.items.length === 20, 'default limit 20');
// privacy over full dump
const everything = JSON.stringify(seen) + JSON.stringify(f1.b) + JSON.stringify(f2.b);
ok(!/\b\d{18}\b/.test(everything) && !/demoOnlyCode|"code"|idempotencyKey|keyHash|key_hash|requestId/.test(everything), 'listing: no 18-digit CLABE, demoOnlyCode, code, idempotencyKey, keyHash, requestId');
ok(seen.filter((i) => i.destination).every((i) => /^\d{3}•+\d{4}$/.test(i.destination.clabeMasked)), 'only clabeMasked');
for (const k of [...made.map((m) => m.key)]) { if (everything.includes(k)) { ok(false, 'a key leaked in listing'); break; } }
// 404 closure mapping detail
const vv = seen.find((i) => i.status === 'voided'); ok(vv.transferId === null && vv.amountMinor === null && vv.destination === null && vv.closedAt, 'voided closure shape (nulls)');
const rj = seen.find((i) => i.status === 'rejected'); ok(rj.amountMinor !== null && rj.problem.detail && rj.transferId === null, 'rejected closure has amountMinor/problem');

L('== R8-11 isolation (user B)');
const bl = await listA(b, { limit: '50' }); ok(bl.b.items.length === 0, 'B list has none of A');
const ba = await listA(b, { attemptId: made[3].attemptId }); const bu = await listA(b, { attemptId: uuid() });
ok(ba.s === 200 && JSON.stringify(ba.b.items) === JSON.stringify(bu.b.items) && ba.b.items.length === 0, 'B ?attemptId=<A> same as unknown -> items []');
const gA = await call(b.token, '/transfers/' + made[3].r.b.id); ok(gA.s === 404, 'B GET /transfers/<A> -> 404');
const eA0 = await E.gateEpoch(u.id); const pendA = (await q("select count(*)::int n from transfers where owner_id=$1 and status='awaiting_confirmation'", [u.id]))[0].n;
const bv = await voidA(b, made[3].key, made[3].attemptId);
ok(bv.s === 200 && bv.b.resolution === 'voided', 'B void with A key+attemptId -> voided in B scope', bv.b?.resolution);
const rpA = await send(u, ownBody(u, 103), { key: made[3].key, attemptId: made[3].attemptId, epoch: await epochOf(u) });
ok(rpA.b.id === made[3].r.b.id, 'A POST with that key still returns A transfer');
const bva = await voidAll(b, await epochOf(b));
ok((await E.gateEpoch(u.id)) === eA0 && (await q("select count(*)::int n from transfers where owner_id=$1 and status='awaiting_confirmation'", [u.id]))[0].n === pendA, 'B void-all does not change A epoch or pendings');
// B closure should not appear for A
const al = await listA(u, { attemptId: made[3].attemptId }); ok(al.b.items.length === 1 && al.b.items[0].transferId, 'A listing for that attemptId unchanged (1 item, transfer)');
// B cannot void A's pending via transferId path: void with A key where only A has record -> scope
const pendA2 = made.find((m) => m.exp === 'awaiting_confirmation'); const bv2 = await voidA(b, pendA2.key, pendA2.attemptId);
ok((await one('select status from transfers where id=$1', [pendA2.r.b.id])).status === 'awaiting_confirmation', 'B void with A pending key does not cancel it');
await E.done();
