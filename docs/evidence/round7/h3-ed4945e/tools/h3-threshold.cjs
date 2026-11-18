// R7 H3 · F-23 (documentation only): the code threshold as the real API applies it today (default demo policy).
const { L, call, mkUser, xfer, flush } = require('./lib.cjs');
(async () => {
  const u = await mkUser();
  const policy = (await call(u.token, '/transfer-policy')).b;
  L('policy otpThresholdMinor', policy.otpThresholdMinor, '| demoOnly', policy.demoOnly);
  for (const amount of ['499999', '500000', '500001']) {
    const r = await xfer(u, u.pr, u.own, amount);
    L(`POST /transfers amountMinor=${amount} -> HTTP ${r.s} status ${r.b && r.b.status} | demoOnlyCode present: ${Boolean(r.b && r.b.demoOnlyCode)} (value never printed)`);
    if (r.b && r.b.status === 'awaiting_confirmation') await call(u.token, `/transfers/${r.b.id}/cancel`, { method: 'POST' });
  }
  flush('logs/h3-threshold.txt');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
