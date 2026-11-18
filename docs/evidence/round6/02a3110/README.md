# Ronda 6 · G3 móvil — fixes F-11..F-14, Inter real y fidelidad de los 30 estados (código `02a3110`)

Evidencia de la tanda G3 sobre `feature/product-mvp` (commits `b55ce2b` F-11, `a370018` F-12, `c4e9156` F-14, `0f42f51` Inter,
`02a3110` F-13 + fidelidad + folios). **No es evidencia nativa**: es el bundle real (`expo export --platform web`) en Chromium
(Playwright, 390 px lógicos ×2, alto = alto de cada PNG de referencia escalado a 390) contra una API aislada sobre `wallet_test`.

## Niveles de prueba

| Nivel | Qué | Resultado |
|---|---|---|
| Unit (Jest, `jest-expo`) | `mobile/tests/app.test.tsx`, `format.test.ts`, `typography.test.tsx`, `typography-fallback.test.tsx` | 90/90 (antes 77) |
| Integración API/PG | API `dev:api:testdb` en :3790 sobre `wallet_test` (migrada con `db:migrate:test`); datos con `tools/seed.mjs` | ver `runlog.txt` |
| Render RN-Web | `tools/capture.cjs` (30 estados) + `tools/extras.cjs` (F-11, F-13, folio, Inter) | imágenes de esta carpeta y `checks/` |
| Nativo (Hermes, SecureStore, AppState, teclado iOS, `fontScale` real, carga de fuentes en iOS) | iPhone/simulador | **pendiente nativo** (sin `simctl`/`adb` en este host) |

Limitaciones del render web: SecureStore se sustituye en la copia exportada por un shim sobre `localStorage` (`tools/patch.py`);
el foco de RN-Web (recuadro en el input enfocado) se quita con `blur()` antes de cada captura porque no existe en nativo
(`outlineStyle` es sólo web); "texto 130/200 %" escala `font-size` por CSS (no es `fontScale`); `adjustsFontSizeToFit` no existe en
web (en web los importes muy largos se truncan, en nativo se reducen).

## Hallazgos abiertos (pass 5)

| ID | Corrección | Prueba |
|---|---|---|
| F-11 | Saludo en columna `flex:1/minWidth:0`, 2 líneas + elipsis; logout 44 pt `flexShrink:0`. Fila de cuenta de M11 también encoge. Revisados headers y filas con datos dinámicos (alias, conceptos, referencias, folios, CLABE enmascarada): ninguno desplaza controles. | Jest (nombre de 64 caracteres, `fontScale` 1 y 2). Web: `checks/extras-log.txt` — logout x=338..382 a 100/130/200 %, sin scroll horizontal, logout funciona (`checks/F11-nombre-largo-*.png`). |
| F-12 | "Cancelar y volver a revisar" y la flecha deshabilitados mientras el intento está ocupado (confirm en vuelo); `leaveOtp` ignora llamadas en vuelo. | Jest: confirm retenido → ambos deshabilitados, un toque forzado no sale ni cancela, al responder llega al comprobante, 0 `/cancel`. Falla sin el fix. |
| F-13 | M07 con paddings/tamaños Stitch (p-4, captions 10 px, botón h-48). | Web: a 390×884 y 390×844 "Confirmar" termina en y≈769 y "Modificar datos" en y≈821 (ambos visibles); con 130 % se alcanzan con scroll. `checks/F13-*.png`, lado a lado `M07-revision--*`. |
| F-14 | — | Jest con umbrales 123456 y 1000000: cambia variante, etiqueta y botón; fijar `500000n` hace fallar 3 casos. |
| F-05 | Sin cambio: BLOCKED (nativo). | — |

## Inter

`@expo-google-fonts/inter@0.4.2` (publicada 2025-09-11, fijada exacta) + `expo-font ~58.0.12` (ya en el árbol vía `expo`,
declarada por importarse directo). Se importan los entry points por peso (`/400Regular`, `/500Medium`, `/600SemiBold`, `/700Bold`):
`expo export` web e iOS incluyen exactamente esos 4 TTF (342-344 KB c/u). `useInterTypeface` espera la carga (vista "Cargando")
y cae a la fuente del sistema con pesos reales si falla o tarda >6 s. Cada estilo tipográfico usa la familia de su peso y no
`fontWeight` (RN no combina pesos con familias custom: Android los ignora, web sintetiza negrita falsa). Verificado en el render:
`document.fonts` cargó `Inter_400Regular/500Medium/600SemiBold`, el título usa `Inter_600SemiBold` (`checks/extras-log.txt`, y
`fonts=` por estado en `runlog.txt`). La escala de G2 se recalibró con Inter contra los tokens de `DESIGN.md`/`code.html`.
Pendiente nativo: confirmar en iPhone que `loadAsync` registra las 4 familias en Expo Go/dev build.

