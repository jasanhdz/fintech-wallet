# Evidencia UX-T0 · cierre · código `3d04a16`

Línea base «antes», métricas, mapa de lecturas y suites completas en la línea base: `../cc5d489/`.

| Criterio | Resultado | Evidencia |
|---|---|---|
| T0-01 | HEAD `cc5d489` (= `0cf8257` + SPEC), árbol limpio | `../cc5d489/t0-01-head.txt` |
| T0-02 / ENV-01 / ENV-03 | preflight PASS con 3411, 5411 y `fintech-wallet-review-pg` en la lista de prohibidos; 3.42 GiB libres y `docker system df` antes del volumen | `preflight.txt`, `../cc5d489/env-01-disk.txt` |
| T0-03 | `t5-confirm-result.spec.ts` P1: 51 PASS, 0 fallos, 0 omitidas (en `cc5d489` fallaban 5: nombre accesible del botón de W11 enviando y pegado en W10; corregidos sólo en presentación) | `test-output.txt` |
| T0-04 | `t5-integration.spec.ts` P1+P3: 3 PASS (W10 correcto/incorrecto→W12, «Ver movimientos», W11 respuesta perdida, P3 expirado y agotados) | `test-output.txt` |
| T0-05 / NET-01 | `golden.spec.ts` S1…S7: `diffTraces` vacío contra `f0ed4bc` | `network-traces.json`, `test-output.txt` |
| T0-06 / NET-03 | correcciones sólo en `web/src/transfer-screens.tsx` (presentación) y en pruebas; diffs de red vacíos | `net-static.txt` |
| T0-07 | 408 capturas «antes» + `metrics.json` con todos los helpers §5.10 | `../cc5d489/` |
| T0-08 | `network-reads.json` por escenario; `final` 255/256 y `legacy` 10/10 en la línea base (único fallo: carrera de la prueba P3, corregida) | `../cc5d489/` |
