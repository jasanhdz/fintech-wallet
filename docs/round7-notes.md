# Ronda 7 · tanda H1 (móvil) — notas y decisiones

Alcance: sólo `mobile/**`, documentación y evidencia. No se tocaron `api/**`, migraciones, seed, `wallet_dev` ni los puertos
3200/5174/8083. Las pruebas contra la API real usan `wallet_test` (`npm run db:migrate:test` + `npm run dev:api:testdb` en
3794). Compartir/PDF (M10) se implementó en la tanda H2 (§9). Evidencia: `docs/evidence/round7/efd0704/`.

## 1. Discrepancia del umbral de código (sin cambiar la regla financiera)

| Fuente | Texto | Regla |
|---|---|---|
| `specs/requirements.md:47` REQ-XFER-11 | "Given transferencia de monto **superior** al umbral pendiente de aprobación, when se confirma, then exige código de un solo uso…" | `amount > threshold` |
| `specs/design.md:17` | "OTP **sobre** 5,000 MXN" — "Umbral demo desde env (`5,000 MXN` como ejemplo, no exigencia aprobada)" | ambiguo (sobre = superior) |
| `specs/openapi.yaml:616` (`TransferPolicy.otpThresholdMinor`, contrato) | "Se exige OTP cuando `amountMinor >= otpThresholdMinor`." | `amount >= threshold` |
| `api/src/transfers/service.ts:51` | `const requiresOtp=amount>=threshold;` | `amount >= threshold` |

El contrato OpenAPI y el backend coinciden entre sí (`>=`) y discrepan del texto del requisito (`>`); el diseño es ambiguo.
Comportamiento vigente medido contra la API real en `wallet_test` (ronda 7: `docs/evidence/round7/efd0704/tools/api-r7.mjs`;
repetido en la tanda H3: `docs/evidence/round7/h3-ed4945e/logs/h3-threshold.txt`, umbral de demostración 500000):

| Monto | Centavos | HTTP | Estado |
|---|---|---|---|
| $4,999.99 | 499999 | 201 | `completed` (sin código) |
| $5,000.00 | 500000 | 202 | `awaiting_confirmation` (con código) |
| $5,000.01 | 500001 | 202 | `awaiting_confirmation` (con código) |

Decisión: **no** se cambia la regla, el contrato ni el backend (F-23 es decisión de producto). Exactamente $5,000.00 pide
código hoy; según REQ-XFER-11 literal no debería. **Requiere decisión del Coordinador/producto**, que es dueño de OpenAPI y
de la documentación de producto: o bien (a) se mantiene `>=` y se corrige el texto de REQ-XFER-11 ("igual o superior") y de
`design.md`, o bien (b) se adopta `>` y cambian juntos `specs/openapi.yaml:616`, `api/src/transfers/service.ts:51`, sus
pruebas de integración y la predicción del cliente (`mobile/App.tsx`, `requiresOtp`, y la etiqueta "mayor o igual a"). Hasta
esa decisión el cliente no redefine la regla:

- La variante de M07 ("Continuar a verificación" y el chip "mayor o igual a …") es sólo una **predicción** con
  `otpThresholdMinor` de `GET /v1/transfer-policy` y la misma comparación que hoy aplica la API (BigInt `>=`).
- La pantalla siguiente la decide la respuesta del servidor: 202 `awaiting_confirmation` abre M08 aunque la predicción dijera
  "sin código"; 201 `completed` abre el comprobante aunque la predicción dijera "con código". Pruebas jest `round 7 · 4`
  (499999/500000/500001 y los dos casos de autoridad del servidor).
- Umbral, límite diario, expiración (`otpExpirySeconds` y `Transfer.expiresAt`) e intentos (`otpMaxAttempts`) siempre vienen
  de la API; ningún valor está fijo en el cliente. Son configuración de demostración, no política aprobada.

## 2. Código de demostración (OTP)

