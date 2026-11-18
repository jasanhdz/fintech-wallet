# SPEC — Ronda Web «UX polish» · Billetera MXN

| Campo | Valor |
|---|---|
| Worktree | `/Users/jasanhernandez/Develop/fintech-wallet-web-final` |
| Rama | `feature/web-fidelity-final` (se continúa en la misma rama; commits con prefijo `UX-Tn:`) |
| SHA base | `0cf8257` |
| Contrato | OpenAPI 0.3.0 (sin cambios) |
| Autor | Planner (único archivo escrito: este) |
| Evaluaciones | máximo **3**; hallazgos en `docs/web-ux-polish/FINDINGS.md` (sólo el Evaluator) |

**Precedencia.** Este SPEC gobierna la ronda «UX polish» de la Web. **Sustituye la meta de fidelidad Stitch** de `docs/web-fidelity-final/SPEC.md` (que no se edita y queda congelado como historia): las referencias de `design/web` ya no mandan salvo en identidad visual (paleta y tokens de color, Inter, metáforas de iconos). Siguen vigentes de aquel SPEC, sin cambio: §4 (modelo de datos y registro local de intento), §5.4 sólo en lo relativo a **color**, §5.5 (Inter auto-hospedada), §5.6 (iconos SVG), §5.8 (etiquetado demo), §5.9 D-3…D-11 y D-13 (reglas de producto), §5.10 (entorno aislado), §7.3 completo (recuperación, REC-*, H-W*), SC-01…SC-05 y las decisiones del coordinador de `docs/web-fidelity-final/DECISIONS.md` y `ESCALATIONS.md` (D-12 diferido, H-W1…H-W6 abiertos). Donde este documento calla, aplican `AGENTS.md`, `docs/challenge.md`, `specs/requirements.md`. Nada de este SPEC cambia reglas financieras, umbral OTP, límites, claves de idempotencia, momentos de escritura/borrado del registro local ni el tráfico de escritura.

---

## 1. Objetivo

Que la app Web se vea cuidada y se use sin fricción —espaciado consistente en escala 4/8, jerarquía clara, alineación de bordes, chrome sin duplicados ni transparencias, formularios largos con errores visibles y acción primaria siempre alcanzable, accesibilidad WCAG 2.2 AA verificable— principalmente en escritorio (1280–1920) y correctamente en tablet y móvil (1024, 768, 390, 320), **sin cambiar la paleta ni ningún token de color**, sin tocar reglas financieras ni tráfico de red, con datos reales de la API y validando el flujo completo contra API + PostgreSQL reales. Antes de empezar se cierra la verificación en navegador pendiente de WF-T5 (W10/W11/W12).

## 2. Scope

### 2.1 Incluido
- Presentación, layout, espaciado, tipografía (sólo tamaños/pesos de la escala existente), estados vacíos/cargando/error, gestión de foco, anuncios accesibles y responsive de **todas** las pantallas Web W01–W14 y del shell autenticado.
- Tokens **no de color** nuevos en `web/src/style.css` (espaciado, radio `xs`, anchos de contenedor, alturas de chrome) y limpieza de CSS muerto heredado (líneas 10–212 de `style.css` en `0cf8257` con clases legadas `.topbar`, `.app-rail`, `.transfer-*`, `.receipt-card*`, etc.) cuando no tengan uso.
- Orden determinista de cuentas en cliente (`orderAccounts`, §4) y cuenta de origen por defecto = cuenta principal.
- Reubicación de componentes existentes (sin refactor general): shell, barra de acción pegajosa en móvil, resumen pegajoso en escritorio / colapsable en móvil, resumen de errores junto a la acción.
- Pruebas Playwright nuevas `web/e2e-final/ux-*.spec.ts`, helpers nuevos en `web/e2e-final/helpers/`, pruebas unitarias en `web/tests/`, ajustes de `web/e2e-final/playwright.config.ts` y scripts de `web/e2e-final/scripts/` (p. ej. lista de prohibidos de `preflight.mjs`).
- Actualización/retirada de aserciones de **geometría/estilo de fidelidad Stitch** de las suites `t0…t5` que contradigan este SPEC, registrándolas en `docs/web-ux-polish/SUPERSEDED.md` (§5.11).

### 2.2 Excluido (qué NO se toca) — respuesta a (d)
- **Colores**: ningún valor `--color-*` cambia, no se añaden colores (hex, `rgb()`, `rgba()`, `hsl()`, `color-mix()` nuevos) ni se cambia `theme-color`. Sólo se permite **reasignar tokens existentes** a texto secundario/placeholder o bordes cuando una medición de contraste falla (§5.8).
- **Tráfico de red**: ninguna petición de escritura nueva, eliminada, reordenada o con cuerpo/cabeceras distintos; ninguna lectura `GET` a endpoints que la pantalla no consultaba en `0cf8257`. Traza dorada REC-02 idéntica. H-W1…H-W6 siguen escalados y sin corregir.
- **Reglas financieras**: predicción OTP `BigInt(amountMinor) >= BigInt(policy.otpThresholdMinor)` intacta; sin bloqueos de cliente por saldo/límite (D-5); importes como cadena/bigint; ningún literal de política.
- **Copy legal y de recuperación**: textos de W03 aviso pendiente, W11, W13 («No se realizó ningún cargo»), W14 pendiente, W12 y avisos demo no cambian, salvo corrección de contradicciones listadas en `docs/web-ux-polish/COPY-CHANGES.md` con justificación.
- Archivos fuera de propiedad: `api/**`, `mobile/**`, `packages/shared/**`, `specs/**`, cualquier `package.json`/lockfile, CI, `playwright.config.ts` raíz, `SPEC.md`/`FINDINGS.md` raíz, `docs/web-fidelity-final/**` (congelado), `docs/design-mapping.md`, `design/**`.
- SPEI/bancos externos, claims no respaldados, botones decorativos, simuladores, nuevas funciones (reenvío OTP, cancelación, «Volver a revisar»), contrato 0.4.0.
- `npm ci|install`, suites raíz `test:e2e`/`test:visual`, contenedores/puertos de la demo (`fintech-wallet-postgres-1`, 55432, 3200, 5174, 8083), Lucem (`lucem-retail-db-1`, 5432), **stack de revisión manual del usuario** (puertos 3411/5411, contenedor `fintech-wallet-review-pg`), `docker compose down -v`, deploy/túneles.

### 2.3 Propiedad de archivos
Generators: `web/**` excepto `web/package.json`; `docs/web-ux-polish/**` excepto `SPEC.md` y `FINDINGS.md`; `docs/evidence/web-ux/**`. Evaluator: sólo `docs/web-ux-polish/FINDINGS.md` y `docs/evidence/web-ux/eval-<sha>/**`. Planner: sólo este archivo.

---

## 3. User flows (entradas → salidas)

Todas las llamadas idénticas a `0cf8257` (mismo endpoint, método, cuerpo, cabeceras). Lo que cambia es la salida visual, el foco y los anuncios.

| # | Flujo | Entradas | Salidas UX esperadas |
|---|---|---|---|
| UF-1 | Login (W01) | email, contraseña | Error cliente → foco al primer campo inválido con mensaje visible; 401/429/red → alerta encima del formulario, foco en ella; 200 → `/accounts`, foco en `h1` «Hola, {nombre}», título «Inicio · Billetera MXN», sin saltos de layout (CLS ≤ 0.1) |
| UF-2 | Registro (W02) | nombre, email, contraseña ×2 | Igual patrón; 201 → `/accounts` (vacío o con cuentas) |
| UF-3 | Inicio (W03) | `GET /accounts`, `GET /accounts/{principal}/movements?limit=3`, `GET /transfer-policy` | Cabecera (saludo + saldo consolidado), aviso pendiente si hay registro local, tarjetas ordenadas con la **principal primero**, actividad reciente con **un** enlace a historial |
| UF-4 | Beneficiario (W06→W07) | nombre, alias, CLABE; `POST /beneficiaries` | Validación al enviar; errores en línea + resumen junto a «Guardar»; 404/409/422 → foco en CLABE con su mensaje visible; 201 → W06 con aviso `role=status` |
| UF-5 | Transferencia bajo umbral (W08→W09→W11→W12) | origen (por defecto principal), tipo, destino, importe, concepto, referencia | W08 con origen visible y seleccionable en 1 clic; resumen pegajoso (≥1024) o colapsable (<1024); CTA siempre visible en móvil; W09 → `POST /transfers` → W12 comprobante |
| UF-6 | Transferencia sobre umbral (… → W10 → W12) | importe ≥ `otpThresholdMinor`; código de 6 dígitos | W09 variante código; 202 → W10 con un único indicador de estado del código y CTA visible; código correcto → W12; incorrecto → alerta + foco al campo |
| UF-7 | Historial (W04/W05) | cuenta (selector ordenado), tipo, fechas, «Cargar más» | Tabla densa legible por breakpoint; conteo anunciado tras cargar; vacío/sin resultados/error con acción útil; «Limpiar filtros» sólo con filtros activos |
| UF-8 | Rechazo (W13) | 422 saldo / 429 límite | Pantalla de rechazo con acciones ≥44 px; copy intacto |
| UF-9 | Cerrar sesión | botón único visible «Cerrar sesión»/«Salir» | `POST /auth/logout` → `/login` |
| UF-10 | Sesión vencida (W14) | 401 sin refresh posible | Tarjeta «Tu sesión venció» centrada; resumen del intento si existe; acción ≥44 px |

