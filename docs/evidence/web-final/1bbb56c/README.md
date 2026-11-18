# Evidencia WF-T3 · Beneficiarios (W06, W07) · código `1bbb56c`

Rama `feature/web-fidelity-final`, base `f0ed4bc`. Evidencia del Generator de la tanda WF-T3. **No es aceptación
final**: la evaluación la hace el Evaluador (`docs/evidence/web-final/eval-<sha>/` y `docs/web-fidelity-final/FINDINGS.md`).
El commit de esta carpeta sólo añade evidencia; el código evaluado es `1bbb56c`.

| Archivo | Contenido |
|---|---|
| `commands.txt` | comandos exactos (sin `npm ci/install`, sin suites raíz `test:e2e`/`test:visual`) |
| `env-01-disk.txt` | `df -h` + `docker system df` antes del volumen (3.25 GiB libres ≥ 2.5) y salida de `db-up.mjs` |
| `env-summary.txt` | versiones, perfiles P1/P2, contenedor propio en `127.0.0.1:55433`, puertos de la ronda libres al terminar |
| `env-06-cleanup.txt` | `db-down.mjs`: contenedor y volumen propios eliminados; `web/dist` y capturas `wip` borradas; disco después (3.1 GiB) |
| `checks-output.txt` | FN-18 (lint, typecheck, 34 pruebas unitarias, build), eslint + tsc de `web/e2e-final` y `web/e2e`, `static-checks.mjs` (RESULT PASS) |
| `test-output-final.txt` | Playwright `final` (T0 + golden + T1 + T2 + T3, P1 y P2): **149/149** + salida PASS de `preflight.mjs` |
| `test-output-legacy.txt` | Playwright `legacy` en sus dos invocaciones: **8/8** y **2/2** |
| `golden-comparison.txt` | REC-02: S1…S7 **idénticos** a `../f0ed4bc/network-golden.json` (sin delta D-12) |
| `network-traces.json` | trazas no-GET normalizadas de este SHA |
| `metrics.json` | geometría/estilos, orden de tabulación, contraste, reflow, lado a lado, [I] (claves `W06-*`, `W07 *`, `WF-T3 [I] FN-02`) |
| `captures-manifest.tsv` | 191 capturas (68 de W06/W07, incluidas 4 [I]; PNG en `captures/`, no versionadas) con sha256 y referencia aprobada |
| `scope-sweeps.txt` | barridos informativos SC-01…04, FN-09, FN-16, REC-04 |

EV-03: el barrido sobre esta carpeta (sin `captures/`) sólo coincide en dos líneas de `captures-manifest.tsv` cuyo **sha256
hexadecimal de un PNG** contiene ≥ 18 dígitos decimales seguidos (como en WF-T1/T2). Las pruebas [I] comparan la CLABE
real sólo como booleano y los cuerpos [F] por SHA-256, así que ninguna salida contiene una CLABE completa. Las capturas PNG
(no versionadas) muestran en el campo de W07 las CLABE sintéticas generadas por la prueba, como las escribiría el usuario;
W06 sólo muestra `•••• NNNN`.

Pruebas nuevas: `web/e2e-final/t3-beneficiaries.spec.ts` ([F], 45 pruebas), `web/e2e-final/t3-integration.spec.ts` ([I] P1),
`web/tests/beneficiaries.test.ts` (5 unitarias). Helpers: `composeSideBySideHtml`/`sideBySideHtml` (variantes sin PNG) y
espera de transiciones CSS en `tabOrder`/`a11yBasics` (ver `DEPENDENCIES.md` WF-T3).

## Criterios de WF-T3