- Sólo existe con `APP_ENV=development`: la API lo devuelve en `demoOnlyCode` de la respuesta de creación (y de la repetición
  idempotente del mismo intento). La app lo muestra en el recuadro "Código asignado para esta prueba" de M08; no se guarda en
  SecureStore ni en logs.
- En pruebas se usa ese mismo mecanismo y se enmascara en toda salida (`docs/evidence/round7/efd0704/tools/api-r7.mjs` imprime `••••••`). Las capturas de la
  evidencia se tomaron con el recuadro difuminado.
- Estados de M08: incompleto ("Faltan N dígitos"), completo, verificando ("Verificando código…", distinto de "Enviando" de M09),
  código incorrecto (422; no se reenvía el mismo código), expirado (422 "El código expiró" o cuenta regresiva a 0), intentos
  agotados (429 al llegar a `OTP_MAX_ATTEMPTS`: entrada y "Autorizar" deshabilitados, salida con "Solicitar un código nuevo" o
  "Cancelar y volver a revisar"), cancelación y nuevo código. Un 422 "Saldo insuficiente" o 429 "límite diario" al confirmar es
  un rechazo de negocio confirmado: M11 sin débito y el intento pendiente se cancela.
- Entrada: un único `TextInput` oculto con nombre "Código de confirmación", `autoComplete="one-time-code"`,
  `textContentType="oneTimeCode"`, sólo dígitos, pegado de 6 dígitos y borrado; las seis casillas son decorativas para
  tecnologías de asistencia. **F-24 (tanda H3)**: el campo ya no tiene `maxLength` (el control recortaba "12 34-56" a
  "12 34-" *antes* del filtro); `onChangeText` filtra dígitos y conserva los 6 primeros, así que pegar `12 34-56`,
  `12a3456789` o ` 742-890 ` da los 6 dígitos (medido en RN-Web; en iOS el portapapeles real queda pendiente, F-05).

## 3. "Solicitar un código nuevo" (sin endpoint nuevo)

1. Con un confirm de resultado incierto no se hace nada (F-06).
2. El intento anterior debe quedar **confirmado** como `cancelled`/`expired` por la API antes de crear otro: `POST …/cancel`; si
   falla, `GET …/{id}`. Si terminó `completed` se muestra su comprobante; si su estado no se puede leer, no se crea nada y se
   explica.
3. El nuevo intento conserva monto, origen, destino, concepto y referencia, con una `Idempotency-Key` nueva.
4. Integración real: confirmar el intento cancelado con su propio código responde 409 sin mover dinero; el código viejo contra
   el intento nuevo responde 422; sólo el código nuevo completa, con un único débito de 600000.

## 4. Barra de saldo estimado (M07)

En Stitch (`m07_*/code.html`) los segmentos son `93.17 %`/`6.83 %` = $11,600/$12,450 y $850/$12,450 (y `51.81 %`/`48.19 %`
en la variante de $6,000): son **datos reales** — azul = saldo que queda tras la transferencia, segundo segmento = parte del
saldo actual que usa la transferencia. No representa límite ni riesgo. Se conserva con la misma proporción (BigInt, puntos
base), pero el segundo segmento pasa de salmón (`tertiary-fixed-dim`, lectura de alarma) a gris neutro (`outline-variant`), y
la barra es decorativa para tecnologías de asistencia (`accessibilityElementsHidden` /
`importantForAccessibility="no-hide-descendants"`) porque el texto "Cálculo: $A - $B = $C MXN" ya expresa todo. No se inventó
métrica.

## 5. Escala tipográfica

Antes: 40 estilos a 10 pt (captions, insignias, límite y disponible diario de M06, captions de M07, detalle del comprobante,
pies, iniciales). Ahora ningún texto baja de 12 pt (con interlineado ≥ tamaño), ayuda y errores a 14 pt (aviso misma cuenta,
advertencias, descripción y estados de M08, cuenta regresiva, recuadro del código, mensajes de M09/M11), etiquetas de M07 a
14 pt como sus valores, fecha de M10/M04 a 14 pt, pestañas a 13 pt. Objetivos táctiles ≥ 44 pt (se añadió al enlace "Cambiar"
de Inicio). Diferencia frente a los PNG: los textos que en Stitch eran 10 px se ven más grandes; las pantallas largas pasan a
desplazarse antes (no se redujo nada para evitarlo). Comparación lado a lado en la evidencia.

