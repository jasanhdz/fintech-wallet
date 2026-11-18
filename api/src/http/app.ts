import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { dataSource } from '../db/data-source.js';
import { ensureDemoClearingAccount } from '../db/clearing-account.js';
import { clabeFingerprint, decryptClabe, encryptClabe, generateClabe, hashSecret } from '../security/crypto.js';
import { loginRequestSchema, registerRequestSchema } from '@fintech-wallet/shared';

const validRequestId = /^[a-zA-Z0-9._:-]{1,128}$/;
const cookieName = 'wallet_refresh';
const csrfCookie = 'wallet_csrf';
const dummyPasswordHash = hash('unusable-credential-sentinel', 12);

export function createApp() {
  const app = express();
  const production = process.env.APP_ENV === 'production';
  const webOrigin = process.env.WEB_ORIGIN ?? process.env.CORS_ORIGIN;
  const allowedOrigins = webOrigin?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use((request: Request, response: Response, next) => {
    const incoming = request.header('x-request-id');
    const requestId = incoming && validRequestId.test(incoming) ? incoming : randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.locals.requestId = requestId;
    next();
  });
  app.get('/health', (_request, response) => response.json({ status: 'ok', requestId: response.locals.requestId as string }));

  const db = dataSource();
  const api = express.Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, handler: (_req, res) => problem(res, 429, 'Too Many Requests', 'Intenta de nuevo más tarde.') });
  const jwtKey = () => new TextEncoder().encode(process.env.JWT_ACCESS_SECRET ?? '');
  const issueAccess = async (user: User) => new SignJWT({ email: user.email }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime('10m').sign(jwtKey());
  const csrfGuard = (req: Request, res: Response, next: (error?: unknown) => void) => {
    if (!csrfValid(req, webOrigin)) return problem(res, 403, 'Forbidden', 'Token CSRF u origen inválido.');
    next();
  };
  const createSession = async (runner: import('typeorm').QueryRunner, user: User, client: Client, res: Response) => {
    const refresh = randomBytes(48).toString('base64url');
    await runner.query("INSERT INTO refresh_sessions(user_id,token_hash,client,expires_at) VALUES($1,$2,$3,now()+interval '30 days')", [user.id, hashSecret(refresh), client]);
    if (client === 'web') res.cookie(cookieName, refresh, { httpOnly: true, secure: production, sameSite: 'lax', path: '/v1/auth', maxAge: 30 * 86400000 });
    return { accessToken: await issueAccess(user), ...(client === 'mobile' ? { refreshToken: refresh } : {}), tokenType: 'Bearer', expiresIn: 600, user: { id: user.id, fullName: user.full_name, email: user.email } };
  };
  const authenticate = async (req: Request, res: Response, next: (error?: unknown) => void) => {
    try { const token=req.get('authorization')?.match(/^Bearer (.+)$/)?.[1]; if (!token) return problem(res,401,'Unauthorized','Autenticación requerida.'); const {payload}=await jwtVerify(token,jwtKey()); if (!payload.sub) return problem(res,401,'Unauthorized','Sesión inválida.'); res.locals.userId=payload.sub; next(); }
    catch { problem(res,401,'Unauthorized','Sesión inválida o expirada.'); }
  };

  api.get('/auth/csrf', (_req,res) => { const token=randomBytes(32).toString('base64url'); res.cookie(csrfCookie,token,{secure:production,sameSite:'lax',path:'/',httpOnly:false}); res.json({csrfToken:token}); });
  api.post('/auth/register',limiter,csrfGuard,async(req,res,next)=>{
    const parsed=registerRequestSchema.safeParse(req.body); if(!parsed.success) return problem(res,400,'Bad Request','Datos de registro inválidos.');
    const email=parsed.data.email.trim().toLowerCase(); const passwordHash=await hash(parsed.data.password,12); const runner=db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    try {
      const inserted=await runner.query('INSERT INTO users(email,full_name,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email,full_name',[email,parsed.data.fullName.trim(),passwordHash]);
      if(!inserted[0]) { await runner.rollbackTransaction(); return problem(res,409,'Conflict','No fue posible crear la cuenta con esos datos.'); }
      const user=inserted[0] as User; const fixture=process.env.APP_ENV==='development'&&process.env.DEMO_FIXTURE_ENABLED==='true';
      const accounts=fixture?[{name:'Cuenta principal',kind:'checking',balance:BigInt(process.env.DEMO_PRIMARY_BALANCE_MINOR??'0')},{name:'Ahorro',kind:'savings',balance:BigInt(process.env.DEMO_SAVINGS_BALANCE_MINOR??'0')}]:[{name:'Cuenta principal',kind:'checking',balance:0n}];
      let clearingId:string|undefined;
      if(fixture) clearingId=await ensureDemoClearingAccount((sql,parameters)=>runner.query(sql,parameters));
      for(const account of accounts) {
        const id=randomUUID(); const clabe=generateClabe();
        await runner.query('INSERT INTO accounts(id,owner_id,name,kind,balance_minor,clabe_ciphertext,clabe_lookup_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,account.name,account.kind,account.balance.toString(),encryptClabe(clabe),clabeFingerprint(clabe)]);
        if(fixture&&account.balance!==0n) { const rows=await runner.query("INSERT INTO ledger_transactions(reference_type,reference_id) VALUES('opening',$1) RETURNING id",[id]); await runner.query("INSERT INTO ledger_entries(ledger_transaction_id,account_id,signed_amount_minor,entry_type) VALUES($1,$2,$3,'opening'),($1,$4,$5,'opening')",[rows[0].id,id,account.balance.toString(),clearingId,(-account.balance).toString()]); await runner.query('UPDATE accounts SET balance_minor=balance_minor+$1 WHERE id=$2',[(-account.balance).toString(),clearingId]); }
      }
      await runner.query("INSERT INTO audit_events(actor_id,action,resource_type,resource_id,request_id,metadata) VALUES($1,'user.registered','user',$1,$2,'{}')",[user.id,res.locals.requestId]);
      const body=await createSession(runner,user,'web',res); await runner.commitTransaction(); res.status(201).json(body);
    } catch(error) { await runner.rollbackTransaction(); if(isUnique(error)) return problem(res,409,'Conflict','No fue posible crear la cuenta con esos datos.'); next(error); } finally { await runner.release(); }
  });
  api.post('/auth/login',limiter,async(req,res,next)=>{
    const parsed=loginRequestSchema.safeParse(req.body); if(!parsed.success) return problem(res,400,'Bad Request','Credenciales inválidas.');
    if(parsed.data.client==='web'&&!csrfValid(req,webOrigin)) return problem(res,403,'Forbidden','Token CSRF u origen inválido.');
    try { const rows=await db.query('SELECT id,email,full_name,password_hash FROM users WHERE email=$1',[parsed.data.email.trim().toLowerCase()]); const user=rows[0] as User|undefined; const passwordMatches=await compare(parsed.data.password,user?.password_hash??await dummyPasswordHash); if(!user||!passwordMatches) return problem(res,401,'Unauthorized','Credenciales inválidas.'); const runner=db.createQueryRunner(); await runner.connect(); await runner.startTransaction(); try {const body=await createSession(runner,user,parsed.data.client,res); await runner.commitTransaction(); res.json(body);}catch(error){await runner.rollbackTransaction();throw error;}finally{await runner.release();} } catch(error) { next(error); }
  });
  api.post('/auth/refresh',limiter,async(req,res,next)=>{
    const client:Client=req.body?.client==='mobile'?'mobile':'web';
     if(client==='web'&&!csrfValid(req,webOrigin)) return problem(res,403,'Forbidden','Token CSRF u origen inválido.');
    const refresh=client==='mobile'?req.body?.refreshToken:req.cookies[cookieName]; if(typeof refresh!=='string') { if(client==='web'&&!req.cookies[cookieName]) return res.status(204).end(); return problem(res,401,'Unauthorized','Sesión inválida.'); }
    const runner=db.createQueryRunner(); await runner.connect(); await runner.startTransaction();
    try {
      const rows=await runner.query('SELECT s.id,s.user_id,s.client,s.rotated_at,s.revoked_at,s.expires_at,u.email,u.full_name FROM refresh_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 FOR UPDATE',[hashSecret(refresh)]); const row=rows[0] as (Record<string,unknown>&{id:string;user_id:string;client:Client;email:string;full_name:string})|undefined;
      if(!row||row.client!==client||row.revoked_at||new Date(String(row.expires_at))<=new Date()){await runner.rollbackTransaction();return problem(res,401,'Unauthorized','Sesión inválida.');}
      if(row.rotated_at){await runner.query('UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[row.user_id]);await runner.commitTransaction();return problem(res,401,'Unauthorized','Sesión revocada.');}
      await runner.query('UPDATE refresh_sessions SET rotated_at=now() WHERE id=$1',[row.id]); const body=await createSession(runner,{id:row.user_id,email:row.email,full_name:row.full_name},client,res); await runner.commitTransaction(); res.json(body);
    }catch(error){await runner.rollbackTransaction();next(error);}finally{await runner.release();}
  });
  api.use(authenticate);
   api.post('/auth/logout',async(req,res,next)=>{try{if(req.body?.client!=='mobile'&&!csrfValid(req,webOrigin))return problem(res,403,'Forbidden','Token CSRF u origen inválido.');const refresh=req.body?.refreshToken??req.cookies[cookieName];if(refresh)await db.query('UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL',[res.locals.userId,hashSecret(refresh)]);res.clearCookie(cookieName,{httpOnly:true,secure:production,sameSite:'lax',path:'/v1/auth'});res.status(204).end();}catch(error){next(error);}});
  api.get('/auth/me',async(_req,res,next)=>{try{const rows=await db.query('SELECT id,email,full_name AS "fullName" FROM users WHERE id=$1',[res.locals.userId]);if(!rows[0])return problem(res,401,'Unauthorized','Sesión inválida.');res.json(rows[0]);}catch(error){next(error);}});
  api.get('/accounts',async(_req,res,next)=>{try{const rows=await db.query("SELECT id,name,kind,currency,balance_minor::text AS balance,clabe_ciphertext FROM accounts WHERE owner_id=$1 ORDER BY created_at,id",[res.locals.userId]);res.json({items:rows.map((a:Record<string,string>)=>accountDto(a))});}catch(error){next(error);}});
  api.get('/accounts/:accountId',async(req,res,next)=>{try{const rows=await db.query("SELECT id,name,kind,currency,balance_minor::text AS balance,clabe_ciphertext FROM accounts WHERE id=$1 AND owner_id=$2",[req.params.accountId,res.locals.userId]);if(!rows[0])return problem(res,404,'Not Found','Cuenta no encontrada.');res.json(accountDto(rows[0] as Record<string,string>));}catch(error){next(error);}});
  app.use('/v1',api);
  app.use((_request,response)=>problem(response,404,'Not Found','Recurso no encontrado.'));
  const errorHandler: ErrorRequestHandler = (error,_request,response,next)=>{void next;const code=typeof error==='object'&&error!==null&&'code'in error?String((error as {code:unknown}).code):typeof error==='object'&&error!==null&&'name'in error?String((error as {name:unknown}).name):'internal';console.error(JSON.stringify({event:'request.failed',requestId:response.locals.requestId,code}));problem(response,500,'Internal Server Error','Ocurrió un error interno.');};
  app.use(errorHandler);
  return app;
}

type Client='web'|'mobile';
type User={id:string;email:string;full_name:string;password_hash?:string};
function problem(response:Response,status:number,title:string,detail:string){return response.status(status).type('application/problem+json').json({type:'about:blank',title,status,detail,instance:response.req.originalUrl,requestId:response.locals.requestId as string});}
function originAllowed(origin:string,request:Request,allowlist:string|undefined){if(allowlist)return allowlist.split(',').map((item)=>item.trim()).includes(origin);try{return new URL(origin).hostname===new URL(`http://${request.get('host')}`).hostname;}catch{return false;}}
function csrfValid(request:Request,allowlist:string|undefined){const origin=request.get('origin');if(origin&&!originAllowed(origin,request,allowlist))return false;const token=request.get('x-csrf-token');const cookie=request.cookies[csrfCookie];return !!token&&!!cookie&&token.length===cookie.length&&timingSafeEqual(Buffer.from(token),Buffer.from(cookie));}
function isUnique(error:unknown){return typeof error==='object'&&error!==null&&'code'in error&&(error as {code:string}).code==='23505';}
function accountDto(a:Record<string,string>){const clabe=decryptClabe(a.clabe_ciphertext!);return{id:a.id,name:a.name,kind:a.kind,currency:a.currency,availableBalanceMinor:a.balance,clabe,clabeMasked:`${clabe.slice(0,3)}•••••••••••${clabe.slice(-4)}`};}
