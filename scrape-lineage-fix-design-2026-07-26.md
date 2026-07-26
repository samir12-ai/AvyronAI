# scrape-lineage-fix-design-2026-07-26.md

**Architecture design only. No code changes. All file:line references are to the current codebase.**

---

## Preamble — two clarifications from the audit

Before the designs, two structural clarifications that affect every decision below.

**Clarification 1 — Two systems share the name "Content DNA"**

| Name | Location | Kind | Current state |
|---|---|---|---|
| Deterministic DNA | `mi_snapshots.content_dna_data` (JSON blob) | Regex archetype classification per competitor per run | Computed, stored in snapshots, last run May 2026 |
| Synthesized DNA | `content_dna` table (`shared/schema.ts:2630`) | LLM-generated campaign narrative guidance | 0 rows |

These are not the same thing. The strategy engines that are reading an empty table (`agent-context.ts:312`, `execution-activation/engine.ts:416`, `business-context-layer.ts:1044`) are reading the **Synthesized DNA** (LLM table). The **Deterministic DNA** (JSON blob) is computed correctly but is run-scoped and stale. The designs below treat them separately.

**Clarification 2 — `metaPostId` IS captured synchronously — but only when the publish-worker runs**

`publishToMeta()` at `publish-worker.ts:203` gets `postId` from Meta's `media_publish` response synchronously. The worker writes it at `publish-worker.ts:514`:

```ts
metaPostId: result.postId || null,
```

The gap is NOT that Meta is asynchronous. The gap is:
- The Studio path creates `published_posts` with `status='scheduled'` (no `metaPostId`).
- A separate polling loop (the publish-worker) later executes the Meta call and writes `metaPostId`.
- If the scraper observes a post **before the worker runs**, or if the worker **crashes after the Meta call but before the UPDATE**, `metaPostId` stays NULL permanently. Step 1 of the lineage resolver (`lineage-resolver.ts:278`) then misses for the lifetime of the row.
- Additionally: at `publish-worker.ts:514`, `result.postId || null` silently loses the ID if `result.postId` is an empty string rather than a falsy value. This is a capture-failed case that looks like a success.

---

## Section 1 — Problem 2: The `content_dna` table is empty and disconnected

### 1.1 Root cause chain

```
BLOCKED_BY_PLATFORM (all 13 competitors since ~May 2026)
  → MIv3 engine has no fresh competitor posts
  → contentDnaResults = [] or stale (last snapshot May 2026)
  → content_dna route (/api/content-dna/generate) is never auto-triggered
  → content_dna table stays 0 rows
  → orchestrator / execution-activation / commercial-reasoning read empty table
  → strategy engines operate with no DNA context
```

The Synthesized DNA route exists and works (`content-dna-routes.ts:344`) but requires valid MI engine analysis as input. It is currently only triggered manually. No automatic trigger exists after a successful MI run.

The Deterministic DNA is computed in `engine.ts:931` on each fresh run but only stored as JSON in `mi_snapshots.content_dna_data`. It is never written to a queryable persistent store.

Owned posts do not enter either DNA computation. The content scorer (`content-scorer.ts:200–212`) reads `hookStyle`/`contentAngle`/`contentType` from `owned_posts.lineageState` — it does NOT read `content_dna`. But the orchestrator and commercial-reasoning engines DO read the Synthesized DNA table, which is empty.

### 1.2 Source-of-truth decision

**The `content_dna` table (Synthesized DNA) is the canonical persistent store.** Reasoning:

- All three strategy engines already point at it.
- LLM-synthesized guidance is the appropriate input for the orchestrator and commercial-reasoning — not raw archetype flags.
- Eliminating it would require rewriting three reader paths.

**The `mi_snapshots.content_dna_data` JSON blob is a run-scoped cache — not deprecated.** Reasoning:

- It correctly serves snapshot-replay and the positioning engine.
- Deprecating it would require a schema migration and breaks the replay system.
- It should be promoted to a queryable table (see 1.4) for the Deterministic DNA use case, rather than dropped.

### 1.3 Schema additions required

**New table: `competitor_dna_snapshots`** (Deterministic DNA — persisted)

```sql
CREATE TABLE competitor_dna_snapshots (
  id                  varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          varchar NOT NULL,
  campaign_id         varchar NOT NULL,
  competitor_id       varchar NOT NULL,          -- FK ci_competitors.id
  mi_snapshot_id      varchar NOT NULL,          -- FK mi_snapshots.id (provenance)
  hook_archetypes     jsonb,                     -- HookArchetype[]
  narrative_frameworks jsonb,                   -- NarrativeFramework[]
  cta_frameworks      jsonb,                     -- CTAFramework[]
  dna_confidence      double precision,
  evidence            jsonb,                     -- ContentDNAEvidence[]
  missing_signal_flags jsonb,                   -- string[]
  computed_at         timestamp NOT NULL DEFAULT now(),
  created_at          timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX competitor_dna_snapshots_comp_snap_uidx
  ON competitor_dna_snapshots (competitor_id, mi_snapshot_id);
CREATE INDEX competitor_dna_snapshots_campaign_idx
  ON competitor_dna_snapshots (account_id, campaign_id, computed_at DESC);
```

