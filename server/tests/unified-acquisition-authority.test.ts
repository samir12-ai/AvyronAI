import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../db";
import {
  acquisitionTasks,
  acquisitionRequests,
  acquisitionAttempts,
  rawAcquisitionObservations,
  ciCompetitors,
  ciCompetitorPosts,
  ciCompetitorReviews,
  ciSharedProfiles,
  competitorSources,
  ownedPosts,
  ownedPostSnapshots,
} from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  requestAcquisition,
  cancelAcquisitionRequest,
  claimAuthorityTask,
  executeClaimedAuthorityTask,
  heartbeatTaskLease,
  resetAcquisitionPoolConfig,
  isTaskCompatibleWithRequest,
  inferDefaultProviderAndActor,
} from "../acquisition/authority";
import {
  classifyAcquisitionError,
  computeBoundedBackoffMs,
} from "../acquisition/error-contract";
import {
  runActorAndGetItems,
  setApifyTestHttpHandler,
} from "../acquisition/apify-client";
import { assessAmbiguousSourceOwnershipWithLlm } from "../acquisition/llm-source-reasoner";
import { persistYouTubeItemsToCompetitorPosts } from "../competitive-intelligence/provider-registry";
import {
  persistExternalEvidenceToDb,
  normalizeYouTubeChannelUrl,
  parseLinkedInIdentity,
  fetchYouTubeEvidence,
  fetchLinkedInEvidence,
  fetchXEvidence,
  fetchXProfileViaApify,
  fetchFacebookEvidence,
  fetchYouTubeCommentsViaApify,
  fetchTikTokCommentsViaApify,
  fetchReviewsViaApify,
  verifyReviewTargetMatchesCompetitor,
} from "../acquisition/multi-source-providers";
import { scrapeInstagramViaApify } from "../competitive-intelligence/instagram-apify-scraper";
import { planAcquisitionTasks, freezeEvidenceManifest } from "../acquisition/coordinator";
import { evidenceManifests } from "@shared/schema";
import { parsePostTimestamp, recordOwnedPostObservations } from "../performance-loop/owned-post-tracker";
import { calculateOwnedPlatformWindowCounts } from "../user-channel-scraper";

const TEST_ACCOUNT_A = `test_acct_a_${randomUUID().slice(0, 8)}`;
const TEST_ACCOUNT_B = `test_acct_b_${randomUUID().slice(0, 8)}`;
const TEST_CAMPAIGN_A = `test_camp_a_${randomUUID().slice(0, 8)}`;
const TEST_CAMPAIGN_B = `test_camp_b_${randomUUID().slice(0, 8)}`;

