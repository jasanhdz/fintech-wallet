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

test('internal beneficiaries validate, resolve, encrypt and enforce owner isolation in PostgreSQL', async (t) => {
  const testUrl=assertSafeTestDatabase(process.env.TEST_DATABASE_URL,process.env.DATABASE_URL);
  process.env.DATABASE_URL=testUrl.toString();
  process.env.APP_ENV='test';
  process.env.WEB_ORIGIN='http://localhost:5173';
  let server:ReturnType<typeof createServer>|undefined;
  const source=dataSource(testUrl.toString()); await source.initialize();
  t.after(async()=>{if(server?.listening)await new Promise<void>((resolveClose,reject)=>server!.close((error)=>error?reject(error):resolveClose()));if(source.isInitialized)await source.destroy();});
  server=createServer(createApp()); await new Promise<void>((resolveListen)=>server!.listen(0,'127.0.0.1',resolveListen));
  const address=server.address(); assert(address&&typeof address!=='string'); const base=`http://127.0.0.1:${address.port}/v1`;

  async function register(label:string) {
    const csrfResponse=await fetch(`${base}/auth/csrf`); const csrf=(await csrfResponse.json() as {csrfToken:string}).csrfToken;
    const cookie=csrfResponse.headers.getSetCookie().find((value)=>value.startsWith('wallet_csrf='))!.split(';')[0]!;
    const response=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrf,cookie,origin:'http://localhost:5173'},body:JSON.stringify({fullName:label,email:`${label}-${crypto.randomUUID()}@example.test`,password:'correct horse battery staple'})});
    assert.equal(response.status,201); return (await response.json() as {accessToken:string}).accessToken;
  }
  const ownerToken=await register('beneficiary-owner'); const destinationOwnerToken=await register('beneficiary-destination');
  const ownerId=String((await jwtVerify(ownerToken,new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))).payload.sub);
  const ownerHeaders={authorization:`Bearer ${ownerToken}`,'content-type':'application/json'};
  const destinationAccounts=await fetch(`${base}/accounts`,{headers:{authorization:`Bearer ${destinationOwnerToken}`}});
  const destination=(await destinationAccounts.json() as {items:Array<{id:string;clabe:string}>}).items[0]!;

  const unauthenticated=await fetch(`${base}/beneficiaries`); assert.equal(unauthenticated.status,401);
  const invalid=await fetch(`${base}/beneficiaries`,{method:'POST',headers:ownerHeaders,body:JSON.stringify({name:'Invalid',alias:'Invalid',clabe:'002010077777777770'})});
  assert.equal(invalid.status,422);
  const malformed=await fetch(`${base}/beneficiaries`,{method:'POST',headers:ownerHeaders,body:JSON.stringify({name:'Invalid',alias:'Invalid',clabe:'123'})}); assert.equal(malformed.status,422);
  const external=await fetch(`${base}/beneficiaries`,{method:'POST',headers:ownerHeaders,body:JSON.stringify({name:'Unknown',alias:'Unknown',clabe:'002010077777777771'})}); assert.equal(external.status,404);

  const created=await fetch(`${base}/beneficiaries`,{method:'POST',headers:ownerHeaders,body:JSON.stringify({name:'Destino de prueba',alias:'Mi alias',clabe:destination.clabe})});
  assert.equal(created.status,201); const dto=await created.json() as {id:string;name:string;alias:string;clabeMasked:string;destinationAccountId:string;clabe?:string};
  assert.equal(dto.name,'Destino de prueba'); assert.equal(dto.alias,'Mi alias'); assert.equal(dto.destinationAccountId,destination.id); assert.equal('clabe' in dto,false);
  assert.equal(dto.clabeMasked,`${destination.clabe.slice(0,3)}•••••••••••${destination.clabe.slice(-4)}`); assert.equal(dto.clabeMasked.includes(destination.clabe),false);
  const stored=await source.query('SELECT owner_id,destination_account_id,clabe_ciphertext,clabe_lookup_hash FROM beneficiaries WHERE id=$1',[dto.id]);
  assert.equal(stored[0].owner_id,ownerId);
  assert.notEqual(stored[0].clabe_ciphertext,destination.clabe); assert.notEqual(stored[0].clabe_ciphertext,dto.clabeMasked);
  assert.match(stored[0].clabe_lookup_hash,/^[a-f0-9]{64}$/); assert.equal(stored[0].destination_account_id,destination.id);

  const duplicate=await fetch(`${base}/beneficiaries`,{method:'POST',headers:ownerHeaders,body:JSON.stringify({name:'Otra etiqueta',alias:'Duplicado',clabe:destination.clabe})}); assert.equal(duplicate.status,409);
  const listed=await fetch(`${base}/beneficiaries`,{headers:{authorization:`Bearer ${ownerToken}`}}); assert.equal(listed.status,200);
  const items=(await listed.json() as {items:Array<{id:string;clabeMasked:string}>}).items; assert.equal(items.length,1); assert.equal(items[0]!.id,dto.id); assert.equal(items[0]!.clabeMasked,dto.clabeMasked);
  const ownDetail=await fetch(`${base}/beneficiaries/${dto.id}`,{headers:{authorization:`Bearer ${ownerToken}`}}); assert.equal(ownDetail.status,200); assert.equal((await ownDetail.json() as {clabeMasked:string}).clabeMasked,dto.clabeMasked);
  const foreignDetail=await fetch(`${base}/beneficiaries/${dto.id}`,{headers:{authorization:`Bearer ${destinationOwnerToken}`}}); assert.equal(foreignDetail.status,404);
  const malformedId=await fetch(`${base}/beneficiaries/not-a-uuid`,{headers:{authorization:`Bearer ${ownerToken}`}}); assert.equal(malformedId.status,404);
  const destinationCannotSee=await fetch(`${base}/beneficiaries`,{headers:{authorization:`Bearer ${destinationOwnerToken}`}}); assert.deepEqual((await destinationCannotSee.json() as {items:unknown[]}).items,[]);
});
