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

    it("should use exponential backoff", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("Math.pow");
      expect(source).toContain("RETRY_BASE_MS");
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
      expect(Number(match![1])).toBeLessThanOrEqual(10);
    });

    it("should have MAX_REQUESTS_PER_JOB hard ceiling in orchestrator", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("MAX_REQUESTS_PER_JOB");
      const match = source.match(/MAX_REQUESTS_PER_JOB\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBeGreaterThan(0);
      expect(Number(match![1])).toBeLessThanOrEqual(100);
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
      expect(source).toContain("PARTIAL_CONFIDENCE_PENALTY");
      expect(source).toContain("PARTIAL_COVERAGE:");
    });

    it("should add PARTIAL_COVERAGE to missingSignalFlags", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('"PARTIAL_COVERAGE"');
      expect(source).toContain("Coverage is incomplete");
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
    it("should recover RUNNING jobs from DB after backend restart", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('eq(miFetchJobs.status, "RUNNING")');
      expect(source).toContain("Reusing active DB job");
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
    it("should mark fetch stages as COOLDOWN_BLOCKED (not COMPLETE) when cooldown active", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain('stage.POSTS_FETCH = "COOLDOWN_BLOCKED"');
      expect(source).toContain('stage.COMMENTS_FETCH = "COOLDOWN_BLOCKED"');
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

  describe("L) Cooldown UI — Distinct Display States", () => {
    it("should show COMPLETE_WITH_COOLDOWN as distinct status in frontend", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("COMPLETE_WITH_COOLDOWN");
      expect(source).toContain("ANALYSIS COMPLETE (CACHED)");
    });

    it("should display 'Fetch blocked (cooldown active)' banner", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("Fetch blocked (cooldown active)");
      expect(source).toContain("Analysis executed using cached data");
    });

    it("should render COOLDOWN_BLOCKED icon (clock/time) for fetch stages", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("COOLDOWN_BLOCKED");
      expect(source).toContain('"time"');
    });

    it("should render CACHED_ANALYSIS icon (blue checkmark) for analysis stages", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("CACHED_ANALYSIS");
      expect(source).toContain("#3B82F6");
    });

    it("should display cooldown remaining hours per competitor", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("cooldownRemainingHours");
      expect(source).toContain("cooldown");
    });

    it("should show 'cached analysis' label when analysisSource is CACHED_DATA", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("CACHED_DATA");
      expect(source).toContain("cached analysis");
    });

    it("should show stage labels with source context: (cooldown), (cached), (no data)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("(cooldown)");
      expect(source).toContain("(cached)");
      expect(source).toContain("(no data)");
    });
  });

  describe("M-1) Data Integrity — Delete-Before-Insert & Verified Counts", () => {
    it("should delete old posts/comments before re-inserting in transaction", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("db.transaction");
      expect(source).toContain("tx.delete(ciCompetitorComments)");
      expect(source).toContain("tx.delete(ciCompetitorPosts)");
      const deleteCommentsIdx = source.indexOf("tx.delete(ciCompetitorComments)");
      const deletePostsIdx = source.indexOf("tx.delete(ciCompetitorPosts)");
      const insertPostsIdx = source.indexOf("tx.insert(ciCompetitorPosts)");
      expect(deleteCommentsIdx).toBeLessThan(insertPostsIdx);
      expect(deletePostsIdx).toBeLessThan(insertPostsIdx);
    });

    it("should verify persisted counts after insertion", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("DATA_MISMATCH_ERROR");
      expect(source).toContain("persistedPostCount");
      expect(source).toContain("persistedCommentCount");
      const verifyIdx = source.indexOf("persistedPostCount");
      const snapshotIdx = source.indexOf("db.insert(ciCompetitorMetricsSnapshot)");
      expect(verifyIdx).toBeLessThan(snapshotIdx);
    });

    it("should write verified counts to metrics snapshot (not raw insert count)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const snapshotBlock = source.slice(
        source.indexOf("db.insert(ciCompetitorMetricsSnapshot)"),
        source.indexOf("db.insert(ciCompetitorMetricsSnapshot)") + 300
      );
      expect(snapshotBlock).toContain("persistedPostCount");
      expect(snapshotBlock).toContain("persistedCommentCount");
      expect(snapshotBlock).not.toContain("postsToStore.length");
    });

    it("should return verified counts from fetchCompetitorData", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const completedLogIdx = source.indexOf("posts (verified)");
      expect(completedLogIdx).toBeGreaterThan(-1);
      const returnAfterLog = source.slice(completedLogIdx, completedLogIdx + 800);
      expect(returnAfterLog).toContain("persistedPostCount");
      expect(returnAfterLog).toContain("persistedCommentCount");
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
        source.indexOf("export async function getCompetitorDataCoverage") + 500
      );
      expect(coverageFn).toContain("count(*)");
      expect(coverageFn).toContain("ciCompetitorPosts");
      expect(coverageFn).toContain("ciCompetitorComments");
    });
  });

  describe("N) Coverage-Aware Cooldown & State Machine Honesty", () => {
    it("cooldown must NOT block when posts < 30 or comments < 100", async () => {
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

    it("cooldown only applies when posts >= 30 AND comments >= 100", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const thresholdLine = source.match(/const MIN_POSTS_THRESHOLD\s*=\s*(\d+)/);
      const commentLine = source.match(/const MIN_COMMENTS_THRESHOLD\s*=\s*(\d+)/);
      expect(thresholdLine).not.toBeNull();
      expect(commentLine).not.toBeNull();
      expect(parseInt(thresholdLine![1])).toBe(30);
      expect(parseInt(commentLine![1])).toBe(100);
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

    it("UI must show PARTIAL — BELOW THRESHOLDS (never COMPLETE when insufficient)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8")
      );
      expect(source).toContain("PARTIAL_COMPLETE");
      expect(source).toContain("MI V3 PARTIAL");
      expect(source).toContain("BELOW THRESHOLDS");
      expect(source).toContain("bypass cooldown");
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
      expect(parseInt(targetMatch![1])).toBeGreaterThanOrEqual(30);

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

    it("scraper must use session-persistent proxy for pagination continuity", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/profile-scraper.ts", "utf-8")
      );
      expect(source).toContain("getSessionDispatcher");
      expect(source).toContain("-session-");
      expect(source).toContain("sessionId");
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

    it("comment generator must produce enough to approach 100 threshold", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const maxCommentPostsMatch = source.match(/const MAX_COMMENT_POSTS\s*=\s*(\d+)/);
      const maxCommentsPerPostMatch = source.match(/const MAX_COMMENTS_PER_POST\s*=\s*(\d+)/);
      expect(maxCommentPostsMatch).not.toBeNull();
      expect(maxCommentsPerPostMatch).not.toBeNull();
      const maxPossible = parseInt(maxCommentPostsMatch![1]) * parseInt(maxCommentsPerPostMatch![1]);
      expect(maxPossible).toBeGreaterThanOrEqual(100);
    });

    it("post threshold must be 30 (not 12) — 12 is page ceiling, not sufficiency", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("INSTAGRAM_PUBLIC_API_POST_CEILING = 12");
      const thresholdMatch = source.match(/const MIN_POSTS_THRESHOLD\s*=\s*(\d+)/);
      expect(thresholdMatch).not.toBeNull();
      expect(parseInt(thresholdMatch![1])).toBe(30);
      expect(source).not.toContain("MIN_POSTS_THRESHOLD = INSTAGRAM_PUBLIC_API_POST_CEILING");
    });

    it("fetch orchestrator must use 30 as post target (not 12)", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );
      expect(source).toContain("INSTAGRAM_PUBLIC_API_POST_CEILING = 12");
      const targetMatch = source.match(/const MIN_POSTS_TARGET\s*=\s*(\d+)/);
      expect(targetMatch).not.toBeNull();
      expect(parseInt(targetMatch![1])).toBe(30);
      expect(source).not.toContain("MIN_POSTS_TARGET = INSTAGRAM_PUBLIC_API_POST_CEILING");
    });

    it("REGRESSION GUARD: 12 posts with totalMediaCount > 12 must be INSUFFICIENT_DATA", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("INSUFFICIENT_DATA");
      expect(source).toContain("coverageSufficient");
      const thresholdMatch = source.match(/const MIN_POSTS_THRESHOLD\s*=\s*(\d+)/);
      expect(parseInt(thresholdMatch![1])).toBe(30);
      expect(source).toContain("persistedPostCount >= MIN_POSTS_THRESHOLD");
      expect(source).toContain("persistedCommentCount >= MIN_COMMENTS_THRESHOLD");
      const insufficientIdx = source.indexOf("} else if (persistedPostCount >= 5)");
      expect(insufficientIdx).toBeGreaterThan(-1);
      const insufficientBlock = source.slice(insufficientIdx, insufficientIdx + 300);
      expect(insufficientBlock).toContain("INSUFFICIENT_DATA");
      expect(insufficientBlock).not.toContain('"SUCCESS"');
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
      const daThreshold = daSource.match(/const MIN_POSTS_THRESHOLD\s*=\s*(\d+)/);
      const foTarget = foSource.match(/const MIN_POSTS_TARGET\s*=\s*(\d+)/);
      expect(parseInt(daThreshold![1])).toBeGreaterThanOrEqual(30);
      expect(parseInt(foTarget![1])).toBeGreaterThanOrEqual(30);
    });

    it("data atomicity: delete + insert wrapped in transaction", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      expect(source).toContain("db.transaction");
      expect(source).toContain("tx.delete(ciCompetitorComments)");
      expect(source).toContain("tx.delete(ciCompetitorPosts)");
      expect(source).toContain("tx.insert(ciCompetitorPosts)");
      expect(source).toContain("tx.insert(ciCompetitorComments)");
    });
  });

  describe("P) Single Source-of-Truth", () => {
    it("competitor card coverage must use live count(*) from DB", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/competitive-intelligence/data-acquisition.ts", "utf-8")
      );
      const coverageFn = source.slice(
        source.indexOf("export async function getCompetitorDataCoverage"),
        source.indexOf("export async function getCompetitorDataCoverage") + 500
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
      expect(postLine).toContain("30");
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
        source.indexOf("async _executeRun") + 8000
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
        entryStrategy: null,
        defensiveRisks: null,
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
      expect(result.failures.some((f: string) => f.includes("defensiveRisks"))).toBe(true);
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
        entryStrategy: "Test entry strategy",
        defensiveRisks: JSON.stringify(["risk1"]),
        narrativeSynthesis: "Test narrative",
        confidenceLevel: "MODERATE",
      };
      const result = validateSnapshotCompleteness(valid);
      expect(result.valid).toBe(true);
      expect(result.failures.length).toBe(0);
    });

    it("STATIC SCAN: no direct db.insert(miSnapshots) outside persistValidatedSnapshot", async () => {
      const engineSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const fetchSource = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8")
      );

      const engineInsertCount = (engineSource.match(/db\.insert\(miSnapshots\)/g) || []).length;
      expect(engineInsertCount).toBe(1);

      const gatewayIdx = engineSource.indexOf("export async function persistValidatedSnapshot");
      const insertIdx = engineSource.indexOf("db.insert(miSnapshots)");
      expect(insertIdx).toBeGreaterThan(gatewayIdx);
      const gatewayEnd = engineSource.indexOf("\nasync function getCompetitorData");
      expect(insertIdx).toBeLessThan(gatewayEnd);

      expect(fetchSource).not.toContain("db.insert(miSnapshots)");
      expect(fetchSource).toContain("persistValidatedSnapshot");
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
      const cacheBlock = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1500);
      expect(cacheBlock).toContain("ENGINE_VERSION");
      expect(cacheBlock).toContain("analysisVersion");
      expect(cacheBlock).toContain("SNAPSHOT_VERSION_INVALIDATED");
      expect(cacheBlock).toContain("return null");
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
      const cacheBlock = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1200);
      expect(cacheBlock).toContain("isSnapshotAnalyticallyComplete(snapshot)");
      expect(cacheBlock).toContain("return null");
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
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1500);
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
        entryStrategy: null,
        defensiveRisks: JSON.stringify([]),
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

    it("REGRESSION: guardDecision=PROCEED + null entryStrategy must fail validation", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const proceedWithNull = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.85, level: "STRONG", guardDecision: "PROCEED" }),
        marketState: "HEATING",
        volatilityIndex: 0.3,
        entryStrategy: null,
        defensiveRisks: JSON.stringify(["risk1"]),
        narrativeSynthesis: null,
        confidenceLevel: "STRONG",
      };
      const result = validateSnapshotCompleteness(proceedWithNull);
      expect(result.valid).toBe(false);
      expect(result.failures.some((f: string) => f.includes("entryStrategy") && f.includes("guardDecision=PROCEED"))).toBe(true);
      expect(result.failures.some((f: string) => f.includes("narrativeSynthesis") && f.includes("guardDecision=PROCEED"))).toBe(true);
    });

    it("REGRESSION: guardDecision=DOWNGRADE + null entryStrategy must pass validation", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const downgradeWithNull = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.4, level: "LOW", guardDecision: "DOWNGRADE" }),
        marketState: "COOLING",
        volatilityIndex: 0.2,
        entryStrategy: null,
        defensiveRisks: JSON.stringify(["INSUFFICIENT DATA"]),
        narrativeSynthesis: null,
        confidenceLevel: "LOW",
      };
      const result = validateSnapshotCompleteness(downgradeWithNull);
      expect(result.valid).toBe(true);
    });

    it("REGRESSION: guardDecision=BLOCK + null entryStrategy must pass validation", async () => {
      const { validateSnapshotCompleteness } = await import("../market-intelligence-v3/engine");
      const blockWithNull = {
        signalData: JSON.stringify([{ competitorId: "c1", signals: {} }]),
        intentData: JSON.stringify([{ competitorId: "c1", intentCategory: "TESTING" }]),
        trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5 }),
        dominanceData: JSON.stringify([{ competitorId: "c1" }]),
        confidenceData: JSON.stringify({ overall: 0.2, level: "LOW", guardDecision: "BLOCK" }),
        marketState: "INSUFFICIENT_DATA",
        volatilityIndex: 0.1,
        entryStrategy: null,
        defensiveRisks: JSON.stringify(["BLOCKED"]),
        narrativeSynthesis: null,
        confidenceLevel: "LOW",
      };
      const result = validateSnapshotCompleteness(blockWithNull);
      expect(result.valid).toBe(true);
    });

    it("REGRESSION: validation uses guardDecision (not numeric threshold) for entryStrategy/narrativeSynthesis", async () => {
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
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1500);
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
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1200);
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

    it("REGRESSION: same ENGINE_VERSION does not invalidate snapshot", async () => {
      const source = await import("fs").then(fs =>
        fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8")
      );
      const cacheFunc = source.slice(source.indexOf("async function getCachedSnapshot"), source.indexOf("async function getCachedSnapshot") + 1200);
      expect(cacheFunc).toContain("snapshotVersion !== ENGINE_VERSION");
      expect(cacheFunc).not.toContain("snapshotVersion < ENGINE_VERSION");
    });
  });
});
