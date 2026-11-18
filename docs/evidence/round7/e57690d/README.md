# Ronda 7 · H2 móvil — Compartir comprobante y PDF en M10 (código `e57690d`)

Commit de código: `e57690d` (sobre `10ac7fb`). Decisiones: [`docs/round7-notes.md` §9](../../../round7-notes.md).
Alcance: sólo `mobile/**`, `mobile/package.json`, `package-lock.json` y esta evidencia. No se tocaron `api/**`,
migraciones, seed, `wallet_dev` ni los puertos 3200/5174/8083.

## Niveles de evidencia

| Nivel | Qué | Resultado |
|---|---|---|
| Unit (jest, módulos nativos simulados) | `mobile/tests/receipt.test.tsx` (17) | Contenido del documento (monto, fecha de negocio, estado, terminaciones, concepto, referencia, folio UUID completo, aviso de demostración), ausencia de código, `requestId`, ids internos, CLABE completa, tokens y correo, escape de `&`, `<`, `>`, comillas simples/dobles y acento grave, ningún comprobante para `awaiting_confirmation/processing/rejected/expired/cancelled`; flujo feliz print → share → delete con `application/pdf` y `com.adobe.pdf`; hoja cerrada (resuelve o rechaza con "cancel") sin error; error de generación; error al compartir (mensaje sin rutas, archivo borrado); fallo al borrar sin error visible; Sharing no disponible (no se genera PDF); web con mensaje sin llamar módulos nativos; doble toque (una sola generación); error → reintento; borrado al desmontar con la hoja abierta. |
| Integración de pantalla (jest, App real) | `mobile/tests/app.test.tsx` · `round 7 H2` (3) + M10 existente | En M10 tras 201 `completed`: "Opciones de comprobante (opcional)", "Compartir comprobante", "Guardar PDF" (iOS en jest); doble toque → un `printToFileAsync`; indicador con nombre de la acción y la otra acción deshabilitada; HTML con folio y aviso, sin código ni correo ni CLABE; al cerrar la hoja no hay mensaje y se borra el archivo; error de generación con mensaje en español y reintento; en el paso de código (pendiente) no hay acciones. |
| Pruebas nuevas sin el cambio | `logs/mutation-*.txt` | Con `App.tsx` de `10ac7fb`: 3 de 4 fallan (la que pasa es la negativa "pendiente sin acciones"). Sin `src/receiptShare.ts` la suite no carga. |
| Render web (RN-Web, Chromium 390 px ×2) | `tools/h2cap.cjs` | Bundle real exportado; API respondida por Playwright (`page.route`, datos fijos, sin base de datos); `navigator.share` sustituido por un stub por estado. `logs/capture-h2.txt`: `scrollWidth` 390 en todos, 0 errores de página. |
| Bundles | `expo export --platform ios` / `web` | ios exit 0 (`logs/export-ios.txt`), web exit 0 (la rama nativa del PDF es código muerto en web: `Platform.OS` se inlinea). |
| Dependencias | `logs/dependency-diff.txt`, `logs/expo-install-check.txt` | Ver abajo. `npx expo install --check`: "Dependencies are up to date". |
| Raíz | `npm run lint`, `typecheck`, `test` | exit 0 (`logs/root-*.txt`; móvil 151/151). |
| Nativo (iPhone/simulador) | — | **Pendiente** (sin `simctl`/`adb` en este host). Ver abajo. |

## Estados (Stitch | normal | en curso | error | PDF en web)

[`shots/M10-H2--lado-a-lado.jpg`](shots/M10-H2--lado-a-lado.jpg) (las imágenes no se versionan: `.gitignore` excluye
`*.png`/`*.jpg`; se regeneran con "Reproducir"; los `.txt` de texto visible y los logs sí).

