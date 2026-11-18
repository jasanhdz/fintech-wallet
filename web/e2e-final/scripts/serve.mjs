#!/usr/bin/env node
// Foreground server for one profile, used by Playwright `webServer` (which owns its lifecycle)
// or manually. Usage: node web/e2e-final/scripts/serve.mjs api|web P1 [--no-build]
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, VITE_CACHE_DIR, apiEnv, profile } from './env-lib.mjs';
import { databaseUrlViolations } from './preflight.mjs';

const [kind, name] = process.argv.slice(2);
const p = profile(name);
let child;
if (kind === 'api') {
  const env = { ...process.env, ...apiEnv(name) };
  if (databaseUrlViolations(env).length) { console.error('serve: forbidden database target'); process.exit(2); }
  child = spawn('npx', ['tsx', 'api/src/server.ts'], { cwd: ROOT, env, stdio: 'inherit' });
} else if (kind === 'web') {
  if (!process.argv.includes('--no-build')) {
    const build = spawnSync('node', ['web/e2e-final/scripts/build-web.mjs', name], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  child = spawn('npm', ['--workspace', '@fintech-wallet/web', 'exec', '--', 'vite', 'preview', '--outDir', `dist/${name.toLowerCase()}`, '--host', '127.0.0.1', '--port', String(p.web), '--strictPort'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEB_VITE_CACHE_DIR: VITE_CACHE_DIR },
  });
} else {
  console.error('usage: serve.mjs api|web P1..P4 [--no-build]');
  process.exit(2);
}
const stop = () => { child?.kill('SIGTERM'); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
