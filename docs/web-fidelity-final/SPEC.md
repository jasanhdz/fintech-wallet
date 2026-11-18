# SPEC — Ronda Web «fidelidad final» · Billetera MXN

| Campo | Valor |
|---|---|
| Worktree | `/Users/jasanhernandez/Develop/fintech-wallet-web-final` |
| Rama | `feature/web-fidelity-final` |
| SHA base | `f0ed4bc` |
| Contrato vigente | OpenAPI **0.3.0** (`specs/openapi.yaml:4`); 0.4.0 en desarrollo en otra rama → sólo `[P]` |
| Autor | Planner (único archivo escrito: este) |
| Evaluaciones Forge | máximo 3; hallazgos de esta ronda en `docs/web-fidelity-final/FINDINGS.md` (no el global) |

**Precedencia.** Este SPEC gobierna sólo la ronda Web de fidelidad final. No sustituye ni edita `SPEC.md`/`FINDINGS.md` globales (los usa la ronda de recuperación de transferencias). Donde este documento calla, aplican `AGENTS.md`, `docs/challenge.md`, `specs/requirements.md`, `docs/design-mapping.md` y el contrato 0.3.0. Ninguna decisión de este documento cambia reglas financieras, umbral OTP, límites, claves de idempotencia ni el protocolo de recuperación.

---

## 1. Objetivo

Llevar cada pantalla y estado Web W01–W14 a fidelidad con la referencia Stitch **aprobada** (una por estado, elegida y justificada aquí), con funcionalidad real conectada a la API 0.3.0, tipografía Inter cargada de verdad, responsive (1440, 1280-referencia, 768, 390) y accesibilidad verificables, sin claims ni datos ilustrativos de los exports, y dejando inventariado —sin modificarlo— el comportamiento actual ante respuestas perdidas, con los riesgos de doble débito escalados al coordinador.

## 2. Scope

### 2.1 Incluido
- Presentación y comportamiento de UI de `web/src/**` para W01–W14 (estados listados en §7.2).
- Shell autenticado único (sidebar/topbar/navegación inferior), tokens visuales, iconos SVG inline, fuente Inter auto-hospedada.
- Consumo de endpoints **ya existentes** de 0.3.0 que hoy la Web no usa: `GET /v1/transfer-policy`, `Movement.counterparty`, `Beneficiary.ownAccountId`, `Transfer.expiresAt`, estados `expired`/`cancelled`, `POST /v1/transfers/{id}/cancel` (sólo en W10 «Volver a revisar», §5.9 D-12).
- Historial con «Cargar más» acumulativo y filtros de fecha por día de negocio.
- Arnés de pruebas propio de la ronda en `web/e2e-final/**` (Playwright), pruebas unitarias en `web/tests/**`, entorno aislado (PostgreSQL propio en 55433, APIs 3301–3304, Web 5301–5304).
- Documentación de la ronda en `docs/web-fidelity-final/**` y evidencia en `docs/evidence/web-final/**`.

### 2.2 Excluido
- SPEI/bancos externos, CEP/Banxico, KYC, garantías técnicas o de cifrado, inversiones, biometría, programación, exportación, gestión de límites, «Frecuentes»/rankings, «Sin costo de comisión»/comisiones/IVA, reloj en vivo, campana/ayuda decorativas, simuladores de estados y consolas QA dentro del producto.
- Rediseño del protocolo de recuperación, cambios de claves de idempotencia, borrado de intentos inciertos, nuevos reenvíos automáticos, uso de coincidencias en historial o de un 404 como prueba de no cargo (§7.3).
- Cualquier edición fuera de propiedad: `api/**`, `mobile/**`, `packages/shared/**`, `specs/openapi.yaml`, migraciones, cualquier `package.json`/lockfile, CI, `playwright.config.ts` raíz, scripts raíz de QA, `SPEC.md`/`FINDINGS.md` globales, `docs/design-mapping.md` y demás docs de producto del coordinador. Necesidades de ese tipo → §5.12 (dependencias).
- Integración con contrato 0.4.0 (`GET /transfer-attempts`, `void`, `void-all`, cabeceras `Transfer-Attempt-Id`/`Transfer-Send-Epoch`, `TransferPolicy.sendEpoch`, tipos de problema nuevos): sólo se lista como `[P]`.
- `npm ci`/`npm install` en el worktree (el `node_modules` raíz es symlink al checkout principal), `npm run test:e2e`/`test:visual` raíz (apuntan a la `wallet_test` del contenedor 55432), contenedor `fintech-wallet-postgres-1`, Lucem (`lucem-retail-db-1`, 5432), puertos 3200/5174/8083, `docker compose down -v`, fast-forward del checkout principal, deploy/túneles.

### 2.3 Propiedad de archivos en esta ronda
Editable: `web/**` excepto `web/package.json`; `docs/web-fidelity-final/**` (salvo este SPEC, que sólo edita el Planner); `docs/evidence/web-final/**`. El Evaluador sólo escribe `docs/web-fidelity-final/FINDINGS.md` y `docs/evidence/web-final/eval-<sha>/**`.

---

## 3. User flows (entradas → salidas)

Todas las llamadas usan `VITE_API_URL` (`http://127.0.0.1:330X/v1` en pruebas), Bearer en memoria, cookie de refresh HttpOnly y CSRF según el código actual. Importes en unidades menores como cadena; nunca `Number`/`parseFloat` para dinero.

| # | Flujo | Entradas | Salidas |
|---|---|---|---|
| UF-1 | Acceso (W01) | email, contraseña; `GET /auth/csrf`, `POST /auth/login` | 200 → `/accounts`; 401 → error credenciales; 429 → estado rate-limited; red → sin conexión; validación cliente por campo |
| UF-2 | Registro (W02) | nombre, email, contraseña, confirmación (sólo cliente); `POST /auth/register` | 201 → `/accounts` (W03 «sin saldo» o con cuentas); 409 → email no disponible; validación |
| UF-3 | Inicio (W03) | `GET /accounts`, `GET /accounts/{first}/movements?limit=3`, `GET /transfer-policy`, lectura read-only del registro local de intento | Saldo consolidado (suma bigint), tarjetas por cuenta, actividad reciente, aviso de operación pendiente si hay registro local |
| UF-4 | Historial (W04) | `accountId`, tipo (Todos/Entradas/Salidas), Desde/Hasta (día de negocio), cursor | Tabla acumulativa de 20 en 20; vacío; sin resultados; cargando; error inicial; error al cargar más conservando filas |
| UF-5 | Detalle (W05) | `transferId` de una fila propia → `GET /transfers/{id}` | Comprobante interno; recibidas de terceros → detalle inline desde la fila (sin GET ajeno) |
| UF-6 | Beneficiarios (W06) | `GET /beneficiaries`, búsqueda local | Tarjetas; vacío; sin resultados; «Transferir» → `/transfers/new?beneficiaryId=` |
| UF-7 | Alta (W07) | nombre, alias, CLABE; `POST /beneficiaries` | 201 → directorio con aviso; 400/422 → campos; checksum cliente; 409 duplicado; 404 destino no disponible; 5xx/red → error recuperable conservando datos |
| UF-8 | Transferencia (W08→W09) | origen, tipo destino, beneficiario o cuenta propia, importe, concepto, referencia; `GET /transfer-policy` | Revisión W09 con los mismos valores exactos que se enviarán; variante «requiere código» si `amountMinor >= otpThresholdMinor` |
| UF-9 | Envío (W11→W12/W10/W13) | `POST /transfers` con `Idempotency-Key` del registro local (lógica actual intacta) | 201 → W12; 202 → W10; 422/429 → W13; otro error/sin respuesta → W11 resultado desconocido |
| UF-10 | Código (W10) | 6 dígitos; `POST /transfers/{id}/confirm` (clave por código, lógica actual) | 200 → W12; 422 «Código incorrecto.»; 422 «El código expiró.»/estado `expired`; 429 «Se agotaron los intentos.»; 422 saldo / 429 límite → W13; 409 → `GET` y estado real |
| UF-11 | Volver a revisar desde W10 | `POST /transfers/{id}/cancel` | 200 `cancelled`/`expired` → W08 con datos y registro local liberado por la lógica existente de estado terminal; 409 → `GET` → W12 si `completed`; error → permanece en W10 con aviso |
| UF-12 | Sesión/permisos (W14) | 401 sin refresh posible; 403; 404 de recurso por id | Tarjeta «Tu sesión venció» (con resumen seguro del intento si existe); tarjeta «Acceso no disponible» sin revelar existencia |

---

## 4. Modelo de datos (cliente)

Sin cambios de contrato ni de persistencia servidor. La Web consume tipos de `@fintech-wallet/shared` (`ProductComponents['schemas']`).

- **Account** `{id, name, kind: checking|savings, currency: MXN, availableBalanceMinor, clabe, clabeMasked}` — `clabe` nunca se muestra completa; para UI se usa `maskTail(clabeMasked)` → `•••• 1234` (últimos 4).
- **Beneficiary** `{id, name, alias, clabeMasked, destinationAccountId, ownAccountId?, isFrequent?}` — `isFrequent` se ignora (no se muestra ni ordena).
- **Transfer** `{id, status: awaiting_confirmation|processing|completed|rejected|expired|cancelled, sourceAccountId, destination: Beneficiary|Account, amountMinor, currency, concept, reference, createdAt, completedAt?, expiresAt?, receiptReference?, requestId?, demoOnlyCode?}`. Los tipos locales de `web/src/transfers.tsx`/`movements.tsx` se amplían para incluir `expired`/`cancelled`/`expiresAt` (derivados del tipo compartido, no duplicados a mano).
- **Movement** `{id, transferId?, type: debit|credit, amountMinor, currency, concept, reference, status, occurredAt, counterparty?: {name, clabeMasked, ownAccountId?}}`.
- **TransferPolicy** `{currency, businessDate, businessTimeZone, dailyLimitMinor, dailyUsedMinor, dailyRemainingMinor, otpThresholdMinor, otpExpirySeconds, otpMaxAttempts, demoOnly}` — query `['transfer-policy', userId]`, `staleTime: 0`; ninguna cifra se fija en código.
- **Registro local de intento (sin cambios)** `sessionStorage['wallet:web:transfer-attempt:<userId>'] = {key, body, transferId?}` y `sessionStorage['wallet:web:active-user']`. Prohibido cambiar nombre de clave, formato, momentos de escritura/borrado o generación de `key`. Se permite **un** accesor read-only nuevo en `web/src/transfer-attempt.ts`, p. ej. `readActiveTransferContext(): { summary: TransferAttemptSummary; hasTransferId: boolean } | null`, que no expone `key`, ids ni escribe/borra nada.
- **Fixtures de prueba** (`web/e2e-final/fixtures/*.ts`): constructores tipados con `satisfies ProductComponents['schemas'][...]`; datos sintéticos genéricos («Persona Prueba Uno», `@example.test`, CLABEs generadas con checksum válido en el test); nunca nombres/cifras de los exports (§7.1 SC-02). Nunca se importan desde `web/src`.
- **Inventario de acciones** `docs/web-fidelity-final/actions-inventory.md`: por pantalla/estado, cada botón/enlace visible con `{nombre accesible, tipo, efecto esperado (ruta | petición | cambio de estado | portapapeles), orden de tabulación}`.
- **Manifiesto de evidencia** `docs/evidence/web-final/<sha>/captures-manifest.tsv`: `escenario, pantalla, estado, nivel, viewport WxH, DPR, archivo, sha256, referencia aprobada`.

---

## 5. Stack y decisiones técnicas concretas

### 5.1 Base
React 19 + Vite 8 + react-router 7 + TanStack Query 5 (ya instalados). Sin dependencias nuevas. Playwright 1.65.1 y Chromium `chromium-1248` ya en disco (`~/Library/Caches/ms-playwright/chromium-1248`). Node exigido por `.nvmrc` `26.13.1` (registrar `node -v`; si difiere, la evidencia lo marca y los FAIL de runtime se tratan como BLOCKED, como en `docs/qa-round5.md`).

### 5.2 Selección de referencias (regla)
Por estado se aprueba **una** carpeta de `/Users/jasanhernandez/Develop/fintech-wallet/design/web/` con este orden de precedencia: (1) la usada como referencia en `docs/design-fidelity-round4.md`/`docs/qa-round5.md`; (2) la variante sin simulador/consola QA ni claims excluidos por `docs/design-mapping.md` §«Alcance externo y claims»; (3) la familia coherente con las variantes de estado del mismo ID. Las demás quedan **descartadas** (se pueden consultar sólo como lista funcional de estados). `docs/design-mapping.md` no designa una iteración aprobada por estado (las lista todas como fuentes inspeccionadas); esta ronda fija la elección en §7.2(a).

### 5.3 Tamaño equivalente de referencia
Todas las referencias aprobadas están maquetadas a **1280 px CSS** de ancho (sidebar `w-72`=288 o `w-64`=256 CSS medidos en el PNG: 360 px en PNG de 1600 → DPR 1.25; 512 px en PNG de 2560 → DPR 2). Para cada referencia: `sips -g pixelWidth -g pixelHeight <png>` → `DPR = ancho/1280`, viewport `1280 × (alto/DPR)`, `deviceScaleFactor = DPR`. Medidos en esta planeación: PNG 1600×1280 → 1280×1024 @1.25 (W01, W02, W04, W06, W07 agregar, W08 base, W09, W10 de confirmación/completo/incompleto, W11, W12 850, W13, W14); `w03_operaci_n_pendiente_de_verificaci_n` 2560×2248 → 1280×1124 @2; `w10_intentos_agotados` 2560×2048 → 1280×1024 @2; `w12_comprobante_entre_cuentas_propias` 2560×2160 → 1280×1080 @2. Las alturas no listadas se miden con `sips` y se registran en el manifiesto.

### 5.4 Tokens (fuente: tokens YAML de `design/web/billetera_mxn/DESIGN.md` + `tailwind.config` de los HTML aprobados; la paleta narrativa queda descartada, `docs/design-mapping.md` contradicción 1)
- **Color**: surface `#f9f9ff`; lienzo auth `#f6f8fb` (W01/W02); lowest `#ffffff`; container-low `#f1f3ff`; container `#e9edff`; container-high `#e0e8ff`; container-highest `#dbe2f9`; on-surface `#141b2c`; on-surface-variant `#434655`; outline `#747686`; outline-variant `#c4c5d7`; primary `#0037b0`; primary-container `#1d4ed8`; on-primary `#ffffff`; secondary `#006d40`; secondary-container `#98f6bb`; on-secondary-container `#007345`; tertiary `#7a2b00`; tertiary-fixed `#ffdbcd`; error `#ba1a1a`; error-container `#ffdad6`; on-error-container `#93000a`.
- **Tipografía** (Inter, px/line-height/peso/tracking): display-currency 40/48/600/-0.02em (≤767: 32/40); headline-lg 30/38/600/-0.015em (≤767: 24/32/-0.01em); headline-md 20/28/600/-0.01em; headline-sm 16/24/600; body-lg 16/24/400; body-md 14/20/400; body-md-medium 14/20/500; body-sm 12/18/400; body-sm-medium 12/18/500; label-caps 11/16/600/0.04em mayúsculas; code-data 13/18/400/0.02em. Importes y CLABE: `font-variant-numeric: tabular-nums`.
- **Radios**: 8 px (inputs del shell, ítems pequeños), 12 px (tarjetas, botones, ítems de navegación), 16 px (tarjeta auth W01/W02, tarjetas de cuenta W03), 9999 px (chips, avatares). Inputs auth 10 px.
- **Sombras**: tarjeta `0 1px 2px 0 rgba(0,0,0,0.05)`; shell `0 1px 8px rgba(0,0,0,0.04)`; botón primario `0 1px 4px rgba(29,78,216,0.2)`.
- **Controles**: altura 44 px; botón primario bg `#1d4ed8`/texto `#fff`/14 px 500/hover `#0037b0`; secundario bg `#e0e8ff`/texto `#141b2c`; contorno bg `#fff` + borde 1 px `#c4c5d7`; deshabilitado bg `#e0e8ff` texto `#747686`. Input shell: bg `#f1f3ff`, sin borde visible, radio 8, foco bg `#fff` + anillo 2 px `#1d4ed8`; inválido: anillo inset 2 px `#ba1a1a` + icono error. Input auth: bg `#fff`, borde 1 px `#e2e8f0`, radio 10, foco borde `#1d4ed8` + anillo `rgba(29,78,216,0.1)`.
- **Chips**: completado bg `#98f6bb` texto `#007345`; pendiente bg `#ffdbcd` texto `#7a2b00`; error bg `#ffdad6` texto `#93000a`; neutro bg `#e9edff` texto `#434655`; demostración bg `#e0e8ff` texto `#0037b0` (12/500). Todos con texto (nunca sólo color).
- Implementación: variables CSS en `web/src/style.css` (`--color-*`, `--radius-*`, `--shadow-*`, clases de tipografía). Se elimina `'DM Sans'` y `!important` de headings.

