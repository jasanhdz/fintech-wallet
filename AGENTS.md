# Project instructions

- This repository is BOOT-00 only. Do not implement registration, login, accounts, beneficiaries, transfers, ledger, OTP, financial schema, or product screens.
- Treat `docs/challenge.md` as the verbatim source for challenge requirements and `specs/*` as the derived design record. Future work in `specs/tasks.md` remains blocked by `DESIGN_REVIEW_REQUIRED`.
- Preserve existing user work. Never reset, force-push, or delete unreviewed files.
- Forge Planner writes only `SPEC.md`; Generator may build only its BOOT-00 rubric and must not edit `SPEC.md` or `FINDINGS.md`; Evaluator writes only `FINDINGS.md` and does not fix code.
- Keep the documentary specifications commit before any scaffold or application-code commit. Use task IDs in commit messages and retain full history.
- Never read or commit local secrets. Test scripts must refuse to target the development database.
- Do not deploy AWS, publish Expo/EAS, run a public tunnel, or proceed to product tasks before design review.
