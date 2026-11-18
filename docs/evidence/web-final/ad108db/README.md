# Evidencia WF-T1 · Acceso (W01, W02, W14, NotFound) · código `ad108db`

Rama `feature/web-fidelity-final`, base `f0ed4bc`. Evidencia del Generator de la tanda WF-T1. **No es aceptación
final**: la evaluación la hace el Evaluador (`docs/evidence/web-final/eval-<sha>/` y
`docs/web-fidelity-final/FINDINGS.md`). `web/src` en `ad108db` es idéntico al de `4eb397e` (el último commit sólo
renombra títulos de prueba para EV-03).

| Archivo | Contenido |
|---|---|
| `commands.txt` | comandos exactos (sin `npm ci/install`, sin suites raíz `test:e2e`/`test:visual`) |
| `env-01-disk.txt` | `df -h` + `docker system df` antes del volumen (4.65 GiB libres ≥ 2.5) y log de `db-up.mjs` |
| `env-summary.txt` | versiones, perfiles P1/P2, contenedor propio en `127.0.0.1:55433`, puertos libres al terminar (sin secretos) |
| `env-06-cleanup.txt` | `db-down.mjs`: contenedor y volumen propios eliminados; disco después |
| `checks-output.txt` | FN-18 (lint, typecheck, 28 unit tests, build), eslint + tsc de `web/e2e-final`, `static-checks.mjs` |
| `test-output-final.txt` | Playwright `final` (T0 + golden + T1) con P1,P2: **50/50** + salida PASS de `preflight.mjs` |
| `test-output-legacy.txt` | Playwright `legacy` en sus dos invocaciones: **8/8** y **2/2** |
| `golden-comparison.txt` | REC-02: S1…S7 **idénticos** a `../f0ed4bc/network-golden.json` (sin delta D-12) |
| `network-traces.json` | trazas no-GET normalizadas de este SHA |
| `metrics.json` | geometría/estilos, orden de tabulación, contraste, reflow, D-11, [I] |
| `captures-manifest.tsv` | 56 capturas (PNG en `captures/`, no versionadas) con sha256 y referencia aprobada |
| `scope-sweeps.txt` | barridos informativos SC-01…04 y `parseFloat|toFixed` (el barrido formal es WF-T6) |

EV-03: `rg -n "Bearer |[0-9]{18}|demoOnlyCode|Idempotency-Key: [0-9a-f-]{36}|password"` sobre esta carpeta
(sin `captures/`) da una única coincidencia: la línea 44 de `captures-manifest.tsv`, cuyo **sha256 hexadecimal de
un PNG** contiene 21 dígitos decimales seguidos. No es una CLABE ni un secreto. No hay contraseñas, tokens,
cookies, OTP ni claves de idempotencia en la evidencia.

## Criterios de WF-T1

