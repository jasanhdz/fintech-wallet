# Plan de tareas trazable

Estados: BOOT-00 puede ejecutarse ahora. Toda tarea de producto es `PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED`; crear directorios o contrato no la completa. Una tarea implementada se vincula a commits por mensaje verificable y pruebas; los hashes finales se agregan tras los commits, nunca se auto-referencian dentro del mismo commit.

| ID | Estado / etiqueta | Requisitos | Diseño | Criterios verificables / prueba esperada |
|---|---|---|---|---|
| BOOT-00 | EN CURSO · infra/api/web/mobile | BOOT-00-01..06 | SPEC rubric, design arquitectura, docs | Monorepo reproducible; health + RFC7807; DB test aislada; validación OpenAPI; scaffold web/móvil; CI; no producto. Commit documental antes de scaffold. |
| API-01 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · api | REQ-AUTH-01..04, REQ-QUAL-01 | auth, seguridad | Pruebas unit/integración de registro, JWT/refresh, hash/rate limit, autorización y Problem Details. |
| API-02 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · api | REQ-ACCT-01..02, REQ-BEN-01..03 | ER, seguridad | PostgreSQL real: ownership, CLABE verificador y acceso ajeno denegado. |
| API-03 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · api | REQ-XFER-01..07, REQ-XFER-11 | dinero/concurrencia | Integración con asientos balanceados, sin saldo negativo, mismo origen, precisión, OTP ligado al intento. |
| API-04 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · api | REQ-XFER-08..10, REQ-XFER-09 | idempotencia | Repetición igual devuelve mismo resultado, payload distinto conflictúa, retry tras timeout no duplica. |
| API-05 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · api | REQ-LIMIT-01..02, REQ-QUAL-04 | locks/ventana diaria | PostgreSQL real: límites concurrentes y casos a ambos lados de medianoche en zona aprobada. |
| API-06 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · api | REQ-HIST-01,03,04; REQ-QUAL-02..04 | esquema/índices | Cursor estable; seed >=100,000; adjuntar EXPLAIN ANALYZE real; auditoría append-only. |
| WEB-01 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · web | REQ-AUTH-01..02, REQ-ACCT-01 | auth web pendiente | Pruebas Testing Library/Playwright de registro/login/sesión y estados. |
| WEB-02 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · web | REQ-ACCT-01, REQ-HIST-01..02 | pantallas/errores | Cuentas e historial, filtros/cursor, estados, teclado, etiquetas y accesibilidad. |
| WEB-03 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · web/api | REQ-BEN-01..03 | CLABE/ownership | Alta/validación CLABE y aislamiento de recursos, pruebas integración + UI. |
| WEB-04 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · web/api | REQ-XFER-01..08, REQ-XFER-05 | idempotencia/UI | Flujo confirmación/recibo, doble clic, botón bloqueado, error de saldo insuficiente en Testing Library. |
| WEB-05 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · web | REQ-BONUS-01 | exportación | Export CSV/PDF mensual opcional, permisos y contenido verificados. |
| MOBILE-01 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · mobile | REQ-AUTH-02,05; REQ-ACCT-01 | auth segura | Login, sesión en SecureStore, sin tokens AsyncStorage, protección de background verificada en dispositivo. |
| MOBILE-02 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · mobile | REQ-ACCT-01, REQ-HIST-04 | pantallas | Saldo y últimos 20 movimientos; estados online/offline en dispositivo/simulador. |
| MOBILE-03 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · mobile/api | REQ-XFER-01,09..11 | idempotencia/red | Cortar red a mitad de envío, retry con misma key, confirmar estado real sin duplicado; prueba red móvil. |
| MOBILE-04 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · mobile | REQ-BONUS-03 | seguridad local | Biometría opcional probada en dispositivo compatible. |
| QA-01 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · infra/api/web/mobile | REQ-QUAL-03..06 | suites QA | CLABE, idempotencia, límite diario, saldo no negativo, 100 transferencias simultáneas, ledger/auditoría, Testing Library, Playwright, red móvil y EXPLAIN de 100k; no mocks que simulen aprobación. |
| AWS-01 | PENDIENTE · BLOCKED: DESIGN_REVIEW_REQUIRED · infra | Reto Fase 4 | docs/aws-deploy.md | Propuesta completa de cómputo, DB, web, móvil, observabilidad/auditoría, CI/CD/OIDC, pools/RDS Proxy, crecimiento 100x e IaC; no desplegar. |

## Historial de commits

BOOT-00-00 (specs previas al scaffold) y tareas de implementación deben usar commits distintos con IDs, por ejemplo `docs(BOOT-00): add initial specifications`, `build(BOOT-00): add isolated workspace scaffold`. Completar el mapa SHA → tarea → comandos de verificación una vez creados los commits; no inventar commits futuros.

| Tarea | Commit(s) | Evidencia asociada |
|---|---|---|
| BOOT-00-00 · especificaciones previas al scaffold | `839bb38` `docs(BOOT-00): add challenge specs and forge plan` | Archivos fuente/specs/Forge; OpenAPI parseado YAML antes de scaffold. |
| BOOT-00 · scaffold workspace, clientes mínimos, versiones y documentación | `4c5be10` `build(BOOT-00): add reproducible workspace scaffold`; `61280ce` `build(BOOT-00): expose planned OpenAPI reference` | `npm ci`, lint/typecheck/test/build; Redoc de contrato planeado y health-only. |
| BOOT-00 · API base, Compose aislado y QA/CI | `aa5b769` `build(BOOT-00): add API health and isolated database QA` | `npm run qa:bootstrap`; health/Problem Details; guard DB; PostgreSQL integration; workflow CI. |
| BOOT-00 · informe de evaluación/trazabilidad | `26fec66` `docs(BOOT-00): record forge evaluation evidence` | `FINDINGS.md`, `docs/forge-evidence.md`, bitácora AI y este mapa SHA/tarea. |

Los hashes completos quedan en `git log`; pruebas/evaluación referidas a un SHA se identifican expresamente en `FINDINGS.md` y en el reporte final. El commit de documentación no incluye ni afirma futuros commits de producto.