| Criterio | Estado | Cómo / dónde (`metrics.json` / prueba) |
|---|---|---|
| W06-V1 h1 «Mis beneficiarios» 30/38/600 (24/32 a 390) + subtítulo; buscador con icono search, placeholder «Buscar por nombre o alias…», etiqueta accesible «Buscar beneficiarios»; «+ Agregar beneficiario» primario TOK-03 en la misma fila (apilado < 640) | PASS | «W06-V1/V2/F1 lista» ×4 viewports → `W06-V1-V2-F1 *` |
| W06-V2 grid 2 columnas ≥ 1024 gap 24 (1 < 1024; 1 resultado = 100 % ≥ 85 %); tarjeta blanca radio 12 sombra de tarjeta; avatar 48 (60 PNG ÷ 1.25) `#e9edff` con iniciales; nombre 20/28/600; chip «Alias: …» 9999 neutro; panel `#f9f9ff` «Cuenta destino Billetera MXN» + `•••• NNNN` 13 px tabular; «Transferir →» contorno azul a lo ancho, 44 | PASS | ídem (`cards`, `search.singleWidthRatio`) |
| W06-V3 vacío (tarjeta centrada, icono group en círculo 64, título, texto, «+ Agregar beneficiario»); buscador en la barra superior deshabilitado con razón visible enlazada | PASS | «W06-V3 vacío» ×4 |
| W06-V4 sin resultados (manage_search, título, «Limpiar búsqueda» que vacía y devuelve el foco) | PASS | «W06-V4 sin resultados» ×4 |
| W06-F1 búsqueda por nombre / alias (sin acentos ni mayúsculas) / últimos 4 sin peticiones; «Transferir» → `/transfers/new?beneficiaryId={id}` con el beneficiario preseleccionado en W08 | PASS | `W06-V1-V2-F1 *.search` (0 peticiones), «W06-F1 Transferir» (`select` de W08 = id), unitaria `filterBeneficiaries` |
| W06-F2 cargando (skeleton `aria-busy`, sin animación) y error con «Intentar de nuevo» que reintenta; 401 → W14 | PASS | «W06-F2» (R y 390); 401 → «Tu sesión venció» ya cubierto por `t1-access` «W14-F2» sobre `/beneficiaries` |
| W06-F3 `[I]` alta FN-02 visible con máscara y aviso «Beneficiario “{alias}” agregado.» | PASS | «WF-T3 [I] P1» (`WF-T3 [I] FN-02.created`) |
| W06-VZ lado a lado (lista, vacío) | Para el Evaluador | `W06-lista-sbs.png`, `W06-vacio-sbs.png` |
| W07-V1 migas «← Beneficiarios / Nuevo registro», eyebrow «REGISTRO DE CONTACTO» label-caps `#0037b0`, h1, subtítulo | PASS | «W07 idle» ×4 |
| W07-V2 tarjeta ≈ 8/12 (fórmula de la retícula ±2 px), banner «Solo se admiten cuentas de Billetera MXN.», campos y metas («Obligatorio», «Para identificarlo fácil», `n / 18`, «18 dígitos numéricos»), inputs del shell 44 / radio 8 / `#f1f3ff` | PASS | ídem (`geometry`) |
| W07-V3 «Cancelar» contorno + «Guardar beneficiario» primario con person_add a la derecha; ayuda `#e9edff` «¿Dónde obtener la CLABE interna?» con el texto de (e) | PASS | ídem |
| W07-V4 campos inválidos: banner `#ffdad6` + chip «N errores» real (3 → 2 al corregir), anillo 2 px `#ba1a1a`, icono y mensaje por campo, `aria-invalid` + `aria-describedby`, foco al primer error, sin petición | PASS | «W07 campos inválidos» ×4; unitaria «empty submit…» |
| W07-V5 CLABE incorrecta (18 dígitos, dígito verificador inválido con `isValidClabe`): banner, etiqueta `#ba1a1a`, contador chip error, mensaje, «Formato válido» en los otros, sin petición | PASS | «W07 CLABE incorrecta» ×4; `[I]` sin petición |
| W07-V6 duplicado (409): banner + «Cuenta ya registrada» + «Ver en directorio» / «Modificar datos» (enfoca la CLABE) | PASS | «W07 duplicado (409)» ×4, «W07-F1», `[I]` 409 real |
| W07-V7 destino no disponible (404): banner y textos del SPEC; CLABE marcada | PASS | «W07 destino no disponible (404)» ×4, `[I]` 404 real |
| W07-V8 guardando: botón deshabilitado con spinner «Guardando beneficiario…», campos `readonly`, formulario `aria-busy`, `role="status"` con el texto, razón enlazada en los dos botones deshabilitados, un solo POST | PASS | «W07 guardando» ×4 (POST retenido y liberado → 201 → aviso en W06) |
| W07-V9 error recuperable (5xx/red): banner y textos, valores conservados, «Reintentar guardar» primario | PASS | «W07 error recuperable (503)» ×4, «W07-F1» (503 → red abortada → 409) |
| W07-F1 sin petición con vacíos/dígito inválido; reintento = mismo cuerpo (SHA-256 idéntico ×3); «Modificar datos» → foco CLABE; «Ver en directorio» y «Cancelar» → `/beneficiaries` | PASS | «W07-F1», unitarias |
| W07-F2 / FN-02 `[I]` 201 con la CLABE real de otro usuario sintético → W06 con `•••• NNNN` (ni completa ni 3+4 en el DOM); repetir → 409 W07-V6; CLABE válida inexistente → 404 W07-V7; dígito inválido → W07-V5 sin petición; secuencia `[201, 409, 404]` | PASS | «WF-T3 [I] P1» (`WF-T3 [I] FN-02`) + capturas `I-W06-*`, `I-W07-*` |
| W07-VZ lado a lado (base PNG + 6 variantes contra su HTML sin red) | Para el Evaluador | `W07-base-sbs.png`, `W07-invalidos-sbs.png`, `W07-clabe-incorrecta-sbs.png`, `W07-duplicado-sbs.png`, `W07-destino-no-disponible-sbs.png`, `W07-guardando-sbs.png`, `W07-error-recuperable-sbs.png` |
| RESP-01/02 a 1440, R, 768, 390 en cada estado; RESP-04 (W07 apilado < 1024, principal primero en DOM y pantalla) | PASS | `responsive` en cada métrica; «W07 idle 768/390» |
| A11Y-01 (orden = `actions-inventory.md`), 02, 03, 04, 07, 08, 09, 10 en todos los estados capturados | PASS | `a11y` en cada métrica |
| A11Y-05 (zoom 200 % y 320) W06 (lista con textos largos, vacío) y W07 (base, inválidos); A11Y-06 W06 (nombre 120, alias 80: nombre con ajuste de línea, alias truncado con `title`) | PASS | «W06 A11Y-05/06», «W07 A11Y-05» |
| FONT-04 / FN-17 | PASS | `watch()` en cada prueba (sólo fallos HTTP provocados: 404/409/503 y la red abortada) |
| FN-14 (inventario) | PASS | cada acción de W06/W07 se activa en las pruebas; secuencias de tabulación = inventario |
| FN-18, TOK-01, SC-03, REC-01, REC-08, ENV-02 | PASS | `checks-output.txt` |
| REC-02 traza dorada | PASS (idéntica) | `golden-comparison.txt` |
| FN-09, FN-16, SC-01/02/04 | PASS (informativo) | `scope-sweeps.txt` (SC-01 sólo conserva el «CEP» del descargo de W12, WF-T5) |
| T0 + T1 + T2 + golden siguen verdes; legacy | PASS | `test-output-final.txt` 149/149; `test-output-legacy.txt` 8/8 + 2/2 |

