# Registro de fases — fintech-wallet

Este registro separa el trabajo histórico BOOT-00 del ciclo de producto. No es una autoaprobación final.

## BOOT-00 — preparado/publicado

- HEAD publicado en `main` al cerrar BOOT-00: `bfb3ad260f940ab7dd9c1df4511428a307859749`.
- Repo privado `jasanhdz/fintech-wallet`; CI BOOT-00 verde.
- Se conservó el reporte anterior de Forge en `docs/forge/BOOT-00-FINDINGS.md`; ese resultado histórico 3/3 no se reutiliza como evaluación del producto.
- Esta fase inicial solo implementó `GET /health`, scaffold técnico y placeholder de web/móvil; no creó datos/esquema financiero.

## Revisión de Stitch y autorización de producto — aprobada

- Fecha: 2026-11-14. El usuario aprobó los diseños web/móvil como referencia visual y autorizó el producto obligatorio del challenge.
- Inspección: 59 exports HTML web y 22 mobile; 47 capturas web, 22 capturas mobile. Se abrieron las 69 capturas disponibles y se inspeccionó el HTML de todas las 81 variantes.
- Faltan capturas web en 12 variantes: las ocho W07, W09 traspaso entre propias y W10 código incorrecto, expirado y verificando. W12 own-account HTML carece de markup aunque su PNG existe. Ninguna captura móvil falta.
- Decisión de alcance: solo transferencias internas; se excluyen SPEI/bancos externos, CEP/Banxico real, inversiones, garantías, biometría y bonus no autorizados. Copy/handlers demo de los exports no son contrato de servidor.
- Decisión de datos aprobada por usuario: cuenta MXN al registro y fixture local de dos cuentas propias con asientos de apertura compensados. Saldos seed son únicamente fixture; no política ni saldo real.
- Las cifras de saldo, límite, OTP, expiración y zona presentadas en exports siguen ilustrativas. Implementación usa configuración de demo; la política de producción requiere aprobación posterior.
- Los exports originales se preservan intactos en el checkout local, sin commit porque incluyen passwords/OTP demo en HTML y datos financieros ilustrativos en capturas; la documentación conserva sus paths. No se cambió `.gitignore` para permitir capturas.

## Contratos y agentes — preparación

- OpenCode 1.18.33 ofrece tareas `general` independientes y `explore`; la inspección visual se realizó por tres contextos independientes. Backend/Web/Mobile se delegarán en worktrees después de cerrar contratos.
- OpenAPI es el contrato de request/response; `packages/shared` genera tipos. Coordinator es propietario exclusivo del contrato/shared/root manifests/lockfile/CI/documentación. Backend, Web y Mobile implementan rutas disjuntas en worktrees.
- Product SPEC de Forge y su commit documental preceden a los worktrees/cambios de aplicación.

## Base común de implementación — lista (sin flujos de producto)

- OpenAPI 0.2.0 se validó con Redocly y sus tipos shared se generan/verifican desde OpenAPI.
- Se fijaron dependencias para auth/seguridad/validación, React Query/router y pruebas web con Testing Library sobre el runner `tsx` existente; Expo Router/SecureStore/Vector Icons/React Native Web pasan Expo SDK 58 checks.
- `packages/shared` incorpora conversión exacta de MXN a minor units y checksum CLABE, con tests positivos/negativos.
- E2E Playwright arranca API y web en puertos aislados 3100/5174 con guard `wallet_test`; CI separa visual, integration y end-to-end.
- `npm run env:local` genera llaves locales en `.env` con modo restrictivo sin mostrar valores. No se iniciaron Docker/Compose ni se accedió a Lucem.
- En Node 26.13.1: `npm ci`, OpenAPI validate/generate/check, typecheck, npm test (API/web/mobile/shared) y Expo install check pasan; los flujos producto requieren rutas/app/migraciones de los worktrees.
- Se detectó que la peer opcional de Expo Router `@testing-library/react-native` instalaba el árbol Jest en un perfil audit `--omit=dev`; se retiró esa biblioteca, manteniendo renderer Expo/Jest para mobile. El lockfile conserva avisos de dependencias que están registrados para la revisión final.
- Commit coordinador `9675b79` deja el lockfile preparado y genera shared validation/types antes de delegar UI/API. Node 26.13.1 y Expo SDK 58 CLI checks pasan; React 19.3.0 queda deduplicado en ambos clientes. Cuatro pruebas shared de dinero/CLABE pasaron.
- `PLATFORM-01` no implementa registro, sesiones, cuentas ni pantallas de producto. `npm ci` se ejecutó en los tres worktrees de agente; no se operó Docker ni PostgreSQL local durante esta preparación.