## 6. Otras decisiones

- **M02 combinación incompatible**: con destino = origen (identidad `ownAccountId`), Inicio ofrece "Elegir otro destinatario"
  (abre M05, que explica el conflicto y ofrece cambiar el origen); nunca "Continuar con transferencia".
- **M09/M12**: "Ir al inicio" deja en Inicio el aviso "Transferencia en verificación" (monto y referencia, sin afirmar nada
  sobre el dinero). ~~Su acción repite el mismo intento con su llave original.~~ **Cambiado en la tanda H5 (§11)**: verificar sólo
  lee; el reenvío con la llave original es una acción aparte, explícita y confirmada. El registro de recuperación guarda el id de
  usuario: una sesión vencida lo conserva y el mismo usuario lo reanuda al volver a entrar; otro usuario en el dispositivo
  nunca lo ve ni lo consume. ~~Cerrar sesión explícitamente lo borra.~~ **Cambiado en la tanda H3 (F-21/F-22, §10)**: ningún
  cierre de sesión borra el registro; sólo se borra cuando la API informa el intento resuelto. La cortina de privacidad se
  aplica en `inactive` (selector de apps de iOS) y `background`. No es protección biométrica.
- **M11**: "no se debitó" sólo con 422 o 429 "límite diario" (rechazos de negocio confirmados). **Tanda H5**: cualquier otro 4xx
  (409 "en curso", 401, 403, 400, 404, 429 de tasa) y un error de conexión dejan el intento en verificación (M09), nunca M11; la
  variante "Revisa tu saldo antes de reintentar" de M11 ya no existe.
- **F-20**: filas de movimientos, tarjetas de beneficiario y opciones de cuenta nombran todo su contenido visible.
- **Frecuentes**: diferencia deliberada fuera de alcance (no hay dato de frecuencia en la API; no se inventa ranking).
  **"Sin costo de comisión"** no se muestra (no hay respaldo).

## 7. Biometría (mejora futura opcional)

`grep` de "biométric", "Face ID", "Touch ID" y "huella" en `mobile/` y documentación de producto: no hay afirmaciones
biométricas en la app; las únicas menciones son el bonus opcional de `docs/challenge.md` y notas que confirman su ausencia. No
se implementa Face ID/Touch ID ni se añaden dependencias. Queda como mejora futura opcional (p. ej. `expo-local-authentication`
para desbloquear la sesión guardada), fuera del alcance obligatorio.

## 8. Pendiente nativo (sin simulador/iPhone en este host)

Hermes, SecureStore/Keychain, `AppState` real (`inactive` en el selector de apps), autollenado `oneTimeCode` del teclado iOS,
pegado desde el portapapeles, Dynamic Type real 130/200 %, VoiceOver/Control por voz con los nombres nuevos, safe area real y
gesto atrás en M08. Todo lo anterior está probado con jest (render RN) y con el bundle web (RN-Web), que es una aproximación.

## 9. Tanda H2: "Compartir comprobante" y PDF en M10

Evidencia: `docs/evidence/round7/e57690d/`.

- **Fuente de datos**: `mobile/src/receipt.ts` construye el documento sólo desde la transferencia confirmada que ya muestra
  M10 (`status === 'completed'`, leída de la API con la sesión del usuario): monto, fecha con `formatBusinessDateTime`
  (America/Mexico_City), estado, origen/destino por terminación, concepto, referencia y folio real (`receiptReference`, que
  la API iguala al id UUID). No copia `clabe` completa, `demoOnlyCode`, `requestId`, ids de cuentas/beneficiarios ni el
  correo. Cualquier otro estado devuelve `null` y no se ofrecen acciones. Aviso fijo: "Comprobante interno de demostración
  — no es un comprobante bancario oficial". Sin afirmaciones de SPEI, cifrado ni biometría.
