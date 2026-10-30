import "dotenv/config";
import { describe, it, expect, beforeEach } from "vitest";
import { normalizeDomain } from "../discovery/context-binder";
import { rankAndSamplePostsForComments, type PostCandidateForComments } from "../competitive-intelligence/profile-scraper";
import {
  planAcquisitionTasks,
  claimNextTask,
  completeTask,
  failTask,
  freezeEvidenceManifest,
  getFrozenManifest,
} from "../acquisition/coordinator";
import { runFinalEvidenceJudge } from "../market-voice/evidence-verifier";
import { db } from "../db";
import { acquisitionTasks, evidenceManifests, ciCompetitors, ciCompetitorPosts } from "@shared/schema";
import { eq } from "drizzle-orm";

describe("Multi-Source Evidence Pipeline & Coordinator Tests", () => {
  describe("Domain Normalization & Authority Grounding", () => {
    it("correctly normalizes domains without protocols, www, or trailing paths", () => {
      expect(normalizeDomain("https://baklawati.com.tr/")).toBe("baklawati.com.tr");
      expect(normalizeDomain("http://www.baklawati.com.tr/products/special")).toBe("baklawati.com.tr");
      expect(normalizeDomain("baklawati.com.tr")).toBe("baklawati.com.tr");
      expect(normalizeDomain("https://gulluoglu.com/")).toBe("gulluoglu.com");
      expect(normalizeDomain("")).toBe("");
    });
  });

  describe("Unified Comment Sampling Policy", () => {
    it("applies composite scoring and strictly enforces 3-post and comment caps", () => {
      const candidates: PostCandidateForComments[] = [
        { postId: "p1", shortcode: "sc1", commentCount: 50, likesCount: 500, mediaType: "REEL", timestamp: new Date(Date.now() - 86400000) },
        { postId: "p2", shortcode: "sc2", commentCount: 5, likesCount: 50, mediaType: "REEL", timestamp: new Date(Date.now() - 172800000) },
        { postId: "p3", shortcode: "sc3", commentCount: 30, likesCount: 400, mediaType: "CAROUSEL", timestamp: new Date(Date.now() - 3600000) },
        { postId: "p4", shortcode: "sc4", commentCount: 20, likesCount: 200, mediaType: "IMAGE", timestamp: new Date(Date.now() - 7200000) },
        { postId: "p5", shortcode: "sc5", commentCount: 100, likesCount: 1000, mediaType: "REEL", timestamp: new Date(Date.now() - 864000000) },
      ];

      const selected = rankAndSamplePostsForComments(candidates, 3);
      expect(selected.length).toBe(3);
      const postIds = selected.map((p) => p.postId);
      // Ensure CAROUSEL or IMAGE is included due to format diversity
      const formats = selected.map((p) => p.mediaType);
      expect(new Set(formats).size).toBeGreaterThan(1);
    });

    it("handles posts with 0 comments cleanly", () => {
      const candidates: PostCandidateForComments[] = [
        { postId: "p1", shortcode: "sc1", commentCount: 0, likesCount: 10, mediaType: "IMAGE" },
        { postId: "p2", shortcode: "sc2", commentCount: null, likesCount: 0, mediaType: "REEL" },
      ];
      const selected = rankAndSamplePostsForComments(candidates, 3);
      expect(selected.length).toBe(1);
      expect(selected[0].postId).toBe("p2");
    });
  });

  describe("Evidence Verifier Own-Brand Exclusion", () => {
    it("rejects evidence quotes originating from own-brand domain", () => {
      const decision = runFinalEvidenceJudge(
        {
          sourceUrl: "https://baklawati.com.tr/about-us",
          sourceDomain: "baklawati.com.tr",
          verbatimText: "We produce the finest artisan baklava daily in Istanbul.",
          sourcePlatform: "WEB_FORUMS",
        } as any,
        { isCustomerAuthored: true, authorRole: "CUSTOMER_COMMUNITY_USER", confidence: 0.9, reasoning: "User post" },
        { isEligible: true, eligibility: "ELIGIBLE", primaryEligibility: { verdict: "PRIMARY_ELIGIBLE", semanticScope: "CATEGORY_RECURRING" } } as any,
        {
          offeringName: "Baklava Gift Box",
          category: "Confectionery",
          targetMarket: "Turkey",
          canonicalDomain: "baklawati.com.tr",
        }
      );

      expect(decision.verdict).toBe("REJECT");
      expect(decision.rejectionReason).toBe("OWN_BRAND_CONTENT");
    });
  });

  describe("Acquisition Tasks Claiming & Fencing Tokens", () => {
    const testCampaignId = `test_camp_${Date.now()}`;
    const testAccountId = `test_acc_${Date.now()}`;

    beforeEach(async () => {
      await db.delete(acquisitionTasks).where(eq(acquisitionTasks.campaignId, testCampaignId));
      await db.delete(evidenceManifests).where(eq(evidenceManifests.campaignId, testCampaignId));
    });

    it("plans and atomically claims tasks with monotonically increasing fencing tokens", async () => {
      const mockContext: any = {
        accountId: testAccountId,
        campaignId: testCampaignId,
        category: "Sweets",
        offeringName: "Baklava",
        targetMarket: "Turkey",
        targetLanguage: "tr",
        canonicalDomain: "baklawati.com.tr",
      };

      const planResult = await planAcquisitionTasks(mockContext);
      expect(planResult.tasksPlanned).toBeGreaterThan(0);

      // Claim task with worker 1
      const claim1 = await claimNextTask("worker-1", testCampaignId);
      expect(claim1).not.toBeNull();
      expect(claim1!.task.status).toBe("RUNNING");
      expect(claim1!.fencingToken).toBe(1);

      // Complete task with worker 1 using correct fencing token
      const completed = await completeTask(claim1!.task.id, claim1!.fencingToken, { items: 5 });
      expect(completed).toBe(true);

      // Attempting to complete with stale fencing token fails
      const staleComplete = await completeTask(claim1!.task.id, 999, { items: 0 });
      expect(staleComplete).toBe(false);
    });

    it("freezes and retrieves an immutable evidence manifest", async () => {
      const jobId = `test_job_${Date.now()}`;
      const fingerprint = "test_fingerprint_abc123";

      const manifest = await freezeEvidenceManifest({
        campaignId: testCampaignId,
        accountId: testAccountId,
        orchestrationJobId: jobId,
        contextFingerprint: fingerprint,
      });

      expect(manifest.id).toBeDefined();
      expect(manifest.status).toBe("FROZEN");
      expect(manifest.orchestrationJobId).toBe(jobId);
      expect(manifest.contextFingerprint).toBe(fingerprint);

      const retrieved = await getFrozenManifest(jobId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(manifest.id);
    });
  });
});
