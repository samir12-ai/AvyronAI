import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import {
  acquisitionTasks,
  evidenceManifests,
  ciCompetitors,
  ciCompetitorPosts,
  ciCompetitorComments,
  ciCompetitorReviews,
  marketVoiceEvidence,
  campaignOfferings,
  offeringInputEvidence,
  businessUnderstandingSnapshots,
  orchestratorJobs,
  type EvidenceManifest,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import {
  planAcquisitionTasks,
  claimNextTask,
  completeTask,
  failTask,
  freezeEvidenceManifest,
  getFrozenManifest,
  executeAcquisitionBatch,
} from "../acquisition/coordinator";
import {
  loadCanonicalCustomerVoice,
  loadCanonicalCompetitorContent,
} from "../competitive-intelligence/evidence-routing";
import {
  getStoredPostsForMIv3,
  getStoredCommentsForMIv3,
  getStoredReviewsForMIv3,
} from "../competitive-intelligence/data-acquisition";
import { executeMarketVoiceAnalysis } from "../market-voice/pipeline";
import { summarizeEngine } from "../agent/summarizers";
import { StrategyExperienceService } from "../strategy-experience/service";

describe("Multi-Source Pipeline Wiring & Strict Manifest Tests", () => {
  const testCampaignId = `test_camp_repair_${Date.now()}`;
  const testAccountId = `test_acc_repair_${Date.now()}`;
  const testCompetitorId = `test_comp_repair_${Date.now()}`;

  beforeEach(async () => {
    // Clean test campaign data
    await db.delete(acquisitionTasks).where(eq(acquisitionTasks.campaignId, testCampaignId));
    await db.delete(evidenceManifests).where(eq(evidenceManifests.campaignId, testCampaignId));
    await db.delete(ciCompetitorComments).where(eq(ciCompetitorComments.competitorId, testCompetitorId));
    await db.delete(ciCompetitorReviews).where(eq(ciCompetitorReviews.competitorId, testCompetitorId));
    await db.delete(ciCompetitorPosts).where(eq(ciCompetitorPosts.competitorId, testCompetitorId));
    await db.delete(marketVoiceEvidence).where(eq(marketVoiceEvidence.campaignId, testCampaignId));
    await db.delete(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.campaignId, testCampaignId));
    await db.delete(campaignOfferings).where(eq(campaignOfferings.campaignId, testCampaignId));
    await db.delete(offeringInputEvidence).where(eq(offeringInputEvidence.campaignId, testCampaignId));
    await db.delete(ciCompetitors).where(eq(ciCompetitors.campaignId, testCampaignId));
  });

  describe("Coordinator Task Planning & Dependency Wiring", () => {
    it("generates deterministic taskKeys containing cycleToken and encodes dependencies", async () => {
      // Seed an active competitor
      await db.insert(ciCompetitors).values({
        id: testCompetitorId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        name: "Test Competitor Baklava",
        businessType: "DIRECT_COMPETITOR",
        primaryObjective: "CUSTOMER_ACQUISITION",
        isActive: true,
      });

      const { competitorSources } = await import("@shared/schema");
      await db.insert(competitorSources).values({
        id: `csrc_${Date.now()}`,
        accountId: testAccountId,
        campaignId: testCampaignId,
        competitorId: testCompetitorId,
        platform: "INSTAGRAM",
        canonicalUrl: "https://instagram.com/testbaklava",
        externalAccountId: "testbaklava",
        status: "ACTIVE",
      });

      const mockContext: any = {
        accountId: testAccountId,
        campaignId: testCampaignId,
        category: "Confectionery",
        offeringName: "Artisan Baklava Box",
        targetMarket: "Turkey",
        targetLanguage: "tr",
        canonicalDomain: "baklawati.com.tr",
      };

      const cycleToken = `orch_job_test_${Date.now()}`;
      const plan = await planAcquisitionTasks(mockContext, { cycleToken });
      expect(plan.tasksPlanned).toBeGreaterThanOrEqual(2);

      // Verify tasks in database
      const tasks = await db
        .select()
        .from(acquisitionTasks)
        .where(eq(acquisitionTasks.campaignId, testCampaignId));

      const postsTask = tasks.find((t) => t.sourcePlatform === "INSTAGRAM" && t.taskType === "POSTS");
      const commentsTask = tasks.find((t) => t.sourcePlatform === "INSTAGRAM" && t.taskType === "COMMENTS");
      const mvTask = tasks.find((t) => t.sourcePlatform === "MARKET_VOICE" && t.taskType === "SEARCH_QUOTES");

      expect(postsTask).toBeDefined();
      expect(postsTask!.taskKey).toContain(cycleToken);
      expect(postsTask!.priority).toBe(100);

      expect(commentsTask).toBeDefined();
      expect(commentsTask!.taskKey).toContain(cycleToken);
      expect(commentsTask!.priority).toBe(80);
      expect((commentsTask!.inputPayload as any)?.dependsOn).toBe(postsTask!.id);

      expect(mvTask).toBeDefined();
      expect(mvTask!.taskKey).toContain(cycleToken);
      expect(mvTask!.priority).toBe(110);
    });

    it("executes batch with dependency ordering and bounded concurrency", async () => {
      await db.insert(ciCompetitors).values({
        id: testCompetitorId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        name: "Test Competitor Sweets",
        businessType: "DIRECT_COMPETITOR",
        primaryObjective: "CUSTOMER_ACQUISITION",
        isActive: true,
      });

      const mockContext: any = {
        accountId: testAccountId,
        campaignId: testCampaignId,
        category: "Sweets",
        offeringName: "Baklava Box",
        targetMarket: "Turkey",
        targetLanguage: "tr",
        canonicalDomain: "baklawati.com.tr",
      };

      const cycleToken = `orch_batch_test_${Date.now()}`;
      const batchResult = await executeAcquisitionBatch(mockContext, {
        orchestrationJobId: cycleToken,
        concurrencyLimit: 3,
        batchDeadlineMs: 10_000,
      });

      expect(batchResult.totalTasksPlanned).toBeGreaterThan(0);
      expect(batchResult.durationMs).toBeLessThan(10_000);

      // Verify tasks in DB reached completed or skipped states
      const tasks = await db
        .select()
        .from(acquisitionTasks)
        .where(eq(acquisitionTasks.campaignId, testCampaignId));

      for (const t of tasks) {
        expect(["COMPLETED", "SKIPPED", "FAILED"]).toContain(t.status);
      }
    });
  });

  describe("Strict Evidence Manifest Filtering", () => {
    it("strictly isolates evidence reads to manifest-pinned record IDs", async () => {
      // Seed competitor first for foreign key safety
      await db.insert(ciCompetitors).values({
        id: testCompetitorId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        name: "Test Competitor Pinned",
        businessType: "DIRECT_COMPETITOR",
        primaryObjective: "CUSTOMER_ACQUISITION",
        isActive: true,
      });

      // 1. Seed two posts: one pinned in manifest, one unpinned
      const pinnedPostId = `post_pinned_${Date.now()}`;
      const unpinnedPostId = `post_unpinned_${Date.now()}`;

      await db.insert(ciCompetitorPosts).values([
        {
          id: pinnedPostId,
          postId: `ext_${pinnedPostId}`,
          accountId: testAccountId,
          competitorId: testCompetitorId,
          caption: "Pinned authentic pistachio baklava",
          platform: "instagram",
        },
        {
          id: unpinnedPostId,
          postId: `ext_${unpinnedPostId}`,
          accountId: testAccountId,
          competitorId: testCompetitorId,
          caption: "Unpinned post that should NOT be read",
          platform: "instagram",
        },
      ]);

      // 2. Seed two comments: one pinned, one unpinned
      const pinnedCommentId = `comm_pinned_${Date.now()}`;
      const unpinnedCommentId = `comm_unpinned_${Date.now()}`;

      await db.insert(ciCompetitorComments).values([
        {
          id: pinnedCommentId,
          commentId: `ext_${pinnedCommentId}`,
          accountId: testAccountId,
          competitorId: testCompetitorId,
          postId: `ext_${pinnedPostId}`,
          commentText: "Pinned delicious baklava comment",
          authorType: "customer",
          isSynthetic: false,
        },
        {
          id: unpinnedCommentId,
          commentId: `ext_${unpinnedCommentId}`,
          accountId: testAccountId,
          competitorId: testCompetitorId,
          postId: `ext_${unpinnedPostId}`,
          commentText: "Unpinned comment",
          authorType: "customer",
          isSynthetic: false,
        },
      ]);

      // 3. Seed two reviews: one pinned, one unpinned
      const pinnedReviewId = `rev_pinned_${Date.now()}`;
      const unpinnedReviewId = `rev_unpinned_${Date.now()}`;

      await db.insert(ciCompetitorReviews).values([
        {
          id: pinnedReviewId,
          reviewId: `ext_${pinnedReviewId}`,
          accountId: testAccountId,
          campaignId: testCampaignId,
          competitorId: testCompetitorId,
          reviewText: "Pinned 5-star Google review",
          rating: 5,
          platform: "google",
          isSynthetic: false,
        },
        {
          id: unpinnedReviewId,
          reviewId: `ext_${unpinnedReviewId}`,
          accountId: testAccountId,
          campaignId: testCampaignId,
          competitorId: testCompetitorId,
          reviewText: "Unpinned review",
          rating: 4,
          platform: "google",
          isSynthetic: false,
        },
      ]);

      // 4. Create mock manifest including ONLY the pinned IDs
      const mockManifest: EvidenceManifest = {
        id: `evm_test_${Date.now()}`,
        campaignId: testCampaignId,
        accountId: testAccountId,
        orchestrationJobId: `job_${Date.now()}`,
        contextFingerprint: "fingerprint_test_123",
        manifestVersion: 1,
        status: "FROZEN",
        includedPostIds: [pinnedPostId],
        includedCommentIds: [pinnedCommentId],
        includedReviewIds: [pinnedReviewId],
        includedMarketVoiceIds: [],
        includedWebSnapshotIds: [],
        evidencePoolCounts: { primaryMarketVoice: 0, supportingSocialVoice: 2, benchmarkContext: 0, totalUnits: 2 } as any,
        sourceDiversityReport: {} as any,
        frozenAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Test data acquisition loader filtering
      const filteredPosts = await getStoredPostsForMIv3(testCompetitorId, testAccountId, mockManifest.includedPostIds as string[]);
      expect(filteredPosts.length).toBe(1);
      expect(filteredPosts[0].caption).toContain("Pinned authentic pistachio baklava");

      const filteredComments = await getStoredCommentsForMIv3(testCompetitorId, testAccountId, mockManifest.includedCommentIds as string[]);
      expect(filteredComments.length).toBe(1);
      expect(filteredComments[0].text).toContain("Pinned delicious baklava comment");

      const filteredReviews = await getStoredReviewsForMIv3(testCompetitorId, testAccountId, mockManifest.includedReviewIds as string[]);
      expect(filteredReviews.length).toBe(1);
      expect(filteredReviews[0].text).toContain("Pinned 5-star Google review");

      // Test empty manifest returns empty arrays without leaking unpinned records
      const emptyPosts = await getStoredPostsForMIv3(testCompetitorId, testAccountId, []);
      expect(emptyPosts.length).toBe(0);

      const emptyComments = await getStoredCommentsForMIv3(testCompetitorId, testAccountId, []);
      expect(emptyComments.length).toBe(0);

      const emptyReviews = await getStoredReviewsForMIv3(testCompetitorId, testAccountId, []);
      expect(emptyReviews.length).toBe(0);

      // Test evidence routing loader strictly respects manifest
      const manifestCustomerVoice = await loadCanonicalCustomerVoice(testAccountId, testCampaignId, {
        evidenceManifest: mockManifest,
      });
      const commentUnits = manifestCustomerVoice.filter((u) => u.origin === "COMPETITOR_COMMENT");
      const reviewUnits = manifestCustomerVoice.filter((u) => u.origin === "COMPETITOR_REVIEW");
      expect(commentUnits.length).toBe(1);
      expect(commentUnits[0].text).toBe("Pinned delicious baklava comment");
      expect(reviewUnits.length).toBe(1);
      expect(reviewUnits[0].text).toBe("Pinned 5-star Google review");

      const manifestCompetitorContent = await loadCanonicalCompetitorContent(testAccountId, testCampaignId, {
        evidenceManifest: mockManifest,
      });
      expect(manifestCompetitorContent.length).toBe(1);
      expect(manifestCompetitorContent[0].caption).toBe("Pinned authentic pistachio baklava");
    });
  });

  describe("Market Voice Contract & Status Mapping", () => {
    it("returns INCOMPLETE when combined customer evidence is insufficient regardless of quote count", async () => {
      // Seed a competitor and offering
      await db.insert(ciCompetitors).values({
        id: testCompetitorId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        name: "Test Competitor",
        businessType: "DIRECT_COMPETITOR",
        primaryObjective: "CUSTOMER_ACQUISITION",
        isActive: true,
      });

      const offeringEvidenceId = `oie_test_${Date.now()}`;
      const offeringId = `off_test_${Date.now()}`;

      await db.insert(offeringInputEvidence).values({
        id: offeringEvidenceId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        campaignOfferingId: offeringId,
        rawOfferingName: "Fresh Antep Pistachio Baklava Gift Box",
        rawFeaturesAndNotes: "Pistachio baklava gift box",
        contentHash: "hash_test_123",
        authorityType: "USER_CONFIRMED",
        createdAt: new Date(),
      });

      await db.insert(campaignOfferings).values({
        id: offeringId,
        accountId: testAccountId,
        campaignId: testCampaignId,
        offeringName: "Fresh Antep Pistachio Baklava Gift Box",
        sourceInputEvidenceId: offeringEvidenceId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.insert(businessUnderstandingSnapshots).values({
        id: `bu_test_${Date.now()}`,
        accountId: testAccountId,
        campaignId: testCampaignId,
        websiteSnapshotId: `ws_test_${Date.now()}`,
        offeringInputEvidenceId: offeringEvidenceId,
        campaignOfferingId: offeringId,
        businessUnderstanding: {
          campaignOfferingId: offeringId,
          businessName: "Baklawati Test",
          offeringUnderstanding: {
            offeringName: "Fresh Antep Pistachio Baklava Gift Box",
            category: "Confectionery",
          },
        },
        status: "COMPLETE",
      });

      // Execute analysis when combined corpus is insufficient
      const analysisResult = await executeMarketVoiceAnalysis({
        accountId: testAccountId,
        campaignId: testCampaignId,
        campaignOfferingId: offeringId,
        forceRefresh: true,
        acquisitionSummary: {
          evidenceUnitsPersisted: 15, // Saved 15 quotes!
          approvedEvidenceIds: ["q1", "q2", "q3"],
        },
      });

      // Loophole closed: even with 15 persisted quotes, insufficient combined readiness returns INCOMPLETE
      expect(analysisResult.status).toBe("INCOMPLETE");
      expect(analysisResult.statusMessage).toContain("PRIMARY_MARKET_VOICE_INCOMPLETE");
    });

    it("summarizes BLOCKED and INCOMPLETE engines with human-readable reason instead of generic error", () => {
      const summaryBlocked = summarizeEngine(
        "audience" as any,
        null,
        "BLOCKED",
        "PRIMARY_MARKET_VOICE_INCOMPLETE: Customer evidence corpus is semantically insufficient"
      );
      expect(summaryBlocked).toBe("Blocked — PRIMARY_MARKET_VOICE_INCOMPLETE: Customer evidence corpus is semantically insufficient");
      expect(summaryBlocked).not.toContain("Engine encountered an error");

      const summaryIncomplete = summarizeEngine(
        "audience" as any,
        null,
        "INCOMPLETE",
        "PRIMARY_MARKET_VOICE_INCOMPLETE: Customer evidence corpus is semantically insufficient"
      );
      expect(summaryIncomplete).toBe("Blocked — PRIMARY_MARKET_VOICE_INCOMPLETE: Customer evidence corpus is semantically insufficient");
      expect(summaryIncomplete).not.toContain("Engine encountered an error");
    });

    it("verifies getRunProgress maps INCOMPLETE to BLOCKED and displays human-readable summary instead of WAITING", async () => {
      const mockJobId = `mock_job_progress_${Date.now()}`;
      await db.insert(orchestratorJobs).values({
        id: mockJobId,
        blueprintId: "orchestrator-v2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        status: "BLOCKED",
        sectionStatuses: JSON.stringify([
          { id: "market_intelligence", name: "Market Intelligence", status: "SUCCESS", summary: "Found 12 competitors." },
          { id: "market_voice", name: "Market Voice", status: "COMPLETE", summary: "Completed." },
          { id: "audience", name: "Audience Engine", status: "INCOMPLETE", summary: "Strategic lane grouping failed — zero valid lanes formed" },
          { id: "differentiation", name: "Differentiation Engine", status: "SKIPPED", summary: "Skipped — Blocked by upstream failure in Audience Engine" },
        ]),
      });

      const progress = await StrategyExperienceService.getRunProgress(mockJobId, testAccountId);
      expect(progress).not.toBeNull();
      expect(progress?.status).toBe("BLOCKED");
      expect(progress?.completedCount).toBe(2); // market_intelligence + market_voice

      const miStage = progress?.stages.find(s => s.id === "market_intelligence");
      expect(miStage?.status).toBe("COMPLETED");
      expect(miStage?.displayMessage).toBe("Found 12 competitors.");

      const mvStage = progress?.stages.find(s => s.id === "market_voice");
      expect(mvStage?.status).toBe("COMPLETED");
      expect(mvStage?.displayMessage).toBe("Completed.");

      const audStage = progress?.stages.find(s => s.id === "audience");
      expect(audStage?.status).toBe("BLOCKED");
      expect(audStage?.displayMessage).toBe("Strategic lane grouping failed — zero valid lanes formed");
      expect(audStage?.status).not.toBe("WAITING");

      const diffStage = progress?.stages.find(s => s.id === "differentiation");
      expect(diffStage?.status).toBe("BLOCKED");
      expect(diffStage?.displayMessage).toBe("Skipped — Blocked by upstream failure in Audience Engine");
      expect(diffStage?.displayMessage).not.toContain("undefined");

      // Cleanup mock job
      await db.delete(orchestratorJobs).where(eq(orchestratorJobs.id, mockJobId));
    });

    it("verifies getRunProgress displays live RUNNING message during pre-freeze acquisition", async () => {
      const mockJobId = `mock_job_acq_${Date.now()}`;
      await db.insert(orchestratorJobs).values({
        id: mockJobId,
        blueprintId: "orchestrator-v2",
        accountId: testAccountId,
        campaignId: testCampaignId,
        status: "RUNNING",
        sectionStatuses: JSON.stringify([
          { id: "market_intelligence", name: "Market Intelligence", status: "RUNNING", summary: "Acquiring multi-source competitor and customer evidence..." },
          { id: "market_voice", name: "Market Voice", status: "PENDING" },
        ]),
      });

      const progress = await StrategyExperienceService.getRunProgress(mockJobId, testAccountId);
      expect(progress).not.toBeNull();
      expect(progress?.status).toBe("RUNNING");
      expect(progress?.currentStage).toBe("Market Intelligence");

      const miStage = progress?.stages.find(s => s.id === "market_intelligence");
      expect(miStage?.status).toBe("RUNNING");
      expect(miStage?.displayMessage).toBe("Acquiring multi-source competitor and customer evidence...");

      // Cleanup mock job
      await db.delete(orchestratorJobs).where(eq(orchestratorJobs.id, mockJobId));
    });
  });
});
