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
  sobre el dinero) cuya acción repite el mismo intento con su llave original. El registro de recuperación guarda el id de
  usuario: una sesión vencida lo conserva y el mismo usuario lo reanuda al volver a entrar; otro usuario en el dispositivo
  nunca lo ve ni lo consume. ~~Cerrar sesión explícitamente lo borra.~~ **Cambiado en la tanda H3 (F-21/F-22, §10)**: ningún
  cierre de sesión borra el registro; sólo se borra cuando la API informa el intento resuelto. La cortina de privacidad se
  aplica en `inactive` (selector de apps de iOS) y `background`. No es protección biométrica.
- **M11**: "no se debitó" sólo con 422 o 429 "límite diario" (rechazos de negocio confirmados); otros 4xx quedan "Revisa tu
  saldo antes de reintentar" y un error de conexión va a M09, nunca a M11.
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
camino para crear otro intento sin resolver el primero.

- **Registro**: `wallet.transfer-recovery.<userId>` en SecureStore (una entrada por usuario; claves `[A-Za-z0-9._-]`). Se
  escribe antes de enviar el `POST /transfers` y guarda llave, cuerpo, `transferId` y último estado conocidos. El hueco único
  anterior (`wallet.transfer-recovery`, escrito hasta la ronda 7) se migra a la clave de su dueño la primera vez que ese usuario
  entra; si pertenece a otro usuario no se lee, no se reemplaza y no se borra.
- **Regla de cierre de sesión (cambio respecto a §6)**: ni "Cerrar sesión" ni una sesión vencida borran el registro. Sólo se
  borra cuando la API informa el intento como resuelto (`completed`, `rejected`, `expired`, `cancelled`, o un rechazo de
  negocio 422/429 "límite diario" del mismo intento, que no generó asientos). Así ningún otro usuario puede borrar el registro
  de A (F-22) y A lo reanuda con la misma llave al volver a entrar (F-21 agravante a). Es la regla más simple que cumple
  ambos: el cierre de sesión no toca registros de recuperación.
