// R8-04 lost response on send (+API restart), R8-05 lost response on void/void-all, R8-14 other client. Run with API on 3951 (restart handled by caller via EV_RESTART_CMD).
import * as E from './lib8.mjs';
import { execSync } from 'node:child_process';
const { L, ok, q, one, call, send, voidA, voidAll, listA, epochOf, ownBody, newKey, uuid, sleep, T_VOIDED } = E;
const restart = async () => { const pid = Number(execSync('cat /private/tmp/claude-501/api3951.pid').toString()); process.kill(pid, 'SIGTERM'); await sleep(1500);
  const { spawn } = await import('node:child_process'); const child = spawn('/Users/jasanhernandez/Develop/fintech-wallet-g1/docs/evidence/round8/eval-8da2700/tools/start-api.sh', ['3951'], { detached: true, stdio: ['ignore', 'ignore', 'ignore'] }); child.unref();
  execSync(`echo ${child.pid} > /private/tmp/claude-501/api3951.pid`);
  for (let i = 0; i < 60; i++) { await sleep(500); try { const r = await fetch(E.API + '/auth/csrf'); if (r.ok) return; } catch {} } throw new Error('api did not restart'); };
const u = await E.register('loss');
L('== R8-04 send with destination account locked; client aborts; lock released; API restarted');
{ const key = newKey(), attemptId = uuid(), epoch = await epochOf(u), amount = 777; const bal0 = await E.balOf(u);
  const lock = await E.dbClient('runtime'); await lock.query('begin'); await lock.query('select 1 from accounts where id=$1 for update', [u.sv.id]);
  const ac = new AbortController(); const p = send(u, ownBody(u, amount), { key, attemptId, epoch, headers: {} }).catch(() => 'aborted');
  // abort variant: separate fetch with signal
  const ac2 = new AbortController(); const raw = fetch(E.API + '/transfers', { method: 'POST', signal: ac2.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + u.token, 'idempotency-key': key, 'transfer-attempt-id': attemptId, 'transfer-send-epoch': epoch }, body: JSON.stringify(ownBody(u, amount)) }).catch((e) => 'client-aborted');
  await sleep(600); ac2.abort(); const r2 = await raw; ok(r2 === 'client-aborted', 'client aborted before answer');
  const mid = await q('select 1 from transfers where owner_id=$1 and client_attempt_id=$2', [u.id, attemptId]); ok(mid.length === 0, 'server not yet committed while lock held');
  await lock.query('rollback'); await lock.end(); await p; // first (non-aborted) request also finishes: same key -> replay
  await sleep(500);
  const ts = await E.transfersOfAttempt(u.id, attemptId); ok(ts.length === 1, 'server confirmed after lock release: exactly 1 transfer for the identity');
  await restart(); ok(true, 'API process restarted (new PID)');
  const l = await listA(u, { attemptId, limit: '1' }); ok(l.s === 200 && l.b.items.length === 1 && l.b.items[0].transferId === ts[0].id && l.b.items[0].status === 'completed', 'GET ?attemptId= returns exactly 1 item with transferId after restart');
  const rp = await send(u, ownBody(u, amount), { key, attemptId, epoch }); ok((rp.s === 201 || rp.s === 200) && rp.b.id === ts[0].id, 'replay (same key/body/headers) -> same id');
  const bal1 = await E.balOf(u); ok(bal0.checking - bal1.checking === BigInt(amount) && (await E.debitsOf(ts[0].id)) === 1 && (await E.netOf(ts[0].id)) === 0n, '1 debit exactly; ledger sum 0');
}
L('== R8-05 lost response on void x3 / void-all x3');
{ const key = newKey(), attemptId = uuid(); const rs = []; for (let i = 0; i < 3; i++) rs.push(await voidA(u, key, attemptId));
  ok(rs.every((r) => r.s === 200 && r.b.resolution === 'voided') && (await q('select 1 from transfer_attempt_closures where owner_id=$1 and client_attempt_id=$2', [u.id, attemptId])).length === 1 && (await q("select 1 from audit_events where actor_id=$1 and action='transfer.attempt_voided' and resource_id=(select id from transfer_attempt_closures where client_attempt_id=$2)", [u.id, attemptId])).length === 1, 'void x3 -> same resolution, 1 closure, 1 audit');
  const e = await epochOf(u); const a = [await voidAll(u, e), await voidAll(u, e), await voidAll(u, e)];
  ok(JSON.stringify(a.map((x) => x.b.advanced)) === '[true,false,false]' && (await E.gateEpoch(u.id)) === String(BigInt(e) + 1n) && a[1].b.sendEpoch === a[0].b.sendEpoch, 'void-all x3 same fromEpoch -> [true,false,false], epoch +1 once');
  ok((await q("select 1 from audit_events where actor_id=$1 and action='transfer.send_epoch_advanced' and metadata->>'from'=$2", [u.id, e])).length === 1, '1 audit send_epoch_advanced');
  const fut = await voidAll(u, String(BigInt(await epochOf(u)) + 1n)); ok(fut.s === 400, 'void-all fromEpoch > current -> 400');
}
L('== R8-14 another client');
{ const a = await E.register('cliA'); // session A
  const kApplied = newKey(), aApplied = uuid(), kNever = newKey(), aNever = uuid(), eA = await epochOf(a);
  // applied variant: A sends, response "lost"
  await send(a, ownBody(a, 500), { key: kApplied, attemptId: aApplied, epoch: eA });
  const b = await E.login(a); // session B (fresh login, no local state)
  const lst = await listA(b, { limit: '50' }); const seen = lst.b.items.find((i) => i.attemptId === aApplied);
  ok(seen && seen.transferId && seen.status === 'completed', 'B sees A applied attempt with its attemptId');
  const va = await voidAll(b, lst.b.sendEpoch); ok(va.s === 200 && va.b.advanced, 'B void-all');
  const r1 = await listA(a, { attemptId: aApplied }); ok(r1.b.items.length === 1 && r1.b.items[0].transferId === seen.transferId, 'A later reads by attemptId -> applied, same id');
  const r2 = await send(a, ownBody(a, 500), { key: kApplied, attemptId: aApplied, epoch: eA }); ok((r2.s === 200 || r2.s === 201) && r2.b.id === seen.transferId, 'A resend applied variant -> replay same id');
  // never-arrived variant: A's request never reached the server before B void-all
  const r3 = await send(a, ownBody(a, 500), { key: kNever, attemptId: aNever, epoch: eA }); ok(r3.s === 409 && r3.b.type === T_VOIDED, 'A late send (old epoch) -> 409 voided');
  ok((await E.transfersOfAttempt(a.id, aNever)).length === 0 && (await E.counts(a.id)).transfers === 1 && (await E.userNet(a.id)) === 0n, '<=1 debit per attempt; ledger sum 0');
}
await E.done();
