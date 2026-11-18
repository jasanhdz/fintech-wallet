# Ronda 7 · tanda H5: recuperación de intentos inciertos sin doble débito — evidencia (código `17b7163`)

Commits de la tanda sobre `d0fee0d` (H4):

| Commit | Requisito | Qué |
|---|---|---|
| `28c0344` fix F-21 | 1 | 409 "en curso" / 401 / 403 / 400 / 429 de tasa en **cualquier** envío → M09 con el registro intacto; M11 sólo con rechazo de negocio confirmado; ninguna salida de M09/M11 borra un registro |
| `15707df` fix F-26 | 4 | sin "Descartar este intento" ni liberación por 404 (GET o POST); salidas seguras explicadas para 404, registro dañado y SecureStore ilegible; rechazo al confirmar libera sólo tras `cancel` confirmado |
| `f2c37c6` fix F-27 | 2, 3, 5 | verificar sólo lee (Inicio, M09, primer plano, arranque, login); "Reenviar la misma transferencia" explícito, con revisión de los datos originales y del consentimiento guardado, misma llave y cuerpo, M08 si el servidor pide código |
| `338be55` fix F-27 | — | (retirado por `17b7163`) cruce con Movimientos para intentos sin `transferId` |
| `b1aaf76` fix F-21 | 4, 7 | un 422/429 "límite diario" a un **reenvío** se reconfirma una vez con la misma llave en el mismo toque (si el envío anterior se aplicó, el servidor lo devuelve: sin "Tu dinero está intacto" falso) |
| `6e14d37` test F-28 | 6 | prueba que mata la única mutación superviviente (404 en "Verificar" de M09) |
| `4a6384d` docs | 8 | `docs/round7-notes.md` §6, §10, §11 reescritas |
| `17b7163` fix F-27 | 2, 7(a) | **seguimiento del Coordinador**: se quita el cruce de `338be55`. Una coincidencia de monto/concepto/referencia/hora no prueba que un cargo sea el intento: un intento sin `transferId` nunca se resuelve, libera ni muestra comprobante por ella. "Ver movimientos" queda informativo ("…una coincidencia no prueba que sea este intento."). La reconciliación autoritativa es el reenvío consentido con la misma llave |
| `09c3e24` docs | 8 | notas: se quita la decisión del cruce (§11.4 sin cambios) |

`mobile/App.tsx` evaluado: el de `17b7163` (sin cambios después). La evidencia de `b1aaf76` (commit `5b16f33`) queda en el
historial; este directorio la sustituye (se regeneraron todos los logs y capturas). Reglas, salidas por caso y residual: `docs/round7-notes.md` §11.

Niveles: **unitario** (jest, render RN) + **mutaciones**; **integración real** API + PostgreSQL `wallet_test` a través del **render
web** (export de Expo para web en Chromium/Playwright, 390 px @2x). **No es evidencia nativa** (sin simulador/iPhone; F-05). El
export para iOS sólo prueba que el bundle Hermes compila y contiene los textos nuevos y no los retirados
(`logs/ios-bundle-strings.txt`: "Reenviar la misma transferencia", "Volver sin reenviar", "Reintentar lectura", "Verificar de nuevo",
"una coincidencia no prueba que sea este intento" presentes; "Descartar este intento", "Descartar intento", "Ya puedes hacer otra
transferencia" y la consulta `movements?type=debit` del cruce retirado, ausentes).

Entorno propio (no se usó `wallet_dev`, 3200/5174/8083, el checkout principal ni Lucem): `npm run db:migrate:test`; API aislada
`npm run dev:api:testdb` en 3971 (política por defecto), 3972 (umbral 123456, 90 s, 3 intentos, límite 1,500,000) y 3973 (igual
con 8 s); bundle web con `EXPO_PUBLIC_API_URL=http://127.0.0.1:3971/v1`, parcheado sólo en la copia exportada
(`docs/evidence/round6/71bd7e5/tools/patch.py`, SecureStore → localStorage) y servido en 8971. Usuarios sintéticos
`*.h5.*@example.test`; contraseña de prueba aleatoria por variable de entorno, nunca escrita. Respuestas perdidas y el 409 "en
curso" se simulan con `page.route` (la petición llega al servidor real y se descarta la respuesta, no sale, o se responde con el
cuerpo real del 409); **todos los 404 son respuestas reales de la API**. El código OTP sólo se lee en memoria y se enmascara
(`••••••`) en logs y `shots/*.txt` (verificado: 0 coincidencias de códigos en claro). Procesos propios terminados al final (sólo
los PID lanzados por esta tanda).

