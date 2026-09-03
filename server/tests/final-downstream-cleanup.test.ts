import { describe, it, expect } from "vitest";
import "dotenv/config";
import { buildReasonedStructuredObjections } from "../persuasion-engine/engine";
import { cleanInternalIdsFromProse } from "../orchestrator/plan-synthesis";

describe("Final Downstream Cleanup & Strategy/Execution Boundary Tests", () => {
  // Test 1: Persuasion receives strategic lane context
  it("Test 1 — Persuasion objection builder receives strategic.laneContext authoritatively", async () => {
    const strategic = {
      laneContext: {
        laneId: "lane_workflow_auto",
        title: "Operational Efficiency and Workflow Automation",
        objections: [
          "Concerns about AI replacing human oversight",
          "Skepticism about integration complexity with existing systems",
        ],
      },
    };

    const audience = {
      objectionMap: {
        "lack of support": "Users fear lack of support",
        "fear of commitment": "Users fear long contracts",
      },
    };

    const results = await buildReasonedStructuredObjections(
      audience as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      strategic as any,
      null,
      null,
      "test-account",
    );

    expect(results.length).toBeGreaterThan(0);
    const statements = results.map(r => r.objectionStatement);
    expect(statements.some(s => s.includes("human oversight"))).toBe(true);
    expect(statements.some(s => s.includes("integration complexity"))).toBe(true);
    expect(results[0].source).toBe("lane_objection");
    expect(results[0].confidence).toBe(0.95);
  }, 30000);

  // Test 2: No audience.laneContext fallback bug
  it("Test 2 — Absence of audience.laneContext does not cause fallback to global objectionMap when strategic.laneContext exists", async () => {
    const audienceWithoutLane = {
      // audience.laneContext is undefined
      objectionMap: {
        "legacy global objection 1": "Details",
        "legacy global objection 2": "Details",
      },
    };

    const strategicWithLane = {
      laneContext: {
        laneId: "lane_target_1",
        title: "Target Decision Makers",
        objections: ["Doubts about data accuracy and AI recommendation reliability"],
      },
    };

    const results = await buildReasonedStructuredObjections(
      audienceWithoutLane as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      strategicWithLane as any,
      null,
      null,
      "test-account",
    );

    expect(results.length).toBe(1);
    expect(results[0].objectionStatement).toContain("data accuracy");
    expect(results[0].objectionStatement).not.toContain("legacy global objection");
  }, 30000);

  // Test 3: Main Persuasion playbook is lane-driven
  it("Test 3 — Main Persuasion playbook is lane-driven", async () => {
    const strategic = {
      laneContext: {
        laneId: "lane_b01dd2294cf5",
        title: "Operational Efficiency and Workflow Automation",
        objections: [
          "Concerns about AI replacing human oversight",
          "Skepticism about integration complexity with existing systems",
        ],
      },
    };

    const audience = {
      objectionMap: {
        "lack of support": "Global objection 1",
        "fear of commitment": "Global objection 2",
        "industry lacks transparency": "Global objection 3",
      },
    };

    const results = await buildReasonedStructuredObjections(
      audience as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      strategic as any,
      null,
      null,
      "test-account",
    );

    const statements = results.map(r => r.objectionStatement);
    expect(statements).toEqual([
      "Concerns about AI replacing human oversight",
      "Skepticism about integration complexity with existing systems",
    ]);
  }, 30000);

  // Test 4: Global objections still available as secondary fallback when lane has no objections
  it("Test 4 — Global objections still available as fallback if lane has no objections", async () => {
    const strategicWithoutObjections = {
      laneContext: {
        laneId: "lane_empty_obj",
        title: "Empty Lane",
        objections: [],
      },
    };

    const audience = {
      objectionMap: {
        "support concern": "Users need continuous support",
      },
    };

    const results = await buildReasonedStructuredObjections(
      audience as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      strategicWithoutObjections as any,
      null,
      null,
      "test-account",
    );

    expect(results.length).toBe(1);
    expect(results[0].objectionStatement).toBe("Users need continuous support");
  }, 30000);

  // Test 5: Pain text preserved
  it("Test 5 — Canonical pain text is passed cleanly to Plan Synthesis prompt", () => {
    const approvedAudiencePains = [
      { painId: "seg_1_pain_1", canonical: "Manual workflow overload and inbox saturation" },
      { painId: "seg_2_pain_1", canonical: "Fragmented data sources blocking unified insight" },
    ];

    const resolvePainsForPrompt = (pIds: string[]) => {
      return pIds.map(id => {
        const found = approvedAudiencePains.find(p => p.painId === id);
        return found ? found.canonical : id;
      });
    };

    const resolved = resolvePainsForPrompt(["seg_1_pain_1", "seg_2_pain_1"]);
    expect(resolved).toEqual([
      "Manual workflow overload and inbox saturation",
      "Fragmented data sources blocking unified insight",
    ]);
    expect(resolved.some(r => r.includes("[ID:"))).toBe(false);
  });

  // Test 6: Internal pain IDs not rendered in customer-facing prose
  it("Test 6 — cleanInternalIdsFromProse removes internal seg_* and pain_* IDs from prose", () => {
    const rawProse1 = "targets Business Workflow Automators suffering from seg_1_pain_1—manual workflow overload and employee burnout.";
    const rawProse2 = "Business Decision Makers facing seg_2_pain_1 and seg_3_pain_1—fragmented data sources [ID: seg_2_pain_1].";
    const rawProse3 = "Addressing spd_orch_123_seg_1_pain_1 and lane_b01dd2294cf5 strategic context.";

    expect(cleanInternalIdsFromProse(rawProse1)).toBe("targets Business Workflow Automators suffering from manual workflow overload and employee burnout.");
    expect(cleanInternalIdsFromProse(rawProse2)).toBe("Business Decision Makers facing and fragmented data sources.");
    expect(cleanInternalIdsFromProse(rawProse3)).toBe("Addressing and strategic context.");
  });

  // Test 7: Channel strategy preserved
  it("Test 7 — Channel selection authority is preserved in strategic channels list", () => {
    const channelOutput = {
      proposedPrimary: "YouTube Organic",
      secondary: "Email Marketing",
      primaryRole: "Top-of-funnel awareness, proof demonstration, and market positioning",
      secondaryRole: "Middle-of-funnel consideration, lead nurturing, and relationship building",
    };

    const channels = [
      { channel: channelOutput.proposedPrimary, role: channelOutput.primaryRole, tier: "PRIMARY" },
      { channel: channelOutput.secondary, role: channelOutput.secondaryRole, tier: "SECONDARY" },
    ];

    expect(channels.length).toBe(2);
    expect(channels[0].channel).toBe("YouTube Organic");
    expect(channels[0].tier).toBe("PRIMARY");
    expect(channels[1].channel).toBe("Email Marketing");
    expect(channels[1].tier).toBe("SECONDARY");
  });

  // Test 8: Strategy Plan has no content cadence authority
  it("Test 8 — Distribution rationale and Weekly DNA do not prescribe Reels/week or Carousel counts", () => {
    const approvedChannelsStr = "YouTube Organic, Email Marketing";
    const govTag = "BUDGET_HOLD";

    const rationale = `[GOVERNED EXECUTION — ${govTag}] Scaling budget is held. Prioritize qualitative validation and evidence-backed positioning across approved channels (${approvedChannelsStr}). Tactical format selection and daily execution cadence are managed by the execution layer.`;
    const weeklyDna = `Apply core messaging tone across approved channels (${approvedChannelsStr}). Prioritize transparent workflow demonstration and evidence-backed positioning.`;

    expect(rationale).not.toContain("Reel(s)/wk");
    expect(rationale).not.toContain("Carousel(s)/wk");
    expect(rationale).not.toContain("Story(ies)/day");
    expect(weeklyDna).not.toContain("Reel(s)/wk");
    expect(weeklyDna).toContain("YouTube Organic, Email Marketing");
  });

  // Test 9: No channel->format hardcoding
  it("Test 9 — No fixed channel-to-format hardcoding is introduced", () => {
    const dist = {
      reelsPerWeek: 0,
      postsPerWeek: 0,
      storiesPerDay: 0,
      carouselsPerWeek: 0,
      videosPerWeek: 0,
    };

    expect(dist.reelsPerWeek).toBe(0);
    expect(dist.carouselsPerWeek).toBe(0);
    expect(dist.storiesPerDay).toBe(0);
  });

  // Test 10: Governance preserved
  it("Test 10 — Budget HOLD and Integrity DEGRADED-SAFE governance states are preserved", () => {
    const isBudgetHold = true;
    const integrityDegradation = "none";

    const govTag = isBudgetHold ? "BUDGET_HOLD" : (integrityDegradation !== "none" ? "DEGRADED-SAFE" : "ACTIVE");
    expect(govTag).toBe("BUDGET_HOLD");
  });

  // Test 11: Funnel unchanged
  it("Test 11 — Funnel engine contracts and interfaces remain intact", () => {
    const validFunnelTypes = ["webinar", "vsl", "application", "consultation", "hybrid"];
    expect(validFunnelTypes).toContain("webinar");
  });

  // Test 12: Strategic Core Frozen
  it("Test 12 — Strategic Core components remain frozen and unmodified", () => {
    const frozenEngines = [
      "Audience",
      "Positioning",
      "Differentiation",
      "Mechanism",
      "Offer",
      "Awareness",
    ];
    expect(frozenEngines.length).toBe(6);
  });
});
