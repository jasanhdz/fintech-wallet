# Evaluación independiente ronda 7, pasada 8 (código `1302862`)

Nivel: unit (jest) + mutaciones, integración API/PostgreSQL (`wallet_test`), render RN-Web (export web de Expo, Chromium 390 px @2x).
**No es evidencia nativa** (sin simulador/iPhone/`simctl`; F-05). Ningún cambio de código de la aplicación: las mutaciones se
restauraron con `git checkout` (`git status` final: sólo esta carpeta).

Entorno propio: API aislada `npm run dev:api:testdb` sobre `wallet_test` (migrada con `npm run db:migrate:test`) en 3897
(política por defecto: umbral 500000, expiración 300 s, 5 intentos, límite 2,000,000), 3898 (umbral 123456, expiración 90 s, 3
intentos, límite 1,500,000) y 3899 (igual que 3898 con expiración 8 s, sólo para vencimiento real); bundle web exportado con
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3897/v1` y servido en 8897 (shim de SecureStore sólo en la copia exportada, `round6/71bd7e5/tools/patch.py`);
las llamadas a 3898/3899 se reescriben con `page.route`. No se usó `wallet_dev` ni 3200/5174/8083; todos los procesos propios se
terminaron. Usuarios sintéticos `*.ev8.*@example.test`; la contraseña de prueba sólo por variable de entorno
(`EV_TEST_PASSWORD`). El código OTP se lee en memoria (DOM/respuesta) y nunca se imprime: logs y `shots/*.txt` lo enmascaran y en
las capturas el recuadro "Código asignado para esta prueba" está difuminado (se verificó con `grep` que no hay OTP en la carpeta).

- `tools/`: `lib.cjs` (helpers), `api-ev8.cjs` (umbral, código nuevo, llave nueva), `ui-m02-m09.cjs` (M02, aviso pendiente, segundo intento),
  `ui-otp.cjs` (M07/M08: umbral, barra, estados, expiración, cancelación, código nuevo, incertidumbre), `ui-m09-m12.cjs`, `ui-share.cjs`,
  `ui-dbltap.cjs`, `receipt-html.ts`, `ui-labels.cjs` (F-20 y objetivos táctiles), `ui-overflow.cjs` (100/130/200 % con datos largos),
  `ui-f15.cjs`, `ui-fid.cjs` + `compose-ev8.cjs` + `mapping-ev8.json` (fidelidad), `ui-type.cjs`/`ui-focus.cjs`/`ui-reload-otp.cjs`, `e2e.cjs`, `mutate.py`.
- `logs/`: salida de cada corrida (`.txt`), mutaciones (`mutations*.txt`), raíz (`root-*.txt`), integración una suite a la vez
  (`integration-*.txt`), exports (`export-*.txt`, `ios-bundle-strings.txt`), dependencias (`expo-install-check.txt`, `npm-ci-dry-run.txt`),
  contrato del umbral (`threshold-contract.txt`), `fidelity-metrics.txt`.
- `shots/` (PNG no versionados por `.gitignore`; los `.txt` de texto visible sí), `tri/` (Stitch | captura | diferencia, 17 estados), `artifacts/` (HTML/texto del comprobante con concepto malicioso).

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3897 WEB_ORIGIN=http://localhost:8897 npm run dev:api:testdb
API_PORT=3898 WEB_ORIGIN=http://localhost:8897 OTP_EXPIRY_SECONDS=90 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
API_PORT=3899 WEB_ORIGIN=http://localhost:8897 OTP_EXPIRY_SECONDS=8 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3897/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8897 --bind 127.0.0.1 -d <scratch>/dist
export EV_TEST_PASSWORD=<valor de prueba>; cd docs/evidence/round7/eval-1302862
EV_OUT=. EV_API_PORT=3897 node tools/ui-m02-m09.cjs        # F-21
EV_OUT=. EV_API_PORT=3898 node tools/ui-otp.cjs            # M07/M08 (SKIP_O1=1 omite el bloque M07)
EV_OUT=. EV_API_PORT=3897 node tools/ui-m09-m12.cjs        # M09, M11, M12 (F-22)
python3 -I tools/mutate.py                                  # mutaciones (restaura con git checkout)
```

El límite de autenticación (10/min) obliga a esperar entre usuarios (los scripts esperan o reintentan); cada corrida tarda minutos.