---

## 4. Modelo de datos

Sin cambios de contrato, persistencia ni registro local (`sessionStorage['wallet:web:transfer-attempt:<userId>']` y `wallet:web:active-user` intactos).

- **`orderAccounts(items: Account[]): Account[]`** (nuevo, puro, en `web/src/account-order.ts`): devuelve copia ordenada por `kind` (`checking` → 0, `savings` → 1, otro → 2), luego `name` con `Intl.Collator('es-MX', {sensitivity:'base'})`, luego `id`. **Cuenta principal** = `orderAccounts(items)[0]`. Motivo verificado: `GET /v1/accounts` ordena por `created_at,id` (`api/src/http/app.ts:101`) y las dos cuentas del registro con fixture se crean en la misma transacción, así que el orden depende de UUID aleatorios (por eso el video mostró «Ahorro» primero). Se usa en: W03 (orden de tarjetas, tarjeta destacada, cuenta de la actividad reciente), shell (enlace «Movimientos», línea `Cuenta •• NNNN`), W04 (opciones del selector), W08 (origen por defecto y orden de listas). No altera cuerpos `POST` salvo el valor por defecto de origen cuando el usuario no lo elige (la traza dorada fija el origen explícitamente; ver NET-01).
- **Tokens no de color** (§5.3) como variables CSS.
- **Inventario de acciones** `docs/web-ux-polish/actions-inventory.md` (copia en UX-T0 del de `docs/web-fidelity-final/` y mantenido aquí): por pantalla/estado/breakpoint (≥1024 y <1024), acciones en orden de tabulación con `{nombre accesible, tipo, efecto}`.
- **Manifiesto de capturas** `docs/evidence/web-ux/<sha>/captures-manifest.tsv`: `escenario, pantalla, estado, nivel, viewport WxH, DPR, fase (antes|después), archivo, sha256`.
- **Métricas** `docs/evidence/web-ux/<sha>/metrics.json`: por escenario×viewport, resultados de los helpers de §5.10 (espaciado fuera de escala, radios, tipografía, objetivos táctiles, contraste, overlays, foco oculto, duplicados, CLS).
- **Mapa de lecturas** `docs/evidence/web-ux/<sha>/network-reads.json`: por escenario, conjunto de `(método, plantilla de ruta)` de todas las peticiones (incluidas GET).

---

## 5. Stack y decisiones técnicas concretas

### 5.1 Base
React 19 + Vite 8 + react-router 7 + TanStack Query 5, Playwright 1.65.1 con `chromium-1248` en disco, Node `26.13.1`. **Sin dependencias nuevas.** Sin librerías de UI. Componentes existentes reutilizados (`AppShell`, `StatePanel`, `Notice`, `Amount`, `RadioCards`, `FieldError`, `SectionLabel`, `AuthField`, `StatusLayout`, `CodeView`, `ReceiptView`…); se permite extraer **tres** componentes pequeños nuevos: `PageHeader` (breadcrumb/eyebrow + h1 + subtítulo), `FormErrorSummary`, `ActionBar`.

### 5.2 Verificación de la revisión del usuario contra el código actual (`0cf8257`)
El video mostraba en parte una versión en caché; cada punto se contrastó con el árbol de trabajo (el Generator de UX-T0 confirma `git rev-parse --short HEAD` = `0cf8257`).

| # | Observación | Estado en `0cf8257` | Evidencia |
|---|---|---|---|
| 1 | Contenido visible a través de la cabecera sticky; h1 pegado bajo ella | **Confirmado** | `.shell-topbar` `position:fixed`, `background:rgba(255,255,255,0.9)` + `backdrop-filter:blur(12px)` (`style.css:244`); `.shell-main` `padding-top:64px` = alto de la topbar (`:250`) → h1 de W03/W04/W06 a 0 px de la topbar; no hay `scroll-padding`, así que el foco programático puede quedar bajo la topbar |
| 2 | Marca, «Demostración», «Cerrar sesión» y usuario duplicados | **Confirmado** | `components.tsx:128` (marca + «DEMOSTRACIÓN» lateral), `:137` (marca + chip topbar), `:132`/`:138` (avatar+nombre en ambos), `:133`/`:138` (dos «Cerrar sesión»); en <1024 también dos (`:138` topbar y `:141` «Salir») |
| 3 | «+ + Agregar …» | **Confirmado** | Icono `add`/`personAddOutlined` **y** texto `+ ` en `transfers.tsx:375`, `beneficiaries.tsx:59` y `:102`; además W06 vacío muestra dos CTA de alta (barra y tarjeta) |
| 4 | Origen por defecto = primera de la lista | **Confirmado** | `transfers.tsx:227` (`ownAccounts[0]`); orden de API no determinista (§4); cambiar origen exige 3 pasos («Cambiar cuenta» → elegir → se cierra) |
| 5 | Errores fuera de vista, validación ruidosa, foco, CTA | **Parcial** | W07: banner de error encima de la tarjeta (`beneficiaries.tsx:204-229`) mientras el usuario está en «Guardar»; «Formato válido» + check en cada campo correcto tras un error (`:240-243`, `:274`); W08: banner al inicio de la página (`transfers.tsx:340`); el foco al primer error **ya existe** (W02/W07/W08) pero sin `scroll-padding` puede quedar tapado; sin barra de acción pegajosa en móvil. La validación **no** es en tiempo real antes del primer envío (sí lo es el ruido de «válido» después) |
| 6 | Resumen/Saldo proyectado | **Confirmado** | `.tf-summary` sin `position:sticky` (`style.css:926`); en <1024 queda debajo, siempre expandido; vacíos «—» sin texto |
| 7 | Tabla de movimientos | **Confirmado** | filas apiladas en todo <1280 (`style.css:590`) incluso con 928 px útiles; controles de 30–32 px (`:506`, `:514`, `:517`, `:545`); «Limpiar filtros» visible e inerte sin filtros activos (`movements.tsx:78`, botón sin efecto = decorativo); carga con overlay `backdrop-filter` (`style.css:579`) |
| 8 | Espaciados, anchos, objetivos táctiles, navegación inferior | **Confirmado** | paddings superiores por página distintos (W03/W04/W06 0, W07 8, W10 12, W09 8/16, W08 32, W11 32); contenedores unos centrados y otros alineados a la izquierda (`.home`, `.hist`, `.bn-page` sin `margin:auto`); `.auth-reveal` 32 px, `.rc-copy` 32 px; barra inferior de 64 px **incluyendo** `env(safe-area-inset-bottom)` y `index.html` sin `viewport-fit=cover` (el inset siempre vale 0); valores fuera de escala (6, 7, 9, 13, 14, 15, 17, 18, 19, 21… px) |
| 9 | Accesibilidad | **Parcial** | Hay skip link, landmarks y `role=status/alert`; faltan: foco tras cambio de ruta, `scroll-padding` (foco oculto, WCAG 2.4.11), contraste de `#747686` sobre `#f9f9ff`/`#f1f3ff` (≈4.3:1 y ≈4.1:1 < 4.5:1) y de los límites de input `#f1f3ff` sobre blanco (≈1.1:1 < 3:1, WCAG 1.4.11), anillos de foco mezclados (outline 2 px, outline 3 px legado, box-shadow inset) |
| 10 | Otras fricciones | Ver §5.6 | W10: eyebrow y h1 con el mismo texto «Código de confirmación» (`transfer-screens.tsx:158-159`); tres indicadores simultáneos del mismo estado del código (chip, línea «Longitud válida…», texto de razón); con intento bloqueado se muestran un botón primario deshabilitado y otro primario «Volver al inicio»; W03 tiene dos enlaces al mismo historial (`home.tsx:159` y `:170`); W06 con un solo beneficiario estira la tarjeta a todo el ancho (`.bn-grid.is-single`); cargas de W08 usan `StatePanel` con icono «info» en vez de indicador de carga; H-W6 (§8) |

### 5.3 Sistema mínimo de espaciado, tipografía y contenedores — respuesta a (b)
Variables nuevas en `:root` de `web/src/style.css` (ningún `--color-*` cambia):

| Grupo | Tokens |
|---|---|
| Espaciado | `--space-1:4px --space-2:8px --space-3:12px --space-4:16px --space-5:20px --space-6:24px --space-8:32px --space-10:40px --space-12:48px --space-16:64px` |
| Radio | existentes `--radius-sm:8px --radius-auth-input:10px --radius-md:12px --radius-lg:16px --radius-full:9999px` + nuevo `--radius-xs:4px` |
| Contenedores | `--w-page:1200px` (W03, W04, W06) · `--w-form:1024px` (W07, W08, W09 código/propias, W10) · `--w-doc:768px` (W05, W09 normal, W12) · `--w-status:576px` (W11, W13) · `--w-auth:440px` (W01/W02) · `--w-card-status:448px` (W14) · `--measure:640px` (máx. de párrafos) |
| Chrome | `--shell-sidebar:256px` · `--topbar-h:56px` · `--bottom-nav-h:56px` · `--action-bar-h:72px` |
| Gutter | `--gutter`: 16 (<768), 24 (768–1279), 32 (≥1280) |
| Ritmo | `--page-top`: 24 (<768), 32 (≥768); cabecera de página → primer bloque: 24; entre secciones de primer nivel: 32 (≥768) / 24 (<768); padding de tarjeta: 24 (≥640) / 16 (<640); entre campos de formulario: 24 (≥768) / 20 (<768); etiqueta → control: 8; control → ayuda/error: 8; título de sección → contenido: 16 |