- **Acciones** (`mobile/src/receiptShare.ts`): "Compartir comprobante" comparte un resumen de texto con `Share` de React
  Native (hoja nativa; el mismo generador de filas que el PDF, sin duplicar lógica). El PDF se genera con `expo-print`
  (`printToFileAsync` con HTML escapado, sin scripts ni recursos remotos) y se entrega con `expo-sharing`
  (`application/pdf`, UTI `com.adobe.pdf`). Nada se envía sin un toque del usuario.
- **Etiqueta por plataforma** (`Platform.select`): iOS "Guardar PDF" (la hoja ofrece "Guardar en Archivos"); Android y web
  "Compartir PDF" (el chooser de Android no garantiza un destino de guardado). No se usa "Descargar": no hay descarga.
- **Estados**: una acción a la vez (indicador en la pulsada con su nombre, la otra deshabilitada, texto vivo "Generando el
  PDF del comprobante…" / "Abriendo la hoja para compartir…", dobles toques ignorados); cerrar la hoja no es error
  (`shareAsync` resuelve; `AbortError`/"cancel" también se tratan como cierre); error de generación o de la hoja → mensaje
  en español reintentable sin rutas; `isAvailableAsync() === false` → "Compartir no está disponible en este dispositivo." y
  no se genera el PDF; web → mensaje y la rama nativa queda fuera del bundle.
- **Archivo temporal**: el PDF vive en la caché de `expo-print`; se borra con `deleteAsync(uri, { idempotent: true })`
  (`expo-file-system/legacy`) al cerrar la hoja, en error y al desmontar M10 con la hoja abierta. Un fallo al borrar no se
  muestra al usuario.
- **M04**: no ofrece PDF. Un movimiento recibido no tiene lectura autorizada de la transferencia (`GET /transfers/{id}` es
  sólo del emisor), así que no hay folio autorizado; para los enviados queda como posible extensión con el mismo generador.
- **Dependencias**: `expo-print ~58.0.9`, `expo-sharing ~58.0.23`, `expo-file-system ~58.0.13` (directa). Procedimiento y
  diff en el README de la evidencia.

## 10. Tanda H3 (pasada 8): un solo intento abierto por usuario (F-21) y registro ligado a su dueño (F-22)

Criterio aplicado (del evaluador): mientras exista un intento incierto o pendiente propio del usuario, la app no ofrece ningún
camino para crear otro intento sin resolver el primero. Sigue vigente; las tandas H4 y H5 cambiaron cómo se verifica y cuándo
se libera (§11 sustituye a las reglas de H3 y H4 donde difieren).

- **Registro**: `wallet.transfer-recovery.<userId>` en SecureStore (una entrada por usuario; claves `[A-Za-z0-9._-]`). Se
  escribe antes de enviar el `POST /transfers` y guarda llave, cuerpo, `transferId` y último estado conocidos (desde H5 también el
  consentimiento y etiquetas enmascaradas, §11.3). El hueco único anterior (`wallet.transfer-recovery`, escrito hasta la ronda 7)
  se migra a la clave de su dueño la primera vez que ese usuario entra; si pertenece a otro usuario no se lee, no se reemplaza y
  no se borra. Un hueco antiguo ilegible se mueve tal cual a la clave del usuario que entra (nunca se borra).
- **Regla de cierre de sesión (cambio respecto a §6)**: ni "Cerrar sesión" ni una sesión vencida borran el registro. Ningún otro
  usuario puede borrar el registro de A (F-22) y A lo vuelve a ver al entrar. Cuándo se borra: §11.1.
- **Inicio con registro**: el aviso ("Transferencia en verificación" o, si la API ya lo reporta `awaiting_confirmation`,
  "Transferencia pendiente de autorizar") sustituye a todas las entradas de transferencia: no aparecen "Transferir dinero", la
  tarjeta del destino conservado, "Cambiar", "Continuar con transferencia" ni "Elegir otro destinatario". Sus acciones: §11.2.
- **Defensa en profundidad**: `submitCreate` (cualquier intento con llave nueva) lee el registro del usuario antes de enviar;
  si existe, no envía nada y vuelve a Inicio con el aviso; si SecureStore no se puede leer o el registro está dañado, no envía
  nada (falla cerrado). La única excepción es "Solicitar un código nuevo", que sólo crea el nuevo intento después de que la API
  confirmó el anterior `cancelled`/`expired` (§3).
- **Salir del código (M08)**: "Cancelar y volver a revisar" espera la cancelación; sólo con el intento confirmado
  `cancelled`/`expired` borra el registro y vuelve a revisión. Si la API no lo confirma, se conserva el registro y se va a Inicio
  con "Transferencia pendiente de autorizar". Igual para un 422 "Saldo insuficiente" / 429 "límite diario" al *confirmar*
  (desde H5): M11 explica el rechazo (esa confirmación no movió dinero), pero el registro sólo se borra si el `cancel` posterior
  confirma el intento cerrado; si no, Inicio lo sigue mostrando como pendiente de autorizar.

### 10.1 Otros hallazgos de la pasada 8 (tanda H3)

- **F-15 (M07 umbral con nombres reales)**: en la variante con código, el círculo decorativo de 48 px del importe pasa a
  ser un icono en línea (el mismo, 18 pt) junto a "Monto a transferir". No se redujo ningún texto (mínimo medido 12 px), los
  botones siguen en 48/44 pt y el chip conserva su texto completo. Medido en RN-Web con "Cuenta principal" → "Cuenta de ahorro
  demo", $6,000.00: "Continuar a verificación" / "Modificar datos" a 390x844 = 720-768 / 776-820 (antes 762-810 / 818-862,
  fuera); a 884 = 760-808 / 816-860; a 763 (safe area simulada) = 639-687 / 695-739. Las variantes normal y propias no
  cambian y caben a 844, 884 y 763. Diferencia frente a Stitch (que conserva el círculo): documentada. Safe area real en
  iPhone sin verificar (F-05).
