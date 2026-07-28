---
name: Grounded AI interpretation layer
description: Lessons from building the Watchtower AI Market Analyst (LLM above deterministic truth engine, code guards + LLM judge)
---

## Judge calibration: grouping ≠ causation
A grounding judge told to reject "unsupported causal claims" will over-reject the very signal-grouping behavior the analyst is REQUIRED to do ("these shifts appear related"). The judge rule must explicitly distinguish: connected/reinforcing/same-movement language over same-window, same-direction signals is expected interpretation; only proven-causation claims about business OUTCOMES (sales, engagement results) or definitive X-caused-Y statements are violations. Hedged language ("suggesting", "consistent with") is always acceptable.
**Why:** first validation run had the judge REJECT a correct coherent-movement interpretation for saying declining awareness posts "appear directly related" to rising conversion posts.
**How to apply:** when writing judge prompts for interpret-only LLM layers, enumerate what is NOT a violation as explicitly as what is.

## Large structured payloads break analyst calls two ways
A ~3K-token JSON bundle tripped both the default aiChat timeout AND max_tokens truncation (malformed JSON mid-array). Fix: explicit generous timeoutMs, larger max_tokens, plus a 2-attempt self-correction retry that restates the parse failure and asks for concise output.
**How to apply:** any new LLM call fed a full snapshot/bundle needs timeout + token budget sized to the payload, and a retry loop — the classifier self-correction pattern is the house convention.

## Period honesty for "last N days" claims
Every data source feeding a windowed insight must be filtered to the SAME window. Loading confirmed events "latest 20 by campaign" while distributions use a 30d window lets months-old shifts masquerade as current — architect review flagged this as blocking.
**How to apply:** when a bundle merges multiple tables, align every query's time filter to the snapshot's currentWindow; regression-test by seeding one in-window and one far-out-of-window row.

## Structural stripping of internal telemetry
Don't rely on routes hand-picking fields to keep internal flags (fallback reasons, rejection causes) out of customer payloads — export a `toCustomerPayload()` projection and make it the only thing routes serialize, so future internal fields can never leak.
