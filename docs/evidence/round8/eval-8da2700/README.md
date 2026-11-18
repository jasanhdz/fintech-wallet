# Evaluación independiente ronda 8 (código `8da2700`; cambios `f0ed4bc..8da2700`)

Entorno propio: APIs reales (`tools/start-api.sh`, un proceso node por puerto, solo `wallet_test`) en 3951 (por defecto), 3952 (OTP 10.00), 3953 (retención 2), 3954 (sin `IDEMPOTENCY_RECORD_RETENTION_DAYS`), 3955/3956 (límites);
web exportada (Expo, shim SecureStore solo en la copia) en 8951. Node 26.13.1. No se usó `wallet_dev`, 3200/5174/8083, 33xx/53xx/55433 ni Lucem. Procesos terminados por PID. Ningún OTP/llave/CLABE completa en logs
(`lib8.mjs` los enmascara; `grep` sobre `logs/api395*.log`: 0 coincidencias).

- `tools/lib8.mjs`, `races.mjs`, `races2.mjs`, `otp.mjs`, `listing.mjs`, `loss.mjs`, `expiry.mjs`, `noretention2/3.mjs`, `reject.mjs`, `firstsend.mjs`: sondas propias de API+PostgreSQL.
- `tools/psql.sh` (solo `wallet_test`, roles runtime/migrator), `migration` en `logs/migration-*.txt`, `logs/db-guards-runtime.txt`, `logs/up.sql`/`down.sql`.
- `tools/mutate8.py`: mutaciones propias de `mobile/App.tsx` (`logs/mutations8.txt`, `mutations8b.txt`; restauradas con `git checkout`).
- `tools/mobile-copy/`: copia (leída, no confiada) de `lib.cjs`/`ui-r8.cjs` del Generator ejecutada por mí (`logs/ui-r8-stdout.txt`, 82 PASS/0 FAIL) y `ui-extra.cjs` propio (escenarios L y N, `logs/ui-extra-stdout.txt`).
- `logs/root-*.txt`, `integration-*.txt` (7 suites una a la vez), `ci.json`, `scope.txt`, `bundle-strings.txt`, `export-*.txt`, `expo-install-check.txt`.
