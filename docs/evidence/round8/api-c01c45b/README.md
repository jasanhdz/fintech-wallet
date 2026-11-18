# Ronda 8 · C0 + G-A (API) — evidencia del código `c01c45b`

Contrato OpenAPI 0.4.0 (`325eb74`) y backend de recuperación autoritativa de intentos (`aa15f16`…`c01c45b`) en
`feature/product-mvp`. Todo se ejecutó con Node 26.13.1 contra PostgreSQL 16.10 **`wallet_test`** (guardas fail-closed de
`assertSafeTestDatabase`/`assertSafeTestMigrator`). Diseño y garantías: `docs/round8-api-notes.md`.
**No es evidencia móvil ni nativa** (G-B / R8-15…R8-22).

## Niveles

| Nivel | Qué | Archivo |
|---|---|---|
| [U] unitario (`node:test`) | `api/tests/config.test.ts` (retención obligatoria en producción, sin valor por defecto, sin `interval '30 days'`), `api/tests/transfer-attempts.test.ts` (cursor, query, cabeceras) | `22-root-test.txt` (api: 12/12) |
| [I] integración real API + PostgreSQL | `api/tests/transfer-recovery.integration.ts` (14 subpruebas) + las 6 suites existentes, **una a la vez** | `10-…16-integration-*.txt` |
| Consultas `psql` | `queries-wallet_test.sql` sobre los usuarios del último run (filtrados por `created_at >= since`) | `30-psql-wallet_test.txt` |
| Entorno | `wallet_dev` sólo lectura; puertos de la demo y checkout principal | `31-…`, `33-…` |

Ningún criterio de este bloque usa mocks de la API: los clientes HTTP hablan con `createApp()` real escuchando en
`127.0.0.1:0` (puerto efímero) y la base es `wallet_test`.

## Criterios (resultado observado por el Generator; la aprobación es del Evaluator)

