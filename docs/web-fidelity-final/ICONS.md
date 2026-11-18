# Iconos SVG inline (`web/src/icons.tsx`)

- Componente `Icon({ name, size = 20 })`: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
  focusable="false">`, 20 px por defecto. Nunca se carga la fuente Material Symbols ni ningún CDN.
- **Origen y licencia**: los trazos se transcribieron de **Google Material Icons** (variantes de 24 px),
  © Google LLC, licencia **Apache License 2.0** (<https://www.apache.org/licenses/LICENSE-2.0>). Se usan
  como equivalentes de los Material Symbols que aparecen en las referencias Stitch aprobadas; no se copia
  HTML de los exports.

| Nombre (`IconName`) | Material Icon equivalente | Uso previsto |
|---|---|---|
| `wallet` | account_balance_wallet | marca (tile), saldo consolidado |
| `bank` | account_balance | navegación «Inicio» |
| `receipt` | receipt_long | navegación «Movimientos», vacíos de historial |
| `contacts` | contacts | navegación «Beneficiarios» |
| `send` | send | navegación «Transferir», CTA transferir |
| `swap` | swap_horiz | «Mover entre mis cuentas» |
| `logout` | logout | «Cerrar sesión» / «Salir» |
| `mail`, `lock`, `visibility`, `visibilityOff` | mail, lock, visibility, visibility_off | W01/W02 |
| `search`, `personAdd`, `add`, `group`, `manageSearch` | search, person_add, add, group, manage_search | W04/W06/W07 |
| `arrowForward`, `arrowBack`, `chevronRight`, `expandMore` | arrow_forward, arrow_back, chevron_right, expand_more | acciones y desplegables |
| `calendar`, `restart` | calendar_today, refresh | W03 fecha, reintentos |
| `error`, `priorityHigh`, `info`, `checkCircle` | error, priority_high, info, check_circle | estados |
| `schedule`, `timer`, `syncProblem`, `spinner` | schedule, timer, sync_problem, (arco propio) | W10/W11, aviso pendiente |
| `edit`, `home`, `copy`, `savings` | edit, home, content_copy, savings | W09/W12 |
| `arrowOutward`, `arrowDownward` | arrow_outward, arrow_downward | cargo / abono |
| `lockClock` | lock_clock | W14 sesión vencida |
| `walletOutlined`, `mailOutlined`, `lockOutlined`, `visibilityOutlined`, `visibilityOffOutlined` | account_balance_wallet, mail, lock, visibility, visibility_off — **Material Icons Outlined** | WF-T1: tiles de marca W01/W02/W14, campos y ojo de W01/W02, candado de W14 acceso |
| `lockClockOutlined` (compuesto) | lock (Outlined, sin ojo de cerradura, escalado) + insignia de reloj propia con anillo de separación | WF-T1: W14 sesión vencida |
| `groupOutlined`, `personAddOutlined` (compuestos, `fill-rule: evenodd`; person_add reflejado para dejar el «+» a la derecha como el Material Symbol de las referencias), `helpOutlined`, `errorOutlined`, `report`, `warning`, `folderShared` | group, person_add, help_outline, error_outline — **Material Icons Outlined**; report, warning, folder_shared — Material Icons | WF-T3: vacío de W06, «+ Agregar beneficiario», «Guardar beneficiario», ayuda lateral de W07, banners de CLABE incorrecta / duplicado / destino no disponible, «Ver en directorio» |

`spinner` es un arco simple propio (no Material). Los glifos Unicode usados como icono en pantallas
(`✦ ◌ ↗ ◷ 🔒 ! … ✓ ＋ ◉ →`) se retiran pantalla por pantalla en las tandas WF-T1…T5; WF-T0 los retira del
shell autenticado y de `StatePanel`.

**Variantes outlined (WF-T1).** Las referencias aprobadas usan la fuente Material Symbols con `FILL 0`, es decir
glifos de contorno; las variantes `*Outlined` transcriben los trazos de **Material Icons Outlined** (mismo origen y
licencia Apache-2.0). `lockClockOutlined` es un compuesto propio de varios `<path>`: el candado outlined sin el
ojo de cerradura, un anillo de separación pintado con `--icon-gap` (transparente por defecto; W14 lo fija al color
del círculo contenedor) y una insignia de reloj sólida con las manecillas recortadas (`fill-rule: evenodd`). Se
comparó a 2× contra `w14_sesi_n_vencida/screen.png`. Las variantes rellenas de WF-T0 siguen en el shell.


**WF-T2 (W03/W04/W05).** Mismo origen y licencia (Material Icons / Material Icons Outlined, Apache-2.0):

| Nombre (`IconName`) | Material Icon equivalente | Uso |
|---|---|---|
| `calendarOutlined` | calendar_today (Outlined) | W03 fecha de cabecera, W04 «Desde»/«Hasta» |
| `checkCircleOutlined` | check_circle (Outlined) | W05 tarjeta de estado completada |
| `infoOutlined` | info (Outlined) | W03 aviso «Tu cuenta está creada» |
| `block` | block | W03 sin saldo: «Transferir» deshabilitado |
| `restartAlt` | restart_alt | W04 «Limpiar filtros», «Restablecer búsqueda» |
| `sync` | sync | W04 «Cargar más movimientos» |
| `syncAlt` | sync_alt | W03 «Mover entre mis cuentas» |
| `receiptLongOutlined` | receipt_long (Outlined) | W03/W04 estados vacíos |
| `factCheckOutlined` | fact_check (Outlined) | W03 aviso pendiente: «Retomar verificación» / «Consultar estado» |
| `arrowUpward` | arrow_upward | W04 icono de cargo |
| `unfoldMore` | unfold_more | W04 selector «Cuenta activa» |

Ya existentes reutilizados: `walletOutlined` (saldo consolidado, selector de cuenta), `send` (CTA «Transferir»),
`arrowOutward`/`arrowDownward` (cargo/abono en W03, abono en W04), `syncProblem` (aviso pendiente, error al cargar
más), `manageSearch` (sin resultados), `restart` (reintentos), `chevronRight`/`arrowForward`/`arrowBack`.

**WF-T4 (W08/W09/W13).** Mismo origen y licencia (Material Icons / Material Icons Outlined, Apache-2.0):

| Nombre (`IconName`) | Material Icon equivalente | Uso |
|---|---|---|
| `personOutlined` | person (Outlined) | W08 «A un beneficiario» |
| `check` | check | W08 marca de selección, W09 stepper |
| `calculateOutlined` | calculate (Outlined) | W09 saldo estimado / proyección |
| `tag` | tag | W09 número de referencia |
| `notes` | notes | W09 concepto (icono genérico, (e)) |
| `howToReg` | how_to_reg | W09 destinatario |
| `trendingDown` | trending_down | W13 faltante |
| `trendingFlat` | trending_flat | W09 propias, flujo origen → destino |
| `subdirectoryArrowRight` | subdirectory_arrow_right | W09 propias, cuenta destino |
| `doNotDisturbOnOutlined` | do_not_disturb_on (Outlined) | W13 «Operación no procesada» |
| `pendingOutlined` | pending (Outlined) | W08 «Sin seleccionar» |

Ya existentes reutilizados: `bank`, `syncAlt`, `savings`, `walletOutlined`, `personAddOutlined`, `infoOutlined`, `error`,
`errorOutlined`, `warning`, `report`, `block`, `edit`, `send`, `lockOutlined`, `schedule`, `arrowOutward`, `arrowForward`,
`arrowBack`, `chevronRight`, `checkCircleOutlined`, `receipt`, `add`, `spinner`.

**WF-T5 (W10/W11/W12).** Mismo origen y licencia (Material Icons Outlined, Apache-2.0):

| Nombre (`IconName`) | Material Icon equivalente | Uso |
|---|---|---|
| `shieldOutlined` | shield (Outlined) | W10 «Protege tu código», nota de W11 |
| `gppBadOutlined` | gpp_bad (Outlined) | W10-V10 «Operación suspendida» |
| `copyOutlined` | content_copy (Outlined) | W12 «Copiar folio» |

Ya existentes reutilizados: `lockClockOutlined`, `timer`, `lockOutlined`, `checkCircle`, `checkCircleOutlined`, `infoOutlined`,
`error`, `spinner`, `swap`, `sync`, `syncProblem`, `restart`, `home`, `receiptLongOutlined`, `walletOutlined`, `savings`,
`personOutlined`, `chevronRight`, `check`.
