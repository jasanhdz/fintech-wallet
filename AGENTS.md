# Project instructions — product implementation phase

- The user approved the inspected Stitch exports as visual references on 2026-11-14. Functional requirements remain governed by `docs/challenge.md` and `specs/requirements.md`; visual mapping is in `docs/design-mapping.md`.
- Implement only mandatory challenge scope. Do not add real SPEI/external-bank connectivity, investments, guarantees, biometric auth, scheduled transfers, monthly statements, limit-management, or unsupported regulatory/security claims. Keep illustrative thresholds/configuration labelled demo-only, not approved production policy.
- Registration creates a MXN account. The user approved local demo data with two own accounts and balanced opening counter-entries; fixture amounts are examples only. Never seed or reset outside the authorized test database, except the documented idempotent local dev seed.
- Preserve the source HTML and captures in `design/` as user references. Do not copy HTML into app code. Web uses React components; mobile uses native React Native components, never a WebView.
- Preserve existing work. Never reset, force-push, delete user files, or operate on Lucem containers/volumes/data. Do not use `docker compose down -v`.
- Forge roles: Planner writes only `SPEC.md`; Generator never edits `SPEC.md` or `FINDINGS.md`; Evaluator only writes `FINDINGS.md` and never fixes code. Preserve the prior BOOT-00 evaluation under `docs/forge/BOOT-00-FINDINGS.md`; product evaluation is a separate cycle.
- OpenAPI, `packages/shared`, root manifests/lockfile, CI, migrations/architecture decisions and integration are owned by the Coordinator. Backend agent owns `api/src/**`, `api/tests/**`, and `api/src/db/migrations/**`; Web owns `web/src/**`, `web/tests/**`, `web/e2e/**`; Mobile owns `mobile/App.tsx`, `mobile/app/**`, `mobile/src/**`, `mobile/tests/**`, and Expo config except package manifest. Request dependency changes from the Coordinator.
- Work in `feature/product-mvp` and isolated task worktrees/branches. Commit only owned files and task IDs; retain all ancestry including `839bb38`.
- Never inspect or commit local secrets. Passwords, refresh tokens, OTPs, CLABEs and financial data must not appear in logs.
- PostgreSQL tests must fail closed on `wallet_dev` and use `wallet_test`. TypeORM `synchronize:false` in all environments.
- No AWS deployment, Expo/EAS publish, app-store distribution or public tunnel. Finish with reproducible run instructions and an independent-review report; do not self-declare final approval.
