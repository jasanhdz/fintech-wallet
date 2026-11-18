# Revisión independiente de integración — Billetera MXN

**Veredicto: NO APTO para aceptación final.** La integración tiene evidencia sustancial con PostgreSQL y los recorridos web ejecutados pasan, pero al menos un requisito obligatorio de conciliación concurrente no queda probado, la recuperación de intento no sobrevive a reiniciar el cliente, la comparación visual completa y mobile en dispositivo están bloqueadas, y no hay publicación ni CI ejecutada para este SHA.

## Identidad y alcance

- Rama revisada: `feature/product-mvp`.
- SHA completo revisado: `f5e9a4868409740aff29b1f5a4ea11b9a4194413` (commit reportado `f5e9a48`).
- Árbol al inicio: limpio salvo los exports/capturas de `design/` y `design/mobile/billetera_mxn/DESIGN.md`, `design/web/billetera_mxn/DESIGN.md` sin versionar. Se dejaron intactos. No se cambió de rama ni se editó código de producto.
- Runtime encontrado: Node `v26.3.0`, npm `11.16.0`; el README y el informe de integración indican Node `26.13.1`. Migraciones informan PostgreSQL `16.10`.
- Las pruebas de PostgreSQL y Playwright usan los guards de `wallet_test`. No se ejecutó seed contra `wallet_dev`, ni se operó Lucem.

## Matriz de requisitos