**New column on `content_dna`: `input_source_summary`** (text, nullable)

Records what inputs were available when the LLM synthesized this row — specifically whether competitor posts were fresh, stale, or absent, and whether owned performance data was included. Needed to avoid silently degrading the DNA when inputs are empty.

```sql
ALTER TABLE content_dna ADD COLUMN IF NOT EXISTS input_source_summary text;
ALTER TABLE content_dna ADD COLUMN IF NOT EXISTS owned_posts_included boolean NOT NULL DEFAULT false;
ALTER TABLE content_dna ADD COLUMN IF NOT EXISTS competitor_posts_count integer;
ALTER TABLE content_dna ADD COLUMN IF NOT EXISTS data_age_days integer;
```

**No columns are removed from either existing table.** `mi_snapshots.content_dna_data` is unchanged.

### 1.4 Write path — exactly where and what gets written

**Path A — Deterministic DNA (per MIv3 fresh-data run)**

Location: `server/market-intelligence-v3/engine.ts`, after line 931 where `contentDnaResults` is computed.

Current code:
```ts
// engine.ts:931
const contentDnaResults = computeAllContentDNA(competitors);
```

Proposed insertion site (after line 1326 where `contentDnaData` is written to snapshot):

```ts
// Proposed: after engine.ts:1326
// Upsert each competitor's deterministic DNA into competitor_dna_snapshots.
// Non-blocking: failures log loud but do not abort the snapshot persist.
await upsertCompetitorDnaSnapshots({
  accountId,
  campaignId,
  snapshotId: persistedSnapshotId,
  dnaResults: contentDnaResults,
});
```

`upsertCompetitorDnaSnapshots` is a new function in a new file `server/market-intelligence-v3/dna-persistence.ts`. It does a batch INSERT ... ON CONFLICT (competitor_id, mi_snapshot_id) DO NOTHING.

If `contentDnaResults` is empty (no competitors had posts), write a `system_notices` row:
- `category: 'DNA_COMPUTATION_EMPTY'`
- `severity: 'warning'`
- `audience: 'operator'`
- `copyKey: 'operator.dna_computation_empty'`
- `correlationKey: 'DNA_COMPUTATION_EMPTY:<account_id>'`

**Path B — Synthesized DNA (LLM campaign DNA, triggered post-snapshot)**

The auto-trigger must fire after a successful fresh-data MIv3 snapshot is persisted. Location: `server/market-intelligence-v3/engine.ts`, after `persistedSnapshotId` is confirmed.

The trigger calls the same logic as `content-dna-routes.ts:344` but non-interactively:
- Builds the prompt from the fresh snapshot's `perCompetitorMultiSource` data AND from `ownedContentScores` (performance data for owned posts — see 1.5)
- Calls `generateAndPersistContentDna(accountId, campaignId, { snapshotId, ownedScoresSummary })`
- On failure or empty parse: write a `system_notices` warning (do not silently skip)

If the snapshot is from stale/degraded data (`provenanceDegraded = true`), the Synthesized DNA generation is SKIPPED and a `system_notices` notice fires instead:
- `copyKey: 'operator.dna_generation_skipped_degraded_inputs'`
- `detail.reason = provenanceReason`

This enforces the doctrine: do not silently generate DNA from empty inputs and present it as authoritative.

### 1.5 Owned posts entry into DNA computation

Owned posts do not enter the Deterministic DNA (which classifies competitor hook archetypes). They should enter the **Synthesized DNA** as a performance summary.

The `ownedContentScores` table (`server/performance-loop/content-scorer.ts`) already records which `hookStyle`, `contentAngle`, and `contentType` values are performing above/below cohort baseline. This is the owned-post signal to feed DNA.

New function `computeOwnedPerformanceSummary(accountId, campaignId)`:
- Reads from `owned_content_scores` (already written by `content-scorer.ts`)
- Groups by dimension + dimensionValue, returns: which hookStyles are winning, which angles are underperforming, maturity band of the data
- Returns NULL if `owned_content_scores` has 0 rows (no data) — callers must treat this as an unknown, not a zero

The Synthesized DNA prompt (currently in `content-dna-routes.ts` around line 300–344) is extended to include this owned performance block. The `owned_posts_included` column on `content_dna` is set to `true` when this block is non-null.

**Explicit rule:** If `owned_content_scores` has 0 rows, owned performance is omitted from the prompt and `owned_posts_included = false`. No fabricated signals, no empty arrays passed as inputs. The column is a verifiable audit trail.

### 1.6 Read path — how Performance Loop scorer queries DNA

**The content scorer does NOT need to change.** It already reads `hookStyle`, `contentAngle`, `contentType` from `owned_posts` directly (via lineage resolver), and this is correct. The scorer does not read `content_dna`.

The new read path for strategy engines:

