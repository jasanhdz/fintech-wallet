<!-- UX-T0: copia de docs/web-fidelity-final/actions-inventory.md en 0cf8257 (SPEC §4). Desde aquí se mantiene en docs/web-ux-polish/; el original queda congelado. Cada tanda actualiza las secciones que cambia y anota la tanda. -->

# Inventario de acciones visibles (SPEC §4, A11Y-01, FN-14)

Formato por pantalla/estado: cada botón/enlace visible en **orden de tabulación**, con
`{nombre accesible, tipo, efecto esperado (ruta | petición | cambio de estado | portapapeles)}`.
Cero botones decorativos: todo lo listado debe producir su efecto (FN-14). Las pantallas W01–W14 se
completan en la tanda que las rediseña; WF-T0 deja fijado el shell, que precede y sigue al contenido de
cada pantalla autenticada.

## Shell autenticado (WF-T0, todas las pantallas con sesión)

### ≥1024 px (barra lateral 288 + topbar)

| # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|
| 1 | Saltar al contenido | enlace | foco a `main#contenido` (sin navegación) |
| 2 | Inicio | enlace | ruta `/accounts`; `aria-current="page"` en Inicio |
| 3 | Movimientos | enlace | ruta `/accounts/{primera cuenta}/movements` (o la cuenta abierta) |
| 4 | Beneficiarios | enlace | ruta `/beneficiaries` |
| 5 | Transferir | enlace | ruta `/transfers/new` |
| 6 | Cerrar sesión (barra lateral) | botón | `POST /v1/auth/logout` → ruta `/login` (limpieza local según `session.tsx`, sin cambios) |
| 7 | Cerrar sesión (topbar, icono) | botón | igual que 6 |
| 8… | contenido de la pantalla | — | ver ficha de la pantalla |

Elementos no interactivos: marca (tile + «Billetera MXN» + «DEMOSTRACIÓN» sólo con `demoOnly`), tarjeta de
usuario (iniciales, nombre, `Cuenta •• NNNN`), chip «Demostración» del topbar (sólo con `demoOnly`).
No hay reloj, campana ni ayuda.

### <1024 px (topbar + navegación inferior)

| # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|
| 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| 2 | Cerrar sesión (topbar, icono) | botón | `POST /v1/auth/logout` → `/login` |
| 3… | contenido de la pantalla | — | ver ficha |
| n+1 | Inicio | enlace | `/accounts` |
| n+2 | Movimientos | enlace | `/accounts/{id}/movements` |
| n+3 | Beneficiarios | enlace | `/beneficiaries` |
| n+4 | Transferir | enlace | `/transfers/new` |
| n+5 | Salir | botón | `POST /v1/auth/logout` → `/login` |

## W01 · Iniciar sesión (WF-T1)

Sin shell. Todos los estados (listo, errores de campo, enviando, 401, 429, sin conexión) comparten la misma
secuencia; en «enviando» el botón está deshabilitado (sale del orden de tabulación). Elementos no interactivos:
marca (tile + «Billetera MXN»), alerta `role="alert"`, estado `role="status"` (sólo lector de pantalla).

| # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|
| 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| 2 | Correo electrónico | campo `email` | captura (validación cliente al enviar) |
| 3 | Contraseña | campo `password` | captura |
| 4 | Mostrar contraseña / Ocultar contraseña | botón (`aria-pressed`) | cambio de estado: `type` password ↔ text |
| 5 | Iniciar sesión | botón `submit` | validación → `GET /v1/auth/csrf` + `POST /v1/auth/login` → `/accounts` (o `/transfers/new` con `resumeTransfer`) |
| 6 | Regístrate aquí | enlace | ruta `/register` |

## W02 · Crear cuenta (WF-T1)

Mismos estados que W01 (listo, errores de campo, contraseñas distintas, 409, creando).

| # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|
| 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| 2 | Nombre completo | campo | captura |
| 3 | Correo electrónico | campo `email` | captura |
| 4 | Contraseña | campo `password` (`aria-describedby` → ayuda «Usa al menos 12 caracteres.») | captura |
| 5 | Mostrar contraseña / Ocultar contraseña | botón (`aria-pressed`) | cambio de estado del campo 4 |
| 6 | Confirmar contraseña | campo `password` | captura; sólo se valida en cliente, nunca se envía |
| 7 | Mostrar confirmación / Ocultar confirmación | botón (`aria-pressed`) | cambio de estado del campo 6 |
| 8 | Crear cuenta | botón `submit` | validación → `GET /v1/auth/csrf` + `POST /v1/auth/register` (`fullName, email, password`) → `/accounts` |
| 9 | Inicia sesión | enlace | ruta `/login` |