## Resolución de `@fintech-wallet/shared` (punto 8)

- (a) Metro **sí** aplica `compilerOptions.paths` de `mobile/tsconfig.json` (soporte tsconfig paths de Expo): con el mapeo resuelve
  `fintech-wallet-g1/packages/shared/src/index.ts`; sin él resuelve por el symlink de `node_modules`, que en este worktree apunta al
  checkout principal (`fintech-wallet/packages/shared`, otra versión). En un clon normal ambos caminos son el mismo archivo.
- (b) `packages/shared/package.json` exporta `./src/index.ts` (no hay `dist`); no existe un build viejo que Metro pueda empaquetar.
- (c) Mobile sólo hace `import type { ProductComponents }`: Babel lo elimina, así que ni Metro (ios/web) ni Jest empaquetan código de
  `shared` (0 coincidencias de `parseMxnToMinor`, `isValidClabe`, `registerRequestSchema` en los bundles). Los campos/rutas nuevos de
  0.3.0 que la app usa en runtime viven en `App.tsx` y están en ambos bundles: `/transfer-policy`, `otpThresholdMinor`,
  `dailyRemainingMinor`, `expiresAt`, `ownAccountId`, `counterparty`, `/cancel` (1 coincidencia c/u en
  `index-*.js` web y `entry-*.hbc` iOS). **No hay divergencia** tipos/runtime; no se tocó `packages/shared/package.json` ni se
  añadió `metro.config.js`.
- Riesgo latente (no corregido, decisión del Coordinador): una importación de **valor** desde `shared` rompe el bundle
  (`Unable to resolve "./money.js" from packages/shared/src/index.ts`), porque `shared` usa specifiers `.js` hacia fuentes `.ts`
  y Metro no los reescribe. Probado con un import temporal (revertido) en export web.

## Los 30 estados

Lado a lado = PNG original `design/mobile/*/screen.png` (izq.) | captura (der.); diferencia = `mix-blend-mode: difference`
(negro = igual). Todos se regeneraron porque la escala tipográfica/botones (Inter) cambió en todas las pantallas. Revisados uno
por uno por el Generator G3 contra PNG y `code.html` (antes y después del cambio). Diferencias por datos: los textos/importes/
dígitos de la referencia son de maqueta (ej. `$12,450.00`, `•• 8412`, `DEMO-0001`); la app muestra datos reales de `wallet_test`.

