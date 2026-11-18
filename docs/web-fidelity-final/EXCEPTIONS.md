# Excepciones justificadas y discrepancias de medida · ronda Web «fidelidad final»

Registro del Generator, por tanda. Complementa §7.2 (e) y §7.4 del SPEC (que no se edita). Regla aplicada en
cada pantalla: **donde el SPEC fija un valor, gana el SPEC; donde calla, gana la referencia aprobada tal como
está renderizada en su `screen.png`; la accesibilidad (E-G4) prevalece sobre ambas.** Cada punto cita la
evidencia en `docs/evidence/web-final/<sha>/` (capturas en `captures/`, no versionadas).

## WF-T1 · W01, W02, W14

### Discrepancias del SPEC frente a la referencia (para el Planner/coordinador)

| Criterio | Texto del SPEC | Referencia aprobada (CSS del export + PNG @1.25) | Implementado | Motivo |
|---|---|---|---|---|
| W14-V1 | tile 40 + «Billetera MXN» 18/500 | `w-8 h-8` = 32 CSS (40 px en el PNG); `text-headline-sm` 16/24, peso visual 500 | tile 32, 16/24/500 | 40 es medida en píxeles del PNG sin dividir por DPR 1.25; el ancho del texto en el PNG (126 px = 101 CSS) coincide con 16 px |
| W14-V1 | tarjeta ancho 448 (`max-w-md`), padding 32 | `main.max-w-md.p-space-lg` (448) contiene la tarjeta `p-space-lg`: tarjeta 400 CSS (500 px en el PNG), padding 24 | columna 448, tarjeta 400, padding 24 | 448 es la columna, no la tarjeta; el PNG mide 500 px = 400 CSS y el botón empieza a 30 px = 24 CSS del borde |
| W14-V2 | icono en círculo 80 | `w-16 h-16` = 64 CSS (80 px en el PNG) | 64 (acceso: `w-14` = 56) | misma confusión de unidades |

Las aserciones de `web/e2e-final/t1-access.spec.ts` comprueban los valores implementados (`metrics.json`,
claves `W14-V1-V2-V4 R`); si el Evaluador aplica los números literales del SPEC, W14-V1/V2 fallarían por estas
tres medidas aunque el lado a lado coincida. Requiere decisión del Planner (no se edita el SPEC).

### Excepciones por pantalla

| Pantalla | Diferencia con la referencia | Antes (f0ed4bc) | Después (WF-T1) | Justificación |
|---|---|---|---|---|
| W01 | Posición vertical de la tarjeta a R: la referencia la pinta 27 CSS px más arriba | tarjeta con eyebrow y legal, 480 px | tarjeta 440 centrada con `margin-block:auto` como el export | El PNG se capturó con un viewport de ~970 px de alto y se rellenó hasta 1280 px: con el mismo HTML, `my-auto` deja la tarjeta en y=332 sólo si el alto es 970. Prueba: `W01-listo-sbs-970.png` (viewport 1280×970 @1.25) coincide en posición; `metrics.json` → `W01-V1-V4 R.at970.cardTop`. E-G5 (artefacto de captura). |
| W01 | Placeholders gris `#747686` (la referencia los pinta casi negros) | — | `--color-outline` | E-G4: un placeholder no debe confundirse con un valor capturado; 4.6:1 sobre blanco. |
| W01/W02 | Iconos de campo en `#747686` (referencia `slate-400` `#94a3b8`) | glifos/sin iconos | outlined 20 px `--color-outline` | E-G4: `#94a3b8` da 2.56:1 (< 3:1 para iconos informativos); además `#94a3b8` no es token (TOK-01). |
| W01/W02 | Sin chip «Demostración»/«Entorno de Demostración» | — | — | E-G2 (sin sesión no hay `policy.demoOnly`). |
| W01 | Placeholder del correo `nombre@correo.com` | — | — | §7.2 W01 (e). |
| W02 | Título «Crea tu cuenta» 20/28/600 (PNG: 16/400) | «Empieza por aquí.» 32 px | headline-md | W02-V1 lo fija. El PNG pinta 16/400 porque `text-headline-md` no existe en el `tailwind.config` de ese export. |
| W02 | Bordes de campo `#e2e8f0` (PNG: gris oscuro del plugin `forms` + sombra) | borde `#c4c5d7` 49 px | input auth 44/10 | §5.4 «Input auth» y W02-V2. |
| W02 | Ayuda «Usa al menos 12 caracteres.» bajo «Contraseña» (no está en el PNG) | ayuda suelta sin `aria-describedby` | ayuda enlazada | W02-V2 la exige; la regla es la del contrato (≥ 12), no los «8» de variantes descartadas. |
| W02 | Botón «Crear cuenta» 14/500 (PNG: 16/400) | 14/700 con flecha | 14/500 sin flecha | TOK-03 (botón primario 14/500); el PNG no tiene flecha. |
| W02 | Etiquetas, campos, subtítulo y pie a 16/24/400 | 13/600, 14 | body-lg | El SPEC calla; el PNG aprobado los renderiza así (las clases `text-body-sm*` del export tampoco existen en su config). |
| W02 | Placeholders genéricos («Nombre y apellidos», «nombre@correo.com», «Al menos 12 caracteres», «Repite tu contraseña») en vez de «Ana López», `ana.lopez@institucion.mx`, `••••` | — | — | SC-02 prohíbe los datos del export; puntos como placeholder se confunden con un valor (E-G4). |
| W14 | Botón «Volver al inicio» `#1d4ed8` (referencia acceso: `bg-primary` `#0037b0`) | `#0037b0` con «←» | primario TOK-03 + icono arrow_back | TOK-03 fija el primario en `rgb(29,78,216)`. |
| W14 | Sombra de la tarjeta de acceso = sombra de tarjeta (referencia: `shadow-md`) | sombra propia | `--shadow-card` | TOK-04. |
| W14 | Tarjetas ~12 px más abajo que en la referencia | — | — | Se retira el chip «DEMOSTRACIÓN» (E-G2) y el bloque centrado se cierra (E-G6). |
| W14 | V3 (intento pendiente) sin referencia propia | rail + topbar + 2 tarjetas | bloque `#f1f3ff` dentro de la misma tarjeta | §7.2 W14 (e); copia veraz: no afirma «sin volver a enviarla» ni «consultará el mismo intento» (REC-05, H-W1). |
| W14 | «No tienes permisos…» y «Página no encontrada» con el estilo V4 | `🔒`, texto «permiso» | V4 | W14-V4 y (e). |
| W01/W02/W14 | Enlace «Saltar al contenido» y anillo de foco 2 px `#1d4ed8` | — | — | E-G4 (SH-07, A11Y-02). |

