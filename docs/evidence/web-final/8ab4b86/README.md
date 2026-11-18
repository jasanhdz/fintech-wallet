# Evidencia WF-T4 · Transferencia (W08, W09, W13) · código `8ab4b86`

Rama `feature/web-fidelity-final`, base `f0ed4bc`. Evidencia del Generator de la tanda WF-T4. **No es aceptación
final**: la evaluación la hace el Evaluador (`docs/evidence/web-final/eval-<sha>/` y `docs/web-fidelity-final/FINDINGS.md`).
El commit de esta carpeta sólo añade evidencia; el código evaluado es `8ab4b86`.

| Archivo | Contenido |
|---|---|
| `commands.txt` | comandos exactos (sin `npm ci/install`, sin suites raíz `test:e2e`/`test:visual`) |
| `env-01-disk.txt` | `df -h` + `docker system df` antes del volumen y salida de `db-up.mjs` |
| `env-summary.txt` | versiones, perfiles P1/P2/P4, contenedor propio en `127.0.0.1:55433`, puertos de la ronda al terminar |
| `env-06-cleanup.txt` | `db-down.mjs`, limpieza de `web/dist`, `test-results` y capturas temporales; disco después |
| `checks-output.txt` | FN-18 (lint, typecheck, 39 pruebas unitarias, build), eslint + tsc de `web/e2e-final` y `web/e2e`, `static-checks.mjs` |
| `test-output-final.txt` | Playwright `final` (T0 + golden + T1 + T2 + T3 + T4; perfiles P1, P2, P4): **202/202** + salida PASS de `preflight.mjs` |
| `test-output-legacy.txt` | Playwright `legacy` en sus dos invocaciones: **8/8** y **2/2** |
| `golden-comparison.txt` | REC-02: S1…S7 contra `../f0ed4bc/network-golden.json` |
| `network-traces.json` | trazas no-GET normalizadas de este SHA |
| `metrics.json` | geometría/estilos, orden de tabulación, contraste, reflow, lado a lado, [I] (claves `W08-*`, `W09-*`, `W13-*`, `WF-T4 [I] *`) |
| `captures-manifest.tsv` | capturas (PNG en `captures/`, no versionadas) con sha256 y referencia aprobada |
| `scope-sweeps.txt` | barridos SC-01…04, FN-09, FN-16, REC-04 |

EV-03: el barrido sobre esta carpeta (sin `captures/`) sólo coincide en líneas de `captures-manifest.tsv` cuyo **sha256 de un
PNG** contiene ≥ 18 dígitos seguidos (como en WF-T1…T3). Las pruebas [I] comparan cuerpos sin CLABE; el código de demostración
sólo se teclea en la página y nunca se imprime.

Pruebas nuevas: `web/e2e-final/t4-transfer.spec.ts` ([F], 47 pruebas), `web/e2e-final/t4-integration.spec.ts` ([I] P1, P2, P4),
`web/tests/transfer-form.test.ts` (5 unitarias). Código nuevo: `web/src/transfer-form.ts` (lógica pura BigInt/política/identidad),
W08/W09/W13 en `web/src/transfers.tsx`, estilos `tf-*`/`tr-*`/`rj-*` en `web/src/style.css`, iconos en `web/src/icons.tsx`.

## Criterios de WF-T4