## Resultados por nivel

| Nivel | Qué | Resultado |
|---|---|---|
| Raíz | `npm run lint`, `npm run typecheck`, `npm test` | exit 0 los tres (`logs/root-*.txt`); api 7/7, web 20/20, **mobile 217/217**, shared 4/4 |
| Pruebas nuevas contra H4 | `tests/recovery-h5.test.tsx` (39) ejecutado con `App.tsx` de `d0fee0d` | **35 fallan, 4 pasan** (`logs/h5-tests-on-h4-d0fee0d.txt`). Las 4 que pasan son controles/regresiones que H4 ya cumplía: 422 en el primer envío abre M11, primer envío 422 = 1 `POST`, verificar con id sólo hace `GET`, registro sin id + primer plano/Inicio/login = 0 `POST` (F-27 de H4). Para el requisito 5 la prueba que falla con H4 es la del registro **con** id pendiente de código: H4 repetía el `POST` al arrancar/entrar para recuperar el código |
| Mutaciones | `tools/mutate-h5.py`, 26 cambios en `App.tsx`, restaurados con `git checkout` | **26/26 matadas, 0 sobreviven** (`logs/mutations.txt`; tabla abajo) |
| Integración real + render web | `tools/ui-h5.cjs` A, B, C, C2, D, D2, E, E2, F | **47 `PASS`, 1 `FAIL` de la herramienta** en la corrida completa (`logs/ui-h5-stdout.txt`): la aserción de B buscaba el texto del cruce retirado; corregida la expresión, B se repitió sola con todo `PASS` (`logs/ui-h5-B-rerun-stdout.txt`). Capturas `shots/A-…F-*` |
| Regresión render web | `ui-m02-m09.cjs`, `ui-otp.cjs` (API 3972/3973), `ui-share.cjs`, `ui-dbltap.cjs` | exit 0 los cuatro (`logs/ui-*-stdout.txt`) |
| Nativo | — | **No verificado** (F-05) |

### Mutaciones (`logs/mutations.txt`; entre paréntesis, pruebas que fallan)

F-28.1 guard con `catch { existing = null }` (2) · F-28.2 `requestNewCode` con `replacesClosedAttempt=true` (1) · 1a 4xx no
confirmado → M11 (21) · 1b 4xx no confirmado borra el registro (21) · 1c "Ir al inicio" de M09 borra el registro (38) · 2a "Verificar"
de M09 hace `POST` sin id (5) · 2b "Verificar" de Inicio hace `POST` sin id (6) · 2c arranque/login repite el `POST` para recuperar
el código (3) · **6a "Verificar" de M09 resuelve y libera un intento sin id por un cargo coincidente en Movimientos (2)** · **6b
ídem en Inicio (1)** · 3a reenvío con llave nueva (25) · 3b reenvío con cuerpo reconstruido (4) · 3c reenvío al primer toque, sin
revisión (21) · 3d consentimiento no guardado (4) · 3e autorización del código no registrada (1) · 3f 422 de reenvío final sin
reconfirmar (2) · 4a liberación por 404 de GET al arrancar (2) · 4b ídem en Inicio (4) · 4c ídem en M09 (1; superviviente en la
primera corrida, matada por `6e14d37`) · 4d liberación por 404 del `POST` (1) · 4e botón "Descartar este intento" de vuelta (3) · 4f
"Reintentar lectura" borra el registro dañado (3) · 4g SecureStore ilegible tratado como "sin registro" (3) · 4h rechazo al
confirmar libera sin `cancel` confirmado (1) · 5a Inicio/primer plano repite el `POST` sin id (20) · 5b arranque/login repite el
`POST` sin id (10).

### Escenarios con API real (`tools/ui-h5.cjs`; BD: filas, asientos y débitos del origen leídos de `wallet_test`)

- **A — respuesta perdida tras aplicarse, sin `transferId`**: Principal → Ahorro $300.25, la API aplica (`completed:30025`) y la
  respuesta se descarta. M09 sin afirmaciones. "Verificar" en M09: **0 `POST`**, sin comprobante, con "…no podemos consultarla…" y
  "En Movimientos revisa si aparece un cargo con estos datos; una coincidencia no prueba que sea este intento.". Inicio: sólo el aviso
  (sin entradas a una transferencia nueva ni descarte) y la misma advertencia; "Verificar" de Inicio, vuelta a primer plano y
  Movimientos (donde aparece el cargo de -$300.25): el registro sigue **byte a byte igual**, 0 `POST` nuevos, **no se resuelve por
  el cargo coincidente**. "Reenviar la misma transferencia" (revisión + confirmación): misma llave y mismo cuerpo → el servidor
  devuelve **la misma transferencia (mismo folio)** → comprobante. BD: 1 fila, 2 asientos suma 0, 1 débito de 30025; registro liberado.
