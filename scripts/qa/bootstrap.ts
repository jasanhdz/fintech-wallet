import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const run = (command: string, args: string[], env = process.env) => spawnSync(command, args, { encoding: 'utf8', env });
const start = new Date().toISOString();
const git = run('git', ['rev-parse', 'HEAD']);
const sha = git.status === 0 ? git.stdout.trim() : 'UNAVAILABLE';
const checks: { name: string; status: 'PASS' | 'FAIL' | 'BLOCKED'; command: string; output: string }[] = [];
const check = (name: string, command: string, args: string[], env = process.env) => {
  const result = run(command, args, env);
  checks.push({ name, status: result.status === 0 ? 'PASS' : 'FAIL', command: `${command} ${args.join(' ')}`, output: `${result.stdout}${result.stderr}`.trim().slice(-5000) });
};

check('OpenAPI validation', 'npm', ['run', 'openapi:validate']);
check('Generated types reproducible', 'npm', ['run', 'openapi:check']);
check('API health and RFC7807 tests', 'npm', ['--workspace', '@fintech-wallet/api', 'test']);
check('Web render tests', 'npm', ['--workspace', '@fintech-wallet/web', 'test']);
check('Mobile render test', 'npm', ['--workspace', '@fintech-wallet/mobile', 'test']);
check('Lint', 'npm', ['run', 'lint']);
check('Typecheck', 'npm', ['run', 'typecheck']);
check('Web production build', 'npm', ['--workspace', '@fintech-wallet/web', 'run', 'build']);
check('Mobile Expo export', 'npm', ['--workspace', '@fintech-wallet/mobile', 'run', 'build']);
check('Export/dependency audit', 'npm', ['ls', '--all', '--workspaces']);
const devGuard = run('tsx', ['scripts/qa/assert-test-db.ts'], { ...process.env, DATABASE_URL: 'postgres://wallet_runtime_dev:y@localhost/wallet_dev', TEST_DATABASE_URL: 'postgres://wallet_runtime_dev:y@localhost/wallet_dev' });
checks.push({ name: 'Refuses dev DB for tests', status: devGuard.status !== 0 ? 'PASS' : 'FAIL', command: 'tsx scripts/qa/assert-test-db.ts (development URL expected to be rejected)', output: `${devGuard.stdout}${devGuard.stderr}`.trim().slice(-5000) });
check('Accepts isolated test DB config', 'tsx', ['scripts/qa/assert-test-db.ts'], { ...process.env, DATABASE_URL: 'postgres://wallet_runtime_dev:y@localhost/wallet_dev', TEST_DATABASE_URL: 'postgres://wallet_runtime_test:y@localhost/wallet_test' });

const compose = run('docker-compose', ['ps', '--services', '--filter', 'status=running']);
if (compose.status !== 0 || !compose.stdout.includes('postgres')) {
  checks.push({ name: 'PostgreSQL test connection and isolation', status: 'BLOCKED', command: 'docker-compose up -d && PostgreSQL connection/isolation checks', output: `${compose.stderr || compose.stdout} (DB-dependent check requires local compose service)` });
} else {
  check('PostgreSQL test connection and isolation', 'npm', ['--workspace', '@fintech-wallet/api', 'run', 'test:db'], { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://wallet_runtime_dev:dev_runtime_local_only@localhost:55432/wallet_dev', TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://wallet_runtime_test:test_runtime_local_only@localhost:55432/wallet_test' });
}

const overall = checks.some((item) => item.status === 'FAIL') ? 'FAIL' : checks.some((item) => item.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
const report = `# BOOT-00 QA bootstrap\n\n- Resultado global: **${overall}**\n- SHA evaluado: \`${sha}\`\n- Fecha UTC: ${start}\n\n${checks.map((item) => `## ${item.status} — ${item.name}\n\nComando: \`${item.command}\`\n\n\`\`\`text\n${item.output || '(sin salida relevante)'}\n\`\`\``).join('\n\n')}\n`;
await mkdir('docs', { recursive: true });
await writeFile('docs/qa-report.md', report);
console.log(`QA ${overall}; ${checks.filter((item) => item.status === 'PASS').length} PASS, ${checks.filter((item) => item.status === 'FAIL').length} FAIL, ${checks.filter((item) => item.status === 'BLOCKED').length} BLOCKED. Report: docs/qa-report.md (SHA ${createHash('sha256').update(report).digest('hex').slice(0, 12)})`);
if (overall === 'FAIL') process.exitCode = 1;
