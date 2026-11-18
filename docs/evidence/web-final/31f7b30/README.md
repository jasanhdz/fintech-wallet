# Evidencia WF-T2 · Inicio e historial (W03, W04, W05) · código `31f7b30`

Rama `feature/web-fidelity-final`, base `f0ed4bc`. Evidencia del Generator de la tanda WF-T2. **No es aceptación
final**: la evaluación la hace el Evaluador (`docs/evidence/web-final/eval-<sha>/` y `docs/web-fidelity-final/FINDINGS.md`).
El commit de esta carpeta sólo añade evidencia; el código evaluado es `31f7b30`.

| Archivo | Contenido |
|---|---|
| `commands.txt` | comandos exactos (sin `npm ci/install`, sin suites raíz `test:e2e`/`test:visual`) |
| `env-01-disk.txt` | `df -h` + `docker system df` antes del volumen (4.47 GiB libres ≥ 2.5) y salida de `db-up.mjs` |
| `env-summary.txt` | versiones, perfiles P1/P2, contenedor propio en `127.0.0.1:55433`, puertos de la ronda libres al terminar |
| `env-06-cleanup.txt` | `db-down.mjs`: contenedor y volumen propios eliminados; disco después (3.3 GiB) |
| `checks-output.txt` | FN-18 (lint, typecheck, 29 pruebas unitarias, build), eslint + tsc de `web/e2e-final` y `web/e2e`, `static-checks.mjs` (RESULT PASS) |
| `test-output-final.txt` | Playwright `final` (T0 + golden + T1 + T2, P1 y P2): **103/103** + salida PASS de `preflight.mjs` |
| `test-output-legacy.txt` | Playwright `legacy` en sus dos invocaciones: **8/8** y **2/2** |
| `golden-comparison.txt` | REC-02: S1…S7 **idénticos** a `../f0ed4bc/network-golden.json` (sin delta D-12) |
| `network-traces.json` | trazas no-GET normalizadas de este SHA |
| `metrics.json` | geometría/estilos, orden de tabulación, contraste, reflow, lado a lado, [I] |
| `captures-manifest.tsv` | 128 capturas (100 de W03/W04/W05; PNG en `captures/`, no versionadas) con sha256 y referencia aprobada |
| `scope-sweeps.txt` | barridos informativos SC-01…04, FN-09, FN-16, REC-04 y EV-03 |

EV-03: el barrido sobre esta carpeta (sin `captures/`) sólo coincide en dos líneas de `captures-manifest.tsv` cuyo
**sha256 hexadecimal de un PNG** contiene ≥ 18 dígitos decimales seguidos (como en WF-T1). No hay contraseñas, tokens,
cookies, OTP, CLABE completas ni claves de idempotencia; los usuarios [I] son sintéticos y sus correos no se registran.

Pruebas nuevas: `web/e2e-final/t2-home-history.spec.ts` ([F], API simulada), `web/e2e-final/t2-integration.spec.ts`
([I] P1 y P2), `web/e2e-final/helpers/screen.ts`. Unitarias: `web/tests/movements.test.ts` (D-4, acumulación, error de
página siguiente, panel D-10) y `web/tests/recent-activity.test.ts`.

## Criterios de WF-T2

