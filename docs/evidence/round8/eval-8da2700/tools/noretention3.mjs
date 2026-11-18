const API2 = 'http://127.0.0.1:3954/v1';
import * as E from './lib8.mjs';
const { L, ok, call, q, one } = E;
const u = await E.register('exp0c');                 // registered on 3952 (EV_API_PORT)
const r = async (path, init) => { const x = await fetch(API2 + path, { ...init, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + u.token, ...(init?.headers || {}) } }); return { s: x.status, b: await x.json().catch(() => null) }; };
const epoch = (await call(u.token, '/transfer-policy')).b.sendEpoch;
const body = JSON.stringify({ sourceAccountId: u.pr.id, destinationType: 'own_account', destinationAccountId: u.sv.id, amountMinor: '2000', concept: 'x', reference: '1' });
const body2 = JSON.stringify({ sourceAccountId: u.pr.id, destinationType: 'own_account', destinationAccountId: u.sv.id, amountMinor: '100', concept: 'x', reference: '1' });
const k1 = E.newKey(), k2 = E.newKey(), a1 = E.uuid(), a2 = E.uuid(), a3 = E.uuid();
const p = (await call(u.token, '/transfers', { method: 'POST', headers: { 'idempotency-key': k1, 'transfer-attempt-id': a1, 'transfer-send-epoch': epoch }, body })).b;  // on 3952 pending
const d = (await call(u.token, '/transfers', { method: 'POST', headers: { 'idempotency-key': k2, 'transfer-attempt-id': a2, 'transfer-send-epoch': epoch }, body: body2 })).b; // executed
const replay = await r('/transfers', { method: 'POST', headers: { 'idempotency-key': k2, 'transfer-attempt-id': a2, 'transfer-send-epoch': epoch }, body: body2 });
L('replay of an EXECUTED transfer on the API without the variable ->', replay.s); ok(replay.s === 500, 'replay of executed result is 500 too (variable read before replay)');
const conf = await r(`/transfers/${p.id}/confirm`, { method: 'POST', headers: { 'idempotency-key': E.newKey() }, body: JSON.stringify({ code: p.demoOnlyCode }) });
L('confirm of a pending transfer ->', conf.s); ok(conf.s === 500, 'confirm -> 500');
const canc = await r(`/transfers/${p.id}/cancel`, { method: 'POST', body: '{}' }); ok(canc.s === 200, 'cancel works (no variable needed)', canc.s);
const g = await r(`/transfers/${d.id}`); ok(g.s === 200, 'GET transfer works');
await E.done();
