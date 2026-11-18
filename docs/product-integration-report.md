# Informe de integración para revisión independiente

**Estado:** entrega de código integrada en `feature/product-mvp`; este documento reúne evidencia para revisión independiente y no constituye aprobación final del producto. `main` y BOOT-00 se conservan separados.

## Alcance entregado

- Registro/login/sesiones, cuentas MXN y fixture local aprobado.
- Beneficiarios por CLABE válida únicamente entre cuentas internas, cifra/HMAC y respuestas enmascaradas.
- Transferencias internas a beneficiarios o cuentas propias, ledger balanceado/append-only, saldo no negativo, límite diario configurable, OTP simulado ligado al intento e idempotencia/recovery.
- Historial por cursor keyset con filtros, ownership y detalle/comprobante interno.
- Cliente web responsive y accesible; cliente React Native nativo para login/cuentas/beneficiarios/transferencias/historial con SecureStore y privacidad background.
- Exclusiones respetadas: SPEI/bancos externos, Banxico/CEP, garantías/KYC, inversiones, biometría, programación, exportación mensual, AWS y publicación Expo/EAS.

## Evidencia ejecutada desde la rama integrada

Runtime de comprobación: Node 26.13.1. Migraciones e integración se ejecutaron contra el PostgreSQL local `wallet_test`; pruebas fail-closed verifican target y rol. El seed `wallet_dev` solo fue el comando local de desarrollo expresamente autorizado, ejecutado dos veces y sin duplicar la cuenta clearing. No se ejecutaron fixtures de prueba en `wallet_dev` ni se operó Lucem.

| Comprobación | Resultado |
|---|---|
| `npm run db:migrate:test` | Pasa con las migraciones integradas |
| `npm run db:seed && npm run db:seed` | Ambas pasadas terminan en `Local demo clearing account ensured.` |
| `npm run test:integration` | 7/7 PostgreSQL: auth/ownership, beneficiarios, historial, idempotencia, OTP, ledger, límites y 100 solicitudes concurrentes |
| `npm run test:e2e` | 3/3 Playwright con API/PostgreSQL reales: sesión, alta de beneficiario, transferencia, pérdida simulada de respuesta, retry same key/payload, historial y recibo |
| `npm run test:visual` | 2/2; login/registro en Chromium |
| Flujo real responsive | Pasa 390×844 y 1440×960 sin overflow horizontal; `pageerror`/errores de consola no intencionales ausentes |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | Pasa en API/Web/Mobile/Shared; Jest móvil 6, web 17, API 3, shared 4; Expo export Android/iOS/Web |
| `npm run openapi:validate && npm run openapi:check` | Ambos contratos válidos y tipos reproducibles |
| `npm run qa:history-performance` | Dos ejecuciones en `wallet_test` mantuvieron exactamente 100,000 movimientos; EXPLAIN real versionado en `docs/history-performance.md` |

## Pendiente para la revisión

1. Ejecutar flujos móviles en simulator/device físico: el host no tiene `simctl` operativo ni `adb`. Expo export/Jest no se presentan como device E2E.
2. Ejecutar/verificar CI remota en GitHub; no se publicó ni se empujó esta rama durante este ciclo.
3. Revisar de forma independiente seguridad, invariantes SQL, políticas demo/configuración, accesibilidad y criterios binarios de `SPEC.md`; no hay política de producción aprobada para monto/límite/OTP/zona.

## Comandos de reproducción

Desde checkout de `feature/product-mvp`, con Node 26.13.1, dependencias instaladas y las variables locales configuradas sin subir `.env`:

```sh
npm run db:migrate:test
npm run test:integration
npm run test:e2e
npm run test:visual
npm run typecheck
npm run lint
npm test
npm run build
npm run openapi:validate
npm run openapi:check
npm run qa:history-performance
```

`npm run qa:history-performance` requiere únicamente roles locales de `wallet_test`; mantiene una fixture sintética dedicada e idempotente en esa base para reproducir el plan. Umbrales y saldos demo siguen siendo configuración ilustrativa, nunca policy de producción.
