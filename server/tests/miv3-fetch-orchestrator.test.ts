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

  describe("E) Build-a-Plan Reads Only (No Compute)", () => {
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
});
