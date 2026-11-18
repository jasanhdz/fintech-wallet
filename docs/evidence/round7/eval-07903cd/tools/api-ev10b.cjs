// (b) all-or-nothing: a business rejection (422 insufficient balance, 429 daily limit) leaves no transfer, ledger or idempotency row.
const { L, ok, call, mkUser, psql, flush, crypto } = require('./lib.cjs');
(async () => {
  const u = await mkUser('Ana Atom', 'at'); const id = psql(`select id from users where email='${u.email}'`);
  const cnt = () => psql(`select (select count(*) from transfers where owner_id='${id}')||' transfers / '||(select count(*) from idempotency_records where user_id='${id}')||' idem / '||(select count(*) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id where t.owner_id='${id}')||' ledger / '||(select count(*) from audit_events where actor_id='${id}' and action='transfer.created')||' audit'`);
  const b = (amt) => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amt, concept: 'Atom', reference: '9' });
  const P = (k, amt) => call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': k }, body: JSON.stringify(b(amt)) });
  L('start', cnt());
  const k = crypto.randomUUID();
  const r1 = await P(k, '499999'); L('ok 499999 ->', r1.s, '|', cnt());
  const r2 = await P(k, '499999'); L('replay ->', r2.s, 'same id', r2.b.id === r1.b.id, '|', cnt());
  const kd = crypto.randomUUID();
  const r3 = await P(kd, '499999'); const r4 = await P(crypto.randomUUID(), '499999'); const r5 = await P(crypto.randomUUID(), '499999');
  L('3 more below threshold ->', r3.s, r4.s, r5.s, '|', cnt(), '| balance', psql(`select balance_minor from accounts where id='${u.pr.id}'`));
  const kr = crypto.randomUUID();
  const rej = await P(kr, '499999'); L('beyond the balance or the daily limit ->', rej.s, rej.b.detail, '|', cnt());
  const rejKeyKnown = psql(`select count(*) from idempotency_records where user_id='${id}' and operation='create-transfer' and key_hash is not null`);
  L('rejected key leaves an idempotency record? count of records equals transfers:', rejKeyKnown);
  const again = await P(kr, '499999'); L('same rejected key again ->', again.s, again.b.detail, '(re-evaluated, no stored result)');
  flush('logs/api-ev10b.txt');
})().catch((e) => { console.error(e); process.exitCode = 1; });
