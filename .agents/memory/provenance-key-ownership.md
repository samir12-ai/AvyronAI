---
name: _provenance key ownership
description: result._provenance is owned by the snapshot-reuse trust layer; any other writer to that key makes fresh engine outputs classify as stale reuse.
---

**Rule:** `result._provenance` on engine outputs belongs exclusively to the snapshot-reuse trust layer. Any other metadata (AEL acknowledgement, downgrades, etc.) must live in its own namespaced key (e.g. `_aelProvenance`). Never merge extra flags into `_provenance`.

**Why:** The contract registry's `extractProvenance()` classifies ANY non-null `_provenance` object lacking `sourceJobId` as REUSED_UNVERIFIED → STALE. When the AEL consumer-guard began writing `aelPartialPropagated` etc. into `_provenance` on FRESH outputs, every guard-wrapped engine looked like an unverified snapshot reuse → `offer_input_sufficient=UNKNOWN` → PIPELINE_INCOMPLETE hard block, despite all 15 engines succeeding.

**How to apply:**
- Adding cross-cutting metadata to engine results? Use a new `_<domain>Provenance` key and grep for readers before renaming/moving anything.
- Old snapshots polluted during such a regression self-heal: `safeReuse` wholesale-assigns a fresh `_provenance` stamp on every reuse hit, so no cleanup migration is needed.
- The synthesized *plan*'s `_provenance` is a separate plan-level object written directly by the plan path (and read by the frontend plan view) — distinct from engine-result `_provenance`.

**Watch item:** offer-engine's pain-echo mirror duplicates the integrity layer2 predicate by copy; if integrity l2 changes, the mirror drifts silently — change them in lockstep.
