import { describe, expect, it } from "vitest";
import {
  buildAudiencePainRegistry,
  classifyAudiencePain,
  selectPainForUse,
  validateAudiencePainRegistry,
} from "../shared/audience-pain-registry";
import { validateOfferAlignment, runOfferEngine } from "../offer-engine/engine";
import { validatePostGeneration } from "../shared/strategy-root";
import { runRetentionEngine } from "../strategy/retention-engine/engine";
import { extractAudiencePainRoles } from "../orchestrator/plan-synthesis";

const lineage = { accountId: "account-a", audienceSnapshotId: "audience-run-a" };

const differentiation = {
  pillars: [],
  mechanismFraming: { supported: false, type: "none" },
  mechanismCore: null,
  authorityMode: null,
  claimStructures: [],
  proofArchitecture: [],
  confidenceScore: null,
};

describe("authoritative Audience pain registry", () => {
  it("creates stable, ranked roles and prevents post-purchase friction becoming the offer core", () => {
    const raw = [
      { canonical: "Refund and account access friction after purchase", evidence: ["ev-refund"], classification: "POST_PURCHASE_FRICTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["retention"] },
      { canonical: "Teams struggle to produce reliable reports before the sales call", evidence: ["ev-report"], classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["positioning", "differentiation", "mechanism", "offer_core", "awareness", "funnel", "persuasion", "channel"] },
      { canonical: "Price and proof concerns delay purchase approval", evidence: ["ev-price"], classification: "OBJECTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_objection", "awareness", "funnel", "persuasion"] },
    ];
    const first = buildAudiencePainRegistry(raw, lineage);
    const second = buildAudiencePainRegistry(raw, lineage);

    expect(first.map((pain) => pain.painId)).toEqual(second.map((pain) => pain.painId));
    expect(first[0].classification).toBe("POST_PURCHASE_FRICTION");
    expect(first[0].allowedUses).toEqual(["retention"]);
    expect(selectPainForUse(first, "offer_core")?.canonical).toContain("struggle to produce");
    expect(selectPainForUse(first, "offer_objection")?.canonical).toContain("Price and proof");
  });

  it("rejects cross-account and cross-snapshot registry records", () => {
    const pains = buildAudiencePainRegistry([{ canonical: "Teams struggle with reporting" }], lineage);
    pains[0] = {
      ...pains[0],
      lineage: { ...pains[0].lineage, accountId: "other-account" },
    };
    const result = validateAudiencePainRegistry(pains, lineage);
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toContain("PAIN_LINEAGE_MISMATCH");
  });

  it("initial registry creates neutral unassessed records by default", () => {
    const neutral = buildAudiencePainRegistry([
      { canonical: "Refund friction after delivery" },
      { canonical: "Pricing proof concerns delay approval" },
      { canonical: "Teams struggle to prepare reports" },
    ], lineage);
    expect(neutral.every((p) => p.classification === "NOT_EVALUATED")).toBe(true);
    expect(neutral.every((p) => p.eligible === false)).toBe(true);
    expect(neutral.every((p) => p.allowedUses.length === 0)).toBe(true);
  });

  it("rejects Offer core-pain merging and lower-ranked selections", () => {
    const painRegistry = buildAudiencePainRegistry([
      { canonical: "Teams struggle to prepare reliable reports before sales calls", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_core"] },
      { canonical: "Price and proof concerns delay purchase approval", classification: "OBJECTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_objection"] },
    ], lineage);
    const audience = {
      audiencePains: painRegistry,
      painRegistry,
      desireMap: {},
      objectionMap: {},
      emotionalDrivers: [],
      maturityIndex: null,
      awarenessLevel: null,
      audienceSegments: [],
    };
    const result = validateOfferAlignment({
      offerName: "Reporting confidence offer",
      coreOutcome: "Help teams solve report preparation before sales calls",
      mechanismDescription: "A reporting workflow",
      deliverables: [],
      selectedPainRoles: {
        core: {
          painId: painRegistry[1].painId,
          role: "core_purchase",
          mergedPainIds: [painRegistry[0].painId, painRegistry[1].painId],
        },
      },
    } as any, differentiation, audience);

    expect(result.aligned).toBe(false);
    expect(result.failures.join(" ")).toContain("unapproved or lower-priority");
    expect(result.failures.join(" ")).toContain("must not merge");
  });

  it("rejects a final strategy that drops the selected core pain role", () => {
    const pains = buildAudiencePainRegistry([
      { canonical: "Teams struggle to prepare reliable reports before sales calls", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_core"] },
    ], lineage);
    const result = validatePostGeneration({
      accountId: lineage.accountId,
      audienceSnapshotId: lineage.audienceSnapshotId,
      primaryAxis: "reporting clarity",
      approvedMechanism: JSON.stringify({}),
      approvedAudiencePains: JSON.stringify(pains),
    }, {
      offerName: "Reporting confidence offer",
      coreOutcome: "Prepare reliable reports",
      selectedPainRoles: { core: { painId: "invented", role: "core_purchase" } },
    });
    expect(result.valid).toBe(false);
    expect(result.issues.join(" ")).toContain("audience_pain_role_mismatch");
  });

  it("attaches authoritative pain roles on the Offer signal-insufficient early return", async () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "Teams struggle to produce reliable reports before the sales call", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_core"] },
      { canonical: "Price and proof concerns delay purchase approval", classification: "OBJECTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_objection"] },
    ], lineage);
    const corePainId = selectPainForUse(registry, "offer_core")!.painId;
    const strategyRoot = {
      id: "root-1",
      rootHash: "hash",
      runId: "run-1",
      primaryAxis: "reporting_clarity",
      accountId: lineage.accountId,
      audienceSnapshotId: lineage.audienceSnapshotId,
      approvedMechanism: JSON.stringify({}),
      approvedAudiencePains: JSON.stringify(registry),
    };
    // Empty upstream lineage → INSUFFICIENT_SIGNALS early return, no AI call.
    const result = await runOfferEngine(
      {} as any,
      { audiencePains: [], desireMap: {}, objectionMap: {}, emotionalDrivers: [], maturityIndex: null, awarenessLevel: null, audienceSegments: [] } as any,
      {} as any,
      {} as any,
      lineage.accountId,
      [],
      undefined,
      strategyRoot,
    );
    expect(result.status).toBe("INSUFFICIENT_SIGNALS");
    expect(result.primaryOffer.selectedPainRoles?.core?.painId).toBe(corePainId);
    expect(result.primaryOffer.selectedPainRoles?.core?.mergedPainIds).toEqual([corePainId]);
    // Post-generation validation must not misread the truthful early return as a dropped core pain.
    const postGen = validatePostGeneration(strategyRoot, result.primaryOffer);
    expect(postGen.issues.join(" ")).not.toContain("audience_pain_role_mismatch");
    expect(postGen.issues.join(" ")).not.toContain("audience_pain_merge_forbidden");
  });

  it("attaches authoritative pain roles on the Offer differentiation-insufficient early return", async () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "Teams struggle to produce reliable reports before the sales call", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_core"] },
    ], lineage);
    const corePainId = selectPainForUse(registry, "offer_core")!.painId;
    const strategyRoot = {
      id: "root-2",
      rootHash: "hash",
      runId: "run-2",
      primaryAxis: "reporting_clarity",
      accountId: lineage.accountId,
      audienceSnapshotId: lineage.audienceSnapshotId,
      approvedMechanism: JSON.stringify({}),
      approvedAudiencePains: JSON.stringify(registry),
    };
    // Enough hop-0 qualifying signals to pass the signal gate, but no
    // differentiation pillars/claims → second early return, still no AI call.
    const upstreamLineage = [1, 2, 3].map((i) => ({
      signalId: `sig-${i}`,
      originEngine: "audience",
      signalCategory: "audience_pain",
      signalText: `Signal text ${i} about reliable reporting`,
      hopDepth: 0,
      originType: "customer" as any,
    }));
    const result = await runOfferEngine(
      {} as any,
      { audiencePains: [], desireMap: {}, objectionMap: {}, emotionalDrivers: [], maturityIndex: null, awarenessLevel: null, audienceSegments: [] } as any,
      {} as any,
      { pillars: [], claimStructures: [] } as any,
      lineage.accountId,
      upstreamLineage as any,
      undefined,
      strategyRoot,
    );
    expect(result.status).toBe("INSUFFICIENT_SIGNALS");
    expect(result.statusMessage).toContain("Differentiation data insufficient");
    expect(result.primaryOffer.selectedPainRoles?.core?.painId).toBe(corePainId);
    expect(result.alternativeOffer.selectedPainRoles?.core?.painId).toBe(corePainId);
  });

  it("routes post-purchase friction to Retention and preserves the selected role on fallback paths", async () => {
    const registry = buildAudiencePainRegistry([
      { canonical: "Teams struggle to produce reliable reports before the sales call", classification: "CORE_PURCHASE", productFit: "ELIGIBLE", eligible: true, allowedUses: ["offer_core"] },
      { canonical: "Refund and cancellation friction after purchase", classification: "POST_PURCHASE_FRICTION", productFit: "ELIGIBLE", eligible: true, allowedUses: ["retention"] },
    ], lineage);
    const retentionPain = selectPainForUse(registry, "retention");
    expect(retentionPain?.classification).toBe("POST_PURCHASE_FRICTION");
    // The retention pain can never claim the Offer core slot.
    expect(selectPainForUse(registry, "offer_core")?.painId).not.toBe(retentionPain?.painId);

    // Sparse input takes the deterministic fallback path — no AI call.
    const result = await runRetentionEngine({
      customerJourneyData: {
        touchpoints: [],
        avgTimeToConversion: null,
        repeatPurchaseRate: null,
        churnRate: null,
        customerLifetimeValue: null,
        retentionWindowDays: null,
        engagementDecayRate: null,
      },
      offerStructure: {
        offerName: null,
        coreOutcome: null,
        deliverables: [],
        proofStrength: null,
        riskReducers: [],
        mechanismDescription: null,
      },
      purchaseMotivations: [],
      postPurchaseObjections: [],
      campaignId: "campaign-a",
      accountId: lineage.accountId,
      painRegistry: registry,
    });
    expect(result.selectedPainRoles?.retention?.painId).toBe(retentionPain?.painId);
  });

  it("preserves engine-selected pain roles at plan synthesis without reselection", () => {
    const results = new Map<string, any>();
    results.set("offer", {
      status: "SUCCESS",
      output: { output: { selectedPainRoles: {
        core: { painId: "pain_core", role: "core_purchase" },
        objections: [{ painId: "pain_obj", role: "objection" }],
      } } },
    });
    results.set("retention", {
      status: "SUCCESS",
      output: { output: { selectedPainRoles: {
        retention: { painId: "pain_ret", role: "post_purchase_friction", classification: "POST_PURCHASE_FRICTION" },
      } } },
    });
    const preserved = extractAudiencePainRoles(results as any);
    expect(preserved.roles?.core).toEqual({ painId: "pain_core", source: "offer" });
    expect(preserved.roles?.objections).toEqual([{ painId: "pain_obj", source: "offer" }]);
    expect(preserved.roles?.retention?.painId).toBe("pain_ret");
    expect(preserved.violations).toEqual([]);
  });

  it("rejects merged core pains and retention pains claiming the core slot at synthesis", () => {
    const merged = new Map<string, any>();
    merged.set("offer", {
      status: "SUCCESS",
      output: { output: { selectedPainRoles: {
        core: { painId: "pain_a", role: "core_purchase", mergedPainIds: ["pain_a", "pain_b"] },
      } } },
    });
    const mergedResult = extractAudiencePainRoles(merged as any);
    expect(mergedResult.roles?.core).toBeUndefined();
    expect(mergedResult.violations).toContain("OFFER_CORE_PAIN_MERGED");

    const conflict = new Map<string, any>();
    conflict.set("offer", {
      status: "SUCCESS",
      output: { output: { selectedPainRoles: { core: { painId: "pain_x", role: "core_purchase" } } } },
    });
    conflict.set("retention", {
      status: "SUCCESS",
      output: { output: { selectedPainRoles: { retention: { painId: "pain_x" } } } },
    });
    const conflictResult = extractAudiencePainRoles(conflict as any);
    expect(conflictResult.roles?.core?.painId).toBe("pain_x");
    expect(conflictResult.roles?.retention).toBeUndefined();
    expect(conflictResult.violations).toContain("RETENTION_PAIN_CONFLICTS_WITH_CORE");
  });
});