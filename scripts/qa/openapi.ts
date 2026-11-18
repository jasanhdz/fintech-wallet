import { readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const plannedSource = 'specs/openapi.yaml';
const scaffoldSource = 'specs/openapi.boot.yaml';
const runId = `${process.pid}-${Date.now()}`;
const plannedTarget = 'packages/shared/src/generated/product-design.ts';
const scaffoldTarget = 'packages/shared/src/generated/openapi.ts';
const plannedTemporary = `${plannedTarget}.${runId}.tmp`;
const scaffoldTemporary = `${scaffoldTarget}.${runId}.tmp`;

function execute(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

function localBin(name: string) {
  return process.platform === 'win32'
    ? `node_modules/.bin/${name}.cmd`
    : `./node_modules/.bin/${name}`;
}

const mode = process.argv[2];
try {
  if (mode === 'validate') {
    console.log(execute(localBin('redocly'), ['lint', plannedSource]));
    console.log(execute(localBin('redocly'), ['lint', scaffoldSource]));
  } else if (mode === 'generate') {
    execute(localBin('openapi-typescript'), [plannedSource, '-o', plannedTarget]);
    execute(localBin('openapi-typescript'), [scaffoldSource, '-o', scaffoldTarget]);
    console.log(`Generated planned design types (not implemented paths) and BOOT-00 scaffold types.`);
  } else if (mode === 'check') {
    execute(localBin('redocly'), ['lint', plannedSource]);
    execute(localBin('redocly'), ['lint', scaffoldSource]);
    const plannedBefore = await readFile(plannedTarget, 'utf8');
    const scaffoldBefore = await readFile(scaffoldTarget, 'utf8');
    execute(localBin('openapi-typescript'), [plannedSource, '-o', plannedTemporary]);
    execute(localBin('openapi-typescript'), [scaffoldSource, '-o', scaffoldTemporary]);
    const plannedAfter = await readFile(plannedTemporary, 'utf8');
    const scaffoldAfter = await readFile(scaffoldTemporary, 'utf8');
    if (plannedBefore !== plannedAfter || scaffoldBefore !== scaffoldAfter) throw new Error('Generated OpenAPI types are stale; run npm run openapi:generate');
    console.log('Both OpenAPI contracts validate and generated types are reproducible.');
  } else {
    throw new Error('Expected validate, generate, or check');
  }
} finally {
  await Promise.all([plannedTemporary, scaffoldTemporary].map((path) => rm(path, { force: true })));
}
