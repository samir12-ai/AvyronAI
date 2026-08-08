---
name: AEL JSON parse repair — thinking-token artifact
description: LLM thinking tokens inject \'  (invalid JSON escape) into AEL output; a 4-stage repair IIFE in analytical-enrichment-layer/engine.ts fixes this before throwing.
---

## Rule
Never call `JSON.parse` exactly once on LLM output for the AEL. Always run the 4-stage repair IIFE first.

## The artifact
OpenAI "thinking" token bleed-through produces `\'` inside JSON strings — this is invalid per the JSON spec (only `"` needs escaping; `\'` is a literal backslash-apostrophe and JSON.parse throws). The failure is silent until the entire AEL parse blows up, returning empty `root_causes=[]`.

## The 4-stage repair sequence (in order)
1. Direct `JSON.parse` — succeeds when there is no artifact.
2. Replace `\'` → `'` — handles the thinking-token apostrophe artifact.
3. Strip `"thinking"` fields with regex — removes embedded thinking blocks that carry raw text.
4. Normalize `\"` artifacts — handles double-escaped quotes left by thinking blocks.
Fall through to `throw` only if all 4 fail.

## Why this matters
Empty `root_causes=[]` → `causalDepthScore=0` → Differentiation DEPTH_FAILED on both attempts → `DEPTH_CASCADE_BLOCKED` fires and blocks ALL remaining engines (cascade from engine 4 through 15). The symptom looks like a timeout or an integrity failure, but the true root is a single invalid character in the AEL JSON string.

## How to apply
When diagnosing `DEPTH_FAILED` on Differentiation: check the AEL parse log first (`rootCauses=0` with no fetch error = parse artifact, not data absence). Add stages to the repair IIFE if new escape patterns emerge — do not relax the depth gate.
