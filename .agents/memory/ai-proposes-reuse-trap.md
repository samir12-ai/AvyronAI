---
name: AI-proposes / code-validates reuse trap
description: The two things that silently break when you bolt a gate-validated AI layer onto an existing deterministic strategy engine that has snapshot reuse.
---

## Rule
When adding an "AI Proposes, Code Validates" layer on top of an existing deterministic strategy engine (audience/positioning/offer/channel-selection pattern in `server/strategy/**` + `server/*-engine/**`), two orchestrator wiring steps are mandatory:

1. **Bump the reuse-hash literal** for that engine's `computeInputHash("...-vN", ...)` call in `server/orchestrator/index.ts`. Pre-existing snapshots were produced WITHOUT the AI layer and lack the new fields; without a bump they get reused forever and the AI layer never runs on returning campaigns.
2. **Append the engine's decision summary to `priorDecisions` on BOTH the fresh path AND the reuse (cache-hit) path** via `appendPriorDecision(ctx, summary)`. Downstream contradiction gates validate later candidates against these prior decisions; if a cache hit skips the append, later engines lose the ability to detect contradictions against this engine on reused runs.

**Why:** both failures are silent — the pipeline still "succeeds," so nothing surfaces the regression. The Phase 2 build hit the reuse-skip; the fix is structural, not a one-off.

**How to apply:** mirror the offer engine's dual-path append. Keep the deterministic engine sync and untouched (it is the constraint floor + recorded fallback); put all async LLM + gate-battery work in a NEW module inside the engine dir (engine dirs are whitelisted for `aiChat`; orchestrator siblings are not, and have a 200-line ceiling). Constrain the AI pick to a whitelist of the deterministically-viable candidates so the AI can never resurrect a hard-blocked option. If the AI reorders primary/secondary, recompute EVERY primary-derived field in lockstep (fit score, confidence with the same reliability/repair penalties, risk-note merge, layer results) — a partial swap yields an internally inconsistent result.
