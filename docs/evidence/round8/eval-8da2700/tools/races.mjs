// R8-06/R8-07/R8-09: races on a real API (EV_API_PORT) + wallet_test. Own implementation (not the Generator's suite).
import * as E from './lib8.mjs';
const { L, ok, q, one, call, send, voidA, voidAll, epochOf, ownBody, newKey, uuid, sleep, T_VOIDED, T_CONFLICT } = E;
const N = Number(process.env.EV_ITER || 60);
const u = await E.register('race');
const amount = 100;
L(`== R8-06 send vs void: ${N} iterations, both orders, random 0-6 ms offset`);
const dist = { posted_first_wins: 0, void_first_wins: 0, executed_then_found: 0 };
let outcomes = { A_exec: 0, B_voided: 0 }, bad = 0, orderSeen = { postFirst: [0, 0], voidFirst: [0, 0] };
for (let i = 0; i < N; i++) {
  const key = newKey(), attemptId = uuid(), epoch = await epochOf(u);
  const before = await E.balOf(u);
  const postFirst = i % 2 === 0, delay = Math.floor(Math.random() * 7);
  const doPost = () => send(u, ownBody(u, amount), { key, attemptId, epoch });
  const doVoid = () => voidA(u, key, attemptId);
  let p, v;
  if (postFirst) { const pp = doPost(); await sleep(delay); const vv = doVoid(); [p, v] = await Promise.all([pp, vv]); }
  else { const vv = doVoid(); await sleep(delay); const pp = doPost(); [p, v] = await Promise.all([pp, vv]); }
  const ts = await E.transfersOfAttempt(u.id, attemptId), cs = await E.closuresOfAttempt(u.id, attemptId);
  const after = await E.balOf(u);
  let good = false;
  if (p.s === 201 && v.s === 200 && v.b.resolution === 'transfer_found' && v.b.attempt.transferId === p.b.id && ts.length === 1 && cs.length === 0 && (await E.debitsOf(ts[0].id)) === 1 && (await E.netOf(ts[0].id)) === 0n && before.checking - after.checking === BigInt(amount)) { good = true; outcomes.A_exec++; orderSeen[postFirst ? 'postFirst' : 'voidFirst'][0]++; }
  else if (p.s === 409 && p.b.type === T_VOIDED && v.s === 200 && v.b.resolution === 'voided' && ts.length === 0 && cs.length === 1 && cs[0].status === 'voided' && before.checking === after.checking) { good = true; outcomes.B_voided++; orderSeen[postFirst ? 'postFirst' : 'voidFirst'][1]++; }
  // replay consistency
  const rp = await send(u, ownBody(u, amount), { key, attemptId, epoch });
  const rv = await voidA(u, key, attemptId);
  const replayOk = good && (outcomes.A_exec && ts.length ? (rp.s === 201 || rp.s === 200) && rp.b.id === ts[0].id && rv.b.resolution === 'transfer_found' : rp.s === 409 && rp.b.type === T_VOIDED && rv.b.resolution === 'voided');
  const afterReplay = await E.counts(u.id);
  if (!good || !replayOk) { bad++; L('BAD iteration', i, { p: p.s, pt: p.b?.type, v: v.b?.resolution, ts: ts.length, cs: cs.length }); }
}
ok(bad === 0, `R8-06 ${N} send-vs-void iterations: every one exactly {2xx+transfer_found same id | 409 voided + voided}; never 2 debits, never transfer+closure`, `bad=${bad}`);
L('outcome distribution', outcomes, 'by order (postFirst [exec,voided], voidFirst [exec,voided])', orderSeen);
ok(outcomes.A_exec > 0 && outcomes.B_voided > 0, 'both outcomes occurred (real interleaving, not a single deterministic order)');
const c = await E.counts(u.id);
ok(c.transfers === outcomes.A_exec && c.closures === outcomes.B_voided && c.entries === 2 * outcomes.A_exec, 'totals: transfers == executed, closures == voided, 2 ledger entries per transfer', c);
ok((await E.userNet(u.id)) === 0n, 'ledger entries sum 0 over all of the user transfers');
const dup = await one("select count(*)::int n from (select key_hash from idempotency_records where user_id=$1 and operation='create-transfer' group by key_hash having count(*)>1) x", [u.id]);
const both = await one("select count(*)::int n from transfer_attempt_closures c join transfers t on t.owner_id=c.owner_id and t.client_attempt_id=c.client_attempt_id where c.owner_id=$1", [u.id]);
ok(dup.n === 0 && both.n === 0, 'DB: no duplicated idempotency record; no attempt that has both a transfer and a closure', { dup: dup.n, both: both.n });

