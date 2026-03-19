import { describe, test, expect } from "vitest";
import { buildPositioningLock } from "../offer-engine/engine";
import type { OfferPositioningInput, OfferDifferentiationInput } from "../offer-engine/types";
import { analyzePersuasion } from "../persuasion-engine/engine";
import type {
  PersuasionMIInput,
  PersuasionAudienceInput,
  PersuasionPositioningInput,
  PersuasionDifferentiationInput,
  PersuasionOfferInput,
  PersuasionFunnelInput,
  PersuasionIntegrityInput,
  PersuasionAwarenessInput,
} from "../persuasion-engine/types";
import type { SignalLineageEntry } from "../shared/signal-lineage";

function makeSignal(engine: string, category: string, text: string, idx: number): SignalLineageEntry {
  return {
    signalId: `${engine.toUpperCase()}_${category.toUpperCase()}_${String(idx).padStart(3, "0")}`,
    originEngine: engine,
    signalCategory: category,
    signalText: text,
    parentSignalId: null,
    hopDepth: 0,
    signalPath: [engine],
    createdAt: new Date().toISOString(),
  };
}

const basePositioning: OfferPositioningInput = {
  contrastAxis: "revenue growth vs cost reduction",
  enemyDefinition: "spreadsheet-first agency",
  narrativeDirection: "forward",
  positioningStatement: "We help SaaS founders grow ARR without adding headcount",
  uniqueValue: "revenue-focused systems",
};

const baseDifferentiation: OfferDifferentiationInput = {
  pillars: ["outcome-guaranteed", "done-for-you"],
  mechanismCore: {
    mechanismName: "Revenue Flywheel System",
    mechanismType: "system",
    mechanismSteps: ["audit", "build", "deploy", "optimize"],
    mechanismPromise: "Predictable ARR growth",
    mechanismProblem: "Unpredictable revenue",
    mechanismLogic: "Systematic pipeline automation",
  },
  mechanismFraming: {
    name: "Revenue Flywheel System",
    description: "Automated pipeline system",
    supported: true,
    proofBasis: [],
    type: "system",
  },
  claimStructures: [],
  proofArchitecture: [],
  authorityMode: null,
  confidenceScore: 0.9,
};

describe("buildPositioningLock – lockedDecisions and nonGenericAnchors", () => {
  const THREE_SIGNALS: SignalLineageEntry[] = [
    makeSignal("audience", "pain", "unpredictable revenue blocks growth", 1),
    makeSignal("positioning", "differentiation", "automated pipeline outperforms manual tracking", 2),
    makeSignal("differentiation", "mechanism", "revenue flywheel system delivers predictable ARR", 3),
  ];

  test("populates lockedDecisions with all four decision types when fully specified", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    expect(lock.lockedDecisions.length).toBeGreaterThanOrEqual(3);
    expect(lock.lockedDecisions.some(d => d.startsWith("contrast_axis:"))).toBe(true);
    expect(lock.lockedDecisions.some(d => d.startsWith("enemy:"))).toBe(true);
    expect(lock.lockedDecisions.some(d => d.startsWith("mechanism:"))).toBe(true);
    expect(lock.lockedDecisions.some(d => d.startsWith("narrative_direction:"))).toBe(true);
  });

  test("lockedDecisions includes contrastAxis text verbatim", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    const axisDecision = lock.lockedDecisions.find(d => d.startsWith("contrast_axis:"))!;
    expect(axisDecision).toContain("revenue growth vs cost reduction");
  });

  test("lockedDecisions includes enemyDefinition text verbatim", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    const enemyDecision = lock.lockedDecisions.find(d => d.startsWith("enemy:"))!;
    expect(enemyDecision).toContain("spreadsheet-first agency");
  });

  test("lockedDecisions includes mechanismName text verbatim", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    const mechDecision = lock.lockedDecisions.find(d => d.startsWith("mechanism:"))!;
    expect(mechDecision).toContain("Revenue Flywheel System");
  });

  test("nonGenericAnchors contains only tokens longer than 3 chars", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    for (const anchor of lock.nonGenericAnchors) {
      expect(anchor.length).toBeGreaterThan(3);
    }
  });

  test("nonGenericAnchors are unique (no duplicates)", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    const unique = [...new Set(lock.nonGenericAnchors)];
    expect(lock.nonGenericAnchors).toHaveLength(unique.length);
  });

  test("nonGenericAnchors contains tokens from contrastAxis, enemyDefinition, and mechanismName", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    expect(lock.nonGenericAnchors.length).toBeGreaterThan(0);
    const joined = lock.nonGenericAnchors.join(" ").toLowerCase();
    const hasAxisToken = joined.includes("revenue") || joined.includes("growth") || joined.includes("reduction");
    expect(hasAxisToken).toBe(true);
  });

  test("empty positioning produces empty lockedDecisions and nonGenericAnchors", () => {
    const emptyPos: OfferPositioningInput = {
      contrastAxis: "",
      enemyDefinition: "",
      narrativeDirection: "",
      positioningStatement: "",
      uniqueValue: "",
    };
    const emptyDiff: OfferDifferentiationInput = {
      pillars: [],
      mechanismCore: null,
      mechanismFraming: { name: "", description: "", supported: false, proofBasis: [], type: "none" },
      claimStructures: [],
      proofArchitecture: [],
      authorityMode: null,
      confidenceScore: null,
    };
    const lock = buildPositioningLock(emptyPos, emptyDiff);
    expect(lock.lockedDecisions).toHaveLength(0);
    expect(lock.nonGenericAnchors).toHaveLength(0);
    expect(lock.locked).toBe(false);
  });

  test("partial positioning (only contrastAxis) produces one lockedDecision", () => {
    const partialPos: OfferPositioningInput = {
      contrastAxis: "speed vs thoroughness",
      enemyDefinition: "",
      narrativeDirection: "",
      positioningStatement: "",
      uniqueValue: "",
    };
    const emptyDiff: OfferDifferentiationInput = {
      pillars: [],
      mechanismCore: null,
      mechanismFraming: { name: "", description: "", supported: false, proofBasis: [], type: "none" },
      claimStructures: [],
      proofArchitecture: [],
      authorityMode: null,
      confidenceScore: null,
    };
    const lock = buildPositioningLock(partialPos, emptyDiff);
    expect(lock.lockedDecisions).toHaveLength(1);
    expect(lock.lockedDecisions[0]).toMatch(/^contrast_axis:/);
  });

  test("lock.locked is true when any of contrastAxis, enemyDefinition, mechanismName are set", () => {
    const lock = buildPositioningLock(basePositioning, baseDifferentiation);
    expect(lock.locked).toBe(true);
  });
});