Reglas:
- **Escala**: todo `padding-*`, `margin-*`, `gap`, `row-gap`, `column-gap` computado en el shell y `main` pertenece a `S = {0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96}` px; excepción única: `padding-block: 2px` en `.chip`. Márgenes `auto` permitidos. Sin márgenes negativos.
- **Tipografía**: sólo las clases `t-*` existentes (display-currency 40/48 →32/40 <768; headline-lg 30/38 → 24/32 <768; headline-md 20/28; headline-sm 16/24; body-lg 16/24; body-md 14/20; body-md-medium; body-sm 12/18; body-sm-medium; label-caps 11/16; code-data 13/18). Pesos 400/500/600/700. Sin `clamp()` ni tamaños sueltos. Importes y CLABE con `tabular-nums`.
- **Contenedores**: todo contenedor de página es `width:100%; max-width:var(--w-*); margin-inline:auto`; la cabecera de página (`PageHeader`) vive **dentro** del mismo contenedor que el contenido, de modo que el borde izquierdo del h1 coincide con el de la primera tarjeta.
- **Rejillas de tarjetas**: filas con `align-items:stretch`; acciones de pie de tarjeta empujadas al fondo (`margin-top:auto`) para que queden alineadas.
- **Superficies**: tarjeta = `--color-surface-lowest` + `--radius-md` (16 sólo en tarjetas de cuenta W03 y auth) + `--shadow-card`; sin bordes de colores nuevos.

### 5.4 Shell y navegación (decisión D-UX-1)
- **≥1024**: barra lateral fija de 256 px, fondo opaco blanco, borde derecho 1 px `--color-surface-container-low`. Arriba: bloque de marca de 64 px (tile 32 + «Billetera MXN» 16/600 + chip «Demostración» debajo sólo si `policy.demoOnly`). Navegación Inicio, Movimientos, Beneficiarios, Transferir (ítems ≥44 px de alto, activo con `aria-current="page"`). Abajo: bloque de cuenta no interactivo (iniciales 32, nombre 14/500 con elipsis y `title`, `Cuenta •• NNNN` de la principal) y **un** botón «Cerrar sesión» de 44 px a todo el ancho. **No hay topbar en escritorio**: desaparece la fuente del texto fantasma y de los duplicados.
- **<1024**: topbar **estática** (no fija ni sticky; se desplaza con el contenido), opaca, 56 px: tile + «Billetera MXN» + chip «Demostración» (si `demoOnly`; oculto <360 px) a la izquierda; a la derecha **un** botón «Salir» (icono + texto visible, `aria-label="Cerrar sesión"`, ≥44×44). Navegación inferior **fija**, opaca, con **4** destinos (sin «Salir»), fila de 56 px + `padding-bottom: env(safe-area-inset-bottom)` fuera de esa fila; `index.html` añade `viewport-fit=cover`. `main` reserva `padding-bottom` = 56 + inset + 24.
- `html{scroll-padding-top:16px}`; en <1024 `scroll-padding-bottom` = barra inferior + inset + 16 (+ `--action-bar-h` cuando la página tiene `ActionBar`).
- Sin `backdrop-filter` ni fondos translúcidos en ningún elemento fijo/pegajoso del producto.
- Al cambiar de ruta dentro de la app: el foco va al `h1` de la nueva vista (`tabIndex=-1`) y `document.title` se actualiza (ya existe por ruta).

### 5.5 Formularios largos (W02, W07, W08, W09, W10)
- **Cuándo validar**: sólo al enviar. Tras el primer envío con errores, cada campo se revalida al cambiar (desaparece su error en cuanto es válido) y al perder el foco; los campos todavía no tocados no muestran errores nuevos hasta el siguiente envío. Nunca se muestran estados de éxito por campo («Formato válido», checks verdes); se conservan sólo ayudas neutras (contador `n / 18`, `n / 40`, «Hasta 7 dígitos»).
- **Errores**: mensaje en línea bajo el campo (`aria-invalid`, `aria-describedby`) + `FormErrorSummary` (`role="alert"`) dentro del formulario **inmediatamente antes de las acciones**, con el conteo y un botón por campo inválido que mueve el foco a ese campo. Se eliminan los banners de error de cabecera de página de W07 (estados `invalid`, `server-invalid`, `clabe-checksum`, `duplicate`, `not-found`) y W08 («Corrige los campos marcados…»); su texto se conserva dentro del resumen o del mensaje en línea. El estado «guardando» y el error recuperable (5xx/red) de W07 también se muestran en el resumen junto a las acciones.
- **Foco**: error de cliente → primer campo inválido en orden DOM; error de servidor ligado a campo (W07 404/409/422) → ese campo; error de servidor sin campo (5xx/red, 401 de login) → el resumen/alerta. El elemento enfocado y su mensaje quedan completamente visibles (no bajo overlays).
- **`ActionBar`** (<1024, en W07, W08, W09, W10): contenedor `position:sticky; bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))`, fondo opaco blanco, borde superior 1 px `--color-surface-container-low`, padding 12/16, con **sólo** la acción primaria a todo el ancho y, encima, la razón de deshabilitado si existe. Acciones secundarias («Cancelar», «Modificar datos», «Volver al inicio» cuando no es la primaria) quedan en el flujo normal al final del formulario. ≥1024: misma estructura en flujo normal (no pegajosa), primaria a la derecha y secundaria a su izquierda. Con altura de viewport < 560 px la barra deja de ser pegajosa.
- **Placeholders**: sólo ejemplos con prefijo «p. ej.»/«Ej.»; nunca repiten la etiqueta o la ayuda; color `--color-on-surface-variant` cuando el fondo del input es `--color-surface-container-low` (contraste ≥4.5:1).
- **Límite de inputs (WCAG 1.4.11)**: los inputs del shell conservan fondo `--color-surface-container-low` y añaden borde 1 px `--color-outline` (token existente, ≈4.6:1 contra blanco); foco: outline 2 px `--color-primary-container`; inválido: borde y outline `--color-error`.

### 5.6 Decisiones por pantalla
- **D-UX-2 W03**: tarjetas en orden `orderAccounts`; la destacada (barra superior 4 px) es la principal. La actividad reciente es de la principal. Un único enlace a historial («Ver historial completo», en la cabecera de la sección); el pie de la tabla queda con el texto «Mostrando los últimos N movimientos». Esqueleto con la misma altura que las tarjetas reales (sin saltos).
- **D-UX-3 W04**: ≥1280 tabla de 6 columnas; 1024–1279 tabla de 5 (fecha y hora como segunda línea de «Contraparte»); <1024 filas apiladas con etiquetas. «Limpiar filtros» sólo se renderiza si hay filtro activo; al usarlo el foco va a «Todos». «Cargar más» y el texto «Mostrando N movimientos» (`role=status`) en el pie de la tarjeta; tras cargar, el foco permanece en el botón (o en el texto de estado si ya no hay más páginas) y se anuncia «Se cargaron N movimientos más». Carga inicial: esqueleto + línea de estado; sin overlay con desenfoque. Selector de cuenta nativo de 44 px con etiqueta visible «Cuenta» y anillo de foco en el contenedor (`:focus-within`).
- **D-UX-4 W06**: rejilla `repeat(auto-fill, minmax(320px, 1fr))` (un beneficiario no se estira a todo el ancho). Estado vacío: no se renderiza la barra (buscador deshabilitado + CTA); el único CTA es el de la tarjeta vacía. Exactamente un enlace de alta visible por estado. Texto del CTA sin «+» literal.
- **D-UX-5 W07**: patrón §5.5; ayuda lateral a la derecha (≥1024, 8/4) o debajo del formulario (<1024).
- **D-UX-6 W08**: origen por defecto = `?source=` o principal. Con ≤3 cuentas el origen se muestra siempre como `radiogroup` de tarjetas compactas (cambiar = 1 clic; sin «Cambiar cuenta»); con >3, tarjeta resumen + «Cambiar cuenta». Resumen (`EntrySummary`): ≥1024 columna derecha `position:sticky; top:32px`; <1024 bloque después del formulario con botón de cabecera «Resumen previo · {importe o "sin importe"}» (`aria-expanded=false` por defecto, ≥44 px) que despliega las filas; a ≥1024 no existe ese botón. Valores vacíos con texto («Ingresa un importe», «Elige un destinatario») en lugar de «—». Primaria «Continuar a revisión» en `ActionBar`.
- **D-UX-7 W09**: primaria («Enviar transferencia»/«Confirmar transferencia») en `ActionBar`; «Modificar» secundaria; ≥1024 pie con primaria a la derecha.
- **D-UX-8 W10**: se elimina el eyebrow duplicado (el `h1` «Código de confirmación» queda solo, con el chip «Demo» a su lado si hay `demoOnlyCode`); un único indicador del estado del código (el chip `n/6 dígitos` → «Código completo»/«Código incorrecto»); la línea de longitud y la razón de deshabilitado se fusionan en un solo texto bajo las casillas. Si el intento está bloqueado/expirado/cancelado no se renderiza el botón «Autorizar…» y la única primaria es «Volver al inicio». El temporizador (`role=timer`) no es región viva; un `role=status` oculto anuncia una sola vez «Queda menos de un minuto» y «El código expiró».
- **D-UX-9 W11/W12/W13/W14**: contenedores centrados según §5.3; botones ≥44 px; «Copiar folio» ≥44×44 en <1024 y ≥36×36 en ≥1024; acciones apiladas a todo el ancho <640. Copy intacto.
- **D-UX-10 Cargas**: los `StatePanel` de carga usan icono `spinner` y `role=status`; los de error, icono de error y `role=alert`.