| Criterio | Estado | Cómo / dónde (`metrics.json` / prueba) |
|---|---|---|
| W03-V1 cabecera (eyebrow label-caps 0.44 px, h1 30/38/600 y 24/32 a 390, calendario + fecha larga, tarjeta «SALDO CONSOLIDADO» con tile, 20/28/600 + «MXN» 12/500) | PASS | «W03-V1…V4 con saldo» ×4 viewports → `W03-V1-V4 *` |
| W03-V2 grid 2/1 columnas gap 24, radio 16, padding 24, barra 4 px `#0037b0` sólo en la 1.ª, chip con punto, `•••• NNNN` 13 px, «SALDO DISPONIBLE», 40/600 (32 a 390) + «MXN» 16/500 `#434655`, separador y CTA a lo ancho | PASS | ídem |
| W03-V3 «Transferir» → `?source=`; «Mover entre mis cuentas» → `?type=own_account&source=`; primario/secundario TOK-03 | PASS | ídem |
| W03-V4 «Actividad Reciente» 20/28/600 + chip + enlace; cabecera label-caps sobre `#f1f3ff`; contraparte, `•••• NNNN · fecha`, «Ref: N», chip, `−/+`, abono `#006d40`; pie | PASS | ídem; filas apiladas con etiqueta a < 768 (RESP-03) |
| W03-V5 sin saldo (banner, columnas, «1 CUENTA ACTIVA», «0 Registros», vacío, «Transferir» deshabilitado con razón visible enlazada) | PASS | «W03-V5 sin saldo» ×4; `[I]` P2 «W03-V5 [I]» |
| W03-V6 aviso (ancho completo sobre las cuentas, borde 4 px `#7a2b00`, tile sync_problem `#ffdbcd`, título + chip «EN VERIFICACIÓN», importe y tipo, interrupción, CTA a la derecha a ≥ 1024) | PASS | «W03-V6/F1» ×2 variantes ×4 viewports |
| W03-F1 «Retomar verificación» (+ «Se repetirá la misma solicitud con su misma clave de operación.») / «Consultar estado»; montar W03 no emite escrituras ni muestra la clave | PASS | tras el clic: sin `transferId` → un `POST /v1/transfers` con la **misma** clave y cuerpo; con `transferId` → sólo `GET` |
| W03-F2 cargando `aria-busy`; error de cuentas con reintento; error de actividad conserva cuentas | PASS | «W03-F2» (R y 390) |
| W03-F3 `[I]` saldos y actividad tras transferencias; aviso tras respuesta perdida real | PASS | «WF-T2 [I] P1»: suma bigint = API; I-W03-10: aviso «$0.47 MXN (Entre mis cuentas)», retomar → 201 reproducido, un solo débito |
| W03-VZ lado a lado (corregido, sin saldo, pendiente) | Para el Evaluador | `W03-con-saldo-sbs.png`, `W03-sin-saldo-sbs.png`, `W03-pendiente-sin-transferId-sbs.png`, `W03-pendiente-con-transferId-sbs.png` |
| W04-V1 h1 + selector «CUENTA ACTIVA» `(•••• NNNN)` + chevron | PASS | «W04-V1…V4» ×4 |
| W04-V2 segmentado (activo blanco sobre `#f1f3ff`), Desde/Hasta `type=date` con calendario, «Limpiar filtros» | PASS | ídem |
| W04-V3 seis columnas label-caps, filas ≥ 52, fecha + hora, icono cargo/abono, contraparte, «Ref. N», chip, importe, «Ver detalle» `#0037b0`; ACCIÓN completa a R | PASS | ídem (`row`, `action`) |
| W04-V4 «Cargar más movimientos» secundario centrado + «Mostrando N movimientos» | PASS | ídem |
| W04-V5 cargando (4 filas skeleton, tarjeta `role=status`, barra) sin animación con movimiento reducido | PASS | «W04-V5 cargando» ×4 (A11Y-10) |
| W04-V6 vacío sin filtros (fechas ocultas, segmentado) | PASS | «W04-V6» ×4 |
| W04-V7 sin resultados + «Restablecer búsqueda» | PASS | «W04-V7» ×4 |
| W04-V8 error al cargar más (banner `#ffdad6`, sync_problem, textos, «Reintentar» primario) | PASS | «W04-V8/F1» ×4 |
| W04-F1 acumulación sin duplicados; error en página 2 conserva 20 y «Reintentar» añade | PASS `[F]` y `[I]` | `[F]` 20 → 25; `[I]` 20 → 22 ids únicos, orden de la API |
| W04-F2 `type=credit/debit`; Limpiar/Restablecer quitan `from,to,type,cursor`; cambiar filtros reinicia | PASS | «W04-F2», «W04-V7» |
| W04-F3 día de negocio | PASS `[F]` borde 23:30/00:30; `[I]` día real | `[I]`: el día de negocio del movimiento más reciente lo incluye y el día anterior da «sin resultados» (no se puede forzar 23:30 con la API real; SPEC (e)) |
| W04-F4 selector sólo con cuentas de `GET /accounts` y navegación | PASS | «W04-F4…F5» |
| W04-F5 propio → W05; tercero → panel `aria-expanded` sin `GET /transfers` | PASS `[F]` y `[I]` | ídem + `[I]` |
| W04-F6 error inicial con «Intentar de nuevo»; 404/403 → W14 | PASS | «W04-F6» |
| W04-VZ lado a lado de los 5 estados | Para el Evaluador | `W04-con-movimientos-sbs.png`, `W04-cargando-sbs.png`, `W04-vacio-sbs.png`, `W04-sin-resultados-sbs.png`, `W04-error-cargar-mas-sbs.png`, `W04-error-cargar-mas-banner-sbs.png` |
| W05-V1 atrás 40 `aria-label`, «FOLIO INTERNO • folio», h1 20/28/600, ancho ≤ 768, navegación activa Movimientos | PASS | «W05-V1…V5» (6 capturas) |
| W05-V2…V5 estado, panel de monto y folio, partes «Cuenta Billetera (•••• NNNN)» + «Tipo de abono», detalle (Fecha y hora, Concepto, Referencia numérica), «Volver a Movimientos» / «Ir a Inicio» | PASS | ídem; beneficiario y entre cuentas propias |
| W05-F1 `[I]` datos = `GET /transfers/{id}` de la fila; volver a la cuenta | PASS | «WF-T2 [I] P1» (FN-13) |
| W05-F2 error con reintento; 404/403 → W14 con registro intacto | PASS | «W05-F2» |
| W05-VZ | Para el Evaluador | `W05-beneficiario-sbs.png` |
| REC-03 W03 sin escrituras al montar, sin clave en el DOM | PASS | «W03-V6/F1» |
| REC-04 404 no borra el registro; Movimientos no resuelve intentos | PASS | «REC-04» + I-W03-10 (el movimiento ya aparece en la actividad y el aviso sigue hasta retomar) |
| REC-01 sólo el accesor read-only | PASS | `checks-output.txt` (`readActiveTransferContext`, sin líneas eliminadas) |
| REC-02 traza dorada | PASS (idéntica) | `golden-comparison.txt` |
| FN-12 `[I]` | PASS | «Ver movimientos» en W12 → 1.ª fila «Prueba FN-12 · Ref. 1212 · −$0.33 MXN» |
| FN-13 `[I]` | PASS | `GET /v1/transfers/{transferId de la fila}`, importe/concepto/referencia iguales |
| A11Y-01/02/04/09 en todos los estados capturados | PASS | `a11y` en cada métrica (inventario = `actions-inventory.md`) |
| A11Y-05/06 W03 y W04 | PASS | «W03/W04 A11Y-05/06» |
| A11Y-07/08/10 | PASS | botón sin saldo con razón; `−/+`, chips con texto, iconos con texto; sin animaciones |
| RESP-01/02/03 a 1440, R, 768, 390 | PASS | `responsive` en cada métrica |
| FONT-04 / FN-17 | PASS | `watch()` en cada prueba (sólo fallos HTTP provocados) |
| FN-18, TOK-01, SC-03, REC-08, ENV-02 | PASS | `checks-output.txt` |
| FN-09, FN-16, SC-02, SC-04 | PASS (informativo) | `scope-sweeps.txt`; SC-01 sólo conserva el «CEP» del descargo de W12 (`transfers.tsx`, desde `f0ed4bc`, WF-T5) |
| T0 + T1 + golden siguen verdes | PASS | `test-output-final.txt` 103/103 |