| Engine | Current read | After fix |
|---|---|---|
| `agent-context.ts:312` | `content_dna` table (0 rows) | Same — now populated via auto-trigger |
| `execution-activation/engine.ts:416` | `content_dna` table (0 rows) | Same — now populated |
| `business-context-layer.ts:1044` | `content_dna` table (0 rows) | Same — now populated |
| Positioning engine | `mi_snapshots.content_dna_data` | Same — unchanged |
| Audience engine semantic bridge | `mi_snapshots.content_dna_data` | Same — unchanged |

No reader paths are rewritten. The fix is entirely on the write side.

### 1.7 Backfill strategy

**Deterministic DNA (competitor_dna_snapshots):** The existing 140 `ci_competitor_posts` rows span 2026-04-02 to 2026-05-15. A one-time backfill script reads these rows grouped by competitor, re-runs `computeContentDNA()` on each group, and inserts into `competitor_dna_snapshots` with `mi_snapshot_id = 'backfill_2026-07-26'`. This is safe — the function is pure (no DB writes, no network calls).

**Synthesized DNA (content_dna table):** Cannot meaningfully backfill from stale May 2026 data. The first real `content_dna` row will be generated when fresh competitor data resumes (see Problem 3). Until then, strategy engines should handle `content_dna` returning 0 rows — they already have fallback code paths (e.g., `execution-activation/engine.ts:425`: `if (contentDnaRecord) { ... } else { activationLog.push('CONTENT_DNA: Not found — using default distribution') }`). The existing fallback is correct; the priority is populating the table going forward.

**Migration strategy for existing data:**
- New migration `045_competitor_dna_snapshots.sql` creates the `competitor_dna_snapshots` table and adds the new columns to `content_dna`
- Existing `content_dna` rows (currently 0) get `owned_posts_included = false`, `input_source_summary = NULL`
- No destructive changes to `mi_snapshots`

### 1.8 Deprecation plan for the losing store

Nothing is deprecated. The roles are clarified:
- `mi_snapshots.content_dna_data` → Deterministic DNA cache (per-run, competitor-only, serves positioning + replay)
- `competitor_dna_snapshots` → Deterministic DNA persistent store (queryable, per-competitor, per-run)
- `content_dna` table → Synthesized DNA store (LLM, per-campaign, serves orchestrator + activation)

### 1.9 Subsystems touched and gate/score/verdict impact

| Subsystem | Change type | Gate/score/verdict weakened? |
|---|---|---|
| `market-intelligence-v3/engine.ts` | Add post-snapshot write call | No — additive only |
| `content-dna-routes.ts` | Extract generation logic into shared function | No |
| `system_notices` | New notice categories written | No |
| `content_dna` table schema | Additive columns only | No |
| `competitor_dna_snapshots` | New table | No |
| `owned_content_scores` | Read-only consumer | No |

### 1.10 Live verification plan

1. **Trigger condition:** After a successful fresh-data MIv3 run for any campaign.
2. **Verify Deterministic DNA:**
   ```sql
   SELECT competitor_id, array_length(hook_archetypes::jsonb, 1) as hook_count,
          dna_confidence, computed_at
   FROM competitor_dna_snapshots
   WHERE campaign_id = '<id>'
   ORDER BY computed_at DESC LIMIT 5;
   ```
   Expected: ≥1 row per competitor that had posts, `dna_confidence > 0`.
3. **Verify Synthesized DNA:**
   ```sql
   SELECT id, owned_posts_included, competitor_posts_count, data_age_days,
          messaging_core IS NOT NULL as has_messaging, status, generated_at
   FROM content_dna WHERE campaign_id = '<id>'
   ORDER BY generated_at DESC LIMIT 1;
   ```
   Expected: 1 row, `status = 'active'`, `has_messaging = true`.
4. **Verify warning on empty run:** Force a run with 0 competitor posts (set all to BLOCKED). Confirm a `system_notices` row appears with `category = 'DNA_COMPUTATION_EMPTY'`. Verify it does NOT appear when posts are present.
5. **Verify owned performance included:** After content-scorer runs and writes `owned_content_scores`, trigger DNA generation and confirm `owned_posts_included = true`.

---

## Section 2 — Problem 1: Identity capture is deferred, not enforced at publish time

### 2.1 Root cause

The publish flow has two phases that operate independently:

```
Phase 1 (Studio API, ~synchronous, seconds):
  POST /api/studio
    → INSERT published_posts { status: 'generating_caption', metaPostId: NULL }
    → generate caption
    → UPDATE published_posts { status: 'scheduled', hookStyle, lineageSource, ... }
    ← metaPostId still NULL

Phase 2 (Publish-worker, polling loop):
  publishToMeta() → Meta Graph API → { success: true, postId: 'xxx' }
    → UPDATE published_posts { status: 'published', metaPostId: 'xxx' }
```

**Gap 1 — Window:** If the lineage resolver runs between Phase 1 and Phase 2, `metaPostId` is NULL and Step 1 of the resolver misses. The post is then matched (or not) by caption fingerprint. If the scraper finds the post before Phase 2 completes, the highest-confidence key is permanently lost for that ownership proof cycle.