## W14 · Sesión vencida, acceso no disponible y página no encontrada (WF-T1)

Sin shell. Al montarse no emiten peticiones de escritura (sólo la hidratación de sesión `POST /v1/auth/refresh`).

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Sesión vencida (sin intento) | 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| | 2 | Iniciar sesión | enlace | ruta `/login` |
| Sesión vencida con intento (V3) | 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| | 2 | Iniciar sesión y retomar la verificación | enlace | ruta `/login` con `state {from:'/transfers/new', resumeTransfer:true}` (lógica existente); el registro local no cambia |
| Acceso no disponible (403, 404 por id, `/access-denied`) | 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| | 2 | Volver al inicio | enlace | `/accounts` con sesión, `/login` sin sesión |
| Página no encontrada | 1 | Saltar al contenido | enlace | foco a `main#contenido` |
| | 2 | Volver al inicio | enlace | igual que acceso no disponible |

## W03 · Inicio (WF-T2)

Contenido entre el shell (tras «Cerrar sesión» del topbar a ≥1024; antes de la navegación inferior a <1024). Sin
peticiones de escritura al montarse (REC-03). Elementos no interactivos: cabecera (eyebrow, saludo, fecha del día de
negocio), tarjeta «Saldo consolidado», tarjetas de cuenta (chip, `•••• NNNN`, saldo), tabla de actividad, pie.

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Con saldo (2 cuentas) | 1 | Transferir | enlace (primario, 1.ª tarjeta) | ruta `/transfers/new?source={id 1.ª cuenta}` |
| | 2 | Mover entre mis cuentas | enlace (secundario, 2.ª y siguientes) | ruta `/transfers/new?type=own_account&source={id}` |
| | 3 | Ver todos los movimientos en Historial | enlace | ruta `/accounts/{1.ª cuenta}/movements` |
| | 4 | Ver historial completo | enlace | ruta `/accounts/{1.ª cuenta}/movements` |
| Con saldo (1 cuenta) | 1 | Transferir | enlace | `/transfers/new?source={id}`; luego 3 y 4 |
| Aviso pendiente sin `transferId` | 0 | Retomar verificación | enlace (`aria-describedby` → «Se repetirá la misma solicitud con su misma clave de operación.») | ruta `/transfers/new`; la lógica existente repite el mismo `POST /transfers` con la misma `Idempotency-Key` y cuerpo (H-W1, sin cambios) |
| Aviso pendiente con `transferId` | 0 | Consultar estado | enlace | ruta `/transfers/new`; la lógica existente hace `GET /transfers/{id}` |
| Sin saldo | — | Transferir (Disponible cuando la cuenta tenga saldo) | botón deshabilitado (fuera del orden de tabulación; razón visible enlazada por `aria-describedby`) | ninguno |
| Cargando | — | — | — | skeletons `aria-busy` |
| Error de cuentas | 1 | Intentar de nuevo | botón | `GET /v1/accounts` |
| Error de actividad | 1 | Transferir / Mover entre mis cuentas (como «con saldo») | enlaces | — |
| | 3 | Ver todos los movimientos en Historial | enlace | — |
| | 4 | Intentar de nuevo | botón | `GET /v1/accounts/{1.ª}/movements?limit=3` |

El aviso (fila 0) precede a las tarjetas cuando existe registro local.

