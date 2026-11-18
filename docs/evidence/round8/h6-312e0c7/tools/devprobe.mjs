// H6 F-32 probe. Starts a root npm script in its own process group with IDEMPOTENCY_RECORD_RETENTION_DAYS removed (or set),
// captures output for a few seconds, probes GET /transfer-policy on the given port, then kills only that group.
// Never prints environment values; output lines are filtered to event names and the config error message.
import { spawn } from 'node:child_process';
const [script, port, retention] = process.argv.slice(2);
const env = { ...process.env, API_PORT: port };
delete env.IDEMPOTENCY_RECORD_RETENTION_DAYS;
if (retention && retention !== 'UNSET') env.IDEMPOTENCY_RECORD_RETENTION_DAYS = retention;
const child = spawn('npm', ['run', script], { cwd: process.cwd(), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
await new Promise((r) => setTimeout(r, Number(process.env.PROBE_WAIT_MS ?? 9000)));
let probe; let health;
try { const h = await fetch(`http://127.0.0.1:${port}/health`); health = `HTTP ${h.status}`; } catch (e) { health = `no response (${e.cause?.code ?? e.message})`; }
try { const res = await fetch(`http://127.0.0.1:${port}/v1/transfer-policy`); probe = `HTTP ${res.status}`; } catch (e) { probe = `no response (${e.cause?.code ?? e.message})`; }
const alive = child.exitCode === null;
try { process.kill(-child.pid, 'SIGTERM'); } catch {}
await new Promise((r) => setTimeout(r, 1500));
try { process.kill(-child.pid, 'SIGKILL'); } catch {}
const keep = out.split('\n').filter((l) => /api\.config_invalid|api\.listening|IDEMPOTENCY_RECORD_RETENTION_DAYS|Process exited|Waiting for file changes|tsx watch|> @fintech|> fintech|> tsx|> node/.test(l));
console.log(JSON.stringify({ script, port: Number(port), retention: retention ?? 'UNSET', groupPid: child.pid, stillRunningAtProbe: alive, exitCode: child.exitCode, getV1TransferPolicyUnauthenticated: probe, getHealth: health }));
for (const l of keep) console.log('  | ' + l.replace(/postgres(ql)?:\/\/\S+/g, '<redacted-url>'));
