import { describe, it, expect } from "vitest";
import * as fs from "fs";

const SOURCE_PATH = "server/competitive-intelligence/data-acquisition.ts";

function readSource(): string {
  return fs.readFileSync(SOURCE_PATH, "utf-8");
}

function getCleanupBody(): string {
  const source = readSource();
  const fnStart = source.indexOf("export async function cleanupExpiredSyntheticComments");
  const fnEnd = source.indexOf("\nexport ", fnStart + 1);
  return source.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 6000);
}

function getEnrichBody(): string {
  const source = readSource();
  const fnStart = source.indexOf("export async function enrichCompetitorWithComments");
  const fnEnd = source.indexOf("\nexport ", fnStart + 1);
  return source.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 5000);
}

describe("Synthetic Comment Lifecycle — Deep Pass Integrity", () => {

  describe("Section 1: Retention Window Enforcement", () => {

    it("1.1) SYNTHETIC_RETENTION_DAYS constant is exported and > 0", () => {
      const source = readSource();
      expect(source).toContain("export const SYNTHETIC_RETENTION_DAYS");
      const match = source.match(/SYNTHETIC_RETENTION_DAYS\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const days = parseInt(match![1]);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(90);
    });

    it("1.2) cleanupExpiredSyntheticComments uses cutoff based on SYNTHETIC_RETENTION_DAYS", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("SYNTHETIC_RETENTION_DAYS");
      expect(fnBody).toContain("cutoffDate");
    });

    it("1.3) Cleanup DELETE targets only isSynthetic=true AND expired comments", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("is_synthetic = true");
      expect(fnBody).toContain("created_at");
      expect(fnBody).toContain("cutoffDate");
    });

    it("1.4) Cleanup only deletes synthetic comments, never real ones", () => {
      const fnBody = getCleanupBody();
      const deleteSection = fnBody.slice(fnBody.indexOf("DELETE"), fnBody.indexOf("DELETE") + 200);
      expect(deleteSection).toContain("is_synthetic = true");
      expect(deleteSection).not.toContain("is_synthetic = false");
    });

    it("1.5) Cleanup returns structured result with deleted count, affected competitors, re-enriched count, and diagnostics", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("deleted: number");
      expect(fnBody).toContain("competitorsAffected: string[]");
      expect(fnBody).toContain("reEnriched: number");
      expect(fnBody).toContain("diagnostics: SyntheticLifecycleDiagnostics");
    });

    it("1.6) No-op when no expired synthetic comments exist (returns zeros)", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("deleted: 0");
      expect(fnBody).toContain("competitorsAffected: []");
      expect(fnBody).toContain("reEnriched: 0");
    });
  });

  describe("Section 2: Real Comment Protection", () => {

    it("2.1) isSynthetic column exists in schema with NOT NULL default false", () => {
      const schema = fs.readFileSync("shared/schema.ts", "utf-8");
      const commentTable = schema.slice(
        schema.indexOf("ciCompetitorComments = pgTable"),
        schema.indexOf("ciCompetitorComments = pgTable") + 600
      );
      expect(commentTable).toContain("isSynthetic");
      expect(commentTable).toContain("is_synthetic");
      expect(commentTable).toContain(".notNull()");
      expect(commentTable).toContain(".default(false)");
    });

    it("2.2) source column exists in schema with default 'scraped'", () => {
      const schema = fs.readFileSync("shared/schema.ts", "utf-8");
      const commentTable = schema.slice(
        schema.indexOf("ciCompetitorComments = pgTable"),
        schema.indexOf("ciCompetitorComments = pgTable") + 600
      );
      expect(commentTable).toContain("source");
      expect(commentTable).toContain('"scraped"');
    });

    it("2.3) All synthetic comment inserts set isSynthetic=true and source='synthetic_enrichment'", () => {
      const source = readSource();
      const insertBlocks = source.split("commentInserts.push({");
      const insertCount = insertBlocks.length - 1;
      expect(insertCount).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < insertBlocks.length; i++) {
        const block = insertBlocks[i].slice(0, 400);
        expect(block).toContain("isSynthetic: true");
        expect(block).toContain('source: "synthetic_enrichment"');
      }
    });

    it("2.4) generateSyntheticCommentSamples prefixes ALL comments with [synthetic] or [synthetic-]", () => {
      const source = readSource();
      const fnStart = source.indexOf("function generateSyntheticCommentSamples");
      const fnEnd = source.indexOf("\n}", fnStart + 100);
      const fnBody = source.slice(fnStart, fnEnd + 2);
      expect(fnBody).toContain("[synthetic]");
      expect(fnBody).toContain("[synthetic-");
      const pushCount = (fnBody.match(/samples\.push/g) || []).length;
      expect(pushCount).toBeGreaterThanOrEqual(3);
      const textAssignments = fnBody.match(/text:\s*[`"'][^`"']*|text:\s*prefixed/g) || [];
      for (const ta of textAssignments) {
        const hasPrefix = ta.includes("[synthetic") || ta.includes("prefixed");
        expect(hasPrefix).toBe(true);
      }
    });

    it("2.5) Audience engine filters synthetic at DB level (isSynthetic=false)", () => {
      const engine = fs.readFileSync("server/audience-engine/engine.ts", "utf-8");
      expect(engine).toContain("isSynthetic");
      const querySection = engine.slice(engine.indexOf(".from(ciCompetitorComments)") - 200, engine.indexOf(".from(ciCompetitorComments)") + 300);
      expect(querySection).toContain("isSynthetic");
      expect(querySection).toContain("false");
    });

    it("2.6) Audience engine ALSO filters synthetic at text level via SYNTHETIC_FILTERS", () => {
      const engine = fs.readFileSync("server/audience-engine/engine.ts", "utf-8");
      expect(engine).toContain("sanitizeTexts");
      expect(engine).toContain("SYNTHETIC_FILTERS");
      const constants = fs.readFileSync("server/audience-engine/constants.ts", "utf-8");
      expect(constants).toContain("SYNTHETIC_FILTERS");
      expect(constants).toContain('"synthetic"');
      expect(constants).toContain('"[synthetic-"');
    });
  });

  describe("Section 3: Deep Pass Re-Enrichment After Cleanup", () => {

    it("3.1) Cleanup checks remaining comment count per competitor after deletion", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("remaining");
      expect(fnBody).toContain("MIN_COMMENTS_THRESHOLD");
    });

    it("3.2) Cleanup calls enrichCompetitorWithComments when below threshold", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("enrichCompetitorWithComments");
    });

    it("3.3) Cleanup demotes to FAST_PASS when no posts exist for re-enrichment", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("FAST_PASS");
      expect(fnBody).toContain("Demoted");
    });

    it("3.4) enrichCompetitorWithComments skips when already enriched (idempotent)", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("ALREADY_ENRICHED");
      expect(fnBody).toContain("MIN_COMMENTS_THRESHOLD");
    });

    it("3.5) enrichCompetitorWithComments only promotes to DEEP_PASS when threshold met", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("DEEP_PASS");
      expect(fnBody).toContain("FAST_PASS");
      expect(fnBody).toContain("coverageMet");
    });

    it("3.6) enrichCompetitorWithComments avoids duplicate comments for same posts", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("existingPostIdsWithComments");
      expect(fnBody).toContain("postsNeedingComments");
    });
  });

  describe("Section 4: Orphaned Comment Detection", () => {

    it("4.1) Cleanup checks for orphaned comment references (no matching competitor)", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("orphan");
      expect(fnBody).toContain("LEFT JOIN ci_competitors");
      expect(fnBody).toContain("WHERE c.id IS NULL");
    });

    it("4.2) Cleanup removes orphaned comments when found", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("NOT IN (SELECT id FROM ci_competitors)");
      expect(fnBody).toContain("orphanCount");
    });

    it("4.3) Cleanup logs orphan removal count", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("[SyntheticCleanup] Removed");
      expect(fnBody).toContain("orphaned comment references");
    });
  });

  describe("Section 5: Startup Integration", () => {

    it("5.1) cleanupExpiredSyntheticComments is imported in fetch-orchestrator", () => {
      const orch = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      expect(orch).toContain("cleanupExpiredSyntheticComments");
    });

    it("5.2) Cleanup runs on a delayed timer after server start", () => {
      const orch = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      const startFn = orch.slice(orch.indexOf("export function startQueueProcessor"), orch.indexOf("export function startQueueProcessor") + 800);
      expect(startFn).toContain("cleanupExpiredSyntheticComments");
      expect(startFn).toContain("setTimeout");
      expect(startFn).toContain("SyntheticLifecycle");
    });

    it("5.3) Cleanup runs AFTER Deep Pass recovery (higher timeout)", () => {
      const orch = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      const startFn = orch.slice(orch.indexOf("export function startQueueProcessor"), orch.indexOf("export function stopQueueProcessor"));
      const recoveryMatch = startFn.match(/setTimeout\(\(\)\s*=>\s*recoverStuckDeepPass\(\),\s*(\d+)\)/);
      expect(recoveryMatch).not.toBeNull();
      const recoveryDelay = parseInt(recoveryMatch![1]);
      const allTimeouts = [...startFn.matchAll(/setTimeout\([\s\S]*?,\s*(\d+)\s*\)/g)];
      expect(allTimeouts.length).toBeGreaterThanOrEqual(2);
      const cleanupPos = startFn.indexOf("cleanupExpiredSyntheticComments");
      expect(cleanupPos).toBeGreaterThan(-1);
      let cleanupDelay = 0;
      for (const m of allTimeouts) {
        const blockStart = m.index!;
        const blockEnd = blockStart + m[0].length;
        if (cleanupPos > blockStart && cleanupPos < blockEnd + 200) {
          cleanupDelay = parseInt(m[1]);
        }
      }
      expect(cleanupDelay).toBeGreaterThan(recoveryDelay);
    });
  });

  describe("Section 6: Data Integrity Invariants", () => {

    it("6.1) getCompetitorDataCoverage returns real and synthetic counts separately", () => {
      const source = readSource();
      const fnStart = source.indexOf("export async function getCompetitorDataCoverage");
      const fnBody = source.slice(fnStart, fnStart + 2000);
      expect(fnBody).toContain("realCommentsCount");
      expect(fnBody).toContain("syntheticCommentsCount");
      expect(fnBody).toContain("isSynthetic");
    });

    it("6.2) getCompetitorDataCoverage computes freshness from post timestamps (not lastFetchAt)", () => {
      const source = readSource();
      const fnStart = source.indexOf("export async function getCompetitorDataCoverage");
      const fnBody = source.slice(fnStart, fnStart + 2000);
      expect(fnBody).toContain("newestPost");
      expect(fnBody).toContain("ciCompetitorPosts.timestamp");
    });

    it("6.3) Frontend displays real vs enriched comment counts", () => {
      const ui = fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8");
      expect(ui).toContain("realCommentsCount");
      expect(ui).toContain("syntheticCommentsCount");
      expect(ui).toContain("real / enriched");
    });

    it("6.4) MI snapshot freshness uses computeDataFreshnessDays exclusively", () => {
      const orch = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      const fnStart = orch.indexOf("async function persistSnapshotAfterFetch");
      const fnBody = orch.slice(fnStart, fnStart + 3000);
      expect(fnBody).toContain("computeDataFreshnessDays(competitorInputs)");
      const freshAssignments = fnBody.match(/dataFreshnessDays\s*=/g) || [];
      expect(freshAssignments.length).toBe(1);
    });

    it("6.5) Confidence calculation uses separate variable from persisted freshness", () => {
      const orch = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      const fnStart = orch.indexOf("async function persistSnapshotAfterFetch");
      const fnBody = orch.slice(fnStart, fnStart + 3000);
      expect(fnBody).toContain("confidenceFreshnessDays");
      expect(fnBody).toContain("computeConfidence(signalResults, confidenceFreshnessDays)");
    });

    it("6.6) Only 2 comment insert paths exist in the system", () => {
      const source = readSource();
      const insertMatches = source.match(/tx\.insert\(ciCompetitorComments\)/g) || [];
      expect(insertMatches.length).toBe(2);
    });

    it("6.7) Both insert paths set isSynthetic=true and source='synthetic_enrichment'", () => {
      const source = readSource();
      const insertBlocks = source.split("tx.insert(ciCompetitorComments)");
      expect(insertBlocks.length).toBe(3);
      for (let i = 1; i < insertBlocks.length; i++) {
        const context = source.slice(
          source.indexOf("tx.insert(ciCompetitorComments)", source.indexOf("tx.insert(ciCompetitorComments)") + (i - 1) * 100) - 300,
          source.indexOf("tx.insert(ciCompetitorComments)", source.indexOf("tx.insert(ciCompetitorComments)") + (i - 1) * 100) + 100
        );
        const pushBlock = source.slice(
          source.indexOf("commentInserts.push({", source.indexOf("tx.insert(ciCompetitorComments)") - 1000 + (i - 1) * 2000),
          source.indexOf("commentInserts.push({", source.indexOf("tx.insert(ciCompetitorComments)") - 1000 + (i - 1) * 2000) + 400
        );
        expect(pushBlock).toContain("isSynthetic: true");
        expect(pushBlock).toContain('source: "synthetic_enrichment"');
      }
    });
  });

  describe("Section 7: Synthetic Churn Prevention", () => {

    it("7.1) SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS constant is exported (3-7 day range)", () => {
      const source = readSource();
      expect(source).toContain("export const SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS");
      const match = source.match(/SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS\s*=\s*(\d+)/);
      expect(match).not.toBeNull();
      const days = parseInt(match![1]);
      expect(days).toBeGreaterThanOrEqual(3);
      expect(days).toBeLessThanOrEqual(7);
    });

    it("7.2) SYNTHETIC_CHURN_WINDOW_DAYS and SYNTHETIC_CHURN_THRESHOLD constants are exported", () => {
      const source = readSource();
      expect(source).toContain("export const SYNTHETIC_CHURN_WINDOW_DAYS");
      expect(source).toContain("export const SYNTHETIC_CHURN_THRESHOLD");
      const windowMatch = source.match(/SYNTHETIC_CHURN_WINDOW_DAYS\s*=\s*(\d+)/);
      const thresholdMatch = source.match(/SYNTHETIC_CHURN_THRESHOLD\s*=\s*(\d+)/);
      expect(windowMatch).not.toBeNull();
      expect(thresholdMatch).not.toBeNull();
      expect(parseInt(windowMatch![1])).toBeGreaterThanOrEqual(7);
      expect(parseInt(thresholdMatch![1])).toBeGreaterThanOrEqual(2);
    });

    it("7.3) isSyntheticCooldownActive function exists and checks lastSyntheticEnrichmentAt", () => {
      const source = readSource();
      expect(source).toContain("function isSyntheticCooldownActive");
      expect(source).toContain("SYNTHETIC_ENRICHMENT_COOLDOWN_DAYS");
      const fnStart = source.indexOf("function isSyntheticCooldownActive");
      const fnBody = source.slice(fnStart, fnStart + 300);
      expect(fnBody).toContain("daysSinceEnrichment");
    });

    it("7.4) enrichCompetitorWithComments enforces cooldown before regeneration", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("isSyntheticCooldownActive");
      expect(fnBody).toContain("COOLDOWN_ACTIVE");
      expect(fnBody).toContain("lastSyntheticEnrichmentAt");
    });

    it("7.5) enrichCompetitorWithComments checks real data sufficiency before synthetic generation", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("REAL_DATA_SUFFICIENT");
      expect(fnBody).toContain("isSynthetic, false");
      const realCheckIdx = fnBody.indexOf("REAL_DATA_SUFFICIENT");
      const alreadyEnrichedIdx = fnBody.indexOf("ALREADY_ENRICHED");
      expect(realCheckIdx).toBeLessThan(alreadyEnrichedIdx);
    });

    it("7.6) enrichCompetitorWithComments records lastSyntheticEnrichmentAt on successful enrichment", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("lastSyntheticEnrichmentAt: new Date()");
      expect(fnBody).toContain("syntheticEnrichmentCount:");
    });

    it("7.7) detectHighSyntheticChurn function uses lastSyntheticEnrichmentAt for rolling window", () => {
      const source = readSource();
      expect(source).toContain("function detectHighSyntheticChurn");
      const fnStart = source.indexOf("function detectHighSyntheticChurn");
      const fnBody = source.slice(fnStart, fnStart + 600);
      expect(fnBody).toContain("SYNTHETIC_CHURN_WINDOW_DAYS");
      expect(fnBody).toContain("SYNTHETIC_CHURN_THRESHOLD");
      expect(fnBody).toContain("lastSyntheticEnrichmentAt");
      expect(fnBody).not.toContain("createdAt: Date");
    });

    it("7.8) enrichCompetitorWithComments flags HIGH_SYNTHETIC_CHURN when churn detected", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("HIGH_SYNTHETIC_CHURN");
      expect(fnBody).toContain("detectHighSyntheticChurn");
      expect(fnBody).toContain("syntheticChurnFlag");
      expect(fnBody).toContain("CHURN_WARNING");
    });

    it("7.9) Schema has lastSyntheticEnrichmentAt, syntheticEnrichmentCount, and syntheticChurnFlag columns", () => {
      const schema = fs.readFileSync("shared/schema.ts", "utf-8");
      const competitorTable = schema.slice(
        schema.indexOf("ciCompetitors = pgTable"),
        schema.indexOf("ciCompetitors = pgTable") + 1500
      );
      expect(competitorTable).toContain("lastSyntheticEnrichmentAt");
      expect(competitorTable).toContain("last_synthetic_enrichment_at");
      expect(competitorTable).toContain("syntheticEnrichmentCount");
      expect(competitorTable).toContain("synthetic_enrichment_count");
      expect(competitorTable).toContain("syntheticChurnFlag");
      expect(competitorTable).toContain("synthetic_churn_flag");
    });

    it("7.10) Cleanup checks real comment sufficiency before re-enrichment", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("realComments >= MIN_COMMENTS_THRESHOLD");
      expect(fnBody).toContain("real comments");
      expect(fnBody).toContain("no re-enrichment needed");
    });

    it("7.11) Cleanup respects cooldown — skips re-enrichment when cooldown active", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("isSyntheticCooldownActive");
      expect(fnBody).toContain("cooldown active");
      expect(fnBody).toContain("cooldownBlockedCount");
    });

    it("7.12) SyntheticLifecycleDiagnostics interface includes all required fields", () => {
      const source = readSource();
      expect(source).toContain("export interface SyntheticLifecycleDiagnostics");
      const ifaceStart = source.indexOf("export interface SyntheticLifecycleDiagnostics");
      const ifaceBody = source.slice(ifaceStart, ifaceStart + 600);
      expect(ifaceBody).toContain("syntheticGeneratedCount");
      expect(ifaceBody).toContain("syntheticExpiredCount");
      expect(ifaceBody).toContain("syntheticRegeneratedCount");
      expect(ifaceBody).toContain("competitorsReEnriched");
      expect(ifaceBody).toContain("highChurnCompetitors");
      expect(ifaceBody).toContain("cooldownBlockedCount");
      expect(ifaceBody).toContain("realDataSufficientCount");
      expect(ifaceBody).toContain("averageDaysBetweenSyntheticRegeneration");
    });

    it("7.13) Cleanup logs structured diagnostics summary", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("[SyntheticCleanup] Diagnostics:");
      expect(fnBody).toContain("expired=");
      expect(fnBody).toContain("cooldownBlocked=");
      expect(fnBody).toContain("realSufficient=");
      expect(fnBody).toContain("highChurn=");
    });

    it("7.14) Cleanup queries HIGH_SYNTHETIC_CHURN flagged competitors for diagnostics", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("HIGH_SYNTHETIC_CHURN");
      expect(fnBody).toContain("highChurnCompetitors");
      expect(fnBody).toContain("syntheticChurnFlag");
    });

    it("7.15) enrichCompetitorWithComments accepts skipCooldown option for initial Deep Pass recovery", () => {
      const fnBody = getEnrichBody();
      expect(fnBody).toContain("skipCooldown");
      expect(fnBody).toContain("options?.skipCooldown");
    });

    it("7.16) Cleanup skips inactive competitors during re-enrichment evaluation", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("isActive");
    });

    it("7.17) Cleanup computes averageDaysBetweenSyntheticRegeneration from enrichment history", () => {
      const fnBody = getCleanupBody();
      expect(fnBody).toContain("averageDaysBetweenSyntheticRegeneration");
      expect(fnBody).toContain("syntheticEnrichmentCount");
      expect(fnBody).toContain("totalAvgDays");
    });

    it("7.18) No automatic re-enrichment when real data now sufficient after cleanup", () => {
      const fnBody = getCleanupBody();
      const realCheckIdx = fnBody.indexOf("realComments >= MIN_COMMENTS_THRESHOLD");
      const enrichCallIdx = fnBody.indexOf("enrichCompetitorWithComments(competitorId");
      expect(realCheckIdx).toBeGreaterThan(-1);
      expect(enrichCallIdx).toBeGreaterThan(-1);
      expect(realCheckIdx).toBeLessThan(enrichCallIdx);
    });
  });
});