### Cambios de comportamiento (sin tráfico de transferencias)

- **W14-F2**: una sesión existente que pierde el acceso por un 401 sin refresh posible ahora muestra «Tu sesión
  venció» (`/session-expired`) en lugar del login. Sólo estado de presentación (`SessionProvider.expired`); el
  registro local del intento no se lee, escribe ni borra (prueba unitaria `web/tests/auth.test.ts` y
  `t1-access.spec.ts` «W14-F2»).
- **D-11**: 403 y 404 por id se pintan en el sitio con la tarjeta V4 (sin redirección, sin peticiones nuevas).
  `GET /transfers/{id}` 404 deja de mostrar «No pudimos consultar el intento» + «Consultar de nuevo» cuando no hay
  datos cargados; el registro sigue intacto (REC-04) y la traza no-GET no cambia.

## WF-T2 · W03, W04, W05

Misma regla (D-C1): medidas del SPEC tomadas del PNG se leen ÷ 1.25; donde el SPEC fija un token gana el token; donde
calla gana el PNG/HTML aprobado; la accesibilidad (E-G4) prevalece. Evidencia: `docs/evidence/web-final/<sha>/`
(`*-sbs.png` y recortes en `captures/`).

### Discrepancias del SPEC frente a la referencia (para el Planner/coordinador)

| Criterio | Texto del SPEC | Referencia aprobada | Implementado | Motivo |
|---|---|---|---|---|
| W05-V1 | «contenido centrado ancho máx. 960» | `max-w-3xl` = 768 CSS (960 px en el PNG @1.25) | 768 | D-C1 (960 es medida de imagen) |
| W05-V1 | botón atrás «tile blanco 40» | `p-2` + icono 20 = 36 CSS | 40 | El SPEC fija 40 y es un objetivo táctil mayor (E-G4); diferencia de 4 px |
| W03-V6 | borde izquierdo «4 px `#7a2b00`» | `w-1.5` (6 px) `tertiary-container` `#a03c00` | 4 px `#7a2b00` | El SPEC lo fija; `#a03c00` no es token (§5.4) |
| W03-V2/W05-V3 | importes `display-currency` (40/48/600) | `font-bold` (700) y `leading-none` en W03 | 40/600; interlineado 40 en las tarjetas de W03 (`leading-none` del HTML) | El SPEC fija el token y su peso; el interlineado no lo fija y se toma del HTML para que la tarjeta mida 260 px como la referencia |
| W03-V1 | suma «headline-md» | `font-bold` | 20/28/600 | token del SPEC |
| W03-V4 | «Actividad Reciente» headline-md (20) | `text-headline-sm` (16) | 20/28/600 | lo fija el SPEC |
| W05-V4 | nombre de las partes «headline-sm» | `body-md-medium` semibold (14) | 16/24/600 | lo fija el SPEC |

### Excepciones por pantalla

