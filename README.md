# Billetera MXN — producto local integrado

Aplicación local de billetera MXN con API Express/PostgreSQL, web React y cliente React Native nativo. La implementación integrada vive en `feature/product-mvp`. El alcance son transferencias internas entre cuentas propias y beneficiarios de la plataforma; no conecta con SPEI/bancos externos ni se despliega a AWS o Expo/EAS.

Repositorio: <https://github.com/jasanhdz/fintech-wallet>.

La solución está organizada como monorepo npm: `api/` (Express, TypeScript y TypeORM), `web/` (React/Vite), `mobile/` (React Native/Expo) y `packages/shared/` (tipos generados desde OpenAPI y utilidades portables). PostgreSQL es la fuente persistente; transferencias, ledger, límites e idempotencia se verifican en el backend y la base de datos. El diseño funcional y las decisiones de implementación están en [`specs/requirements.md`](specs/requirements.md) y [`specs/design.md`](specs/design.md).

La entrega cubre registro e inicio de sesión, cuentas MXN, CLABE validada para beneficiarios internos, transferencias a beneficiarios o entre cuentas propias, confirmación OTP simulada, consulta de movimientos y comprobantes internos. El cliente web contiene el panel completo; el móvil implementa los flujos nativos de login, cuentas, movimientos y transferencias. Se excluyen SPEI/bancos externos, inversiones, biometría, transferencias programadas y estados de cuenta mensuales.

## Requisitos

- Node.js `26.13.1` (usar `nvm use` con `.nvmrc`) y npm 11 o superior.
- Docker Engine y Docker Compose standalone (`docker-compose`) o una instalación equivalente compatible con el archivo Compose. PostgreSQL 16.10, compatible con requisito >=15.
- Para compilar/ejecutar móvil: dependencias Expo SDK 58; dispositivo/simulador compatible. No se publica a EAS ni tiendas.

## Instalación y configuración

```sh
nvm use
npm ci
npm run env:local
```

`.env.example` contiene URLs locales ficticias y valores de demo. Ejecuta `npm run env:local` para crear `.env` con llaves criptográficas aleatorias sin imprimirlas; no sobrescribe un `.env` existente. No subir `.env`. Desarrollo usa `wallet_dev`; todas las pruebas financieras usan exclusivamente `wallet_test` y abortan si el destino no es la base aislada. Los roles `wallet_runtime_*` son de aplicación y `wallet_migrator_*` para migraciones. Límites, umbral/expiración OTP, zona y saldos de fixture son valores configurables de demo, no política de producción aprobada.

### Arranque local completo

Desde la raíz, después de `nvm use`, `npm ci` y `npm run env:local`:

