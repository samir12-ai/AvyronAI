# User Pipeline Audit 2026-05 — One-Page Summary

**Status:** PASS for 5 of 6 categories. Category B is DOCUMENTED_EXCEPTION (no live 60-min sample possible in dev container; same class + sunset as Seal #19/#20 Audit #2). Category F is PASS for 8 pre-existing scenarios + UNVERIFIED for the operator-reset-during-failure sub-vector (F-F2). 0 P0/P1 in production runtime. 1 P2 fixed inline (F-D2). 1 P2 filed (F-F2 — subsumed by existing Seal #18 architect MEDIUM follow-up).
**Full report:** `.local/docs/audits/user-pipeline-audit-2026-05.md`.

| Category | Verdict |
|---|---|
| A — Lifecycle Integrity | **PASS** |
| B — Runtime Stability | **DOCUMENTED_EXCEPTION** (no live 60-min sample possible — same exception class + sunset as Seal #19/#20 Audit #2) |
| C — Continuity & Cadence | **PASS** (INVARIANT-RETRY enforced; scenarios 6 + 12 prove failure→retry and mid-tick crash. Operator-reset-during-failure sub-vector is UNVERIFIED — see Category F + F-F2) |
| D — Data & Semantic Integrity | **PASS** (1 P2 fixed inline: validation-contract test fixtures lagged the registry — engine emits the required fields, only the test fixture was stale) |
| E — Observability | **PASS** (every state transition has at least one operator-visible signal) |
| F — Stress / Recovery | **PASS for the 8 pre-existing scenarios; UNVERIFIED for the operator-reset-during-failure sub-vector** (scenario-19 attempted, withdrawn — see F-F2) |

**Findings:**

| ID | Severity | Disposition |
|---|---|---|
| F-D2 | P2 | Fixed inline — `server/tests/validation-contract.test.ts` `baseOutput()` updated to emit `unmappedSignals: []` + `lowConfidenceSignals: []` (mirrors `engine.ts:1458-1459`). |
| F-F2 | P2 | Filed (subsumed by existing Seal #18 architect MEDIUM "scenario-19 deferred" follow-up) — when an operator-injected `plan_anchor_resets` row coexists with a scheduler-written long-gap reanchor row inside the same retry-after-failure window, the next tick may not re-invoke `runBoss`. Probable scheduler bug OR harness gap; needs architect-level diagnosis. |

**Doctrine drift:** 0 new D1–D5 ESLint suppressions. Suppression count remains 11 (4 archive-allowlist + 7 Seal #19 documented).

**Test status:**
- Lifecycle suite: 18/18 PASS (no new scenarios shipped this audit; scenario-19 was attempted, surfaced F-F2, withdrawn).
- Doctrine regression: PASS.
- Integrity contract: PASS.
- Validation contract: 3 FAIL pre-audit → 8/8 PASS after F-D2 inline fix.

**Files changed:**
- `server/tests/validation-contract.test.ts` (fixture sync — F-D2)
- `.local/docs/audits/user-pipeline-audit-2026-05.md` (this audit)
- `.local/docs/audits/user-pipeline-audit-2026-05-summary.md` (this summary)

No follow-up tasks filed — existing 12 follow-ups in the queue already cover broader sunset items (production runtime baseline, allowlist sync, legacy `.catch(() => {})` sweep).
