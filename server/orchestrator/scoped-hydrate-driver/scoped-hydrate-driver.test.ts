import { describe, it, expect } from "vitest";
import {
  parseAudienceSnapshotRow,
  parseMiSnapshotRow,
  buildScopedHydrationOutcome,
} from "./index";

describe("scoped-hydrate-driver", () => {
  describe("parseAudienceSnapshotRow", () => {
    it("returns null for zero-signal rows", () => {
      const row: any = {
        id: "snap1",
        structuredSignals: JSON.stringify({
          pain_clusters: [],
          desire_clusters: [],
          pattern_clusters: [],
          root_causes: [],
          psychological_drivers: [],
        }),
        audiencePains: "[]",
        desireMap: "[]",
        objectionMap: "[]",
        transformationMap: "[]",
        emotionalDrivers: "[]",
        audienceSegments: "[]",
        segmentDensity: "[]",
        awarenessLevel: "{}",
        maturityIndex: "{}",
        audienceIntentDistribution: "{}",
        inputSummary: "{}",
      };
      expect(parseAudienceSnapshotRow(row)).toBeNull();
    });

    it("parses a non-zero row into canonical seed + counts signals", () => {
      const row: any = {
        id: "snap2",
        structuredSignals: JSON.stringify({
          pain_clusters: [1, 2],
          desire_clusters: [1],
          pattern_clusters: [],
          root_causes: [],
          psychological_drivers: [1],
        }),
        audiencePains: "[]",
        desireMap: "[]",
        objectionMap: JSON.stringify([{ label: "price", confidence: 0.8, evidence: ["e1"] }]),
        transformationMap: "[]",
        emotionalDrivers: "[]",
        audienceSegments: "[]",
        segmentDensity: "[]",
        awarenessLevel: "{}",
        maturityIndex: "{}",
        audienceIntentDistribution: "{}",
        inputSummary: "{}",
      };
      const parsed = parseAudienceSnapshotRow(row);
      expect(parsed?.snapshotId).toBe("snap2");
      expect(parsed?.signalCount).toBe(4);
      expect(parsed?.rawObjectionsForSgl).toEqual([
        { label: "price", confidence: 0.8, evidence: ["e1"] },
      ]);
    });

    it("falls back through label aliases (canonical → pain → signal) for objection rows", () => {
      const row: any = {
        id: "snap3",
        structuredSignals: JSON.stringify({
          pain_clusters: [1],
          desire_clusters: [],
          pattern_clusters: [],
          root_causes: [],
          psychological_drivers: [],
        }),
        audiencePains: "[]",
        desireMap: "[]",
        objectionMap: JSON.stringify([{ canonical: "trust", confidenceScore: 0.42 }]),
        transformationMap: "[]",
        emotionalDrivers: "[]",
        audienceSegments: "[]",
        segmentDensity: "[]",
        awarenessLevel: "{}",
        maturityIndex: "{}",
        audienceIntentDistribution: "{}",
        inputSummary: "{}",
      };
      const parsed = parseAudienceSnapshotRow(row);
      expect(parsed?.rawObjectionsForSgl[0]).toEqual({
        label: "trust",
        confidence: 0.42,
        evidence: [],
      });
    });
  });

  describe("parseMiSnapshotRow", () => {
    it("parses signalData and forwards snapshotId", () => {
      const row: any = {
        id: "mi1",
        signalData: JSON.stringify([{ a: 1 }]),
        multiSourceSignals: '{"x":1}',
        overallConfidence: 0.7,
      };
      const out = parseMiSnapshotRow(row);
      expect(out.snapshotId).toBe("mi1");
      expect((out.parsed as any).signals).toEqual([{ a: 1 }]);
      expect((out.parsed as any).snapshotId).toBe("mi1");
    });
  });

  describe("buildScopedHydrationOutcome", () => {
    it("flags audienceHydrated=false when audience is null", () => {
      const out = buildScopedHydrationOutcome({ audience: null, mi: null, gaps: [] });
      expect(out.audienceHydrated).toBe(false);
      expect(out.miHydrated).toBe(false);
      expect(out.gaps).toEqual([]);
    });

    it("propagates gaps as-is", () => {
      const gaps = [{ missingDependency: "audience", ctxKey: "audience" }];
      const out = buildScopedHydrationOutcome({ audience: null, mi: null, gaps });
      expect(out.gaps).toBe(gaps);
    });
  });
});