| Requisito/área | Estado | Evidencia y motivo |
|---|---|---|
| Registro, login, creación de cuenta y recuperación de sesión web | PASS | `test:integration` (auth) y E2E Playwright registran, cierran sesión, vuelven a iniciar y restauran cookie HttpOnly tras reload. |
| Cuentas y aislamiento de propiedad | PASS | Integración cubre listas/cuentas propias y accesos cruzados; rutas filtran por `owner_id` y devuelven 404 para recurso ajeno. |
| Beneficiarios y CLABE | PASS | PostgreSQL real valida checksum, destino interno, cifrado/enmascarado y aislamiento; E2E registra un beneficiario real y no presenta la CLABE completa. |
| Transferencia, confirmación OTP, historial y comprobante | PASS | E2E conectado a API/PostgreSQL cubre envío incierto, retry con misma llave/payload, OTP cuando aplica, historial filtrado y comprobante interno. |
| Saldo no negativo, atomicidad, movimientos balanceados e idempotencia | PASS* | Servicio transaccional bloquea cuentas en orden determinista; checks, trigger deferred y permisos append-only en migraciones. Integración prueba repetición/mismatch de key, saldo insuficiente, OTP y neto ledger. La suficiencia de la evidencia de concurrencia se califica por separado abajo. |
| 100 transferencias simultáneas y conciliación al centavo (REQ-QUAL-04) | **FAIL** | Se observan 100 solicitudes concurrentes, pero la prueba solo permite estados 201/429 y aserta `balance >= 0`. No compara saldo inicial/final con el total aceptado, número de movimientos, débitos/créditos por intento ni uso del límite. La prueba actual no verifica la invariante exigida por el challenge. |
| Límite diario y zona de negocio | PASS / BLOCKED | Caso de integración de exceso y sincronización por fila en PostgreSQL pasa. La zona se toma de configuración (`BUSINESS_TIME_ZONE`, por defecto en pruebas `America/Mexico_City`); no existe una política de producción aprobada, como reconoce el informe. No se encontró un caso específico que cruce medianoche bajo concurrencia: comportamiento límite (REQ-LIMIT-02) BLOCKED. |
| Sesiones, refresh rotation/reuse, revocación y CSRF | PASS | Integración prueba rotación/reutilización, logout y protección CSRF; el access JWT expira en 10 min y refresh se almacena como hash en PostgreSQL. |
| OTP asociado a intento, expiración y límites de intentos | PASS | Prueba integrada cubre confirmación, repetición, código incorrecto, agotamiento y expiración. El código de demo se condiciona a `APP_ENV=development`, cifrado en BD y excluido de snapshots/logs. |
| Recuperación de resultado desconocido | **BLOCKED** | En sesión viva, web conserva intento y payload en `Map` y móvil en estado React; GET del intento y reenvío con la misma llave funcionan. El cliente no conserva la llave/intent ID de forma recuperable tras reload/cierre forzado; si se pierde la respuesta y se reinicia el proceso antes de guardar `transferId`, el usuario no tiene mecanismo verificado para identificar/reconsultar el intento. No declarar resultado/afectación de saldo sin consultar la operación. |
| RFC 7807, request ID, validación, dinero decimal e historial cursor | PASS | Contrato OpenAPI válido; TypeScript de servicios valida importes en minor units/BigInt, parámetros de historial y keyset sin OFFSET. Suite API/shared/web pasa. |
| Seguridad de auditoría y ledger en PostgreSQL | PASS | Migraciones crean triggers append-only; roles runtime sin UPDATE/DELETE sobre ledger/audit; integración comprueba privilegios. |
| Web responsive 390 px y escritorio | PASS parcial / BLOCKED visual | Playwright ejercitó el flujo real a 390×844 y revisó overflow hasta recibo; login/registro se probaron a 390 y escritorio 1440×960. Sin errores de navegador observados. No hay comparación de screenshots/pixel contra las referencias ni revisión visual de todas las pantallas/estados. |
| Carga, vacío, error y sesión vencida en web | PASS parcial | Pruebas de componentes cubren estados y sesión/refresh; E2E prueba login/registro y journeys integrados. No se recorrieron visualmente todos los estados de pantalla contra sus exports; auditoría visual integral BLOCKED. |
| Móvil React Native integrado | BLOCKED en dispositivo | Unit tests (6) y export Expo Android/iOS/Web pasaron, pero `simctl` no está instalado/disponible y `adb` no está instalado. No se presenta export ni tests unitarios como prueba de dispositivo. Lista reproducible abajo. |
| Fixture 100,000 y EXPLAIN ANALYZE | PASS con observación | QA local sobre `wallet_test` confirmó 100,000 movimientos, cursor keyset real y plan PostgreSQL 16.10. Consulta usa `ledger_entries_account_created_idx`, más búsquedas por PK para ledger/transfers; obtiene 20 filas en 0.522 ms en esta ejecución (164 shared buffers). El índice líder account/created_at/id soporta cursor y LIMIT; filtros de tipo/estado/fecha se aplican parcialmente después del scan/joins. Rendimiento observado, no garantía. |
| Publicación de rama y CI del SHA | **BLOCKED** | `git ls-remote --heads origin refs/heads/feature/product-mvp` no devolvió la rama. `gh run list --branch feature/product-mvp` y por SHA completo no devolvieron runs. Existe configuración de workflow en el árbol, pero no evidencia de ejecución para producto/SHA. No contar BOOT-00 como CI del producto. |
| Instrucciones reproducibles, migración y seed | **FAIL documental** | Los comandos de QA se ejecutaron, pero README aún declara “ninguna migración de negocio”, seed sin inserción y solo `/health`; contradice migraciones funcionales, fixture, rutas reales e informe. Reproducibilidad de API/web sí posible con `.env.example` y scripts, pero las instrucciones de entrega están desactualizadas. |
| OpenAPI y tipos compartidos | PASS | `openapi:validate` valida ambos contratos; `openapi:check` confirma generación reproducible. |
| Conservación y futura incorporación de diseños | PASS local / BLOCKED publicación | Los archivos originales permanecen sin versionar e intactos en `design/`. No forman parte del SHA revisado y no viajan al checkout remoto. Procedimiento de incorporación segura abajo. |

## Ejecución independiente

Comandos ejecutados en este checkout:

