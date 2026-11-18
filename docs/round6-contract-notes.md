# Ronda 6 — notas de contrato (tanda G1: contrato + API + shared)

Base: `902743f`. Contrato `specs/openapi.yaml` pasa de 0.2.0 a **0.3.0** con cambios **aditivos** (ningún campo existente se quita ni cambia de tipo; los clientes actuales siguen compilando con los tipos regenerados). Todo lo descrito está probado contra PostgreSQL real en `wallet_test` (`api/tests/round6-contract.integration.ts`). `wallet_dev` no se migró ni se tocó.

## 1. Auditoría

### 1.1 Formato de fechas

| Campo | Origen en API | Formato antes | Formato ahora |
|---|---|---|---|
| `Transfer.createdAt`, `Transfer.completedAt` | `Date.prototype.toISOString()` sobre `timestamptz` de pg | `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC, 3 decimales, `Z`) | sin cambio |
| `Transfer.expiresAt` (nuevo) | igual que arriba, desde `otp_challenges.expires_at` | — | `YYYY-MM-DDTHH:mm:ss.sssZ` o `null` |
| `Movement.occurredAt` | `to_char(... 'US"Z"')` en SQL | `YYYY-MM-DDTHH:mm:ss.ssssssZ` (**6** decimales) | `YYYY-MM-DDTHH:mm:ss.sssZ` |

- El dato de transferencias que usa el comprobante móvil (`completedAt ?? createdAt`) **siempre fue válido**: ISO-8601/RFC 3339 en UTC con `Z`, producido por `toISOString()`; también en las respuestas reproducidas desde `idempotency_records` (el snapshot guarda esa misma cadena).
- El bug "a de undefined de 8, undefined:undefined hrs" **no proviene de un dato inválido**: con una fecha inválida `Intl.DateTimeFormat#formatToParts` lanza `RangeError` y el código cae al fallback ("Invalid Date"), no a partes `undefined`. La cadena observada indica que `formatToParts` devolvió partes con tipos distintos de `day/month/year/hour/minute` (motor Intl de Hermes en el dispositivo) y `formatReceiptDate` en `mobile/App.tsx` indexa por esos tipos sin verificarlos. Recomendación para G2: no depender de los tipos de `formatToParts`; validar que existan las 5 partes o formatear sin Intl (America/Mexico_City es UTC−6 fijo desde 2022, con tabla de meses) y conservar el fallback.
- `Movement.occurredAt` con 6 decimales era RFC 3339 válido, pero el formato de fecha-hora de ECMAScript define exactamente 3 decimales; otras variantes son "implementation-defined" en `Date.parse`. Se normalizó a milisegundos para que todos los timestamps del contrato tengan una sola forma. El cursor keyset sigue usando microsegundos internamente (no cambia la paginación).
- OpenAPI declara ahora `components.schemas.Timestamp` (`format: date-time` + patrón `^…T…\.[0-9]{3}Z$`) y lo usan `createdAt`, `completedAt`, `expiresAt` y `occurredAt`.

### 1.2 Contraparte en movimientos

Antes: `Movement` sólo tenía `id, transferId, type, amountMinor, currency, concept, reference, status, occurredAt`. No había de quién/a quién. El detalle se completaba con `GET /transfers/{transferId}`, que es **sólo del emisor**: el receptor de una transferencia de otro usuario recibe 404 (correcto por ownership), así que un movimiento RECIBIDO de terceros no tenía forma de mostrar el emisor.

Ahora `Movement.counterparty` (siempre presente):

| Movimiento | `name` | `clabeMasked` | `ownAccountId` |
|---|---|---|---|
| Enviado a beneficiario | nombre del beneficiario como lo registró el emisor | CLABE del beneficiario enmascarada | sólo si el beneficiario es cuenta propia |
| Enviado a cuenta propia | nombre de la cuenta destino | CLABE destino enmascarada | id de la cuenta destino |
| Recibido de cuenta propia | nombre de la cuenta origen | CLABE origen enmascarada | id de la cuenta origen |
| Recibido de otro usuario | nombre completo del usuario emisor | CLABE origen enmascarada (3+4) | nunca |

Folio y referencia: `transferId` es el folio interno (`receiptReference` = id de la transferencia al completarse); `reference` es la referencia numérica 1–7 dígitos que capturó el emisor; `concept` el concepto. No hay número de cuenta completo ni saldo de terceros en ninguna respuesta.

### 1.3 Qué expone `Beneficiary`

`id, name, alias, clabeMasked, destinationAccountId` (y ahora `ownAccountId` opcional). Nunca la CLABE completa. `destinationAccountId` ya existía y es el **id de la cuenta interna** a la que resuelve la CLABE, también para cuentas de terceros (un UUID sin saldo ni dueño; todo acceso por id está protegido por ownership). Se mantiene por compatibilidad con web/móvil; su minimización para terceros sería un cambio incompatible y queda como decisión futura.

