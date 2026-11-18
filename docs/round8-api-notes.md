# Ronda 8 · API: recuperación autoritativa de intentos de transferencia (G-A)

Alcance: tandas C0 (contrato 0.4.0) y G-A (backend) de `SPEC.md` §R8.1–§R8.13. Cierra la parte de servidor de F-26
(dimensión ii) sin tocar la dimensión (i) ya aceptada. La parte móvil (§R8.7–§R8.9) es de G-B. Las cifras de
configuración (`IDEMPOTENCY_RECORD_RETENTION_DAYS=30` y las existentes) son **ejemplos demo, no política aprobada**.

Código: `api/src/db/migrations/1763000009000-TransferAttemptRecovery.ts`, `api/src/transfers/faults.ts`,
`api/src/transfers/service.ts` (`createTransfer`, `ensureSendGate`, `lockAttemptKey`), `api/src/transfers/attempts.ts`
(listado, `void`, `void-all`), `api/src/http/app.ts` (rutas y problemas tipados), `api/src/config.ts`
(`idempotencyRetentionDays`). Pruebas: `api/tests/transfer-recovery.integration.ts` (integración real),
`api/tests/transfer-attempts.test.ts` y `api/tests/config.test.ts` (unitarias). Evidencia: `docs/evidence/round8/api-c01c45b/`.

## 1. Contrato 0.4.0 (aditivo)

| Elemento | Forma |
|---|---|
| `GET /v1/transfer-attempts` | `status` (lista por comas de `awaiting_confirmation,completed,expired,cancelled,rejected,voided`), `from`/`to` (ISO 8601 sobre `createdAt`, `from <= to`), `attemptId`, `limit` 1–50 (defecto 20), `cursor`. Respuesta `TransferAttemptPage {items, nextCursor, sendEpoch}`. |
| `POST /v1/transfer-attempts/void` | `VoidAttemptRequest {idempotencyKey (16–128), attemptId?}` → 200 `VoidAttemptResult {resolution: transfer_found\|rejected\|voided, attempt}`; 409 `transfer-attempt-conflict`. Sin cabecera `Idempotency-Key`: es idempotente por estado. |
| `POST /v1/transfer-attempts/void-all` | `VoidAllRequest {fromEpoch}` → 200 `VoidAllResult {sendEpoch, advanced, closedTransferIds}`; `fromEpoch` mayor que la vigente → 400. |
| `POST /v1/transfers` | Cabeceras opcionales `Transfer-Attempt-Id` (UUID) y `Transfer-Send-Epoch` (`^(0\|[1-9][0-9]{0,18})$`), juntas o ninguna. |
| `TransferPolicy.sendEpoch` | Cadena decimal (`SendEpoch`), en `required`. |
| Tipos de problema | `urn:billetera:problem:transfer-attempt-voided`, `…-rejected`, `…-conflict` (`TransferAttemptProblemType`); el resto sigue `about:blank`. |

Decisión de forma: las épocas viajan como **cadena decimal** (igual que los importes `bigint`), en cabecera, política,
página, `fromEpoch` y resultado. `git diff` de `specs/openapi.yaml` sólo quita la línea `version` y la lista
`required` de `TransferPolicy` (sustituida por otra que añade `sendEpoch`); ninguna operación existente cambia.

## 2. Modelo de datos (migración `1763000009000`)

Idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, grants en bloque
`DO` sólo para roles existentes) y sólo aditiva. `down` en orden inverso con `IF EXISTS`.

- `transfers.client_attempt_id uuid NULL` + `transfers_owner_attempt_uidx (owner_id, client_attempt_id) WHERE NOT NULL`;
  trigger `transfers_attempt_id_immutable` (tampoco permite rellenar un `NULL`).
- `transfer_send_gates (owner_id PK, epoch bigint ≥ 0, updated_at)`; trigger `transfer_send_gates_monotonic`
  (DELETE siempre error; UPDATE sólo `epoch ∈ {OLD, OLD+1}` y mismo dueño). Fila perezosa; ausencia = época 0.
- `transfer_attempt_closures` con los CHECK de §R8.5-3 (con nombre), índices únicos `(owner_id, key_hash)` y
  `(owner_id, client_attempt_id) WHERE NOT NULL`, índice `(owner_id, closed_at DESC, id DESC)` y trigger
  `transfer_attempt_closures_append_only`.
- Guardas cruzadas (defensa en profundidad): `transfer_attempt_closures_cross_guard`, `idempotency_records_closed_key_guard`
  (`WHEN operation='create-transfer'`) y `transfers_closed_attempt_guard` (`WHEN client_attempt_id IS NOT NULL`).
- Grants de `wallet_runtime_dev`/`wallet_runtime_test`: gates `SELECT, INSERT, UPDATE` y `REVOKE DELETE, TRUNCATE`;
  closures `SELECT, INSERT` y `REVOKE UPDATE, DELETE, TRUNCATE`. `transfers`, `idempotency_records` y `audit_events` sin cambios.