- **B — respuesta perdida antes de aplicarse (sin id)**: "Verificar" en M09 → 0 `POST`, BD 0 filas, "…no podemos confirmar si se
  realizó un cargo…". 2 vueltas a primer plano + Inicio de nuevo + "Verificar" de Inicio: 0 `POST`, BD 0 filas. "Reenviar…" abre
  la revisión con monto, origen, destino, concepto, referencia y "Confirmaste esta transferencia el …" sin enviar nada; "Volver sin
  reenviar" deja el registro idéntico. Confirmación: **misma llave y mismo cuerpo** (bytes iguales) → comprobante; BD 1 fila, 1 débito.
- **C — 409 "en curso" (cuerpo real) en el reenvío** tras una respuesta perdida ya aplicada: sigue en M09 (nunca M11), registro
  byte a byte idéntico; Inicio sólo el aviso; un nuevo reenvío con la misma llave → la misma transferencia. 1 sola llave enviada; BD
  1 fila, 1 débito.
- **C2 — 409 en el primer envío**: M09, registro conservado, Inicio bloqueado; reenvío con la misma llave → 1 transferencia, 1 débito.
- **D — `GET` 404 real** de un `transferId` desconocido: "El servidor no encuentra esta operación. No podemos confirmar si se
  realizó un cargo: revisa Movimientos y tu saldo." sin "Ya puedes hacer otra transferencia"; registro idéntico, bloqueado, 0 `POST`;
  acciones "Verificar de nuevo" (sólo lee), "Ver movimientos", "Reenviar…"; el reenvío envía la llave guardada → 1 transferencia.
- **D2 — `GET` 404 con la llave ya aplicada** (aplicada antes directamente en la API, id guardado erróneo): el reenvío devuelve
  **la misma** transferencia (mismo folio) → BD sigue con 1 fila y 1 débito de 44444.
- **E — registro corrupto**: explicación sin texto técnico, sin reenvío, sin transferencia nueva, sin descarte; "Reintentar
  lectura" y "Ver movimientos" no lo borran; 0 `POST`, BD 0 filas.
- **E2 — SecureStore ilegible**: al confirmar, mensaje y 0 `POST`; al reiniciar, "No pudimos comprobar tus transferencias" y
  bloqueo; "Reintentar lectura" con el almacenamiento aún ilegible sigue bloqueado; ya legible (sin registro) desbloquea.
- **F — F-22 / cierre de sesión**: A deja un intento incierto y cierra sesión (registro idéntico); B entra (no ve el aviso), transfiere
  $150.00 y sale: registro de A idéntico; A entra: aviso y 0 `POST`; reenvío con la llave guardada → A `completed:30025` (1 débito),
  B `completed:15000` (1 débito).
- **Regresión** (`ui-m02-m09`, `ui-otp`, `ui-share`, `ui-dbltap`): M02 Ahorro → Ahorro sólo "Elegir otro destinatario"; F-21 original
  (respuesta perdida, "Ir al inicio"): Inicio con el aviso y sin "Continuar con transferencia"; "Verificar" no envía nada y el
  intento sigue en verificación; el reenvío con la misma llave lo resuelve: 1 llave, débito 30025 una vez.
  Umbral (API 3972, sin cambiar `>=`): 1,234.55 sin código; 1,234.56 / 1,234.57 con código; M08 vacío/completo/verificando/422/3.er
  fallo 429/código nuevo con cancelación confirmada/vencimiento real 8 s (API 3973)/cancelar/código nuevo con intento ilegible (0
  `POST`). Compartir: 1 llamada con doble toque, sin CLABE completa/correo/token, 0 acciones en M09/M04, HTML del comprobante
  escapado. Mismas limitaciones de herramienta que H4 (tecleo con `click()` en `ui-otp`, "double tap … 2" de `ui-share` en RN-Web,
  `pdftotext` ausente).

## Pruebas cambiadas y por qué

Retiradas (codificaban comportamiento que el usuario pidió eliminar; reemplazos en `tests/recovery-h5.test.tsx`):

