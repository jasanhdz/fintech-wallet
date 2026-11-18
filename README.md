# Fintech Wallet — producto en implementación

BOOT-00 publicó la base reproducible. El diseño Stitch está aprobado como referencia y la implementación del producto obligatorio está en curso en `feature/product-mvp`. La API de producto se implementará por fases; consulta `docs/design-mapping.md` y `docs/phase-log.md` para estados/evidencia. No hay despliegue AWS ni publicación EAS.

## Requisitos

- Node.js `26.13.1` (rama LTS, usar `nvm use` con `.nvmrc`) y npm 11 o superior.
- Docker Engine y Docker Compose standalone (`docker-compose`) o una instalación equivalente compatible con el archivo Compose. PostgreSQL 16.10, compatible con requisito >=15.
- Para compilar/ejecutar móvil: dependencias Expo SDK 58; dispositivo/simulador compatible. No se publica a EAS ni tiendas.

## Instalación y configuración

```sh
nvm use
npm ci
npm run env:local
```

`.env.example` contiene credenciales locales ficticias y políticas ilustrativas de demo. Ejecuta `npm run env:local` para crear `.env` con llaves criptográficas aleatorias sin imprimirlas; el script no sobrescribe un `.env` existente. No subir `.env`. Desarrollo usa `wallet_dev`; tests usan exclusivamente `wallet_test`. Las credenciales `wallet_runtime_*` son roles de aplicación; `wallet_migrator_*` son roles separados para migraciones. Valores de límite/OTP/semilla son configurables demo, no policy de producción aprobada.

## Comandos desde raíz

```sh
npm run db:up        # inicia PostgreSQL en segundo plano; parar: docker-compose down
npm run db:migrate   # aplica migraciones TypeORM autorizadas (ninguna migración de negocio)
npm run db:seed      # informa: sin migraciones/seed de negocio; no inserta datos
npm run dev          # inicia API (3000) y Vite web (5173); parar con Ctrl-C
npm run dev:api      # inicia solo API; parar con Ctrl-C
npm run dev:web      # inicia solo Vite web; parar con Ctrl-C
npm run dev:mobile   # inicia Metro/Expo en LAN; parar con Ctrl-C
npm run lint
npm run typecheck
npm test
npm run test:visual # Playwright Chromium: smoke visual separado de qa:bootstrap
npm run db:migrate:test # aplica esquema solo en wallet_test, tras db:up
npm run test:integration # integration PostgreSQL con guard de base de prueba
npm run test:e2e # web+API reales, obliga wallet_test; servicios temporales en 3100/5174
npm run build
npm --workspace @fintech-wallet/api run test:db # requiere PostgreSQL levantado y URLs del .env
npm run openapi:validate
npm run openapi:check
npm run docs:api      # contrato de producto PLANNED/no implementado: docs/api-reference.html
npm run docs:bootstrap-api # contrato BOOT-00 de GET /health, también no implementado: docs/bootstrap-api-reference.html
npm run qa:bootstrap # guarda reporte real en docs/qa-report.md (gitignored)
```

`npm run db:up` utiliza el ejecutable standalone `docker-compose`. En este host `docker compose` (plugin CLI) no está instalado, sí está disponible `docker-compose`; el daemon puede no estar iniciado. `npm run dev` no conecta a PostgreSQL: el endpoint health actual no consulta la base. Expo usa LAN y no abre túneles públicos.

## URLs API

- Web local: Vite utiliza `VITE_API_URL=http://localhost:3000` (configurable por entorno).
- Dispositivo físico en la misma LAN: definir `EXPO_PUBLIC_API_URL` como `http://<IP-LAN-del-host>:3000`.
- Emulador Android: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`.
- No usar `localhost` como host API desde un teléfono físico: apuntaría al propio dispositivo.

API: `GET http://localhost:3000/health`; una ruta no implementada responde Problem Details `application/problem+json` (RFC 7807), con request ID.

## Estado de implementación

- BOOT-00 permanece como entrega inicial en el historial. La aprobación visual y el alcance obligatorio están en `docs/design-mapping.md`; el análisis de fuentes, imágenes ausentes y exclusiones está documentado allí.
- En el commit base de preparación de producto, el único endpoint implementado continúa siendo `GET /health`; las rutas OpenAPI se implementan verticalmente y su presencia en el contrato no acredita implementación.
- `npm run docs:api` genera Redoc desde el contrato OpenAPI de producto; `npm run docs:bootstrap-api` conserva la referencia inicial health-only.
- TypeORM mantiene `synchronize: false`; migraciones y fixture demo balanceada se agregarán antes de integrar los flujos. Tests de base deben rechazar `wallet_dev` antes de conectar.
- Las pruebas financieras, 100 transferencias concurrentes y `EXPLAIN ANALYZE` real sobre 100k movimientos se reportarán solo cuando se ejecuten contra `wallet_test`.
- `npm run test:visual` es una prueba de navegador real, separada del informe `qa:bootstrap`; `npm run test:e2e` valida recorridos integrados con API y PostgreSQL. Móvil requiere simulador/dispositivo para evidencia visual y de red; export de Expo no acredita prueba en dispositivo.
- `npm run test:visual` y `npm run test:e2e` arrancan servidores Playwright en puertos dedicados (API 3100, web 5174); ambos validan `TEST_DATABASE_URL` contra `wallet_test` antes de iniciar. Las migraciones de test deben ejecutarse primero. Detener `db:up` solo para el proyecto wallet con `docker-compose stop postgres`; nunca usar `down -v`.
- `docs/aws-deploy.md` permanece pendiente. No se despliega AWS, no se publica Expo/EAS y no se abre túnel público.

## Contrato y tipos compartidos

`npm run openapi:validate` valida el contrato de producto OpenAPI 3.1 y el contrato health-only. `npm run openapi:generate` produce tipos compartidos desde ambos documentos; `npm run openapi:check` confirma que la generación es reproducible. `packages/shared` no depende de TypeORM, secretos ni internals de Node.
