# Ronda 6 · G2 móvil — evidencia de render y comparación con Stitch (código `e677d8a`)

Evidencia de la tanda G2 (sólo `mobile/**`) sobre `feature/product-mvp`. **No es evidencia nativa**: es el bundle real de la app
(`expo export --platform web`) ejecutado en Chromium (Playwright) contra una API aislada. Ningún dato proviene de `wallet_dev`.

## Qué tipo de prueba cubre qué

| Nivel | Qué es | Dónde | Estado |
|---|---|---|---|
| Unit (Jest, `jest-expo`) | `mobile/tests/format.test.ts` (dinero, fechas, Intl tipo Hermes) y `mobile/tests/app.test.tsx` (pantallas con `fetch` simulado) | `npm test` | 77/77 en verde |
| Integración API/PostgreSQL | API real (`npm run dev:api:testdb`, puerto 3490) sobre `wallet_test` migrada con `npm run db:migrate:test`; datos sembrados con `tools/seed.mjs` vía API | `runlog.txt` | ejecutado (ver abajo) |
| Render RN-Web | Bundle exportado + Playwright 390 px lógicos ×2, alto igual al de cada PNG de referencia (`tools/capture.cjs`) | imágenes de esta carpeta | ejecutado |
| Ejecución nativa real (Hermes, SecureStore/Keychain, AppState, teclado iOS/Android, `fontScale`) | iPhone/simulador | — | **pendiente** (este host no tiene `simctl`/`adb`) |

Limitaciones del render web, explícitas: SecureStore se sustituye en la copia exportada por un shim sobre `localStorage`
(`tools/patch.py`, nunca en el código de la app); el background se emula con `visibilitychange`; el "teclado abierto" se aproxima
reduciendo el viewport 336 px; el "texto 130 %" escala los `font-size` por CSS (no es `fontScale` nativo); el ícono de engrane
de Expo Go no existe en web. Tipografía: Stitch usa Inter; la app usa la fuente del sistema (no hay dependencia de fuentes).

## Datos y sanitización

- Usuarios sintéticos `ana.g2.r5@example.test` y `carlos.g2.r5@example.test` (fixture de desarrollo/test: dos cuentas propias);
  contraseña de prueba sólo por variable de entorno (`G2_TEST_PASSWORD`), nunca escrita aquí.
- Las referencias Stitch usadas en estas imágenes son las copias **sanitizadas** de `docs/design/references/round3/source/mobile/`
  (rectángulos sobre correos/importes/códigos del mockup): esas zonas aparecen como diferencias en la superposición y no son
  defectos. La comparación de trabajo del Generator se hizo además contra los originales locales de `design/mobile`.
- En las capturas de M08 el código de demostración está tapado (`mask`). Los inputs de M01 en estado de error también. Sólo se ven
  últimos 4 dígitos de CLABE de prueba; folios son UUID de `wallet_test`.

## Integración ejecutada (extracto de `runlog.txt`)

- Principal → Ahorro $1,500.00 (cuentas propias): Principal 865000 → 715000, Ahorro 650000 → 800000, total 1515000 conservado,
  asientos del traspaso suman 0, una sola transferencia `completed`; comprobante e historial muestran `-$1,500.00` y
  "Traspaso a Cuenta de ahorro demo".
- Origen = destino (Ahorro → "Cuenta de ahorro demo"): bloqueado en M05 (`aria-disabled`) y en M06 (Continuar deshabilitado, sin
  saldo posterior estimado), **0** `POST /transfers`; al cambiar origen a Principal se habilita.
- Envío normal: pantalla "Enviando transferencia…" neutral (sin "Verificando"/anti-duplicados).
- Respuesta perdida tras commit: "Estamos verificando…", recarga de la app ⇒ reanuda "verificando", "Verificar" reutiliza **la
  misma** `Idempotency-Key` (una sola llave en todos los `POST`), BD: una sola transferencia `completed`.
- OTP: variante M07 "Continuar a verificación" (≥ umbral del servidor), cuenta regresiva con `expiresAt`, expirado real; "Solicitar
  nuevo código" = `POST /transfers/{id}/cancel` + nuevo `POST /transfers` con llave nueva (BD: anterior `expired`, nuevo pendiente);
  "Cancelar y volver a revisar" ⇒ `cancelled` (sin huérfanos).
- Intento pendiente expirado en servidor + relanzar app ⇒ pantalla "El código de esta operación expiró", BD `expired`.
- Rechazo real 422 (saldo gastado desde otra sesión del mismo usuario): M11 con saldo re-leído; "Modificar monto o cuenta"
  conserva importe y concepto.
- Recibida (Carlos → Ana): M04 con "De / Recibida / +$1,000.00" sin `GET /transfers/{id}` (es del emisor).
- Errores de consola: sólo respuestas de red provocadas por la prueba (401 de credenciales, abortos simulados, 422); 0 `pageerror`.

## Pantallas y estados

