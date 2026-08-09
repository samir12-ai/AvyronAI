---
name: Wrapper guarantees bypassed by reuse/alternate paths
description: Metadata attached via engine entry wrappers is silently dropped on snapshot-reuse branches — every "attached on EVERY path" guarantee must enumerate ALL result-producing paths, not just the fresh-run call.
---

# Rule
When a guarantee is implemented as an engine ENTRY WRAPPER ("result always carries field X"), audit every place the orchestrator produces that engine's result WITHOUT calling the entry point — snapshot-reuse branches (`result = reused.hydrated`), cache hydration, replay paths. Those paths silently drop the wrapper-attached metadata.

**Why:** the five pain-routing engines attach `selectedPainRoles` via entry wrappers, but the orchestrator's reuse branches assign `reused.hydrated` directly — reused runs lost pain routing from plan_json until a central `attachSelectedPainRoles(engine, result, registry)` helper was added to the reuse branches. Deterministic selection makes central re-derivation equivalent to the wrapper.

**How to apply:**
- `rg` for every assignment of the engine's ctx slot / output variable, not just calls to the exported entry function.
- Prefer a shared attach helper (single source of truth for the role shape) called from both the wrapper and each reuse branch; keep the shapes in lockstep.
- Related failure family: retry paths dropping context args (see retry-path-context-threading.md) — same audit discipline, different path type.
