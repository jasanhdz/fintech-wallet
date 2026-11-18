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

## Entregas verticales

| Fase | Alcance | Agentes/commit | Qué funciona end-to-end | Pruebas/evidencia |
|---|---|---|---|---|
| 1 | Registro web, login web/móvil, sesión, cuentas/saldos | Pendiente | Pendiente | Pendiente |
| 2 | Alta/lista de beneficiarios web, selección móvil | Pendiente | Pendiente | Pendiente |
| 3 | Transferencias internas, review/OTP demo, idempotencia, límites configurables y recuperación | Pendiente | Pendiente | Pendiente |
| 4 | Historial/cursor, detalle/recibo interno, rechazos, privacidad/background y sesión expirada | Pendiente | Pendiente | Pendiente |
| QA final | PostgreSQL integridad, 100 concurrentes, 100k movimientos/EXPLAIN, CI y revisión responsive | Pendiente | Pendiente | Pendiente |

Las filas se actualizan solo con commits/pruebas ejecutados; mocks o exports HTML no se consideran recorridos integrados.
