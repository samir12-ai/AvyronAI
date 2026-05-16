# Operations Guardian — Audit & Architecture Proposal

**Status:** DRAFT — design only. Do not implement until approved.
**Author:** Agent (May 15, 2026)
**Trigger:** User feedback after Task #52 / Operations panel landed — raw infrastructure detail is fine internally but must NOT leak to user-facing surfaces. The Operations panel needs a Guardian layer above it that interprets, suppresses, recovers, and translates.

---

## 1. Founding question

**"Do we already have something that owns this responsibility?"**

Answer: **the brain, heart, and voice all exist. The connective tissue and translation layer do not.**

| Capability we want | Where it lives today | State |
|---|---|---|
| Liveness/lag classification (HEALTHY/DEGRADED/DEAD) | `server/continuity/supervisor.ts` | EXISTS — limited to chain liveness |
| Severity classification + execution mode (PASS/BLOCK/REPAIR/DOWNGRADE) | `server/system-control/engine.ts` | EXISTS — per-run, per-campaign |
| Auto-recovery actions | `server/system-control/repair-actions.ts` | EXISTS — in-place mutations |
| Human-readable diagnosis + repair patterns | `server/system-control/recovery-planner.ts` + `recovery-map.ts` | EXISTS |
| Per-account state machine (consecutive failures, drift) | `server/account-lifecycle.ts` (`account_state` table) | PARTIAL |
| Worker-level reliability (zombie watchdogs, retries) | `boss/concurrency.ts`, `continuity/scheduler.ts`, `fetch-orchestrator.ts`, `publish-worker.ts`, `snapshot-cleanup-worker.ts` | EXISTS — reports up |
| **Unified notice table** ("what is the system currently worried about?") | — | **MISSING** |
| **User-facing copy translation** (internal codes → "We're waiting for updated channel data…") | — | **MISSING** |
| **Non-blocking toast/banner UI primitive** | — | **MISSING** (only `Alert.alert()` and per-component banners) |
| **Periodic Guardian tick** (correlation, suppression, deduplication) | — | **MISSING** |
| External escalation (Slack/PagerDuty) | — | MISSING (Sentry only) |
| Push notifications | — | MISSING (no `expo-notifications`) |

**Recommendation:** **Do NOT build a new "Guardian Agent" from scratch.** Extend the supervisor with a thin Interpreter layer that consumes the existing signals and writes to a new `system_notices` table. That table becomes the single source of truth for "what should the operator/user see right now?" — and three audiences read it differently.

---

## 2. Three-tier audience model

The user explicitly distinguished three audiences. The architecture must enforce this separation in **schema** (not just convention), so a downstream UI bug can't accidentally leak `continuity_window_claims` to a customer.

```
┌─────────────────────────────────────────────────────────────────┐
│  TIER 1 — INTERNAL (raw truth, operator-only, admin-token gated)│
│  • Operations panel I just shipped (audit-control screen)       │
│  • /metrics, /healthz/continuity, /api/admin/operations/panel   │
│  • Sentry, server logs, Grafana                                  │
│  Audience: us (engineers/operators).                             │
│  Vocabulary allowed: stuck claims, watchdog zombies, retry      │
│  loops, queue depth, etc.                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Guardian tick reads + interprets
┌─────────────────────────────────────────────────────────────────┐
│  TIER 2 — OPERATOR NOTICE (interpreted, actionable)             │
│  • New "Operator notices" tab in audit-control screen            │
│  • Optional: webhook to Slack (deferred)                         │
│  Audience: us, but already-classified (severity + suggested     │
│  action + correlation key + suppression window).                 │
│  Vocabulary: "Continuity scheduler missed 3 consecutive ticks   │
│  on chain X — supervisor classified DEAD at 14:02. Last         │
│  successful run: 8h ago."                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ Only when there is real user impact
┌─────────────────────────────────────────────────────────────────┐
│  TIER 3 — USER NOTICE (impact-language only)                    │
│  • New <ImpactBanner> on dashboard                               │
│  • New <PlanConfidenceFootnote> on plan view                     │
│  • Optional: future toast/snackbar primitive                     │
│  Audience: customers.                                             │
│  Vocabulary: impact + reassurance + ETA when known. NEVER       │
│  internal terms. NEVER stack traces. NEVER "stuck claim".       │
└─────────────────────────────────────────────────────────────────┘
```

