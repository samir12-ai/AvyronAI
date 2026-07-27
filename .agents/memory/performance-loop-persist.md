---
name: Performance-loop persist semantics
description: Freeze/race rules for weekly cycle verdicts — advisory-lock persist, TRUTH_CHANGED abort, memory-policy floor
---

# Performance-loop persist semantics

**Rule 1 — the report row IS the freeze.** A window's verdicts freeze when its `performance_cycle_reports` row lands (unique per campaign+window). Re-runs return ALREADY_REPORTED. Never add a second freeze mechanism; never update frozen rows (append-only history doctrine).

**Rule 2 — persist must re-validate under a lock.** Any run that reads truth early and persists late must, inside ONE transaction: take `pg_advisory_xact_lock(hashtext(windowId)::bigint)`, re-check the window is still unreported, re-check the active (non-superseded) truth id equals the one the math used, then insert verdicts + report together. If truth changed → abort with TRUTH_CHANGED, persist nothing; the superseding submission's own fire-and-forget trigger reports instead.
**Why:** truth is supersedable and the cycle trigger is fire-and-forget — read-once-persist-late froze stale sales into history until the guard was added (caught by architect review, proven by a `_beforePersist` test-seam scenario).
**How to apply:** any new consumer that snapshots user truth and writes derived history needs the same lock + re-check pattern. LLM calls must run BEFORE the transaction, never inside it.

**Rule 3 — memory-policy floor.** `upsertByFingerprint` (decision policy) blocks `iteration_direction` writes below confidence 0.65. WINNER at 0.85 writes; LOSER at 0.55 is blocked. Record the block verbatim on the source row (`memoryWriteStatus="blocked:…"`) — that is doctrine-compliant honest degradation, NOT a bug. Don't "fix" it by inflating confidence.

**Rule 4 — synthetic experiments on real campaign ids need contamination guards:** delete synthetic strategy_memory rows after proving write-through, and archive the synthetic APPROVED plan (status change) so `evaluateWindowState` can't anchor real truth to it. Labelled verdict/report rows may remain (testLabel column + isTestCycle on the API).

Also: judged interpretation (performance-interpretation engine) rejects generic output on sparse/synthetic context → UNAVAILABLE with deterministic verdicts standing. Same truthful-degradation family as the positioning gate — do not tune the judge to pass.
