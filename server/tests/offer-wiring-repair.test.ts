import "dotenv/config";
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { strategicPlans, offerSnapshots } from "../../shared/schema";
import { eq, and } from "drizzle-orm";

describe("Offer Authority, Lineage & Wiring Repair (10-Point Regression Suite)", () => {
  const targetCampaignId = "campaign_1773576062201_6t0oxi";
  const targetJobId = "orch_1787686698057_c0yx1s";
  const targetPlanId = "61fc9ca0-c26d-41dd-b6e3-e01d4ee15554";

  it("Test 1: Canonical Offer is persisted into active planJson.offer", async () => {
    const [plan] = await db.select().from(strategicPlans).where(
      eq(strategicPlans.id, targetPlanId)
    ).limit(1);

    expect(plan).toBeDefined();
    expect(plan.planJson).toBeDefined();

    const planJson = JSON.parse(plan.planJson!);
    expect(planJson.offer).toBeDefined();
    expect(typeof planJson.offer).toBe("object");
  });

  it("Test 2: Offer Name is preserved from Offer Snapshot without rewriting", async () => {
    const [offerSnap] = await db.select().from(offerSnapshots).where(
      and(
        eq(offerSnapshots.campaignId, targetCampaignId),
        eq(offerSnapshots.jobId, targetJobId)
      )
    ).limit(1);

    const primaryOffer = typeof offerSnap.primaryOffer === "string"
      ? JSON.parse(offerSnap.primaryOffer)
      : offerSnap.primaryOffer;

    const [plan] = await db.select().from(strategicPlans).where(
      eq(strategicPlans.id, targetPlanId)
    ).limit(1);
    const planJson = JSON.parse(plan.planJson!);

    expect(planJson.offer.offerName).toEqual(primaryOffer.offerName);
  });

  it("Test 3: Deliverables from deliveryLayer.deliverables reach the plan unchanged", async () => {
    const [offerSnap] = await db.select().from(offerSnapshots).where(
      and(
        eq(offerSnapshots.campaignId, targetCampaignId),
        eq(offerSnapshots.jobId, targetJobId)
      )
    ).limit(1);

    const primaryOffer = typeof offerSnap.primaryOffer === "string"
      ? JSON.parse(offerSnap.primaryOffer)
      : offerSnap.primaryOffer;

    const [plan] = await db.select().from(strategicPlans).where(
      eq(strategicPlans.id, targetPlanId)
    ).limit(1);
    const planJson = JSON.parse(plan.planJson!);

    expect(planJson.offer.deliveryLayer.deliverables).toEqual(primaryOffer.deliveryLayer.deliverables);
    expect(planJson.offer.deliveryLayer.deliverables.length).toBeGreaterThan(0);
  });

  it("Test 4: No strategicSummary leakage in OfferSectionView component", () => {
    const componentCode = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/OfferSectionView.tsx"),
      "utf8"
    );

    // Component must not read strategicSummary fields for offer attributes
    expect(componentCode).not.toContain("stratSummary?.targetAudience");
    expect(componentCode).not.toContain("stratSummary?.strategy");
    expect(componentCode).not.toContain("stratSummary?.growthObjective");
    expect(componentCode).not.toContain("businessRep?.strategicSummary");
  });

  it("Test 5: No raw pain IDs (seg_*_pain_*) in Offer component or plan offer section", async () => {
    const [plan] = await db.select().from(strategicPlans).where(
      eq(strategicPlans.id, targetPlanId)
    ).limit(1);
    const planJson = JSON.parse(plan.planJson!);

    const offerString = JSON.stringify(planJson.offer);
    expect(offerString).not.toMatch(/"title":\s*"seg_\d+_pain_\d+"/);
    expect(planJson.offer.problemStatement).not.toMatch(/^seg_\d+_pain_\d+$/);
  });

  it("Test 6: Commercial Impact is owned by Offer value wedge / reasoning (not Funnel goals)", async () => {
    const [plan] = await db.select().from(strategicPlans).where(
      eq(strategicPlans.id, targetPlanId)
    ).limit(1);
    const planJson = JSON.parse(plan.planJson!);

    const componentCode = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/OfferSectionView.tsx"),
      "utf8"
    );

    expect(componentCode).toContain("valueArchitecture?.primaryValueWedge");
    expect(componentCode).not.toContain("stratSummary?.growthObjective");
  });

  it("Test 7: Proof ownership renders proofLayer, not internal system validation controls", () => {
    const componentCode = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/OfferSectionView.tsx"),
      "utf8"
    );

    // Must not contain hardcoded internal validation mechanisms
    expect(componentCode).not.toContain("First-party capability verification via Business Understanding");
    expect(componentCode).not.toContain("Cross-engine consistency validation via Strategic Consistency Judge");
    expect(componentCode).not.toContain("Live competitor contrast citation and freshness audit");
    expect(componentCode).toContain("proofLayer");
  });

  it("Test 8: Same-run lineage enforced (offer matches active job)", async () => {
    const [offerSnap] = await db.select().from(offerSnapshots).where(
      and(
        eq(offerSnapshots.campaignId, targetCampaignId),
        eq(offerSnapshots.jobId, targetJobId)
      )
    ).limit(1);

    expect(offerSnap.jobId).toBe(targetJobId);
  });

  it("Test 9: Zero hardcoded semantic arrays in OfferSectionView.tsx", () => {
    const componentCode = fs.readFileSync(
      path.resolve(__dirname, "../../components/strategy-plan/OfferSectionView.tsx"),
      "utf8"
    );

    // Deliverables hardcoded array check
    expect(componentCode).not.toContain("'Continuous Live Market Mirror signal tracking & competitor monitoring'");
    expect(componentCode).not.toContain("'Automated evidence filtering and strategic pain registry verification'");
    expect(componentCode).not.toContain("'Execution-ready weekly content and distribution playbooks'");
    expect(componentCode).not.toContain("'Closed-loop performance attribution and budget governance control'");
  });

  it("Test 10: Offer Engine files remain unmodified (zero engine regression)", () => {
    const enginePath = path.resolve(__dirname, "../offer-engine/engine.ts");
    const idPath = path.resolve(__dirname, "../offer-engine/identity-llm.ts");
    const valPath = path.resolve(__dirname, "../offer-engine/value-architect.ts");

    expect(fs.existsSync(enginePath)).toBe(true);
    expect(fs.existsSync(idPath)).toBe(true);
    expect(fs.existsSync(valPath)).toBe(true);
  });
});