```text
node --version && npm --version                         -> v26.3.0 / 11.16.0
npm run db:migrate:test                                 -> pasa; wallet_test
npm run test:integration                                -> 7/7 pasa; PostgreSQL real
npm run typecheck                                       -> pasa API/Web/Mobile/Shared
npm run lint                                            -> pasa API/Web/Mobile/Shared
npm test                                               -> pasa; API 3, Web 17, Mobile 6, Shared 4
npm run build                                           -> pasa; API/Web y Expo export Android/iOS/Web
npm run openapi:validate                                -> pasa contratos producto y BOOT-00
npm run openapi:check                                   -> pasa tipos reproducibles
npm run test:e2e                                        -> 3/3 pasa (API/PostgreSQL real)
npm run test:visual                                     -> 2/2 pasa (Chromium)
npm run qa:history-performance                          -> 100,000 filas; EXPLAIN real; 0.522 ms
xcrun simctl list devices booted                        -> bloqueado: simctl no disponible
adb devices                                             -> bloqueado: adb no instalado
git ls-remote --heads origin refs/heads/feature/product-mvp -> rama no publicada
gh run list --commit f5e9a4868409740aff29b1f5a4ea11b9a4194413 -> sin runs
```

Las pruebas integradas y la suite no limpiaron ni sembraron `wallet_dev`. La migración de prueba se aplicó en `wallet_test`; la prueba de rendimiento mantiene allí su fixture sintética idempotente de 100k. Se conserva el reporte de plan reproducible en [`history-performance.md`](history-performance.md).

### Notas de consulta y rendimiento

El plan real usa `Index Scan` sobre `ledger_entries_account_created_idx` con condición `(account_id, (created_at,id) < cursor)` y `LIMIT 20`; los joins posteriores usan PK de ledger transaction y transfer. En una cuenta con solo los movimientos de esta fixture, estima alrededor de 48.9k entradas y filtra por `entry_type`, `reference_type`, estado y fecha después de encontrar candidatos. Adecuado para la consulta medida y paginación keyset; si una cuenta acumula muchos movimientos no coincidentes, esos filtros pueden incrementar lecturas. Reevaluar con distribución representativa antes de proponer índices parciales/compuestos adicionales.

## Hallazgos priorizados y reproducción

### P1 — La prueba concurrente no comprueba conciliación

Archivo: `api/tests/transfers.integration.ts`, caso “internal transfers…”, bloque de `Promise.all` y aserciones finales (aprox. líneas 46–47). Lanza exactamente 100 solicitudes, pero acepta 201/429 sin clasificar el conjunto ni calcular el importe admitido; después únicamente comprueba no negatividad. La consulta de balance se hace a una sola cuenta y no inspecciona los ledger entries concurrentes. Por tanto no satisface la afirmación de challenge de que el balance final “cuadra al centavo”.

Reproducción: `npm run db:migrate:test && npm run test:integration`. El test pasa, pero sus aserciones descritas no incluyen conciliación. Para cerrar: capturar balances y uso diario antes/después en la cuenta aislada; asignar importes/keys conocidos; conciliar cada 201 con exactamente dos asientos opuestos, total neto cero, cuenta origen/destino y movimientos únicos; comprobar que delta del balance equivale a suma aceptada y que rechazos no escriben asientos ni incrementan uso diario.

### P1 — README no describe la entrega integrada

Archivo: `README.md`, especialmente líneas 24–27, 42–45 y 58–67. Asegura que `db:migrate` no aplica migraciones de negocio, que `db:seed` no inserta datos, que el único endpoint es health y que AWS doc está pendiente; contradice el código actual y `docs/product-integration-report.md`. También indica Node 26.13.1 mientras el entorno revisado reportó 26.3.0.

Reproducción: comparar README con `api/src/db/command.ts`, migraciones, `api/src/http/app.ts` y comandos comprobados en este informe. La preparación requiere actualizar y verificar pasos desde checkout limpio, con configuración local generada, migraciones y fixture de demo limitadas a sus bases permitidas.

### P2 — Recuperación del intento solo en memoria del cliente

Web mantiene `attempts` y `confirmationAttempts` en `Map` de módulo (`web/src/transfers.tsx`); mobile mantiene `createAttempt`/`transfer` en estado React (`mobile/App.tsx`). Es suficiente para retry durante la sesión viva que cubren los tests, pero al reiniciar app/página se descarta la clave. En caso de respuesta perdida antes de obtener ID, tampoco hay endpoint de consulta por llave; el lookup depende de repetir POST con misma llave, que el usuario ya no puede recuperar.

