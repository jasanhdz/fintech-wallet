// UX polish visual evidence (docs/web-ux-polish/SPEC.md §7.4, T0-07/T0-08, VZ-01): every scenario of §7.4 at the 7
// viewports of §5.7 + zoom 200 %, with the §5.10 metrics and the per-scenario map of API reads.
// Project `ux-capture` only (not part of `final`):
//   WF_UX_PHASE=antes  WF_EVIDENCE_SHA=<sha> npx playwright test -c web/e2e-final/playwright.config.ts --project=ux-capture
//   WF_UX_PHASE=despues WF_UX_BASELINE=<sha antes> WF_EVIDENCE_SHA=<sha> … (adds the «antes | después» composites)
// Optional: WF_UX_ONLY=W03,W04 (screens) to limit a run. Captures (PNG) stay unversioned under captures/ux/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { test } from '@playwright/test';
import { EVIDENCE_DIR, ROOT, EVIDENCE_ROOT, evidencePath } from './helpers/evidence.js';
import { newPage, settle, watch } from './helpers/screen.js';
import { horizontalOverflow } from './helpers/geometry.js';
import { clippedText, contrastFailures, headingOutline } from './helpers/a11y.js';
import { composeBeforeAfter } from './helpers/before-after.js';
import { SCENARIOS, UX_VIEWPORTS, authenticatedScreen } from './helpers/ux-scenarios.js';
import { duplicateChrome, edgeAlignment, focusObscured, offScaleSpacing, overlayBleed, overlayRects, radiiOutside, readCls, readTraffic, touchTargets, trackCls, typographyOutside } from './helpers/ux-metrics.js';

const PHASE = process.env.WF_UX_PHASE === 'despues' ? 'después' : 'antes';
const PHASE_DIR = PHASE === 'antes' ? 'antes' : 'despues';
const BASELINE = process.env.WF_UX_BASELINE;
const ONLY = (process.env.WF_UX_ONLY ?? '').split(',').map((item) => item.trim()).filter(Boolean);
const HEADER = 'escenario\tpantalla\testado\tnivel\tviewport\tdpr\tfase\tarchivo\tsha256\n';

function recordRow(cells: { scenario: string; screen: string; state: string; viewport: string; dpr: number; phase: string; file: string }) {
  const manifest = evidencePath('captures-manifest.tsv');
  const rel = relative(EVIDENCE_DIR, cells.file);
  const digest = createHash('sha256').update(readFileSync(cells.file)).digest('hex');
  const lines = existsSync(manifest) ? readFileSync(manifest, 'utf8').split('\n').filter((line) => line && !line.startsWith('escenario\t') && line.split('\t')[7] !== rel) : [];
  lines.push([cells.scenario, cells.screen, cells.state, 'F', cells.viewport, String(cells.dpr), cells.phase, rel, digest].join('\t'));
  writeFileSync(manifest, HEADER + lines.sort().join('\n') + '\n');
}

function mergeJson(name: string, key: string, value: unknown) {
  const file = evidencePath(name);
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
  current[key] = value;
  writeFileSync(file, `${JSON.stringify(current, null, 1)}\n`);
}

const cap = <T>(items: T[]) => ({ count: items.length, sample: items.slice(0, 12) });

for (const scenario of SCENARIOS.filter((item) => !ONLY.length || ONLY.includes(item.screen))) {
  test(`UX ${PHASE} ${scenario.id}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const reads = new Set<string>();
    const perViewport: Record<string, unknown> = {};
    for (const viewport of UX_VIEWPORTS) {
      const { context, page } = await newPage(browser, viewport);
      const seen = watch(page);
      const traffic = readTraffic(page);
      await trackCls(page);
      try {
        await scenario.open(page);
        await settle(page);
        await page.waitForTimeout(150);
        const name = `${scenario.id}-${viewport.width}x${viewport.height}@${viewport.dpr}.png`;
        const file = resolve(EVIDENCE_DIR, 'captures/ux', PHASE_DIR, name);
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file, fullPage: true });
        recordRow({ scenario: scenario.id, screen: scenario.screen, state: scenario.state, viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, phase: PHASE, file });
        if (PHASE === 'después' && BASELINE) {
          const before = resolve(ROOT, EVIDENCE_ROOT, BASELINE, 'captures/ux/antes', name);
          const out = resolve(EVIDENCE_DIR, 'captures/ux/ba', `${scenario.id}-${viewport.label}-ba.png`);
          mkdirSync(dirname(out), { recursive: true });
          const composed = await composeBeforeAfter(browser, before, file, out, `${scenario.id} · ${viewport.width}×${viewport.height}@${viewport.dpr}`);
          if (composed) recordRow({ scenario: scenario.id, screen: scenario.screen, state: `${scenario.state} · antes|después`, viewport: `${viewport.width}x${viewport.height}`, dpr: viewport.dpr, phase: 'antes|después', file: composed });
        }
        const wide = viewport.width >= 1024;
        const metrics: Record<string, unknown> = {
          cls: await readCls(page),
          offScaleSpacing: cap(await offScaleSpacing(page)),
          radiiOutside: cap(await radiiOutside(page)),
          typographyOutside: cap(await typographyOutside(page)),
          touchTargets: cap(wide ? await touchTargets(page, 24, 36) : await touchTargets(page, 44)),
          overlays: await overlayRects(page),
          overlayBleed: await overlayBleed(page),
          duplicateChrome: authenticatedScreen(scenario.screen) ? await duplicateChrome(page) : null,
          edgeAlignment: await edgeAlignment(page),
          contrast: await contrastFailures(page).then((result) => ({ checked: result.checked, ...cap(result.failures) })),
          headings: await headingOutline(page),
          clipped: cap(await clippedText(page)),
          overflow: await horizontalOverflow(page).then((result) => ({ scrollWidth: result.scrollWidth, innerWidth: result.innerWidth })),
        };
        if (viewport.label === '390' || viewport.label === '1440') metrics.focusObscured = cap(await focusObscured(page));
        metrics.consoleErrors = seen.errors; metrics.foreign = seen.foreign;
        perViewport[viewport.label] = metrics;
      } catch (error) {
        perViewport[viewport.label] = { error: String((error as Error).message).split('\n')[0] };
      } finally {
        for (const read of traffic.reads()) reads.add(read);
        await context.close();
      }
    }
    mergeJson('metrics.json', `${PHASE} ${scenario.id}`, perViewport);
    mergeJson('network-reads.json', scenario.id, [...reads].sort());
    const failed = Object.entries(perViewport).filter(([, value]) => (value as { error?: string }).error);
    if (failed.length) throw new Error(`scenario ${scenario.id} could not be reached at ${failed.map(([label, value]) => `${label}: ${(value as { error: string }).error}`).join('; ')}`);
  });
}