### 5.7 Responsive por breakpoint — respuesta a (c)
Viewports de evidencia: **320×640, 390×844, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080**; zoom 200 % = 640×512 @DPR 2. Cortes CSS: <640, 640–767, 768–1023, 1024–1279, ≥1280.

| Pantalla | ≥1280 (1280/1440/1920) | 1024–1279 | 768–1023 | 390 (<640) | 320 |
|---|---|---|---|---|---|
| Shell | lateral 256, sin topbar, gutter 32, contenido centrado en su `--w-*` | lateral 256, gutter 24 | topbar estática 56 + barra inferior fija 4 destinos, gutter 24 | igual, gutter 16 | igual; etiquetas inferiores 11 px sin recorte; chip demo oculto en topbar |
| W01/W02 | tarjeta 440 centrada | = | = | tarjeta a todo el ancho − 32, padding 24 | padding 16 |
| W03 | cabecera en fila (saludo ↔ total a la derecha); cuentas 2 columnas; tabla 4 columnas | = | cuentas 2 col; tabla 4 col | todo en 1 col; total a todo el ancho; actividad apilada | = 390 |
| W04 | tabla 6 col; filtros en 1 fila | tabla 5 col; filtros en 1 fila (con salto si no caben) | filas apiladas; filtros 2 filas | filas apiladas; segmento a todo el ancho (3 botones iguales); fechas 2 col | fechas 1 col |
| W05 | 768 centrado; partes 2 col | = | = | 1 col; folio en línea propia | = |
| W06 | rejilla auto-fill ≥320 (3 col a 1440/1920) | 2 col | 2 col | 1 col; buscador y CTA apilados a todo el ancho | = |
| W07 | 1024: formulario 8/12 + ayuda 4/12 | = | 1 col, ayuda debajo; `ActionBar` | = + padding 16 | = |
| W08 | 1024: formulario 8/12 + resumen 4/12 sticky top 32 | = | 1 col; resumen colapsable tras el formulario; `ActionBar` | = ; concepto/referencia en 1 col | = |
| W09 | normal 768; código/propias 1024 8/4 | = | 1 col; `ActionBar` | = | = |
| W10 | 1024 7/5 | = | 1 col: código, luego resumen; `ActionBar` | casillas 6 × ≥44 de alto sin desbordar | = |
| W11/W13 | 576 centrado | = | = | padding 16 | = |
| W12 | 768 centrado; acciones en fila | = | = | acciones apiladas | = |
| W14 | tarjeta 448 centrada vertical y horizontalmente | = | = | padding 16 | = |

### 5.8 Accesibilidad
WCAG 2.2 AA: foco visible uniforme (outline 2 px sólido `--color-primary-container`, offset 2; `--color-error` en campos inválidos; nunca `box-shadow` como único indicador), foco no oculto (2.4.11), objetivos ≥44×44 en <1024 y ≥24×24 (alto ≥36 para controles) en ≥1024 salvo enlaces dentro de texto, orden de tabulación = inventario, etiquetas visibles, errores asociados, contraste 4.5:1/3:1 (si falla: texto → `--color-on-surface-variant`; límite de componente → `--color-outline`; nunca colores nuevos), skip link, landmarks (un `main`, `nav` etiquetadas, la oculta con `display:none`), anuncios `role=status`/`alert`, `prefers-reduced-motion` (sin animaciones ni transiciones), zoom 200 % y reflow 320.

### 5.9 Entorno — hereda `docs/web-fidelity-final/ENVIRONMENT.md`
Contenedor propio `fintech-wallet-web-pg` en `127.0.0.1:55433` (volumen `fintech-wallet-web-pg-data`, base `wallet_test`), APIs P1–P4 en 3301–3304, Web en 5301–5304 (`--strictPort`), `.env.web-final`, caché `node_modules/.vite-web-final`, ≥2.5 GiB libres antes de crear volumen o compilar (hoy ≈3.4 GiB; si baja de 2.5 → BLOCKED), sin `npm install`. `preflight.mjs` añade a su lista de prohibidos los puertos 3411/5411 y el nombre `fintech-wallet-review-pg` (sólo comprobación de no-uso; jamás se detiene ni inspecciona ese stack). Evidencia en `docs/evidence/web-ux/<sha>/` con la misma estructura que `web-final` (`README.md`, `commands.txt`, `env-summary.txt`, `test-output.txt`, `metrics.json`, `captures-manifest.tsv`, `network-reads.json`, `network-traces.json`); PNG no versionados.

### 5.10 Helpers de medición (nuevos, `web/e2e-final/helpers/ux-metrics.ts`)
`offScaleSpacing(page)`, `radiiOutside(page)`, `typographyOutside(page)`, `touchTargets(page, min)`, `overlayRects(page)` (fijos/pegajosos), `overlayBleed(page)` (alfa de fondo, `backdrop-filter`, `elementFromPoint` en 9 puntos por overlay tras desplazar 300 px), `focusObscured(page)` (recorre Tab y compara cada rect enfocado con viewport y overlays), `duplicateChrome(page)` (cuenta visibles de «Billetera MXN», «Demostración», «Cerrar sesión/Salir», iniciales), `edgeAlignment(page)`, `clsDuring(page, action)` (PerformanceObserver `layout-shift`), `readTraffic(page)`. Reutilizan `contrastFailures`, `tabOrder`, `headingOutline`, `clippedText` y `diffTraces` existentes. `web/e2e-final/helpers/before-after.ts`: compone captura «antes» (UX-T0) | «después» a la misma escala (como `composeSideBySide`) → `<escenario>-<viewport>-ba.png`.

### 5.11 Pruebas heredadas
Las aserciones de las suites `t0…t5` que fijan medidas Stitch (288 px de lateral, topbar, posiciones de referencia, tamaños de tarjeta de la referencia…) y que contradicen este SPEC se actualizan al nuevo valor o se retiran; cada una se lista en `docs/web-ux-polish/SUPERSEDED.md` (archivo, prueba, aserción, motivo, criterio de este SPEC que la reemplaza). **Prohibido** retirar o debilitar aserciones funcionales, de red, de idempotencia, de recuperación, de copy veraz (REC-05) o de reglas financieras.

### 5.12 Cómo se mide «se ve hermosa» — respuesta a (e)
1. **Medible** (bloqueante): SP-*, SH-*, FM-*, A11Y-*, criterios por pantalla.
2. **Revisión visual del Evaluator** (bloqueante, VZ-*): para cada escenario de §7.4 y cada viewport de §5.7, el Evaluator abre (Read) el compuesto «antes | después» y la captura «después», y marca PASS/FAIL en 8 categorías, citando archivo y región en cada FAIL:
   1. **Alineación**: bordes izquierdos de h1, tarjetas y tablas coinciden; columnas de importes alineadas a la derecha; iconos centrados ópticamente con su texto.
   2. **Jerarquía**: un único foco visual por pantalla (h1 o importe principal) y una única acción primaria visible por vista/estado; títulos de sección claramente subordinados.
   3. **Espacio**: ritmo uniforme (mismos huecos entre bloques equivalentes), nada apretado ni huecos vacíos > 96 px dentro del contenido; paddings de tarjetas iguales.
   4. **Consistencia**: el mismo componente (botón, chip, tarjeta, fila de resumen, estado vacío) se ve igual en todas las pantallas.
   5. **Legibilidad/densidad**: líneas de texto ≤ `--measure`; tablas escaneables; importes con `tabular-nums` y un solo «MXN».
   6. **Estados**: vacío/cargando/error/deshabilitado comprensibles, con causa y acción útil.
   7. **Chrome**: sin duplicados de marca/demo/logout/usuario; navegación visible; nada tapa el contenido ni el foco.
   8. **Acabado**: sin recortes, desbordes, botones de alturas distintas en una misma fila ni saltos de layout.
   Además: ninguna categoría puede empeorar respecto de «antes»; y el Evaluator anota las 3 mejoras más visibles por pantalla (informativo).

### 5.13 Tandas de Generators — respuesta a (f)
Secuenciales, un Generator por tanda, misma rama, commits `UX-Tn:` sólo con archivos propios. Cada tanda termina con BLD-01 verde, la suite `final` (incluidas `ux-*`) verde para lo ya entregado, NET-01…NET-05 verdes y evidencia en `docs/evidence/web-ux/<sha>/`.

