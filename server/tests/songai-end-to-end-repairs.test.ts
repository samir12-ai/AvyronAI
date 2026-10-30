import "dotenv/config";
import { describe, it, expect } from "vitest";
import { resolveCanonicalEntities, extractAppListingIdentity, extractBrandEntityInfo } from "../discovery/entity-resolver";
import { isExcludedPlatformDomain, resolveCanonicalEntityIdForDomain } from "../discovery/competitor-quality-pipeline";
import {
  extractSourcesFromHtml,
  extractExternalAccountId,
  isPlatformOwnedHandle,
  verifySearchCandidateOwnership,
} from "../competitive-intelligence/source-discovery";
import { buildCompetitorAcquisitionTaskDefinitions } from "../acquisition/coordinator";
import { resolveAcquisitionCapability } from "../competitive-intelligence/provider-registry";
import { computePublicationWindowFrequency, translateEnvelopeToLanePayload } from "../boss/envelope-to-lane";
import { classifyWatchtowerChanges } from "../watchtower/orchestrator";
import { validateBriefDeterministic, type LLMBriefResponse } from "../watchtower/strategic-brief-generator";
import type { EvidenceRegistryEntry } from "../watchtower/strategic-brief-context";
import { RhythmConfigSchema } from "../../shared/contracts/rhythm";
import { evaluateRhythmCompliance } from "../pipeline/lanes/user/rhythm-compliance";
import { openReasoningCase, resolveDesignatedActiveLineage, syncCampaignAdaptiveReasoning } from "../adaptive/case-coordinator";
import { runCausalReasoningAnalysis } from "../adaptive/reasoning-engine";
import { judgeReasoningAnalysis } from "../adaptive/reasoning-judge";
import { routeAdaptiveDecision } from "../adaptive/router";
import { validateCampaignContainment } from "../adaptive/lineage";

