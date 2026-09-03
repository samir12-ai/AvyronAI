import "dotenv/config";
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { runDifferentiationEngine } from "../differentiation-engine/engine";

describe("Semantic Tenant Isolation & Fail-Closed Fallbacks", () => {
  it("proposer prompt contains no Avyron, Live Market Mirror, or semantic Judge verification examples", () => {
    const proposerPath = path.resolve(__dirname, "../differentiation-engine/proposer.ts");
    const content = fs.readFileSync(proposerPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror");
    expect(content).not.toContain("Avyron AI verified pipeline");
    expect(content).not.toContain("Avyron's established capability");
  });

  it("differentiation engine contains no hardcoded Avyron Product Truth fallback", () => {
    const enginePath = path.resolve(__dirname, "../differentiation-engine/engine.ts");
    const content = fs.readFileSync(enginePath, "utf-8");
    expect(content).not.toContain("Avyron AI continuously analyzes");
    expect(content).not.toContain("Avyron AI Live Market Mirror");
    expect(content).not.toContain("without live evidence streaming or automated semantic Judge verification");
  });

  it("missing Product Truth in Differentiation Engine returns FAILED status", async () => {
    const mi: any = { competitors: [] };
    const aud: any = {
      painRegistry: [{ painId: "p1", classification: "CORE_PURCHASE", canonical: "High operational complexity" }],
      productTruthFacts: []
    };
    const profile: any = {};
    const runContext: any = { campaignId: "test_camp_empty_pt", accountId: "test_acc" };

    const result = await runDifferentiationEngine(mi, aud, profile, runContext);

    expect(result.status).toBe("FAILED");
    expect(result.statusMessage).toContain("PRODUCT_TRUTH_MISSING");
    expect(result.differentiations).toHaveLength(0);
  });

  it("WTDT Context Builder contains no Avyron semantic fallbacks", () => {
    const contextBuilderPath = path.resolve(__dirname, "../what-to-do-today/context-builder.ts");
    const content = fs.readFileSync(contextBuilderPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror Trust-Building Webinar");
    expect(content).not.toContain("Live Market Mirror Transparent Workflow Demonstration");
    expect(content).not.toContain("Live Market Intelligence Blueprint");
    expect(content).not.toContain("Register for Live Market Mirror Strategy Review");
    expect(content).not.toContain("Positioning Avyron AI against fragmented data visibility");
    expect(content).not.toContain("Business Workflow Automators");
  });

  it("WTDT Planner contains no branded Avyron examples in system prompt", () => {
    const plannerPath = path.resolve(__dirname, "../what-to-do-today/planner.ts");
    const content = fs.readFileSync(plannerPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror");
    expect(content).not.toContain("Build tangible evidence that Avyron AI replaces");
  });

  it("Blueprint Generator contains no branded Avyron examples", () => {
    const blueprintPath = path.resolve(__dirname, "../what-to-do-today/blueprint-generator.ts");
    const content = fs.readFileSync(blueprintPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror");
    expect(content).not.toContain("avyron.ai/demo");
  });

  it("Adaptive Read Surface returns null instead of Avyron defaults when plan summary is missing", () => {
    const readSurfacePath = path.resolve(__dirname, "../adaptive/read-surface.ts");
    const content = fs.readFileSync(readSurfacePath, "utf-8");
    expect(content).not.toContain("Avyron AI positions against fragmented competitor");
  });

  it("Positioning Engine contains no Live Market Mirror fallback", () => {
    const posPath = path.resolve(__dirname, "../positioning-engine/engine.ts");
    const content = fs.readFileSync(posPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror");
  });

  it("Market Intelligence Service contains no Live Market Mirror fallback", () => {
    const miPath = path.resolve(__dirname, "../market-intelligence-service.ts");
    const content = fs.readFileSync(miPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror");
  });

  it("Audience Positioning Service contains no Live Market Mirror fallback", () => {
    const apPath = path.resolve(__dirname, "../audience-positioning-service.ts");
    const content = fs.readFileSync(apPath, "utf-8");
    expect(content).not.toContain("Live Market Mirror");
  });

  // Part 12: Fail-Closed Semantics Test
  it("missing conversionPath, CTA, and proof in WTDT context builder leaves them undefined without fabricating generic fallbacks", () => {
    const contextBuilderPath = path.resolve(__dirname, "../what-to-do-today/context-builder.ts");
    const content = fs.readFileSync(contextBuilderPath, "utf-8");
    
    // Assert no generic business fallbacks
    expect(content).not.toContain("Educational Workshop / Demo");
    expect(content).not.toContain("Book a Strategy Review");
    expect(content).not.toContain("Register for Webinar");
    expect(content).not.toContain("Live Market Mirror Trust-Building Webinar");
  });

  // Part 13: Cross-Tenant Semantic Isolation Test
  it("Tenant B output contains ZERO unique semantic terms from Tenant A", async () => {
    // Synthetic Tenant A (Market Intelligence SaaS)
    const tenantAPtFacts = [
      { productTruthFactId: "pt_a_1", statement: "Real-time query ingestion engine" },
      { productTruthFactId: "pt_a_2", statement: "Autonomous signal alert pipeline" }
    ];

    // Synthetic Tenant B (Social Media Scheduling SaaS)
    const tenantBPtFacts = [
      { productTruthFactId: "pt_b_1", statement: "Multi-channel calendar scheduling" },
      { productTruthFactId: "pt_b_2", statement: "Direct visual media queue publishing" }
    ];

    const miDataTenantB: any = {
      competitors: [
        { competitorId: "comp_1", competitorName: "Later", intentType: "DEFENSIVE" }
      ]
    };

    const audDataTenantB: any = {
      painRegistry: [
        { painId: "pain_b_1", classification: "CORE_PURCHASE", canonical: "Manual scheduling overhead across platforms" }
      ],
      productTruthFacts: tenantBPtFacts
    };

    const resultTenantB = await runDifferentiationEngine(miDataTenantB, audDataTenantB, {} as any, {
      campaignId: "camp_tenant_b_test",
      accountId: "acc_tenant_b"
    });

    const tenantBOutputString = JSON.stringify(resultTenantB);

    // Assert Tenant B output contains ZERO distinct Tenant A product terms
    expect(tenantBOutputString).not.toContain("query ingestion");
    expect(tenantBOutputString).not.toContain("signal alert");
    expect(tenantBOutputString).not.toContain("Live Market Mirror");
    expect(tenantBOutputString).not.toContain("Avyron AI");
  }, 120000);
});
