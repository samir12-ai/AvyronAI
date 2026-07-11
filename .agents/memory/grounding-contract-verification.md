---
name: Grounding contract behavior & verification gotchas
description: How the shared grounding contract actually behaves at runtime and the non-obvious traps when validating it from run logs/snapshots.
---

# Grounding contract (server/shared/grounding-contract.ts) — behavior & verification

The contract compels judged engines to (1) name the differentiating feature, (2) cite AEL evidence as a
structured `groundingRefs: string[]`, (3) self-check interchangeability. `checkGroundingContract(...)` validates
the emitted refs and logs `GROUNDING_CONTRACT_MET` (console.log) / `GROUNDING_CONTRACT_UNMET` (console.error).

## Non-obvious behaviors (don't misread these as bugs)

- **`groundingRefs` is validated & logged, NOT persisted.** The refs are parsed into a local var, fed to
  `checkGroundingContract`, and logged — but engines build their typed result objects field-by-field, so the
  refs do NOT land in `engine_*_snapshots.json`. The contract-registry `.passthrough()` *permits* the field but
  does not *force* it through. If you see the string `groundingRefs` inside a snapshot, it's embedded **prompt
  text**, not an output key. Making it durable requires per-engine result-construction edits (bigger diff).
  **Why:** implemented under a minimal-diff / no-schema-break constraint; the contract's purpose (compel + verify
  + loud log) is met without persistence.

- **`ael == null` ⇒ `met=true` (NO_AEL_AVAILABLE) and does NOT log.** Audience passes `ael=null` by design, so it
  never emits a MET line. Offer/persuasion/cialdini emit nothing when no AEL exists at the checked site. **Absence
  of a MET log ≠ contract failure** — only `UNMET` is a real failure.

## Verification gotcha (cost me a wrong count once)

- **`grep -c` over the workflow log over-counts every marker by 1.** The harness prints a final
  `markers: {..., "GROUNDING_CONTRACT_MET":7, "GROUNDING_CONTRACT_UNMET":0, ...}` summary line whose JSON *keys*
  contain the marker strings, so each marker matches one extra time (and any with a real event count off-by-one).
  **Authoritative source = `SUMMARY.json → markerCounts`**, not `grep -c` on the log. Use the log only to read the
  per-engine `cited=...` detail on the actual `[GroundingContract] ...MET|UNMET` event lines.

## Truthful before/after reporting

- Confirm no gate change by showing identical gate telemetry across runs: `orchestrator.status`,
  `CONTRACT_INCOMPLETE`, `DEPTH_FAILED`, `buildPlan.status`. `ORCH_STATUS=BLOCKED` here is a pre-existing funnel
  `DEPTH_FAILED` gate, not a regression.
- Favorable single-run deltas (e.g. `BLOCKED_BY_INTEGRITY` down, `NOT_REACHED` down) are **stochastic** — report as
  observations, never claim causation from one LLM run against an unchanged integrity stack.