## W04 · Historial (WF-T2)

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Todos | 1 | Cuenta activa | `select` | ruta `/accounts/{id}/movements` (sólo cuentas de `GET /accounts`) |
| | 2–4 | Todos / Entradas / Salidas | botones `aria-pressed` | quitan o fijan `type=credit|debit`; reinician la acumulación |
| | 5–8 | Desde (día, mes, año, selector de calendario) | campo `type=date` (Chromium: 4 paradas con el mismo nombre) | `from` = 00:00 del día de negocio en `businessTimeZone` |
| | 9–12 | Hasta (día, mes, año, selector de calendario) | campo `type=date` | `to` = 24:00 − 1 ms del día de negocio |
| | 13 | Limpiar filtros | botón | quita `from`, `to`, `type`, `cursor` |
| Con movimientos | 14… | Ver detalle (una por fila) | enlace (propio: cargo, o abono con `counterparty.ownAccountId`) | ruta `/transfers/{transferId}/movement-receipt` (W05) |
| | | Ver detalle | botón `aria-expanded`/`aria-controls` (abono de tercero) | muestra/oculta el panel en línea; sin `GET /transfers` (D-10) |
| | último | Cargar más movimientos | botón | `GET …/movements?cursor=` y añade la página (D-9) |
| Error al cargar más | último | Reintentar | botón | repite la página siguiente; las filas visibles se conservan |
| Vacío sin filtros | 1–4 | Cuenta activa, Todos, Entradas, Salidas | — | fechas y «Limpiar filtros» se ocultan |
| Sin resultados | 14 | Restablecer búsqueda | botón | igual que «Limpiar filtros» |
| Cargando | 1–13 | (filtros) | — | tarjeta `role="status"` «Obteniendo movimientos recientes…» |
| Error inicial | 14 | Intentar de nuevo | botón | repite la primera página |
| 403 / 404 | — | ver W14 «Acceso no disponible» | — | D-11 |

## W05 · Comprobante desde el historial (WF-T2)

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Comprobante | 1 | Volver a Movimientos (icono) | enlace | `/accounts/{cuenta de la que se abrió, o origen}/movements` |
| | 2 | Volver a Movimientos | enlace (contorno) | igual que 1 |
| | 3 | Ir a Inicio | enlace (primario) | `/accounts` |
| Error de consulta | 1 | Volver a Movimientos (icono) | enlace | igual que arriba |
| | 2 | Intentar de nuevo | botón | `GET /v1/transfers/{id}` |
| 403 / 404 | — | ver W14 | — | D-11, registro local intacto |

## W06 · Beneficiarios (WF-T3)

Contenido entre el shell. Sin peticiones de escritura: la búsqueda es local (nombre, alias o últimos 4 dígitos) y
anuncia «N de M beneficiarios» en un `role="status"` oculto. Elementos no interactivos: encabezado, tarjetas (avatar con
iniciales, nombre, chip «Alias: …», panel «Cuenta destino Billetera MXN» + `•••• NNNN`), aviso de alta `role="status"`.

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Lista | 1 | Buscar beneficiarios | campo `search` (`aria-controls` → resultados) | filtra en el cliente, sin peticiones |
| | 2 | Agregar beneficiario | enlace (primario, icono add) | ruta `/beneficiaries/new` |
| | 3… | Transferir a {nombre} (texto visible «Transferir →», una por tarjeta) | enlace | ruta `/transfers/new?beneficiaryId={id}`; W08 abre con ese beneficiario preseleccionado |
| Vacío | — | Buscar beneficiarios | campo deshabilitado (fuera del orden; razón visible «La búsqueda se habilita cuando registres tu primer beneficiario.» enlazada por `aria-describedby`) | ninguno |
| | 1 | Agregar beneficiario (barra superior, texto «+ Agregar beneficiario») | enlace | `/beneficiaries/new` |
| | 2 | Agregar beneficiario (tarjeta vacía) | enlace | `/beneficiaries/new` |
| Sin resultados | 1–2 | Buscar beneficiarios, Agregar beneficiario | — | como «Lista» |
| | 3 | Limpiar búsqueda | botón | vacía el campo y le devuelve el foco; vuelven todas las tarjetas |
| Cargando | 1–2 | Buscar beneficiarios, Agregar beneficiario | — | skeletons `aria-busy` |
| Error | 1–2 | Buscar beneficiarios, Agregar beneficiario | — | — |
| | 3 | Intentar de nuevo | botón | `GET /v1/beneficiaries` |
| 401 / 403 | — | ver W14 | — | 401 → «Tu sesión venció»; 403 → «Acceso no disponible» |

## W07 · Alta de beneficiario (WF-T3)