function buildTestPersuasionInputs(overrides: {
  offerLockedDecisions?: string[];
  offerNonGenericAnchors?: string[];
  routeNameOverride?: string;
} = {}): {
  mi: PersuasionMIInput;
  audience: PersuasionAudienceInput;
  positioning: PersuasionPositioningInput;
  differentiation: PersuasionDifferentiationInput;
  offer: PersuasionOfferInput;
  funnel: PersuasionFunnelInput;
  integrity: PersuasionIntegrityInput;
  awareness: PersuasionAwarenessInput;
} {
  const mi: PersuasionMIInput = {
    marketDiagnosis: "SaaS founders struggle with unpredictable revenue",
    opportunitySignals: [
      "founders want ARR growth without headcount",
      "manual spreadsheet processes create revenue leakage",
      "automated pipeline systems outperform manual tracking",
    ],
    competitorWeaknesses: ["no guarantees", "generic advice"],
    marketMaturity: "growing",
    multiSourceSignals: null,
  };

  const audience: PersuasionAudienceInput = {
    audiencePains: [
      "unpredictable monthly revenue",
      "too much time on manual reporting",
    ],
    objections: [
      "worried about setup complexity",
      "not sure if ROI is guaranteed",
    ],
    trustBarriers: ["no proof", "unknown brand"],
    emotionalDrivers: ["desire for financial freedom", "fear of stagnation"],
    desireMap: { "ARR growth": 0.9, "time savings": 0.8 },
    audienceSegments: [],
  };

  const positioning: PersuasionPositioningInput = {
    narrativeDirection: "forward",
    enemyDefinition: "spreadsheet-first agency",
    contrastAxis: "revenue growth vs cost reduction",
    positioningStatement: "Revenue Flywheel System for SaaS founders",
  };

  const differentiation: PersuasionDifferentiationInput = {
    pillars: ["outcome-guaranteed", "done-for-you"],
    mechanismCore: {
      mechanismName: "Revenue Flywheel System",
      mechanismType: "system",
      mechanismSteps: ["audit", "build", "deploy", "optimize"],
      mechanismPromise: "Predictable ARR growth",
      mechanismProblem: "Unpredictable revenue",
      mechanismLogic: "Systematic pipeline automation",
    },
    mechanismFraming: {
      name: "Revenue Flywheel System",
      description: "Automated pipeline",
      supported: true,
      proofBasis: ["3 case studies"],
      type: "system",
    },
    claimStructures: [],
    proofArchitecture: [],
    authorityMode: null,
    confidenceScore: 0.85,
  };

  const offer: PersuasionOfferInput = {
    offerName: "Revenue Flywheel Accelerator",
    coreOutcome: "30% ARR growth in 90 days",
    mechanismDescription: "Revenue Flywheel System drives predictable pipeline",
    deliverables: ["pipeline audit", "automation build", "weekly reporting"],
    proofAlignment: ["case study: 2.3x ARR in 6 months"],
    offerStrengthScore: 0.82,
    riskNotes: ["ROI guarantee included"],
    frictionLevel: 2,
    lockedDecisions: overrides.offerLockedDecisions ?? [
      "contrast_axis: revenue growth vs cost reduction",
      "enemy: spreadsheet-first agency",
      "mechanism: Revenue Flywheel System",
    ],
    nonGenericAnchors: overrides.offerNonGenericAnchors ?? [
      "revenue", "growth", "flywheel", "spreadsheet", "agency",
    ],
  };

  const funnel: PersuasionFunnelInput = {
    funnelName: "SaaS Growth Funnel",
    funnelType: "webinar",
    stageMap: [],
    trustPath: [],
    proofPlacements: [],
    commitmentLevel: "high",
    frictionMap: [],
    entryTrigger: { mechanismType: "opt-in", purpose: "education" },
    funnelStrengthScore: 0.75,
  };

  const integrity: PersuasionIntegrityInput = {
    overallIntegrityScore: 0.85,
    safeToExecute: true,
    layerResults: [],
    structuralWarnings: [],
    flaggedInconsistencies: [],
  };

  const awareness: PersuasionAwarenessInput = {
    entryMechanismType: "webinar",
    targetReadinessStage: "solution_aware",
    triggerClass: "desire",
    trustRequirement: "medium",
    funnelCompatibility: "compatible",
    awarenessStrengthScore: 0.78,
    frictionNotes: [],
  };

  return { mi, audience, positioning, differentiation, offer, funnel, integrity, awareness };
}

