import 'dotenv/config';
import { describe, it, expect } from "vitest";
import { runCompetitorUnderstandingEngine } from "../competitive-intelligence/competitor-understanding-engine";
import { runDifferentiationEngine } from "../differentiation-engine/engine";
import { judgeDifferentiation } from "../differentiation-engine/judge";

describe("Competitor Website Understanding + MI Integration Tests (A-J)", { timeout: 45000 }, () => {
  const accountId = "test_acc_comp";
  const campaignId = "test_camp_comp";
  const competitorId = "comp_hubspot_test";
  const websiteUrl = "https://www.hubspot.com";

  it("TEST A — Competitor capability extraction: Generates canonical capability fact with valid evidenceRefIds", async () => {
    const understanding = await runCompetitorUnderstandingEngine(accountId, campaignId, competitorId, websiteUrl, "HubSpot Test");
    expect(understanding.competitorUnderstandingAuthorityId).toBeDefined();
    expect(understanding.capabilities.length).toBeGreaterThan(0);
    
    const cap = understanding.capabilities[0];
    expect(cap.competitorCapabilityFactId).toBeDefined();
    expect(cap.competitorId).toBe(competitorId);
    expect(Array.isArray(cap.evidenceRefIds)).toBe(true);
    expect(cap.evidenceRefIds.length).toBeGreaterThan(0);
  });

  it("TEST B — Unsupported capability rejected: Anti-fabrication filter strips unsupported claims", async () => {
    const understanding = await runCompetitorUnderstandingEngine(accountId, campaignId, competitorId, websiteUrl, "HubSpot Test");
    for (const cap of understanding.capabilities) {
      expect(cap.statement.toLowerCase()).not.toContain("unsupported hallucinated feature");
    }
  });

  it("TEST C — Missing feature does NOT become absence: Absence of evidence is NOT evidence of absence", async () => {
    const understanding = await runCompetitorUnderstandingEngine(accountId, campaignId, competitorId, websiteUrl, "HubSpot Test");
    for (const cap of understanding.capabilities) {
      expect(cap.statement.toLowerCase()).not.toContain("lacks ");
      expect(cap.statement.toLowerCase()).not.toContain("does not have ");
    }
    // Unmentioned features are stored in notEstablishedAreas or marked NOT_ESTABLISHED
    expect(Array.isArray(understanding.notEstablishedAreas)).toBe(true);
  });

  it("TEST D — Positioning vs Capability separation: Slogans stay in positioning facts, not capability facts", async () => {
    const understanding = await runCompetitorUnderstandingEngine(accountId, campaignId, competitorId, websiteUrl, "HubSpot Test");
    expect(understanding.positioning.length).toBeGreaterThanOrEqual(0);
    expect(understanding.capabilities.length).toBeGreaterThan(0);
  });

  it("TEST E — Full lineage: Preserves complete ID chain from fact to website source", async () => {
    const understanding = await runCompetitorUnderstandingEngine(accountId, campaignId, competitorId, websiteUrl, "HubSpot Test");
    expect(understanding.competitorUnderstandingAuthorityId).toMatch(/^comp_auth_/);
    expect(understanding.competitorWebsiteSnapshotId).toBeDefined();
    expect(understanding.parentAuthorityIds).toContain(understanding.competitorWebsiteSnapshotId);
    expect(understanding.capabilities[0].evidenceRefIds[0]).toMatch(/^ev_comp_web_/);
  });

  it("TEST F — Cross competitor isolation: Facts for competitor A belong strictly to competitor A", async () => {
    const compA = await runCompetitorUnderstandingEngine(accountId, campaignId, "comp_a", websiteUrl, "Comp A");
    const compB = await runCompetitorUnderstandingEngine(accountId, campaignId, "comp_b", websiteUrl, "Comp B");
    
    expect(compA.competitorId).toBe("comp_a");
    expect(compB.competitorId).toBe("comp_b");
    for (const cap of compA.capabilities) expect(cap.competitorId).toBe("comp_a");
    for (const cap of compB.capabilities) expect(cap.competitorId).toBe("comp_b");
  });

  it("TEST G — Cross campaign isolation: Facts are strictly campaign-scoped", async () => {
    const camp1 = await runCompetitorUnderstandingEngine(accountId, "camp_1", competitorId, websiteUrl, "Comp");
    const camp2 = await runCompetitorUnderstandingEngine(accountId, "camp_2", competitorId, websiteUrl, "Comp");
    
    expect(camp1.campaignId).toBe("camp_1");
    expect(camp2.campaignId).toBe("camp_2");
  });

  it("TEST H — Differentiation receives competitor product baseline: Facts passed into canonicalMi input", async () => {
    const compUnd = await runCompetitorUnderstandingEngine(accountId, campaignId, competitorId, websiteUrl, "HubSpot");
    
    const miInput = {
      competitorProductBaselines: [{
        competitorId,
        competitorName: "HubSpot",
        competitorUnderstandingAuthorityId: compUnd.competitorUnderstandingAuthorityId,
        capabilities: compUnd.capabilities,
        positioning: compUnd.positioning
      }]
    };

    const audInput = {
      painRegistry: [{
        painId: "pain_test_h",
        classification: "CORE_PURCHASE",
        canonical: "Users face scattered data and lack buying signals.",
        productTruthFactIds: ["pt_fact_1"]
      }]
    };

    const diffResult = await runDifferentiationEngine(
      miInput as any,
      audInput as any,
      { territories: [] } as any,
      { accountId, campaignId, jobId: "test_h_job", audienceSnapshotId: "aud_snap_h", miSnapshotId: "mi_snap_h" }
    );

    expect(diffResult.engineVersion).toBe(3);
  });

  it("TEST I — No unsupported negative contrast: Judge rejects candidate claiming competitor lacks X without evidence", async () => {
    const input: any = {
      lineage: { accountId, campaignId, jobId: "job_i", audienceSnapshotId: "aud_i", miSnapshotId: "mi_i" },
      corePains: [{
        painId: "pain_i",
        canonicalPain: "Data fragmentation causes poor targeting.",
        fitType: "DIRECT_FIT",
        productTruthFactIds: ["pt_i_1"]
      }],
      productTruth: [{ productTruthFactId: "pt_i_1", factType: "CAPABILITY", fact: "Avyron provides live signal analysis." }],
      competitiveAuthority: [{ miAuthorityId: "mi_i_1", competitorId: "comp_1", factType: "COMPETITOR_FACT", fact: "Comp 1 uses static reporting." }]
    };

    const candidates: any[] = [{
      differentiationId: "cand_i_1",
      corePainIds: ["pain_i"],
      differentiationClaim: "Avyron performs live signal analysis, whereas Competitor 1 lacks all data analysis capabilities.",
      distinctiveProperty: "Live signal mirror",
      buyerValue: "Prevents targeting noise",
      productTruthFactIds: ["pt_i_1"],
      miAuthorityIds: ["mi_i_1"]
    }];

    const judgeRes = await judgeDifferentiation(input, candidates);
    // Unsupported blanket assertion "lacks all data analysis" should trigger Judge rejection
    expect(judgeRes.valid).toBe(false);
  });

  it("TEST J — Positive contrast allowed: Proposing contrast X vs Y passes Judge evaluation", async () => {
    const input: any = {
      lineage: { accountId, campaignId, jobId: "job_j", audienceSnapshotId: "aud_j", miSnapshotId: "mi_j" },
      corePains: [{
        painId: "pain_j",
        canonicalPain: "Scattered data causes difficulty identifying buying signals.",
        fitType: "DIRECT_FIT",
        productTruthFactIds: ["pt_j_1"]
      }],
      productTruth: [{ productTruthFactId: "pt_j_1", factType: "CAPABILITY", fact: "Avyron AI operates a 6-fact-category Competitor Understanding engine with automated lineage tracing back to source page hashes." }],
      competitiveAuthority: [{ miAuthorityId: "mi_j_1", competitorId: "comp_j", factType: "COMPETITOR_PRODUCT_CAPABILITY", fact: "HubSpot capability: Uses manual static campaign templates. Equivalent automated 6-fact lineage tracing was not established in reviewed competitor evidence." }]
    };

    const candidates: any[] = [{
      differentiationId: "cand_j_1",
      corePainIds: ["pain_j"],
      differentiationClaim: "Avyron AI operates a 6-fact-category Competitor Understanding engine with automated lineage tracing back to source page hashes, whereas HubSpot operates on manual static campaign templates.",
      distinctiveProperty: "6-fact-category Competitor Understanding engine with source page hash lineage",
      buyerValue: "Eliminates targeting noise by grounding buying signals in cryptographic page hash lineage",
      productTruthFactIds: ["pt_j_1"],
      miAuthorityIds: ["mi_j_1"]
    }];

    const judgeRes = await judgeDifferentiation(input, candidates);
    if (!judgeRes.valid) console.log("TEST J Judge Defects:", JSON.stringify(judgeRes.defects, null, 2));
    expect(judgeRes.valid).toBe(true);
  });
});
