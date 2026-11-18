# Plan de tareas trazable

Estado 2026-11-14: diseño Stitch aprobado como referencia visual; tareas funcionales obligatorias `READY_FOR_IMPLEMENTATION`. Los bonus y despliegues no están autorizados. Tareas implementadas deben enlazar commits y evidencia reales; las políticas de demo no se convierten en políticas de producción.

| ID | Estado / etiqueta | Requisitos | Diseño | Criterios verificables / prueba esperada |
|---|---|---|---|---|
| PLATFORM-01 | COMPLETE · infra/api/web/mobile/shared | BOOT-00 workspace; REQ-QUAL-01/03/06 | Node/Expo compatibility, local crypto config, unit/integration/E2E harness | Exact dependencies and lockfile; Expo check; shared schema/money tests; isolated Postgres migration/E2E and Playwright visual configs. Coordinator-owned; no app behavior included. |
| DESIGN-01 | COMPLETE · infra/docs | W01–W14, M01–M12, todos REQ-* | `docs/design-mapping.md`, `docs/design/README.md` | Fuentes HTML/capturas inspeccionadas; assets faltantes/contradicciones/out-of-scope registrados; estado visual aprobado sin convertir claims demo en política. |
| API-CONTRACT-01 | COMPLETE · api/shared | REQ-AUTH, ACCT, BEN, XFER, LIMIT, HIST, QUAL | `specs/openapi.yaml`, `specs/design.md` | Contrato OpenAPI 3.1 válido, tipos shared reproducibles; auth/cookie/CSRF, idempotencia, `amountMinor`, cursor y Problem Details definidos antes de worktrees. |
| BOOT-00 | COMPLETADA · infra/api/web/mobile | BOOT-00-01..06 | SPEC BOOT-00, diseño inicial | Monorepo, health, DB aislada, scaffold, CI; no contaba como producto. |
| API-01 | COMPLETE · api | REQ-AUTH-01..04, REQ-QUAL-01 | auth/seguridad y OpenAPI | Registro/login, hash, JWT/refresh/revocación, rate limit, owner; PostgreSQL integration. Commits `4136931`, `64ece86`, `baa4be4`. |
| API-02 | COMPLETE · api | REQ-ACCT-01..02 | ER/accounts | Cuenta auto al registro, fixture dev de dos cuentas/contra-postings, saldo owner-scoped, 404 genérico, privilegios runtime. Seed local idempotente verificado dos veces; commit `0424f38` soporta `{ rows }` de `pg` y arreglos TypeORM. |
| API-03 | COMPLETE · api | REQ-BEN-01..03 | W06/W07, CLABE/ownership | `e173322`: PostgreSQL real, checksum/cifrado/HMAC, solo destino interno, duplicados y aislamiento; migración y prueba integración. 5/5 integración en rama integrada. |
| API-04 | READY_FOR_IMPLEMENTATION · api | REQ-XFER-01..07, REQ-XFER-11 | ledger/concurrencia | PostgreSQL real: transacción, postings suma cero, saldo no negativo, mismo-account rejection, precisión, OTP ligado al intento. |
| API-05 | READY_FOR_IMPLEMENTATION · api | REQ-XFER-08..10, REQ-XFER-09 | idempotencia | Mismo key/payload retorna resultado/intento, payload distinto 409, retry tras timeout recupera sin duplicar. |
| API-06 | READY_FOR_IMPLEMENTATION · api | REQ-LIMIT-01..02, REQ-QUAL-04 | locks/ventana diaria | Prueba PostgreSQL de límite concurrente y medianoche; valores demo por env, policy prod pendiente. |
| API-07 | READY_FOR_IMPLEMENTATION · api | REQ-HIST-01,03,04; REQ-QUAL-02..04 | esquema/índices/auditoría | Cursor estable; seed test >=100k y EXPLAIN ANALYZE real; audit append-only; 100 transferencias simultáneas. |
| WEB-01 | COMPLETE · web | REQ-AUTH-01..02, REQ-ACCT-01 | W01/W02/W03 | Registro/login/cookie segura, refresh bootstrap/rotation, cuentas/saldos API reales; Playwright E2E register/login/logout/reload con PostgreSQL wallet_test. Commits `9a3a6cc`, `b658add`, `3ca0a75`, `6977ed1`. |
| WEB-02 | READY_FOR_IMPLEMENTATION · web | REQ-HIST-01..02 | W04/W05 | Historial/filtros/cursor/detalle/recibo interno, estados, teclado/labels/responsive. |
| WEB-03 | COMPLETE · web/api | REQ-BEN-01..03 | W06/W07 | `356d3e8`: directorio/alta real con búsqueda, validación, estados y accesibilidad. Playwright real registro/alta/CLABE inválida/masking 2/2; commits E2E `1c33ac4`, `e45ae9c`, `413c012`. |
| WEB-04 | READY_FOR_IMPLEMENTATION · web/api | REQ-XFER-01..08, REQ-XFER-05 | W08–W14 | Confirmación, idempotency key, OTP, doble click, recuperación y saldo insuficiente; Testing Library + Playwright. |
| WEB-05 | EXCLUIDA · bonus opcional no autorizado · web | REQ-BONUS-01 | — | No implementar export de estado mensual. |
| MOBILE-01 | CODE INTEGRATED · DEVICE E2E BLOCKED · mobile | REQ-AUTH-02,05; REQ-ACCT-01 | M01/M02/M12 | Login, SecureStore, no AsyncStorage, cuentas API, obscured state y revocación servidor best-effort al salir. Typecheck/Jest/Expo exports pasan; no hay simctl ni adb para recorrido nativo. Commits `e2280e5`, `8c7e99e`. |
| MOBILE-02 | READY_FOR_IMPLEMENTATION · mobile | REQ-ACCT-01, REQ-HIST-04 | M03/M04 | Últimos 20 movimientos y detalle real; offline/error en simulador/dispositivo. |
| MOBILE-03 | M05 COMPLETE · TRANSFER PENDING · mobile/api | REQ-XFER-01,09..11 | M05–M11 | `7eaa64f`: selector nativo real de beneficiarios web, búsqueda y selección provisional; faltan datos/revisión/OTP, retry same key y flujo transferencias Fase 3. Sin device E2E. |
| MOBILE-04 | EXCLUIDA · bonus opcional no autorizado · mobile | REQ-BONUS-03 | — | Sin biometría en esta entrega. |
| QA-01 | READY_FOR_IMPLEMENTATION · infra/api/web/mobile | REQ-QUAL-03..06 | Suites | CLABE, idempotencia, límite, saldo, 100 concurrentes, ledger/auditoría, Testing Library, Playwright/responsive, red móvil, EXPLAIN 100k; ningún mock como evidencia de integración. |
| AWS-01 | NO INCLUIDA EN ESTA FASE · infra | Challenge Fase 4 | `docs/aws-deploy.md` | No desplegar AWS; propuesta escrita no se incluye en esta iteración de producto. |