## 2. Origen = destino por identidad confiable

- El servidor identifica el destino de un beneficiario por `beneficiaries.destination_account_id` (resuelto al registrar la CLABE vía `clabe_lookup_hash`) y rechaza con **422** si es igual a `sourceAccountId`; además la tabla tiene `CHECK(source_account_id<>destination_account_id)`.
- Nuevo `Beneficiary.ownAccountId` (uuid): presente **sólo** si la cuenta destino pertenece al mismo usuario; igual a `destinationAccountId`. Para cuentas ajenas el campo no existe (probado). También aparece en `Transfer.destination` cuando el destino es un beneficiario propio.
- Regla para G2: si `beneficiary.ownAccountId === sourceAccountId`, no permitir esa combinación (ocultar o deshabilitar el beneficiario para esa cuenta origen, o la cuenta origen para ese beneficiario). El backend sigue siendo la autoridad.
- Prueba: Ahorro → beneficiario "Cuenta de ahorro demo" (misma cuenta) = 422 sin filas ni cambios de saldo; Principal → ese beneficiario = 201 `completed`.

## 3. Política desde el servidor

`GET /v1/transfer-policy` (Bearer):

```json
{ "currency": "MXN", "businessDate": "2026-11-16", "businessTimeZone": "America/Mexico_City",
  "dailyLimitMinor": "2000000", "dailyUsedMinor": "175156", "dailyRemainingMinor": "1824844",
  "otpThresholdMinor": "500000", "otpExpirySeconds": 300, "otpMaxAttempts": 5, "demoOnly": true }
```

- Valores leídos de `DAILY_TRANSFER_LIMIT_MINOR`, `BUSINESS_TIME_ZONE`, `OTP_THRESHOLD_MINOR`, `OTP_EXPIRY_SECONDS`, `OTP_MAX_ATTEMPTS`. Las cifras del ejemplo son las del `.env.example`/pruebas: **ejemplos demo, no política aprobada**. `demoOnly` es `true` fuera de `APP_ENV=production`.
- Semántica exacta: OTP se exige cuando `amountMinor >= otpThresholdMinor`. `dailyUsedMinor` = salidas **completadas** del usuario en `businessDate`; un intento pendiente de OTP no reserva límite (se valida al confirmar, y puede fallar con 429 si otra salida consumió el límite mientras tanto). El límite es por usuario y día, no por cuenta.
- Se eligió el endpoint y **no** poblar `Account.dailyLimitMinor/dailyUsedMinor`: el límite no es por cuenta y repetirlo en cada cuenta sería engañoso. Esos dos campos quedan `deprecated` en OpenAPI y la API no los devuelve.
- `Transfer.expiresAt`: instante de vencimiento del OTP del intento (= `createdAt + OTP_EXPIRY_SECONDS`), `null` si no requirió OTP. El cliente puede mostrar una cuenta regresiva con él (no con `otpExpirySeconds` + reloj local).

### Reenviar código: decisión

No se añade endpoint de reenvío. REQ-XFER-11 exige un código de un solo uso, ligado al intento y con expiración/uso único; no exige reenvío, y reemitir un código para el mismo intento abriría preguntas de política (¿reinicia expiración?, ¿reinicia intentos?) que no están aprobadas. El contrato ya permite un **nuevo intento seguro**: cancelar el pendiente (`POST /transfers/{id}/cancel`) o dejarlo expirar, y crear otra transferencia con **nueva** `Idempotency-Key` → nuevo `transferId` y nuevo código. No puede haber doble débito: sólo un intento confirmado genera asientos y el anterior queda en estado terminal sin asientos (garantizado por trigger en BD). Si G2 ofrece "Solicitar otro código", debe ser exactamente esa secuencia (cancelar + nuevo intento, con acción explícita del usuario).

## 4. F-10 — ciclo de vida de `awaiting_confirmation`

```
POST /transfers (>= umbral) ──► awaiting_confirmation ──OTP correcto──► completed   (asientos + límite)
                                   │  │
                                   │  └─ POST /cancel ───────────────► cancelled   (sin asientos)
                                   └──── now() >= expiresAt ─────────► expired     (sin asientos)
```

