# Requisitos derivados de la prueba técnica

**Fuente normativa:** [`../docs/challenge.md`](../docs/challenge.md), copia del enunciado original suministrado. Las etiquetas **obligatorio**, **bonus** y **BOOT-00** distinguen el requisito de producto del scaffold inicial. El usuario autorizó el producto obligatorio tras aprobar las referencias visuales Stitch; los bonus siguen fuera del alcance actual.

## Alcance por cliente

- **API:** registro/login, cuentas/saldos, beneficiarios con CLABE, transferencias, historial con filtros y cursor, límite diario, OTP simulado; persistencia e invariantes PostgreSQL, auditoría, observabilidad y pruebas reales.
- **Web:** login, resumen de cuentas, historial, alta de beneficiarios y transferencia con confirmación/comprobante; estados de carga/vacío/error, validación, accesibilidad y bloqueo/idempotencia del envío.
- **Móvil (alcance reducido):** login, saldo, últimos 20 movimientos y transferencia a beneficiario existente; almacenamiento seguro de tokens, reintento idempotente ante red inestable y ocultamiento sensible en background.
- **Bonus:** exportar estado mensual CSV/PDF o transferencias futuras; biometría móvil. Ninguno es obligatorio.
- **BOOT-00:** commit histórico que solo entregó estructura reproducible y scaffold técnico; no se considera que aquellas pruebas cubran funcionalidades financieras.
- **Estado actual:** los criterios funcionales REQ-* están autorizados para implementación; verificar extremo a extremo con servicios reales y PostgreSQL, sin aceptar mocks como entrega integrada.

## Criterios obligatorios Given/When/Then

### Registro y sesión (REQ-AUTH)

- **REQ-AUTH-01 (obligatorio, API/web/móvil).** Given visitante no autenticado y datos válidos, when registra usuario, then se crea su identidad y obtiene confirmación sin revelar si correos preexistentes pertenecen a otra persona más allá de la política que se apruebe.
- **REQ-AUTH-02 (obligatorio, API/web/móvil).** Given usuario registrado, when inicia sesión con credenciales válidas, then recibe acceso JWT de vida corta y refresh rotativo; credenciales inválidas se rechazan sin detalles sensibles.
- **REQ-AUTH-03 (obligatorio, API).** Given intentos repetidos de login, when se supera el umbral configurado, then rate limiting limita temporalmente solicitudes y evita enumeración de cuentas.
- **REQ-AUTH-04 (obligatorio, API/web/móvil).** Given refresh token usado, when se rota, then el anterior queda invalidado y la reutilización se detecta conforme a política aprobada.
- **REQ-AUTH-05 (obligatorio, móvil).** Given sesión móvil activa, when se guarda o renueva el token, then se usa SecureStore/Keychain/Keystore, nunca AsyncStorage; al pasar a background se oculta información sensible.

### Cuentas (REQ-ACCT)

- **REQ-ACCT-01 (obligatorio, API/web/móvil).** Given usuario autenticado con cuentas propias, when consulta cuentas, then solo recibe cuentas autorizadas y sus saldos disponibles en MXN.
- **REQ-ACCT-02 (obligatorio, API).** Given usuario que referencia cuenta ajena, when intenta verla o usarla, then la API la deniega sin filtrar datos ni confirmar detalles de propiedad.

### Beneficiarios y CLABE (REQ-BEN)

- **REQ-BEN-01 (obligatorio, API/web).** Given nombre, alias y CLABE con exactamente 18 dígitos y dígito verificador válido, when registra beneficiario, then queda asociado al usuario autenticado.
- **REQ-BEN-02 (obligatorio, API/web).** Given CLABE con longitud, caracteres o dígito verificador inválidos, when la envía, then se rechaza con error de validación consistente y no se persiste.
- **REQ-BEN-03 (obligatorio, API/web).** Given beneficiario propiedad de otro usuario, when se consulta o selecciona, then el acceso se deniega sin exposición de recursos ajenos.

### Transferencias e importes (REQ-XFER)

- **REQ-XFER-01 (obligatorio, API/web/móvil).** Given una cuenta origen propia, beneficiario elegible o cuenta destino propia, importe válido, concepto y referencia numérica, when confirma envío, then la transferencia se procesa atómicamente y devuelve un comprobante/identificador consultable.
- **REQ-XFER-02 (obligatorio, API/web/móvil).** Given importe expresado en MXN, when se valida y procesa, then precisión, límites y serialización son explícitos; nunca se usa aritmética binaria `float` para dinero.
- **REQ-XFER-03 (obligatorio, API/web).** Given importe con más de dos decimales, when se presenta, then se rechaza sin redondeo silencioso. Esta regla figura como supuesto pendiente de aprobación, no como texto explícito del reto.
- **REQ-XFER-04 (obligatorio, API).** Given origen y destino idénticos, when se intenta transferir, then se rechaza como operación inválida, sujeto a confirmar política de producto.
- **REQ-XFER-05 (obligatorio, API).** Given saldo insuficiente, when se intenta transferir, then no cambia ningún saldo/asiento y se devuelve error de dominio RFC 7807; web lo prueba con Testing Library.
- **REQ-XFER-06 (obligatorio, API).** Given transferencia válida, when se escriben movimientos, then todos los asientos balancean suma cero y el débito no produce saldo negativo; la base garantiza invariantes y auditoría es append-only.
- **REQ-XFER-07 (obligatorio, API).** Given dos o más solicitudes concurrentes que usan recursos relacionados, when se ejecutan, then bloqueos deterministas o SERIALIZABLE con reintentos preservan saldo/límites sin deadlock no recuperado ni pérdida/doble aplicación.
- **REQ-XFER-08 (obligatorio, web).** Given doble clic en “Enviar”, when ocurren dos eventos antes de la respuesta, then el botón se bloquea y ambas transmisiones no originan dos transferencias: una llave idempotente única por intento garantiza un solo resultado.
- **REQ-XFER-09 (obligatorio, móvil).** Given solicitud de transferencia enviada y respuesta perdida por desconexión, when la app reintenta, then reutiliza la misma llave idempotente y consulta/muestra el estado real, sin duplicar la transferencia.
- **REQ-XFER-10 (obligatorio, API).** Given la misma llave de idempotencia y mismo principal/operación, when se repite con mismo payload, then se devuelve el resultado original; si el payload difiere, se rechaza de forma definida. La llave queda única en persistencia.
- **REQ-XFER-11 (obligatorio, API).** Given transferencia de monto superior al umbral pendiente de aprobación, when se confirma, then exige código de un solo uso (simulable) ligado al intento concreto, con expiración/uso único definidos antes de implementar.

