# Product implementation plan and orchestration record

## Scope

Implement the approved product scope from the original fintech challenge in vertical slices. BOOT-00 is already published on `main`; work on `feature/product-mvp` and preserve its full history. Final delivery is a fully integrated branch plus reproducible instructions and evidence for an independent reviewer.

## Source and authority

- Original challenge: `docs/challenge.md`, copied faithfully from the user-provided attachment.
- Original challenge is `docs/challenge.md`; requirements are `specs/requirements.md`.
- The user approved the inspected web/mobile Stitch designs as visual references on 2026-11-14. `docs/design-mapping.md` links screens to app routes, states and phases.
- Only mandatory API/web/mobile behavior is authorized. External SPEI, real bank integrations, guarantees, bonus products, biometrics and scheduled/export features remain excluded.
- User-approved demo data policy: create one MXN account at registration; local demonstration may create two own accounts with balanced contra postings. Monetary example values remain fixture data, not product policy.

## Forge roles and traceability

- Planner owns `SPEC.md` only for this new cycle; its product contract must be committed before code changes.
- Backend, Web and Mobile are independent OpenCode task contexts in isolated Git worktrees after contracts/ownership are frozen.
- Coordinator exclusively owns shared API/OpenAPI/types/manifests/lockfile/docs/CI and performs integration.
- Generator never edits `SPEC.md` or `FINDINGS.md`; Evaluator writes only `FINDINGS.md` and does not fix code.
- Preserve the previous Forge 3/3 record as `docs/forge/BOOT-00-FINDINGS.md`; the product cycle gets a new root `FINDINGS.md` history and at most three evaluator passes.
- Keep traceability from requirements → design/screen → task → commit → test.

## Vertical slices

1. Registration web, login web/mobile, refresh/session, accounts and balances.
2. Web beneficiary create/list and mobile beneficiary selection.
3. Internal beneficiary/own-account transfer, review/OTP/configured limits/idempotency and network recovery.
4. Cursor history, filters, movement details, internal receipts, rejection and privacy/session expiry.
5. PostgreSQL integration, 100-concurrent-transfer and 100k-movement explain evidence, visual/responsive QA, CI.

Do not deploy AWS, connect SPEI/banks, publish Expo/EAS, or implement optional bonus features.

## Ownership and contracts

| Owner | Exclusive paths / responsibility |
|---|---|
| Coordinator | `specs/openapi.yaml`, generated/validation `packages/shared/**`, every `package.json`/`package-lock.json`, CI, root QA scripts, product docs, final integration and branch |
| Backend agent | `api/**` except `api/package.json`; API services, routes, configuration, TypeORM migrations and tests. Requests dependencies/scripts from Coordinator. |
| Web agent | `web/**` except `web/package.json`; React routes/components/styles/tests/Playwright E2E. Requests dependencies/scripts from Coordinator. |
| Mobile agent | `mobile/**` except `mobile/package.json`; Expo Router routes, native components, app config, session, tests. Requests dependencies/scripts from Coordinator. |

OpenAPI is the source of request/response types. The Coordinator generates TypeScript declarations and lands them before the worktrees branch. No workstream edits OpenAPI, shared generated types, root manifests/lockfile, task plan, or another workstream's files. Each independent task is assigned its own worktree and branch.
