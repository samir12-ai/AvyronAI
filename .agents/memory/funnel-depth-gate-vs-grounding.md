---
name: Funnel depth gate vs grounding contract score different surfaces
description: Why "score the full funnel" did not lift the funnel depth score, and how to verify such input-fixes before trusting a diagnosis
---

- The GroundingContract check and the CEL depth gate (`enforceEngineDepthCompliance`) score DIFFERENT text surfaces. GroundingContract runs on the funnel LLM's raw concept-generation output (which cites `[RC#]/[CC#]/[BB#]`) → can be MET. The depth gate scores `collectFunnelText(...)` of the DETERMINISTICALLY-built funnel structure (stageMap/trustPath/proofPlacements/frictionMap), which `buildFunnelCandidate(...)` builds WITHOUT the AEL and which carries no root-cause references → floors near `depthScore=0.1`.
- Consequence: `GROUNDING_CONTRACT_MET` does NOT imply the depth gate will pass. A funnel can cite every root cause in its concept output and still `DEPTH_FAILED` because the scored deterministic structure references none of them.

**Why:** the funnel LLM output schema is only `{name,type,rejectionReason,groundingRefs}` — the grounded prose is discarded after the contract check; the rich structure is built deterministically from audience/offer/positioning templates, not from the AEL. Grounding-MET is checked on one surface; depth is scored on another.

**How to apply:** to make the funnel pass depth legitimately (fix inputs, never gates), the depth scorer's INPUT must include AEL-grounded content — either feed `analyticalEnrichment` into `buildFunnelCandidate` so stage/trust/friction text references root causes, or resolve `groundingRefs` back to AEL root-cause texts and include them in `celSourceTexts`. Correcting the retry to score the full deterministic funnel (the `[type,name]` bug) is NECESSARY but NOT SUFFICIENT.

**Verification lesson (general):** a diagnosis that cannot quote the actual scored strings (`layer_diagnostics=null`, replay off) can be wrong about the *decisive* break even when its sub-findings are correct. Before trusting that a scoring-INPUT fix will lift a score, capture the per-attempt scored input / per-attempt depthScore empirically via an A/B real run — do not ship on the inference alone. Also note the orchestrator-level `CEL_ENGINE | funnel | score=0.00 | missing_root_cause` is circular after DEPTH_FAILED: it scores the "No Funnel" placeholder, so it is not independent evidence.
