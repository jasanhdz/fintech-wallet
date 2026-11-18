# Evidencia WF-T5 · Confirmación y resultado (W10, W11, W12) · código `29e780e`

Rama `feature/web-fidelity-final`, base `f0ed4bc`. Evidencia del Generator de la tanda WF-T5. **No es aceptación final**: la
evaluación la hace el Evaluador (`docs/evidence/web-final/eval-<sha>/` y `docs/web-fidelity-final/FINDINGS.md`).

## Estado: runtime BLOCKED por disco

`df -h /System/Volumes/Data` dio **2.04 GiB** libres al empezar; tras borrar las capturas PNG no versionadas de tandas
anteriores (~82 MB) quedó en **2.12 GiB** y terminó en **2.11 GiB** (`env-01-disk.txt`). SPEC §5.10 exige ≥ 2.5 GiB antes de
crear el volumen o compilar, así que **no** se creó `fintech-wallet-web-pg`, **no** se hizo `vite build`, **no** se abrieron
puertos 3301–3304/5301–5304 y **no** corrió Playwright (`final`, `legacy`), ni capturas, ni lado a lado, ni la comparación de la
traza dorada. No se borró nada ajeno (imágenes/volúmenes Docker y el scratchpad del coordinador no son de esta tanda).

Lo que sí corrió (Node 26.13.1): lint, typecheck, 44/44 pruebas unitarias, eslint + `tsc` de `web/e2e-final` y `web/e2e`,
`static-checks.mjs` (FONT-01/02, TOK-01, REC-01, REC-08, ENV-02, SC-03 PASS), barridos de alcance sobre `web/src` y una
comparación estática de los puntos de escritura de red (`network-static.txt`).

| Archivo | Contenido |
|---|---|
| `commands.txt` | comandos ejecutados y los pendientes por el bloqueo (sin `npm ci/install`, sin suites raíz) |
| `env-01-disk.txt` | `df -h` + `docker system df` → BLOCKED |
| `env-summary.txt` | versiones, recursos propios no creados, puertos libres, pilas ajenas no tocadas |
| `checks-output.txt` | FN-18 (salvo `build`), eslint/tsc de los arneses, `static-checks.mjs` |
| `scope-sweeps.txt` | SC-01/02/04, FN-09, FN-16, REC-04, sin `/cancel` ni 0.4.0 en `web/src` |
| `network-static.txt` | sustituto estático de REC-02: llamadas de escritura de `transfers.tsx` idénticas a `8ab4b86` (traza dorada IDÉNTICA en WF-T4); `api.ts`, `session.tsx`, `transfer-attempt.ts` sin cambios en WF-T5 |

## Qué se construyó

- **W10** (`web/src/transfer-screens.tsx` `CodeView`, `web/src/transfers.tsx` `TransferStatusPage`): estructura de dos columnas de
  `w10_c_digo_completo` (7/12 código + 5/12 «Resumen de orden»), cuenta regresiva desde `expiresAt` (chip «mm:ss min», tonos de
  error < 60 s; a `00:00` un `GET` y V9 sólo si el servidor dice `expired`), estados vacío, incompleto, completo, verificando,
  incorrecto (foco + selección), expirado/cancelado (del servidor), intentos agotados (tarjeta «Operación suspendida» con saldo
  de `GET /v1/accounts`), código de demostración sólo si la respuesta lo trae. Mapeo de `confirm` por `status` + `detail`
  (`web/src/transfer-outcome.ts`): 409 y 422 «El código expiró.» leen el intento con `GET`.
- **W11**: tres vistas distintas — `SendingView` (POST en vuelo, sustituye a la revisión), `VerifyView` «Verificando resultado»
  (spinner, botón deshabilitado) y «Resultado desconocido» (icono estático, botón habilitado). Botón y nota nombran la acción real:
  `GET` → «Consultar estado» / «No reenviamos tu transferencia…»; mismo `POST` → «Reintentar el mismo envío» / «Se repetirá la
  misma solicitud con su misma clave…». «Volver al Inicio» conserva el registro (aviso de W03).
