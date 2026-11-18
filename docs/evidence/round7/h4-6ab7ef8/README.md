# Ronda 7 · tanda H4 (pasada 9): F-26, F-21 residual, F-27, F-28 — evidencia (código `6ab7ef8`)

Commits de la tanda sobre `47391bb`: `d387e83` fix F-26, `85792b2` fix F-21, `b89f54f` fix F-27, `6ab7ef8` fix F-28 (sólo
pruebas), `d7a26fa` docs (`docs/round7-notes.md` §11). El código de la app evaluado aquí es `mobile/App.tsx` de `b89f54f`
(idéntico en `6ab7ef8`). Reglas y riesgo aceptado: `docs/round7-notes.md` §11.

Niveles: unitario (jest, render RN) + mutaciones; integración real API + PostgreSQL `wallet_test` a través del render web
(export de Expo para web en Chromium, 390 px @2x). **No es evidencia nativa** (sin simulador/iPhone: Keychain real, `AppState`
real, `Modal` con VoiceOver siguen pendientes, F-05). El export para iOS sólo prueba que el bundle Hermes compila y contiene los
textos nuevos (`logs/ios-bundle-strings.txt`).

Entorno propio (no se usó `wallet_dev`, 3200/5174/8083 ni Lucem): `npm run db:migrate:test`; API aislada `npm run dev:api:testdb`
en 3994 (política por defecto), 3995 (umbral 123456, 90 s, 3 intentos, límite 1,500,000) y 3996 (igual con 8 s); bundle web con
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3994/v1`, parcheado sólo en la copia exportada (`docs/evidence/round6/71bd7e5/tools/patch.py`,
SecureStore -> localStorage) y servido en 8994. Usuarios sintéticos `*.h4.*@example.test`; contraseña de prueba aleatoria por
variable de entorno, nunca escrita. Respuestas "perdidas" y el 409 "en curso" se simulan con `page.route` (la petición llega al
servidor real y se descarta la respuesta, o no sale); **los 404 son respuestas reales de la API**. Los escenarios H4 están bajo el
umbral (sin código); en las regresiones el código OTP sólo se lee en memoria y se enmascara (`••••••`) en logs y `shots/*.txt`.
Procesos propios terminados al final.

## Resultados

| Nivel | Qué | Resultado |
|---|---|---|
| Raíz | `npm run lint`, `npm run typecheck`, `npm test` | exit 0 los tres (`logs/root-*.txt`); api 7/7, web 20/20, **mobile 185/185** (160 previas + 25 de `tests/recovery-h4.test.tsx`), shared 4/4 |
| Export | `expo export --platform web` / `--platform ios` | exit 0 (`logs/export-web.txt`, `logs/export-ios.txt`); el `.hbc` contiene los textos nuevos |
| Mutaciones | `tools/mutate-h4.py` (14 cambios en `App.tsx`, restaurados con `git checkout`) | **14/14 matadas, 0 sobreviven** (`logs/mutations.txt`), incluidas las dos de F-28 |
| Pruebas que fallan sin el cambio | jest nuevo contra el `App.tsx` anterior a cada fix | F-26: 7 de 14 fallan (las 7 restantes son guardas de "no liberar" que ya se cumplían y se protegen con mutaciones); F-21: 7/7; F-27: 6 (2 nuevas + 4 ajustadas) |
| Render web + API real | `tools/ui-h4.cjs` (S1-S6) | todos `PASS` (`logs/ui-h4-S1.txt`, `logs/ui-h4.txt`) |
| Regresión | `ui-m02-m09.cjs`, `ui-otp.cjs`, `ui-share.cjs`, `ui-dbltap.cjs` (copias de la pasada 9 con puertos 399x/8994) | exit 0 los cuatro (`logs/ui-*-stdout.txt`). M02: Ahorro -> Ahorro sólo "Elegir otro destinatario" (0 `POST`), pares válidos con "Continuar"; M09 -> Inicio con aviso sin "Continuar", "Verificar" con la misma llave -> 1 transferencia, débito 30025. Umbral (API 3995): 1,234.55 sin código, 1,234.56/1,234.57 con código; M08 vacío/completo/verificando/422/3.º fallo 429/código nuevo con cancelación confirmada/vencimiento real 8 s (API 3996)/cancelar/código nuevo con intento ilegible (0 `POST`); el código nunca se imprime. Compartir: 1 llamada con doble toque (`ui-dbltap`), sin CLABE completa/correo/token, 0 acciones en M09/M04, HTML real del comprobante escapado. Mismas limitaciones de herramienta que la pasada 9 (tecleo con `click()` en `ui-otp`, "double tap … 2" de `ui-share`, `pdftotext` ausente) |

### Escenarios con API real (`tools/ui-h4.cjs`)

- **S1 F-21 original + F-27**: Principal -> Ahorro $300.25, respuesta perdida *después* de aplicarse, red caída; Inicio sólo el
  aviso + "Verificar estado" + "Descartar este intento" (0 entradas a una transferencia nueva). Con la red de vuelta, 2 vueltas a
  primer plano: **0 `POST /transfers`**. Toque en "Verificar estado": comprobante, 1 llave, BD `completed:30025`, 2 asientos suma 0,
  débito 30025, registro borrado.
- **S1b descarte tras revisar**: respuesta perdida *antes* de aplicarse; 2 vueltas a primer plano con red: 0 `POST`, BD vacía (antes
  de F-27 esto creaba y debitaba solo). Movimientos revisados (sin cargo). Diálogo (`role=dialog`, `aria-modal`) con la
  advertencia; "Conservar intento" deja el registro idéntico; "Descartar intento" lo borra y Inicio lo anota. Nueva transferencia
  $120.00: BD `completed:12000`, un solo débito.
- **S2 E4 (409 "en curso" simulado en el reintento)**: se queda en M09 (no M11), registro idéntico; "Ir al inicio" -> aviso sin
  entradas nuevas; con la red normal, toque -> comprobante; 1 llave, BD `completed:30025`, 1 débito.
- **S3 (a) GET 404 real** de un `transferId` desconocido: al reiniciar, 1 `GET` y liberación con "El servidor no tiene registro de la
  operación de $333.33 MXN (Ref: 5)…"; 0 `POST`; luego exactamente una transferencia (BD `completed:10000`).
- **S3b 404 real "Beneficiario no encontrado"** en la repetición: reinicio + primer plano 0 `POST`; tras el toque M11 con el motivo,
  registro borrado, "Transferir dinero" de vuelta; BD vacía.
- **S4 registro corrupto**: "Registro de transferencia dañado" sin texto técnico; descarte; una transferencia.
- **S5 SecureStore ilegible**: al confirmar, mensaje y 0 `POST`; al reiniciar, "No pudimos comprobar tus transferencias" sin entradas
  nuevas; descartar con el borrado fallando -> "No pudimos descartar el registro en este dispositivo…" sin fingir éxito;
  almacenamiento de vuelta + "Reintentar comprobación" -> flujo disponible.
- **S6 F-22 / cierre de sesión**: A deja un intento incierto y cierra sesión (registro idéntico); B entra (no ve el aviso, 0 peticiones
  a `/transfers` al entrar), transfiere $150.00 y sale: registro de A idéntico. A entra: aviso, 0 `POST` sin toque; toque -> misma
  llave, comprobante; A `completed:30025` (2 asientos suma 0), B `completed:15000`.

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3994 WEB_ORIGIN=http://localhost:8994 npm run dev:api:testdb
API_PORT=3995 WEB_ORIGIN=http://localhost:8994 OTP_EXPIRY_SECONDS=90 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
API_PORT=3996 WEB_ORIGIN=http://localhost:8994 OTP_EXPIRY_SECONDS=8 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3994/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8994 --bind 127.0.0.1 -d <scratch>/dist
export EV_TEST_PASSWORD=<valor de prueba>; cd docs/evidence/round7/h4-6ab7ef8
EV_OUT=. node tools/ui-h4.cjs            # ONLY=S1,S2,... para un subconjunto
EV_OUT=. node tools/ui-m02-m09.cjs ; EV_OUT=. EV_API_PORT=3995 node tools/ui-otp.cjs ; EV_OUT=. node tools/ui-share.cjs
npx tsx tools/receipt-html.ts artifacts   # (desde la raíz: ruta completa) HTML real del comprobante para ui-share
python3 -I docs/evidence/round7/h4-6ab7ef8/tools/mutate-h4.py   # desde la raíz, con App.tsx sin cambios locales
```

## Límites

- RN-Web no es nativo: `Modal` real de iOS (foco de VoiceOver, gesto atrás), Keychain (incluida la persistencia tras reinstalar,
  relevante para el descarte) y `AppState` real quedan para F-05. En RN-Web la vuelta a primer plano se simula con `visibilitychange`.
- El 409 "en curso" y las respuestas perdidas son simulados (la ventana real es de milisegundos); los 404 son reales.
- No se ejecutaron las suites de integración de la API (`api/**` no cambió en esta tanda).
- Riesgo aceptado y documentado (§11.3): un descarte explícito de un intento que sí se aplicó, sin revisar Movimientos, permite
  un segundo envío igual.