Reproducción funcional sugerida en entorno aislado: interceptar/abortar la primera respuesta POST de transferencia después de que API la procese; cerrar/reload cliente y verificar que el mismo intento se localiza sin crear otra transferencia ni anunciar estado financiero sin consulta. La prueba automatizada existente no reinicia el cliente.

### P2 — No existe evidencia remota de producto

La rama no aparece en `origin` y GitHub no reportó workflow run para el SHA. El workflow en el árbol no equivale a CI verde. Publicar la rama aprobada y ejecutar CI del producto para este SHA; conservar la URL/resultado verificable. No mezclar con el workflow o findings de BOOT-00.

### P2 — Inspección visual de alcance parcial

Las pruebas generan/ejercitan viewport, overflow y journeys, pero el test visual solo verifica login/registro; no produce comparación automatizada ni evidencia persistida comparada con Stitch. Revisar web en ambas anchuras y estados de historial, beneficiario, formulario, OTP, resultado incierto, comprobante y sesión vencida; registrar capturas comparables sin copiar HTML de referencia a la app.

## Validaciones móviles para ejecutar en teléfono

En una red Wi-Fi compartida, iniciar API/web siguiendo pasos actualizados del README, establecer `EXPO_PUBLIC_API_URL=http://<IP-LAN-del-host>:3000` antes de abrir Expo y arrancar `npm run dev:mobile`. En el teléfono, Expo Go compatible o cliente de desarrollo, ejecutar este recorrido y guardar versión de app/OS, capturas y resultado (sin exponer tokens, OTP ni datos financieros reales):

1. Login correcto e incorrecto; cerrar/abrir app y verificar refresh, expiración, revocación y re-login.
2. Ver cuentas y saldo; seleccionar beneficiario registrado, historial de 20 movimientos y comprobante interno.
3. Transferir un importe pequeño de demo: validar revisión, envío, OTP cuando la configuración lo exige, resultado y comprobante; confirmar movimientos y saldo desde la API.
4. Simular pérdida de conectividad después de enviar; recuperar conexión, consultar el mismo intento y reintentar con la misma clave. Confirmar una sola transferencia/ledger entry y que la UI no afirme débito/completitud antes de respuesta verificable.
5. Poner app en background y revisar app switcher/captura de pantalla; volver a foreground y comprobar ocultamiento de información y recuperación de sesión.
6. Probar errores/empty/loading de cuentas, beneficiarios e historial; teclado, safe areas, orientación soportada y targets táctiles.

## Incorporar los diseños finales sin alterar originales

Los paths `design/web/**` y `design/mobile/**` están ahora presentes como archivos untracked locales. No se deben borrar, renombrar ni añadir indiscriminadamente (`.DS_Store`, archivos ajenos o capturas/HTML con datos demo no sanitizados). Para incluirlos en un checkout remoto:

1. Mantener intactos los originales locales y realizar inventario explícito con responsables de diseño.
2. Preparar una copia curada en un directorio versionable dedicado (por ejemplo `docs/design/references/`), conservando estructura y solo los exports/capturas finales autorizados. Antes de copiar, inspeccionar y redactar en las copias contraseñas, OTP, CLABEs, nombres/saldos u otros valores demo sensibles. No editar los originales como parte de esa curación.
3. Dejar fuera `.DS_Store`, carpetas de variantes descartadas, archivos ajenos y cualquier secreto. No copiar HTML de referencia a `web/` o `mobile/`.
4. Revisar `git status --short`, `git diff --cached --stat` y escanear solamente las copias seleccionadas; stagear paths explícitos (nunca `git add design/` ni `git add -A`). Publicar un commit documental separado y enlazar el inventario/licencia/origen de las referencias.

La revisión no hace esos cambios. La aceptación final requiere cerrar los FAIL/BLOCKED obligatorios, publicar y obtener CI del producto, volver a revisar este SHA o su sucesor, y completar la validación móvil física.