```sh
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

Abre <http://localhost:5173>. La API escucha en <http://localhost:3000>; comprueba `GET /health`. El seed idempotente crea/reutiliza un perfil demostrativo y dos cuentas propias con contra-asientos balanceados en `wallet_dev`; los montos son ejemplos locales, no fondos reales ni política aprobada. Para una revisión manual usa `wallet_dev`; no conectes el flujo de demostración a `wallet_test`.

Genera la referencia navegable del contrato con `npm run docs:api`; el archivo generado es `docs/api-reference.html`. El contrato fuente es [`specs/openapi.yaml`](specs/openapi.yaml).

## Comandos desde raíz

```sh
npm run db:up        # inicia PostgreSQL local del proyecto; no uses down -v
npm run db:migrate   # aplica las migraciones TypeORM usando rol migrator de wallet_dev
npm run db:seed      # perfil manual demo idempotente: wallet_dev solamente
npm run dev          # API (3000) y Vite web (5173); parar con Ctrl-C
npm run dev:api      # inicia solo API; parar con Ctrl-C
npm run dev:api:testdb # API sobre wallet_test; no usar para pruebas manuales persistentes
npm run dev:web      # inicia solo Vite web; parar con Ctrl-C
npm run dev:mobile   # inicia Metro/Expo en LAN; parar con Ctrl-C
npm run test:integration # integración PostgreSQL, siempre wallet_test
npm run test:e2e     # recorridos web+API+PostgreSQL, wallet_test
npm run test:visual  # checks de navegador Chromium; wallet_test
npm run qa:report    # QA secuencial + informe PASS/FAIL/BLOCKED y capturas
npm run qa:history-performance # fixture sintética 100k + EXPLAIN ANALYZE en wallet_test
npm run lint
npm run typecheck
npm test
npm run build
npm run openapi:validate
npm run openapi:check
npm run docs:api      # genera referencia Redoc local desde el contrato de producto
npm run db:migrate:test # aplica migraciones solo en wallet_test
```

Para un checkout nuevo: `nvm use`, `npm ci`, `npm run env:local`, `npm run db:up`, `npm run db:migrate` y `npm run db:seed`. El seed crea/reutiliza el usuario reservado `demo@wallet.local`, dos cuentas propias con contra-asientos de apertura balanceados y un beneficiario interno hacia la cuenta de ahorro. Solo opera con `APP_ENV=development`, `DEMO_FIXTURE_ENABLED=true` y el rol migrator local dirigido a `wallet_dev`; no cambia los saldos ni borra la actividad de una cuenta ya sembrada.

Credenciales **solo para demostración local** (web y móvil comparten usuario):

```text
Correo:       demo@wallet.local
Contraseña:   Billetera-MXN-Demo-2026!
Base local:   wallet_dev
```

Los saldos iniciales salen de `DEMO_PRIMARY_BALANCE_MINOR` y `DEMO_SAVINGS_BALANCE_MINOR` del `.env` local. Los valores del `.env.example` equivalen a $10,000.00 MXN y $5,000.00 MXN; son datos ilustrativos, no política ni fondos reales. El seed conserva los saldos/operaciones existentes al repetirse.

Para tests PostgreSQL: con la base local del proyecto disponible, `npm run db:migrate:test` seguido por los comandos de pruebas. Los tests usan `wallet_test`, no `wallet_dev`. No ejecutes seed ni migraciones manuales sobre datos de otro proyecto.

Para las pruebas manuales usa `wallet_dev`, no `wallet_test`: las suites automáticas y el proceso `dev:api:testdb` comparten la base de prueba y pueden agregar fixtures. El beneficiario sembrado apunta a la cuenta de ahorro propia y sirve para probar el flujo interno; también puedes usar transferencias entre cuentas propias en Web.

`npm run db:up` utiliza `docker-compose`; el daemon debe estar disponible. La aplicación API conecta a PostgreSQL. Expo usa LAN y no abre túneles públicos.

## Aplicación móvil y QR de Expo Go

Metro genera un QR **dinámico** al iniciar Expo; no es un archivo de entrega que deba versionarse. El teléfono y el host deben compartir la misma red Wi-Fi. Inicia la API local y luego arranca Expo con la dirección LAN del host:

```sh
EXPO_PUBLIC_API_URL="http://<IP-LAN-DEL-HOST>:3000/v1" npm run dev:mobile
```

Escanea el QR que imprime Expo con Expo Go compatible con SDK 58. El cliente móvil es React Native nativo, no una WebView. Direcciones habituales:

- Teléfono físico: `http://<IP-LAN-DEL-HOST>:3000/v1` (no uses `localhost` desde el teléfono).
- Android Emulator: `http://10.0.2.2:3000/v1`.
- iOS Simulator en el mismo host: `http://localhost:3000/v1`.

Para usar el QR, Expo debe poder llegar por LAN al host; no se requiere ni se debe abrir un túnel público. Expo Go cubre la configuración actual; no se publica a EAS ni a tiendas.

## Contrato y URLs API

- Web local: el base URL incluye la versión `VITE_API_URL=http://localhost:3000/v1` (configurable por entorno).
- Health: `GET http://localhost:3000/health`; las rutas de producto están bajo `/v1` y los errores usan Problem Details `application/problem+json` (RFC 7807) con request ID.
- `npm run docs:api` genera la referencia navegable local de OpenAPI. El archivo se genera en `docs/api-reference.html` y no necesita copiarse a la UI de la aplicación.

## Producto y evidencia

- La API de producto está implementada según `specs/openapi.yaml`; el contrato define rutas y esquemas, y `npm run openapi:validate && npm run openapi:check` los valida y comprueba tipos reproducibles.
- Las migraciones TypeORM se ejecutan con `synchronize: false`; el perfil manual demo se crea con `db:seed` dentro de `wallet_dev`, con ledger de apertura balanceado y sin reset de actividad.
- `docs/product-integration-report.md` recoge evidencia del ciclo de integración. `docs/integration-review.md` preserva la revisión independiente del SHA `f5e9a4868409740aff29b1f5a4ea11b9a4194413`; no es aprobación de la versión actual ni final.
- Las capturas de referencia sanitizadas, su manifiesto y la matriz de fidelidad están en la rama `design-reference` (tag `design-reference-v1`). Esta rama `feature/product-mvp` no contiene la carpeta `design/` ni assets visuales. El checkout fuente original conserva intactos sus exports locales.
- `docs/design-mapping.md` conserva la trazabilidad textual de pantallas/estados; las imágenes correspondientes se consultan en `design-reference`. La validación visual nativa sigue pendiente hasta recibir capturas del teléfono del revisor.
- `docs/qa-round5.md` mapea las capturas manuales nuevas a pantallas/referencias aprobadas y documenta correcciones/gaps. `npm run qa:report` ejecuta las suites existentes secuencialmente sobre `wallet_test` y genera `test-results/qa/qa-report.md` + `.json`, con estados por suite y requisito; las capturas Web quedan en `test-results/visual/`. `BLOCKED` impide declarar aceptación completa.
- `docs/acceptance-handoff-round3.md` registra el SHA, el arranque no destructivo, la diferencia de llaves entre worktrees y el límite de atribución del request histórico; la aceptación sigue pendiente.
- `docs/aws-deploy.md` contiene la propuesta de arquitectura solicitada por el challenge. Es una propuesta, no un despliegue ni una aprobación de presupuesto, SLA o política de producción.