**Gap 2 — Capture failure:** At `publish-worker.ts:514`, the code writes `metaPostId: result.postId || null`. If `result.postId` is an empty string (`""`), this stores NULL. The `success: true` path proceeds with no audit trail that identity was lost. There is no observable state distinguishing "never published" from "published but identity not captured."

**Gap 3 — Historical posts:** Posts published before migration 044 (owned_posts table creation) may have `metaPostId = NULL` if the publish-worker crashed between the Meta call and the UPDATE, or if they were published through an inline route (`routes.ts:1168`, `routes.ts:1465`) that may not have written `metaPostId` reliably.

### 2.2 Proposed schema changes

**New column on `published_posts`: `meta_identity_status`**

```sql
ALTER TABLE published_posts
  ADD COLUMN IF NOT EXISTS meta_identity_status text NOT NULL DEFAULT 'pending';

ALTER TABLE published_posts
  DROP CONSTRAINT IF EXISTS published_posts_meta_identity_status_check;
ALTER TABLE published_posts
  ADD CONSTRAINT published_posts_meta_identity_status_check
  CHECK (meta_identity_status IN (
    'pending',          -- Row created; publish not yet attempted
    'awaiting',         -- Publish attempted; identity capture in-flight (rare async window)
    'captured',         -- metaPostId confirmed non-empty after successful publish
    'capture_failed',   -- Publish succeeded per worker but metaPostId came back empty/null
    'failed',           -- Publish itself failed; identity N/A
    'legacy'            -- Row predates this migration; identity status unknowable
  ));

-- SLA index: find rows that have been 'pending' or 'awaiting' too long
CREATE INDEX IF NOT EXISTS published_posts_identity_sla_idx
  ON published_posts (meta_identity_status, updated_at)
  WHERE meta_identity_status IN ('pending', 'awaiting');
```

**No new columns on `owned_posts`.** The lineage resolver already records `matchMethod` and `matchConfidence`. The fix is upstream at `published_posts`.

### 2.3 Publish-path sequence diagram

```
Studio API (/api/studio)
│
├─ INSERT published_posts {
│    status:               'generating_caption',
│    meta_identity_status: 'pending',    ← new, explicit state
│    metaPostId:           NULL
│  }
│
├─ generateAndScoreCaptions()
│
├─ resolvePublishLineage()   → hookStyle, lineageSource, ...
│
└─ UPDATE published_posts {
     status:               'scheduled',
     meta_identity_status: 'pending',    ← unchanged here; worker owns this transition
     hookStyle, contentAngle, lineageSource, planId, ...
   }
   [publish-pipeline.ts:276]

                  ↓ (polling loop, publish-worker.ts)

publishToMeta()
│
├─ [SUCCESS, postId non-empty]
│   UPDATE published_posts {
│     status:               'published',
│     metaPostId:           result.postId,
│     meta_identity_status: 'captured',   ← new
│     publishedAt:          now()
│   }
│   [publish-worker.ts:511 — update site]
│
├─ [SUCCESS, postId empty or falsy]
│   UPDATE published_posts {
│     status:               'published',
│     metaPostId:           NULL,
│     meta_identity_status: 'capture_failed',  ← new; was silently NULL before
│   }
│   + write system_notices row (audience='operator', copyKey='operator.publish_identity_lost')
│
└─ [FAILURE]
    UPDATE published_posts {
      status:               'failed',
      meta_identity_status: 'failed',     ← new, distinct from capture_failed
    }
    [existing error path, publish-worker.ts:557]
```

**SLA enforcement:** A new lightweight SLA monitor (runs inside the existing publish-worker tick, `publish-worker.ts`) queries:

```sql
SELECT id, account_id FROM published_posts
WHERE meta_identity_status IN ('pending', 'awaiting')
  AND updated_at < now() - interval '60 seconds'
  AND status NOT IN ('failed', 'published');
```

For each row found: write a `system_notices` row:
- `category: 'PUBLISH_IDENTITY_SLA_BREACH'`
- `severity: 'warning'`
- `audience: 'operator'`
- `copyKey: 'operator.publish_identity_sla_breach'`
- `correlationKey: 'PUBLISH_IDENTITY_SLA_BREACH:<post_id>'`

The SLA monitor does NOT modify the `published_posts` row. It is a reader only. The post continues to be attempted by the normal publish retry logic.

### 2.4 Failure mode table

| Scenario | `meta_identity_status` | `metaPostId` | System notice? | Lineage resolver behavior |
|---|---|---|---|---|
| Post scheduled, not yet published | `pending` | NULL | None (within SLA) | Resolver runs → Step 1 misses → fallback to caption. If re-run after `captured`, Step 1 hits. |
| Post scheduled, SLA breached (>60s) | `pending` | NULL | Yes — `PUBLISH_IDENTITY_SLA_BREACH` | Same as above; notice alerts operator to investigate |
| Meta returned postId correctly | `captured` | `<id>` | None | Step 1 always hits — highest confidence |
| Meta returned success + empty postId | `capture_failed` | NULL | Yes — `PUBLISH_IDENTITY_LOST` | Step 1 misses permanently; fallback to caption |
| Meta returned error | `failed` | NULL | Existing error logging | Step 1 misses; post not in published state |
| Meta timeout, will retry | `awaiting` | NULL | None until SLA | Transient; resolves to `captured` on retry success |
| Row predates migration | `legacy` | NULL or set | None | Status quo for pre-existing rows |