Cada fila enlaza el lado a lado (Stitch sanitizado | app) y la superposición por diferencia (`mix-blend-mode: difference`; negro =
igual). "Revisado" indica que el Generator inspeccionó la imagen; las demás se generaron pero no se inspeccionaron una por una.

| Pantalla / estado | Referencia | Lado a lado | Diferencia | Discrepancias que persisten |
|---|---|---|---|---|
| M01 login | m01_2 | [jpg](M01-login--lado-a-lado.jpg) | [jpg](M01-login--diferencia.jpg) | Revisado. Sin flecha atrás/avatar (no hay sesión); sin pistas "Registrado/Alfanumérica"; inputs más altos (56 vs 44). |
| M01 credenciales inválidas | m01_1 | [jpg](M01-error-credenciales--lado-a-lado.jpg) | [jpg](M01-error-credenciales--diferencia.jpg) | Variante del HTML (la PNG muestra el panel QA "Simular estado", excluido). |
| M01 sin red | m01_1 | [jpg](M01-error-sin-red--lado-a-lado.jpg) | [jpg](M01-error-sin-red--diferencia.jpg) | Igual que arriba. Sin claim "Autenticación bancaria cifrada (SPEI)". |
| M02 inicio | m02 | [jpg](M02-inicio--lado-a-lado.jpg) | [jpg](M02-inicio--diferencia.jpg) | Revisado tras ajuste de escala. Subtítulo de fila usa `•• dígitos · concepto` (no hay "Folio"/"hace N días" en la fila); importes largos se truncan en web (en nativo `adjustsFontSizeToFit`). |
| M03 movimientos | m03 | [jpg](M03-movimientos--lado-a-lado.jpg) | [jpg](M03-movimientos--diferencia.jpg) | Revisado. Sin "Ciclo: …" (no existe en API); sin ícono por categoría (carrito). |
| M04 enviada | m04 | [jpg](M04-detalle-enviada--lado-a-lado.jpg) | [jpg](M04-detalle-enviada--diferencia.jpg) | Pill "Enviada" y fila "Para" (pedido explícito) en lugar de "Completada"/"Cuenta destino"; folio es UUID (envuelve); sin copiar folio. |
| M04 recibida | m04 | [jpg](M04-detalle-recibida--lado-a-lado.jpg) | [jpg](M04-detalle-recibida--diferencia.jpg) | Revisado. "De" + "Cuenta destino", importe verde con "+". |
| M05 lista | m05_2 | [jpg](M05-beneficiarios--lado-a-lado.jpg) | [jpg](M05-beneficiarios--diferencia.jpg) | Sin chip "Frecuentes" ni punto verde (no hay datos de frecuencia/presencia). |
| M05 origen = destino | m05_1 | [jpg](M05-origen-ahorro-destino-incompatible--lado-a-lado.jpg) | [jpg](M05-origen-ahorro-destino-incompatible--diferencia.jpg) | Revisado. **Excepción documentada**: aviso + selector de cuenta origen (no existe en Stitch) y fila deshabilitada con explicación. |
| M05 vacío | m05_1 | [jpg](M05-vacio--lado-a-lado.jpg) | [jpg](M05-vacio--diferencia.jpg) | Sin "Acceder a banca web corporativa" ni copy de blindaje/2FA (claims no soportados). |
| M06 datos | m06 | [jpg](M06-datos--lado-a-lado.jpg) | [jpg](M06-datos--diferencia.jpg) | Línea extra "Disponible hoy … · límites de demostración" (dato real de `/transfer-policy`); enlace "Cambiar cuenta" (excepción C). |
| M06 propias | m06 | [jpg](M06-datos-propias--lado-a-lado.jpg) | [jpg](M06-datos-propias--diferencia.jpg) | Igual que M06. |
| M06 origen = destino | m06 | [jpg](M06-origen-igual-destino--lado-a-lado.jpg) | [jpg](M06-origen-igual-destino--diferencia.jpg) | Estado nuevo (no hay referencia): aviso y Continuar deshabilitado. |
| M06 selector de origen | m06 | [jpg](M06-selector-origen--lado-a-lado.jpg) | [jpg](M06-selector-origen--diferencia.jpg) | Excepción C (radio de cuentas propias). |
| M07 revisión | m07_2 | [jpg](M07-revision--lado-a-lado.jpg) | [jpg](M07-revision--diferencia.jpg) | Sin "Sin costo de comisión" (claim no soportado). |
| M07 propias | m07_1 | [jpg](M07-revision-propias--lado-a-lado.jpg) | [jpg](M07-revision-propias--diferencia.jpg) | "Transferencia interna" en lugar de "Inmediata". |
| M07 umbral | m07_6000 | [jpg](M07-revision-umbral--lado-a-lado.jpg) | [jpg](M07-revision-umbral--diferencia.jpg) | Revisado. Umbral leído del servidor ("mayor o igual", etiqueta demo); sin nota de escenario. |
| M08 vacío | m08_2 | [jpg](M08-codigo-vacio--lado-a-lado.jpg) | [jpg](M08-codigo-vacio--diferencia.jpg) | Recuadro con código de demostración (tapado) entre descripción y casillas desplaza ~60 px. |
| M08 vigente | m08_vigente | [jpg](M08-codigo-vigente--lado-a-lado.jpg) | [jpg](M08-codigo-vigente--diferencia.jpg) | Revisado. "Solicitar nuevo código de demostración" en lugar de "Reenviar" (ver decisión). |
| M08 expirado | m08_expirado | [jpg](M08-codigo-expirado--lado-a-lado.jpg) | [jpg](M08-codigo-expirado--diferencia.jpg) | Expiración real (`expiresAt`). |
| M09 enviando | m09_1 | [jpg](M09-enviando--lado-a-lado.jpg) | [jpg](M09-enviando--diferencia.jpg) | Revisado. Estado "Enviando" propio (la PNG muestra la pestaña QA "Sin conexión"); sin "clave de rastreo SPEI". |
| M09 verificando | m09_2 | [jpg](M09-verificando--lado-a-lado.jpg) | [jpg](M09-verificando--diferencia.jpg) | Revisado. Copy neutral ("No pudimos confirmar…") en lugar de "Se perdió la conexión…"; sin "saldo protegido"/Banxico; sin pie "ID de operación". |
| M10 comprobante | m10_1 | [jpg](M10-comprobante--lado-a-lado.jpg) | [jpg](M10-comprobante--diferencia.jpg) | Revisado. Sin Compartir/PDF ni "auditada/cifrada" (fuera de alcance); folio UUID; fila "Para". |
| M10 propias | m10_2 | [jpg](M10-comprobante-propias--lado-a-lado.jpg) | [jpg](M10-comprobante-propias--diferencia.jpg) | Igual que M10. |
| M11 rechazada (real) | m11 | [jpg](M11-rechazada-saldo--lado-a-lado.jpg) | [jpg](M11-rechazada-saldo--diferencia.jpg) | Revisado. Sin pestañas QA "Saldo insuficiente/Límite diario". |
| Intento expirado (nuevo) | m11 | [jpg](M11-intento-expirado--lado-a-lado.jpg) | [jpg](M11-intento-expirado--diferencia.jpg) | Estado nuevo (`expired`/`cancelled`); usa la composición de M11. |
| M12 cortina | m12_bg | [jpg](M12-privacidad--lado-a-lado.jpg) | [jpg](M12-privacidad--diferencia.jpg) | Sin "cifrado 256-bit/biométrico/SSL". |
| M12 sesión vencida | m12_sesion | [jpg](M12-sesion-vencida--lado-a-lado.jpg) | [jpg](M12-sesion-vencida--diferencia.jpg) | Revisado. La PNG muestra la pestaña "Cortina"; el aviso se implementó desde el HTML (sin "borrador guardado"/CNBV). 401 simulado con `route.fulfill`. |
| Texto 130 % M06 | m06 | [jpg](I-texto-130-M06--lado-a-lado.jpg) | [jpg](I-texto-130-M06--diferencia.jpg) | Aproximación CSS; Continuar visible. |
| Viewport reducido M06 | m06 | [jpg](I-viewport-reducido-M06--lado-a-lado.jpg) | [jpg](I-viewport-reducido-M06--diferencia.jpg) | Aproximación de teclado abierto; Continuar visible. |

