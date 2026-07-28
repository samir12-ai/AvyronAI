---
name: Strategic reasoning evidence-registry pattern
description: P-4 layer design — evidence refs as the grounding contract, absence-as-evidence, tenant scoping, and window-granularity rules for market memory history
---

## Evidence-registry grounding beats free-text grounding
The reasoning layer assigns every verified fact a short citable ref (MM-*/PR-*/BIZ-1/HIST-*…) and the code guard checks cited refs ⊆ registry. This is a stronger, fully deterministic contract than number-subset checks alone — reuse it for any new LLM interpretation surface.
**Why:** ref-existence is binary and unfakeable; the LLM physically cannot cite evidence that doesn't exist without being caught in code.

## Absence must be citable evidence
When deterministic analysis finds nothing (no recurrence/momentum yet), register the absence itself as an evidence item (HIST-0). Otherwise the LLM cites the empty findings block or leaves refs empty and guards reject healthy truthful output.
**Why:** two live failures came from "no history yet" cards having nothing legal to cite; prompt-tuning alone did not fix it — the structural fix did.

## Derived counts need explicit allowance once blanket exemptions go
Removing a blanket small-number exemption from a numeric guard requires adding deterministically derived counts (evidence totals, per-type counts, findings lengths) to the allowed set, or truthful counting language gets rejected. Also: any number a deterministic fallback template prints (e.g. basedOn post counts) must appear in evidence details, or the fallback fails its own guards.

## Market-memory history rules
- Temporal logic (recurrence spacing, resemblance age) must use windowTo, never createdAt — backfilled/seeded rows corrupt createdAt-based spacing.
- Only compare rows of the same windowDays; 30d and 90d emerging themes are different observations and cross-counting fabricates recurrence.
- Validation seeding trick: give seeded chains a window size unused by live data (e.g. 7d) so live rows can't interleave and break consecutive-window momentum.

## Judge over-rejection class (recurring)
Same lesson as P-3, extended: judges also over-reject descriptive competitor-posture grouping ("objectives consistent with trends") as outcome causation, and per-card confidence fields as "overconfidence". Whitelist descriptive grouping explicitly and scope confidence violations to certainty *language* over thin evidence.

## Tenant scoping is per-layer work
New read paths over shared tables must add accountId+campaignId filters even when the route's campaign guard makes collisions unlikely, and in-process caches must key on accountId:campaignId. Dedup/unique indexes on tenant data should include account_id.
**Why:** architect review flagged campaign-only scoping as a high-severity isolation risk; house convention is defense in depth.
