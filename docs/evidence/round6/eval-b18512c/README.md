# Evaluación independiente ronda 6 (código b18512c)

Nivel de evidencia: unit (jest), integración API/PostgreSQL (`wallet_test`), render RN-Web (export de Expo en Chromium 390 px x2). NO es evidencia nativa (sin Hermes, SecureStore/Keychain, AppState, teclado ni fontScale reales; sin simctl/adb en este host).
Entorno: API aislada `dev:api:testdb` en :3611 sobre `wallet_test` migrada con `db:migrate:test`; bundle web en :8611 (shim de SecureStore sólo en la copia exportada). Procesos terminados al finalizar. Datos sintéticos (`*.ev.*@example.test`); contraseña por `EV_TEST_PASSWORD`.
- `tools/`: scripts (`s1` fechas, `s2` B/C/D, `s3`/`s3b` E/G, `s4` F-06/H/C4/carrera, `s5` dinero >2^53, carrera inversa, texto largo/130 %, `api-eval.mjs` API+BD, `compose.py` lado a lado/diferencia). `capture.cjs` de fidelidad = el del implementador (`../e677d8a/tools`) ejecutado por el evaluador con puertos propios.
- `logs/`: salidas (`api-eval.txt`, `s1-dates.txt`, `s2-bcd.txt`, `s3*.txt`, `s4.txt`, `s5.txt`, `mutations.txt`, `integration.txt`, lint/typecheck/test, `fidelity-capture.log`).
- `*--lado-a-lado.jpg`: referencia original `design/mobile/*/screen.png` (izq., escalada a 780 px) | captura propia (der.), alto del viewport = alto de la referencia. `*--diferencia.jpg`: |ref - app| por píxel sin umbral; `metrics.txt`: diferencia media absoluta (0-255) por estado. Los textos distintos (mockup vs datos de prueba) y fuente (Inter vs sistema) inflan la métrica; la comparación es visual.
- `shots/`: capturas puntuales de hallazgos.
