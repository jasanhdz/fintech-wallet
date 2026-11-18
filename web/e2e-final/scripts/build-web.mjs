#!/usr/bin/env node
// Static web build per profile: web/dist/pX with VITE_API_URL -> that profile's API.
// Usage: node web/e2e-final/scripts/build-web.mjs P1 [P2 ...]
import { spawnSync } from 'node:child_process';
import { ROOT, VITE_CACHE_DIR, profile } from './env-lib.mjs';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['P1'];
for (const name of names) {
  const p = profile(name);
  const outDir = `dist/${name.toLowerCase()}`;
  const result = spawnSync('npm', ['--workspace', '@fintech-wallet/web', 'exec', '--', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: ROOT, stdio: 'inherit',
    env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${p.api}/v1`, WEB_VITE_CACHE_DIR: VITE_CACHE_DIR },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`build-web: ${name} -> web/${outDir} (API 127.0.0.1:${p.api})`);
}