L('== R8-06(c) real overlap by lock: POST held on an account lock after taking the gate; void launched and blocked; release');
{
  const lock = await E.dbClient('runtime'); const key = newKey(), attemptId = uuid(), epoch = await epochOf(u);
  await lock.query('begin'); await lock.query('select 1 from accounts where id=$1 for update', [u.pr.id]);
  let postDone = false, voidDone = false;
  const pp = send(u, ownBody(u, amount), { key, attemptId, epoch }).then((r) => { postDone = true; return r; });
  let waitingPost = false; for (let i = 0; i < 40 && !waitingPost; i++) { await sleep(50); waitingPost = !!(await one("select 1 x from pg_stat_activity where datname='wallet_test' and wait_event_type='Lock' and query ilike '%from accounts%for update%' and pid<>pg_backend_pid()")); }
  ok(waitingPost, 'POST is blocked on the account lock (pg_stat_activity wait_event_type=Lock), after taking gate FOR SHARE');
  const vv = voidA(u, key, attemptId).then((r) => { voidDone = true; return r; });
  let waitingVoid = false; for (let i = 0; i < 40 && !waitingVoid; i++) { await sleep(50); waitingVoid = !!(await one("select 1 x from pg_stat_activity where datname='wallet_test' and wait_event_type='Lock' and query ilike '%transfer_send_gates%for update%'")); }
  ok(waitingVoid, 'void is blocked on the gate (FOR UPDATE waits for in-flight send)');
  await sleep(500); ok(!postDone && !voidDone, 'neither answered while the lock is held');
  await lock.query('rollback'); await lock.end();
  const [p, v] = await Promise.all([pp, vv]);
  ok(p.s === 201 && v.b.resolution === 'transfer_found' && v.b.attempt.transferId === p.b.id, 'after release: POST confirms; void returns transfer_found (does not hide the executed op)', { p: p.s, r: v.b.resolution });
  ok((await E.debitsOf(p.b.id)) === 1 && (await E.closuresOfAttempt(u.id, attemptId)).length === 0, '1 debit, no closure');
}

L('== R8-06(a)/(b) forced orders');
{
  const key = newKey(), attemptId = uuid(), epoch = await epochOf(u);
  const v = await voidA(u, key, attemptId); const p = await send(u, ownBody(u, amount), { key, attemptId, epoch });
  ok(v.b.resolution === 'voided' && p.s === 409 && p.b.type === T_VOIDED && (await E.transfersOfAttempt(u.id, attemptId)).length === 0, '(a) void first -> POST 409 voided, 0 transfers');
  const key2 = newKey(), a2 = uuid(); const p2 = await send(u, ownBody(u, amount), { key: key2, attemptId: a2, epoch }); const v2 = await voidA(u, key2, a2);
  ok(p2.s === 201 && v2.b.resolution === 'transfer_found' && v2.b.attempt.transferId === p2.b.id, '(b) POST first -> void transfer_found with that id');
}

