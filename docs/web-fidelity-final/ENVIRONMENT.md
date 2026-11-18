# Entorno aislado · ronda Web «fidelidad final»

Gobernado por `docs/web-fidelity-final/SPEC.md` §5.10. Todo corre desde la raíz del worktree
`/Users/jasanhernandez/Develop/fintech-wallet-web-final` con Node `26.13.1`
(`export PATH=$HOME/.nvm/versions/node/v26.13.1/bin:$PATH`). No se ejecuta `npm ci`/`npm install`
ni las suites raíz `test:e2e`/`test:visual`.

## Recursos propios

| Recurso | Valor |
|---|---|
| Contenedor | `fintech-wallet-web-pg` (`postgres:16.10-alpine`, ya en disco; no se descarga) |
| Volumen | `fintech-wallet-web-pg-data` |
| Puerto | `127.0.0.1:55433` → puerto por defecto de PostgreSQL dentro del contenedor |
| Base usada | `wallet_test` (el `init.sql` también crea una `wallet_dev` interna que nunca se usa) |
| APIs | 3301 (P1) · 3302 (P2) · 3303 (P3) · 3304 (P4) — `npx tsx api/src/server.ts`, sin `watch` |
| Web | 5301 (P1) · 5302 (P2) · 5303 (P3) · 5304 (P4) — `vite preview --strictPort` de `web/dist/pX` |
| Caché Vite | `web/node_modules/.vite-web-final` (`WEB_VITE_CACHE_DIR`, `web/vite.config.ts`) |
| Variables | `.env.web-final` (ignorado por `.env.*`, permisos 0600, secretos aleatorios, nunca se imprimen) |

Perfiles (ajustes **sólo de demostración**, configuración del proceso de prueba, no política aprobada):

| Perfil | Ajustes |
|---|---|
| P1 | `DEMO_FIXTURE_ENABLED=true`, valores de `.env.example` (límite 2000000, umbral 500000, expiración 300, intentos 5) |
| P2 | `DEMO_FIXTURE_ENABLED=false` |
| P3 | fixture activo, `OTP_EXPIRY_SECONDS=5`, `OTP_MAX_ATTEMPTS=2` |
| P4 | fixture activo, `DAILY_TRANSFER_LIMIT_MINOR=100000` |

Todas las `*DATABASE_URL*` se fijan explícitamente: `DATABASE_URL`/`TEST_DATABASE_URL` → `wallet_test` en
55433 (procesos API); `MIGRATOR_DATABASE_URL` → `postgres://none@127.0.0.1:1/none` (destino inválido).
Para migrar y para el proceso de Playwright, `DATABASE_URL` también apunta a ese destino inválido porque
el guardián `assertSafeTestDatabase` rechaza que la URL «de desarrollo» coincida con `wallet_test`.

## Comandos

```sh
export PATH=$HOME/.nvm/versions/node/v26.13.1/bin:$PATH
node web/e2e-final/scripts/make-env.mjs            # crea .env.web-final si no existe
node web/e2e-final/scripts/db-up.mjs --evidence <archivo>  # df + docker system df, ≥2.5 GiB, crea/arranca, migra wallet_test
node web/e2e-final/scripts/preflight.mjs           # PASS/FAIL: destinos de BD, contenedor, puertos libres
WF_PROFILES=P1 npx playwright test -c web/e2e-final/playwright.config.ts --project=final
# legacy (web/e2e) en dos invocaciones: la API limita /auth/register + /auth/login a 10/min por IP
# (limitador en memoria del proceso); cada invocación arranca una API P1 nueva.
WF_PROFILES=P1 npx playwright test -c web/e2e-final/playwright.config.ts --project=legacy own-account-transfer.spec.ts product.spec.ts
WF_PROFILES=P1 npx playwright test -c web/e2e-final/playwright.config.ts --project=legacy w13-rejections.spec.ts
node web/e2e-final/scripts/static-checks.mjs [docs/evidence/web-final/<sha>]
node web/e2e-final/scripts/db-down.mjs             # limpieza: stop + rm contenedor + rm volumen (sólo esos nombres)
```

- `playwright.config.ts` ejecuta `preflight.mjs` una vez antes de arrancar servidores (falla si un puerto
  de la ronda está ocupado) y levanta, por cada perfil de `WF_PROFILES`, la API y la Web
  (`scripts/serve.mjs`, que compila `web/dist/pX` con `VITE_API_URL=http://127.0.0.1:330X/v1`).
  Playwright detiene esos procesos al terminar. `WF_NO_BUILD=1` reutiliza `web/dist/pX`.
- Evidencia en `docs/evidence/web-final/<sha>/` (`WF_EVIDENCE_SHA`, por defecto el HEAD corto). Las
  capturas PNG y `test-results` quedan en `captures/` (ignorado por `.gitignore`).
- Servidores manuales (si hiciera falta): `node web/e2e-final/scripts/serve.mjs api P1` y
  `node web/e2e-final/scripts/serve.mjs web P1`; se detienen con Ctrl-C o `kill <PID>` del propio proceso.

## Limpieza

```sh
node web/e2e-final/scripts/db-down.mjs
# equivalente: docker stop fintech-wallet-web-pg && docker rm fintech-wallet-web-pg && docker volume rm fintech-wallet-web-pg-data
```

Nunca se usa `docker compose down -v`, ni se detienen/borran otros contenedores, volúmenes o procesos.