| Criterio | Estado | Cómo / dónde (`metrics.json` / prueba) |
|---|---|---|
| W08-V1 migas, h1 30/38 (24/32 a 390), subtítulo, 2 columnas ≈ 2/3 + 1/3 a ≥ 1024 (apilado < 1024) | PASS | «W08-V1…V4» ×4 → `W08-V1-V4 *` (`layout`) |
| W08-V2 secciones label-caps 1–6, tarjeta `#f1f3ff` con tile `#0037b0`, `•••• NNNN`, saldo; segmentado con iconos; destinatario con avatar `#006d40`, chip alias, «Cuenta •••• NNNN» | PASS | ídem |
| W08-V3 «Disponible hoy … (demostración)» de la política, campo 56 con `$` y «MXN», `n / 40`, «Hasta 7 dígitos», 2 columnas ≥ 640, «Continuar a revisión →» primario ancho + «Cancelar» secundario | PASS | ídem |
| W08-V4 «Resumen previo»: monto, saldo proyectado, barra y «Representa el X %» BigInt (88.4 % para 6,495.00 / 7,345.00) | PASS | ídem (`.tf-bar` 88.42 %) |
| W08-V5 entre mis cuentas: «N cuenta(s) disponible(s)», tarjetas radio, origen deshabilitado con «Origen actual» y razón, «Resumen proyectado» con saldos finales | PASS | «W08-V5» ×4 |
| W08-V6 errores: banner `#ffdad6` + «3 errores detectados», etiquetas `#ba1a1a` con `*`, campos `#fff5f4` + anillo, mensajes; se limpian al corregir (3 → 2 → 1 → sin banner); sin petición | PASS | «W08-V6» ×4 |
| W08-V7 sin beneficiarios (panel, «+ Agregar nuevo beneficiario», «Transferir a cuenta propia» sólo con ≥ 2 cuentas, «Para: Sin seleccionar», «Continuar» deshabilitado con razón) | PASS | «W08-V7» ×4 + «una sola cuenta» |
| W08-V8 sin segunda cuenta propia (panel, «Transferir a un beneficiario», «Continuar» deshabilitado con razón) | PASS | «W08-V8» ×4; `[I]` P2 «I-W08-9» |
| W08-F1 preselección `?source=`, `?beneficiaryId=`, `?type=own_account`; radiogroups con flechas/Espacio/Enter | PASS | «W08-F1…F3» |
| W08-F2 / FN-06 / FN-07 (rechazos sin petición; `10`/`10.5`/`10.50` → `1000`/`1050`/`1050`; valores conservados entre pestañas, al volver de W09 y de W13) | PASS | «W08-F2», «W09-V1…V5» (Modificar datos), «W13-V1/V2» (Modificar monto); unitarias |
| W08-F3 / D-7 / FN-05 (identidad: beneficiario con la CLABE del origen deshabilitado con razón; con el otro origen, 201) | PASS | «W08-F1…F3»; `[I]` P1 `FN-05` |
| W08-F4 / D-5 (importe > saldo pasa a W09) | PASS | «W08-F4» |
| W09-V1…V5 normal (migas + 2 barras, eyebrow, h1, tarjeta 760, banner, monto display, chip, partes, concepto/referencia con iconos, fórmula, pie) | PASS | «W09-V1…V5» ×4 |
| W09-V6 requiere código (8/4, tarjeta lateral con umbral de la política y «demostración», «Continuar a verificación →», «Modificar datos») | PASS | «W09-V6» ×4 |
| W09-V7 propias (stepper, banner + «Paso 2 de 2», desglose, flujo, proyección Cargo/Abono, «Resumen») y F-W09-4 | PASS | «W09-V7» ×4, «F-W09-4» |
| W09-F2 / D-6 (sólo la política; política caída → texto neutro y «Confirmar transferencia»; 202 sin predicción → W10; 201 con predicción → W12; SC-05) | PASS | «W09-F2» |
| W09-F3 «Modificar datos» → W08 con todo, sin escritura | PASS | «W09-V1…V5» |
| W09-F1 / FN-08 / FN-15 | PASS | «W09-F1 FN-15 [F]» y `[I]` P1 (doble clic = 1 POST; cuerpo = revisión = captura) |
| W13-V1/V2/V5 saldo (icono, h1, alerta, desglose con saldo de `GET /accounts` posterior, «Faltan», «Intacto», acciones) | PASS | «W13-V1/V2/V5» ×4; `[I]` P2 |
| W13-V3/V4 límite (chip, h1, «Rechazo confirmado…», desglose con cifras de la política, barra, «Cargo aplicado $0.00 MXN (sin débito)», zona de negocio) | PASS | «W13-V3/V4/V5» ×4; `[I]` P4 |
| W13-F1 «Modificar monto» → W08 con todos los campos y foco en el importe; sin política → sólo mensaje; F-W13-3 en confirm | PASS | «W13-V1/V2/V5», «F-W13-4», «F-W13-3» |
| W13: «sin cargo» sólo con 422/429 del servidor; otro 422 → aviso genérico; error de red → W11 | PASS | «F-W13-4» |
| FN-03, FN-04, FN-05, FN-08, FN-10, FN-15 `[I]` P1; FN-11 `[I]` P2 (422) y P4 (429) sin cambio de saldo | PASS | `WF-T4 [I] P1/P2/P4` |
| FN-09 (sin `parseFloat`/`toFixed`/`Number(` ni «MXN MXN»), FN-16 (sin literales de política) | PASS | `scope-sweeps.txt` |
| RESP-01/02/04, A11Y-01 (orden = `actions-inventory.md`), 02, 03, 04, 05, 06, 07, 08, 09 en W08/W09/W13 | PASS | `responsive`/`a11y` en cada métrica; «W08/W09 A11Y-05/06» |
| FONT-04 / FN-17 | PASS | `watch()` en cada prueba (sólo fallos provocados: 422/429/503/abort) |
| REC-02 traza dorada | PASS (idéntica) | `golden-comparison.txt` |
| REC-01, REC-08, TOK-01, SC-03, ENV-02, FN-18 | PASS | `checks-output.txt` |
| T0…T3 + golden siguen verdes; legacy | PASS | `test-output-final.txt` 202/202; `test-output-legacy.txt` 8/8 + 2/2 |
| W08-VZ, W09-VZ, W13-VZ lado a lado | Para el Evaluador | `W08-*-sbs.png`, `W09-normal/codigo-sbs.png`, `W09-propias-sbs.png` (HTML sin red), `W13-*-sbs.png` |

