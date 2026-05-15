# Rollout Strategy

**Companion to:** [`roadmap.md`](./roadmap.md) phases.

## Stage table

| Stage | Account count | Duration | Entry gate | Exit gate | Rollback trigger |
|---|---|---|---|---|---|
| **S0 — internal dogfood** | 3–5 (operator + dev team) | 7d | Phase 1 follow-ups closed (dashboards, UX clarifications, runtime baseline). All P1 alert rules wired. | 7d clean: `dead_cycles=0`, `runsFailed/runsInvoked < 1%`, AI spend ≤ projection ±20%. | Any P0; ≥1 P1 not resolved within 24h. |
| **S1 — closed beta** | 5 invited | 14d | S0 exit + first 7d production runtime baseline diffed vs pre-deploy ±10% (memory/CPU/DB-conn). | All 5 accounts complete ≥3 weekly cycles each with **zero** operator interventions for continuity / data-integrity issues. ≥1 piece of qualitative UX feedback per account. | Any P0; ≥2 P1 in 7d; any account triggers account-cap kill-switch. |
| **S2a — expanded beta batch 1** | +5 (total 10) | 7d | S1 exit + ≥1 batch-rollback dry-run on staging. | 7d at green per [`must-monitor-metrics.md`](./must-monitor-metrics.md). | Standard rollback triggers. |
| **S2b** | +5 (total 15) | 7d | S2a exit. | 7d green. | Standard. |
| **S2c** | +5 (total 20) | 7d | S2b exit. | 7d green. | Standard. |
| **S2d** | +5 (total 25) | 7d | S2c exit. | 7d green AND no per-account AI rate-limit exceedance > 10% of allotted hourly cap. | Standard. |
| **S3 — open beta (waitlist)** | 25 → uncapped (account-level caps still enforced) | open | S2d exit + all playbooks in [`playbooks.md`](./playbooks.md) test-fired on staging. | GA decision (out of scope). | Standard + invitation freeze if waitlist throughput exceeds projection by 50%. |

## Per-stage admission process

1. **Vet** — operator confirms account meets [`launch-constraints.md`](./launch-constraints.md) cap profile.
2. **Provision** — assign `tier=beta` flag (subject to `BETA_ACCOUNT_CAP` global guardrail).
3. **Notify** — send the beta-onboarding pack (cadence expectations, support channel, known limitations from [`unresolved-risks.md`](./unresolved-risks.md)).
4. **Monitor** — operator dashboards the new account's first 3 weekly cycles individually.

## Rollback playbook (cross-stage)

Triggered by any rollback condition in [`roadmap.md`](./roadmap.md) §"Inter-phase rollback triggers". Sequence:

1. Flip `BETA_ADMISSIONS_FROZEN=true` (no new accounts admitted).
2. For the offending account class, set `BETA_ACCOUNT_CAP` to the prior-stage limit.
3. If continuity-related: do NOT stop the scheduler — INVARIANT-RETRY relies on it. Instead set `CONTINUITY_SCHEDULER_DISABLED=true` ONLY if directed by [`playbooks.md`](./playbooks.md) "scheduler dead" branch.
4. Open a P1 retro within 24h of trigger. Architect review required to lift the freeze.

## Comms cadence

| Stage | Internal | External |
|---|---|---|
| S0 | Daily standup; weekly retro. | None. |
| S1 | Daily standup; weekly retro; ad-hoc operator → user direct. | Per-account weekly check-in (operator-initiated). |
| S2a–S2d | Daily standup; weekly retro; new-batch admission review. | Per-account bi-weekly check-in. |
| S3 | Weekly retro; monthly architect review. | Monthly all-beta-users newsletter; in-app status banner for incidents. |

## Decision authority

| Decision | Owner |
|---|---|
| Stage entry/exit | Engineering lead |
| Rollback trigger fired | On-call operator (immediate); engineering lead confirms within 4h |
| New beta account admission outside the per-stage cap | Engineering lead |
| Lifting an admissions freeze | Architect review APPROVED |
| GA decision (post-S3) | Out of scope for this strategy |
