---
name: Retry paths drop context threading
description: Regenerate/retry call sites silently omit anchor/context args that the attempt-1 call site passes — audit every retry branch, not just the first call.
---

# Rule
When a generation function gains new context parameters (doctrine anchor, strategic, productDna, attemptNumber), every retry/regenerate call site must thread them too — engines often have 2+ distinct retry loops (e.g. depth-gate retry vs signal-grounding retry) with separate call sites.

**Why:** the differentiation engine's signal-grounding retry loop omitted the anchor args while its depth-gate retry threaded them correctly — retries 2/3 silently ran without doctrine (`present=no source=none`) and mis-logged `attempt=1`. Full-fleet runs missed it because the engine usually passed on attempt 1; only a degraded-mode run that forced retries exposed it.

**How to apply:**
- After threading new args, `rg` for ALL call sites of the generation function and diff their argument lists against the attempt-1 site.
- Verify with per-attempt evidence logs: each attempt must log the same presence/source as attempt 1 and a correct attempt counter.
- To thread an attempt counter into a log line without touching the prompt, add a log-only optional param (same pattern as a `temperature` param) — never a synthetic correction object, which injects prompt content.
