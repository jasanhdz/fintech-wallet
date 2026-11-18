# Billetera MXN — producto local integrado

Aplicación local de billetera MXN con API Express/PostgreSQL, web React y cliente React Native nativo. La implementación integrada vive en `feature/product-mvp`. El alcance son transferencias internas entre cuentas propias y beneficiarios de la plataforma; no conecta con SPEI/bancos externos ni se despliega a AWS o Expo/EAS.

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

## URLs API

- Web local: el base URL incluye la versión `VITE_API_URL=http://localhost:3000/v1` (configurable por entorno).
- Dispositivo físico en la misma LAN: antes de iniciar Expo, definir `EXPO_PUBLIC_API_URL=http://<IP-LAN-del-host>:3000/v1`.
- Emulador Android: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/v1`.
- iOS Simulator del host: `EXPO_PUBLIC_API_URL=http://localhost:3000/v1`.
- No usar `localhost` como host API desde un teléfono físico: apuntaría al propio dispositivo.

API: `GET http://localhost:3000/health`; las rutas de producto están bajo `/v1` y los errores usan Problem Details `application/problem+json` (RFC 7807) con request ID. `npm run docs:api` genera la referencia navegable local de OpenAPI.

El proceso Expo debe recibir explícitamente `EXPO_PUBLIC_API_URL` al arrancar. Para móvil físico usa la IP LAN del host y `/v1`; para Android Emulator usa `10.0.2.2`; no uses un base URL sin `/v1`.

Expo Go es suficiente con la configuración actual (Expo SDK 58, Expo Router y SecureStore disponibles en Expo Go; no hay `expo-dev-client` ni módulo nativo propio). Usa una versión de Expo Go compatible con SDK 58. En teléfono físico usa la IP LAN de la Mac, no `localhost`, y mantén ambos dispositivos en la misma Wi-Fi.

### Sesión manual aislada en esta Mac

Actualmente los puertos 3000, 5173 y 8081 están ocupados por el smoke ligado a `wallet_test`. Para mantener tus datos manuales aparte, arranca una instancia dedicada a `wallet_dev` en puertos alternos. No detengas los procesos existentes.

**Terminal 1 — PostgreSQL, migraciones y seed local** (PostgreSQL ya se verificó healthy en `localhost:55432`):

```sh
npm run db:up
npm run db:migrate
npm run db:seed
```

**Terminal 2 — API con `wallet_dev`:**

```sh
API_PORT=3200 APP_ENV=development DEMO_FIXTURE_ENABLED=true WEB_ORIGIN=http://localhost:5174 npm run dev:api
```

**Terminal 3 — Web conectada a esa API:**

```sh
WEB_ORIGIN=http://localhost:5174 VITE_API_URL=http://localhost:3200/v1 npm --workspace @fintech-wallet/web run dev -- --host 0.0.0.0 --port 5174
```

Abre <http://localhost:5174> e inicia sesión con las credenciales locales de demo indicadas arriba.

**Terminal 4 — Expo Go para el teléfono:**

```sh
EXPO_PUBLIC_API_URL=http://192.168.100.8:3200/v1 npm --workspace @fintech-wallet/mobile run start -- --port 8082
```

La IP del comando es la observada en esta Mac (`ipconfig getifaddr en0`); si cambia de Wi-Fi, vuelve a ejecutar ese comando y sustituye la dirección. Escanea el QR con Expo Go. Los datos permanecen en `wallet_dev`, aislados de las suites que usan `wallet_test`.

## Producto y evidencia

- La API de producto está implementada según `specs/openapi.yaml`; el contrato define rutas y esquemas, y `npm run openapi:validate && npm run openapi:check` los valida y comprueba tipos reproducibles.
- Las migraciones TypeORM se ejecutan con `synchronize: false`; el perfil manual demo se crea con `db:seed` dentro de `wallet_dev`, con ledger de apertura balanceado y sin reset de actividad.
- `docs/product-integration-report.md` recoge evidencia del ciclo de integración. `docs/integration-review.md` preserva la revisión independiente del SHA `f5e9a4868409740aff29b1f5a4ea11b9a4194413`; no es aprobación de la versión actual ni final.
- `docs/design-mapping.md` registra la correspondencia de fuentes visuales, estados y alcance. `docs/design/references/` contiene referencias canónicas curadas sin datos operativos de las exportaciones originales.
- `docs/aws-deploy.md` es una propuesta documental; no se despliega AWS. No se publica Expo/EAS ni se abre un túnel público.

## Contrato y tipos compartidos

`npm run openapi:validate` valida el contrato de producto OpenAPI 3.1 y el contrato health-only. `npm run openapi:generate` produce tipos compartidos desde ambos documentos; `npm run openapi:check` confirma que la generación es reproducible. `packages/shared` no depende de TypeORM, secretos ni internals de Node.
