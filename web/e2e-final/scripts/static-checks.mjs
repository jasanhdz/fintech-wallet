#!/usr/bin/env node
// Static (command-level) WF-T0 checks: FONT-01, FONT-02, TOK-01, REC-01, REC-08, ENV-02, SC-03.
// Usage: node web/e2e-final/scripts/static-checks.mjs [evidence-dir]   → PASS/FAIL lines, exit 1 on FAIL.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT } from './env-lib.mjs';
import { FORBIDDEN_TEXT } from './preflight.mjs';

const BASE = 'f0ed4bc';
const results = [];
const check = (id, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`); };
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const fontDir = 'web/public/fonts/inter';
const fontFiles = ['Inter-400.ttf', 'Inter-500.ttf', 'Inter-600.ttf', 'Inter-700.ttf', 'OFL.txt'];
const css = read('web/src/style.css');
const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
const facesOk = faces.length === 4 && [400, 500, 600, 700].every((weight) => faces.some((face) => face.includes(`font-weight:${weight}`) && face.includes('font-display:swap') && face.includes(`url('/fonts/inter/Inter-${weight}.ttf')`)));
check('FONT-01', fontFiles.every((file) => existsSync(resolve(ROOT, fontDir, file))) && facesOk, `${fontDir}: ${fontFiles.filter((file) => existsSync(resolve(ROOT, fontDir, file))).join(', ')}; @font-face=${faces.length}`);

const html = read('web/index.html');
const preloads = html.match(/<link[^>]*rel="preload"[^>]*>/g) ?? [];
const preloadOk = ['400', '600'].every((weight) => preloads.some((link) => link.includes(`Inter-${weight}.ttf`) && link.includes('as="font"') && /crossorigin/.test(link)));
check('FONT-02', preloadOk, `preload links: ${preloads.length}`);

const allowed = new Set(['#f9f9ff', '#f6f8fb', '#ffffff', '#f1f3ff', '#e9edff', '#e0e8ff', '#dbe2f9', '#141b2c', '#434655', '#747686', '#c4c5d7', '#0037b0', '#1d4ed8', '#006d40', '#98f6bb', '#007345', '#7a2b00', '#ffdbcd', '#ba1a1a', '#ffdad6', '#93000a', '#e2e8f0']);
const hexes = [...new Set((css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((value) => value.toLowerCase()))];
const outside = hexes.filter((value) => !allowed.has(value));
const definitionLine = css.split('\n').find((line) => line.startsWith(':root{--color-surface:')) ?? '';
const hexInRules = css.split('\n').filter((line) => line !== definitionLine && !line.startsWith('/*')).join('\n').match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
check('TOK-01', outside.length === 0 && hexInRules.length === 0 && !/DM Sans/.test(css) && !/h1,h2,h3\{[^}]*!important/.test(css), `hex values=${hexes.length}, outside list=${outside.join(',') || 'none'}, hex in component rules=${hexInRules.length}`);

const attemptDiff = git('diff', BASE, '--', 'web/src/transfer-attempt.ts');
// REC-01 (SPEC §7.3.5): the diff may only ADD the one read-only accessor of §4; no line of the base file (and so no
// body of saveTransferDraft/clearTransferDraft/clearAllTransferDrafts/activateTransferUser/forgetTransferUser/
// readTransferDraft) may be removed or changed, and the added code must not write or remove storage.
const diffLines = attemptDiff.split('\n').filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line));
const removed = diffLines.filter((line) => line.startsWith('-'));
const added = diffLines.filter((line) => line.startsWith('+')).join('\n');
const newExports = added.match(/export function (\w+)/g) ?? [];
const writes = /setItem|removeItem|clear\(/.test(added);
check('REC-01', removed.length === 0 && newExports.length <= 1 && !writes, `git diff ${BASE} -- web/src/transfer-attempt.ts: ${attemptDiff === '' ? 'empty' : `additions only (removed=${removed.length}), new exports: ${newExports.join(', ') || 'none'}, storage writes in added code: ${writes ? 'yes' : 'none'}`}`);
const outOfScope = git('diff', BASE, '--stat', '--', 'api', 'mobile', 'packages', 'specs', 'SPEC.md', 'FINDINGS.md', 'package.json', 'package-lock.json', 'web/package.json', '.github');
check('REC-08', outOfScope === '', `git diff ${BASE} --stat -- api mobile packages specs SPEC.md FINDINGS.md package*.json web/package.json .github: ${outOfScope || 'empty'}`);

const forbidden = FORBIDDEN_TEXT;
const files = [];
const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else files.push(path); } };
walk(resolve(ROOT, 'web/e2e-final'));
const evidenceDir = process.argv[2] ? resolve(process.argv[2]) : undefined;
if (evidenceDir && existsSync(join(evidenceDir, 'commands.txt'))) files.push(join(evidenceDir, 'commands.txt'));
const hits = files.filter((path) => !path.endsWith('scripts/preflight.mjs')).filter((path) => forbidden.test(readFileSync(path, 'utf8'))).map((path) => relative(ROOT, path));
check('ENV-02', hits.length === 0, `forbidden targets outside preflight deny list: ${hits.join(', ') || 'none'} (${files.length} files scanned)`);

const productSources = ['web/index.html', ...readdirSync(resolve(ROOT, 'web/src')).map((name) => `web/src/${name}`)];
const cdn = productSources.filter((path) => /material-symbols|tailwind|googleusercontent|cdn\./i.test(read(path)));
check('SC-03', cdn.length === 0, `material-symbols|tailwind|googleusercontent|cdn. in web/src + web/index.html: ${cdn.join(', ') || 'none'}`);


// ── UX polish round (docs/web-ux-polish/SPEC.md §7.2) ──
const UX_BASE = '0cf8257';
const tokens = ['--radius-xs', '--w-page', '--w-form', '--w-doc', '--w-status', '--w-auth', '--w-card-status', '--measure', '--shell-sidebar', '--topbar-h', '--bottom-nav-h', '--action-bar-h', '--gutter', '--page-top'];
const spaceLines = css.split('\n').filter((line) => /--space-(1|2|3|4|5|6|8|10|12|16):/.test(line)).length;
check('SP-01', spaceLines === 10 && tokens.every((token) => css.includes(`${token}:`)), `--space-* declaration lines=${spaceLines}; missing tokens: ${tokens.filter((token) => !css.includes(`${token}:`)).join(', ') || 'none'}`);
const baseCss = git('show', `${UX_BASE}:web/src/style.css`);
const colorLines = (text) => text.split('\n').flatMap((line) => line.match(/--color-[\w-]+:[^;}]+/g) ?? []).sort().join('\n');
const colorValues = (text) => new Set((text.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|color-mix\([^)]*\)/g) ?? []).map((value) => value.toLowerCase()));
const baseValues = colorValues(baseCss);
const newValues = [...colorValues(css)].filter((value) => !baseValues.has(value));
const inlineColour = execFileSync('bash', ['-c', `grep -rEn "style=\\{\\{[^}]*(color|background)" ${resolve(ROOT, 'web/src')} || true`], { encoding: 'utf8' }).trim();
check('SP-02', colorLines(css) === colorLines(baseCss) && newValues.length === 0 && html.includes('name="theme-color" content="#f9f9ff"') && inlineColour === '', `--color-* identical to ${UX_BASE}: ${colorLines(css) === colorLines(baseCss)}; colour values not in ${UX_BASE}: ${newValues.join(', ') || 'none'}; theme-color kept; inline colour styles: ${inlineColour ? 'found' : 'none'}`);
check('SP-05 (static)', !/clamp\(/.test(css), `clamp( in style.css: ${(css.match(/clamp\(/g) ?? []).length}`);
const srcText = readdirSync(resolve(ROOT, 'web/src')).filter((name) => /\.(ts|tsx)$/.test(name)).map((name) => read(`web/src/${name}`)).join('\n');
const DYNAMIC = new Set(['chip-success', 'chip-pending', 'chip-error', 'chip-neutral', 'is-success', 'is-pending', 'is-error', 'auth-card-login', 'auth-card-register']);
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)/g, '').replace(/\d*\.\d+/g, '0');
const classes = [...new Set((cssNoComments.match(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g) ?? []).map((value) => value.slice(1)))];
const unused = classes.filter((name) => !DYNAMIC.has(name) && !new RegExp(`(?<![A-Za-z0-9_-])${name.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_-])`).test(srcText));
const importantNow = (css.match(/!important/g) ?? []).length;
const importantBase = (baseCss.match(/!important/g) ?? []).length;
check('SP-06', unused.length === 0 && importantNow <= importantBase, `classes in style.css without use in web/src: ${unused.join(', ') || 'none'} (${classes.length} classes); !important ${importantNow} (base ${importantBase})`);
check('SH-05 (static)', /name="viewport" content="[^"]*viewport-fit=cover/.test(html), 'web/index.html viewport-fit=cover');
check('SH-07 (static)', !/backdrop-filter/.test(css), `backdrop-filter in style.css: ${(css.match(/backdrop-filter/g) ?? []).length}`);
const plus = execFileSync('bash', ['-c', `grep -rEn 'aria-hidden="true">\\+ |>\\+ <|'"'"'\\+ '"'"'' ${resolve(ROOT, 'web/src')} || true`], { encoding: 'utf8' }).trim();
check('UX-SC-03', plus === '', `literal «+» next to an add icon: ${plus ? plus.split('\n').length : 0}`);

console.log(`RESULT ${results.every(Boolean) ? 'PASS' : 'FAIL'}`);
process.exit(results.every(Boolean) ? 0 : 1);