## Decisiones y diferencias deliberadas

- **Reenviar código**: no hay endpoint de reenvío (`docs/round6-contract-notes.md` §3). "Solicitar nuevo código" cancela el intento
  pendiente y crea uno nuevo con otra `Idempotency-Key` y otro código; "Reenviar" (mismo intento) no existe. Oculto mientras un
  confirm es incierto (F-06).
- **Compartir / Descargar PDF**: fuera del alcance aprobado; no se añade un botón sin comportamiento.
- **Selector de cuenta origen** (M05/M06): excepción a la referencia, necesaria para resolver origen = destino (B/C).
- **Engrane flotante** (grabación del iPhone): no existe en el código de la app (ningún ícono `settings`/`cog`; la barra de estado
  de la grabación muestra "◂ Code Scanner", es decir Expo Go abierto desde la cámara). Es el botón flotante de herramientas de
  Expo Go; se excluye de la comparación y no se oculta desde la app.
- Claims de SPEI, cifrado, biometría, QA, comisión, Banxico/CNBV siguen fuera.

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3490 WEB_ORIGIN=http://localhost:8490 npm run dev:api:testdb      # API aislada sobre wallet_test
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3490/v1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/e677d8a/tools/patch.py <scratch>/dist && python3 -m http.server 8490 --bind 127.0.0.1 -d <scratch>/dist
G2_TEST_PASSWORD=<valor de prueba> node docs/evidence/round6/e677d8a/tools/seed.mjs r5      # escribe seed-r5.json junto a tools/
node docs/evidence/round6/e677d8a/tools/capture.cjs <seed-r5.json> <shots>
node docs/evidence/round6/e677d8a/tools/compose-evidence.cjs <shots> docs/design/references/round3/source/mobile <salida> docs/evidence/round6/e677d8a/tools/mapping.json
```