`[P]`: ninguno visible (sin UI 0.4.0).

## Comparaciones lado a lado

Referencia a la izquierda, producto a R (1280 × alto/1.25 @1.25) a la derecha; `differentPixelRatio` informativo: W08 base 0.124,
propias 0.141, errores 0.228, sin beneficiarios 0.152, sin segunda cuenta 0.146; W09 normal 0.069, código 0.172; W13 saldo 0.080,
límite 0.132. Las cifras altas de W08 variantes/W09 código vienen de las familias distintas de esas variantes y de lo retirado
por claims (E-G6); detalle en `docs/web-fidelity-final/EXCEPTIONS.md` (WF-T4). Además se revisaron recortes a resolución nativa.

## Diferencias corregidas (antes → después)

| Pantalla | Antes (`610e9cb`) | Después (`8ab4b86`) |
|---|---|---|
| W08 | «Nueva transferencia» con selects, sin numeración, resumen con «Saldos disponibles actuales», error único en un `Notice` | estructura aprobada 1–6, tarjetas + radiogroups, «Disponible hoy» de la política, «Resumen previo»/«Resumen proyectado», errores por campo con banner y conteo, estados sin beneficiarios / sin segunda cuenta, identidad D-7 |
| W08 (iteraciones) | estilos heredados de `.transfer-form` (marco anidado); contenido 32 px arriba de la referencia; nombres truncados en tarjetas deshabilitadas; acciones apiladas en el vacío; encabezados de campo que se partían en errores; foco por `requestAnimationFrame` que podía dejar texto en otro campo | reset del formulario; `padding-top` 32; razón en su propia línea; botones en fila; cabeceras con salto controlado; foco tras el commit de React |
| W09 | lista «Confirma los datos» dentro del formulario | vistas normal (760), código (8/4) y propias; posición vertical como cada referencia (código +8, propias +16) |
| W13 | panel genérico «Transferencia no realizada» | vistas aprobadas de saldo y límite con cifras reales |
| W11/W12 | `$1.23 MXN MXN` | `$1.23 MXN` (FN-09) |

## Bloqueos y avisos

- **Tipos compartidos 0.4.0 en el checkout principal**: `node_modules` del worktree es symlink al checkout principal, cuyo
  `packages/shared/src/generated` pasó a OpenAPI 0.4.0 el 2026-11-17 a las 12:26 (fast-forward ajeno). `validation.ts` y
  `money.ts` no cambiaron (runtime idéntico); la Web compila (FN-18 verde), pero `npx tsc -p web/e2e-final/tsconfig.json`
  falla sólo en `fixtures/data.ts` (`TransferPolicy.sendEpoch` requerido en 0.4.0). No se adaptó: esta ronda es 0.3.0 y 0.4.0
  es `[P]`. Requiere decisión del coordinador (DEP-7).
- H-W1…H-W5 siguen escalados sin cambios (`ESCALATIONS.md`).

## Reproducir

Desde la raíz del worktree, `commands.txt`: `make-env` → `db-up` → Playwright con `WF_EVIDENCE_SHA=8ab4b86
WF_PROFILES=P1,P2,P4` (`final`) y las dos invocaciones `legacy` → `db-down`. Las capturas se regeneran en `captures/`.
