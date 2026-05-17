# Orchestrator Extraction PR — Task #90 / Phase 4-B

Use this template for any PR that EXTRACTS a responsibility from
`server/orchestrator/index.ts` into a new module folder, or that
PROMOTES an existing extracted module (`current` → `shadow` →
`candidate`).

## Module
- [ ] Module id: `__________________________________`
- [ ] Env flag: `ORCH_USE___________________________`
- [ ] Source-of-truth lines in `server/orchestrator/index.ts`:
      `_____ – _____`
- [ ] Promotion direction (check one):
  - [ ] New extraction (default `current`)
  - [ ] Promote `current` → `shadow`
  - [ ] Promote `shadow` → `candidate`
  - [ ] Demote / rollback (link incident)

## Behavioral parity attestation

- [ ] Module `index.ts` ≤ 200 lines (ESLint `orchestrator/no-new-large-file`).
- [ ] Module does NOT import `../index` (ESLint `orchestrator/module-boundary`).
- [ ] No new `eslint-disable semantic/no-semantic-fallback` outside the H1-H7
      archive allowlist. Suppression count delta = 0.
- [ ] Unit test file present: `server/orchestrator/<module>/<module>.test.ts`.
- [ ] Parity report present: `.local/docs/p4b-extractions/<module>-parity.md`.
- [ ] Parity report's "Comparator" section specifies either `defaultJsonDiff`
      OR a custom comparator with the timing/ordering whitelist.

## Doctrine compliance (D1-D5)
- [ ] D1: no `?? status` / `|| verdict` / `?? outcome` fallback on any
      verdict-shape read in the new module.
- [ ] D2: any new field has its own canonical name (no generic
      `status`/`verdict`/`outcome` for verdict semantics).
- [ ] D3: every union type is `z.enum`-equivalent string-literal union.
- [ ] D4: legacy fields (if any) are explicitly back-compat-only.
- [ ] D5: returns `null`/explicit envelope for missing canonical fields;
      no silent substitution.

## Replay corpus
- [ ] `npm run replay:run` passes against the full corpus with
      `ORCH_USE_<MODULE>=shadow` (zero `major` / `fatal` divergences
      recorded for 48 h).
- [ ] `npm run replay:flake` (100 iterations) passes.

## Operator surface
- [ ] CV-14 alarm thresholds reviewed for this module.
- [ ] Auto-revert supervisor watch entry added (if promoting to
      `candidate`).
- [ ] Rollback runbook entry updated in
      `.local/docs/p4b-extractions/rollback-runbook.md`.

## 8-audit gate (Seal #19 — applies on `candidate` promotion only)
- [ ] Audits 1-8 documented in `.local/docs/seals/seal-<N>-audits.md`.
- [ ] One-row summary in `.local/docs/seal-<N>-audit-report.md`.
- [ ] All audits PASS / DOCUMENTED_EXCEPTION (sunset date) /
      FIX_REQUIRED with linked follow-up.

## Drift declaration
Did this PR diverge from the task plan? Record the deviation:
> _______________________________________________________________

## Rollback procedure
If this PR ships behavior-changing code (i.e. promotes a module to
`candidate`), document the one-command rollback:
```
export ORCH_USE_<MODULE>=current  # then rolling restart
```