- **F-24 (pegado de código)**: ver §2.
- **F-25 (iniciales con texto ampliado)**: avatares de Inicio, encabezados de flujo y tarjetas de beneficiario con tamaños
  mínimos (32/44 pt) en lugar de fijos, radio de píldora e iniciales en una línea. A 100 % son los mismos círculos; a 200 %
  (aproximación CSS) "AL" mide 36x40 dentro de 44x40 en Inicio y 31x32 dentro de 39x32 en M07, sin controles < 44 px ni
  desbordes horizontales. `fontScale`/Dynamic Type real sin verificar (F-05).
- **F-23**: sin cambio de regla; §1 documenta requisito, diseño, contrato OpenAPI y backend con las mediciones.

Evidencia (código `ed4945e`): `docs/evidence/round7/h3-ed4945e/` (README con el procedimiento, scripts, logs y capturas antes/
después lado a lado).

## 11. Tanda H5 (sustituye a H4): verificar sólo lee, reenvío explícito y consentido, sin descarte

La tanda H4 (pasada 9) añadió un descarte manual ("Descartar este intento"), liberaba el registro ante un 404 de
`GET /transfers/{id}` o del `POST` ("El servidor no tiene registro… Ya puedes hacer otra transferencia") y su "Verificar estado"
repetía el `POST` cuando no había `transferId`. **Las tres reglas se retiraron en H5**: el descarte y el 404 permitían crear otro
intento sin saber si el primero había cobrado (y el texto afirmaba implícitamente que no), y una consulta no debe poder crear una
transferencia. Principio de H5: **nada debita dos veces en ninguna variante**; ante la duda se conserva el registro y el bloqueo.

