import { describe, it, expect } from "vitest";
import { computeDataFreshnessDays } from "../market-intelligence-v3/engine";
import {
  verifySnapshotIntegrity,
  getEngineReadinessState,
  checkMIDependencyForDownstream,
} from "../market-intelligence-v3/engine-state";
import type { CompetitorInput } from "../market-intelligence-v3/types";
import { ENGINE_VERSION } from "../market-intelligence-v3/constants";

function makeCompetitor(posts: { timestamp: string }[], comments: { timestamp: string }[] = []): CompetitorInput {
  return {
    id: "test-comp-1",
    name: "Test Competitor",
    platform: "instagram",
    profileLink: "https://instagram.com/test",
    businessType: "fitness",
    postingFrequency: 3,
    contentTypeRatio: null,
    engagementRatio: 0.05,
    ctaPatterns: null,
    discountFrequency: null,
    hookStyles: null,
    messagingTone: null,
    socialProofPresence: null,
    posts: posts.map((p, i) => ({
      id: `post-${i}`,
      caption: "test",
      likes: 10,
      comments: 2,
      mediaType: "IMAGE",
      hashtags: [],
      timestamp: p.timestamp,
      hasCTA: false,
      hasOffer: false,
    })),
    comments: comments.map((c, i) => ({
      id: `comment-${i}`,
      text: "test comment",
      timestamp: c.timestamp,
    })),
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("computeDataFreshnessDays", () => {
  it("returns 999 for empty competitors", () => {
    expect(computeDataFreshnessDays([])).toBe(999);
  });

  it("returns 999 for competitors with no posts", () => {
    const comp = makeCompetitor([]);
    expect(computeDataFreshnessDays([comp])).toBe(999);
  });

  it("uses newest post timestamp, not oldest", () => {
    const comp = makeCompetitor([
      { timestamp: daysAgo(100) },
      { timestamp: daysAgo(2) },
      { timestamp: daysAgo(50) },
    ]);
    const result = computeDataFreshnessDays([comp]);
    expect(result).toBeLessThanOrEqual(3);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("considers comment timestamps in freshness calculation", () => {
    const comp = makeCompetitor(
      [{ timestamp: daysAgo(30) }],
      [{ timestamp: daysAgo(1) }]
    );
    const result = computeDataFreshnessDays([comp]);
    expect(result).toBeLessThanOrEqual(2);
  });

  it("picks freshest signal across multiple competitors", () => {
    const comp1 = makeCompetitor([{ timestamp: daysAgo(20) }]);
    const comp2 = makeCompetitor([{ timestamp: daysAgo(3) }]);
    const result = computeDataFreshnessDays([comp1, comp2]);
    expect(result).toBeLessThanOrEqual(4);
  });

  it("anomaly guard triggers when >365 days but recent signals exist", () => {
    const comp = makeCompetitor([
      { timestamp: daysAgo(800) },
      { timestamp: daysAgo(5) },
    ]);
    const result = computeDataFreshnessDays([comp]);
    expect(result).toBeLessThanOrEqual(6);
    expect(result).not.toBeGreaterThan(365);
  });

  it("returns actual days when all posts are truly old (>365d, no recent signals)", () => {
    const comp = makeCompetitor([
      { timestamp: daysAgo(400) },
      { timestamp: daysAgo(500) },
    ]);
    const result = computeDataFreshnessDays([comp]);
    expect(result).toBe(400);
  });

  it("handles invalid timestamps gracefully", () => {
    const comp = makeCompetitor([
      { timestamp: "invalid-date" },
      { timestamp: daysAgo(5) },
    ]);
    const result = computeDataFreshnessDays([comp]);
    expect(result).toBeLessThanOrEqual(6);
  });

  it("prevents future timestamps from producing negative freshness", () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const comp = makeCompetitor([{ timestamp: futureDate }]);
    const result = computeDataFreshnessDays([comp]);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe("verifySnapshotIntegrity", () => {
  const validSnapshot = {
    id: "ad2d651a-1271-4a11-b9b7-031f5be03b4a",
    createdAt: new Date().toISOString(),
    campaignId: "campaign_test_123",
    analysisVersion: ENGINE_VERSION,
    analysisOutput: { confidence: { overall: 0.8 } },
  };

  it("passes for valid snapshot", () => {
    const result = verifySnapshotIntegrity(validSnapshot, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("fails for null snapshot", () => {
    const result = verifySnapshotIntegrity(null, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(false);
    expect(result.failures).toContain("snapshot is null or undefined");
  });

  it("fails for invalid UUID", () => {
    const bad = { ...validSnapshot, id: "not-a-uuid" };
    const result = verifySnapshotIntegrity(bad, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes("invalid snapshot.id"))).toBe(true);
  });

  it("fails for missing createdAt", () => {
    const bad = { ...validSnapshot, createdAt: null };
    const result = verifySnapshotIntegrity(bad, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes("missing snapshot.createdAt"))).toBe(true);
  });

  it("fails for campaignId mismatch", () => {
    const result = verifySnapshotIntegrity(validSnapshot, ENGINE_VERSION, "wrong_campaign");
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes("campaignId mismatch"))).toBe(true);
  });

  it("fails for version mismatch", () => {
    const result = verifySnapshotIntegrity(validSnapshot, ENGINE_VERSION + 1, "campaign_test_123");
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes("version mismatch"))).toBe(true);
  });

  it("fails for empty output", () => {
    const bad = { ...validSnapshot, analysisOutput: null, signalData: null, confidenceData: null, marketState: null };
    const result = verifySnapshotIntegrity(bad, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(false);
    expect(result.failures.some(f => f.includes("output payload missing or empty"))).toBe(true);
  });

  it("passes when DB-format fields are present (signalData/marketState)", () => {
    const dbFormat = {
      id: "ad2d651a-1271-4a11-b9b7-031f5be03b4a",
      createdAt: new Date().toISOString(),
      campaignId: "campaign_test_123",
      analysisVersion: ENGINE_VERSION,
      signalData: "{}",
      marketState: "STABLE",
    };
    const result = verifySnapshotIntegrity(dbFormat, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(true);
  });

  it("accumulates multiple failures", () => {
    const bad = { id: "bad", createdAt: null, campaignId: "wrong", analysisVersion: 0, analysisOutput: null };
    const result = verifySnapshotIntegrity(bad, ENGINE_VERSION, "campaign_test_123");
    expect(result.valid).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });
});

describe("getEngineReadinessState", () => {
  const validSnapshot = {
    id: "ad2d651a-1271-4a11-b9b7-031f5be03b4a",
    createdAt: new Date().toISOString(),
    campaignId: "campaign_test_123",
    analysisVersion: ENGINE_VERSION,
    analysisOutput: { confidence: { overall: 0.8 } },
    dataFreshnessDays: 4,
  };

  it("returns READY for valid, fresh snapshot", () => {
    const result = getEngineReadinessState(validSnapshot, "campaign_test_123");
    expect(result.state).toBe("READY");
    expect(result.diagnostics.snapshotFound).toBe(true);
    expect(result.diagnostics.freshnessValid).toBe(true);
    expect(result.diagnostics.integrityValid).toBe(true);
    expect(result.diagnostics.engineState).toBe("READY");
  });

  it("returns REFRESH_REQUIRED for null snapshot", () => {
    const result = getEngineReadinessState(null, "campaign_test_123");
    expect(result.state).toBe("REFRESH_REQUIRED");
    expect(result.diagnostics.snapshotFound).toBe(false);
  });

  it("returns REFRESH_REQUIRED for stale data", () => {
    const stale = { ...validSnapshot, dataFreshnessDays: 20 };
    const result = getEngineReadinessState(stale, "campaign_test_123");
    expect(result.state).toBe("REFRESH_REQUIRED");
    expect(result.diagnostics.freshnessValid).toBe(false);
  });

  it("returns REFRESH_REQUIRED for version mismatch", () => {
    const oldVersion = { ...validSnapshot, analysisVersion: ENGINE_VERSION - 1 };
    const result = getEngineReadinessState(oldVersion, "campaign_test_123");
    expect(result.state).toBe("REFRESH_REQUIRED");
  });

  it("returns REFRESH_REQUIRED for campaign mismatch", () => {
    const result = getEngineReadinessState(validSnapshot, "wrong_campaign");
    expect(result.state).toBe("REFRESH_REQUIRED");
  });

  it("returns BLOCKED for missing output", () => {
    const noOutput = { ...validSnapshot, analysisOutput: null };
    const result = getEngineReadinessState(noOutput, "campaign_test_123");
    expect(result.state).toBe("BLOCKED");
  });

  it("diagnostics include all fields", () => {
    const result = getEngineReadinessState(validSnapshot, "campaign_test_123");
    const d = result.diagnostics;
    expect(d).toHaveProperty("snapshotFound");
    expect(d).toHaveProperty("snapshotId");
    expect(d).toHaveProperty("campaignIdMatch");
    expect(d).toHaveProperty("versionMatch");
    expect(d).toHaveProperty("freshnessValid");
    expect(d).toHaveProperty("freshnessDays");
    expect(d).toHaveProperty("integrityValid");
    expect(d).toHaveProperty("integrityFailures");
    expect(d).toHaveProperty("engineState");
  });
});

describe("checkMIDependencyForDownstream", () => {
  const validSnapshot = {
    id: "ad2d651a-1271-4a11-b9b7-031f5be03b4a",
    createdAt: new Date().toISOString(),
    campaignId: "campaign_test_123",
    analysisVersion: ENGINE_VERSION,
    analysisOutput: { confidence: { overall: 0.8 } },
    dataFreshnessDays: 4,
  };

  it("returns ready=true for valid MI snapshot", () => {
    const result = checkMIDependencyForDownstream(validSnapshot, "campaign_test_123");
    expect(result.ready).toBe(true);
    expect(result.state).toBe("READY");
  });

  it("returns ready=false for stale MI snapshot", () => {
    const stale = { ...validSnapshot, dataFreshnessDays: 20 };
    const result = checkMIDependencyForDownstream(stale, "campaign_test_123");
    expect(result.ready).toBe(false);
    expect(result.state).toBe("REFRESH_REQUIRED");
  });

  it("returns ready=false for null snapshot", () => {
    const result = checkMIDependencyForDownstream(null, "campaign_test_123");
    expect(result.ready).toBe(false);
    expect(result.state).toBe("REFRESH_REQUIRED");
  });

  it("returns ready=false for campaign mismatch", () => {
    const result = checkMIDependencyForDownstream(validSnapshot, "wrong_campaign");
    expect(result.ready).toBe(false);
  });
});

describe("Strategic Gate ↔ MI v3 regression tests", () => {
  const validSnapshot = {
    id: "ad2d651a-1271-4a11-b9b7-031f5be03b4a",
    createdAt: new Date().toISOString(),
    campaignId: "campaign_gate_test",
    analysisVersion: ENGINE_VERSION,
    analysisOutput: { confidence: { overall: 0.8 } },
    signalData: "{}",
    dataFreshnessDays: 4,
  };

  it("gate passes when MI snapshot is valid and fresh", () => {
    const result = getEngineReadinessState(validSnapshot, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).toBe("READY");
    expect(result.diagnostics.integrityValid).toBe(true);
    expect(result.diagnostics.freshnessValid).toBe(true);
    expect(result.diagnostics.campaignIdMatch).toBe(true);
  });

  it("gate blocks when MI snapshot is missing", () => {
    const result = getEngineReadinessState(null, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).not.toBe("READY");
    expect(result.diagnostics.snapshotFound).toBe(false);
  });

  it("gate blocks when MI data is stale (>14 days)", () => {
    const stale = { ...validSnapshot, dataFreshnessDays: 16 };
    const result = getEngineReadinessState(stale, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).not.toBe("READY");
    expect(result.diagnostics.freshnessValid).toBe(false);
  });

  it("gate blocks on campaign mismatch — prevents cross-campaign snapshot use", () => {
    const result = getEngineReadinessState(validSnapshot, "different_campaign", ENGINE_VERSION, 14);
    expect(result.state).not.toBe("READY");
    expect(result.diagnostics.campaignIdMatch).toBe(false);
  });

  it("gate blocks on engine version mismatch — snapshot compatibility guard", () => {
    const outdated = { ...validSnapshot, analysisVersion: ENGINE_VERSION - 1 };
    const result = getEngineReadinessState(outdated, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).not.toBe("READY");
    expect(result.diagnostics.versionMatch).toBe(false);
  });

  it("gate blocks on future engine version — forward compatibility guard", () => {
    const futureVersion = { ...validSnapshot, analysisVersion: ENGINE_VERSION + 5 };
    const result = getEngineReadinessState(futureVersion, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).not.toBe("READY");
    expect(result.diagnostics.versionMatch).toBe(false);
  });

  it("gate blocks when output is missing — integrity failure", () => {
    const noOutput = { ...validSnapshot, analysisOutput: null, signalData: null, confidenceData: null, marketState: null };
    const result = getEngineReadinessState(noOutput, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).toBe("BLOCKED");
    expect(result.diagnostics.integrityValid).toBe(false);
  });

  it("diagnostics always surface failure reasons for transparency", () => {
    const bad = {
      id: "not-a-uuid",
      createdAt: null,
      campaignId: "wrong",
      analysisVersion: 0,
      analysisOutput: null,
      signalData: null,
    };
    const result = getEngineReadinessState(bad, "campaign_gate_test", ENGINE_VERSION, 14);
    expect(result.state).not.toBe("READY");
    expect(result.diagnostics.integrityFailures.length).toBeGreaterThan(0);
  });
});
