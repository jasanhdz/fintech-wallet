# BOOT-00 — seguimiento posterior al ciclo Forge

Este documento registra las verificaciones posteriores solicitadas después de que el ciclo Forge original terminara en pass 3/3. No altera ni reescribe `FINDINGS.md` ni presenta estos resultados como una cuarta pasada Forge. No autoriza fases financieras: estado de producto y Stitch permanece `DESIGN_REVIEW_REQUIRED`.

## Identidad y GitHub

- GitHub API validada con `gh api user`: `jasanhdz`. `gh auth status` muestra también `jasanhdz-isol` como cuenta autenticada inactiva; se seleccionó `jasanhdz` sin borrar sus credenciales.
- El repositorio `jasanhdz/fintech-wallet` no existía al consultar la API (404). Se creó privado y se verificó metadata `isPrivate: true`, URL `https://github.com/jasanhdz/fintech-wallet`.
- `origin` usa SSH personal probado: `git@github.com-personal:jasanhdz/fintech-wallet.git`.
- Se publicó `main` sin force y con el historial completo. Primer SHA publicado/CI verificado: `3a8d5458a441f1d2209228a6857bcf16dd2a2b80`, coincidente entre HEAD local, GitHub API y `git ls-remote`.
- GitHub Actions `bootstrap-ci`, ejecución [43551752866](https://github.com/jasanhdz/fintech-wallet/actions/runs/43551752866), concluyó `success` para `main` y ese SHA. Pasaron `npm ci`, lint, typecheck, tests, Chromium smoke, PostgreSQL test aislada, builds y OpenAPI check. GitHub anotó advertencias no bloqueantes por acciones v4 ejecutándose en Node 24 bajo compatibilidad forzada (deprecación de Node 20) y la migración del runner `ubuntu-latest` a Ubuntu 26; las acciones completaron correctamente.
- Este registro requerirá un commit/push de documentación; la verificación final repetirá CI contra el SHA resultante antes de cerrar el seguimiento.

## Corrección de F-02 por inspección de navegador

- Se añadió `@playwright/test` `1.65.1` como dependencia de desarrollo fijada y un smoke test del scaffold en `web/e2e/bootstrap.spec.ts`. El test abre `/` en Chromium, comprueba HTTP 200, título, mensaje exacto de preparación y cero errores `console`/`pageerror`.
- Chromium se instaló en la caché de usuario, fuera del repositorio (no se añadieron binarios). Comando ejecutado: `npx playwright install chromium`.
- Comando: `npm run test:visual`. Resultado observado: 1 test aprobado en Chromium, `web preparation message renders without browser console errors`, render visible `Entorno preparado. Diseño pendiente`; sin errores de consola/errores de página.
- La inspección solo cubre web BOOT-00. No prueba pantallas de producto, flujos financieros, dispositivo móvil ni aprobación de diseño.
- Se añadió ejecución del mismo smoke browser al workflow CI, independiente de `qa:bootstrap` para no confundir control automatizado con inspección visual.
- Resultado registrado en seguimiento de 2026-11-14; no se altera el F-02 abierto del `FINDINGS.md` original, que representa su pasada histórica sin navegador.

## Compatibilidad y advisories

Ver [`dependency-review.md`](dependency-review.md): Expo cambió a versiones recomendadas por `expo install --check`; el pin Node pasa de 26.3.0 a 26.13.1 (rama LTS vigente). Se clasifican cadenas npm y se dejan pendientes solo las correcciones sin versión compatible comprobada. No se usó `npm audit fix --force`.

## Compatibilidad de herramientas y controles

- Cambios de seguimiento en `a5de82b` (`build(BOOT-00): align runtime and verify web in Chromium`); documentación/auditados de dependencias en commits documentales posteriores.
- Al ejecutar el validador OpenAPI bajo Node 26.13.1, `npx` interno devolvió `EUSAGE`; se cambió el script para invocar los binarios fijados de `node_modules/.bin`. Después pasó `openapi:validate`, `openapi:check` y `qa:bootstrap` con Node 26.13.1.
- `npm run lint`, `npm run typecheck`, `npm test` (API 2, web 1, mobile 1), `npm run test:visual` (Chromium 1), `npm run build` (API/web/Expo Android+iOS), OpenAPI, Redoc y QA bootstrap pasaron con Node 26.13.1. QA bootstrap reportó 13 PASS/0 FAIL/0 BLOCKED; la inspección visual se informa por separado.
- PostgreSQL `wallet_test` pasó integración (1/1) con roles aislados; no se operó Docker en este seguimiento y no se tocaron contenedores/volúmenes/archivos de Lucem.