## Herramientas de desarrollo y flujo Forge

### Stack y herramientas del proyecto

- Node.js 26.13.1, npm workspaces y TypeScript estricto.
- Express, TypeORM y PostgreSQL para API, persistencia y migraciones.
- React/Vite para web; React Native y Expo SDK 58 para móvil nativo.
- OpenAPI 3.1 como contrato; `openapi-typescript` genera tipos compartidos y Redoc produce documentación navegable.
- Docker Compose para PostgreSQL local; Playwright/Chromium para flujos web y pruebas visuales; Jest para pruebas unitarias; GitHub Actions para CI; ESLint y `tsc` para lint/typecheck.
- OpenCode se utilizó como host para coordinación de tareas y sesiones con roles independientes. Codex CLI se utilizó para inspección de solo lectura del repositorio y su historia; el registro de sesiones y decisiones está en [`specs/ai-log.md`](specs/ai-log.md).

### Qué aporta Forge

Forge es un skill reutilizable de planificación e implementación por tareas pequeñas. Define roles y límites de edición para que un host de agentes compatible pueda ejecutar trabajo en contextos independientes:

1. **Planner:** convierte requisitos aprobados en una especificación verificable (`SPEC.md`); no implementa código.
2. **Generator:** implementa tareas acotadas ligadas a criterios y pruebas; no modifica `SPEC.md` ni los findings de evaluación.
3. **Evaluator:** inspecciona el resultado contra la especificación, ejecuta comprobaciones y registra hallazgos; no corrige el código evaluado.
4. **Coordinator:** mantiene contrato OpenAPI, paquetes compartidos, integración, límites de propiedad y documentación transversal.

El skill proporciona las instrucciones y el protocolo; el host (Codex, OpenCode o Claude Code) es quien instancia y coordina los agentes cuando ofrece esa capacidad. Separar contextos ayuda a reducir cambios fuera de alcance y a conservar trazabilidad requisito → tarea → implementación → prueba. No sustituye la revisión humana ni las pruebas contra PostgreSQL real. En este repositorio, el detalle verificable de las sesiones está en `specs/ai-log.md` y las decisiones funcionales en `SPEC.md`, `specs/` y `docs/`.

## Contrato y tipos compartidos

`npm run openapi:validate` valida el contrato de producto OpenAPI 3.1 y el contrato health-only. `npm run openapi:generate` produce tipos compartidos desde ambos documentos; `npm run openapi:check` confirma que la generación es reproducible. `packages/shared` no depende de TypeORM, secretos ni internals de Node.

## Qué haría con más tiempo

- Completar y documentar el recorrido móvil en un teléfono físico con Expo Go: QR, login, actividad, transferencia aprobada y recuperación tras pérdida de conexión, guardando capturas sin datos sensibles.
- Añadir una prueba visual automatizada de comparación contra las referencias sanitizadas y cerrar discrepancias que requieran revisión humana.
- Profundizar la matriz de pruebas de concurrencia, recuperación ante fallos de PostgreSQL y operación de despliegues/migraciones antes de cualquier uso real.
- Validar con responsables de producto/operación los valores de zona horaria, límites, umbral/expiración OTP, retención y objetivos RPO/RTO propuestos; hoy los valores de demo no son política productiva.
- Ejecutar una revisión independiente del SHA final y adjuntar el resultado de CI correspondiente a ese SHA.

## Estado de entrega del challenge

- **Repositorio y ejecución local:** disponibles; este README documenta instalación, API, web, PostgreSQL y Expo Go.
- **Specs y OpenAPI navegable:** incluidos; se genera localmente con `npm run docs:api`.
- **CI:** GitHub Actions está configurado para push, pull request y ejecución manual; confirma que el run del SHA que entregues termine en verde. Un run de un SHA anterior no sustituye esa verificación.
- **Propuesta AWS:** documentada en `docs/aws-deploy.md`; no hay despliegue.
- **Demo:** es local, no pública. Se levanta siguiendo “Arranque local completo”; no se abre túnel.
- **QR:** Expo lo imprime al ejecutar `npm run dev:mobile` con `EXPO_PUBLIC_API_URL`; falta escanearlo y verificar el recorrido en un dispositivo para cerrar esa evidencia.
- **Video de hasta 5 minutos:** pendiente de grabar. Debe mostrar el flujo web y móvil, incluido un intento rechazado por saldo insuficiente.
- **Revisión móvil física y revisión independiente final:** pendientes de evidencia; Jest/Expo export no equivalen a una prueba en dispositivo.
- **Envío final:** queda compartir el enlace del repositorio, video y evidencia de la revisión con quien recibe el challenge, y preparar la sesión técnica de 60 minutos.