## Entregas verticales

| Fase | Alcance | Agentes/commit | Qué funciona end-to-end | Pruebas/evidencia |
|---|---|---|---|---|
| 1 | Registro web, login web/móvil, sesión, cuentas/saldos | Integrada | Registro/login/logout/reload web real; login/cuentas móvil en código | `test:integration` 3/3, `test:e2e` 1/1, `test:visual` 2/2, typecheck/lint/unit/build; móvil sin dispositivo |
| 2 | Alta/lista de beneficiarios web, selección móvil | Integrada | Alta UI real contra API/PostgreSQL, CLABE inválida y masking; selector móvil real en código | `test:integration` 5/5, `test:e2e` 2/2, `test:visual` 2/2, typecheck/lint/unit/build; móvil sin dispositivo |
| 3 | Transferencias internas, review/OTP demo, idempotencia, límites configurables y recuperación | Integrada | Web E2E real con respuesta perdida → mismo intento/clave → recibo; móvil implementado | API integra OTP/ledger/límite/100 concurrentes; web E2E 3/3 y mobile Jest/Expo; no device E2E |
| 4 | Historial/cursor, detalle/recibo interno, rechazos, privacidad/background y sesión expirada | Integrada | Web E2E verifica débito en historial filtrado y detalle; mobile implementado | API cursor/ownership/filtros en wallet_test; unit/API integration 7/7; no device E2E |
| QA final | PostgreSQL integridad, 100 concurrentes, 100k movimientos/EXPLAIN, CI y revisión responsive | CÓDIGO/QA LOCAL COMPLETOS · DEVICE E2E BLOCKED | Web real flow comprobado a 390×844 y 1440×960 sin overflow | `docs/history-performance.md`, `docs/visual-review-round2.md`; CI se verificará en el SHA publicado y resta segunda revisión independiente |

## Fase 1 — registro, sesión, cuentas y saldos

- **Agentes:** Backend independiente en `product/backend` (API-01/API-02); Web independiente en `product/web` (WEB-01); Mobile independiente en `product/mobile` (MOBILE-01); Coordinator integró sin compartir ownership de archivos.
- **Web extremo a extremo:** registro → cuenta/saldo dev → logout → login → reload recupera sesión HttpOnly → cuentas desde API. Playwright usa API y PostgreSQL real `wallet_test`: `npm run test:e2e` pasó 1/1.
- **Visual web:** `npm run test:visual` pasó 2/2 en Chromium (viewport 390×844 y 1440×960), render login/register y consola sin errores. Capturas de la prueba quedaron en artefactos locales ignorados (`test-results/`), no se versionaron por datos demo.
- **Backend/PostgreSQL:** `npm run db:migrate:test` pasó y `npm run test:integration` pasó 3/3 en `wallet_test`: auth/CSRF/rate-limit, refresh/reuso, ownership/saldos y privilegios append-only. `wallet_dev` no fue target de esos tests.
- **Automatizados integrados:** lint, typecheck, npm unit tests (API 3, Web 10, Mobile 3, Shared 4), build API/web/Expo (Android/iOS/web), OpenAPI validate/check pasan en Node 26.13.1.
- **Móvil:** M01/M02/M12 están implementadas; tokens via SecureStore, access en memoria, privacy overlay y cierre intenta revocar refresh servidor. Jest (3) y Expo export pasaron. No se probó en dispositivo/simulador: `xcrun` no puede hallar `simctl` y `adb` no está disponible. Expo export no acredita el recorrido nativo.
- **Seed local:** el helper API-02 ahora acepta resultados de consulta `pg` (`{ rows }`) y arreglos TypeORM. Desde la rama integrada `npm run db:seed` pasó dos veces consecutivas sin duplicar la cuenta clearing; `db:migrate:test` y la integración de prueba se mantienen dirigidas a `wallet_test`.
- **Fuera de fase 1:** beneficiarios, transferencias/OTP e historial quedaban pendientes en ese corte. No se declara fase total ni producto final aprobado.

