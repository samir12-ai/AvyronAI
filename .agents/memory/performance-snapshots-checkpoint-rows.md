---
name: performance_snapshots checkpoint rows vs sync rows
description: Two row shapes share one table — readers must filter by checkpoint or nulls fabricate zeros; dedupe is a DB partial unique index, not app logic.
---

`performance_snapshots` holds two distinct row shapes:
- **sync rows** (`checkpoint='sync'`) — full economics (spend/cpa/roas/ctr).
- **revisit checkpoint rows** (`checkpoint IN ('24h','72h','7d')`) — engagement
  metrics only; economics are **explicit NULL by design** (null = not captured,
  0 = platform said 0 — Beta axiom B1).

**Rule:** any reader that aggregates or "latest-row" joins this table MUST
filter by checkpoint class. A reader that grabs the newest row regardless will
pick a checkpoint row and coalesce its null economics into fabricated zeros.
**Why:** this exact bug was caught as the HIGH architect finding when the
outcome tracker was revived (July 2026) — the fix was `eq(checkpoint,'sync')`
on the economics path.

**Idempotency lives in the DB, not the app:** unique partial index on
`(post_id, checkpoint) WHERE checkpoint IN ('24h','72h','7d')` +
`onConflictDoNothing().returning()`; empty returning = a peer replica already
captured that checkpoint. Don't add app-level "did I already run" state.

**Chain-registry corollary:** every new scheduler must be appended (never
reordered — Prometheus label space) to the continuity chain registry. For
schedulers whose cycle completes every tick even with zero due work, an
in-process last-cycle-completed timestamp is a truthful cadence introspector;
returning null until the first cycle (or while disabled) is the honest
UNKNOWN/DEAD signal, not a defect.