### 5.5 Fuente Inter (carga real, sin CDN)
Se auto-hospedan **Inter 400/500/600/700** copiando los TTF OFL de `@expo-google-fonts/inter@0.4.2` (ya en el `node_modules` raíz, dependencia de mobile) a `web/public/fonts/inter/Inter-{400,500,600,700}.ttf` junto con su `LICENSE_FONT` como `web/public/fonts/inter/OFL.txt`. `@font-face` por peso con `font-display: swap`; `<link rel="preload" as="font" type="font/ttf" crossorigin>` para 400 y 600 en `web/index.html`. Prohibido Google Fonts/CDN en producto. Alternativa sólo si el coordinador la pide: `@fontsource/inter` (dependencia, §5.12 DEP-1).

### 5.6 Iconos
`web/src/icons.tsx`: componentes SVG inline (viewBox 24, `currentColor`, 20 px por defecto, `aria-hidden="true"`, `focusable="false"`) equivalentes a los Material Symbols usados por las referencias aprobadas: wallet (marca), inicio, recibo (movimientos), contactos, transferir, logout, mail, lock, visibility/visibility_off, search, person_add, add, arrow_forward, arrow_back, chevron_right, expand_more, calendar, restart, error, priority_high, info, check_circle, schedule/timer, sync_problem, spinner, edit, home, content_copy, savings, arrow_outward/arrow_downward (cargo/abono), lock_clock, group, manage_search. Se retiran los glifos Unicode usados como icono (`✦ ◌ ↗ ◷ 🔒 ! … ✓ ＋ ◉ →`). Atribución de origen (si se transcriben trazos Material Symbols, Apache-2.0) en `docs/web-fidelity-final/ICONS.md`. No se carga la fuente Material Symbols.

### 5.7 Shell autenticado único (decisión D-1)
Los exports usan dos shells (`w-72` en W03–W06, `w-64` en W07–W14). Se unifica en el de **W03 `w03_inicio_y_cuentas_corregido`** (pantalla de inicio aprobada): sidebar 288 px blanco con sombra de shell; bloque de marca 64 px (tile wallet + «Billetera MXN» 16/600 + «DEMOSTRACIÓN» label-caps sólo si `policy.demoOnly`); navegación en orden **Inicio, Movimientos, Beneficiarios, Transferir** (ítems 12 px de radio, `py-2.5 px-4`, activo bg `#1d4ed8` texto blanco); tarjeta de usuario inferior (avatar con iniciales, nombre, `Cuenta •• 1234` de la primera cuenta) y «Cerrar sesión»; topbar 64 px (`left: 288`, fondo `rgba(255,255,255,0.9)`) con «Billetera MXN» + chip «Demostración» (sólo si `policy.demoOnly`) a la izquierda y avatar 32 + nombre + botón icono «Cerrar sesión» a la derecha. Sin reloj, campana ni ayuda. `<1024 px`: sidebar oculto, topbar a ancho completo y navegación inferior fija con los 4 destinos + «Salir». El área de contenido se compara con cada referencia; la diferencia de shell (256 vs 288 px) en W07–W14 es excepción global E-G1.

### 5.8 Etiquetado demo (decisión D-2)
«Demostración»/«(demostración)» sólo aparece si `GET /transfer-policy` devuelve `demoOnly: true` (dato real del servidor). Páginas sin sesión (W01, W02, W14) no muestran chip (no hay dato sin autenticación) → excepción E-G2. El código OTP de demostración sólo se muestra si la respuesta trae `demoOnlyCode`.

### 5.9 Decisiones de producto de la ronda
- **D-3** Importes: `formatMxnFromMinor` (shared) y un helper web `splitMxn(minor) → {sign, number, suffix:'MXN'}` para pintar el sufijo un paso tipográfico menor. Exactamente un «MXN» por importe.
- **D-4** Fecha/hora: `Intl.DateTimeFormat('es-MX')` en `policy.businessTimeZone` si está cargada (si no, zona del navegador), sin sufijo «CST». Fechas de filtro W04: límites `[00:00, 24:00)` del día de negocio en esa zona convertidos a UTC con `Intl` (sin librerías).
- **D-5** No se bloquea en cliente por saldo o límite (servidor autoritativo; W13 debe ser alcanzable). Sólo validaciones de formato.
- **D-6** Predicción OTP en W09: `BigInt(amountMinor) >= BigInt(policy.otpThresholdMinor)`; si la política no cargó, texto neutro «Puede requerir un código de confirmación» y CTA «Confirmar transferencia»; la respuesta (201/202) manda siempre.
- **D-7** Origen ≠ destino por identidad: cuenta propia → la cuenta origen aparece deshabilitada como destino con la razón visible; beneficiario con `ownAccountId === sourceAccountId` (o `destinationAccountId === sourceAccountId`) → deshabilitado con razón. Beneficiario que resuelve a **otra** cuenta propia es válido.
- **D-8** Selección en W08: tarjetas-resumen de la selección actual + listas `role="radiogroup"` desplegables («Cambiar cuenta», «Buscar otro beneficiario»). Origen por defecto: `?source=` o primera cuenta; beneficiario por `?beneficiaryId=`; tipo por `?type=own_account`.
- **D-9** Historial con `useInfiniteQuery` (acumula páginas; «Cargar más» añade; error en página N conserva páginas previas).
- **D-10** Detalle de movimientos recibidos de terceros (`credit` sin `counterparty.ownAccountId`): panel inline expandible en la fila (`aria-expanded`), sin `GET /transfers/{id}` (sería 404 por propiedad). Movimientos propios → W05.
- **D-11** 404 en rutas por id (`/transfers/:id/*`, `/accounts/:id/movements`) y 403 → tarjeta W14 «Acceso no disponible» (no revela existencia). Nunca borra ni modifica el registro local.
- **D-12** W10 «Volver a revisar» = `POST /transfers/{id}/cancel` → sólo con 200 `cancelled|expired` se vuelve a W08 con los datos; 409 → `GET` y estado real; fallo → se queda en W10. «Solicitar nuevo código» **no** se implementa (no existe endpoint de reenvío en 0.3.0) → excepción E-W10-1.
- **D-13** Folio: `receiptReference ?? id` completo, `code-data`, con salto de línea permitido; botón «Copiar folio» con confirmación `role="status"`.
- **D-14** Copias de exports reformuladas sólo cuando el texto original es falso o excluido (lista en cada (e)).

### 5.10 Entorno de pruebas aislado (obligatorio)
- **Disco**: antes de crear volumen o compilar, `df -h /System/Volumes/Data` ≥ 2.5 GiB libres y `docker system df` registrado; si < 2.5 GiB → detener y reportar BLOCKED.
- **PostgreSQL propio**: imagen local `postgres:16.10-alpine`; contenedor `fintech-wallet-web-pg`; volumen nombrado `fintech-wallet-web-pg-data`; `-p 127.0.0.1:55433:5432`; `POSTGRES_PASSWORD` generado al vuelo (no se imprime); `-v <worktree>/scripts/db/init.sql:/docker-entrypoint-initdb.d/001-init.sql:ro`. Ese init crea también una `wallet_dev` **dentro de este contenedor**; nunca se usa. Migraciones: `npm run db:migrate:test` con `TEST_DATABASE_URL=postgres://wallet_runtime_test:test_runtime_local_only@127.0.0.1:55433/wallet_test` y `TEST_MIGRATOR_DATABASE_URL=postgres://wallet_migrator_test:test_migrator_local_only@127.0.0.1:55433/wallet_test` (pasan `api/src/db/test-database-guard.ts`).
- **Variables**: archivo `.env.web-final` en la raíz del worktree (ignorado por `.env.*`), generado por `web/e2e-final/scripts/make-env.mjs` con secretos aleatorios (`JWT_ACCESS_SECRET`, `REFRESH_TOKEN_PEPPER`, `CLABE_ENCRYPTION_KEY`, `CLABE_LOOKUP_KEY`); **todas** las variables `*DATABASE_URL*` exportadas explícitamente a 55433 (`MIGRATOR_DATABASE_URL` a un destino inválido `postgres://none@127.0.0.1:1/none`). No se lee ni modifica el `.env` existente del worktree. `web/e2e-final/scripts/preflight.mjs` falla si alguna `*DATABASE_URL*` contiene `:55432`, `:5432/` o `wallet_dev`, si no existe el contenedor `fintech-wallet-web-pg`, o si algún puerto de §5.10 está ocupado.
- **Perfiles de API** (`npx tsx api/src/server.ts`, sin `watch`, `APP_ENV=development`, `DATABASE_URL` = wallet_test 55433, `WEB_ORIGIN=http://127.0.0.1:530X`, `BUSINESS_TIME_ZONE=America/Mexico_City` demo):

| Perfil | API | Web | Ajustes demo (sólo en este proceso) | Uso |
|---|---|---|---|---|
| P1 | 3301 | 5301 | `DEMO_FIXTURE_ENABLED=true`, defaults `.env.example` (límite 2000000, umbral 500000, expiración 300, intentos 5) | flujos principales, OTP, own/beneficiario |
| P2 | 3302 | 5302 | `DEMO_FIXTURE_ENABLED=false` (1 cuenta, saldo 0) | W02, W03 sin saldo, W08 sin segunda cuenta, W13 saldo |
| P3 | 3303 | 5303 | fixture on, `OTP_EXPIRY_SECONDS=5`, `OTP_MAX_ATTEMPTS=2` | W10 expirado/agotados |
| P4 | 3304 | 5304 | fixture on, `DAILY_TRANSFER_LIMIT_MINOR=100000` | W13 límite |

  3305–3309/5305–5309 reservados. Los ajustes son configuración de prueba del proceso, no cambian reglas ni código.
- **Web**: build estático por perfil, sin compartir caché con la demo: `npm --workspace @fintech-wallet/web exec -- vite build --outDir dist/pX --emptyOutDir` con `VITE_API_URL=http://127.0.0.1:330X/v1` y `WEB_VITE_CACHE_DIR=node_modules/.vite-web-final`; `vite preview --outDir dist/pX --host 127.0.0.1 --port 530X --strictPort`. `web/vite.config.ts` añade `cacheDir: process.env.WEB_VITE_CACHE_DIR || undefined` (`web/dist/` ya ignorado).
- **Playwright de la ronda**: `web/e2e-final/playwright.config.ts` (proyectos `final` = `web/e2e-final/**/*.spec.ts`, `legacy` = `web/e2e/**/*.spec.ts` apuntado a P1), `workers: 1`, `outputDir` y capturas en `docs/evidence/web-final/<sha>/captures/` (ignorado por `**/captures/`). Ejecución: `npx playwright test -c web/e2e-final/playwright.config.ts`.
- **Limpieza**: `docker stop fintech-wallet-web-pg && docker rm fintech-wallet-web-pg && docker volume rm fintech-wallet-web-pg-data` (sólo esos nombres). Documentado en `docs/web-fidelity-final/ENVIRONMENT.md`.

### 5.11 Método de comparación visual
No hay herramienta de pixel-diff aprobada. Se combinan: (1) aserciones automáticas de geometría/estilo computado (§7.0); (2) composición lado a lado generada por el propio test: página `about:blank` que muestra la referencia (leída de `/Users/jasanhernandez/Develop/fintech-wallet/design/web/<carpeta>/screen.png` como data URL) y la captura del producto a la misma escala; se guarda como `<ID>-<estado>-sbs.png` (no versionado); (3) métrica informativa de diferencia de píxeles por canvas (no es criterio). El Evaluador abre cada composición (Read del PNG) y registra diferencias por categoría (§7.0 «Diferencia material»). Para variantes sin PNG, la referencia es el `code.html` local renderizado por el test sin red (puede no cargar fuentes/Tailwind de CDN: se comparan estructura y copia).

### 5.12 Dependencias para el coordinador (no bloquean salvo indicación)
- **DEP-1** Fuente: aprobar el vendoring OFL de Inter desde `@expo-google-fonts/inter@0.4.2` o, alternativamente, añadir `@fontsource/inter` (versión exacta) a `web/package.json` + lockfile.
- **DEP-2** Tipos de problema RFC 7807 específicos para OTP incorrecto/expirado/agotado, saldo insuficiente y límite diario (hoy `about:blank` + `detail`); la Web mapea por `status`+`detail` literal de `api/src/transfers/service.ts` (frágil).
- **DEP-3** Endpoint de reenvío de OTP (no existe) para «Solicitar nuevo código».
- **DEP-4** Decisión sobre hallazgos H-W1…H-W5 (§7.3); cualquier cambio de protocolo pertenece a la ronda de recuperación/0.4.0.
- **DEP-5** Opcional: `@axe-core/playwright` (versión exacta) para auditoría a11y automática adicional; la ronda usa comprobaciones propias.
- **DEP-6** Opcional: incluir `web/e2e-final` en CI (CI es del coordinador).
- **DEP-7** Integración 0.4.0 en Web (lista `[P]` §7.3.4).

---

## 6. Assumptions

- **A-1** El worktree está en `f0ed4bc` y lo leído en `web/src` refleja ese SHA; si el Generator encuentra divergencias, registra el SHA real en la evidencia.
- **A-2** Las referencias aprobadas son las de §7.2(a); los PNG se leen del checkout principal sin modificarlos ni copiarlos al repo (las copias saneadas de `docs/design/references/round3/source/` pueden citarse).
- **A-3** Ancho de referencia 1280 CSS con DPR derivado (§5.3).
- **A-4** El contrato 0.3.0 y los `detail` de error del servidor no cambian durante la ronda.
- **A-5** Docker Desktop está disponible y la imagen `postgres:16.10-alpine` está en disco; si no, BLOCKED (no se descargan imágenes sin espacio suficiente).
- **A-6** El rate-limit de login existe en la API; su umbral no se conoce desde la Web: W01 rate-limited se valida `[F]`; `[I]` sólo si se consigue sin afectar otros perfiles.
- **A-7** Los textos de error/estado de los exports son copia de UI reutilizable salvo cuando contienen claims o datos ilustrativos.
- **A-8** «Datos reales» = lo que devuelve la API o lo capturado por el usuario; los fixtures `[F]` son sintéticos y sólo viven en pruebas.
- **A-9** La demo del usuario (3200/5174/8083, `wallet_dev`) sigue corriendo y no se toca.
- **A-10** La API nunca escribe `processing`/`rejected` en `transfers` (SPEC global R8.5); por eso W11 se alcanza sólo por pérdida de respuesta o espera, no por estado del servidor.

