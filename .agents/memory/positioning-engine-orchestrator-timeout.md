---
name: Positioning Engine orchestrator timeout
description: Positioning Engine SemanticCollision step can alone exceed the orchestrator's 420s ENGINE_TIMEOUT, causing all downstream engines to be skipped and buildPlan to return INSUFFICIENT_DATA.
---

**The rule:** The Positioning Engine's `PositioningSemanticCollision` LLM step scores every territory against every competitor claim; at 2 territories × 29 competitors it took ~120 s in one observed run. Total engine wall-clock was 530 s, exceeding the orchestrator's `ENGINE_TIMEOUT_MS_OVERRIDE=420000`. The orchestrator marks the engine TIMEOUT even if its internal logic eventually finishes.

**Why:** The orchestrator fires a parallel timeout watchdog for each engine. Once the watchdog fires, all downstream engines that depend on positioning are `ENGINE_SKIPPED`. The pipeline reaches `BLOCKED` at System Control.

**How to apply:** When `runBuildPlanLayer` is invoked after a BLOCKED pipeline, it receives no usable snapshots for most engines and returns `status=INSUFFICIENT_DATA actionability=0 attempts=0` — it never reaches the `aiChat` call. Therefore the `timeoutMs: 120_000` fix on the buildPlan LLM call cannot be exercised in a run where Positioning Engine caused the BLOCK. Full LLM-path verification of Blocker 1 requires a run where Positioning Engine completes within 420 s (or the orchestrator timeout is raised to cover it).
