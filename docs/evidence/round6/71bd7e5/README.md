# Ronda 6 · G4 móvil — F-15 a F-19 (código `71bd7e5`)

Evidencia de la tanda G4 (modo fix) sobre `feature/product-mvp`. Commits, en orden: `69c11d5` F-15, `5d124b5` F-16,
`29304dd` F-16 (tipado de la prueba: `5d124b5` se publicó con un error de `tsc` en la prueba nueva; ningún cambio de app),
`d0f0f64` F-17, `e0f4335` F-19, `71bd7e5` F-18, `e460d06` (sólo un comentario de prueba que apunta a esta carpeta; el bundle
es el mismo que el de `71bd7e5`).

**No es evidencia nativa.** Es el bundle real (`expo export --platform web`) en Chromium (Playwright, 390 px lógicos ×2)
contra una API aislada (`dev:api:testdb`, puerto 3793) sobre `wallet_test` migrada con `db:migrate:test`; bundle servido en
8793. No se tocaron `wallet_dev` ni 3200/5174/8083. Datos sintéticos `*.g4.*@example.test`; la contraseña de prueba se generó
por corrida y sólo vivió en una variable de entorno (los `seed-*.json` que la contienen se escribieron fuera del repositorio).
"Antes" = bundle de `2ab42b4` (código evaluado en el pass 6) medido con los mismos scripts.

## Hallazgos

| ID | Corrección | Prueba que falla sin el fix | Render web: antes (`2ab42b4`) → después (`71bd7e5`) |
|---|---|---|---|
| F-15 | Sólo en la variante umbral de M07: hero con `paddingVertical` 12 (en lugar de 16) y separación de 12 px (en lugar de 24) entre "Saldo posterior estimado" y las acciones. Las otras variantes conservan p-4 y 24 px de Stitch. | `F-15: …` (jest): estilos de la variante umbral vs normal (2 casos fallan sin el fix). | 390×844 umbral: "Modificar datos" `812-856` → `792-836` (primario `736-784`); 390×884 `817-861` → `797-841`. Normal y propias sin cambio (`776-820`, `792-836` a 844). A 390×763 (844 − safe area 47+34 de un iPhone 14), tras desplazar al final las tres variantes muestran primario `639-687` y "Modificar datos" `695-739`: el scroll alcanza todo. `checks/f15-antes-2ab42b4-log.txt`, `checks/f15-log.txt`, `checks/F15-*.jpg`. |
| F-16 | Filas etiqueta-valor (M06 cabeceras y nombre+alias, M07 meta, M04 detalle/folio, M11) con `flexWrap: 'wrap'` y valor que puede encoger (`flexGrow 1 / flexShrink 1 / flexBasis 0`); líneas de importe de M04/M07/M08/M10 con `flexWrap` y `minWidth: 0`; M04 y M08 ya no anidan "MXN" dentro del texto de una línea del importe. | `F-16: …` (jest, `fontScale` 1.3 y 2): estructura de filas y de importes (6 casos fallan sin el fix). | Con datos largos (nombre de 63 car., beneficiario de 112, alias de 79, concepto de 39, folios UUID reales) en M01, M02, M03, M04 enviada/recibida, M05, M06 con selector, M07 normal y umbral, M08, M09, M10, M11: cajas fuera de 390 px a 100/130/200 % = 0/0/21 → 0/0/0. `checks/f16-antes-2ab42b4-log.txt`, `checks/f16-log.txt`, `checks/F16-*x2-*.jpg` (antes y después a 200 %). |
| F-17 | `FONT_LOAD_TIMEOUT_MS` 6000 → 2500. | `typography-timeout.test.tsx` (temporizadores falsos, `loadAsync` que nunca responde): a 2.4 s sigue "Cargando", a 2.5 s login con fuente del sistema y peso real. Falla con 6000. | Login usable (3 corridas c/u): normal 0.88 s con Inter (CDP: `Inter`, `Inter Medium`, `Inter SemiBold`); `.ttf` abortado 0.88 s con `.SF NS`; `.ttf` colgado **6.43 s → 3.40 s** con `.SF NS` (≈0.9 s de carga de página + 2.5 s). `checks/f17-*.txt`, `checks/F17-*.jpg`. |
| F-19 | Nombre accesible = texto visible (o lo contiene al inicio): "Solicitar nuevo código de demostración" (las dos variantes), "Transferir dinero, elegir beneficiario", aviso "Última actualización de saldo. …", conmutador de origen "Listo, cerrar las cuentas de origen" cuando muestra "Listo", selector/opciones de cuenta de M03 (`Cuenta principal (•• 1234), cambiar cuenta` / `…, ver sus movimientos`), campos de M06 "Monto a transferir", "Concepto de pago", "Referencia numérica (hasta 7 dígitos)". Scripts de captura de G2/G3 actualizados a los nombres nuevos. | `F-19: …` (jest): recorre M02, M05, M06 (selector cerrado/abierto), M07, M08 (vigente y expirado), M03 (selector abierto) y M04; cada control con `accessibilityLabel` debe contener su primer texto visible (3 casos fallan sin el fix). | `checks/f19-log.txt`: 16 controles con nombre en M02/M03/M06/M08, 0 sin su texto visible; un comando de voz por nombre exacto "Solicitar nuevo código de demostración" encuentra 1 control. Controles sólo-ícono (atrás, cerrar sesión, mostrar contraseña, limpiar búsqueda) no tienen texto visible y conservan su etiqueta. |
| F-18 | Documentado en `docs/round6-contract-notes.md` §7 (cuándo rompe un build y cómo proceder). `packages/shared/package.json` sin cambios. Prueba barata nueva `mobile/tests/shared-imports.test.ts`. | Mutación: añadir `import { isValidClabe } from '@fintech-wallet/shared'` a `App.tsx` hace fallar la prueba; la misma mutación hace fallar `expo export --platform web` con `Unable to resolve "./money.js" from "packages/shared/src/index.ts"` (`checks/f18-value-import-export.log`). Revertida. | — |