## Comparaciones lado a lado (abrir cada PNG en `captures/`)

Referencia aprobada a la izquierda, producto a viewport R a la derecha (W03 corregido 1280×1030 @1.25; sin saldo,
W04 y W05 1280×1024 @1.25; pendiente 1280×1124 @2). Además se revisaron recortes a resolución nativa de cabecera,
tarjetas, actividad, aviso, tarjeta sin saldo y banner (script `crop.py` del scratchpad del Generator).

## Diferencias corregidas (antes → después)

| Pantalla | Antes (`f0ed4bc`) | Después (`31f7b30`) |
|---|---|---|
| W03 | «RESUMEN», «Hola, … ✦», botón «Transferir →» suelto, bloque «Saldo consolidado» degradado, tarjetas con `◌/↗`, «Ver movimientos de …», tabla Concepto/Fecha/Tipo/Estado/Importe, banner «Tus cuentas, siempre a la vista» | cabecera aprobada con fecha de negocio y tarjeta de saldo consolidado; tarjetas con barra, chip, `•••• NNNN`, 40/600 y CTA; tabla Detalle/Concepto & Referencia/Estado/Monto con contraparte; pie; sin banner genérico |
| W03 (iteraciones) | etiqueta móvil «Concepto» visible en escritorio; hueco del sufijo «MXN» de 11 px; botón sin saldo con icono en otra línea (87 px); hueco nombre→saldo 32 px | etiquetas sólo < 768; espacio dentro del sufijo (4 px como la referencia); icono en línea (60 px); 24 px como la referencia; 1.ª fila con el tinte de la referencia |
| W03 | sin estado sin saldo ni aviso pendiente | V5 y V6 |
| W04 | «Movimientos», filtros con `select` Tipo, paginación que reemplazaba la página, «Sin movimientos» único, error que ocultaba filas, «Ver detalle»/«Sin comprobante» | h1 + selector de cuenta, segmentado, fechas de día de negocio, acumulación, 5 estados aprobados, panel para terceros |
| W04 (iteraciones) | tabla desbordaba a 1024–1279 y con textos largos; cabecera `sr-only` contaba como desborde; icono de calendario tapado por el campo; foco del campo de fecha sin anillo propio; reintento no visible porque la consulta reintenta 1 vez | `table-layout: fixed` a ≥ 1280 y filas apiladas por debajo; `thead` oculto al apilar; icono sobre el campo; anillo 2 px en el campo; pruebas con dos fallos |
| W05 | «← Volver a mis cuentas», «Comprobante interno», tarjeta genérica, «Actualizar estado», descargo con «CEP» | cabecera con atrás + folio + h1, estado con chip, panel de monto/folio, partes, detalle y pie «Volver a Movimientos» / «Ir a Inicio»; descargo sin CEP |
| Shell | etiquetas de la barra inferior recortadas a 320 px sin valor accesible | `title` con el valor completo |

Excepciones justificadas y discrepancias SPEC↔referencia: `docs/web-fidelity-final/EXCEPTIONS.md` (sección WF-T2).

## Reproducir

Desde la raíz del worktree, `commands.txt`: `make-env` → `db-up` → Playwright con `WF_EVIDENCE_SHA=31f7b30
WF_PROFILES=P1,P2` (`final`) y las dos invocaciones `legacy` → `db-down`. Las capturas se regeneran en
`docs/evidence/web-final/31f7b30/captures/`.
