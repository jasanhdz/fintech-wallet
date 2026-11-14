# Findings — pass 3 (final)

## Resumen

9/10 criterios del rubric pasan. El criterio #10 queda BLOCKED únicamente respecto a la inspección visual: Playwright no está instalado y no se instaló navegador. F-01 se conserva resuelto, verificado contra PostgreSQL real. No se declara QA PASS global por la limitación visual. Pasada 3/3; evaluación final.

SHA exacto evaluado: `61280cefa9f973c57d1a461368bcfb6a806389e6` (`HEAD`, rama `main`). Fecha exacta de cierre: `2026-11-14T02:43:11Z` UTC. Los headers HTTP observados llevan fecha `Sat, 14 Nov 2026 02:43:04 GMT`.

| # | Criterio | Estado | Evidencia de esta pasada |
|---|---|---|---|
| 1 | Workspaces y runtime | PASS | `node --version`/`npm --version`, `.nvmrc`, engines y cuatro workspaces fueron comprobados en pass 2. `npm ci` no se repitió en pass 2 porque ya había pasado en pass 1 sobre el mismo SHA y no había necesidad de reinstalar; no fue por prohibición del usuario. En pass 3 no se repitió `npm ci`; se usaron las dependencias locales existentes. |
| 2 | Scaffold ejecutable | PASS | Pass 3: `npm run lint && npm run typecheck && npm test && npm run build` terminó con código 0. Tests: API 2/2, web 1/1, móvil 1/1; builds API/web y export Expo Android/iOS completados. |
| 3 | Stack y límites | PASS | Se conserva verificación de manifests/config y alcance BOOT-00 registrada en pass 2; historial/spec-first revisados en pass 3. HEAD agrega documentación Redoc planificada, sin cambiar autorización de producto ni implementar endpoints. |
| 4 | Aislamiento de base de datos | PASS | Pass 3: `DATABASE_URL='postgres://wallet_runtime_dev:dev_runtime_local_only@localhost:55432/wallet_dev' TEST_DATABASE_URL='postgres://wallet_runtime_test:test_runtime_local_only@localhost:55432/wallet_test' npm --workspace @fintech-wallet/api run test:db` terminó con código 0; prueba de conexión como `wallet_runtime_test` a `wallet_test` y ausencia de tablas de negocio pasó (1/1). `fintech-wallet-postgres-1` estaba healthy en `55432`; `lucem-retail-db-1` permaneció activo, sin intervención. No se ejecutó down/reset. |
| 5 | Migraciones sin sincronización automática | PASS | Verificación de configuración y comandos DB de pass 2: `synchronize: false`, sin migraciones/entidades de negocio y sin DROP/TRUNCATE en init. |
| 6 | Health y request ID | PASS | Pass 3: con `npm run dev` temporal, `curl -si -H 'X-Request-Id: evaluator-pass3-20261113' http://127.0.0.1:3000/health` devolvió HTTP 200 y `{"status":"ok","requestId":"evaluator-pass3-20261113"}`; header coincidió. `curl -si http://127.0.0.1:5173/` devolvió HTTP 200 y HTML del scaffold. |
| 7 | Error RFC 7807 | PASS | Pass 3: `curl -si http://127.0.0.1:3000/__evaluator_missing_route` devolvió HTTP 404, `Content-Type: application/problem+json; charset=utf-8`, campos `type`, `title`, `status`, `instance`, `requestId`; no se observó stack trace ni secreto. |
| 8 | OpenAPI y tipos compartidos | PASS | Pass 3: `npm run openapi:validate && npm run openapi:check` terminó con código 0; ambos contratos validan y tipos generados reproducibles. Redoc: `npm run docs:api` generó `docs/api-reference.html` (291 KiB), título `Fintech Wallet API — PLANNED, NOT IMPLEMENTED`; el documento embebido contiene rutas propuestas de producto, no se implementan en servidor. `npm run docs:bootstrap-api` generó `docs/bootstrap-api-reference.html` (278 KiB), título `Fintech Wallet BOOT-00 API — HEALTH ONLY, NOT IMPLEMENTED`; definición embebida limitada a `/health` y fallback `/{unmatchedPath}`. |
| 9 | CI | PASS | Workflow revisado en pass 2: instalación reproducible y checks del criterio 2, sin deploy/publicación. No se afirma ejecución remota de CI. |
| 10 | Ausencia de producto y condición de parada | BLOCKED | Revisión de código/specs heredada del pass 2 confirma BOOT-00 y tareas futuras `DESIGN_REVIEW_REQUIRED`. `npm ls playwright @playwright/test --depth=0` en pass 2 no encontró Playwright; en pass 3 no se instaló Playwright ni browser. HTML web devolvió HTTP 200, pero no sustituye verificación visual. No afirmar conformidad visual de UI web o móvil. |

Arranque temporal de `npm run dev` permitió comprobar API y web y fue detenido al terminar; `pgrep -af 'tsx watch src/server.ts|vite|concurrently'` no dejó procesos de app vivos (la comprobación final de `ps -p 93151` no encontró proceso). Ambos contenedores DB siguieron activos. Los comandos Redoc generaron los dos HTML locales; no se incorporan al historial de Git. `npm ci` se autorizó expresamente; no se repitió porque no era necesario, dado el pass satisfactorio previo.

Historial spec-first confirmado con `git log --oneline -4`: `839bb38 docs(BOOT-00): add challenge specs and forge plan` → `4c5be10 build(BOOT-00): add reproducible workspace scaffold` → `aa5b769 build(BOOT-00): add API health and isolated database QA` → `61280ce build(BOOT-00): expose planned OpenAPI reference`. SPEC documental precede scaffold y la revisión actual coincide con el último commit esperado.

Estado Git observado: modificaciones preexistentes en `docs/forge-evidence.md`, `specs/ai-log.md` y `specs/tasks.md`, preservadas; `FINDINGS.md` era untracked al inicio de esta evaluación. No se modificaron archivos de producto. El contenedor `lucem-retail-db-1` no se tocó ni detuvo.

## Abiertos

- [ ] F-02 · minor · criterio #10 — falta inspección visual de UI con Playwright. No disponible localmente; verificados HTTP y revisión estática únicamente. No atribuir al usuario prohibición de instalar dependencias: la instalación fue autorizada, pero no se necesitó repetir `npm ci` y no se instaló Playwright/browser en esta pasada.

## Resueltos (verificados este pass)

- [x] F-01 · criterio #4 — verificada en pass 3 la conexión real independiente como `wallet_runtime_test` a `wallet_test`, sin tablas de negocio. DB de wallet continuó activa en `55432`; `lucem-retail-db-1` quedó activo y sin intervención.
- [x] Criterios #1–#9 — criterios aprobados con la evidencia de pass 2 y los comandos/evidencia adicional de pass 3 especificados arriba; ninguna comprobación se marca PASS sin evidencia registrada.