Elementos no interactivos: eyebrow, encabezado, banner informativo, metas de campo («Obligatorio», «Para identificarlo
fácil», contador `n / 18`, «Formato válido», «Cuenta ya registrada», «No encontrada»), banners de estado (`role="alert"`,
`tabindex=-1`: reciben el foco tras una respuesta del servidor, fuera del orden de tabulación), tarjeta «¿Dónde obtener la
CLABE interna?» (`aside`).

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Base, campos inválidos, CLABE incorrecta, destino no disponible | 1 | Beneficiarios | enlace (migas, icono atrás) | ruta `/beneficiaries` |
| | 2 | Nombre completo o razón social | campo (máx. 120) | captura |
| | 3 | Alias o nombre corto | campo (máx. 80) | captura |
| | 4 | CLABE de 18 dígitos | campo numérico (sólo dígitos, máx. 18) | captura; contador `n / 18` |
| | 5 | Cancelar | enlace (contorno) | ruta `/beneficiaries` |
| | 6 | Guardar beneficiario | botón `submit` | validación cliente (vacíos, 18 dígitos, dígito verificador con `isValidClabe`): si falla, sin petición y foco al primer campo con error; si pasa, `POST /v1/beneficiaries` → 201 `/beneficiaries` con aviso; 409 duplicado; 404 destino no disponible; 422 CLABE incorrecta; 400 campos; 5xx/429/red error recuperable; 401 W14; 403 acceso no disponible |
| Duplicado (409) | 1–4 | Beneficiarios + 3 campos (`readonly`) | — | — |
| | 5 | Ver en directorio | enlace (primario) | ruta `/beneficiaries` |
| | 6 | Modificar datos | botón (secundario) | vuelve a editable y enfoca la CLABE (sin petición) |
| Guardando | 1–4 | Beneficiarios + 3 campos (`readonly`, formulario `aria-busy`) | — | — |
| | — | Cancelar · Guardando beneficiario… | botones deshabilitados (razón visible `role="status"` «Registrando y validando datos en Billetera MXN. Por favor no cierres esta ventana.» enlazada por `aria-describedby`) | ninguno |
| Error recuperable (5xx / red) | 1–5 | Beneficiarios, 3 campos, Cancelar | — | — |
| | 6 | Reintentar guardar | botón `submit` (primario, icono sync) | reenvía exactamente el mismo cuerpo del intento fallido |

Cualquier edición tras una respuesta del servidor vuelve al estado base (sin banner). En «campos inválidos» corregir un
campo retira su error y actualiza el chip «N errores».

## W08 · Datos de transferencia (WF-T4)

Contenido entre el shell. Sin peticiones de escritura: W08 → W09 sólo cambia de paso. Elementos no interactivos: migas
(texto), encabezado, tarjeta de la cuenta origen seleccionada, tarjeta del beneficiario seleccionado, contador `n / 40`,
«Hasta 7 dígitos», «Disponible hoy» (sólo con política), resumen lateral (`aside` «Resumen previo» / «Resumen proyectado»),
banner de errores (`role="alert"`), razón de «Continuar» deshabilitado (enlazada por `aria-describedby`).

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Beneficiario seleccionado (base, errores) | 1 | Cambiar cuenta | botón `aria-expanded`/`aria-controls` (sólo con ≥ 2 cuentas) | despliega/pliega el `radiogroup` «Cuenta de origen» (una parada; flechas mueven y seleccionan, Espacio selecciona, Enter o clic selecciona y pliega devolviendo el foco al botón) |
| | 2 | A un beneficiario | botón `aria-pressed` | tipo de destino beneficiario (conserva todos los valores) |
| | 3 | Entre mis cuentas | botón `aria-pressed` | tipo de destino cuentas propias (conserva todos los valores) |
| | 4 | Buscar otro beneficiario | botón `aria-expanded`/`aria-controls` | despliega/pliega el `radiogroup` «Destinatario» (beneficiarios que resuelven a la cuenta origen: `aria-disabled` con razón) |
| | 5 | Importe a transferir | campo `inputmode=decimal` | captura; validación al continuar (FN-06) |
| | 6 | Concepto | campo (máx. 40) | captura; contador `n / 40` |
| | 7 | Referencia numérica | campo `inputmode=numeric` (máx. 7) | captura |
| | 8 | Continuar a revisión | botón `submit` (primario) | validación cliente: con errores, banner + foco al primer campo y sin petición; sin errores → W09 (sin petición) |
| | 9 | Cancelar | enlace (secundario) | ruta `/accounts` |
| Sin beneficiario elegido | 4 | {nombre del beneficiario} | `radiogroup` «Destinatario» (una parada) | selecciona; Enter/clic pliega y lleva el foco a «Buscar otro beneficiario» |
| Lista de origen abierta | 2 | {nombre de la cuenta} | `radiogroup` «Cuenta de origen» (una parada, tras «Cambiar cuenta») | selecciona el origen; el resto sigue igual |
| Entre mis cuentas | 4 | {nombre de la cuenta destino} | `radiogroup` «Cuenta de destino» (una parada; la cuenta origen aparece `aria-disabled` con chip «Origen actual» y razón) | selecciona el destino (con una sola candidata viene preseleccionada) |
| Sin beneficiarios (W08-V7) | 4 | Agregar nuevo beneficiario (texto «+ Agregar nuevo beneficiario») | enlace (primario) | ruta `/beneficiaries/new` |
| | 5 | Transferir a cuenta propia | botón (sólo con ≥ 2 cuentas) | cambia a «Entre mis cuentas» conservando los valores |
| | — | Continuar a revisión | botón deshabilitado (fuera del orden; razón visible «Registra un beneficiario o transfiere entre tus cuentas para continuar.») | ninguno |
| Sin segunda cuenta propia (W08-V8) | 1–2 | A un beneficiario · Entre mis cuentas | — | (sin «Cambiar cuenta» con una sola cuenta) |
| | 3 | Transferir a un beneficiario | botón | cambia a «A un beneficiario» conservando los valores |
| | — | Continuar a revisión | botón deshabilitado (razón «Necesitas una segunda cuenta propia para transferir entre tus cuentas.») | ninguno |
| Beneficiario = cuenta origen (D-7) | — | Continuar a revisión | botón deshabilitado (razón «Este beneficiario corresponde a la cuenta de origen. Elige otra cuenta de origen u otro beneficiario.») | cambiar el origen lo habilita |
| Cargando / error de opciones | 1 | Intentar de nuevo (sólo error) | botón | `GET /v1/accounts` + `GET /v1/beneficiaries` |

