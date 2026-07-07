---
name: Avyron typecheck baseline
description: How to typecheck safely in the Avyron repo — large pre-existing error baseline, and a tsc double-run timeout quirk.
---

# Avyron typecheck: measure deltas, run once

`npx tsc --noEmit` reports a LARGE pre-existing error count (baseline was 713 at time of writing — re-measure, it drifts). The project runs via `tsx` (no typecheck at boot), so these pre-existing errors do NOT block boot.

**How to apply:**
- Judge your edits by the DELTA, not the absolute count. After a change, `rg -c "error TS"` and compare to baseline; also `rg` for your specific touched files/line ranges to prove none of the errors are yours.
- Run tsc ONCE, redirect to a temp file, then grep it: `npx tsc --noEmit > /tmp/tsc.txt 2>&1; rg -c "error TS" /tmp/tsc.txt`. Running tsc twice in one command (or back-to-back) times out at the 120s tool limit.
- `npm run lint` is broken in this repo — enforce doctrine rules (D1 no `??`/`||` producing decision/verdict/outcome VALUES; strict `z.enum`; runOrchestrator ≤5000 lines; no bare LLM in orchestrator siblings) MANUALLY.
