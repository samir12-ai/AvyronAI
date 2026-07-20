---
name: Shared-table row classes need every-reader fences
description: Adding a new row class to a shared table breaks unfenced readers; unique partial indexes on open-state rows need explicit expiry closure.
---

## Rule 1 — fence EVERY reader, not just the obvious one

When a new class of rows (distinguished by a discriminator column, e.g. `kind IS NOT NULL`) is added to a shared table, enumerate ALL readers of that table and fence each one — not just the reader you were warned about.

**Why:** Watchtower W-1 added market-event rows (structured JSON-object evidence) to `pipeline_change_events`. The Q2 verdict reader was fenced, but the bridge lane's runId-based contract readers were not — their strict Zod contract (`evidence: z.array(z.string())`) threw `CONTRACT_SHAPE_INVALID` and failed every boss run that produced a candidate. A dashboard severity-count query also silently ingested the new rows. Direct-unit E2E missed it because only the writer was exercised, never the sibling readers.

**How to apply:** before shipping, grep for every query touching the shared table (`from(<table>)` / raw SQL) and decide per-reader: fence with the discriminator, or accept the new rows deliberately. Verify by exercising the *other* readers with the new rows present, not just the new code path.

## Rule 2 — open-state unique partial indexes need expiry closure

A unique partial index scoped to "open" rows (`WHERE validated_at IS NULL`) plus `onConflictDoNothing` makes a stale open row a permanent silencer: once a row ages past the processing window without being closed, every future insert dedupes into nothing, forever.

**Why:** W-1 candidates older than the 30d confirmation window were filtered out of maintenance queries but never deleted — the slot stayed occupied and detection of that kind for that competitor went silent (violates "operational silence is a failure category").

**How to apply:** whatever loop maintains the open rows must load them WITHOUT the time filter and explicitly close (delete-with-log) expired ones, releasing the slot. Test: age a row past the window, confirm closure and that a fresh insert succeeds.

## Rule 3 — two-fetch confirmation compares vs the STORED baseline

In an append-per-fetch snapshot model, confirming a change by re-diffing the newest consecutive pair makes confirmation unreachable (a persisted change diffs clean against itself). Confirmation must re-classify current state against the candidate's ORIGINAL stored baseline snapshot, require the confirming snapshot to differ from the candidate's own, and close (never promote) on reversion or direction flip.