Son **6 triggers**: los 3 de §R8.5-1/2/3 más las 3 guardas de §R8.5-4. El texto de R8-01 dice "los 5 triggers"; se
implementó todo lo que §R8.5 enumera y la prueba comprueba los 6.

## 3. Orden de `createTransfer` y garantías

Validaciones previas sin cambios → cabeceras (400 sin escribir) → `expireDue` (como antes) → `ensureSendGate`
(INSERT … ON CONFLICT DO NOTHING en su propia sentencia) → transacción:

1. `SELECT epoch … FOR SHARE` del gate (toda creación, con o sin cabeceras; compatible entre envíos).
2. `pg_advisory_xact_lock(hashtextextended(owner_id || ':' || key_hash, 0))`.
3. Idempotencia: replay del resultado guardado (payload distinto → 409 `about:blank` como hoy; con cabeceras, si la
   transferencia tiene otro `client_attempt_id` no nulo → 409 `conflict`; nulo se acepta sin rellenar). **Un resultado
   ejecutado nunca se oculta**, cualquiera que sea la época.
4. Cierres por `key_hash` o por `attemptId`: cualquier `voided` → 409 `voided`; `rejected` con la misma llave y payload →
   mismo status y `detail` con tipo `rejected`; misma llave con otro payload → 409 `about:blank`; la identidad cerrada con
   otra llave → 409 `conflict`. Sin escrituras. La búsqueda por llave aplica también sin cabeceras (R8-07).
5. Con cabeceras: época enviada < vigente → 409 `voided`; > vigente → 400; `attemptId` usado por otra llave → 409 `conflict`.
6. `SAVEPOINT create_transfer` + lógica anterior (cuentas en orden, OTP `amount >= threshold`, saldo, límite diario,
   asientos, auditoría, idempotencia). Con cabeceras, un `TransferFault` 404/422/429 hace `ROLLBACK TO SAVEPOINT`, inserta
   el cierre `rejected` + `transfer.attempt_rejected` y hace COMMIT. Sin cabeceras: rollback total (comportamiento web).

Garantías y por qué se cumplen:

- **Nunca dos débitos por llave**: el lock consultivo serializa la misma llave; el segundo ve la fila de idempotencia
  (8 `POST` simultáneos → 8 × 201 con el mismo id, ya no 409 "en curso"). `UNIQUE(user_id, operation, key_hash)` sigue.
- **Veto por identidad**: `void` toma el gate `FOR UPDATE` (espera a los envíos en curso, que lo tienen `FOR SHARE`) y el
  mismo lock consultivo. Si no hay ejecución, el cierre `voided` queda antes que cualquier envío posterior; un envío que
  llega después ve el cierre en el paso 4. Si el envío ya se ejecutó, `void` lo devuelve (`transfer_found`).
- **Veto sin identidad**: `void-all` avanza la época con el gate `FOR UPDATE`; los envíos en curso terminan antes, y los
  que llegan después leen la época nueva (READ COMMITTED relee la fila bloqueada) y responden 409 `voided`.
- **Pendientes de código**: `void`/`void-all` bloquean la fila `FOR UPDATE` (orden por id) y vuelven a leer su estado; la
  carrera con `confirm` (que bloquea `FOR UPDATE OF t,o`) termina en `completed` con asientos o `cancelled`/`expired` sin ellos.
- **Sin interbloqueos nuevos**: orden de locks gate → consultivo → filas (cuentas o transferencia). `confirm`, `cancel` y
  `expireDue` (SKIP LOCKED) nunca toman el gate, así que no hay ciclo. La concurrencia 100 de `transfers.integration.ts`
  sigue en verde (FOR SHARE no serializa).
- **Choques de identidad simultáneos** (misma `Transfer-Attempt-Id`, llaves distintas): la segunda inserción viola
  `transfers_owner_attempt_uidx` o `transfer_attempt_closures_owner_attempt_uidx` y se responde 409 `conflict` (no "en curso").

## 4. Listado, `void` y `void-all`

- Listado: `expireDue` del usuario y después `transfers ∪ transfer_attempt_closures` del dueño, orden total
  `createdAt DESC, kind DESC ('transfer' > 'closure'), id DESC`, keyset con cursor opaco base64url canónico de
  `{at (µs UTC), kind, id}` (cualquier alteración → 400), sin OFFSET. Para un cierre `createdAt = closedAt = closed_at`,
  `transferId`, `concept`, `reference`, `sourceAccountId`, `destination` y `expiresAt` son `null`; `amountMinor` sólo existe
  en `rejected`. `destination` sólo lleva `name`, `clabeMasked` y `ownAccountId`; nunca CLABE completa, `demoOnlyCode`,
  código, llave, `key_hash` ni `requestId`. `from`/`to` comparan con la marca de tiempo completa (µs) aunque `createdAt` se
  muestre con milisegundos. Los parámetros desconocidos se ignoran (como en movimientos).
- `void`: llave en `idempotency_records` → `transfer_found` (cerrando un pendiente como `cancelled`, o `expired` si su OTP
  venció, auditado con `via:'void'`); identidad usada por otra llave o llave ligada a otra identidad → 409 `conflict`;
  cierre existente → su estado; nada → cierre `voided` + `transfer.attempt_voided`. Una llave desconocida nunca es 404.
