# scrape-lineage-truth-audit-2026-07-26.md

**Read-only audit. No code changes made. All claims backed by file:line, DB output, or log output.**

---

## A1 — What identifiers are persisted at publish time?

**Relevant file:** `server/publish-pipeline.ts`

The publish pipeline executes in two steps. The initial `INSERT` happens at **line 205**:

```ts
// server/publish-pipeline.ts:205–220
const inserted = await db.insert(publishedPosts).values({
  accountId,
  mediaItemId: mediaItemId || null,
  mediaType: normalizedType,
  mediaUri: mediaUri || null,
  caption: "",                           // always empty string at insert time
  platform: platform || "Instagram",
  scheduledDate: schedDate,
  status: "generating_caption",
  goal,
  audience,
  cta,
  series: series || null,
  offer: offer || null,
  campaignId,
}).returning();
```

**At initial INSERT:**
- `metaPostId` — **NOT written.** The column exists in the schema (`shared/schema.ts:677`) but is never populated during publish. It is written only after Meta confirms publication (a separate async path not found in this pipeline). This is the field that the lineage resolver uses as its highest-confidence match key (Step 1 in A2 below).
- `shortcode` — **Column does not exist on `published_posts`.** (Confirmed: DB rejected a query including it. `shortcode` is only a column on `owned_posts` and `ci_competitor_posts`.)
- `hookStyle`, `contentAngle`, `plannedSlot`, `lineageSource`, `planId`, `calendarEntryId`, `studioItemId` — **NOT in the initial INSERT.**

A follow-up `UPDATE` at **line 276** writes the plan-level fields:

```ts
// server/publish-pipeline.ts:276–289
await db.update(publishedPosts)
  .set({
    caption: captionResult.winner.text,
    status: "scheduled",
    planId: lineage.planId,
    calendarEntryId: lineage.calendarEntryId,
    studioItemId: lineage.studioItemId,
    hookStyle: lineage.hookStyle,
    contentAngle: lineage.contentAngle,
    plannedSlot: lineage.plannedSlot,
    lineageSource: lineage.lineageSource,
    updatedAt: new Date(),
  })
  .where(eq(publishedPosts.id, postId));
```

**Real DB row:**

```
SELECT id, meta_post_id, studio_item_id, plan_id, hook_style,
       content_angle, lineage_source, published_at
FROM published_posts ORDER BY created_at DESC LIMIT 3;

 id | meta_post_id | studio_item_id | plan_id | hook_style | content_angle | lineage_source | published_at
----+--------------+----------------+---------+------------+---------------+----------------+--------------
(0 rows)
```

`published_posts` has zero rows in this environment. The pipeline code exists and has been exercised in migration migrations (migration 041 retroactively sets all pre-existing rows to `lineage_source = 'legacy'`), but no posts have been published through Studio in this DB.

---

## A2 — Matching logic that links a scraped post to published_posts

**Relevant file:** `server/performance-loop/lineage-resolver.ts`

The resolver (`resolveOwnedPostLineage`, line 124) fetches all `owned_posts` in state `'unmatched'` or `'ambiguous'` for the account+campaign, then applies a strict priority cascade. The cascade is documented in the file header (lines 1–25) and implemented in `resolveOne()` (line 272):

**Step 1 — Exact platform post ID** (`lineage-resolver.ts:278`):
```ts
const byId = pubRows.find((p) => p.metaPostId != null && p.metaPostId === post.postId);
if (byId) return fromPublished(byId, "platform_post_id", 1.0);
```
Matches `owned_posts.post_id` against `published_posts.meta_post_id`. Confidence = 1.0. This is the primary key for linking back to a publish event.

**Step 2 — Stored post URL** (`lineage-resolver.ts:281–282`):
```
// 2. Exact stored post URL — published_posts persists no post permalink
//    today. Explicit no-op (never approximated with media_uri).
```
Documented as an **explicit no-op**. `published_posts` has no `permalink` column.

