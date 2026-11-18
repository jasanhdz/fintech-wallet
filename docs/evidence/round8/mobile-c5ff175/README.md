# Ronda 8 · tanda G-B (móvil): recuperación autoritativa — evidencia (código `c5ff175`)

Base: `6375909` (G-A publicado, contrato 0.4.0). Diseño y reglas: `docs/round8-mobile-notes.md`.

| Commit | Qué |
|---|---|
| `2ebd858` feat(mobile) | Registro v2 antes del `POST`; tres cabeceras; falla cerrado sin `sendEpoch`; lecturas (incl. `GET /transfer-attempts?attemptId=`); liberación sólo con resultado terminal + borrado + relectura `null`; "Anular esta transferencia" (`void`) y "Resolver con el servidor" (listado → `void-all` → listado); registros antiguos/sin dueño/dañados/ilegibles; GET 404 sin "Verificar de nuevo"; un toque = un `POST`; F-30. Ajuste de pruebas H4/H5/app (lista abajo) |
| `9c06bdb` test(mobile) | `mobile/tests/recovery-r8.test.tsx` (R8-15..R8-20) |
| `8628390` test(mobile) | Los toques de `recovery-r8` esperan al botón con carga paralela (sin esto una prueba fallaba con `--maxWorkers=3` y "mataba" toda mutación) |
| `0a3d1a3` docs | `docs/round8-mobile-notes.md` |
| `7911fc2` fix(mobile) | Mutación 16i sobrevivía: un borrado que **informa error** (aunque la clave quede vacía) ya no libera en la relectura de Inicio; el reenvío de un registro antiguo lee la política en ese momento (nunca la cacheada). Prueba nueva |
| `c5ff175` chore(mobile) | Sólo comentarios: ya no contienen el literal "Verificar de nuevo" (grep de R8-20) |

Mutaciones, render web y exports se hicieron sobre `7911fc2`; `c5ff175` sólo cambia 4 líneas de comentario y sobre él se repitieron
jest móvil completo (`logs/mobile-jest-c5ff175.txt`: 277/277), `tsc` y `eslint` de móvil, y el grep de alcance (`logs/scope.txt`).

Niveles: **[U]** jest (render RN, API simulada) + mutaciones; **[W]** render RN-Web (export de Expo para web, Chromium/Playwright,
390x929 @2x) contra **API real + PostgreSQL `wallet_test`**; **[N]** no disponible (F-05). Entorno propio: API aislada
`npm run dev:api:testdb` en 3971 con `IDEMPOTENCY_RECORD_RETENTION_DAYS=30` (ejemplo demo), web estática en 8971 (copia exportada
con el shim de SecureStore → `localStorage`, `docs/evidence/round6/71bd7e5/tools/patch.py`). No se usó `wallet_dev`, ni 3200/5174/8083,
ni el checkout principal, ni el worktree web, ni Lucem (`logs/environment.txt`). Usuarios sintéticos `*.r8m.*@example.test`,
contraseña aleatoria por variable de entorno, nunca escrita. Las llaves de idempotencia sólo aparecen como huella SHA-256 de 8 hex;
ningún OTP, CLABE completa ni llave en logs o capturas (verificado por grep: 0 cadenas de 18 dígitos; los UUID completos visibles en
`shots/*.txt` son ids/folios de transferencias en comprobantes). Procesos propios detenidos por PID al final.

## Resultados

| Nivel | Qué | Resultado |
|---|---|---|
| Raíz (Node 26.13.1) | `npm run lint`, `typecheck`, `test`, `build`, `openapi:check` | exit 0 los cinco (`logs/root-*.txt`); test: api 12, web 20, **mobile 277/277**, shared 4 |
| Expo | `npx expo install --check` (sin cambiar versiones); `expo export --platform web` y `--platform ios` | exit 0 ("Dependencies are up to date"; `logs/expo-install-check.txt`, `logs/export-*.txt`); exports temporales borrados |
| Textos en bundles | `tools/bundle-strings.py` sobre el bundle web y el `.hbc` de iOS | retirados 0 / obligatorios presentes en ambos (`logs/bundle-strings.txt`) |
| Mutaciones | `tools/mutate-r8.py`, 48 cambios de `App.tsx` (línea base verde primero), restaurados con `git checkout` | **48/48 matadas, 0 sobreviven** (`logs/mutations.txt`) |
| Render web + API/BD reales | `tools/ui-r8.cjs` escenarios A–K | **82 PASS, 0 FAIL** (`logs/ui-r8.txt`, `logs/ui-r8-stdout.txt`, `shots/`) |
| Nativo | Keychain, reinstalación, `AppState`, `fetch` nativo | **No verificado — BLOCKED (F-05)** |