- `void-all`: `fromEpoch == epoch` → `epoch+1`, cierra todos los `awaiting_confirmation` del usuario (también los creados
  sin cabeceras, D4) con `via:'void_all'`, audita `transfer.send_epoch_advanced {from,to,closedCount}` (cadenas para las
  épocas); `fromEpoch < epoch` → no-op `advanced:false`; `fromEpoch > epoch` → 400.

Auditoría: sólo acciones efectivas (un `void` repetido o un `void-all` no-op no auditan). `metadata` nunca lleva llave,
`key_hash`, OTP, CLABE ni concepto.

## 5. Política de expiración (criterio 6)

| Campo | Decisión |
|---|---|
| `otp_challenges.expires_at` / `Transfer.expiresAt` | Sin cambio. `void`/`void-all` aplican la misma regla (vencido → `expired`, si no → `cancelled`). |
| `idempotency_records.expires_at` | **Replay indefinido**; ninguna lógica lo lee. Se escribe `now() + make_interval(days => IDEMPOTENCY_RECORD_RETENTION_DAYS)` en create y confirm. Sin literal en el código: la variable es obligatoria en producción (`assertProductionConfiguration`) y se lee del entorno en todos los entornos (si falta, crear/confirmar falla con 500 y no se escribe nada). Rango aceptado 1–1,000,000 (cota de representabilidad de `timestamptz`, no política). |
| Cierres y época | Permanentes. |

Consecuencia operativa: un `.env` local anterior a la ronda 8 no tiene la variable. Las suites que crean transferencias
(`transfers`, `round6-contract`, `movements`) la fijan con `??= '30'` (ejemplo demo), y `npm run env:local` la copia de
`.env.example`. **Antes de actualizar la demo** (fuera de esta ronda) hay que añadirla a la `.env` del checkout principal
y aplicar la migración a `wallet_dev`; ambas cosas requieren autorización del usuario (§R8.11).

## 6. Residuales y decisiones (SPEC §R8.11)

- **D3** Los rechazos 404/422/429 con cabeceras son terminales para su identidad (el replay tras abonar saldo sigue 422).
  Sin cabeceras se reevalúan como antes. Un 400 nunca se cierra.
- **D4** `void-all` es amplio: veta todo envío con cabeceras aún no llegado de cualquier dispositivo del usuario y cancela
  todos sus pendientes de código, incluidos los de la web.
- **D5** Un registro dañado de un build anterior cuyo envío original (sin cabeceras) no hubiera llegado al servidor cuando
  termina el `void-all` no queda vetado (no lleva época). Los envíos en curso sí se esperan (lock del gate). Todo registro
  legible tiene veto por llave con `void`, y todo envío del build nuevo tiene veto por época.
- **D6** Un dispositivo cuyo almacenamiento no puede escribir/borrar no debe enviar (G-B); el servidor ya resuelve sus intentos.
- **D2** Una purga futura de `idempotency_records` exigiría convertir la fila en cierre permanente; fuera de alcance.

## 7. Desviaciones y puntos a revisar

- Seis triggers en lugar de los "5" citados en R8-01 (ver §2).
- `ensureSendGate` hace el `INSERT … ON CONFLICT DO NOTHING` fuera de la transacción del envío, para que el primer envío de
  un usuario no deje a los demás esperando su COMMIT; dentro de la transacción sólo se toma `FOR SHARE`.
- Las carreras de R8-06/R8-08 son `Promise.all` reales, con un desfase aleatorio de pocos ms que alterna qué lado arranca
  primero para ejercitar ambos órdenes (sin él el `void` ganaba siempre por hacer menos viajes previos). El caso (c) de R8-06
  demuestra el solapamiento real (envío retenido por un lock de cuenta, `void` esperando el gate).
- En CI, `test:integration` ejecuta todas las suites en paralelo; la prueba de corte de BD de `transfers.integration.ts`
  termina backends activos del rol runtime y podría coincidir con otra suite. Es un riesgo previo (ya existía con
  `round6-contract`); la evidencia local ejecuta las suites una a la vez.
- `round6-contract.integration.ts` compara la política con `deepEqual`; se añadió `sendEpoch: '0'` a lo esperado (cambio
  aditivo del contrato), sin tocar otras expectativas.
- `Transfer` (GET/POST `/transfers`) no expone `attemptId`; la identidad sólo aparece en el listado.

## 8. Cómo reproducir

```bash
nvm use                                   # Node 26.13.1
npm run db:migrate:test                   # sólo wallet_test (guardas fail-closed); nunca wallet_dev
(cd api && npx tsx --import dotenv/config --test tests/transfer-recovery.integration.ts)
npm run lint && npm run typecheck && npm test && npm run build && npm run openapi:check
```

El detalle (una suite a la vez, consultas `psql`, comprobaciones de alcance) está en
`docs/evidence/round8/api-c01c45b/README.md`.