## W09 · Revisión (WF-T4)

Elementos no interactivos: migas, barras de paso, eyebrow, tarjetas de monto, partes, concepto/referencia, saldo estimado.
Muestra exactamente el cuerpo que se enviará (concepto recortado).

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Normal (sin código previsto o política no disponible) | 1 | Modificar datos | botón (contorno, icono edit) | vuelve a W08 con todos los valores; sin petición |
| | 2 | Confirmar transferencia | botón (primario) | `POST /v1/transfers` con `Idempotency-Key` (lógica de `f0ed4bc`); 201 → W12; 202 → W10; 422/429 «Saldo/límite» → W13; otro error o sin respuesta → W11. Doble clic = un solo POST |
| Requiere código (`amountMinor >= otpThresholdMinor` de la política) | 1 | Continuar a verificación | botón (primario, tarjeta lateral) | el mismo `POST /v1/transfers`; la respuesta manda (201 → W12, 202 → W10) |
| | 2 | Modificar datos | botón (secundario) | vuelve a W08 |
| Cuentas propias | 1 | Confirmar transferencia (o «Continuar a verificación» si se prevé código) | botón (primario, icono send) | como arriba |
| | 2 | Modificar datos | botón (secundario) | vuelve a W08 |
| Enviando | — | — | — | WF-T5: mientras el `POST` está en vuelo la revisión cede su lugar a W11-V1 «Enviando transferencia» (ver W11); un solo POST |

## W13 · Saldo insuficiente y límite diario (WF-T4)

Sólo tras un 422 «Saldo insuficiente.» o 429 «Se excedió el límite diario.» del servidor (en create o en confirm). Tras el
rechazo se leen `GET /v1/accounts` y `GET /v1/transfer-policy` (sólo lectura). Alerta `role="alert"`.

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Saldo / límite (create) | 1 | Modificar monto | botón (primario, icono edit) | vuelve a W08 con todos los valores y foco en el importe; sin petición |
| | 2 | Volver al inicio | enlace (secundario) | ruta `/accounts` |
| Saldo / límite (confirm) | 1 | Modificar monto | botón | ruta `/transfers/new` con los datos del intento en el estado de navegación (el registro local ya fue borrado por la lógica existente); foco en el importe |
| | 2 | Volver al inicio | enlace | `/accounts` |

## W10 · Código de confirmación (WF-T5)