### 11.1 Cuándo se libera el registro (sólo con el resultado final confirmado del MISMO intento)

| Respuesta del servidor | Efecto |
|---|---|
| `GET /transfers/{id}` → `completed` | Comprobante (M10); se borra el registro. |
| `GET /transfers/{id}` → `rejected` / `expired` / `cancelled` | M11 / cierre sin movimiento; se borra. Sólo aquí (y en la fila siguiente) los textos dicen "no se movió dinero" / "Tu dinero está intacto". |
| 422 / 429 "límite diario" al primer envío de una llave nueva, o **dos veces seguidas** al mismo "Reenviar la misma transferencia" (§11.3) | Rechazo de negocio confirmado: M11 con el motivo; se borra. |
| `POST …/cancel` confirmado `cancelled`/`expired` (salir de M08, código nuevo, rechazo de negocio al confirmar) | Se borra. |
| 404 de `GET`, 404 del `POST`, 400, 401, 403, 409 (incluido "en curso"), 429 de límite de tasa, 5xx, sin respuesta, registro dañado, almacenamiento ilegible | **Nunca** libera. El registro queda byte a byte igual y las transferencias nuevas siguen bloqueadas. |

Ninguna salida de M09 ("Ir al inicio", flecha, "Ver movimientos") ni de M11 ("Volver al inicio", "Modificar monto o cuenta")
borra un registro: M11 sólo se alcanza con un rechazo ya confirmado, cuyo registro se borró al confirmarse.

### 11.2 Salidas por caso (todas seguras; ninguna crea otro intento)

| Caso | Qué ve el usuario | Acciones |
|---|---|---|
| Primer envío, reintento o reenvío con 409 "en curso" / 401 / 403 / 400 / 404 / 429 de tasa / 5xx / sin red | M09 "Estamos verificando si tu transferencia se completó" con el detalle del servidor; nunca M11 | "Verificar estado de la transferencia" (lectura), "Ver movimientos", "Reenviar la misma transferencia" (si no hay `transferId`), "Ir al inicio (revisar saldo después)" |
| Registro sin `transferId` (la respuesta del `POST` se perdió, antes o después de aplicarse) | Inicio: "Transferencia en verificación". "Verificar" no envía nada: "Esta operación aún no tiene número del servidor, así que no podemos consultarla. No podemos confirmar si se realizó un cargo. Para conocer su resultado sin riesgo de un cargo doble usa «Reenviar la misma transferencia»…" | "Verificar estado" (no envía nada; refresca saldo y movimientos), "Ver movimientos" (informativo), "Reenviar la misma transferencia" (la reconciliación autoritativa) |
| Registro con `transferId` y `GET` 404 | "El servidor no encuentra esta operación. No podemos confirmar si se realizó un cargo: revisa Movimientos y tu saldo." (Inicio y M09); registro conservado | "Verificar de nuevo", "Ver movimientos", "Reenviar la misma transferencia" (idempotente con la misma llave: si ya se aplicó, el servidor devuelve la misma transferencia) |
| Registro con `transferId` y `GET` sin respuesta / 5xx / 401 | "Sin respuesta por ahora…" | "Verificar estado" (se reintenta solo al volver a Inicio o a primer plano), "Ver movimientos" |
| `awaiting_confirmation` | "Transferencia pendiente de autorizar" | "Continuar con la transferencia pendiente" (`GET` y M08 **sin** el código: no se guarda en el dispositivo; "Solicitar un código nuevo" o "Cancelar y volver a revisar" según §3/§10) |
| Registro dañado (JSON inválido, campos faltantes) | "No pudimos recuperar los datos de una transferencia en verificación guardada en este dispositivo. No sabemos si se realizó un cargo; no vuelvas a enviar hasta revisar Movimientos…" (sin texto técnico) | "Reintentar lectura", "Ver movimientos". Sin reenvío (no hay llave ni cuerpo recuperables) y sin transferencia nueva |
| SecureStore no se puede leer | "No pudimos comprobar tus transferencias" + mismo aviso de cargo | "Reintentar lectura" (si la lectura vuelve y no hay registro, se desbloquea; si hay registro, se muestra su aviso), "Ver movimientos" |

