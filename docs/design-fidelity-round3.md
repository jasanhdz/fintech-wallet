# Matriz de fidelidad visual — ronda 3

**Versión revisada:** `2a93ee155322c732b96e0541c4fdbc1cb5421e7d`

**CI:** [run 43706017068](https://github.com/jasanhdz/fintech-wallet/actions/runs/43706017068)
**Estado:** evidencia para aceptación del revisor; no constituye aceptación.

## Cómo leer esta matriz

- **Implementado** describe rutas/estados que existen en Web o Mobile; no significa que su fidelidad esté aceptada.
- **Captura revisada** significa que abrí la captura real del producto publicada por CI y revisé su jerarquía/layout. Web usa navegador Chromium a anchos 1440 y 390 px; 390 px es Web responsive, no una captura nativa.
- **Hallazgo** compara la captura del producto con el PNG de referencia del mismo ID. `Parcial` indica estructura reconocible con diferencias visibles; `Divergencia` señala una diferencia sustantiva. `Sin captura` significa que el código/estado puede existir, pero no hay evidencia visual real para evaluarlo.
- Las imágenes de implementación están en [`docs/design/references/round3/implementation/`](design/references/round3/README.md); las referencias PNG derivadas están en [`source/`](design/references/round3/README.md). El mapeo completo de variantes de origen está en [`design-mapping.md`](design-mapping.md).

## Web — navegador real, capturas responsive del CI

| Pantalla / estado | Implementación funcional | Captura de producto abierta | Inspección visual y fidelidad observada |
|---|---|---|---|
| W01 Acceso — formulario / inicio de sesión | Login, renovación de sesión y acceso a cuentas | `W01-login-1440.png`, `web-login-mobile-390.png` | **Divergencia:** la fuente principal es una tarjeta centrada; la Web actual usa una composición promocional lateral en escritorio. Móvil conserva el formulario, pero no se acepta por similitud automática. |
| W02 Registro — formulario | Registro Web y alta de cuenta | `W02-registro-1440.png`, `web-register-mobile-390.png` | **Divergencia:** estructura funcional presente; la composición lateral actual y la distribución del formulario difieren de las fuentes centradas. |
| W03 Cuentas — vacío / dos cuentas / actividad reciente / transferencia propia completada | Inicio, saldos, cuenta seleccionada y actividad | `W03-cuentas-{1440,390}.png`, `W03-cuentas-own-{1440,390}.png`, `W03-cuentas-transfer-completada-own-{1440,390}.png`, `W03-actividad-reciente-*-390-scroll.png` | **Parcial:** navegación lateral, tarjetas de cuenta y actividad están presentes; densidad, tipografía, espaciado y redacción varían entre exportaciones y producto. |
| W04 Historial — vacío / con movimientos / detalle | Historial paginado y detalle interno | `W04-historial-{1440,390}.png`, `W04-historial-vacio-own-{1440,390}.png`, `W04-detalle{,-own}-{1440,390}.png` | **Parcial:** tabla/filtros/estados y detalle se renderizan. Las capturas no cubren loading ni error de cargar más en el producto. |
| W05 Comprobante / detalle | Comprobante interno, sin afirmación CEP/oficial | `W04-detalle{,-own}-{1440,390}.png`, `W12-recibo{,-own}-{1440,390}.png` | **Parcial:** campos y estado están visibles; el recibo de producto es más compacto que las fuentes con tarjeta y desglose amplio. |
| W06 Beneficiarios — vacío / lista | Alta, listado y CLABE enmascarada | `W06-beneficiarios-vacio{,-own}-{1440,390}.png`, `W06-beneficiarios-listado-{1440,390}.png` | **Parcial:** estados vacío/lista, búsqueda y acción de alta aparecen; composición y densidad no son idénticas a las variantes Stitch. |
| W07 Alta — formulario / CLABE inválida | Alta y validación de CLABE | `W07-alta-{1440,390}.png`, `W07-error-{1440,390}.png` | **Parcial:** forma, campos y error se capturaron; duplicado, destino no disponible y error recuperable no tienen captura de producto en este run. |
| W08 Transferencia — beneficiario / entre cuentas propias | Formularios de ambos destinos; validación de campos | `W08-formulario-{1440,390}.png`, `W08-formulario-own-{1440,390}.png` | **Parcial:** ambos recorridos están capturados. El producto presenta una jerarquía más simple que los paneles/resúmenes laterales de las referencias. |
| W09 Revisión — beneficiario / propia | Revisión antes de enviar | `W09-review{,-own}-{1440,390}.png` | **Parcial:** resumen y acción de confirmar aparecen; variación de densidad/orden respecto a las fuentes. |
| W10 Código — vacío / error de confirmación | OTP ligado a la transferencia; error y reintento | `W10-otp-{1440,390}.png`, `W10-otp-own-{1440,390}.png`, `W10-otp-error-own-{1440,390}.png` | **Divergencia:** la fuente usa seis casillas y un resumen de orden; la captura Web actual muestra un único campo de código. El estado funcional fue ejercitado por E2E. |
| W11 Envío — resultado incierto / recuperación | Recuperación tras reload con la misma llave y payload | `W11-resultado-incierto-{1440,390}.png` | **Divergencia:** recuperación/idempotencia comprobadas; visualmente el aviso queda sobre el formulario de transferencia, mientras la fuente propone una pantalla de estado dedicada con acción de consulta. |
| W12 Completada — beneficiario / propia | Recibos internos y estado final | `W12-recibo{,-own}-{1440,390}.png` | **Parcial:** estado y campos del recibo presentes; la fuente incluye mayor tratamiento de saldo, cuentas y comprobante. |
| W13 Rechazo — saldo insuficiente / límite demo | La UI traduce errores de saldo/límite; reglas de límite siguen siendo demo | **Sin captura W13 en el artefacto de este CI** | **Sin inspección visual real:** no declarar fidelidad. API/integración prueba límites y rechazo; queda pendiente generar una captura específica sin modificar saldos de `wallet_dev`. |
| W14 Sesión / permisos — sesión vencida / acceso denegado | Sesión vencida y ruta de acceso denegado | `W14-session-expired-{1440,390}.png`, `W14-access-denied-{1440,390}.png` | **Parcial:** acceso denegado coincide en estructura general; sesión vencida vuelve a usar el panel promocional lateral, distinto de la tarjeta centrada de la fuente. |

Todas las 55 capturas listadas en el artefacto responsive del CI se abrieron e inspeccionaron. No se compararon píxeles con una tolerancia automatizada; los hallazgos son inspección visual cualitativa y quedan pendientes de aceptación del revisor.

## Mobile nativo — React Native / Expo Go

| Pantalla / estados | Implementación | Evidencia disponible | Inspección visual nativa |
|---|---|---|---|
| M01 Login — válido, formulario, error | Implementado; login usa SecureStore para refresh token | Jest, typecheck y Expo export | **BLOCKED:** no se dispuso de captura en teléfono/simulador de esta Mac. |
| M02 Cuentas — selección / saldos / vacío-error | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M03 Movimientos — lista / vacío / error / cargar más | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M04 Detalle de movimiento | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M05 Beneficiarios — lista / búsqueda / vacío | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M06 Datos de transferencia — importe / concepto / referencia | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M07 Revisión — beneficiario / cuentas propias | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M08 Confirmación — código / error / reintento | Implementado; código efímero en memoria | Jest, typecheck y Expo export | **BLOCKED** |
| M09 Estado — envío / resultado incierto / recuperación | Implementado con SecureStore e idempotencia | Jest, typecheck y Expo export | **BLOCKED** |
| M10 Recibo completado | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M11 Rechazo — saldo/límite | Implementado | Jest, typecheck y Expo export | **BLOCKED** |
| M12 Privacidad — app en segundo plano / reanudación | Capa de privacidad y validación de sesión implementadas | Jest, typecheck y Expo export | **BLOCKED** |

Los 22 PNG fuente M01–M12 sí fueron abiertos como **referencias de diseño**; eso no equivale a inspeccionar el producto nativo. La exportación Expo y Jest tampoco sustituyen esa revisión.
