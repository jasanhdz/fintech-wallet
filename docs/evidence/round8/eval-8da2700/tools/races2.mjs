// R8-06 stronger overlap: (1) same-tick launch with no offset; (2) gate held by an external transaction so POST and void/void-all are BOTH queued in PostgreSQL (random queue order).
import * as E from './lib8.mjs';
const { L, ok, q, one, send, voidA, voidAll, epochOf, ownBody, newKey, uuid, sleep, T_VOIDED } = E;
const N = Number(process.env.EV_ITER || 50);
const u = await E.register('race2');
const amount = 100;
L(`== (1) same tick, no offset, ${N} iterations send vs void (random launch order)`);
{ let a = 0, b = 0, bad = 0;
  for (let i = 0; i < N; i++) {
    const key = newKey(), attemptId = uuid(), epoch = await epochOf(u);
    const fs = [() => send(u, ownBody(u, amount), { key, attemptId, epoch }), () => voidA(u, key, attemptId)];
    if (Math.random() < 0.5) fs.reverse();
    const rs = await Promise.all(fs.map((f) => f()));
    const p = rs.find((r) => 'id' in (r.b || {}) || r.b?.type === T_VOIDED), v = rs.find((r) => r.b?.resolution);
    const ts = await E.transfersOfAttempt(u.id, attemptId), cs = await E.closuresOfAttempt(u.id, attemptId);
    const ex = p.s === 201 && v.b.resolution === 'transfer_found' && v.b.attempt.transferId === p.b.id && ts.length === 1 && !cs.length && (await E.debitsOf(ts[0].id)) === 1;
    const vo = p.s === 409 && p.b.type === T_VOIDED && v.b.resolution === 'voided' && !ts.length && cs.length === 1;
    if (ex) a++; else if (vo) b++; else { bad++; L('BAD', p.s, v.b); }
  }
  ok(bad === 0, `same-tick ${N}: all consistent`, { a, b, bad }); L('distribution exec/voided', { a, b });
}
async function heldGate(label, mk) {
  L(`== (2) ${label}: gate row held FOR UPDATE by an external txn; both requests queue in PostgreSQL; ${N} iterations`);
  let ex = 0, vo = 0, bad = 0, bothQueued = 0;
  for (let i = 0; i < N; i++) {
    const key = newKey(), attemptId = uuid(), epoch = await epochOf(u);
    const hold = await E.dbClient('runtime'); await hold.query('begin'); await hold.query('select 1 from transfer_send_gates where owner_id=$1 for update', [u.id]);
    const first = Math.random() < 0.5; let pP, pV;
    const lp = () => { pP = send(u, ownBody(u, amount), { key, attemptId, epoch }); };
    const lv = () => { pV = mk(key, attemptId, epoch); };
    if (first) { lp(); await sleep(15); lv(); } else { lv(); await sleep(15); lp(); }
    let waiting = 0; for (let k = 0; k < 60 && waiting < 2; k++) { await sleep(25); waiting = (await one("select count(*)::int n from pg_stat_activity where datname='wallet_test' and wait_event_type='Lock' and query ilike '%transfer_send_gates%'")).n; }
    if (waiting >= 2) bothQueued++;
    await hold.query('rollback'); await hold.end();
    const [p, v] = await Promise.all([pP, pV]);
    const ts = await E.transfersOfAttempt(u.id, attemptId), cs = await E.closuresOfAttempt(u.id, attemptId);
    const e1 = p.s === 201 && ts.length === 1 && (await E.debitsOf(ts[0].id)) === 1 && (await E.netOf(ts[0].id)) === 0n;
    const e2 = p.s === 409 && p.b.type === T_VOIDED && !ts.length;
    if (e1 && v.s === 200) ex++; else if (e2 && v.s === 200) vo++; else { bad++; L('BAD', p.s, JSON.stringify(v.b).slice(0, 150)); }
    if (e1 && v.b.resolution !== undefined && v.b.resolution !== 'transfer_found') { bad++; L('BAD resolution', v.b.resolution); }
    if (e2 && v.b.resolution !== undefined && v.b.resolution !== 'voided') { bad++; L('BAD resolution', v.b.resolution); }
  }
  ok(bad === 0, `${label}: ${N} iterations consistent`, { ex, vo, bad, bothQueued }); L('distribution executed/vetoed', { ex, vo, bothQueued: bothQueued, of: N });
  ok(ex > 0 && vo > 0, `${label}: both outcomes occurred under queued overlap`);
}
await heldGate('send vs void', (key, attemptId) => voidA(u, key, attemptId));
const w = await E.register('race2b');
{ // void-all variant uses w
  const N2 = N; L(`== (2b) send vs void-all with gate held, ${N2} iterations`);
  let ex = 0, vo = 0, bad = 0;
  for (let i = 0; i < N2; i++) {
    const key = newKey(), attemptId = uuid(), epoch = await epochOf(w);
    const hold = await E.dbClient('runtime'); await hold.query('begin'); await hold.query('select 1 from transfer_send_gates where owner_id=$1 for update', [w.id]);
    const first = Math.random() < 0.5; let pP, pV;
    const lp = () => { pP = send(w, ownBody(w, amount), { key, attemptId, epoch }); }; const lv = () => { pV = voidAll(w, epoch); };
    if (first) { lp(); await sleep(15); lv(); } else { lv(); await sleep(15); lp(); }
    for (let k = 0; k < 60; k++) { await sleep(25); if ((await one("select count(*)::int n from pg_stat_activity where datname='wallet_test' and wait_event_type='Lock' and query ilike '%transfer_send_gates%'")).n >= 2) break; }
    await hold.query('rollback'); await hold.end();
    const [p, v] = await Promise.all([pP, pV]);
    const ts = await E.transfersOfAttempt(w.id, attemptId);
    const ge = await E.gateEpoch(w.id);
    if (v.s === 200 && v.b.advanced && ge === String(BigInt(epoch) + 1n)) {
      if (p.s === 201 && ts.length === 1 && (await E.debitsOf(ts[0].id)) === 1) ex++; else if (p.s === 409 && p.b.type === T_VOIDED && !ts.length) vo++; else { bad++; L('BAD', p.s); }
    } else { bad++; L('BAD void-all', v.s, v.b); }
  }
  ok(bad === 0 && ex > 0 && vo > 0, `send vs void-all queued: consistent; both outcomes`, { ex, vo, bad });
  ok((await E.userNet(w.id)) === 0n, 'ledger sum 0');
}
await E.done();
