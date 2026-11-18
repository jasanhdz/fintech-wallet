# Evaluación independiente ronda 7, pasada 9 (código `b392a5f`; cambios `261decc..b392a5f`)

Nivel: unit (jest) + mutaciones, integración API/PostgreSQL (`wallet_test`), render RN-Web (export web de Expo en Chromium 390 px @2x).
**No es evidencia nativa** (sin simulador/iPhone; F-05). Ningún cambio de código de la aplicación: las mutaciones se restauraron con
`git checkout` (`git status` final: sólo esta carpeta y `FINDINGS.md`).

Entorno propio (puertos 3991/3992/3993 y 8991; no se usó `wallet_dev`, 3200/5174/8083 ni Lucem): `npm run db:migrate:test`;
API aislada `npm run dev:api:testdb` en 3991 (política por defecto: umbral 500000, expiración 300 s, 5 intentos, límite 2,000,000),
3992 (umbral 123456, 90 s, 3 intentos, límite 1,500,000) y 3993 (igual que 3992 con 8 s de expiración); bundle web de Expo exportado con
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3991/v1` y servido en 8991 (shim de SecureStore -> localStorage sólo en la copia exportada,
`docs/evidence/round6/71bd7e5/tools/patch.py`). Los intentos "respuesta perdida / sin red" se simulan con `page.route` (la petición
llega al servidor real y se descarta la respuesta, o nunca sale). El 409 "en curso" del escenario E4 y el 404 de la consulta del
escenario E son respuestas **simuladas** con el mismo cuerpo que emite la API (`api/src/http/app.ts:131`); el 404 de "beneficiario
inexistente" es una respuesta **real** de la API. El código OTP se lee en memoria (DOM/respuesta) y nunca se imprime: logs y `shots/*.txt`
lo enmascaran y en las capturas el recuadro "Código asignado para esta prueba" está difuminado (se verificó con `grep`). Usuarios
sintéticos `*.ev9.*@example.test`; la contraseña de prueba sólo por variable de entorno (`EV_TEST_PASSWORD`). Todos los procesos propios
se terminaron.

## Contenido

- `tools/` (reproducibles): `lib.cjs` (helpers), `ui-f21.cjs` (F-21: respuesta perdida antes/después de aplicarse, auditoría de entradas, recarga,
  relogin, primer plano), `ui-f21b.cjs` (intento pendiente de código, salidas de M08, código nuevo, rechazo al confirmar),
  `ui-f21c.cjs` (F-22, hueco único antiguo, registros que no se resuelven, 409 "en curso", expirado/cancelado por el servidor),
  `ui-f21d.cjs` (registro corrupto/ilegible al enviar, 500 con aviso visible), `ui-f21e.cjs` (sesión vencida), `ui-m02-m09.cjs` (escenario original adaptado),
  `ui-f24.cjs` (pegado), `ui-f25.cjs` (avatares 100/130/200 %), `ui-f15.cjs` (posición de acciones M07), `ui-fid9.cjs` + `compose-ev9.cjs` +
  `mapping-ev9.json` (fidelidad), `mutate9.py` (mutaciones), y las copias de la pasada 8 adaptadas a los puertos 399x (`api-ev9.cjs`, `ui-otp.cjs`,
  `ui-m09-m12.cjs`, `ui-share.cjs`, `ui-dbltap.cjs`, `receipt-html.ts`, `ui-labels.cjs`, `ui-overflow.cjs`, `ui-reload-otp.cjs`, `e2e.cjs`).
- `logs/`: salida de cada corrida (`ui-*.txt`, `*-stdout.txt`), `mutations.txt`, raíz (`root-*.txt`), integración una suite a la vez (`integration-*.txt`),
  exports (`export-*.txt`, `ios-bundle-strings.txt`), `expo-install-check.txt`, `npm-ci-dry-run.txt`, `fidelity-metrics.txt`.
- `shots/` (PNG no versionados por `.gitignore`; los `.txt` de texto visible sí), `tri/` (Stitch | captura | diferencia), `artifacts/` (HTML/texto del comprobante con concepto malicioso).

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3991 WEB_ORIGIN=http://localhost:8991 npm run dev:api:testdb
API_PORT=3992 WEB_ORIGIN=http://localhost:8991 OTP_EXPIRY_SECONDS=90 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
API_PORT=3993 WEB_ORIGIN=http://localhost:8991 OTP_EXPIRY_SECONDS=8 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3991/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8991 --bind 127.0.0.1 -d <scratch>/dist
export EV_TEST_PASSWORD=<valor de prueba>; cd docs/evidence/round7/eval-b392a5f
EV_OUT=. node tools/ui-f21.cjs ; EV_OUT=. node tools/ui-f21b.cjs ; EV_OUT=. node tools/ui-f21c.cjs ; EV_OUT=. node tools/ui-f21d.cjs ; EV_OUT=. node tools/ui-f21e.cjs
EV_OUT=. node tools/ui-m02-m09.cjs ; EV_OUT=. node tools/ui-f24.cjs ; EV_OUT=. node tools/ui-f25.cjs ; EV_OUT=. node tools/ui-f15.cjs
EV_OUT=. node tools/ui-fid9.cjs && node tools/compose-ev9.cjs shots <repo-principal>/design/mobile tri tools/mapping-ev9.json
EV_OUT=. EV_API_PORT=3992 node tools/ui-otp.cjs ; EV_OUT=. node tools/ui-m09-m12.cjs ; python3 -I tools/mutate9.py
```

El límite de autenticación (10/min) obliga a esperar entre usuarios (los scripts esperan o reintentan); cada corrida tarda minutos.

## Limitaciones de las herramientas (no del producto)

- `ui-otp.cjs` (copia de la pasada 8) teclea con `input.click()`; en RN-Web un clic de ratón no enfoca el campo (`DismissKeyboardArea`, ver F-05), por eso
  sus líneas "M08 incomplete" y "after typing 3 4-5" no son concluyentes; el pegado y el tecleo se midieron con `focus()` en `tools/ui-f24.cjs`.
- La cola de `ui-m09-m12.cjs` (M12 con registro "bound to user") parte de la regla anterior (cerrar sesión borraba el registro) y de que el aviso necesitaba un toque;
  con la regla actual Inicio resuelve solo. Esa parte la sustituyen `ui-f21c.cjs` (F-22) y `ui-f21e.cjs` (sesión vencida).
- `pdftotext` no está instalado: el PDF del comprobante no se extrajo a texto (el HTML real se renderizó en Chromium y se verificó el escape).