### Rubric R8-15..R8-24 (G-B)

| Criterio | Estado | Evidencia |
|---|---|---|
| R8-15 [U] envío e identidad | **PASS** | `recovery-r8` "R8-15" (registro v2 antes del `POST`, cabeceras = registro, sin/mal `sendEpoch` → 0 `POST`, arranque/primer plano ×3/login/Inicio/Verificar → 0 `POST`/`void`/`void-all`, Verificar sin id = sólo `GET /transfer-attempts?attemptId=…&limit=1`); mutaciones 15a–15i. [W] A, B, C |
| R8-16 [U] reglas de liberación | **PASS** | "R8-16": cada fila libera/no libera; borrado con error / relectura no nula → bloqueo + "No pudimos actualizar este dispositivo" + "Reintentar". Mutaciones pedidas: 404 de GET (16a–c), 422 sin tipo (16d), conflict (16f), sin relectura (16h), void automático al arrancar (16k), void-all sin confirmación (16n) — todas matadas, más 16e/g/i/j/l/m/o/p/q/r/s |
| R8-17 [U] registros antiguos | **PASS** | "R8-17": sin `attemptId` (identidad nueva, `legacy`, misma llave y bytes; `void` por llave; reenvío persiste la época antes), sin `userId`, dañado/ilegible sólo tras `void-all` 200 + listado + borrado verificado; ningún camino borra sin resultado terminal. Mutaciones 17a–17l. [W] D, E, F, G |
| R8-18 [U] F-29 | **PASS** | dos pruebas (registro borrado / reemplazado) → 0 `POST`; mutación 3g las hace fallar (2 fallos, `logs/mutations.txt`) |
| R8-19 [U] un toque = un POST | **PASS** | 422/429 tipados → 1 `POST`, M11, liberado; 422 sin tipo → 1 `POST`, M09, intacto; mutación 19a (segundo `send()`) → 12 fallos; `send()` en `sendAttempt` = 0 (`logs/scope.txt`) |
| R8-20 [U/W] F-30 | **PASS** | grep fuente y bundles web/iOS: 0 retirados, obligatorios presentes; jest + Playwright G: sin "Verificar de nuevo" tras 404 real; Playwright B a 390x929: **16 px** entre consentimiento y botón principal |
| R8-21 [W] escenarios integrados | **PASS** | A–K abajo; `psql` de cada caso en `logs/ui-r8.txt` |
| R8-22 [N] nativo | **BLOCKED (F-05)** | sin simulador/dispositivo; el export iOS no es PASS |
| R8-23 [U/I] regresión y CI | **PASS local** / CI no observado | comandos locales en verde con Node 26.13.1; `npm ci` no se ejecutó (manifests/lockfile sin cambios; no se reinstaló `node_modules` compartido); el workflow de CI en la rama lo observa el Coordinador tras el push |
| R8-24 [I] alcance y entorno | **PASS** | `logs/scope.txt`: sólo `mobile/App.tsx`, `mobile/tests/**`, `docs/**`; 0 líneas en `web/**`, `api/**`, `specs/**`, `packages/**`, manifests y lockfile; sin ruta de reserva; `amount>=threshold` intacto; `logs/environment.txt` |

### Escenarios [W] (`tools/ui-r8.cjs`; BD `wallet_test`: transferencias por `client_attempt_id`, débitos, asientos por transacción, cierres, época, auditoría)

- **A** respuesta perdida **después** de aplicarse: M09 sin afirmaciones; registro v2 = cabeceras del `POST`; "Verificar" →
  `GET /transfer-attempts?attemptId=` + `GET /transfers/{id}`, 0 escrituras → comprobante, liberado; "Transferir" vuelve. BD 1/1 débito.
