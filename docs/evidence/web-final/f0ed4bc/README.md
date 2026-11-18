# Evidencia · traza dorada REC-02 sobre el código Web de `f0ed4bc`

- **Código evaluado**: `web/src`, `web/index.html` idénticos a `f0ed4bc` (el test en modo registro falla si
  `git diff f0ed4bc -- web/src web/index.html web/public` o archivos sin seguimiento en `web/src`/`web/public`
  no están vacíos). Rama `feature/web-fidelity-final`, worktree con el arnés WF-T0 (sólo `web/e2e-final/**`
  y `cacheDir` en `web/vite.config.ts`, sin efecto en el bundle).
- **Archivo**: `network-golden.json` — por escenario S1…S7, peticiones **no-GET** con método, ruta (UUID → `:id`),
  clase de `Idempotency-Key` (`K1`, `K2`… = igualdad; `none` = sin cabecera), SHA-256 del cuerpo, `aborted`
  y `draftAfter` (estado del registro local al final, sin clave ni ids).
- **Método**: Playwright `[F]` con API simulada (`web/e2e-final/helpers/mock-api.ts`, `page.route('**/v1/**')`),
  build estática `web/dist/p1` servida en `127.0.0.1:5301`; la API P1 (3301) arranca pero no recibe tráfico de estos escenarios.
- **Salida**: `test-output.txt` (reporter list, 7/7 PASS).
- **Reproducir**: ver `commands.txt`. Las capturas/resultados de Playwright quedan en `captures/` (no versionado).
- Esta evidencia no es aceptación final.