| Tanda | Contenido | Aceptación |
|---|---|---|
| **UX-T0 Prerrequisito** | Cierre de verificación en navegador de WF-T5 (W10/W11/W12) en `0cf8257`; línea base «antes» (capturas 7 viewports, métricas, lecturas de red, traza dorada); helpers §5.10; copia del inventario; `SUPERSEDED.md`/`COPY-CHANGES.md` vacíos con cabecera; ajuste de `preflight.mjs` | T0-01…T0-08, ENV-01…ENV-06 |
| **UX-T1 Shell, tokens y navegación** | Tokens §5.3, limpieza de CSS muerto, shell §5.4, `orderAccounts`, foco por ruta, `scroll-padding`, `PageHeader` en todas las pantallas, contenedores centrados | SP-01…SP-06, SH-01…SH-11, ORD-01…ORD-03, A11Y-06/07/08/14, NET-*, UX-SC-* |
| **UX-T2 Formularios y flujo de transferencia** | §5.5 (`FormErrorSummary`, `ActionBar`), W01, W02, W07, W08, W09, W10, W11, W13 | AU-*, AB-*, TF-*, RV-*, CD-*, SD-*, RJ-*, FM-*, FLOW-01 (sólo transferencia) → **Evaluación 1** sobre el SHA de UX-T2 (criterios de T0–T2) |
| **UX-T3 Inicio, historial, beneficiarios, comprobantes** | W03, W04, W05, W06, W12, W14 | HM-*, HI-*, DT-01, BN-*, RC-*, ST-* |
| **UX-T4 Responsive y accesibilidad finales** | Barrido de los 7 viewports + zoom/reflow, contraste, objetivos táctiles, foco oculto, inventario final, flujos completos [I], capturas «después», `HANDOFF.md` | SP-07…SP-10, A11Y-*, FLOW-01…03, VZ-01, todo §7 → **Evaluación 2** (todo); correcciones → **Evaluación 3** (cierre) |

Tras la 3.ª evaluación, lo abierto se entrega como ABIERTO/BLOCKED con causa exacta al coordinador. `docs/web-ux-polish/HANDOFF.md` (Generator de UX-T4): SHA base/final, commits, archivos cambiados (subconjunto de §2.3), comandos, resultados por criterio, `SUPERSEDED.md`, `COPY-CHANGES.md`, estado de §8.

---

## 6. Assumptions

- **A-1** El worktree está en `0cf8257` sin cambios locales; si no, UX-T0 registra el SHA real y se detiene si hay cambios ajenos.
- **A-2** «Cuenta principal» = primera por `orderAccounts` (cuenta `checking`); con el fixture de la API es «Cuenta principal». No hay campo de cuenta principal en el contrato 0.3.0.
- **A-3** Las suites `t5-confirm-result.spec.ts` y `t5-integration.spec.ts` existen y cubren W10/W11/W12 pero nunca se ejecutaron en navegador (dato del coordinador); los perfiles P1/P3 bastan para ellas.
- **A-4** El token de acceso dura 600 s fijos (`api/src/http/app.ts:54`); la sesión vencida `[I]` se provoca con API real invalidando credenciales en el cliente (FLOW-03).
- **A-5** El límite de 10 registros/logins por minuto por IP de la API sigue vigente: las pruebas `[I]` agrupan usuarios y reinician la API P1 por invocación como en `ENVIRONMENT.md`.
- **A-6** `#747686` (`--color-outline`) da ≈4.6:1 sobre blanco, ≈4.3:1 sobre `#f9f9ff` y ≈4.1:1 sobre `#f1f3ff`; `#434655` supera 7:1 en los tres. Los valores exactos los mide `contrast.ts`.
- **A-7** Docker Desktop disponible, imagen `postgres:16.10-alpine` en disco, ≥2.5 GiB libres.
- **A-8** El stack de revisión del usuario (3411/5411, `fintech-wallet-review-pg`) puede estar corriendo; sus puertos no se usan ni se liberan.

---

## 7. Rubric

### 7.0 Convenciones
- Niveles: `[F]` red simulada con `page.route` (`installMockApi`), `[I]` API + PostgreSQL reales de §5.9, `[I*]` API real con manipulación de credenciales en el cliente, `[S]` comprobación estática por comando.
- Contexto Playwright: Chromium, `locale: es-MX`, `timezoneId: America/Mexico_City`, `reducedMotion: 'reduce'` para capturas, reloj fijo en `[F]`, viewports de §5.7.
- «Todos los estados» = lista de escenarios de §7.4. Tolerancias: geometría ±1 px; tamaños tipográficos exactos.
- Cada criterio es PASS/FAIL. Cierre = todo PASS (P1 y P2); los P3 se reportan pero no bloquean.

### 7.1 UX-T0 · Prerrequisito (cierre WF-T5 y línea base)
- **T0-01** `[S]` `commands.txt` registra `git rev-parse --short HEAD` = `0cf8257` y `git status --porcelain` vacío al inicio.
- **T0-02** `[S]` `preflight.mjs` PASS y lista como prohibidos 3411, 5411 y `fintech-wallet-review-pg`; `df -h /System/Volumes/Data` ≥2.5 GiB y `docker system df` registrados antes de crear/arrancar el volumen.
- **T0-03** `[F]` `WF_PROFILES=P1 npx playwright test -c web/e2e-final/playwright.config.ts --project=final t5-confirm-result.spec.ts` en Chromium: ≥1 prueba, 0 fallos, 0 omitidas; salida `list` en `docs/evidence/web-ux/<sha>/test-output.txt`.
- **T0-04** `[I]` `t5-integration.spec.ts` con los perfiles que requiera (P1, P3): 0 fallos, 0 omitidas; cubre al menos W10 correcto→W12, W10 incorrecto, W10 expirado (P3), W10 intentos agotados (P3), W11 por pérdida de respuesta y W12 «Ver movimientos».
- **T0-05** `[F]` `golden.spec.ts` en el SHA de cierre de UX-T0: `diffTraces` contra `docs/evidence/web-final/f0ed4bc/network-golden.json` vacío.
- **T0-06** `[S]` Si T0-03/T0-04 fallaron en `0cf8257`, la corrección se hizo sólo en presentación o pruebas (`git diff 0cf8257 -- web/src/transfer-attempt.ts web/src/api.ts web/src/session.tsx` vacío y NET-03 PASS) en un commit `UX-T0:`; si la causa exige tocar tráfico o recuperación, la tanda se declara BLOCKED en `HANDOFF.md` con la causa exacta.
- **T0-07** `[F]` Capturas «antes» de todos los escenarios de §7.4 en los 7 viewports + zoom 200 % con manifiesto (`fase=antes`, sha256) y `metrics.json` de línea base con todos los helpers de §5.10.
- **T0-08** `[F]` `network-reads.json` de línea base por escenario y suites completas `final` y `legacy` ejecutadas en `0cf8257` con su resultado registrado (fallos listados, no necesariamente corregidos salvo W10–W12).

### 7.2 Transversales

**Tokens, espaciado y contenedores**
- **SP-01** `[S]` `:root` de `style.css` declara todas las variables de §5.3 (`rg -c -- '--space-(1|2|3|4|5|6|8|10|12|16):'` = 10; `--radius-xs`, `--w-page`, `--w-form`, `--w-doc`, `--w-status`, `--w-auth`, `--w-card-status`, `--measure`, `--shell-sidebar`, `--topbar-h`, `--bottom-nav-h`, `--action-bar-h`, `--gutter`, `--page-top` presentes).
- **SP-02** `[S]` Invariancia de color: las líneas `--color-*:` de `style.css` son idénticas a `0cf8257`; el conjunto `rg -o '#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|color-mix\([^)]*\)' web/src/style.css | sort -u` es subconjunto del de `0cf8257`; `web/index.html` conserva `theme-color` `#f9f9ff`; ningún color en estilos en línea de `web/src/**/*.tsx` (`rg "style=\{\{[^}]*(color|background)"` = 0).
- **SP-03** `[F]` `offScaleSpacing` = [] en shell y `main` para todos los estados y viewports (escala `S` de §5.3; excepción `.chip` 2 px vertical).
- **SP-04** `[F]` `radiiOutside` = [] (radios ∈ {0, 4, 8, 10 sólo en inputs auth, 12, 16, 9999}).
- **SP-05** `[F]` `typographyOutside` = [] (pares tamaño/interlineado de §5.3, pesos 400–700); `[S]` `rg -c "clamp\(" web/src/style.css` = 0.
- **SP-06** `[S]` `static-checks.mjs` amplía un control «selectores sin uso»: cada clase de `style.css` aparece en `web/src/**/*.{ts,tsx}` (0 sin uso); `rg -c "!important" web/src/style.css` ≤ el valor de `0cf8257` menos los del CSS eliminado.
- **SP-07** `[F]` A 1440 y 1920, el contenedor de cada pantalla mide su `--w-*` (§5.3, ±1) y está centrado en el área de contenido (|hueco izq. − hueco der.| ≤ 1); a <1280 ocupa el ancho disponible menos `--gutter` por lado.
- **SP-08** `[F]` `edgeAlignment`: en cada pantalla y viewport, borde izquierdo del `h1` = borde izquierdo del primer bloque de contenido (±1); tarjetas hermanas de una misma fila tienen igual `top` e igual alto (±1) y sus acciones de pie igual `bottom` (±1) (W03 cuentas, W06 tarjetas, W12 partes).
- **SP-09** `[F]` Ritmo: hueco cabecera de página → primer bloque = 24 (±1); entre secciones de primer nivel = 32 (≥768) / 24 (<768); padding de tarjetas principales = 24 (≥640) / 16 (<640); distancia del `h1` al borde superior visible del área de contenido = `--page-top` (+ alto de topbar en <1024).
- **SP-10** `[F]` A 1920 ningún `p` de texto corrido (`t-body-md`/`t-body-lg`) en `main` mide más de 640 px de ancho.