- **Inicio con registro**: el aviso ("Transferencia en verificación" o, si la API ya lo reporta `awaiting_confirmation`,
  "Transferencia pendiente de autorizar") es la única acción de transferencia: no aparecen "Transferir dinero", la tarjeta del
  destino conservado, "Cambiar", "Continuar con transferencia" ni "Elegir otro destinatario". La acción ("Verificar estado de
  la transferencia" / "Continuar con la transferencia pendiente") reanuda el mismo intento: `GET /transfers/{id}` o la
  repetición idempotente del mismo `POST` (misma llave y cuerpo).
- **Resolución automática**: Inicio consulta el intento (misma llave) cada vez que se muestra y al volver a primer plano con
  la sesión confirmada (`/auth/me` o refresh correctos). Si quedó `completed` muestra el comprobante; `rejected` M11;
  `expired`/`cancelled` el cierre sin movimiento; en todos los casos borra el registro y al volver a Inicio el flujo de
  transferencia vuelve a estar disponible. Si sigue pendiente, en proceso o sin respuesta, el aviso permanece ("Sin respuesta
  por ahora…").
- **Defensa en profundidad**: `submitCreate` (cualquier intento con llave nueva) lee el registro del usuario antes de enviar;
  si existe, no envía nada y vuelve a Inicio con el aviso; si SecureStore no se puede leer, no envía nada (falla cerrado). La
  única excepción es "Solicitar un código nuevo", que sólo crea el nuevo intento después de que la API confirmó el anterior
  `cancelled`/`expired` (§3).
- **Salir del código (M08)**: "Cancelar y volver a revisar" ahora espera la cancelación; sólo con el intento confirmado
  `cancelled`/`expired` borra el registro y vuelve a revisión. Si la API no lo confirma, el intento puede seguir abierto: se
  conserva el registro y se va a Inicio con "Transferencia pendiente de autorizar".
- **Residual documentado**: un 422 "Saldo insuficiente" o 429 "límite diario" al *confirmar* sigue cerrando el intento con un
  `cancel` de mejor esfuerzo y borra el registro (comportamiento de la ronda 7). Si ese `cancel` fallara, el intento quedaría
  `awaiting_confirmation` hasta su `expiresAt` sin que la app conserve su código: no puede confirmarse desde la app ni mover
  dinero.

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

## 11. Tanda H4 (pasada 9): salida segura del bloqueo (F-26), 4xx no verificado (F-21 residual), sin repetición sin toque (F-27) y cobertura del guard (F-28)

Restricción que se conserva (F-21/F-22 de H3): mientras exista un intento incierto o pendiente propio no hay camino a crear
otro con llave nueva; cerrar sesión no borra el registro; otro usuario no toca el registro de A. Lo nuevo es una salida
segura y proporcional: el registro sólo se suelta solo ante un negativo definitivo del servidor o por decisión explícita del
usuario, advertida y confirmada.

### 11.1 Cuándo se libera el registro automáticamente (F-26 a)

| Consulta | Respuesta | Efecto |
|---|---|---|
| `GET /transfers/{id}` (registro con `transferId`) | **404** | El servidor no tiene ese intento para este usuario: se borra el registro, Inicio dice "El servidor no tiene registro de la operación de $X (Ref: R), así que dejamos de darle seguimiento… Ya puedes hacer otra transferencia." |
| Repetición del `POST /transfers` con la misma llave y cuerpo (registro sin `transferId`) | **404** (beneficiario/cuenta inexistente), **422** (p. ej. saldo insuficiente, origen = destino), **429 "límite diario"** | La API sólo responde esto *después* de buscar la llave (`api/src/transfers/service.ts`, `createTransfer`): no existe intento con esa llave. Se borra el registro y se muestra M11 con el motivo ("Tu dinero está intacto" es cierto para ese intento). |
| Cualquiera | **400**, 401, 403, **409** (incluido "en curso"), 429 de límite de tasa, 5xx, sin respuesta | **Nunca** libera. El 400 se valida *antes* de buscar la llave (`service.ts:28-29`), así que no prueba que el intento no exista (p. ej. tras endurecer una validación). |

Ventana de carrera conocida (aceptada): si una repetición llega *mientras* el primer `POST` con esa llave todavía se procesa, la
API puede responder 422 "Saldo insuficiente"/429 "límite diario" porque el primero ya descontó el saldo/límite (bloqueo de filas)
y la repetición se libera aunque el primero se aplicó. Es autoprotegida para el mismo importe (un segundo intento igual también
sería rechazado por la misma razón) y con F-27 la repetición sólo ocurre por un toque del usuario, ya fuera de la ventana de
milisegundos. El 409 "en curso" (la otra cara de esa carrera) nunca libera.

### 11.2 Registro dañado o almacenamiento ilegible (F-26 b/d)

- Registro dañado (JSON inválido o sin `key`/`payload`/importe válido): ya no aparece "Unexpected end of JSON input". Inicio muestra
  "Registro de transferencia dañado" con texto claro, bloquea las entradas a una transferencia nueva y ofrece el descarte (11.3).
  Si el guard lo encuentra al confirmar, no envía nada y vuelve a Inicio con ese aviso.
- Hueco antiguo (`wallet.transfer-recovery`, sin `userId`): sigue la migración a quien inicia sesión (regla de H3). Si es ilegible
  se copia tal cual a la clave de ese usuario antes de tratarlo como dañado, así el descarte sólo borra la clave del usuario actual.
  Si su repetición recibe un negativo definitivo, se libera por 11.1.
- SecureStore ilegible: el guard sigue cerrando en falla (0 `POST`, mensaje "No pudimos comprobar si tienes una transferencia en
  verificación…"). Inicio muestra "No pudimos comprobar tus transferencias" con "Reintentar comprobación" y el descarte.

### 11.3 Descarte explícito (F-26 c) y riesgo aceptado

- **Cuándo se ofrece** ("Descartar este intento", acción secundaria del aviso de Inicio): sólo si el intento no se pudo verificar:
  registro dañado, almacenamiento ilegible, última consulta sin respuesta (`GET` fallido), o intento cuyo id nunca llegó (Inicio no
  puede leerlo; sólo la repetición con toque lo resuelve). **No** se ofrece mientras se consulta ni cuando el servidor confirmó que
  el intento espera su código (allí la salida es "Cancelar y volver a revisar" de M08, confirmada por la API).
- **Confirmación**: diálogo modal (`Modal` de React Native; en web `role=dialog`, `aria-modal`) "¿Descartar este intento?" con la
  advertencia "Revisa primero Movimientos: si el cargo aparece, la transferencia ya se realizó. Descartar no la cancela ni la
  revierte." y "Descartar intento" / "Conservar intento". Conservar (o el gesto/botón atrás) no cambia nada.
- **Efecto**: borra sólo `wallet.transfer-recovery.<userId actual>` (nunca el hueco antiguo ni claves de otros usuarios) y lo vuelve a
  leer; sólo si la lectura confirma que no queda registro se informa éxito: Inicio muestra "Descartaste manualmente el seguimiento
  de una transferencia anterior. Si su cargo aparece en Movimientos, esa transferencia sí se realizó." (sin importes ni ids). Si el
  almacenamiento no permite borrar o leer: "No pudimos descartar el registro en este dispositivo…", el aviso y el bloqueo siguen.
- **Riesgo aceptado (decisión documentada)**: si el intento descartado sí se aplicó y el usuario no revisa Movimientos, puede enviar
  otra transferencia igual (doble débito por decisión explícita tras la advertencia). El descarte no cancela nada en el servidor:
  un intento `awaiting_confirmation` descartado queda sin código en la app y expira solo en `expiresAt` (no mueve dinero).

### 11.4 F-21 residual: 4xx no verificado

- Al **reintentar** un intento cuyo resultado ya era incierto (M09 "Verificar estado" o el toque en Inicio), un 4xx que no sea rechazo
  confirmado (409 "en curso", 401, 403, 429 de tasa, 400) deja el intento incierto en M09 con su registro; nunca lleva a M11.
- En el **primer envío** un 4xx no confirmado sigue mostrando M11 "Revisa tu saldo antes de reintentar" (F-09), pero sus salidas ya
  no sueltan el registro y desaparece "Modificar monto o cuenta": "Volver al inicio" deja Inicio con el aviso.
- Sólo un rechazo confirmado (422, 429 "límite diario", o el 404 posterior a la búsqueda de la llave) suelta el registro, en cuanto
  se conoce.

### 11.5 F-27: sin repetición del `POST` sin toque

- Inicio (cada vez que se muestra) y la vuelta a primer plano sólo **leen**: `GET /transfers/{id}` cuando el registro tiene id.
- Un registro **sin** `transferId` (la respuesta se perdió antes de conocer el id) sólo se repite (`POST /transfers`, misma llave y
  cuerpo) con el toque explícito en "Verificar estado de la transferencia" (aviso de Inicio o M09).
- Arranque e inicio de sesión: antes repetían el `POST` solos (documentado en la ronda 7 · 8 y H3 §10 "Resolución automática");
  ante la duda se exige el toque también aquí. Un registro con id se lee (`GET`) al arrancar y, si el servidor dice
  `awaiting_confirmation`, M08 se reabre; la repetición que recupera el código de demostración en memoria no puede crear nada
  (la llave ya está registrada en el servidor con ese id).

### 11.6 F-28 y verificación

- Pruebas nuevas en `mobile/tests/recovery-h4.test.tsx` (F-26, F-21, F-27, F-28); las pruebas de `app.test.tsx` que codificaban la
  repetición automática se ajustaron al toque (misma llave, una fila) o a la lectura por id.
- Mutaciones (`docs/evidence/round7/h4-*/tools/mutate-h4.py`): guard que falla abierto con SecureStore ilegible, `requestNewCode`
  con `replacesClosedAttempt=true` sin intento previo, liberación ante cualquier error, 404 que no libera, 409/400 como definitivos,
  descarte que borra el hueco antiguo, descarte sin diálogo, descarte que finge éxito, descarte ofrecido con el intento confirmado
  pendiente de código, registro dañado como error crudo, 409 de reintento a M11, salidas de M11 que sueltan siempre, Inicio y
  arranque que repiten el `POST` sin toque: todas hacen fallar pruebas.
- Evidencia y límites: README de `docs/evidence/round7/h4-*/`. Nativo (Keychain real, `AppState` real, `Modal` con VoiceOver) sigue
  pendiente (F-05).
