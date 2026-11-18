// H6 F-32 probe: starts ONE API process with the evaluator's start-api.sh (wallet_test only; it execs node, so the
// child PID is the API PID) with IDEMPOTENCY_RECORD_RETENTION_DAYS as given (UNSET removes it), then:
//  - if the process exited: reports its exit code, the api.config_invalid line and a refused GET /v1/transfer-policy;
//  - if it listens: registers a throw-away user on wallet_test and reports GET /v1/transfer-policy (authenticated).
// Prints no environment values, tokens, OTPs or CLABEs. Kills only its own child PID.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const [port, retention] = process.argv.slice(2);
const origin = `http://localhost:${Number(port) + 5000}`;
const startApi = '/Users/jasanhernandez/Develop/fintech-wallet-g1/docs/evidence/round8/eval-8da2700/tools/start-api.sh';
const child = spawn('/bin/zsh', [startApi, port], { env: { ...process.env, IDEMPOTENCY_RECORD_RETENTION_DAYS: retention, WEB_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { out += c; });
for (let i = 0; i < 60 && child.exitCode === null && !/api\.listening/.test(out); i += 1) await new Promise((r) => setTimeout(r, 250));
const API = `http://127.0.0.1:${port}/v1`;
const result = { port: Number(port), retention, pid: child.pid, exitedBeforeListening: child.exitCode !== null, exitCode: child.exitCode, listening: /api\.listening/.test(out) };
if (result.listening) {
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrf.json();
  const reg = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin, cookie }, body: JSON.stringify({ fullName: 'H6 probe', email: `h6.${Date.now().toString(36)}@example.test`, password: 'H6-' + randomUUID() }) });
  result.register = reg.status;
  const token = reg.ok ? (await reg.json()).accessToken : '';
  const policy = await fetch(`${API}/transfer-policy`, { headers: { authorization: `Bearer ${token}` } });
  result.getTransferPolicyAuthenticated = policy.status;
} else {
  try { const r = await fetch(`${API}/transfer-policy`); result.getTransferPolicy = `HTTP ${r.status}`; } catch (e) { result.getTransferPolicy = `no response (${e.cause?.code ?? e.message})`; }
}
if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((r) => child.on('exit', r)); }
result.configLines = out.split('\n').filter((l) => /api\.config_invalid|api\.listening/.test(l));
console.log(JSON.stringify(result, null, 1));
