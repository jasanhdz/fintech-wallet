# Evidencia UX-T0 · línea base «antes» · código `cc5d489`

`cc5d489` = `0cf8257` + `docs/web-ux-polish/SPEC.md` (sin cambios de código; `t0-01-head.txt`). Generator de UX-T0;
**no es aceptación**: la evaluación la hace el Evaluator.

| Archivo | Contenido |
|---|---|
| `t0-01-head.txt` | SHA y `git status` al inicio (T0-01) |
| `env-01-disk.txt`, `preflight.txt`, `env-summary.txt` | `df` + `docker system df` antes del volumen, preflight PASS (T0-02, ENV-01/03) |
| `commands.txt` | comandos y resultados |
| `test-output-final-baseline.txt` | suite `final` completa (P1–P4) en la línea base: 255 PASS, 1 FAIL (carrera en la prueba P3, corregida en UX-T0) |
| `test-output-legacy-baseline.txt` | `legacy` en dos invocaciones: 8 + 2 PASS |
| `metrics.json`, `metrics-summary.md` | helpers §5.10 por escenario × viewport, fase «antes» (T0-07) |
| `captures-manifest.tsv` | 408 capturas «antes» (51 escenarios §7.4 × 7 viewports + zoom 200 %), sha256; PNG en `captures/ux/antes/` (no versionados) |
| `network-reads.json` | plantillas `(método, ruta)` de todas las peticiones por escenario (T0-08, línea base de NET-02) |
| `network-traces.json` | traza no-GET de `golden.spec.ts` en la línea base: idéntica a `../../web-final/f0ed4bc/network-golden.json` |
| `suite-metrics.json`, `suite-captures-manifest.tsv` | métricas/capturas propias de las suites t0…t5 |

Hallazgos de la verificación en navegador de WF-T5 (W10/W11/W12) y su corrección: ver `commands.txt` y la evidencia del
commit de cierre de UX-T0.