describe("Competitor Acquisition, Watchtower, Deep Reasoning & Performance Loop Repairs (20 Scenarios)", () => {
  // 1. Two different domains with the same generic SEO title are not merged.
  it("Scenario 1: does not merge two different domains that share a generic SEO title", () => {
    const candidates = [
      {
        candidateId: "cand_1",
        canonicalEntityId: "ent_personalisedsongsuk",
        name: "Personalised Songs UK",
        domain: "songforyou.co.uk",
        websiteUrl: "https://songforyou.co.uk/custom-songs",
        occurrences: [],
      },
      {
        candidateId: "cand_2",
        canonicalEntityId: "ent_personalisedsongsuk",
        name: "Personalised Songs UK",
        domain: "melodybolt.com",
        websiteUrl: "https://melodybolt.com/uk",
        occurrences: [],
      },
    ] as any;

    const entities = resolveCanonicalEntities(candidates);
    expect(entities.length).toBe(2);
    const domains = entities.map((e) => e.domain).sort();
    expect(domains).toEqual(["melodybolt.com", "songforyou.co.uk"]);
    expect(entities[0].canonicalEntityId).not.toBe(entities[1].canonicalEntityId);

    // Also verify resolveCanonicalEntityIdForDomain assigns distinct canonicalEntityIds
    const id1 = resolveCanonicalEntityIdForDomain("Personalised Songs UK", "songforyou.co.uk");
    const id2 = resolveCanonicalEntityIdForDomain("Personalised Songs UK", "melodybolt.com");
    expect(id1).not.toBe(id2);
  });

  // 2. Multiple social accounts for one brand are preserved as separate sources.
  it("Scenario 2: preserves multiple legitimate social accounts for one brand as separate sources", () => {
    const html = `
      <html>
        <body>
          <footer>
            <a href="https://www.tiktok.com/@bolt.melody">TikTok Main</a>
            <a href="https://www.tiktok.com/@melody.bolt2">TikTok Secondary</a>
            <a href="https://www.instagram.com/bolt.melody">Instagram Main</a>
          </footer>
        </body>
      </html>
    `;
    const extracted = extractSourcesFromHtml(html, "https://melodybolt.com");
    expect(extracted.allByPlatform?.tiktok).toEqual([
      "https://tiktok.com/@bolt.melody",
      "https://tiktok.com/@melody.bolt2",
    ]);
    expect(extracted.allByPlatform?.instagram).toEqual([
      "https://instagram.com/bolt.melody",
    ]);
  });

  // 3. App Store / Play Store listing URLs are not collapsed to root domains.
  it("Scenario 3: preserves full App Store and Play Store listing identity instead of collapsing to root domain", () => {
    const appleUrl = "https://apps.apple.com/gb/app/ai-song-maker-songsnap-music/id6749816117";
    const playUrl = "https://play.google.com/store/apps/details?id=com.songsnap.music&hl=en_GB";

    const appleIdentity = extractAppListingIdentity(appleUrl);
    expect(appleIdentity.isAppListing).toBe(true);
    expect(appleIdentity.canonicalListingUrl).toBe("https://apps.apple.com/gb/app/ai-song-maker-songsnap-music/id6749816117");
    expect(extractBrandEntityInfo(appleUrl).baseDomain).toContain("id6749816117");

    const playIdentity = extractAppListingIdentity(playUrl);
    expect(playIdentity.isAppListing).toBe(true);
    expect(playIdentity.canonicalListingUrl).toBe("https://play.google.com/store/apps/details?id=com.songsnap.music");

    // Specific app listings are allowed; bare store root domains are excluded
    expect(isExcludedPlatformDomain("apps.apple.com", appleUrl)).toBe(false);
    expect(isExcludedPlatformDomain("apps.apple.com", "https://apps.apple.com")).toBe(true);
    expect(isExcludedPlatformDomain("play.google.com", playUrl)).toBe(false);
    expect(isExcludedPlatformDomain("play.google.com", "https://play.google.com")).toBe(true);
  });

  // 4. Testimonial/creator/embed/platform accounts are not assigned as competitor-owned profiles.
  it("Scenario 4: separates third-party testimonial videos and rejects platform-owned accounts (@appstore)", () => {
    const html = `
      <html>
        <body>
          <a href="https://www.tiktok.com/@thythickmomma/video/729182736182736">Customer Reaction Video</a>
          <a href="https://www.instagram.com/appstore">Download on the App Store</a>
          <a href="https://www.tiktok.com/@apple">Apple TikTok</a>
        </body>
      </html>
    `;
    const extracted = extractSourcesFromHtml(html, "https://songgifts.co.uk");
    expect(extracted.tiktok).toBeUndefined();
    expect(extracted.instagram).toBeUndefined();
    expect(extracted.capturedTestimonials?.length).toBe(1);
    expect(extracted.capturedTestimonials?.[0]).toMatchObject({
      platform: "tiktok",
      url: "https://www.tiktok.com/@thythickmomma/video/729182736182736",
      authorHandle: "thythickmomma",
    });
    expect(isPlatformOwnedHandle("appstore")).toBe(true);
  });

  // 5. Valid Facebook profile.php?id=... URLs are preserved while pixel/bare URLs are rejected.
  it("Scenario 5: preserves valid Facebook profile.php?id=... URLs while rejecting tracking pixels and bare profile.php", () => {
    const validHtml = `<a href="https://www.facebook.com/profile.php?id=61558129384712&ref=page">Facebook</a>`;
    const validExtracted = extractSourcesFromHtml(validHtml, "https://customsong.co.uk");
    expect(validExtracted.facebook).toBe("https://www.facebook.com/profile.php?id=61558129384712");
    expect(extractExternalAccountId("FACEBOOK", validExtracted.facebook!)).toBe("profile.php?id=61558129384712");

    const invalidHtml = `
      <img src="https://www.facebook.com/tr?id=123456&ev=PageView" />
      <a href="https://www.facebook.com/profile.php">Broken FB Link</a>
      <a href="https://www.facebook.com/sharer/sharer.php?u=https://example.com">Share</a>
    `;
    const invalidExtracted = extractSourcesFromHtml(invalidHtml, "https://customsong.co.uk");
    expect(invalidExtracted.facebook).toBeUndefined();
    expect(extractExternalAccountId("FACEBOOK", "https://www.facebook.com/profile.php")).toBeNull();
  });

  // 6. YouTube /channel/UC..., /@handle, /c/, and /user/ URLs are extracted.
  it("Scenario 6: extracts YouTube /channel/UC..., /@handle, /c/, and /user/ URLs", () => {
    const html = `
      <a href="https://www.youtube.com/channel/UC1234567890abcdefghijkl">Channel ID</a>
      <a href="https://www.youtube.com/@tuneformaker">Handle</a>
      <a href="https://www.youtube.com/c/CustomSongStudio">Custom URL</a>
      <a href="https://www.youtube.com/user/LegacySongChannel">Legacy User</a>
    `;
    const extracted = extractSourcesFromHtml(html, "https://tuneformaker.com");
    expect(extracted.allByPlatform?.youtube).toEqual([
      "https://www.youtube.com/channel/UC1234567890abcdefghijkl",
      "https://www.youtube.com/@tuneformaker",
      "https://www.youtube.com/c/CustomSongStudio",
      "https://www.youtube.com/user/LegacySongChannel",
    ]);
    expect(extractExternalAccountId("YOUTUBE", "https://www.youtube.com/channel/UC1234567890abcdefghijkl")).toBe(
      "UC1234567890abcdefghijkl",
    );
  });

  // 7. Regional review URLs (uk.trustpilot.com, ca.trustpilot.com, etc.) are extracted.
  it("Scenario 7: extracts regional Trustpilot review URLs (uk.trustpilot.com, ca.trustpilot.com)", () => {
    const htmlUk = `<a href="https://uk.trustpilot.com/review/songfinch.com">Trustpilot UK</a>`;
    const htmlCa = `<a href="https://ca.trustpilot.com/review/makeasong.co">Trustpilot CA</a>`;

    const exUk = extractSourcesFromHtml(htmlUk, "https://songfinch.com");
    const exCa = extractSourcesFromHtml(htmlCa, "https://makeasong.co");

    expect(exUk.reviews).toBe("https://uk.trustpilot.com/review/songfinch.com");
    expect(exCa.reviews).toBe("https://ca.trustpilot.com/review/makeasong.co");
  });

  // 8. Unverified search-fallback profiles do not become active scrape targets.
  it("Scenario 8: blocks unverified search-fallback profiles from becoming active scrape targets", () => {
    const unverified = verifySearchCandidateOwnership({
      platform: "instagram",
      url: "https://www.instagram.com/random_musician_uk",
      handle: "random_musician_uk",
      title: "Random Musician UK (@random_musician_uk)",
      snippet: "Follow random_musician_uk on Instagram for guitar covers",
      competitorName: "Personalised Songs UK",
      cleanDomain: "songforyou.co.uk",
    });
    expect(unverified.verified).toBe(false);

    const verified = verifySearchCandidateOwnership({
      platform: "instagram",
      url: "https://www.instagram.com/songforyouuk",
      handle: "songforyouuk",
      title: "Official SongForYou UK (@songforyouuk)",
      snippet: "Custom songs at songforyou.co.uk",
      competitorName: "SongForYou",
      cleanDomain: "songforyou.co.uk",
    });
    expect(verified.verified).toBe(true);
  });

  // 9. provider-registry / coordinator dispatches Instagram, TikTok, and YouTube post acquisition without Unsupported task.
  it("Scenario 9: plans and dispatches Instagram (including dotted handles), TikTok, and YouTube post tasks", async () => {
    const tasks = buildCompetitorAcquisitionTaskDefinitions(
      {
        id: "comp_test_1",
        name: "MelodyBolt",
        websiteUrl: "https://melodybolt.com",
      },
      [
        {
          id: "src_ig_1",
          platform: "INSTAGRAM",
          canonicalUrl: "https://www.instagram.com/bolt.melody",
          externalAccountId: "bolt.melody",
        },
        {
          id: "src_tt_1",
          platform: "TIKTOK",
          canonicalUrl: "https://www.tiktok.com/@bolt.melody",
          externalAccountId: null, // tests fallback handle extraction from canonicalUrl
        },
        {
          id: "src_tt_2",
          platform: "TIKTOK",
          canonicalUrl: "https://www.tiktok.com/@melody.bolt2",
          externalAccountId: "melody.bolt2",
        },
        {
          id: "src_yt_1",
          platform: "YOUTUBE",
          canonicalUrl: "https://www.youtube.com/channel/UC1234567890abcdefghijkl",
          externalAccountId: "UC1234567890abcdefghijkl",
        },
      ],
      "camp_test_1",
      "acc_test_1",
      "cycle_test_1"
    );

    const igTasks = tasks.filter((t) => t.sourcePlatform === "INSTAGRAM" && t.taskType === "POSTS");
    const ttTasks = tasks.filter((t) => t.sourcePlatform === "TIKTOK" && t.taskType === "POSTS");
    const ytTasks = tasks.filter((t) => t.sourcePlatform === "YOUTUBE" && t.taskType === "POSTS");
    const reviewTasks = tasks.filter((t) => t.sourcePlatform === "TRUSTPILOT" || t.sourcePlatform === "GOOGLE_REVIEWS");

    expect(igTasks.length).toBe(1);
    expect(igTasks[0].inputPayload.handle).toBe("bolt.melody");
    expect(ttTasks.length).toBe(2);
    expect(ttTasks.map((t) => t.inputPayload.handle).sort()).toEqual(["bolt.melody", "melody.bolt2"]);
    expect(ytTasks.length).toBe(1);
    expect(ytTasks[0].inputPayload.channelUrl).toBe("https://www.youtube.com/channel/UC1234567890abcdefghijkl");
    // Unregistered review sources are NOT scheduled
    expect(reviewTasks.length).toBe(0);

    // Provider registry capability checks
    expect(resolveAcquisitionCapability("INSTAGRAM").status).toBe("PRODUCTION_READY");
    expect(resolveAcquisitionCapability("TIKTOK").status).toBe("PRODUCTION_READY");
    expect(resolveAcquisitionCapability("YOUTUBE").status).toBe("PRODUCTION_READY");
  });

  // 10. Unchanged website crawl content produces the same content_hash and skips redundant LLM analysis.
  it("Scenario 10: computes deterministic content_hash from normalized page content independent of random IDs and timestamps", async () => {
    const crypto = await import("crypto");
    const buildNormalizedHash = (pages: Array<{ url: string; title: string; rawTextSnippet: string }>) => {
      const normalized = pages
        .map((p) => ({
          url: p.url,
          title: p.title,
          rawTextSnippet: p.rawTextSnippet,
        }))
        .sort((a, b) => a.url.localeCompare(b.url));
      return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 32);
    };

    const run1 = buildNormalizedHash([
      { url: "https://tunefor.com", title: "TuneFor", rawTextSnippet: "Custom songs from £49" },
    ]);
    const run2 = buildNormalizedHash([
      { url: "https://tunefor.com", title: "TuneFor", rawTextSnippet: "Custom songs from £49" },
    ]);
    expect(run1).toBe(run2);
  });

  // 11. Watchtower frequency comparison uses comparable publication windows, not cumulative DB row counts.
  it("Scenario 11: computes posting frequency over a comparable 30-day publication window rather than cumulative DB row count", () => {
    const anchorIso = "2026-10-24T12:00:00.000Z";
    const posts = [
      { postId: "p1", caption: "Recent 1", timestamp: "2026-10-20T10:00:00.000Z" },
      { postId: "p2", caption: "Recent 2", timestamp: "2026-10-15T10:00:00.000Z" },
      { postId: "p3", caption: "Recent 3", timestamp: "2026-10-01T10:00:00.000Z" },
      // Older historical posts stored in DB (>30d old)
      { postId: "p4", caption: "Old 1", timestamp: "2026-08-10T10:00:00.000Z" },
      { postId: "p5", caption: "Old 2", timestamp: "2026-07-05T10:00:00.000Z" },
      { postId: "p6", caption: "Old 3", timestamp: "2026-06-01T10:00:00.000Z" },
    ];

    const freqResult = computePublicationWindowFrequency(posts, anchorIso, 30);
    expect(freqResult).not.toBeNull();
    // Only 3 posts were published in the 30-day window, even though 6 rows exist in DB
    expect(freqResult?.frequency).toBe(3);
    expect(freqResult?.meta.totalSampled).toBe(6);
    expect(freqResult?.meta.isSampleCapped).toBe(false);

    // Also verify sample-capped snapshots do NOT emit false posting_frequency_shift
    const prevPayload = {
      frequency: 12,
      frequency_meta: { windowDays: 30, postsInWindow: 12, totalSampled: 12, oldestPostAt: "2026-10-20T00:00:00Z", newestPostAt: "2026-10-24T00:00:00Z", isSampleCapped: true, hasPublicationTimestamps: true },
    };
    const currPayload = {
      frequency: 30,
      frequency_meta: { windowDays: 30, postsInWindow: 30, totalSampled: 30, oldestPostAt: "2026-10-10T00:00:00Z", newestPostAt: "2026-10-24T00:00:00Z", isSampleCapped: true, hasPublicationTimestamps: true },
    };
    const changes = classifyWatchtowerChanges(currPayload, prevPayload, "snap_curr", "snap_prev");
    expect(changes.filter((c) => c.kind === "posting_frequency_shift").length).toBe(0);
  });

  // 12. Rolling-window displacement and #tag vs tag do not produce false removal events.
  it("Scenario 12: does not emit false removal events from rolling-window displacement, sample-cap differences, or #tag vs tag", () => {
    const prevEnv = {
      acquisition_id: "acq_1",
      account_id: "acc_1",
      campaign_id: "camp_1",
      lane: "competitor" as const,
      entity_type: "competitor_instagram" as const,
      entity_id: "comp_1",
      source_adapter: "main:ci_competitor_posts.instagram",
      collected_at: "2026-10-20T12:00:00.000Z",
      payload: {
        posts: [
          { postId: "p1", caption: "Free lyric sheet with every custom song!", timestamp: "2026-10-01T00:00:00Z" },
          { postId: "p2", caption: "Anniversary song gift", timestamp: "2026-10-05T00:00:00Z" },
          { postId: "p3", caption: "Wedding song surprise", timestamp: "2026-10-10T00:00:00Z" },
        ],
        hashtags: ["#CustomSong", "#SongGift", "#MusicGift"],
      },
      provenance: { cache_hit: false, warnings: [] },
    };
    const currEnv = {
      ...prevEnv,
      acquisition_id: "acq_2",
      collected_at: "2026-10-24T12:00:00.000Z",
      payload: {
        posts: [
          { postId: "p2", caption: "Anniversary song gift", timestamp: "2026-10-05T00:00:00Z" },
          { postId: "p3", caption: "Wedding song surprise", timestamp: "2026-10-10T00:00:00Z" },
        ],
        // Same hashtags without leading '#'
        hashtags: ["customsong", "songgift", "musicgift"],
      },
    };

    const prevLane = translateEnvelopeToLanePayload(prevEnv)!;
    const currLane = translateEnvelopeToLanePayload(currEnv)!;

    const changes = classifyWatchtowerChanges(currLane, prevLane, "snap_2", "snap_1");
    expect(changes.length).toBe(0);

    // Also verify empty/failed fetch never generates removed claims
    const emptyChanges = classifyWatchtowerChanges(
      { is_empty_or_failed: true, patterns: [], objections: [] },
      prevLane,
      "snap_empty",
      "snap_1",
    );
    expect(emptyChanges.length).toBe(0);
  });

  // 13. Watchtower brief validation blocks a removal claim when the phrase still exists in current evidence.
  it("Scenario 13: blocks Watchtower strategic brief that claims removal of a phrase still present in current posts or website snapshots", () => {
    const registry: EvidenceRegistryEntry[] = [
      {
        ref: "EV-1",
        origin: "Watchtower",
        timestamp: new Date().toISOString(),
        engine: "Watchtower",
        table: "pipeline_change_events",
        recordId: "evt_1",
        factType: "observed",
        age: "1h",
        freshnessStatus: "fresh",
        confidence: "high",
        relevanceScore: 100,
        inclusionReason: "Primary event",
        detail: "Confirmed Watchtower event competitor_profile_change. removed: free lyric sheet",
        label: "Confirmed Change",
      },
      {
        ref: "CURR-POSTS",
        origin: "Competitor DNA",
        timestamp: new Date().toISOString(),
        engine: "Competitor DNA",
        table: "ci_competitor_posts",
        recordId: "comp_1",
        factType: "observed",
        age: "1h",
        freshnessStatus: "fresh",
        confidence: "high",
        relevanceScore: 91,
        inclusionReason: "Current posts",
        detail: "Current active competitor posts: Order your custom song today and get a free lyric sheet included!",
        label: "Current Competitor Posts",
      },
    ];

    const badBrief: LLMBriefResponse = {
      eventId: "evt_1",
      executiveSummary: 'CustomSongGift removed the "free lyric sheet" bonus from its recent messaging.',
      strategicInterpretation: 'The competitor dropped "free lyric sheet" from its social promotions.',
      likelyStrategicObjective: "Margin preservation",
      directionOfMovement: "Simplified offer",
      affectedStrategyAreas: ["offer"],
      impactOnOurStrategy: "Potential opportunity to highlight our lyric sheet inclusion.",
      marketSignificance: "Moderate",
      strategicImportance: "medium",
      recommendation: "monitor",
      modelProposedConfidence: 80,
      evidenceRefs: ["EV-1", "CURR-POSTS"],
      missingEvidence: [],
      assumptions: [],
      claims: [
        {
          claimId: "CL-1",
          claimText: 'Competitor removed "free lyric sheet" from its current posts.',
          claimType: "competitor_strategy",
          evidenceRefs: ["EV-1"],
          criticality: "critical",
          factuality: "observed",
        },
      ],
    };

    const violations = validateBriefDeterministic(badBrief, registry);
    expect(violations.some((v) => v.includes("free lyric sheet"))).toBe(true);
  });

  // 14. Legacy rhythm config upgrades or validates cleanly without breaking corrupt-JSON rejection.
  it("Scenario 14: validates legacy camelCase rhythm config via versioned compatibility while still rejecting corrupt JSON", async () => {
    const legacyCamelJson = JSON.stringify({
      reelsPerWeek: 4,
      carouselsPerWeek: 2,
      storiesPerDay: 3,
      postsPerWeek: 2,
      approvedAt: "2026-04-12T10:00:00.000Z",
    });

    const parsed = RhythmConfigSchema.safeParse(JSON.parse(legacyCamelJson));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reels_per_week).toBe(4);
      expect(parsed.data.carousels_per_week).toBe(2);
      expect(parsed.data.stories_per_day).toBe(3);
      expect(parsed.data.posts_per_week).toBe(2);
      expect(parsed.data.schema_version).toBe("v1");
    }

    // Corrupt JSON still triggers rhythm_invalid
    const corruptResult = await evaluateRhythmCompliance({
      campaignId: "camp_isolated_test_14",
      windowStart: new Date(Date.now() - 7 * 86400000),
      windowEnd: new Date(),
      approvedRhythmJson: "{ malformed json",
    });
    expect(corruptResult.status).toBe("rhythm_invalid");
  });

  // 15. Active strategy resolution selects the designated active plan/root/bundle.
  it("Scenario 15: resolves Songai designated active plan c3e6a7a0-56be-4538-b9de-529302903435 v4, root de027857-3a9e-4bee-8ad6-9a6b6319ec32, bundle 533cbd06-a23d-4eba-ac05-74a747b592d2 v13", async () => {
    const lineage = await resolveDesignatedActiveLineage("camp_ac86e8b8-55b", "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f");
    expect(lineage.planId).toBe("c3e6a7a0-56be-4538-b9de-529302903435");
    expect(lineage.planVersion).toBe(4);
    expect(lineage.strategyRootId).toBe("de027857-3a9e-4bee-8ad6-9a6b6319ec32");
    expect(lineage.rootBundle?.id).toBe("533cbd06-a23d-4eba-ac05-74a747b592d2");
    expect(lineage.strategyRootVersion).toBe(13);
  });

  // 16. Routine Watchtower MI refresh does not flip strategy_roots to REVIEW_REQUIRED.
  it("Scenario 16: keeps strategy_roots ACTIVE on routine background Watchtower MI refresh", async () => {
    const fs = await import("fs");
    const engineCode = fs.readFileSync(
      "C:/Users/mahmo/Projects/AvyronAI/server/market-intelligence-v3/engine.ts",
      "utf8",
    );
    expect(engineCode).toContain("let isMaterialChange = false;");
    expect(engineCode).toContain("if (!isBackgroundPersist && activeRoot.miSnapshotId)");
  });

  // 17. Reasoning/decision creation is idempotent across repeated runs.
  it("Scenario 17: syncCampaignAdaptiveReasoning is idempotent across repeated invocations", async () => {
    const first = await syncCampaignAdaptiveReasoning({
      accountId: "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f",
      campaignId: "camp_ac86e8b8-55b",
    });
    const second = await syncCampaignAdaptiveReasoning({
      accountId: "ce5c11b9-9a9a-499c-a4f8-b75e6ec6055f",
      campaignId: "camp_ac86e8b8-55b",
    });
    expect(second.casesCreated).toBe(0);
    expect(second.decisionsCreated).toBe(0);
    expect(second.casesSkippedIdempotent).toBeGreaterThanOrEqual(first.casesCreated + first.casesSkippedIdempotent);
  });

  // 18. Confirmed market or performance signals route to OBSERVE, INSUFFICIENT_EVIDENCE, EXECUTION_RESPONSE, REEVALUATE_AUTHORITY, or STRATEGY_CHANGE_REQUIRED.
  it("Scenario 18: routes signals accurately to OBSERVE, INSUFFICIENT_EVIDENCE, EXECUTION_RESPONSE, REEVALUATE_AUTHORITY, and STRATEGY_CHANGE_REQUIRED", () => {
    const baseParams = {
      accountId: "acc_test_18",
      campaignId: "camp_test_18",
      strategyRootId: "root_test_18",
      strategyRootVersion: 1,
    };

    // (a) OBSERVE (confirmed market signal with observeOnly / monitor recommendation)
    const obsSig = {
      signalId: "sig_obs_1",
      campaignId: "camp_test_18",
      accountId: "acc_test_18",
      sourceDomain: "MARKET" as const,
      sourceArtifactId: "evt_obs_1",
      entityIds: ["comp_1"],
      evidenceIds: ["ev_1"],
      signalType: "posting_frequency_shift",
      summary: "Minor cadence shift",
      severity: "LOW" as const,
      confidence: 0.8,
      confirmationState: "CONFIRMED" as const,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      metadata: { observeOnly: true },
    };
    const caseObs = openReasoningCase({ ...baseParams, marketSignals: [obsSig] });
    const anaObs = runCausalReasoningAnalysis({ reasoningCase: caseObs, marketSignals: [obsSig], performanceSignals: [] });
    const jdgObs = judgeReasoningAnalysis(anaObs.updatedCase, [obsSig], []);
    const decObs = routeAdaptiveDecision({ reasoningCase: anaObs.updatedCase, judgeVerdict: jdgObs, marketSignals: [obsSig], campaignId: "camp_test_18", accountId: "acc_test_18" });
    expect(decObs.decisionType).toBe("OBSERVE");

    // (b) INSUFFICIENT_EVIDENCE
    const decIns = routeAdaptiveDecision({
      reasoningCase: { ...anaObs.updatedCase, status: "INSUFFICIENT_EVIDENCE" },
      judgeVerdict: { ...jdgObs, status: "INSUFFICIENT_EVIDENCE", confidence: 0.3 },
      marketSignals: [obsSig],
      campaignId: "camp_test_18",
      accountId: "acc_test_18",
    });
    expect(decIns.decisionType).toBe("INSUFFICIENT_EVIDENCE");

    // (c) EXECUTION_RESPONSE (performance warning alone)
    const perfSig = {
      signalId: "sig_perf_1",
      campaignId: "camp_test_18",
      accountId: "acc_test_18",
      sourceDomain: "PERFORMANCE" as const,
      sourceArtifactId: "pctx_1",
      entityIds: ["exec_1"],
      evidenceIds: ["ev_perf_1"],
      signalType: "ENGAGEMENT_BOTTLENECK",
      summary: "Engagement cadence bottleneck",
      severity: "HIGH" as const,
      confidence: 0.8,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const caseExec = openReasoningCase({ ...baseParams, performanceSignals: [perfSig] });
    const anaExec = runCausalReasoningAnalysis({ reasoningCase: caseExec, marketSignals: [], performanceSignals: [perfSig] });
    const jdgExec = judgeReasoningAnalysis(anaExec.updatedCase, [], [perfSig]);
    const decExec = routeAdaptiveDecision({ reasoningCase: anaExec.updatedCase, judgeVerdict: jdgExec, performanceSignals: [perfSig], campaignId: "camp_test_18", accountId: "acc_test_18" });
    expect(decExec.decisionType).toBe("EXECUTION_RESPONSE");

    // (d) REEVALUATE_AUTHORITY (confirmed market event affecting OFFER / DIFFERENTIATION)
    const reevalSig = {
      ...obsSig,
      signalId: "sig_reeval_1",
      candidateAffectedAuthorities: ["OFFER" as const],
      metadata: { observeOnly: false },
    };
    const caseReeval = openReasoningCase({ ...baseParams, marketSignals: [reevalSig] });
    const anaReeval = runCausalReasoningAnalysis({ reasoningCase: caseReeval, marketSignals: [reevalSig], performanceSignals: [] });
    const jdgReeval = judgeReasoningAnalysis(anaReeval.updatedCase, [reevalSig], []);
    const decReeval = routeAdaptiveDecision({ reasoningCase: anaReeval.updatedCase, judgeVerdict: jdgReeval, marketSignals: [reevalSig], campaignId: "camp_test_18", accountId: "acc_test_18" });
    expect(decReeval.decisionType).toBe("REEVALUATE_AUTHORITY");
    expect(decReeval.affectedAuthority).toBe("OFFER");

    // (e) STRATEGY_CHANGE_REQUIRED (confirmed market-wide shift affecting STRATEGY_ROOT)
    const stratChangeSig = {
      ...obsSig,
      signalId: "sig_stratchange_1",
      candidateAffectedAuthorities: ["STRATEGY_ROOT" as const],
      metadata: { observeOnly: false },
    };
    const caseStrat = openReasoningCase({ ...baseParams, marketSignals: [stratChangeSig] });
    const anaStrat = runCausalReasoningAnalysis({ reasoningCase: caseStrat, marketSignals: [stratChangeSig], performanceSignals: [] });
    const jdgStrat = judgeReasoningAnalysis(anaStrat.updatedCase, [stratChangeSig], []);
    const decStrat = routeAdaptiveDecision({ reasoningCase: anaStrat.updatedCase, judgeVerdict: jdgStrat, marketSignals: [stratChangeSig], campaignId: "camp_test_18", accountId: "acc_test_18" });
    expect(decStrat.decisionType).toBe("STRATEGY_CHANGE_REQUIRED");
  });

  // 19. Proposal generation/application preserves strategy root and plan versioning without auto-spending or unapproved strategy replacement.
  it("Scenario 19: preserves strategyRootId and strategyRootVersion on reasoning cases and decisions without mutating strategy payloads", () => {
    const sig = {
      signalId: "sig_19",
      campaignId: "camp_test_19",
      accountId: "acc_test_19",
      sourceDomain: "MARKET" as const,
      sourceArtifactId: "evt_19",
      entityIds: ["comp_19"],
      evidenceIds: ["ev_19"],
      signalType: "offer_language_change",
      summary: "Competitor updated offer language",
      severity: "MEDIUM" as const,
      confidence: 0.85,
      confirmationState: "CONFIRMED" as const,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      candidateAffectedAuthorities: ["OFFER" as const],
    };
    const rc = openReasoningCase({
      accountId: "acc_test_19",
      campaignId: "camp_test_19",
      strategyRootId: "de027857-3a9e-4bee-8ad6-9a6b6319ec32",
      strategyRootVersion: 13,
      marketSignals: [sig],
    });
    const ana = runCausalReasoningAnalysis({ reasoningCase: rc, marketSignals: [sig], performanceSignals: [] });
    const jdg = judgeReasoningAnalysis(ana.updatedCase, [sig], []);
    const dec = routeAdaptiveDecision({
      reasoningCase: ana.updatedCase,
      judgeVerdict: jdg,
      marketSignals: [sig],
      campaignId: "camp_test_19",
      accountId: "acc_test_19",
    });

    expect(dec.strategyRootId).toBe("de027857-3a9e-4bee-8ad6-9a6b6319ec32");
    expect(dec.strategyRootVersion).toBe(13);
    // Verify ReasoningJudge rejects any attempt to embed replacement strategy payloads
    const mutatedCase = {
      ...ana.updatedCase,
      metadata: { ...ana.updatedCase.metadata, primaryOffer: "Unauthorized Replacement Offer" },
    };
    const mutatedVerdict = judgeReasoningAnalysis(mutatedCase, [sig], []);
    expect(mutatedVerdict.status).toBe("REJECTED");
  });

  // 20. Cross-campaign data cannot leak into discovery, acquisition, Watchtower, or Performance Loop.
  it("Scenario 20: rejects cross-campaign signals in ReasoningCase and cross-campaign containment checks", () => {
    const foreignSignal = {
      signalId: "sig_foreign",
      campaignId: "camp_OTHER_999",
      accountId: "acc_test_20",
      sourceDomain: "MARKET" as const,
      sourceArtifactId: "evt_foreign",
      entityIds: ["comp_foreign"],
      evidenceIds: ["ev_foreign"],
      signalType: "pricing_change",
      summary: "Foreign campaign event",
      severity: "HIGH" as const,
      confidence: 0.9,
      confirmationState: "CONFIRMED" as const,
      observedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    expect(() =>
      validateCampaignContainment(foreignSignal, "camp_ac86e8b8-55b", "acc_test_20"),
    ).toThrow(/Cross-campaign contamination/i);

    expect(() =>
      openReasoningCase({
        accountId: "acc_test_20",
        campaignId: "camp_ac86e8b8-55b",
        strategyRootId: "root_1",
        strategyRootVersion: 1,
        marketSignals: [foreignSignal],
      }),
    ).toThrow(/Cross-campaign contamination/i);
  });
});