### Límites diarios e historial (REQ-LIMIT / REQ-HIST)

- **REQ-LIMIT-01 (obligatorio, API).** Given transferencias del día acumuladas, when se solicita otra que excede el límite aplicable, then se rechaza atómicamente y no se excede el límite incluso bajo concurrencia.
- **REQ-LIMIT-02 (obligatorio, API).** Given una solicitud alrededor de medianoche, when su instante cruza el límite diario, then el día de negocio se calcula en zona explícita pendiente de aprobar; no hay ventana doble ni ambigüedad UTC/local.
- **REQ-HIST-01 (obligatorio, API/web).** Given usuario autenticado, when consulta movimientos con filtros de fecha/tipo, then recibe solo los propios, con cursor estable y sin `OFFSET`.
- **REQ-HIST-02 (obligatorio, web).** Given filtros vacíos, cargando o error de historial, when se muestra la pantalla, then cada estado es explícito y accesible; navegación con teclado, etiquetas y contraste básico están cubiertos.
- **REQ-HIST-03 (obligatorio, API).** Given conjunto de al menos 100,000 movimientos de prueba, when se ejecuta consulta de historial con `EXPLAIN ANALYZE`, then se conserva la salida real, entorno/semilla y plan; no se aceptan planes inventados.
- **REQ-HIST-04 (móvil).** Given cuenta elegida, when se consulta actividad, then se muestran los últimos 20 movimientos autorizados.

### Calidad transversal (REQ-QUAL)

- **REQ-QUAL-01 (obligatorio, API).** Given entrada inválida o fallo HTTP, when la API responde, then usa RFC 7807 sin filtrar detalles internos y registra JSON con request ID y datos sensibles enmascarados.
- **REQ-QUAL-02 (obligatorio, API).** Given persistencia PostgreSQL, when se despliega esquema, then migraciones TypeORM y `synchronize: false`; FKs, checks, unique idempotency y garantías de balance/auditoría quedan en BD.
- **REQ-QUAL-03 (obligatorio, API).** Given unit/integration suite, when se ejecuta, then valida CLABE, idempotencia, límite diario, saldo no negativo y PostgreSQL real local.
- **REQ-QUAL-04 (obligatorio, API).** Given cuenta origen y 100 solicitudes concurrentes, when finalizan o se rechazan por reglas, then saldo final y asientos concilian al centavo.
- **REQ-QUAL-05 (obligatorio, web).** Given flujo transferencia, when se ejecuta Testing Library, then incluye error de saldo insuficiente.
- **REQ-QUAL-06 (obligatorio, API/web/móvil).** Given pipeline CI, when se ejecutan cambios, then lint y pruebas de los tres proyectos se ejecutan; checks de scaffold no se presentan como pruebas financieras ni como prueba en dispositivo.

### Bonus (REQ-BONUS)

- **REQ-BONUS-01 (bonus, API/web).** Given movimientos de un mes, when usuario exporta estado, then entrega CSV o PDF consistente con permisos y filtros aprobados.
- **REQ-BONUS-02 (bonus, API/web).** Given transferencia futura programada, when llega su fecha y se cumplen controles, then se procesa según política temporal aprobada.
- **REQ-BONUS-03 (bonus, móvil).** Given soporte del dispositivo, when el usuario habilita biometría, then puede desbloquear acceso local sin sustituir controles del servidor.

## Criterios de preparación BOOT-00

- **BOOT-00-01:** Given un checkout limpio, when se usa Node fijado y `npm ci`, then se instalan workspaces API/web/móvil/shared desde lockfile.
- **BOOT-00-02:** Given API local iniciada, when se consulta `/health` y una ruta inexistente, then health responde sin secretos, request ID se propaga y 404 usa RFC 7807.
- **BOOT-00-03:** Given PostgreSQL dev y test, when scripts de test reciben URL de dev, then abortan antes de conectar; TypeORM declara `synchronize:false`.
- **BOOT-00-04:** Given OpenAPI borrador y generación compartida, when se valida/genera, then el documento es OpenAPI 3.1 válido y la salida de tipos es reproducible.
- **BOOT-00-05:** Given README, when se siguen pasos de API/web/móvil, then web muestra “Entorno preparado. Diseño pendiente”; móvil mensaje equivalente; no hay producto ni tablas financieras.
- **BOOT-00-06:** Given CI de BOOT-00, when se ejecuta en GitHub Actions, then corre npm ci/lint/typecheck/tests de scaffold con PostgreSQL test donde aplique, sin deploy/publicación.
