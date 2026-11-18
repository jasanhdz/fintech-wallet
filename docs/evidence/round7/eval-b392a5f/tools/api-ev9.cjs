// Evaluator API checks (real API + PostgreSQL wallet_test): threshold edges, policy source, new-code semantics, pending-attempt double-debit probe.
const { L, ok, call, mkUser, mkRecipient, xfer, balances, dbRows, dbLedger, psql, flush, crypto } = require('./lib.cjs');
(async () => {
  const u = await mkUser('Ana López', 'api');
  const policy = (await call(u.token, '/transfer-policy')).b;
  L('policy', JSON.stringify({ otpThresholdMinor: policy.otpThresholdMinor, otpExpirySeconds: policy.otpExpirySeconds, otpMaxAttempts: policy.otpMaxAttempts, dailyLimitMinor: policy.dailyLimitMinor, dailyRemainingMinor: policy.dailyRemainingMinor, demoOnly: policy.demoOnly }));
  // 4. threshold edges (OTP required when amount >= threshold in the API)
  const T = BigInt(policy.otpThresholdMinor);
  for (const [label, amt] of [['T-1 (4,999.99)', T - 1n], ['T (5,000.00)', T], ['T+1 (5,000.01)', T + 1n]]) {
    const r = await xfer(u, u.pr, u.own, amt.toString());
    L(`EDGE ${label}: amountMinor=${amt} -> HTTP ${r.s} status=${r.b?.status} demoCodePresent=${Boolean(r.b?.demoOnlyCode)}`);
    if (r.b?.status === 'awaiting_confirmation') { const c = await call(u.token, `/transfers/${r.b.id}/cancel`, { method: 'POST' }); L(`  cancel -> ${c.s} ${c.b?.status}`); }
  }
  L('EDGE ledger/rows after edges:', dbRows(u.email).replace(/\n/g, ' | '), '| ledger', dbLedger(u.email));
  // 5. new code semantics (fresh user so balances are not affected by the edge probe)
  const u0 = u; Object.assign(u, await mkUser('Ana López', 'nc'));
  const before = await balances(u);
  const body = (amt, ref = '7001') => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amt, concept: 'Nuevo codigo', reference: ref });
  const k1 = crypto.randomUUID();
  const a1 = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': k1 }, body: JSON.stringify(body('600000')) });
  const old = a1.b.demoOnlyCode;
  // replay of the same key returns the same attempt (UI recovery uses this)
  const rep = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': k1 }, body: JSON.stringify(body('600000')) });
  ok(rep.b.id === a1.b.id, `replay same key -> same attempt id (${rep.s})`);
  // A second create with a NEW key while a1 is still pending: does the server open a second pending attempt?
  const a2 = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body('600000')) });
  L(`NEW KEY while previous pending: HTTP ${a2.s} status=${a2.b?.status} sameId=${a2.b?.id === a1.b.id}`);
  const pend = psql(`select count(*) from transfers t join users x on x.id=t.owner_id where x.email='${u.email}' and t.status='awaiting_confirmation'`);
  L('pending attempts for user now:', pend);
  // cancel a1; the OLD code must not authorize a1 nor a2; and no money must move
  const c1 = await call(u.token, `/transfers/${a1.b.id}/cancel`, { method: 'POST' });
  L(`cancel a1 -> ${c1.s} ${c1.b?.status}`);
  const lateOld = await call(u.token, `/transfers/${a1.b.id}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code: old }) });
  L(`OLD code on cancelled a1 -> ${lateOld.s}`);
  const cross = old === a2.b.demoOnlyCode ? { s: 'skipped(collision)' } : await call(u.token, `/transfers/${a2.b.id}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code: old }) });
  L(`OLD code on new a2 -> ${cross.s}`);
  const mid = await balances(u);
  ok(mid.checking === before.checking && mid.savings === before.savings, `no money moved by old code (principal ${mid.checking} savings ${mid.savings})`);
  const good = await call(u.token, `/transfers/${a2.b.id}/confirm`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ code: a2.b.demoOnlyCode }) });
  L(`NEW code on a2 -> ${good.s} ${good.b?.status}`);
  const after = await balances(u);
  ok(before.checking - after.checking === 600000n && after.savings - before.savings === 600000n, 'exactly one debit/credit of 600000');
  L('DB rows:', dbRows(u.email).replace(/\n/g, ' | '), '| ledger', dbLedger(u.email));
  // 6. idempotency under threshold: a SECOND create with a different key while the first (lost response) already completed -> two debits (API cannot know)
  const before2 = await balances(u);
  const kA = crypto.randomUUID(), kB = crypto.randomUUID();
  const b1 = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': kA }, body: JSON.stringify(body('30025', '7002')) });
  const b2 = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': kB }, body: JSON.stringify(body('30025', '7002')) });
  const after2 = await balances(u);
  L(`DOUBLE-KEY under threshold: first ${b1.s} ${b1.b?.status}, second(new key, same payload) ${b2.s} ${b2.b?.status} distinctIds=${b1.b?.id !== b2.b?.id}; debit total=${before2.checking - after2.checking}`);
  // money edge: same key different payload
  const conflict = await call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': kA }, body: JSON.stringify(body('30026', '7002')) });
  L(`same key different payload -> ${conflict.s}`);
  flush('logs/api-ev9.txt');
})().catch((e) => { console.error('FAILED', e); process.exitCode = 1; });