**Shell y navegación**
- **SH-01** `[F]` `duplicateChrome` en cada viewport y estado autenticado: exactamente 1 «Billetera MXN» visible, ≤1 «Demostración/DEMOSTRACIÓN» en el chrome (1 si `demoOnly:true`, 0 si `false`), exactamente 1 control visible de cierre de sesión, ≤1 bloque de iniciales/nombre de usuario.
- **SH-02** `[F]` ≥1024: no existe topbar visible; `aside` 256 px de ancho, alto = viewport, `position:fixed`, fondo opaco; 4 enlaces en orden Inicio, Movimientos, Beneficiarios, Transferir, cada uno ≥44 px de alto, activo con `aria-current="page"`.
- **SH-03** `[F]` <1024: topbar con `position` `static` o `relative`, alto 56, fondo opaco; contiene marca y el botón «Salir» (`aria-label="Cerrar sesión"`, ≥44×44).
- **SH-04** `[F]` <1024: navegación inferior `position:fixed`, fila de 56 px con exactamente 4 enlaces ≥44×44, opaca; ninguna etiqueta recortada (`scrollWidth ≤ clientWidth`) a 320; no hay `aside` visible.
- **SH-05** `[S]` `web/index.html` incluye `viewport-fit=cover`; `[F]` la barra inferior aplica `env(safe-area-inset-bottom)` como relleno adicional (con un inset simulado de 34 px vía CSS `--test-safe-area` o `page.addStyleTag`, la fila sigue midiendo 56).
- **SH-06** `[F]` Al desplazar al final de cada pantalla en <1024, el último elemento enfocable de `main` queda completamente por encima de la navegación inferior (y de `ActionBar` si existe).
- **SH-07** `[F]` `overlayBleed`: todo elemento fijo/pegajoso (salvo skip link) tiene fondo con alfa 1 y `backdrop-filter: none`; `[S]` `rg -c "backdrop-filter" web/src/style.css` = 0.
- **SH-08** `[F]` Tras desplazar 300 px, `elementFromPoint` en 9 puntos de cada overlay devuelve el overlay o un descendiente; con `scrollY = 0`, el `h1` no intersecta ningún overlay.
- **SH-09** `[F]` «Cerrar sesión» (≥1024) y «Salir» (<1024) emiten exactamente un `POST /v1/auth/logout` y navegan a `/login`; volver atrás no muestra datos de cuentas.
- **SH-10** `[F]` Con `/accounts` simulado devolviendo `[Ahorro (savings), Cuenta principal (checking)]`, el enlace «Movimientos» apunta a la cuenta `checking` y la línea de cuenta del lateral muestra su terminación.
- **SH-11** `[F]` Tras cada navegación interna (clic en navegación o CTA que cambia de ruta), `document.activeElement` es el `h1` de la nueva vista y `document.title` corresponde a la ruta.

**Orden de cuentas**
- **ORD-01** `[S]` `web/tests/account-order.test.ts`: `checking` antes que `savings`; desempate por nombre (`es-MX`, sin distinguir acentos/mayúsculas) y por `id`; resultado estable; la entrada no se muta.
- **ORD-02** `[F]` Con la respuesta invertida de SH-10: W03 muestra la tarjeta `checking` primera y destacada y su actividad (`GET /accounts/{checking}/movements?limit=3`); W04 lista `checking` primero en el selector; W08 preselecciona `checking` como origen.
- **ORD-03** `[I]` P1: para 3 usuarios recién registrados con fixture, W08 sin `?source=` muestra como origen seleccionado «Cuenta principal» y W03 la muestra primera.

**Formularios**
- **FM-01** `[S]` `rg -n "Formato válido|Longitud válida" web/src` = 0; `[F]` en W07 tras un envío con un solo campo inválido no hay iconos de check visibles en los campos válidos; en W10 con 6 dígitos hay exactamente un elemento visible que comunica «completo».
- **FM-02** `[F]` Antes del primer envío, escribir valores inválidos no muestra errores; tras un envío con errores, corregir un campo elimina su error en el siguiente `input` y no aparecen errores de campos no tocados hasta el siguiente envío o `blur` (W02, W07, W08).
- **FM-03** `[F]` Error de cliente al enviar (W02, W07, W08) a 390 y 1440: `activeElement` = primer campo inválido en orden DOM, y el campo y su mensaje están completamente dentro del viewport sin intersectar overlays.
- **FM-04** `[F]` W07 404, 409 y 422 de servidor: foco en `#clabe`, su mensaje en línea visible, `FormErrorSummary` (`role="alert"`) es el elemento previo a las acciones en el DOM; no hay banner de error por encima de la tarjeta del formulario. 5xx/red: foco en el resumen, visible.
- **FM-05** `[F]` El resumen lista un botón por campo inválido (conteo = campos inválidos) y cada uno enfoca su campo.
- **FM-06** `[F]` <1024, en W07, W08, W09 y W10: la acción primaria es visible en el viewport con `scrollY` = 0, a mitad y al final; su `bottom` ≤ `top` de la navegación inferior; ≥1024 la barra tiene `position:static`. Con viewport de 390×500 la barra es `static`.
- **FM-07** `[F]` Toda primaria deshabilitada tiene la razón visible adyacente (dentro de `ActionBar` en <1024) y enlazada por `aria-describedby`.
- **FM-08** `[F]` Todo input de texto mide ≥44 px de alto, tiene etiqueta visible y su placeholder (si hay) contrasta ≥4.5:1 con el fondo del input y empieza por «p. ej.»/«Ej.» o es un formato («dd/mm/aaaa» nativo, «0.00»).

**Accesibilidad**
- **A11Y-01** `[F]` En todo enfocable con `:focus-visible`: `outline-style: solid`, `outline-width ≥ 2px`, color `rgb(29,78,216)` (o `rgb(186,26,26)` en campos inválidos), contraste del anillo ≥3:1 con el fondo adyacente.
- **A11Y-02** `[F]` `tabOrder` de cada estado y breakpoint (≥1024 y <1024) = secuencia de `docs/web-ux-polish/actions-inventory.md`.
- **A11Y-03** `[F]` Todo input/select con nombre accesible; inválido → `aria-invalid="true"` y `aria-describedby` con el id del mensaje; resúmenes `role="alert"`; progreso/éxito `role="status"`.
- **A11Y-04** `[F]` `contrastFailures` = [] en todos los estados (≥4.5:1 texto normal, ≥3:1 texto grande e iconos informativos).
- **A11Y-05** `[F]` Todo input de texto/select tiene un límite (borde o fondo) con contraste ≥3:1 contra el fondo adyacente (WCAG 1.4.11).
- **A11Y-06** `[F]` Primer enfocable = «Saltar al contenido», visible al foco, mueve el foco a `main#contenido`.
- **A11Y-07** `[F]` Exactamente un `main`; cada `nav` visible con `aria-label` único; la navegación no visible tiene `display:none`; `aside` del resumen/ayuda con nombre.
- **A11Y-08** `[F]` `focusObscured` = [] recorriendo con Tab cada estado a 390 y 1440 (ningún elemento enfocado fuera del viewport ni intersectando overlays).
- **A11Y-09** `[F]` Regiones vivas: «Folio copiado», «Cargando más…», «Se cargaron N…», «Guardando…», «Enviando…» en `role=status`; el temporizador W10 no se anuncia más de 2 veces en 300 s (contador de mutaciones en regiones vivas).
- **A11Y-10** `[F]` Con `reducedMotion:'reduce'`: `document.getAnimations()` sin animaciones en curso y `transition-duration` ≤ 0.01 s en todos los elementos.
- **A11Y-11** `[F]` Zoom 200 % (640×512 @2) y 320×640: `scrollWidth ≤ innerWidth`, `clippedText` = [] (salvo truncados con `title`/texto accesible), y navegación inferior + `ActionBar` ocupan ≤ 40 % del alto del viewport.
- **A11Y-12** `[F]` `touchTargets`: <1024 todo interactivo visible ≥44×44 (exentos: enlaces dentro de un párrafo con texto); ≥1024 todo botón/input/select ≥36 px de alto y ≥24 px de ancho.
- **A11Y-13** `[F]` `html[lang="es"]`; exactamente un `h1` por vista; niveles sin saltos (`headingOutline`).
- **A11Y-14** `[F]` Todo botón sólo-icono tiene `aria-label`; todo SVG decorativo `aria-hidden="true"`.

**Red, reglas y recuperación (invariantes)**
- **NET-01** `[F]` `golden.spec.ts` en cada SHA entregado: `diffTraces` vacío contra `network-golden.json` de `f0ed4bc` (S1…S7, sin delta D-12).
- **NET-02** `[F]` Para cada escenario de §7.4: peticiones no-GET idénticas a la línea base T0-08 (método, ruta, clase de `Idempotency-Key`, sha256 del cuerpo) y conjunto de plantillas GET ⊆ línea base (excepción documentada: cambio de cuenta en las lecturas por `orderAccounts`, misma plantilla).
- **NET-03** `[S]` `git diff 0cf8257 -- web/src/transfer-attempt.ts web/src/api.ts web/src/session.tsx web/src/transfer-form.ts web/src/transfer-outcome.ts` vacío y `git diff -U0 0cf8257 -- web/src/transfers.tsx web/src/beneficiaries.tsx web/src/routes.tsx | rg '^[-+].*(request\(|requestTransfer|saveTransferDraft|clearTransferDraft|readTransferDraft|createKey|recoverTransferDraft|Idempotency|method:)'` = 0 líneas.
- **NET-04** `[S]` `rg -n "500000|2000000|parseFloat|toFixed" web/src` = 0; prueba unitaria: con `amountMinor = otpThresholdMinor` la variante W09 es «requiere código» y con `otpThresholdMinor − 1` no.
- **NET-05** `[S]` `git diff --stat 0cf8257 -- api mobile packages specs SPEC.md FINDINGS.md docs/web-fidelity-final '**/package.json' '**/package-lock.json'` vacío.