| Criterio | Estado | Cómo / dónde |
|---|---|---|
| W01-V1 lienzo, marca, tarjeta 440/16/32 | PASS | `t1-access.spec.ts` «W01-V1…V4» → `metrics.json` `W01-V1-V4 R` |
| W01-V2 h1 24/700, subtítulo 14/400 `#434655` | PASS | ídem |
| W01-V3 etiquetas 12/600, input 44/10/`#e2e8f0`, icono 20, ojo | PASS | ídem (iconos outlined) |
| W01-V4 botón 44/10 + flecha, separador, «Regístrate aquí» 14/600 | PASS | ídem |
| W01-F1 ojo: `type`, `aria-pressed`, «Mostrar/Ocultar contraseña» | PASS | «W01-F1» |
| W01-F2 vacío sin petición; enviando deshabilitado + spinner + `role=status` | PASS | «W01-F2» (R y 390) |
| W01-F3 401 / 429 / sin conexión distintos; email conservado | PASS | «W01-F3» (R y 390) |
| W01-F4 `[I]` login real P1 → `/accounts` | PASS | «[I] W01-F4 + I-W14-6» |
| W01-VZ lado a lado | Para el Evaluador | `W01-listo-sbs.png`; `W01-listo-sbs-970.png` prueba que la diferencia vertical es la altura de captura de la referencia (`EXCEPTIONS.md`) |
| W02-V1 marca, tarjeta 440/16/32, título headline-md centrado + subtítulo | PASS | «W02-V1…V3» |
| W02-V2 orden de campos, ojos, input 44/10, ayuda en `aria-describedby` | PASS | ídem |
| W02-V3 «Crear cuenta» ancho completo; pie «Inicia sesión» | PASS | ídem |
| W02-F1 confirmación distinta sin petición; cuerpo = 3 campos | PASS | «W02-F1» |
| W02-F2 409 con `detail`; nombre/correo conservados; contraseñas vacías | PASS | «W02-F2» (R y 390) |
| W02-F3 `[I]` P2 → 1 cuenta `$0.00 MXN`; P1 → 2 cuentas | PASS | «[I] W02-F3 P1/P2» |
| W02-VZ lado a lado | Para el Evaluador | `W02-listo-sbs.png` |
| W14-V1 lienzo `#f9f9ff`, marca centrada, tarjeta radio 12 | PASS con discrepancia | Implementado según la referencia: tile 32, 16/24/500, columna 448, tarjeta 400, padding 24. Los números literales del SPEC (tile 40, 18/500, tarjeta 448, padding 32) son píxeles del PNG; ver `EXCEPTIONS.md` |
| W14-V2 lock_clock en círculo, título, texto, botón «Iniciar sesión →» | PASS con discrepancia | círculo 64 CSS (= 80 px del PNG) |
| W14-V3 bloque `#f1f3ff` en la misma tarjeta, botón «Iniciar sesión y retomar la verificación →» | PASS | «W14-V3» (4 viewports) |
| W14-V4 «Acceso no disponible», botón «← Volver al inicio» (`/accounts` con sesión, `/login` sin ella) | PASS | «W14-V1/V2/V4», «W14-F1» |
| W14-F1 `[F]` 403/404 por id → V4, registro byte a byte igual | PASS | «W14-F1» (`/accounts` 403, `/transfers/:id/status` 404, `/accounts/:id/movements` 404, `/transfers/:id/movement-receipt` 404) |
| W14-F1 `[I]` usuario B sobre recursos de A → V4 | PASS | «[I] W01-F4 + I-W14-6» |
| W14-F2 401 sin refresh conserva el registro y muestra V3; `state` de reanudación | PASS | «W14-F2», «W14-V3», `web/tests/auth.test.ts` |
| W14-VZ lado a lado (vencida, vencida con intento, acceso) | Para el Evaluador | `W14-vencida-sbs.png`, `W14-vencida-con-intento-sbs.png`, `W14-acceso-sbs.png` |
| NotFound con estilo V4 | PASS | «W14 vencida/acceso/no encontrada» |
| A11Y-01 orden de tabulación = inventario | PASS | `a11yBasics` en W01/W02 (4 viewports), W14 (3 estados × 4 viewports) |
| A11Y-02 anillo ≥2 px, ≥3:1 | PASS | ídem (`metrics.json` `tabOrder[].ratio`) |
| A11Y-03 nombres, `aria-invalid` + `aria-describedby`, `role=alert/status` | PASS | W01-F2/F3, W02-F1/F2 |
| A11Y-04 contraste de texto | PASS | `contrastFailures` en todos los estados capturados de W01/W02/W14 |
| A11Y-05 zoom 200 % y reflow 320 | PASS | «W01/W02 A11Y-05» (W14 cubierto a 390) |
| A11Y-06 textos largos | N/A en T1 | (W03/W04/W06/W08/W09/W12); el concepto de 24 caracteres en V3 no desborda |
| A11Y-07 botón deshabilitado con texto y `aria-describedby` | PASS | «Iniciando sesión…» / «Creando tu cuenta…» → `#login-status` / `#register-status` |
| A11Y-08 errores con icono y texto | PASS | W01-F2/F3 |
| A11Y-09 `lang="es"`, un `h1`, sin saltos | PASS | `a11yBasics` |
| RESP-01/02 a 1440, R, 768, 390 | PASS | todos los escenarios con captura |
| FONT-04 sólo orígenes Web/API | PASS | `watch()` en cada prueba T1 |
| FN-17 sin errores de consola | PASS | sólo fallos HTTP provocados por el escenario (401/403/404/409/429/sin conexión), listados en `metrics.json` (`provoked`) |
| REC-02 traza dorada | PASS (idéntica) | `golden-comparison.txt` |
| REC-03 W14 sin escrituras al montarse | PASS | sólo `POST /v1/auth/refresh` (hidratación) |
| SH-08 títulos (incl. tarjetas V4 en sitio) | PASS | T0 «SH-08» + «W14-F1» |
| FN-18, TOK-01, FONT-01/02, REC-01, REC-08, ENV-02, SC-03 | PASS | `checks-output.txt` |
| T0 (FONT, SH, RESP-01 `/accounts`) sigue verde | PASS | `test-output-final.txt` |