| Estado | Ref. | Diferencias materiales encontradas → corregidas | Persisten (justificación) |
|---|---|---|---|
| [M01 login](M01-login--lado-a-lado.jpg) · [dif](M01-login--diferencia.jpg) | m01_2 | Título 30/700→28/600, subtítulo 15→14, marca 52→56 px, card p20/r16→p16/r12, inputs 56→48 (texto 14), botón 56/16→48/14, info y footer a 12/10 px. | Sin flecha atrás ni avatar (no hay sesión); sin pistas "Registrado/Alfanumérica" (no son reglas de la API). Coincide casi píxel a píxel. |
| [M01 credenciales](M01-error-credenciales--lado-a-lado.jpg) · [dif](M01-error-credenciales--diferencia.jpg) | m01_1 | Caja de error con fondo error-container sin borde, título on-surface 14, texto 12. | PNG muestra panel QA "Simular estado" (excluido) y claim SPEI (excluido); inputs tapados. |
| [M01 sin red](M01-error-sin-red--lado-a-lado.jpg) · [dif](M01-error-sin-red--diferencia.jpg) | m01_1 | Variante sin red con surface-container-high e ícono outline (del HTML). | Igual que arriba. |
| [M02 inicio](M02-inicio--lado-a-lado.jpg) · [dif](M02-inicio--diferencia.jpg) | m02 | Header 14/10 px y avatar 32; logout 20 px; pestañas r8 y peso 500/600; "Saldo disponible" 12; tarjeta r12; botón 14; aviso de actualización 12 px; filas: título 14, sub 12, meta 10, importe 16, íconos 20 con tonos Stitch, divisores con margen; "Ver los últimos 20" 14; nav con sombra. | Pastilla "Completado" en las 3 filas (Stitch sólo en la 1ª; se mantiene semántica uniforme); fila sin "Folio DEMO"/"hace N días" (meta = fecha real). |
| [M03 movimientos](M03-movimientos--lado-a-lado.jpg) · [dif](M03-movimientos--diferencia.jpg) | m03 | Tarjeta de cuenta r12/14 px; saldo en mono 16 (font-mono de Stitch) y MXN 10; título 20/700; grupos 10 px; filas p12 con divisor 1 px, íconos surface-container-high / secondary-container 40 %; importe 16/600 (abono 700), MXN 10; chevron outline. | Sin "Ciclo: …" (no existe en la API); sin ícono por categoría (carrito). |
| [M04 enviada](M04-detalle-enviada--lado-a-lado.jpg) · [dif](M04-detalle-enviada--diferencia.jpg) | m04 | Ícono 36 + punto "en vivo"; pill 10 px; card r12 con filas 12/14 px; destino alineado a la derecha; botones 16/14 y "Ir al inicio" surface-container-high; folio real en primario semibold. | "Para"/"Enviada" en lugar de "Cuenta destino"/"Completada" (pedido explícito); folio UUID completo en 2 líneas, seleccionable, sin botón copiar (no hay dependencia de portapapeles). |
| [M04 recibida](M04-detalle-recibida--lado-a-lado.jpg) · [dif](M04-detalle-recibida--diferencia.jpg) | m04 | Igual que enviada. | "De" + importe verde con "+" (estado recibido no existe en Stitch; coherente con M03). |
| [M05 lista](M05-beneficiarios--lado-a-lado.jpg) · [dif](M05-beneficiarios--diferencia.jpg) | m05_2 | Header 16 px y avatar 32 (texto 10); búsqueda my-12; pie r8 con ícono 16. | Sin chip "Frecuentes" ni punto verde (sin datos de frecuencia/presencia); descripción sin "de forma inmediata". |
| [M05 origen=destino](M05-origen-ahorro-destino-incompatible--lado-a-lado.jpg) · [dif](M05-origen-ahorro-destino-incompatible--diferencia.jpg) | m05_1 | Tipografía/radios globales. | **Excepción documentada** (B/C): aviso + selector de origen + fila deshabilitada. |
| [M05 vacío](M05-vacio--lado-a-lado.jpg) · [dif](M05-vacio--diferencia.jpg) | m05_1 | Encabezado de sección "INFORMACIÓN DE GESTIÓN" sobre la tarjeta vacía; ícono 24. | Sin "Acceder a banca web corporativa" ni nota de blindaje/2FA (claims); "Billetera MXN" en lugar de "Seguridad bancaria". |
| [M06 datos](M06-datos--lado-a-lado.jpg) · [dif](M06-datos--diferencia.jpg) | m06 | "PASO 1 DE 2" 12/600; barra primary-container; cards r12; cabecera de tarjeta sin alto mínimo extra; monto 60 px; botón Continuar 16. Foco de RN-Web retirado de la comparación. | Línea "Disponible hoy … límites de demostración" (dato real de `/transfer-policy`) y enlace "Cambiar cuenta" (excepción C). |
| [M06 propias](M06-datos-propias--lado-a-lado.jpg) · [dif](M06-datos-propias--diferencia.jpg) | m06 | Igual que M06. | Igual que M06. |
| [M06 origen=destino](M06-origen-igual-destino--lado-a-lado.jpg) · [dif](M06-origen-igual-destino--diferencia.jpg) | m06 | Igual que M06. | Estado nuevo sin referencia (aviso + Continuar deshabilitado); captura desplazada al campo enfocado. |
| [M06 selector](M06-selector-origen--lado-a-lado.jpg) · [dif](M06-selector-origen--diferencia.jpg) | m06 | Igual que M06. | Excepción C (radio de cuentas propias). |
| [M07 revisión](M07-revision--lado-a-lado.jpg) · [dif](M07-revision--diferencia.jpg) | m07_2 | **F-13**: hero p16 r12, ícono 48, captions 10, partes p12, dirección 10 px, meta p12, estimado p12 con valor 16 y cálculo/nota 10, acciones h-48/h-44 con gap 8: Confirmar y Modificar en la posición de Stitch. | Sin chip "Sin costo de comisión" (claim). |
| [M07 propias](M07-revision-propias--lado-a-lado.jpg) · [dif](M07-revision-propias--diferencia.jpg) | m07_1 | Igual que M07. | "Revisar transferencia"/"Cuenta de origen"/"Transferencia interna" en lugar de "Revisar y confirmar"/"Cuenta origen"/"Inmediata" (una sola variante de copy); se muestra el cálculo. |
| [M07 umbral](M07-revision-umbral--lado-a-lado.jpg) · [dif](M07-revision-umbral--diferencia.jpg) | m07_6000 | Pastilla de umbral 10 px en surface-container-high, ícono 14. | Texto "mayor o igual … (umbral de demostración)" (semántica `>=` del servidor); sin nota de escenario QA. |
| [M08 vacío](M08-codigo-vacio--lado-a-lado.jpg) · [dif](M08-codigo-vacio--diferencia.jpg) | m08_2 | Contexto p12/captions 10; tarjeta p16; insignia r-full 12/600; casillas 44×52 (vacía surface-container-low, llena high), sin borde; cuenta regresiva 12 px; enlace de nuevo código 14/500 primary 80 %; pie gap 8, candado abierto/cerrado según dígitos. | Recuadro con el código de demostración (tapado) — necesario sin SMS; "Solicitar nuevo código" en lugar de "Reenviar" (no hay endpoint de reenvío); `mm:ss` real de `expiresAt`. |
| [M08 vigente](M08-codigo-vigente--lado-a-lado.jpg) · [dif](M08-codigo-vigente--diferencia.jpg) | m08_vigente | Igual que M08 vacío. | Igual. Pie sin la nota QA de Stitch (por eso la tarjeta queda ~40 px más arriba relativa al pie). |
| [M08 expirado](M08-codigo-expirado--lado-a-lado.jpg) · [dif](M08-codigo-expirado--diferencia.jpg) | m08_expirado | Banner p8 r8 error-container/40, texto 12; acción "Solicitar nuevo código" en línea (bg primary-fixed/50, 14/600) en lugar de botón de ancho completo 56 px; casillas expiradas opacas con borde. | — |
| [M09 enviando](M09-enviando--lado-a-lado.jpg) · [dif](M09-enviando--diferencia.jpg) | m09_1 (sección oculta "Enviando") | Anillo 96/80 con spinner, pastilla "Envío en curso", texto centrado sin tarjeta, filas 12 px, botón deshabilitado "Procesando transferencia..." + "Esta acción previene duplicados accidentales". | La PNG muestra la pestaña QA "Sin conexión"; sin "Transmisión bancaria"/"Protocolo SPEI"/"Clave rastreo" (claims); título "Enviando transferencia…" (requisito E, copy neutral). |
| [M09 verificando](M09-verificando--lado-a-lado.jpg) · [dif](M09-verificando--diferencia.jpg) | m09_2 | Ícono 80/48/28 con insignia 28; pastilla 12 px; tarjeta p12 texto 14; caja de aviso p8 con título 12; filas label-sm con referencia mono y estado 10 px; botones 16 ("Ir al inicio" surface-container-low); pie mono con referencia (e ID real si existe) + "Billetera MXN • Validación interna de operación". | Copy neutral "No pudimos confirmar…" (no afirma pérdida de conexión ni "saldo protegido"); línea roja de error del reintento (estado real). |
| [M10 comprobante](M10-comprobante--lado-a-lado.jpg) · [dif](M10-comprobante--diferencia.jpg) | m10_1 | Anillo 64/48 + insignia verificada; MXN 14/500; pastilla de fecha p12/4 12 px; card gap 8 con filas 12/14/600, sombreado /60, detalle 10; folio real 14/600 tabular; nuevo saldo en surface-container-high/80 sin borde, etiqueta 12, MXN 16; botones 16 con gap 8. | Sin Compartir/PDF ni "auditada y cifrada" (fuera de alcance/claims); "Para" en lugar de "Beneficiario"; folio UUID en 2 líneas, seleccionable, sin botón copiar. |
| [M10 propias](M10-comprobante-propias--lado-a-lado.jpg) · [dif](M10-comprobante-propias--diferencia.jpg) | m10_2 | Igual que M10. | Variante m10_2 con borde de tarjeta y "Opciones de comprobante (opcional)" (Compartir/PDF fuera de alcance). |
| [M11 rechazada](M11-rechazada-saldo--lado-a-lado.jpg) · [dif](M11-rechazada-saldo--diferencia.jpg) | m11 | Ícono 64/32; título mb4; importe del motivo en 500; caja "intacto" p12 r12 con textos 12; tarjeta p16 gap12 con cuenta 14/500 e ícono 16; débito p12 r8 nota 10; botones 14 con gap 8. | Sin pestañas QA "Saldo insuficiente/Límite diario"; el motivo viene de la API. |
| [Intento expirado](M11-intento-expirado--lado-a-lado.jpg) · [dif](M11-intento-expirado--diferencia.jpg) | m11 | Misma composición y tokens que M11. | Estado nuevo (`expired`/`cancelled`), sin referencia propia. |
| [M12 cortina](M12-privacidad--lado-a-lado.jpg) · [dif](M12-privacidad--diferencia.jpg) | m12_bg | Tarjeta min-h 460 centrada verticalmente r16 con borde; ícono 96/64 + insignia 32; título 20/600; pastilla 12; nota con ícono 40 r12 y texto 12. | Logo de imagen sustituido por ícono de cartera (la imagen de Stitch no carga). Coincide casi píxel a píxel. |
| [M12 sesión vencida](M12-sesion-vencida--lado-a-lado.jpg) · [dif](M12-sesion-vencida--diferencia.jpg) | m12_sesion (sección oculta del HTML) | Tarjeta de sesión expirada (ícono 64 con punto tertiary, título 20, texto 14) en lugar del bloque de marca; botón "Iniciar sesión nuevamente". | La PNG muestra la pestaña "Cortina"; sin "Operación en pausa/Borrador guardado" (no hay borradores) ni CNBV/multifactor (claims); el formulario sigue en la misma pantalla. |
| [Texto 130 % M06](I-texto-130-M06--lado-a-lado.jpg) · [dif](I-texto-130-M06--diferencia.jpg) | m06 | — | Aproximación CSS; Continuar visible. **Pendiente nativo** (`fontScale`). |
| [Viewport reducido M06](I-viewport-reducido-M06--lado-a-lado.jpg) · [dif](I-viewport-reducido-M06--diferencia.jpg) | m06 | — | Aproximación de teclado (-336 px); Continuar visible. **Pendiente nativo** (teclado iOS). |

