# Fintech Wallet — BOOT-00

Scaffold reproducible de infraestructura y clientes mínimos. El único endpoint implementado es `GET /health`; no hay funcionalidades de producto ni esquema financiero. Estado de las fases posteriores y diseños: `DESIGN_REVIEW_REQUIRED`.

## Requisitos

- Node.js `26.13.1` (rama LTS, usar `nvm use` con `.nvmrc`) y npm 11 o superior.
- Docker Engine y Docker Compose standalone (`docker-compose`) o una instalación equivalente compatible con el archivo Compose. PostgreSQL 16.10, compatible con requisito >=15.
- Para compilar/ejecutar móvil: dependencias Expo SDK 58; dispositivo/simulador compatible. No se publica a EAS ni tiendas.

## Instalación y configuración

```sh
nvm use
npm ci
cp .env.example .env
```

`.env.example` contiene solo credenciales locales ficticias de desarrollo. No subir `.env`. Desarrollo usa `wallet_dev`; tests usan exclusivamente `wallet_test`. Las credenciales `wallet_runtime_*` son roles de aplicación; `wallet_migrator_*` son roles separados para migraciones.

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
npm run test:visual # Playwright Chromium: browser smoke test del scaffold web, no producto
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

## Estado BOOT-00

- Web muestra exactamente **Entorno preparado. Diseño pendiente**.
- Móvil muestra el mensaje equivalente y dispone de prueba que monta el componente con React Native renderer.
- `npm run docs:api` genera Redoc navegable desde `specs/openapi.yaml`: contrato completo de producto PLANNED, pendiente de revisión/autorización y no implementado. El título del HTML lo marca explícitamente; sus rutas documentan diseño futuro, no endpoints disponibles.
- `npm run docs:bootstrap-api` genera Redoc desde `specs/openapi.boot.yaml`: solo el contrato scaffold de `GET /health` y error genérico, también marcado como no implementado. La API BOOT-00 real implementa actualmente `GET /health`; las demás rutas devuelven 404. La generación de documentación no implementa endpoints.
- `specs/openapi.yaml` preserva el contrato de diseño derivado previo. `specs/openapi.boot.yaml` limita la validación y tipos generados al scaffold.
- TypeORM configura siempre `synchronize: false`; no hay entidades ni tablas de negocio. Tests DB rechazan URL/nombre dev antes de conectarse; aislamiento usa bases y roles runtime/migrator separados.
- Suites financieras futuras no están implementadas ni aprobadas; permanecen bloqueadas por `DESIGN_REVIEW_REQUIRED`.
- CI valida el scaffold; no equivale a aprobación final, prueba financiera, despliegue o publicación.
- `npm run test:visual` inspecciona en Chromium el mensaje de preparación, HTTP 200 y ausencia de errores de consola; no sustituye pruebas de producto ni prueba en dispositivo móvil.
- Diseños M01–M12 y W01–W14 están `DESIGN_REVIEW_REQUIRED`. El índice AWS queda `PENDIENTE`.

## Contrato y tipos compartidos

`npm run openapi:validate` valida el borrador de diseño `specs/openapi.yaml` y el contrato BOOT-00. Para respetar el commit documental sin editarlo, el validador normaliza en un archivo temporal dos descripciones inline que no son YAML válido; conserva la estructura/semántica fuente. `npm run openapi:generate` produce tipos separados del contrato planeado (no implementado) y del scaffold bajo `packages/shared`; `npm run openapi:check` confirma reproducibilidad. Shared no depende de TypeORM, secretos ni internals de Node.
