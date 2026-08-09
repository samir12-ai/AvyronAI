---
name: Offer pain scaffolding & contract coherence
description: Why the Offer engine doom-looped to "No Offer" — scaffolding prefixes poisoning the pain contract, plus four contract-coherence defects between prompt/validators/clamps/depth-gate read path.
---

# Offer pain scaffolding & contract coherence

**Rule 1 — scaffolding prefixes are labels, not pain language.** The audience engine fabricates registry canonicals like `"Problem behind objection: X"` / `"Unresolved need: Y"`. Any consumer that derives echo/contract words from raw canonicals ends up demanding meta-tokens ("problem", "behind", "objection"), which steers the LLM into template text with zero AEL root-cause semantics → depth gate fails truthfully on poisoned input. `cleanPainScaffolding()` in `server/offer-engine/engine.ts` must guard EVERY pain-text derivation site (alignment context, prompt words, PAIN_ECHO validator, skeleton painsList/primaryPain, layer1 coercion). Cleaned word set is a strict subset of raw, so downstream integrity l2 (raw probe) stays satisfied.

**Rule 2 — every offer-replacement path must re-apply every clamp.** Alignment-retry `Object.assign(primaryOffer, retryPrimary)` silently dropped the root-axis clamp; the accepted retry candidate then guaranteed INVALID_ROOT_BINDING at post-gen. Clamp predicates must ALSO mirror the downstream validator byte-for-byte: `clampOfferToAxis` satisfied itself on ANY posLock token (e.g. "platform") while `validatePostGeneration` demands the root primaryAxis tokens specifically.

**Rule 3 — the depth gate must score the full offer representation.** `celSourceTexts` omitted `problemStatement`, the exact field where the skeleton and depth-retry LLM put root-cause language ("pain — root cause: X"). Fix the read path, never the gate.

**Why:** 2026-08-09 forensic on job campaign_1773576062201_6t0oxi_realrun_* — five compounding defects, each individually looked like a truthful gate rejection.

**How to apply:** whenever an offer/plan gate fails "truthfully" on healthy upstream data, diff the exact evaluated texts and required word/token sets against the raw registry/root values FIRST; check for label scaffolding, predicate drift between clamp and validator, and fields dropped from the evaluated representation.

**Residual truth:** after all fixes, this campaign still DEPTH_FAILEDs in orchestrator context because the strategy root's mechanism/claim DNA is genuinely vague ("platform capability transformation validation gap"); interchangeability judge rejects 3/3 for the same reason and DNA_ENRICHMENT_REQUIRED (Path B) is correctly raised. Remedy is richer product DNA → mechanism re-run, not offer-gate tuning.