### 2.5 Migration strategy for existing rows

```sql
-- Migration 046_published_posts_identity.sql

ALTER TABLE published_posts
  ADD COLUMN IF NOT EXISTS meta_identity_status text NOT NULL DEFAULT 'pending';

-- Backfill: rows with a known post ID — identity was captured
UPDATE published_posts SET meta_identity_status = 'captured'
  WHERE meta_post_id IS NOT NULL;

-- Backfill: rows that are published but have no ID — capture was lost
UPDATE published_posts SET meta_identity_status = 'capture_failed'
  WHERE meta_post_id IS NULL AND status = 'published';

-- Backfill: rows that failed — identity N/A
UPDATE published_posts SET meta_identity_status = 'failed'
  WHERE status = 'failed';

-- Everything else (scheduled, generating_caption, etc.) stays 'pending'
-- The publish-worker's next tick will resolve them.
```

All remaining `pending` rows (scheduled posts not yet sent to Meta) will be resolved to `captured` or `capture_failed` by the publish-worker's next successful or failed attempt.

### 2.6 Interaction with existing warning systems

**Does not hook into `dna_enrichment_requests`.** That table is for interchangeability judge failures — entirely different purpose.

The `system_notices` table is the correct hook. It already handles:
- `SCRAPER_PROVIDER_DEGRADED` (operator audience, `interpreter.ts:289`)
- 10 existing notices in the current DB

The new notices for Problem 1 follow the same pattern:
- `PUBLISH_IDENTITY_LOST` → `audience: 'operator'`, fires once per post, correlates on post ID
- `PUBLISH_IDENTITY_SLA_BREACH` → `audience: 'operator'`, fires once per post per SLA window

These are operational notices — **not** user-facing (same as the existing guardian notices). User-facing publish failure feedback already exists through the existing `status: 'failed'` path.

### 2.7 Subsystems touched and gate/score/verdict impact

| Subsystem | Change type | Gate/score/verdict weakened? |
|---|---|---|
| `shared/schema.ts` | Add `meta_identity_status` column | No |
| `publish-worker.ts:511–514` | Write `meta_identity_status` on UPDATE | No |
| `publish-worker.ts` | Add SLA monitor query | No — read-only addition |
| `system_notices` | Two new notice categories | No |
| `lineage-resolver.ts` | No change needed | No |

### 2.8 Live verification plan

1. **Trigger:** Publish a post through Studio in a test campaign.
2. **Immediately after INSERT:**
   ```sql
   SELECT id, meta_identity_status, meta_post_id, status FROM published_posts
   WHERE id = '<postId>';
   ```
   Expected: `meta_identity_status = 'pending'`, `meta_post_id = NULL`, `status = 'scheduled'`.
3. **After publish-worker runs (post delivered to Meta):**
   ```sql
   SELECT meta_identity_status, meta_post_id, status FROM published_posts
   WHERE id = '<postId>';
   ```
   Expected: `meta_identity_status = 'captured'`, `meta_post_id IS NOT NULL`, `status = 'published'`.
4. **SLA test:** Pause the publish-worker. Wait 65 seconds. Query `system_notices` for `category = 'PUBLISH_IDENTITY_SLA_BREACH'`. Expected: 1 row appears. Resume worker. Confirm `meta_identity_status` transitions to `captured`. Confirm notice is not re-raised after resolution.
5. **Capture-failed test:** In a dev/synthetic-mode run, simulate Meta returning `{ success: true, postId: "" }`. Confirm `meta_identity_status = 'capture_failed'`, `meta_post_id = NULL`, and a `PUBLISH_IDENTITY_LOST` notice appears.
6. **Lineage verification:** After `captured`, run the lineage resolver. Confirm the log shows `OWNED_POST_LINEAGE_RESOLVED state=planned_direct method=platform_post_id confidence=1.0`.

---

## Section 3 — Problem 3: Instagram competitor data dead since May 15 with no user-facing signal

### 3.1 Decision 3a — Repair the fuel

#### Current state

All 13 Instagram competitors have `fetch_method = 'BLOCKED_BY_PLATFORM'`. The competitor fetch path in `data-acquisition.ts:731` calls:

```ts
// data-acquisition.ts:731
const scrapeResult = await scrapeInstagramProfile(competitor.profileLink, proxyCtx, maxPosts, accountId);
// No opts argument → allowApifyFallback defaults to undefined (false)
```

The Apify fallback already exists in `profile-scraper.ts:1225`:
```ts
if (posts.length === 0 && opts?.allowApifyFallback) {
  // scrapeInstagramViaApify(...)
}
```

The owned-post scraper ALREADY passes `{ allowApifyFallback: true }` (`user-channel-scraper.ts:283`). The competitor path does not. This is the sole code-level gap.

