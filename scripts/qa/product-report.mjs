import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const reportDirectory = resolve(root, 'test-results/qa');
const startedAt = new Date();
const expectedNode = (await readFile(resolve(root, '.nvmrc'), 'utf8')).trim().replace(/^v/, '');
const actualNode = process.versions.node;
const exactNodeMatch = actualNode === expectedNode;
process.env.PLAYWRIGHT_WEB_PORT ??= '5175';
process.env.PLAYWRIGHT_WEB_ORIGIN ??= `http://127.0.0.1:${process.env.PLAYWRIGHT_WEB_PORT}`;

function command(name, args) {
  return new Promise((resolveResult) => {
    const child = spawn(name, args, { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', (error) => resolveResult({ status: 'BLOCKED', detail: `Could not start ${name}: ${error.code ?? 'spawn error'}` }));
    child.once('close', (code, signal) => resolveResult({ status: code === 0 ? 'PASS' : 'FAIL', detail: code === 0 ? 'completed' : `exit ${code ?? signal ?? 'unknown'}` }));
  });
}

async function gitValue(...args) {
  const result = await commandCapture('git', args);
  return result.code === 0 ? result.stdout.trim() : 'unavailable';
}

function commandCapture(name, args) {
  return new Promise((resolveResult) => {
    const child = spawn(name, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', () => resolveResult({ code: 1, stdout: '' }));
    child.once('close', (code) => resolveResult({ code: code ?? 1, stdout }));
  });
}

const results = [];
const run = async (id, label, args, prerequisite = true) => {
  if (!prerequisite) {
    results.push({ id, label, command: `npm ${args.join(' ')}`, status: 'BLOCKED', detail: 'wallet_test migration did not pass; database-backed checks were not started' });
    return 'BLOCKED';
  }
  const outcome = await command('npm', args);
  results.push({ id, label, command: `npm ${args.join(' ')}`, ...outcome });
  return outcome.status;
};

if (!exactNodeMatch) {
  results.push({ id: 'node-runtime', label: 'Pinned Node runtime', command: `Node ${expectedNode}`, status: 'BLOCKED', detail: `running Node ${actualNode}; suite still runs for diagnostics` });
} else {
  results.push({ id: 'node-runtime', label: 'Pinned Node runtime', command: `Node ${expectedNode}`, status: 'PASS', detail: 'matches .nvmrc' });
}

await run('lint', 'Lint all workspaces', ['run', 'lint']);
await run('typecheck', 'Typecheck all workspaces', ['run', 'typecheck']);
await run('unit', 'Unit tests for API, Web, Mobile and shared code', ['test']);
await run('openapi-validate', 'Validate OpenAPI contracts', ['run', 'openapi:validate']);
await run('openapi-check', 'Check reproducible shared types', ['run', 'openapi:check']);

const migration = await run('db-migrate-test', 'Apply test-only migrations to wallet_test', ['run', 'db:migrate:test']);
const databaseReady = migration === 'PASS';

await run('api-integration', 'API/PostgreSQL integration tests', ['run', 'test:integration'], databaseReady);
await run('web-visual', 'Playwright responsive visual flows', ['run', 'test:visual'], databaseReady);
await run('web-e2e', 'Playwright product/API/PostgreSQL journeys', ['run', 'test:e2e'], databaseReady);
await run('history-performance', '100k movement fixture and real EXPLAIN ANALYZE', ['run', 'qa:history-performance'], databaseReady);
await run('build', 'API, Web and Expo exports', ['run', 'build']);

results.push({
  id: 'native-device-review',
  label: 'Native iOS/Android interaction and visual review',
  command: 'Manual Expo Go/device walkthrough in docs/mobile-review-round4.md',
  status: 'BLOCKED',
  detail: 'Playwright, Jest and Expo export do not provide native-device evidence',
});
results.push({
  id: 'business-day-boundary',
  label: 'Daily limit crossing the configured business-day boundary',
  command: 'No deterministic midnight-boundary regression exists yet',
  status: 'BLOCKED',
  detail: 'existing daily-limit tests exercise concurrent usage, not a clock-controlled midnight transition',
});
results.push({
  id: 'visual-pixel-diff',
  label: 'Pixel-level comparison against approved references',
  command: 'Web PNG captures plus qualitative same-viewport inspection',
  status: 'BLOCKED',
  detail: 'captures are reproducible, but no pixel-diff threshold is used; user screenshots remain implementation evidence, not baselines',
});

const byId = new Map(results.map((result) => [result.id, result]));
const requirements = [
  ['REQ-AUTH-01', 'Registro crea identidad y cuenta MXN', ['api-integration', 'web-e2e'], 'Mobile no ofrece registro; el challenge lo reserva al panel Web.'],
  ['REQ-AUTH-02', 'Login válido e inválido; JWT de acceso y refresh', ['api-integration', 'web-e2e', 'unit'], 'La inspección nativa real de login queda separada.'],
  ['REQ-AUTH-03', 'Rate limit en intentos de autenticación', ['api-integration'], ''],
  ['REQ-AUTH-04', 'Refresh rotativo, reutilización y cierre de sesión', ['api-integration', 'web-e2e', 'unit'], 'La renovación/revocación móvil tiene cobertura unitaria simulada; dispositivo pendiente.'],
  ['REQ-AUTH-05', 'SecureStore y privacidad al ir a segundo plano', ['unit', 'native-device-review'], 'La captura del app switcher/background requiere teléfono real.'],
  ['REQ-ACCT-01', 'Consulta de cuentas propias y saldos MXN', ['api-integration', 'web-e2e', 'unit', 'native-device-review'], 'La suite móvil usa API simulada; falta recorrido nativo integrado.'],
  ['REQ-ACCT-02', 'Aislamiento de cuentas ajenas', ['api-integration'], ''],
  ['REQ-BEN-01', 'Alta y consulta de beneficiario interno válido', ['api-integration', 'web-e2e'], ''],
  ['REQ-BEN-02', 'Longitud, caracteres y checksum CLABE inválidos sin persistencia', ['api-integration', 'web-e2e'], ''],
  ['REQ-BEN-03', 'Aislamiento de beneficiarios ajenos', ['api-integration'], ''],
  ['REQ-XFER-01', 'Transferencia a beneficiario y entre cuentas propias', ['api-integration', 'web-e2e', 'unit', 'native-device-review'], 'Mobile unit tests simulan red; falta ejecución nativa contra API.'],
  ['REQ-XFER-02', 'Precisión MXN en unidades menores sin float', ['api-integration', 'web-e2e', 'unit'], ''],
  ['REQ-XFER-03', 'Rechazo de más de dos decimales', ['unit', 'web-e2e'], ''],
  ['REQ-XFER-04', 'Rechazo de origen y destino idénticos', ['api-integration'], ''],
  ['REQ-XFER-05', 'Saldo insuficiente sin cambio financiero', ['api-integration', 'web-e2e'], 'Las pruebas comprueban respuesta, saldos, asientos y uso diario.'],
  ['REQ-XFER-06', 'Atomicidad, saldo no negativo y asientos balanceados', ['api-integration'], 'Incluye conciliación por transferencia y global.'],
  ['REQ-XFER-07', 'Conciliación de 100 solicitudes concurrentes', ['api-integration'], ''],
  ['REQ-XFER-08', 'Doble clic de envío no genera un segundo POST inicial', ['web-e2e'], ''],
  ['REQ-XFER-09', 'Recuperación incierta tras reiniciar cliente/API con misma llave', ['api-integration', 'unit', 'native-device-review'], 'API real y unidad móvil simulada; pérdida de red en dispositivo queda pendiente.'],
  ['REQ-XFER-10', 'Idempotencia igual payload y rechazo por payload distinto', ['api-integration'], ''],
  ['REQ-XFER-11', 'OTP requerido, incorrecto, expirado y agotado', ['api-integration', 'web-e2e'], 'OTP incompleto se valida en UI; captura nativa real pendiente.'],
  ['REQ-LIMIT-01', 'Límite diario concurrente sin exceso ni débito por rechazo', ['api-integration', 'web-e2e'], ''],
  ['REQ-LIMIT-02', 'Zona de negocio y transición de día a medianoche', ['api-integration', 'business-day-boundary'], 'No existe todavía prueba con reloj/control de instante en el borde del día.'],
  ['REQ-HIST-01', 'Historial propietario, filtros y cursor estable', ['api-integration', 'web-e2e'], ''],
  ['REQ-HIST-02', 'Estados Web loading/vacío/error, filtros y accesibilidad', ['web-visual', 'web-e2e'], 'La inspección de captura es cualitativa, no pixel-diff.'],
  ['REQ-HIST-03', '100,000 movimientos y EXPLAIN ANALYZE PostgreSQL real', ['history-performance'], ''],
  ['REQ-HIST-04', 'Móvil muestra últimos 20 movimientos', ['unit', 'native-device-review'], 'Fixture unitaria y captura manual; falta recorrido integrado en teléfono.'],
  ['REQ-QUAL-01', 'RFC 7807, request ID y logs sin datos sensibles', ['api-integration'], ''],
  ['REQ-QUAL-02', 'Migraciones TypeORM, synchronize:false e invariantes de BD', ['db-migrate-test', 'api-integration'], ''],
  ['REQ-QUAL-03', 'Suite financiera con PostgreSQL real aislado', ['api-integration'], ''],
  ['REQ-QUAL-04', '100 operaciones concurrentes concilian al centavo', ['api-integration'], ''],
  ['REQ-QUAL-05', 'Web presenta rechazo de saldo insuficiente', ['web-e2e'], ''],
  ['REQ-QUAL-06', 'Lint, tipos, unitarias, integración y build de tres clientes', ['lint', 'typecheck', 'unit', 'api-integration', 'web-e2e', 'build'], 'La automatización nativa no equivale a aceptación física.'],
];

function requirementStatus(suites) {
  const statuses = suites.map((id) => byId.get(id)?.status ?? 'BLOCKED');
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  return 'PASS';
}

const requirementResults = requirements.map(([id, title, suites, note]) => ({ id, title, suites, note, status: requirementStatus(suites) }));
const evaluatedSha = await gitValue('rev-parse', 'HEAD');
const capturesPath = resolve(root, 'test-results/visual');
let captureNames = [];
try { captureNames = (await readdir(capturesPath)).filter((name) => name.toLowerCase().endsWith('.png')).sort(); } catch { /* Visual suite may not have produced captures. */ }

const failed = results.some((result) => result.status === 'FAIL');
const blocked = results.some((result) => result.status === 'BLOCKED') || requirementResults.some((result) => result.status === 'BLOCKED');
const overall = failed ? 'FAIL' : blocked ? 'BLOCKED' : 'PASS';
const approval = overall === 'PASS' ? 'Eligible for reviewer assessment; not self-approval' : 'NO — one or more required checks are blocked or failed';
const endedAt = new Date();

const report = {
  schemaVersion: 1,
  evaluatedSha,
  branch: await gitValue('branch', '--show-current'),
  startedAt: startedAt.toISOString(),
  endedAt: endedAt.toISOString(),
  runtime: { node: actualNode, expectedNode, nodeStatus: exactNodeMatch ? 'PASS' : 'BLOCKED' },
  environment: { automatedFinancialTestsTarget: 'wallet_test (guarded)', demoWalletTouched: false },
  overall,
  approval,
  commands: results,
  requirements: requirementResults,
  screenshots: { directory: 'test-results/visual/', count: captureNames.length, files: captureNames },
  limitations: [
    'No Web pixel-diff comparison is performed; PNGs are real masked Playwright captures for qualitative same-viewport comparison.',
    'Native iOS/Android visual and live journey review requires Expo Go on a physical device; Jest and Expo export are not device evidence.',
    'The business-day midnight boundary has no deterministic clock-controlled regression yet.',
    'Automated tests use wallet_test; wallet_dev is not seeded, reset, or used for financial tests by this runner.',
  ],
};

const statusRows = results.map((result) => `| ${result.label} | **${result.status}** | \`${result.command}\` | ${result.detail} |`);
const requirementRows = requirementResults.map((result) => `| ${result.id} | ${result.title} | **${result.status}** | ${result.suites.join(', ')} | ${result.note} |`);
const markdown = [
  '# QA report — Billetera MXN',
  '',
  `- SHA evaluado: \`${evaluatedSha}\` (${report.branch})`,
  `- Periodo: ${report.startedAt} — ${report.endedAt}`,
  `- Node: \`${actualNode}\` (requerido por .nvmrc: \`${expectedNode}\`) — **${report.runtime.nodeStatus}**`,
  '- Base de pruebas financieras: `wallet_test` con guard fail-closed; `wallet_dev` no se usa para pruebas financieras.',
  `- Resultado automatizable: **${overall}**`,
  `- Aprobación completa: **${approval}**`,
  '',
  'Un resultado **PASS** aplica únicamente a la evidencia automatizada indicada. Cualquier requisito obligatorio **BLOCKED** impide declarar aceptación completa.',
  '',
  '## Comandos y evidencias',
  '',
  '| Suite | Estado | Comando | Detalle |',
  '|---|---|---|---|',
  ...statusRows,
  '',
  '## Matriz de requisitos y recorridos',
  '',
  '| Requisito | Caso | Estado | Evidencia automatizada requerida | Pendiente / alcance |',
  '|---|---|---|---|---|',
  ...requirementRows,
  '',
  `## Capturas Web reales (${captureNames.length})`,
  '',
  'Las imágenes aparecen en `test-results/visual/` y se publican junto con este informe como artefacto CI `visual-captures-<SHA>`. Las capturas no reemplazan la comparación cualitativa con la fuente aprobada.',
  '',
  ...captureNames.map((name) => `- \`${name}\``),
  '',
  '## Pendientes que bloquean aceptación completa',
  '',
  '- Capturas y recorrido nativo M01–M12 en teléfono; especialmente M06 después de la corrección del estado ocupado.',
  '- Prueba determinista del límite diario cruzando medianoche y verificando saldos, ledger y uso.',
  '- Inspección visual de referencia/captura Web al mismo viewport; no se automatiza diff de píxeles.',
  '- Recorrido móvil real con API para expiración/reanudación y recuperación de red; los tests Mobile existentes usan red simulada.',
  '',
].join('\n');

await mkdir(reportDirectory, { recursive: true });
await writeFile(resolve(reportDirectory, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await writeFile(resolve(reportDirectory, 'qa-report.md'), markdown, { mode: 0o600 });
console.log(`QA report: test-results/qa/qa-report.md (${overall})`);
console.log(`Requirements: ${requirementResults.filter((item) => item.status === 'PASS').length} PASS, ${requirementResults.filter((item) => item.status === 'FAIL').length} FAIL, ${requirementResults.filter((item) => item.status === 'BLOCKED').length} BLOCKED`);
if (failed) process.exitCode = 1;
