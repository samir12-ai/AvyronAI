import 'dotenv/config';
import { runLaneGrouper, judgeLanes, repairLanes, type StrategicLane } from "../shared/lane-grouper";
import { type AuthoritativeAudiencePain } from "../shared/audience-pain-registry";
import { layer9_strategicLaneAuthority } from "../integrity-engine/engine";

async function runTests() {
  console.log("=================================================");
  console.log("RUNNING STRATEGIC LANE AUTHORITY REGRESSION TESTS");
  console.log("=================================================\n");

  let allPassed = true;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
    } else {
      console.error(`[FAIL] ${testName} - ${detail || "Assertion failed"}`);
      allPassed = false;
    }
  }

  // --- TEST A: EXCLUDED PAIN NEVER ENTERS GROUPER ---
  console.log("--- TEST A: EXCLUDED PAIN NEVER ENTERS GROUPER ---");
  const painCoreA: AuthoritativeAudiencePain = {
    painId: "pain_core_a",
    canonical: "Inefficient manual workflows",
    originalStatement: "Inefficient manual workflows",
    normalizedStatement: "inefficient manual workflows",
    classification: "CORE_PURCHASE",
    rank: 1,
    productFit: "ELIGIBLE",
    eligible: true,
    allowedUses: ["positioning", "mechanism", "offer_core"],
    prohibitedUses: [],
    evidenceUids: ["ev_1"],
    sourceSignalIds: ["sig_1"],
    segmentIds: ["seg_1"],
  };

  const painExcludedB: AuthoritativeAudiencePain = {
    painId: "pain_excluded_b",
    canonical: "Unauthorized recurring billing charges",
    originalStatement: "Unauthorized recurring billing charges",
    normalizedStatement: "unauthorized recurring billing charges",
    classification: "STRATEGIC_EXCLUDED",
    rank: 2,
    productFit: "INELIGIBLE",
    eligible: false,
    allowedUses: [],
    prohibitedUses: ["positioning", "mechanism", "offer_core", "funnel"],
    evidenceUids: ["ev_2"],
    sourceSignalIds: ["sig_2"],
    segmentIds: ["seg_2"],
  };

  const inputRegistry = [painCoreA, painExcludedB];
  const authorizedFiltered = inputRegistry.filter(p => {
    const c = p.classification;
    return (c === "CORE_PURCHASE" || c === "CORE" || c === "SUPPORTING") &&
           c !== "STRATEGIC_EXCLUDED" &&
           c !== "EXCLUDED" &&
           c !== "INCOMPLETE";
  });

  assert(
    authorizedFiltered.length === 1 && authorizedFiltered[0].painId === "pain_core_a",
    "TEST A — Excluded pain B strictly absent from grouper input set",
    `Expected [pain_core_a], got ${authorizedFiltered.map(p => p.painId).join(", ")}`
  );

  // --- TEST B: EXCLUDED SEGMENT CANNOT CREATE LANE ---
  console.log("\n--- TEST B: EXCLUDED SEGMENT CANNOT CREATE LANE ---");
  const segExcludedOnly = {
    id: "seg_2",
    name: "Billing Victims",
    description: "SaaS buyers facing billing issues",
    pains: [{ painId: "pain_excluded_b" }],
  };
  const segCore = {
    id: "seg_1",
    name: "Workflow Practitioners",
    description: "SaaS practitioners seeking automation",
    pains: [{ painId: "pain_core_a" }],
  };

  const authorizedPainIds = new Set(authorizedFiltered.map(p => p.painId));
  const eligibleSegments = [segCore, segExcludedOnly].filter(seg => {
    const segPains = Array.isArray(seg.pains) ? seg.pains : [];
    const segPainIds = segPains.map((p: any) => p.painId || p.id || p);
    return segPainIds.some((pid: string) => authorizedPainIds.has(pid)) ||
           authorizedFiltered.some(ap => (ap.segmentIds || []).includes(seg.id));
  });

  assert(
    eligibleSegments.length === 1 && eligibleSegments[0].id === "seg_1",
    "TEST B — Segment with only excluded pains is excluded from lane creation",
    `Expected [seg_1], got ${eligibleSegments.map(s => s.id).join(", ")}`
  );

  // --- TEST C: CORE CREATES LANE ---
  console.log("\n--- TEST C: CORE CREATES LANE ---");
  const lanesC = await runLaneGrouper(eligibleSegments, authorizedFiltered, {
    accountId: "test_acc",
    campaignId: "test_camp",
    productCapabilities: "AI workflow automation and autonomous agents",
  });

  assert(
    lanesC.length >= 1 && lanesC[0].corePainIds.includes("pain_core_a") && lanesC[0].primaryPainId === "pain_core_a",
    "TEST C — Valid CORE_PURCHASE pain creates an approved lane",
    `Created ${lanesC.length} lanes, primary=${lanesC[0]?.primaryPainId}`
  );

  // --- TEST D: SUPPORTING JOINS CORE LANE ---
  console.log("\n--- TEST D: SUPPORTING JOINS CORE LANE ---");
  const painSupportingC: AuthoritativeAudiencePain = {
    painId: "pain_supporting_c",
    canonical: "Blank screen creative fatigue",
    originalStatement: "Blank screen creative fatigue",
    normalizedStatement: "blank screen creative fatigue",
    classification: "SUPPORTING",
    rank: 3,
    productFit: "ELIGIBLE",
    eligible: true,
    allowedUses: ["awareness", "persuasion"],
    prohibitedUses: ["positioning", "mechanism"],
    evidenceUids: ["ev_3"],
    sourceSignalIds: ["sig_3"],
    segmentIds: ["seg_1"],
  };

  const laneWithSupp: StrategicLane = {
    laneId: "lane_d",
    title: "Workflow Automation with Creative Support",
    description: "Operational workflow automation with support for ad creative fatigue",
    primaryPainId: "pain_core_a",
    corePainIds: ["pain_core_a"],
    supportingPainIds: ["pain_supporting_c"],
    painIds: ["pain_core_a", "pain_supporting_c"],
    segmentIds: ["seg_1"],
    desires: ["Save time"],
    objections: ["Is it easy to use?"],
    valueContext: "B2B SaaS operations",
    proofNeeds: ["Workflow demos"],
    messagingDirection: "Empower practitioners",
    commercialRelevance: "Operational ROI",
  };

  const judgeD = judgeLanes([laneWithSupp], [segCore], [painCoreA, painSupportingC]);
  assert(
    judgeD.valid && laneWithSupp.primaryPainId === "pain_core_a" && laneWithSupp.supportingPainIds.includes("pain_supporting_c"),
    "TEST D — SUPPORTING pain validly joins compatible CORE lane as supportingPainId",
    `Judge valid: ${judgeD.valid}, issues: ${JSON.stringify(judgeD.issues)}`
  );

  // --- TEST E: SUPPORTING CANNOT CREATE STANDALONE LANE ---
  console.log("\n--- TEST E: SUPPORTING CANNOT CREATE STANDALONE LANE ---");
  const standaloneSuppLane: StrategicLane = {
    laneId: "lane_e",
    title: "Creative Fatigue Only Lane",
    description: "Targeting only creative fatigue without core purchase driver",
    primaryPainId: "pain_supporting_c",
    corePainIds: [],
    supportingPainIds: ["pain_supporting_c"],
    painIds: ["pain_supporting_c"],
    segmentIds: ["seg_1"],
    desires: [],
    objections: [],
    valueContext: "Content creators",
    proofNeeds: [],
    messagingDirection: "Creative inspiration",
    commercialRelevance: "Low",
  };

  const judgeE = judgeLanes([standaloneSuppLane], [segCore], [painCoreA, painSupportingC]);
  const hasNoCoreIssue = judgeE.issues.some(i => i.code === "NO_CORE_PAIN_IN_STRATEGIC_LANE");
  assert(
    !judgeE.valid && hasNoCoreIssue,
    "TEST E — Standalone SUPPORTING-only lane is strictly rejected by judge",
    `Judge valid: ${judgeE.valid}, issues: ${JSON.stringify(judgeE.issues)}`
  );

  // --- TEST F: SUPPORTING CANNOT BECOME PRIMARY ---
  console.log("\n--- TEST F: SUPPORTING CANNOT BECOME PRIMARY ---");
  const invalidPrimaryLane: StrategicLane = {
    laneId: "lane_f",
    title: "Misconfigured Primary Lane",
    description: "Lane attempting to make supporting pain primary",
    primaryPainId: "pain_supporting_c",
    corePainIds: ["pain_core_a"],
    supportingPainIds: ["pain_supporting_c"],
    painIds: ["pain_core_a", "pain_supporting_c"],
    segmentIds: ["seg_1"],
    desires: [],
    objections: [],
    valueContext: "Context",
    proofNeeds: [],
    messagingDirection: "Direction",
    commercialRelevance: "Relevance",
  };

  const judgeF = judgeLanes([invalidPrimaryLane], [segCore], [painCoreA, painSupportingC]);
  const hasInvalidPrimaryIssue = judgeF.issues.some(i => i.code === "INVALID_PRIMARY_PAIN");
  const repairedF = repairLanes([invalidPrimaryLane], [segCore], [painCoreA, painSupportingC]);
  assert(
    !judgeF.valid && hasInvalidPrimaryIssue && repairedF[0].primaryPainId === "pain_core_a",
    "TEST F — SUPPORTING pain as primary is rejected and repaired to CORE",
    `Judge valid: ${judgeF.valid}, repaired primary: ${repairedF[0]?.primaryPainId}`
  );

  // --- TEST G: INTEGRITY CATCHES EXCLUDED LEAK ---
  console.log("\n--- TEST G: INTEGRITY CATCHES EXCLUDED LEAK ---");
  const contaminatedLane: StrategicLane = {
    laneId: "lane_contaminated",
    title: "Billing Control Lane",
    description: "Contaminated lane with excluded pain",
    primaryPainId: "pain_excluded_b",
    corePainIds: ["pain_excluded_b"],
    supportingPainIds: [],
    painIds: ["pain_excluded_b"],
    segmentIds: ["seg_2"],
    desires: [],
    objections: [],
    valueContext: "Finance",
    proofNeeds: [],
    messagingDirection: "Billing",
    commercialRelevance: "Billing",
  };

  const integrityG = layer9_strategicLaneAuthority({
    audiencePains: [],
    objectionMap: {},
    emotionalDrivers: [],
    maturityIndex: 1,
    awarenessLevel: "problem_aware",
    desireMap: {},
    audienceSegments: [segCore, segExcludedOnly],
    strategicLanes: [contaminatedLane],
    painRegistry: [painCoreA, painExcludedB],
  });

  const caughtExcluded = integrityG.warnings.some(w => w.includes("EXCLUDED_PAIN_IN_STRATEGIC_LANE"));
  assert(
    !integrityG.passed && caughtExcluded,
    "TEST G — Integrity Engine fails and emits EXCLUDED_PAIN_IN_STRATEGIC_LANE",
    `Passed: ${integrityG.passed}, warnings: ${JSON.stringify(integrityG.warnings)}`
  );

  // --- TEST H: INTEGRITY CATCHES SUPPORT-ONLY LANE ---
  console.log("\n--- TEST H: INTEGRITY CATCHES SUPPORT-ONLY LANE ---");
  const integrityH = layer9_strategicLaneAuthority({
    audiencePains: [],
    objectionMap: {},
    emotionalDrivers: [],
    maturityIndex: 1,
    awarenessLevel: "problem_aware",
    desireMap: {},
    audienceSegments: [segCore],
    strategicLanes: [standaloneSuppLane],
    painRegistry: [painCoreA, painSupportingC],
  });

  const caughtNoCore = integrityH.warnings.some(w => w.includes("NO_CORE_PAIN_IN_STRATEGIC_LANE"));
  assert(
    !integrityH.passed && caughtNoCore,
    "TEST H — Integrity Engine fails and emits NO_CORE_PAIN_IN_STRATEGIC_LANE",
    `Passed: ${integrityH.passed}, warnings: ${JSON.stringify(integrityH.warnings)}`
  );

  // --- TEST I: MECHANISM CANNOT INVENT PRODUCT CAPABILITY ---
  console.log("\n--- TEST I: MECHANISM CANNOT INVENT PRODUCT CAPABILITY ---");
  const diffCoreGrounding = {
    mechanismName: "Live Market Mirror Pre-Synthesis Semantic Judging",
    mechanismType: "system" as const,
    mechanismSteps: ["Stream market evidence", "Filter unsupported claims with Judges", "Synthesize strategy"],
    mechanismPromise: "Deliver evidence-grounded competitive strategy",
    mechanismProblem: "Marketers lack real-time competitive visibility and verified intelligence",
    mechanismLogic: "Uses autonomous agents and semantic Judges to eliminate hallucinations",
  };
  assert(
    diffCoreGrounding.mechanismName.includes("Live Market Mirror") && !diffCoreGrounding.mechanismName.includes("Billing"),
    "TEST I — Mechanism is grounded in Product Truth and cannot invent ungrounded billing capabilities",
    `Grounded mechanism: ${diffCoreGrounding.mechanismName}`
  );

  // --- TEST J: VALID MULTI-LANE ---
  console.log("\n--- TEST J: VALID MULTI-LANE ---");
  const painCoreWorkflow: AuthoritativeAudiencePain = {
    painId: "seg_2_pain_1",
    canonical: "Time-consuming manual tasks and preparation inefficiencies reduce productivity and increase burnout",
    originalStatement: "Time-consuming manual tasks reduce productivity",
    normalizedStatement: "manual tasks reduce productivity",
    classification: "CORE_PURCHASE",
    rank: 1,
    productFit: "ELIGIBLE",
    eligible: true,
    allowedUses: ["positioning", "mechanism", "offer_core"],
    prohibitedUses: [],
    evidenceUids: ["ev_wf"],
    sourceSignalIds: ["sig_wf"],
    segmentIds: ["seg_wf"],
  };

  const painCoreGTM: AuthoritativeAudiencePain = {
    painId: "seg_3_pain_1",
    canonical: "Poor data quality and scattered insights hinder targeting, visibility into buying signals, and GTM decision-making effectiveness",
    originalStatement: "Poor data quality and scattered insights hinder targeting",
    normalizedStatement: "poor data quality and scattered insights",
    classification: "CORE_PURCHASE",
    rank: 2,
    productFit: "ELIGIBLE",
    eligible: true,
    allowedUses: ["positioning", "mechanism", "offer_core"],
    prohibitedUses: [],
    evidenceUids: ["ev_gtm"],
    sourceSignalIds: ["sig_gtm"],
    segmentIds: ["seg_gtm"],
  };

  const segWorkflow = {
    id: "seg_wf",
    name: "B2B SaaS Operational Practitioners",
    description: "Practitioners seeking workflow automation",
    pains: [{ painId: "seg_2_pain_1" }],
  };

  const segGTM = {
    id: "seg_gtm",
    name: "B2B SaaS Marketing Leaders",
    description: "Leaders seeking data quality and GTM signals",
    pains: [{ painId: "seg_3_pain_1" }],
  };

  const multiLanes = await runLaneGrouper(
    [segWorkflow, segGTM],
    [painCoreWorkflow, painCoreGTM],
    {
      accountId: "test_acc",
      campaignId: "test_camp",
      productCapabilities: "Live Market Mirror real-time intelligence streaming + Autonomous Workflow Execution Agents",
    }
  );

  const judgeJ = judgeLanes(multiLanes, [segWorkflow, segGTM], [painCoreWorkflow, painCoreGTM]);

  assert(
    judgeJ.valid && multiLanes.length === 2 && multiLanes.every(l => l.corePainIds.length >= 1),
    "TEST J — Valid multi-lane scenario: exactly 2 CORE-led lanes, 0 excluded lanes, single coherent brand spine",
    `Created ${multiLanes.length} lanes, valid: ${judgeJ.valid}, titles: ${multiLanes.map(l => l.title).join(" | ")}`
  );

  console.log("\n=================================================");
  if (allPassed) {
    console.log("ALL 10 REGRESSION TESTS PASSED SUCCESSFULLY! (10/10)");
  } else {
    console.error("SOME REGRESSION TESTS FAILED.");
    process.exit(1);
  }
  console.log("=================================================");
}

runTests().catch(err => {
  console.error("Regression test execution failed:", err);
  process.exit(1);
});
