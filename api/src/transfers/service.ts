import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import { hashSecret, decryptClabe, encryptOtpDemoCode, decryptOtpDemoCode } from '../security/crypto.js';
import { idempotencyRetentionDays } from '../config.js';
import { TransferFault, conflictFault, parseAttemptHeaders, rejectedFault, voidedFault } from './faults.js';

export { TransferFault } from './faults.js';
const digest=(value:string)=>createHmac('sha256',process.env.REFRESH_TOKEN_PEPPER??'').update(value).digest('hex');
const configured=(name:string)=>{const value=process.env[name];if(!value)throw new Error(`${name} required`);return value;};
const positiveBigint=(value:unknown)=>{if(typeof value!=='string'||! /^[1-9][0-9]*$/.test(value)||BigInt(value)>9223372036854775807n)throw new TransferFault(400,'Bad Request','Datos de transferencia inválidos.');return BigInt(value);};
const iso=(value:unknown)=>value instanceof Date?value.toISOString():new Date(String(value)).toISOString();
export type Run=(sql:string,parameters:unknown[])=>Promise<unknown>;

/**
 * F-10: deterministically closes OTP-pending attempts whose challenge already expired (status `expired`,
 * `closed_at` set, audit event). It never touches balances, ledger or daily usage. Rows locked by an
 * in-flight confirm/cancel are skipped (that transaction decides their fate), so concurrent sweeps never deadlock.
 */
export async function expireDue(run:Run,userId:string,transferId:string|null,requestId:string){
  await run(`WITH due AS (SELECT t.id FROM transfers t JOIN otp_challenges o ON o.transfer_id=t.id
      WHERE t.owner_id=$1::uuid AND t.status='awaiting_confirmation' AND o.consumed_at IS NULL AND o.expires_at<=now()
        AND ($2::uuid IS NULL OR t.id=$2::uuid) ORDER BY t.id FOR UPDATE OF t SKIP LOCKED),
    closed AS (UPDATE transfers t SET status='expired',closed_at=now() FROM due WHERE t.id=due.id AND t.status='awaiting_confirmation' RETURNING t.id)
    INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata)
    SELECT $1::uuid,'transfer.expired','transfer',closed.id,$3::varchar,'{}'::jsonb FROM closed`,[userId,transferId,requestId]);
}

export type TransferRequest={sourceAccountId:string;destinationType:'beneficiary'|'own_account';beneficiaryId?:string;destinationAccountId?:string;amountMinor:string;concept:string;reference:string};
/** Raw round-8 headers as received (`Transfer-Attempt-Id`, `Transfer-Send-Epoch`); both or none. */
export type RawAttemptHeaders={attemptId?:string|undefined;epoch?:string|undefined};

/** Lazily creates the user's send gate (epoch 0) in its own statement, so concurrent first sends never queue behind one transaction. */
export async function ensureSendGate(db:DataSource,userId:string){await db.query('INSERT INTO transfer_send_gates(owner_id) VALUES($1::uuid) ON CONFLICT DO NOTHING',[userId]);}
/** Serializes every operation on one idempotency key of one user (round 8, B7). */
export async function lockAttemptKey(r:QueryRunner,userId:string,keyHash:string){await r.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0))",[userId,keyHash]);}

/**
 * Round-8 order (one transaction): headers validated; gate FOR SHARE (every creation, with or without headers);
 * advisory lock per key; idempotent replay (an executed result is never hidden, whatever the epoch); closures
 * (voided → 409 voided, rejected → same rejection); epoch/identity checks (headers only); SAVEPOINT + current logic.
 * With headers, a 404/422/429 business rejection becomes a persisted `rejected` closure (terminal for that identity).
 */