"Verificar estado de la transferencia", "Verificar de nuevo", "Continuar con la transferencia pendiente", la comprobación al
mostrar Inicio, la vuelta a primer plano (con sesión confirmada por `/auth/me` o refresh), el arranque y el inicio de sesión son
**sólo lecturas** (`GET /transfers/{id}`, `/accounts`, `/accounts/{id}/movements`). Ninguno envía `POST /transfers`.

**Movimientos es sólo informativo.** Una coincidencia de monto, concepto, referencia u hora **no prueba** que un cargo sea este
intento (puede ser otra transferencia igual), así que la app nunca da por resuelto, libera ni muestra comprobante de un intento sin
`transferId` a partir de un cargo que "se parece" (la tanda H5 lo hizo en `338be55` y se retiró en el commit siguiente por esa razón).
Junto a "Ver movimientos" se lee: "En Movimientos revisa si aparece un cargo con estos datos; una coincidencia no prueba que sea
este intento." La reconciliación autoritativa de un intento con llave y cuerpo guardados es el reenvío consentido (§11.3): con la
misma llave el servidor devuelve la transferencia ya aplicada (mismo folio) o, si nunca se aplicó, la crea con el consentimiento
registrado; en ningún caso hay dos.

### 11.3 Reenvío consentido: "Reenviar la misma transferencia"

- **Nunca automático**: no lo dispara Inicio, el primer plano, el arranque ni el inicio de sesión. Sólo se ofrece mientras el
  servidor no conoce el resultado (sin `transferId`, o `GET` 404) y nunca para un registro dañado o ilegible.
- **Primero revisa**: el botón abre una pantalla con los **datos originales del registro** (monto, cuenta de origen, destinatario,
  concepto, referencia; origen y destino con las etiquetas enmascaradas guardadas al confirmar), la marca de tiempo del toque
  original ("Confirmaste esta transferencia el 13 de noviembre de 2026, 14:30 hrs (Tiempo del Centro de México)") y el estado del
  código ("Ya habías autorizado su código…" / "El servidor pidió su código…" / "Si el servidor pide un código…"). Explica que se
  reenvía con la misma clave y que, si ya se aplicó, el servidor devuelve esa misma transferencia. Abrirla no envía nada;
  "Volver sin reenviar" (o la flecha) regresa sin cambios.
- **Sólo el toque de confirmación envía**, con el texto "Reenviar la misma transferencia". La app vuelve a leer el registro de
  SecureStore y envía **exactamente** su `Idempotency-Key` y su cuerpo (`JSON.stringify` del `payload` guardado: los mismos bytes
  del primer envío). Nunca llave nueva ni datos recapturados del formulario. Si el registro cambió o desapareció entretanto, no
  envía nada.
- **Respeta el código**: un 202 / `awaiting_confirmation` lleva a M08 y exige el código; el código nunca se guarda, así que el
  reenvío no puede omitirlo. Resultados: 201/200 `completed` → comprobante; 422/429 "límite diario" → M11 confirmado; cualquier
  otra respuesta → M09 con el registro intacto (§11.2).
- **Consentimiento en el registro** (`consent`): `confirmedAt` (ISO del toque en "Confirmar transferencia"/"Continuar a
  verificación" o en "Solicitar un código nuevo"), `via` (`confirm`/`new_code`) y `otp` (`unknown`, `required` cuando el
  servidor respondió 202, `authorized` cuando el usuario tocó "Autorizar transferencia"; nunca el código). También `display`
  (origen y destino como "Nombre •• 1234"; nunca la CLABE completa). Registros anteriores a H5 no tienen estos campos: la pantalla
  lo dice ("la fecha no quedó guardada en este dispositivo") y busca el origen en las cuentas cargadas.