The Apify Instagram actor (`apify~instagram-profile-scraper`) is already proven working on the owned path. `instagram-apify-scraper.ts` was created 2026-07-20 precisely for this. The timeout is `APIFY_RUN_TIMEOUT_MS = 120_000` (2 min), already accommodating the longer Apify run time.

#### Recommendation: Option A (enable Apify fallback on competitor path)

**Rationale:** Option B accepts permanent blindness on competitor intelligence. Option C adds complexity and partial coverage. Option A is low-risk because the code path already exists, is already tested on the owned path, and requires a single-line change at `data-acquisition.ts:731`.

**One guard required:** The competitor fetch runs under the fetch-orchestrator's per-competitor runtime budget (`BASE_RUNTIME_PER_COMPETITOR_MS = 100_000` at `fetch-orchestrator.ts:136`). An Apify run takes up to 120 seconds. The budget must be raised to at least `180_000ms` per competitor when Apify is the active rung, or the orchestrator must treat an Apify run as a non-budgeted special case (similar to how TikTok Apify is handled in `tiktok-apify-scraper.ts`). **This must be confirmed before implementation.**

**APIFY_API_KEY dependency:** `instagram-apify-scraper.ts:34` returns null if `APIFY_API_KEY` is not set. If the key is absent, the fallback is silently skipped (`profile-scraper.ts:1228–1229`). The key must be present as a secret. **This is a pre-condition for implementation.**

#### Cost estimate

Apify's `apify~instagram-profile-scraper` actor: pricing is ~$0.50 per 1000 Actor compute units (ACU). Each profile scrape for ~30 posts consumes approximately 0.5–1 ACU.

| Scenario | Count | ACU/run | Runs/week | Cost/week |
|---|---|---|---|---|
| 13 competitors, 1 run/day | 13 | 0.75 avg | 91 | ~$0.034 |
| 13 competitors, 3 runs/day | 13 | 0.75 avg | 273 | ~$0.10 |

**Estimated cost: < $0.50/week at current competitor count and daily cadence.** This is negligible. The constraint is not cost — it is Apify API key availability and the per-competitor runtime budget (see above guard).

#### What this does NOT fix

The `BLOCKED_BY_PLATFORM` cooldown logic at `data-acquisition.ts:577`. Even with Apify fallback enabled, a competitor must pass the 6-hour cooldown gate (`BLOCKED_PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000`) before a new scrape is attempted. On the next probe cycle, Bright Data will still fail → Apify fallback triggers → succeeds. The transition from all-blocked to active data will take at most one 6-hour cooldown cycle per competitor after the fix ships.

### 3.2 Decision 3b — Surface degradation to the user

#### Current degradation surfacing (audited)

| Layer | What exists | Audience |
|---|---|---|
| MIv3 snapshot `telemetry._provenance.degraded` | Written when ≥50% competitors have 0 posts (`engine.ts:867`) | Internal — not queryable |
| `system_notices` `SCRAPER_PROVIDER_DEGRADED` | Written by `interpreter.ts:289` based on `mi_fetch_jobs` failures in last 60 min | `audience: 'operator'` only |
| UI | Nothing | — |

The `system_notices` schema at `shared/schema.ts:1533` has an `audience` column. The schema comment is explicit: "During the observe-only phase (Steps 1–7 of the Guardian rollout) the interpreter only writes `audience='operator'` rows. `audience='user'` stays empty until copy review unlocks each category individually."

This is the designed gate. The design below proposes promoting ONE notice category to `audience='user'` with appropriate copy.

#### Proposed freshness thresholds

| State | Definition | Label |
|---|---|---|
| `fresh` | Last competitor post for this platform: < 7 days ago | (no warning) |
| `watching` | 7–14 days | "Competitor data is 7+ days old — we're working on a refresh." |
| `stale` | 14–30 days | "Competitor data is [N] days old. Insights may not reflect current activity." |
| `unavailable` | > 30 days OR `fetch_method = 'BLOCKED_BY_PLATFORM'` for all competitors on platform | "Competitor Instagram data is currently unavailable. Last updated [date]." |

Thresholds rationale: 7 days is a typical content cadence; by 14 days a competitor could have run a full campaign cycle without Avyron seeing it. 30 days is the absolute ceiling beyond which presenting any competitor insight as current is misleading.

#### Schema: new `system_notices` category for user audience

```
category:       'COMPETITOR_DATA_STALE'
severity:       'warning' (watching/stale) | 'degraded' (unavailable)
audience:       'user'
copyKey:        'user.competitor_data_stale'
correlationKey: 'COMPETITOR_DATA_STALE:<account_id>:<platform>'
copyVars:       { platform, ageDays, lastFetchDate, state: 'watching'|'stale'|'unavailable' }
```

The interpreter (`operations-guardian/interpreter.ts`) already has the infrastructure. A new classifier function `classifyCompetitorDataStaleness()` is added there, parallel to the existing `classifyScraperProviderDegradedSignals()` at line ~873. It queries:

```sql
SELECT platform,
       MAX(created_at) as newest_post,
       EXTRACT(DAY FROM now() - MAX(created_at)) as age_days
FROM ci_competitor_posts
WHERE account_id = $1
GROUP BY platform;
```