`[P]`: ninguno en esta tanda («duplicado» y «destino no disponible» salen de respuestas reales del contrato 0.3.0).

## Comparaciones lado a lado

Referencia aprobada a la izquierda, producto a viewport R (1280×1024 @1.25) a la derecha. W06 usa el mismo sidebar de 288
que la referencia, así que la comparación es directa (`differentPixelRatio` informativo: lista 0.055, vacío 0.065); W07 base
0.062 con el desplazamiento E-G1. Las variantes de W07 sin PNG se comparan contra su `code.html` sin red (sin Tailwind ni
fuentes: estructura y copia, §5.11). Además se revisaron recortes a resolución nativa de encabezado, buscador, tarjetas,
formulario y estados (`crop.py` del scratchpad).

## Diferencias corregidas (antes → después)

| Pantalla | Antes (`eeafd2e`) | Después (`1bbb56c`) |
|---|---|---|
| W06 | eyebrow «DIRECTORIO», h1 «Beneficiarios», buscador sin icono con etiqueta visible, tarjetas con avatar de una letra, alias suelto, «CLABE · 646•••…1234» y badge «Cuenta interna» sin acción; vacío/sin resultados como `StatePanel` genérico | h1 «Mis beneficiarios» + subtítulo, fila buscador + «+ Agregar beneficiario», tarjetas aprobadas con «Transferir →» funcional, vacío con barra en tarjeta y buscador deshabilitado con razón, sin resultados con «Limpiar búsqueda» |
| W06 (iteraciones) | bordes `#dbe2f9`/`#c4c5d7` más azulados/oscuros que la referencia; icono group relleno; person_add con el «+» a la izquierda | bordes `outline-variant` al 50 % sobre blanco (≈ `#E5E7EB` de la referencia); group outlined con hueco (even-odd); person_add reflejado como el Material Symbol |
| W07 | «← Volver a beneficiarios», «NUEVO BENEFICIARIO», «Agregar beneficiario», campos «Nombre del beneficiario/Alias/CLABE interbancaria» con borde, vista previa lateral, `Notice` genérico para 409/404/5xx, «Guardando…» | migas, eyebrow, h1 y subtítulo aprobados; tarjeta 8/12 con banner informativo y ayuda 4/12; inputs del shell; seis estados con banner, marcas de campo y acciones propias |
| W07 (iteraciones) | metas «OBLIGATORIO»/«PARA IDENTIFICARLO FÁCIL» en mayúsculas (el PNG las pinta en minúsculas); contenido alineado a la izquierda a 1440; banner de error a 390 con el icono en una línea aparte; «Modificar datos» reenviaba el formulario (React reutilizaba el botón como `submit` en el mismo clic) | metas en tamaño label-caps sin mayúsculas (mayúsculas sólo en error, como la variante); centrado `max-w-5xl mx-auto`; banner en retícula icono + texto; acciones con `key` distintas: «Modificar datos» sólo desbloquea y enfoca la CLABE |
| Pruebas | — | helpers esperan las transiciones CSS antes de leer colores/anillos (falsos FAIL de A11Y-02/04 bajo carga) |

Excepciones justificadas y discrepancias SPEC↔referencia: `docs/web-fidelity-final/EXCEPTIONS.md` (sección WF-T3).

## Reproducir

Desde la raíz del worktree, `commands.txt`: `make-env` → `db-up` → Playwright con `WF_EVIDENCE_SHA=1bbb56c
WF_PROFILES=P1,P2` (`final`) y las dos invocaciones `legacy` → `db-down`. Las capturas se regeneran en
`docs/evidence/web-final/1bbb56c/captures/`.