---

## 7. Rubric

### 7.0 Convenciones
- **Niveles**: `[F]` captura/aserción con fixtures y red simulada (`page.route` sobre `**/v1/**`); `[I]` recorrido real contra API+PostgreSQL de §5.10; `[P]` pendiente por contrato 0.4.0 (no evaluable en esta ronda; sólo se verifica que no haya UI decorativa preparada).
- **Viewports**: `R` = tamaño de la referencia (§5.3); `1440×960`; `768×1024`; `390×844` (DPR 1 salvo `R`). Contexto: Chromium, `locale: es-MX`, `timezoneId: America/Mexico_City`, `reducedMotion: 'reduce'` para capturas, reloj fijo en `[F]`.
- **Tolerancias**: cajas ±2 px; radios ±1 px; tamaño/peso/interlineado de fuente exactos; colores exactos (rgb computado); espaciados de hitos ±4 px.
- **Diferencia material** (cualquiera cuenta, incluidas las «menores»): sección/componente faltante o sobrante, orden distinto, encabezado o etiqueta de acción distinta, jerarquía tipográfica distinta, color/radio/sombra distinto del token, icono faltante o de metáfora distinta, alineación/columna distinta, densidad/espaciado visiblemente distinto, desbordamiento o recorte. No cuentan: datos reales distintos, y lo listado en (e) de cada pantalla o en E-G*.
- Cada criterio es PASS/FAIL. «Wxx-VZ» es el juicio final de lado a lado del Evaluador.

### 7.1 Criterios transversales

**Fuente**
- **FONT-01** `web/public/fonts/inter/` contiene Inter 400/500/600/700 y `OFL.txt`; `style.css` declara 4 `@font-face` (`font-display: swap`, `url('/fonts/inter/…')`). (comando: `ls`, `rg '@font-face' web/src/style.css`)
- **FONT-02** `web/index.html` precarga 400 y 600 con `rel="preload" as="font" crossorigin`. (`rg`)
- **FONT-03** `[F]` En `/login` y `/accounts`, tras `document.fonts.load` de los 4 pesos y `document.fonts.ready`, existen FontFace `Inter` con `status === 'loaded'` para 400/500/600/700, y sus peticiones respondieron 200 desde el mismo origen.
- **FONT-04** `[F][I]` Cero peticiones a `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.tailwindcss.com` u otro host distinto de la Web/API en todos los escenarios.
- **FONT-05** `[F]` `getComputedStyle` de `body`, `h1`, `button`, `input` → `font-family` empieza por `Inter`.
- **FONT-06** `[F]` `document.fonts.check('600 30px Inter') === true` y el ancho medido en canvas de «Billetera MXN» con `600 30px Inter` difiere ≥1 px del medido con `600 30px Arial`.
- **FONT-07** `[F]` Todo elemento `[data-amount]` y toda CLABE enmascarada tiene `font-variant-numeric` con `tabular-nums`.

**Tokens**
- **TOK-01** `style.css` define variables para todos los colores de §5.4 y ningún color hex fuera de ellas en reglas de componentes (excepción: `#f6f8fb`, `#e2e8f0` auth, documentadas). (`rg -o '#[0-9a-fA-F]{3,8}' web/src/style.css` ⊆ lista)
- **TOK-02** `[F]` h1 de cada pantalla autenticada = headline-lg (30/38/600) a ≥768 y 24/32 a 390; títulos de tarjeta = headline-md o headline-sm según (d); etiquetas en mayúsculas = label-caps 11/16/600 con `letter-spacing: 0.44px`.
- **TOK-03** `[F]` Botón primario: bg `rgb(29,78,216)`, texto blanco, alto 44, radio 12, 14 px/500; secundario bg `rgb(224,232,255)`; deshabilitado bg `rgb(224,232,255)` texto `rgb(116,118,134)`.
- **TOK-04** `[F]` Tarjetas: bg blanco, radio 12 (16 donde (d) lo indique), sombra de tarjeta; chips con radio 9999 y colores de §5.4.

**Shell (≥1024 px)**
- **SH-01** `[F]` Sidebar `aside` ancho 288, alto = viewport, bg blanco, `position: fixed`, sombra de shell.
- **SH-02** `[F]` Bloque de marca alto 64 con tile wallet (SVG) y «Billetera MXN» 16/600; «DEMOSTRACIÓN» presente sii la política simulada trae `demoOnly: true` (probar ambos).
- **SH-03** `[F]` Navegación con exactamente 4 enlaces en orden Inicio, Movimientos, Beneficiarios, Transferir; cada uno con SVG 20 px `aria-hidden` y texto 14 px; activo con `aria-current="page"`, bg `rgb(29,78,216)` y texto blanco; inactivos `rgb(67,70,85)`.
- **SH-04** `[F]` Tarjeta de usuario inferior con iniciales (2 letras de `fullName`), nombre y `Cuenta •• NNNN` de la primera cuenta; «Cerrar sesión» ejecuta `POST /auth/logout` y navega a `/login`.
- **SH-05** `[F]` Topbar alto 64, `left` 288, sin reloj/campana/ayuda; botón icono de salir con `aria-label="Cerrar sesión"`; chip «Demostración» sii `demoOnly`.
- **SH-06** `[F]` `<1024`: no hay `aside` visible; navegación inferior fija con 4 destinos + «Salir», cada destino ≥44×44; el contenido tiene `padding-bottom` ≥ alto de la barra + 16.
- **SH-07** `[F]` Primer elemento enfocable: enlace «Saltar al contenido», visible al foco, mueve el foco a `main#contenido`.
- **SH-08** `[F]` `document.title` por ruta: «Iniciar sesión · Billetera MXN», «Crear cuenta · …», «Inicio · …», «Movimientos · …», «Comprobante · …», «Beneficiarios · …», «Nuevo beneficiario · …», «Transferir · …», «Sesión vencida · …», «Acceso no disponible · …».
- **SH-09** `[F]` La marca en sidebar/topbar nunca muestra imagen rota ni el texto «img».

**Responsive**
- **RESP-01** `[F]` En cada escenario capturado a 1440, R, 768 y 390: `document.documentElement.scrollWidth <= window.innerWidth`.
- **RESP-02** `[F]` Ningún elemento visible tiene `getBoundingClientRect().right > innerWidth + 1` (incluye tablas y filtros).
- **RESP-03** `[F]` `<768`: tablas W03/W04 se presentan como filas apiladas que muestran fecha, contraparte, concepto/referencia, estado e importe con su etiqueta; filtros W04 en una o más filas sin desbordar.
- **RESP-04** `[F]` Layouts de dos columnas (W07, W08, W09 código/propias, W10) se apilan `<1024` con el contenido principal primero en DOM y en pantalla.
- **RESP-05** `[F]` A 1440 ningún contenedor de contenido supera 1200 px de ancho.

**Accesibilidad**
- **A11Y-01** `[F]` Orden de tabulación de cada pantalla/estado = el registrado en `actions-inventory.md` (comparación de nombres accesibles en secuencia).
- **A11Y-02** `[F]` Todo enfocable con `:focus-visible` muestra outline o anillo ≥2 px con contraste ≥3:1 contra el fondo adyacente.
- **A11Y-03** `[F]` Todo input/select tiene nombre accesible; con error: `aria-invalid="true"` y `aria-describedby` que incluye el id del mensaje; resúmenes de error `role="alert"`; progreso/éxito `role="status"`.
- **A11Y-04** `[F]` Contraste calculado (helper WCAG en `web/e2e-final/helpers/contrast.ts`) ≥4.5:1 para texto <24 px (<18.66 px bold) y ≥3:1 para texto grande e iconos informativos, en todos los nodos de texto visibles no deshabilitados de cada estado.
- **A11Y-05** `[F]` Zoom 200 % (viewport 640×512) y reflow 320×640: sin scroll horizontal, sin texto recortado (ningún elemento con `overflow: hidden` y `scrollWidth > clientWidth` salvo truncado con valor completo accesible).
- **A11Y-06** `[F]` Escenario «textos largos» (nombre 120, alias 80, concepto 40, nombre de cuenta 40 caracteres) en W03, W04, W06, W08, W09, W12: sin desbordar; si se trunca, el valor completo está en `title` o texto accesible.
- **A11Y-07** `[F]` Todo botón deshabilitado tiene texto visible que explica por qué y está enlazado con `aria-describedby`.
- **A11Y-08** `[F]` Ningún estado se comunica sólo con color: chips con texto, importes con signo `−`/`+`, errores con icono y texto, selección con `aria-pressed`/`aria-checked`.
- **A11Y-09** `[F]` `html[lang="es"]`; exactamente un `h1` por vista; niveles de encabezado sin saltos.
- **A11Y-10** `[F]` Con `reducedMotion: 'reduce'` no hay animaciones (`animation-name: none` o duración 0) en spinners/skeletons.
- **A11Y-11** `[F]` OTP conserva un único `input` accesible (`autocomplete="one-time-code"`, `inputmode="numeric"`), pegado de 6 dígitos funciona y las casillas son `aria-hidden`.

**Funcionalidad real**
- **FN-01** `[I]` P1: login → `/accounts`; recarga mantiene sesión; «Cerrar sesión» → `/login`; volver atrás no muestra datos de cuentas.
- **FN-02** `[I]` P1: alta de beneficiario con la `clabe` real de la cuenta de otro usuario sintético → aparece enmascarado en W06; repetir → W07 duplicado (409); CLABE de 18 dígitos con checksum válido inexistente → W07 destino no disponible (404); checksum inválido → W07 CLABE incorrecta sin petición.
- **FN-03** `[I]` P1: transferencia a beneficiario bajo umbral → 201 → W12 muestra id/folio, importe, concepto y referencia idénticos a la respuesta del `POST`; W03 refleja saldo origen = anterior − importe (comparación bigint de cadenas).
- **FN-04** `[I]` P1: transferencia entre dos cuentas propias distintas → W12 propias; saldos de ambas actualizados en W03.
- **FN-05** `[I]` P1: origen≠destino por identidad (D-7): cuenta origen no seleccionable como destino propio; beneficiario creado con la CLABE de la propia cuenta origen queda deshabilitado con razón visible; el mismo beneficiario con la otra cuenta como origen sí permite transferir (201).
- **FN-06** `[F]` Importe: `''`, `0`, `-1`, `abc`, `10.999`, `1,000` rechazados en cliente con mensaje de W08 (sin petición); `10`, `10.5`, `10.50` aceptados y enviados como `1000`/`1050`/`1050`.
- **FN-07** `[F]` Concepto 1–40 tras `trim` y referencia `^[0-9]{1,7}$` validados con contador visible `n / 40`.
- **FN-08** `[I]` El cuerpo del `POST /transfers` (interceptado sin alterar) es igual campo a campo a lo mostrado en W09, y W09 es igual a lo capturado en W08 (concepto recortado).
- **FN-09** Ningún `parseFloat`, `toFixed`, `Number(` aplicado a importes en `web/src` (`rg -n "parseFloat|toFixed" web/src` = 0; revisión de `Number(`); ningún importe muestra «MXN MXN».
- **FN-10** `[I]` P1: importe ≥ `otpThresholdMinor` leído de la política → W09 variante código → 202 → W10 → código `demoOnlyCode` → W12. Código incorrecto → W10 incorrecto.
- **FN-11** `[I]` P2 → W13 saldo insuficiente (422 en create); P4 → W13 límite (429) con cifras de la política; en ambos, ningún cambio de saldo en W03.
- **FN-12** `[I]` Tras W12, «Ver movimientos» muestra como primera fila la operación recién hecha (concepto, importe, referencia) sin recargar manualmente.
- **FN-13** `[I]` «Ver detalle» de una fila propia abre W05 con `GET /transfers/{transferId de esa fila}` y los mismos importe/concepto/referencia.
- **FN-14** `[F][I]` Prueba de inventario: cada acción de `actions-inventory.md` se activa y produce su efecto documentado; el número de botones/enlaces visibles por estado coincide con el inventario (cero botones decorativos).
- **FN-15** `[I]` Doble clic en «Confirmar transferencia» (W09) emite exactamente un `POST /transfers` (REQ-XFER-08 preservado).
- **FN-16** `rg -n "500000|2000000|5000|20000|6,000|850" web/src` sin literales de política/umbral/importe de diseño; la variante W09 depende sólo de la política y la respuesta del servidor prevalece.
- **FN-17** `[F][I]` Cero errores de consola no manejados y cero `pageerror` (salvo fallos de red provocados por el escenario, listados).
- **FN-18** `npm --workspace @fintech-wallet/web run lint`, `run typecheck`, `test` y `run build` terminan con 0.

**Alcance y contenido**
- **SC-01** `rg -i` en `web/src` y `web/dist/p1` sin coincidencias de `SPEI|Banxico|\bCEP\b|BBVA|Santander|Banamex|\bSTP\b|Comprobante Oficial|cifrad|256-bit|\bTLS\b|certificad|garant|comisi|frecuente|simulador|sandbox|QA Environment|Producción|inversi|biom[eé]tr|programar|programad|exportar|gestionar límites|KYC|Sin costo`; y `rg` sensible a mayúsculas sin `\bIVA\b|\bINE\b`.
- **SC-02** `rg` en `web/src` y `web/dist/p1` sin `Ana López|Carlos Ruiz|Mariana|Andrea Morán|8412|0028|5931|DEMO-000|131126|12,450|11,600`.
- **SC-03** `rg -i "material-symbols|tailwind|googleusercontent|cdn\." web/src web/index.html` = 0 (no se copia HTML de Stitch).
- **SC-04** `rg -i "simulat|mock|fixture" web/src` = 0 y ningún parámetro de URL/almacenamiento altera estados visuales del producto.
- **SC-05** `[F]` Con `demoOnly: true`, toda cifra derivada de la política (umbral, límite, usado, restante) se acompaña de «(demostración)» o chip; con `demoOnly: false` no aparece la palabra.

**Entorno y evidencia**
- **ENV-01** Evidencia incluye salida de `df -h /System/Volumes/Data` y `docker system df` previas a crear volumen (≥2.5 GiB libres).
- **ENV-02** `docker ps` muestra `fintech-wallet-web-pg` en `127.0.0.1:55433`; ningún comando de la ronda referencia `fintech-wallet-postgres-1`, `lucem-retail-db-1`, 55432, 5432, 3200, 5174 ni 8083 (`rg` sobre `docs/evidence/web-final/<sha>/commands.txt` y `web/e2e-final/**`, salvo la lista de prohibidos de `preflight.mjs`).
- **ENV-03** `preflight.mjs` corre antes de cada suite y su salida PASS consta en la evidencia.
- **ENV-04** Las APIs/Web corren en 3301–3304/5301–5304 con `--strictPort`; builds en `web/dist/pX`; `cacheDir` `node_modules/.vite-web-final`.
- **ENV-05** No se ejecutó `npm ci|install`, ni la suite raíz `test:e2e`/`test:visual` (`commands.txt`).
- **ENV-06** Limpieza documentada y, al cerrar la ronda, contenedor y volumen propios eliminados (o declarados retenidos a petición del coordinador).
- **EV-01** `docs/evidence/web-final/<sha>/` existe por cada SHA evaluado con `README.md`, `commands.txt`, `env-summary.txt` (versiones, puertos, sin secretos), `test-output.txt` (reporter list), `metrics.json` (resultados de aserciones de geometría/estilo/contraste/fuentes), `captures-manifest.tsv`, `network-traces.json` (§7.3).
- **EV-02** Ningún `.log` (ignorado): las salidas se versionan como `.txt`/`.json`.
- **EV-03** Evidencia sanitizada: sin contraseñas, tokens, `Bearer`, cookies, códigos OTP, CLABE de 18 dígitos completa ni `Idempotency-Key` (`rg -n "Bearer |[0-9]{18}|demoOnlyCode|Idempotency-Key: [0-9a-f-]{36}|password" docs/evidence/web-final` = 0).
- **EV-04** Capturas PNG en `captures/` (no versionadas) reproducibles con el comando de `README.md`; el manifiesto lista sha256 por archivo.
- **EV-05** Cada fila del manifiesto cita la carpeta de referencia aprobada y el viewport R calculado con `sips`.
- **EV-06** `README.md` de evidencia declara el SHA de código evaluado y que la evidencia no es aceptación final.