And also checks `ci_competitors.fetch_method` for `BLOCKED_BY_PLATFORM` prevalence.

**Gate:** `audience='user'` rows require copy review per the schema comment. The copy for `'user.competitor_data_stale'` must be reviewed by Samir before this notice fires. Implementation writes the notice; activation of the user-facing surface requires explicit copy approval (not a code change — a configuration decision).

#### UI surface design

**Component to extend:** The competitive intelligence panel(s) in the dashboard. No new component is needed — extend the existing competitor overview section.

**Per-platform staleness banner:**

When `system_notices` has an open row with `category = 'COMPETITOR_DATA_STALE'` and `audience = 'user'` for the current account:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚠ Instagram competitor data is 73 days old (last updated May 15).    │
│   Insights shown below reflect past activity and may not be current. │
└──────────────────────────────────────────────────────────────────────┘
```

For `unavailable` state:
```
┌──────────────────────────────────────────────────────────────────────┐
│ ✕ Instagram competitor data is currently unavailable.                │
│   Last successful update: May 15, 2026. We're working on restoring   │
│   access. Existing insights are shown for reference only.            │
└──────────────────────────────────────────────────────────────────────┘
```

**Per-competitor last-fetch timestamp:** Add a `last_scraped_at` display field to each competitor card. Source: `MAX(ci_competitor_posts.created_at) WHERE competitor_id = ?`. This is a read-only addition to the existing competitor list query.

**No zeros-as-fresh behavior:** When a competitor has `BLOCKED_BY_PLATFORM` status, their card shows the last-known data with a timestamp rather than rendering empty metrics as current. The banner (above) is shown at the platform level; the timestamp is shown per-competitor.

#### Interaction with existing Operations Guardian signal

The existing `SCRAPER_PROVIDER_DEGRADED` operator notice is NOT retired. It serves a different purpose (high-frequency fetch failures in the last hour, from `mi_fetch_jobs`). The new `COMPETITOR_DATA_STALE` user notice is a lower-frequency, age-based signal.

The two signals are complementary:
- `SCRAPER_PROVIDER_DEGRADED` (`operator`) → alerts the operator about an active failure event
- `COMPETITOR_DATA_STALE` (`user`) → informs the end user that the data they are viewing is old

The interpreter's `fullyObserved` set (`interpreter.ts:929`) already tracks `SCRAPER_PROVIDER_DEGRADED`. `COMPETITOR_DATA_STALE` is added to the same set.

### 3.3 Subsystems touched and gate/score/verdict impact

| Subsystem | Change type | Gate/score/verdict weakened? |
|---|---|---|
| `data-acquisition.ts:731` | Add `{ allowApifyFallback: true }` opt | No — adds a fallback rung, does not change existing logic |
| `fetch-orchestrator.ts` | Raise per-competitor runtime budget when Apify active | No — budget is an operational parameter, not a gate |
| `operations-guardian/interpreter.ts` | New classifier function | No |
| `system_notices` | New notice category (`COMPETITOR_DATA_STALE`) | No |
| Competitive intelligence UI | Add staleness banner + last-fetch timestamp | No |

No MIv3 signals, no judge thresholds, no scoring rules are changed.

### 3.4 Live verification plan

**3a — Apify fallback working:**
1. Confirm `APIFY_API_KEY` is set as a secret.
2. Trigger a competitor scrape for one competitor currently in `BLOCKED_BY_PLATFORM`. Confirm `ci_competitor_posts` gets new rows.
3. Check `ci_competitors.fetch_method` — it should transition away from `BLOCKED_BY_PLATFORM` after a successful Apify run.
4. Verify log: `[CI Scraper] APIFY_ACTOR: profile=<handle> posts=<N>` (from `profile-scraper.ts:1239–1242`).

**3b — User notice:**
1. Confirm `system_notices` has an open row for `category = 'COMPETITOR_DATA_STALE'` and `audience = 'user'`.
2. Query:
   ```sql
   SELECT category, severity, audience, copy_key, copy_vars, first_seen_at
   FROM system_notices
   WHERE category = 'COMPETITOR_DATA_STALE' AND resolved_at IS NULL;
   ```
3. After Apify produces fresh posts (age < 7 days), confirm the notice auto-resolves (no open row).
4. Confirm the UI banner appears when the notice is open and disappears when resolved.

---

## Section 4 — Sequencing recommendation

### Order: Problem 3 → Problem 1 → Problem 2

**Problem 3 first (fuel repair + user visibility):**

Problem 3 is the prerequisite for Problem 2. Without fresh competitor posts, the MIv3 engine cannot produce a fresh snapshot. Without a fresh snapshot, the DNA auto-trigger (Problem 2 fix) has nothing to write. Building Problem 2 first produces infrastructure that cannot be exercised until Problem 3 is fixed.

Problem 3 is also the highest user-impact fix: 73 days of stale data with no visible warning. The user-facing staleness banner is independently valuable regardless of whether Problems 1 and 2 are fixed.

**Problem 1 second (identity capture):**

Problem 1 is independent of Problems 2 and 3. It can be built in parallel with Problem 3, but is lower urgency because the owned scraper has 0 posts in the DB — there is nothing for the lineage resolver to match against. Problem 1 must be complete before owned posts accumulate in production.

Sequence within Problem 1: migration first (`meta_identity_status` column, backfill), then publish-worker update, then SLA monitor. Do not ship the SLA monitor without the column.

**Problem 2 third (DNA write path + owned posts entry):**

Problem 2 requires:
- Problem 3 fixed → fresh competitor posts available → DNA generation has valid inputs
- Problem 1 fixed (or at least in progress) → owned posts starting to accumulate → `ownedContentScores` has data to include

The Deterministic DNA persistence (`competitor_dna_snapshots` table) can be built and backfilled from existing 140 posts immediately, independently of Problems 1 and 3. The Synthesized DNA auto-trigger must wait for Problem 3.

### Dependency graph

```
Problem 3a (Apify fallback)
  └─ enables → Problem 2 (Synthesized DNA auto-trigger)

