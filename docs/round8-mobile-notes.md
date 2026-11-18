# Ronda 8 · Móvil: recuperación autoritativa de intentos de transferencia (G-B)

Alcance: tanda G-B de `SPEC.md` §R8.7–§R8.9 sobre el contrato 0.4.0 implementado por G-A (`docs/round8-api-notes.md`).
Código: `mobile/App.tsx`. Pruebas: `mobile/tests/recovery-r8.test.tsx` (nueva) y ajustes justificados en
`mobile/tests/app.test.tsx`, `recovery-h4.test.tsx`, `recovery-h5.test.tsx`. Evidencia: `docs/evidence/round8/mobile-<sha>/`.
Sin dependencias nuevas, sin cambios en `api/**`, `web/**`, `packages/shared`, manifests ni lockfile. F-23 (`amount >= threshold`)
y la política OTP sin cambios.

## 1. Registro v2 y envío

- Clave por usuario `wallet.transfer-recovery.<userId>` (F-22 sin cambios). Forma:
  `{ v: 2, attemptId, key, sendEpoch, payload, userId, transferId?, status?, consent, display, legacy?: true, ownerAssumed?: true }`.
  `ownerAssumed` amplía §R8.7 sólo para explicar al usuario un registro que se guardó sin dueño.
- Al tocar "Confirmar transferencia"/"Continuar a verificación"/"Solicitar un código nuevo": `key` y `attemptId` son UUID v4
  distintos; `sendEpoch` es `TransferPolicy.sendEpoch` de la política cargada para la revisión (si no está cargada se lee una vez
  más con `GET /transfer-policy`). El registro se escribe **antes** del `POST`; si no se puede escribir, no se envía nada.
- Sin `sendEpoch` válido (`^(0|[1-9][0-9]{0,18})$`) no se envía nada (falla cerrado) y se muestra
  "No pudimos preparar el envío con seguridad…". `attemptHeaders` vuelve a exigir identidad UUID y época antes de cada `POST`.
- Todo `POST /v1/transfers` lleva `Idempotency-Key`, `Transfer-Attempt-Id`, `Transfer-Send-Epoch` con los valores del registro.
  El reenvío usa los guardados (misma llave, identidad, época y bytes del cuerpo).
- **Un toque = un POST**: se eliminó el segundo `send()` de `sendAttempt`.

## 2. Lecturas (nada automático escribe)

Arranque, primer plano, inicio de sesión, Inicio y "Verificar" sólo leen: con `transferId` → `GET /transfers/{id}`; sin él →
`GET /transfer-attempts?attemptId=<id>&limit=1`. Si el listado trae un ítem con `transferId` se guarda en el registro y se lee esa
transferencia; si trae un cierre (`voided`/`rejected`, sin transferencia) se explica y se ofrece "Anular esta transferencia" (cuya
respuesta 200 es la que libera); si no trae nada se explica que el servidor aún no la registra y se ofrecen Reenviar y Anular.
`void` y `void-all` nunca se envían sin toque y pantalla de confirmación.

## 3. Resultados que liberan (y sólo éstos, §R8.7)

| Libera | No libera (registro y bloqueo intactos) |
|---|---|
| `GET /transfers/{id}` → `completed`/`expired`/`cancelled`/`rejected` | 404 de `GET` (arranque, Inicio, M09) |
| `POST` → `completed` (tras su `GET`) | 422/429/404 sin tipo, 409 "en curso", 400, 401, 403, 429 de tasa, 5xx, sin respuesta |
| `POST` → 409 `transfer-attempt-voided` ("Transferencia anulada. No se realizó ningún cargo por esta operación.") | `transfer-attempt-conflict` (se ofrece "Resolver con el servidor") |
| `POST` → 404/422/429 `transfer-attempt-rejected` (M11) | coincidencias en Movimientos, tiempo, cierre de sesión, cambio de usuario |
| cualquier 200 de `void` (`voided` / `rejected` / `transfer_found` → se muestra la transferencia) | `void` con 409/5xx/sin respuesta |
| `void-all` 200 + listado leído con éxito | `void-all` 200 sin listado posterior (se reintenta el listado, no el `void-all`) |
| `cancel` confirmado ("Cancelar y volver a revisar"), sin cambio | |

**Liberación** (`releaseRecovery`) = `deleteItemAsync` sin error **y** relectura `null`; sólo entonces se quita el bloqueo en
memoria. Si falla, se muestra el resultado ya conocido + "No pudimos actualizar este dispositivo…" + "Reintentar" (también en
Inicio) y el bloqueo sigue.

## 4. Acciones explícitas

- **"Anular esta transferencia"** (M09 e Inicio, mientras el estado en el servidor es desconocido: sin id o tras 404) → pantalla con
  "Si ya se aplicó, te mostraremos su resultado y no se cancelará el cargo. Si no se aplicó, quedará anulada y ya no podrá aplicarse
  aunque llegue después." → `POST /transfer-attempts/void {idempotencyKey, attemptId}` (registro `legacy`: sólo la llave, porque su
  envío original no llevaba identidad). Antes de enviar relee el registro: si ya no es el mismo, no anula (como el reenvío).
- **"Resolver con el servidor"** (registro dañado, almacenamiento ilegible, identidad en conflicto) → `GET /transfer-attempts`
  (primera página) + texto: la anulación también detiene las transferencias aún no aplicadas enviadas desde otros dispositivos y
  cancela las pendientes de código → toque "Anular pendientes y desbloquear" → `POST /transfer-attempts/void-all {fromEpoch}` con la
  época leída → `GET /transfer-attempts` → borrado verificado → listado final. "Volver sin anular" no envía nada.

