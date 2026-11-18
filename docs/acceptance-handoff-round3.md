# Handoff de aceptación — ronda 3

**Estado: recibido, pendiente de aceptación del revisor.**

**SHA publicado:** `2a93ee155322c732b96e0541c4fdbc1cb5421e7d`
**CI:** [run 43706017068 — success](https://github.com/jasanhdz/fintech-wallet/actions/runs/43706017068).

## Demo y verificación de sesión

La Mac tiene activa la base PostgreSQL de Billetera del proyecto en `localhost:55432`; no se ejecutaron `db:seed`, migraciones, reset de saldos ni limpieza de actividad. El usuario local reservado ya existía. La instancia de demo usa el `.env` del checkout raíz en el SHA publicado, con `wallet_dev` como base runtime/migrator y `wallet_test` como base de pruebas.

Resultado de solo lectura en `wallet_dev`: un usuario reservado, dos cuentas propias, una cuenta clearing del ledger y un beneficiario. Las dos CLABEs cifradas del perfil se descifraron correctamente con la llave del checkout raíz. El login Web desde el navegador respondió `200`; tras recarga, la renovación respondió `200`; `GET /accounts` respondió `200` con dos cuentas. La navegación alcanzó Beneficiarios y Transferir. No se confirmó ninguna transferencia.

Los servicios de revisión están preparados en Web `http://localhost:5174`, API `http://localhost:3200` y Metro `8082`; la guía para el teléfono está en [`mobile-review-round3.md`](mobile-review-round3.md). La IP LAN observada al preparar Expo fue `192.168.100.8`; volver a consultarla antes de usar otro Wi-Fi.

## Discrepancia de `GET /accounts`

Los `.env` del checkout raíz y de los worktrees API/Web tenían los mismos destinos: runtime y migrator de desarrollo apuntan a `wallet_dev`, y los equivalentes de test a `wallet_test`. **Las cuatro llaves criptográficas comparadas (cifrado CLABE, lookup, refresh pepper y JWT) diferían entre el checkout raíz y ambos worktrees.** No se muestran sus valores ni huellas.

Con la fila demo existente de `wallet_dev`, el `.env` del checkout raíz descifra 2/2 CLABEs; los `.env` de los worktrees API/Web descifran 0/2. Por tanto, usar el `.env` del worktree contra el mismo `wallet_dev` puede reproducir un `500` al mapear `/accounts`; el problema demostrado es incompatibilidad de configuración criptográfica con datos cifrados, no dos perfiles/base legítimamente distintos. La demo se debe iniciar desde el checkout raíz.

`wallet_test` es una base separada, con datos de pruebas persistentes de ejecuciones previas: la llave raíz descifra 536 de 1.806 CLABEs de cuentas consultables. Esto es compatible con registros de pruebas cifrados con llaves distintas, aunque no permite identificar qué llave produjo cada fila. No se modificó ni limpió esa base. La suite del CI usa una base aislada y los E2E crean usuarios sintéticos nuevos.

El request ID histórico `057dbfb5-af5f-4163-b33b-655c7e46702e` no está correlacionado en los logs disponibles. El hallazgo anterior de llaves distintas ofrece un mecanismo reproducible y probable para el `500`, pero **no demuestra qué proceso produjo ese request histórico**.

## `mobile/tsconfig.json` local

El cambio local solo formatea el JSON y simplifica `include` a `**/*.ts` y `**/*.tsx`, quitando las inclusiones explícitas `.expo/types/**/*.ts` y `expo-env.d.ts`; `strict`, `noUncheckedIndexedAccess` y la exclusión `node_modules` se mantienen. No se requiere para el producto. Se conserva aparte, sin commit; el typecheck local pasó.

El SHA publicado no depende del cambio: su `mobile/tsconfig.json` conserva las inclusiones Expo explícitas y CI pasó `npm run typecheck`, pruebas, integración, visual Web, E2E, build/Expo export y OpenAPI en ese SHA.

## Paquete para revisión

- [`design-fidelity-round3.md`](design-fidelity-round3.md): matriz de implementación, capturas Web realmente inspeccionadas, diferencias y estados nativos bloqueados.
- [`design/references/round3/README.md`](design/references/round3/README.md): capturas PNG fuente sanitizadas y capturas PNG reales del producto del CI.
- [`mobile-review-round3.md`](mobile-review-round3.md): recorrido manual breve en Expo Go.
