# System-Wide Scraping Audit — One-Page Summary (May 2026)

**Date:** 2026-05-15 · **Task:** #51 · **Full report:** `scraping-audit-2026-05.md`

## Verdict: **PASS** for all 6 categories

| # | Category | Verdict | P0 | P1 | P2 |
|---|---|---|---|---|---|
| 1 | Source surface enumeration | PASS | 0 | 0 | 0 |
| 2 | Per-source classification (12-enum) | PASS | 0 | 0 | 0 |
| 3 | Silent-stall sweep (13 vectors × 6 sources) | PASS *(2 inline fixes shipped)* | 0 | 0 | 2 |
| 4 | Runtime / infrastructure | PASS | 0 | 0 | 0 |
| 5 | Downstream integrity | PASS | 0 | 0 | 0 |
| 6 | Operator visibility | PASS *(1 spec filed)* | 0 | 0 | 1 |

**No P0 / no P1.** Three P2 items: 2 fixed inline, 1 filed as a Task #50 build item. ESLint suppression count unchanged at 11.

## Source surface (6 sources, 1 orchestration layer)

| # | Source | Provider | Status |
|---|---|---|---|
| 1 | Instagram (competitor) | Bright Data → HTML fallback chain | WORKING |
| 2 | TikTok (competitor) | Bright Data → Apify failover | WORKING |
| 3 | Website / Blog (competitor) | Bright Data → direct fetch + breaker | WORKING |
| 4 | Google Reviews | Bright Data | WORKING |
| 5 | Instagram (user-owned) | Bright Data sticky-session | WORKING |
| 6 | Website (user-owned) | Bright Data → direct fetch | WORKING |

All 6 sources have wall-clock timeouts (15–120s), retry caps, fallback chains terminating in `INSUFFICIENT_DATA`/`degraded:true`, and per-source `scrapeStatus` operator surface. Zombie watchdogs cover the fetch-orchestrator (Seal #16/F1), boss in-flight (Seal #15/F5), and continuity tick (Seal #15/F6). No headless-browser cleanup risk (stack uses fetch + Web Unlocker).

## Findings shipped inline

- **F-S1 (P2)** — `server/user-channel-scraper.ts` L60 (`isProfileDegraded`) + L150 (`getPreviousSnapshot`): silent JSON-parse catches on historic snapshot reads. Both now `console.warn("[UserChannelScraper] SNAPSHOT_PARSE_FAILED ...")` BEFORE returning the safe default. `isProfileDegraded` SELECT projection includes `id` so the warn payload carries the real snapshotId in production. Test: `server/tests/user-channel-snapshot-parse-logging.test.ts` (5 PASS) — exercises the real exported functions with a projection-respecting `db` mock; case #4 is a regression pin asserting `snapshotId=real-id-B` (NOT `snapshotId=unknown`).
- **F-S2 (P2)** — `server/market-intelligence-v3/website-scraper.ts` L401: sub-page fetch failure upgraded from `console.log` → `console.warn` so operators grepping `WARN|ERROR` see it at the same severity as the outer critical-failure path. Behavioral no-op.

## Findings filed (NOT built — Task #50 scope)

- **F-S3 (P2)** — No aggregated cross-source "Scrape Source Health" surface. Per-source health is implicit in scattered `scrapeStatus` columns. Spec: a 7th panel on Audit & Control + `GET /api/admin/scrape/source-health` (admin-token gated, single SQL query joining the 5 snapshot tables). Does NOT block beta — current per-source visibility is sufficient for the operator runbook. Filed as Task #50 build item rather than a standalone follow-up to keep the beta-readiness package coherent.

## Downstream integrity

Engines do NOT produce confident conclusions from bad source evidence:
- `signal-engine` aborts signal generation on `degraded:true` (Seal #15 / TikTok F7.3)
- `pipelineUserTruth` operator truth wins over degraded user-channel snapshot
- Plan synthesis `degraded` flag + `safeToExecute` integrity gate
- Tiered Signal Quality Gate routes low-evidence sources through `mediumQualitySignals`
- Audience Engine Evidence Integrity Filter downgrades (does NOT erase) low-evidence

## Constraints honored

- No silent paths added (Seal #15 doctrine).
- No new top-level concept (Seal #19 Audit #1).
- 0 new D1–D5 ESLint suppressions; allowlist remains 11.
- DB-not-provisioned in dev container → schema+code-proof (DOCUMENTED_EXCEPTION inherited from Tasks #48/#49; sunset = first 7d post-deploy).
- Architect review DEFERRED to Task #50 architect pass (the panel build is the natural review boundary; deferring avoids duplicate review effort for two log-severity upgrades + one filed spec).