**Step 3 — Exact normalized caption + 48 h time window** (`lineage-resolver.ts:284–300`):
```ts
const direct = pubRows.filter((p) => {
  if (!p.caption || normalizeCaption(p.caption) !== normalizedPost) return false;
  if (p.platform && p.platform !== post.platform) return false;
  if (p.publishedAt && post.postedAt) {
    return Math.abs(p.publishedAt.getTime() - post.postedAt.getTime()) <= DIRECT_PUBLISH_WINDOW_MS; // 48h
  }
  return true;
});
if (direct.length === 1) return fromPublished(direct[0], "direct_publish_caption_time", 0.9);
if (direct.length > 1) return { ...UNMATCHED, state: "ambiguous", ... };
```

**Step 4 — Caption fingerprint vs `studio_items`** (`lineage-resolver.ts:302–342`):
Jaccard/containment similarity (max of the two) against studio item captions. Threshold = 0.85 with timestamps, 0.92 without. Ambiguous if top two candidates are within 0.10 of each other.

**Step 5 — Media fingerprint** (`lineage-resolver.ts:344`):
```
// 5. Media fingerprint — no stored media hashes exist; unavailable, not faked.
```

**Step 6 — Unmatched** (the `UNMATCHED` sentinel, all lineage fields NULL).

**Real DB row:**
```
SELECT id, post_id, shortcode, lineage_state, match_method, match_confidence,
       matched_published_post_id, hook_style, content_angle, content_type
FROM owned_posts ORDER BY created_at DESC LIMIT 3;

 id | post_id | shortcode | lineage_state | match_method | match_confidence | matched_published_post_id | hook_style | content_angle | content_type
----+---------+-----------+---------------+--------------+------------------+---------------------------+------------+---------------+--------------
(0 rows)
```

`owned_posts` has zero rows in this environment. The resolver code exists and is invoked after `recordOwnedPostObservations()` returns new post IDs.

---

## A3 — Fields propagated from published_posts when a match succeeds

**Relevant file:** `server/performance-loop/lineage-resolver.ts:256–269` and `327–339`

**From a `published_posts` match (`planned_direct` or `unplanned`):**
```ts
// lineage-resolver.ts:256–269
function fromPublished(pub: PubRow, method: string, confidence: number): ResolvedLineage {
  const planned = pub.planId != null || pub.lineageSource === "planned";
  return {
    state: planned ? "planned_direct" : "unplanned",
    method,
    confidence,
    matchedPublishedPostId: pub.id,
    matchedPlanId: pub.planId,
    matchedCalendarEntryId: pub.calendarEntryId,
    matchedStudioItemId: pub.studioItemId,
    hookStyle: pub.hookStyle,
    contentAngle: pub.contentAngle,
    contentType: null,           // ← always null; published_posts has no contentType column
  };
}
```

**From a `studio_items` fingerprint match (`planned_matched`):**
```ts
// lineage-resolver.ts:327–339
return {
  state: item.planId != null ? "planned_matched" : "manual_matched",
  method: "caption_fingerprint",
  confidence: Number(top.sim.toFixed(3)),
  matchedPublishedPostId: null,
  matchedPlanId: item.planId,
  matchedCalendarEntryId: item.calendarEntryId,
  matchedStudioItemId: item.id,
  hookStyle: item.hook,
  contentAngle: item.contentAngle,
  contentType: item.contentType,   // ← populated from studio_items
};
```

These fields are then written to `owned_posts` at lines 203–219:
`lineageState`, `matchMethod`, `matchConfidence`, `matchedPublishedPostId`, `matchedPlanId`, `matchedCalendarEntryId`, `matchedStudioItemId`, `hookStyle`, `contentAngle`, `contentType`.

**Specifically requested fields:**