| Pantalla | Diferencia con la referencia | Antes (`f0ed4bc`) | Después (WF-T2) | Justificación |
|---|---|---|---|---|
| W03 | Cabecera del estado «sin saldo» igual a la del estado con saldo (eyebrow «RESUMEN FINANCIERO», fecha con calendario, tarjeta con tile) en lugar de «RESUMEN GENERAL • fecha» y «SALDO CONSOLIDADO TOTAL» de `w03_inicio_sin_saldo` | saludo + banner genérico | cabecera W03-V1 en ambos estados | W03-V1 fija la cabecera de W03; V5 sólo describe el cuerpo del estado. Requiere decisión si se quiere la variante |
| W03 | Fecha de la cabecera = `businessDate` de `GET /transfer-policy` (fecha del navegador mientras carga); sin hora ni «CST (CDMX)» | sin fecha | fecha larga es-MX | (e) y D-4 (sin reloj en vivo, §2.2) |
| W03 | Sin chips «Predeterminada»/«Bóveda Interna», sin «Acciones Frecuentes», sin «Intento ID», «Registrado», «Último saldo conocido» | — | — | (e), E-G6 |
| W03 | Texto del aviso: «por $X MXN (Beneficiario Billetera\|Entre mis cuentas)» sin nombre del destinatario; «Ocurrió una interrupción durante el proceso.» sin «sin duplicar la operación»; sin `transferId`: «Se repetirá la misma solicitud con su misma clave de operación.» | no existía | aviso | (e); REC-05/H-W1: la acción real repite el `POST` (sin `transferId`) o hace `GET` (con él); la copia no promete que no se reenvíe ni que sólo se consulte |
| W03 | Chips «Completada» `#98f6bb`/`#007345` y tile de abono `#98f6bb`/`#006d40` (referencia: `#ECFDF3`/`#027A48`, fuera de tokens) | `movement-status` | tokens §5.4 | TOK-04; mismos colores que W04 |
| W03 | Primera fila de actividad con fondo `--color-surface` (referencia `primary-container` al 3 % ≈ el mismo color) | — | token equivalente opaco | el helper de contraste no compone alfa; el color resultante coincide |
| W03 | Chips «N CUENTA ACTIVA» y «Últimos movimientos» con radio 9999 y colores neutros (`#e9edff`/`#434655`) | — | — | TOK-04 (referencia: radio 4 y `#f1f3ff`) |
| W03 | Icono del CTA «Transferir» = `send` (el mismo del shell, WF-T0) en lugar de `send_money` | `→` | icono SVG | coherencia con la navegación aprobada en WF-T0 (ICONS.md) |
| W03 | Icono vacío de actividad en `#747686` (referencia `outline-variant` `#c4c5d7`, 1.6:1) | — | — | E-G4 |
| W04 | Selector «CUENTA ACTIVA» único (tile wallet + nombre `(•••• NNNN)` + chevron) en todos los estados; `w04_sin_movimientos` dibuja otra variante (punto verde + dos líneas) | sin selector | `select` nativo estilizado | W04-V1; un `select` nativo da teclado y lector de pantalla sin código propio |
| W04 | Fechas «Desde/Hasta» vacías por defecto (`dd/mm/aaaa` del control nativo) en lugar de un rango ilustrativo; el icono de calendario va dentro del campo | inputs sin estilo | `type=date` con etiqueta | datos reales (E-G3); el control nativo expone 4 paradas de tabulación por campo (inventario) |
| W04 | «Ref. N» bajo el concepto (la referencia sólo muestra el concepto) | — | — | W04-V3 lo exige |
| W04 | Columna ACCIÓN completa a R (la referencia la recorta) | — | — | (e) mejora permitida |
| W04 | Cargando: sin subtítulo «Sincronizando con el enlace institucional SPEI»; el título es «Obteniendo movimientos recientes…»; icono = arco giratorio (quieto con movimiento reducido) | «Cargando movimientos…» | tarjeta + skeleton | (e), E-G6, A11Y-10 |
| W04 | Error al cargar más: banner `#ffdad6` (referencia `error-container` al 40 %) con título «No pudimos cargar más movimientos.» y «Tus transacciones visibles se conservan.» | error genérico que reemplazaba la página | banner dentro de la tarjeta | W04-V8 fija color y textos |
| W04 | Sin resultados: «Prueba ajustando el rango de fechas o el tipo de operación.» (sin «montos»); icono `manage_search` | «Sin movimientos» | estado propio | W04-V7 (no hay filtro de montos) |
| W04 | Filas apiladas por debajo de 1280 px de ancho de ventana (contenido < 928 px) en lugar de < 768 | tabla con scroll | filas apiladas con etiquetas | RESP-02: con el sidebar de 288 px las seis columnas no caben sin recorte entre 1024 y 1279 |
| W05 | Subtítulo «Operación registrada en Billetera MXN» (referencia «Operación realizada con éxito»); descargo «Constancia interna de Billetera MXN; no es un documento oficial.» | «Comprobante interno» | — | W05-V2 y (e) |
| W05 | Sin «Saldo después de la operación» ni «Comisión por servicio»; titular de origen = nombre de la cuenta | — | — | (e) |
| W05 | Tile de estado `#98f6bb` (referencia al 30 %) | `✓` | — | W05-V2 lo fija |
| Shell | Etiquetas de la navegación inferior con `title` (a 320 px «Beneficiarios»/«Movimientos» se recortan) | — | — | A11Y-05 (valor completo accesible) |

### Cambios de comportamiento (sin tráfico de transferencias)

- **D-9**: historial con `useInfiniteQuery`; un conjunto de filtros abandonado se descarta (`gcTime: 0`), así que
  «Limpiar»/«Restablecer» o volver a W04 empiezan en la página 1.
- **D-4**: `from`/`to` = `[00:00, 24:00)` del día de negocio en `businessTimeZone` (la API compara `<=`, por eso se envía
  24:00 − 1 ms).
- **D-10**: abonos de terceros abren un panel en línea; nunca `GET /transfers/{id}`.
- **FN-12**: W12 completado añade el enlace «Ver movimientos» (sólo navegación; la traza no-GET no cambia).
- **REC-03/04**: el aviso de W03 lee el registro con `readActiveTransferContext` (nunca escribe ni borra, ni expone la
  clave); Movimientos no resuelve intentos (un movimiento con el mismo concepto no oculta el aviso).

## WF-T3 · W06, W07