## 5. Registros antiguos, dañados e ilegibles (§R8.8)

| Caso | Comportamiento |
|---|---|
| Sin `attemptId` (H3–H5) | Al leerlo se añade `attemptId` nuevo, `v:2`, `legacy:true` y se persiste; `key` y bytes de `payload` intactos. Se explica que una versión anterior no lo registró por número; Reenviar (antes lee la política y **persiste** `sendEpoch`; si falla no envía) o Anular (por llave). |
| Sin `userId` (ranura antigua) | Se mueve a la clave del usuario que entra con `ownerAssumed:true` y se explica; `void` usa el token de ese usuario. |
| En la clave propia con `userId` de otro | Se trata como dañado (identidad en conflicto). |
| Dañado / identidad inválida | Bloqueado; "Reintentar lectura" y "Resolver con el servidor"; nunca se borra sin `void-all` 200 + listado + borrado verificado. |
| SecureStore ilegible | Igual; si tras el `void-all` sigue sin poder borrar/releer, se explica D6 (resuelto en el servidor; este dispositivo no envía; usa la web). |
| `transferId` con GET 404 | Sin "Verificar de nuevo" ni "Verificar estado"; Anular, Reenviar, Ver movimientos. |

## 6. F-29, F-30 y reglas H3–H5 conservadas

- F-29: dos pruebas (registro borrado / reemplazado entre abrir la revisión del reenvío y el toque) → 0 `POST`; Inicio libre o con
  el aviso del otro intento. La mutación 3g las hace fallar (evidencia).
- F-30: sin "No la envíes de nuevo", "No intentes enviar el dinero nuevamente" ni "Podrás hacer otra transferencia cuando
  conozcamos su resultado"; el aviso dice "No hagas otra transferencia igual" y nombra Verificar/Reenviar/Anular; "Podrás hacer otra
  transferencia cuando esta quede resuelta."; ≥ 12 px (16) entre el recuadro de consentimiento y el botón principal del reenvío.
- Se conservan: verificar sólo lee; reenvío explícito y consentido con la misma llave y bytes; el código OTP nunca se guarda;
  registro por usuario; nada automático; "Cancelar y volver a revisar" y "Solicitar un código nuevo" con sus reglas de H3–H5
  (salvo que la liberación ahora exige borrado verificado).

## 7. Observación del Coordinador: `IDEMPOTENCY_RECORD_RETENTION_DAYS`

G-A hizo la variable obligatoria en todos los entornos sin valor por defecto en código (`api/src/config.ts`,
`idempotencyRetentionDays`). Verificado en esta tanda con una API aislada en el puerto 3972 sobre `wallet_test` **sin** la variable:
la API arranca y `GET /transfer-policy` responde 200, pero `POST /transfers` responde **500** ("Ocurrió un error interno.") sin
escribir nada (saldo sin cambios). El `.env` del checkout principal no define la variable (comprobado sólo contando la línea, sin
leer valores) y el `.env` de este worktree es un enlace a ese archivo. Consecuencias:

- La demo viva (3200/5174/8083) corre código anterior y **no** se ve afectada mientras no se haga fast-forward.
- Si se actualiza la demo a este código sin añadir la variable, toda creación/confirmación de transferencia responde 500: la web
  muestra error y la app móvil lo trata como resultado no confirmado (M09, registro intacto, "Anular" disponible). Además el código
  nuevo exige la migración `1763000009000`, que `wallet_dev` no tiene. Antes de actualizar
  hay que añadir `IDEMPOTENCY_RECORD_RETENTION_DAYS=30` (ejemplo demo de `.env.example`) a ese `.env` y aplicar `1763000009000` en
  `wallet_dev`; ambas cosas requieren autorización del usuario (§R8.11).
- Toda API aislada de esta tanda se lanzó con `IDEMPOTENCY_RECORD_RETENTION_DAYS=30` en el entorno del proceso.
- **Nota de despliegue (H6, F-32).** Desde H6 la API valida la variable **al arrancar** en todos los entornos: sin ella (o con
  `0`, negativa, no numérica o mayor que 1,000,000) el proceso termina con `api.config_invalid` nombrando la variable y no
  escucha; ya no existe el estado "API sana con `POST /transfers` = 500" descrito arriba (ese párrafo describe el código
  `8da2700`). Por tanto, **antes de actualizar la demo** del checkout principal hay que añadir
  `IDEMPOTENCY_RECORD_RETENTION_DAYS=30` (ejemplo demo, no política aprobada) a su `.env` y aplicar `1763000009000` en
  `wallet_dev`, con autorización del usuario; si se omite la variable, la API de la demo no arrancará tras el fast-forward.

## 8. Límites

- Nativo no verificado (F-05): Keychain real, persistencia tras reinstalar, `AppState` real y `fetch` nativo → R8-22 **BLOCKED**.
  El export iOS sólo prueba que el bundle Hermes compila y contiene/omite los textos.
- El render web usa el shim de SecureStore sobre `localStorage` (copia exportada parcheada), no el Keychain.
- "Otra sesión" en el render se ejerce como segunda sesión de API del mismo usuario: la app sin registro local no ofrece
  `void-all` (no hay nada que resolver en ese dispositivo).
- Residual D5 sin cambios (registro dañado de un build anterior cuyo envío sin cabeceras aún no hubiera llegado).
