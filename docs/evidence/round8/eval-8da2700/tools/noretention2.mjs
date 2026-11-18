import * as E from './lib8.mjs';
const { L, ok, call, send, epochOf, ownBody, newKey, uuid, confirmT, voidA } = E;
// tokens are valid on every instance (same JWT secret): create on 3952 (threshold 1000), then act on 3954 (no variable)
const u = await E.register('exp0b'); const epoch = await epochOf(u);
const key = newKey(), attemptId = uuid();
const p = await send(u, ownBody(u, 2000), { key, attemptId, epoch }); const done = await send(u, ownBody(u, 100), { key: newKey(), attemptId: uuid(), epoch });
L('created on 3952:', p.s, done.s);
globalThis.__swap = true;