Misma regla (D-C1). Evidencia: `docs/evidence/web-final/<sha>/` (`W06-*-sbs.png`, `W07-*-sbs.png` y recortes en `captures/`).
Las seis variantes de W07 sin PNG se compararon contra su `code.html` renderizado sin red (§5.11: estructura y copia).

### Discrepancias del SPEC frente a la referencia (para el Planner/coordinador)

| Criterio | Texto del SPEC | Referencia aprobada | Implementado | Motivo |
|---|---|---|---|---|
| W06-V2 | avatar «60» | `w-12 h-12` = 48 CSS (60 px en el PNG @1.25) | 48 | D-C1 |
| W06-V2 | tarjeta «radio 12» | `rounded-[16px]` | 12 | lo fija el SPEC (TOK-04) |
| W06-V2 | nombre headline-md (20/28/600) | `text-[18px] font-semibold` | 20/28/600 | lo fija el SPEC |
| W06-V2 | `•••• NNNN` code-data (13/18) | `font-mono text-base` (16) | 13/18, peso 500, `tabular-nums` | lo fija el SPEC |
| W07-V2 | «inputs del shell alto 44» (§5.4: fondo `#f1f3ff`, sin borde, radio 8) | base PNG: fondo blanco con anillo `outline-variant`; las seis variantes usan `bg-surface-container-low rounded-lg` | input del shell en todos los estados | lo fija el SPEC y coincide con las variantes; la base PNG es la única que pinta campos blancos |
| W07-V2 | «Nombre completo o razón social» | «Nombre completo o Razón social» | texto del SPEC | lo fija el SPEC |

### Excepciones por pantalla

| Pantalla | Diferencia con la referencia | Antes (`eeafd2e`) | Después (WF-T3) | Justificación |
|---|---|---|---|---|
| W06 | Buscador de la lista: borde 1 px `outline-variant` al 50 % sobre blanco, radio 12 (igual que la referencia); placeholder `#747686` | campo sin icono con etiqueta visible | buscador con icono y etiqueta accesible | E-G4 (placeholder no confundible con un valor, como WF-T1); el campo sin borde del token desaparecería sobre el lienzo `#f9f9ff` |
| W06 | Chip «Alias: …» con radio 9999 y colores neutros `#e9edff`/`#434655` (referencia: radio 6, `#F1F5F9` con borde) | texto suelto | chip | TOK-04, como los chips de WF-T2 |
| W06 | Botón «Transferir →» alto 44 (referencia 42), fondo `#f1f3ff`, borde azul `#1d4ed8` al 30 % | no existía (badge «Cuenta interna») | enlace funcional | TOK-03 (controles de 44); `#EFF6FF`/`#BFDBFE` no son tokens |
| W06 | «+ Agregar beneficiario» alto 44 (referencias 40 y 48) | botón con «＋» | primario TOK-03 | TOK-03 |
| W06 | Vacío: título 20/28/600 (referencia `text-lg` 18) | «Aún no tienes beneficiarios» | headline-md | TOK-02 (títulos de tarjeta = headline-md o headline-sm) |
| W06 | Vacío: bajo el buscador deshabilitado se muestra «La búsqueda se habilita cuando registres tu primer beneficiario.» (la barra mide 114 en vez de 92 CSS y la tarjeta vacía baja 22 px) | — | razón visible enlazada | W06-V3 «deshabilitado con razón»; E-G4 |
| W06 | Sin resultados (sin referencia): tarjeta como la del vacío con icono manage_search, título, «Prueba con otro nombre, alias o los últimos 4 dígitos de la cuenta.» y «Limpiar búsqueda» | «No encontramos resultados» | W06-V4 | se reutiliza la familia visual aprobada del vacío; la línea de ayuda dice qué campos se buscan |
| W06 | Separación título → buscador 20 px en la lista (referencia 24 con h1 de 24/32); 32 px en el vacío | — | posiciones a ±1 px de la referencia | el h1 del SPEC (30/38) es 6 px más alto que el de la referencia de lista |
| W06 | Aviso de alta «Beneficiario “{alias}” agregado.» con icono check sobre `#f1f3ff` entre el encabezado y el buscador | aviso con texto largo | — | (e) sin referencia visual |
| W07 | Contenido 32 px a la derecha y 48 px más estrecho que la referencia (shell 288 en vez de 256 y padding 32 en vez de 24) | — | — | E-G1 |
| W07 | Metas «Obligatorio» / «Para identificarlo fácil» 11/16/600 sin mayúsculas (como el PNG); en error pasan a mayúsculas y `#ba1a1a` (como `w07_campos_inv_lidos`) | — | — | el PNG muestra el tamaño label-caps sin `uppercase` |
| W07 | Placeholders genéricos («p. ej. Nombre y apellidos», «p. ej. Nombre corto», «18 dígitos») en vez de «p. ej. Carlos Ruiz Mendoza», «p. ej. Carlos» y puntos | — | — | SC-02 (nombres del export); los puntos se confunden con un valor capturado (E-G4, precedente W02) |
| W07 | Ayuda lateral «Pide al titular su CLABE de Billetera MXN de 18 dígitos.» (2 líneas; la referencia 3) | vista previa lateral | tarjeta de ayuda | (e); la vista previa de round4 se retira (a) |
| W07 | Contenido centrado (`max-width` 1024 + `margin: auto`) a 1440 | — | — | `max-w-5xl mx-auto` del HTML aprobado |
| W07 (variantes) | Los estados se dibujan sobre la estructura de la base (migas, eyebrow, h1, tarjeta 8/12 con banner informativo y ayuda 4/12); el banner de cada estado va encima de la tarjeta del formulario, en la columna principal | estados = `Notice` genérico | banners por estado | las seis variantes son de familias distintas (h1 dentro de la tarjeta, «Paso único», «Nuevo contacto», «Alta de Destinatario», una columna de 672 px); se toma de cada una su banner, sus marcas de campo y sus acciones, no su retícula |
| W07 inválidos | Sin «Registro / Agregar beneficiario» con tile dentro de la tarjeta ni «0 / 25 caracteres» del alias; subtítulo del banner = el de la variante | — | — | h1 único de la base (A11Y-09); el contrato admite 80 caracteres de alias, no 25 |
| W07 CLABE incorrecta | Sin «Paso único», chip «Corrección requerida» ni la nota «Aviso importante de validación … no garantiza la titularidad»; textos de ayuda propios de la variante («Tal como aparece en la identificación oficial…») sustituidos por los de la base; iconos de campo válidos = check_circle | — | — | estructura de la base; el texto del banner se reformula a «Se detectó una inconsistencia en la CLABE proporcionada. Corrige el campo señalado antes de continuar.» (sin «clave numérica interbancaria») |
| W07 duplicado | Sin «Validación en línea SPEI», nombre/alias del contacto existente ni «BANCO 138 (SANTANDER)»; acciones alineadas a la izquierda como la variante, «Ver en directorio» con el primario TOK-03 (`#1d4ed8`, la variante usa `#0037b0`) | — | — | (e), SC-01, TOK-03; la API no devuelve el contacto existente |
| W07 destino no disponible | Sin «Red Bancaria Conectada», «Parámetros de transferencia», «Modo: SPEI / Directo», iconos de prefijo ni chip «Inválida»; la CLABE muestra anillo de error + «No encontrada» | — | — | (e), SC-01; el anillo es el estado inválido del token (§5.4) |
| W07 guardando | Etiquetas en `#434655` y campos `readonly` (no `disabled`) con `aria-busy` en el formulario; «Cancelar» deshabilitado con la misma razón visible | — | — | W07-V8; `readonly` mantiene el valor legible y enfocable |
| W07 error recuperable | Acciones en el orden de la base («Cancelar», «Reintentar guardar») a la derecha; sin «Alias de confianza / Opcional» (el alias es obligatorio en el contrato) | — | — | estructura de la base; contrato 0.3.0 |