| Estado | Qué se ve | Medición (`logs/capture-h2.txt`) |
|---|---|---|
| Normal | Separador, "Opciones de comprobante (opcional)", "Compartir comprobante" y "Compartir PDF" (etiqueta web/Android; en iOS "Guardar PDF"). | sin deshabilitados, sin indicador |
| En curso (hoja abierta) | La acción pulsada muestra el indicador (nombre accesible "Compartir comprobante"), la otra queda deshabilitada y el texto vivo "Abriendo la hoja para compartir…". En el dispositivo el PDF muestra "Generando el PDF del comprobante…" (sólo jest: en web no se genera PDF). | deshabilitados=[Compartir PDF], ocupado=[Compartir comprobante] |
| Cerrar la hoja | `navigator.share` resuelve o rechaza con `AbortError`: la UI vuelve al estado normal sin mensaje. | "error shown = false" en ambos |
| Error | "No se pudo abrir la hoja para compartir. Inténtalo de nuevo." (alerta, reintentable, sin rutas). | — |
| PDF en web | "El PDF del comprobante solo se puede generar en la app para iOS o Android." | no se llama a expo-print/expo-sharing |

Texto compartido (`logs/shared-text.txt`): folio completo, aviso de demostración, terminaciones `•• 8412` / `•• 0028`; sin
CLABE completa, correo ni ids (`capture-h2.txt`: `full CLABE: false | e-mail: false | ids: false`). RN-Web pasa `title` y
`text` a `navigator.share`, por eso el título aparece dos veces en ese log; en iOS/Android el título es el de la hoja.

### Diferencia frente a Stitch (motivo)

- "Descargar PDF" → "Guardar PDF" (iOS) / "Compartir PDF" (Android y web): no hay descarga; el archivo se entrega a la hoja
  nativa. En iOS la hoja ofrece "Guardar en Archivos".
- A 390 px "Compartir comprobante" ocupa dos líneas: los botones usan 14 pt (escala de la ronda 7) en lugar del 12 px de la
  referencia; no se redujo el texto.
- El folio es el UUID real (no `DEMO-0001`) y no hay botón de copiar (el texto es seleccionable, sin cambio en esta tanda).

## Dependencias

Instaladas con las versiones de `expo/bundledNativeModules.json` (SDK 58): `expo-print ~58.0.9`, `expo-sharing ~58.0.23` y
`expo-file-system ~58.0.13` (ya estaba como transitiva de `expo`; ahora es directa porque se importa
`expo-file-system/legacy`). `package-lock.json` sólo añade esas tres entradas del workspace y los nodos `expo-print` y
`expo-sharing` (cuyas dependencias `@expo/plist`, `@expo/config-types`, `@expo/config-plugins` ya estaban). Integridad
sha512 de los tarballs verificada contra el lockfile.

Nota de procedimiento: en este worktree `node_modules` raíz es un enlace simbólico al checkout principal (donde corren el
Metro y la API de demostración). `npx expo install` habría ejecutado `npm install` sobre ese árbol, así que se usó el
equivalente sin tocarlo: `package.json` con las versiones exactas que `expo install` elige, `npm install
--package-lock-only` para el lockfile y los dos paquetes extraídos de sus tarballs en `mobile/node_modules` del worktree.
Un `npm ci` normal produce el mismo resultado hoisted.

## Pendiente nativo (iPhone)

- Hoja de compartir real de iOS con el texto y con el PDF (`UIActivityViewController`), incluido cerrarla sin elegir app.
- "Guardar en Archivos" desde la hoja y abrir el PDF guardado.
- PDF renderizado real por WebKit (`printToFileAsync`): tipografía, saltos de línea del folio, tamaño de página.
- Borrado real del archivo en `Caches/Print` tras compartir/cerrar/error y al salir de M10.
- `isAvailableAsync` real y VoiceOver con el indicador y los mensajes en vivo. Android: chooser real y etiqueta "Compartir PDF".

## Reproducir

```sh
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3795/v1 npx expo export --platform web --output-dir <scratch>/h2-dist
python3 -I ../docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/h2-dist
python3 -I -m http.server 8795 --bind 127.0.0.1 -d <scratch>/h2-dist
node docs/evidence/round7/e57690d/tools/h2cap.cjs docs/evidence/round7/e57690d/shots <checkout>/design/mobile
```