**Hard rule:** a notice's `audience` field is a strict enum, set at WRITE time by the Guardian Interpreter. The user-facing renderer queries `WHERE audience = 'user'`. Internal codes (e.g. `STUCK_CLAIM`, `WATCHDOG_ZOMBIE`) are never present in user-audience rows because the Interpreter only emits `audience='user'` notices through a copy-key path that requires a translation entry.

---

## 3. What's already detectable today (no new instrumentation needed)

The Guardian Interpreter can produce useful notices on day 1 by reading from already-emitted signals:

| Signal source | Where to read | Maps to Guardian category |
|---|---|---|
| `continuity_window_claims` rows in_progress > 2h | DB query (already in Operations panel) | `WORKER_STUCK` |
| `continuity_ticks` notes with ≥3 `failed` per campaign in 24h | DB query (already in Operations panel) | `RETRY_LOOP` |
| `_bossInFlightStats().zombieEvictions > 0` | In-memory stat (Operations panel) | `LEAKED_LOCK` |
| `_continuityTickInflightStats().zombieEvictions > 0` | In-memory stat | `LEAKED_LOCK` |
| `_activeJobsStats().zombieEvictions > 0` | In-memory stat | `LEAKED_LOCK` |
| `chain_registry_state.lastState = 'DEAD' OR 'DEGRADED'` | DB (supervisor writes this) | `CHAIN_DEGRADED` / `CHAIN_DEAD` |
| `system_control_verdicts` with `verdict='BLOCK'` in last 24h, per campaign | DB | `INTEGRITY_BLOCKED` |
| `orchestrator_jobs.fallback = true` rate | DB | `PLAN_DEGRADED` |
| `pipeline_rejections` aggregated by `boundary` + `reasonCode` | DB | `PIPELINE_REJECTED` |
| `mi_telemetry.downgradeReason` not null | DB | `MARKET_DATA_DEGRADED` |
| `account_state.consecutiveFailures > N` | DB | `ACCOUNT_DEGRADED` |
| MIv3 scraper success/fail per platform (already in MI snapshots) | DB | `SCRAPER_PROVIDER_DEGRADED` |
| AI per-account 429 from rate limiter | log scrape OR new counter | `AI_QUOTA_PRESSURE` |

Notably, every entry above is **already written by an existing system**. The Guardian doesn't fabricate anything — it reads, interprets, correlates, and decides whether to surface.

---

## 4. New schema (one table, no exceptions)

```ts
// shared/schema.ts — new
export const systemNotices = pgTable("system_notices", {
  id: varchar("id").primaryKey().$defaultFn(() => randomUUID()),

  // What kind of thing is this?
  category: varchar("category").notNull(),
  // strict enum, e.g. WORKER_STUCK | RETRY_LOOP | CHAIN_DEAD | PLAN_DEGRADED
  // | MARKET_DATA_DEGRADED | SCRAPER_PROVIDER_DEGRADED | AI_QUOTA_PRESSURE
  // | INTEGRITY_BLOCKED | LEAKED_LOCK | ACCOUNT_DEGRADED

  severity: varchar("severity").notNull(),
  // strict enum: info | warning | degraded | critical
  // (matches existing audit_log.riskLevel taxonomy where possible)

  audience: varchar("audience").notNull(),
  // strict enum: internal | operator | user
  // SET ONCE AT WRITE TIME — never mutated, never recomputed at read.

  // Stable correlation key — multiple raw signals collapse into one notice.
  // Guardian dedupes by (correlationKey, audience) within a suppression window.
  correlationKey: varchar("correlation_key").notNull(),
  // e.g. "RETRY_LOOP:campaign=abc123" or "CHAIN_DEAD:lead-engine"

  // Tenant scope — null means system-wide notice.
  accountId: varchar("account_id"),
  campaignId: varchar("campaign_id"),

  // Copy resolution. NEVER store rendered text — store a key + variables
  // so we can re-render in any locale without a backfill.
  copyKey: varchar("copy_key").notNull(),
  copyVars: jsonb("copy_vars").$type<Record<string, string | number>>(),

  // Internal context (may include vocabulary forbidden in user audience).
  // Guardian emits this for operator/internal audiences ONLY.
  detail: jsonb("detail"),

  // Lifecycle
  firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  suppressedUntil: timestamp("suppressed_until"),

  // Auto-recovery attempted? Did it succeed?
  recoveryAttempted: boolean("recovery_attempted").notNull().default(false),
  recoveryOutcome: varchar("recovery_outcome"),
  // strict enum: not_attempted | success | failed | not_applicable
}, (t) => ({
  byAudience: index("system_notices_audience_idx").on(t.audience, t.resolvedAt),
  byCorrelation: uniqueIndex("system_notices_correlation_unique")
    .on(t.correlationKey, t.audience)
    .where(sql`resolved_at IS NULL`),
  // Partial unique index → at most ONE open notice per (correlationKey,
  // audience). Re-emitting bumps lastSeenAt + copyVars; never inserts a dup.
}));
```