| Criterio | Resultado | Dónde |
|---|---|---|
| R8-01 Migración | PASS | `01-…` (primera aplicación), `02-…` (re-ejecución sin cambios), subprueba R8-01 (re-ejecuta el SQL de `up` como `wallet_migrator_test` en una transacción con COMMIT; columna, 4 índices, 5 CHECK, 6 triggers, `has_table_privilege`; como runtime: UPDATE/DELETE de cierre, bajar/saltar época, DELETE de gate, cambiar `client_attempt_id`, `completed → cancelled` y las 3 guardas cruzadas fallan), `30-…` (catálogo), `31-…` (`wallet_dev`: 0 filas `1763000009000`, sin tablas ni columna) |
| R8-02 Contrato | PASS | `24-…`, `25-…` (validate/check = 0), `21-…` (typecheck = 0), `32-…` (versión 0.4.0, 3 rutas, 2 cabeceras, `sendEpoch`, 3 tipos; `git diff` sólo quita `version` y la lista `required` de `TransferPolicy`) |
| R8-03 Listado | PASS | Subprueba R8-03: 45 intentos (20 completed, 6 awaiting, 4 expired, 4 cancelled, 5 rejected, 6 voided); páginas `limit=10` = `[10,10,10,10,5]` idénticas al orden SQL directo aun creando 3 intentos tras la primera página; filtros `status`, `from`/`to` (comparado con SQL) y `attemptId`; `limit=0/51/x`, cursor alterado o extendido, `from>to`, `status`/`attemptId` inválidos → 400; recorrido de cada respuesta sin `^\d{18}$`, `demoOnlyCode`, `code`, `idempotencyKey`, `keyHash`, `requestId`, `clabe` ni llaves |
| R8-04 Respuesta perdida al enviar | PASS | Subprueba R8-04: lock `FOR UPDATE` de la cuenta destino desde otra conexión, `POST` con cabeceras bloqueado (`pg_blocking_pids`), cliente abortado (`AbortError`), lock liberado, el servidor confirma, **reinicio de la API**, `GET ?attemptId=&limit=1` = 1 ítem con `transferId`, replay = mismo id; BD 1 transferencia, 1 débito, suma 0, saldos ±12345 |
| R8-05 Respuesta perdida al anular | PASS | Subprueba R8-05: `void` ×3 → `voided`, 1 cierre, 1 `transfer.attempt_voided`; `void-all` ×3 → `advanced [true,false,false]`, época +1, 1 `transfer.send_epoch_advanced {from,to,closedCount:0}`; `fromEpoch` futuro → 400 |
| R8-06 Carrera enviar/anular | PASS | Subprueba R8-06: (a) anular antes → 409 `voided`, 0 transferencias; (b) `POST` antes → `transfer_found` mismo id, 1 débito; (c) `POST` retenido por lock de cuenta con el gate tomado, `void` esperando el gate, lock liberado → 201 y `transfer_found` mismo id. 50 iteraciones `Promise.all([post, void])`: 25 ejecutadas + 25 anuladas, por identidad exactamente una transferencia o un cierre, ≤ 1 débito, suma 0. `void-all` vs `POST` ×20: 10 + 10 |
| R8-07 Envío tardío vetado | PASS | Subprueba R8-07: tras `void`, mismo `POST` (misma época, época actual) y sin cabeceras con la llave → 409 `voided`, instantánea (saldos, `daily_limit_usage`, filas) idéntica; tras `void-all`, época vieja + llave nueva → 409 `voided`, época nueva → 201; época futura y una sola cabecera → 400 |
| R8-08 Anulación de pendientes | PASS | Subprueba R8-08: `void` de `awaiting_confirmation` → `cancelled` con `transfer.cancelled {via:'void'}`; `confirm` posterior → 409 sin asientos; OTP vencido → `expired {via:'void'}`; carrera `confirm` vs `void` ×20 → 10 `completed` (2 asientos, 1 débito) + 10 `cancelled` (0 asientos); `void-all` cierra los 4 pendientes del usuario (incluido uno sin cabeceras) con `via:'void_all'` y deja los 2 del otro usuario y su época intactos |
| R8-09 Rechazo terminal y lock por identidad | PASS | Subprueba R8-09: 422 saldo, 429 límite y 404 beneficiario con cabeceras → tipo `rejected`, 1 cierre `rejected` con su status, 0 transferencias/asientos/consumo, auditoría `{status}`; tras abonar saldo el replay sigue 422 `rejected`; sin cabeceras el 422 no deja cierre y tras abonar se reevalúa a 201; 8 `POST` simultáneos de una llave (con y sin cabeceras) → 8 × 201 mismo id, 1 registro de idempotencia, 1 débito; identidad/llave cruzadas → 409 `conflict` |
| R8-10 Preservación | PASS | `10-…15-…` (auth-accounts 2/2, beneficiaries 1/1, database 2/2, movements 1/1, round6-contract 1/1, transfers 2/2 con concurrencia 100, OTP, límite/medianoche y corte de BD), una a la vez; subprueba R8-10: 499999 → 201, 500000 → 202, 500001 → 202 con y sin cabeceras |
| R8-11 Aislamiento | PASS | Subprueba R8-11: listado de B vacío; `?attemptId=<de A>` idéntico a un id inexistente; `void` de B con la llave de A → `voided` en el ámbito de B y el replay de A sigue devolviendo su transferencia; `void-all` de B no cambia época ni pendientes de A; `GET /transfers/{id de A}` → 404 |
| R8-12 Expiración | PASS | Subprueba R8-12: `expires_at` 45 días al pasado → replay mismo id/status y `void` → `transfer_found`, 0 filas nuevas; `IDEMPOTENCY_RECORD_RETENTION_DAYS=2` → `2 days` en create y confirm (también en `30-…`). [U] en `22-…`; `grep` = 0 en `32-…`; pruebas OTP de expiración existentes en `15-…` |
| R8-13 Auditoría y privacidad | PASS | Subprueba R8-13 (241 eventos, 203 llaves, 48 códigos, 28 CLABE comprobados contra metadata de auditoría y todo lo impreso por el proceso de prueba + API) y `30-…` (escaneo SQL: 0 valores de 18 dígitos, 0 campos tipo llave/código, 0 `key_hash` en metadata); `32-…` (`grep` en los logs guardados: sin 18 dígitos ni cabeceras de llave) |
| R8-14 Otro cliente | PASS | Subprueba R8-14: dos logins móviles del mismo usuario; A pierde la respuesta de un envío aplicado y tiene otro que nunca llegó; B lista (ve el aplicado con su `attemptId`, no el otro) y ejecuta `void-all`; A lee por `attemptId` el mismo id, su replay devuelve 201 mismo id (lo ejecutado no se oculta) y el reenvío del no llegado → 409 `voided`; ≤ 1 débito por intento, suma 0 |
| R8-23 (parte API/raíz) | PASS local | `20-…23-…`: `lint`, `typecheck`, `test` (api 12, web 20, mobile 217, shared 4), `build` = 0 con Node 26.13.1. `npm ci`, `expo install --check`, `expo export` y CI de la rama no se ejecutaron en esta tanda (G-B / CI tras el push) |
| R8-24 Alcance y entorno | PASS | `32-…`: 0 líneas en `web/**`, manifests y lockfile desde `f0ed4bc`; sin ruta de reserva; `amount>=threshold` intacto; política OTP sin cambios. `31-…`: `wallet_dev` sin migrar. `33-…`: 3200/5174/8083 siguen con sus procesos, checkout principal en `6549bfe`; las APIs de prueba usan puertos efímeros |

## Cómo reproducir

```bash
cd /ruta/al/worktree && nvm use                 # Node 26.13.1
npm run db:migrate:test                          # sólo wallet_test; falla cerrado ante cualquier otro destino
cd api
for s in auth-accounts beneficiaries database movements round6-contract transfers transfer-recovery; do
  npx tsx --import dotenv/config --test tests/$s.integration.ts || break   # una suite a la vez
done
cd ..
npm run lint && npm run typecheck && npm test && npm run build && npm run openapi:validate && npm run openapi:check
SINCE=<instante UTC anterior al run de transfer-recovery>
docker exec -i fintech-wallet-postgres-1 psql -U postgres -d wallet_test -v since="$SINCE" < docs/evidence/round8/api-c01c45b/queries-wallet_test.sql
```

Notas: los logs se guardan como `.txt` (el repositorio ignora `*.log`). Las suites usan su propio `process.env` con
valores demo (no política aprobada). `.env` local no se imprime; los logs sólo muestran el recuento de variables que
`dotenv` inyecta. Ninguna consulta selecciona `key_hash`, cifrados de CLABE/OTP ni hashes de código.