export async function createTransfer(db:DataSource,userId:string,key:string,body:TransferRequest,requestId:string,rawAttempt:RawAttemptHeaders={}){
  if(key.length<16||key.length>128)throw new TransferFault(400,'Bad Request','Idempotency-Key inválida.');
  const amount=positiveBigint(body.amountMinor);
  if(!body.sourceAccountId||!body.concept?.trim()||body.concept.trim().length>40||!/^\d{1,7}$/.test(body.reference))throw new TransferFault(400,'Bad Request','Datos de transferencia inválidos.');
  const attempt=parseAttemptHeaders(rawAttempt.attemptId,rawAttempt.epoch);
  const retentionDays=idempotencyRetentionDays();
  const payload=JSON.stringify({...body,amountMinor:amount.toString()}); const payloadHash=digest(payload); const keyHash=hashSecret(key);
  await expireDue((sql,parameters)=>db.query(sql,parameters),userId,null,requestId);
  await ensureSendGate(db,userId);
  const runner=db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try {
    const gate=await runner.query('SELECT epoch::text AS epoch FROM transfer_send_gates WHERE owner_id=$1 FOR SHARE',[userId]);
    await lockAttemptKey(runner,userId,keyHash);
    const old=await runner.query("SELECT payload_hash,response_status,response_snapshot,transfer_id FROM idempotency_records WHERE user_id=$1 AND operation='create-transfer' AND key_hash=$2 FOR UPDATE",[userId,keyHash]);
    if(old[0]){if(old[0].payload_hash!==payloadHash)throw new TransferFault(409,'Conflict','La llave de idempotencia ya fue usada con otros datos.');
      if(attempt){const bound=await runner.query('SELECT client_attempt_id FROM transfers WHERE id=$1',[old[0].transfer_id]);if(bound[0]?.client_attempt_id&&bound[0].client_attempt_id!==attempt.attemptId)throw conflictFault();}
      let response=old[0].response_snapshot as Record<string,unknown>;let replayStatus=Number(old[0].response_status);
      // A replayed OTP-pending attempt reports its current state (it may since have been confirmed, cancelled or expired).
      if(response.status==='awaiting_confirmation'){response=await dto(runner,String(old[0].transfer_id),userId);if(response.status!=='awaiting_confirmation')replayStatus=200;}
      if(response.status==='awaiting_confirmation'&&process.env.APP_ENV==='development'){const otp=await runner.query('SELECT demo_code_ciphertext FROM otp_challenges WHERE transfer_id=$1',[old[0].transfer_id]);if(otp[0]?.demo_code_ciphertext)response.demoOnlyCode=decryptOtpDemoCode(String(otp[0].demo_code_ciphertext));}await runner.commitTransaction();return {status:replayStatus,body:response};}
    const closures=await runner.query('SELECT key_hash=$2 AS by_key,client_attempt_id,status,payload_hash,problem_status,problem_detail FROM transfer_attempt_closures WHERE owner_id=$1 AND (key_hash=$2 OR ($3::uuid IS NOT NULL AND client_attempt_id=$3::uuid))',[userId,keyHash,attempt?.attemptId??null]) as ClosureMatch[];
    if(closures.some((c)=>c.status==='voided'))throw voidedFault();
    const byKey=closures.find((c)=>c.by_key);
    if(closures.some((c)=>!c.by_key))throw conflictFault();
    if(byKey){
      if(byKey.payload_hash!==payloadHash)throw new TransferFault(409,'Conflict','La llave de idempotencia ya fue usada con otros datos.');
      if(attempt&&byKey.client_attempt_id&&byKey.client_attempt_id!==attempt.attemptId)throw conflictFault();
      throw rejectedFault(Number(byKey.problem_status),String(byKey.problem_detail));
    }
    if(attempt){
      const current=BigInt(String(gate[0].epoch));
      if(attempt.epoch<current)throw voidedFault();
      if(attempt.epoch>current)throw new TransferFault(400,'Bad Request','Transfer-Send-Epoch inválida.');
      const used=await runner.query('SELECT 1 FROM transfers WHERE owner_id=$1 AND client_attempt_id=$2',[userId,attempt.attemptId]);
      if(used[0])throw conflictFault();
    }
    await runner.query('SAVEPOINT create_transfer');
    try {
      const result=await executeTransfer(runner,userId,keyHash,body,amount,payloadHash,requestId,attempt?.attemptId??null,retentionDays);
      await runner.commitTransaction();return result;
    } catch(error) {
      if(!attempt||!(error instanceof TransferFault)||![404,422,429].includes(error.status))throw error;
      await runner.query('ROLLBACK TO SAVEPOINT create_transfer');
      const closed=await runner.query("INSERT INTO transfer_attempt_closures(owner_id,key_hash,client_attempt_id,status,payload_hash,amount_minor,problem_status,problem_detail,request_id) VALUES($1,$2,$3,'rejected',$4,$5::bigint,$6,$7,$8) RETURNING id",[userId,keyHash,attempt.attemptId,payloadHash,amount.toString(),error.status,error.message,requestId]);
      await runner.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1::uuid,'transfer.attempt_rejected','transfer_attempt',$2::uuid,$3::varchar,jsonb_build_object('status',$4::int))",[userId,closed[0].id,requestId,error.status]);
      await runner.commitTransaction();
      throw rejectedFault(error.status,error.message);
    }
  }catch(error){if(runner.isTransactionActive)await runner.rollbackTransaction();throw error;}finally{await runner.release();}
}
type ClosureMatch={by_key:boolean;client_attempt_id:string|null;status:'voided'|'rejected';payload_hash:string|null;problem_status:number|null;problem_detail:string|null};