## Estados regenerados (16)

Sólo los estados cuyo layout tocó esta tanda (F-15/F-16). Lado a lado = PNG original `design/mobile/*/screen.png` (izq.) |
captura (der.); diferencia = `mix-blend-mode: difference` (negro = igual). Alto de viewport = alto de la referencia escalado a
390 px (igual que G3). Las capturas de 30 estados se corrieron completas (`checks/runlog.txt`) pero sólo se publican estas.

| Estado | Qué cambió en esta tanda | Qué persiste (sin cambio respecto a la evaluación de `2ab42b4`) |
|---|---|---|
| [M07 umbral](M07-revision-umbral--lado-a-lado.jpg) · [dif](M07-revision-umbral--diferencia.jpg) | Hero 8 px más bajo y 12 px menos sobre las acciones: "Continuar a verificación" y "Modificar datos" visibles en el alto de 844 (en el alto de la referencia, 931, quedan más arriba que en Stitch). | Texto propio del chip (`mayor o igual … (umbral de demostración)`), sin chip "Sin costo de comisión" ni pie "Escenario ilustrativo". |
| [M07](M07-revision--lado-a-lado.jpg) · [dif](M07-revision--diferencia.jpg), [M07 propias](M07-revision-propias--lado-a-lado.jpg) · [dif](M07-revision-propias--diferencia.jpg) | Nada visible a 100 % (filas meta con `wrap`; con datos cortos quedan igual). | Sin chip de comisión; "Transferencia interna" en lugar de "Inmediata"; título "Revisar transferencia". |
| [M06](M06-datos--lado-a-lado.jpg) · [dif](M06-datos--diferencia.jpg), [M06 propias](M06-datos-propias--lado-a-lado.jpg) · [dif](M06-datos-propias--diferencia.jpg), [M06 selector](M06-selector-origen--lado-a-lado.jpg) · [dif](M06-selector-origen--diferencia.jpg), [texto 130 %](I-texto-130-M06--lado-a-lado.jpg) · [dif](I-texto-130-M06--diferencia.jpg) | Nada visible a 100 %: cabeceras y nombre+alias pueden pasar a una segunda línea sólo cuando no caben (200 %, alias de 79 car.). | Enlace "Cambiar cuenta" y línea "Disponible hoy … límites de demostración" (funcionales, sin Stitch); a 130 % "Continuar" visible. |
| [M04 enviada](M04-detalle-enviada--lado-a-lado.jpg) · [dif](M04-detalle-enviada--diferencia.jpg), [M04 recibida](M04-detalle-recibida--lado-a-lado.jpg) · [dif](M04-detalle-recibida--diferencia.jpg) | Importe y "MXN" son hermanos en una fila (antes "MXN" anidado): mismo aspecto a 100 %; a 200 % "MXN" baja de línea. El folio UUID sigue junto a "Folio interno" en 2 líneas y sólo baja de fila si su tramo más largo no cabe. | "Para"/"Enviada" en lugar de "Cuenta destino"/"Completada"; folio real sin botón copiar. |
| [M08 vacío](M08-codigo-vacio--lado-a-lado.jpg) · [dif](M08-codigo-vacio--diferencia.jpg), [M08 vigente](M08-codigo-vigente--lado-a-lado.jpg) · [dif](M08-codigo-vigente--diferencia.jpg), [M08 expirado](M08-codigo-expirado--lado-a-lado.jpg) · [dif](M08-codigo-expirado--diferencia.jpg) | Importe "IMPORTE" en fila propia que puede usar todo el ancho y bajar debajo del destinatario con texto grande; a 100 % igual. Etiqueta accesible del botón de nuevo código = texto visible (no cambia la imagen). | Recuadro del código de demostración (enmascarado), "Solicitar nuevo código" en lugar de "Reenviar", cuenta regresiva real `mm:ss`. |
| [M10](M10-comprobante--lado-a-lado.jpg) · [dif](M10-comprobante--diferencia.jpg), [M10 propias](M10-comprobante-propias--lado-a-lado.jpg) · [dif](M10-comprobante-propias--diferencia.jpg) | Línea de importe con `wrap`: a 200 % "MXN" baja y el importe ya no sale por la izquierda (antes `left=-9`); a 100 % igual. | Sin Compartir/PDF ni "auditada y cifrada"; folio UUID en 2 líneas. |
| [M11 rechazada](M11-rechazada-saldo--lado-a-lado.jpg) · [dif](M11-rechazada-saldo--diferencia.jpg), [intento expirado](M11-intento-expirado--lado-a-lado.jpg) · [dif](M11-intento-expirado--diferencia.jpg) | Filas con `wrap`: a 200 % el valor baja bajo su etiqueta (antes `$1,000.00 MXN` hasta x=425); a 100 % igual. | Sin pestañas QA de Stitch; motivo de la API; estado expirado sin referencia propia. |

