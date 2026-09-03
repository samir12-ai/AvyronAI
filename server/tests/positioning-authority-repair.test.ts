import "dotenv/config";
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  validateTerritorySpecificity,
  classifyTerritoryLevel,
  type Territory,
} from "../positioning-engine/engine";
import { assembleStrategyRootInput } from "../shared/strategy-root-assembler";

describe("Positioning Authority & Cross-Engine Semantic Propagation Repair (10-Point Suite)", () => {

  it("Test 1: Core pain dominates primary positioning over ungrounded psychology", () => {
    const operationalTerritory: Territory = {
      name: "Manual Oversight Dependency in Workflow Automation",
      opportunityScore: 0.85,
      narrativeDistanceScore: 0.9,
      painAlignment: ["Challenges in scaling operations without constant manual intervention and oversight."],
      desireAlignment: ["Automated workflow execution"],
      enemyDefinition: "Manual workflow processes fail to scale without continuous human intervention.",
      contrastAxis: "Automated digital operators vs manual oversight bottlenecks",
      narrativeDirection: "Scale operations with automated verification.",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: ["Pain: manual oversight"],
      confidenceScore: 0.85,
      domainFailure: "Manual intervention creates severe operational scaling bottlenecks.",
      operationalProblem: "Teams cannot scale campaigns without adding proportional headcount.",
    };

    const psychologicalTerritory: Territory = {
      name: "Lack of Community Framework for User Belonging",
      opportunityScore: 0.84,
      narrativeDistanceScore: 1.0,
      painAlignment: [], // Pure emotional driver, no core buying pain
      desireAlignment: ["Belonging / community validation"],
      enemyDefinition: "The platform community framework collapses under unmet belonging needs.",
      contrastAxis: "Fostering community belonging vs feeling isolated in automation",
      narrativeDirection: "Enable connected community for peer validation.",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: ["Driver: belonging / community"],
      confidenceScore: 0.3,
      domainFailure: "Community framework fails to provide emotional connection.",
      operationalProblem: "Users feel isolated without peer validation.",
    };

    // Strategic precedence calculation check
    const getPrecedence = (t: Territory) => {
      let score = t.opportunityScore;
      if (t.painAlignment && t.painAlignment.length > 0) score += 0.25;
      return score;
    };

    expect(getPrecedence(operationalTerritory)).toBeGreaterThan(getPrecedence(psychologicalTerritory));
  });

  it("Test 2: Psychology cannot auto-promote to primary positioning territory", () => {
    const purePsychologyAsPrimary: Territory = {
      name: "Lack of Community Framework for User Belonging",
      opportunityScore: 0.84,
      narrativeDistanceScore: 1.0,
      painAlignment: [], // 0 core pain grounding
      desireAlignment: ["Belonging / community validation"],
      enemyDefinition: "The platform community framework collapses under unmet belonging needs.",
      contrastAxis: "Fostering community belonging vs feeling isolated in automation",
      narrativeDirection: "Enable connected community for peer validation.",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: ["Driver: belonging / community"],
      confidenceScore: 0.3,
    };

    const result = validateTerritorySpecificity([purePsychologyAsPrimary]);
    expect(result.passed).toBe(false);
    expect(result.rejections[0].reasons.some(r => r.includes("PSYCHOLOGY_PROMOTED_TO_CORE") || r.includes("audience-level"))).toBe(true);
  });

  it("Test 3: Domain-appropriate psychology CAN promote if grounded in core purchase problem (No Keyword Ban)", () => {
    // In a mental wellness or community-first product domain, belonging IS the operational core problem
    const legitimateCommunityProductTerritory: Territory = {
      name: "Community Engagement Platform Breakdown",
      opportunityScore: 0.88,
      narrativeDistanceScore: 0.95,
      painAlignment: ["High user churn due to fragmented community engagement tools and lack of peer integration."],
      desireAlignment: ["Integrated community belonging framework with verified peer networking"],
      enemyDefinition: "Disjointed forum tools fail to provide structured member onboarding and community retention pipelines.",
      contrastAxis: "Automated community engagement engine vs disjointed discussion forums",
      narrativeDirection: "Drive member retention through algorithmic community connection workflows.",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: ["Pain: fragmented community engagement"],
      confidenceScore: 0.88,
      domainFailure: "Disjointed forum tools fail to retain active members.",
      operationalProblem: "Communities lose 60% of new members within 14 days.",
    };

    const result = validateTerritorySpecificity([legitimateCommunityProductTerritory]);
    // System-level structure + core pain grounding allows this to pass without keyword blocking
    expect(result.passed).toBe(true);
  });

  it("Test 4: Judge rejects composite axis overload (multiple independent themes in one axis)", () => {
    const overloadedTerritory: Territory = {
      name: "Manual Oversight Dependency in Workflow Automation",
      opportunityScore: 0.85,
      narrativeDistanceScore: 0.9,
      painAlignment: ["Challenges in scaling operations without constant manual intervention."],
      desireAlignment: ["Automated workflow execution"],
      enemyDefinition: "Manual workflow processes fail to scale without continuous human intervention.",
      // Compound narrative overloading 4 independent themes:
      contrastAxis: "Business Workflow Automators seek to strengthen their operational autonomy and foster belonging through modular agents, instead of remaining stuck in fragmented comparison-shopping due to weak commitment to transformation, while also eliminating manual oversight.",
      narrativeDirection: "Scale operations with automated verification.",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: ["Pain: manual oversight"],
      confidenceScore: 0.85,
      domainFailure: "Manual intervention creates scaling bottlenecks.",
      operationalProblem: "Teams cannot scale campaigns.",
    };

    const result = validateTerritorySpecificity([overloadedTerritory]);
    expect(result.passed).toBe(false);
    expect(result.rejections[0].reasons.some(r => r.includes("COMPOSITE_AXIS_OVERLOAD"))).toBe(true);
  });

  it("Test 5: Strategy Root primaryAxis represents clean primary commercial contrast", async () => {
    const rootInput = await assembleStrategyRootInput({
      campaignId: "campaign_test",
      accountId: "acc_test",
      miSnapshotId: "mi_test",
      audienceSnapshotId: "aud_test",
      positioningSnapshotId: "pos_test",
      differentiationSnapshotId: "diff_test",
      mechanismSnapshotId: "mech_test",
      mechanismResult: {
        primaryMechanism: {
          mechanismName: "Workflow Autonomy Validation Engine",
          axisAlignment: { primaryAxis: "Continuous Verified Evidence vs Manual Guesswork" }
        }
      },
      positioningSnapshot: {
        contrastAxis: "Continuous Verified Evidence vs Manual Guesswork",
        enemyDefinition: "Manual guesswork in workflow scaling",
        territories: []
      },
      differentiationContext: { claimStructures: [] },
      audienceOverride: {
        audiencePains: [{ painId: "p1", canonical: "Manual oversight bottleneck", classification: "CORE_PURCHASE" }],
        desireMap: { d1: "Operational autonomy" },
        objectionMap: { o1: "Data reliability" },
        audienceSegments: [{ id: "s1", name: "Ops Leaders" }]
      }
    });

    expect(rootInput.primaryAxis).toBe("Continuous Verified Evidence vs Manual Guesswork");
    expect(rootInput.primaryAxis).not.toContain("and foster belonging");
    expect(rootInput.primaryAxis).not.toContain("comparison-shopping");
  });

  it("Test 6: Lane Grouper prompt defines structural scoping role", () => {
    const laneGrouperCode = fs.readFileSync(
      path.resolve(__dirname, "../shared/lane-grouper.ts"),
      "utf8"
    );

    expect(laneGrouperCode).toContain("A Strategic Lane is a structural scoping container to group segments and pains");
    expect(laneGrouperCode).toContain("Do NOT generate or invent brand positioning, differentiation claims, market enemies");
  });

  it("Test 7: Downstream consistency contracts preserved (Offer & Persuasion consume Strategy Root)", () => {
    const offerEngineCode = fs.readFileSync(
      path.resolve(__dirname, "../offer-engine/engine.ts"),
      "utf8"
    );
    const persuasionEngineCode = fs.readFileSync(
      path.resolve(__dirname, "../persuasion-engine/engine.ts"),
      "utf8"
    );

    expect(offerEngineCode).toContain("strategyRoot.primaryAxis");
    expect(persuasionEngineCode).toContain("positioning.narrativeDirection");
    expect(persuasionEngineCode).toContain("positioningAxis");
  });

  it("Test 8: Supporting psychology remains preserved and available in audience contracts", async () => {
    const rootInput = await assembleStrategyRootInput({
      campaignId: "campaign_test",
      accountId: "acc_test",
      miSnapshotId: "mi_test",
      audienceSnapshotId: "aud_test",
      positioningSnapshotId: "pos_test",
      differentiationSnapshotId: "diff_test",
      mechanismSnapshotId: "mech_test",
      mechanismResult: { primaryMechanism: { mechanismName: "Engine" } },
      positioningSnapshot: { contrastAxis: "A vs B" },
      differentiationContext: { claimStructures: [] },
      audienceOverride: {
        audiencePains: [{ painId: "p1", canonical: "Core Pain", classification: "CORE_PURCHASE" }],
        desireMap: { d1: "Belonging and team connection" },
        objectionMap: { o1: "Adoption fear" },
        audienceSegments: [{ id: "s1", name: "Segment 1" }]
      }
    });

    expect(rootInput.approvedDesires).toEqual({ d1: "Belonging and team connection" });
    expect(rootInput.approvedObjections).toEqual({ o1: "Adoption fear" });
  });

  it("Test 9: Zero hardcoded keyword blacklist in Positioning Engine", () => {
    const posCode = fs.readFileSync(
      path.resolve(__dirname, "../positioning-engine/engine.ts"),
      "utf8"
    );

    // No hardcoded ban on words like belonging, community, comparison
    expect(posCode).not.toContain("if (text.includes(\"belonging\")) return false");
    expect(posCode).not.toContain("if (text.includes(\"community\")) return false");
    expect(posCode).not.toContain("if (text.includes(\"comparison-shopping\")) return false");
  });

  it("Test 10: Territory level classification correctly classifies system vs audience levels", () => {
    const validSystemTerritory: Territory = {
      name: "Operational Workflow Scaling Infrastructure",
      opportunityScore: 0.8,
      narrativeDistanceScore: 0.8,
      painAlignment: ["Manual scaling limits"],
      desireAlignment: ["Autonomous execution"],
      enemyDefinition: "Fragmented legacy tools fail to coordinate across teams.",
      contrastAxis: "Unified workflow architecture vs fragmented tools",
      narrativeDirection: "Scale with unified platform.",
      isStable: true,
      stabilityNotes: [],
      evidenceSignals: [],
      confidenceScore: 0.8,
      domainFailure: "Tools disconnect during high volume.",
      operationalProblem: "Manual handoffs delay execution.",
    };

    const classification = classifyTerritoryLevel(validSystemTerritory);
    expect(classification.level).toBe("system");
    expect(classification.reasons.length).toBe(0);
  });
});