/** Current (pre-round-8) creation logic, unchanged except that the transfer row carries `client_attempt_id` and the retention date is configured. */
async function executeTransfer(runner:QueryRunner,userId:string,keyHash:string,body:TransferRequest,amount:bigint,payloadHash:string,requestId:string,attemptId:string|null,retentionDays:number){
    let destinationId:string;let beneficiary:Record<string,unknown>|null=null;
    if(body.destinationType==='beneficiary') { if(!body.beneficiaryId)throw new TransferFault(400,'Bad Request','Beneficiario inválido.'); const rows=await runner.query('SELECT id,name,alias,destination_account_id,clabe_ciphertext FROM beneficiaries WHERE id=$1 AND owner_id=$2',[body.beneficiaryId,userId]);if(!rows[0])throw new TransferFault(404,'Not Found','Beneficiario no encontrado.');beneficiary=rows[0] as Record<string,unknown>;destinationId=String(beneficiary.destination_account_id); }
    else if(body.destinationType==='own_account'&&body.destinationAccountId)destinationId=body.destinationAccountId;
    else throw new TransferFault(400,'Bad Request','Destino inválido.');
    if(destinationId===body.sourceAccountId)throw new TransferFault(422,'Unprocessable Entity','El origen y destino deben ser distintos.');
    const ids=[body.sourceAccountId,destinationId].sort();
    const accounts=await runner.query('SELECT id,owner_id,kind,balance_minor::text AS balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
    const source=accounts.find((a:Record<string,string>)=>a.id===body.sourceAccountId);const dest=accounts.find((a:Record<string,string>)=>a.id===destinationId);
    if(!source||source.owner_id!==userId||!dest||(body.destinationType==='own_account'?dest.owner_id!==userId:dest.kind==='clearing'))throw new TransferFault(404,'Not Found','Cuenta o destino no encontrado.');
    const transferId=randomUUID();const now=await runner.query("SELECT (now() AT TIME ZONE $1)::date::text AS business_date",[configured('BUSINESS_TIME_ZONE')]);const day=String(now[0].business_date);
    const limit=BigInt(configured('DAILY_TRANSFER_LIMIT_MINOR'));const threshold=BigInt(configured('OTP_THRESHOLD_MINOR'));
    const requiresOtp=amount>=threshold;
    if(!requiresOtp){await runner.query('INSERT INTO daily_limit_usage(owner_id,business_date,outgoing_minor) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[userId,day]);await runner.query('SELECT 1 FROM daily_limit_usage WHERE owner_id=$1 AND business_date=$2 FOR UPDATE',[userId,day]);const used=await runner.query('SELECT outgoing_minor::text AS used FROM daily_limit_usage WHERE owner_id=$1 AND business_date=$2',[userId,day]);if(BigInt(used[0].used)+amount>limit)throw new TransferFault(429,'Too Many Requests','Se excedió el límite diario.');}
    const status=requiresOtp?'awaiting_confirmation':'completed';await runner.query('INSERT INTO transfers(id,owner_id,source_account_id,destination_account_id,beneficiary_id,amount_minor,concept,reference,status,completed_at,receipt_reference,request_id,client_attempt_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7::varchar,$8::varchar,$9::varchar,CASE WHEN $9::varchar=\'completed\' THEN now() END,CASE WHEN $9::varchar=\'completed\' THEN $11::text END,$10::varchar,$12::uuid) RETURNING created_at',[transferId,userId,body.sourceAccountId,destinationId,body.beneficiaryId??null,amount.toString(),body.concept.trim(),body.reference,status,requestId,transferId,attemptId]);
    let demoCode:string|undefined;
     if(requiresOtp){demoCode=String(randomInt(0,1000000)).padStart(6,'0');await runner.query('INSERT INTO otp_challenges(transfer_id,code_hash,demo_code_ciphertext,expires_at,max_attempts) VALUES($1,$2,$3,now()+($4::text||\' seconds\')::interval,$5)',[transferId,hashSecret(`${transferId}:${demoCode}`),process.env.APP_ENV==='development'?encryptOtpDemoCode(demoCode):null,configured('OTP_EXPIRY_SECONDS'),configured('OTP_MAX_ATTEMPTS')]);}
    else {if(BigInt(source.balance)<amount)throw new TransferFault(422,'Unprocessable Entity','Saldo insuficiente.');await applyLedger(runner,transferId,userId,body.sourceAccountId,destinationId,amount);await runner.query('INSERT INTO daily_limit_usage(owner_id,business_date,outgoing_minor) VALUES($1,$2,$3) ON CONFLICT(owner_id,business_date,currency) DO UPDATE SET outgoing_minor=daily_limit_usage.outgoing_minor+EXCLUDED.outgoing_minor',[userId,day,amount.toString()]);}
    await runner.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1::uuid,'transfer.created','transfer',$2::uuid,$3::varchar,jsonb_build_object('status',$4::text,'amountMinor',$5::text))",[userId,transferId,requestId,status,amount.toString()]);
     const response:Record<string,unknown>=await dto(runner,transferId,userId);if(demoCode&&process.env.APP_ENV==='development')response.demoOnlyCode=demoCode;
     const snapshot={...response};delete snapshot.demoOnlyCode;
     await runner.query("INSERT INTO idempotency_records(user_id,operation,key_hash,payload_hash,transfer_id,response_status,response_snapshot,expires_at) VALUES($1,'create-transfer',$2,$3,$4,$5,$6,now()+make_interval(days=>$7::int))",[userId,keyHash,payloadHash,transferId,requiresOtp?202:201,JSON.stringify(snapshot),retentionDays]);
    return {status:requiresOtp?202:201,body:response};
}
async function applyLedger(r:QueryRunner,id:string,user:string,source:string,dest:string,amount:bigint){
  await r.query('UPDATE accounts SET balance_minor=balance_minor-$1 WHERE id=$2 AND owner_id=$3 AND balance_minor >= $1',[amount.toString(),source,user]);
  await r.query('UPDATE accounts SET balance_minor=balance_minor+$1 WHERE id=$2',[amount.toString(),dest]);
  const tx=await r.query("INSERT INTO ledger_transactions(reference_type,reference_id) VALUES('transfer',$1) RETURNING id",[id]);
  await r.query("INSERT INTO ledger_entries(ledger_transaction_id,account_id,signed_amount_minor,entry_type) VALUES($1,$2,$3,'debit'),($1,$4,$5,'credit')",[tx[0].id,source,(-amount).toString(),dest,amount.toString()]);
}
async function dto(r:QueryRunner,id:string,user:string){const rows=await r.query('SELECT t.*,t.amount_minor::text AS amount,sa.name AS source_name,sa.kind AS source_kind,sa.balance_minor::text AS source_balance,sa.clabe_ciphertext AS source_clabe,da.name AS dest_name,da.kind AS dest_kind,da.balance_minor::text AS dest_balance,da.clabe_ciphertext AS dest_clabe,b.id AS b_id,b.name AS b_name,b.alias AS b_alias,b.clabe_ciphertext AS b_clabe,da.owner_id AS dest_owner,o.expires_at AS otp_expires_at FROM transfers t JOIN accounts sa ON sa.id=t.source_account_id JOIN accounts da ON da.id=t.destination_account_id LEFT JOIN beneficiaries b ON b.id=t.beneficiary_id AND b.owner_id=t.owner_id LEFT JOIN otp_challenges o ON o.transfer_id=t.id WHERE t.id=$1 AND t.owner_id=$2',[id,user]);if(!rows[0])throw new TransferFault(404,'Not Found','Transferencia no encontrada.');const x=rows[0];const masked=(value:string)=>{const c=decryptClabe(value);return `${c.slice(0,3)}•••••••••••${c.slice(-4)}`;};
  return {id:x.id,status:x.status,sourceAccountId:x.source_account_id,destination:x.b_id?{id:x.b_id,name:x.b_name,alias:x.b_alias,destinationAccountId:x.destination_account_id,...(x.dest_owner===x.owner_id?{ownAccountId:x.destination_account_id}:{}),clabeMasked:masked(x.b_clabe)}:{id:x.destination_account_id,name:x.dest_name,kind:x.dest_kind,currency:'MXN',availableBalanceMinor:x.dest_balance,clabe:decryptClabe(x.dest_clabe),clabeMasked:masked(x.dest_clabe)},amountMinor:x.amount,currency:'MXN',concept:x.concept,reference:x.reference,createdAt:iso(x.created_at),completedAt:x.completed_at?iso(x.completed_at):null,expiresAt:x.otp_expires_at?iso(x.otp_expires_at):null,receiptReference:x.receipt_reference,requestId:x.request_id};}
export async function getTransfer(db:DataSource,user:string,id:string,requestId:string){const r=db.createQueryRunner();await r.connect();try{await expireDue((sql,parameters)=>r.query(sql,parameters),user,id,requestId);return await dto(r,id,user);}finally{await r.release();}}
export async function confirmTransfer(db:DataSource,user:string,id:string,key:string,code:string,requestId:string){
  if(key.length<16||key.length>128||!/^\d{6}$/.test(code))throw new TransferFault(400,'Bad Request','Datos de confirmación inválidos.');const retentionDays=idempotencyRetentionDays();const r=db.createQueryRunner();await r.connect();await r.startTransaction();
  try{const payloadHash=digest(JSON.stringify({transferId:id,code}));const old=await r.query("SELECT payload_hash,response_status,response_snapshot FROM idempotency_records WHERE user_id=$1 AND operation='confirm-transfer' AND key_hash=$2 FOR UPDATE",[user,hashSecret(key)]);if(old[0]){if(old[0].payload_hash!==payloadHash)throw new TransferFault(409,'Conflict','La llave de idempotencia ya fue usada con otros datos.');await r.commitTransaction();return replayConfirm(Number(old[0].response_status),old[0].response_snapshot as Record<string,unknown>);}
    const recordFailure=async(status:number,title:string,detail:string)=>{await r.query("INSERT INTO idempotency_records(user_id,operation,key_hash,payload_hash,transfer_id,response_status,response_snapshot,expires_at) VALUES($1,'confirm-transfer',$2,$3,$4,$5,$6,now()+make_interval(days=>$7::int))",[user,hashSecret(key),payloadHash,id,status,JSON.stringify({problem:{title,detail}}),retentionDays]);return new TransferFault(status,title,detail);};
    const rows=await r.query('SELECT t.*,o.code_hash,o.expires_at,(o.expires_at<=now()) AS otp_expired,o.attempt_count,o.max_attempts,o.consumed_at FROM transfers t JOIN otp_challenges o ON o.transfer_id=t.id WHERE t.id=$1 AND t.owner_id=$2 FOR UPDATE OF t,o',[id,user]);if(!rows[0])throw new TransferFault(404,'Not Found','Transferencia no encontrada.');const x=rows[0];if(x.status!=='awaiting_confirmation'||x.consumed_at)throw new TransferFault(409,'Conflict','La transferencia ya no puede confirmarse.');if(x.otp_expired){await r.query("UPDATE transfers SET status='expired',closed_at=now() WHERE id=$1",[id]);await r.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,'transfer.expired','transfer',$2,$3,'{}')",[user,id,requestId]);const fault=await recordFailure(422,'Unprocessable Entity','El código expiró.');await r.commitTransaction();throw fault;}if(Number(x.attempt_count)>=Number(x.max_attempts))throw new TransferFault(429,'Too Many Requests','Se agotaron los intentos.');if(hashSecret(`${id}:${code}`)!==x.code_hash){const n=Number(x.attempt_count)+1;await r.query('UPDATE otp_challenges SET attempt_count=$1 WHERE transfer_id=$2',[n,id]);const exhausted=n>=Number(x.max_attempts);const fault=await recordFailure(exhausted?429:422,exhausted?'Too Many Requests':'Unprocessable Entity',exhausted?'Se agotaron los intentos.':'Código incorrecto.');await r.commitTransaction();throw fault;}
    const ids=[String(x.source_account_id),String(x.destination_account_id)].sort();const accounts=await r.query('SELECT id,owner_id,balance_minor::text AS balance FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);const src=accounts.find((a:Record<string,string>)=>a.id===x.source_account_id);if(!src||BigInt(src.balance)<BigInt(x.amount_minor))throw new TransferFault(422,'Unprocessable Entity','Saldo insuficiente.');const day=await r.query("SELECT (now() AT TIME ZONE $1)::date::text AS d",[configured('BUSINESS_TIME_ZONE')]);await r.query('INSERT INTO daily_limit_usage(owner_id,business_date,outgoing_minor) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[user,day[0].d]);await r.query('SELECT 1 FROM daily_limit_usage WHERE owner_id=$1 AND business_date=$2 FOR UPDATE',[user,day[0].d]);const used=await r.query('SELECT outgoing_minor::text AS n FROM daily_limit_usage WHERE owner_id=$1 AND business_date=$2',[user,day[0].d]);const amount=BigInt(x.amount_minor);if(BigInt(used[0].n)+amount>BigInt(configured('DAILY_TRANSFER_LIMIT_MINOR')))throw new TransferFault(429,'Too Many Requests','Se excedió el límite diario.');
    await applyLedger(r,id,user,String(x.source_account_id),String(x.destination_account_id),amount);await r.query('UPDATE daily_limit_usage SET outgoing_minor=outgoing_minor+$1 WHERE owner_id=$2 AND business_date=$3',[amount.toString(),user,day[0].d]);await r.query("UPDATE transfers SET status='completed',completed_at=now(),receipt_reference=id::text WHERE id=$1",[id]);await r.query('UPDATE otp_challenges SET consumed_at=now() WHERE transfer_id=$1',[id]);await r.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,'transfer.confirmed','transfer',$2,$3,'{}')",[user,id,requestId]);const result=await dto(r,id,user);await r.query("INSERT INTO idempotency_records(user_id,operation,key_hash,payload_hash,transfer_id,response_status,response_snapshot,expires_at) VALUES($1,'confirm-transfer',$2,$3,$4,200,$5,now()+make_interval(days=>$6::int))",[user,hashSecret(key),payloadHash,id,JSON.stringify(result),retentionDays]);await r.commitTransaction();return result;
  }catch(e){if(r.isTransactionActive)await r.rollbackTransaction();throw e;}finally{await r.release();}}

/** Replays a stored confirm outcome: the original 200 body, or the original problem (never an empty 200). */
function replayConfirm(status:number,snapshot:Record<string,unknown>){
  if(status===200)return snapshot;
  const problem=snapshot.problem as {title?:unknown;detail?:unknown}|undefined;
  throw new TransferFault(status,typeof problem?.title==='string'?problem.title:status===429?'Too Many Requests':'Unprocessable Entity',typeof problem?.detail==='string'?problem.detail:status===429?'Se agotaron los intentos.':'Código incorrecto.');
}

/**
 * F-10: explicit, idempotent abandonment of an own OTP-pending attempt. Never moves money. Repeating it on an
 * already cancelled/expired attempt returns that terminal state; completed attempts cannot be cancelled (409).
 */
export async function cancelTransfer(db:DataSource,user:string,id:string,requestId:string){
  const r=db.createQueryRunner();await r.connect();await r.startTransaction();
  try{
    const rows=await r.query('SELECT t.status,(o.expires_at IS NOT NULL AND o.expires_at<=now()) AS otp_expired FROM transfers t LEFT JOIN otp_challenges o ON o.transfer_id=t.id WHERE t.id=$1 AND t.owner_id=$2 FOR UPDATE OF t',[id,user]);
    if(!rows[0])throw new TransferFault(404,'Not Found','Transferencia no encontrada.');
    const x=rows[0] as {status:string;otp_expired:boolean};
    if(x.status==='awaiting_confirmation'){
      const next=x.otp_expired?'expired':'cancelled';
      await r.query('UPDATE transfers SET status=$2,closed_at=now() WHERE id=$1',[id,next]);
      await r.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,$2,'transfer',$3,$4,'{}')",[user,`transfer.${next}`,id,requestId]);
    } else if(x.status!=='cancelled'&&x.status!=='expired')throw new TransferFault(409,'Conflict','La transferencia ya no puede cancelarse.');
    const result=await dto(r,id,user);await r.commitTransaction();return result;
  }catch(e){if(r.isTransactionActive)await r.rollbackTransaction();throw e;}finally{await r.release();}
}

