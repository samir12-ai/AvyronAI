---
name: V2 pipeline production state
description: Production campaign inventory, V2 orchestrator completion state, and known intentional stops as of 2026-07-28
---

## Campaign inventory (as of 2026-07-28)
Only 2 real production campaigns exist in the DB:
1. `campaign_1775158281356_dy5s6r` — account `c523dfd9` — Maxzi burger, Dubai — strong data (147 posts, 104 comments, 10 competitors)
2. `campaign_1783438826741_rhc444` — account `d9338c62` — forma jerseys, Istanbul — weak data (35 posts, 0 comments, 3 competitors)

Synthetic audit accounts (`intel_audit_v1_*`) are test fixtures, not real campaigns.

## V2 orchestrator state (C1, audience-confidence-v2 in effect)
- 13/15 engines complete; strategy_roots row written (ACTIVE, `c07d9d1a`)
- Stops at Iteration Engine because `primaryKpi` + `dataWindowDays` are user-supplied fields — this is designed product behaviour, not a technical blocker
- Funnel INTEGRITY_FAILED (grade red) is pre-existing truthful degradation; pipeline continues

## C2 correct behaviour
- INSUFFICIENT_SIGNALS (35 posts, 0 comments → 0 cluster matches) → SGL BLOCKED
- Correct conservative behaviour; not a v2 regression

**Why:** Needed to distinguish "pipeline stops here" (designed) vs "pipeline is broken" (bug). The Iteration gate and C2 block are both correct/expected.

## Remaining gaps before full 15-engine completion
- Iteration: user must set `primaryKpi` + `dataWindowDays` on the campaign
- C2: needs more scraped data (comments especially) before audience engine can proceed
