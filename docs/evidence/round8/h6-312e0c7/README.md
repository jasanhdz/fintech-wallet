# Round 8 · H6 (fix mode) — evidence for code 312e0c7

Scope: the open pass-11 findings F-32 (minor, API configuration) and F-31 (minor, mobile coverage). F-33 (Expo version drift)
and the manifests/lockfile were not touched. Commits: `51bf10d fix F-32`, `312e0c7 test F-31`.

All runs used Node 26.13.1, this worktree only, PostgreSQL `wallet_test` (container `fintech-wallet-postgres-1`) and ports
3971–3979. No `wallet_dev`, no demo ports (3200/5174/8083), no Lucem. Only processes started here were stopped (by PID or by
their own process group). No OTP, key, token, CLABE or connection string is printed in these logs.

## F-32 — `IDEMPOTENCY_RECORD_RETENTION_DAYS` validated at start-up

Change: `assertStartupConfiguration` (`api/src/config.ts`) = production checks + the retention variable in every environment;
`api/src/server.ts` calls it before opening the database or listening and, on failure, prints one line
`{"event":"api.config_invalid","message":"IDEMPOTENCY_RECORD_RETENTION_DAYS …"}` and exits 1. No default; transfers still read
the variable per request; `createApp` and the integration suites are unchanged.

| Evidence | Result |
|---|---|
| `logs/f32-tests-before-fix.txt` — new tests against `9274403`'s `server.ts`/`config.ts` | **exit 1**: `config.test.ts` fails (no `assertStartupConfiguration`), the start-up test fails (the process got past configuration and only failed at the database); the control passes |
| `api/tests/config.test.ts`, `api/tests/startup.test.ts` on `312e0c7` | pass (in `logs/root-test.txt`, api 15/15) |
| `logs/f32-policy-probe.txt` — evaluator's `start-api.sh` (real `server.ts`, wallet_test) | unset / `0` / `-5` / `treinta` / `987654321987`: **exit 1 before listening**, `GET /v1/transfer-policy` → ECONNREFUSED, message names the variable without its value. Control `30`: listens, register 201, authenticated `GET /v1/transfer-policy` **200** |
| `logs/f32-dev-start-probe.txt` — `npm run dev:api:testdb` and `npm run dev:api` (tsx watch) | without the variable: `api.config_invalid`, `/health` and `/v1/transfer-policy` ECONNREFUSED (the `tsx watch` watcher stays alive waiting for edits, but no API process listens); control `30` on wallet_test: `api.listening`, `/health` 200 |

Limit: the `npm start` rows of `f32-dev-start-probe.txt` are not F-32 evidence. The compiled `dist/src/server.js` exits 1
with `ERR_MODULE_NOT_FOUND` (`packages/shared/src/money.js`), before any configuration check and regardless of this
change. Production mode is covered by `startup.test.ts` ("production, variable unset", real `server.ts` under tsx).

## F-31 — the two surviving mobile mutants are killed

New jest cases in `mobile/tests/recovery-r8.test.tsx` (`describe('F-31: …')`, no app code change):
- M09 "Verificar" reads a `voided` / `rejected` closure in the list → nothing deleted, record byte-identical, 0 void, Home
  still blocked; only the explicit "Anular" (void 200) releases.
- `confirmVoid` with the record replaced (another key) or deleted after opening the void confirmation → 0 void calls.

`logs/f31-mutations.txt` (`python3 -I docs/evidence/round8/eval-8da2700/tools/mutate8.py r12 f2`): **r12 KILLED, f2
KILLED**. `mobile/App.tsx` was restored by the tool's `git checkout`. The tool appends to the evaluator's
`eval-8da2700/logs/mutations8b.txt`; those appended lines were copied here and that file was restored unchanged.

## Full verification (`tools/run-all.sh`)

| Level | Result |
|---|---|
| root `lint`, `typecheck`, `test`, `build`, `openapi:check` | exit 0 (api node:test 15/15, web 20/20, shared 4/4, mobile jest 281/281) |
| `assert-test-db` | exit 0 |
| api integration, one suite at a time on wallet_test | auth-accounts 2/2, beneficiaries 1/1, database 2/2, movements 1/1, round6-contract 1/1, transfers 2/2, **transfer-recovery 14/14** |
| mobile jest (full) | 10 suites, 281/281 |

## Deployment note

The live demo's `.env` (main checkout) must get `IDEMPOTENCY_RECORD_RETENTION_DAYS=30` (demo example, not approved policy)
before any fast-forward. Otherwise the updated API will not start. Migration `1763000009000` must also be applied to
`wallet_dev`. Both steps need the user's authorization (see `docs/round8-api-notes.md` §5 and `docs/round8-mobile-notes.md` §7).