## Fase 2 — beneficiarios internos

- **Backend API-03:** rutas de listado/alta/detalle, validación checksum CLABE, destino limitado a cuenta de la plataforma, cifrado + HMAC lookup, respuesta enmascarada y ownership. Migración `1763000003000-InternalBeneficiaries`; integración PostgreSQL valida CLABE inválida/no interna/duplicado, persistencia protegida, aislamiento y 404 genérico. Commit `e173322`.
- **Web WEB-03:** directorio con búsqueda, alta, validación y estados responsive/accesibles; E2E Playwright contra API y PostgreSQL registra un usuario destino, alta UI de beneficiario, rechazo de CLABE inválida y presentación enmascarada. Commits `356d3e8`, `1c33ac4`, `e45ae9c`, `413c012`.
- **Móvil M05:** selector React Native consulta beneficiarios reales, búsqueda por nombre/alias/CLABE enmascarada y selección provisional; transferencia completa pendiente de Fase 3. Commit `7eaa64f`. Jest y Expo export pasaron; simulador/dispositivo no verificado (`simctl`/`adb` no disponibles).
- **Verificación integrada en `feature/product-mvp`:** `db:migrate:test` pasó; API `test:integration` 5/5 en `wallet_test`; `test:e2e` 2/2 (incluye registro de beneficiario real); `test:visual` 2/2; typecheck, lint, unit tests y build workspaces pasaron. Seed local `wallet_dev` ejecutado dos veces con éxito; no se ejecutaron fixtures de prueba sobre `wallet_dev`.
- **Estado de corte:** Fase 2 cerró con la transferencia como siguiente entrega; las secciones siguientes documentan su implementación integrada y la de historial.

## Fase 3 — transferencias internas

- **Backend API-04/05/06:** creación/consulta/confirmación, destinatario beneficiario propio o cuenta propia, locks de cuentas, saldo y contra-asientos, límite por día de negocio, idempotencia y OTP ligado a intento; snapshots de retry sin OTP plano. Commit `af10cc7`; hardening OTP cifrado + índice de trigger `aa02724`.
- **Web WEB-04:** formulario → revisión → envío, OTP, consulta/recuperación y comprobante interno; importe minor-unit y claves/payload en memoria, doble submit bloqueado. Playwright prueba pérdida de respuesta después de commit real y retry de mismo key+payload/resultado. Commits `d21f399`, `8a5c47a`.
- **Móvil M06–M11:** flujo React Native de datos/revisión/OTP/estado/recibo; retry conserva key+payload, transferencia nativa conectada al contrato API. Commit `b5a66ab`; pruebas Jest y Expo export pasan; device E2E pendiente.
- **Evidencia integrada:** integración PostgreSQL 7/7 incluye transferencia/OTP/lockout/expiry/ownership/idempotencia, saldo/ledger/límite y 100 solicitudes concurrentes; E2E Web real 3/3.

## Fase 4 — historial y detalle

