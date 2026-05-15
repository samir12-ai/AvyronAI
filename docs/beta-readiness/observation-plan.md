# Observation Plan

**Companion to:** [`roadmap.md`](./roadmap.md) Phase 1 hand-off.

## A. Current operator surfaces (inventory)

| # | Surface | What it shows | Gate |
|---|---|---|---|
| 1 | `GET /healthz` | Liveness only. | unauth |
| 2 | `GET /healthz/continuity` (public) | Operational counters + per-chain `state`/`lag` (no tenant fields). | unauth |
| 3 | `GET /healthz/continuity` (admin) | Public surface + `replicaId` + per-tenant decision log. | `X-Admin-Token` |
| 4 | `GET /metrics` | Full Prometheus scrape (continuity + AI + boss + MIv3 + auth families). | `X-Admin-Token` |
| 5 | `GET /api/admin/continuity/panel` | Last tick + window-index gaps + last 10 reanchors + 24h skip-reason histogram. | `X-Admin-Token` |
| 6 | `GET /api/admin/continuity/campaign/:id/last-decision` | Per-campaign skip-reason badge data. | `X-Admin-Token` |
| 7 | In-app **Continuity** panel (`app/audit-control.tsx`) | Surfaces #5 + #6 in the operator UI. | `EXPO_PUBLIC_METRICS_ADMIN_TOKEN` set on client |
| 8 | In-app Audit & Control 5-panel dashboard | Feeds, AI usage, gate status, decisions, publish history, job mgmt. | same |
| 9 | Grafana `avyron-continuity` (16 panels, `.local/dashboards/continuity.json`) | Heartbeat, skip reasons + throughput, multi-replica claim handshake, 10-chain registry. | Grafana SSO + Prom scrape token |
| 10 | Operator handoff one-pager (`.local/docs/operator-handoff-continuity.md`) | Heartbeat-red decision tree, env-var reference, alert thresholds. | doc |
| 11 | Audit log (`audit_log` / `audit_log_archive` tables) | Every `CONTINUITY_*` event, `BOSS_RUN_*` events, security events. | DB query (admin only) |

## B. Gaps + dashboards/panels to add (Phase 1 follow-ups, NOT built here)

| # | Gap | Severity | Proposed surface | Backed by metric |
|---|---|---|---|---|
| G1 | **Retry amplification** — `runsFailed → releaseClaimForRetry → next-tick re-claim` loop is invisible at the campaign level. A campaign retrying every tick for 24h shows up only as `runsFailed > 0` in aggregate. | P2 | New Grafana panel: per-campaign `claims_released_total` vs `claims_completed_total` ratio over 24h. New in-app card: "campaigns in retry loop ≥ 3 ticks". | `continuity_window_claims_released_total{campaign}` (already emitted; needs panel). |
| G2 | **Scraper health** — Bright Data + Apify per-domain success rate, latency distribution, quota burn. Currently only visible via fetch-orchestrator logs. | P2 | New Grafana row: scraper success rate per provider, latency p50/p95, daily quota burn vs cap. | Need new metrics: `scraper_requests_total{provider,domain,outcome}`, `scraper_latency_seconds{provider}`. **Filed as Phase 1 follow-up.** |
| G3 | **Queue depth** — global job queue, per-account job budgets, request-dedup window. Currently visible only in code, not as a metric. | P2 | New Grafana panel: queue depth + per-account in-flight jobs gauge. | Need new metrics: `mi_queue_depth`, `mi_active_jobs_per_account{account}`. **Filed as Phase 1 follow-up.** |
| G4 | **AI spend** — per-account token consumption + estimated USD spend. Today there is per-account rate limit but no spend gauge. | P2 | New Grafana panel: `ai_tokens_consumed_total{account,model}` + USD projection. New in-app card under Audit & Control. | Need new metrics: `ai_tokens_consumed_total{account,model,direction=in/out}`. **Filed as Phase 1 follow-up.** |
| G5 | **Degraded-source surfacing in user-facing UI** — `SynthesizedPlan.degraded` + `PlanSource` + AEL `isPartial` are all backend-canonical but not visible to the user when they read a plan. | P3 | UX-side — see §C. | n/a |
| G6 | **Dead-letter visibility** for `STUCK_*_FAILED` log lines (Seal #15) — they are operator-grep-only today. | P2 | New Grafana panel: count of `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED` / `[Orchestrator] STUCK_JOB_UPDATE_FAILED` / `[MIv3] AUDIT_WRITE_FAILED` log events. Requires log-to-metric bridge (vector / promtail). | Log-derived counter. **Filed as Phase 1 follow-up.** |

## C. UX & trust readiness gaps (Phase 1 follow-ups, NOT built here)

User-facing copy on degraded surfaces is currently engine-true but not user-readable. Specify the following copy improvements (no UI built in this task):

| # | Surface | Today | Beta target |
|---|---|---|---|
| U1 | Plan-detail screen when `synthesisVerification.degraded === true` | Plan renders identically to a clean plan; only operators see the `degraded` flag. | Inline banner at top of plan: "This plan was generated with reduced inputs (X). Confidence is reduced; we recommend re-running once Y is available." Cite the `partialReason` from AEL. |
| U2 | Empty-state for first-time campaign with no plan yet | Generic "no plan yet" string. | "Your first plan will be ready within 1 hour after approval. We'll notify you." Link to expected-cadence explainer. |
| U3 | Confidence indicators on engine outputs | Numeric confidence is in the data but not surfaced. | Render confidence as a 3-state badge (high/medium/weak) tied to the `validationState` enum (D3 contract). |
| U4 | Public system-status page | Does not exist (`/healthz/continuity` is operator-only). | New `/status` page (read-only, no tenant data): scheduler heartbeat color, last 24h boss-run success rate aggregate, last incident timestamp. |
| U5 | "Why did my plan not run this week" answer for end users | Operator-only via Continuity panel. | Render the `PerCampaignDecision.reason` (from the per-campaign last-decision endpoint, gated to the campaign owner) on the campaign card itself with a friendly translation table (Failed → "We hit a temporary issue and will retry automatically", Already evaluated → "You're already up-to-date for this week", No advance → "Waiting on plan approval", etc.). |

## D. Alert routing (must-add before Phase 2)

Pager rules per [`must-monitor-metrics.md`](./must-monitor-metrics.md). Until Phase 2, all P1+ alerts route to the on-call operator's email + Slack #avyron-oncall. Phase 2 adds PagerDuty (or equivalent) for P0/P1.

| Severity | Channel | Acknowledge SLA |
|---|---|---|
| P0 | PagerDuty page | 5 min |
| P1 | PagerDuty page | 15 min |
| P2 | Slack #avyron-oncall (no page) | next business day |
| P3 | Slack #avyron-oncall | weekly review |

## E. What is intentionally NOT in scope for this observation plan

- Building any dashboard or in-app panel — Phase 1 follow-up tasks.
- Net-new metric families (G2/G3/G4/G6 require new metrics; emit them in Phase 1).
- Cross-region observability — single-region beta only.
- Customer-visible billing/usage surfaces — out of scope.
