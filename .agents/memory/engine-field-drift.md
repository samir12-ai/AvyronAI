---
name: Engine result field-drift
description: Orchestrator-side reads of fields engines never emit silently zero out confidence/CEL inputs; check the real result shape before trusting any cross-module field path.
---

**Rule:** Whenever the orchestrator (or any consumer) reads a field off an engine result, verify the path against the engine's actual return shape (types.ts + the final `return {...}`). A wrong path does not error — it yields `undefined`, which flows into gates as 0/empty and produces *plausible-looking truthful failures* (low confidence, missing_alignment) that are actually input bugs.

**Why:** One session hit this three independent times, all producing orchestrator BLOCKED verdicts on healthy content:
- persuasion confidence map read top-level `confidenceScore` (never emitted; real: `primaryRoute.persuasionStrengthScore`) → engineConfidence 0 → spread gate tripped.
- offer CEL texts read top-level `offerName/coreOutcome/mechanismDescription/headline` (real fields under `primaryOffer`, `headline` doesn't exist) → CEL judged empty string → guaranteed FAIL.
- funnel CEL texts read top-level `stages` (real: `primaryFunnel.stageMap` with `name/purpose/contentType/conversionGoal`, plus `groundedJourneyRationale` string array) → same empty-string FAIL.

**How to apply:**
- Debugging a gate failure? First dump the *actual* evaluated input (DB `cel_reports.engineOutput`, provenance rows). Empty input = field drift, not bad content. Fix the read path, never the gate ("FIX INPUTS, NEVER GATES").
- When adding a consumer read, mirror an existing correct sibling (awareness's `primaryRoute.awarenessStrengthScore` was the template for persuasion).
- Add a loud `console.warn` when an extracted text list is empty so the next drift is visible instead of masquerading as a compliance failure.
- Related: retry paths dropping args (see retry-path-context-threading.md) — same class of silent cross-module contract drift.
