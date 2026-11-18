// R8-08: voiding OTP-pending attempts; confirm vs void race (API with OTP_THRESHOLD_MINOR=1000).
import * as E from './lib8.mjs';
const { L, ok, q, one, send, voidA, voidAll, epochOf, ownBody, newKey, uuid, sleep, confirmT, T_VOIDED } = E;
const N = Number(process.env.EV_ITER || 24);
const u = await E.register('otp'), other = await E.register('otpB');
const amt = 2000; // >= threshold 1000 -> awaiting_confirmation
const mk = async (user) => { const key = newKey(), attemptId = uuid(); const r = await send(user, ownBody(user, amt), { key, attemptId, epoch: await epochOf(user) }); return { key, attemptId, r }; };
L('== void on awaiting_confirmation -> cancelled; confirm afterwards 409; no ledger');
{ const a = await mk(u); ok(a.r.s === 202 && a.r.b.status === 'awaiting_confirmation', 'POST >= threshold -> 202 awaiting_confirmation');
  const code = a.r.b.demoOnlyCode; const bal0 = await E.balOf(u);
  const v = await voidA(u, a.key, a.attemptId);
  ok(v.s === 200 && v.b.resolution === 'transfer_found' && v.b.attempt.status === 'cancelled', 'void -> transfer_found with status cancelled', { r: v.b?.resolution, s: v.b?.attempt?.status });
  const au = await q("select metadata from audit_events where actor_id=$1 and action='transfer.cancelled' and resource_id=$2", [u.id, a.r.b.id]);
  ok(au.length === 1 && au[0].metadata.via === 'void', 'audit transfer.cancelled metadata.via=void', au);
  const c = await confirmT(u, a.r.b.id, code); ok(c.s === 409, 'confirm after void -> 409', c.s);
  ok((await E.netOf(a.r.b.id)) === 0n && (await E.debitsOf(a.r.b.id)) === 0 && (await E.balOf(u)).checking === bal0.checking, 'no ledger entries, balance unchanged');
  const v2 = await voidA(u, a.key, a.attemptId); ok(v2.b.resolution === 'transfer_found' && v2.b.attempt.status === 'cancelled' && (await q("select 1 from audit_events where actor_id=$1 and action='transfer.cancelled' and resource_id=$2", [u.id, a.r.b.id])).length === 1, 'repeat void: same result, no second audit');
  const rp = await send(u, ownBody(u, amt), { key: a.key, attemptId: a.attemptId, epoch: await epochOf(u) }); ok((rp.s === 200 || rp.s === 202 || rp.s === 201) && rp.b.id === a.r.b.id && rp.b.status === 'cancelled', 'POST replay after void reports cancelled with same id (no new transfer)', { s: rp.s, st: rp.b.status });
}
L('== void with OTP already expired -> expired');
{ const a = await mk(u); await q("update otp_challenges set expires_at = now() - interval '1 second' where transfer_id=$1", [a.r.b.id]);
  const v = await voidA(u, a.key, a.attemptId); ok(v.b.resolution === 'transfer_found' && v.b.attempt.status === 'expired', 'void on elapsed OTP -> expired', v.b?.attempt?.status);
  const au = await q("select metadata from audit_events where actor_id=$1 and resource_id=$2 and action in ('transfer.expired','transfer.cancelled')", [u.id, a.r.b.id]);
  ok(au.length === 1, 'exactly one closing audit event (expired or via listing/expireDue); got ' + JSON.stringify(au.map(x=>x.metadata)));
}
L(`== confirm vs void race, ${N} iterations`);
{ let comp = 0, canc = 0, bad = 0;
  for (let i = 0; i < N; i++) {
    const a = await mk(u); const code = a.r.b.demoOnlyCode; const before = await E.balOf(u);
    const fs = [() => confirmT(u, a.r.b.id, code), () => voidA(u, a.key, a.attemptId)]; if (i % 2) fs.reverse();
    const rs = await Promise.all(fs.map((f, k) => (k === 1 ? sleep(Math.floor(Math.random() * 5)).then(f) : f())));
    const st = (await one('select status from transfers where id=$1', [a.r.b.id])).status; const deb = await E.debitsOf(a.r.b.id), net = await E.netOf(a.r.b.id); const after = await E.balOf(u);
    const cf = rs.find((r) => r.b?.id === a.r.b.id && r.b?.status), vd = rs.find((r) => r.b?.resolution);
    if (st === 'completed' && deb === 1 && net === 0n && before.checking - after.checking === BigInt(amt) && vd.b.attempt.status === 'completed') comp++;
    else if (st === 'cancelled' && deb === 0 && before.checking === after.checking && rs.some((r) => r.s === 409)) canc++;
    else { bad++; L('BAD', st, deb, rs.map((r) => r.s)); }
  }
  ok(bad === 0, `confirm vs void ${N}: always exactly completed(1 debit) or cancelled(0 entries)`, { comp, canc, bad }); L('distribution', { comp, canc });
}
L('== void-all closes only own pending (incl. created without headers), expired -> expired');
{ const a = await mk(u), b = await mk(u); const w = await send(u, ownBody(u, amt), { key: newKey() }); // web-style pending
  await q("update otp_challenges set expires_at = now() - interval '1 second' where transfer_id=$1", [b.r.b.id]);
  const o = await mk(other); const e = await epochOf(u);
  const va = await voidAll(u, e);
  ok(va.b.advanced && va.b.closedTransferIds.length >= 2 && [a.r.b.id, w.b.id].every((id) => va.b.closedTransferIds.includes(id)), 'void-all closed own pendings incl. header-less (web) one', va.b.closedTransferIds.length);
  const st = Object.fromEntries((await q('select id,status from transfers where id=any($1)', [[a.r.b.id, b.r.b.id, w.b.id]])).map((r) => [r.id, r.status]));
  ok(st[a.r.b.id] === 'cancelled' && st[w.b.id] === 'cancelled', 'pending -> cancelled', st);
  ok(st[b.r.b.id] === 'expired', 'elapsed pending -> expired', st[b.r.b.id]);
  ok((await one('select status from transfers where id=$1', [o.r.b.id])).status === 'awaiting_confirmation' && (await E.gateEpoch(other.id)) === '0', 'other user pending untouched and epoch unchanged');
  const au = await q("select metadata from audit_events where actor_id=$1 and action in ('transfer.cancelled','transfer.expired') and metadata->>'via'='void_all'", [u.id]);
  ok(au.length >= 3, 'audit via=void_all for each closed pending', au.length);
  const ep = await q("select metadata from audit_events where actor_id=$1 and action='transfer.send_epoch_advanced' order by created_at desc limit 1", [u.id]);
  ok(ep[0].metadata.from === e && ep[0].metadata.to === String(BigInt(e) + 1n), 'audit transfer.send_epoch_advanced from/to', ep[0].metadata);
  const noop = await voidAll(u, e); ok(noop.b.advanced === false && (await q("select 1 from audit_events where actor_id=$1 and action='transfer.send_epoch_advanced' and metadata->>'from'=$2", [u.id, e])).length === 1, 'void-all repeated -> advanced:false, no audit');
}
await E.done();