- `recovery-h5` (seguimiento `17b7163`): las cinco pruebas del cruce con Movimientos de `338be55` ("Verificar encuentra el intento
  en Movimientos → comprobante" desde M09 y desde Inicio, "dos cargos iguales no deciden", "un cargo con otros datos no se toma",
  "un registro sin hora del toque no se busca") → reemplazo "H5 · 2b": un cargo **perfectamente** coincidente no resuelve ni libera
  el registro por "Verificar" (M09 e Inicio), Inicio ni Movimientos (0 `POST`, 0 lecturas de esa transferencia), y el reenvío con
  la misma llave devuelve el mismo folio (1 transferencia). Mutaciones 6a/6b (reintroducir el cruce en M09 o Inicio) las hacen fallar.

- `recovery-h4`: "GET 404 (arranque/Inicio) libera el registro" ×2 → reemplazo "H5 · 4 … 404 conserva el registro"; "registro antiguo
  cuyo reenvío responde 404 se libera" → "H5 · 3 … legacy … 404 is kept"; "registro dañado se descarta", "el guard encuentra un
  registro dañado" (texto), "cancelar el diálogo de descarte", "SecureStore ilegible: el descarte intenta borrar" → "H5 · 4" (sin
  descarte; "Reintentar lectura").

Ajustadas (mismo objetivo, nueva acción):

- `app.test`: F-09 401/409/429 y "429 de tasa" en el primer envío esperaban M11 "Revisa tu saldo antes de reintentar" → ahora M09
  con el registro (requisito 1). Siete pruebas que pulsaban "Verificar estado" para repetir el `POST` (reinicio real, M09, "Verificando
  resultado", M09 → Inicio, sesión vencida, Inicio bloqueado, cerrar sesión y volver) → ahora comprueban que "Verificar" envía 0
  `POST` y reanudan con "Reenviar la misma transferencia" (abrir + confirmar), misma llave y cuerpo.
- `recovery-h4`: reintentos con 409/401/403/429/400, 500/sin respuesta y 422 en la repetición, y las dos de F-27 → mismas
  aserciones a través del reenvío explícito; "Verificar" debe enviar 0 `POST`. "Primer envío con 4xx no verificado" → M09.
- Se conservan las dos pruebas de F-28 de H4 (guard ilegible; `requestNewCode` sin intento previo); las mutaciones F-28.1/F-28.2
  las hacen fallar.

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3971 WEB_ORIGIN=http://localhost:8971 npm run dev:api:testdb
API_PORT=3972 WEB_ORIGIN=http://localhost:8971 OTP_EXPIRY_SECONDS=90 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
API_PORT=3973 WEB_ORIGIN=http://localhost:8971 OTP_EXPIRY_SECONDS=8 OTP_MAX_ATTEMPTS=3 OTP_THRESHOLD_MINOR=123456 DAILY_TRANSFER_LIMIT_MINOR=1500000 npm run dev:api:testdb
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3971/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8971 --bind 127.0.0.1 -d <scratch>/dist
export EV_TEST_PASSWORD=<valor de prueba>; cd docs/evidence/round7/h5-17b7163
EV_OUT=. node tools/ui-h5.cjs            # ONLY=A,B,C,C2,D,D2,E,E2,F
EV_OUT=. node tools/ui-m02-m09.cjs ; EV_OUT=. EV_API_PORT=3972 node tools/ui-otp.cjs ; EV_OUT=. node tools/ui-share.cjs ; EV_OUT=. node tools/ui-dbltap.cjs
python3 -I docs/evidence/round7/h5-17b7163/tools/mutate-h5.py   # desde la raíz, con App.tsx sin cambios locales
```

## Límites

- RN-Web no es nativo: Keychain real (incluida su persistencia tras reinstalar, relevante para el residual del registro dañado),
  `AppState` real y VoiceOver quedan para F-05. La vuelta a primer plano se simula con `visibilitychange`.
- El 409 "en curso" y las respuestas perdidas son simulados (la ventana real es de milisegundos); los 404 son reales. La
  reconfirmación de un 422 de reenvío sólo se probó en jest (la carrera real no se reprodujo contra la API).
- Un intento sin `transferId` sólo se reconcilia con el reenvío consentido (la app no deduce nada de Movimientos); si el usuario no
  reenvía, el intento queda en verificación y bloquea nuevas transferencias.
- Residual sin implementar, a decidir por producto (§11.4): registro dañado permanente / reenvío que siempre recibe 404.
- No se ejecutaron las suites de integración de la API (`api/**` no cambió). F-23 (umbral `>=`) sin cambios.
- Este informe no es una aprobación: la revisión independiente corresponde al Evaluator.
