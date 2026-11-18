# Plan de tareas trazable

Estado 2026-11-14: diseño Stitch aprobado como referencia visual; tareas funcionales obligatorias `READY_FOR_IMPLEMENTATION`. Los bonus y despliegues no están autorizados. Tareas implementadas deben enlazar commits y evidencia reales; las políticas de demo no se convierten en políticas de producción.

| ID | Estado / etiqueta | Requisitos | Diseño | Criterios verificables / prueba esperada |
|---|---|---|---|---|
| DESIGN-01 | IN PROGRESS · infra/docs | W01–W14, M01–M12, todos REQ-* | `docs/design-mapping.md`, `docs/design/README.md` | Fuentes HTML/capturas inspeccionadas; assets faltantes/contradicciones/out-of-scope registrados; estado visual aprobado sin convertir claims demo en política. |
| API-CONTRACT-01 | IN PROGRESS · api/shared | REQ-AUTH, ACCT, BEN, XFER, LIMIT, HIST, QUAL | `specs/openapi.yaml`, `specs/design.md` | Contrato OpenAPI 3.1 válido, tipos shared reproducibles; auth/cookie/CSRF, idempotencia, `amountMinor`, cursor y Problem Details definidos antes de worktrees. |
| BOOT-00 | COMPLETADA · infra/api/web/mobile | BOOT-00-01..06 | SPEC BOOT-00, diseño inicial | Monorepo, health, DB aislada, scaffold, CI; no contaba como producto. |
| API-01 | READY_FOR_IMPLEMENTATION · api | REQ-AUTH-01..04, REQ-QUAL-01 | auth/seguridad y OpenAPI | Registro/login, hash, JWT corto, refresh rotativo/revocación, rate limit, authorization owner; PostgreSQL integration. |
| API-02 | READY_FOR_IMPLEMENTATION · api | REQ-ACCT-01..02, REQ-BEN-01..03 | ER/account/beneficiary | Cuenta auto al registro; saldo solo propio; CLABE checksum; beneficiario solo a cuenta interna; acceso ajeno no revela existencia. |
| API-03 | READY_FOR_IMPLEMENTATION · api | REQ-XFER-01..07, REQ-XFER-11 | ledger/concurrencia | PostgreSQL real: transacción, postings suma cero, saldo no negativo, mismo-account rejection, precisión; OTP simulado ligado al intento. |
| API-04 | READY_FOR_IMPLEMENTATION · api | REQ-XFER-08..10, REQ-XFER-09 | idempotencia | Mismo key/payload retorna resultado/intento, payload distinto 409, retry tras timeout recupera sin duplicar. |
| API-05 | READY_FOR_IMPLEMENTATION · api | REQ-LIMIT-01..02, REQ-QUAL-04 | locks/ventana diaria | Prueba PostgreSQL de límite concurrente y medianoche; valores demo por env, policy prod pendiente. |
| API-06 | READY_FOR_IMPLEMENTATION · api | REQ-HIST-01,03,04; REQ-QUAL-02..04 | esquema/índices/auditoría | Cursor estable; seed test >=100k y EXPLAIN ANALYZE real; audit append-only; 100 transferencias simultáneas. |
| WEB-01 | READY_FOR_IMPLEMENTATION · web | REQ-AUTH-01..02, REQ-ACCT-01 | W01/W02/W03 | Registro/login/cookie segura; Testing Library/Playwright y sesión real. |
| WEB-02 | READY_FOR_IMPLEMENTATION · web | REQ-ACCT-01, REQ-HIST-01..02 | W03/W04/W05 | Cuentas e historial/filtros/cursor/detalle, estados, teclado/labels/responsive. |
| WEB-03 | READY_FOR_IMPLEMENTATION · web/api | REQ-BEN-01..03 | W06/W07 | Alta/validación CLABE/listado real, destino interno, aislamiento. |
| WEB-04 | READY_FOR_IMPLEMENTATION · web/api | REQ-XFER-01..08, REQ-XFER-05 | W08–W14 | Confirmación, idempotency key, OTP, doble click, recuperación y saldo insuficiente; Testing Library + Playwright. |
| WEB-05 | EXCLUIDA · bonus opcional no autorizado · web | REQ-BONUS-01 | — | No implementar export de estado mensual. |
| MOBILE-01 | READY_FOR_IMPLEMENTATION · mobile | REQ-AUTH-02,05; REQ-ACCT-01 | M01/M02/M12 | Login, SecureStore, no AsyncStorage, cuentas reales y obscured state en background. |
| MOBILE-02 | READY_FOR_IMPLEMENTATION · mobile | REQ-ACCT-01, REQ-HIST-04 | M02–M04 | Saldo, últimos 20 y detalle real; online/offline en simulador/dispositivo. |
| MOBILE-03 | READY_FOR_IMPLEMENTATION · mobile/api | REQ-XFER-01,09..11 | M05–M11 | Beneficiario web registrado, revisión/OTP, red cortada, misma key y estado real; sin duplicado. |
| MOBILE-04 | EXCLUIDA · bonus opcional no autorizado · mobile | REQ-BONUS-03 | — | Sin biometría en esta entrega. |
| QA-01 | READY_FOR_IMPLEMENTATION · infra/api/web/mobile | REQ-QUAL-03..06 | Suites | CLABE, idempotencia, límite, saldo, 100 concurrentes, ledger/auditoría, Testing Library, Playwright/responsive, red móvil, EXPLAIN 100k; ningún mock como evidencia de integración. |
| AWS-01 | NO INCLUIDA EN ESTA FASE · infra | Challenge Fase 4 | `docs/aws-deploy.md` | No desplegar AWS; propuesta escrita no se incluye en esta iteración de producto. |