- **W12** (`ReceiptView`): cabecera de éxito, tarjeta 760 con barra, folio copiable (`receiptReference ?? id`, «Folio copiado»),
  partes con iconos, filas zebra, saldo(s) disponible(s) actual(es) de `GET /v1/accounts` (se releen al pasar a `completed`),
  «Volver al inicio» / «Ver movimientos». Se eliminó el aviso con «CEP».
- Sin «Solicitar nuevo código» (E-W10-1) ni «Volver a revisar» (E-W10-2, D-12 diferido; escalado H-W6).
- DEP-7: `sendEpoch: '0'` en la política sintética de `web/e2e-final/fixtures/data.ts`; `tsc -p web/e2e-final` vuelve a pasar.

Pruebas nuevas (escritas, typecheck/lint verdes, **no ejecutadas** por el bloqueo): `web/e2e-final/t5-confirm-result.spec.ts`
([F]: W10 × 7 estados × 4 viewports con lado a lado a R, W10-F1/F2, W11 V1–V4 × 4 viewports, W11-F1/F4, W12 × 2 × 4 viewports,
W12-F1, reflow, pegado) y `web/e2e-final/t5-integration.spec.ts` ([I] P1 FN-10/W12-F2/FN-12 e I-W11-6; P3 expiración y
agotados reales). Unitarias: `web/tests/transfer-outcome.test.ts` (5).

## Criterios de WF-T5

| Criterio | Estado | Evidencia |
|---|---|---|
| W10-V1…V10, W10-F1/F2 `[F]` | Pendiente (implementado; prueba escrita, sin ejecutar) | `t5-confirm-result.spec.ts`; mapeo y cuenta regresiva PASS en unitarias |
| W10-F3 (Volver a revisar, D-12) | No aplica en esta tanda: diferido por el coordinador; omitido (E-W10-2) | `EXCEPTIONS.md`, `ESCALATIONS.md` H-W6 |
| W10-F4 `[I]` P1/P3 | Pendiente | `t5-integration.spec.ts` |
| W10-VZ, W11-VZ, W12-VZ | Pendiente (sin capturas) | — |
| W11-V1…V4, F1, F2, F4 `[F]` | Pendiente; F1 (copia por acción) PASS en unitarias | `transfer-outcome.test.ts` |
| W11-F3 `[I]` | Pendiente | `t5-integration.spec.ts` I-W11-6 |
| W12-V1…V6, F1 `[F]`; F2 `[I]` | Pendiente | specs T5 |
| FN-10 `[I]` | Pendiente | `t5-integration.spec.ts` |
| REC-02 (traza dorada) | Pendiente de ejecución; sustituto estático: llamadas de escritura idénticas a `8ab4b86` | `network-static.txt` |
| REC-05 (copia veraz W11-F1) | PASS estático/unitario; pendiente `[F]` | unitarias, `scope-sweeps.txt` |
| FN-18 | lint/typecheck/test PASS; `build` BLOCKED | `checks-output.txt` |
| TOK-01, FONT-01/02, REC-01, REC-08, ENV-02, SC-03 | PASS | `checks-output.txt` |
| SC-01/02/04, FN-09, FN-16 (sobre `web/src`; `web/dist` no compilado) | PASS | `scope-sweeps.txt` |
| T0–T4 `final` + `legacy` + golden | Pendiente (BLOCKED) | — |

## Reproducir (cuando haya ≥ 2.5 GiB libres)

Ver `commands.txt` (bloque «NOT RUN»): `make-env` → `db-up` → Playwright `final` con `WF_PROFILES=P1,P2,P3,P4` y las dos
invocaciones `legacy` → comparación con `../f0ed4bc/network-golden.json` → `db-down`.
