import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({ path: resolve(process.cwd(), '..', '.env') });
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { dataSource } from '../src/db/data-source.js';
import { assertSafeTestDatabase } from '../src/db/test-database-guard.js';
import { createApp } from '../src/http/app.js';

test('PostgreSQL auth, rotation, csrf and owner-scoped accounts', async (t) => {
  const developmentUrl=process.env.DATABASE_URL; const testUrl=assertSafeTestDatabase(process.env.TEST_DATABASE_URL,developmentUrl);
  process.env.DATABASE_URL=testUrl.toString();
  process.env.APP_ENV='test';
  process.env.WEB_ORIGIN='http://localhost:5173';
  const source=dataSource(testUrl.toString()); await source.initialize();
  const server=createServer(createApp());
  await new Promise<void>((resolveListen)=>server.listen(0,'127.0.0.1',resolveListen));
  t.after(async()=>{await new Promise<void>((resolveClose,reject)=>server.close((error)=>error?reject(error):resolveClose()));await source.destroy();});
  const address=server.address(); assert(address&&typeof address!=='string'); const base=`http://127.0.0.1:${address.port}/v1`;
  const preflight=await fetch(`${base}/auth/register`,{method:'OPTIONS',headers:{origin:'http://localhost:5173','access-control-request-method':'POST','access-control-request-headers':'content-type,x-csrf-token'}});
  assert.equal(preflight.headers.get('access-control-allow-origin'),'http://localhost:5173');
  const deniedPreflight=await fetch(`${base}/auth/register`,{method:'OPTIONS',headers:{origin:'https://attacker.invalid','access-control-request-method':'POST'}});
  assert.equal(deniedPreflight.headers.get('access-control-allow-origin'),null);
  const csrfResponse=await fetch(`${base}/auth/csrf`); const csrfData=await csrfResponse.json() as {csrfToken:string}; const csrfCookie=csrfResponse.headers.getSetCookie().find((cookie)=>cookie.startsWith('wallet_csrf='))!.split(';')[0]!;
  const anonymousRefresh=await fetch(`${base}/auth/refresh`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfData.csrfToken,cookie:csrfCookie,origin:'http://localhost:5173'},body:JSON.stringify({client:'web'})}); assert.equal(anonymousRefresh.status,204); assert.equal(await anonymousRefresh.text(),'');
  const invalidMobileRefresh=await fetch(`${base}/auth/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client:'mobile',refreshToken:'invalid-refresh-token'})}); assert.equal(invalidMobileRefresh.status,401);
  const identity=`api-${crypto.randomUUID()}@example.test`;
  const register=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfData.csrfToken,cookie:csrfCookie,origin:'http://localhost:5173'},body:JSON.stringify({fullName:'Integration User',email:identity.toUpperCase(),password:'correct horse battery staple'})});
  assert.equal(register.status,201); const registered=await register.json() as {accessToken:string}; assert.equal('refreshToken' in registered,false);
  const claims=await (await import('jose')).jwtVerify(registered.accessToken,new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
  const userId=String(claims.payload.sub);
  const userRow=await source.query('SELECT email,password_hash FROM users WHERE id=$1',[userId]); assert.equal(userRow[0].email,identity); assert.notEqual(userRow[0].password_hash,'correct horse battery staple');
  const duplicate=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfData.csrfToken,cookie:csrfCookie},body:JSON.stringify({fullName:'Duplicate',email:identity,password:'correct horse battery staple'})}); assert.equal(duplicate.status,409);
  const accountsResponse=await fetch(`${base}/accounts`,{headers:{authorization:`Bearer ${registered.accessToken}`}}); assert.equal(accountsResponse.status,200); const accounts=await accountsResponse.json() as {items:Array<{id:string;availableBalanceMinor:string;clabe:string}>}; assert.equal(accounts.items.length,1); assert.equal(accounts.items[0]!.availableBalanceMinor,'0'); assert.match(accounts.items[0]!.clabe,/^\d{18}$/);
  const missing=await fetch(`${base}/accounts/${crypto.randomUUID()}`,{headers:{authorization:`Bearer ${registered.accessToken}`}}); assert.equal(missing.status,404);
  const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:identity,password:'correct horse battery staple',client:'mobile'})}); assert.equal(login.status,200); const initial=await login.json() as {accessToken:string;refreshToken:string};
  const rotatedResponse=await fetch(`${base}/auth/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client:'mobile',refreshToken:initial.refreshToken})}); assert.equal(rotatedResponse.status,200); const rotated=await rotatedResponse.json() as {refreshToken:string};
  const reuse=await fetch(`${base}/auth/refresh`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client:'mobile',refreshToken:initial.refreshToken})}); assert.equal(reuse.status,401);
  const csrfFailure=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fullName:'Other',email:`other-${crypto.randomUUID()}@example.test`,password:'correct horse battery staple'})}); assert.equal(csrfFailure.status,403);
  const originFailure=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfData.csrfToken,cookie:csrfCookie,origin:'https://attacker.invalid'},body:JSON.stringify({fullName:'Other',email:`other-${crypto.randomUUID()}@example.test`,password:'correct horse battery staple'})}); assert.equal(originFailure.status,403);
  assert.ok(rotated.refreshToken);
  const previousEnv={app:process.env.APP_ENV,fixture:process.env.DEMO_FIXTURE_ENABLED,primary:process.env.DEMO_PRIMARY_BALANCE_MINOR,savings:process.env.DEMO_SAVINGS_BALANCE_MINOR};
  process.env.APP_ENV='development';process.env.DEMO_FIXTURE_ENABLED='true';process.env.DEMO_PRIMARY_BALANCE_MINOR='12345';process.env.DEMO_SAVINGS_BALANCE_MINOR='6789';
  try {
    const fixtureResponse=await fetch(`${base}/auth/register`,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfData.csrfToken,cookie:csrfCookie},body:JSON.stringify({fullName:'Demo Fixture',email:`fixture-${crypto.randomUUID()}@example.test`,password:'correct horse battery staple'})}); assert.equal(fixtureResponse.status,201);
    const fixtureBody=await fixtureResponse.json() as {user:{id:string}}; const fixtureAccounts=await source.query('SELECT id,balance_minor::text AS balance FROM accounts WHERE owner_id=$1 ORDER BY name',[fixtureBody.user.id]); assert.equal(fixtureAccounts.length,2); assert.deepEqual(fixtureAccounts.map((account: {balance:string})=>account.balance).sort(),['12345','6789']);
    const opening=await source.query("SELECT COALESCE(sum(signed_amount_minor),0)::text AS total FROM ledger_entries WHERE ledger_transaction_id IN (SELECT DISTINCT e.ledger_transaction_id FROM ledger_entries e JOIN accounts a ON a.id=e.account_id WHERE a.owner_id=$1)",[fixtureBody.user.id]); assert.equal(opening[0].total,'0');
    const foreign=await fetch(`${base}/accounts/${fixtureAccounts[0].id}`,{headers:{authorization:`Bearer ${registered.accessToken}`}}); assert.equal(foreign.status,404);
  } finally {process.env.APP_ENV=previousEnv.app;process.env.DEMO_FIXTURE_ENABLED=previousEnv.fixture;process.env.DEMO_PRIMARY_BALANCE_MINOR=previousEnv.primary;process.env.DEMO_SAVINGS_BALANCE_MINOR=previousEnv.savings;}
  let limited=0; for(let i=0;i<12;i++){const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`missing-${i}@example.test`,password:'wrong',client:'mobile'})});if(response.status===429){limited=429;break;}} assert.equal(limited,429);
});

test('runtime role cannot mutate ledger or audit tables', async () => {
  const url=assertSafeTestDatabase(process.env.TEST_DATABASE_URL,'postgres://wallet_runtime_dev@localhost/wallet_dev'); const source=dataSource(url.toString()); await source.initialize();
  try { const rows=await source.query("SELECT has_table_privilege(current_user,'ledger_entries','UPDATE') AS ledger_update, has_table_privilege(current_user,'audit_events','DELETE') AS audit_delete"); assert.equal(rows[0].ledger_update,false); assert.equal(rows[0].audit_delete,false); }
  finally { await source.destroy(); }
});
