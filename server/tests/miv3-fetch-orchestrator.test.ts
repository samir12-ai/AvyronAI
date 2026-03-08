import { describe, it, expect, beforeAll } from "vitest";
import { detectCTAIntent } from "../competitive-intelligence/data-acquisition";
import {
  validateEngineIsolation,
  validateDomainOwnership,
  rejectBlockedEngine,
  assertSnapshotReadOnly,
  assertNoComputeFromExternal,
  getProtectedDomains,
  getBlockedEngines,
} from "../market-intelligence-v3/isolation-guard";

describe("MIv3 Fetch Orchestrator — Torture Tests", () => {

  describe("A) CTA Intelligence v2 — Storytelling Detection", () => {
    it("should detect explicit CTAs", () => {
      const result = detectCTAIntent("DM us now for a free consultation! Link in bio.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
      expect(result.ctaTypeDistribution.explicit).toBeGreaterThan(0);
      expect(result.detectedPatterns.length).toBeGreaterThan(0);
    });

    it("should detect soft CTAs (suggestive phrases)", () => {
      const result = detectCTAIntent("Check out our new collection and discover what suits you best. Learn more about our journey.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
      expect(result.ctaTypeDistribution.soft).toBeGreaterThan(0);
    });

    it("should detect narrative/storytelling CTAs", () => {
      const result = detectCTAIntent("I used to struggle with my skin for years. Here's how I transformed my routine and found confidence again. My journey from acne-prone to glowing skin.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
      expect(result.ctaTypeDistribution.narrative).toBeGreaterThan(0);
      expect(result.explanation).toBeTruthy();
    });

    it("should detect trust/social proof CTAs", () => {
      const result = detectCTAIntent("Trusted by 500+ clients worldwide. See our real results and reviews. Certified professionals with a proven track record.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
      expect(result.ctaTypeDistribution.trust).toBeGreaterThan(0);
    });

    it("should give coverage > 0 for implicit-only CTAs (no explicit commands)", () => {
      const result = detectCTAIntent("Behind the scenes of how we built this from scratch. A real talk about the challenges every entrepreneur faces.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
    });

    it("should handle null/empty captions gracefully", () => {
      const nullResult = detectCTAIntent(null);
      expect(nullResult.hasCTA).toBe(false);
      expect(nullResult.ctaIntentScore).toBe(0);
      expect(nullResult.missingSignalFlags.ctaPatterns).toBe(true);

      const emptyResult = detectCTAIntent("");
      expect(emptyResult.hasCTA).toBe(false);
      expect(emptyResult.ctaIntentScore).toBe(0);
      expect(emptyResult.missingSignalFlags.ctaPatterns).toBe(true);
    });

    it("should flag short captions as missing signal", () => {
      const result = detectCTAIntent("Nice!");
      expect(result.missingSignalFlags.ctaPatterns).toBe(true);
      expect(result.confidenceDowngrade).toBe(true);
    });

    it("should not produce false positives for unrelated content", () => {
      const result = detectCTAIntent("A beautiful sunset today over the mountains. The colors were amazing.");
      expect(result.ctaTypeDistribution.explicit).toBe(0);
    });

    it("should detect Arabic CTAs", () => {
      const result = detectCTAIntent("تواصل معنا الآن! خصم 50% على كل المنتجات. الرابط في البايو");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
    });

    it("should detect mixed intent (explicit + narrative)", () => {
      const result = detectCTAIntent("I transformed my business using this method. Here's my before and after story. DM us to start your journey. Link in bio for more!");
      expect(result.ctaTypeDistribution.explicit).toBeGreaterThan(0);
      expect(result.ctaTypeDistribution.narrative).toBeGreaterThan(0);
      expect(result.ctaIntentScore).toBeGreaterThan(0.3);
    });

    it("should detect engagement question narrative CTAs", () => {
      const result = detectCTAIntent("What would you do if you had unlimited resources? Have you ever felt stuck in your career? Let me share my perspective.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaTypeDistribution.narrative).toBeGreaterThan(0);
      expect(result.detectedPatterns).toEqual(expect.arrayContaining(["EngagementQuestion"]));
    });

    it("should detect how-to/guide narrative CTAs", () => {
      const result = detectCTAIntent("Here are 5 tips for growing your business. A complete guide to social media marketing for beginners.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaTypeDistribution.narrative).toBeGreaterThan(0);
      expect(result.detectedPatterns).toEqual(expect.arrayContaining(["HowToGuide"]));
    });

    it("should detect opinion hook narrative CTAs", () => {
      const result = detectCTAIntent("Unpopular opinion: most marketing advice is completely wrong. The truth about what actually works in 2024.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaTypeDistribution.narrative).toBeGreaterThan(0);
    });

    it("should detect exclusivity trust CTAs", () => {
      const result = detectCTAIntent("This exclusive offer is for members only. We are the industry leader in premium skincare solutions.");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaTypeDistribution.trust).toBeGreaterThan(0);
      expect(result.detectedPatterns).toEqual(expect.arrayContaining(["Exclusivity"]));
    });

    it("should detect Arabic narrative patterns (lesson/secret/how-to)", () => {
      const result = detectCTAIntent("تعلمت من هذه التجربة أن النجاح يحتاج صبر. نصائح مهمة لكل مبتدئ");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaIntentScore).toBeGreaterThan(0);
      expect(result.ctaTypeDistribution.narrative).toBeGreaterThan(0);
    });

    it("should detect Arabic trust patterns (guarantee/exclusivity)", () => {
      const result = detectCTAIntent("خدماتنا حصري للأعضاء فقط مع ضمان كامل على جميع المنتجات");
      expect(result.hasCTA).toBe(true);
      expect(result.ctaTypeDistribution.trust).toBeGreaterThan(0);
    });

    it("dataset with only implicit CTAs should produce coverage > 0", () => {
      const implicitOnlyCaptions = [
        "Behind the scenes of how we built this from scratch. A real talk about challenges.",
        "What I learned after 10 years in this industry. The lesson is invaluable.",
        "Imagine a world where everyone has access to quality education. This is how we are making it happen.",
        "Our journey started 5 years ago in a small garage. My experience taught me resilience.",
        "The truth about overnight success: nobody talks about the years of hard work.",
        "How to build a sustainable business. Tips for young entrepreneurs starting out.",
        "Trusted by 200+ clients worldwide with a proven track record of success.",
        null,
        "Hi",
        "A beautiful sunset over the ocean with golden light reflecting on the water surface.",
      ];

      let ctaCount = 0;
      for (const caption of implicitOnlyCaptions) {
        const result = detectCTAIntent(caption);
        if (result.hasCTA) ctaCount++;
      }

      const coverage = ctaCount / implicitOnlyCaptions.length;
      expect(coverage).toBeGreaterThan(0);
      expect(ctaCount).toBeGreaterThanOrEqual(5);
    });

    it("should not have false 0% CTA on value-proposition content", () => {
      const valueContent = [
        "Step by step guide to transform your morning routine completely.",
        "What no one tells you about freelancing and the hidden costs involved.",
        "Case study: how we grew revenue by 300% in just six months.",
        "Honest review of the top 5 productivity tools for remote workers.",
        "This is why most startups fail in their first year of operation.",
      ];

      for (const caption of valueContent) {
        const result = detectCTAIntent(caption);
        expect(result.hasCTA).toBe(true);
        expect(result.ctaIntentScore).toBeGreaterThan(0);
      }
    });

    it("minimum text length threshold should prevent scoring very short text", () => {
      const shortTexts = ["OK", "Yes", "Hi!", "Cool", "Nice pic"];
      for (const text of shortTexts) {
        const result = detectCTAIntent(text);
        expect(result.hasCTA).toBe(false);
        expect(result.ctaIntentScore).toBe(0);
        expect(result.missingSignalFlags.ctaPatterns).toBe(true);
        expect(result.confidenceDowngrade).toBe(true);
      }
    });
  });

  describe("B) Engine Isolation — Single Ownership", () => {
    it("should allow MARKET_INTELLIGENCE_V3 caller", () => {
      expect(() => validateEngineIsolation("MARKET_INTELLIGENCE_V3")).not.toThrow();
    });

    it("should reject non-MIv3 callers", () => {
      expect(() => validateEngineIsolation("BUILD_A_PLAN_ORCHESTRATOR")).toThrow("isolation violation");
      expect(() => validateEngineIsolation("AUTOPILOT")).toThrow("isolation violation");
      expect(() => validateEngineIsolation("RANDOM_ENGINE")).toThrow("isolation violation");
    });

    it("should reject blocked engines from MIv3 context", () => {
      expect(() => rejectBlockedEngine("BUILD_A_PLAN_ORCHESTRATOR", "/api/ci/mi-v3/analyze")).toThrow("ISOLATION VIOLATION");
      expect(() => rejectBlockedEngine("AUTOPILOT", "/api/ci/mi-v3/fetch")).toThrow("ISOLATION VIOLATION");
      expect(() => rejectBlockedEngine("CREATIVE_ENGINE", "/api/ci/mi-v3/analyze")).toThrow("ISOLATION VIOLATION");
      expect(() => rejectBlockedEngine("LEAD_ENGINE", "/api/ci/mi-v3/analyze")).toThrow("ISOLATION VIOLATION");
    });

    it("should not reject MIv3 itself or unknown non-blocked engines", () => {
      expect(() => rejectBlockedEngine("MARKET_INTELLIGENCE_V3", "/api/ci/mi-v3/analyze")).not.toThrow();
      expect(() => rejectBlockedEngine("SOME_UNKNOWN_ENGINE", "/api/ci/mi-v3/analyze")).not.toThrow();
    });

    it("should reject domain ownership violations", () => {
      expect(() => validateDomainOwnership("BUILD_A_PLAN", "COMPETITOR_DATA")).toThrow("Domain ownership violation");
      expect(() => validateDomainOwnership("CREATIVE", "DOMINANCE")).toThrow("Domain ownership violation");
      expect(() => validateDomainOwnership("EXTERNAL", "CTA_ANALYSIS")).toThrow("Domain ownership violation");
    });

    it("should allow MIv3 domain ownership", () => {
      expect(() => validateDomainOwnership("MARKET_INTELLIGENCE_V3", "COMPETITOR_DATA")).not.toThrow();
      expect(() => validateDomainOwnership("MARKET_INTELLIGENCE_V3", "DOMINANCE")).not.toThrow();
    });

    it("should block snapshot writes from external callers", () => {
      expect(() => assertSnapshotReadOnly("BUILD_A_PLAN", "INSERT")).toThrow("ISOLATION VIOLATION");
      expect(() => assertSnapshotReadOnly("EXTERNAL", "UPDATE")).toThrow("ISOLATION VIOLATION");
      expect(() => assertSnapshotReadOnly("CREATIVE", "COMPUTE")).toThrow("ISOLATION VIOLATION");
      expect(() => assertSnapshotReadOnly("CREATIVE", "EXECUTE")).toThrow("ISOLATION VIOLATION");
    });

    it("should allow snapshot reads from external callers", () => {
      expect(() => assertSnapshotReadOnly("BUILD_A_PLAN", "SELECT")).not.toThrow();
      expect(() => assertSnapshotReadOnly("EXTERNAL", "READ")).not.toThrow();
    });

    it("should allow MIv3 to write snapshots", () => {
      expect(() => assertSnapshotReadOnly("MARKET_INTELLIGENCE_V3", "INSERT")).not.toThrow();
      expect(() => assertSnapshotReadOnly("MARKET_INTELLIGENCE_V3", "UPDATE")).not.toThrow();
    });

    it("should block external compute calls", () => {
      expect(() => assertNoComputeFromExternal("BUILD_A_PLAN", "computeAllSignals")).toThrow("ISOLATION VIOLATION");
      expect(() => assertNoComputeFromExternal("AUTOPILOT", "computeConfidence")).toThrow("ISOLATION VIOLATION");
    });

    it("should allow MIv3 compute calls", () => {
      expect(() => assertNoComputeFromExternal("MARKET_INTELLIGENCE_V3", "computeAllSignals")).not.toThrow();
    });

    it("should have all 8 protected domains", () => {
      const domains = getProtectedDomains();
      expect(domains).toContain("COMPETITOR_DATA");
      expect(domains).toContain("DOMINANCE");
      expect(domains).toContain("CTA_ANALYSIS");
      expect(domains).toContain("CONFIDENCE");
      expect(domains).toContain("SNAPSHOTS");
      expect(domains).toContain("SIGNAL_COMPUTE");
      expect(domains).toContain("TRAJECTORY");
      expect(domains).toContain("INTENT_CLASSIFICATION");
      expect(domains.length).toBe(8);
    });

    it("should block all 8 engines", () => {
      const blocked = getBlockedEngines();
      expect(blocked).toContain("BUILD_A_PLAN_ORCHESTRATOR");
      expect(blocked).toContain("AUTOPILOT");
      expect(blocked).toContain("CREATIVE_ENGINE");
      expect(blocked).toContain("LEAD_ENGINE");
      expect(blocked).toContain("FULFILLMENT_ENGINE");
      expect(blocked.length).toBe(8);
    });
  });

  describe("C) Fetch Orchestrator Schema & Structure", () => {
    it("should export startFetchJob and getFetchJobStatus", async () => {
      const mod = await import("../market-intelligence-v3/fetch-orchestrator");
      expect(typeof mod.startFetchJob).toBe("function");
      expect(typeof mod.getFetchJobStatus).toBe("function");
    });

    it("should define mi_fetch_jobs in schema", async () => {
      const schema = await import("@shared/schema");
      expect(schema.miFetchJobs).toBeDefined();
    });
  });

  describe("D) Retry & Safety", () => {
    it("should not allow infinite retries — MAX_RETRIES is bounded", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_RETRIES");
      const match = source.match(/MAX_RETRIES\s*=\s*(\d+)/);
      expect(match).toBeTruthy();
      const maxRetries = parseInt(match![1]);
      expect(maxRetries).toBeLessThanOrEqual(5);
      expect(maxRetries).toBeGreaterThanOrEqual(1);
    });

    it("should use intelligent backoff with error-specific delays", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("RATE_LIMIT backoff");
      expect(source).toContain("[10000, 30000, 60000]");
      expect(source).toContain("rotateSessionOnBlock");
    });

    it("should respect 72h cooldown", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("COOLDOWN");
    });

    it("should have concurrency lock (idempotency)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("activeJobs");
      expect(source).toContain("lockKey");
    });

    it("should classify block reasons explicitly", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("RATE_LIMIT");
      expect(source).toContain("PROXY_BLOCKED");
      expect(source).toContain("PRIVATE_ACCOUNT");
      expect(source).toContain("PAGINATION_STOPPED");
    });
  });

  describe("E) Hard Ceilings — Proxy & Cost Protection", () => {
    it("should have MAX_PAGES_PER_COMPETITOR hard ceiling in orchestrator", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_PAGES_PER_COMPETITOR");
      const match = source.match(/MAX_PAGES_PER_COMPETITOR\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
      expect(Number(match![1])).toBeLessThanOrEqual(12);
    });

    it("should have MAX_REQUESTS_PER_JOB hard ceiling in orchestrator", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_REQUESTS_PER_JOB");
      const match = source.match(/MAX_REQUESTS_PER_JOB\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
      expect(Number(match![1])).toBeLessThanOrEqual(120);
    });

    it("should have MAX_RUNTIME_MS hard ceiling in orchestrator", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_RUNTIME_MS");
      const match = source.match(/MAX_RUNTIME_MS\s*=\s*([\d*\s]+)/);
      expect(match).not.toBeNull();
    });

    it("should have MAX_RETRIES hard ceiling in orchestrator", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_RETRIES");
      const match = source.match(/MAX_RETRIES\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
      expect(Number(match![1])).toBeLessThanOrEqual(5);
    });

    it("should stop with explicit STOP_REASON when limits reached", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("StopReason");
      expect(source).toContain("MAX_PAGES_REACHED");
      expect(source).toContain("MAX_REQUESTS_REACHED");
      expect(source).toContain("MAX_RUNTIME_REACHED");
      expect(source).toContain("STOP_REASON:");
    });

    it("should log hard ceiling telemetry in audit", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("hardCeilings");
      expect(source).toContain("maxPagesPerCompetitor");
      expect(source).toContain("maxRequestsPerJob");
      expect(source).toContain("maxRuntimeMs");
      expect(source).toContain("maxRetries");
    });

    it("should track totalRequests counter in job execution", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("totalRequests");
      expect(source).toContain("totalRequests++");
    });
  });

  describe("F) Snapshot Persistence After Fetch", () => {
    it("should call persistSnapshotAfterFetch when analysis completes (COMPLETE or CACHED_ANALYSIS)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("persistSnapshotAfterFetch");
      expect(source).toContain("anyAnalysisRan");
      expect(source).toContain("Snapshot persisted");
    });

    it("should persist snapshot with version increment", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("newVersion");
      expect(source).toContain("previousSnapshot?.version || 0) + 1");
    });

    it("should persist signal logs and telemetry with snapshot", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("miSignalLogs");
      expect(source).toContain("miTelemetry");
      expect(source).toContain("snapshotId: snapshot.id");
    });

    it("should compute full pipeline (signals, intents, trajectory, confidence, dominance) before persistence", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("computeAllSignals(competitorInputs)");
      expect(source).toContain("classifyAllIntents(signalResults)");
      expect(source).toContain("computeTrajectory(signalResults");
      expect(source).toContain("computeConfidence(signalResults");
      expect(source).toContain("computeAllDominance(signalResults");
    });

    it("should audit log the snapshot persistence event", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MI_SNAPSHOT_PERSISTED_POST_FETCH");
    });
  });

  describe("G) DB-Persisted snapshotIdCreated (No In-Memory Dependency)", () => {
    it("should have snapshotIdCreated column in mi_fetch_jobs schema", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("shared/schema.ts", "utf-8")
      );
      expect(source).toContain("snapshotIdCreated");
      expect(source).toContain("snapshot_id_created");
    });

    it("should write snapshotIdCreated to DB at job completion", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("snapshotIdCreated");
      expect(source).toContain("snapshotIdCreated,");
      expect(source).not.toContain("pendingSnapshotIds");
    });

    it("should return snapshotIdCreated from DB in getFetchJobStatus", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("job.snapshotIdCreated");
    });

    it("should have stopReason column in mi_fetch_jobs schema", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("shared/schema.ts", "utf-8")
      );
      expect(source).toContain("stopReason: text");
      expect(source).toContain("stop_reason");
    });

    it("should write stopReason to DB at job completion", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("stopReason: finalStopReason");
    });
  });

  describe("H) DB-Level RUNNING Job Uniqueness", () => {
    it("should have partial unique index on RUNNING status in schema or migration", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("23505");
    });

    it("should handle unique constraint violation by returning existing jobId", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("Unique constraint hit");
      expect(source).toContain("insertErr.code");
    });
  });

  describe("I) Partial Coverage Downgrade on Limit-Stop", () => {
    it("should accept isPartialCoverage flag in persistSnapshotAfterFetch", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("isPartialCoverage");
      expect(source).toContain("jobStopReason");
    });

    it("should downgrade confidence when partial coverage", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("coveragePenalty");
      expect(source).toContain("PARTIAL_COVERAGE:");
    });

    it("should add PARTIAL_COVERAGE to missingSignalFlags", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('"PARTIAL_COVERAGE"');
      expect(source).toContain("Data collection stopped early");
    });

    it("should set marketState to PARTIAL_DATA when partial", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("PARTIAL_DATA");
    });

    it("should include partialCoverage flag in telemetry", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("partialCoverage: isPartialCoverage");
      expect(source).toContain("jobStopReason: isPartialCoverage");
    });
  });

  describe("J) Crash/Restart Recovery", () => {
    it("should recover RUNNING/QUEUED jobs from DB after backend restart", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("IN ('RUNNING', 'QUEUED')");
      expect(source).toContain("DEDUP: Reusing active");
    });

    it("should return stable stageStatuses from DB (not memory)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("job.stageStatuses ? JSON.parse(job.stageStatuses)");
    });

    it("should return snapshotIdCreated from DB after restart", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("job.snapshotIdCreated");
      expect(source).not.toContain("pendingSnapshotIds.get");
    });

    it("should cleanup activeJobs in-memory map in finally block", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("activeJobs.delete(lockKey)");
      expect(source).toContain(".finally(");
    });

    it("should handle DB state correctly: stages persist incrementally", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const updateCount = (source.match(/updateJobStages\(/g) || []).length;
      expect(updateCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("K) Cooldown State Model — Correct Stage Truth", () => {
    it("should mark fetch stages as SKIPPED_FETCH_COOLDOWN (not COMPLETE or COOLDOWN_BLOCKED) when cooldown active", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('stage.POSTS_FETCH = "SKIPPED_FETCH_COOLDOWN"');
      expect(source).toContain('stage.COMMENTS_FETCH = "SKIPPED_FETCH_COOLDOWN"');
      expect(source).not.toContain('stage.POSTS_FETCH = "COMPLETE";\n      stage.COMMENTS_FETCH = "COOLDOWN"');
    });

    it("should include cooldownRemainingHours in CompetitorStage metadata", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("cooldownRemainingHours");
      expect(source).toContain("remainingHours");
    });

    it("should run CTA_ANALYSIS and SIGNAL_COMPUTE on cached data when sufficient", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('stage.CTA_ANALYSIS = "CACHED_ANALYSIS"');
      expect(source).toContain('stage.SIGNAL_COMPUTE = "CACHED_ANALYSIS"');
      expect(source).toContain('analysisSource = "CACHED_DATA"');
    });

    it("should mark analysis as BLOCKED_INSUFFICIENT_DATA when not enough cached data", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('stage.CTA_ANALYSIS = "BLOCKED_INSUFFICIENT_DATA"');
      expect(source).toContain('stage.SIGNAL_COMPUTE = "BLOCKED_INSUFFICIENT_DATA"');
    });

    it("should set job status to COMPLETE_WITH_COOLDOWN when all competitors in cooldown", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('"COMPLETE_WITH_COOLDOWN"');
      expect(source).toContain("allCooldown && anyAnalysisRan");
    });

    it("should set stopReason to COOLDOWN_ACTIVE", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('"COOLDOWN_ACTIVE"');
      expect(source).toContain('stopReason = "COOLDOWN_ACTIVE"');
    });

    it("should NOT set COOLDOWN to COMPLETE artificially for any stage", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const cooldownBlock = source.substring(
        source.indexOf('fetchResult.status === "COOLDOWN"'),
        source.indexOf('continue;', source.indexOf('fetchResult.status === "COOLDOWN"'))
      );
      expect(cooldownBlock).not.toContain('POSTS_FETCH = "COMPLETE"');
      expect(cooldownBlock).not.toContain('COMMENTS_FETCH = "COMPLETE"');
      expect(cooldownBlock).not.toContain('CTA_ANALYSIS = "COMPLETE"');
      expect(cooldownBlock).not.toContain('SIGNAL_COMPUTE = "COMPLETE"');
    });

    it("should persist snapshot when analysis ran on cached data during cooldown", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('s.SIGNAL_COMPUTE === "CACHED_ANALYSIS"');
      expect(source).toContain("anyAnalysisRan");
    });

    it("should track cooldownCount and use it for job status determination", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("cooldownCount++");
      expect(source).toContain("cooldownCount === competitors.length");
    });

    it("should NOT trigger partial coverage downgrade for COOLDOWN_ACTIVE", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('stopReason !== "COOLDOWN_ACTIVE"');
    });

    it("should include analysisSource in CompetitorStage type", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('analysisSource?: "CACHED_DATA" | "FRESH_DATA"');
    });
  });

  describe("L) Sequential Per-Competitor Fetch — No Batch Fetch", () => {
    it("should NOT contain Auto-Fetch All Data button in frontend", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).not.toContain("Auto-Fetch All Data");
      expect(source).not.toContain("autoFetchAllBtn");
      expect(source).not.toContain("startFetchJobMutation");
    });

    it("should NOT contain fetchingAll or fetchJobId state in frontend", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).not.toContain("fetchingAll");
      expect(source).not.toContain("fetchJobId");
      expect(source).not.toContain("fetchJobStatus");
    });

    it("should have campaign-level fetch button (not per-competitor)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("fetchDataMutation.mutate()");
      expect(source).toContain("isFetchingCampaign");
      expect(source).not.toContain("fetchingCompetitorId");
    });

    it("should enforce sequential fetching — disable all fetch buttons when campaign fetch in progress", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("anyFetchInProgress");
      expect(source).toContain("isFetchingCampaign");
      expect(source).toContain("disabled={anyFetchInProgress");
    });

    it("should show 'Collecting...' on all competitor cards during campaign fetch", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("Collecting...");
    });

    it("should handle queue-based job status in fetch response (RUNNING/QUEUED)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("RUNNING");
      expect(source).toContain("QUEUED");
      expect(source).toContain("Collection Queued");
    });

    it("should handle already-in-progress dedup in fetch response", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("already in progress");
      expect(source).toContain("Already Running");
    });

    it("should include remainingCooldownSeconds and existingCoverage in stage metadata", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("remainingCooldownSeconds");
      expect(source).toContain("lastFetchTimestamp");
      expect(source).toContain("existingCoverage");
    });

    it("should track fetchExecuted per competitor stage (false for cooldown, true for fresh)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("stage.fetchExecuted = false");
      expect(source).toContain("stage.fetchExecuted = true");
    });

    it("should NEVER set POSTS_FETCH or COMMENTS_FETCH to COMPLETE during cooldown", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const cooldownBlock = source.substring(
        source.indexOf('fetchResult.status === "COOLDOWN"'),
        source.indexOf("continue;", source.indexOf('fetchResult.status === "COOLDOWN"'))
      );
      expect(cooldownBlock).not.toContain('POSTS_FETCH = "COMPLETE"');
      expect(cooldownBlock).not.toContain('COMMENTS_FETCH = "COMPLETE"');
    });

    it("should never allow COOLDOWN_BLOCKED as a valid StageStatus (replaced by SKIPPED_FETCH_COOLDOWN)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).not.toContain('"COOLDOWN_BLOCKED"');
    });

    it("should enforce MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT = 1 (strict sequential)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT = 1");
    });

    it("batch fetch route /api/ci/mi-v3/fetch should be deprecated (410)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/routes.ts", "utf-8")
      );
      const fetchRoute = source.substring(
        source.indexOf('"/api/ci/mi-v3/fetch"'),
        source.indexOf("});", source.indexOf('"/api/ci/mi-v3/fetch"')) + 3
      );
      expect(fetchRoute).toContain("410");
      expect(fetchRoute).toContain("DEPRECATED");
    });

    it("batch fetch-all route /api/ci/competitors/fetch-all should be deprecated (410)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition-routes.ts", "utf-8")
      );
      const marker = "/api/ci/competitors/fetch-all";
      const idx = source.indexOf(marker);
      expect(idx).toBeGreaterThan(-1);
      const fetchAllRoute = source.substring(idx, source.indexOf("});", idx) + 3);
      expect(fetchAllRoute).toContain("410");
      expect(fetchAllRoute).toContain("DEPRECATED");
    });

    it("per-competitor fetch route should be deprecated (410) — all collection via queue", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition-routes.ts", "utf-8")
      );
      expect(source).toContain('"/api/ci/competitors/:id/fetch-data"');
      expect(source).toContain("410");
      expect(source).toContain("DEPRECATED");
      expect(source).not.toContain("fetchCompetitorData");
    });
  });

  describe("K2) Snapshot Source Transparency", () => {
    it("should include snapshotSource and fetchExecuted in mi_snapshots schema", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("shared/schema.ts", "utf-8")
      );
      expect(source).toContain('snapshotSource: text("snapshot_source")');
      expect(source).toContain('fetchExecuted: boolean("fetch_executed")');
    });

    it("should set snapshotSource and fetchExecuted in fetch-orchestrator snapshot payload", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("snapshotSource");
      expect(source).toContain("fetchExecuted");
      expect(source).toContain('? "FRESH_DATA" : "CACHED_DATA"');
    });

    it("should set snapshotSource and fetchExecuted in engine.ts snapshot payload", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      expect(source).toContain('snapshotSource: "FRESH_DATA"');
      expect(source).toContain("fetchExecuted: true");
    });

    it("should include snapshotSource and fetchExecuted in MIv3DiagnosticResult type", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/types.ts", "utf-8")
      );
      expect(source).toContain('snapshotSource: "FRESH_DATA" | "CACHED_DATA"');
      expect(source).toContain("fetchExecuted: boolean");
    });

    it("should display snapshotSource and fetchExecuted in UI", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("snapshotSource");
      expect(source).toContain("fetchExecuted");
    });

    it("should include snapshotSource and fetchExecuted in telemetry JSON", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const telemetrySection = source.substring(
        source.indexOf("telemetry: JSON.stringify({"),
        source.indexOf("}),", source.indexOf("telemetry: JSON.stringify({")) + 5
      );
      expect(telemetrySection).toContain("snapshotSource");
      expect(telemetrySection).toContain("fetchExecuted");
    });

    it("should show data coverage section in per-competitor card", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("DATA COVERAGE");
      expect(source).toContain("dataCoverage");
    });
  });

  describe("M-1) Data Integrity — Cache-First Insert & Verified Counts", () => {
    it("should insert only new posts in transaction (cache-first, no delete-all)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("db.transaction");
      expect(source).toContain("tx.insert(ciCompetitorPosts)");
      expect(source).toContain("tx.insert(ciCompetitorComments)");
      expect(source).toContain("existingPostIds");
      expect(source).toContain("cachedPostsReused");
    });

    it("should verify persisted counts after insertion", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("DATA_MISMATCH_ERROR");
      expect(source).toContain("persistedPostCount");
      expect(source).toContain("persistedCommentCount");
      const verifyIdx = source.indexOf("persistedPostCount");
      const transactionIdx = source.indexOf("await db.transaction(");
      expect(verifyIdx).toBeGreaterThan(transactionIdx);
    });

    it("should write verified counts to metrics snapshot (not raw insert count)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const txBlock = source.slice(source.indexOf("await db.transaction("));
      const mainSnapshotIdx = txBlock.indexOf("db.insert(ciCompetitorMetricsSnapshot)");
      expect(mainSnapshotIdx).toBeGreaterThan(0);
      const snapshotBlock = txBlock.slice(mainSnapshotIdx, mainSnapshotIdx + 300);
      expect(snapshotBlock).toContain("persistedPostCount");
      expect(snapshotBlock).toContain("persistedCommentCount");
      expect(snapshotBlock).not.toContain("postsToStore.length");
    });

    it("should have data degradation guard to prevent replacing better data", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("DATA_DEGRADATION_GUARD");
      expect(source).toContain("scrapeResult.posts.length < existingPosts");
      expect(source).toContain("Keeping existing data");
    });

    it("should return verified counts from fetchCompetitorData", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("persistedPostCount");
      expect(source).toContain("persistedCommentCount");
      expect(source).toContain("cachedPostsReused");
    });

    it("should use live DB counts in cooldown path and bypass if coverage insufficient", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("COOLDOWN_BYPASS");
      expect(source).toContain("coverageMet");
      expect(source).toContain("MIN_POSTS_THRESHOLD");
      expect(source).toContain("MIN_COMMENTS_THRESHOLD");

      const cooldownSection = source.slice(
        source.indexOf("COOLDOWN_BYPASS"),
        source.indexOf("COOLDOWN_BYPASS") + 400
      );
      expect(cooldownSection).toContain("Allowing re-fetch");
    });

    it("getCompetitorDataCoverage should use live count(*) not metrics snapshot", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const coverageFn = source.slice(
        source.indexOf("export async function getCompetitorDataCoverage"),
        source.indexOf("export async function getCompetitorDataCoverage") + 1000
      );
      expect(coverageFn).toContain("count(*)");
      expect(coverageFn).toContain("ciCompetitorPosts");
      expect(coverageFn).toContain("ciCompetitorComments");
    });
  });

  describe("N) Coverage-Aware Cooldown & State Machine Honesty", () => {
    it("cooldown must NOT block when posts < 14 or comments < 50", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("COOLDOWN_BYPASS");
      const bypassSection = source.slice(source.indexOf("COOLDOWN_BYPASS"), source.indexOf("COOLDOWN_BYPASS") + 500);
      expect(bypassSection).toContain("Coverage insufficient");
      expect(bypassSection).toContain("Allowing re-fetch");

      expect(source).toContain("coverageMet");
      const coverageCheck = source.slice(source.indexOf("coverageMet"), source.indexOf("coverageMet") + 200);
      expect(coverageCheck).toContain("MIN_POSTS_THRESHOLD");
      expect(coverageCheck).toContain("MIN_COMMENTS_THRESHOLD");
    });

    it("cooldown thresholds are sourced from central MI_THRESHOLDS (14 posts, 50 comments)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR");
      expect(source).toContain("MI_THRESHOLDS.MIN_COMMENTS_SAMPLE");
      expect(source).not.toMatch(/const MIN_POSTS_THRESHOLD\s*=\s*\d+/);
      expect(source).not.toMatch(/const MIN_COMMENTS_THRESHOLD\s*=\s*\d+/);

      const constants = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/constants.ts", "utf-8")
      );
      expect(constants).toContain("MIN_POSTS_PER_COMPETITOR: 14");
      expect(constants).toContain("MIN_COMMENTS_SAMPLE: 50");
    });

    it("job status must be PARTIAL_COMPLETE when coverage below thresholds (not COMPLETE)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("PARTIAL_COMPLETE");
      expect(source).toContain("anyInsufficientData");
      const idx = source.indexOf("anyInsufficientData");
      const statusBlock = source.slice(idx, idx + 600);
      expect(statusBlock).toContain("PARTIAL_COMPLETE");
    });

    it("fetch result status must be INSUFFICIENT_DATA when below thresholds", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain('"INSUFFICIENT_DATA"');
      expect(source).toContain("coverageSufficient");
      expect(source).toContain("Below thresholds");
    });

    it("UI must use queue-based fetch-job route (not direct per-competitor fetch)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("/api/ci/mi-v3/fetch-job");
      expect(source).not.toContain("/api/ci/competitors/${id}/fetch-data");
      expect(source).toContain("Two-Speed");
    });
  });

  describe("O) Pagination & Cap Detection", () => {
    it("scraper must attempt v1 feed pagination beyond 12-post ceiling", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("TARGET_POSTS");
      expect(source).toContain("MAX_PAGINATION_PAGES");
      expect(source).toContain("INSTAGRAM_PUBLIC_API_CEILING");
      expect(source).toContain("has_next_page");
      expect(source).toContain("feed/user/");
      expect(source).toContain("PaginationDiagnostics");
      expect(source).toContain("V1_FEED_API");

      const targetMatch = source.match(/const TARGET_POSTS\s*=\s*(\d+)/);
      expect(targetMatch).not.toBeNull();
      expect(parseInt(targetMatch![1])).toBeGreaterThanOrEqual(14);

      const ceilingMatch = source.match(/const INSTAGRAM_PUBLIC_API_CEILING\s*=\s*(\d+)/);
      expect(ceilingMatch).not.toBeNull();
      expect(parseInt(ceilingMatch![1])).toBe(12);
    });

    it("scraper must have explicit stop reason classification (no SINGLE_PAGE)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).not.toContain('"SINGLE_PAGE"');
      expect(source).toContain("PaginationStopReason");
      expect(source).toContain("INSTAGRAM_API_CEILING");
      expect(source).toContain("FEED_PAGINATION_AUTH_REQUIRED");
      expect(source).toContain("FEED_PAGINATION_BLOCKED");
      expect(source).toContain("ACCOUNT_PRIVATE");
      expect(source).toContain("PROXY_BLOCKED");
      expect(source).toContain("RATE_LIMITED");
      expect(source).toContain("NO_USER_ID");
      expect(source).toContain("UNKNOWN_FAILURE");
    });

    it("scraper must log full pagination diagnostics", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("PAGE_1 AUDIT");
      expect(source).toContain("page1PostCount");
      expect(source).toContain("page1HasNextPage");
      expect(source).toContain("page1EndCursorPresent");
      expect(source).toContain("page1HttpStatus");
      expect(source).toContain("totalMediaCount");
      expect(source).toContain("paginationAttempted");
      expect(source).toContain("paginationMethod");
      expect(source).toContain("paginationHttpStatus");
      expect(source).toContain("paginationErrorDetail");
      expect(source).toContain("FINAL_AUDIT");
    });

    it("scraper must use pool-managed sticky sessions for pagination continuity", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("proxyCtx?.session.dispatcher");
      expect(source).toContain("proxyCtx?.session.sessionId");
      expect(source).not.toContain("getSessionDispatcher");
      expect(source).not.toContain("getProxyDispatcher");
    });

    it("scraper must deduplicate posts via seenIds", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("seenIds");
      expect(source).toContain("seenIds.has");
      expect(source).toContain("seenIds.add");
    });

    it("scraper must parse v1 feed API format (parsePostFromV1Feed)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("parsePostFromV1Feed");
      expect(source).toContain("item.code");
      expect(source).toContain("item.caption?.text");
      expect(source).toContain("item.like_count");
      expect(source).toContain("item.comment_count");
    });

    it("fetch result must include rawFetchedCount and paginationStopReason", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("rawFetchedCount");
      expect(source).toContain("paginationPages");
      expect(source).toContain("paginationStopReason");
    });

    it("comment generator must produce enough to approach 50 threshold", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const maxCommentPostsMatch = source.match(/const MAX_COMMENT_POSTS\s*=\s*(\d+)/);
      const maxCommentsPerPostMatch = source.match(/const MAX_COMMENTS_PER_POST\s*=\s*(\d+)/);
      expect(maxCommentPostsMatch).not.toBeNull();
      expect(maxCommentsPerPostMatch).not.toBeNull();
      const maxPossible = parseInt(maxCommentPostsMatch![1]) * parseInt(maxCommentsPerPostMatch![1]);
      expect(maxPossible).toBeGreaterThanOrEqual(50);
    });

    it("post threshold must be 14 (not 12) — sourced from central MI_THRESHOLDS", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("INSTAGRAM_PUBLIC_API_POST_CEILING = 12");
      expect(source).toContain("MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR");
      expect(source).not.toContain("MIN_POSTS_THRESHOLD = INSTAGRAM_PUBLIC_API_POST_CEILING");
      expect(source).not.toContain("MIN_POSTS_THRESHOLD = 12");
    });

    it("fetch orchestrator must use 14 as post target (not 12)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("INSTAGRAM_PUBLIC_API_POST_CEILING = 12");
      const targetMatch = source.match(/const MIN_POSTS_TARGET\s*=\s*(\d+)/);
      expect(targetMatch).not.toBeNull();
      expect(parseInt(targetMatch![1])).toBe(14);
      expect(source).not.toContain("MIN_POSTS_TARGET = INSTAGRAM_PUBLIC_API_POST_CEILING");
    });

    it("REGRESSION GUARD: 12 posts with totalMediaCount > 12 must be INSUFFICIENT_DATA", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("INSUFFICIENT_DATA");
      expect(source).toContain("coverageSufficient");
      expect(source).toContain("MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR");
      expect(source).toContain("persistedPostCount >= postsTarget");
      expect(source).toContain("persistedCommentCount >= commentsTarget");
    });

    it("REGRESSION GUARD: paginationAttempted must be true when has_next_page is true", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("paginationAttempted");
      const attemptBlock = source.slice(source.indexOf("paginationAttempted = true"), source.indexOf("paginationAttempted = true") + 200);
      expect(attemptBlock).toBeTruthy();
      expect(source).toContain("has_next_page=true. Attempting v1 feed pagination");
      expect(source).toContain("diag.paginationAttempted = true");
    });

    it("REGRESSION GUARD: no path silently accepts 12 posts as sufficient", async () => {
      const daSource = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const foSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(daSource).not.toContain("MIN_POSTS_THRESHOLD = 12");
      expect(daSource).not.toContain("MIN_POSTS_THRESHOLD = INSTAGRAM_PUBLIC_API_POST_CEILING");
      expect(foSource).not.toContain("MIN_POSTS_TARGET = 12");
      expect(foSource).not.toContain("MIN_POSTS_TARGET = INSTAGRAM_PUBLIC_API_POST_CEILING");
      expect(daSource).toContain("MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR");
      const foTarget = foSource.match(/const MIN_POSTS_TARGET\s*=\s*(\d+)/);
      expect(parseInt(foTarget![1])).toBeGreaterThanOrEqual(14);
    });

    it("data atomicity: cache-first insert wrapped in transaction", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("db.transaction");
      expect(source).toContain("tx.insert(ciCompetitorPosts)");
      expect(source).toContain("tx.insert(ciCompetitorComments)");
      expect(source).toContain("existingPostIds");
    });
  });

  describe("P) Single Source-of-Truth", () => {
    it("competitor card coverage must use live count(*) from DB", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const coverageFn = source.slice(
        source.indexOf("export async function getCompetitorDataCoverage"),
        source.indexOf("export async function getCompetitorDataCoverage") + 1000
      );
      expect(coverageFn).toContain("count(*)");
      expect(coverageFn).toContain("ciCompetitorPosts");
      expect(coverageFn).toContain("ciCompetitorComments");
    });

    it("coverage display must show values color-coded orange when below thresholds", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("#F97316");
      const postLine = source.slice(source.indexOf("Posts collected"), source.indexOf("Posts collected") + 200);
      expect(postLine).toContain("14");
      expect(postLine).toContain("#10B981");
      expect(postLine).toContain("#F97316");
    });
  });

  describe("M) Build-a-Plan Reads Only (No Compute)", () => {
    it("should not import compute functions in orchestrator-routes", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/strategic-core/orchestrator-routes.ts", "utf-8")
      );
      expect(source).not.toContain("computeAllSignals");
      expect(source).not.toContain("computeConfidence");
      expect(source).not.toContain("computeAllDominance");
      expect(source).not.toContain("computeTrajectory");
    });

    it("should not call MIv3 engine.run from Build-a-Plan", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/strategic-core/orchestrator-routes.ts", "utf-8")
      );
      expect(source).not.toContain("MarketIntelligenceV3.run");
    });
  });

  describe("Q) Snapshot Completion Contract — No Fake COMPLETE", () => {
    it("validateSnapshotCompleteness must exist and be exported from engine.ts", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      expect(source).toContain("export function validateSnapshotCompleteness");
    });

    it("persistValidatedSnapshot must exist as single gateway with validation", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      expect(source).toContain("export async function persistValidatedSnapshot");
      const gatewayFunc = source.slice(
        source.indexOf("export async function persistValidatedSnapshot"),
        source.indexOf("export async function persistValidatedSnapshot") + 600
      );
      expect(gatewayFunc).toContain("validateSnapshotCompleteness");
      expect(gatewayFunc).toContain("SNAPSHOT_COMPLETION_CONTRACT_VIOLATED");
      expect(gatewayFunc).toContain('"PARTIAL"');
      expect(gatewayFunc).toContain("db.insert(miSnapshots)");
      expect(gatewayFunc).toContain("analysisVersion");
      expect(gatewayFunc).toContain("ENGINE_VERSION");
    });

    it("engine._executeRun must use persistValidatedSnapshot (not direct insert)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const executeRunBlock = source.slice(
        source.indexOf("async _executeRun"),
        source.indexOf("async _executeRun") + 15000
      );
      expect(executeRunBlock).toContain("persistValidatedSnapshot(snapshotPayload");
      expect(executeRunBlock).not.toContain("db.insert(miSnapshots)");
    });

    it("fetch-orchestrator must use persistValidatedSnapshot (not direct insert)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("persistValidatedSnapshot(snapshotPayload");
      expect(source).not.toContain("db.insert(miSnapshots)");
    });

    it("validateSnapshotCompleteness rejects null/missing analytical fields", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const incomplete = {
        signalData: null,
        intentData: null,
        trajectoryData: null,
        dominanceData: null,
        confidenceData: null,
        marketState: null,
        volatilityIndex: null,
        marketDiagnosis: null,
        threatSignals: null,
        narrativeSynthesis: null,
        confidenceLevel: null,
      };
      const result = validateSnapshotCompleteness(incomplete);
      expect(result.valid).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(6);
      expect(result.failures.some((f: string) => f.includes("marketState"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("trajectoryData"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("confidenceData"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("signalData"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("intentData"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("threatSignals"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("volatilityIndex"))).toBe(true);
    });

    it("validateSnapshotCompleteness accepts valid PROCEED snapshot", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const valid = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.6, level: "MODERATE", guardDecision: "PROCEED" }),
        marketState: "HEATING",
        volatilityIndex: 0.33,
        marketDiagnosis: "Test market diagnosis",
        threatSignals: JSON.stringify(["risk1"]),
        opportunitySignals: JSON.stringify([]),
        narrativeSynthesis: "Test narrative",
        confidenceLevel: "MODERATE",
      };
      const result = validateSnapshotCompleteness(valid);
      expect(result.valid).toBe(true);
      expect(result.failures.length).toBe(0);
    });

    it("STATIC SCAN: no direct db.insert(miSnapshots) or tx.insert(miSnapshots) outside persistValidatedSnapshot", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const engineSource = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      const fetchSource = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      const routesSource = fs.readFileSync("server/market-intelligence-v3/routes.ts", "utf-8");

      const engineDbInsertCount = (engineSource.match(/db\.insert\(miSnapshots\)/g) || []).length;
      expect(engineDbInsertCount).toBe(1);

      const engineTxInsertCount = (engineSource.match(/tx\.insert\(miSnapshots\)/g) || []).length;
      expect(engineTxInsertCount).toBe(0);

      const gatewayIdx = engineSource.indexOf("export async function persistValidatedSnapshot");
      const insertIdx = engineSource.indexOf("db.insert(miSnapshots)");
      expect(insertIdx).toBeGreaterThan(gatewayIdx);
      const gatewayEnd = engineSource.indexOf("\nasync function getCompetitorData") !== -1
        ? engineSource.indexOf("\nasync function getCompetitorData")
        : engineSource.indexOf("\ninterface CacheResult");
      expect(insertIdx).toBeLessThan(gatewayEnd);

      expect(fetchSource).not.toContain("db.insert(miSnapshots)");
      expect(fetchSource).not.toContain("tx.insert(miSnapshots)");
      expect(fetchSource).toContain("persistValidatedSnapshot");

      expect(routesSource).not.toContain("db.insert(miSnapshots)");
      expect(routesSource).not.toContain("tx.insert(miSnapshots)");

      const serverDir = "server";
      const allTsFiles = fs.readdirSync(serverDir, { recursive: true })
        .filter((f: any) => typeof f === 'string' && f.endsWith('.ts') && !f.includes('node_modules') && !f.includes('test'));

      for (const file of allTsFiles) {
        const filePath = path.join(serverDir, file as string);
        if (filePath.includes("engine.ts") && filePath.includes("market-intelligence-v3")) continue;
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const hasDbInsert = content.includes("db.insert(miSnapshots)");
          const hasTxInsert = content.includes("tx.insert(miSnapshots)");
          if (hasDbInsert || hasTxInsert) {
            throw new Error(`ROGUE mi_snapshots INSERT found in ${filePath}`);
          }
        } catch (e: any) {
          if (e.message.includes("ROGUE")) throw e;
        }
      }
    });
  });

  describe("R) Version-Aware Cache Invalidation (ENGINE_VERSION)", () => {
    it("ENGINE_VERSION must exist in constants.ts", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/constants.ts", "utf-8")
      );
      expect(source).toContain("export const ENGINE_VERSION =");
      const match = source.match(/export const ENGINE_VERSION = (\d+)/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBeGreaterThanOrEqual(8);
    });

    it("analysisVersion must be stored in snapshot schema", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("shared/schema.ts", "utf-8")
      );
      expect(source).toContain("analysisVersion");
      expect(source).toContain("analysis_version");
    });

    it("getCachedSnapshot must reject snapshots with wrong analysisVersion", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const startIdx = source.indexOf("async function getCachedSnapshot");
      const endIdx = source.indexOf("\nfunction computeDataFreshnessDays");
      const cacheBlock = source.slice(startIdx, endIdx);
      expect(cacheBlock).toContain("ENGINE_VERSION");
      expect(cacheBlock).toContain("analysisVersion");
      expect(cacheBlock).toContain("SNAPSHOT_VERSION_INVALIDATED");
      expect(cacheBlock).toContain("snapshot: null");
    });

    it("both engine and fetch-orchestrator must write analysisVersion to snapshots", async () => {
      const engineSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const fetchSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(engineSource).toContain("analysisVersion: ENGINE_VERSION");
      expect(fetchSource).toContain("analysisVersion: ENGINE_VERSION");
    });

    it("REGRESSION: old snapshot (version 0) must be rejected by cache", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1200);
      expect(cacheFunc).toContain("snapshot.analysisVersion || 0");
      expect(cacheFunc).toContain("snapshotVersion !== ENGINE_VERSION");
      const { ENGINE_VERSION } = await import("../market-intelligence-v3/constants");
      expect(ENGINE_VERSION).toBeGreaterThan(0);
    });
  });

  describe("S) Anti-Stale Guard — Forced Recompute on Incomplete Snapshot", () => {
    it("getCachedSnapshot must call isSnapshotAnalyticallyComplete", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const startIdx = source.indexOf("async function getCachedSnapshot");
      const endIdx = source.indexOf("\nfunction computeDataFreshnessDays");
      const cacheBlock = source.slice(startIdx, endIdx);
      expect(cacheBlock).toContain("isSnapshotAnalyticallyComplete(snapshot)");
      expect(cacheBlock).toContain("snapshot: null");
    });

    it("isSnapshotAnalyticallyComplete must log CACHE_INVALID_INCOMPLETE_SNAPSHOT on failure", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      expect(source).toContain("CACHE_INVALID_INCOMPLETE_SNAPSHOT");
      const guardFunc = source.slice(source.indexOf("function isSnapshotAnalyticallyComplete"), source.indexOf("function isSnapshotAnalyticallyComplete") + 400);
      expect(guardFunc).toContain("validateSnapshotCompleteness");
      expect(guardFunc).toContain("CACHE_INVALID_INCOMPLETE_SNAPSHOT");
      expect(guardFunc).toContain("return false");
    });

    it("REGRESSION: incomplete COMPLETE snapshot must trigger recompute (not be served from cache)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const startIdx = source.indexOf("async function getCachedSnapshot");
      const endIdx = source.indexOf("\nfunction computeDataFreshnessDays");
      const cacheFunc = source.slice(startIdx, endIdx);
      const versionCheck = cacheFunc.indexOf("snapshotVersion !== ENGINE_VERSION");
      const completenessCheck = cacheFunc.indexOf("isSnapshotAnalyticallyComplete");
      const freshnessCheck = cacheFunc.indexOf("age > freshnessMs");
      expect(versionCheck).toBeGreaterThan(-1);
      expect(completenessCheck).toBeGreaterThan(-1);
      expect(freshnessCheck).toBeGreaterThan(-1);
      expect(versionCheck).toBeLessThan(completenessCheck);
      expect(completenessCheck).toBeLessThan(freshnessCheck);
    });

    it("REGRESSION: validateSnapshotCompleteness catches zeroed volatilityIndex correctly", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const withNullVolatility = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.6, level: "MODERATE" }),
        marketState: "HEATING",
        volatilityIndex: null,
        marketDiagnosis: null,
        threatSignals: JSON.stringify([]),
        narrativeSynthesis: null,
        confidenceLevel: "MODERATE",
      };
      const result = validateSnapshotCompleteness(withNullVolatility);
      expect(result.valid).toBe(false);
      expect(result.failures.some((f: string) => f.includes("volatilityIndex"))).toBe(true);

      const withZeroVolatility = { ...withNullVolatility, volatilityIndex: 0 };
      const result2 = validateSnapshotCompleteness(withZeroVolatility);
      expect(result2.failures.some((f: string) => f.includes("volatilityIndex"))).toBe(false);
    });

    it("REGRESSION: guardDecision=PROCEED + null marketDiagnosis must fail validation", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const proceedWithNull = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.85, level: "STRONG", guardDecision: "PROCEED" }),
        marketState: "HEATING",
        volatilityIndex: 0.3,
        marketDiagnosis: null,
        threatSignals: JSON.stringify(["risk1"]),
        narrativeSynthesis: null,
        confidenceLevel: "STRONG",
      };
      const result = validateSnapshotCompleteness(proceedWithNull);
      expect(result.valid).toBe(false);
      expect(result.failures.some((f: string) => f.includes("marketDiagnosis") && f.includes("guardDecision=PROCEED"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("narrativeSynthesis") && f.includes("guardDecision=PROCEED"))).toBe(true);
    });

    it("REGRESSION: guardDecision=DOWNGRADE + null marketDiagnosis must pass validation", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const downgradeWithNull = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.4, level: "LOW", guardDecision: "DOWNGRADE" }),
        marketState: "COOLING",
        volatilityIndex: 0.2,
        marketDiagnosis: null,
        threatSignals: JSON.stringify(["INSUFFICIENT DATA"]),
        opportunitySignals: JSON.stringify([]),
        narrativeSynthesis: null,
        confidenceLevel: "LOW",
      };
      const result = validateSnapshotCompleteness(downgradeWithNull);
      expect(result.valid).toBe(true);
    });

    it("REGRESSION: guardDecision=BLOCK + null marketDiagnosis must pass validation", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const blockWithNull = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.2, level: "LOW", guardDecision: "BLOCK" }),
        marketState: "INSUFFICIENT_DATA",
        volatilityIndex: 0.1,
        marketDiagnosis: null,
        threatSignals: JSON.stringify(["BLOCKED"]),
        opportunitySignals: JSON.stringify([]),
        narrativeSynthesis: null,
        confidenceLevel: "LOW",
      };
      const result = validateSnapshotCompleteness(blockWithNull);
      expect(result.valid).toBe(true);
    });

    it("REGRESSION: validation uses guardDecision (not numeric threshold) for marketDiagnosis/narrativeSynthesis", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const startIdx = source.indexOf("export function validateSnapshotCompleteness");
      const endMarker = source.indexOf("function isSnapshotAnalyticallyComplete");
      const validationFunc = source.slice(startIdx, endMarker);
      expect(validationFunc).toContain('guardDecision === "PROCEED"');
      expect(validationFunc).not.toContain("MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD");
    });

    it("cache rejection order: hash → version → completeness → freshness", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("\nfunction computeDataFreshnessDays"));
      const hashCheck = cacheFunc.indexOf("competitorHash");
      const versionCheck = cacheFunc.indexOf("ENGINE_VERSION");
      const completenessCheck = cacheFunc.indexOf("isSnapshotAnalyticallyComplete");
      const freshnessCheck = cacheFunc.indexOf("freshnessMs");
      expect(hashCheck).toBeGreaterThan(-1);
      expect(versionCheck).toBeGreaterThan(-1);
      expect(completenessCheck).toBeGreaterThan(-1);
      expect(freshnessCheck).toBeGreaterThan(-1);
      expect(hashCheck).toBeLessThan(versionCheck);
      expect(versionCheck).toBeLessThan(completenessCheck);
      expect(completenessCheck).toBeLessThan(freshnessCheck);
    });

    it("SNAPSHOT_VERSION_INVALIDATED log must exist in getCachedSnapshot", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("\nfunction computeDataFreshnessDays"));
      expect(cacheFunc).toContain("SNAPSHOT_VERSION_INVALIDATED");
      expect(cacheFunc).toContain("reason=engine_upgrade");
    });

    it("ENGINE_VERSION bump policy comment must exist in constants.ts", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/constants.ts", "utf-8")
      );
      expect(source).toContain("ENGINE_VERSION — Bump Policy");
      expect(source).toContain("INCREMENT when:");
      expect(source).toContain("DO NOT increment for:");
      expect(source).toContain("Output schema changes");
      expect(source).toContain("Logging changes");
    });

    it("API must return cacheInvalidationReason and snapshotStatus fields", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/types.ts", "utf-8")
      );
      expect(source).toContain("cacheInvalidationReason");
      expect(source).toContain("snapshotStatus");
      expect(source).toContain("ENGINE_UPGRADE");
      expect(source).toContain("COMPETITOR_SET_CHANGED");
      expect(source).toContain("INCOMPLETE_SNAPSHOT");
      expect(source).toContain("STALE");

      const engineSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      expect(engineSource).toContain("snapshotStatus:");
      expect(engineSource).toContain("cacheInvalidationReason");

      const buildResultStart = engineSource.indexOf("export function buildResultFromSnapshot");
      const buildResultEnd = engineSource.indexOf("export function buildMarketSummary");
      const buildResult = engineSource.slice(buildResultStart, buildResultEnd);
      expect(buildResult).toContain("snapshotStatus:");
      expect(buildResult).toContain("cacheInvalidationReason:");
    });

    it("getCachedSnapshot returns structured invalidation reasons (not just null)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 2000);
      expect(cacheFunc).toContain('invalidationReason: "ENGINE_UPGRADE"');
      expect(cacheFunc).toContain('invalidationReason: "COMPETITOR_SET_CHANGED"');
      expect(cacheFunc).toContain('invalidationReason: "INCOMPLETE_SNAPSHOT"');
      expect(cacheFunc).toContain('invalidationReason: "STALE"');
      expect(cacheFunc).toContain('invalidationReason: null');
    });

    it("cache NEVER serves PARTIAL snapshots (filter by COMPLETE only)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 800);
      expect(cacheFunc).toContain('eq(miSnapshots.status, "COMPLETE")');
      expect(cacheFunc).not.toContain('eq(miSnapshots.status, "PARTIAL")');

      const routesSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/routes.ts", "utf-8")
      );
      const snapshotRoute = routesSource.slice(routesSource.indexOf("snapshot/:campaignId"), routesSource.indexOf("snapshot/:campaignId") + 500);
      expect(snapshotRoute).toContain('eq(miSnapshots.status, "COMPLETE")');
    });

    it("UI visually distinguishes PARTIAL from COMPLETE", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("snapshotStatus === 'PARTIAL'");
      expect(source).toContain("PARTIAL");
      expect(source).toContain("should not be interpreted as final strategy");
    });

    it("UI displays engine upgrade message (not log-only)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("cacheInvalidationReason === 'ENGINE_UPGRADE'");
      expect(source).toContain("Analysis refreshed due to engine upgrade");
    });

    it("REGRESSION: same ENGINE_VERSION does not invalidate snapshot", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1200);
      expect(cacheFunc).toContain("snapshotVersion !== ENGINE_VERSION");
      expect(cacheFunc).not.toContain("snapshotVersion < ENGINE_VERSION");
    });
  });

  describe("S) Scalability Protection — Global Job Queue", () => {
    it("GLOBAL_MAX_CONCURRENT_JOBS constant exists and is 2-4", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const match = source.match(/GLOBAL_MAX_CONCURRENT_JOBS\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1]);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(4);
    });

    it("PER_ACCOUNT_JOB_BUDGET_PER_HOUR exists and is reasonable (2-10)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const match = source.match(/PER_ACCOUNT_JOB_BUDGET_PER_HOUR\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1]);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(10);
    });

    it("QUEUE_PROCESSOR_INTERVAL_MS exists and is 15s-60s", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const match = source.match(/QUEUE_PROCESSOR_INTERVAL_MS\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1]);
      expect(value).toBeGreaterThanOrEqual(15000);
      expect(value).toBeLessThanOrEqual(60000);
    });

    it("processJobQueue checks global running count before promoting", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("getGlobalRunningJobCount");
      expect(source).toContain("globalRunning >= GLOBAL_MAX_CONCURRENT_JOBS");
    });

    it("queue promotion is atomic (WHERE status=QUEUED)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('eq(miFetchJobs.status, "QUEUED")');
      expect(source).toContain("Atomically promoted QUEUED");
      expect(source).toContain("already promoted by another process");
    });

    it("processJobQueue enforces per-account budget", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("checkAccountBudget");
      expect(source).toContain("incrementAccountBudget");
      expect(source).toContain("exceeded hourly budget");
    });

    it("processJobQueue respects per-account concurrency limit when promoting", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const queueFunc = source.slice(source.indexOf("async function processJobQueue"), source.indexOf("async function processJobQueue") + 2000);
      expect(queueFunc).toContain("getRunningJobCountForAccount");
      expect(queueFunc).toContain("MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT");
    });

    it("startQueueProcessor and stopQueueProcessor are exported", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("export function startQueueProcessor");
      expect(source).toContain("export function stopQueueProcessor");
    });

    it("getQueueDiagnostics returns required fields", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("export async function getQueueDiagnostics");
      expect(source).toContain("globalRunning");
      expect(source).toContain("globalMaxConcurrent");
      expect(source).toContain("queuedJobs");
      expect(source).toContain("perAccountBudget");
      expect(source).toContain("accountTrackers");
    });

    it("Queue processor is started on server boot", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/index.ts", "utf-8")
      );
      expect(source).toContain("startQueueProcessor");
      expect(source).toContain("import { startQueueProcessor }");
    });

    it("QUEUED jobs are selected by priority then FIFO (ordered by priority, createdAt)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const queueFunc = source.slice(source.indexOf("async function processJobQueue"), source.indexOf("async function processJobQueue") + 2000);
      expect(queueFunc).toContain("QUEUED");
      expect(queueFunc).toContain("orderBy");
      expect(queueFunc).toContain("priority");
      expect(queueFunc).toContain("createdAt");
    });

    it("account budget tracker resets hourly", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("3600000");
      expect(source).toContain("resetAt");
    });

    it("priority constants exist (FAST_PASS=0, DEEP_PASS=5, BACKGROUND=10)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("PRIORITY_FAST_PASS = 0");
      expect(source).toContain("PRIORITY_DEEP_PASS = 5");
      expect(source).toContain("PRIORITY_BACKGROUND = 10");
    });

    it("priority column exists in schema", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("shared/schema.ts", "utf-8")
      );
      const miFetchSection = source.slice(source.indexOf('mi_fetch_jobs'), source.indexOf('mi_fetch_jobs') + 1000);
      expect(miFetchSection).toContain("priority");
    });

    it("QUEUED jobs are created with FAST_PASS priority", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("priority: PRIORITY_FAST_PASS");
    });
  });

  describe("S2) Request Deduplication", () => {
    it("deduplicates by account+campaign (reuses RUNNING or QUEUED jobs)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("DEDUP: Reusing active");
      expect(source).toContain("IN ('RUNNING', 'QUEUED')");
    });

    it("deduplicates by competitorHash across different accounts", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("DEDUP: Reusing job");
      expect(source).toContain("same competitorHash");
      expect(source).toContain("existingDupHash");
    });
  });

  describe("S3) Backpressure & Rate Gate", () => {
    it("BACKPRESSURE_QUEUE_THRESHOLD exists and is reasonable (10-50)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const match = source.match(/BACKPRESSURE_QUEUE_THRESHOLD\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1]);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(50);
    });

    it("backpressure limits promotions to 1 per cycle when queue exceeds threshold", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("BACKPRESSURE: queue depth");
      expect(source).toContain("limiting to 1 promotion");
      expect(source).toContain("totalQueued > BACKPRESSURE_QUEUE_THRESHOLD");
    });

    it("MAX_PROMOTIONS_PER_MINUTE exists and is reasonable (4-10)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const match = source.match(/MAX_PROMOTIONS_PER_MINUTE\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1]);
      expect(value).toBeGreaterThanOrEqual(4);
      expect(value).toBeLessThanOrEqual(10);
    });

    it("rate gate defers promotions when limit reached", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("checkPromotionRateGate");
      expect(source).toContain("RATE_GATE:");
      expect(source).toContain("recordPromotion");
    });

    it("rate gate is checked per-promotion inside loop (not just once per cycle)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const queueFunc = source.slice(source.indexOf("for (const job of queuedJobs)"), source.indexOf("for (const job of queuedJobs)") + 1500);
      expect(queueFunc).toContain("checkPromotionRateGate");
      expect(queueFunc).toContain("stopping promotions");
      expect(queueFunc).toContain("break");
    });

    it("creationLocks path deduplicates QUEUED jobs (not just RUNNING)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const lockSection = source.slice(source.indexOf("if (creationLocks.has(lockKey))"), source.indexOf("if (creationLocks.has(lockKey))") + 500);
      expect(lockSection).toContain("IN ('RUNNING', 'QUEUED')");
      expect(lockSection).toContain("DEDUP (lock-path)");
    });

    it("promotion tracker resets every 60 seconds", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const rateGateFunc = source.slice(source.indexOf("function checkPromotionRateGate"), source.indexOf("function checkPromotionRateGate") + 300);
      expect(rateGateFunc).toContain("60000");
      expect(rateGateFunc).toContain("promotionTracker.count = 0");
    });

    it("queue health monitoring in diagnostics", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("backpressureActive");
      expect(source).toContain("backpressureThreshold");
      expect(source).toContain("promotionsThisMinute");
      expect(source).toContain("maxPromotionsPerMinute");
      expect(source).toContain("rateGateActive");
      expect(source).toContain("queueProcessorRunning");
    });
  });

  describe("T) Admin Market Database — Routes", () => {
    it("admin routes file exists and registers 4 endpoints", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/admin-routes.ts", "utf-8")
      );
      expect(source).toContain("/api/admin/market/overview");
      expect(source).toContain("/api/admin/market/competitors");
      expect(source).toContain("/api/admin/market/freshness");
      expect(source).toContain("/api/admin/market/crawler-status");
    });

    it("admin routes are registered in index.ts", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/index.ts", "utf-8")
      );
      expect(source).toContain("registerAdminMarketRoutes");
      expect(source).toContain("import { registerAdminMarketRoutes }");
    });

    it("overview endpoint returns inventory + queue + recentJobs", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/admin-routes.ts", "utf-8")
      );
      const overviewFunc = source.slice(source.indexOf("/api/admin/market/overview"), source.indexOf("/api/admin/market/competitors"));
      expect(overviewFunc).toContain("inventory");
      expect(overviewFunc).toContain("queue");
      expect(overviewFunc).toContain("recentJobs");
      expect(overviewFunc).toContain("getQueueDiagnostics");
    });

    it("freshness endpoint computes age and isFresh flag", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/admin-routes.ts", "utf-8")
      );
      expect(source).toContain("ageHours");
      expect(source).toContain("isFresh");
    });

    it("crawler-status returns running + queued + last24h stats", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/admin-routes.ts", "utf-8")
      );
      const crawlerFunc = source.slice(source.indexOf("/api/admin/market/crawler-status"));
      expect(crawlerFunc).toContain("running");
      expect(crawlerFunc).toContain("queued");
      expect(crawlerFunc).toContain("last24h");
    });

    it("MarketDatabaseAdmin component exists in frontend", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/MarketDatabaseAdmin.tsx", "utf-8")
      );
      expect(source).toContain("MarketDatabaseAdmin");
      expect(source).toContain("/api/admin/market/overview");
      expect(source).toContain("/api/admin/market/competitors");
      expect(source).toContain("/api/admin/market/freshness");
      expect(source).toContain("/api/admin/market/crawler-status");
    });

    it("Market DB tab is registered in AI Management (admin-only)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("app/(tabs)/ai-management.tsx", "utf-8")
      );
      expect(source).toContain("'marketdb'");
      expect(source).toContain("Market DB");
      expect(source).toContain("MarketDatabaseAdmin");
      expect(source).toContain("marketdb");
      const marketDbLine = source.split('\n').find((l: string) => l.includes("'marketdb'") && l.includes("advanced"));
      expect(marketDbLine).toBeDefined();
      expect(marketDbLine).toContain("advanced: true");
    });
  });

  describe("U) Stress Simulation — Queue Safety", () => {
    it("STAGGER_DELAY prevents burst starts for same account", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("STAGGER_DELAY_MS");
      expect(source).toContain("lastJobStartByAccount");
      const match = source.match(/STAGGER_DELAY_MS\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const value = parseInt(match![1]);
      expect(value).toBeGreaterThanOrEqual(3000);
    });

    it("creationLocks prevent duplicate job creation", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("creationLocks");
      expect(source).toContain("creationLocks.has(lockKey)");
      expect(source).toContain("creationLocks.add(lockKey)");
      expect(source).toContain("creationLocks.delete(lockKey)");
    });

    it("MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT is strictly 1", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      const match = source.match(/MAX_CONCURRENT_FETCH_JOBS_PER_ACCOUNT\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      expect(parseInt(match![1])).toBe(1);
    });

    it("cache reuse window prevents re-scraping within 12h", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("CACHE_REUSE_WINDOW_MS");
      const match = source.match(/CACHE_REUSE_WINDOW_MS\s*=\s*([\d*\s]+)/);
      expect(match).not.toBeNull();
    });

    it("multiple simultaneous requests reuse existing RUNNING/QUEUED job", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("DEDUP: Reusing active");
      expect(source).toContain("existingActive.length > 0");
    });

    it("queue processor limits promoted jobs to available global slots with backpressure", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("GLOBAL_MAX_CONCURRENT_JOBS - globalRunning");
      expect(source).toContain(".limit(slotsAvailable)");
      expect(source).toContain("BACKPRESSURE_QUEUE_THRESHOLD");
    });
  });

  describe("FAST_PASS / DEEP_PASS Architecture Hardening", () => {
    let orchSource: string;
    let dataAcqSource: string;
    let schemaSource: string;

    beforeAll(() => {
      orchSource = require("fs").readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      dataAcqSource = require("fs").readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8");
      schemaSource = require("fs").readFileSync("shared/schema.ts", "utf-8");
    });

    it("FP-1) Schema has enrichmentStatus field on ciCompetitors", () => {
      const tableBlock = schemaSource.slice(
        schemaSource.indexOf("ciCompetitors = pgTable"),
        schemaSource.indexOf("ciCompetitors = pgTable") + 2500
      );
      expect(tableBlock).toContain('enrichmentStatus');
      expect(tableBlock).toContain('enrichment_status');
      expect(tableBlock).toContain('.default("PENDING")');
    });

    it("FP-2) Schema has fetchMethod, postsCollected, commentsCollected, dataFreshnessDays on ciCompetitors", () => {
      const tableBlock = schemaSource.slice(
        schemaSource.indexOf("ciCompetitors = pgTable"),
        schemaSource.indexOf("ciCompetitors = pgTable") + 2500
      );
      expect(tableBlock).toContain("fetchMethod");
      expect(tableBlock).toContain("fetch_method");
      expect(tableBlock).toContain("postsCollected");
      expect(tableBlock).toContain("posts_collected");
      expect(tableBlock).toContain("commentsCollected");
      expect(tableBlock).toContain("comments_collected");
      expect(tableBlock).toContain("dataFreshnessDays");
      expect(tableBlock).toContain("data_freshness_days");
    });

    it("FP-3) FAST_PASS updates competitor inventory after fetch", () => {
      expect(orchSource).toContain('fetchMethod: "FAST_PASS"');
      expect(orchSource).toContain("postsCollected: fetchResult.postsCollected");
      expect(orchSource).toContain("commentsCollected: fetchResult.commentsCollected");
      expect(orchSource).toContain("FAST_PASS completed | competitor=");
    });

    it("FP-4) DEEP_PASS gate: blocks when FAST_PASS incomplete (missing lastCheckedAt)", () => {
      expect(orchSource).toContain("DEEP_PASS_BLOCKED");
      expect(orchSource).toContain("!c.lastCheckedAt");
      expect(orchSource).toContain("have not completed FAST_PASS");
    });

    it("FP-5) DEEP_PASS gate: skips already-enriched competitors", () => {
      expect(orchSource).toContain('c.enrichmentStatus === "ENRICHED"');
      expect(orchSource).toContain('enrichmentStatus !== "ENRICHED"');
      expect(orchSource).toContain("DEEP_PASS skipped: all");
    });

    it("FP-6) DEEP_PASS sets enrichmentStatus transitions: ENRICHING → ENRICHED/FAILED/SKIPPED", () => {
      expect(orchSource).toContain('enrichmentStatus: "ENRICHING"');
      expect(orchSource).toContain('enrichmentStatus: "ENRICHED"');
      expect(orchSource).toContain('enrichmentStatus: "FAILED"');
      expect(orchSource).toContain('enrichmentStatus: "SKIPPED"');
    });

    it("FP-7) DEEP_PASS updates fetchMethod and analysisLevel to DEEP_PASS on promotion", () => {
      expect(orchSource).toContain('fetchMethod: "DEEP_PASS"');
      expect(orchSource).toContain('analysisLevel: "DEEP_PASS"');
      expect(orchSource).toContain("competitor promoted to DEEP_PASS");
      expect(orchSource).toContain("analysisLevel=DEEP_PASS");
    });

    it("FP-8) enrichCompetitorWithComments blocks when FAST_PASS incomplete", () => {
      expect(dataAcqSource).toContain("FAST_PASS_INCOMPLETE");
      expect(dataAcqSource).toContain("!competitor.lastCheckedAt");
      expect(dataAcqSource).toContain("Cannot enrich before FAST_PASS completes");
    });

    it("FP-9) enrichCompetitorWithComments uses enrichmentStatus guard", () => {
      expect(dataAcqSource).toContain('enrichmentStatus === "ENRICHED"');
      expect(dataAcqSource).toContain("ALREADY_ENRICHED");
    });

    it("FP-10) DATA_DEGRADATION_GUARD prevents DEEP_PASS from overwriting FAST_PASS data", () => {
      expect(dataAcqSource).toContain("DATA_DEGRADATION_GUARD");
      expect(dataAcqSource).toContain("Keeping existing data");
    });

    it("FP-11) Duplicate post protection active (postId + shortcode dedup)", () => {
      expect(dataAcqSource).toContain("existingPostIds.has(post.postId)");
      expect(dataAcqSource).toContain("existingShortcodes.has(post.shortcode)");
      expect(dataAcqSource).toContain("isDuplicate");
    });

    it("FP-12) FAST_PASS skips comment generation", () => {
      expect(dataAcqSource).toContain('collectionMode !== "FAST_PASS"');
      expect(dataAcqSource).toContain("FAST_PASS: Skipping comment generation");
    });

    it("FP-13) recoverStuckDeepPass respects enrichmentStatus", () => {
      expect(orchSource).toContain("enrichment_status != 'ENRICHED'");
      expect(orchSource).toContain("enrichment_status NOT IN ('ENRICHED', 'ENRICHING')");
      expect(orchSource).toContain("last_checked_at IS NOT NULL");
    });

    it("FP-14) Data freshness calculated from newest post or comment timestamp", () => {
      expect(dataAcqSource).toContain("postTimestamps");
      expect(dataAcqSource).toContain("commentTimestamps");
      expect(dataAcqSource).toContain("allTimestamps");
      expect(dataAcqSource).toContain("newestTs");
      expect(dataAcqSource).toContain("dataFreshnessDays");
      const dataCoverage = require("fs").readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8");
      const coverageFn = dataCoverage.slice(
        dataCoverage.indexOf("async function getCompetitorDataCoverage") || dataCoverage.indexOf("export async function getCompetitorDataCoverage"),
        (dataCoverage.indexOf("async function getCompetitorDataCoverage") || dataCoverage.indexOf("export async function getCompetitorDataCoverage")) + 2000
      );
      expect(coverageFn).toContain("newestPost");
    });

    it("FP-15) Synthetic comments tagged as synthetic and excluded from real signal counts", () => {
      expect(dataAcqSource).toContain("isSynthetic: true");
      expect(dataAcqSource).toContain('source: "synthetic_enrichment"');
      expect(dataAcqSource).toContain("isSynthetic, false");
    });

    it("FP-16) Cooldown enforcement blocks repeated enrichment", () => {
      expect(dataAcqSource).toContain("SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS");
      expect(dataAcqSource).toContain("isSyntheticCooldownActive");
      expect(dataAcqSource).toContain("COOLDOWN_ACTIVE");
    });

    it("FP-17) Pipeline order enforced: FAST_PASS → snapshot → DEEP_PASS → enriched snapshot", () => {
      const fastPassSnapshotIdx = orchSource.indexOf("persistSnapshotAfterFetch(accountId, campaignId, isPartialCoverage");
      const deepPassQueueIdx = orchSource.indexOf("queueDeepPass(accountId, campaignId, competitors)");
      const deepPassSnapshotIdx = orchSource.indexOf("DEEP_PASS snapshot recomputed");
      expect(fastPassSnapshotIdx).toBeLessThan(deepPassQueueIdx);
      expect(deepPassQueueIdx).toBeLessThan(deepPassSnapshotIdx);
    });

    it("FP-18) FAST_PASS priority=0 always higher than DEEP_PASS priority=5", () => {
      expect(orchSource).toContain("PRIORITY_FAST_PASS = 0");
      expect(orchSource).toContain("PRIORITY_DEEP_PASS = 5");
      const fpMatch = orchSource.match(/PRIORITY_FAST_PASS\s*=\s*(\d+)/);
      const dpMatch = orchSource.match(/PRIORITY_DEEP_PASS\s*=\s*(\d+)/);
      expect(Number(fpMatch![1])).toBeLessThan(Number(dpMatch![1]));
    });

    it("FP-19) Structured logging for all stage transitions", () => {
      expect(orchSource).toContain("FAST_PASS completed");
      expect(orchSource).toContain("DEEP_PASS started");
      expect(orchSource).toContain("competitor promoted to DEEP_PASS");
      expect(orchSource).toContain("competitor skipped");
      expect(orchSource).toContain("DEEP_PASS_BLOCKED");
    });

    it("FP-20) DEEP_PASS cannot run repeatedly: enrichmentStatus + cooldown double-guard", () => {
      const enrichFn = dataAcqSource.slice(
        dataAcqSource.indexOf("export async function enrichCompetitorWithComments"),
        dataAcqSource.indexOf("export async function enrichCompetitorWithComments") + 3000
      );
      expect(enrichFn).toContain("FAST_PASS_INCOMPLETE");
      expect(enrichFn).toContain("isSyntheticCooldownActive");
      expect(enrichFn).toContain("COOLDOWN_ACTIVE");
      expect(enrichFn).toContain("REAL_DATA_SUFFICIENT");
      expect(enrichFn).toContain("ALREADY_ENRICHED");
    });

    it("FP-21) fetchCompetitorData stores inventory fields (fetchMethod, postsCollected, dataFreshnessDays)", () => {
      const fetchFn = dataAcqSource.slice(
        dataAcqSource.indexOf("export async function fetchCompetitorData"),
        dataAcqSource.indexOf("export async function fetchCompetitorData") + 25000
      );
      expect(fetchFn).toContain('fetchMethod: collectionMode || "FAST_PASS"');
      expect(fetchFn).toContain("postsCollected: persistedPostCount");
      expect(fetchFn).toContain("commentsCollected: persistedCommentCount");
      expect(fetchFn).toContain("dataFreshnessDays");
    });

    it("FP-22) New system uses enrichmentStatus (not only analysisLevel) for stage tracking", () => {
      expect(orchSource).toContain("enrichmentStatus");
      expect(dataAcqSource).toContain("enrichmentStatus");
      const enrichmentStatusCount = (orchSource.match(/enrichmentStatus/g) || []).length;
      expect(enrichmentStatusCount).toBeGreaterThanOrEqual(8);
    });

    it("FP-23) Snapshot integrity: FAST_PASS generates baseline, DEEP_PASS generates enriched", () => {
      expect(orchSource).toContain('fastPassDataStatus');
      expect(orchSource).toContain('"ENRICHING"');
      expect(orchSource).toContain("DEEP_PASS snapshot recomputed (COMPLETE)");
    });

    it("FP-24) Engine version compatibility checks remain active", () => {
      const engineSource = require("fs").readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      expect(engineSource).toContain("ENGINE_VERSION");
      expect(engineSource).toContain("analysisVersion");
      expect(engineSource).toContain("SNAPSHOT_COMPLETION_CONTRACT_VIOLATED");
    });

    it("FP-25) New competitor creation initializes enrichmentStatus=PENDING", () => {
      const routeSource = require("fs").readFileSync("server/competitive-intelligence/competitor-routes.ts", "utf-8");
      expect(routeSource).toContain('enrichmentStatus: "PENDING"');
      expect(routeSource).toContain("postsCollected: 0");
      expect(routeSource).toContain("commentsCollected: 0");
    });

    it("FP-26) Admin route includes all inventory fields", () => {
      const adminSource = require("fs").readFileSync("server/market-intelligence-v3/admin-routes.ts", "utf-8");
      expect(adminSource).toContain("ciCompetitors.enrichmentStatus");
      expect(adminSource).toContain("ciCompetitors.fetchMethod");
      expect(adminSource).toContain("ciCompetitors.postsCollected");
      expect(adminSource).toContain("ciCompetitors.commentsCollected");
      expect(adminSource).toContain("ciCompetitors.dataFreshnessDays");
      expect(adminSource).toContain("ciCompetitors.lastCheckedAt");
      expect(adminSource).toContain("ciCompetitors.analysisLevel");
    });

    it("FP-27) Evidence endpoint returns inventory block", () => {
      const routeSource = require("fs").readFileSync("server/competitive-intelligence/competitor-routes.ts", "utf-8");
      expect(routeSource).toContain("inventory:");
      expect(routeSource).toContain("competitor.enrichmentStatus");
      expect(routeSource).toContain("competitor.fetchMethod");
      expect(routeSource).toContain("competitor.postsCollected");
      expect(routeSource).toContain("competitor.commentsCollected");
      expect(routeSource).toContain("competitor.dataFreshnessDays");
    });

    it("FP-28) MIv3 engine logs INVENTORY_STATUS with enrichmentStatus counts", () => {
      const engineSource = require("fs").readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      expect(engineSource).toContain("INVENTORY_STATUS");
      expect(engineSource).toContain('enrichmentStatus === "ENRICHED"');
      expect(engineSource).toContain('enrichmentStatus === "PENDING"');
    });

    it("FP-29) AudienceEngine logs INVENTORY_STATUS", () => {
      const aeSource = require("fs").readFileSync("server/audience-engine/engine.ts", "utf-8");
      expect(aeSource).toContain("INVENTORY_STATUS");
      expect(aeSource).toContain('enrichmentStatus === "ENRICHED"');
    });

    it("FP-30) PositioningEngine logs INVENTORY_STATUS and filters active only", () => {
      const peSource = require("fs").readFileSync("server/positioning-engine/engine.ts", "utf-8");
      expect(peSource).toContain("INVENTORY_STATUS");
      expect(peSource).toContain("enrichmentStatus");
      expect(peSource).toContain("isActive, true");
    });

    it("FP-31) Context kernel uses enrichmentStatus for data quality weighting", () => {
      const ckSource = require("fs").readFileSync("server/engine-contracts/context-kernel.ts", "utf-8");
      expect(ckSource).toContain('enrichmentStatus === "ENRICHED"');
      expect(ckSource).toContain("enrichmentRatio");
    });

    it("FP-32) getCompetitorDataCoverage returns inventory fields from competitor record", () => {
      const coverageSource = require("fs").readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8");
      const fnStart = coverageSource.indexOf("export async function getCompetitorDataCoverage");
      const fn = coverageSource.slice(fnStart, fnStart + 4000);
      expect(fn).toContain("competitor?.analysisLevel");
      expect(fn).toContain("competitor?.enrichmentStatus");
      expect(fn).toContain("competitor?.fetchMethod");
      expect(fn).toContain("competitor?.dataFreshnessDays");
      expect(fn).toContain("lastCheckedAt");
    });

    it("FP-33) analysisLevel promoted to DEEP_PASS in normal DEEP_PASS path (not just recovery)", () => {
      expect(orchSource).toContain('analysisLevel: "DEEP_PASS"');
      expect(orchSource).toContain("analysisLevel=DEEP_PASS");
    });

    it("FP-34) FAST_PASS resets enrichmentStatus to PENDING so DEEP_PASS can re-run", () => {
      expect(orchSource).toContain('enrichmentStatus: "PENDING"');
      expect(orchSource).toContain('analysisLevel: "FAST_PASS"');
      const fastPassSection = orchSource.slice(
        orchSource.indexOf("stage.POSTS_FETCH = \"COMPLETE\""),
        orchSource.indexOf("stage.POSTS_FETCH = \"COMPLETE\"") + 800
      );
      expect(fastPassSection).toContain('enrichmentStatus: "PENDING"');
      expect(fastPassSection).toContain('analysisLevel: "FAST_PASS"');
    });

    it("FP-35) Full FAST_PASS→DEEP_PASS cycle: FAST_PASS sets PENDING, DEEP_PASS promotes to ENRICHED", () => {
      const fastPassUpdate = orchSource.slice(
        orchSource.indexOf("stage.POSTS_FETCH = \"COMPLETE\""),
        orchSource.indexOf("stage.POSTS_FETCH = \"COMPLETE\"") + 800
      );
      expect(fastPassUpdate).toContain('enrichmentStatus: "PENDING"');
      expect(fastPassUpdate).toContain('fetchMethod: "FAST_PASS"');

      const deepPassPromotion = orchSource.slice(
        orchSource.indexOf("competitor promoted to DEEP_PASS"),
        orchSource.indexOf("competitor promoted to DEEP_PASS") + 500
      );
      expect(deepPassPromotion).toContain("analysisLevel=DEEP_PASS");

      const deepPassUpdate = orchSource.slice(
        orchSource.indexOf("competitor promoted to DEEP_PASS") - 500,
        orchSource.indexOf("competitor promoted to DEEP_PASS")
      );
      expect(deepPassUpdate).toContain('analysisLevel: "DEEP_PASS"');
      expect(deepPassUpdate).toContain('enrichmentStatus: "ENRICHED"');
      expect(deepPassUpdate).toContain('fetchMethod: "DEEP_PASS"');
    });

    it("FP-36) Recovery path enforces post+comment thresholds before promotion", () => {
      expect(orchSource).toContain("[DeepPassRecovery]");
      expect(orchSource).toContain("Promoted");
      expect(orchSource).toContain("Thresholds NOT met");
      const recoverySection = orchSource.slice(
        orchSource.indexOf("[DeepPassRecovery]"),
        orchSource.indexOf("[DeepPassRecovery]") + 3000
      );
      expect(recoverySection).toContain("postsMet");
      expect(recoverySection).toContain("commentsMet");
      expect(recoverySection).toContain("MIN_POSTS_TARGET");
      expect(recoverySection).toContain("fetchCompetitorData");
      expect(recoverySection).toContain("TARGET_POSTS_DEEP");
    });

    it("FP-37) DEEP_PASS auto-triggers after FAST_PASS when fetch executed", () => {
      expect(orchSource).toContain("willRunDeepPass = anyFetchExecuted && !allCooldown");
      expect(orchSource).toContain("Auto-queuing Deep Pass");
      expect(orchSource).toContain("queueDeepPass(accountId, campaignId, competitors)");
    });

    it("FP-38) DEEP_PASS collects additional posts before enrichment", () => {
      const deepPassFn = orchSource.slice(
        orchSource.indexOf("async function queueDeepPass"),
        orchSource.indexOf("async function queueDeepPass") + 5000
      );
      expect(deepPassFn).toContain("TARGET_POSTS_DEEP");
      expect(deepPassFn).toContain("fetchCompetitorData");
      expect(deepPassFn).toContain('"DEEP_PASS"');
      expect(deepPassFn).toContain("DEEP_PASS collecting additional posts");
      expect(deepPassFn).toContain("DEEP_PASS post target already met");
    });

    it("FP-39) DEEP_PASS promotion requires both post AND comment thresholds + dataset growth", () => {
      const deepPassFn = orchSource.slice(
        orchSource.indexOf("async function queueDeepPass"),
        orchSource.indexOf("async function queueDeepPass") + 9000
      );
      expect(deepPassFn).toContain("postsMet = deepPassPostCount >= MIN_POSTS_TARGET");
      expect(deepPassFn).toContain("commentsMet = deepPassCommentCount >= MIN_COMMENTS_TARGET");
      expect(deepPassFn).toContain("enrichmentSucceeded && postsMet && commentsMet && datasetGrew");
      expect(deepPassFn).toContain("DEEP_PASS thresholds NOT met");
      expect(deepPassFn).toContain("ENRICHMENT_NO_CHANGE");
    });

    it("FP-40) DEEP_PASS updates postsCollected on promotion", () => {
      const deepPassFn = orchSource.slice(
        orchSource.indexOf("async function queueDeepPass"),
        orchSource.indexOf("async function queueDeepPass") + 9000
      );
      expect(deepPassFn).toContain("postsCollected: deepPassPostCount");
      expect(deepPassFn).toContain("commentsCollected: deepPassCommentCount");
    });

    it("FP-41) DEEP_PASS tracks real vs synthetic comment counts", () => {
      const deepPassFn = orchSource.slice(
        orchSource.indexOf("async function queueDeepPass"),
        orchSource.indexOf("async function queueDeepPass") + 9000
      );
      expect(deepPassFn).toContain("isSynthetic, false");
      expect(deepPassFn).toContain("realCommentCount");
      expect(deepPassFn).toContain("syntheticCommentCount");
      const deepPassLog = orchSource.slice(
        orchSource.indexOf("competitor promoted to DEEP_PASS"),
        orchSource.indexOf("competitor promoted to DEEP_PASS") + 500
      );
      expect(deepPassLog).toContain("real=");
    });

    it("FP-42) enrichCompetitorWithComments does NOT set analysisLevel (orchestrator owns promotion)", () => {
      const enrichFn = dataAcqSource.slice(
        dataAcqSource.indexOf("export async function enrichCompetitorWithComments"),
        dataAcqSource.indexOf("export async function enrichCompetitorWithComments") + 3000
      );
      const updateSection = enrichFn.slice(
        enrichFn.indexOf("lastSyntheticEnrichmentAt: new Date()") - 100,
        enrichFn.indexOf("lastSyntheticEnrichmentAt: new Date()") + 300
      );
      expect(updateSection).not.toContain("analysisLevel");
    });

    it("FP-43) Recovery auto-promote SQL requires BOTH post and comment thresholds", () => {
      const recoveryQuery = orchSource.slice(
        orchSource.indexOf("UPDATE ci_competitors SET analysis_level = 'DEEP_PASS', enrichment_status = 'ENRICHED'"),
        orchSource.indexOf("UPDATE ci_competitors SET analysis_level = 'DEEP_PASS', enrichment_status = 'ENRICHED'") + 1200
      );
      expect(recoveryQuery).toContain("ci_competitor_posts");
      expect(recoveryQuery).toContain("MIN_POSTS_TARGET");
      expect(recoveryQuery).toContain("MIN_COMMENTS_SAMPLE");
    });

    it("FP-44) Dataset growth verification: ENRICHMENT_NO_CHANGE blocks promotion when dataset unchanged", () => {
      const deepPassFn = orchSource.slice(
        orchSource.indexOf("async function queueDeepPass"),
        orchSource.indexOf("async function queueDeepPass") + 9000
      );
      expect(deepPassFn).toContain("datasetGrew = deepPassPostCount > baselinePostCount || deepPassCommentCount > baselineCommentCount");
      expect(deepPassFn).toContain("ENRICHMENT_NO_CHANGE");
      expect(deepPassFn).toContain("dataset did not grow");
      expect(deepPassFn).toContain("promotion blocked");
      expect(deepPassFn).toContain("!datasetGrew && enrichmentSucceeded");
    });

    it("FP-45) POST_EXPANSION_FAILED logged when post count doesn't increase", () => {
      expect(orchSource).toContain("POST_EXPANSION_FAILED");
      expect(orchSource).toContain("no new posts collected");
      expect(orchSource).toContain("postExpansionSucceeded = afterFetchPosts > baselinePostCount");
    });

    it("FP-46) DEEP_PASS_DIAGNOSTICS emitted for every competitor after processing", () => {
      const deepPassFn = orchSource.slice(
        orchSource.indexOf("async function queueDeepPass"),
        orchSource.indexOf("async function queueDeepPass") + 12000
      );
      expect(deepPassFn).toContain("DEEP_PASS_DIAGNOSTICS");
      expect(deepPassFn).toContain("baselinePostCount=");
      expect(deepPassFn).toContain("deepPassPostCount=");
      expect(deepPassFn).toContain("realCommentCount=");
      expect(deepPassFn).toContain("syntheticCommentCount=");
      expect(deepPassFn).toContain("totalCommentCount=");
      expect(deepPassFn).toContain("datasetGrew=");
      expect(deepPassFn).toContain("postExpansionAttempted=");
      expect(deepPassFn).toContain("postExpansionSucceeded=");
      expect(deepPassFn).toContain("promotionDecision=");
      expect(deepPassFn).toContain("enrichmentResult=");
    });

    it("FP-47) Inventory consistency validation runs after DEEP_PASS", () => {
      expect(orchSource).toContain("validateInventoryConsistency(accountId, campaignId)");
      expect(orchSource).toContain("INVENTORY_INCONSISTENCY");
      expect(orchSource).toContain("INVENTORY_VALIDATION");
      expect(orchSource).toContain("demoting to FAST_PASS/PENDING");
    });

    it("FP-48) validateInventoryConsistency demotes DEEP_PASS competitors below thresholds", () => {
      const validationFn = orchSource.slice(
        orchSource.indexOf("async function validateInventoryConsistency"),
        orchSource.indexOf("async function validateInventoryConsistency") + 4000
      );
      expect(validationFn).toContain("MIN_POSTS_TARGET");
      expect(validationFn).toContain("MIN_COMMENTS_TARGET");
      expect(validationFn).toContain('analysisLevel: "FAST_PASS"');
      expect(validationFn).toContain('enrichmentStatus: "PENDING"');
      expect(validationFn).toContain("inconsistencies corrected");
    });

    it("FP-49) Recovery path includes dataset growth verification (ENRICHMENT_NO_CHANGE)", () => {
      const recoverySection = orchSource.slice(
        orchSource.indexOf("[DeepPassRecovery]"),
        orchSource.lastIndexOf("[DeepPassRecovery]") + 2000
      );
      expect(recoverySection).toContain("ENRICHMENT_NO_CHANGE");
      expect(recoverySection).toContain("datasetGrew");
      expect(recoverySection).toContain("baselinePostCount");
      expect(recoverySection).toContain("DEEP_PASS_DIAGNOSTICS");
    });

    it("FP-50) Recovery path logs real+synthetic comment breakdown", () => {
      const recoverySection = orchSource.slice(
        orchSource.indexOf("recoverStuckDeepPass"),
        orchSource.indexOf("recoverStuckDeepPass") + 8000
      );
      expect(recoverySection).toContain("realCommentCount");
      expect(recoverySection).toContain("syntheticComments");
      expect(recoverySection).toContain("isSynthetic, false");
    });
  });

  describe("LOW_SAMPLE + Market Activity Hardening", () => {
    let signalSource: string;
    let trajectorySource: string;
    let constantsSource: string;
    let typesSource: string;

    beforeAll(() => {
      signalSource = require("fs").readFileSync("server/market-intelligence-v3/signal-engine.ts", "utf-8");
      trajectorySource = require("fs").readFileSync("server/market-intelligence-v3/trajectory-engine.ts", "utf-8");
      constantsSource = require("fs").readFileSync("server/market-intelligence-v3/constants.ts", "utf-8");
      typesSource = require("fs").readFileSync("server/market-intelligence-v3/types.ts", "utf-8");
    });

    it("FP-51) CompetitorSignalResult includes lowSample boolean field", () => {
      expect(typesSource).toContain("lowSample: boolean");
    });

    it("FP-52) computeCompetitorSignals flags lowSample when posts < MIN_POSTS_PER_COMPETITOR", () => {
      expect(signalSource).toContain("lowSample = posts.length < MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR");
      expect(signalSource).toContain("LOW_SAMPLE_WEIGHT_FACTOR");
    });

    it("FP-53) LOW_SAMPLE competitors get reduced authority weight", () => {
      const signalFn = signalSource.slice(
        signalSource.indexOf("export function computeCompetitorSignals"),
        signalSource.indexOf("export function computeCompetitorSignals") + 4000
      );
      expect(signalFn).toContain("lowSample ?");
      expect(signalFn).toContain("LOW_SAMPLE_WEIGHT_FACTOR");
      expect(signalFn).toContain("rawAuthorityWeight");
    });

    it("FP-54) computeMarketActivityLevel prioritizes ACTIVE competitors with sufficient data", () => {
      expect(trajectorySource).toContain("activeWithSufficientData");
      expect(trajectorySource).toContain("!s.lowSample");
      expect(trajectorySource).toContain("useActiveOnly");
      expect(trajectorySource).toContain("LOW_SAMPLE_ACTIVITY_WEIGHT");
      expect(trajectorySource).toContain("LOW_SAMPLE_COMPETITOR");
    });

    it("FP-55) detectSampleBias flags LOW_SAMPLE_COMPETITOR competitors", () => {
      expect(signalSource).toContain("LOW_SAMPLE_COMPETITOR");
      expect(signalSource).toContain("lowSampleCompetitors");
      expect(signalSource).toContain("r.lowSample");
    });

    it("FP-56) MI_LIFECYCLE constants include LOW_SAMPLE thresholds", () => {
      expect(constantsSource).toContain("LOW_SAMPLE_WEIGHT_FACTOR");
      expect(constantsSource).toContain("LOW_SAMPLE_ACTIVITY_WEIGHT");
      const weightMatch = constantsSource.match(/LOW_SAMPLE_WEIGHT_FACTOR:\s*([\d.]+)/);
      expect(weightMatch).toBeTruthy();
      expect(Number(weightMatch![1])).toBeLessThan(1.0);
      expect(Number(weightMatch![1])).toBeGreaterThan(0);
    });
  });
});
