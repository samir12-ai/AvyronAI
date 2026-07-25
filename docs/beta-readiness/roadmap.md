# Beta-Readiness Roadmap

**Owner:** main agent (Task #50)
**Date:** 2026-05-15
**Status:** DRAFT — pending architect review (verdict appended at end)

This roadmap is the launch-governance reference for the Avyron AI controlled beta. It does NOT add features; it stages the system from "operationally stable post-Seals-#13–#20" through "monitored beta" through "broader rollout", with explicit gates between phases.

Companion docs (read in this order):

1. [`observation-plan.md`](./observation-plan.md) — operator-surface inventory + gaps + alert routing.
2. [`stress-test-plan.md`](./stress-test-plan.md) — 14 stress vectors mapped to Seal #18 lifecycle scenarios.
3. [`rollout-strategy.md`](./rollout-strategy.md) — staged rollout with entry/exit criteria.
4. [`guardrails.md`](./guardrails.md) — runtime guardrails active during beta.
5. [`risk-register.md`](./risk-register.md) — runtime + scaling + cost risks.
6. [`playbooks.md`](./playbooks.md) — operator-response playbooks (≤1 page each).
7. [`must-monitor-metrics.md`](./must-monitor-metrics.md) — canonical metric list with thresholds.
8. [`launch-constraints.md`](./launch-constraints.md) — explicit beta caps.
9. [`unresolved-risks.md`](./unresolved-risks.md) — accepted/deferred risks at beta start.

---

## Current state (entry point)

Verified by Tasks #48 (User Pipeline) and #49 (Competitor Pipeline) — both PASS with 13/14 audit categories green and 1 DOCUMENTED_EXCEPTION (DB not provisioned in dev container; same exception class as Seal #19 / Audit #2; sunset = first 7d post-deploy). Doctrine baseline:

- D1–D5 semantic-contract hardening (`replit.md`).
- Continuity Architecture (Seals #13–#20): hourly scheduler, multi-replica claim handshake, 10-chain registry + supervisor, silent-degradation hardening, operator-visible Continuity panel + 16-panel Grafana dashboard, 18 deterministic lifecycle scenarios, 8-audit gate.
- Operator runbook: [`.local/docs/operator-handoff-continuity.md`](../operator-handoff-continuity.md).
- ESLint suppression count: 11 (4 in H1–H7 archive + 7 documented in Seal #19 allowlist-drift table). **Beta MUST NOT add new suppressions.**

## Phases

### Phase 0 — Beta-readiness package (THIS task)

Produces the 10 governance docs in this directory + the doctrine codification in `replit.md`. **No** runtime feature work. Exit: architect APPROVED + 10 docs mirrored to `docs/beta-readiness/`.

### Phase 1 — Pre-beta hardening (1–2 weeks)

Build the dashboards and UX-clarity items that the package SPECIFIES. Hand-off to follow-up tasks (filed in `mark_task_complete`):

- Build the dashboards listed in [`observation-plan.md`](./observation-plan.md) §B (retry-amplification panel, scraper health panel, queue depth panel, AI spend panel).
- Ship the user-facing copy clarifications listed in [`observation-plan.md`](./observation-plan.md) §C (degraded badges, empty-state copy, confidence indicators, system-status page).
- Capture the post-Seal-#20 production runtime baseline (60-min steady-state sample) — discharges Audit #2 DOCUMENTED_EXCEPTION.

**Entry gate:** Phase 0 complete + architect APPROVED.
**Exit gate:** all four follow-up tasks closed; runtime baseline captured.

### Phase 2 — Internal dogfood (1 week)

Operator + dev team accounts only. Real plans, real scrapes, real AI spend, but no external users.

**Entry gate:** Phase 1 exit + all P1 alerts wired in PagerDuty (or equivalent) per [`must-monitor-metrics.md`](./must-monitor-metrics.md).
**Exit gate:** 7d clean run with `continuity_dead_cycles_total == 0`, `runsFailed` rate < 1% of `runsInvoked`, zero P0/P1 incidents, AI spend within projection (±20%).

### Phase 3 — Closed beta — 5 invited accounts (2 weeks)

Hand-picked accounts with operator-direct support channel. Caps from [`launch-constraints.md`](./launch-constraints.md) enforced.

**Entry gate:** Phase 2 exit + first 7d production baseline diffed vs pre-deploy ±10% memory/CPU/DB-conn.
**Exit gate:** all 5 accounts complete ≥3 weekly cycles each with ZERO operator interventions for any continuity / data-integrity issue. UX-clarity items receive ≥1 piece of qualitative feedback each (positive or negative — silence is treated as a signal failure).

### Phase 4 — Expanded beta — 25 accounts (4 weeks)

Add 20 accounts in batches of 5/week. Per-batch readiness gate: `must-monitor-metrics.md` thresholds at green for the prior batch's first week.

**Entry gate:** Phase 3 exit + at least one batch-rollback dry-run (revoke 1 of the 5 closed-beta accounts via the [`guardrails.md`](./guardrails.md) account-cap kill-switch and verify clean stop — no partial states).
**Exit gate:** 25 accounts × 4 weeks with `continuity_dead_cycles_total == 0` AND no per-account AI rate-limit exceedance > 10% of allotted hourly cap.

### Phase 5 — Open beta (waitlist)

Lift the hand-picked gating; keep account-level caps from [`launch-constraints.md`](./launch-constraints.md). Continue all guardrails.

**Entry gate:** Phase 4 exit + all rollback playbooks in [`playbooks.md`](./playbooks.md) test-fired at least once on staging.
**Exit gate:** GA decision (out of scope for this roadmap).

## Inter-phase rollback triggers

Any of these conditions triggers an automatic phase rollback (drop active accounts back to the prior-phase cap, freeze new admissions, file a P1 retro):

- `continuity_dead_cycles_total > 0` lasting > 24h.
- `supervisor.schedulerState != HEALTHY` for ≥2h on 2+ consecutive supervisor ticks.
- `runsFailed / runsInvoked > 5%` on a 24h rolling window.
- AI spend > 200% of forecasted spend for the active phase's account count.
- Any P0 incident.
- ≥3 P1 incidents in a 7d window.

## Architect review verdict

**APPROVED** (2026-05-15, second pass).

First pass REJECTED on a single link-integrity defect: `docs/beta-readiness/{roadmap,playbooks}.md` referenced `../operator-handoff-continuity.md` but `docs/operator-handoff-continuity.md` did not exist (only `.local/docs/operator-handoff-continuity.md` did). Fix: copied the operator-handoff one-pager into `docs/operator-handoff-continuity.md` so the published surface (`docs/`) is internally complete.

All other findings green on first pass:
- 10 deliverables present in both `.local/docs/beta-readiness/` and `docs/beta-readiness/`; mirror parity verified by `diff -rq`.
- Scope-control respected: only docs + `replit.md` modified. No runtime / engine / metrics changes. No new ESLint suppressions.
- Doctrine alignment strong: explicit references to D1–D5, Seals #13–#20, Seal #15 silent-degradation, Seal #19 8-audit gate.
- Stress-vector coverage map satisfies the requirement with ZERO new lifecycle scenarios; residuals tracked in `risk-register.md` + `unresolved-risks.md`.
- `replit.md` "Beta Safety Doctrine (Task #50)" subsection ties B1–B5 to existing enforcement points.
- Phase 1 follow-ups (GR19–GR23, G2/G3/G4/G6 metrics, UX U1–U5) explicitly tagged "NOT built here" — no silent assumption of shipped work.