### Cambios de comportamiento (sin tráfico de transferencias)

- **W06-F1**: `NewTransferPage` toma `?beneficiaryId=` como valor inicial del beneficiario (sólo estado inicial; sin
  peticiones nuevas; la traza no-GET de REC-02 no cambia).
- **W07**: la validación cliente usa `isValidClabe` de `@fintech-wallet/shared` (dígito verificador 3-7-1, el mismo que
  la API); la CLABE se limpia a dígitos al capturar. Estados de servidor sólo por estado HTTP del contrato 0.3.0
  (`POST /v1/beneficiaries`: 409 duplicado, 404 destino no disponible, 422 dígito verificador, 400 datos, 5xx/red
  recuperable). «Reintentar guardar» reenvía el cuerpo exacto del intento fallido; cualquier edición vuelve al estado base.
- Se retiraron las reglas CSS muertas de la Web anterior (`.beneficiary-*`, `.internal-badge`, `.privacy-note`), que ya
  no se usaban tras el rediseño.

## WF-T4 · W08, W09, W13

Misma regla (D-C1). Evidencia: `docs/evidence/web-final/<sha>/` (`W08-*-sbs.png`, `W09-*-sbs.png`, `W13-*-sbs.png` y capturas
por viewport en `captures/`). Las cinco variantes de W08 son de familias distintas (otro título, «Paso 2 de 3», tres tarjetas
apiladas, pestañas arriba); como en W07, cada estado se dibuja sobre la estructura de la base aprobada
(`w08_formulario_de_transferencia`) y de cada variante se toma su panel, sus marcas de campo y sus acciones.

### Discrepancias del SPEC frente a la referencia (para el Planner/coordinador)

| Criterio | Texto del SPEC | Referencia aprobada | Implementado | Motivo |
|---|---|---|---|---|
| W08-V5 | «2. CUENTA DE DESTINO» | `w08_entre_mis_cuentas` numera «2» porque sus pestañas van arriba sin número | «3. Cuenta de destino» tras «2. Tipo de destino» | estructura de la base (W08-V2 fija «2. TIPO DE DESTINO»); el selector no se mueve al cambiar de pestaña |
| W09-V2 | tarjeta «ancho máx. 950» | `max-w-[760px]` (950 px en el PNG @1.25) | 760 | D-C1 |
| W13-V1 | tarjeta «≈720» | `max-w-xl` = 576 CSS (720 px en el PNG) | 576 | D-C1 |
| W13-V1/V2 | alerta y fila «Faltante» `#ffdad6` | `error-container` al 40 % / 30 % | `#ffdad6` (token) | lo fija el SPEC |
| W08-V3 | botón «Continuar» y segmentado | `h-12` (48) y botones de 40 | 44 (TOK-03, controles de 44) | lo fija el SPEC |
| W08/W09 tarjetas | radio 12 | `rounded-2xl` (16) en la base W08 | 12 | TOK-04 (16 sólo donde (d) lo indica) |
| W08 inputs | input del shell radio 8 | `rounded-xl` (12) | 8 | §5.4 «Input shell» |
| W09-V7 | (sin h1 en el HTML) | `w09_revisi_n_entre_cuentas_propias` no tiene `h1` | h1 «Revisa y confirma tu transferencia» headline-lg tras el stepper | A11Y-09 (un h1) y TOK-02 |

