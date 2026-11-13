# Objetivo

Entregar BOOT-00: una base reproducible de documentación, configuración y scaffold no financiero para el monorepo fintech-wallet, y detenerse en `DESIGN_REVIEW_REQUIRED`.

# Scope

## Incluido en BOOT-00

- Monorepo npm workspaces con `api`, `web`, `mobile` y `packages/shared`.
- Configuración común de Node.js LTS >=20 fijada mediante archivo de versión y requisitos de engines; TypeScript en modo estricto en los proyectos que lo usan.
- Scaffold de API con Express y TypeORM, de web con React/Vite y de móvil con Expo/React Native; carpetas, configuración mínima, dependencias y comandos de desarrollo/build/lint/typecheck/test que funcionen.
- Configuración PostgreSQL >=15 aislada para desarrollo y pruebas: bases/URLs separadas, guardas en comandos de prueba que rechacen explícitamente la base de desarrollo, migraciones TypeORM disponibles y `synchronize: false`. Sin tablas financieras ni seed de producto.
- API base con `GET /health`, generación/propagación de request ID y formato RFC 7807 para errores base, sin autenticación ni lógica de negocio.
- OpenAPI como documento de diseño solamente, limitado a health y convenciones base. Puede describir las convenciones comunes de error/request ID; no autoriza a construir endpoints de producto.
- Pruebas del scaffold: salud, request ID, error RFC 7807, separación/guardas de configuración de bases y comprobaciones de workspace.
- CI para instalar de forma reproducible y ejecutar lint, typecheck, pruebas y builds disponibles del scaffold, sin publicar artefactos ni desplegar.
- Documentación de instalación, configuración local, comandos y límites de BOOT-00.

## Fuera de alcance y prohibiciones

- Registro, login, autenticación, autorización, sesiones o gestión de usuarios.
- Cuentas, beneficiarios, transferencias, movimientos, ledger, límites financieros, OTP, CLABE de producto o cualquier esquema/tablas/datos financieros.
- Pantallas de producto, formularios o flujos financieros en web o móvil. Solo scaffold técnico sin experiencia de producto.
- Aplicar tareas de `specs/tasks.md` o cualquier tarea futura: permanecen bloqueadas por `DESIGN_REVIEW_REQUIRED`.
- Despliegue AWS, infraestructura cloud, túneles públicos, publicación/distribución Expo/EAS o publicación en tiendas.
- Implementar funcionalidades de fases posteriores del reto.

# User flows

BOOT-00 no introduce flujos de usuario de producto ni pantallas funcionales. Los flujos verificables son de desarrollo/operación local:

1. **Instalar y comprobar workspace:** desde la raíz, ejecutar `npm ci`; ejecutar los scripts raíz de lint, typecheck, test y build. La instalación es reproducible y cada comando termina con código cero cuando el scaffold está sano.
2. **Arrancar la API local:** configurar la URL de PostgreSQL de desarrollo, ejecutar el script documentado de desarrollo y solicitar `GET /health` con `curl`. Respuesta: HTTP 200 y JSON indicando estado saludable; respuesta incluye un request ID que coincide con el encabezado de respuesta documentado.
3. **Comprobar error base:** solicitar una ruta inexistente con `curl`. Respuesta: HTTP 404 en formato `application/problem+json` (RFC 7807), con request ID y sin stack trace ni detalles internos.
4. **Preparar y probar bases aisladas:** ejecutar los comandos documentados de configuración/migración para desarrollo y pruebas. Los tests usan exclusivamente la base de pruebas; intentar dirigirlos a la base de desarrollo falla antes de ejecutar pruebas o alterar datos.
5. **Revisar contrato y CI:** consultar el documento OpenAPI de diseño y ejecutar localmente los mismos checks del pipeline. OpenAPI describe únicamente el scaffold autorizado; el pipeline no despliega ni publica.

# Modelo de datos

BOOT-00 no define ni crea tablas de dominio o financieras. No se permiten entidades, migraciones o fixtures de usuarios, cuentas, beneficiarios, transferencias, asientos, OTP ni saldos.

La única configuración de persistencia es conexión PostgreSQL >=15 mediante TypeORM, con configuración independiente para desarrollo y pruebas, nombres de base inequívocamente diferenciados y `synchronize: false`. Las migraciones disponibles en esta fase no crean esquema financiero. La eventual necesidad de datos de producto queda pendiente de diseño y autorización posteriores.

# Stack y decisiones técnicas

