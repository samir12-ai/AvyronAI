---
name: CEL compliance forensic audit findings
description: Two confirmed software bugs caused COMPLIANCE_FAILURE in the real MarketMindAI run; fixes applied 2026-08-08; residual non-blocking depth violations in awareness/funnel/differentiation need separate follow-up.
---

# CEL Compliance Forensic Audit

**Bug 1 (CEL_VALIDATOR_BUG)**: `TRUST_OPACITY_RULE.requiredAxisPatterns` was missing `/evidence/i`. Territory text with "evidence-linked" (4×) correctly demonstrated transparency but CEL couldn't see it. Fix: add `/evidence/i` to requiredAxisPatterns in `server/causal-enforcement-layer/engine.ts` line 103.

**Why:** Pattern list was incomplete — "evidence" and "evidence-linked" are valid transparency signals (see CONCEPT_evidence in shared/embedding.ts). Adding the pattern is additive; threshold (0.75) unchanged.

**Bug 2 (LINEAGE_MAPPING_BUG)**: Orchestrator called `enforceGenericEngineCompliance("differentiation", ...)` using only `.claim` strings, missing pillar descriptions and mechanism text where TRUST_OPACITY patterns appear. Fix: replaced with full-text call using pillar name+description + claims + mechanism_framing.description (mirrors engine.ts:1532-1536). Important distinction: `enforceGenericEngineCompliance` checks required-axis alignment (TRUST_OPACITY patterns); `enforceEngineDepthCompliance` checks causal grounding depth — both are needed, only the text subset changed.

**Already-fixed bugs (before this audit):**
- Awareness: mythBreaker/narrativeReframe now included in celSourceTexts (lines 1132-1147 of awareness-engine/engine.ts)
- Funnel: FIX-C applied — groundedJourneyRationale attached in buildAllFunnels() before collectFunnelText/enforceEngineDepthCompliance

**Residual non-blocking violations (open follow-ups #149, #150):**
- Awareness depth: rootCauseRefs=0 (cosine similarity doesn't reach 0.35 threshold even with mythBreaker texts)
- Funnel depth: rootCauseRefs=0 (same issue)
- Differentiation depth: chainRefs=0 (CC2 text quoted verbatim but cosine sim still misses)
- All three have `passed=true` — not COMPLIANCE_FAILURE contributors

**Post-fix new run result:** 15/15 engines complete; CEL passed for all engines (score=1.0); blocked by CONFIDENCE_SPREAD_EXCESSIVE (mechanism confidence 0.20 vs market intelligence 0.92, spread 0.72 > threshold 0.50) — a truthful System Control gate, not a CEL bug.

**How to apply:** When debugging COMPLIANCE_FAILURE, always check (1) which violation types are in the report: `missing_alignment` from `enforceGenericEngineCompliance`, `missing_root_cause`/`missing_causal_chain` from `enforceEngineDepthCompliance`. Only the former with score < threshold = `passed=false` contributes to COMPLIANCE_FAILURE. Depth violations with `passed=true` are informational.
