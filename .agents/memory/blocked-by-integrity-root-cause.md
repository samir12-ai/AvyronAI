---
name: BLOCKED_BY_INTEGRITY root cause
description: The structural reason the 15-engine V2 pipeline ends BLOCKED_BY_INTEGRITY and why timeout increases don't fix it
---

## Rule
BLOCKED_BY_INTEGRITY is driven by the Audience Engine returning zero-confidence absent
evidence, not by engine timeouts. Raising ENGINE_TIMEOUT_MS has no effect.

**Why:** The cascade is:
1. Audience Engine AEL builds N dimensions but extracts 0 usable signal types
   (objection, root_cause) when competitor posting volume is thin (≤2 posts/30d for
   most competitors).
2. Confidence floor collapses to 0.00 (dataProv=absent, engineProv=absent).
3. SGL (Signal Grounding Layer) blocks all mid-pipeline engines (Positioning,
   Differentiation, Mechanism, Offer, Funnel, Persuasion) — they are SKIPPED, not
   timed out — because required signal types have zero coverage.
4. Integrity Engine runs synchronously (~5 ms, no LLM). Its inputs for Positioning,
   Differentiation, Offer, and Funnel snapshots are all null → 8/8 layers
   INSUFFICIENT_EVIDENCE → safeToExecute=false → BLOCKED_BY_INTEGRITY.

**How to apply:**
- A long V2 wall-clock (first-ever AEL build for a campaign: ~130 s) vs short on
  repeat (existing snapshot: ~25 s) is AEL build cost, not engine timeouts.
- The production ENGINE_TIMEOUT_MS (now 300 s) provides headroom for first-time AEL
  builds on new campaigns; it does not affect the BLOCKED verdict.
- The real fix is one or more of:
  a. AEL sparse-data fallback: synthesize proxy signals from MI threat/opportunity
     arrays when extracted signal types fall below SGL minimums.
  b. SGL soft-required: for markets with <5 competitor posts per window, relax
     objection/root_cause to soft-required so engines run in degraded mode.
  c. Audience confidence floor: assign minimum 0.30 floor when MI confidence ≥0.85,
     allow mid-pipeline engines to run with degradation markers.
- Each orchestration creates TWO `orchestrator_jobs` rows: the section-composer job
  (always COMPLETE) and the V2/15-engine job (may be BLOCKED). The BLOCKED verdict
  lives on the V2 job, not the section-composer job.