## Historial de commits

BOOT-00-00 (specs previas al scaffold) y tareas de implementación deben usar commits distintos con IDs, por ejemplo `docs(BOOT-00): add initial specifications`, `build(BOOT-00): add isolated workspace scaffold`. Completar el mapa SHA → tarea → comandos de verificación una vez creados los commits; no inventar commits futuros.

| Tarea | Commit(s) | Evidencia asociada |
|---|---|---|
| DESIGN-01 · inspección y mapa de diseño | `f4c520a`, `63ad4ba` | `docs/design-mapping.md`; 81 HTML y 69 capturas disponibles inspeccionadas; faltantes/out-of-scope mapeados. |
| API-CONTRACT-01 · OpenAPI y tipos compartidos | `bb73c3c` | `specs/openapi.yaml` OpenAPI 3.1; `openapi:validate`, `openapi:check` y generación type-safe shared. |
| PRODUCT-SPEC-01 · Forge Planner | `b7cfa69` | `SPEC.md` producto con 20 criterios, después de contrato/docs y antes de código. |
| PLATFORM-01 · herramientas y contratos compartidos | `9675b79` | `npm ci`, 4 shared tests, typecheck, OpenAPI y Expo compatibility; tres `npm ci` worktrees independientes. |
| API-01/API-02 + WEB-01 + MOBILE-01 · entrega vertical 1 | `4136931`, `64ece86`, `9a3a6cc`, `b658add`, `e2280e5`, `baa4be4`, `3ca0a75`, `6977ed1`, `8c7e99e`; integraciones `9f7cf97`, `1f1321c`, `b3b8394`, `82626a4`, `c97a07a` | API/PostgreSQL fase 1, web register/login/accounts E2E real, mobile login/accounts código integrado; no se marca device E2E. |
| API-02 · compatibilidad e idempotencia del seed local | `6a1b03e`, `6a7d1be`, `0424f38` | Seed dev acepta resultados `{ rows }` de `pg` o arreglos TypeORM; `npm run db:seed` dos veces consecutivas. Pruebas de integración aisladas en `wallet_test`. |
| Fase 2 · API-03, WEB-03, M05 | Backend `e173322`; Web `356d3e8`, `1c33ac4`, `e45ae9c`, `413c012`; Mobile `7eaa64f`; merges coordinador en historial Git | API beneficiarios cifrada/interna/owner-scoped; Playwright con API/PostgreSQL reales, alta y CLABE inválida; selector M05 nativo integrado en código, sin device E2E. |
| BOOT-00-00 · especificaciones previas al scaffold | `839bb38` `docs(BOOT-00): add challenge specs and forge plan` | Archivos fuente/specs/Forge; OpenAPI parseado YAML antes de scaffold. |
| BOOT-00 · scaffold workspace, clientes mínimos, versiones y documentación | `4c5be10` `build(BOOT-00): add reproducible workspace scaffold`; `61280ce` `build(BOOT-00): expose planned OpenAPI reference` | `npm ci`, lint/typecheck/test/build; Redoc de contrato planeado y health-only. |
| BOOT-00 · API base, Compose aislado y QA/CI | `aa5b769` `build(BOOT-00): add API health and isolated database QA` | `npm run qa:bootstrap`; health/Problem Details; guard DB; PostgreSQL integration; workflow CI. |
| BOOT-00 · informe de evaluación/trazabilidad | `26fec66` `docs(BOOT-00): record forge evaluation evidence` | `FINDINGS.md`, `docs/forge-evidence.md`, bitácora AI y este mapa SHA/tarea. |
| BOOT-00-FU01 · actualizar pins Expo/Node, añadir inspección Playwright y estabilizar OpenAPI bajo Node fijado | `a5de82b` `build(BOOT-00): align runtime and verify web in Chromium` | `npx expo install --check`; `npm run test:visual`; lint/typecheck/tests/build/OpenAPI/QA en Node 26.13.1; F-02 verificado visualmente en seguimiento sin cambiar findings históricos. |
| BOOT-00-FU02 · documentar versiones, advisories y evidencia del seguimiento | `235e20b` `docs(BOOT-00): record compatibility and browser follow-up` | `docs/dependency-review.md`, `docs/boot-00-followup.md`, revisión oficial de compatibilidad y clasificación de auditoría. |

Los hashes completos quedan en `git log`; pruebas/evaluación referidas a un SHA se identifican expresamente en `FINDINGS.md` y en el reporte final. El commit de documentación no incluye ni afirma futuros commits de producto.