## Historial de commits

BOOT-00-00 (specs previas al scaffold) y tareas de implementación deben usar commits distintos con IDs, por ejemplo `docs(BOOT-00): add initial specifications`, `build(BOOT-00): add isolated workspace scaffold`. Completar el mapa SHA → tarea → comandos de verificación una vez creados los commits; no inventar commits futuros.

| Tarea | Commit(s) | Evidencia asociada |
|---|---|---|
| BOOT-00-00 · especificaciones previas al scaffold | `839bb38` `docs(BOOT-00): add challenge specs and forge plan` | Archivos fuente/specs/Forge; OpenAPI parseado YAML antes de scaffold. |
| BOOT-00 · scaffold workspace, clientes mínimos, versiones y documentación | `4c5be10` `build(BOOT-00): add reproducible workspace scaffold`; `61280ce` `build(BOOT-00): expose planned OpenAPI reference` | `npm ci`, lint/typecheck/test/build; Redoc de contrato planeado y health-only. |
| BOOT-00 · API base, Compose aislado y QA/CI | `aa5b769` `build(BOOT-00): add API health and isolated database QA` | `npm run qa:bootstrap`; health/Problem Details; guard DB; PostgreSQL integration; workflow CI. |
| BOOT-00 · informe de evaluación/trazabilidad | `26fec66` `docs(BOOT-00): record forge evaluation evidence` | `FINDINGS.md`, `docs/forge-evidence.md`, bitácora AI y este mapa SHA/tarea. |
| BOOT-00-FU01 · actualizar pins Expo/Node, añadir inspección Playwright y estabilizar OpenAPI bajo Node fijado | `a5de82b` `build(BOOT-00): align runtime and verify web in Chromium` | `npx expo install --check`; `npm run test:visual`; lint/typecheck/tests/build/OpenAPI/QA en Node 26.13.1; F-02 verificado visualmente en seguimiento sin cambiar findings históricos. |
| BOOT-00-FU02 · documentar versiones, advisories y evidencia del seguimiento | `235e20b` `docs(BOOT-00): record compatibility and browser follow-up` | `docs/dependency-review.md`, `docs/boot-00-followup.md`, revisión oficial de compatibilidad y clasificación de auditoría. |

Los hashes completos quedan en `git log`; pruebas/evaluación referidas a un SHA se identifican expresamente en `FINDINGS.md` y en el reporte final. El commit de documentación no incluye ni afirma futuros commits de producto.