L('== R8-06 void-all vs POST with headers, ' + N + ' iterations');
const w = await E.register('raceall');
let oc = { exec: 0, vetoed: 0 }, bad2 = 0, advancedAlways = true;
for (let i = 0; i < N; i++) {
  const key = newKey(), attemptId = uuid(), e = await epochOf(w);
  const postFirst = i % 2 === 0, delay = Math.floor(Math.random() * 7);
  let p, v;
  if (postFirst) { const pp = send(w, ownBody(w, amount), { key, attemptId, epoch: e }); await sleep(delay); const vv = voidAll(w, e); [p, v] = await Promise.all([pp, vv]); }
  else { const vv = voidAll(w, e); await sleep(delay); const pp = send(w, ownBody(w, amount), { key, attemptId, epoch: e }); [p, v] = await Promise.all([pp, vv]); }
  const ts = await E.transfersOfAttempt(w.id, attemptId);
  advancedAlways &&= v.s === 200 && v.b.advanced === true && v.b.sendEpoch === String(BigInt(e) + 1n);
  const ge = await E.gateEpoch(w.id);
  const rp = await send(w, ownBody(w, amount), { key, attemptId, epoch: e });
  let good = false;
  if (p.s === 201 && ts.length === 1 && (await E.debitsOf(ts[0].id)) === 1 && (rp.s === 200 || rp.s === 201) && rp.b.id === p.b.id) { oc.exec++; good = true; }
  else if (p.s === 409 && p.b.type === T_VOIDED && ts.length === 0 && rp.s === 409 && rp.b.type === T_VOIDED) { oc.vetoed++; good = true; }
  if (!good || ge !== String(BigInt(e) + 1n)) { bad2++; L('BAD void-all iteration', i, { p: p.s, ts: ts.length, rp: rp.s, ge, e }); }
}
ok(bad2 === 0 && advancedAlways, `${N} void-all-vs-POST iterations: each is {executed (replay returns it) | vetoed 409 voided with 0 transfers}; epoch +1 exactly once each`, { bad2, advancedAlways });
L('outcome distribution', oc);
ok(oc.exec > 0 && oc.vetoed > 0, 'both outcomes occurred');
ok((await E.userNet(w.id)) === 0n && (await E.counts(w.id)).transfers === oc.exec, 'ledger sum 0; transfers == executed');

L('== R8-07 late send vetoed');
{
  const x = await E.register('late'); const key = newKey(), attemptId = uuid(), epoch = await epochOf(x);
  const bal0 = await E.balOf(x); const usage0 = await q('select outgoing_minor::text o from daily_limit_usage where owner_id=$1', [x.id]);
  const v = await voidA(x, key, attemptId);
  ok(v.s === 200 && v.b.resolution === 'voided', 'void of unknown identity -> voided');
  const p1 = await send(x, ownBody(x, amount), { key, attemptId, epoch });
  const p2 = await send(x, ownBody(x, amount), { key, attemptId, epoch: await epochOf(x) });
  const p3 = await send(x, ownBody(x, amount), { key });
  const p4 = await send(x, ownBody(x, amount), { key, attemptId: uuid(), epoch });
  ok([p1, p2, p3].every((p) => p.s === 409 && p.b.type === T_VOIDED), 'same POST / current epoch / no headers with the same key -> 409 transfer-attempt-voided', [p1.s, p2.s, p3.s]);
  ok(p4.s === 409 && p4.b.type === T_VOIDED, 'same key with a different identity -> still 409 voided (key closed)', { s: p4.s, t: p4.b.type });
  const bal1 = await E.balOf(x); const usage1 = await q('select outgoing_minor::text o from daily_limit_usage where owner_id=$1', [x.id]);
  ok(bal0.checking === bal1.checking && JSON.stringify(usage0) === JSON.stringify(usage1) && (await E.counts(x.id)).transfers === 0, 'balances, daily_limit_usage and transfers unchanged');
  // identity voided, new key, same identity header -> voided (identity closed)
  const p5 = await send(x, ownBody(x, amount), { key: newKey(), attemptId, epoch });
  ok(p5.s === 409 && p5.b.type === T_VOIDED, 'voided identity + another key -> 409 voided');
  // void-all: old epoch + new key -> voided; new epoch -> 201
  const e0 = await epochOf(x); const va = await voidAll(x, e0);
  ok(va.b.advanced === true && va.b.sendEpoch === String(BigInt(e0) + 1n), 'void-all advances epoch');
  const old = await send(x, ownBody(x, amount), { key: newKey(), attemptId: uuid(), epoch: e0 });
  const neu = await send(x, ownBody(x, amount), { key: newKey(), attemptId: uuid(), epoch: va.b.sendEpoch });
  ok(old.s === 409 && old.b.type === T_VOIDED && neu.s === 201, 'old epoch + new key -> 409 voided; new epoch -> 201', { old: old.s, neu: neu.s });
  const fut = await send(x, ownBody(x, amount), { key: newKey(), attemptId: uuid(), epoch: String(BigInt(va.b.sendEpoch) + 5n) });
  ok(fut.s === 400, 'epoch greater than current -> 400', fut.s);
  // web: no headers, new key is not affected by epoch (web unaffected)
  const web = await send(x, ownBody(x, amount), { key: newKey() });
  ok(web.s === 201, 'web-style POST (no headers, new key) after void-all -> 201 (D4/web unchanged)');
}