- **B** respuesta perdida **antes**: "Verificar" explica que el servidor aún no la registra (0 escrituras, BD 0); primer plano ×2 e
  Inicio: 0 escrituras; textos F-30; revisión del reenvío con 16 px; reenvío con misma huella de llave, identidad, época y cuerpo → 1/1.
- **C** recarga de la app: aplicada → el arranque sólo lee y resuelve (comprobante); no aplicada → sólo lee, bloqueado, primer plano ×3 sin escrituras.
- **D** registro dañado + pendiente de código de otro cliente: "Resolver con el servidor" lista (pendiente visible) y explica;
  "Anular pendientes y desbloquear" → listado → `void-all` → listado → borrado; pendiente `cancelled` con `via: void_all`, época +1,
  `transfer.send_epoch_advanced`; el envío tardío con la época vieja → 409 `transfer-attempt-voided`; 0 débitos.
- **E** almacenamiento ilegible: "Reintentar lectura" sigue bloqueado; `void-all` hecho pero sin poder releer → D6 ("puedes usar la
  web"), bloqueado; ya legible → "Reintentar" desbloquea. Época +1 una vez.
- **F** registro sin `userId` cuya llave se aplicó antes **sin cabeceras**: se mueve al usuario, `legacy` + `ownerAssumed`, misma
  llave y bytes; "Anular" (confirmación con el texto obligatorio) → `transfer_found` → comprobante sin afirmar "sin cargo"; BD 1/1, 0 cierres.
- **G** `transferId` con GET 404 real: sin "Verificar de nuevo" ni "Verificar estado"; Anular/Reenviar/Ver movimientos; "Anular" →
  "Transferencia anulada. No se realizó ningún cargo…"; el mismo envío tardío → 409 voided; BD 0 transferencias, 1 cierre, auditado.
- **H** anulación de un envío que nunca llegó: confirmación sin enviar nada; "Volver sin anular" conserva; "Anular" → voided; la
  llegada tardía del envío original → 409 voided; saldo igual.
- **J** carrera real: cuenta origen bloqueada `FOR UPDATE` 10 s desde `psql`; el `POST` queda retenido en el servidor (la página ve la
  conexión caída); "Anular" se toca a +3.6 s y espera (gate); al soltarse el lock el `POST` confirma (201) y el `void` responde
  `transfer_found` → la app muestra la transferencia aplicada (no la oculta), liberada; BD 1 transferencia, 1 débito, 0 cierres.
- **K** otra sesión (segunda sesión de API del mismo usuario, sin estado local): ve la aplicada de A con su `attemptId` y hace
  `void-all`; A al recargar lee su identidad → aplicada; segundo intento de A nunca llegado, `void-all` de B → el reenvío de A recibe
  409 voided → "Transferencia anulada…", liberado. BD: 1 transferencia, la vetada nunca se creó, 1 débito.

En todos: asientos por transacción suman 0, ≤ 1 débito por intento, `metadata` de auditoría sin llaves/`key_hash`/OTP/CLABE.

## Pruebas existentes cambiadas y por qué

Fixtures (contrato 0.4.0; no cambian lo que se prueba):

- `app.test.tsx`, `recovery-h4.test.tsx`, `recovery-h5.test.tsx`: las políticas simuladas añaden `sendEpoch: '0'` (campo obligatorio
  de `TransferPolicy` 0.4.0; sin él la app no envía, §R8.10). Antes de cada `throw new Error('Unexpected API request')` se añade
  `round8Default(url)`: política con `sendEpoch` cuyos límites nunca se alcanzan (para las pruebas que antes no simulaban la
  política) y `GET /transfer-attempts?…` vacío (la verificación sin `transferId` ahora lee el listado, §R8.4-2).
- `app.test.tsx`: el mock de `expo-crypto` devuelve UUID en lugar de `expo-crypto-uuid-N`: `Transfer-Attempt-Id` debe ser UUID
  (§R8.6-1) y `expo-crypto` devuelve UUID v4 en el dispositivo. La prueba del respaldo de Hermes sigue comprobando que la llave sale de `expo-crypto`.
- `recovery-h4/h5`: `record()` produce un registro v2 (`v`, `attemptId`, `sendEpoch`), el que escribe el build nuevo. Un registro
  sin identidad se actualiza al leerse (§R8.8) y dejaría de ser "byte a byte idéntico"; ese caso se prueba en `recovery-r8`.

Reglas sustituidas por §R8.7–§R8.9:

- Sólo el rechazo **tipado** `transfer-attempt-rejected` es terminal: pasan a usar el tipo `app.test` (ronda 7·7 ×2, origen=destino,
  "Modificar monto o cuenta", F-16 M11 ×2, tipografía M11), `recovery-h5` "422 del primer envío abre M11" y "primer envío 422 final",
  `recovery-h4` "422 en el reintento". Un 422 sin tipo ahora queda en M09 (pruebas nuevas en H5 y R8).
- Un toque = un `POST` (§R8.9): `recovery-h5` "422 dos veces en el mismo toque" y "422 del envío anterior aún en curso" se sustituyen
  por "reenvío con 422 tipado: 1 POST, M11, liberado" y "reenvío con 422 sin tipo: 1 POST, M09, intacto" (el servidor serializa la
  misma llave, B7, y cierra el rechazo, B6).
- F-30 (c) / §R8.8: tras un 404 de `GET` no hay "Verificar de nuevo": `recovery-h5` "GET 404 (arranque/Inicio)" y "M09 Verificar con
  404" exigen su ausencia y Anular/Reenviar/Ver movimientos; la relectura se comprueba al volver a Inicio.
- `recovery-h5` `NO_ID`: nuevo texto ("El servidor aún no registra esta operación…").
- F-30 (a)/(b): `app.test` M09 ("No hagas otra transferencia igual") e Inicio ("…cuando esta quede resuelta.").

Ninguna prueba H3–H5 se retiró sin reemplazo; F-22, consentimiento, reenvío byte-idéntico y "nada automático" siguen cubiertos.

## Reproducir

```sh
nvm use                                   # 26.13.1
npm run lint && npm run typecheck && npm test && npm run build && npm run openapi:check
(cd mobile && npx expo install --check)
API_PORT=3971 WEB_ORIGIN=http://localhost:8971 IDEMPOTENCY_RECORD_RETENTION_DAYS=30 npm run dev:api:testdb   # wallet_test (migrado)
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3971/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8971 --bind 127.0.0.1 -d <scratch>/dist
export EV_TEST_PASSWORD=<valor de prueba>; cd docs/evidence/round8/mobile-c5ff175 && EV_OUT=<dir> node tools/ui-r8.cjs   # ONLY=A,B,…
python3 -I docs/evidence/round8/mobile-c5ff175/tools/mutate-r8.py      # desde la raíz, App.tsx sin cambios locales
python3 -I docs/evidence/round8/mobile-c5ff175/tools/bundle-strings.py <bundle web .js> <bundle iOS .hbc>
```

## Observación del Coordinador (`IDEMPOTENCY_RECORD_RETENTION_DAYS`)

`logs/no-retention-probe.txt`: con una API aislada (3972, `wallet_test`) **sin** la variable, la API arranca y la política responde 200,
pero `POST /transfers` responde 500 sin escribir nada. El `.env` del checkout principal no la define (sólo se contó la línea). La demo
viva no se ve afectada mientras siga en el código anterior; antes de actualizarla hay que añadir la variable y aplicar la migración
en `wallet_dev`, ambas con autorización del usuario (detalle en `docs/round8-mobile-notes.md` §7).

## Límites

- RN-Web no es nativo: Keychain real, persistencia tras reinstalar, `AppState` real y `fetch` nativo quedan para F-05 (R8-22 BLOCKED).
  El primer plano se simula con `visibilitychange`; el almacenamiento ilegible con el shim.
- Respuestas perdidas simuladas con `page.route`; los 404, 409, `void`, `void-all` y la carrera J son respuestas reales de la API.
- "Otra sesión" es una segunda sesión de API: la app sin registro local no ofrece `void-all`.
- `npm ci` y el workflow de CI no se ejecutaron aquí (sin cambios de dependencias). Este informe no es una aprobación: la revisión
  independiente corresponde al Evaluator.