Residuales observados en `checks/F11-nombre-largo-200.png` (200 % CSS): en web el saldo grande se trunca ("$10,…") y las
pestañas muestran "P…"/"A…"; en nativo el saldo usa `adjustsFontSizeToFit` y las pestañas conservan la etiqueta accesible completa.
**Pendiente nativo** con `fontScale` real.

## Pendiente nativo (iPhone/simulador)

Carga de Inter con `expo-font` en Expo Go/dev build; `fontScale`/Dynamic Type real (F-11 a 200 %, pestañas y saldo); teclado iOS
en M06/M08; selección/copia del folio con pulsación larga; Hermes (fechas, `expo-crypto`), SecureStore/Keychain, AppState (F-05).

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3790 WEB_ORIGIN=http://localhost:8790 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3790/v1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/02a3110/tools/patch.py <scratch>/dist && python3 -m http.server 8790 --bind 127.0.0.1 -d <scratch>/dist
G3_TEST_PASSWORD=<valor de prueba> node docs/evidence/round6/02a3110/tools/seed.mjs r11   # escribe seed-r11.json (fuera del repo si se copia la carpeta tools)
node docs/evidence/round6/02a3110/tools/capture.cjs seed-r11.json <shots>
node docs/evidence/round6/02a3110/tools/compose-evidence.cjs <shots> design/mobile <salida> docs/evidence/round6/02a3110/tools/mapping.json
G3_TEST_PASSWORD=<valor de prueba> node docs/evidence/round6/02a3110/tools/seed.mjs r12 && node docs/evidence/round6/02a3110/tools/extras.cjs seed-r12.json <checks>
```
Cada corrida de `capture.cjs` consume saldo de prueba: usar un seed nuevo por corrida. Usuarios `*.g3.*@example.test` sintéticos.
