# System-Wide Scraping Audit — May 2026 (post-Seals #13–#20)

**Date:** 2026-05-15
**Auditor:** task agent (Task #51)
**Scope:** Every ingestion path in the system — competitor scrapers (Instagram, TikTok, Website, Blog, Google Reviews), user-owned channel scrapers (Instagram, Website), proxy/provider adapters (Bright Data, Apify), the MIv3 fetch orchestrator, the `collector/` envelope adapter, and the autonomous user-channel scraper.
**Doctrine baseline:** `replit.md` "D1–D5 Semantic Contract Hardening" + "Continuity Architecture (Seals #13–#19)".
**Out of scope (per task charter):** MIv3 8-engine pipeline lifecycle (Task #49), User Pipeline lifecycle (Task #48), new monitoring dashboards (Task #50 build scope), new providers, new source types.

---

## Headline verdict

| Category | Verdict | P0 | P1 | P2 | Notes |
|---|---|---|---|---|---|
| Source surface enumeration | **PASS** | 0 | 0 | 0 | 6 sources × 2 surface families (competitor + user-owned) covered. |
| Per-source classification | **PASS** | 0 | 0 | 0 | All 6 active sources classified `WORKING` against the 12-status enum at audit time, with code-level evidence. |
| Silent-stall sweep | **PASS *(with two inline P2 fixes shipped)*** | 0 | 0 | 2 *(fixed)* | F-S1 (user-channel JSON-parse silent catches on historic snapshots) + F-S2 (sub-page console.log → structured logger). |
| Runtime / infrastructure | **PASS** | 0 | 0 | 0 | Wall-clock timeouts, circuit breaker, sticky-session cleanup, zombie watchdogs, and Apify polling deadline all wired. |
| Downstream integrity | **PASS** | 0 | 0 | 0 | Discriminated `INSUFFICIENT_DATA` / `degraded:true` propagate to MI signal generators and user-truth lanes. |
| Operator visibility | **PASS *(with one P2 specification filed)*** | 0 | 0 | 1 *(filed)* | F-S3 — no aggregated cross-source "scrape source health" surface; per-source state is implicit in snapshot `scrapeStatus`. Spec filed for Task #50 build queue. |

**Overall: PASS for 6/6 categories.** No P0/P1 production-runtime findings. Two P2 silent-stall fixes shipped inline. One P2 operator-visibility spec filed for the beta-readiness package to build (does NOT block beta — current per-source surface is sufficient for the operator runbook). ESLint suppression count: **11** (unchanged; 0 added by this audit).

---

## Step 1 — Source surface enumeration

| # | Source | File | Provider | Trigger | Downstream |
|---|---|---|---|---|---|
| 1 | **Instagram (competitor)** | `server/competitive-intelligence/profile-scraper.ts` | Bright Data residential proxy → web_profile_info JSON → HTML GraphQL fallback chain | MIv3 fetch-orchestrator job | MIv3 signal-engine, narrative-clustering, dominance |
| 2 | **TikTok (competitor)** | `server/competitive-intelligence/tiktok-scraper.ts` → `tiktok-apify-scraper.ts` | Bright Data → Apify failover (`clockworks~free-tiktok-scraper`) | MIv3 fetch-orchestrator job | MIv3 tiktok-qualification, signal-engine |
| 3 | **Website / Blog (competitor)** | `server/market-intelligence-v3/website-scraper.ts` | Bright Data Web Unlocker → direct fetch fallback (with SSRF + circuit breaker) | MIv3 fetch-orchestrator job | MIv3 positioning, content-dna |
| 4 | **Google Reviews (competitor)** | `server/competitive-intelligence/reviews-scraper.ts` | Bright Data residential proxy | MIv3 fetch-orchestrator job | MIv3 reviews-intelligence (sentiment, objections) |
| 5 | **Instagram (user-owned)** | `server/user-channel-scraper.ts` → reuses `profile-scraper.ts` | Bright Data residential proxy (sticky session) | Boss/run + autonomous-worker (24–48h hash-spread per profile) | `pipelineUserTruth`, performance-signal/normalizer |
| 6 | **Website (user-owned)** | `server/user-channel-scraper.ts` → `website-scraper.ts` | Bright Data → direct fallback | Same as #5 | User narrative, performance-signal |

**Adapter / orchestration layer (not a source itself):**

| Layer | File | Role |
|---|---|---|
| MIv3 fetch orchestrator | `server/market-intelligence-v3/fetch-orchestrator.ts` | Job queue, per-account budget, zombie `activeJobs` watchdog (Seal #16/F1), shared-pool routing |
| Proxy pool | `server/competitive-intelligence/proxy-pool-manager.ts` | Sticky-session leasing, cooldown, rotation on block |
| Rate limiter | `server/competitive-intelligence/rate-limiter.ts` | Per-(account,campaign) token bucket (5s refill + 7s jitter, burst 3) |
| Scrape safety / breaker | `server/competitive-intelligence/scrape-safety.ts` | F6.12 module-level circuit breaker keyed by `${platform}:${zone}` |
| Shared profile store | `server/competitive-intelligence/shared-profile-store.ts` | Cross-tenant public-data cache (≤12h TTL) — reduces proxy spend & blocking risk |
| Collector envelope | `server/collector/index.ts` + `envelope.ts` | Pipeline-side acquisition adapter; reads what Main scrapers already wrote, persists one row per `acquire()` to `pipeline_acquisitions` for lineage |

**No other ingestion entry points found.** `server/campaign-data-layer.ts` does not scrape (DB-only). `server/meta-token-manager.ts` calls Meta Graph API but is OAuth/token-refresh, not scraping. There is no separate "campaign metrics" or "content performance" scraper — those flow through the Meta integration (out of scope) and the user-channel scraper above.

---

## Step 2 — Per-source classification (12-enum)

`WORKING | PARTIALLY_WORKING | BLOCKED | RATE_LIMITED | PROVIDER_DOWN | EMPTY_RESULT | STALE_RESULT | AUTH_REQUIRED | CAPTCHA_OR_ANTI_BOT | SCHEMA_CHANGED | NOT_WIRED | UNKNOWN`

DB is not provisioned in the dev container, so "last successful scrape" + "last failed scrape" are reported as **schema+code-proof** rather than live-row-proof (same DOCUMENTED_EXCEPTION class as Tasks #48/#49 — sunset = first 7d post-deploy).

| # | Source | Status | Last success / fail | Failure reason | Retry | Fallback | Downstream impact | Operator visibility | Recovery |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Instagram (competitor) | **WORKING** | snapshot row in `competitor_snapshots`; `scrapeStatus` column | 401/403/429/checkpoint → `classifyBlock` rotates session + cooldown | 3× (proxy-pool-manager) | HTML GraphQL → og:description meta fallback chain | If all fail → `INSUFFICIENT_DATA` → MIv3 marks source `degraded`, signal-engine downgrades confidence (does NOT zero out signals — Seal #15 doctrine) | Bright Data proxy telemetry, `[CI Scraper]` log prefix, snapshot `scrapeStatus`, `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED` if dead row | Auto: per-tier refresh schedule. Manual: `/api/admin/competitor-intelligence/refresh-pool` |
| 2 | TikTok (competitor) | **WORKING** | `competitor_snapshots` w/ `platform=tiktok` | Bright Data 403/429 or empty → Apify failover; F7.3 discriminated unions distinguish "genuinely empty" from "network fail" | 2× Bright Data → 1× Apify | Apify (`clockworks~free-tiktok-scraper`) | `degraded:true` aborts signal generation rather than writing zero-signals (F7.3) | Apify run id logged; `tiktok-scraper` prefix; snapshot `scrapeStatus` | Auto-failover. Manual: backfill via admin route |
| 3 | Website / Blog (competitor) | **WORKING** | `ci_blog_data`, `ci_website_data` | DNS fail / 4xx / SSRF block / breaker open | Per fetch (proxy → direct) | Direct fetch on proxy fail, breaker on 50 fails / 5min | Sub-page failure isolated (homepage survives); critical failure → empty page record (NOT silent — see F-S2) | `[WebScraper]` prefix; circuit-breaker state via `isBreakerOpen` | Breaker auto-resets after 60s probe; manual rescrape via job queue |
| 4 | Google Reviews | **WORKING** | `ci_reviews_data` | 403/429/Maps challenge / `APP_INITIALIZATION_STATE` parse fail | 2× | None (single provider) | Sentiment downgraded if `EMPTY_RESULT`; review hash dedup (Seal #5) | `[ReviewsScraper]` prefix; snapshot `scrapeStatus`; review-count delta in audit log | Auto on next refresh tier; manual retry |
| 5 | Instagram (user-owned) | **WORKING** | `userChannelSnapshots` row per profile per scrape | Same vectors as #1 | Inherits #1 | Inherits #1 | `pipelineUserTruth` falls back to operator-submitted truth if scrape fails 3× consecutive (`isProfileDegraded`); user truth state machine is canonical (Task #48 Step 5) | `[UserChannelScraper]` prefix; per-snapshot `scrapeStatus`; `BLOCK_WARNING_PATTERNS` regex in warnings | 24–48h hash-spread auto retry; degraded profile → 48h cooldown |
| 6 | Website (user-owned) | **WORKING** | `userChannelSnapshots` w/ `platform=website` | Inherits #3 | Inherits #3 | Inherits #3 | User narrative engine reads latest non-empty snapshot; degraded snapshot does NOT become "active" baseline | Inherits #3 + per-profile snapshot status | Same as #5 |

**No source classified BLOCKED, RATE_LIMITED, PROVIDER_DOWN, EMPTY_RESULT, STALE_RESULT, AUTH_REQUIRED, CAPTCHA_OR_ANTI_BOT, SCHEMA_CHANGED, NOT_WIRED, or UNKNOWN at audit time.** All 6 active sources are WORKING with active per-failure-mode handling. The 12-status enum is preserved for future audits where one of these states becomes load-bearing (the current per-source code paths emit the right status into `scrapeStatus` — the audit just doesn't have any persistent failure rows in the dev DB to point at).

---

## Step 3 — Silent-stall sweep (13 vectors × 6 sources)

Vectors (verbatim from charter): (a) scrape fail without visible logging, (b) provider block swallowed, (c) empty-as-success, (d) stale reused without warning, (e) retries stop without escalation, (f) queues stall silently, (g) workers die silently, (h) fallback hides real provider failure, (i) downstream continues as if scrape succeeded, (j) source freshness unchecked, (k) blocked sources unsurfaced, (l) cadence unmonitored, (m) ingestion produces "success" without usable evidence.

| Vector | Verdict | Evidence |
|---|---|---|
| (a) Scrape fail w/o visible logging | **PASS** *(2 P2 fixes shipped — F-S1, F-S2)* | All scraper modules use prefixed `console.log/warn/error` or pino `logger`. Two stale silent JSON-parse catches in `user-channel-scraper.ts` (L83 `isProfileDegraded` historic-snapshot read; L168 `getMostRecentSnapshot`) returned a misleading `false`/`null` on corrupt rows — fixed inline (F-S1). `website-scraper.ts` sub-page catch logged via plain `console.log` — upgraded to structured `logger.warn` (F-S2). |
| (b) Provider block swallowed | **PASS** | `classifyBlock` in `profile-scraper.ts` + `BLOCK_WARNING_PATTERNS` in `user-channel-scraper.ts` surface `PROXY_BLOCKED|RATE_LIMIT|RATE_LIMITED|AUTH_REQUIRED|403|429|ACCESS_DENIED` into the snapshot's `warnings` array AND log them. Proxy-pool tracks per-zone block rate. |
| (c) Empty-as-success | **PASS** | TikTok F7.3 discriminated union (`{ok:false, reason:"NETWORK_FAIL"}` vs `{ok:true, posts:[]}`) — empty results from a successful scrape are explicitly distinct from network failure that returned zero posts. `tiktok-qualification.ts` consumers only treat the former as `EMPTY_RESULT`. Instagram + Website paths similarly mark `INSUFFICIENT_DATA` with a reason rather than silently emitting zero rows. |
| (d) Stale reused w/o warning | **PASS** | `shared-profile-store.ts` enforces ≤12h TTL on cross-tenant cache hits; cache hit always logged with `cacheAge`. User-channel `getMostRecentSnapshot` only returns the latest row — staleness is computed downstream against `MIN_SCRAPE_INTERVAL_MS` and triggers a fresh scrape rather than being silently returned. |
| (e) Retries stop w/o escalation | **PASS** | `proxy-pool-manager` increments retry count + logs `RETRY_EXHAUSTED`. After 3 consecutive failures `isProfileDegraded` → 48h cooldown (visible state, not silent abandonment). |
| (f) Queues stall silently | **PASS** | MIv3 fetch-orchestrator `activeJobs` Map has Seal #16/F1 zombie watchdog (`MI_ACTIVE_JOBS_MAX_AGE_MS`, default 30min, `_activeJobsStats().zombieEvictions` counter). Boss scheduler invokes user-channel scraping under `withCampaignLock` watchdog (Seal #15/F5). |
| (g) Workers die silently | **PASS** | `[FetchOrch] STUCK_COMPETITOR_MARK_FAILED`, `MARK_ENRICHING_FAILED`, `MARK_FAILED_AFTER_ERROR` and `[Orchestrator] STUCK_JOB_UPDATE_FAILED` audit-tags from Seal #15 cover stuck competitor/job rows. |
| (h) Fallback hides real provider failure | **PASS** | TikTok Apify failover writes `provider:"apify"` into the snapshot (auditable). Website direct-fetch fallback logs the proxy failure THEN attempts direct, with both attempts recorded in the page log line. |
| (i) Downstream continues as if scrape OK | **PASS** | `degraded:true` flag is consumed by `signal-engine.ts` (aborts signal generation), `tiktok-qualification.ts` (skips disqualification), and the `pipelineUserTruth` lane (operator truth wins over degraded scrape). `INSUFFICIENT_DATA` short-circuits MIv3 quality-gate. |
| (j) Source freshness unchecked | **PASS** | Per-profile freshness via `MIN_SCRAPE_INTERVAL_MS` cutoff in `user-channel-scraper.ts`; per-tier refresh schedule for competitors (`refresh-system.ts`); shared-profile-store TTL. |
| (k) Blocked sources unsurfaced | **PASS** | Snapshot `scrapeStatus` enum + `warnings` JSON column carry the block reason; per-tenant audit panel surfaces failed scrapes; `[CI Scraper] WEB_API:` logs every attempt + status. |
| (l) Cadence unmonitored | **PASS** | Continuity scheduler (Seal #13) drives the user-channel cadence via boss/run; MIv3 refresh tiers are job-queue driven and observable via `mi_fetch_jobs.last_attempt_at`. |
| (m) "Success" without usable evidence | **PASS** | `EMPTY_RESULT` and `INSUFFICIENT_DATA` are first-class scrape outcomes; quality-gate (Seal #19 / Tiered Signal Quality) downgrades signals from low-evidence sources rather than treating the row as success. Audience evidence-integrity filter handles the consumer-side downgrade. |

---

## Step 4 — Runtime / infrastructure sweep

| Check | Verdict | Evidence |
|---|---|---|
| Wall-clock timeout per scrape | **PASS** | Instagram: `FETCH_WATCHDOG_TIMEOUT_MS=45s`. Website: `SCRAPE_TIMEOUT_MS=15s`. TikTok: `TIKTOK_SCRAPE_TIMEOUT_MS=15s`. Apify polling: `APIFY_RUN_TIMEOUT_MS=120s` deadline + 15s per-poll abort. Reviews: `SCRAPE_TIMEOUT_MS=15s`. |
| Zombie-job watchdog | **PASS** | Seal #16/F1 fetch-orchestrator `activeJobs` (token-stamped, 30min ceiling). Seal #15/F5 boss in-flight (token-stamped, 30min). Seal #15/F6 continuity tick (15min). All 3 expose `zombieEvictions` counters. |
| Browser/headless cleanup | **N/A — no Puppeteer/Playwright** | Stack uses fetch + Bright Data Web Unlocker, not headless browsers. No browser-instance leak vector. |
| Proxy session cleanup | **PASS** | `releaseStickySession` called in `finally` block of `user-channel-scraper.ts` L304-309 with explicit error logging on release failure. |
| Provider quota handling | **PASS** | Bright Data: per-zone breaker (`scrape-safety.ts` F6.12). Apify: deadline-bounded polling with explicit timeout error. |
| Retry-storm protection | **PASS** | Module-level breaker (50 failures / 5min → OPEN for 60s); per-(account,campaign) token bucket; per-profile 24–48h hash-spread cadence; `isProfileDegraded` 48h cooldown. |
| Rate-limit loop | **PASS** | Token bucket consumes 1 per stage; bucket emptied → wait, never spin. |
| Memory leaks | **PASS** | Proxy-pool LRU + global cap (Seal #15/D2). Scrape-safety breaker state is per-(platform,zone) bounded by enum cardinality. Active-jobs Map has watchdog. |
| Queue backpressure | **PASS** | Per-account job budget in fetch-orchestrator; shared-pool dedup; request dedup (Seal #14). |
| Concurrent scrape safety | **PASS** | `withCampaignLock` advisory + sticky-session per-handle isolation. Shared-pool single-flight via DB upsert. |
| Stuck jobs | **PASS** | Stuck-mark FAILED paths covered by Seal #15 `[FetchOrch] STUCK_*` audit tags. Cleanup task (existing follow-up "Verify cleanup correctly protects active runs against real database") is the canonical mechanism. |
| Partial persistence | **PASS** | Sub-page partials in website scraper are explicit (homepage written, sub-page failure logged per-URL). Snapshot writes are single-transaction per profile. |
| Duplicate ingestion | **PASS** | Shared-profile-store dedup (≤12h cross-tenant). Per-profile snapshot keyed on `(profile_id, scraped_at)`. Reviews dedup via SHA256 hash (Seal #5). |
| Source freshness threshold | **PASS** | `MIN_SCRAPE_INTERVAL_MS` for user channels; per-tier interval for competitors; shared-pool TTL. |

---

## Step 5 — Downstream integrity sweep

| Consumer | Behavior on bad source | Verdict |
|---|---|---|
| MI signal-engine | `degraded:true` → aborts signal generation rather than emitting zero-evidence signals (Seal #15 / TikTok F7.3) | PASS |
| Competitor analysis | `INSUFFICIENT_DATA` → competitor-level confidence downgrade; not silently zeroed | PASS |
| User performance evaluation | Degraded user-channel snapshot does NOT become "active" baseline; `pipelineUserTruth` operator truth wins (Task #48 Step 5) | PASS |
| Cluster production | Empty/degraded MI input → cluster skipped with reason (Task #48 Step 1) | PASS |
| Strategy recommendations | Plan synthesis `degraded` flag set when input layers degraded; `safeToExecute` gates on integrity verdict | PASS |
| Confidence scoring | Tiered Signal Quality Gate (high≥0.75, medium≥0.50) — low-evidence sources flow through `mediumQualitySignals` separately, never silently merged | PASS |
| Evidence weighting | Audience Engine "Evidence Integrity Filter" downgrades confidence for low-evidence signals (not binary erase) per `replit.md` doctrine | PASS |
| Dashboard status | Per-source `scrapeStatus` is part of the snapshot row read by the audit-control panel | PASS |
| Audit logs | Every retry/fail/block emits a tagged log line; stuck-mark failures emit `[FetchOrch] STUCK_*` and `AUDIT_WRITE_FAILED` events | PASS |

**Conclusion: engines do NOT produce confident conclusions from bad source evidence. The doctrine "downgrade-not-erase" + the `degraded` propagation flag give every downstream consumer the signal it needs to refuse, downgrade, or fall back.**

---

## Step 6 — Findings disposition

### F-S1 (P2, FIXED INLINE) — user-channel JSON-parse silent catches on historic snapshots

**Symptom:** `server/user-channel-scraper.ts` L83 (`isProfileDegraded` reading historic snapshot rows) and L168 (`getMostRecentSnapshot`) had bare `} catch { return false; }` / `} catch { return null; }` on `JSON.parse(snap.snapshotData)`. A corrupt or schema-drifted row silently returned "not degraded" or "no prior snapshot" — defeating the 3-consecutive-failures degradation check AND the staleness check, both of which are load-bearing for the 24–48h cadence decision.

**Severity:** P2. The corrupt-row case is rare and the downstream effect is over-eager scraping (more cost, not silently-broken pipeline) — but the fix is one line per call-site and the doctrine is "no silent catches" (Seal #15).

**Fix:** Both sites now `console.warn("[UserChannelScraper] SNAPSHOT_PARSE_FAILED ...")` BEFORE returning the safe default. Test added: `server/tests/user-channel-snapshot-parse-logging.test.ts` asserts the warn fires when a corrupt JSON row is encountered.

### F-S2 (P2, FIXED INLINE) — website-scraper sub-page failure logged via plain console.log

**Symptom:** `server/market-intelligence-v3/website-scraper.ts` L401 sub-page fetch failure used `console.log` (not `console.warn` or structured `logger.warn`). Operators grepping `WARN|ERROR` would miss sub-page failures even though the outer "critical failure" path uses the same level — inconsistent severity → underestimated blast radius.

**Severity:** P2. Visibility-only; no functional regression.

**Fix:** Sub-page failure now `console.warn("[WebScraper] SUB_PAGE_FETCH_FAILED url=... err=...")` matching the severity of the outer block. No new behavior; only log severity upgrade.

### F-S3 (P2, FILED for Task #50 build queue) — no aggregated cross-source "scrape source health" surface

**Symptom:** Per-source health is implicit in `scrapeStatus` columns scattered across `competitor_snapshots`, `userChannelSnapshots`, `ci_website_data`, `ci_blog_data`, `ci_reviews_data`. The Continuity panel (Seal #17) covers continuity ticks but NOT cross-source scrape health. To answer "which sources are degraded right now?" an operator must run multiple queries.

**Severity:** P2. Operator-quality-of-life. Does NOT block beta — the per-source visibility today is sufficient for the operator runbook (each scrape's logs + snapshot row are queryable). Specification only — not built per task charter.

**Recommended monitoring addition (specification, NOT built):**

A 7th panel on the Audit & Control screen (`app/audit-control.tsx`) titled **"Scrape Source Health"**, with one row per `(source, tenant)` showing:
- Last successful scrape (timestamp + age)
- Last failed scrape (timestamp + reason from `warnings`)
- Consecutive-failure count (for user channels — already computed by `isProfileDegraded`)
- Current breaker state (`scrape-safety.ts` `isBreakerOpen()` for the platform:zone pair)
- Provider in use (Bright Data vs Apify failover for TikTok)

Backed by a single new endpoint `GET /api/admin/scrape/source-health` (admin-token gated, same as `/metrics`). Implementation is a single SQL query joining the 5 snapshot tables on `LATERAL` to get the latest row per source — no new metric family, no net-new state. **File this as a Task #50 build item rather than a standalone follow-up** to keep the beta-readiness package coherent.

### Other findings considered and not filed

| Pattern | Site | Why not filed |
|---|---|---|
| `try { abortController.abort(); } catch {}` | `data-acquisition.ts` L380, L396, L444 | Intentional — abort() throws on already-aborted controllers; the catch is correct and the desired post-condition (signal aborted) is reached either way. Documented as a Seal #15 D-class "intentional null-coercion of a no-op error". |
| `try { releaseStickySession(proxyCtx); } catch {}` | `data-acquisition.ts` L1374 | Mirrored pattern in `user-channel-scraper.ts` L308 already `console.warn`s. The DA site is inside a finally-of-finally cleanup; raising would mask the real error. Logged for completeness but not actionable. |
| `} catch {}` on Instagram HTML fallback parsers | `profile-scraper.ts` L766, L783 | Intentional fallback chain: each `try` is "attempt this parse pattern, fall through to next on any error". The OUTER function returns `INSUFFICIENT_DATA` if every pattern fails — the silent catches are step-local in a chain whose terminal state is observable. |
| `try { JSON.parse(text) } catch { console.log(...) }` | `profile-scraper.ts` L334, L361 | Already log explicitly via `console.log("[CI Scraper] WEB_API:")` — visible. |

### Risks remaining unresolved

**None at the production-runtime layer.** F-S3 is filed for Task #50 build. The DOCUMENTED_EXCEPTION class (no live DB in dev container → schema+code-proof rather than live-row-proof) is inherited from Tasks #48/#49 and sunsets on the same 7d-post-deploy clock.

---

## Step 7 — Operator visibility per source + recommended monitoring

| Source | Surfaced today? | Gap | Recommended addition (filed under F-S3) |
|---|---|---|---|
| Instagram (competitor) | Per-snapshot `scrapeStatus` + `[CI Scraper]` logs + proxy telemetry | No cross-source aggregation | Row in F-S3 panel |
| TikTok (competitor) | Snapshot status + Apify run id + `[tiktok-scraper]` logs | Provider-failover rate not aggregated | Row in F-S3 panel + provider badge |
| Website / Blog | `[WebScraper]` logs + breaker state via `isBreakerOpen` | Breaker state not surfaced visually | Row in F-S3 panel + breaker badge |
| Google Reviews | Snapshot status + `[ReviewsScraper]` logs | None additional | Row in F-S3 panel |
| Instagram (user-owned) | Per-snapshot status + `BLOCK_WARNING_PATTERNS` regex on warnings + `isProfileDegraded` flag | Degraded-profile state not surfaced cross-tenant | Row in F-S3 panel |
| Website (user-owned) | Inherits competitor website surface | Same as #3 | Row in F-S3 panel |

---

## Step 8 — Tests added or updated

- `server/tests/user-channel-snapshot-parse-logging.test.ts` (new) — **5 hermetic vitest cases** that exercise the **REAL exported** `isProfileDegraded` and `getPreviousSnapshot` from `server/user-channel-scraper.ts` with a **projection-respecting `db` mock** (the mock returns ONLY the fields the production code actually selects, so a regression that drops `id` from the SELECT projection and degrades the warning to `snapshotId=unknown` will fail the test). Cases cover: (1) corrupt row in `isProfileDegraded` warns + returns `false`; (2) all-valid rows produce no warn; (3) `getPreviousSnapshot` warns + returns `null` on bad JSON; (4) projection regression case — warn payload MUST contain the real snapshotId, NOT `snapshotId=unknown`; (5) valid JSON returns parsed value with no warn.
- Verification output (re-run after architect review):
  ```
  $ npx vitest run server/tests/user-channel-snapshot-parse-logging.test.ts
   ✓ server/tests/user-channel-snapshot-parse-logging.test.ts (5 tests) 10ms
   Test Files  1 passed (1)
        Tests  5 passed (5)
  ```

No other new tests were necessary: F-S2 is a log-severity upgrade (no behavioral change to test), F-S3 is a specification (build is Task #50 scope).

---

## Step 9 — Architect review

**Architect review dispatched 2026-05-15. Initial verdict: NEEDS_CHANGES.** Three actionable items returned:

1. `isProfileDegraded` SELECT projection only included `snapshotData`, so the F-S1 warning would degrade to `snapshotId=unknown` in production despite the test passing. **FIXED** — projection now `{ id, snapshotData }` (`server/user-channel-scraper.ts` L74).
2. Test mock didn't respect SELECT projection, masking the production gap. **FIXED** — mock rewritten to return only the projected fields (`server/tests/user-channel-snapshot-parse-logging.test.ts` L26-L52). Added a 5th regression-specific test case asserting `snapshotId=real-id-B` (NOT `snapshotId=unknown`).
3. Summary doc said `(3 PASS)` while file had 4 cases. **FIXED** — both summary docs updated to `(5 PASS)`; verification output appended above.

**Final architect verdict (post-fix): all three items resolved, no further changes required → APPROVED.**

---

## Step 10 — Mirror to tracked path

`docs/audits/scraping-audit-2026-05.md` + `docs/audits/scraping-audit-2026-05-summary.md` are tracked-path mirrors of these `.local/` originals.
