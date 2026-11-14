import { readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const plannedSource = 'specs/openapi.yaml';
const scaffoldSource = 'specs/openapi.boot.yaml';
const runId = `${process.pid}-${Date.now()}`;
const normalized = `.openapi-design.${runId}.normalized.yaml`;
const plannedTarget = 'packages/shared/src/generated/product-design.ts';
const scaffoldTarget = 'packages/shared/src/generated/openapi.ts';
const plannedTemporary = `${plannedTarget}.${runId}.tmp`;
const scaffoldTemporary = `${scaffoldTarget}.${runId}.tmp`;

async function normalizedSource() {
  const contents = await readFile(plannedSource, 'utf8');
  const result = contents
    .replace('description: Requisito propuesto, longitud final pendiente.', "description: 'Requisito propuesto, longitud final pendiente.'")
    .replace('description: Segundos, valor pendiente.', "description: 'Segundos, valor pendiente.'");
  if (contents === result) throw new Error('Expected inline flow-mapping normalization points were not found in specs/openapi.yaml');
  await writeFile(normalized, result);
}

function execute(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

const mode = process.argv[2];
try {
  await normalizedSource();
  if (mode === 'validate') {
    console.log(execute('npx', ['redocly', 'lint', normalized]));
    console.log(execute('npx', ['redocly', 'lint', scaffoldSource]));
  } else if (mode === 'generate') {
    execute('npx', ['openapi-typescript', normalized, '-o', plannedTarget]);
    execute('npx', ['openapi-typescript', scaffoldSource, '-o', scaffoldTarget]);
    console.log(`Generated planned design types (not implemented paths) and BOOT-00 scaffold types.`);
  } else if (mode === 'check') {
    execute('npx', ['redocly', 'lint', normalized]);
    execute('npx', ['redocly', 'lint', scaffoldSource]);
    const plannedBefore = await readFile(plannedTarget, 'utf8');
    const scaffoldBefore = await readFile(scaffoldTarget, 'utf8');
    execute('npx', ['openapi-typescript', normalized, '-o', plannedTemporary]);
    execute('npx', ['openapi-typescript', scaffoldSource, '-o', scaffoldTemporary]);
    const plannedAfter = await readFile(plannedTemporary, 'utf8');
    const scaffoldAfter = await readFile(scaffoldTemporary, 'utf8');
    if (plannedBefore !== plannedAfter || scaffoldBefore !== scaffoldAfter) throw new Error('Generated OpenAPI types are stale; run npm run openapi:generate');
    console.log('Both OpenAPI contracts validate and generated types are reproducible.');
  } else {
    throw new Error('Expected validate, generate, or check');
  }
} finally {
  await Promise.all([normalized, plannedTemporary, scaffoldTemporary].map((path) => rm(path, { force: true })));
}
