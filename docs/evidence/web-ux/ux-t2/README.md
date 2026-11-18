# Evidencia · UX-T2/UX-T3 (sin commit; árbol de trabajo sobre `b73d4c7` + cambios UX-T1 de Codex)

Generator, 2026-11-17. Worktree `/Users/jasanhernandez/Develop/fintech-wallet-web-final`, rama
`feature/web-fidelity-final`. No hay commit ni push: el usuario todavía no los autoriza. Esto **no** es una aprobación
final; la revisión independiente queda pendiente para el Evaluator.

## Qué contiene

| Archivo | Contenido |
|---|---|
| `run0-final.txt` | Suite `final` sobre el árbol recibido (UX-T1 de Codex): 274 PASS / 5 FAIL (t0 SH alto de la marca y W07 idle 46 px) |
| `run1-final.txt` | Primera corrida tras implementar UX-T2/T3, antes de actualizar las aserciones Stitch (129 FAIL) |
| `final-suite.txt` | Suite `final` completa, perfiles P1–P4, build nuevo: **283 PASS / 0 FAIL** (golden S1…S7 incluidos) |
| `suite/` | `network-traces.json`, `suite-metrics.json` y el manifiesto de esa corrida |
| `walkthrough-*.json` | Recorrido real (API 3301 + `wallet_test`, web 5301): auditoría por pantalla (desborde horizontal, objetivos < 44/36 px, número de h1, errores de consola) |
| `captures/<viewport>/NN-*.png` | Capturas del recorrido (página completa y, <1024, también el viewport). PNG no versionados |

El recorrido se lanza con `node web/e2e-final/scripts/ux-walkthrough.mjs ux-t2 <anchos…>`, con los servidores P1 en marcha
(`node web/e2e-final/scripts/serve.mjs api P1` y `… web P1`). Los pasos son: login (vacío, con errores y real) → Inicio →
W06 vacío → W07 (inicial, errores, 404 real) → W06 con la lista → W08 (inicial, errores, completo) → W09 → W12 → W08 por
encima del umbral → W09 con código → W10 (vacío, incorrecto, completo) → W12 → W04 (con y sin filtro) → Inicio con
movimientos → «Cerrar sesión» → login → W14 por un 401 real con refresh 401. Ni las contraseñas ni los códigos ni las
CLABE se imprimen: el código de demostración se lee del DOM y no sale por consola.

## Resultados

- `npm --workspace @fintech-wallet/web run lint` y `run typecheck` terminan en 0.
- `test` da 49/49 en dos de tres corridas. `tests/auth.test.ts` «W14-F2» falla de forma intermitente
  (`findByText('out:expired')`, ~1.4 s). Los archivos que cubre (`session.tsx`, `api.ts`, `auth.test.ts`) no tienen
  cambios.
- Suite `final`: P1–P4, 283 PASS.
- `legacy`, invocación 1 (`own-account-transfer` + `product`): 8 PASS.
- `legacy`, invocación 2 (`w13-rejections`): 2 PASS.
- `static-checks.mjs`: PASS (SP-01, SP-02, SP-05, SP-06, SH-05, SH-07, UX-SC-03, TOK-01, REC-01, REC-08, ENV-02).
- NET-03: `git diff 0cf8257` de `transfer-attempt.ts`, `api.ts`, `session.tsx`, `transfer-form.ts` y `transfer-outcome.ts`
  está vacío. Las líneas `+/-` de `transfers.tsx`, `beneficiaries.tsx` y `routes.tsx` no tocan
  `request(`/`requestTransfer`/`*TransferDraft`/`createKey`/`Idempotency`/`method:`.
- NET-04: 0 coincidencias de `500000|2000000|parseFloat|toFixed` en `web/src`.
- NET-05: el diff de `api`, `mobile`, `packages`, `specs`, los `package.json`/lockfiles y `docs/web-fidelity-final` está
  vacío.
- Traza dorada: `golden.spec.ts` S1…S7 PASS contra `docs/evidence/web-final/f0ed4bc/network-golden.json`.

Aserciones sustituidas: `docs/web-ux-polish/SUPERSEDED.md`. Cambios de copy: `docs/web-ux-polish/COPY-CHANGES.md`.
