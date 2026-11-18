# Evaluación independiente ronda 7, pasada 10 (código `07903cd`; cambios `d0fee0d..07903cd`)

Alcance acotado pedido por el usuario: cerrar los bloqueos financieros F-21, F-26, F-27, F-28 (reglas H5 de recuperación). Ningún cambio de código de la
aplicación: las 36 mutaciones se restauraron con `git checkout -- mobile/App.tsx` (árbol final: sólo esta carpeta y `FINDINGS.md`).
`git diff d0fee0d..07903cd -- api specs packages` = 0 líneas (el backend, el contrato y la regla `>=` de F-23 no cambiaron).

Niveles: unitario (jest) + mutaciones; integración API real + PostgreSQL `wallet_test` (curl/fetch + psql); render RN-Web (export web de Expo en Chromium
390 px, Playwright) con API y BD reales. **No es evidencia nativa** (sin simulador/iPhone; F-05).

Entorno propio: `npm run db:migrate:test`; APIs `npm run dev:api:testdb` en 3991 (política por defecto), 3992 (umbral 123456, 90 s, 3 intentos, límite 1,500,000)
y 3993 (8 s); web exportada con `EXPO_PUBLIC_API_URL=http://127.0.0.1:3991/v1` y servida en 8991 (shim SecureStore->localStorage sólo en la copia exportada,
`docs/evidence/round6/71bd7e5/tools/patch.py`). No se usó `wallet_dev`, 3200/5174/8083 ni Lucem; los procesos propios se terminaron por PID. El código OTP se
lee en memoria y nunca se imprime (verificado con `grep`: 0 coincidencias en logs/shots/tools; contraseña de prueba aleatoria por variable de entorno, 0
coincidencias; 0 CLABE de 18 dígitos). Los "fallos" simulados usan `page.route` (la petición llega al servidor real y se descarta/altera la respuesta, o nunca sale);
el 409 "en curso" real se obtuvo de una carrera real (`mode: race`), el 404 de GET/POST es real (la API contestó), el 422/429 de reenvío es real.

## Contenido

- `tools/`: `lib.cjs` (copia de la pasada 9), `h10.cjs` (controlador de red/BD/auditoría), `api-ev10.cjs` y `api-ev10b.cjs` (criterio 8), `ui-ev10-1.cjs` (primer envío con 9
  respuestas distintas), `ui-ev10-2.cjs` (reenvío 409/4xx, carrera 409 real, 404 real GET y POST, registro corrupto, SecureStore ilegible, cargo coincidente real, GET 4xx con id,
  rechazo real del reenvío, registro cambiado), `ui-ev10-3.cjs` (intento pendiente de código/M08, F-22), `ui-ev10-4.cjs` (compartir/PDF sólo completed), `mutate10.py` (36 mutaciones),
  `reg-*.cjs` (copias de la pasada 9 para regresión; las partes que dependían de la regla anterior quedaron obsoletas, ver abajo).
- `logs/`: `root-*.txt` y `integration-*.txt` (Node 26.3.0 del host), `root26131-*.txt` y `integration26131-*.txt` (Node 26.13.1 pinneado por `.nvmrc`), `api-ev10*.txt`,
  `ui-ev10-*-stdout.txt`, `mutations10.txt`, `residue-check*.txt`, `reg-*`, exports y `api39xx.log`.
- `shots/`: PNG (ignorados por `.gitignore`) y `.txt` de texto visible (el código OTP enmascarado).

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3991 WEB_ORIGIN=http://localhost:8991 npm run dev:api:testdb
API_PORT=3992 WEB_ORIGIN=http://localhost:8991 OTP_EXPIRY_SECONDS=90 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
API_PORT=3993 WEB_ORIGIN=http://localhost:8991 OTP_EXPIRY_SECONDS=8 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3991/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8991 --bind 127.0.0.1 -d <scratch>/dist
export EV_TEST_PASSWORD=<valor de prueba>; cd docs/evidence/round7/eval-07903cd
EV_OUT=. node tools/api-ev10.cjs ; EV_OUT=. node tools/api-ev10b.cjs
EV_OUT=. EV_CASES=409-applied,409-notapplied,400,401,403,429-rate,500-applied,lost-after,lost-before node tools/ui-ev10-1.cjs
EV_OUT=. EV_SC=resend409,resend4xx,race,get404,post404,corrupt,unreadable,matching,matching2,get4xx,resend422,resendstale node tools/ui-ev10-2.cjs
EV_OUT=. node tools/ui-ev10-3.cjs ; EV_OUT=. node tools/ui-ev10-4.cjs
python3 -I docs/evidence/round7/eval-07903cd/tools/mutate10.py   # desde la raíz del repo
```

El límite de autenticación (10/min) hace esperar a los scripts entre usuarios; cada corrida tarda minutos.

## Notas de honestidad sobre la evidencia

- `ui-ev10-1` con 8 casos se ejecutó dos veces solapadas por un descuido (`ui-ev10-1-cases-8.txt` y `...-replica.txt`): 192 PASS / 0 FAIL cada una (usuarios distintos). El caso 9 (`lost-after`) en `ui-ev10-1-case-lost-after.txt` (24 PASS).
- `ui-ev10-3-run1-*` son la primera corrida de ese script, que falló por defectos del propio script (contaba como "POST nuevo" el envío original y esperaba Inicio donde el arranque reabre M08); se corrigió el script y la segunda corrida (`ui-ev10-3-stdout.txt`) pasa 39/39. No fue un defecto del producto.
- `reg-ui-share`: sus pasos finales dependían de que "Verificar" reenviara el POST (regla anterior); fallan por esa razón, no por un defecto. Se sustituyeron por `ui-ev10-4.cjs`.
  `reg-ui-m02-m09` y `reg-ui-m09-m12` imprimen líneas de la regla anterior ("replays with key ...", "resumed -> other"): son comprobaciones obsoletas, no regresión; lo vigente lo cubren `ui-ev10-1/2/3`.
- `reg-ui-otp` se corrió dos veces: la primera sin la API 3993 (bloque de expiración sin servidor), la segunda con 3993: completa.
- En la comparativa "double tap" de `reg-ui-share` el contador da 2 igual que en las pasadas 8 y 9 (el script cuenta distinto); `ui-dbltap` (mismo tick) da 1 llamada.
