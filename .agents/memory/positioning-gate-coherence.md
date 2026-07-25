---
name: Positioning gate/prompt coherence
description: Why the positioning doom loop happened and the rule that prevents recurrence (prompt steering, grounding allowlist, and judge anchor must stay in lockstep)
---

# Positioning engine gate coherence

**Rule:** Whenever the composer prompt steers claim language toward a product attribute (mechanism, advantage, offer), the grounding allowlist must accept that same attribute's language, and the interchangeability judge must receive a product anchor built from it. If any of the three lags, the engine enters a doom loop: LLM writes what the prompt asks → grounding gate rejects it as unanchored (or the judge rejects it as generic) → retries exhaust → template fallback with capped confidence.

**Why:** July 2026 "reanalyze not working" incident — grounding gate and interchangeability judge disagreed about what a valid claim looked like, so all 3 attempts failed and output degraded to seed templates at confidence 0.25.

**How to apply:**
- Prompt FIELD RULES, `buildAnchorAllowlistTerms`, and the battery's ProductAnchor derivation must be edited together, never singly.
- When strategic doctrine is absent, the judge anchor is derived from Product DNA — but ONLY when a real differentiator + core problem exist. Fabricating an anchor from empty strings flips the judge to the strict test with hollow context, which is worse than the anchor-free test.
- Persistent judge rejection with a well-formed anchor is truthful degradation (B1), not a bug: it means the account's `uniqueMechanism`/`strategicAdvantage` DNA fields are genuinely category-generic. The lever is richer business-profile input, not gate tuning. Do not loosen the judge to buy confidence.