**Alcance y contenido**
- **UX-SC-01** `[S]` `static-checks.mjs` SC-01…SC-04 de `docs/web-fidelity-final/SPEC.md` PASS sobre `web/src` y `web/dist/p1`.
- **UX-SC-02** `[F]` SC-05 (demo) PASS: con `demoOnly:true` toda cifra de política lleva «(demostración)» o chip; con `false` la palabra no aparece.
- **UX-SC-03** `[S]` `rg -n "aria-hidden=\"true\">\+ |>\+ <|'\+ '" web/src` = 0 (sin «+» literal junto a icono de alta).
- **UX-SC-04** `[F][I]` Prueba de inventario: cada acción de `actions-inventory.md` produce su efecto; el número de botones/enlaces visibles por estado coincide (cero decorativos, incluido «Limpiar filtros» sin filtros).
- **UX-SC-05** `[S]` Textos de REC-05 (W11-V1…V3, aviso W03, W14 pendiente), W13 y W12 byte-idénticos a `0cf8257` (lista extraída por `static-checks.mjs`), salvo entradas de `COPY-CHANGES.md` con motivo «contradicción».
- **UX-SC-06** `[F][I]` Cero errores de consola no manejados y cero `pageerror` (salvo fallos de red provocados, listados).
- **UX-SC-07** `[S]` `docs/web-ux-polish/SUPERSEDED.md` lista cada aserción retirada/cambiada de `web/e2e-final/t*.spec.ts` y `web/e2e/*.spec.ts`; `git diff 0cf8257 -- web/e2e-final/t*.spec.ts web/e2e/*.spec.ts golden.spec.ts` no elimina líneas con `Idempotency`, `POST`, `draft`, `network`, `toBe(.*Minor` ni aserciones de copy REC-05 (revisión del Evaluator sobre el diff).

**Entorno, evidencia y build**
- **ENV-01** `[S]` `df` (≥2.5 GiB) y `docker system df` registrados antes de crear/arrancar el volumen en cada sesión de pruebas.
- **ENV-02** `[S]` `docker ps` muestra `fintech-wallet-web-pg` en `127.0.0.1:55433`; `rg` sobre `docs/evidence/web-ux/**/commands.txt` y `web/e2e-final/**` sin `fintech-wallet-postgres-1`, `lucem-retail-db-1`, `fintech-wallet-review-pg`, `:55432`, `:5432/`, `3200`, `5174`, `8083`, `3411`, `5411` (salvo la lista de prohibidos de `preflight.mjs`).
- **ENV-03** `[S]` `preflight.mjs` PASS antes de cada suite (salida en la evidencia).
- **ENV-04** `[S]` Sin `npm ci|install`, sin `test:e2e`/`test:visual` raíz (`commands.txt`).
- **ENV-05** `[S]` Limpieza documentada; al cierre, contenedor y volumen propios eliminados o retenidos por instrucción del coordinador.
- **ENV-06** `[S]` `docs/evidence/web-ux/<sha>/` por SHA entregado con `README.md`, `commands.txt`, `env-summary.txt`, `test-output.txt`, `metrics.json`, `captures-manifest.tsv`, `network-reads.json`, `network-traces.json`; ningún `.log`.
- **BLD-01** `[S]` `npm --workspace @fintech-wallet/web run lint`, `run typecheck`, `test` y `run build` terminan con 0.

### 7.3 Mejoras priorizadas por pantalla — respuesta a (a)
Prioridad: **P1** bloquea uso o belleza, **P2** importante, **P3** pulido.

**W01/W02 · Acceso**
- **AU-01** P2 `[F]` 390/320: tarjeta a todo el ancho menos 2×16, padding 24 (390) / 16 (320), sin scroll horizontal; ≥640 tarjeta 440 centrada.
- **AU-02** P2 `[F]` Botón mostrar/ocultar contraseña ≥44×44 en todas las anchuras, dentro del campo sin solaparse con el texto (`padding-right` del input ≥ ancho del botón).
- **AU-03** P2 `[F]` W02: ayuda «Usa al menos 12 caracteres.» visible antes de errores y enlazada; con error, ayuda y error enlazados.
- **AU-04** P1 `[I]` P1: login real → `/accounts`, foco en `h1`, CLS ≤ 0.1 (`clsDuring`) desde el envío hasta que cuentas y actividad están pintadas.

**W03 · Inicio**
- **HM-01** P1 `[F]` Principal primera y destacada (cubierto por ORD-02) y CTA «Transferir» de su tarjeta navega a `/transfers/new?source={checking}`.
- **HM-02** P1 `[F]` Tarjetas de cuenta de una fila con igual alto y el importe a la misma altura (±1); CTA al fondo alineados.
- **HM-03** P1 `[F]` La sección de actividad contiene exactamente un enlace a `/accounts/{id}/movements`.
- **HM-04** P2 `[F]` ≥1024 saludo y saldo consolidado en la misma fila, borde derecho del total = borde derecho del contenedor (±1); <768 apilados con el total a todo el ancho.
- **HM-05** P2 `[F]` Aviso pendiente: CTA ≥44 px, a todo el ancho <640; aparece entre cabecera y cuentas; copy intacto.
- **HM-06** P2 `[F]` Estado «sin saldo»: botón deshabilitado con razón visible y enlazada; vacío de actividad con icono, título y texto centrados.
- **HM-07** P2 `[F]` Carga: esqueleto con `role=status` y texto oculto; CLS ≤ 0.1 entre esqueleto y datos (respuestas retrasadas 800 ms).

**W04 · Historial**
- **HI-01** P1 `[F]` ≥1280 tabla de 6 columnas; 1024–1279 tabla de 5 sin desbordar (`scrollWidth ≤ clientWidth` de la tarjeta); <1024 filas apiladas con etiquetas visibles de Concepto e Importe.
- **HI-02** P1 `[F]` Controles de filtro ≥44 px de alto <1024 y ≥36 ≥1024; a 320 la barra de filtros no desborda.
- **HI-03** P1 `[F]` «Limpiar filtros» ausente sin filtros activos; presente con alguno; al usarlo todos los filtros se vacían y el foco va a «Todos».
- **HI-04** P1 `[F]` «Cargar más» y «Mostrando N movimientos» dentro del pie de la tarjeta; durante la carga botón deshabilitado con spinner; tras cargar, N actualizado en `role=status`; el foco no se pierde (`activeElement` ≠ `body`).
- **HI-05** P2 `[F]` Carga inicial sin `backdrop-filter`: esqueleto + línea de estado con `role=status`.
- **HI-06** P2 `[F]` Selector de cuenta: etiqueta visible «Cuenta», alto ≥44, anillo de foco visible en el contenedor al enfocar el `select`, opciones en orden `orderAccounts`.
- **HI-07** P2 `[F]` Vacío, sin resultados y error: contenido centrado en la tarjeta, acción ≥44 px; error en «cargar más» conserva filas y ofrece «Reintentar».
- **HI-08** P1 `[I]` P1 con 22 movimientos: 20 → «Cargar más» → 22 filas únicas, el estado anuncia 22, sin recarga manual.

**W05 · Comprobante desde historial**
- **DT-01** P2 `[F]` Botón volver 44×44; contenedor 768 centrado; partes en 1 columna <768; folio sin desbordar a 320.

**W06 · Beneficiarios**
- **BN-01** P1 `[F]` Ningún CTA muestra «+» de texto junto a un icono; nombre accesible del CTA = texto visible («Agregar beneficiario»).
- **BN-02** P1 `[F]` Con 1, 2 y 5 beneficiarios a 1440: todas las tarjetas tienen el mismo ancho (±1) y en cada fila los botones «Transferir» comparten `bottom` (±1).
- **BN-03** P1 `[F]` Exactamente un enlace visible a `/beneficiaries/new` en cada estado (lista, vacío, sin resultados, error); en vacío no se renderiza el buscador deshabilitado.
- **BN-04** P2 `[F]` Tras alta, aviso `role=status` visible bajo la cabecera sin mover el foco; <640 buscador y CTA apilados a todo el ancho, ambos ≥44.

**W07 · Alta de beneficiario**
- **AB-01** P1 `[F]` Patrón §5.5 completo (FM-01…FM-08 aplicados a W07 en 390, 768 y 1440).
- **AB-02** P2 `[F]` ≥1024 formulario 8/12 y ayuda 4/12 alineados arriba (±1); <1024 ayuda después del formulario.
- **AB-03** P1 `[F]` Estado «duplicado»: acciones «Ver en directorio» (primaria) y «Modificar datos» visibles junto al mensaje sin desplazamiento a 390 tras el foco en CLABE (ambas dentro del viewport o la primaria en `ActionBar`).
- **AB-04** P1 `[I]` P1: alta con CLABE real de otro usuario → W06 con aviso; repetir → 409 en línea; CLABE válida inexistente → 404 en línea; checksum inválido → error en línea sin petición.