- **Por qué no duplica**: la API identifica la operación por `Idempotency-Key` por usuario; la misma llave con el mismo cuerpo
  devuelve el mismo intento (o 409 "en curso" si el primero aún se procesa, que deja el intento en verificación).
- **Rechazo de negocio de un reenvío, confirmado en el mismo toque**: la API comprueba saldo y límite después de bloquear las
  cuentas (`api/src/transfers/service.ts`), así que un reenvío que coincide con un envío anterior de la misma llave todavía en
  curso puede recibir 422/429 "límite diario" aunque ese envío sí se aplicó (H4 lo dejaba como ventana aceptada y M11 habría dicho
  "Tu dinero está intacto"). Ahora, dentro del mismo toque, la app repite **una vez** el mismo `POST` con la misma llave y el mismo
  cuerpo: si el envío anterior se aplicó, el servidor lo devuelve (comprobante, sin cargo nuevo); sólo un segundo rechazo de
  negocio se toma como definitivo. El primer envío de una llave nueva no puede coincidir con otro y su 422/429 es final.

### 11.4 Residual: registro dañado permanente (requiere decisión de producto)

Si el registro está dañado de forma permanente (o un registro antiguo cuyo reenvío recibe siempre 404, p. ej. un beneficiario que
ya no existe), la app **no puede** saber si hubo cargo, **no puede** reenviar (sin llave/cuerpo, o el servidor lo rechaza sin
confirmar el resultado) y, por decisión de esta tanda, **no inventa un borrado**. El dispositivo queda bloqueado para transferir
desde la app móvil; consultar saldo y Movimientos sigue disponible. Hoy la salida es **operativa, fuera de la app**: soporte
revisa con el usuario sus movimientos en el servidor y el usuario puede operar desde la web (el bloqueo es sólo del cliente
móvil). En Android, "Borrar datos de la app" debería eliminar el registro (no verificado en dispositivo); en iOS los elementos del Keychain pueden sobrevivir a la
reinstalación (no verificado, F-05), así que puede no haber salida en ese dispositivo. **Nunca se afirma que no hubo cargo.**

Opciones para decidir (Coordinador/producto; ninguna implementada):

1. **Liberación explícita tras revisar Movimientos, como riesgo aceptado**: una acción "Ya revisé mis movimientos" disponible sólo
   para registros dañados/irrecuperables, que muestra primero los movimientos recientes del servidor y exige confirmar que el
   usuario los revisó; registra la decisión. Riesgo aceptado: si el intento sí se aplicó y el usuario lo pasa por alto, puede
   enviar otra transferencia igual (doble débito por decisión del usuario).
2. **Liberación asistida por soporte con verificación del servidor**: un flujo/endpoint nuevo (requiere API y contrato, fuera del
   alcance móvil) en el que soporte confirma en el servidor el resultado de las operaciones del usuario y emite un desbloqueo de un
   solo uso ligado al usuario y al dispositivo; sin ese desbloqueo, el bloqueo se mantiene.

### 11.5 Verificación

- Pruebas jest nuevas en `mobile/tests/recovery-h5.test.tsx` (requisitos 1-5). Pruebas de H4 y de `app.test.tsx` que codificaban
  el descarte, la liberación por 404 o el `POST` dentro de "Verificar" se retiraron o se ajustaron (lista y motivo en el README de
  la evidencia).
- Mutaciones (`docs/evidence/round7/h5-*/tools/mutate-h5.py`): las dos de F-28 (guard con `catch { existing = null }`,
  `requestNewCode` con `replacesClosedAttempt=true`) y las de los requisitos 1-5 hacen fallar pruebas.
- Integración real (API + `wallet_test`, render web con Playwright) y límites: README de `docs/evidence/round7/h5-*/`. Nativo
  (Keychain real, `AppState` real, VoiceOver) sigue pendiente (F-05).
