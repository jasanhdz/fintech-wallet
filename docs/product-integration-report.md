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
| `npm run test:integration` | 7/7 PostgreSQL en `wallet_test`; transferencia concurrente: 100/100 aceptadas, 5,050 minor total, 200 postings, delta source −5,050/destination +5,050/uso diario +5,050, neto 0, ningún reject/fila extra |
| `OTP_THRESHOLD_MINOR=1 npm run test:e2e` | 4/4 Playwright con API/PostgreSQL reales: cuenta propia sin beneficiario, alta CLABE, recuperación de respuesta perdida, OTP incorrecto/correcto, historial/recibo; genera capturas visuales enmascaradas |
| `npm run test:visual` | 3/3; login/registro/sesión vencida en Chromium |
| Flujos web responsive | 390×844 y 1440×960; W03 rail/resumen/actividad, W04 vacío y poblado, W06/W07, W08/W09, W10 OTP/error, W11 incierto, W12 receipt y W14 sesión. Overflow horizontal y `pageerror` no intencional ausentes. Capturas enmascaradas en `test-results/visual/` (ignored); CI las adjunta como `visual-captures-<SHA>`. |
| `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` | Pasan en API/Web/Mobile/Shared; unit: API 7, Web 19, Mobile 6, Shared 4; Expo export Android/iOS/Web |
| `npm run openapi:validate && npm run openapi:check` | Ambos contratos válidos y tipos reproducibles |
| `npm run qa:history-performance` | 100,000 movimientos idempotentes en `wallet_test`; EXPLAIN real con cursor keyset versionado en `docs/history-performance.md` |
| Recuperación Mobile tras restart | Jest unmount/remount con SecureStore persistente: mismo key/payload/ID, un solo intento lógico y OTP no persistido; Mobile E2E en dispositivo sigue BLOCKED |
| Configuración de producción | Startup falla antes de conectar/escuchar si falta zona/límite/OTP válido o fixture demo activado; tests unitarios cubren fail-fast |
| GitHub Actions producto | Run `43682289998` SUCCESS en SHA `b61a2c20f1032f6f2ea22b98249d03d233aa643e`; migraciones CI limpias, suites, build/OpenAPI y artifact visual pasaron. URL: <https://github.com/jasanhdz/fintech-wallet/actions/runs/43682289998>. El nuevo commit documental se verifica con su propio run. |

## Pendiente para la revisión

1. Ejecutar flujos móviles en simulator/device físico: este host no tiene `simctl` operativo ni `adb`. Expo export/Jest y la prueba de restart simulada no se presentan como device E2E.
2. Revisar de forma independiente la nueva versión publicada; no hay política de producción aprobada para monto/límite/OTP/zona.

La workflow de GitHub Actions corre en cada push. Los runs previos fallaron por grants a roles runtime opcionales y por el setup de roles/URL migrator; quedaron corregidos con `c8f773d`/`a6f9152` y cambios del workflow. No se crea ni conecta `wallet_dev`. El run de CI correspondiente al nuevo SHA documental se enlaza en la entrega final; no se reutiliza CI de BOOT-00.

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

## Instrucciones de smoke test móvil cuando haya un dispositivo

Para un test aislado en teléfono/emulador y host del API en la misma LAN:

```sh
npm run db:migrate:test
npm run dev:api:testdb   # wallet_test runtime role; guard exacto antes de escuchar
npm run dev:web          # crear perfil y beneficiario de prueba por la UI web
EXPO_PUBLIC_API_URL=http://<IP-LAN-DEL-HOST>:3000/v1 npm run dev:mobile
```

`.env` debe tener roles locales `TEST_DATABASE_URL` y `TEST_MIGRATOR_DATABASE_URL`; el script `dev:api:testdb` los valida y ejecuta API con `DATABASE_URL=TEST_DATABASE_URL`, `APP_ENV=development` y fixture local. No imprime ni modifica `.env`, no toca `wallet_dev`, y el test no limpia la base. Emulador Android usa `http://10.0.2.2:3000/v1`; iOS Simulator puede usar `http://localhost:3000/v1`. En teléfono físico usa la IP LAN del host en la misma Wi-Fi. No uses túnel público.

1. Inicia sesión; verifica cierre/reapertura y refresh.
2. Consulta cuentas, últimos 20 movimientos y detalle interno.
3. Selecciona un beneficiario creado desde Web; envía un importe demo mínimo y completa revisión/OTP cuando aplique.
4. Simula perder respuesta después del envío y reinicia la app. Confirma que restaura el mismo intento/key desde SecureStore, consulta/reintenta sin duplicar, y no afirma finalización antes de comprobar el estado del servidor.
5. Comprueba background/app switcher, ocultamiento de información, retorno y sesión.
6. Prueba loading/empty/error, safe areas, orientación soportada y targets táctiles.

Guardar versión de app/OS y capturas sintéticas sin exponer refresh/access tokens, CLABE, código OTP ni datos financieros reales. Esta ejecución sigue BLOCKED hasta disponer de dispositivo/simulador.