### Excepciones por pantalla

| Pantalla | Diferencia con la referencia | Antes (`610e9cb`) | Después (WF-T4) | Justificación |
|---|---|---|---|---|
| W08 | Sin «ESTADO DE CUENTA Activa / Verificada», chip «Predeterminada», «Verificado», «Sin comisión…», «Comisión de red», «Tiempo estimado», chip «INMEDIATO», nota «Operación cifrada…», «Bitácora de contexto» | formulario de selects | estructura numerada 1–6 | (e), E-G6 (el hueco se cierra) |
| W08 | «Límite diario: …» → «Disponible hoy: {dailyRemainingMinor} (demostración)» y sólo con política cargada | — | — | W08-V3, SC-05 |
| W08 | Origen y destinatario como tarjetas + `radiogroup` desplegables («Cambiar cuenta», «Buscar otro beneficiario») | `select` | D-8 | la referencia sólo dibuja la tarjeta seleccionada; los enlaces son botones reales |
| W08 | «Representa el X % de tu saldo disponible actual» = saldo proyectado / saldo disponible, BigInt truncado a un decimal (la referencia: 93.1 para 11,600/12,450) | — | — | W08-V4 |
| W08 | Fila «Para: Sin seleccionar» del resumen sólo cuando no hay beneficiario elegido | — | — | W08-V7 (la base no la dibuja con beneficiario) |
| W08 propias | Lista con las cuentas seleccionables primero y la de origen al final, deshabilitada; sin pestaña «Nueva cuenta», atajos de importe, «Máx. disponible», «¿Deseas programar traspasos?», «Comisión por traspaso», «Tiempo de acreditación», nota «Traspaso registrado…» | — | — | (e), E-G6; orden de la referencia |
| W08 propias | Nota «Saldos estimados con tus saldos disponibles actuales.» bajo los saldos finales | — | — | W08-V5 «(estimados)» |
| W08 errores | Banner a lo ancho sobre la retícula (como la variante) con «Revisa los campos resaltados en rojo.» en lugar del texto SPEI; etiquetas numeradas de la base en `#ba1a1a` con `*`; columna derecha = «Resumen previo» de la base; sin «FOLIO PRE-», «Límite por operación», atajos, «Valor detectado…Banxico», «Envío instantáneo», «Reglas de validación Banxico» | — | — | (e), SC-01, E-G6 |
| W08 errores | Fondo de campo inválido `#fff5f4` = `color-mix(error-container 27 %, blanco)` (sin hex nuevo) + anillo 2 px `#ba1a1a`; icono warning en concepto y error en referencia como la variante | — | — | W08-V6, TOK-01 |
| W08 sin beneficiarios | Texto «Registra primero un beneficiario de Billetera MXN.» (SPEC) en lugar del texto SPEI; sin círculos decorativos de fondo, «Resumen preliminar» con IVA/comisión, «Garantía SPEI Banxico», «¿Dudas…? Guía SPEI», «Datos en borrador» | — | — | W08-V7, SC-01, E-G6 |
| W08 sin segunda cuenta | Texto del SPEC; botón tonal `#dbe2f9`/`#0037b0` con person_add; sin «Beneficiarios frecuentes», «Garantía Operativa SPEI», textos CEP/Banxico | — | — | W08-V8, (e), SC-01 |
| W08 | «Continuar» deshabilitado con razón visible bajo las acciones (sin beneficiarios, sin segunda cuenta, beneficiario = origen) | — | — | A11Y-07, E-G4 |
| W09 normal | Chip «Transferencia interna» (sin «inmediata»); «Desglose contable» se conserva; icono de concepto genérico `notes` | — | — | (e), §2.2 |
| W09 código | Encabezado de la base (eyebrow + h1 único) en lugar de «Revisar detalles de transferencia» + «Modo Seguro SPEI Directo»; barras de paso a lo ancho como la variante; la tarjeta principal es la de la base (monto, partes, concepto/referencia, saldo estimado) sin «Tipo de cambio», «Fecha estimada», «Costo»; tarjeta lateral «Se requiere código de confirmación» (icono candado `#7a2b00`) sin «Firma dinámica token» ni «Información de cumplimiento» | — | — | (e), W09-V6 |
| W09 propias | Sin «Traspaso Inmediato», «Acreditación instantánea», «Comisión: $0.00», «Visible en extractos…», «Generado automáticamente» (la referencia la captura el usuario), «Distribución patrimonial», «Fecha valor», «Costo operativo», «Traspaso seguro en tiempo real», «Tu saldo total no varía»; «Proyección contable estimada» → «Proyección estimada»; «Resumen ejecutivo» → «Resumen» | — | — | (e), W09-V7, E-G6 |
| W09 | Política no disponible: línea «Puede requerir un código de confirmación.» en el banner y CTA «Confirmar transferencia» | — | — | D-6 |
| W13 saldo | Saldo disponible leído con `GET /v1/accounts` después del rechazo; si esa lectura falla, «No pudimos consultarlo ahora» y sin filas «Faltante»/«Saldo final» | panel genérico | — | W13-V2 (sin inventar cifras) |
| W13 límite | Sin la segunda línea «Los fondos permanecen íntegros… sin retenciones»; «asignado a tu cuenta» → «disponible diario»; reinicio «al iniciar el siguiente día de negocio ({businessTimeZone})»; segmento rojo de la barra = disponible restante, como la referencia | — | — | (e), E-G6 |
| W13 | «No se realizó ningún cargo» sólo tras 422/429 del servidor con el `detail` de saldo/límite; otro 422/429 conserva el aviso genérico existente y un error de red sigue en W11 | — | — | regla de la tanda; H-W4 sigue escalado (ESCALATIONS.md) |
| W11/W12 | Un solo «MXN» en el importe del comprobante, del intento pendiente y del saldo de destino | `$1.23 MXN MXN` | `$1.23 MXN` | FN-09 (corrección de presentación; el rediseño es de WF-T5) |
| Shell | Contenido 32 px a la derecha y más estrecho que las referencias de 256 px | — | — | E-G1 |