| Field | Propagated? | Source |
|---|---|---|
| `content_type` | **Only via studio_items match**; NULL for published_posts match | `studio_items.contentType` |
| `hook_style` | Yes (both paths) | `published_posts.hookStyle` or `studio_items.hook` |
| `angle` / `content_angle` | Yes (both paths) | `published_posts.contentAngle` or `studio_items.contentAngle` |
| `mix_bucket` | **Not in schema.** No column in `owned_posts`, not propagated | — |
| `planned_slot` | **Not in schema.** No column in `owned_posts`, not propagated | — |
| `campaign_id` | Stored on `owned_posts.campaignId` at insert time (not from lineage) | Set by tracker at scrape |

**Real row:** 0 rows in `owned_posts` — cannot show a live populated example.

---

## A4 — What happens when match fails (pre-tracker / historical posts)

**Relevant file:** `server/performance-loop/lineage-resolver.ts:106–117`, `346–348`, `354–358`

When no step matches, the resolver returns the `UNMATCHED` sentinel:

```ts
// lineage-resolver.ts:106–117
const UNMATCHED: ResolvedLineage = {
  state: "unmatched",
  method: null,
  confidence: null,
  matchedPublishedPostId: null,
  matchedPlanId: null,
  matchedCalendarEntryId: null,
  matchedStudioItemId: null,
  hookStyle: null,
  contentAngle: null,
  contentType: null,
};
```

These are written verbatim to `owned_posts`. The log entry is:

```ts
// lineage-resolver.ts:354–355
console.warn(`[LineageResolver] OWNED_POST_LINEAGE_MISSING ${base}
  — no plan artifact matched; post contributes to account baseline only`);
```

**Tags applied:** None. There is no "orphan", "baseline", or "unplanned" tag for an unmatched post. The `lineage_state` CHECK constraint allows `'unmatched'` as a permanent state (`server/migrations/sql/044_owned_post_tracking.sql`, the ALTER TABLE … ADD CONSTRAINT line). Posts with `lineage_state = 'unmatched'` are silently excluded from plan-dimension scoring but still contribute to account-level engagement baseline.

**Real row:** 0 rows in `owned_posts`.

---

## A5 — Is there a classifier that infers hook_style/angle/content_type from caption?

**No.** There is no such classifier for owned posts.

The only caption classifier that exists for owned posts is **`server/pipeline/lanes/user/post-classification.ts`** (paid/organic/uncertain). Its file header is explicit:

```ts
// post-classification.ts:9–11
// - LABEL ONLY. Output MUST NOT feed Q1, Q2, the DNA working verdict, the
//   outcome-regression check, or any verdict boundary. It is descriptive
//   metadata for the explanation layer.
```

Migration 044 (`server/migrations/sql/044_owned_post_tracking.sql`) includes a column comment that enforces this:

```sql
-- Plan-derived dimensions — populated ONLY from a supported lineage match
-- (planned_direct / planned_matched). Never inferred from the caption.
hook_style text,
content_angle text,
content_type text,
```

And `lineage-resolver.ts:23` repeats the invariant:

```
// Plan dimensions (hook/angle/type) are copied ONLY from a matched artifact,
// never inferred from the caption itself.
```

**Conclusion:** Owned posts get `hookStyle`, `contentAngle`, and `contentType` **only** from a `publish_history` (`published_posts`) or `studio_items` match. If the match fails, those fields stay NULL permanently unless a re-run of the resolver finds a match.

---

## B1 — When the scraper returns a competitor post, is it classified?

**Partially — and only for TikTok.**

**`hookText` / `hookSource`** — Populated for TikTok only:

```ts
// server/competitive-intelligence/tiktok-apify-scraper.ts:166, 172–173
const { hookText, hookSource } = deriveHook(caption, transcript);
...
hookText,
hookSource,
```

```ts
// server/competitive-intelligence/tiktok-apify-scraper.ts:236–251
// deriveHook: takes first 10 words of transcript as hook if transcript exists
// and is > 5 chars; otherwise falls back to caption first line.
```

For Instagram, `hookText` and `hookSource` are **never set by the scraper.** The DB confirms this:

```
SELECT id, competitor_id, platform, post_id, hook_text, hook_source,
       has_cta, cta_type, has_offer, created_at
FROM ci_competitor_posts ORDER BY created_at DESC LIMIT 3;

                  id                  |          competitor_id          | platform  |       post_id       | hook_text | hook_source | has_cta |  cta_type   | has_offer |         created_at
--------------------------------------+---------------------------------+-----------+---------------------+-----------+-------------+---------+-------------+-----------+----------------------------
 d32cc215-...                         | 10910b0e-...                    | instagram | 3895987142844004283 |           |             | f       |             | f         | 2026-05-15 19:12:56
 565d68fd-...                         | 10910b0e-...                    | instagram | 3896806813260345416 |           |             | t       | Exclusivity | f         | 2026-05-15 19:12:56
 4f9d1394-...                         | 10910b0e-...                    | instagram | 3893985698845586272 |           |             | f       |             | f         | 2026-05-12 18:14:25
```

`hook_text` and `hook_source` are **empty** for all Instagram rows.

**`hasCTA` / `ctaType` / `hasOffer`** — Set by the profile-level scraper (not per-post caption analysis). The value for these fields comes from the competitor profile ingestion step, not from individual post text.

**In-memory hook/narrative/CTA archetype classification** — This exists but is **never persisted back to `ci_competitor_posts`**. It runs in `server/market-intelligence-v3/content-dna.ts` via regex pattern matching on caption text. Output is a `CompetitorContentDNA` object stored transiently in the MIv3 engine run (see B2).

---

## B2 — Where do competitor post classifications end up?

**Data flow:**

1. MIv3 engine fetches competitor post data (from `ci_competitor_posts` + profile fields), builds `CompetitorInput[]`
2. `computeAllContentDNA(competitors)` runs at **`server/market-intelligence-v3/engine.ts:931`** — pure in-memory regex analysis
3. Result (`CompetitorContentDNA[]`) is serialized as JSON into `mi_snapshots.content_dna_data` at **`engine.ts:1326`**:
   ```ts
   contentDnaData: JSON.stringify(contentDnaResults),
   ```
4. On snapshot reuse, it is parsed back at **`engine.ts:1564`**:
   ```ts
   contentDnaData: parseJsonSafe(snapshot.contentDnaData, null),
   ```

**Downstream consumers of `contentDnaData` (from snapshot):**

- **Positioning engine** — reads competitor narratives (`server/tests/positioning-engine-v3.test.ts:51` cites `contentDnaData` as the source of competitor narrative extraction)
- **Audience engine** — Semantic Bridge uses it when the primary dataset is too small (`server/audience-engine/engine.ts:1975`)
- **Orchestrator agent-context** — reads from the `content_dna` **table** (not the snapshot field) at `server/orchestrator/agent-context.ts:312`
- **Execution activation** — reads from the `content_dna` **table** at `server/execution-activation/engine.ts:416`
- **Commercial reasoning** — reads from the `content_dna` **table** at `server/commercial-reasoning/business-context-layer.ts:1044`

**Does it feed Content DNA (table)?** The `content_dna` table (the persistent store) is written by routes in `server/content-dna-routes.ts:367`, `server/root-bundle.ts:394`, and the execution-activation and commercial-reasoning engines — **not** by the MIv3 engine directly. The MIv3 engine writes only to `mi_snapshots`.

**Does it feed the Watchtower?** `server/watchtower/orchestrator.ts` has no direct join against `ci_competitor_posts`. The Watchtower consumes MIv3 snapshot data (which embeds the in-memory DNA) rather than querying competitor posts directly. UNKNOWN — could not verify the exact Watchtower read path without reading the full orchestrator (it was not searched completely).

**Does it feed the Performance Loop?** No join found between `content_dna` or `ci_competitor_posts` and any file in `server/performance-loop/`. The performance loop operates on `owned_posts` + `owned_post_snapshots` + `published_posts`.

---

## B3 — Current state of competitor Instagram data (post Bright Data outage ~July 19)

