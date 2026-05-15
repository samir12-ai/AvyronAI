# Risk Register — Beta

**Severity scale:** P0 = blocks beta. P1 = beta-acceptable with active mitigation + monitoring. P2 = monitor + mitigate as needed. P3 = accept + review at GA.

**Status:** OPEN = needs a mitigation before beta. ACTIVE = mitigation in place; monitor. ACCEPTED = explicit accept at beta start; review at GA.

## Runtime risks

| ID | Risk | Sev | Owner | Mitigation | Residual | Status |
|---|---|---|---|---|---|---|
| R-CR1 | Continuity scheduler dies silently | P0-class (origin of Seals #13–#20) | on-call ops | Multi-replica claim handshake + supervisor heartbeat + dead-cycles metric + Continuity panel + Grafana dashboard. INVARIANT-RETRY enforced. | Very low — 7-seal arc closed. | ACTIVE |
| R-CR2 | Hung in-flight lock (boss / continuity tick / MI active jobs) blocks all future work | P0-class | on-call | Three zombie watchdogs (GR6/GR7/GR8) with token-checked cleanup. | Steady-state expectation = 0; alarm on any non-zero `zombieEvictions`. | ACTIVE |
| R-CR3 | Unbounded AI call hangs holding per-account locks | P1 | platform | Hard timeouts (GR9/GR10) + Gemini AbortController wired into SDK fetch (Seal #16 / F2). | Low; timeout fires; lock released. | ACTIVE |
| R-CR4 | Operator-reset during failure interacts unexpectedly with implicit long-gap reanchor | P2 | architect | Surfaced by Task #48 F-F2; tracked under Seal #18 architect MEDIUM "scenario-19 deferred"; production observation via Continuity panel reanchor history. | Medium — single deferred scenario; not reproduced in production. | OPEN (architect diagnosis required before scenario-19 ships) |
| R-CR5 | Multi-replica race writes duplicate boss_runs | P0-class if regressed | platform | DB claim handshake `ON CONFLICT DO NOTHING` (GR12); Seal #14 INVARIANT. | Very low. | ACTIVE |
| R-CR6 | Silent catch hides real outage | P1 | every author | Seal #15 doctrine: no `catch {}`, no bare `.catch(() => {})`. ESLint coverage planned for follow-up. | Low; existing offenders surfaced via grep audit. | ACTIVE |
| R-CR7 | Inconsistent truth submission corrupts eval window | P2 | platform | `acceptUserTruth` validates `qualified ≤ total`, `booked ≤ qualified` in single transaction (Task #48 D-category PASS). | Low. | ACTIVE |
| R-CR8 | Authority hierarchy violation in plan synthesis | P2 | strategy team | CEL programmatic enforcement + cross-engine integrity verdict + `safeToExecute` cross-references; Seal #9 doctrine. | Low. | ACTIVE |
| R-CR9 | Rebellious LLM output bypasses contract | P1 | platform | D1–D5 doctrine + ESLint `semantic/no-semantic-fallback` + `requireContractField` boundary. | Low; doctrine-locked. | ACTIVE |

## Data integrity risks

| ID | Risk | Sev | Owner | Mitigation | Residual | Status |
|---|---|---|---|---|---|---|
| R-LD | Low-data campaigns produce empty/garbage plans | P2 | strategy | Audience Engine "Evidence Integrity Filter" (confidence downgrade not erase) + MIv3 "Tiered Signal Quality Gate" (medium-tier signals usable but tracked) + AEL `isPartial` flag + `SynthesizedPlan.degraded`. | Medium — degraded surface visible to operators; Phase 1 follow-up U1 makes it visible to users. | ACCEPTED at beta start; review weekly. |
| R-MEM | Memory write-path bypass | P1 | strategy | Unified `policyEnforcedMemoryCheck()` doctrine; Seal #19 Audit #5 zero-bypass verified. | Low. | ACTIVE |
| R-PII | PII leak in logs | P1 | platform | `stripSecrets()` regex + key-match (GR16). Existing log pipelines reviewed. | Low; **follow-up task already filed**: "Strip personal info from logs in plan-build and analytics layers". | ACTIVE — folded into existing follow-up. |

## Scaling risks

| ID | Risk | Sev | Owner | Mitigation | Residual | Status |
|---|---|---|---|---|---|---|
| R-QB | Queue buildup under N×N active accounts | P2 | platform | scenario-17 proves 100 campaigns × 4 weekly ticks complete in <60s wall-clock; per-account budget enforcer in code. | Medium — global queue depth not yet metricized; Phase 1 G3 follow-up. | OPEN — observation gap, not behavioral gap. |
| R-CONN | DB connection pool exhaustion under load | P1 | platform | Connection pool sized for current account profile; runtime baseline (Audit #2) sunset = first 7d post-deploy diffed ±10%. | Medium until runtime baseline captured. | OPEN until Phase 1 baseline. |
| R-SCRAPE | Bright Data / Apify quota burn | P2 | ops | Per-domain telemetry; Apify is Bright Data fallback. | Medium — no per-account daily scrape cap yet (GR22 follow-up). | OPEN — guardrail follow-up. |

## Cost risks

| ID | Risk | Sev | Owner | Mitigation | Residual | Status |
|---|---|---|---|---|---|---|
| R-AI-SPEND | Single account AI loop blows monthly budget | P1 | ops | GR1 (50 calls/hr/account/route) bounds throughput. NO USD-spend cap yet (GR21 follow-up). | Medium — rate-limit caps throughput but not USD if a single high-priority route hits the cap continuously. | OPEN — guardrail follow-up. |
| R-RETRY-AMP | Retry-heavy account amplifies AI spend | P2 | ops | INVARIANT-RETRY is the doctrine; mitigation is observation (G1 retry-amplification panel — Phase 1). | Medium until G1 panel shipped. | OPEN — observation follow-up. |
| R-RUNAWAY-SCRAPE | Single account scrape loop blows quota | P2 | ops | GR22 follow-up. Today: per-domain telemetry only. | Medium. | OPEN — guardrail follow-up. |

## Process / org risks

| ID | Risk | Sev | Owner | Mitigation | Residual | Status |
|---|---|---|---|---|---|---|
| R-ONCALL | Single on-call operator; no rotation | P2 | leadership | Operator handoff one-pager (`.local/docs/operator-handoff-continuity.md`) + this beta-readiness package + playbooks ([`playbooks.md`](./playbooks.md)) lower the on-call expertise floor. | Medium — still single-headed for Phase 0–S1. | ACCEPTED for beta start; address before S3. |
| R-COMMS | Beta users uncertain about cadence | P3 | ops | Phase 3 onboarding pack + Phase 1 UX U2 (empty-state cadence copy) + U4 (public status page). | Medium until U2/U4 ship. | OPEN — UX follow-up. |
| R-FEEDBACK | Silence from beta users mistaken for success | P2 | ops | [`rollout-strategy.md`](./rollout-strategy.md) S1 exit gate explicitly requires ≥1 piece of qualitative feedback per account. | Low if exit-gate enforced. | ACTIVE. |

## Doctrine alignment

Every "ACTIVE" mitigation above is enforced by an existing doctrine point in `replit.md` or a Seal #13–#20 archive. Every "OPEN" item is either a Phase 1 follow-up (filed at `mark_task_complete`) or carried into [`unresolved-risks.md`](./unresolved-risks.md) with an explicit sunset condition.