**Design rationale:**
- `audience` set at write, never recomputed → no leak risk.
- `correlationKey + audience` is uniquely indexed when `resolved_at IS NULL` → suppression is enforced by Postgres, not application code.
- `copyKey + copyVars` (not pre-rendered text) → translation/locale flexibility + safe re-render.
- `recoveryAttempted/recoveryOutcome` lets the UI say "we already tried — and it worked" for graceful messaging.
- `detail` is the escape hatch for operator/internal audiences. `audience='user'` rows MUST have `detail = NULL` (enforced in writer + reviewable in tests).

---

## 5. Guardian Interpreter — what it does

A new module: `server/operations-guardian/interpreter.ts`. **No new worker process.** It runs as a step inside the existing Continuity Supervisor tick (every 5 min) — so we get for free: graceful shutdown handle, multi-replica safety (supervisor already coordinates), audit-log integration, and zero new boot-order risk.

Per tick:

```
1. Collect raw signals (parallel):
   - in-flight stats × 3
   - stuck claims query
   - retry loop query
   - chain_registry_state
   - recent BLOCK verdicts (24h window)
   - orchestrator fallback rate
   - mi_telemetry downgrade rate
   - pipeline_rejection rates
   - account_state.consecutiveFailures bucketing

2. For each signal, run a CLASSIFIER (pure function):
   - Severity: info | warning | degraded | critical
   - Transient vs persistent: needs ≥N consecutive observations to escalate
   - Correlation key: stable per (category, scope)

3. For each emitted classification, decide audience (pure function):
   - Default: internal
   - Promote to operator if: severity ≥ warning AND persistent (≥2 observations)
   - Promote to user ONLY if:
     * the category has a registered user-copy entry, AND
     * the impact is observable to a customer (e.g. plan generation
       degraded, market signals delayed by ≥X hours, last successful
       publish older than threshold)

4. Attempt safe auto-recovery (where allowed):
   - LEAKED_LOCK with size ≤ N stale entries → existing watchdogs
     handle; record recoveryOutcome = success
   - WORKER_STUCK with age ≤ 4h AND known-safe pattern → DELETE the
     row (multi-replica safe via existing claim handshake); record
     outcome
   - RETRY_LOOP with same failure category 3+ times → DOWNGRADE the
     plan via System Control's existing REPAIR action; record outcome

5. UPSERT system_notices:
   INSERT ... ON CONFLICT (correlationKey, audience) WHERE resolved_at IS NULL
   DO UPDATE SET lastSeenAt = NOW(), copyVars = EXCLUDED.copyVars,
                 recoveryAttempted = ...

6. CLOSE notices whose underlying signal is gone:
   - For each open notice, re-check the source. If signal is absent for
     2 consecutive ticks (10 min), set resolvedAt = NOW().

7. Emit Prometheus + audit_log line:
   - guardian_tick_total, guardian_notices_open{audience,severity},
     guardian_recovery_outcome_total{outcome}
```

**Doctrine compliance baked in:**
- D1–D5: every classifier returns a typed verdict (no `?? 'unknown'`); audience/severity/category are strict enums; ESLint allowlist unchanged.
- Seal #15: every catch logs via `console.error("[OperationsGuardian] STEP_FAILED ...")`. No silent paths.
- Continuity invariants: runs inside the existing supervisor tick, so MULTI-REPLICA-SAFE is inherited.

---

## 6. Operator + user-facing UI

### Operator surface (additive — does not touch existing panels)

New `<OperatorNoticesPanel>` in `app/audit-control.tsx`, between the existing Continuity panel and the raw Operations panel:

```
[ Continuity panel — existing ]
[ Operator notices — NEW ]      ← interpreted, severity-sorted, dismissible
[ Operations panel — existing ] ← raw truth, unchanged
```

The raw Operations panel I just shipped **stays exactly as it is** — it's the "internal truth" surface the user explicitly said to keep. The new layer is *above* it, not a replacement.