**DB — competitor fetch method:**

```sql
SELECT platform, fetch_method, COUNT(*) FROM ci_competitors
GROUP BY platform, fetch_method ORDER BY platform, COUNT(*) DESC;

 platform  |    fetch_method     | count
-----------+---------------------+-------
 instagram | BLOCKED_BY_PLATFORM |    13
```

All 13 registered Instagram competitors have `fetch_method = 'BLOCKED_BY_PLATFORM'`.

**DB — competitor post recency:**

```sql
SELECT platform, COUNT(*) as cnt, MAX(created_at) as newest, MIN(created_at) as oldest
FROM ci_competitor_posts WHERE created_at > now() - interval '14 days'
GROUP BY platform ORDER BY cnt DESC;

 platform | cnt | newest | oldest
----------+-----+--------+--------
(0 rows)
```

Zero competitor posts in the last 14 days. All 140 rows are instagram, newest = **2026-05-15**, oldest = **2026-04-02**:

```sql
SELECT ci_competitor_posts_total, newest, oldest FROM (
  SELECT COUNT(*) as ci_competitor_posts_total, MAX(created_at) as newest, MIN(created_at) as oldest
  FROM ci_competitor_posts
) t;

 ci_competitor_posts_total |           newest           |           oldest
---------------------------+----------------------------+----------------------------
                       140 | 2026-05-15 19:12:56.233019 | 2026-04-02 21:53:53.462732
```

**Degradation surfacing:**

- **Internal (MIv3 snapshot):** When ≥50% of competitors return 0 posts, the engine sets `_provenance: { degraded: true, reason: "PARTIAL_SCRAPE_FAILURE_Npct" }` which is folded into `mi_snapshots.telemetry._provenance` (`engine.ts:867–884`, `engine.ts:213–230`).
- **Operator-facing (Operations Guardian):** `server/operations-guardian/interpreter.ts:285–310` classifies a `SCRAPER_PROVIDER_DEGRADED` notice (severity = `warning`/`degraded`/`critical` by failed count) when `mi_fetch_jobs` shows failures in the past 60 minutes. `copyKey: "operator.scraper_provider_degraded"`.
- **User-facing UI:** UNKNOWN — could not verify. No degradation notice for Instagram was found in `client/` during the search. The Operations Guardian notice has `audience: "operator"`, not end-user audience.

**Conclusion:** Competitor Instagram data is silently stale from the user's perspective. The last post stored is from 2026-05-15. All subsequent scrape attempts result in `BLOCKED_BY_PLATFORM` before any data is fetched.

---

## C1 — What is Content DNA in the current codebase?

**Two distinct things share the name "Content DNA".**

### C1a — `content_dna` table (persistent store)

**Schema** (`shared/schema.ts:2630–2650`):

```ts
export const contentDna = pgTable("content_dna", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull(),
  accountId: varchar("account_id").notNull().default("default"),
  planId: varchar("plan_id"),
  messagingCore: text("messaging_core"),
  ctaDna: text("cta_dna"),
  hookDna: text("hook_dna"),
  narrativeDna: text("narrative_dna"),
  contentAngleDna: text("content_angle_dna"),
  visualDna: text("visual_dna"),
  formatDna: text("format_dna"),
  executionRules: text("execution_rules"),
  snapshot: text("snapshot"),
  contentInstructions: text("content_instructions"),
  status: text("status").notNull().default("active"),
  rootBundleId: varchar("root_bundle_id"),
  rootBundleVersion: integer("root_bundle_version"),
  generatedAt: timestamp("generated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});
```

**Real DB row:**

```
SELECT id, campaign_id, account_id, messaging_core IS NOT NULL as has_messaging,
       hook_dna IS NOT NULL as has_hook, narrative_dna IS NOT NULL as has_narrative,
       status, generated_at FROM content_dna ORDER BY generated_at DESC LIMIT 3;

 id | campaign_id | account_id | has_messaging | has_hook | has_narrative | status | generated_at
----+-------------+------------+---------------+----------+---------------+--------+--------------
(0 rows)
```

