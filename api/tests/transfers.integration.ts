import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
import { Client } from 'pg';
import { dataSource } from '../src/db/data-source.js';
import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import { createApp } from '../src/http/app.js';
import { ensureDemoClearingAccount } from '../src/db/clearing-account.js';

test('internal transfers enforce owner, idempotency, OTP, ledger, balance and concurrent daily controls in wallet_test', async (t) => {
  const testUrl=assertSafeTestDatabase(process.env.TEST_DATABASE_URL,process.env.DATABASE_URL);
  process.env.DATABASE_URL=testUrl.toString();process.env.APP_ENV='development';process.env.WEB_ORIGIN='http://localhost:5173';
  process.env.BUSINESS_TIME_ZONE??='America/Mexico_City';process.env.DAILY_TRANSFER_LIMIT_MINOR??='2000000';process.env.OTP_THRESHOLD_MINOR??='500000';process.env.OTP_EXPIRY_SECONDS??='300';process.env.OTP_MAX_ATTEMPTS??='5';
  let server:ReturnType<typeof createServer>|undefined;let base='';const source=dataSource(testUrl.toString());await source.initialize();
  const startServer=async()=>{server=createServer(createApp());await new Promise<void>((resolveListen)=>server!.listen(0,'127.0.0.1',resolveListen));const address=server.address();assert(address&&typeof address!=='string');base=`http://127.0.0.1:${address.port}/v1`;};
  const stopServer=async()=>{if(server?.listening)await new Promise<void>((resolveClose,reject)=>server!.close((error)=>error?reject(error):resolveClose()));};
  t.after(async()=>{await stopServer();if(source.isInitialized)await source.destroy();});
  await startServer();
  async function register(label:string){const csrfResponse=await fetch(`${base}/auth/csrf`);const csrf=(await csrfResponse.json() as {csrfToken:string}).csrfToken;const cookie=csrfResponse.headers.getSetCookie().find((value)=>value.startsWith('wallet_csrf='))!.split(';')[0]!;const response=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,cookie,origin:'http://localhost:5173'},body:JSON.stringify({fullName:label,email:`${label}-${crypto.randomUUID()}@example.test`,password:'correct horse battery staple'})});assert.equal(response.status,201);return (await response.json() as {accessToken:string}).accessToken;}
  const owner=await register('transfer-owner');const other=await register('transfer-other');const ownerId=String((await jwtVerify(owner,new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))).payload.sub);const headers={authorization:`Bearer ${owner}`,'content-type':'application/json'};
  const accounts=(await (await fetch(`${base}/accounts`,{headers})).json() as {items:Array<{id:string;clabe:string;availableBalanceMinor:string}>}).items;const foreign=(await (await fetch(`${base}/accounts`,{headers:{authorization:`Bearer ${other}`} })).json() as {items:Array<{id:string;clabe:string}>}).items[0]!;
  const clearingId=await ensureDemoClearingAccount((sql,parameters)=>source.query(sql,parameters));
  const funded=accounts[0]!;const opening=await source.query("INSERT INTO ledger_transactions(reference_type,reference_id) VALUES('opening',$1) RETURNING id",[funded.id]);await source.query("INSERT INTO ledger_entries(ledger_transaction_id,account_id,signed_amount_minor,entry_type) VALUES($1,$2,10000000,'opening'),($1,$3,-10000000,'opening')",[opening[0].id,funded.id,clearingId]);await source.query('UPDATE accounts SET balance_minor=balance_minor+10000000 WHERE id=$1',[funded.id]);await source.query('UPDATE accounts SET balance_minor=balance_minor-10000000 WHERE id=$1',[clearingId]);
  const beneficiaryResponse=await fetch(`${base}/beneficiaries`,{method:'POST',headers,body:JSON.stringify({name:'Test destination',alias:'destination',clabe:foreign.clabe})});assert.equal(beneficiaryResponse.status,201);const beneficiary=(await beneficiaryResponse.json() as {id:string;destinationAccountId:string});
  const request=(amountMinor:string):Record<string,string>=>({sourceAccountId:accounts[0]!.id,destinationType:'beneficiary',beneficiaryId:beneficiary.id,amountMinor,concept:'integration transfer',reference:'123'});
  const key=()=>crypto.randomUUID()+crypto.randomUUID();
  const post=(body:Record<string,string>,idempotencyKey=key())=>fetch(`${base}/transfers`,{method:'POST',headers:{...headers,'idempotency-key':idempotencyKey},body:JSON.stringify(body)});
  const financialSnapshot=async()=>{
    const balances=await source.query('SELECT id,balance_minor::text AS balance FROM accounts WHERE owner_id=$1 ORDER BY id',[ownerId]);
    const transfers=await source.query("SELECT count(*)::int AS count FROM transfers WHERE owner_id=$1 AND status='completed'",[ownerId]);
    const postings=await source.query("SELECT count(le.id)::int AS count FROM transfers t JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.owner_id=$1",[ownerId]);
    return {balances,completedTransfers:transfers[0].count,ledgerPostings:postings[0].count};
  };
  const dailyUsageSnapshot=async()=>{
    const rows=await source.query('SELECT business_date::text AS day,outgoing_minor::text AS amount FROM daily_limit_usage WHERE owner_id=$1 AND business_date=(now() AT TIME ZONE $2)::date AND currency=\'MXN\'', [ownerId,process.env.BUSINESS_TIME_ZONE]);
    return rows.map((row:{day:string;amount:string})=>({day:row.day,amount:row.amount}));
  };
  const immediateKey=key();const immediateBody=request('1000');const immediate=await post(immediateBody,immediateKey);assert.equal(immediate.status,201);const immediateDto=await immediate.json() as {id:string;status:string};assert.equal(immediateDto.status,'completed');
  const duplicate=await post(immediateBody,immediateKey);assert.equal(duplicate.status,201);assert.equal((await duplicate.json() as {id:string}).id,immediateDto.id);
  const uncertainKey=key();const uncertainBody=request('7');const uncertain=await post(uncertainBody,uncertainKey);assert.equal(uncertain.status,201);await uncertain.body?.cancel();
  await stopServer();await startServer();
  const recovered=await post(uncertainBody,uncertainKey);assert.equal(recovered.status,201);const recoveredDto=await recovered.json() as {id:string};
  const recoveredRows=await source.query('SELECT id FROM transfers WHERE id=$1 AND owner_id=$2',[recoveredDto.id,ownerId]);assert.equal(recoveredRows.length,1,'replay after API restart must return the committed transfer');
  const recoveryRecords=await source.query("SELECT count(*)::int AS count FROM idempotency_records WHERE user_id=$1 AND operation='create-transfer' AND transfer_id=$2",[ownerId,recoveredDto.id]);assert.equal(recoveryRecords[0].count,1,'uncertain retry must preserve one idempotency result');
  const mismatch=await post({...immediateBody,amountMinor:'1001'},immediateKey);assert.equal(mismatch.status,409);
   const otpBody=request('600000');const otpKey=key();const otpResponse=await post(otpBody,otpKey);assert.equal(otpResponse.status,202);const pending=await otpResponse.json() as {id:string;status:string;demoOnlyCode:string};assert.equal(pending.status,'awaiting_confirmation');assert.match(pending.demoOnlyCode,/^\d{6}$/);
   const stored=await source.query("SELECT i.response_snapshot::text AS snapshot,o.code_hash,o.demo_code_ciphertext FROM idempotency_records i JOIN otp_challenges o ON o.transfer_id=i.transfer_id WHERE i.transfer_id=$1 AND i.operation='create-transfer'",[pending.id]);assert.equal(stored.length,1);assert.equal(JSON.parse(stored[0].snapshot).demoOnlyCode,undefined);assert.ok(stored[0].code_hash);assert.ok(stored[0].demo_code_ciphertext);assert.notEqual(stored[0].demo_code_ciphertext,pending.demoOnlyCode);assert.ok(!String(stored[0].snapshot).includes(pending.demoOnlyCode));
   const otpReplay=await post(otpBody,otpKey);assert.equal(otpReplay.status,202);const replay=await otpReplay.json() as {id:string;demoOnlyCode:string};assert.equal(replay.id,pending.id);assert.equal(replay.demoOnlyCode,pending.demoOnlyCode);
  const confirm=(id:string,code:string,k=key())=>fetch(`${base}/transfers/${id}/confirm`,{method:'POST',headers:{...headers,'idempotency-key':k},body:JSON.stringify({code})});
   const otpFinancialBefore=await financialSnapshot();const otpStateBefore=await source.query('SELECT t.status,o.attempt_count,o.consumed_at FROM transfers t JOIN otp_challenges o ON o.transfer_id=t.id WHERE t.id=$1',[pending.id]);assert.equal(otpStateBefore.length,1);
   const wrongOtpCode=pending.demoOnlyCode==='000000'?'000001':'000000';const wrong=await confirm(pending.id,wrongOtpCode);assert.equal(wrong.status,422);
   assert.deepEqual(await financialSnapshot(),otpFinancialBefore,'incorrect OTP must not change owner balances, completed transfers, or ledger postings');
   const otpStateAfter=await source.query('SELECT t.status,o.attempt_count,o.consumed_at FROM transfers t JOIN otp_challenges o ON o.transfer_id=t.id WHERE t.id=$1',[pending.id]);assert.equal(otpStateAfter[0].status,'awaiting_confirmation','incorrect OTP must leave transfer pending');assert.equal(Number(otpStateAfter[0].attempt_count),Number(otpStateBefore[0].attempt_count)+1,'incorrect OTP increments attempts');assert.equal(otpStateAfter[0].consumed_at,null,'incorrect OTP must not consume challenge');
   const confirmKey=key();const confirmed=await confirm(pending.id,pending.demoOnlyCode,confirmKey);assert.equal(confirmed.status,200);assert.equal((await confirmed.json() as {status:string}).status,'completed');
  const retryConfirm=await confirm(pending.id,pending.demoOnlyCode,confirmKey);assert.equal(retryConfirm.status,200);assert.equal((await retryConfirm.json() as {id:string}).id,pending.id);
  const exhaustedResponse=await post(request('600000'));assert.equal(exhaustedResponse.status,202);const exhausted=await exhaustedResponse.json() as {id:string;demoOnlyCode:string};
  for(let attempt=0;attempt<5;attempt++){const wrongCode=exhausted.demoOnlyCode==='000000'?'000001':'000000';const response=await confirm(exhausted.id,wrongCode);assert.equal(response.status,attempt===4?429:422);}
  const expiredResponse=await post(request('600000'));assert.equal(expiredResponse.status,202);const expired=await expiredResponse.json() as {id:string;demoOnlyCode:string};await source.query("UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE transfer_id=$1",[expired.id]);const expiredConfirm=await confirm(expired.id,expired.demoOnlyCode);assert.equal(expiredConfirm.status,422);
  const status=await fetch(`${base}/transfers/${pending.id}`,{headers:{authorization:`Bearer ${other}`}});assert.equal(status.status,404);
   process.env.OTP_THRESHOLD_MINOR='9223372036854775807';process.env.DAILY_TRANSFER_LIMIT_MINOR='9223372036854775807';const insufficientBefore=await financialSnapshot();const insufficient=await post({...request('999999999'),sourceAccountId:accounts[1]?.id??accounts[0]!.id});process.env.OTP_THRESHOLD_MINOR='500000';process.env.DAILY_TRANSFER_LIMIT_MINOR='2000000';assert.equal(insufficient.status,422);assert.deepEqual(await financialSnapshot(),insufficientBefore,'insufficient balance must not change owner balances, completed transfers, or ledger postings');
   const limitFinancialBefore=await financialSnapshot();const limitUsageBefore=await dailyUsageSnapshot();assert.equal(limitUsageBefore.length,1,'test setup must have daily usage for the current business date');process.env.OTP_THRESHOLD_MINOR='9223372036854775807';process.env.DAILY_TRANSFER_LIMIT_MINOR=limitUsageBefore[0]!.amount;const overLimit=await post(request('1'));process.env.OTP_THRESHOLD_MINOR='500000';process.env.DAILY_TRANSFER_LIMIT_MINOR='2000000';assert.equal(overLimit.status,429);assert.deepEqual(await financialSnapshot(),limitFinancialBefore,'daily-limit rejection must not change owner balances, completed transfers, or ledger postings');assert.deepEqual(await dailyUsageSnapshot(),limitUsageBefore,'daily-limit rejection must not change daily usage');
  const self=await post({...request('10'),sourceAccountId:accounts[0]!.id,destinationType:'own_account',destinationAccountId:accounts[0]!.id});assert.equal(self.status,422);
  const rows=await source.query("SELECT count(*)::int AS n,COALESCE(sum(le.signed_amount_minor),0)::text AS net FROM transfers t LEFT JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id LEFT JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.owner_id=$1 AND t.status='completed'",[ownerId]);assert.ok(rows[0].n>=2);assert.equal(rows[0].net,'0');
   const sourceId=accounts[0]!.id;const destinationId=beneficiary.destinationAccountId;
   const beforeAccounts=await source.query('SELECT id,balance_minor::text AS balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id',[ [sourceId,destinationId] ]);
   assert.equal(beforeAccounts.length,2);
   const beforeUsage=await source.query("SELECT (now() AT TIME ZONE $1)::date::text AS business_date",[process.env.BUSINESS_TIME_ZONE]);
   const businessDate=beforeUsage[0].business_date;
   const usageBefore=await source.query('SELECT outgoing_minor::text AS amount FROM daily_limit_usage WHERE owner_id=$1 AND business_date=$2 AND currency=\'MXN\'',[ownerId,businessDate]);
   const usageBeforeMinor=BigInt(usageBefore[0]?.amount??'0');
   const rowsBefore=await source.query('SELECT id FROM transfers WHERE owner_id=$1',[ownerId]);
   const beforeIds=new Set(rowsBefore.map((row:{id:string})=>row.id));
   const totalMinor=5050n;
   process.env.DAILY_TRANSFER_LIMIT_MINOR='9223372036854775807';
   const concurrent=await Promise.all(Array.from({length:100},(_,i)=>post(request(String(i+1)),key())));
   const statuses=concurrent.map((response)=>response.status);
   assert.ok(statuses.every((status)=>status===201),`expected 100 accepted responses, observed statuses ${JSON.stringify(statuses)}`);
   const responseDtos=await Promise.all(concurrent.map((response)=>response.json() as Promise<{id:string;status:string}>));
   const acceptedIds=responseDtos.map((dto)=>dto.id);
   assert.equal(new Set(acceptedIds).size,100,'transfer IDs must be unique');
   assert.ok(responseDtos.every((dto)=>dto.status==='completed'));
   const expectedAmountById=new Map(acceptedIds.map((id,index)=>[id,BigInt(index+1)] as const));
   const afterAccounts=await source.query('SELECT id,balance_minor::text AS balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id',[ [sourceId,destinationId] ]);
   const balanceById=new Map<string,bigint>(afterAccounts.map((row:{id:string;balance:string})=>[row.id,BigInt(row.balance)] as const));
   const beforeBalanceById=new Map<string,bigint>(beforeAccounts.map((row:{id:string;balance:string})=>[row.id,BigInt(row.balance)] as const));
   assert.equal(beforeBalanceById.get(sourceId)!-balanceById.get(sourceId)!,totalMinor,'source balance delta');
   assert.equal(balanceById.get(destinationId)!-beforeBalanceById.get(destinationId)!,totalMinor,'destination balance delta');
   const usageAfter=await source.query('SELECT outgoing_minor::text AS amount FROM daily_limit_usage WHERE owner_id=$1 AND business_date=$2 AND currency=\'MXN\'',[ownerId,businessDate]);
   const usageAfterMinor=BigInt(usageAfter[0]?.amount??'0');
   assert.equal(usageAfterMinor-usageBeforeMinor,totalMinor,'daily usage delta');
   const transferRows=await source.query("SELECT t.id,t.status,t.amount_minor::text AS amount,lt.id AS ledger_transaction_id,le.account_id,le.signed_amount_minor::text AS posting FROM transfers t LEFT JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id LEFT JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.owner_id=$1 AND t.id=ANY($2::uuid[]) ORDER BY t.id,le.account_id",[ownerId,acceptedIds]);
   assert.equal(transferRows.length,200,'exactly two ledger postings per transfer');
   const rowsByTransfer=new Map<string,typeof transferRows>();
   for(const row of transferRows){const list=rowsByTransfer.get(row.id)??[];list.push(row);rowsByTransfer.set(row.id,list);}
   assert.equal(rowsByTransfer.size,100);
   let acceptedTotal=0n;let sourcePosted=0n;let destinationPosted=0n;let globalNet=0n;
   for(const [id,entries] of rowsByTransfer){
     assert.equal(entries.length,2,`transfer ${id} must have exactly two postings`);
     assert.ok(entries.every((entry:{status:string})=>entry.status==='completed'));
     const amount=BigInt(entries[0].amount);assert.equal(amount,expectedAmountById.get(id),`requested amount for ${id}`);acceptedTotal+=amount;
     const sourcePosting=entries.find((entry:{account_id:string})=>entry.account_id===sourceId);
     const destinationPosting=entries.find((entry:{account_id:string})=>entry.account_id===destinationId);
     assert.ok(sourcePosting&&destinationPosting,`transfer ${id} must post to source and destination`);
     const sourceAmount=BigInt(sourcePosting.posting);const destinationAmount=BigInt(destinationPosting.posting);
     assert.equal(sourceAmount,-amount,`source posting for ${id}`);assert.equal(destinationAmount,amount,`destination posting for ${id}`);
     assert.equal(sourceAmount+destinationAmount,0n,`per-transfer net for ${id}`);
     sourcePosted+=sourceAmount;destinationPosted+=destinationAmount;globalNet+=sourceAmount+destinationAmount;
   }
   assert.equal(acceptedTotal,totalMinor,'accepted transfer sum');assert.equal(sourcePosted,-totalMinor,'source ledger sum');assert.equal(destinationPosted,totalMinor,'destination ledger sum');assert.equal(globalNet,0n,'global ledger net');
   const allAfter=await source.query('SELECT id FROM transfers WHERE owner_id=$1',[ownerId]);
   const newIds=allAfter.map((row:{id:string})=>row.id).filter((id:string)=>!beforeIds.has(id));
   assert.equal(newIds.length,100,'no extra transfer rows');assert.deepEqual(new Set(newIds),new Set(acceptedIds));
   process.env.OTP_THRESHOLD_MINOR='500000';process.env.DAILY_TRANSFER_LIMIT_MINOR='2000000';

  // F-01: a real PostgreSQL outage (not an API process restart) must surface as a recoverable HTTP error with
  // no financial side effects, and a retry with the identical Idempotency-Key + payload must then complete the
  // same attempt exactly once once the connection is restored, without duplicating postings.
  const outageSibling=new Client({connectionString:testUrl.toString()});await outageSibling.connect();
  try {
    const idleBefore=await outageSibling.query("SELECT pid FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND pid<>pg_backend_pid() AND state='idle'");
    assert.ok(idleBefore.rows.length>=1,'test setup requires at least one idle runtime connection in the API pool to target');
    const outageKey=key();const outageBody=request('2');
    const outageFinancialBefore=await financialSnapshot();
    const outagePromise=post(outageBody,outageKey);
    let terminatedCount=0;
    for(let attempt=0;attempt<200&&terminatedCount===0;attempt++){
      const active=await outageSibling.query("SELECT pid FROM pg_stat_activity WHERE usename=current_user AND datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle'");
      if(active.rows.length>0){const terminated=await outageSibling.query('SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity WHERE pid=ANY($1::int[])',[active.rows.map((row:{pid:number})=>row.pid)]);terminatedCount=terminated.rows.length;}
    }
    assert.ok(terminatedCount>=1,'outage simulation must terminate the backend serving the in-flight transfer request');
    const outageResponse=await outagePromise;
    assert.ok(outageResponse.status>=500&&outageResponse.status<600,`DB outage must surface as a recoverable server error, got ${outageResponse.status}`);
    assert.equal(outageResponse.headers.get('content-type')?.split(';')[0],'application/problem+json');
    const outageProblem=await outageResponse.json() as {status:number;title:string};
    assert.equal(outageProblem.status,outageResponse.status);
    assert.deepEqual(await financialSnapshot(),outageFinancialBefore,'a DB outage mid-request must not change owner balances, completed transfers, or ledger postings');
    const retryResponse=await post(outageBody,outageKey);
    assert.equal(retryResponse.status,201,'retry with identical Idempotency-Key and payload must complete after the connection is restored');
    const retryDto=await retryResponse.json() as {id:string;status:string};
    assert.equal(retryDto.status,'completed');
    const retryRows=await source.query('SELECT id FROM transfers WHERE id=$1 AND owner_id=$2',[retryDto.id,ownerId]);
    assert.equal(retryRows.length,1,'retry after outage must have exactly one committed transfer row');
    const retryIdempotencyRecords=await source.query("SELECT count(*)::int AS count FROM idempotency_records WHERE user_id=$1 AND operation='create-transfer' AND transfer_id=$2",[ownerId,retryDto.id]);
    assert.equal(retryIdempotencyRecords[0].count,1,'retry after outage must preserve exactly one idempotency result for this attempt');
    const retryPostings=await source.query("SELECT le.account_id,le.signed_amount_minor::text AS amount FROM transfers t JOIN ledger_transactions lt ON lt.reference_type='transfer' AND lt.reference_id=t.id JOIN ledger_entries le ON le.ledger_transaction_id=lt.id WHERE t.id=$1",[retryDto.id]);
    assert.equal(retryPostings.length,2,'retry after outage must post exactly two ledger entries for the recovered attempt, not duplicated');
    assert.equal(retryPostings.reduce((sum:bigint,row:{amount:string})=>sum+BigInt(row.amount),0n),0n,'retry after outage postings must balance to zero');
    const secondRetryResponse=await post(outageBody,outageKey);
    assert.equal(secondRetryResponse.status,201);
    assert.equal((await secondRetryResponse.json() as {id:string}).id,retryDto.id,'a further replay of the same key must keep returning the single recovered transfer');
  } finally { await outageSibling.end(); }
});