### User surface (the careful part)

Two minimal additions:

1. `<ImpactBanner>` on the dashboard — renders when there is at least one open `audience='user'` notice for the current `accountId` (or `campaignId` if scoped). Auto-dismisses when notice resolves. Copy comes from a translation registry (next item).
2. `<PlanConfidenceFootnote>` under the plan view — renders when an `audience='user'` notice with category `PLAN_DEGRADED | MARKET_DATA_DEGRADED | INTEGRITY_BLOCKED` is open and scoped to this campaign.

**No toast/snackbar primitive in v1.** Banner-only is safer (no transient-disappearance bug, no missed alert). Toast can come later if we need it.

### Copy registry (the firewall)

`server/operations-guardian/user-copy.ts`:

```ts
// EXHAUSTIVE map: every category that may ever reach audience='user'
// MUST have an entry here. Categories without an entry CANNOT be
// promoted to user audience (enforced in classifier).
export const USER_COPY: Record<UserVisibleCategory, UserCopyTemplate> = {
  MARKET_DATA_DEGRADED: {
    title: "Market signals are delayed",
    body: "We're refreshing your competitor data. Recommendations will update automatically once it completes.",
    severity: "info",
  },
  PLAN_DEGRADED: {
    title: "Plan confidence is reduced",
    body: "Some source data was incomplete. We've generated a working plan and will refine it once the missing inputs arrive.",
    severity: "warning",
  },
  SCRAPER_PROVIDER_DEGRADED: {
    title: "Competitor refresh is temporarily degraded",
    body: "{{platform}} is responding slowly. Other sources are unaffected.",
    severity: "info",
  },
  AI_QUOTA_PRESSURE: {
    title: "Some content generation is paused",
    body: "You're approaching this hour's generation limit. New requests will resume in {{minutes}} minutes.",
    severity: "warning",
  },
  // ... only categories that appear in this map can be user-audience.
};
```

This is the **firewall**. The Guardian classifier looks up `USER_COPY[category]` before it can write `audience='user'`. If the lookup misses, audience stays at `operator`. New user-visible categories require explicit copy review before they can leak.

### 6.1 Copy doctrine (operator-approved, May 16 2026)

Every entry added to `USER_COPY` MUST satisfy all seven rules below. The PR reviewer checks line-by-line; failing any rule blocks the PR. The canonical machine-checkable copy of these rules lives as a comment block above `USER_COPY` in `server/operations-guardian/types.ts` — keep both in sync.

1. **Calm reassurance, not incident language.** Reads like a confident operational update, not an outage page or status-incident report.
2. **Never make the system sound unstable or broken.** Customer's mental model after reading must be "the system is mature and pacing itself", not "the system is having problems".
3. **No technical or runtime terminology.** No infrastructure words. No third-party provider names unless explicitly approved per-category. No internal taxonomy leak.
4. **Frame as impact on recommendations / confidence — not as infrastructure behavior.**
   - GOOD: *"We're waiting for updated market signals before generating a high-confidence recommendation."*
   - BAD: *"Instagram scraping is degraded and retrying."*
5. **Preferred phrasing:** *temporary pacing, refresh delay, waiting for updated signals, reduced confidence, refining, automatically resume/refresh.*
6. **Forbidden words** (case-insensitive) in any `defaultTitle` / `defaultBody`: `failure, failed, crashed, broken, blocked, stuck, degraded, retry loop, provider issue, infrastructure issue, outage, incident, error, exception, timeout, queue, worker, scraper, pipeline`. (These remain fully allowed in operator/internal copy paths.)
7. **Tone targets.** Aim for: *calm, professional, transparent, confidence-preserving, operationally mature.* Avoid: *alarming, defensive, overly technical, incident-report style, apologetic, hedging.*

The §8 step #8 unlock checklist for any category requires a same-PR test asserting **every word in rule 6 is absent** from every `defaultTitle` and `defaultBody` for the unlocked category — a regex test, not a manual review (manual review is rule 1–5/7, the regex covers rule 6 mechanically).

---

## 7. What stays internal-only (forever)

These categories MUST NEVER appear with `audience='user'` — they have no copy entry, and a code-review check should assert that. They live forever in the Operations panel and the Operator Notices panel only:

