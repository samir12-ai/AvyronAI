import { describe, it, expect } from "vitest";
import { computePostRunProjections } from "./index";

describe("computePostRunProjections", () => {
  it("returns skipped recoveryEnrichment when no controlVerdict.recoveryPlan present", async () => {
    const out = await computePostRunProjections({
      campaignId: "c1",
      accountId: "a1",
      ssc: null,
      confidenceProvenanceLog: [],
      results: new Map() as any,
      controlVerdict: null,
    });
    expect(out.recoveryEnrichment.status).toBe("skipped");
    expect(out.recoveryEnrichment.skipReason).toBe("no_recovery_plan_to_enrich");
  });

  it("returns ok for recoveryEnrichment when controlVerdict.recoveryPlan.intelligence is set", async () => {
    const out = await computePostRunProjections({
      campaignId: "c1",
      accountId: "a1",
      ssc: null,
      confidenceProvenanceLog: [],
      results: new Map() as any,
      controlVerdict: { recoveryPlan: { intelligence: { commercialDisease: "x" } } },
    });
    expect(out.recoveryEnrichment.status).toBe("ok");
  });

  it("returns failed for recoveryEnrichment when recoveryPlan exists but has no intelligence overlay", async () => {
    const out = await computePostRunProjections({
      campaignId: "c1",
      accountId: "a1",
      ssc: null,
      confidenceProvenanceLog: [],
      results: new Map() as any,
      controlVerdict: { recoveryPlan: { issues: [] } },
    });
    expect(out.recoveryEnrichment.status).toBe("failed");
    expect(out.recoveryEnrichment.error).toBe("recovery_plan_present_but_not_enriched");
  });

  it("computes commercialDna ok for empty signals", async () => {
    const out = await computePostRunProjections({
      campaignId: "c1",
      accountId: "a1",
      ssc: { commercialSignals: null } as any,
      confidenceProvenanceLog: [],
      results: new Map() as any,
      controlVerdict: null,
    });
    expect(out.commercialDna.status).toBe("ok");
  });

  it("reuses prevConfidenceSummary when present", async () => {
    const prev = {
      verdict: "PASS",
      totalEngines: 1,
      criticalAbsentEngines: [],
      byProvenance: {
        direct_evidence: 1,
        inferred_synthesis: 0,
        default_floor: 0,
        absent: 0,
      },
      defaultFloorEngines: [],
      inferredSynthesisEngines: [],
    } as any;
    const out = await computePostRunProjections({
      campaignId: "c1",
      accountId: "a1",
      ssc: null,
      confidenceProvenanceLog: [],
      prevConfidenceSummary: prev,
      results: new Map() as any,
      controlVerdict: null,
    });
    expect(out.confidenceIntegrity.value).toBe(prev);
  });
});
