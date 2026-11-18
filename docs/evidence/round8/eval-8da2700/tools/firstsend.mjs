// Gate race at a user's FIRST send (no gate row yet): POST + void-all + void + POST(other key) concurrently, N fresh users.
import * as E from './lib8.mjs';
const { L, ok, q, send, voidA, voidAll, ownBody, newKey, uuid, T_VOIDED } = E;
const N = Number(process.env.EV_USERS || 8); let bad = 0, ex = 0, vo = 0;
for (let i = 0; i < N; i++) {
  const u = await E.register('first');
  const gate0 = (await q('select 1 from transfer_send_gates where owner_id=$1', [u.id])).length; // normally 0 rows: no gate yet
  const k1 = newKey(), a1 = uuid(), k2 = newKey(), a2 = uuid();
  const fs = [() => send(u, ownBody(u, 100), { key: k1, attemptId: a1, epoch: '0' }), () => voidAll(u, '0'), () => voidA(u, k2, a2), () => send(u, ownBody(u, 100), { key: k2, attemptId: a2, epoch: '0' }), () => send(u, ownBody(u, 100), { key: k1, attemptId: a1, epoch: '0' })];
  fs.sort(() => Math.random() - 0.5);
  const rs = await Promise.all(fs.map((f) => f()));
  const t = await q('select client_attempt_id a,id from transfers where owner_id=$1', [u.id]); const c = await q('select client_attempt_id a,status from transfer_attempt_closures where owner_id=$1', [u.id]);
  const ge = await E.gateEpoch(u.id);
  const perAttempt = [a1, a2].map((a) => ({ t: t.filter((x) => x.a === a).length, c: c.filter((x) => x.a === a).length }));
  const good = perAttempt.every((x) => x.t + x.c <= 1) && ge === '1' && (await E.userNet(u.id)) === 0n && t.every(async () => true) && rs.every((r) => [200, 201, 409].includes(r.s));
  const dbl = (await q("select count(*)::int n from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers x on x.id=lt.reference_id where x.owner_id=$1 and le.entry_type='debit'", [u.id]))[0].n;
  if (!good || dbl > t.length) { bad++; L('BAD', { gate0, perAttempt, ge, statuses: rs.map((r) => r.s) }); } else { t.length ? ex++ : vo++; }
  L(`user ${i}: gate rows before=${gate0} -> epoch ${ge}; transfers=${t.length} closures=${c.length}; statuses=${rs.map((r) => r.s)}`);
}
ok(bad === 0, `first-send gate race over ${N} fresh users: <=1 outcome per attempt, epoch 1, no double debit`);
await E.done();