### 7.2 Fichas por pantalla/estado

Formato: **(a)** referencia aprobada y descartadas · **(b)** ruta/componente y estado actual · **(c)** escenarios · **(d)** criterios · **(e)** excepciones permitidas · **(f)** niveles.

---

#### W01 · Acceso y estados de acceso
**(a)** Aprobada: `w01_login_demostraci_n` (PNG 1600×1280 → R 1280×1024 @1.25). Motivo: única variante sin simulador; es la referencia de la fila W01 en `docs/design-fidelity-round4.md`. Descartada: `w01_login_y_estados_de_acceso` («Simulador de Estados», «QA Sandbox», «SISTEMA SPEI CERTIFICADO», «Canal cifrado TLS 1.3 • Banco de México», «Normativa de Seguridad Bancaria»); de ella sólo se toma la lista de estados (listo, enviando, 401, 429, sin conexión).
**(b)** `/login` → `LoginPage` (`web/src/routes.tsx`), `AuthLayout`/`Field` (`web/src/components.tsx`). Existe: formulario, validación cliente, «Iniciando sesión…», error API genérico, sin conexión genérico. Falta: marca fuera de la tarjeta (tile + «Billetera MXN»), h1 «Iniciar sesión», subtítulo, iconos en campos, mostrar/ocultar contraseña, separador y «Regístrate aquí», estado 429 diferenciado, retiro de eyebrow «BIENVENIDO A BILLETERA» y legal.
**(c)** F-W01-1 listo (`/auth/refresh` 204); F-W01-2 enviar vacío; F-W01-3 `/auth/login` retenido 2 s; F-W01-4 401 Problem; F-W01-5 429 Problem; F-W01-6 `route.abort('internetdisconnected')`; I-W01-7 login real P1 de usuario sintético.
**(d)**
- **W01-V1** `[F]` Lienzo `rgb(246,248,251)`; encabezado centrado sobre la tarjeta con tile 48×48 radio 14 bg `#1d4ed8` y «Billetera MXN» 20/700; tarjeta ancho 440 (a R), radio 16, padding 32, sombra de tarjeta.
- **W01-V2** `[F]` h1 «Iniciar sesión» 24/700; subtítulo «Ingresa tus credenciales para acceder a tus cuentas» 14/400 `#434655`.
- **W01-V3** `[F]` Campos «Correo electrónico» y «Contraseña» con label 12/600, input auth (alto 44, radio 10, borde `#e2e8f0`) e icono 20 a la izquierda (mail, lock); botón ojo a la derecha en contraseña.
- **W01-V4** `[F]` Botón primario a ancho completo «Iniciar sesión» + flecha, alto 44, radio 10; debajo separador 1 px y «¿No tienes una cuenta? Regístrate aquí» (enlace 14/600 `#1d4ed8`).
- **W01-F1** `[F]` Ojo alterna `type` password/text con `aria-pressed` y `aria-label` «Mostrar contraseña»/«Ocultar contraseña».
- **W01-F2** `[F]` Enviar vacío → errores por campo con `aria-invalid` y sin petición; enviando → botón deshabilitado con «Iniciando sesión…» y spinner (`role="status"`).
- **W01-F3** `[F]` 401 → alerta «Correo o contraseña incorrectos.» sin revelar existencia; 429 → alerta distinta «Demasiados intentos. Espera un momento e inténtalo de nuevo.»; red → «No fue posible conectar. Revisa tu conexión e inténtalo de nuevo.»; el formulario conserva el email.
- **W01-F4** `[I]` Login real P1 → `/accounts` (FN-01).
- **W01-VZ** Lado a lado a R sin diferencias materiales no listadas en (e).
**(e)** Sin chip «Demostración» (E-G2). Placeholder del email genérico (`nombre@correo.com`), no el del export. `requestId` del Problem puede mostrarse como texto secundario.
**(f)** `[F]` V1–V4, F1–F3; `[I]` F4.

---

#### W02 · Registro y onboarding
**(a)** Aprobada: `w02_registro` (1600×1280 → R 1280×1024 @1.25), misma familia visual que W01 (lienzo `#f6f8fb`, tarjeta 440). Descartadas: `w02_registro_y_onboarding_saldo_cero_1` («PLATAFORMA SPEI», «Simulador de Respuestas», KYC/INE, «Simular correo existente»), `w02_registro_y_onboarding_saldo_cero_2` («Variante», «Transferencias deshabilitadas por saldo cero», nota institucional de contraseñas). El onboarding de saldo cero se cubre en W03 «sin saldo».
**(b)** `/register` → `RegisterPage` (`routes.tsx`). Existe: nombre, email, contraseña ≥12, errores, busy. Falta: marca superior, título «Crea tu cuenta» + subtítulo, «Confirmar contraseña», ojos, enlace «Inicia sesión», retiro de eyebrow/legal.
**(c)** F-W02-1 vacío; F-W02-2 contraseñas distintas; F-W02-3 409; F-W02-4 busy; I-W02-5 registro real en P2 (→ W03 sin saldo) y en P1 (→ W03 con dos cuentas).
**(d)**
- **W02-V1** `[F]` Marca superior como W01; tarjeta 440/radio 16/padding 32; título «Crea tu cuenta» headline-md (20/28/600) centrado y subtítulo «Crea tu cuenta en Billetera MXN» centrado.
- **W02-V2** `[F]` Campos en orden: Nombre completo, Correo electrónico, Contraseña (ojo), Confirmar contraseña (ojo); inputs auth alto 44 radio 10; ayuda «Usa al menos 12 caracteres.» enlazada por `aria-describedby`.
- **W02-V3** `[F]` Botón primario ancho completo «Crear cuenta»; pie «¿Ya tienes una cuenta? Inicia sesión».
- **W02-F1** `[F]` Confirmación distinta → error en «Confirmar contraseña» y sin petición; el cuerpo enviado sólo contiene `fullName,email,password`.
- **W02-F2** `[F]` 409 → alerta con el `detail` del servidor («No fue posible crear la cuenta con esos datos.») sin confirmar existencia del correo; campos conservados salvo contraseñas.
- **W02-F3** `[I]` Registro P2 → `/accounts` muestra W03 sin saldo con una cuenta `$0.00 MXN`; registro P1 → dos cuentas.
- **W02-VZ** Lado a lado sin diferencias materiales no listadas.
**(e)** Sin chip «Entorno de Demostración» (E-G2). Regla de contraseña = la del contrato (≥12), no los «8 caracteres» de variantes descartadas.
**(f)** `[F]` V1–V3, F1–F2; `[I]` F3.

---