- **Gestión del repositorio:** npm workspaces; raíz con workspaces `api`, `web`, `mobile` y `packages/shared`.
- **Runtime:** Node.js LTS >=20, versión fijada en archivo de runtime (`.nvmrc` o equivalente) y declarada en `engines`; documentar la versión elegida.
- **API:** Express + TypeScript `strict` + TypeORM + PostgreSQL >=15. Capas mínimas para configuración, middleware y health; `synchronize: false`.
- **Web:** React + Vite + TypeScript `strict`, scaffold ejecutable sin pantallas de producto.
- **Móvil:** Expo + React Native + TypeScript `strict`, scaffold ejecutable sin pantallas de producto ni publicación EAS.
- **Compartido:** `packages/shared` contiene los tipos TypeScript generados desde el documento OpenAPI mediante un comando reproducible. El documento de este alcance solo modela el contrato base autorizado; generación de tipos no debe implicar endpoints financieros.
- **Contrato/documentación:** OpenAPI se mantiene como documento de diseño; no es requisito exponer Swagger UI ni implementar el contrato futuro.
- **Scripts:** documentar y ofrecer comandos raíz coherentes para instalar, desarrollar, lint, typecheck, test y build; comandos explícitos para preparar/migrar bases de desarrollo y pruebas, y para ejecutar CI localmente. Usar `npm ci` para instalación reproducible. Los nombres definitivos de scripts deben quedar documentados en README.
- **Base de datos segura para tests:** configuración separada y validación fail-closed que rechaza host/base/URL de desarrollo en todo comando de test o limpieza de test antes de abrir una conexión destructiva.
- **HTTP base:** middleware request ID acepta un ID entrante válido o genera uno, lo devuelve en respuesta y lo incorpora al error RFC 7807; errores no exponen stack trace ni secretos.
- **CI:** workflow de integración continua que instala dependencias de manera reproducible y ejecuta validaciones del scaffold; sin credenciales cloud, deploy o publish.
- **Decisiones propuestas para fases futuras, no implementación ni autorización en BOOT-00:** representar importes como centavos enteros serializables, nunca como `float`; y diseñar seguridad financiera con invariantes de base de datos, transacciones/idempotencia, control de acceso, auditoría y manejo seguro de secretos. No crear ahora tipos, lógica, esquema, endpoints o pantallas de esas capacidades.

# Assumptions

- `PLAN.md` y `AGENTS.md` limitan esta entrega a BOOT-00 y prevalecen sobre el alcance amplio del reto en `docs/challenge.md`; este SPEC no autoriza fases de producto.
- La entrega documental/spec-first precede a cualquier scaffold: este documento no debe contener instrucciones que habiliten trabajo de tareas futuras. Toda tarea posterior requiere revisión de diseño y cambio explícito de autorización desde `DESIGN_REVIEW_REQUIRED`.
- La versión concreta de Node LTS se fija al generar el scaffold eligiendo una versión LTS vigente que satisfaga >=20; el archivo de versión y `engines` deben coincidir.
- Desarrollo y pruebas usan PostgreSQL local >=15 con bases distintas. Los tests no crean, limpian ni migran accidentalmente la base de desarrollo.
- El endpoint health solo informa disponibilidad técnica básica; no revela configuración, credenciales ni datos sensibles.
- La solicitud no define un proveedor/servicio PostgreSQL ni un gestor de secretos. Se documenta configuración local mediante variables de entorno y se excluyen archivos con secretos del control de versiones.
- Centavos serializables y controles de seguridad financiera son principios propuestos para diseño futuro; no constituyen código ni alcance de BOOT-00.

# Rubric de evaluación

Cada criterio es binario: aprobado solo si se cumple íntegramente y puede verificarse con el comando indicado. Los comandos concretos deben existir y estar documentados por el scaffold.

1. **Workspaces y runtime:** `node --version` satisface >=20 y la versión fijada coincide con `engines`; `npm ci` desde la raíz instala los cuatro workspaces sin error. **PASS/FAIL**.
2. **Scaffold ejecutable:** los comandos raíz documentados de lint, typecheck, test y build terminan con código cero para API, web, móvil y shared donde aplique. **PASS/FAIL**.
3. **Stack y límites:** inspección de manifests/config confirma Express, TypeORM, PostgreSQL >=15, React/Vite, Expo/React Native y TypeScript estricto; no existen dependencias/configuración de producto que contradigan las prohibiciones de Scope. **PASS/FAIL**.
4. **Aislamiento de base de datos:** la configuración documentada de desarrollo y test señala bases distintas; el comando de test rechazando una URL/nombre de base de desarrollo sale distinto de cero antes de conectar o modificar datos, y acepta la configuración de test. **PASS/FAIL**.
5. **Migraciones sin sincronización automática:** inspección de configuración confirma TypeORM con `synchronize: false`; las migraciones de BOOT-00 no crean tablas o campos financieros. **PASS/FAIL**.
6. **Health y request ID:** con API arrancada, `curl -i /health` devuelve 200 y JSON saludable; el request ID de respuesta está presente, es válido y coincide con el enviado o se genera cuando no se envía uno válido. **PASS/FAIL**.
7. **Error RFC 7807:** `curl -i` a ruta inexistente devuelve 404, `Content-Type: application/problem+json`, campos de problema adecuados y request ID; el cuerpo no contiene stack trace ni secretos. **PASS/FAIL**.
8. **OpenAPI y tipos compartidos:** el documento OpenAPI es válido y solo define health/convenciones base; el comando documentado genera tipos en shared de forma reproducible, sin introducir endpoints de producto. **PASS/FAIL**.
9. **CI:** el workflow de CI ejecuta instalación reproducible y los checks del criterio 2 en los cambios de la rama configurada; no contiene pasos de deploy, publicación EAS ni despliegue AWS. **PASS/FAIL**.
10. **Ausencia de producto y condición de parada:** revisión de rutas, pantallas, migraciones, fixtures y API confirma que no hay registro/login, cuentas, beneficiarios, transferencias, ledger, OTP, esquema financiero o pantallas de producto; README/planificación dejan tareas futuras bloqueadas por `DESIGN_REVIEW_REQUIRED`. **PASS/FAIL**.

**Parada obligatoria:** al satisfacer estos 10 criterios y completar la entrega documental/scaffold autorizado de BOOT-00, detener todo trabajo. No iniciar tareas de producto ni fases futuras hasta que el diseño sea revisado y la autorización cambie explícitamente desde `DESIGN_REVIEW_REQUIRED`.