No regenerados (sin cambio de layout en esta tanda): M01, M02, M03, M05, M09, M12, viewport reducido. En M02/M03/M05 sólo
cambiaron nombres accesibles (no visibles).

## Pendiente nativo (iPhone/simulador; no disponible en este host)

- `fontScale`/Dynamic Type real a 130/200 % (aquí: aproximación CSS de `font-size`): en Yoga `flexBasis: 0` no tiene mínimo
  por contenido, así que con 200 % una palabra larga puede partirse dentro de su valor en vez de bajar de fila; los importes de
  una línea usan `adjustsFontSizeToFit` (en web se recortan, en nativo se reducen).
- Safe area real de M07 a 390×844 (aquí: viewport de 763 px como aproximación de 844 − 47 − 34).
- Carga de Inter con `expo-font` en Expo Go/dev build (las TTF van en el export ios) y el tiempo de espera de 2.5 s.
- VoiceOver/Control por voz reales con los nombres nuevos.
- Los pendientes previos siguen: Hermes, SecureStore/Keychain, AppState (F-05), teclado iOS, gesto atrás en el paso de código.

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3793 WEB_ORIGIN=http://localhost:8793 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3793/v1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8793 --bind 127.0.0.1 -d <scratch>/dist
export G4_TEST_PASSWORD=<valor de prueba> G4_SEED_DIR=<scratch>/seeds        # fuera del repositorio
node docs/evidence/round6/71bd7e5/tools/seed.mjs g4a && node docs/evidence/round6/71bd7e5/tools/capture.cjs <scratch>/seeds/seed-g4a.json <shots>
node docs/evidence/round6/71bd7e5/tools/compose-evidence.cjs <shots> design/mobile <salida> docs/evidence/round6/71bd7e5/tools/mapping-g4.json
cd docs/evidence/round6/71bd7e5/tools && node f15.cjs <out> && node f16.cjs <out> && node f17.cjs <out> && node f19.cjs <out>
```
`capture.cjs`, `f16.cjs` y `f19.cjs` gastan saldo de prueba (cada corrida registra usuarios nuevos). Puertos por
`G4_API_PORT`/`G4_WEB_PORT` (por defecto 3793/8793). Herramientas de G3 copiadas y adaptadas (puertos, contraseña por entorno,
seed fuera del repo); `g4lib.cjs` + `f15`-`f19` son nuevas.
