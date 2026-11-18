import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
import { dataSource } from '../src/db/data-source.js';
import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import { createApp } from '../src/http/app.js';
import { ensureDemoClearingAccount } from '../src/db/clearing-account.js';

test('internal transfers enforce owner, idempotency, OTP, ledger, balance and concurrent daily controls in wallet_test', async (t) => {
  const testUrl=assertSafeTestDatabase(process.env.TEST_DATABASE_URL,process.env.DATABASE_URL);
  process.env.DATABASE_URL=testUrl.toString();process.env.APP_ENV='development';process.env.WEB_ORIGIN='http://localhost:5173';
  process.env.BUSINESS_TIME_ZONE??='America/Mexico_City';process.env.DAILY_TRANSFER_LIMIT_MINOR??='2000000';process.env.OTP_THRESHOLD_MINOR??='500000';process.env.OTP_EXPIRY_SECONDS??='300';process.env.OTP_MAX_ATTEMPTS??='5';
  let server:ReturnType<typeof createServer>|undefined;const source=dataSource(testUrl.toString());await source.initialize();
  t.after(async()=>{if(server?.listening)await new Promise<void>((resolveClose,reject)=>server!.close((error)=>error?reject(error):resolveClose()));if(source.isInitialized)await source.destroy();});
  server=createServer(createApp());await new Promise<void>((resolveListen)=>server!.listen(0,'127.0.0.1',resolveListen));const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/v1`;
  async function register(label:string){const csrfResponse=await fetch(`${base}/auth/csrf`);const csrf=(await csrfResponse.json() as {csrfToken:string}).csrfToken;const cookie=csrfResponse.headers.getSetCookie().find((value)=>value.startsWith('wallet_csrf='))!.split(';')[0]!;const response=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,cookie,origin:'http://localhost:5173'},body:JSON.stringify({fullName:label,email:`${label}-${crypto.randomUUID()}@example.test`,password:'correct horse battery staple'})});assert.equal(response.status,201);return (await response.json() as {accessToken:string}).accessToken;}
  const owner=await register('transfer-owner');const other=await register('transfer-other');const ownerId=String((await jwtVerify(owner,new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))).payload.sub);const headers={authorization:`Bearer ${owner}`,'content-type':'application/json'};
  const accounts=(await (await fetch(`${base}/accounts`,{headers})).json() as {items:Array<{id:string;clabe:string;availableBalanceMinor:string}>}).items;const foreign=(await (await fetch(`${base}/accounts`,{headers:{authorization:`Bearer ${other}`} })).json() as {items:Array<{id:string;clabe:string}>}).items[0]!;
  const clearingId=await ensureDemoClearingAccount((sql,parameters)=>source.query(sql,parameters));
  const funded=accounts[0]!;const opening=await source.query("INSERT INTO ledger_transactions(reference_type,reference_id) VALUES('opening',$1) RETURNING id",[funded.id]);await source.query("INSERT INTO ledger_entries(ledger_transaction_id,account_id,signed_amount_minor,entry_type) VALUES($1,$2,10000000,'opening'),($1,$3,-10000000,'opening')",[opening[0].id,funded.id,clearingId]);await source.query('UPDATE accounts SET balance_minor=balance_minor+10000000 WHERE id=$1',[funded.id]);await source.query('UPDATE accounts SET balance_minor=balance_minor-10000000 WHERE id=$1',[clearingId]);
  const beneficiaryResponse=await fetch(`${base}/beneficiaries`,{method:'POST',headers,body:JSON.stringify({name:'Test destination',alias:'destination',clabe:foreign.clabe})});assert.equal(beneficiaryResponse.status,201);const beneficiary=(await beneficiaryResponse.json() as {id:string;destinationAccountId:string});
  const request=(amountMinor:string):Record<string,string>=>({sourceAccountId:accounts[0]!.id,destinationType:'beneficiary',beneficiaryId:beneficiary.id,amountMinor,concept:'integration transfer',reference:'123'});
  const key=()=>crypto.randomUUID()+crypto.randomUUID();
  const post=(body:Record<string,string>,idempotencyKey=key())=>fetch(`${base}/transfers`,{method:'POST',headers:{...headers,'idempotency-key':idempotencyKey},body:JSON.stringify(body)});
  const immediateKey=key();const immediateBody=request('1000');const immediate=await post(immediateBody,immediateKey);assert.equal(immediate.status,201);const immediateDto=await immediate.json() as {id:string;status:string};assert.equal(immediateDto.status,'completed');
  const duplicate=await post(immediateBody,immediateKey);assert.equal(duplicate.status,201);assert.equal((await duplicate.json() as {id:string}).id,immediateDto.id);
  const mismatch=await post({...immediateBody,amountMinor:'1001'},immediateKey);assert.equal(mismatch.status,409);
  const otpResponse=await post(request('600000'));assert.equal(otpResponse.status,202);const pending=await otpResponse.json() as {id:string;status:string;demoOnlyCode:string};assert.equal(pending.status,'awaiting_confirmation');assert.match(pending.demoOnlyCode,/^\d{6}$/);
  const confirm=(id:string,code:string,k=key())=>fetch(`${base}/transfers/${id}/confirm`,{method:'POST',headers:{...headers,'idempotency-key':k},body:JSON.stringify({code})});
  const wrong=await confirm(pending.id,'000000');assert.ok([422,429].includes(wrong.status));const confirmKey=key();const confirmed=await confirm(pending.id,pending.demoOnlyCode,confirmKey);assert.equal(confirmed.status,200);assert.equal((await confirmed.json() as {status:string}).status,'completed');
  const retryConfirm=await confirm(pending.id,pending.demoOnlyCode,confirmKey);assert.equal(retryConfirm.status,200);assert.equal((await retryConfirm.json() as {id:string}).id,pending.id);
  const exhaustedResponse=await post(request('600000'));assert.equal(exhaustedResponse.status,202);const exhausted=await exhaustedResponse.json() as {id:string;demoOnlyCode:string};
  for(let attempt=0;attempt<5;attempt++){const wrongCode=exhausted.demoOnlyCode==='000000'?'000001':'000000';const response=await confirm(exhausted.id,wrongCode);assert.equal(response.status,attempt===4?429:422);}
  const expiredResponse=await post(request('600000'));assert.equal(expiredResponse.status,202);const expired=await expiredResponse.json() as {id:string;demoOnlyCode:string};await source.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1",[expired.id]);const expiredConfirm=await confirm(expired.id,expired.demoOnlyCode);assert.equal(expiredConfirm.status,422);
  const status=await fetch(`${base}/transfers/${pending.id}`,{headers:{authorization:`Bearer ${other}`}});assert.equal(status.status,404);
  process.env.OTP_THRESHOLD_MINOR='9223372036854775807';process.env.DAILY_TRANSFER_LIMIT_MINOR='9223372036854775807';const insufficient=await post({...request('999999999'),sourceAccountId:accounts[1]?.id??accounts[0]!.id});process.env.OTP_THRESHOLD_MINOR='500000';process.env.DAILY_TRANSFER_LIMIT_MINOR='2000000';assert.equal(insufficient.status,422);
  process.env.OTP_THRESHOLD_MINOR='9223372036854775807';process.env.DAILY_TRANSFER_LIMIT_MINOR='601000';const overLimit=await post(request('1'));process.env.OTP_THRESHOLD_MINOR='500000';process.env.DAILY_TRANSFER_LIMIT_MINOR='2000000';assert.equal(overLimit.status,429);
  const self=await post({...request('10'),sourceAccountId:accounts[0]!.id,destinationType:'own_account',destinationAccountId:accounts[0]!.id});assert.equal(self.status,422);
  const rows=await source.query("SELECT count(*)::int AS n,COALESCE(sum(le.signed_amount_minor),0)::text AS net FROM transfers t LEFT JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id LEFT JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.owner_id=$1 AND t.status='completed'",[ownerId]);assert.ok(rows[0].n>=2);assert.equal(rows[0].net,'0');
  const concurrent=await Promise.all(Array.from({length:100},(_,i)=>post(request(String(i+1)))));assert.ok(concurrent.every((response)=>response.status===201||response.status===429));
  const balance=await source.query('SELECT balance_minor::text AS n FROM accounts WHERE id=$1',[accounts[0]!.id]);assert.ok(BigInt(balance[0].n)>=0n);
});
