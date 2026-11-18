# Escalaciones al coordinador · riesgos de recuperación en la Web (H-W1…H-W5)

Estado: **abiertas, no corregidas en esta ronda** (decisión del coordinador: esta ronda congela el
comportamiento de red de transferencias; DEP-4 pendiente). No son diferencias visuales. Referencias de
línea en el código de `f0ed4bc` (sin cambios en WF-T0: `git diff f0ed4bc -- web/src/transfers.tsx
web/src/transfer-attempt.ts web/src/api.ts` vacío en esta tanda; `web/src/session.tsx` tampoco cambia).

Reproducción automatizada común: traza dorada `docs/evidence/web-final/f0ed4bc/network-golden.json`,
generada por `web/e2e-final/golden.spec.ts` (Playwright `[F]`, API simulada con `page.route`), con:

```sh
export PATH=$HOME/.nvm/versions/node/v26.13.1/bin:$PATH
WF_PROFILES=P1 npx playwright test -c web/e2e-final/playwright.config.ts --project=final golden.spec.ts
```

Cada escenario registra las peticiones no-GET (método, ruta, clase de `Idempotency-Key` `K1/K2…`, SHA-256
del cuerpo) y el estado del registro local al final (`draftAfter`).

## H-W4 · CRÍTICO · riesgo de doble débito: 422/429 en create se tratan como definitivos

- Código: `web/src/transfers.tsx:178-186` (`definitivelyRejected = [422, 429].includes(status)` →
  `clearTransferDraft`, panel «No se realizó ningún débito»); textos en `:35-36` y `:45-46`.
- Riesgo: con dos `POST /transfers` concurrentes con la misma clave (SPEC global R8.3 (f)), el segundo puede
  recibir 422 (saldo) o 429 (límite) aunque el primero se haya aplicado. La Web borra el registro, afirma que
  no hubo débito y, si el usuario reintenta, `submit` crea una clave nueva (`:170`, `createKey()`) → segundo débito.
- Reproducción exacta del lado cliente (determinista): escenario **S6** de la traza dorada. Secuencia
  registrada: `POST /v1/transfers K1 → 422`, «Editar datos», «Enviar transferencia» →
  `POST /v1/transfers K2 → 429`, `draftAfter: none`. Demuestra que tras un 422/429 el siguiente envío usa
  una clave distinta (K2) y el registro desaparece.
- Reproducción manual del caso de doble débito (API real P1, `wallet_test` 55433): (1) iniciar sesión con un
  usuario sintético cuyo saldo origen alcance para **una** transferencia de importe X y no para dos; (2) en
  W09 pulsar «Enviar transferencia» y, mientras el `POST` sigue en vuelo (p. ej. con DevTools → *Network
  throttling* «Slow 3G»), recargar la pestaña: el montaje de `/transfers/new` repite el `POST` con la misma
  clave (H-W1); (3) si el segundo `POST` se evalúa antes de que el primero registre su resultado idempotente,
  responde 422 «Saldo insuficiente.»; (4) la Web borra el registro y muestra «No se realizó ningún débito»,
  pero el primero sí debitó; (5) «Editar datos» → «Enviar transferencia» manda una clave nueva → si hay saldo
  (o tras un abono) se produce un segundo débito. Depende de la serialización del servidor (ronda de
  recuperación); la Web no debe tratar 422/429 como prueba de no cargo mientras exista un `POST` previo
  con esa clave sin respuesta.

## H-W1 · alto · reenvío automático al cargar/iniciar sesión

- Código: `web/src/transfers.tsx:124-142` (efecto de montaje) y `:19-31` (`recoverTransferDraft`: sin
  `transferId` repite `POST /transfers` con la misma clave); `web/src/routes.tsx:34-43` (`resumeTransfer`).
- Reproducción: escenarios **S4** (recarga con registro sin `transferId`: `POST K1` abortado → recarga →
  `POST K1` automático sin acción del usuario) y **S5** (login con `resumeTransfer`: `POST /v1/auth/login`
  → `POST /v1/transfers K1` automático).

## H-W2 · alto · el registro de un intento incierto se borra al cerrar sesión o cambiar de usuario

- Código: `web/src/session.tsx:32` (`end()` → `clearAllTransferDrafts()`), `web/src/transfer-attempt.ts:8-14`
  (`activateTransferUser` borra si cambia el usuario de la pestaña).
- Reproducción: escenario **S7**: `POST /v1/transfers K1` abortado → «Cerrar sesión» → `POST /v1/auth/logout`
  → `draftAfter: none`. Tras volver a entrar, la UI permite una transferencia nueva sin conocer el resultado anterior.

## H-W3 · medio · registro por pestaña

- Código: `web/src/transfer-attempt.ts` (`sessionStorage`). Cerrar la pestaña pierde el rastro. Requiere
  `GET /v1/transfer-attempts` (0.4.0, `[P]`).
- Reproducción: escenario S3 hasta W11 «Estamos verificando el resultado»; abrir `/accounts` en otra pestaña
  → no hay aviso pendiente; cerrar la pestaña original → el registro se pierde.

## H-W5 · bajo · 409 en confirm tras recarga

- Código: `web/src/transfers.tsx:239-260` (clave de confirmación por `(transferId, código)` sólo en memoria).
  Tras recargar, el mismo código usa otra clave; si el primero se aplicó, el servidor responde 409 y la Web
  muestra error genérico en vez del comprobante. Sin doble débito.
- Reproducción manual (P1): transferencia ≥ umbral → W10 → introducir el código y, con la respuesta del
  `confirm` perdida (DevTools *offline* justo tras enviar), recargar y repetir el código → 409.
- Esta ronda prevé (WF-T5, W10-F1) sólo un `GET` posterior de lectura; la traza no-GET no cambia.

## D-12 (diferido)

`POST /v1/transfers/{id}/cancel` desde «Volver a revisar» en W10: **diferido** por el coordinador. La traza
dorada REC-02 debe ser idéntica en el SHA final, sin delta D-12.

## H-W6 · medio · un intento OTP vencido o con intentos agotados no libera el registro local (WF-T5)

- Código: `web/src/transfers.tsx` (`TransferStatusPage`: el efecto existente borra el registro sólo con `completed`/`rejected`;
  `NewTransferPage`: con registro, el montaje consulta ese intento y vuelve a `/transfers/{id}/status`; un envío con datos
  distintos se bloquea con «Hay un intento anterior pendiente…»).
- Efecto: tras V9 (expirado, terminal en el servidor) o V10 (intentos agotados; el servidor lo vence después) la pestaña no
  puede iniciar otra transferencia hasta cerrar sesión, y W03 sigue mostrando el aviso de operación pendiente. Sin riesgo de
  doble débito (el intento no puede completarse).
- Relación con D-12: «Volver a revisar» (W10) no se implementa (E-W10-2) porque, sin `POST /cancel` y sin liberar el registro,
  sólo reabriría este mismo intento. Decisión requerida del coordinador junto con D-12/DEP-4: liberar el registro ante estados
  terminales `expired`/`cancelled` del servidor (cambio de los momentos de borrado, hoy congelados) y/o habilitar el `cancel`.