### Cambios de comportamiento (sin tráfico de escritura nuevo)

- **D-8**: `?source=`, `?beneficiaryId=` y `?type=own_account` fijan sólo valores iniciales; el origen por defecto es la
  primera cuenta (antes: sin selección). Con una sola cuenta destino candidata, viene preseleccionada.
- **W08-F2**: los valores se conservan al cambiar de pestaña (antes se vaciaba el beneficiario/la cuenta destino).
- **W13**: tras el rechazo se hacen `GET /v1/accounts` y `GET /v1/transfer-policy` (sólo lectura). «Modificar monto» en
  confirm navega a `/transfers/new` con los datos del intento en el estado de navegación (el registro ya lo borró la
  lógica existente de rechazo definitivo).
- **REC-02**: cuerpo del `POST /v1/transfers` con el mismo orden de claves y valores (`createBody`); claves de idempotencia,
  registro local y recuperación sin cambios; traza dorada S1…S7 idéntica.

## WF-T5 · W10, W11, W12

Regla aplicada (DECISIONS D-C1): medidas del SPEC tomadas del PNG se dividen entre 1.25; donde el SPEC calla gana PNG/HTML;
la accesibilidad prevalece.

### Medidas y tokens

| Pantalla | SPEC | Referencia | Producto | Justificación |
|---|---|---|---|---|
| W10/W11-V2/V3 | TOK-02 «h1 = headline-lg» | el título de la tarjeta es el `h1` y usa headline-md (`w10_c_digo_completo`, `w11_verificando_resultado`) | `h1` headline-md (20/28/600) | W10-V1 y W11-V2 fijan headline-md para ese título; un solo `h1` por vista (A11Y-09) |
| W10 casillas | 72×56 a R | 75×56 con sidebar de 256 | ≈ 70.6×56 a R (52 de alto < 640 px) | E-G1 (shell de 288 estrecha la columna 7/12); tolerancia ±2 |
| W10 casillas | `#f1f3ff` | `surface-container-high/60` | `#f1f3ff` + sombra interior | W10-V2 (valor explícito del SPEC) |
| W10 CTA | botón primario `#1d4ed8`, alto 44 | `bg-primary` `#0037b0`, alto 48 | `#1d4ed8`, alto 48 | TOK-03 (color), alto de la referencia (≥ 44) |
| W10 cuenta regresiva | chip `mm:ss` | «04:09 min» sobre `tertiary-fixed/40`, texto `#a03c00` | «mm:ss min», fondo `color-mix(#ffdbcd 40 %, blanco)`, texto `#7a2b00`; < 60 s `#ffdad6`/`#93000a` | W10-V1; `#a03c00` no es token (TOK-01) |
| W11 tarjetas | ≈ 720 | `max-w-xl` | 576 | D-C1 (720 ÷ 1.25) |
| W12 tarjeta | ≈ 950 | `max-w-[760px]` | 760 | D-C1 |
| W12 círculo | 80 | `w-16` | 64 | D-C1 |
| W12 «Ver movimientos» | contorno | blanco con sombra, sin borde | `btn-outline` (borde `#c4c5d7`) | W12-V6 explícito |
| W12 botones | — | `rounded-lg` (8) | 12 | TOK-03 |
| W12 propias | — | PNG @2 sin HTML útil | misma retícula de 760 que la variante de beneficiario | §5.11 (el HTML no tiene markup) |

### Excepciones por pantalla

