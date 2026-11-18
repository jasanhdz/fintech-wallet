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
npm run db:seed      # asegura idempotentemente la cuenta clearing local de demo
npm run dev          # API (3000) y Vite web (5173); parar con Ctrl-C
npm run dev:api      # inicia solo API; parar con Ctrl-C
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

Para un checkout nuevo: `nvm use`, `npm ci`, `npm run env:local`, `npm run db:up`, `npm run db:migrate`, `npm run db:seed` y `npm run dev`. Registra un usuario en `/register`; en `APP_ENV=development` con `DEMO_FIXTURE_ENABLED=true`, el registro crea el perfil de demo configurable con cuentas propias y postings de apertura balanceados. El seed no crea usuarios ni movimientos de cliente. El alta normal crea una cuenta MXN; cualquier saldo demo es ilustrativo.

Para tests PostgreSQL: con la base local del proyecto disponible, `npm run db:migrate:test` seguido por los comandos de pruebas. Los tests usan `wallet_test`, no `wallet_dev`. No ejecutes seed ni migraciones manuales sobre datos de otro proyecto.

`npm run db:up` utiliza `docker-compose`; el daemon debe estar disponible. La aplicación API conecta a PostgreSQL. Expo usa LAN y no abre túneles públicos.

## URLs API

- Web local: Vite utiliza `VITE_API_URL=http://localhost:3000` (configurable por entorno).
- Dispositivo físico en la misma LAN: definir `EXPO_PUBLIC_API_URL` como `http://<IP-LAN-del-host>:3000`.
- Emulador Android: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`.
- No usar `localhost` como host API desde un teléfono físico: apuntaría al propio dispositivo.

API: `GET http://localhost:3000/health`; las rutas de producto están bajo `/v1` y los errores usan Problem Details `application/problem+json` (RFC 7807) con request ID. `npm run docs:api` genera la referencia navegable local de OpenAPI.

## Producto y evidencia

- La API de producto está implementada según `specs/openapi.yaml`; el contrato define rutas y esquemas, y `npm run openapi:validate && npm run openapi:check` los valida y comprueba tipos reproducibles.
- Las migraciones TypeORM se ejecutan con `synchronize: false`; el perfil demo de dos cuentas se crea al registrar cuando está habilitado en desarrollo, y la cuenta clearing local se asegura con `db:seed`.
- `docs/product-integration-report.md` recoge evidencia del ciclo de integración. `docs/integration-review.md` preserva la revisión independiente del SHA `f5e9a4868409740aff29b1f5a4ea11b9a4194413`; no es aprobación de la versión actual ni final.
- `docs/design-mapping.md` registra la correspondencia de fuentes visuales, estados y alcance. `docs/design/references/` contiene referencias canónicas curadas sin datos operativos de las exportaciones originales.
- `docs/aws-deploy.md` es una propuesta documental; no se despliega AWS. No se publica Expo/EAS ni se abre un túnel público.

## Contrato y tipos compartidos

`npm run openapi:validate` valida el contrato de producto OpenAPI 3.1 y el contrato health-only. `npm run openapi:generate` produce tipos compartidos desde ambos documentos; `npm run openapi:check` confirma que la generación es reproducible. `packages/shared` no depende de TypeORM, secretos ni internals de Node.