- `LEAKED_LOCK` (zombie watchdog evictions)
- `WORKER_STUCK` (raw stuck-claim rows)
- `RETRY_LOOP` (internal retry counter)
- `CHAIN_DEAD` / `CHAIN_DEGRADED` (raw supervisor state)
- `PIPELINE_REJECTED` (raw rejection codes)
- Any new technical category added in the future, until it gets a copy entry

User-visible categories MUST be impact-shaped:
- `MARKET_DATA_DEGRADED` (interpretation of multiple raw signals: scraper degraded + chain degraded + retry loop on MI engine)
- `PLAN_DEGRADED` (interpretation of: orchestrator fallback OR system_control DOWNGRADE OR AEL isPartial)
- `SCRAPER_PROVIDER_DEGRADED` (one specific platform — only when ≥2 hours of failure)
- `AI_QUOTA_PRESSURE` (only when user is genuinely throttled)

---

## 8. Recommended implementation plan (after approval)

Ordered, each step independently shippable:

| # | Step | Effort | Risk | Depends on |
|---|---|---|---|---|
| 1 | Add `system_notices` table + migration | XS | low — additive | — |
| 2 | Add `server/operations-guardian/types.ts` (enums, USER_COPY firewall, classifier interfaces) | XS | low | 1 |
| 3 | Add `server/operations-guardian/interpreter.ts` — collectors + classifier + UPSERT (READ-ONLY first: no recovery actions, no user audience) | M | low — observe only | 2 |
| 4 | Wire interpreter into Continuity Supervisor tick | XS | low — supervisor already exists | 3 |
| 5 | Add admin endpoint `GET /api/admin/operator-notices` (operator audience only) | XS | low | 1 |
| 6 | Add `<OperatorNoticesPanel>` to audit-control screen | S | low — new panel, no edits to existing | 5 |
| 7 | **GATE:** observe operator notices in production for ≥3 days. Tune classifier thresholds. NOTHING user-visible yet. | — | — | 6 |
| 8 | Enable user-audience promotion (add USER_COPY entries one at a time) | S | medium — copy review per category | 7 |
| 9 | Add `<ImpactBanner>` on dashboard | S | low | 8 |
| 10 | Add `<PlanConfidenceFootnote>` on plan view | XS | low | 8 |
| 11 | Enable safe auto-recovery (one category at a time, with audit) | M | medium — DB writes | 7 |
| 12 | Optional: Slack webhook for `severity=critical` | S | low | 6 |
| 13 | Optional: toast/snackbar primitive for non-banner notices | S | low | 9 |

**Critical gate at step #7.** Nothing user-facing ships until we've watched the classifier for several days and confirmed it's not noisy. The user explicitly said "suppress noisy non-actionable alerts" — that means we tune in production with real signal density before exposing anything.

---

## 9. Open questions for the user before we start

1. **Subagent or extension?** I recommend **extension of the Continuity Supervisor** (cheaper, no new worker process, inherits multi-replica safety, no boot-order risk). Subagent-style isolation can come later if the interpreter grows. **OK?**

2. **Auto-recovery scope.** Three candidate auto-recovery actions are listed in §5 step 4. Each one writes to the DB. Do you want to:
   - (a) ship interpreter without auto-recovery first (recommended), then add per-category after observation, or
   - (b) ship all three from day 1?

3. **Slack/PagerDuty.** Do we have a webhook URL today, or is that future work? If you want me to wire it in, I need a secret name + URL pattern.

4. **Internationalization.** The copy registry is keyed for translation, but right now the app has `i18n-js` configured per replit.md. Do you want user copy in English-only for v1 or wired through i18n from the start?

5. **`replit.md` size warning.** The system flagged it as large. The §13–§19 seal section is the bulk; it could be trimmed (each seal is already archived in `.local/docs/seals/`). Want me to do that as a separate housekeeping pass after Guardian lands?

---

## 10. What I will NOT do without explicit approval

- Touch any user-facing screen (dashboard, plan view, narrative card)
- Add any new schema table other than `system_notices`
- Add any external escalation (Slack, PagerDuty, email, push)
- Modify the existing Operations panel I shipped (it stays as raw internal truth)
- Modify the existing System Control engine, Continuity Supervisor logic, or any worker — only ADD an interpreter step that READS from them
- Add any new ESLint suppressions

---

**Recommended first action after approval:** Steps 1–7 only (observe-only mode, operator-audience only, NO user surface yet, NO auto-recovery). Ship behind admin-token gate. Watch for 3 days. Then come back for steps 8+ with real signal data in hand.