/**
 * Transfer controls currently configured on this server for the authenticated user. Values come from
 * DAILY_TRANSFER_LIMIT_MINOR / OTP_THRESHOLD_MINOR / OTP_EXPIRY_SECONDS / OTP_MAX_ATTEMPTS; outside production they
 * are demo examples, not approved product policy (`demoOnly`). OTP is required when amountMinor >= otpThresholdMinor.
 */
export async function getTransferPolicy(db:DataSource,user:string){
  const timeZone=configured('BUSINESS_TIME_ZONE');const limit=BigInt(configured('DAILY_TRANSFER_LIMIT_MINOR'));
  const rows=await db.query("SELECT (now() AT TIME ZONE $2)::date::text AS day,COALESCE((SELECT outgoing_minor::text FROM daily_limit_usage WHERE owner_id=$1 AND business_date=(now() AT TIME ZONE $2)::date AND currency='MXN'),'0') AS used,COALESCE((SELECT epoch::text FROM transfer_send_gates WHERE owner_id=$1),'0') AS send_epoch",[user,timeZone]);
  const used=BigInt(String(rows[0].used));
  return {currency:'MXN',businessDate:String(rows[0].day),businessTimeZone:timeZone,dailyLimitMinor:limit.toString(),dailyUsedMinor:used.toString(),dailyRemainingMinor:(limit>used?limit-used:0n).toString(),otpThresholdMinor:BigInt(configured('OTP_THRESHOLD_MINOR')).toString(),otpExpirySeconds:Number(configured('OTP_EXPIRY_SECONDS')),otpMaxAttempts:Number(configured('OTP_MAX_ATTEMPTS')),demoOnly:process.env.APP_ENV!=='production',sendEpoch:String(rows[0].send_epoch)};
}