The `content_dna` table has **zero rows**.

### C1b — In-snapshot `CompetitorContentDNA` (transient, in `mi_snapshots.content_dna_data`)

Defined as a `CompetitorContentDNA` type in `server/market-intelligence-v3/types.ts`. Contains: competitor id/name, detected hook archetypes (shock/authority/curiosity/problem/question/statistic/story), narrative frameworks (mistake_fix/problem_solution/before_after/story_lesson/listicle/how_to), CTA frameworks (explicit/soft/narrative/trust), and evidence snippets. Stored as a JSON blob in `mi_snapshots.content_dna_data`. Not queryable as rows.

---

## C2 — What inputs feed Content DNA generation?

**Competitor posts only.**

`computeAllContentDNA()` at `server/market-intelligence-v3/engine.ts:931`:

```ts
// engine.ts:920–935
for (const comp of competitors) {
  const { sampledPosts, sampledComments } = applySampling(
    comp.posts || [], comp.comments || [], executionMode
  );
  comp.posts = sampledPosts;
  comp.comments = sampledComments;
}

const signalResults = computeAllSignals(competitors);
const contentDnaResults = computeAllContentDNA(competitors);
```

`competitors` is `CompetitorInput[]` — populated from `ci_competitor_posts` rows for the campaign. The input query (`server/market-intelligence-v3/content-dna.ts:2`, `193`, `256`) operates on `comp.posts` (scraped caption text). **Owned posts do not enter this computation.**

The `content_dna` table (C1a) is written by routes in `server/content-dna-routes.ts`, `server/root-bundle.ts`, and strategy engines — the input source for those routes is UNKNOWN from the files inspected. The table is currently empty.

---

## C3 — How does Content DNA connect to Performance Loop scoring?

**It does not.**

The performance loop files (`server/performance-loop/owned-post-tracker.ts`, `lineage-resolver.ts`, `content-scorer.ts`, `business-outcome-scorer.ts`, `interpretation.ts`, `scoring-config.ts`) contain no references to `content_dna`, `contentDna`, or `contentDnaData`. No grep match was found linking these two systems.

`content_dna` table is read by:

| File | Usage |
|---|---|
| `server/orchestrator/agent-context.ts:312` | Loaded into orchestrator context |
| `server/execution-activation/engine.ts:416` | Format priority alignment during plan activation |
| `server/commercial-reasoning/business-context-layer.ts:1044` | Business context enrichment |
| `server/root-bundle.ts:394` | Root bundle composition |
| `server/content-dna-routes.ts:367` | API read route |

The in-snapshot `contentDnaData` is read by the positioning engine and audience engine semantic bridge — neither of which is part of the performance loop scoring path.

---

## D1 — Plain-terms gap summary

### What a scraped owned post CAN currently tell the Performance Loop

- Raw engagement metrics at observation time: `likes`, `comments`, `views` (NULL-safe — missing metric stays NULL, never coerced to 0)
- Posting timestamp and checkpoint band (discovery / 24h / 72h / 7d / late / unknown_age)
- The post's presence on the owned profile (it exists, it was seen)
- If lineage resolves (`planned_direct` or `planned_matched`): which plan/calendar entry/studio item it came from, `hookStyle`, `contentAngle`, `contentType` (contentType only from studio_items path)

### What a scraped owned post CANNOT currently tell the Performance Loop

- `mix_bucket` — not a field anywhere in the owned post or publish schema
- `planned_slot` — not persisted on `owned_posts` (present on `published_posts` via migration 041, but not propagated to `owned_posts` by the resolver)
- `content_type` for posts matched via `published_posts` directly (always NULL from `fromPublished()`)
- `hookStyle` / `contentAngle` / `contentType` for posts with `lineage_state = 'unmatched'` — these stay NULL permanently unless the resolver is re-run and finds a match. Historical posts (pre-tracker, pre-migration 044) that predate `studio_items` entries will likely stay unmatched.
- Follower count at post time (captured at scrape time as `followersAtObservation`, but only if the scraper returned it — this is best-effort)

