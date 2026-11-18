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
| 3 | Transferencias internas, review/OTP demo, idempotencia, límites configurables y recuperación | Pendiente | Pendiente | Pendiente |
| 4 | Historial/cursor, detalle/recibo interno, rechazos, privacidad/background y sesión expirada | Pendiente | Pendiente | Pendiente |
| QA final | PostgreSQL integridad, 100 concurrentes, 100k movimientos/EXPLAIN, CI y revisión responsive | Pendiente | Pendiente | Pendiente |

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
- **Siguiente:** transferencia interna entre cuentas propias/beneficiarios con atomicidad, OTP configurable, límites demo, idempotencia y recuperación; conservar evidencia móvil solo como código/Jest/export mientras no haya dispositivo disponible.

Las filas se actualizan solo con commits/pruebas ejecutados; mocks o exports HTML no se consideran recorridos integrados.
