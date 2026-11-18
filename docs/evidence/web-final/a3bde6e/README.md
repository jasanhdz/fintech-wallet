# Evidencia WF-T0 · código `a3bde6e` (rama `feature/web-fidelity-final`, base `f0ed4bc`)

Evidencia del Generator de la tanda WF-T0 (Fundación). **No es aceptación final**; la evaluación la hace
el Evaluador en `docs/evidence/web-final/eval-<sha>/` y `docs/web-fidelity-final/FINDINGS.md`.

| Archivo | Contenido |
|---|---|
| `commands.txt` | comandos exactos (sin `npm ci/install`, sin `test:e2e`/`test:visual` raíz) |
| `env-summary.txt` | versiones, puertos, contenedor (sin secretos) |
| `env-01-disk.txt` | `df -h` y `docker system df` antes de crear el volumen (4.6 GiB libres ≥ 2.5) + log de `db-up.mjs` |
| `env-06-cleanup.txt` | limpieza del contenedor/volumen propios y disco después |
| `checks-output.txt` | FN-18 web (lint/typecheck/test/build), eslint+tsc de `web/e2e-final`, `static-checks.mjs` |
| `test-output.txt` | Playwright (reporter list) con la salida PASS de `preflight.mjs` por invocación: `final` 22/22, `legacy` 8/8 + 2/2 |
| `metrics.json` | mediciones de fuentes, shell, títulos, overflow por viewport |
| `network-traces.json` | trazas no-GET S1…S7 en este SHA, comparadas con `../f0ed4bc/network-golden.json` (idénticas) |
| `captures-manifest.tsv` | capturas (PNG en `captures/`, no versionadas) con sha256 y referencia aprobada |

## Criterios WF-T0

| Criterio | Estado | Cómo |
|---|---|---|
| ENV-01 | PASS | `env-01-disk.txt` (4.6 GiB libres antes del volumen) |
| ENV-02 | PASS | `env-summary.txt` (`docker ps`: `127.0.0.1:55433`); `static-checks.mjs` ENV-02 sobre `web/e2e-final/**` + `commands.txt` |
| ENV-03 | PASS | `preflight RESULT PASS` antes de cada invocación en `test-output.txt` |
| ENV-04 | PASS | API 3301 / Web 5301 `--strictPort`, build `web/dist/p1`, `cacheDir node_modules/.vite-web-final` (`scripts/serve.mjs`, `build-web.mjs`) |
| ENV-05 | PASS | `commands.txt` |
| ENV-06 | PASS | `env-06-cleanup.txt` (contenedor y volumen propios eliminados; se recrean con `db-up.mjs`) |
| FONT-01, FONT-02 | PASS | `static-checks.mjs` |
| FONT-03, FONT-04, FONT-05, FONT-06, FONT-07 | PASS | `t0-foundation.spec.ts` (FONT-04 también en las pruebas SH) |
| TOK-01 | PASS | `static-checks.mjs` (22 hex, todos en la lista; 0 hex en reglas de componentes) |
| SH-01 … SH-09 | PASS | `t0-foundation.spec.ts` + `web/tests/shell.test.ts` |
| REC-01 | PASS | `git diff f0ed4bc -- web/src/transfer-attempt.ts` vacío |
| REC-02 (golden) | PASS | `../f0ed4bc/network-golden.json` grabado con `web/src` = `f0ed4bc`; en `a3bde6e` S1…S7 idénticos |
| RESP-01 en `/accounts` | PASS | 1440×960, R 1280×1030@1.25 (`w03_inicio_y_cuentas_corregido`, PNG 1600×1288), 768×1024, 390×844 |

Lado a lado W03 (`captures/W03-con-saldo-sbs.png`) es informativo: el contenido de W03 se rediseña en WF-T2.

## Reproducir

Desde la raíz del worktree, ver `commands.txt` y `docs/web-fidelity-final/ENVIRONMENT.md`
(`make-env` → `db-up` → Playwright con `WF_EVIDENCE_SHA=a3bde6e` → `db-down`). Las capturas se regeneran en
`docs/evidence/web-final/a3bde6e/captures/`.