## Comparaciones lado a lado (abrir cada PNG)

Composición generada por `web/e2e-final/helpers/side-by-side.ts` (referencia aprobada a la izquierda, producto a
viewport R 1280×1024 @1.25 a la derecha), en `captures/`:

1. `W01-listo-sbs.png` — `w01_login_demostraci_n`
2. `W01-listo-sbs-970.png` — misma referencia, producto a 1280×970 @1.25 (altura con la que se capturó el PNG)
3. `W02-listo-sbs.png` — `w02_registro`
4. `W14-vencida-sbs.png` — `w14_sesi_n_vencida`
5. `W14-vencida-con-intento-sbs.png` — `w14_sesi_n_vencida` (V3 sin referencia propia)
6. `W14-acceso-sbs.png` — `w14_acceso_no_autorizado`

Además se revisaron recortes 1×/2× de tarjeta, marca e iconos (script `crop.py` en el scratchpad del Generator):
iconos outlined, peso de «Billetera MXN» en W14 y tipografía de W02 se corrigieron tras esa revisión
(«Diferencias corregidas» abajo). Estados sin referencia propia (errores, 401, 429, sin conexión, enviando, 409,
creando, 403/404, no encontrada) se capturan a R y 390 (`captures-manifest.tsv`).

## Diferencias corregidas (antes → después)

| Pantalla | Antes (`f0ed4bc`) | Después |
|---|---|---|
| W01 | marca dentro de la tarjeta «Billetera.», eyebrow «BIENVENIDO A BILLETERA», h2 «Qué gusto verte.» 32 px, campos 49 px sin iconos, «Regístrate», legal | marca 48 px sobre la tarjeta, h1 «Iniciar sesión», subtítulo, campos 44/10 con mail/lock outlined, ojo, botón 44/10, separador y «Regístrate aquí»; sin eyebrow ni legal |
| W01 | 401 de login mostraba «La sesión ya no está disponible…»; sin estado 429 propio | «Correo o contraseña incorrectos.», «Demasiados intentos…», «No fue posible conectar…» |
| W02 | «Empieza por aquí.», «Crea una contraseña» sin confirmación ni ojos | «Crea tu cuenta» + subtítulo, 4 campos con ojos, ayuda enlazada, «Inicia sesión» |
| W14 | vencida con `◷`; con intento: rail + topbar + 2 tarjetas y copia «consultará el mismo intento… evitar duplicados» (falsa, H-W1); acceso con `🔒` y enlace-marca «Billetera.» | una sola tarjeta con lock_clock outlined; V3 dentro de la tarjeta con importe, tipo, concepto y referencia; acceso con lock outlined y «Volver al inicio» con flecha |
| W14 | 401 sin refresh → login genérico; 403 → panel «Acceso no autorizado» dentro del shell; 404 por id → errores genéricos | `/session-expired`; tarjeta V4 en sitio (D-11) |
| Iconos | rellenos (Material Icons) | outlined, como Material Symbols FILL 0 de las referencias |
| W14 marca | «Billetera MXN» 16/600 | 16/500 (peso del PNG) |
| W02 | etiquetas 12/600 | 16/24/400 como el PNG (el SPEC no las fija) |

Excepciones justificadas: `docs/web-fidelity-final/EXCEPTIONS.md`. Dependencias: `DEPENDENCIES.md` (DEP-W1).

## Reproducir

Desde la raíz del worktree, `commands.txt` (y `docs/web-fidelity-final/ENVIRONMENT.md`): `make-env` → `db-up` →
Playwright con `WF_EVIDENCE_SHA=ad108db WF_PROFILES=P1,P2` (`final`) y las dos invocaciones `legacy` → `db-down`.
Las capturas se regeneran en `docs/evidence/web-final/ad108db/captures/`.