### What a scraped competitor post CAN currently tell the Watchtower

- Hook archetypes (shock/authority/curiosity/etc.), narrative frameworks, CTA types — but **only** via in-memory classification run inside a fresh MIv3 engine pass, stored as JSON in `mi_snapshots.content_dna_data`
- Posting frequency, engagement ratio, CTA patterns, messaging tone — profile-level fields scraped and stored on `ci_competitors`
- Per-post: `hasCTA`, `ctaType`, `hasOffer`, caption text, media type, likes, comments, views, timestamp
- For TikTok only: `hookText` and `hookSource` per post row

### What a scraped competitor post CANNOT currently tell the Watchtower

- Anything about Instagram competitors after 2026-05-15 — all 13 are `BLOCKED_BY_PLATFORM` and no new rows are being written
- `hookText` / `hookSource` for Instagram posts — these fields are empty in all 140 existing rows (TikTok scraper path only)
- Per-post hook archetype or narrative classification stored at the row level — these exist only as a bulk in-memory computation across all of a competitor's posts at MIv3 run time, never written back to `ci_competitor_posts`

---

## D2 — Where exactly does a scraped post get "lost" in terms of lineage?

### Owned posts

**Loss is at scrape time (data never captured):** `owned_posts` has 0 rows, meaning the owned scraper has not yet been invoked to produce rows in this DB. The `user-channel-scraper.ts` and `owned-post-tracker.ts` code exist and are complete, but no scrape run has produced records.

**Secondary loss — at resolution time (captured but lineage not resolved):** For posts that predate the tracker or that were published before `metaPostId` was reliably stored, Step 1 of the resolver (platform_post_id match) will fail because `published_posts.meta_post_id` was never written. Step 3 (caption exact match) requires the caption stored in `published_posts` at publish time — which is the **AI-generated winner caption**, not the original caption typed by the user. If the user edited the caption after Studio generation, the match will fail. Step 4 (caption fingerprint vs `studio_items`) is the fallback, but requires the studio item to exist (pre-Studio posts have no studio item).

**Break point with file+line evidence:**
- `lineage-resolver.ts:278` — Step 1 can only match if `published_posts.meta_post_id` IS NOT NULL. The publish pipeline **never writes `metaPostId`** at publish time (confirmed: not present in the `insert` at `publish-pipeline.ts:205–220`). It must be written by a separate post-publish sync. If that sync hasn't run, Step 1 always misses.
- `lineage-resolver.ts:281–282` — Step 2 is a permanent no-op (no permalink column).

### Competitor posts

**Loss is at scrape time:** `BLOCKED_BY_PLATFORM` means the scrape transport is never invoked. The fetch-orchestrator stamps the competitor row with `fetch_method = 'BLOCKED_BY_PLATFORM'` and a 24 h cooldown (`fetch-orchestrator.ts:914`). No posts are fetched; no rows are written to `ci_competitor_posts`. The existing 140 rows are from before the block (newest: 2026-05-15).

**Break point with file+line evidence:**
```ts
// server/market-intelligence-v3/fetch-orchestrator.ts:577
if (!forceRefresh && collectionMode !== "DEEP_PASS"
    && competitor.fetchMethod === "BLOCKED_BY_PLATFORM"
    && competitor.lastCheckedAt) {
  // ... 24h cooldown: skip fetch entirely
}
```

The competitor post data that does exist is also partially lost **at read time** for the DNA layer: `content_dna` table has 0 rows, so the persistent DNA store that strategy engines (`agent-context.ts`, `execution-activation`, `commercial-reasoning`) read from is entirely empty. The in-snapshot DNA in `mi_snapshots.content_dna_data` is the only active path — but it was last computed against posts from May 2026 or earlier.