L('== R8-09 8 simultaneous POST same key');
{
  const x = await E.register('conc'); const key = newKey(), attemptId = uuid(), epoch = await epochOf(x);
  const rs = await Promise.all(Array.from({ length: 8 }, () => send(x, ownBody(x, amount), { key, attemptId, epoch })));
  const ids = new Set(rs.map((r) => r.b.id));
  ok(rs.every((r) => r.s === 201) && ids.size === 1, '8 simultaneous (headers) -> 8 x 201, same id, no 409 in-progress', rs.map((r) => r.s));
  const c = await E.counts(x.id); ok(c.transfers === 1 && c.entries === 2, '1 transfer, 1 debit (2 entries)', c);
  const key2 = newKey();
  const rs2 = await Promise.all(Array.from({ length: 8 }, () => send(x, ownBody(x, amount), { key: key2 })));
  ok(rs2.every((r) => r.s === 201) && new Set(rs2.map((r) => r.b.id)).size === 1, '8 simultaneous WITHOUT headers -> 8 x 201 same id', rs2.map((r) => r.s));
  const c2 = await E.counts(x.id); ok(c2.transfers === 2, 'total 2 transfers (one per key)', c2);
  // same identity with 8 different keys
  const a2 = uuid();
  const rs3 = await Promise.all(Array.from({ length: 8 }, () => send(x, ownBody(x, amount), { key: newKey(), attemptId: a2, epoch })));
  const okc = rs3.filter((r) => r.s === 201).length, cf = rs3.filter((r) => r.s === 409 && r.b.type === T_CONFLICT).length;
  ok(okc === 1 && cf === 7, 'same attemptId with 8 distinct keys -> exactly 1 x 201, 7 x 409 conflict (no second debit)', rs3.map((r) => r.s + ':' + (r.b.type || '').split('-').pop()));
  ok((await E.transfersOfAttempt(x.id, a2)).length === 1 && (await E.userNet(x.id)) === 0n, '1 transfer for that identity; ledger sum 0');
  // same key, 8 concurrent void
  const k3 = newKey(), a3 = uuid();
  const vs = await Promise.all(Array.from({ length: 8 }, () => voidA(x, k3, a3)));
  ok(vs.every((r) => r.s === 200 && r.b.resolution === 'voided'), '8 simultaneous void -> 8 x voided', vs.map((r) => r.s + r.b.resolution));
  ok((await q('select 1 from transfer_attempt_closures where owner_id=$1 and client_attempt_id=$2', [x.id, a3])).length === 1 && (await E.auditCount(x.id, 'transfer.attempt_voided')) === 1, '1 closure + 1 audit transfer.attempt_voided');
  // concurrent void-all same fromEpoch
  const e = await epochOf(x);
  const vas = await Promise.all(Array.from({ length: 8 }, () => voidAll(x, e)));
  ok(vas.filter((r) => r.b.advanced).length === 1 && (await E.gateEpoch(x.id)) === String(BigInt(e) + 1n) && (await E.auditCount(x.id, 'transfer.send_epoch_advanced')) === 1, '8 concurrent void-all same fromEpoch -> exactly 1 advance, 1 audit', vas.map((r) => r.b.advanced));
}
await E.done();
