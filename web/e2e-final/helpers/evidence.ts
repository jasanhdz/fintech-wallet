// Evidence sinks for the round: metrics.json (merged per key), captures-manifest.tsv and capture paths.
// Everything lives under docs/evidence/web-ux/<sha>/ since UX-T0 (docs/web-ux-polish/SPEC.md §5.9; WF_EVIDENCE_ROOT overrides)
// (PNG files are ignored by `captures/`).
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const SHA = process.env.WF_EVIDENCE_SHA ?? 'local';
export const EVIDENCE_ROOT = process.env.WF_EVIDENCE_ROOT ?? 'docs/evidence/web-ux';
export const EVIDENCE_DIR = resolve(ROOT, EVIDENCE_ROOT, SHA);
export const CAPTURES_DIR = resolve(EVIDENCE_DIR, 'captures');
export const DESIGN_DIR = '/Users/jasanhernandez/Develop/fintech-wallet/design/web';

export function evidencePath(name: string) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  return resolve(EVIDENCE_DIR, name);
}

export function capturePath(name: string) {
  mkdirSync(CAPTURES_DIR, { recursive: true });
  return resolve(CAPTURES_DIR, name);
}

/** Merges `value` under `key` in metrics.json (workers: 1, so no concurrent writers). */
export function recordMetric(key: string, value: unknown) {
  // UX-T0: metrics.json and captures-manifest.tsv belong to the UX helpers (SPEC §4); the t0…t5 suites write suite-*.
  const file = evidencePath('suite-metrics.json');
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
  current[key] = value;
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

const MANIFEST_HEADER = 'escenario\tpantalla\testado\tnivel\tviewport\tdpr\tarchivo\tsha256\treferencia_aprobada\n';
export type ManifestRow = { scenario: string; screen: string; state: string; level: string; viewport: string; dpr: number; file: string; reference: string };

/** Appends one capture row (replacing a previous row for the same file). */
export function recordCapture(row: ManifestRow) {
  const file = evidencePath('suite-captures-manifest.tsv');
  const digest = createHash('sha256').update(readFileSync(row.file)).digest('hex');
  const rel = relative(EVIDENCE_DIR, row.file);
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line && !line.startsWith('escenario\t') && line.split('\t')[6] !== rel) : [];
  lines.push([row.scenario, row.screen, row.state, row.level, row.viewport, String(row.dpr), rel, digest, row.reference].join('\t'));
  writeFileSync(file, MANIFEST_HEADER + lines.sort().join('\n') + '\n');
}

export function appendText(name: string, text: string) { appendFileSync(evidencePath(name), text); }