- **Backend API-07:** movimientos reales derivados de ledger, filtros `from/to/type`, cursor keyset por timestamp+UUID, ownership 404, `limit` 1–100/default20 y sin OFFSET. Commit `d231934`.
- **Web WEB-02:** historial filtrable, cursor y estados; detalle consulta transferencia propia y se presenta explícitamente como comprobante interno. El E2E real confirma que el débito recién procesado aparece filtrando `debit` y abre el detalle. Commit `289e2ab`, E2E `84d7808`.
- **Móvil M03/M04:** últimos 20/cursor, detalle desde API, loading/empty/offline/retry y moneda string. Commit `fa4076f`; Jest/Expo export pasan; device E2E pendiente.
- **QA perf:** script repetible y fail-closed `npm run qa:history-performance` sembró 100,000 movimientos sintéticos en la cuenta dedicada de `wallet_test`; se ejecutó dos veces y mantuvo 100,000 filas. Salida real `EXPLAIN (ANALYZE, BUFFERS)` y contexto en `docs/history-performance.md`.

## QA integrada posterior

- `npm run db:migrate:test && npm run test:integration`: 7/7 en `wallet_test`; `test:e2e`: 3/3 con API/PostgreSQL reales; `test:visual`: 2/2.
- Typecheck, lint, unit tests, builds API/Web/Expo Android/iOS/web y OpenAPI validate/check pasan desde `feature/product-mvp`.
- Playwright responsive del flujo real detectó inicialmente overflow de 563px; Web corrigió shell/nav móvil y la verificación 390×844/1440×960 ahora pasa sin overflow ni errores de consola no intencionales.
- **Pendiente por host:** ejecutar recorridos de transferencia/historial/privacidad en simulador/dispositivo móvil (`simctl` y `adb` no disponibles), CI remota y revisión independiente. Expo export no se presenta como device E2E ni como aprobación del producto.

## Seguimiento de hallazgos de revisión independiente — SHA `f5e9a48`

- **Conciliación de 100 transferencias (P1):** `api/tests/transfers.integration.ts` ahora toma balances y uso diario antes/después y verifica aceptaciones, IDs/filas únicos, 2 postings por transfer, neto cero por cada una y global. Resultado de la corrida: 100 aceptadas, suma 5,050 minor; postings source −5,050/destination +5,050; saldos y uso diario con deltas exactos, 0 rejects/filas extra. Commit Backend `105a1bf`; la suite integrada `wallet_test` volvió a pasar 7/7. No se encontró defecto de lógica API.
- **Fail-fast de producción:** `2174224` valida antes de DB/listen los valores operativos obligatorios y rechaza fixture demo en producción; configuración continúa siendo explícita, sin usar los números de ejemplo como policy.
- **Recovery tras restart (P2):** `3542bff` conserva intent key/payload/id en SecureStore y reanuda por GET/replay idempotente tras unmount/remount. Jest simula POST comiteado con respuesta perdida y remount: mismo key/body, mismo transfer ID, un registro lógico; OTP/demo code nunca se persiste. El device E2E nativo sigue **BLOCKED**.
- **Web propia sin beneficiario:** defecto UI corregido en `4825b6d`; E2E registra y transfiere entre dos cuentas propias con directorio vacío, OTP si aplica, historial y comprobante.
- **Visual W03/W04 y estados:** W03 ahora incluye rail desktop, tarjetas, saldo consolidado BigInt y actividad reciente API; se actualizaron tokens visuales. W04 conserva filtro de fecha/tipo y cursor bajo la ruta propia. Capturas E2E enmascaradas incluyen W03, W04 vacío/poblado, W06/W07, W08/W09, W10 OTP/error, W11 incertidumbre, W12 recibo y W14 sesión a 390×844/1440×960; `OTP_THRESHOLD_MINOR=1` solo para prueba. Informe: `docs/visual-review-round2.md`.
- **Fuentes aprobadas:** SHA-256 de PNG/HTML W03/W04/M02/M09 cotejados contra `docs/design/references/README.md`. SVG solo sintetiza W03+W04 y M02; M09 no se representa. Originales `design/` preservados sin modificar ni añadir al commit; no se convierten exports en código ni se atribuyen a terceros.
- **Verificación local integrada:** seed dos veces; integración `wallet_test` 7/7; Playwright real 4/4; visual Chromium 3/3; unit API 7, Web 19, Mobile 6, Shared 4; typecheck/lint/build/OpenAPI pasan; historia 100k/EXPLAIN versionada. Device E2E mobile permanece **BLOCKED**. Publicación/CI de la versión final y segunda revisión independiente siguen después de cerrar este registro.
- **CI remoto:** los dos primeros runs fallaron al migrar `wallet_test` limpio por grants a `wallet_runtime_dev` inexistente; se corrigieron migraciones y fixture de roles/URLs. Run `43682289998` pasó para SHA `b61a2c20f1032f6f2ea22b98249d03d233aa643e`, incluidas migraciones limpias, integración, Web E2E, exportes y carga de capturas masked. La migración CI no crea ni conecta `wallet_dev`; el nuevo SHA documental vuelve a verificarse en su propio run.

