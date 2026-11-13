# BOOT-00 plan and orchestration record

## Scope

Prepare a reproducible monorepo for the fintech challenge; this phase delivers documentation/specification first, then only infrastructure and non-product scaffolding. Stop after publication and remote SHA/CI verification at `DESIGN_REVIEW_REQUIRED`.

## Source and authority

- Original challenge: `docs/challenge.md`, copied faithfully from the user-provided attachment.
- This plan and `SPEC.md` authorize BOOT-00 only; `specs/tasks.md` documents future work but does not authorize it.

## Forge roles and traceability

- Planner owns `SPEC.md` only.
- Generator works only within BOOT-00 and never edits `SPEC.md` or `FINDINGS.md`.
- Evaluator verifies the README's real startup, scripts, documented specs-before-scaffold ordering, and test/dev database isolation; Evaluator only authors `FINDINGS.md`.
- Role contexts are delegated only where the OpenCode host provides an independent task context; otherwise the role runs in the current session and that limitation is recorded honestly.
- Preserve role outputs and verification reports in version control; maximum three evaluation passes.

## Stop condition

Publish one private `jasanhdz/fintech-wallet` repository on `main`, verify its remote commit SHA and CI state, then stop. Product implementation requires design review first.