const BASE_LINEAGE: SignalLineageEntry[] = [
  makeSignal("audience", "pain", "unpredictable revenue blocks growth", 1),
  makeSignal("positioning", "differentiation", "automated pipeline outperforms manual tracking", 2),
  makeSignal("differentiation", "mechanism", "revenue flywheel system delivers predictable ARR", 3),
];

describe("analyzePersuasion – positioning lock drift detection", () => {
  test("passes through without lock violations when lockedDecisions is empty", () => {
    const { mi, audience, positioning, differentiation, offer, funnel, integrity, awareness } = buildTestPersuasionInputs({
      offerLockedDecisions: [],
      offerNonGenericAnchors: [],
    });
    const result = analyzePersuasion(mi, audience, positioning, differentiation, offer, funnel, integrity, awareness, BASE_LINEAGE);
    const lockDriftWarnings = result.structuralWarnings.filter(w => w.includes("POSITIONING LOCK DRIFT"));
    expect(lockDriftWarnings).toHaveLength(0);
  });

  test("detects drift when lockedDecisions are semantically distant from persuasion output", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const driftOffer: PersuasionOfferInput = {
      offerName: "Generic Business Package",
      coreOutcome: "Better results",
      mechanismDescription: "Standard optimization approach",
      deliverables: ["consulting", "reports"],
      proofAlignment: [],
      offerStrengthScore: 0.4,
      riskNotes: [],
      frictionLevel: 3,
      lockedDecisions: [
        "contrast_axis: quantum computing vs classical hardware",
        "enemy: legacy mainframe vendor",
        "mechanism: QuantumLeap Neural Processor",
      ],
      nonGenericAnchors: ["quantum", "mainframe", "neural", "processor"],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, driftOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const lockDriftWarnings = result.structuralWarnings.filter(w => w.includes("POSITIONING LOCK DRIFT"));
    expect(lockDriftWarnings.length).toBeGreaterThan(0);
  });

  test("POSITIONING LOCK DRIFT warning includes score and threshold", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const driftOffer: PersuasionOfferInput = {
      offerName: "Generic Consulting Package",
      coreOutcome: "Better results",
      mechanismDescription: "Standard approach",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.3,
      riskNotes: [],
      frictionLevel: 3,
      lockedDecisions: [
        "contrast_axis: deep sea fishing vs freshwater angling",
        "enemy: freshwater bait shop operator",
        "mechanism: OceanDepth Sonar System",
      ],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, driftOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const driftWarning = result.structuralWarnings.find(w => w.includes("POSITIONING LOCK DRIFT"));
    if (driftWarning) {
      expect(driftWarning).toMatch(/score=\d+\.\d+/);
      expect(driftWarning).toMatch(/threshold=0\.20/);
    }
  });

  test("generic drift warning fires when most nonGenericAnchors are absent from route text", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const genericOffer: PersuasionOfferInput = {
      offerName: "Standard Growth Package",
      coreOutcome: "Improved performance",
      mechanismDescription: "Proven methodology",
      deliverables: ["strategy session", "implementation guide"],
      proofAlignment: [],
      offerStrengthScore: 0.5,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [],
      nonGenericAnchors: ["xylophone", "zeppelin", "quasar", "neutrino", "parallax", "cataclysm"],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, genericOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const genericWarnings = result.structuralWarnings.filter(w => w.includes("GENERIC DRIFT WARNING"));
    expect(genericWarnings.length).toBeGreaterThan(0);
  });

  test("generic drift warning includes anchor counts", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const genericOffer: PersuasionOfferInput = {
      offerName: "Growth Package",
      coreOutcome: "Better performance",
      mechanismDescription: "Proven approach",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.5,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [],
      nonGenericAnchors: ["xylophone", "zeppelin", "quasar", "neutrino", "parallax"],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, genericOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const genericWarning = result.structuralWarnings.find(w => w.includes("GENERIC DRIFT WARNING"));
    if (genericWarning) {
      expect(genericWarning).toMatch(/\d+\/\d+ positioning anchors/);
      expect(genericWarning).toContain("missing:");
    }
  });

  test("no generic drift warning when most anchors ARE present in route output", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const onTargetOffer: PersuasionOfferInput = {
      offerName: "Revenue Flywheel Education Program",
      coreOutcome: "Predictable ARR growth through revenue flywheel",
      mechanismDescription: "Revenue flywheel system automates spreadsheet-based tracking",
      deliverables: ["flywheel audit", "revenue pipeline build"],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [],
      nonGenericAnchors: ["revenue", "flywheel", "growth"],
    };
    const flyWheelLineage: SignalLineageEntry[] = [
      makeSignal("audience", "pain", "unpredictable revenue blocks flywheel growth", 1),
      makeSignal("positioning", "differentiation", "revenue flywheel pipeline automation", 2),
      makeSignal("differentiation", "mechanism", "flywheel system drives ARR growth", 3),
    ];
    const result = analyzePersuasion(mi, audience, positioning, differentiation, onTargetOffer, funnel, integrity, awareness, flyWheelLineage);
    const genericWarnings = result.structuralWarnings.filter(w => w.includes("GENERIC DRIFT WARNING"));
    expect(genericWarnings).toHaveLength(0);
  });

  test("both lock drift and generic warnings can coexist in structuralWarnings", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const badOffer: PersuasionOfferInput = {
      offerName: "Generic Consulting Package",
      coreOutcome: "Better results",
      mechanismDescription: "Standard approach",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.3,
      riskNotes: [],
      frictionLevel: 3,
      lockedDecisions: [
        "contrast_axis: deep sea fishing vs freshwater angling",
        "enemy: freshwater bait shop",
        "mechanism: OceanDepth System",
      ],
      nonGenericAnchors: ["xylophone", "zeppelin", "quasar", "neutrino", "parallax"],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, badOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const allWarnings = result.structuralWarnings;
    const hasLockDrift = allWarnings.some(w => w.includes("POSITIONING LOCK DRIFT"));
    const hasGenericDrift = allWarnings.some(w => w.includes("GENERIC DRIFT WARNING"));
    expect(hasLockDrift || hasGenericDrift).toBe(true);
  });
});

