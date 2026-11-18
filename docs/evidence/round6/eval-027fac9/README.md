# Evaluación independiente ronda 6, pasada 7 (código `027fac9`)

Nivel: unit (jest), integración API/PostgreSQL (`wallet_test`), render RN-Web (export web en Chromium 390 px @2x). **No es evidencia nativa** (sin simulador/iPhone; F-05).
Entorno propio: API `dev:api:testdb` :3711, bundle web :8711 (export en scratch con shim de SecureStore sólo en la copia exportada, `patch.py` de G4). Procesos terminados al acabar; 3200/5174/8083 y `wallet_dev` no tocados. Contraseña de prueba sólo por variable de entorno.
- `tools/`: `e15.cjs` (F-15), `e16.cjs` (F-16, 100/130/200 %, M02-M08, M10, M11), `e17.cjs` (F-17), `e19.cjs` (F-19, todos los `aria-label`), `e2e.cjs` (Principal->Ahorro 300.25, Ahorro->Ahorro), `lib.cjs`, `compose.py`, `mapping.json`; `capture.cjs`/`seed.mjs` del implementador (G4) ejecutados por el evaluador para las 30 capturas.
- `logs/`: lint/typecheck/test, integration (una suite a la vez), `e16-overflow.txt`, `e17-inter.txt`, `e19-labels.txt`, `e2e-regression.txt`, `capture.log`, `metrics.txt` (diferencia media vs referencia), mutaciones (`mutation-revert-fixes-jest.txt`, `mutation-F17.txt`, `mutation-F18*.txt`).
- `tri/`: referencia | captura propia | diferencia, 16 estados afectados + 4 no afectados (M01-login, M03, M05-vacio, M09-verificando, M02).
- `shots/`: F-15 (3 variantes a 844/884/763) y F-17 (login con descarga colgada a 1 s y normal/abort/hang).
