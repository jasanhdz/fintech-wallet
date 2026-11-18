// Evaluator pass 10 (code 07903cd): backend claims behind F-26, against the real API + PostgreSQL wallet_test (port 3991).
// (a) no lookup by Idempotency-Key / no list of own transfers; (b) idempotency record + transfer + ledger are one transaction;
// (c) idempotency_records.expires_at is not checked; (d) unknown key + valid data creates a NEW operation (no veto of a late send);
// (e) awaiting_confirmation/expired/cancelled never appear in movements; plus a REAL concurrent same-key race (409 "en curso").
const { L, ok, call, mkUser, mkRecipient, xfer, balances, dbRows, dbLedger, psql, flush, crypto, API, PW } = require('./lib.cjs');
const body = (u, amt, ref = '8001', concept = 'Ev10') => ({ sourceAccountId: u.pr.id, destinationType: 'beneficiary', beneficiaryId: u.own.id, amountMinor: amt, concept, reference: ref });
const post = (u, key, b) => call(u.token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(b) });
const raw = async (token, path, init) => { const r = await fetch(API + path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers || {}) } }); return { s: r.status, t: (await r.text()).slice(0, 160) }; };
(async () => {
  const u = await mkUser('Ana Ev10', 'be');
  // (a) endpoints
  L('== (a) lookup endpoints');
  for (const [m, p] of [['GET', '/transfers'], ['GET', '/transfers?limit=5'], ['GET', '/transfers?idempotencyKey=' + crypto.randomUUID()], ['GET', '/idempotency-records'], ['GET', '/idempotency/' + crypto.randomUUID()], ['GET', '/accounts/' + u.pr.id + '/transfers'], ['HEAD', '/transfers/' + crypto.randomUUID()], ['GET', '/transfers/' + crypto.randomUUID()], ['GET', '/transfers/not-a-uuid']]) {
    const r = await raw(u.token, p, { method: m }); L(`${m} ${p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, '<uuid>')} -> ${r.s} ${r.t.replace(/"requestId":"[^"]+"/, '').slice(0, 90)}`);
  }
  L('declared routes in api/src/http/app.ts for transfers: POST /transfers, GET /transfers/:id, POST /transfers/:id/cancel, POST /transfers/:id/confirm, GET /transfer-policy (grep in README)');
  // (b) all or nothing
  L('== (b) atomicity');
  const cnt = () => psql(`select (select count(*) from transfers where owner_id='${u.id}') || ' transfers / ' || (select count(*) from idempotency_records where user_id='${u.id}' and operation='create-transfer') || ' idem / ' || (select count(*) from ledger_entries le join ledger_transactions lt on lt.id=le.ledger_transaction_id join transfers t on t.id=lt.reference_id where t.owner_id='${u.id}') || ' ledger rows'`);
  u.id = psql(`select id from users where email='${u.email}'`);
  L('start', cnt());
  const rej = await post(u, crypto.randomUUID(), body(u, '99999999', '8002')); // > balance, > threshold -> 202? use a small one that exceeds balance below threshold
  L(`over-balance above threshold -> ${rej.s} ${rej.b?.status}`);
  const poor = await post(u, crypto.randomUUID(), body(u, '499999', '8003'));
  L(`499999 (below threshold) ->`, poor.s, poor.b?.status || poor.b?.detail);
  L('after', cnt());
  // Insufficient balance below the OTP threshold: drain then exceed
  const bal0 = (await balances(u)).checking; L('principal balance', bal0.toString());
  // (c) expired record still replays
  L('== (c) expires_at not checked');
  const kOld = crypto.randomUUID(); const bOld = body(u, '12345', '8010');
  const first = await post(u, kOld, bOld); L('first', first.s, first.b?.status, first.b?.id?.slice(0, 8));
  const rec = psql(`select to_char(created_at,'HH24:MI:SS')||' exp='||to_char(expires_at,'YYYY-MM-DD')||' (+'||round(extract(epoch from (expires_at-created_at))/86400)||'d)' from idempotency_records where transfer_id='${first.b.id}'`);
  L('record', rec);
  psql(`update idempotency_records set expires_at = now() - interval '45 days', created_at = now() - interval '75 days' where transfer_id='${first.b.id}'`);
  L('record after forcing expires_at to the past:', psql(`select to_char(expires_at,'YYYY-MM-DD')||' < now: '||(expires_at<now()) from idempotency_records where transfer_id='${first.b.id}'`));
  const replay = await post(u, kOld, bOld);
  ok(replay.b?.id === first.b.id && replay.s === first.s, `replay with an EXPIRED record still returns the same transfer (HTTP ${replay.s}, same id ${replay.b?.id === first.b.id})`);
  const t1 = psql(`select count(*) from transfers where owner_id='${u.id}' and amount_minor=12345`); L('transfers with 12345:', t1);
  // (d) unknown key + valid data creates a new operation
  L('== (d) unknown key creates a new operation (no server veto of a late send)');
  const kLost = crypto.randomUUID(); const bLost = body(u, '23456', '8011');
  L('attempt A (key lost by the client; never sent) -> nothing exists server side; account balance', (await balances(u)).checking.toString());
  const lateA = await post(u, kLost, bLost); L('late send of A with its original key ->', lateA.s, lateA.b?.status);
  const sameData = await post(u, crypto.randomUUID(), bLost); L('same data, a different new key ->', sameData.s, sameData.b?.status, 'distinctIds=' + (sameData.b?.id !== lateA.b?.id));
  L('debits for 23456:', psql(`select count(*) from transfers where owner_id='${u.id}' and amount_minor=23456 and status='completed'`), ' ledger', dbLedger(u.email));
  // 404 real
  L('== real 404 (GET unknown id; POST with a beneficiary that does not exist)');
  const g404 = await call(u.token, '/transfers/' + crypto.randomUUID()); L('GET unknown ->', g404.s, g404.b?.detail);
  const p404 = await post(u, crypto.randomUUID(), { ...body(u, '1000', '8012'), beneficiaryId: crypto.randomUUID() }); L('POST unknown beneficiary ->', p404.s, p404.b?.detail);
  // (e) not in movements
  L('== (e) pending/expired/cancelled not in movements');
  const pend = await post(u, crypto.randomUUID(), body(u, '600000', '8020', 'PENDIENTE')); L('pending', pend.s, pend.b?.status);
  const toCancel = await post(u, crypto.randomUUID(), body(u, '600000', '8021', 'CANCELADA')); const c = await call(u.token, `/transfers/${toCancel.b.id}/cancel`, { method: 'POST' }); L('cancel ->', c.s, c.b?.status);
  const toExpire = await post(u, crypto.randomUUID(), body(u, '600000', '8022', 'EXPIRADA'));
  psql(`update otp_challenges set expires_at = now() - interval '1 minute' where transfer_id='${toExpire.b.id}'`);
  const ex = await call(u.token, `/transfers/${toExpire.b.id}`); L('GET after expiry ->', ex.s, ex.b?.status);
  const mv = []; let cursor = ''; for (let i = 0; i < 5; i++) { const r = await call(u.token, `/accounts/${u.pr.id}/movements?limit=50${cursor}`); mv.push(...r.b.items); if (!r.b.nextCursor) break; cursor = '&cursor=' + encodeURIComponent(r.b.nextCursor); }
  const sav = (await call(u.token, `/accounts/${u.sv.id}/movements?limit=50`)).b.items;
  const concepts = [...mv, ...sav].map((m) => m.concept || m.description || JSON.stringify(m).slice(0, 80));
  L('movement concepts:', JSON.stringify(concepts));
  ok(!JSON.stringify([...mv, ...sav]).match(/PENDIENTE|CANCELADA|EXPIRADA/), 'awaiting_confirmation / cancelled / expired are not listed in movements');
  L('DB statuses:', psql(`select string_agg(concept||'='||status, ' | ' order by created_at) from transfers where owner_id='${u.id}' and concept in ('PENDIENTE','CANCELADA','EXPIRADA')`));
  // REAL concurrent race on the same key (the real source of the 409 "en curso")
  L('== real concurrent same-key race');
  const v = await mkUser('Ana Race', 'race'); v.id = psql(`select id from users where email='${v.email}'`);
  const kr = crypto.randomUUID(); const br = body(v, '30025', '8030', 'Carrera');
  const res = await Promise.all(Array.from({ length: 8 }, () => post(v, kr, br)));
  L('statuses of 8 concurrent POST with the same key:', JSON.stringify(res.map((r) => r.s)));
  const r409 = res.find((r) => r.s === 409); if (r409) L('real 409 body:', JSON.stringify({ title: r409.b.title, detail: r409.b.detail, status: r409.b.status }));
  L('DB rows for race user:', dbRows(v.email), '| ledger', dbLedger(v.email));
  L('debits (completed 30025):', psql(`select count(*) from transfers where owner_id='${v.id}' and status='completed'`));
  flush('logs/api-ev10.txt');
})().catch((e) => { console.error('FAILED', e); process.exitCode = 1; });