describe("buildPersuasionRoutes – locked decisions enforce route content at generation time", () => {
  test("routeName includes locked axis suffix when lockedDecisions contains contrast_axis", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: ["contrast_axis: automated pipeline vs manual spreadsheet tracking"],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    expect(result.primaryRoute.routeName).toMatch(/\[locked axis:/);
  });

  test("frictionNotes on primaryRoute includes LOCK CONSTRAINT when lockedDecisions provided", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [
        "contrast_axis: automated pipeline vs manual tracking",
        "enemy: legacy spreadsheet vendor",
        "mechanism: RevenueFlywheelOS",
      ],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const lockConstraints = result.primaryRoute.frictionNotes.filter(n => n.startsWith("LOCK CONSTRAINT"));
    expect(lockConstraints.length).toBeGreaterThanOrEqual(1);
    expect(lockConstraints.some(n => n.includes("YOU MUST NOT reframe"))).toBe(true);
  });

  test("frictionNotes includes ENEMY ANCHOR note when enemy is in lockedDecisions", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: ["enemy: legacy spreadsheet vendor"],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const enemyNote = result.primaryRoute.frictionNotes.find(n => n.startsWith("ENEMY ANCHOR:"));
    expect(enemyNote).toBeDefined();
    expect(enemyNote).toMatch(/MUST be reflected in objection handling/);
  });

  test("frictionNotes includes MECHANISM ANCHOR note when mechanism is in lockedDecisions", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: ["mechanism: RevenueFlywheelOS"],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const mechNote = result.primaryRoute.frictionNotes.find(n => n.startsWith("MECHANISM ANCHOR:"));
    expect(mechNote).toBeDefined();
    expect(mechNote).toMatch(/MUST reflect .* as the solution vehicle/);
  });

  test("primaryInfluenceDrivers includes a [locked_anchor] entry when nonGenericAnchors provided", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [],
      nonGenericAnchors: ["flywheel", "revenue", "pipeline"],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const lockedDriver = result.primaryRoute.primaryInfluenceDrivers.find(d => d.startsWith("[locked_anchor]"));
    expect(lockedDriver).toBeDefined();
    expect(lockedDriver).toContain("flywheel");
  });

  test("frictionNotes includes ANCHOR REQUIREMENT when nonGenericAnchors provided", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [],
      nonGenericAnchors: ["flywheel", "revenue", "pipeline"],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const anchorReq = result.primaryRoute.frictionNotes.find(n => n.startsWith("ANCHOR REQUIREMENT"));
    expect(anchorReq).toBeDefined();
    expect(anchorReq).toContain("flywheel");
  });

  test("narrative_direction in lockedDecisions generates a LOCK CONSTRAINT for that value", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const lockedOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: ["narrative_direction: from chaos to controlled growth"],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, lockedOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const lockConstraints = result.primaryRoute.frictionNotes.filter(n => n.startsWith("LOCK CONSTRAINT"));
    expect(lockConstraints.some(n => n.includes("chaos to controlled growth"))).toBe(true);
  });

  test("no lock constraint notes injected when lockedDecisions and nonGenericAnchors are both empty", () => {
    const { mi, audience, positioning, differentiation, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const bareOffer: PersuasionOfferInput = {
      offerName: "Revenue Automation Program",
      coreOutcome: "Predictable ARR growth",
      mechanismDescription: "Revenue flywheel system",
      deliverables: [],
      proofAlignment: [],
      offerStrengthScore: 0.8,
      riskNotes: [],
      frictionLevel: 2,
      lockedDecisions: [],
      nonGenericAnchors: [],
    };
    const result = analyzePersuasion(mi, audience, positioning, differentiation, bareOffer, funnel, integrity, awareness, BASE_LINEAGE);
    const lockNotes = result.primaryRoute.frictionNotes.filter(n => n.startsWith("LOCK CONSTRAINT") || n.startsWith("ANCHOR REQUIREMENT") || n.startsWith("ENEMY ANCHOR") || n.startsWith("MECHANISM ANCHOR"));
    expect(lockNotes).toHaveLength(0);
  });
});

describe("PersuasionOfferInput – lockedDecisions and nonGenericAnchors are optional", () => {
  test("offer without lockedDecisions or nonGenericAnchors does not crash analyzePersuasion", () => {
    const { mi, audience, positioning, differentiation, offer, funnel, integrity, awareness } = buildTestPersuasionInputs();
    const bareOffer: PersuasionOfferInput = {
      offerName: offer.offerName,
      coreOutcome: offer.coreOutcome,
      mechanismDescription: offer.mechanismDescription,
      deliverables: offer.deliverables,
      proofAlignment: offer.proofAlignment,
      offerStrengthScore: offer.offerStrengthScore,
      riskNotes: offer.riskNotes,
      frictionLevel: offer.frictionLevel,
    };
    expect(() => analyzePersuasion(mi, audience, positioning, differentiation, bareOffer, funnel, integrity, awareness, BASE_LINEAGE)).not.toThrow();
  });
});