`/transfers/{id}/status` con `status = awaiting_confirmation` (y `expired`/`cancelled` del servidor). Contenido tras el shell.
Un solo `input` accesible («Código de confirmación de 6 dígitos», `autocomplete="one-time-code"`); las 6 casillas son
`aria-hidden`. Botones deshabilitados con su razón visible enlazada (`aria-describedby`). Sin «Solicitar nuevo código»
(E-W10-1, sin endpoint) y sin «Volver a revisar» (D-12 diferido, E-W10-2).

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Vacío / incompleto | 1 | Código de confirmación de 6 dígitos | input | escribir o pegar; sólo dígitos, máx. 6 |
| | — | Autorizar transferencia | botón deshabilitado | razón «Al completar los 6 dígitos se habilitará la autorización.» |
| Completo / incorrecto | 1 | Código de confirmación de 6 dígitos | input | como arriba (tras «Código incorrecto» recibe el foco con el texto seleccionado) |
| | 2 | Autorizar transferencia de {importe} | botón (primario, icono candado) | `POST /v1/transfers/{id}/confirm` con la clave por (intento, código) de la lógica existente; 200 → W12; 422 «Código incorrecto.» → V8; 422 «El código expiró.» → `GET /v1/transfers/{id}` → V9 si `expired`; 429 «Se agotaron los intentos.» → V10; 422 saldo / 429 límite → W13; 409 → `GET` → estado real (W12 si `completed`); sin respuesta/5xx → aviso «No se confirmó la respuesta. Puedes reintentar el mismo código.» |
| Verificando | 1 | Código de confirmación de 6 dígitos | input `readonly` | — |
| | — | Verificando… | botón deshabilitado | razón: estado «Validando código… Por favor no cierres ni recargues esta ventana.» (`role="status"`) |
| Expirado / cancelado (servidor) | — | Código / Autorizar transferencia | input y botón deshabilitados | razón «Autorización deshabilitada: el código expiró.» / «…: el intento se canceló.» |
| | 1 | Volver al inicio | enlace (primario, icono home) | ruta `/accounts` (el registro local no se toca) |
| Intentos agotados | — | Código / Autorizar transferencia | input y botón deshabilitados | razón «Autorización deshabilitada: intentos agotados» |
| | 1 | Volver al inicio | enlace (primario) | ruta `/accounts` |

Cuenta regresiva (sólo presentación) desde `expiresAt`; al llegar a `00:00` hace **un** `GET /v1/transfers/{id}` y sólo
muestra V9 si el servidor responde `expired`. Tras V10 se relee `GET /v1/accounts` (saldo disponible actual).

## W11 · Enviando, verificando resultado y resultado desconocido (WF-T5)

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Enviando (V1, `POST /v1/transfers` en vuelo) | — | Enviando transferencia… | botón deshabilitado (`role="status"` en su texto) | ninguno; un solo POST |
| Verificando (V2) | — | Consultando… / Reintentando el mismo envío… | botón deshabilitado | razón: el texto del estado (`role="status"`) |
| | 1 | Volver al Inicio (conservarás un aviso visible para retomar la verificación) | enlace | ruta `/accounts`; el registro local se conserva y W03 muestra el aviso |
| Resultado desconocido (V3) en `/transfers/new` | 1 | Reintentar el mismo envío | botón (primario) | el mismo `POST /v1/transfers` con la clave y el cuerpo del registro (lógica existente) |
| | 2 | Volver al Inicio (…) | enlace | como arriba |
| Resultado desconocido (V3) en `/transfers/{id}/status` (lectura fallida) | 1 | Consultar estado | botón (primario) | `GET /v1/transfers/{id}` (sólo lectura) |
| | 2 | Volver al Inicio (…) | enlace | como arriba |

V2 aparece al montar `/transfers/new` con registro (acción existente: `GET` si hay `transferId`, mismo `POST` si no) y mientras
corre «Reintentar el mismo envío». La nota de la tarjeta nombra la acción real (W11-F1).

## W12 · Comprobante (WF-T5)

| Estado | # | Nombre accesible | Tipo | Efecto |
|---|---|---|---|---|
| Beneficiario / propias | 1 | Copiar folio | botón (icono) | portapapeles: folio completo (`receiptReference ?? id`); anuncia «Folio copiado» (`role="status"`) |
| | 2 | Volver al inicio | enlace (primario, icono home) | ruta `/accounts` |
| | 3 | Ver movimientos | enlace (contorno, icono recibo) | ruta `/accounts/{sourceAccountId}/movements` (FN-12) |

Saldos actuales con `GET /v1/accounts` (se relee al pasar a `completed` en la misma vista). Sin peticiones de escritura.

## Pantallas (pendiente por tanda)

Ninguna: W01–W14 inventariadas (WF-T6 hace el barrido transversal).