#### W03 · Inicio, cuentas, saldo, actividad y aviso de operación pendiente
**(a)** Aprobadas: `w03_inicio_y_cuentas_corregido` (con saldo; la «corregida», referencia de round4 y qa-round5 #9), `w03_inicio_sin_saldo` (cuenta nueva/saldo cero) y, **sólo para el banner**, `w03_operaci_n_pendiente_de_verificaci_n` (2560×2248 → R 1280×1124 @2). Del pendiente se descartan «Acciones Frecuentes», «Comprobantes y folio CEP», «Gestionar reglas», «Intento ID», «Último saldo conocido», «BBVA», «Tiempo Real», campana/ayuda.
**(b)** `/accounts` → `AccountsPage` (`routes.tsx`). Existe: saludo, saldo consolidado (suma bigint), tarjetas, actividad (3), estados cargando/error/vacío, banner informativo genérico. Falta: estructura aprobada (eyebrow «RESUMEN FINANCIERO», fecha, tarjeta de saldo consolidado arriba a la derecha, tarjetas con chip de cuenta, máscara `•••• NNNN`, «SALDO DISPONIBLE», CTA por tarjeta), tabla de actividad con contraparte/estado/importe, pie «Mostrando los últimos N movimientos», layout sin saldo, **aviso de operación pendiente (no existe)**; retirar `✦`, `◌/↗`, banner «Tus cuentas, siempre a la vista».
**(c)** F-W03-1 dos cuentas + 3 movimientos con contraparte; F-W03-2 una cuenta saldo 0 sin movimientos; F-W03-3 cargando; F-W03-4 error de cuentas; F-W03-5 error de actividad; F-W03-6 registro local de intento sin `transferId` en `sessionStorage`; F-W03-7 con `transferId`; F-W03-8 textos largos; I-W03-9 P1 tras transferencia (FN-03/04); I-W03-10 P1 tras respuesta perdida real (`route.fetch()` + `route.abort()`), navegar a `/accounts`.
**(d)**
- **W03-V1** `[F]` Cabecera: eyebrow «RESUMEN FINANCIERO» label-caps; h1 «Hola, {fullName}» headline-lg; línea con icono calendario + fecha larga es-MX (D-4); a la derecha tarjeta «SALDO CONSOLIDADO» con tile wallet y suma en headline-md + «MXN» 12/500.
- **W03-V2** `[F]` Grid de cuentas 2 columnas a ≥1024 (1 a <1024), gap 24; tarjeta radio 16, padding 24; la primera con barra superior 4 px `#0037b0`; chip con punto y nombre de cuenta; `•••• NNNN` code-data a la derecha; «SALDO DISPONIBLE» label-caps; importe display-currency + «MXN» headline-sm `#434655`; separador y CTA de ancho completo.
- **W03-V3** `[F]` CTA de la primera tarjeta «Transferir» (primario, icono transferir) → `/transfers/new?source={id}`; de las demás «Mover entre mis cuentas» (secundario, icono swap) → `/transfers/new?type=own_account&source={id}`; si el usuario tiene una sola cuenta, sólo existe «Transferir».
- **W03-V4** `[F]` «Actividad Reciente» headline-md + chip «Últimos movimientos» + enlace «Ver todos los movimientos en Historial →»; tabla con cabecera label-caps sobre `#f1f3ff`: DETALLE / BENEFICIARIO (icono cargo/abono, `counterparty.name`, `•••• NNNN · fecha`), CONCEPTO & REFERENCIA (concepto, «Ref: N»), ESTADO (chip), MONTO (alineado a la derecha, `−`/`+`, abono `#006d40`); pie «Mostrando los últimos N movimientos» + «Ver historial completo ›».
- **W03-V5** `[F]` Sin saldo (todas las cuentas `0` y sin movimientos): banner info «Tu cuenta está creada» + «Tu cuenta principal está lista para operar.»; columnas «Cuentas Disponibles» (chip «N CUENTA(S) ACTIVA(S)») y «Actividad Reciente» («0 Registros», estado vacío con icono recibo, «Aún no tienes movimientos registrados»); CTA «Transferir» deshabilitado con razón visible «Disponible cuando la cuenta tenga saldo».
- **W03-V6** `[F]` Aviso pendiente (registro local presente): tarjeta ancho completo encima de las cuentas, borde izquierdo 4 px `#7a2b00`, tile icono sync_problem sobre `#ffdbcd`, título «Estamos verificando el resultado de tu transferencia» + chip «EN VERIFICACIÓN» (`#ffdbcd`/`#7a2b00`), texto «Tienes una transferencia pendiente de verificación por {importe} ({Beneficiario Billetera|Entre mis cuentas}).», línea «Ocurrió una interrupción durante el proceso.» y CTA primario a la derecha.
- **W03-F1** `[F]` CTA del aviso: con `hasTransferId` → «Consultar estado» y al pulsarlo navega a `/transfers/new` (que hace `GET /transfers/{id}` por la lógica existente); sin `transferId` → «Retomar verificación» con texto visible «Se repetirá la misma solicitud con su misma clave de operación.» y al pulsarlo navega a `/transfers/new`. El aviso **no** emite peticiones al montarse ni lee/expone la clave (verificado en `network-traces.json`).
- **W03-F2** `[F]` Cargando → skeletons con `aria-busy`; error de cuentas → panel con «Intentar de nuevo» que reintenta; error de actividad conserva las cuentas y ofrece reintento.
- **W03-F3** `[I]` Tras FN-03/FN-04 los saldos y la actividad reflejan la operación al volver a Inicio; tras I-W03-10 el aviso aparece con el importe capturado.
- **W03-VZ** Lado a lado (corregido, sin saldo, pendiente) sin diferencias materiales no listadas.
**(e)** Sin reloj ni «CST (CDMX)»; sin chips «Predeterminada»/«Bóveda Interna» (no existen en contrato); sin «Acciones Frecuentes»; sin «Intento ID»/«Registrado»; actividad de la primera cuenta (se indica su nombre en `caption`); en el aviso no hay nombre del destinatario porque el registro local sólo conserva tipo/importe/concepto/referencia; la «img» rota del export se sustituye por el tile (SH-09).
**(f)** `[F]` V1–V6, F1–F2; `[I]` F3; `[P]` aviso alimentado por `GET /transfer-attempts` cuando no hay registro local (§7.3.4).

---

#### W04 · Historial (con movimientos, filtros, paginación, vacío, cargando, error, sin resultados)
**(a)** Aprobadas: `w04_historial_con_movimientos` (base, referencia round4), `w04_cargando`, `w04_sin_movimientos`, `w04_sin_resultados`, `w04_error_al_cargar_m_s`. Descartadas: `w04_historial_y_estados_de_carga_1` y `_2` («Variantes de Estado de Carga», «Consola de Simulación», «Exportar CSV/PDF», «SPEI Cifrado 256-bit», «Registros Validados Banxico», «Producción», «Cursor: …»).
**(b)** `/accounts/:accountId/movements` → `MovementsPage` (`web/src/movements.tsx`). Existe: filtros fecha/tipo (select), limpiar, cursor (reemplaza página), cargando/vacío/error, tabla, «Ver detalle». Falta: selector de cuenta, segmentado Todos/Entradas/Salidas, columnas aprobadas con contraparte, chips, acumulación de páginas (D-9), sin resultados distinto de vacío, error al cargar más conservando filas, loading con skeleton + tarjeta, límites de día de negocio (D-4), detalle inline de recibidos (D-10).
**(c)** F-W04-1 25 movimientos (página 1 con `nextCursor`); F-W04-2 vacío sin filtros; F-W04-3 sin resultados con filtro; F-W04-4 primera carga retenida; F-W04-5 error en página 2; F-W04-6 error inicial; F-W04-7 textos largos; I-W04-8 P1 con 21+ transferencias propias creadas por API en el setup (importes < umbral); I-W04-9 movimiento a las 23:30 hora de negocio filtrado por ese día.
**(d)**
- **W04-V1** `[F]` h1 «Historial de movimientos»; a la derecha tarjeta selector «CUENTA ACTIVA» con nombre y `(•••• NNNN)` y chevron.
- **W04-V2** `[F]` Barra de filtros en tarjeta: segmentado «Todos | Entradas | Salidas» (activo fondo blanco sobre `#f1f3ff`), «Desde»/«Hasta» con icono calendario (inputs `type=date` con label), «Limpiar filtros» con icono.
- **W04-V3** `[F]` Tabla en tarjeta: cabecera label-caps sobre `#f1f3ff` «FECHA Y HORA | CONTRAPARTE Y DETALLE | CONCEPTO | ESTADO | IMPORTE | ACCIÓN»; filas ≥52 px con separador; fecha `dd/mm/aaaa` + hora; icono circular cargo (flecha arriba, `#e9edff`) o abono (flecha abajo, `#98f6bb`); `counterparty.name` + `•••• NNNN`; concepto + «Ref. N» body-sm; chip «Completada»; importe con signo, abono `#006d40`, «MXN» 12 px; «Ver detalle» enlace `#0037b0`. Todas las columnas visibles a R sin recorte.
- **W04-V4** `[F]` «Cargar más movimientos» botón secundario centrado con icono; pie «Mostrando N movimientos».
- **W04-V5** `[F]` Cargando: tarjeta de tabla con 4 filas skeleton y tarjeta centrada con icono, «Obteniendo movimientos recientes…» y barra de progreso indeterminada (`role="status"`).
- **W04-V6** `[F]` Vacío (sin filtros): tarjeta con icono recibo en círculo `#e9edff`, «Aún no tienes movimientos», «Las transacciones que realices o recibas en esta cuenta aparecerán en este historial.»; los filtros de fecha se ocultan y queda el segmentado.
- **W04-V7** `[F]` Sin resultados (con filtros): tarjeta con icono búsqueda, «No encontramos movimientos con los filtros seleccionados», «Prueba ajustando el rango de fechas o el tipo de operación.» y botón «Restablecer búsqueda».
- **W04-V8** `[F]` Error al cargar más: filas previas intactas + banner `#ffdad6` con icono sync_problem, texto «No pudimos cargar más movimientos. Tus transacciones visibles se conservan.» y botón primario «Reintentar».
- **W04-F1** `[F][I]` «Cargar más» añade la página siguiente: filas = página1 + página2 sin duplicados (ids únicos) y orden mantenido; con error en página 2, las 20 filas siguen y «Reintentar» añade la página.
- **W04-F2** `[F]` Entradas/Salidas envían `type=credit`/`type=debit`; Limpiar/Restablecer quitan `from`,`to`,`type` y `cursor`; cambiar filtros reinicia la acumulación.
- **W04-F3** `[I]` Filtro Desde=Hasta=D incluye un movimiento ocurrido a las 23:30 de D en `businessTimeZone` y excluye uno de las 00:30 de D+1 (D-4).
- **W04-F4** `[F]` Selector de cuenta lista sólo cuentas de `GET /accounts` y navega a `/accounts/{id}/movements`.
- **W04-F5** `[F][I]` «Ver detalle»: movimiento propio → W05; abono de tercero → panel inline con contraparte, importe, concepto, referencia y fecha (`aria-expanded`), sin `GET /transfers` (D-10).
- **W04-F6** `[F]` Error inicial → banner de error con «Intentar de nuevo» sin tabla; 404/403 → W14 (D-11).
- **W04-VZ** Lado a lado de los 5 estados sin diferencias materiales no listadas.
**(e)** Sin «CST» (D-4); «Sincronizando con el enlace institucional SPEI» → «Obteniendo movimientos recientes…»; la referencia recorta la columna ACCIÓN a 1280: el producto debe mostrarla completa (mejora permitida); a <768 filas apiladas (RESP-03); para I-W04-9 el instante de 23:30 se obtiene creando la transferencia y filtrando por su `occurredAt` real convertido al día de negocio (si no cae cerca de medianoche, la prueba se ejecuta `[F]` con ese borde y `[I]` con el día real).
**(f)** `[F]` V1–V8, F1, F2, F4–F6; `[I]` F1, F3, F5.

---

#### W05 · Detalle/comprobante desde el historial
**(a)** Aprobada: `w05_comprobante_de_transferencia` (1600×1280). Descartada: `w05_detalle_y_comprobante_oficial` («Comprobante Oficial», «Descargar PDF», «Imprimir», «Sello de verificación digital SHA256», «Libro Mayor», «Certificado Activo», «cifrada»).
**(b)** `/transfers/:transferId/movement-receipt` → `MovementReceiptPage` (`movements.tsx`). Existe: recibo interno con importe, partes, concepto, referencia, folio, estado, fechas, «Actualizar estado». Falta: cabecera con botón atrás + «FOLIO INTERNO • …» + h1 «Comprobante de transferencia», tarjeta de estado con chip, panel de monto con folio a la derecha, tarjetas de partes, tabla «DETALLE DE LA OPERACIÓN», pie de acciones; navegación activa = Movimientos; «Volver a mis cuentas» → «Volver a Movimientos».
**(c)** F-W05-1 transferencia a beneficiario completada; F-W05-2 propia; F-W05-3 error de consulta; F-W05-4 404; I-W05-5 desde I-W04-8 (FN-13).
**(d)**
- **W05-V1** `[F]` Cabecera: botón icono atrás (tile blanco 40, `aria-label="Volver a Movimientos"`), eyebrow «FOLIO INTERNO • {folio}», h1 «Comprobante de transferencia» headline-md; contenido centrado ancho máx. 960.
- **W05-V2** `[F]` Tarjeta: fila con tile check `#98f6bb`, «Transferencia completada» headline-sm y «Operación registrada en Billetera MXN» body-sm, chip «Completada» a la derecha; separador.
- **W05-V3** `[F]` Panel `#f1f3ff` radio 12: «MONTO TRANSFERIDO» + display-currency + «MXN»; a la derecha «FOLIO INTERNO» + folio (D-13).
- **W05-V4** `[F]` Dos tarjetas «CUENTA ORIGEN» / «CUENTA DESTINO» con nombre (headline-sm) y `Cuenta Billetera (•••• NNNN)`; fila «Tipo de abono: Transferencia interna» en destino.
- **W05-V5** `[F]` Tabla «DETALLE DE LA OPERACIÓN» con filas Fecha y hora, Concepto, Referencia numérica; pie gris con «Volver a Movimientos» (contorno) y «Ir a Inicio» (primario).
- **W05-F1** `[I]` Datos = `GET /transfers/{id}` de la fila (FN-13); «Volver a Movimientos» → `/accounts/{cuenta propia de la operación}/movements`.
- **W05-F2** `[F]` Error → banner con «Intentar de nuevo»; 404/403 → W14.
- **W05-VZ** Lado a lado sin diferencias materiales no listadas.
**(e)** Sin «Comisión por servicio» ni «Saldo después de la operación» (no lo devuelve la API para el origen); nombre del titular origen = nombre de la cuenta (no hay nombre de persona en `Transfer`); descargo «Constancia interna de Billetera MXN; no es un documento oficial.» permitido.
**(f)** `[F]` V1–V5, F2; `[I]` F1.

---

#### W06 · Directorio de beneficiarios y vacío
**(a)** Aprobadas: `w06_directorio_de_beneficiarios_1` (lista; referencia round4/qa-round5 #11) y `w06_sin_beneficiarios` (vacío). Descartada: `w06_directorio_de_beneficiarios_2` («Liquidación interna 0.0 segundos», «Límite por operación», «Comisión», «Frecuente», «Protocolo SPEI / STP», «Validación … Banxico», «Normativa CNBV», fotos).
**(b)** `/beneficiaries` → `BeneficiariesPage` (`web/src/beneficiaries.tsx`). Existe: lista, búsqueda, vacío, error, aviso de alta, badge «Cuenta interna». Falta: h1 «Mis beneficiarios» + subtítulo, barra búsqueda con icono + CTA en la misma fila, tarjetas con avatar de iniciales, chip «Alias: …», panel «Cuenta destino Billetera MXN» + máscara, botón «Transferir →» funcional; sin resultados con estilo propio.
**(c)** F-W06-1 dos beneficiarios; F-W06-2 vacío; F-W06-3 búsqueda sin resultados; F-W06-4 cargando; F-W06-5 error; F-W06-6 textos largos; I-W06-7 tras FN-02.
**(d)**
- **W06-V1** `[F]` h1 «Mis beneficiarios» + «Envía dinero a cuentas registradas en Billetera MXN»; fila con buscador (icono search, placeholder «Buscar por nombre o alias…», label accesible) y botón primario «+ Agregar beneficiario».
- **W06-V2** `[F]` Grid 2 columnas ≥1024 (1 si hay un solo beneficiario, ocupando ≥85 % del ancho, qa-round5 #11); tarjeta radio 12 con avatar 60 círculo `#e9edff` iniciales, nombre headline-md, chip «Alias: {alias}», panel `#f9f9ff` «Cuenta destino Billetera MXN» + `•••• NNNN` code-data, botón contorno azul ancho completo «Transferir →».
- **W06-V3** `[F]` Vacío: tarjeta centrada con icono group en círculo, «Aún no tienes beneficiarios registrados», «Registra a tus contactos con cuenta en Billetera MXN para enviarles dinero y tenerlos siempre a la mano.», botón primario «+ Agregar beneficiario»; el buscador permanece en la barra superior deshabilitado con razón.
- **W06-V4** `[F]` Sin resultados: icono manage_search, «No encontramos beneficiarios con esa búsqueda», botón «Limpiar búsqueda».
- **W06-F1** `[F]` Búsqueda filtra por nombre, alias o últimos 4 sin peticiones; «Transferir» → `/transfers/new?beneficiaryId={id}` con ese beneficiario preseleccionado en W08.
- **W06-F2** `[F]` Cargando skeleton `aria-busy`; error con «Intentar de nuevo»; 401 → W14 sesión.
- **W06-F3** `[I]` El beneficiario creado en FN-02 aparece con máscara y el aviso «Beneficiario “{alias}” agregado.»
- **W06-VZ** Lado a lado (lista, vacío) sin diferencias materiales no listadas.
**(e)** Máscara mostrada `•••• NNNN` aunque la API envíe 3+4 (más restrictivo); sin orden por frecuencia (`isFrequent` ignorado); aviso de alta sin referencia visual (estilo Notice info tokenizado).
**(f)** `[F]` V1–V4, F1–F2; `[I]` F3.

---

#### W07 · Alta de beneficiario (campos inválidos, CLABE incorrecta, duplicado, destino no disponible, guardando, error recuperable)
**(a)** Aprobadas: base `w07_agregar_beneficiario` (1600×1280) y sus variantes de estado de la misma familia (h1 «Agregar nuevo beneficiario»): `w07_campos_inv_lidos`, `w07_clabe_incorrecta`, `w07_beneficiario_duplicado`, `w07_destino_no_disponible`, `w07_guardando`, `w07_error_recuperable` (HTML sin PNG; inspeccionados). Descartada: `w07_alta_de_beneficiario` (otra familia: «Nuevo beneficiario», «Liquidación en tiempo real», «Comisión: $0.00», «Disponible 24/7», «sin almacenar registros temporales no cifrados»). Consecuencia: se retira la «vista previa» lateral introducida en round4 y se usa la tarjeta de ayuda lateral.
**(b)** `/beneficiaries/new` → `NewBeneficiaryPage` (`beneficiaries.tsx`). Existe: campos, validación schema, 409/404/400/422/5xx, busy, conserva datos, vista previa. Falta: breadcrumb, eyebrow «REGISTRO DE CONTACTO», banner «Solo se admiten cuentas de Billetera MXN.», contador CLABE, estados con banners propios, «Reintentar guardar», «Ver en directorio»/«Modificar datos», tarjeta de ayuda.
**(c)** F-W07-1 idle; F-W07-2 enviar vacío; F-W07-3 CLABE checksum inválido; F-W07-4 409; F-W07-5 404; F-W07-6 POST retenido; F-W07-7 503 y abort; I-W07-8 FN-02 completo.
**(d)**
- **W07-V1** `[F]` Breadcrumb «← Beneficiarios / Nuevo registro»; eyebrow «REGISTRO DE CONTACTO» label-caps `#0037b0`; h1 «Agregar nuevo beneficiario»; subtítulo «Registra una cuenta de Billetera MXN para transferir fondos.»
- **W07-V2** `[F]` Tarjeta formulario (ancho ≈ 8/12 a R) con banner info «Solo se admiten cuentas de Billetera MXN.»; campos «Nombre completo o razón social» (derecha «Obligatorio»), «Alias o nombre corto» (derecha «Para identificarlo fácil»), «CLABE de 18 dígitos» (derecha contador `n / 18`, ayuda «18 dígitos numéricos»); inputs del shell alto 44.
- **W07-V3** `[F]` Acciones alineadas a la derecha: «Cancelar» (contorno) y «Guardar beneficiario» (primario con icono person_add); columna lateral: tarjeta `#e9edff` «¿Dónde obtener la CLABE interna?» con texto de (e).
- **W07-V4** `[F]` Campos inválidos: banner `#ffdad6` «Revisa los campos señalados antes de continuar» + chip «N errores» (N real); cada campo con anillo error 2 px, icono y mensaje: «Ingresa el nombre completo o razón social del titular.», «Asigna un alias para identificar al contacto.», «Ingresa los 18 dígitos numéricos de la cuenta.»
- **W07-V5** `[F]` CLABE incorrecta (18 dígitos, checksum inválido): banner «Verifica la información capturada»; label CLABE en `#ba1a1a`, contador como chip error, mensaje «La CLABE debe contener exactamente 18 dígitos y un dígito verificador válido. Revisa los números ingresados.»; los otros campos muestran «Formato válido».
- **W07-V6** `[F]` Duplicado (409): banner «Beneficiario duplicado» + «Ya tienes registrado un beneficiario con esta misma CLABE.»; nota bajo CLABE «Cuenta ya registrada»; acciones «Ver en directorio» y «Modificar datos».
- **W07-V7** `[F]` Destino no disponible (404): banner «Destino no disponible en la plataforma» + «Esta cuenta no pertenece a Billetera MXN. Revisa la CLABE de 18 dígitos e intenta nuevamente.»
- **W07-V8** `[F]` Guardando: botón con spinner «Guardando beneficiario…», campos `readonly` y `aria-busy`, texto `role="status"` «Registrando y validando datos en Billetera MXN. Por favor no cierres esta ventana.»
- **W07-V9** `[F]` Error recuperable (5xx/red): banner «No pudimos guardar al beneficiario en este momento» + «Ocurrió un problema de conexión temporal. Conservamos la información ingresada para que puedas reintentar.»; botón primario «Reintentar guardar».
- **W07-F1** `[F]` Checksum inválido y campos vacíos no emiten petición; «Reintentar guardar» reenvía exactamente los mismos valores; «Modificar datos» enfoca CLABE; «Ver en directorio» → `/beneficiaries`; «Cancelar» → `/beneficiaries`.
- **W07-F2** `[I]` FN-02 (201, 409, 404 reales) con la UI de V6/V7 y alta visible en W06.
- **W07-VZ** Lado a lado (base + 6 estados; las variantes sin PNG contra su HTML renderizado, §5.11) sin diferencias materiales no listadas.
**(e)** Texto de ayuda lateral reformulado a «Pide al titular su CLABE de Billetera MXN de 18 dígitos.» (el original afirma que se ve en Inicio y la Web sólo muestra la máscara); en duplicado no se muestra el nombre del contacto existente ni banco (la API no lo devuelve); sin «Validación en línea SPEI», «Red Bancaria Conectada», «BANCO 138». En variantes sin PNG se comparan estructura y copia, no tipografía (§5.11).
**(f)** `[F]` V1–V9, F1; `[I]` F2.

---

#### W08 · Datos de transferencia (beneficiario, cuentas propias, sin beneficiarios, sin segunda cuenta propia, errores)
**(a)** Aprobadas: base `w08_formulario_de_transferencia` (referencia round4 y qa-round5 #13), `w08_entre_mis_cuentas`, `w08_errores_en_formulario`, `w08_sin_beneficiarios`, `w08_sin_segunda_cuenta_propia`. Descartada: `w08_datos_de_transferencia` (iteración de una columna «Paso 1 de 2» no usada como referencia). De las aprobadas se excluyen: «ESTADO DE CUENTA Activa / Verificada», «Verificado», «Comisión de red/SPEI/IVA», «Tiempo estimado», «INMEDIATO», «Operación cifrada…», «Bitácora de contexto», atajos de importe, pestaña «Nueva cuenta», «¿Deseas programar traspasos?», «Beneficiarios frecuentes», «Garantía SPEI», «Reglas de validación Banxico», «FOLIO PRE-», «Límite por operación».
**(b)** `/transfers/new` → `NewTransferPage` (`web/src/transfers.tsx`). Existe: tipo destino, selects, importe/concepto/referencia, validación, origen≠destino para propias, resumen lateral, sin beneficiarios, sin cuentas. Falta: estructura numerada 1–6, tarjetas de selección (D-8), «Resumen previo» aprobado con saldo proyectado y porcentaje, «Disponible hoy» de la política, contadores, errores por campo con banner y conteo, sin segunda cuenta propia, origen≠destino por identidad con beneficiarios (D-7), preselección por query.
**(c)** F-W08-1 beneficiario seleccionado; F-W08-2 propias (2 cuentas); F-W08-3 errores (importe 0, concepto vacío, referencia `REF-99X`); F-W08-4 0 beneficiarios; F-W08-5 1 cuenta en pestaña propias; F-W08-6 beneficiario con `ownAccountId` = origen; F-W08-7 textos largos; I-W08-8 P1 flujos FN-03..05; I-W08-9 P2 sin segunda cuenta.
**(d)**
- **W08-V1** `[F]` Breadcrumb «Transferir / Nueva transferencia»; h1 «Transferir dinero»; subtítulo «Envía fondos a un beneficiario registrado o entre tus cuentas propias.»; layout 2 columnas (formulario ≈ 2/3, resumen ≈ 1/3) a ≥1024.
- **W08-V2** `[F]` Secciones con label-caps numeradas: «1. CUENTA DE ORIGEN» (+ «Cambiar cuenta»), tarjeta `#f1f3ff` con tile banco `#0037b0`, nombre, `•••• NNNN`, «Saldo disponible» + importe; «2. TIPO DE DESTINO» segmentado «A un beneficiario» / «Entre mis cuentas» con iconos; «3. DESTINATARIO» (+ «Buscar otro beneficiario») tarjeta con avatar iniciales `#006d40`, nombre, chip «Alias: …», «Cuenta •••• NNNN».
- **W08-V3** `[F]` «4. IMPORTE A TRANSFERIR» con, a la derecha, «Disponible hoy: {dailyRemaining} (demostración)» si hay política; campo grande `$` + input + badge «MXN»; «5. CONCEPTO» con contador `n / 40` y «6. REFERENCIA NUMÉRICA» con «Hasta 7 dígitos» en dos columnas; acciones «Continuar a revisión →» (primario ancho) y «Cancelar» (secundario).
- **W08-V4** `[F]` «Resumen previo» (tarjeta derecha): «Monto a debitar», bloque «Saldo proyectado» con barra y «Representa el X % de tu saldo disponible actual» (bigint, 1 decimal) cuando hay importe válido y origen; si no, «—».
- **W08-V5** `[F]` Entre mis cuentas: «2. CUENTA DE DESTINO» con «N cuenta(s) disponible(s)»; tarjetas con radio-check, tile, nombre, `N° •• NNNN`, «SALDO ACTUAL»; la cuenta origen aparece deshabilitada con chip «ORIGEN ACTUAL» y «No es posible transferir a la misma cuenta de origen»; resumen «Resumen proyectado» con «MONTO A TRASPASAR», «Saldo final en Origen», «Saldo final en Destino» (estimados).
- **W08-V6** `[F]` Errores: banner `#ffdad6` «Corrige los campos marcados para continuar» + chip «N errores detectados»; labels en `#ba1a1a` con `*`; inputs con fondo `#fff5f4`/anillo error; mensajes «Ingresa un monto válido mayor a $0.00 MXN», «Usa como máximo dos decimales y sin comas», «El concepto de transferencia es requerido», «Ingresa una referencia numérica de hasta 7 dígitos».
- **W08-V7** `[F]` Sin beneficiarios: panel `#f1f3ff` con icono person_add + «No tienes beneficiarios registrados en tu cuenta», «Registra primero un beneficiario de Billetera MXN.», botones «+ Agregar nuevo beneficiario» y «Transferir a cuenta propia» (éste sólo si hay ≥2 cuentas); resumen «Para: Sin seleccionar»; «Continuar» deshabilitado con razón.
- **W08-V8** `[F]` Sin segunda cuenta propia: panel info «No cuentas con otra cuenta propia disponible» + «Para transferir entre tus cuentas necesitas al menos dos cuentas de Billetera MXN. Puedes continuar transfiriendo a un beneficiario registrado.» + botón «Transferir a un beneficiario»; «Continuar» deshabilitado con razón.
- **W08-F1** `[F]` Preselección por `?source=`, `?beneficiaryId=`, `?type=own_account`; listas de selección son `radiogroup` operables con flechas/espacio.
- **W08-F2** `[F]` FN-06/FN-07; los errores se muestran al enviar y se limpian al corregir; los valores capturados se conservan al cambiar de pestaña y al volver de W09/W13.
- **W08-F3** `[F][I]` D-7/FN-05: beneficiario cuyo `ownAccountId` = origen deshabilitado con razón «Este beneficiario corresponde a la cuenta de origen»; cambiar el origen lo habilita.
- **W08-F4** `[F]` No hay bloqueo cliente por saldo/límite (D-5): importe > saldo pasa a W09.
- **W08-VZ** Lado a lado de los 5 estados sin diferencias materiales no listadas.
**(e)** Sin «Verificado» ni chip de estado de cuenta; sin atajos de importe; «Disponible hoy» sólo con política cargada; columna derecha de la variante de errores se sustituye por el «Resumen previo» de la base (las tarjetas «Cuenta de cargo»/«Reglas Banxico» contienen claims).
**(f)** `[F]` V1–V8, F1–F4; `[I]` F3, I-W08-8/9.

---

#### W09 · Revisión (normal, monto que requiere código, cuentas propias)
**(a)** Aprobadas: `w09_revisar_transferencia` (normal; referencia round4), `w09_revisi_n_6_000_mxn` (requiere código), `w09_revisi_n_entre_cuentas_propias` (HTML sin PNG). Descartada: `w09_revisi_n_previa_de_transferencia` (otra familia: «Folio preliminar», «Comisión por servicio GRATIS», «Sesión autenticada institucional», «Cargo inmediato y sin retenciones»). Se excluyen de las aprobadas: «Tipo de cambio», «Fecha estimada Inmediata (SPEI)», «Costo de la transacción», «Firma dinámica token habilitada», «Información de cumplimiento», «Modo Seguro SPEI Directo», «Comisión», «Distribución patrimonial», «Fecha valor».
**(b)** Paso `review` dentro de `/transfers/new` (`NewTransferPage`, `transfers.tsx`). Existe: lista «Confirma los datos», «Editar», «Enviar transferencia», resumen con saldos estimados. Falta: vista dedicada con breadcrumb «Paso 2 de 2», banner, tarjeta de monto, tarjetas origen/destino, concepto/referencia con iconos, saldo estimado con fórmula, variante código (panel lateral), variante propias (proyección de ambas cuentas).
**(c)** F-W09-1 beneficiario bajo umbral; F-W09-2 importe ≥ umbral (política simulada); F-W09-3 propias; F-W09-4 propias ≥ umbral; F-W09-5 política no disponible; I-W09-6 FN-08/FN-10/FN-15.
**(d)**
- **W09-V1** `[F]` Breadcrumb «Transferir › Paso 2 de 2: Revisión» + 2 barras de paso; eyebrow con punto «CONFIRMACIÓN REQUERIDA»; h1 «Revisa y confirma tu transferencia»; subtítulo «Verifica los detalles antes de procesar el envío. El dinero aún no ha sido debitado.»
- **W09-V2** `[F]` Tarjeta (ancho máx. 950) con cabecera `#f1f3ff` icono info «Revisa los datos antes de enviar» / «Verifica los detalles antes de continuar. La operación aún no ha sido enviada ni debitada.»; «MONTO A TRANSFERIR» + display-currency + chip «Transferencia interna».
- **W09-V3** `[F]` Dos tarjetas `#f1f3ff`: «CUENTA DE ORIGEN» (nombre `(•• NNNN)`, «Saldo actual: …») y «DESTINATARIO» (nombre + chip alias, «Billetera MXN (•• NNNN)»); «CONCEPTO DEL ENVÍO» y «NÚMERO DE REFERENCIA» con iconos genéricos.
- **W09-V4** `[F]` Panel «Saldo estimado post-operación»: «{saldo} − {importe} =» (importe en `#ba1a1a`) y resultado headline-md; barra proporcional; si importe > saldo, texto «El importe supera el saldo disponible actual» en lugar del resultado (sin bloquear).
- **W09-V5** `[F]` Pie: «Modificar datos» (contorno, icono edit) a la izquierda y «Confirmar transferencia →» (primario) a la derecha.
- **W09-V6** `[F]` Requiere código: layout 8/4; tarjeta lateral «Se requiere código de confirmación» con texto «Como el importe es igual o mayor al umbral configurado ({umbral}, demostración), te pediremos un código de confirmación en el siguiente paso.», CTA «Continuar a verificación →» y «Modificar datos».
- **W09-V7** `[F]` Propias: stepper «1. Configuración de envío ✓ › 2 Revisión y confirmación»; banner «El traspaso entre tus cuentas aún no ha sido confirmado.» + chip «Paso 2 de 2»; tarjeta «Desglose de la operación» con monto en `#0037b0`, flujo Origen → Destino con saldos; tarjeta «Proyección estimada» con «Nuevo saldo» de ambas cuentas (chips «Cargo»/«Abono»); columna derecha «Resumen» («Tipo de traspaso: Entre cuentas propias», «Total a debitar») + CTA y «Modificar datos».
- **W09-F1** `[I]` FN-08 (revisión = capturado = cuerpo enviado) y FN-15 (un solo POST con doble clic).
- **W09-F2** `[F]` Variante código sii `amountMinor >= otpThresholdMinor` de la política (D-6); con política caída: texto neutro y CTA «Confirmar transferencia»; si el servidor responde 202 sin predicción → W10; si 201 con predicción → W12.
- **W09-F3** `[F]` «Modificar datos» vuelve a W08 con todos los valores; ninguna petición de escritura.
- **W09-VZ** Lado a lado (3 variantes; propias contra su HTML renderizado) sin diferencias materiales no listadas.
**(e)** Icono de concepto genérico (no cubiertos); h1 único para normal y código (la variante 6000 usa otro título); propias sin barra «Distribución patrimonial» (decorativa).
**(f)** `[F]` V1–V7, F2–F3; `[I]` F1.

---

#### W10 · Código de confirmación (vacío, incompleto, completo, verificando, incorrecto, expirado, intentos agotados)
**(a)** Aprobadas: estructura `w10_c_digo_completo` (2 columnas: tarjeta de código + «Resumen de orden»), con estados de la misma familia: `w10_c_digo_de_confirmaci_n` (sólo copia del estado vacío), `w10_c_digo_incompleto`, `w10_verificando`, `w10_c_digo_incorrecto`, `w10_c_digo_expirado` (HTML sin PNG), `w10_intentos_agotados` (2560×2048 → R 1280×1024 @2). Ninguna carpeta se descarta entera; se descartan de todas: «AUTENTICACIÓN MULTIFACTOR», «enviado por SMS», «terminación •••• 4190», «Banxico», «Canal Cifrado SPEI», «Comisión», «Institución receptora», «Validación de Destinatario», «Clave de Rastreo», «Cambiar método», «Sesión/IP», «SPEI Token», «Solicitar nuevo código» (sin endpoint), «Paso 3 de 3: Autenticación SPEI».
**(b)** `/transfers/:transferId/status` con `status = awaiting_confirmation` → `TransferStatusPage` (`transfers.tsx`). Existe: 6 casillas sobre un input, código demo, confirmar con clave por código, rechazos definitivos → W13, error genérico. Falta: layout 2 columnas, cuenta regresiva de `expiresAt`, chips de longitud, estados incorrecto/expirado/agotado/verificando diferenciados, «Volver a revisar» (D-12), manejo de 409 con `GET`.
**(c)** F-W10-1 vacío; F-W10-2 3 dígitos; F-W10-3 6 dígitos; F-W10-4 confirm retenido; F-W10-5 422 «Código incorrecto.»; F-W10-6 422 «El código expiró.» y `GET` → `expired`; F-W10-7 429 «Se agotaron los intentos.»; F-W10-8 409 → `GET` `completed`; F-W10-9 cancel 200/409/error; I-W10-10 P1 FN-10; I-W10-11 P3 expiración real (esperar 6 s); I-W10-12 P3 dos códigos erróneos → agotados.
**(d)**
- **W10-V1** `[F]` Breadcrumb «Transferir › Confirmación»; tarjeta izquierda (≈7/12) con tile lock, eyebrow «CÓDIGO DE CONFIRMACIÓN», chip «Demo» si `demoOnlyCode`, título «Código de confirmación» headline-md y a la derecha «EXPIRA EN» + chip `mm:ss` (`#ffdad6`/`#93000a` cuando <60 s).
- **W10-V2** `[F]` Texto «Ingresa el código de 6 dígitos para autorizar la transferencia de {importe} a {destino} (•• NNNN).»; label «Código de 6 dígitos»; 6 casillas 72×56 (a R) radio 8 `#f1f3ff`, dígitos 30 px `#0037b0`; a la derecha del label chip de estado.
- **W10-V3** `[F]` Incompleto: casillas llenas + cursor en la siguiente; texto «Código incompleto (n de 6 dígitos ingresados)» con icono info; botón «Autorizar transferencia» deshabilitado con «Al completar los 6 dígitos se habilitará la autorización.»
- **W10-V4** `[F]` Completo: chip «CÓDIGO COMPLETO» (`#98f6bb`/`#007345`); «Longitud válida (6/6 dígitos)» con check; botón primario «Autorizar transferencia de {importe}» con icono lock; debajo «Volver a revisar» (secundario).
- **W10-V5** `[F]` Código de demostración: si `demoOnlyCode`, panel/chip «Código de demostración: NNNNNN» (sólo en pantalla; nunca en logs/evidencia).
- **W10-V6** `[F]` Columna derecha «RESUMEN DE ORDEN» + chip «Pendiente de confirmación»; panel monto «Monto a transferir»; filas Destinatario (nombre + `Cuenta •• NNNN`), Cuenta origen (nombre + `•• NNNN`), Concepto, Referencia, «Creada» (hora).
- **W10-V7** `[F]` Verificando: botón «Verificando…» con spinner deshabilitado, input `readonly`, texto `role="status"` «Validando código… Por favor no cierres ni recargues esta ventana.»
- **W10-V8** `[F]` Incorrecto: alerta «Código incorrecto» + «El código ingresado no coincide. Revisa e ingresa nuevamente.»; casillas con borde error; foco vuelve al input con el texto seleccionado.
- **W10-V9** `[F]` Expirado: alerta «Código expirado» + «El código de confirmación venció. Este intento se cerró sin cargo.»; casillas deshabilitadas; CTA «Volver a revisar» (sin cancel: ya terminal); cuenta regresiva en `00:00`.
- **W10-V10** `[F]` Intentos agotados: tarjeta superior con borde izquierdo 4 px `#ba1a1a`, tile shield error, «Operación suspendida», «Se agotó el número de intentos permitidos para este código. La transferencia no se realizó.», franja «No se realizó ningún cargo a tu cuenta» + «SALDO DISPONIBLE ACTUAL: {saldo origen de GET /accounts}»; debajo tarjeta «Código de 6 dígitos» con casillas bloqueadas, chip «Bloqueado», botón deshabilitado con «Autorización deshabilitada: intentos agotados», CTA «Volver a revisar transferencia» (primario) y «Volver al inicio»; resumen con chip «No ejecutada».
- **W10-F1** `[F]` Mapeo de respuestas de `confirm` (DEP-2): 200 → W12; 422 `detail` «Código incorrecto.» → V8; 422 «El código expiró.» → `GET` y V9 si `status=expired`; 429 «Se agotaron los intentos.» → V10; 422 «Saldo insuficiente.» → W13 saldo; 429 «Se excedió el límite diario.» → W13 límite; 409 → `GET /transfers/{id}` y render del estado real (W12 si `completed`, V9 si `expired`/`cancelled`); red/5xx → aviso «No se confirmó la respuesta. Puedes reintentar el mismo código.» (misma clave, lógica actual).
- **W10-F2** `[F]` Cuenta regresiva desde `expiresAt`; al llegar a 0 hace un `GET` y sólo muestra V9 si el servidor devuelve `expired`.
- **W10-F3** `[F]` «Volver a revisar» (D-12): `POST /cancel` → 200 `cancelled|expired` → W08 con datos del intento; 409 → `GET` → W12; error → permanece con alerta; nunca crea otro intento por sí mismo.
- **W10-F4** `[I]` P1 FN-10 completo; P3 expiración real → V9; P3 agotados real → V10; en los tres, `GET /accounts` sin cambio de saldo salvo el caso completado.
- **W10-VZ** Lado a lado de 7 estados (incorrecto/expirado/verificando contra HTML renderizado) sin diferencias materiales no listadas.
**(e)** E-W10-1 sin «Solicitar nuevo código» (DEP-3); sin «intentos restantes» (la API no lo informa); la variante incompleto del export invierte columnas: se mantiene el orden de la base; texto «Nunca compartas este código…» opcional.
**(f)** `[F]` V1–V10, F1–F3; `[I]` F4.

---

#### W11 · Enviando, verificando resultado y resultado desconocido (estados distintos)
**(a)** Aprobadas: `w11_enviando` (enviando) y `w11_verificando_resultado` (verificando; base visual también del estado «resultado desconocido» con las diferencias de (d)). Descartadas: `w11_enviando_y_resultado_desconocido` (lámina combinada con etiquetas «W11», «Transacción #TRX», «forma encriptada», «Arquitectura de doble comprobación», «Protocolo de certeza financiera») y `w11_recuperaci_n_por_desconexi_n` (expone «Clave Idempotencia», «En sondeo SPEI», «Ir a Movimientos para comprobar» —usa el historial como prueba—, verificación automática con cuenta atrás, «Bloqueo de seguridad preventivo»).
**(b)** `NewTransferPage` (`transfers.tsx`): enviando = `busy` del submit (hoy sólo cambia la etiqueta del botón); verificando = `recovering` («Recuperando tu transferencia») o clic en «Consultar / reintentar»; desconocido = `uncertainDraft` («Estamos verificando el resultado»). `TransferStatusPage` rama `processing` (inalcanzable hoy, A-10). Falta: vistas dedicadas y diferenciadas; copia veraz según la petición real.
**(c)** F-W11-1 `POST /transfers` retenido 3 s; F-W11-2 registro sin `transferId` + recarga con `POST` retenido; F-W11-3 registro con `transferId` + `GET` retenido; F-W11-4 `POST` abortado; F-W11-5 `GET` 503; I-W11-6 respuesta perdida real (`route.fetch()` y luego `route.abort('connectionreset')`) → desconocido → «Reintentar el mismo envío» → W12 con el mismo id y un solo movimiento en W04.
**(d)**
- **W11-V1** `[F]` Enviando: chip «ENVIANDO»; h1 «Enviando transferencia»; «Por favor no cierres ni recargues esta ventana mientras se procesa la solicitud.»; tarjeta centrada (ancho ≈ 720) con icono transferir dentro de anillo de progreso, «MONTO A TRANSFERIR» + display-currency, panel `#f1f3ff` con Destinatario, Cuenta de origen, Concepto, Referencia; barra deshabilitada «Enviando transferencia…» con spinner.
- **W11-V2** `[F]` Verificando: tarjeta centrada con chip «VERIFICANDO RESULTADO» (punto `#0037b0`), icono sync en círculo `#e9edff` con spinner, h1 «Estamos verificando si tu transferencia se completó», texto «Ocurrió una interrupción momentánea de conexión. Estamos consultando el resultado de tu operación.», panel con Destinatario, Cuenta de origen, Monto, Referencia; nota con icono shield; botón primario deshabilitado «Consultando…».
- **W11-V3** `[F]` Resultado desconocido: misma tarjeta con chip «RESULTADO DESCONOCIDO» (`#ffdbcd`/`#7a2b00`), icono estático sync_problem sobre `#ffdbcd`, h1 «No pudimos confirmar el resultado», texto «La conexión se interrumpió antes de recibir respuesta. No envíes una transferencia nueva: verifica este mismo intento.», botón primario habilitado y enlace «Volver al Inicio (conservarás un aviso visible para retomar la verificación)».
- **W11-V4** `[F]` V2 y V3 difieren al menos en: texto del chip, color del chip, h1, icono animado vs estático y botón deshabilitado vs habilitado (aserción explícita).
- **W11-F1** `[F]` Copia veraz: si la acción es `GET /transfers/{id}` → botón «Consultar estado» y nota «No reenviamos tu transferencia. Consultamos el estado de este mismo intento.»; si es el `POST` con la misma clave (sin `transferId`) → botón «Reintentar el mismo envío» y nota «Se repetirá la misma solicitud con su misma clave de operación; no se crea un intento nuevo.»; nunca «No reenviamos» cuando se reenvía.
- **W11-F2** `[F]` Los datos del panel provienen del registro local/respuesta (sin clave ni ids visibles); el destinatario se resuelve por id contra `GET /beneficiaries`/`GET /accounts` y, si no se encuentra, «Beneficiario Billetera»/«Cuenta propia».
- **W11-F3** `[I]` I-W11-6: exactamente una transferencia nueva (W04 y `GET /transfers/{id}`); el `POST` de reintento lleva la misma `Idempotency-Key` y el mismo cuerpo que el original (igualdad comprobada por hash en `network-traces.json`, sin volcar la clave).
- **W11-F4** `[F]` «Volver al Inicio» conserva el registro local y W03 muestra el aviso (W03-V6).
- **W11-VZ** Lado a lado (enviando vs `w11_enviando`; verificando y desconocido vs `w11_verificando_resultado`) sin diferencias materiales no listadas.
**(e)** «Monto en consulta» → «Monto»; nada de «Entorno seguro», «Finanzas institucionales» ni logo «$» del sidebar del export (shell unificado E-G1).
**(f)** `[F]` V1–V4, F1, F2, F4; `[I]` F3; `[P]` acciones «Anular esta transferencia», verificación por `GET /transfer-attempts?attemptId=` y «un toque = un POST» (§7.3.4).

---

#### W12 · Comprobante de transferencia (beneficiario y cuentas propias)
**(a)** Aprobadas: `w12_comprobante_850_mxn` (beneficiario; 1600×1280) y `w12_comprobante_entre_cuentas_propias` (propias; PNG 2560×2160 → R 1280×1080 @2; su HTML no tiene markup: se usa el PNG). Descartadas: `w12_transferencia_completada` («Comprobante Oficial», «Comisión por envío»), `w12_comprobante_6_000_mxn` (iteración duplicada: «Aprobada y liquidada», «acreditado de forma instantánea», «Operación Directa»). De las aprobadas se excluyen «Comisión», «ENTORNO SEGURO Cifrado 256-bit», «Saldo posterior confirmado» (ver (e)).
**(b)** `/transfers/:transferId/status` y `/receipt` con `status = completed` → `TransferStatusPage`. Existe: recibo interno con importe, partes, concepto, referencia, folio, estado, fecha, saldo destino si propia, «Volver a mis cuentas». Falta: cabecera de éxito centrada, tarjeta con barra superior, cabecera «COMPROBANTE DE TRANSFERENCIA» + folio copiable, tarjetas de partes con iconos, saldos actuales, acciones «Volver al inicio»/«Ver movimientos».
**(c)** F-W12-1 beneficiario; F-W12-2 propias; F-W12-3 folio largo a 390; F-W12-4 portapapeles; I-W12-5 FN-03/FN-04/FN-10.
**(d)**
- **W12-V1** `[F]` Cabecera centrada: círculo 80 `#98f6bb` con check, chip «OPERACIÓN EXITOSA», h1 «¡Transferencia completada con éxito!», importe display-currency en `#0037b0` + «MXN»; propias añade subtítulo «El traspaso entre tus cuentas ha sido aplicado.»
- **W12-V2** `[F]` Tarjeta (ancho ≈ 950) con barra superior 8 px `#0037b0`; panel `#f1f3ff` «COMPROBANTE DE TRANSFERENCIA» + «Transferencia interna Billetera MXN» (propias: «Traspaso entre cuentas propias»); a la derecha caja blanca «FOLIO INTERNO» + folio (D-13) + botón icono copiar.
- **W12-V3** `[F]` Tarjetas de partes con tile icono: «CUENTA DE ORIGEN» (nombre, «Terminación •• NNNN») y «DESTINATARIO»/«CUENTA DE DESTINO» (nombre, «Billetera MXN •• NNNN»/«Terminación •• NNNN»).
- **W12-V4** `[F]` Filas zebra: Fecha y hora (`completedAt`), Concepto, Referencia.
- **W12-V5** `[F]` Beneficiario: panel `#e9edff` con icono check «SALDO DISPONIBLE ACTUAL» + «Cuenta {origen}» y saldo de `GET /accounts`. Propias: «SALDOS DISPONIBLES ACTUALES» con dos tarjetas (chip `− importe` error / `+ importe` éxito, saldo actual) y «SALDO TOTAL CONSOLIDADO» (suma bigint de `GET /accounts`).
- **W12-V6** `[F]` Acciones centradas: «Volver al inicio» (primario, icono home) y «Ver movimientos» (contorno, icono recibo) → `/accounts/{sourceAccountId}/movements`.
- **W12-F1** `[F]` Copiar folio escribe el folio completo en el portapapeles y anuncia «Folio copiado» (`role="status"`); el folio no desborda a 390.
- **W12-F2** `[I]` Es el comprobante de la operación correcta: id/folio = respuesta del `POST`/`confirm`; importe/concepto/referencia iguales; FN-12 tras «Ver movimientos».
- **W12-VZ** Lado a lado (beneficiario, propias) sin diferencias materiales no listadas.
**(e)** «Saldo posterior confirmado» → «Saldo disponible actual» (la API no devuelve saldo posterior del origen; se consulta después y puede incluir operaciones posteriores); sin «Tipo de operación» duplicado; folio es UUID (no «DEMO-0001»).
**(f)** `[F]` V1–V6, F1; `[I]` F2.

---

#### W13 · Saldo insuficiente y límite diario
**(a)** Aprobadas: `w13_saldo_insuficiente` y `w13_l_mite_diario` (1600×1280; referencias round4). Descartada: `w13_transferencia_rechazada` (lámina combinada «Estado de Operaciones Rechazadas», «Ref: W13-…», «Auditoría de seguridad en tiempo real», «Gestionar límites de cuenta»).
**(b)** `NewTransferPage` (rechazo en create) y `TransferStatusPage` (rechazo en confirm) → `RejectionPanel` (`transfers.tsx`). Existe: panel con desglose sin cifras de límite y acciones «Editar datos»/«Volver a mis cuentas». Falta: vista centrada aprobada, desglose saldo/faltante, desglose de límite con política, «Modificar monto».
**(c)** F-W13-1 422 «Saldo insuficiente.» en create; F-W13-2 429 «Se excedió el límite diario.» en create; F-W13-3 ambos en confirm; F-W13-4 política no disponible; I-W13-5 P2 saldo; I-W13-6 P4 límite.
**(d)**
- **W13-V1** `[F]` Saldo: icono wallet en círculo `#ffdad6`; h1 «Transferencia rechazada: Saldo insuficiente»; subtítulo «El monto solicitado supera los fondos disponibles en tu cuenta.»; tarjeta (≈720) con alerta `#ffdad6` «Fondos preservados» / «No se realizó ningún cargo por este intento. Tu saldo permanece intacto.»
- **W13-V2** `[F]` «DESGLOSE DE OPERACIÓN» + «MXN»: Monto solicitado; Saldo disponible en cuenta (de `GET /accounts` posterior al rechazo); fila destacada `#ffdad6` «Faltante para completar» = solicitado − disponible (bigint, sólo si >0); «Saldo final de la cuenta» + chip «INTACTO» = disponible.
- **W13-V3** `[F]` Límite: chip «OPERACIÓN NO PROCESADA»; h1 «Transferencia rechazada: Límite diario alcanzado»; subtítulo «El monto solicitado excede el disponible diario de transferencias.»; alerta «Rechazo confirmado: No se realizó ningún cargo por este intento.»
- **W13-V4** `[F]` «DESGLOSE DE LÍMITES Y MONTOS»: «Límite diario configurado (demostración)» `dailyLimitMinor`, barra usado/total, «Monto acumulado enviado hoy» `dailyUsedMinor`, «Disponible restante hoy» `dailyRemainingMinor` (`#006d40`), «Monto solicitado en esta operación» (`#ba1a1a`), «Cargo aplicado $0.00 MXN (sin débito)»; info «Tu límite se restablece al iniciar el siguiente día de negocio ({businessTimeZone}).»
- **W13-V5** `[F]` Acciones: «Modificar monto» (primario, icono edit) y «Volver al inicio» (secundario).
- **W13-F1** `[F]` «Modificar monto» vuelve a W08 con todos los campos y foco en importe; sin política, V4 oculta las filas de límite y muestra sólo el mensaje.
- **W13-F2** `[I]` FN-11 (P2 y P4), saldos sin cambio en W03.
- **W13-VZ** Lado a lado (2 estados) sin diferencias materiales no listadas.
**(e)** «asignado a tu cuenta» → «disponible diario» (el límite es por usuario, contrato `TransferPolicy`); hora de reinicio expresada como «siguiente día de negocio» con la zona del servidor (no «00:00 hora de Ciudad de México» literal).
**(f)** `[F]` V1–V5, F1; `[I]` F2.

---

#### W14 · Sesión vencida y acceso no autorizado
**(a)** Aprobadas: `w14_sesi_n_vencida` y `w14_acceso_no_autorizado` (1600×1280; referencias round4). Descartada: `w14_sesi_n_y_permisos` («Protocolo de integridad W14», «Código SEC-EXP-01», «Cifrado de extremo a extremo», «Estado del Sistema», «Garantía operativa», soporte por correo, «Monto reservado», «borrador se mantiene 15 minutos»).
**(b)** `/session-expired` → `SessionExpiredPage`; `/access-denied` → `AccessDeniedPage` (`routes.tsx`); además estados 403 en cuentas/beneficiarios/movimientos. Existe: tarjeta simple sin intento; con intento, layout con rail y tarjetas (no aprobado); acceso denegado con `🔒`. Falta: marca encima de la tarjeta, icono lock_clock/lock SVG, tarjeta única también con intento pendiente, mapeo D-11.
**(c)** F-W14-1 sin intento; F-W14-2 con registro local; F-W14-3 403 en `/accounts`; F-W14-4 404 en `/transfers/{id}/status`; F-W14-5 404 en `/accounts/{id}/movements`; I-W14-6 usuario B abre transferencia y movimientos de A (404 real).
**(d)**
- **W14-V1** `[F]` Lienzo `#f9f9ff`; marca centrada (tile 40 + «Billetera MXN» 18/500) sobre tarjeta ancho 448 (`max-w-md`), radio 12, padding 32, contenido centrado.
- **W14-V2** `[F]` Sesión vencida: icono lock_clock en círculo 80 `#f1f3ff`; título «Tu sesión venció» headline-md; texto «Inicia sesión para continuar operando de forma segura.»; botón primario ancho completo «Iniciar sesión →».
- **W14-V3** `[F]` Con intento pendiente: dentro de la misma tarjeta, bloque `#f1f3ff` «Tienes una transferencia pendiente de verificación por {importe} ({tipo}).» + concepto/referencia; botón «Iniciar sesión y retomar la verificación →»; sin rail ni tarjetas extra.
- **W14-V4** `[F]` Acceso no disponible: icono lock en círculo; «Acceso no disponible»; «No tienes permisos para consultar esta sección o el enlace no es válido.»; botón primario «← Volver al inicio» (→ `/accounts` con sesión, `/login` sin sesión).
- **W14-F1** `[F][I]` D-11: 403 y 404 por id muestran V4 sin revelar si el recurso existe; el registro local de intento queda byte a byte igual (`sessionStorage` comparado antes/después).
- **W14-F2** `[F]` 401 sin refresh posible conserva el registro (lógica `end(true)` existente) y muestra V2/V3; el botón lleva el `state` de reanudación existente; la copia no afirma «sin volver a enviarla».
- **W14-VZ** Lado a lado (vencida, vencida con intento, acceso) sin diferencias materiales no listadas.
**(e)** Sin chip «DEMOSTRACIÓN» (E-G2); V3 no tiene referencia propia (contexto de recuperación permitido); `NotFoundPage` adopta el estilo de V4 con «Página no encontrada».
**(f)** `[F]` V1–V4, F1–F2; `[I]` F1.

---

### 7.3 Dependencia con la ronda de recuperación

#### 7.3.1 Reglas de esta ronda
Esta ronda **no** diseña protocolos de recuperación, **no** cambia claves de idempotencia ni su almacenamiento, **no** borra intentos inciertos (más allá de los puntos de borrado que ya existen y se mantienen), **no** añade reenvíos al cargar/iniciar sesión/volver a primer plano, y **no** trata un 404 ni una coincidencia en historial como prueba de no cargo. W03 pendiente y W11 se presentan contra 0.3.0 con fixtures y con la pérdida de respuesta real de I-W11-6.

#### 7.3.2 Inventario read-only de lo que hace hoy la Web ante una respuesta perdida (código en `f0ed4bc`)
1. **Antes de enviar** (`web/src/transfers.tsx:167-171`): crea `key = crypto.randomUUID()` y guarda `{key, body}` en `sessionStorage['wallet:web:transfer-attempt:<userId>']`; si ya hay registro con otro cuerpo, bloquea el envío nuevo.
2. **Envío** (`:172-186`): `POST /transfers` con `Idempotency-Key`. Éxito → guarda `transferId` y va a `/transfers/{id}/status`. **422/429** → borra el registro y muestra rechazo definitivo. **Cualquier otro error** (sin respuesta, 5xx, 409, 404, 400) → conserva el registro y muestra «Estamos verificando el resultado» con botón que repite el `POST` con la misma clave y cuerpo (`:189-198`).
3. **401** (`web/src/api.ts:64-94`): `request()` refresca y repite automáticamente la misma petición (mismo `Idempotency-Key`).
4. **Al montar `/transfers/new` con registro** (`transfers.tsx:124-142`): con `transferId` → `GET /transfers/{id}`; **sin `transferId` → repite el `POST` automáticamente, sin acción del usuario**. Se monta al navegar a «Transferir», recargar, o tras login con `resumeTransfer` (`routes.tsx:36,43`). Deduplicación sólo dentro de la misma instancia (`recoveryFlights`).
5. **Estado `processing`** (`TransferStatusPage`, «Reintentar mismo envío», `:265-271`): rama inalcanzable hoy (A-10).
6. **Borrado del registro**: 422/429 en create; estado `completed`/`rejected` (`:226-228`); rechazo definitivo en confirm; **logout** (`session.tsx:32`, `clearAllTransferDrafts`); **cambio de usuario en la pestaña** (`transfer-attempt.ts:8-14`).
7. **Alcance**: `sessionStorage` por pestaña; cerrar la pestaña pierde el registro; no hay listado de intentos en 0.3.0.
8. **404**: `GET /transfers/{id}` 404 → «No pudimos consultar el intento», registro conservado (correcto). Create 404 → tratado como incierto, registro conservado (conservador).
9. **Historial**: la Web no usa Movimientos para resolver intentos (correcto; se mantiene).
10. **Confirm** (`:236-261`): clave por `(transferId, código)` sólo en memoria; tras recargar, el mismo código usa otra clave; si el primero se aplicó, el servidor responde 409 y hoy la Web muestra error genérico en vez del comprobante.
11. **Copia**: `SessionExpiredPage` dice «Billetera consultará el mismo intento» aunque el camino real puede repetir el `POST` (punto 4).

#### 7.3.3 Hallazgos a escalar al coordinador (no son diferencias visuales; esta ronda no los corrige salvo H-W5 por lectura)
- **H-W1 (alto)** Reenvío automático al cargar/iniciar sesión (punto 4). Con la misma clave el servidor reproduce el resultado, pero contradice la regla «no reenviar al cargar» y habilita la carrera de H-W4 si el `POST` original sigue en curso (recarga durante el envío).
- **H-W2 (alto)** El registro de un intento incierto se borra al cerrar sesión o al entrar otro usuario (punto 6) → la UI permite una transferencia nueva sin conocer el resultado anterior (posible doble débito por acción del usuario).
- **H-W3 (medio)** Registro por pestaña (punto 7): perder la pestaña pierde el rastro; requiere 0.4.0 `GET /transfer-attempts`.
- **H-W4 (crítico, riesgo de doble débito)** 422/429 en create se tratan como definitivos (punto 2). Con dos `POST` concurrentes de la misma clave (SPEC global R8.3 (f)), el segundo puede recibir 422/429 aunque el primero se haya aplicado: la Web borra el registro y muestra «No se realizó ningún débito»; si el usuario reintenta, usa una clave nueva → segundo débito.
- **H-W5 (bajo, sin doble débito)** 409 en confirm tras recarga (punto 10): el servidor serializa por estado; la Web no muestra el comprobante. Esta ronda sí añade el `GET` posterior (W10-F1), que es sólo lectura.
Decisión requerida: DEP-4. Hasta entonces el comportamiento de red de los puntos 1–8 se congela.

#### 7.3.4 Pendiente `[P]` (contrato 0.4.0)
`GET /v1/transfer-attempts` (W03 aviso sin registro local; W11 verificación por `attemptId`), `POST /v1/transfer-attempts/void` («Anular esta transferencia» en W11), `POST /v1/transfer-attempts/void-all` («Resolver con el servidor» para registros dañados), cabeceras `Transfer-Attempt-Id`/`Transfer-Send-Epoch` y `TransferPolicy.sendEpoch` en el envío, problemas `transfer-attempt-voided|rejected|conflict` (mapeo a W13/W11), «un toque = un POST». No se crea UI visible para nada de esto.

#### 7.3.5 Criterios
- **REC-01** `git diff f0ed4bc -- web/src/transfer-attempt.ts` sólo añade el accesor read-only de §4 (las funciones `saveTransferDraft`, `clearTransferDraft`, `clearAllTransferDrafts`, `activateTransferUser`, `forgetTransferUser`, `readTransferDraft` sin cambios de cuerpo).
- **REC-02** `[F]` Traza dorada: en WF-T0, con el código de `f0ed4bc`, se registran en `docs/evidence/web-final/f0ed4bc/network-golden.json` las peticiones **no-GET** (método, ruta, igualdad de clase de `Idempotency-Key`, hash SHA-256 del cuerpo) de los escenarios S1 envío 201; S2 envío 202 + confirm; S3 envío abortado + reintento; S4 recarga con registro sin `transferId`; S5 login con `resumeTransfer`; S6 422/429; S7 logout con registro. En el SHA final las mismas secuencias son idénticas, salvo el delta aprobado D-12 (`POST /cancel` sólo en el escenario «Volver a revisar»).
- **REC-03** `[F]` W03 y W14 no emiten peticiones de escritura al montarse; W03 no muestra ni registra la clave ni ids.
- **REC-04** `[F]` Ninguna pantalla deduce «sin cargo» de un 404 o de la ausencia/presencia en Movimientos (`rg -n "movements" web/src/transfers.tsx` sin uso para resolver intentos; prueba: 404 en `GET /transfers/{id}` no borra el registro).
- **REC-05** `[F]` Copia veraz W11-F1, W03-F1 y W14-F2 (aserciones de texto por acción real).
- **REC-06** `docs/web-fidelity-final/RECOVERY-INVENTORY.md` reproduce §7.3.2–7.3.3 con referencias de línea del SHA final y el estado de DEP-4.
- **REC-07** Ningún `[P]` produce elementos visibles o botones inertes (FN-14).
- **REC-08** `git diff f0ed4bc --stat -- api mobile packages specs` vacío y `SPEC.md`/`FINDINGS.md` raíz sin cambios en la rama.

---

### 7.4 Excepciones globales permitidas
- **E-G1** Shell unificado 288 px de W03 en todas las pantallas autenticadas (W07–W14 se dibujaron con 256 px y con otras marcas: «Banca Institucional», «Finanzas institucionales», «$»).
- **E-G2** Sin chip «Demostración» en páginas sin sesión.
- **E-G3** Datos reales/sintéticos distintos de los del export (nombres, importes, fechas, número de filas).
- **E-G4** Accesibilidad por encima de la referencia: anillos de foco, skip link, textos de razón en deshabilitados, `title` en truncados, contraste corregido si un token de referencia no alcanza 4.5:1 (documentar valor).
- **E-G5** Diferencias de antialiasing/hinting de Chromium vs export y de DPR.
- **E-G6** Eliminación de todo claim/copy excluido en §2.2 aunque deje un hueco: el hueco se cierra (no se rellena con contenido inventado).

### 7.5 Pasadas Forge, cierre y evidencia
- Máximo **3** evaluaciones. Cada una sobre un SHA concreto: `docs/evidence/web-final/eval-<sha>/` + `docs/web-fidelity-final/FINDINGS.md` (Evaluador). El Generator corrige y entrega nuevo SHA.
- **Cierre** = todos los criterios de §7.1–7.3 PASS y cero diferencias visuales materiales abiertas en cualquier `Wxx-VZ` (incluidas menores) que no estén en (e) o §7.4. Si tras la 3.ª evaluación queda algo abierto → se entrega como BLOCKED/abierto con causa exacta al coordinador.
- Evidencia versionada: `.md`, `.txt`, `.json`, `.tsv`, scripts en `web/e2e-final/`; PNG/JPG no versionados (`.gitignore`), regenerables con `README.md`.

### 7.6 Tandas de Generators, aceptación y entregables

Tandas secuenciales (un Generator por tanda, rama `feature/web-fidelity-final`, commits con prefijo `WF-Tn:` y sólo archivos propios). Cada tanda termina con FN-18 verde, la suite `final` de las tandas anteriores verde y evidencia en `docs/evidence/web-final/<sha>/`.

| Tanda | Contenido | Aceptación |
|---|---|---|
| **WF-T0 Fundación** | Entorno §5.10 (scripts `make-env`, `preflight`, `ENVIRONMENT.md`), `web/e2e-final/playwright.config.ts`, helpers (geometría, contraste, fuentes, lado a lado, trazas), traza dorada en `f0ed4bc` (REC-02), Inter (FONT), tokens (TOK-01), iconos, shell (SH), `useTransferPolicy`, esqueleto de `actions-inventory.md`, `vite.config.ts` cacheDir | ENV-01…06, FONT-01…07, TOK-01, SH-01…09, REC-01/02 (golden), RESP-01 en `/accounts` |
| **WF-T1 Acceso** | W01, W02, W14, NotFound | Fichas W01, W02, W14 completas; A11Y-01…09 en esas vistas |
| **WF-T2 Inicio e historial** | W03 (incl. aviso pendiente), W04, W05 | Fichas W03, W04, W05; REC-03/04; FN-12/13 |
| **WF-T3 Beneficiarios** | W06, W07 | Fichas W06, W07; FN-02 |
| **WF-T4 Transferencia** | W08, W09, W13, política, D-5…D-8 | Fichas W08, W09, W13; FN-03…09, FN-11, FN-15, FN-16 |
| **WF-T5 Confirmación y resultado** | W10, W11, W12, D-12/D-13 | Fichas W10, W11, W12; FN-10, REC-02 (comparación final), REC-05 |
| **WF-T6 Barrido** | Responsive/a11y/zoom/textos largos en todo, SC-01…05, FN-14/17, `RECOVERY-INVENTORY.md`, evidencia final, handoff | Todo §7.1–7.3 PASS; listo para evaluación |

**Entregables al coordinador** (`docs/web-fidelity-final/HANDOFF.md`, escrito por el Generator de WF-T6):
- Rama `feature/web-fidelity-final`; SHA base `f0ed4bc`; SHA final; lista de commits `WF-T0…T6` con hash y resumen.
- Archivos cambiados (debe ser subconjunto de `web/**` sin `web/package.json`, `docs/web-fidelity-final/**`, `docs/evidence/web-final/**`).
- Pruebas y comandos: `node web/e2e-final/scripts/make-env.mjs`, `node web/e2e-final/scripts/preflight.mjs`, `npm run db:migrate:test` (con env 55433), `npx playwright test -c web/e2e-final/playwright.config.ts`, `npm --workspace @fintech-wallet/web run lint|typecheck|build`, `npm --workspace @fintech-wallet/web test`, limpieza del contenedor; resultados por criterio.
- Dependencias: DEP-1…DEP-7 con estado; hallazgos H-W1…H-W5.
- Integración 0.4.0 pendiente `[P]` (§7.3.4) y puntos de inserción en UI ya existentes (W03 aviso, W11 tarjeta) sin elementos inertes.
- Conflictos previsibles: `web/src/transfers.tsx` y `web/src/transfer-attempt.ts` (futura integración Web 0.4.0 y posibles correcciones H-W*); `web/src/style.css`/`components.tsx` (cualquier otra ronda Web); `web/e2e/*.spec.ts` (selectores actualizados por cambio de copia, sin debilitar aserciones de idempotencia); `web/vite.config.ts` (cacheDir); regeneración de `packages/shared` a 0.4.0 (tipos aditivos; la Web debe compilar sin cambios); `docs/design-mapping.md` no se toca (la elección de referencias vive en este SPEC).
- Bloqueos, si los hay, con causa exacta: p. ej. espacio en disco < 2.5 GiB (ENV-01), imagen `postgres:16.10-alpine` ausente (A-5), Node distinto de 26.13.1 (§5.1), rechazo de DEP-1 (fuente) o de D-12 (`/cancel`).