- Expiración: el intento vence en el mismo instante que su OTP (`expiresAt`). No hay job en segundo plano; la transición es **determinista y perezosa**: se materializa (estado `expired`, `closed_at`, evento `transfer.expired` en auditoría) al consultar `GET /transfers/{id}`, al confirmar ese intento (respuesta 422 "El código expiró." y el intento queda `expired`), al cancelarlo y cada vez que el dueño crea otro intento (barrido de sus pendientes vencidos). Usa `FOR UPDATE SKIP LOCKED`: nunca bloquea ni compite con una confirmación en curso. No toca saldos, ledger ni `daily_limit_usage`.
- Intentos agotados (`otpMaxAttempts`): confirm responde 429; el intento sigue pendiente sin asientos hasta `expiresAt` (luego `expired`) o hasta que el usuario lo cancele.
- Cancelación: `POST /v1/transfers/{transferId}/cancel` (Bearer, sin cuerpo, sin `Idempotency-Key`). Idempotente por estado: pendiente → `cancelled` (o `expired` si ya venció); repetir sobre `cancelled`/`expired` → 200 con ese estado; `completed` → 409; ajeno/inexistente → 404. Auditado (`transfer.cancelled`).
- BD (migración `1763000008000-TransferTerminalStates`, `synchronize:false`): `status` admite `expired` y `cancelled`; `closed_at` obligatorio exactamente para esos dos; trigger `transfers_terminal_state_guard` impide salir de `completed/rejected/expired/cancelled` y sólo permite llegar a `expired/cancelled` desde `awaiting_confirmation`. Ninguna fila se borra.
- Confirmar un intento `expired`/`cancelled` → 409 y nunca mueve dinero (probado, además lo impide el trigger).
- Idempotencia:
  - Repetir `POST /transfers` con la misma llave y payload sigue devolviendo el mismo `transferId` (nunca una segunda transferencia). Si el intento era OTP, la respuesta refleja el **estado actual**: 202 + `demoOnlyCode` mientras siga pendiente; **200** con `completed`/`expired`/`cancelled` cuando ya cerró.
  - Repetir `confirm` con la misma llave: el éxito devuelve el mismo 200; un fallo (código incorrecto, expirado, agotado) ahora se reproduce con el mismo status y `detail`. Antes se devolvía **200 con `{}`** — un cliente que reintentara un confirm fallido podía interpretarlo como éxito.
- Salir de la pantalla de código y volver a "Confirmar transferencia": hoy el cliente crea otro intento con otra llave y el anterior queda huérfano `awaiting_confirmation` (lo que reportó F-10). Con este contrato el huérfano ya no queda abierto indefinidamente: expira en `expiresAt` y se cierra como `expired`. Recomendación G2: al abandonar el OTP llamar `POST /cancel` sobre ese `transferId` (best-effort; si falla, expira solo) o, si el usuario vuelve con el mismo borrador y el intento sigue pendiente (`GET /transfers/{id}`), reutilizarlo en vez de crear otro.
- Historial: los movimientos sólo existen para transferencias `completed`; un intento pendiente/expirado/cancelado no genera movimientos. Su estado terminal se ve en `GET /transfers/{id}` (y en el replay de create).

## 5. Contrato para G2 (resumen exacto)

- `Beneficiary.ownAccountId?: uuid` — sólo beneficiarios que son cuenta propia.
- `GET /v1/transfer-policy` → `TransferPolicy` (ver §3).
- `POST /v1/transfers/{transferId}/cancel` → 200 `Transfer` (`cancelled`|`expired`), 404, 409.
- `Transfer.status` ∈ `awaiting_confirmation | processing | completed | rejected | expired | cancelled`. El servidor no escribe `processing` ni `rejected` hoy. **G2 debe tratar `expired` y `cancelled`**: el móvil actual manda todo lo que no es `awaiting_confirmation`/`rejected` a la pantalla de comprobante.
- `Transfer.expiresAt: Timestamp | null`.
- `POST /v1/transfers` replay: puede responder **200** (intento OTP ya cerrado).
- `Movement.counterparty: { name, clabeMasked, ownAccountId? }`; `Movement.occurredAt` con milisegundos.
- Todos los timestamps: `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC).

## 6. Operación y pendientes

- `wallet_dev` **no** tiene la migración 1763000008000. La API demo (puerto 3200) corre con `tsx watch` sobre el checkout principal; por eso esta tanda se trabajó en un worktree aparte y el checkout principal sigue en `902743f`. Al hacer fast-forward del checkout principal la API demo recargará el código nuevo: antes hay que correr `npm run db:migrate` contra `wallet_dev` (decisión del usuario), o las rutas de transferencias fallarán por la columna `closed_at` faltante.
- `npm run test:integration` (raíz) corre los archivos en paralelo; la prueba de corte de BD de `transfers.integration.ts` termina backends activos de `wallet_runtime_test` y puede tumbar consultas de otra suite simultánea. Recomendación al dueño de `package.json`: añadir `--test-concurrency=1`. Esta tanda ejecutó las suites de una en una.
- No verificado: parseo de fechas/Intl en Hermes en dispositivo (no hay simulador en este host); cambios de UI web/móvil (fuera del alcance de G1).
