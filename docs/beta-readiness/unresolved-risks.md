# Unresolved Risks — Accepted at Beta Start

Risks that remain ACCEPTED or DEFERRED at beta start. Each entry has a sunset condition and a reviewer. Items here MUST be reviewed at the start of each rollout phase ([`rollout-strategy.md`](./rollout-strategy.md)).

| ID | Risk | Why accepted | Sunset condition | Reviewer | Tracking |
|---|---|---|---|---|---|
| U-RB | Production runtime baseline (memory/CPU/DB-conn) not yet captured | Dev container is not a production proxy; same exception class as Seal #19 / Audit #2. | Capture 60-min steady-state sample within first 7d post-deploy; diff vs pre-deploy ±10%. | engineering lead | Phase 1 follow-up; Audit #2 sunset = first 7d post-deploy. |
| U-F-F2 | Scenario-19 deferred: operator-reset during runBoss failure interacts with implicit long-gap reanchor | Surfaced by Task #48 F-F2; root cause requires architect-level diagnosis of `evaluateWindowState` + `resolveAnchor` + `releaseClaimForRetry` interaction. Not reproduced in production. Adding a flaky test would violate NO-FLAKES doctrine. | Architect diagnosis returns a deterministic repro AND scenario-19 ships passing 100-iteration flake gate. | architect | Seal #18 architect MEDIUM "scenario-19 deferred". |
| U-LD | Low-data campaigns may emit `degraded=true` plans that confuse end users until UX U1 ships | Engine-level mitigation already in place (Audience Engine Evidence Integrity Filter, MIv3 Tiered Signal Quality Gate, AEL `isPartial`); user surfacing pending UX work. | UX U1 ships (degraded-plan banner with `partialReason` cite). | product + engineering | [`observation-plan.md`](./observation-plan.md) §C U1; Phase 1 follow-up. |
| U-G2 | Scraper health metrics not yet emitted (G2) | Per-domain telemetry lives in fetch-orchestrator logs; no Prometheus counter yet. | G2 metrics shipped + Grafana panel live + alert rules wired. | platform | Phase 1 follow-up; [`observation-plan.md`](./observation-plan.md) §B G2. |
| U-G3 | Queue depth not yet metricized (G3) | Per-account budget enforcer in code; no queue-depth gauge. | G3 metrics shipped + GR23 circuit-breaker active. | platform | Phase 1 follow-up. |
| U-G4 | AI spend not yet metricized per account (G4) | Per-account rate limit (GR1) bounds throughput; USD spend not tracked. | G4 metrics shipped + GR21 daily spend cap enforceable. | platform | Phase 1 follow-up. |
| U-G6 | `STUCK_*_FAILED` log lines not yet bridged to metrics (G6) | Operator-grep-only today; absence at steady-state is healthy, but a sustained spike has no automated alert. | Log-to-metric bridge live (vector / promtail) + alert rules. | platform | Phase 1 follow-up. |
| U-PII | Personal-info redaction in plan-build + analytics layers not yet covered | Existing `stripSecrets()` covers transport-layer logs but plan-build and analytics may emit account-bearing context strings. | Existing follow-up task "Strip personal info from logs in plan-build and analytics layers" closes. | platform | Existing follow-up — referenced in `replit.md` task queue. |
| U-ALLOWLIST | ESLint suppression allowlist drift: documented 4 vs actual 11 | All 7 extra suppressions are pre-Seal-#13 origin and D1-safe per Seal #19/#20 review. Documentation-only drift. | Existing follow-up task "Make plan-status checks use the new canonical labels (cleanup)" + allowlist sync work folds in. | architect | Seal #20 doctrine-lock follow-up. |
| U-RR | Refactor 2 leftover ownership checks to use shared helper | Existing follow-up; not blocking beta. | Existing follow-up task closes. | platform | Existing follow-up task. |
| U-PRI | Show operators which competitors are on priority refresh tier | Existing follow-up; observability nice-to-have, not blocking beta. | Existing follow-up task closes. | ops | Existing follow-up task. |
| U-MAUTH | Mobile client lacks `/api/auth/refresh` wiring | JWT access token TTL stays at 14d (legacy grace) until mobile wiring lands. | Mobile client implements refresh; access TTL drops to 60m. | mobile + platform | Captured in `replit.md` "User Authentication" section. |
| U-ONCALL-ROT | Single on-call operator; no rotation | Operator handoff one-pager + this beta-readiness package + playbooks lower the on-call expertise floor. | Second on-call operator trained AND can independently resolve a P5 (runaway retries) playbook on staging. | leadership | [`risk-register.md`](./risk-register.md) R-ONCALL. |

## Review cadence

- Each phase entry gate (S0 → S3): re-read this list. Any sunset condition met → strike the row + close the follow-up.
- Any P1 incident: re-evaluate every "ACCEPTED" entry's continued acceptability.
- Architect review on all rollback-trigger fires + on every new "ACCEPTED" addition.