**W08 · Transferir**
- **TF-01** P1 `[F]` Con 2 cuentas el origen se muestra como `radiogroup` sin pasos previos; cambiar origen = 1 clic (selección por clic o flechas); no existe «Cambiar cuenta»; con 4 cuentas sí existe y abre la lista.
- **TF-02** P1 `[F]` ≥1024: resumen `position:sticky`, `top` computado 32 px; al desplazar el formulario, el resumen permanece con `top ≥ 31` dentro del viewport y opaco. <1024: resumen después del formulario con botón `aria-expanded="false"` ≥44 px que lo despliega; a ≥1024 ese botón no existe.
- **TF-03** P2 `[F]` Resumen sin importe/destino muestra «Ingresa un importe»/«Elige un destinatario» (sin `dd` que sea sólo «—»); filas `dt` izquierda / `dd` derecha con línea base común (±1); importes `tabular-nums`.
- **TF-04** P1 `[F]` No existe banner de error en la cabecera de la página; errores según FM-03…FM-05.
- **TF-05** P1 `[F]` «Continuar a revisión» en `ActionBar` <1024 (FM-06) con la razón de deshabilitado dentro de la barra.
- **TF-06** P2 `[F]` Sin beneficiarios: un solo CTA de alta (sin «+» de texto) y, si hay ≥2 cuentas, «Transferir a cuenta propia».
- **TF-07** P1 `[I]` P1: transferencia a beneficiario bajo umbral (201 → W12) y entre cuentas propias; cuerpo del `POST` = valores mostrados en W09; saldos de W03 actualizados (bigint).
- **TF-08** P2 `[F]` Selector de tipo con `aria-pressed`, ≥44 px; cambiar de tipo conserva importe, concepto y referencia.

**W09 · Revisión**
- **RV-01** P1 `[F]` Primaria en `ActionBar` <1024; ≥1024 pie con primaria a la derecha y «Modificar» a su izquierda, misma altura.
- **RV-02** P1 `[F]` Variante «requiere código» con importe = umbral de la política simulada; normal con umbral − 1; sin política: texto neutro y CTA «Confirmar transferencia».
- **RV-03** P1 `[I]` Doble clic en la primaria emite exactamente un `POST /v1/transfers`.

**W10 · Código**
- **CD-01** P1 `[F]` El texto del `h1` no se repite en un eyebrow; un único indicador de completitud (FM-01); estado bloqueado/expirado/cancelado sin botón «Autorizar…» y con una sola primaria «Volver al inicio».
- **CD-02** P1 `[F]` A 320 las 6 casillas caben sin desbordar y miden ≥44 px de alto; pegar 6 dígitos funciona; un único `input` accesible (`autocomplete="one-time-code"`, `inputmode="numeric"`).
- **CD-03** P2 `[F]` Anuncios del temporizador según D-UX-8 (A11Y-09).
- **CD-04** P1 `[F]` <1024: tarjeta del código antes del resumen y primaria en `ActionBar`.
- **CD-05** P1 `[I]` P1: importe ≥ umbral leído de la política → W10 → `demoOnlyCode` → W12; código incorrecto → alerta y foco en el input con el texto seleccionado; P3: expirado e intentos agotados con su estado.

**W11 · Enviando / verificando**
- **SD-01** P2 `[F]` 576 centrado; padding 16 <640; una sola acción primaria por estado; copy de REC-05 intacto.
- **SD-02** P2 `[F]` Enviando: botón deshabilitado con `role=status`; sin saltos de layout al pasar de W09 a W11 (CLS ≤ 0.1).

**W12 · Comprobante**
- **RC-01** P1 `[F]` «Copiar folio» ≥44×44 <1024 y ≥36×36 ≥1024; «Folio copiado» en `role=status` visible.
- **RC-02** P2 `[F]` Acciones de igual alto en fila ≥640 y apiladas a todo el ancho <640; folio y partes sin desbordar a 320; un solo «MXN» por importe.
- **RC-03** P1 `[I]` «Ver movimientos» muestra como primera fila la operación recién hecha.

**W13 · Rechazos**
- **RJ-01** P2 `[F]` Acciones ≥44 px, apiladas <640; filas `dt`/`dd` del desglose alineadas (±1).
- **RJ-02** P1 `[I]` P2 saldo insuficiente y P4 límite diario: pantalla W13 con copy intacto y sin cambio de saldo en W03.

**W14 · Sesión / acceso**
- **ST-01** P2 `[F]` Tarjeta centrada vertical y horizontalmente (|hueco sup − inf| ≤ 1 cuando cabe) en todos los viewports; acción ≥44 px.
- **ST-02** P2 `[F]` Con registro pendiente, el bloque de resumen no desborda a 320 y la acción principal es única.

**Flujos completos**
- **FLOW-01** P1 `[I]` P1 a 1440×900: login → Inicio → alta de beneficiario → transferencia bajo umbral → W12 → transferencia sobre umbral → W10 → W12 → historial (ambas arriba) → «Cerrar sesión». En cada paso: SH-01, SH-07, A11Y-04, A11Y-12 PASS y captura «después».
- **FLOW-02** P1 `[I]` Mismo recorrido a 390×844 con otro usuario, incluidos FM-06 y SH-06 en cada formulario.
- **FLOW-03** P2 `[I*]` P1: con sesión iniciada, se borran cookies del contexto y se sustituye el `Authorization` de la siguiente petición por un token inválido (la API real responde 401 y el refresh real responde 401) → `/session-expired` con tarjeta W14; «Iniciar sesión» → login real → `/accounts`.

### 7.4 Revisión visual (escenarios y criterios VZ)
Escenarios mínimos (cada uno «antes» y «después», 7 viewports + zoom 200 %): W01 listo y con error; W02 con errores; W03 con saldo, sin saldo, con aviso pendiente, cargando; W04 con movimientos (22), vacío, sin resultados, cargando, error, error al cargar más; W05; W06 lista (1, 2 y 5), vacío, sin resultados; W07 inicial, inválidos, CLABE incorrecta, duplicado, destino no disponible, guardando, error recuperable; W08 beneficiario, propias, errores, sin beneficiarios, sin segunda cuenta; W09 normal, código, propias; W10 vacío, completo, verificando, incorrecto, expirado, agotados; W11 enviando, verificando, desconocido; W12 beneficiario y propias; W13 saldo y límite; W14 vencida, vencida con pendiente, acceso no disponible, página no encontrada.
- **VZ-01** `[S]` Manifiesto con todas las filas «antes» y «después» (sha256) y compuestos `-ba.png` para cada escenario×viewport.
- **VZ-02** Evaluator: las 8 categorías de §5.12 en PASS para cada escenario×viewport; cada FAIL cita archivo y región.
- **VZ-03** Evaluator: ninguna categoría empeora respecto de «antes» en ningún escenario×viewport.
- **VZ-04** Evaluator: a 1920 el contenido no se ve «perdido» (contenedores centrados, sin líneas de texto > `--measure`, sin tarjetas estiradas) y a 320/zoom 200 % no hay solapes ni texto recortado.

---

## 8. Decisiones y bloqueos

Decisiones tomadas en este SPEC (reversibles por el usuario/coordinador sin cambiar el resto):
- **D-UX-1** Sin topbar en escritorio; topbar estática en <1024; logout único por viewport. Alternativa si se rechaza: topbar fija opaca (sin alfa ni desenfoque) sólo con usuario + logout, y lateral sin bloque de usuario.
- **D-UX-0** Lateral de 256 px (antes 288) para dar ancho útil a 1024–1279.
- **D-UX-A11Y** Bordes de input con `--color-outline` (token existente) para cumplir WCAG 1.4.11; si el usuario lo rechaza, la única alternativa sin color nuevo es dejar el fallo documentado como excepción de accesibilidad.
- **D-UX-6** Origen inline con ≤3 cuentas; principal por `kind` (A-2).
- **D-UX-SUP** Aserciones de fidelidad Stitch se sustituyen (§5.11).

Bloqueos / decisiones pendientes del usuario o coordinador (no se resuelven en esta ronda):
- **B-1 · H-W6 (fricción mayor del flujo completo)**: tras un código expirado o con intentos agotados, la pestaña no puede iniciar otra transferencia hasta cerrar sesión y W03 sigue mostrando el aviso pendiente. Corregirlo exige cambiar los momentos de borrado del registro local (congelados) y/o habilitar D-12 (`POST /cancel`). FLOW-01/02 se diseñan para no depender de ello (el código se ingresa correctamente); el Evaluator lo reporta como fricción conocida, no como FAIL.
- **B-2 · D-12 / DEP-3**: «Volver a revisar» y «Solicitar nuevo código» siguen ausentes (sin endpoint de reenvío; cancelación diferida).
- **B-3 · H-W1…H-W5**: siguen escalados en `docs/web-fidelity-final/ESCALATIONS.md`; ninguna mejora de UX los toca.
- **B-4 · UX-T0**: si W10–W12 fallan en navegador por una causa que exige cambiar tráfico de red o recuperación, la ronda se detiene en UX-T0 (BLOCKED) y se escala; el resto de tandas no arranca hasta decisión.
- **B-5 · Entorno**: si el espacio libre baja de 2.5 GiB, o falta la imagen `postgres:16.10-alpine`, o algún puerto 3301–3304/5301–5304 está ocupado, BLOCKED (no se liberan puertos ajenos ni se toca el stack 3411/5411).
- **B-6 · Pruebas `[I]` heredadas no deterministas**: `t2-integration.spec.ts` y `t4-integration.spec.ts` asumen `[checking, savings] = owner.accounts` (orden de API no garantizado). Con `orderAccounts` la UI es determinista; si esas pruebas fallan por el orden de la **API** (no de la UI), el Generator las corrige seleccionando por `kind` y lo anota en `SUPERSEDED.md` (no es cambio de aserción funcional).