Problem 3b (staleness UI)
  └─ independent, can ship alongside 3a

Problem 1 (identity capture)
  └─ independent; enables owned post lineage to work when posts accumulate

Problem 2 / Deterministic DNA persistence
  └─ can backfill from existing 140 posts immediately (independent)

Problem 2 / Synthesized DNA auto-trigger
  └─ requires Problem 3a first
  └─ benefits from Problem 1 being complete (owned scores populated)
```

**Recommended implementation order:**
1. Problem 3b (user-facing staleness banner — no infrastructure dependency, highest user value)
2. Problem 3a (Apify fallback — one-line change + runtime budget confirmation)
3. Problem 1 migration + publish-worker update
4. Problem 2 / Deterministic DNA persistence + backfill
5. Problem 2 / Synthesized DNA auto-trigger (after first fresh snapshot from 3a)
6. Problem 2 / Owned posts entry into DNA (after owned posts accumulate)
7. Problem 1 / SLA monitor (after identity capture is proven working)

---

## Section 5 — Open questions requiring a decision before implementation

**Q1 — Per-competitor runtime budget for Apify (Problem 3a, blocking)**

The fetch-orchestrator caps each competitor at `BASE_RUNTIME_PER_COMPETITOR_MS = 100_000ms` (`fetch-orchestrator.ts:136`). Apify runs take up to `APIFY_RUN_TIMEOUT_MS = 120_000ms` (`instagram-apify-scraper.ts`). The Apify run will hit the orchestrator's budget ceiling before it completes.

Decision needed: (a) raise `BASE_RUNTIME_PER_COMPETITOR_MS` to 150,000–180,000ms for Instagram when Apify is the active rung, OR (b) treat Apify runs as non-budgeted (outside the orchestrator's runtime accounting). Option (b) is cleaner but requires confirming there is no job-level wall-clock timeout that would also need adjusting.

**Q2 — `APIFY_API_KEY` secret availability (Problem 3a, blocking)**

`instagram-apify-scraper.ts:34` checks `process.env.APIFY_API_KEY`. If not set, the fallback is silently skipped. Is `APIFY_API_KEY` currently set as a Replit secret? If not, this must be set before Problem 3a ships.

**Q3 — `audience='user'` copy approval for `COMPETITOR_DATA_STALE` (Problem 3b)**

The `system_notices` schema comment explicitly states user-audience notices require copy review before activation. The proposed copy is in Section 3.2. This copy needs sign-off before the notice can fire for users. Should this be gated behind a feature flag, or is sign-off here (this document) sufficient?

**Q4 — Freshness thresholds (Problem 3b)**

The proposed thresholds (7 / 14 / 30 days) are a recommendation. Do these match your expectations for how quickly stale competitor data becomes misleading for your users?

**Q5 — Synthesized DNA generation when inputs are degraded (Problem 2)**

The design proposes: skip Synthesized DNA generation when `provenanceDegraded = true` (≥50% competitors had 0 posts). This means no `content_dna` row is written during a degraded run. The alternative is to generate DNA from whatever competitor posts are available (even a partial set) and mark the row with a degradation flag.

Decision: skip-and-warn (current proposal) vs. partial-generation-with-flag?

**Q6 — Owned posts in DNA — timing dependency (Problem 2)**

`computeOwnedPerformanceSummary()` reads from `owned_content_scores`. The content scorer only runs after `owned_posts` has sufficient data (minimum sample size per `scoring-config.ts`). With `owned_posts` currently empty, the owned performance block will be NULL for the first several DNA generations. Is it acceptable to ship the DNA auto-trigger before owned scoring data exists, with the understanding that `owned_posts_included = false` for the first several weeks?

**Q7 — tsc baseline (all problems)**

Current TSC baseline: 720 errors. The target is 0 net-new type errors vs. baseline. The proposed schema additions (new table, new columns) will require updating Drizzle type inference across multiple reader files. Before implementation, a TSC check should be run immediately after schema changes to confirm no new errors appear in the reader files. No design decision needed — this is a pre-implementation checklist item, not a question. Flagging it explicitly so the implementation prompt can include "run TSC after schema migration, confirm 0 net-new."