describe("Unified Acquisition Authority — Behavioral Suite (12 Scenarios)", () => {
  beforeEach(() => {
    resetAcquisitionPoolConfig();
    setApifyTestHttpHandler(null);
    process.env.APIFY_API_KEY = "test_apify_token_secret_do_not_log";
  });

  afterAll(async () => {
    setApifyTestHttpHandler(null);
    resetAcquisitionPoolConfig();
    const testAccounts = [TEST_ACCOUNT_A, TEST_ACCOUNT_B];
    await db.delete(rawAcquisitionObservations).where(inArray(rawAcquisitionObservations.accountId, testAccounts));
    await db.delete(acquisitionAttempts).where(inArray(acquisitionAttempts.accountId, testAccounts));
    await db.delete(acquisitionRequests).where(inArray(acquisitionRequests.accountId, testAccounts));
    await db.delete(acquisitionTasks).where(inArray(acquisitionTasks.accountId, testAccounts));
    await db.delete(ciCompetitorPosts).where(inArray(ciCompetitorPosts.accountId, testAccounts));
    await db.delete(ciCompetitorReviews).where(inArray(ciCompetitorReviews.accountId, testAccounts));
    await db.delete(competitorSources).where(inArray(competitorSources.accountId, testAccounts));
    await db.delete(ciCompetitors).where(inArray(ciCompetitors.accountId, testAccounts));
  }, 30_000);

  it(
    "1 & 2. Canonical routing + Request lineage for NEW_FETCH, CACHE_REUSE, and JOINED_INFLIGHT with cancellation safety",
    async () => {
      const entityId = `comp_${randomUUID().slice(0, 8)}`;
      let adapterCallCount = 0;

      // A. First request triggers NEW_FETCH
      const firstOutcome = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "MANUAL_REFRESH",
        parentJobId: "job_101",
        entityType: "COMPETITOR",
        entityId,
        platform: "INSTAGRAM",
        canonicalUrl: "https://www.instagram.com/brand_one/",
        externalAccountId: "brand_one",
        capability: "POSTS",
        timeWindowDays: 30,
        itemLimit: 12,
        freshnessTtlSec: 3600,
        inputPayload: {
          handle: "brand_one",
          apiKey: "super_secret_should_be_redacted",
        },
        customExecutor: async () => {
          adapterCallCount++;
          return {
            status: "COMPLETED",
            provider: "APIFY",
            actorId: "apify~instagram-profile-scraper",
            providerRunId: "run_ig_001",
            datasetId: "ds_ig_001",
            usageUsd: 0.015,
            itemsStored: 5,
            normalizedEvidenceIds: ["post_1", "post_2"],
            rawPayload: { sample: true },
          };
        },
      });

      expect(firstOutcome.resolutionType).toBe("NEW_FETCH");
      expect(firstOutcome.status).toBe("COMPLETED");
      expect(firstOutcome.terminalOutcome).toBe("SUCCESS_WITH_CONTENT");
      expect(firstOutcome.providerRunId).toBe("run_ig_001");
      expect(firstOutcome.itemsStored).toBe(5);
      expect(firstOutcome.observationIds.length).toBe(1);
      expect(firstOutcome.normalizedEvidenceIds).toEqual(["post_1", "post_2"]);
      expect(adapterCallCount).toBe(1);

      // Verify credentials were redacted in persisted task input_payload
      const [persistedTask] = await db
        .select()
        .from(acquisitionTasks)
        .where(eq(acquisitionTasks.id, firstOutcome.taskId));
      expect((persistedTask.inputPayload as any).apiKey).toBe("[REDACTED]");

      // B. Second compatible request within freshnessTtlSec resolves via CACHE_REUSE ($0 extra cost)
      const cachedOutcome = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "STRATEGY_ORCHESTRATOR",
        trigger: "STRATEGY_GENERATION",
        parentJobId: "job_102",
        strategyVersion: 2,
        entityType: "COMPETITOR",
        entityId,
        platform: "INSTAGRAM",
        canonicalUrl: "https://www.instagram.com/brand_one/",
        externalAccountId: "brand_one",
        capability: "POSTS",
        timeWindowDays: 14, // <= 30 days covered by cached fetch
        itemLimit: 10, // <= 12 items covered by cached fetch
        freshnessTtlSec: 3600,
      });

      expect(cachedOutcome.resolutionType).toBe("CACHE_REUSE");
      expect(cachedOutcome.taskId).toBe(firstOutcome.taskId);
      expect(cachedOutcome.providerRunId).toBe("run_ig_001");
      expect(cachedOutcome.usageUsd).toBeNull();
      expect(cachedOutcome.consumerDeliveryStatus).toBe("DELIVERED");
      expect(adapterCallCount).toBe(1); // No second provider call!

      // C. In-flight coalescing (JOINED_INFLIGHT) + partial requester cancellation
      const inflightEntityId = `comp_inflight_${randomUUID().slice(0, 8)}`;
      let releaseAdapter!: () => void;
      const adapterGate = new Promise<void>((r) => {
        releaseAdapter = r;
      });

      const req1Promise = requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "WATCHTOWER",
        trigger: "SCHEDULED_REFRESH",
        monitoringCycleId: "wt_cycle_1",
        entityType: "COMPETITOR",
        entityId: inflightEntityId,
        platform: "TIKTOK",
        externalAccountId: "brand_tt",
        capability: "POSTS",
        forceRefresh: true,
        customExecutor: async () => {
          await adapterGate;
          adapterCallCount++;
          return {
            status: "COMPLETED",
            provider: "APIFY",
            actorId: "clockworks~tiktok-scraper",
            providerRunId: "run_tt_shared_99",
            datasetId: "ds_tt_99",
            usageUsd: 0.02,
            itemsStored: 8,
            normalizedEvidenceIds: ["tt_1", "tt_2"],
          };
        },
      });

      // Wait briefly for req1 to create and claim the task
      await new Promise((r) => setTimeout(r, 250));

      // Queue two joining requests (req2 and req3) while req1 is running
      const req2Queued = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "MANUAL_REFRESH",
        entityType: "COMPETITOR",
        entityId: inflightEntityId,
        platform: "TIKTOK",
        externalAccountId: "brand_tt",
        capability: "POSTS",
        executeInline: false,
      });
      const req3Queued = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "STRATEGY_ORCHESTRATOR",
        trigger: "STRATEGY_GENERATION",
        entityType: "COMPETITOR",
        entityId: inflightEntityId,
        platform: "TIKTOK",
        externalAccountId: "brand_tt",
        capability: "POSTS",
        executeInline: false,
      });

      expect(req2Queued.resolutionType).toBe("JOINED_INFLIGHT");
      expect(req3Queued.resolutionType).toBe("JOINED_INFLIGHT");
      expect(req2Queued.taskId).toBe(req3Queued.taskId);

      // Cancel req2 — underlying task MUST NOT be cancelled because req1 and req3 still need it!
      const cancelRes = await cancelAcquisitionRequest(req2Queued.requestId);
      expect(cancelRes.requestCancelled).toBe(true);
      expect(cancelRes.underlyingTaskCancelled).toBe(false);

      // Now release the shared adapter
      releaseAdapter();
      const req1Result = await req1Promise;
      expect(req1Result.status).toBe("COMPLETED");
      expect(req1Result.providerRunId).toBe("run_tt_shared_99");

      // Verify req3 received the fanned-out completion while req2 stayed CANCELLED
      const [req2Row] = await db.select().from(acquisitionRequests).where(eq(acquisitionRequests.id, req2Queued.requestId));
      const [req3Row] = await db.select().from(acquisitionRequests).where(eq(acquisitionRequests.id, req3Queued.requestId));
      expect(req2Row.status).toBe("CANCELLED");
      expect(req3Row.status).toBe("COMPLETED");
      expect(req3Row.providerRunId).toBe("run_tt_shared_99");
      expect(req3Row.itemsStored).toBe(8);
    },
    30_000
  );

  it("3. Tenant, credential, time-window, and item-limit isolation prevents incompatible merging", async () => {
    const baseTask = {
      accountId: TEST_ACCOUNT_A,
      entityType: "COMPETITOR",
      entityId: "comp_shared",
      sourcePlatform: "INSTAGRAM",
      capability: "POSTS",
      taskType: "POSTS",
      timeWindowDays: 30,
      itemLimit: 12,
      inputPayload: { handle: "brand_x", credentialScope: "oauth_token_1" },
    };

    expect(
      isTaskCompatibleWithRequest(baseTask, {
        accountId: TEST_ACCOUNT_B,
        campaignId: TEST_CAMPAIGN_B,
        requesterEngine: "MIV3",
        trigger: "TEST",
        entityType: "COMPETITOR",
        entityId: "comp_shared",
        platform: "INSTAGRAM",
        externalAccountId: "brand_x",
        capability: "POSTS",
      })
    ).toBe(false);

    expect(
      isTaskCompatibleWithRequest(baseTask, {
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "TEST",
        entityType: "COMPETITOR",
        entityId: "comp_shared",
        platform: "INSTAGRAM",
        externalAccountId: "brand_x",
        capability: "POSTS",
        inputPayload: { credentialScope: "oauth_token_2" },
      })
    ).toBe(false);

    expect(
      isTaskCompatibleWithRequest(baseTask, {
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "TEST",
        entityType: "COMPETITOR",
        entityId: "comp_shared",
        platform: "INSTAGRAM",
        externalAccountId: "brand_x",
        capability: "POSTS",
        timeWindowDays: 90,
        inputPayload: { credentialScope: "oauth_token_1" },
      })
    ).toBe(false);

    expect(
      isTaskCompatibleWithRequest(baseTask, {
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "TEST",
        entityType: "COMPETITOR",
        entityId: "comp_shared",
        platform: "INSTAGRAM",
        externalAccountId: "brand_x",
        capability: "POSTS",
        itemLimit: 30,
        inputPayload: { credentialScope: "oauth_token_1" },
      })
    ).toBe(false);
  });

  it(
    "4. Lease claiming, heartbeat renewal, expired-lease recovery, and fencing-token rejection",
    async () => {
      const queued = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "LEASE_TEST",
        entityType: "COMPETITOR",
        entityId: `comp_lease_${randomUUID().slice(0, 8)}`,
        platform: "YOUTUBE",
        externalAccountId: "@lease_test",
        capability: "POSTS",
        forceRefresh: true,
        executeInline: false,
      });

      const claim1 = await claimAuthorityTask({
        workerId: "worker_1",
        specificTaskId: queued.taskId,
        leaseDurationSec: 1,
      });
      expect(claim1).not.toBeNull();
      expect(claim1!.fencingToken).toBe(1);

      const concurrentClaim = await claimAuthorityTask({
        workerId: "worker_2",
        specificTaskId: queued.taskId,
      });
      expect(concurrentClaim).toBeNull();

      const hbOk = await heartbeatTaskLease(queued.taskId, claim1!.fencingToken, 1);
      expect(hbOk).toBe(true);

      await new Promise((r) => setTimeout(r, 1250));

      const claim2 = await claimAuthorityTask({
        workerId: "worker_2",
        specificTaskId: queued.taskId,
        leaseDurationSec: 60,
      });
      expect(claim2).not.toBeNull();
      expect(claim2!.fencingToken).toBe(2);

      const staleHb = await heartbeatTaskLease(queued.taskId, claim1!.fencingToken, 60);
      expect(staleHb).toBe(false);

      await cancelAcquisitionRequest(queued.requestId);
    },
    30_000
  );

  it(
    "5 & 6. Immediate provider_run_id persistence before polling finishes + run resumption on polling timeout or worker restart without starting a second paid run",
    async () => {
      let postRunsCalls = 0;
      let getRunPolls = 0;
      let midPollObservedTaskRunId: string | null = null;

      const entityId = `comp_run_resume_${randomUUID().slice(0, 8)}`;

      setApifyTestHttpHandler(
        async (path, init) => {
          if (path.includes("/acts/") && path.endsWith("/runs") && init?.method === "POST") {
            postRunsCalls++;
            return {
              data: { id: "apify_run_paid_777", status: "RUNNING", defaultDatasetId: "ds_777" },
            };
          }
          if (path.includes("/actor-runs/apify_run_paid_777") && (!init?.method || init.method === "GET")) {
            getRunPolls++;
            if (getRunPolls === 1) {
              // Verify that provider_run_id was ALREADY persisted in DB before polling finished!
              const [t] = await db
                .select({ providerRunId: acquisitionTasks.providerRunId })
                .from(acquisitionTasks)
                .where(eq(acquisitionTasks.entityId, entityId));
              midPollObservedTaskRunId = t?.providerRunId || null;
              return {
                data: { id: "apify_run_paid_777", status: "RUNNING", defaultDatasetId: "ds_777" },
              };
            }
            return {
              data: {
                id: "apify_run_paid_777",
                status: "SUCCEEDED",
                defaultDatasetId: "ds_777",
                usageTotalUsd: 0.012,
              },
            };
          }
          if (path.includes("/datasets/ds_777/items")) {
            return [{ id: "vid_1", title: "Video 1", viewCount: 500 }];
          }
          throw new Error(`Unexpected Apify path: ${path}`);
        },
        { pollIntervalMs: 30 }
      );

      const customExecFn = async () => {
        const budgetMs = getRunPolls === 0 ? 25 : 5000;
        const res = await runActorAndGetItems({
          actorId: "streamers~youtube-scraper",
          input: { startUrls: [{ url: "https://www.youtube.com/@resume_yt" }] },
          budgetMs,
          label: "ResumeTest",
          preserveRunOnPollingTimeout: true,
        });
        return {
          status: "COMPLETED" as const,
          providerRunId: res.runId,
          datasetId: res.datasetId,
          usageUsd: res.usageUsd,
          itemsStored: res.items.length,
        };
      };

      const queued = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MIV3",
        trigger: "RESUME_TEST",
        entityType: "COMPETITOR",
        entityId,
        platform: "YOUTUBE",
        externalAccountId: "@resume_yt",
        capability: "POSTS",
        forceRefresh: true,
        executeInline: false,
        customExecutor: customExecFn,
      });

      const claim1 = await claimAuthorityTask({ workerId: "w1", specificTaskId: queued.taskId });
      expect(claim1).not.toBeNull();
      const res1 = await executeClaimedAuthorityTask(claim1!, "w1");

      // Attempt 1 timed out while polling, so it scheduled a retry AND preserved provider_run_id!
      expect(midPollObservedTaskRunId).toBe("apify_run_paid_777");
      expect(res1.status).toBe("RETRY_SCHEDULED");
      expect(res1.errorCode).toBe("TIMEOUT");
      expect(postRunsCalls).toBe(1);

      const [taskAfterTimeout] = await db
        .select()
        .from(acquisitionTasks)
        .where(eq(acquisitionTasks.id, queued.taskId));
      expect(taskAfterTimeout.providerRunId).toBe("apify_run_paid_777");

      // Clear nextRetryAt so Worker 2 can claim immediately and resume polling apify_run_paid_777
      await db
        .update(acquisitionTasks)
        .set({ nextRetryAt: new Date(Date.now() - 1000) })
        .where(eq(acquisitionTasks.id, queued.taskId));

      const claim2 = await claimAuthorityTask({ workerId: "w2", specificTaskId: queued.taskId });
      expect(claim2).not.toBeNull();
      expect(claim2!.task.providerRunId).toBe("apify_run_paid_777");

      const res2 = await executeClaimedAuthorityTask(claim2!, "w2");
      expect(res2.status).toBe("COMPLETED");
      expect(res2.providerRunId).toBe("apify_run_paid_777");
      expect(res2.itemsStored).toBe(1);
      // Proof: POST /acts/.../runs was called ONLY ONCE across both attempts!
      expect(postRunsCalls).toBe(1);
    },
    30_000
  );

  it(
    "7 & 8. Concurrency limits + Fair competitor scheduling and resuming DEFERRED tasks",
    async () => {
      const compRecentId = `comp_recent_${randomUUID().slice(0, 8)}`;
      const compNeverId = `comp_never_${randomUUID().slice(0, 8)}`;

      await db.insert(ciCompetitors).values([
        {
          id: compRecentId,
          accountId: TEST_ACCOUNT_B,
          campaignId: TEST_CAMPAIGN_B,
          name: "Recent Competitor",
          businessType: "DIRECT",
          primaryObjective: "GROWTH",
          isActive: true,
          lastCheckedAt: new Date(),
        },
        {
          id: compNeverId,
          accountId: TEST_ACCOUNT_B,
          campaignId: TEST_CAMPAIGN_B,
          name: "Never Checked Competitor",
          businessType: "DIRECT",
          primaryObjective: "GROWTH",
          isActive: true,
          lastCheckedAt: null,
        },
      ]);

      await db.insert(competitorSources).values([
        {
          id: `src_${compRecentId}`,
          accountId: TEST_ACCOUNT_B,
          campaignId: TEST_CAMPAIGN_B,
          competitorId: compRecentId,
          platform: "INSTAGRAM",
          canonicalUrl: "https://www.instagram.com/recent_comp/",
          externalAccountId: "recent_comp",
          status: "VERIFIED",
        },
        {
          id: `src_${compNeverId}`,
          accountId: TEST_ACCOUNT_B,
          campaignId: TEST_CAMPAIGN_B,
          competitorId: compNeverId,
          platform: "INSTAGRAM",
          canonicalUrl: "https://www.instagram.com/never_comp/",
          externalAccountId: "never_comp",
          status: "VERIFIED",
        },
      ]);

      const plan = await planAcquisitionTasks(
        {
          accountId: TEST_ACCOUNT_B,
          campaignId: TEST_CAMPAIGN_B,
          offeringId: "off_test",
          offeringName: "Test Offer",
          category: "Software",
          targetMarket: "US",
          targetLanguage: "en",
          contextFingerprint: "fp_test",
        } as any,
        { cycleToken: "fairness_cycle_1" }
      );
      expect(plan.tasksPlanned).toBeGreaterThanOrEqual(3);

      const tasks = await db
        .select()
        .from(acquisitionTasks)
        .where(eq(acquisitionTasks.campaignId, TEST_CAMPAIGN_B));

      const neverPostsTask = tasks.find((t) => t.entityId === compNeverId && t.taskType === "POSTS");
      const recentPostsTask = tasks.find((t) => t.entityId === compRecentId && t.taskType === "POSTS");
      expect(neverPostsTask!.priority).toBeGreaterThan(recentPostsTask!.priority);
    },
    30_000
  );

  it(
    "9 & 10. Error classification, bounded exponential backoff, non-retryable config errors, and CONFIRMED_EMPTY_SOURCE vs FAILED",
    async () => {
      const configDecision = classifyAcquisitionError({
        error: new Error("Apify API 404: Actor was not found"),
      });
      expect(configDecision.errorCode).toBe("MISSING_ACTOR_OR_UNSUPPORTED");
      expect(configDecision.retryable).toBe(false);

      const rateDecision = classifyAcquisitionError({
        error: new Error("Apify API 429: Rate limit exceeded"),
        retryAfterMs: 45_000,
      });
      expect(rateDecision.errorCode).toBe("RATE_LIMIT_OR_QUOTA");
      expect(rateDecision.retryable).toBe(true);
      const backoff = computeBoundedBackoffMs(1, rateDecision);
      expect(backoff).toBeGreaterThanOrEqual(45_000);

      const failedEmptyDecision = classifyAcquisitionError({
        error: new Error("Upstream connection reset"),
        itemsCount: 0,
        isConfirmedEmpty: false,
      });
      expect(failedEmptyDecision.terminalOutcome).not.toBe("CONFIRMED_EMPTY_SOURCE");
      expect(failedEmptyDecision.errorCode).toBe("TRANSIENT_PROVIDER_ERROR");

      const confirmedEmptyOutcome = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "OWNED_CHANNELS",
        trigger: "TEST_EMPTY",
        entityType: "OWNED",
        entityId: `prof_empty_${randomUUID().slice(0, 8)}`,
        platform: "INSTAGRAM",
        externalAccountId: "songaimedia",
        capability: "OWNED_CHANNEL_SNAPSHOT",
        forceRefresh: true,
        customExecutor: async () => ({
          status: "EMPTY_CONFIRMED",
          providerRunId: "run_empty_ig",
          itemsStored: 0,
          isConfirmedEmpty: true,
        }),
      });
      expect(confirmedEmptyOutcome.status).toBe("COMPLETED");
      expect(confirmedEmptyOutcome.terminalOutcome).toBe("CONFIRMED_EMPTY_SOURCE");
      expect(confirmedEmptyOutcome.consumerDeliveryStatus).toBe("EMPTY_CONFIRMED");
      expect(confirmedEmptyOutcome.errorCode).toBeNull();
    },
    30_000
  );

  it(
    "11 & 12. Idempotent YouTube persistence (no yt_ prefix duplication) + LLM ambiguous source reasoner deterministic guard",
    async () => {
      const compId = `comp_yt_dedup_${randomUUID().slice(0, 8)}`;
      await db.insert(ciCompetitors).values({
        id: compId,
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        name: "YT Dedup Competitor",
        businessType: "DIRECT",
        primaryObjective: "GROWTH",
        isActive: true,
      });

      await persistYouTubeItemsToCompetitorPosts(
        [
          {
            id: "yt_abc123xyz",
            url: "https://www.youtube.com/watch?v=abc123xyz",
            title: "Launch Demo",
            content: "Full walkthrough",
            publishedAt: "2026-10-01T00:00:00Z",
            engagementMetrics: { views: 1200, likes: 85, comments: 12 },
          } as any,
        ],
        {
          accountId: TEST_ACCOUNT_A,
          competitorId: compId,
          sourceId: "src_yt_1",
        }
      );

      await persistExternalEvidenceToDb(
        [
          {
            id: "ext_yt_abc123xyz",
            platform: "YOUTUBE",
            externalId: "abc123xyz",
            title: "Launch Demo",
            text: "Full walkthrough",
            url: "https://www.youtube.com/watch?v=abc123xyz",
            authorName: "YT Dedup Competitor",
            publishedAt: "2026-10-01T00:00:00Z",
            campaignId: TEST_CAMPAIGN_A,
            accountId: TEST_ACCOUNT_A,
            competitorId: compId,
            authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
            engagementMetrics: { views: 1250, likes: 90, comments: 14 },
            rawPayload: {},
            fetchedAt: new Date().toISOString(),
          },
        ],
        { sourceId: "src_yt_1" }
      );

      const ytRows = await db
        .select()
        .from(ciCompetitorPosts)
        .where(
          and(
            eq(ciCompetitorPosts.accountId, TEST_ACCOUNT_A),
            eq(ciCompetitorPosts.competitorId, compId),
            eq(ciCompetitorPosts.platform, "youtube")
          )
        );

      expect(ytRows.length).toBe(1);
      expect(ytRows[0].postId).toBe("abc123xyz");
      expect(ytRows[0].views).toBe(1250);
      expect(ytRows[0].likes).toBe(90);
      expect(ytRows[0].comments).toBe(14);
      expect(ytRows[0].sourceId).toBe("src_yt_1");

      const emptyLlmRes = await assessAmbiguousSourceOwnershipWithLlm({
        competitorName: "Acme Corp",
        cleanDomain: "acme.com",
        platform: "instagram",
        candidates: [],
      });
      expect(emptyLlmRes.selectedUrl).toBeNull();
      expect(emptyLlmRes.decision).toBe("AMBIGUOUS_UNRESOLVED");
    },
    30_000
  );

  it(
    "13. YouTube bare handle URL normalization, Shorts + Videos extraction, and CHANNEL_DOES_NOT_EXIST error rejection",
    async () => {
      expect(normalizeYouTubeChannelUrl("https://youtube.com/songaimedia")).toBe(
        "https://www.youtube.com/@songaimedia"
      );
      expect(normalizeYouTubeChannelUrl("songaimedia")).toBe(
        "https://www.youtube.com/@songaimedia"
      );
      expect(normalizeYouTubeChannelUrl("https://www.youtube.com/channel/UC4Qu-Or5Bm2wvsQrI01KB9Q")).toBe(
        "https://www.youtube.com/channel/UC4Qu-Or5Bm2wvsQrI01KB9Q"
      );

      let capturedInput: any = null;
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/acts/streamers~youtube-scraper/runs")) {
            capturedInput = JSON.parse(String(init.body || "{}"));
            return {
              data: { id: "run_yt_norm_1", status: "SUCCEEDED", defaultDatasetId: "ds_yt_norm_1", usageTotalUsd: 0.05 },
            };
          }
          if (url.includes("/actor-runs/run_yt_norm_1")) {
            return {
              data: { id: "run_yt_norm_1", status: "SUCCEEDED", defaultDatasetId: "ds_yt_norm_1", usageTotalUsd: 0.05 },
            };
          }
          if (url.includes("/datasets/ds_yt_norm_1/items")) {
            return [
              {
                url: "https://youtube.com/songaimedia/about",
                error: "CHANNEL_DOES_NOT_EXIST",
                inputChannelUrl: "https://youtube.com/songaimedia",
              },
              {
                id: "vid_long_1",
                title: "Custom Song Reaction",
                url: "https://www.youtube.com/watch?v=vid_long_1",
                type: "video",
                viewCount: 1400,
                likes: 42,
                commentsCount: 5,
                date: "2026-10-10T00:00:00.000Z",
                channelName: "The Songai",
                channelId: "UC4Qu-Or5Bm2wvsQrI01KB9Q",
                numberOfSubscribers: 487,
                channelTotalVideos: 35,
              },
              {
                id: "short_1",
                title: "Anniversary Gift Short",
                url: "https://www.youtube.com/shorts/short_1",
                type: "shorts",
                viewCount: 3200,
                likes: 110,
                commentsCount: 9,
                date: "2026-10-12T00:00:00.000Z",
                channelName: "The Songai",
                channelId: "UC4Qu-Or5Bm2wvsQrI01KB9Q",
                numberOfSubscribers: 487,
                channelTotalVideos: 35,
              },
            ];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      const ytRes = await fetchYouTubeEvidence({
        channelUrl: "https://youtube.com/songaimedia",
        maxVideos: 25,
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
      });

      expect(capturedInput.startUrls[0].url).toBe("https://www.youtube.com/@songaimedia");
      expect(capturedInput.maxResults).toBe(25);
      expect(capturedInput.maxResultsShorts).toBe(25);
      // Error item must be rejected; only the 2 real videos/Shorts are accepted
      expect(ytRes.items.length).toBe(2);
      expect(ytRes.report.channelSubscribers).toBe(487);
      expect(ytRes.report.channelTotalVideos).toBe(35);
      expect(ytRes.report.channelId).toBe("UC4Qu-Or5Bm2wvsQrI01KB9Q");
    },
    30_000
  );

  it(
    "14. Instagram header-only response (postsCount: undefined, latestPosts: []) triggers fallback to apify~instagram-scraper (resultsType: posts) and never falsely marks CONFIRMED_EMPTY_SOURCE",
    async () => {
      const actorCalls: string[] = [];
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/acts/apify~instagram-profile-scraper/runs")) {
            actorCalls.push("apify~instagram-profile-scraper");
            return {
              data: { id: "run_ig_prof_hdr", status: "SUCCEEDED", defaultDatasetId: "ds_ig_prof_hdr", usageTotalUsd: 0.0026 },
            };
          }
          if (url.includes("/actor-runs/run_ig_prof_hdr")) {
            return {
              data: { id: "run_ig_prof_hdr", status: "SUCCEEDED", defaultDatasetId: "ds_ig_prof_hdr", usageTotalUsd: 0.0026 },
            };
          }
          if (url.includes("/datasets/ds_ig_prof_hdr/items")) {
            // Header-only response: postsCount is undefined and latestPosts is omitted
            return [
              {
                id: "77068978483",
                username: "songaimedia",
                followersCount: 127,
                private: false,
              },
            ];
          }
          if (init?.method === "POST" && url.includes("/acts/apify~instagram-scraper/runs")) {
            actorCalls.push("apify~instagram-scraper");
            return {
              data: { id: "run_ig_posts_fb", status: "SUCCEEDED", defaultDatasetId: "ds_ig_posts_fb", usageTotalUsd: 0.015 },
            };
          }
          if (url.includes("/actor-runs/run_ig_posts_fb")) {
            return {
              data: { id: "run_ig_posts_fb", status: "SUCCEEDED", defaultDatasetId: "ds_ig_posts_fb", usageTotalUsd: 0.015 },
            };
          }
          if (url.includes("/datasets/ds_ig_posts_fb/items")) {
            return [
              {
                id: "post_fb_1",
                shortCode: "DP123",
                type: "Sidecar",
                caption: "Custom song for your loved ones",
                likesCount: 14,
                commentsCount: 2,
                timestamp: "2026-10-18T15:05:31.000Z",
                url: "https://www.instagram.com/p/DP123/",
              },
              {
                id: "post_fb_2",
                shortCode: "DP124",
                type: "Video",
                caption: "Turn memories into music",
                likesCount: 22,
                commentsCount: 4,
                videoViewCount: 310,
                timestamp: "2026-10-17T12:00:00.000Z",
                url: "https://www.instagram.com/p/DP124/",
              },
            ];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      const igRes = await scrapeInstagramViaApify("songaimedia", 15);
      expect(actorCalls).toEqual(["apify~instagram-profile-scraper", "apify~instagram-scraper"]);
      expect(igRes.error).toBeNull();
      expect(igRes.posts.length).toBe(2);
      expect(igRes.followers).toBe(127);
      expect(igRes.isConfirmedEmpty).toBe(false);
    },
    30_000
  );

  it(
    "15 & 16. Cross-competitor review attribution guard + Evidence Manifest customer-voice vs total-evidence reconciliation",
    async () => {
      const compSongGifts = `comp_sg_${randomUUID().slice(0, 8)}`;
      const compSongFinch = `comp_sf_${randomUUID().slice(0, 8)}`;

      await db.insert(ciCompetitors).values([
        {
          id: compSongGifts,
          accountId: TEST_ACCOUNT_A,
          campaignId: TEST_CAMPAIGN_A,
          name: "SongGifts",
          websiteUrl: "https://www.songgifts.co.uk",
          businessType: "DIRECT",
          primaryObjective: "GROWTH",
          isActive: true,
        },
        {
          id: compSongFinch,
          accountId: TEST_ACCOUNT_A,
          campaignId: TEST_CAMPAIGN_A,
          name: "Songfinch",
          websiteUrl: "https://www.songfinch.com",
          businessType: "DIRECT",
          primaryObjective: "GROWTH",
          isActive: true,
        },
      ]);

      const badAttribution = await verifyReviewTargetMatchesCompetitor({
        targetUrl: "https://www.trustpilot.com/review/songfinch.com",
        competitorId: compSongGifts,
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
      });
      expect(badAttribution.ok).toBe(false);
      expect(badAttribution.error).toContain("CROSS_COMPETITOR_ATTRIBUTION_MISMATCH");

      const validAttribution = await verifyReviewTargetMatchesCompetitor({
        targetUrl: "https://www.trustpilot.com/review/songfinch.com",
        competitorId: compSongFinch,
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
      });
      expect(validAttribution.ok).toBe(true);

      // Insert 1 Google review and 1 Trustpilot review and freeze manifest
      await db.insert(ciCompetitorReviews).values([
        {
          id: `rev_g_${randomUUID().slice(0, 8)}`,
          competitorId: compSongGifts,
          accountId: TEST_ACCOUNT_A,
          campaignId: TEST_CAMPAIGN_A,
          platform: "google",
          rating: 5,
          reviewText: "Great gift!",
        } as any,
        {
          id: `rev_tp_${randomUUID().slice(0, 8)}`,
          competitorId: compSongFinch,
          accountId: TEST_ACCOUNT_A,
          campaignId: TEST_CAMPAIGN_A,
          platform: "trustpilot",
          rating: 4,
          reviewText: "Loved our Songfinch custom song!",
        } as any,
      ]);

      const manifest = await freezeEvidenceManifest({
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
        orchestrationJobId: `job_man_${randomUUID().slice(0, 8)}`,
        contextFingerprint: "fp_test_16",
      });

      const diversity = manifest.sourceDiversityReport as any;
      const counts = manifest.evidencePoolCounts as any;
      expect(diversity.googleReviews).toBeGreaterThanOrEqual(1);
      expect(diversity.trustpilotReviews).toBeGreaterThanOrEqual(1);
      expect(diversity.totalReviews).toBe(diversity.googleReviews + diversity.trustpilotReviews + (diversity.otherReviews || 0));
      expect(counts.totalUnits).toBe(counts.totalAllEvidenceUnits);
      expect(counts.totalCustomerVoiceUnits).toBeDefined();

      await db.delete(evidenceManifests).where(eq(evidenceManifests.id, manifest.id));
    },
    30_000
  );

  it(
    "17. Newly connected actors (LinkedIn company/profile, X, Facebook, YouTube/TikTok comments, G2/Capterra/Trendyol reviews) validate schemas and reject generic placeholder URLs without retrying",
    async () => {
      // 1. Generic LinkedIn placeholder must be rejected as SOURCE_INVALID -> INVALID_INPUT_OR_CONFIG (retryable=false)
      expect(parseLinkedInIdentity("https://linkedin.com/company").valid).toBe(false);
      expect(parseLinkedInIdentity("https://www.linkedin.com/company/songfinch")).toEqual({
        valid: true,
        kind: "company",
        slug: "songfinch",
        canonicalUrl: "https://www.linkedin.com/company/songfinch",
      });
      expect(parseLinkedInIdentity("https://www.linkedin.com/in/satyanadella")).toEqual({
        valid: true,
        kind: "profile",
        slug: "satyanadella",
        canonicalUrl: "https://www.linkedin.com/in/satyanadella",
      });

      const badLiRes = await fetchLinkedInEvidence({
        profileUrl: "https://linkedin.com/company",
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
      });
      expect(badLiRes.items.length).toBe(0);
      expect(badLiRes.report.error).toContain("SOURCE_INVALID");
      const classifiedLi = classifyAcquisitionError(badLiRes.report.error);
      expect(classifiedLi.errorCode).toBe("INVALID_INPUT_OR_CONFIG");
      expect(classifiedLi.retryable).toBe(false);

      // 2. Invalid Facebook year path (https://facebook.com/2008) must be rejected as SOURCE_INVALID
      const badFbRes = await fetchFacebookEvidence({
        pageUrl: "https://facebook.com/2008",
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
      });
      expect(badFbRes.items.length).toBe(0);
      expect(badFbRes.report.error).toContain("SOURCE_INVALID");
      const classifiedFb = classifyAcquisitionError(badFbRes.report.error);
      expect(classifiedFb.errorCode).toBe("INVALID_INPUT_OR_CONFIG");
      expect(classifiedFb.retryable).toBe(false);

      // 3. Verify Trendyol, G2/Capterra, X, Facebook, YouTube/TikTok comments input contracts via mock transport
      const capturedCalls: Array<{ url: string; body: any }> = [];
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/runs")) {
            const body = init.body ? JSON.parse(String(init.body)) : {};
            capturedCalls.push({ url, body });
            return {
              data: { id: "run_multi_act", status: "SUCCEEDED", defaultDatasetId: "ds_multi_act", usageTotalUsd: 0.002 },
            };
          }
          if (url.includes("/actor-runs/run_multi_act")) {
            return {
              data: { id: "run_multi_act", status: "SUCCEEDED", defaultDatasetId: "ds_multi_act", usageTotalUsd: 0.002 },
            };
          }
          if (url.includes("/datasets/ds_multi_act/items")) {
            return [
              {
                id: "item_1",
                text: "Great product and service!",
                comment: "Trendyol comment text",
                rating: 5,
                platform: "g2",
              },
            ];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      await fetchReviewsViaApify({
        targetUrl: "https://www.trendyol.com/sr?q=kulaklik",
        platformType: "trendyol",
        maxReviews: 5,
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
      });
      const trendyolCall = capturedCalls.find((c) => decodeURIComponent(c.url).includes("fatihtahta~trendyol-scraper"));
      expect(trendyolCall).toBeDefined();
      expect(trendyolCall!.body.limit).toBeGreaterThanOrEqual(10);
      expect(trendyolCall!.body.getReviews).toBe(true);

      await fetchReviewsViaApify({
        targetUrl: "https://www.g2.com/products/Descript/reviews",
        platformType: "g2",
        maxReviews: 10,
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
      });
      const g2Call = capturedCalls.find((c) => decodeURIComponent(c.url).includes("zen-studio~software-review-scraper"));
      expect(g2Call).toBeDefined();
      expect(g2Call!.body.maxResults).toBeGreaterThanOrEqual(100);
      expect(g2Call!.body.platforms).toEqual(["g2", "capterra"]);
    },
    30_000
  );

  it(
    "18. Timestamp parsing (Unix seconds vs milliseconds vs ISO), publishedAt immutability on re-fetch, and explicit asOf lifecycle window calculations",
    async () => {
      // 1. Unix seconds (< 1e12), Unix milliseconds (>= 1e12), and ISO string parsing
      const secDate = parsePostTimestamp(1760740748);
      expect(secDate?.toISOString()).toBe("2025-10-17T22:39:08.000Z");

      const msDate = parsePostTimestamp(1760740748000);
      expect(msDate?.toISOString()).toBe("2025-10-17T22:39:08.000Z");

      const numStrSecDate = parsePostTimestamp("1760740748");
      expect(numStrSecDate?.toISOString()).toBe("2025-10-17T22:39:08.000Z");

      const isoDate = parsePostTimestamp("2026-10-18T15:05:31.000Z");
      expect(isoDate?.toISOString()).toBe("2026-10-18T15:05:31.000Z");

      // Missing/invalid timestamp must return null (NEVER fetch time / new Date())
      expect(parsePostTimestamp(null)).toBeNull();
      expect(parsePostTimestamp(undefined)).toBeNull();
      expect(parsePostTimestamp("")).toBeNull();
      expect(parsePostTimestamp("not-a-date")).toBeNull();

      // 2. publishedAt preserved on re-fetch and never overwritten with fetchedAt or null
      const profileId = `prof_ts_${randomUUID().slice(0, 8)}`;
      const firstObservedAt = new Date("2026-10-25T10:00:00.000Z");
      await recordOwnedPostObservations({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        ownedProfileId: profileId,
        platform: "instagram",
        observedAt: firstObservedAt,
        acquisitionTaskId: "acq_test_ts_1",
        posts: [
          {
            postId: "3746166402821950550",
            shortcode: "DP9M0N1j1hW",
            permalink: "https://www.instagram.com/p/DP9M0N1j1hW/",
            mediaType: "Sidecar",
            caption: "Original post with valid publication timestamp",
            timestamp: "2026-10-18T15:05:31.000Z",
            likesCount: 15,
            commentsCount: 2,
            viewsCount: null,
          },
        ],
      });

      // Second fetch where provider omits timestamp (null) — must NOT overwrite stored postedAt
      const secondObservedAt = new Date("2026-10-27T12:00:00.000Z");
      await recordOwnedPostObservations({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        ownedProfileId: profileId,
        platform: "instagram",
        observedAt: secondObservedAt,
        acquisitionTaskId: "acq_test_ts_2",
        posts: [
          {
            postId: "3746166402821950550",
            shortcode: "DP9M0N1j1hW",
            permalink: "https://www.instagram.com/p/DP9M0N1j1hW/",
            mediaType: "Sidecar",
            caption: "Original post with valid publication timestamp",
            timestamp: null,
            likesCount: 19,
            commentsCount: 3,
            viewsCount: null,
          },
        ],
      });

      const [storedPost] = await db
        .select()
        .from(ownedPosts)
        .where(and(eq(ownedPosts.ownedProfileId, profileId), eq(ownedPosts.postId, "3746166402821950550")));
      expect(storedPost).toBeDefined();
      expect(storedPost.postedAt?.toISOString()).toBe("2026-10-18T15:05:31.000Z");
      expect(storedPost.lastSeenAt?.toISOString()).toBe("2026-10-27T12:00:00.000Z");

      // Cleanup test owned post rows
      await db.delete(ownedPostSnapshots).where(eq(ownedPostSnapshots.ownedPostId, storedPost.id));
      await db.delete(ownedPosts).where(eq(ownedPosts.id, storedPost.id));

      // 3. Explicit lifecycle window calculation (creation vs initial activation vs active plan v10 vs rolling 30d)
      const lifecycle = {
        campaignCreatedAt: "2026-10-16T09:39:57.097Z",
        campaignCreatedAtMs: new Date("2026-10-16T09:39:57.097Z").getTime(),
        initialActivatedAt: "2026-10-18T08:22:48.856Z",
        initialActivatedAtMs: new Date("2026-10-18T08:22:48.856Z").getTime(),
        activePlanActivatedAt: "2026-10-24T10:31:18.375Z",
        activePlanActivatedAtMs: new Date("2026-10-24T10:31:18.375Z").getTime(),
        campaignWindowStart: "2026-10-18T08:22:48.856Z",
        campaignWindowStartMs: new Date("2026-10-18T08:22:48.856Z").getTime(),
      };
      const samplePosts = [
        { postedAt: "2026-10-18T15:05:31.000Z" }, // After initial activation (Oct 18 08:22Z), before v10 (Oct 24)
        { postedAt: "2026-10-18T14:52:48.000Z" }, // After initial activation
        { postedAt: "2026-10-17T13:21:44.000Z" }, // After creation (Oct 16), before initial activation (Oct 18)
        { postedAt: "2026-10-17T13:16:33.000Z" }, // After creation (Oct 16), before initial activation (Oct 18)
        { postedAt: "2026-10-15T12:12:41.000Z" }, // Before creation, inside rolling 30d
        { postedAt: "2025-10-17T22:39:08.000Z" }, // 2025 historical post (outside rolling 30d)
      ];
      const counts = calculateOwnedPlatformWindowCounts(
        samplePosts,
        lifecycle,
        new Date("2026-10-25T15:25:00.000Z")
      );
      expect(counts.postsSinceCreationCount).toBe(4);
      expect(counts.postsSinceActivationCount).toBe(2);
      expect(counts.activePlanWindowPostCount).toBe(0);
      expect(counts.rolling30dPostCount).toBe(5);
    },
    30_000
  );

  it(
    "19. LinkedIn COMPANY_PROFILE vs COMPANY_FEED_POST separation, PROFILE never satisfies POSTS, and empty feed never falls back to profile dossier",
    async () => {
      // 1. Capability separation in inferDefaultProviderAndActor and isTaskCompatibleWithRequest
      expect(inferDefaultProviderAndActor("LINKEDIN", "PROFILE").actorId).toBe("harvestapi~linkedin-company");
      expect(inferDefaultProviderAndActor("LINKEDIN", "POSTS").actorId).toBe("harvestapi~linkedin-company-posts");
      expect(inferDefaultProviderAndActor("X", "PROFILE").actorId).toBe("apidojo~twitter-user-scraper");
      expect(inferDefaultProviderAndActor("X", "POSTS").actorId).toBe("apidojo~tweet-scraper");

      const profileTask = {
        accountId: TEST_ACCOUNT_A,
        entityType: "COMPETITOR",
        entityId: "comp_li_test",
        sourcePlatform: "LINKEDIN",
        capability: "PROFILE",
        taskType: "PROFILE",
        inputPayload: { canonicalUrl: "https://www.linkedin.com/company/songfinch" },
      };
      const postsRequest = {
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MI_V3",
        trigger: "MANUAL_USER",
        entityType: "COMPETITOR",
        entityId: "comp_li_test",
        platform: "LINKEDIN",
        capability: "POSTS",
        canonicalUrl: "https://www.linkedin.com/company/songfinch",
      };
      expect(isTaskCompatibleWithRequest(profileTask, postsRequest as any)).toBe(false);

      // 2. Empty LinkedIn company-posts feed returns 0 items and NEVER calls harvestapi~linkedin-company
      const calledActors: string[] = [];
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/runs")) {
            calledActors.push(decodeURIComponent(url));
            return {
              data: { id: "run_li_empty", status: "SUCCEEDED", defaultDatasetId: "ds_li_empty", usageTotalUsd: 0.002 },
            };
          }
          if (url.includes("/actor-runs/run_li_empty")) {
            return {
              data: { id: "run_li_empty", status: "SUCCEEDED", defaultDatasetId: "ds_li_empty", usageTotalUsd: 0.002 },
            };
          }
          if (url.includes("/datasets/ds_li_empty/items")) {
            return [];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      const emptyFeedRes = await fetchLinkedInEvidence({
        profileUrl: "https://www.linkedin.com/company/songfinch",
        capability: "POSTS",
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
        competitorId: "comp_li_test",
      });
      expect(emptyFeedRes.items.length).toBe(0);
      expect(emptyFeedRes.report.evidenceType).toBe("COMPANY_FEED_POST");
      expect(emptyFeedRes.report.actorId).toBe("harvestapi~linkedin-company-posts");
      expect(calledActors.some((u) => u.includes("harvestapi~linkedin-company-posts"))).toBe(true);
      expect(calledActors.some((u) => u.endsWith("/acts/harvestapi~linkedin-company/runs"))).toBe(false);

      // 3. Hard persistence guard rejects COMPANY_PROFILE / company_* items from ci_competitor_posts
      const compId = `comp_li_guard_${randomUUID().slice(0, 8)}`;
      const persistRes = await persistExternalEvidenceToDb([
        {
          id: `ext_li_prof_${compId}`,
          platform: "LINKEDIN",
          evidenceType: "COMPANY_PROFILE",
          externalId: "company_10791842",
          title: "Songfinch",
          text: "Songfinch company profile dossier",
          url: "https://www.linkedin.com/company/songfinch",
          authorName: "Songfinch",
          publishedAt: null,
          campaignId: TEST_CAMPAIGN_A,
          accountId: TEST_ACCOUNT_A,
          competitorId: compId,
          authorityClass: "COMPETITOR_SELF_CLAIM",
          rawPayload: {},
          fetchedAt: new Date().toISOString(),
        },
        {
          id: `ext_li_post_${compId}`,
          platform: "LINKEDIN",
          evidenceType: "COMPANY_FEED_POST",
          externalId: "7385001122334455667",
          title: "New custom song feature launch",
          text: "We just launched our new studio experience for custom songs!",
          url: "https://www.linkedin.com/posts/google_7385001122334455667",
          authorName: "Google",
          publishedAt: "2026-10-20T14:00:00.000Z",
          campaignId: TEST_CAMPAIGN_A,
          accountId: TEST_ACCOUNT_A,
          competitorId: compId,
          authorityClass: "COMPETITOR_SELF_CLAIM",
          engagementMetrics: { likes: 120, comments: 14 },
          rawPayload: {},
          fetchedAt: new Date().toISOString(),
        },
      ]);
      expect(persistRes.persistedIds.length).toBe(1);
      expect(persistRes.persistedIds[0]).toContain("7385001122334455667");

      const storedPosts = await db
        .select()
        .from(ciCompetitorPosts)
        .where(and(eq(ciCompetitorPosts.accountId, TEST_ACCOUNT_A), eq(ciCompetitorPosts.competitorId, compId)));
      expect(storedPosts.length).toBe(1);
      expect(storedPosts[0].postId).toBe("7385001122334455667");
    },
    30_000
  );

  it(
    "20. Trendyol review vs product metadata separation + X profile vs X posts capability separation",
    async () => {
      // 1. Trendyol dataset with 1 type='product' item and 2 type='review' items
      const compTrendyolId = `comp_ty_${randomUUID().slice(0, 8)}`;
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/acts/fatihtahta~trendyol-scraper/runs")) {
            return {
              data: { id: "run_ty_sep", status: "SUCCEEDED", defaultDatasetId: "ds_ty_sep", usageTotalUsd: 0.0045 },
            };
          }
          if (url.includes("/actor-runs/run_ty_sep")) {
            return {
              data: { id: "run_ty_sep", status: "SUCCEEDED", defaultDatasetId: "ds_ty_sep", usageTotalUsd: 0.0045 },
            };
          }
          if (url.includes("/datasets/ds_ty_sep/items")) {
            return [
              {
                type: "product",
                id: "800623487",
                title: "Sony Playstation 5 Slim Digital Edition",
                brand: "Sony",
                url: "https://www.trendyol.com/sony/ps5-p-800623487",
                average_rating: 4.56,
                rating_count: 356,
                comment_count: 2224,
              },
              {
                type: "review",
                product_id: 800623487,
                review_id: 472867132,
                rate: 5,
                comment: "Cok hizli kargo ve orijinal urun, tesekkurler!",
                created_at: 1719507036044,
                date_text: "27 Haziran 2024",
                reviewer: { name: "Ahmet Y." },
                like_count: 3,
              },
              {
                type: "review",
                product_id: 800623487,
                review_id: 557430309,
                rate: 4,
                comment: "Paketleme guzeldi, sorunsuz calisiyor.",
                created_at: 1731569362241,
                date_text: "14 Kasim 2024",
                reviewer: { name: "Mehmet K." },
                like_count: 1,
              },
            ];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      const tyRes = await fetchReviewsViaApify({
        targetUrl: "https://www.trendyol.com/sony/ps5-p-800623487",
        platformType: "trendyol",
        maxReviews: 5,
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
        competitorId: compTrendyolId,
      });

      expect(tyRes.report.rawCount).toBe(3);
      expect(tyRes.report.rawProductCount).toBe(1);
      expect(tyRes.report.rawReviewCount).toBe(2);
      expect(tyRes.report.acceptedCount).toBe(2);
      expect(tyRes.reviewsStored).toBe(2);
      expect(tyRes.report.productMetadata?.productId).toBe("800623487");
      expect(tyRes.report.productMetadata?.commentCount).toBe(2224);

      const storedTyReviews = await db
        .select()
        .from(ciCompetitorReviews)
        .where(and(eq(ciCompetitorReviews.accountId, TEST_ACCOUNT_A), eq(ciCompetitorReviews.competitorId, compTrendyolId)));
      expect(storedTyReviews.length).toBe(2);
      expect(storedTyReviews.map((r) => r.reviewId).sort()).toEqual(["472867132", "557430309"]);
      expect(storedTyReviews.find((r) => r.reviewId === "472867132")?.reviewDate?.toISOString()).toBe(
        new Date(1719507036044).toISOString()
      );

      // 2. X Profile capability calls apidojo~twitter-user-scraper with getFollowers=false, getFollowing=false, and returns X_PROFILE dossier
      let xProfileBody: any = null;
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/acts/apidojo~twitter-user-scraper/runs")) {
            xProfileBody = JSON.parse(String(init.body || "{}"));
            return {
              data: { id: "run_x_prof_1", status: "SUCCEEDED", defaultDatasetId: "ds_x_prof_1", usageTotalUsd: 0.001 },
            };
          }
          if (url.includes("/actor-runs/run_x_prof_1")) {
            return {
              data: { id: "run_x_prof_1", status: "SUCCEEDED", defaultDatasetId: "ds_x_prof_1", usageTotalUsd: 0.001 },
            };
          }
          if (url.includes("/datasets/ds_x_prof_1/items")) {
            return [
              {
                type: "user",
                id: "2425925568",
                userName: "apify",
                name: "Apify",
                description: "Full-stack web scraping and browser automation platform.",
                followers: 14500,
                following: 410,
                statusesCount: 3820,
                isBlueVerified: true,
                url: "https://x.com/apify",
                createdAt: "Fri Apr 04 09:00:00 +0000 2014",
              },
            ];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      const xProfRes = await fetchXProfileViaApify({
        handle: "https://x.com/apify",
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
        competitorId: "comp_x_prof_test",
      });
      expect(xProfileBody).toBeDefined();
      expect(xProfileBody.twitterHandles).toEqual(["apify"]);
      expect(xProfileBody.getFollowers).toBe(false);
      expect(xProfileBody.getFollowing).toBe(false);
      expect(xProfRes.report.evidenceType).toBe("X_PROFILE");
      expect(xProfRes.report.acceptedCount).toBe(1);
      expect(xProfRes.profileDossier?.userId).toBe("2425925568");
      expect(xProfRes.profileDossier?.userName).toBe("apify");
      expect(xProfRes.profileDossier?.followers).toBe(14500);
    },
    30_000
  );

  it(
    "21. Inconclusive zero-result vs confirmed empty source at shared authority, Trendyol search query normalization, and Watchtower/Performance false-decline suppression",
    async () => {
      // 1. classifyAcquisitionError distinguishes INCONCLUSIVE_ZERO_RESULT from CONFIRMED_EMPTY_SOURCE
      const inconclusiveDecision = classifyAcquisitionError({
        itemsCount: 0,
        isConfirmedEmpty: false,
      });
      expect(inconclusiveDecision.terminalOutcome).toBe("INCONCLUSIVE_ZERO_RESULT");
      expect(inconclusiveDecision.errorCode).toBe("INCONCLUSIVE_ZERO_RESULT");
      expect(inconclusiveDecision.retryDecision).toBe("NO_RETRY_INCONCLUSIVE_EMPTY");
      expect(inconclusiveDecision.retryable).toBe(false);

      const confirmedDecision = classifyAcquisitionError({
        itemsCount: 0,
        isConfirmedEmpty: true,
      });
      expect(confirmedDecision.terminalOutcome).toBe("CONFIRMED_EMPTY_SOURCE");
      expect(confirmedDecision.errorCode).toBeNull();
      expect(confirmedDecision.retryDecision).toBe("NO_RETRY_CONFIRMED_EMPTY");

      // 2. Shared authority persists INCONCLUSIVE_ZERO_RESULT / EMPTY_INCONCLUSIVE and never caches it as confirmed empty
      const compInconcId = `comp_inconc_${randomUUID().slice(0, 8)}`;
      const inconcOutcome = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MI_V3",
        trigger: "TEST_INCONCLUSIVE_EMPTY",
        entityType: "COMPETITOR",
        entityId: compInconcId,
        platform: "LINKEDIN",
        canonicalUrl: "https://www.linkedin.com/company/songfinch",
        capability: "POSTS",
        forceRefresh: true,
        customExecutor: async () => ({
          status: "EMPTY_INCONCLUSIVE",
          providerRunId: "run_inconc_li_1",
          datasetId: "ds_inconc_li_1",
          itemsStored: 0,
          isConfirmedEmpty: false,
        }),
      });
      expect(inconcOutcome.status).toBe("COMPLETED");
      expect(inconcOutcome.terminalOutcome).toBe("INCONCLUSIVE_ZERO_RESULT");
      expect(inconcOutcome.errorCode).toBe("INCONCLUSIVE_ZERO_RESULT");
      expect(inconcOutcome.consumerDeliveryStatus).toBe("EMPTY_INCONCLUSIVE");

      const [obsRow] = await db
        .select()
        .from(rawAcquisitionObservations)
        .where(eq(rawAcquisitionObservations.id, inconcOutcome.observationIds[0]));
      expect(obsRow.coverageStatus).toBe("EMPTY_INCONCLUSIVE");

      // Subsequent request with forceRefresh=false must NOT reuse INCONCLUSIVE_ZERO_RESULT from cache
      const followUpOutcome = await requestAcquisition({
        accountId: TEST_ACCOUNT_A,
        campaignId: TEST_CAMPAIGN_A,
        requesterEngine: "MI_V3",
        trigger: "TEST_INCONCLUSIVE_RETRY",
        entityType: "COMPETITOR",
        entityId: compInconcId,
        platform: "LINKEDIN",
        canonicalUrl: "https://www.linkedin.com/company/songfinch",
        capability: "POSTS",
        forceRefresh: false,
        customExecutor: async () => ({
          status: "COMPLETED",
          providerRunId: "run_inconc_li_2",
          datasetId: "ds_inconc_li_2",
          itemsStored: 2,
          isConfirmedEmpty: false,
        }),
      });
      expect(followUpOutcome.resolutionType).toBe("NEW_FETCH");
      expect(followUpOutcome.terminalOutcome).toBe("SUCCESS_WITH_CONTENT");
      expect(followUpOutcome.itemsStored).toBe(2);

      // 3. Trendyol search URL (/sr?q=kulaklik) passes queries=["kulaklik"] + os=1, and 0-item run returns isConfirmedEmpty=false
      let capturedTrendyolSearchInput: any = null;
      setApifyTestHttpHandler(
        async (url, init) => {
          if (init?.method === "POST" && url.includes("/acts/fatihtahta~trendyol-scraper/runs")) {
            capturedTrendyolSearchInput = JSON.parse(String(init.body || "{}"));
            return {
              data: { id: "run_ty_empty", status: "SUCCEEDED", defaultDatasetId: "ds_ty_empty", usageTotalUsd: 0.001 },
            };
          }
          if (url.includes("/actor-runs/run_ty_empty")) {
            return {
              data: { id: "run_ty_empty", status: "SUCCEEDED", defaultDatasetId: "ds_ty_empty", usageTotalUsd: 0.001 },
            };
          }
          if (url.includes("/datasets/ds_ty_empty/items")) {
            return [];
          }
          return {};
        },
        { pollIntervalMs: 10 }
      );

      const tyEmptyRes = await fetchReviewsViaApify({
        targetUrl: "https://www.trendyol.com/sr?q=kulaklik",
        platformType: "trendyol",
        maxReviews: 5,
        campaignId: TEST_CAMPAIGN_A,
        accountId: TEST_ACCOUNT_A,
        competitorId: compInconcId,
      });
      expect(capturedTrendyolSearchInput.queries).toEqual(["kulaklik"]);
      expect(capturedTrendyolSearchInput.startUrls[0]).toContain("os=1");
      expect(capturedTrendyolSearchInput.limit).toBeGreaterThanOrEqual(10);
      expect(tyEmptyRes.report.isConfirmedEmpty).toBe(false);

      // 4. translateEnvelopeToLanePayload marks empty/inconclusive competitor_linkedin, competitor_x, competitor_google_search, and user_channel as is_empty_or_failed=true
      const { translateEnvelopeToLanePayload } = await import("../boss/envelope-to-lane");
      const { classifyWatchtowerChanges } = await import("../watchtower/orchestrator");

      const emptyLiLane = translateEnvelopeToLanePayload({
        acquisition_id: "acq_empty_li",
        account_id: TEST_ACCOUNT_A,
        campaign_id: TEST_CAMPAIGN_A,
        lane: "competitor",
        entity_type: "competitor_linkedin",
        entity_id: compInconcId,
        source_adapter: "linkedin-posts-v1",
        collected_at: new Date().toISOString(),
        payload: { posts: [] },
        provenance: { cache_hit: false, warnings: [] },
      });
      expect(emptyLiLane?.is_empty_or_failed).toBe(true);

      const emptyUserLane = translateEnvelopeToLanePayload({
        acquisition_id: "acq_empty_user",
        account_id: TEST_ACCOUNT_A,
        campaign_id: TEST_CAMPAIGN_A,
        lane: "user",
        entity_type: "user_channel",
        entity_id: TEST_ACCOUNT_A,
        source_adapter: "user-channel-v1",
        collected_at: new Date().toISOString(),
        payload: {},
        provenance: { cache_hit: false, warnings: ["inconclusive_zero_result"] },
      });
      expect(emptyUserLane?.is_empty_or_failed).toBe(true);

      const priorValidLane = {
        acquisition_id: "acq_prev_li",
        patterns: ["Custom song gift for wedding"],
        frequency: 4,
      };
      const diffs = classifyWatchtowerChanges(emptyLiLane as any, priorValidLane as any, "snap_curr", "snap_prev");
      expect(diffs).toEqual([]);
    },
    30_000
  );
});