## Correcciones y evidencia tras revisión independiente de `f5e9a48`

- **Conciliación concurrente API:** commit `105a1bf` amplía la integración con snapshots previos/posteriores. Las 100 solicitudes resultaron aceptadas; importes 1–100 minor suman 5,050; se observaron 100 IDs/transfer rows únicos, 200 postings (dos por transferencia), neto cero por transferencia y global, source −5,050, destination +5,050, saldos con los mismos deltas y uso diario +5,050; rechazos/filas extra 0. Reejecutada dentro de `npm run test:integration` (7/7 wallet_test). No apareció defecto en API.
- **Configuración de producción:** `2174224` hace fail-fast antes de conectar/listen si faltan o son inválidos los valores operativos (zona IANA, límite y umbral bigint, expiración/intentos, fixture demo); pruebas unitarias cubren ausencia/rango y conservan development/test.
- **Recuperación móvil:** `3542bff` conserva key+payload+transferId en SecureStore y reconsulta/reintenta tras desmontar/remontar. Jest simula el commit server-side y pérdida de respuesta, mismo key/payload/ID lógico, vuelta a OTP y recibo; verifica que OTP/demoOnlyCode no entra a SecureStore. E2E nativo sigue **BLOCKED**: host sin `simctl` ni `adb`.
- **Web:** `4825b6d` permite transferir entre cuentas propias sin registrar beneficiarios; `48c3a4f` corrige el estado UI tras confirmar OTP; `6542f3d`/`edbb929` alinean W03 con sidebar, saldo consolidado exacto BigInt y actividad reciente real; `be446c7` agrega capturas visuales de estados vacíos/error/OTP. OTP incorrecto→correcto y evidencia responsive se cubren con API real en `wallet_test`.
- **Fuentes visuales:** se compararon capturas originales W03/W04 y M02/M09 con los SVG y la app Web; los SHA-256 de PNG/HTML locales coinciden con `docs/design/references/README.md`. W03/W04 y M02 tienen esquemas editoriales; M09 no está representado por SVG. `design/` permanece intacto, local y sin versionar. Los artifacts web en `test-results/visual/` están enmascarados/ignorados; captura reproducible: `OTP_THRESHOLD_MINOR=1 npm run test:e2e`.
- **Estado de rama y nueva revisión:** se conservó `62b65ef` (documentación del revisor) y se añadieron merges/controlados de API/Web/Mobile. Integración final local: seed 2/2, PostgreSQL 7/7, E2E 4/4, visual 3/3, unit tests API 7/Web 19/Mobile 6/Shared 4, typecheck/lint/build/OpenAPI y performance 100k/EXPLAIN. Antes de cerrar esta ronda se publicará la rama y se verificará CI del SHA final; después corresponde una segunda revisión independiente.

Las filas se actualizan solo con commits/pruebas ejecutados; mocks o exports HTML no se consideran recorridos integrados.