| Pantalla | Diferencia con la referencia | Antes (`8ab4b86`) | Después (WF-T5) | Justificación |
|---|---|---|---|---|
| W10 | Sin «Solicitar nuevo código» | — | — | **E-W10-1** (DEP-3: no existe endpoint de reenvío) |
| W10 | Sin «Volver a revisar» / «Volver a revisar transferencia» (normal, expirado y agotados); en expirado/cancelado y agotados la acción es «Volver al inicio» | — | — | **E-W10-2**: D-12 diferido por el coordinador. Sin `POST /cancel` ni liberación del registro, volver a W08 reabriría este mismo intento (la recuperación al montar `/transfers/new` lo consulta y regresa a W10): sería un botón sin efecto real (FN-14). Ver ESCALATIONS «H-W6» |
| W10 | Sin «AUTENTICACIÓN MULTIFACTOR», «SMS», «terminación •••• 4190», «Canal Cifrado SPEI», «Preparación SPEI / Validación de Token», «Comisión», «Institución receptora», «Validación de Destinatario», tira «SPEI Bancario 24/7 · Sin Comisión Banxico · Comprobante CEP», panel «Formato completado… Banxico» | — | — | (a)/(e), SC-01, E-G6 (el hueco se cierra; no se inventa texto) |
| W10 | Eyebrow «CÓDIGO DE CONFIRMACIÓN»; breadcrumb «Transferir › Confirmación»; chip «En espera de firma» → «Pendiente de confirmación»; «Monto a liquidar» → «Monto a transferir»; «Hora de emisión … CST» → «Creada» con la hora local de negocio | — | — | W10-V1/V6, D-4 |
| W10 | Tarjeta lateral «Protege tu código / Nunca compartas este código con terceros.» (el resto del texto de la referencia promete conducta del personal) | — | — | (e) «texto opcional» |
| W10 | Chip de estado junto a la etiqueta: «n/6 dígitos» (vacío/incompleto), «Código completo», «Código incorrecto», «Código expirado», «Bloqueado» | — | — | W10-V2…V10 |
| W10 incompleto | Se mantiene el orden de columnas de la base (código a la izquierda) | — | — | (e) |
| W10 agotados | Tarjeta superior con «Operación suspendida» (h1) y franja «No se realizó ningún cargo a tu cuenta» + «Saldo disponible actual» de `GET /v1/accounts` (la referencia dice «intacto»); sin «Desafío Inhabilitado», «SMS / TOKEN», «IVA», «Comisión», «Institución receptora», «Cancelada temporalmente»; texto de casillas → «El servidor ya no acepta códigos para este intento.» | — | — | W10-V10, (e), E-G6 |
| W10 expirado | Alerta del SPEC; sin «REF: SPEI…», teléfono, «Token inválido: tiempo límite de 2 minutos», «Entrada bloqueada • Código caducado», «Sin costo», CLABE completa | — | — | W10-V9, SC-01, §4 (CLABE nunca completa) |
| W10 | Sin «intentos restantes» | — | — | (e): la API no lo informa |
| W11-V1 | Sin marca «$ Finanzas institucionales» ni segundo avatar | — | — | E-G1 |
| W11-V2 | Texto según la causa real: al montar con registro «Hay un envío de esta pestaña sin resultado confirmado. Estamos consultando…»; tras una interrupción, el texto del SPEC | — | — | copia veraz (REC-05) |
| W11-V2 | Botón deshabilitado «Consultando…» si la acción es `GET`; «Reintentando el mismo envío…» si es el mismo `POST` | — | — | W11-F1 (nunca «consultar» cuando se reenvía) |
| W11-V3 | Texto alternativo si hubo respuesta HTTP sin resultado (5xx/409/400…): «Recibimos una respuesta que no confirma el resultado…» | — | — | copia veraz (el texto del SPEC habla de conexión interrumpida) |
| W11 | «Monto en consulta» → «Monto»; sin «Entorno seguro» | — | — | (e) |
| W12 | «Saldo posterior confirmado» → «Saldo disponible actual» (+ «Cuenta {origen}»); propias «Saldos posteriores confirmados» → «Saldos disponibles actuales», «Saldo posterior» → «Saldo actual»; «Patrimonio disponible sin variación neta» → «Suma de los saldos disponibles de tus cuentas» | — | — | (e): la API no devuelve el saldo posterior |
| W12 | Sin fila «Comisión»/«Comisión por servicio», sin «ENTORNO SEGURO Cifrado 256-bit»; folio = UUID o `receiptReference` (no «DEMO-0001») | — | — | (e), SC-01, D-13 |
| W12 | Se elimina el aviso «Constancia interna… No es un comprobante CEP ni un documento oficial.» | aviso con «CEP» | sin aviso | instrucción del coordinador (pendiente de T2), SC-01 |
| W12 | «Folio copiado» visible y anunciado (`role="status"`) | — | — | W12-F1 |

### Cambios de comportamiento (sin tráfico de escritura nuevo)

- W10: `GET /v1/transfers/{id}` sólo de lectura tras 409 y tras 422 «El código expiró.» (W10-F1) y una vez al llegar la cuenta
  regresiva a `00:00` (W10-F2); `GET /v1/accounts` tras «intentos agotados» y al pasar a `completed` en la misma vista.
- El mapeo de `confirm` ya no muestra «No se confirmó la respuesta…» para «Código incorrecto.», «El código expiró.» y
  «Se agotaron los intentos.»; las claves por (intento, código), el borrado del registro (sólo `completed`/rechazos
  definitivos) y los `POST` son los mismos que en `f0ed4bc`.
- W11: mismas acciones de red que antes (el botón de V3 en `/transfers/new` repite el mismo `POST`; en
  `/transfers/{id}/status` consulta con `GET`); sólo cambian vistas y copia.
- Tests existentes: selectores actualizados por la copia nueva (`Autorizar transferencia…`, `No pudimos confirmar el
  resultado`, `Reintentar el mismo envío`, `.rc-card`, `.cf-box`, «Volver al inicio»). Dos aserciones de W10 que
  esperaban el texto genérico «No se confirmó la respuesta» ante un código incorrecto real pasan a esperar la alerta
  «Código incorrecto» (W10-V8); el resto de aserciones (idempotencia, un POST, saldos, sin CLABE) no cambia.
