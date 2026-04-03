import { aiChat } from "../../ai-client";
import {
  ENGINE_VERSION,
  RETENTION_SCORE_WEIGHTS,
  GUARD_THRESHOLDS,
  BOUNDARY_BLOCKED_PATTERNS,
  STATUS,
} from "./constants";
import {
  sanitizeBoundary,
  normalizeConfidence,
  assessDataReliability,
  detectGenericOutput,
  createEmptyReliability,
} from "../../engine-hardening";
import { assessStrategyAcceptability } from "../../shared/strategy-acceptability";
import { deduplicateWarnings } from "../dependency-validation";
import type {
  RetentionInput,
  RetentionLoop,
  ChurnRiskFlag,
  LTVExpansionPath,
  UpsellTrigger,
  RetentionGuardResult,
  RetentionResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

function runGuardLayer(input: RetentionInput): RetentionGuardResult {
  const flags: string[] = [];
  const hasRawInputs = !!(input.customerJourneyData as any)?.rawInputs;
  const rawInputs = (input.customerJourneyData as any)?.rawInputs;
  const derivedMetrics = (input.customerJourneyData as any)?.derivedMetrics;

  let valueDeliveryClarity = 0.5;
  if (input.offerStructure.coreOutcome && input.offerStructure.coreOutcome.length > 10) {
    valueDeliveryClarity += 0.2;
  }
  if (input.offerStructure.deliverables.length > 0) {
    valueDeliveryClarity += 0.15;
  }
  if (input.offerStructure.proofStrength && input.offerStructure.proofStrength > 0.5) {
    valueDeliveryClarity += 0.15;
  }
  if (hasRawInputs && rawInputs.totalCustomers > 0) {
    valueDeliveryClarity += 0.2;
  }
  valueDeliveryClarity = clamp(valueDeliveryClarity);

  if (valueDeliveryClarity < GUARD_THRESHOLDS.minValueDeliveryClarity) {
    flags.push("Value delivery unclear — retention mechanisms cannot be anchored to clear outcomes");
  }

  let trustDecayRisk = 0.3;
  const highSeverityObjections = input.postPurchaseObjections.filter(o => o.severity > 0.6);
  if (highSeverityObjections.length > 3) {
    trustDecayRisk += 0.3;
  } else if (highSeverityObjections.length > 1) {
    trustDecayRisk += 0.15;
  }
  if (!input.offerStructure.riskReducers || input.offerStructure.riskReducers.length === 0) {
    trustDecayRisk += 0.2;
  }
  if (hasRawInputs && derivedMetrics && derivedMetrics.refundRate < 0.05) {
    trustDecayRisk -= 0.15;
  }
  trustDecayRisk = clamp(trustDecayRisk);

  if (trustDecayRisk > GUARD_THRESHOLDS.maxTrustDecayRisk) {
    flags.push("Trust decays after purchase — high-severity post-purchase objections detected with insufficient risk reducers");
  }

  let retentionMechanismPresence = 0.0;
  const journey = input.customerJourneyData;
  if (journey.repeatPurchaseRate && journey.repeatPurchaseRate > 0.1) {
    retentionMechanismPresence += 0.3;
  } else if (hasRawInputs && derivedMetrics && derivedMetrics.repeatPurchaseRate > 0) {
    retentionMechanismPresence += 0.2;
  }
  if (journey.touchpoints.length > 2) {
    retentionMechanismPresence += 0.2;
  }
  if (journey.retentionWindowDays && journey.retentionWindowDays > 0) {
    retentionMechanismPresence += 0.2;
  }
  if (input.purchaseMotivations.length > 0) {
    retentionMechanismPresence += 0.15;
  }
  if (journey.engagementDecayRate && journey.engagementDecayRate < 0.5) {
    retentionMechanismPresence += 0.15;
  }
  if (hasRawInputs && rawInputs.totalPurchases > 0 && rawInputs.returningCustomers > 0) {
    retentionMechanismPresence += 0.25;
  }
  if (hasRawInputs && rawInputs.dataWindowDays > 0) {
    retentionMechanismPresence += 0.1;
  }
  retentionMechanismPresence = clamp(retentionMechanismPresence);

  if (retentionMechanismPresence < GUARD_THRESHOLDS.minRetentionMechanismPresence) {
    flags.push("Retention mechanisms missing — insufficient journey touchpoints and no repeat purchase signals detected");
  }

  return {
    passed: flags.length === 0,
    flags,
    valueDeliveryClarity,
    trustDecayRisk,
    retentionMechanismPresence,
  };
}

function buildRetentionPrompt(input: RetentionInput): string {
  const journey = input.customerJourneyData;
  const offer = input.offerStructure;

  const touchpointSummary = journey.touchpoints.length > 0
    ? journey.touchpoints.map(tp => `- ${tp.stage} (${tp.channel}): engagement=${tp.engagementScore.toFixed(2)}, dropoff=${tp.dropoffRate.toFixed(2)}`).join("\n")
    : "No touchpoint data available";

  const motivationSummary = input.purchaseMotivations.length > 0
    ? input.purchaseMotivations.map(m => `- ${m.motivation} (strength: ${m.strength.toFixed(2)}, category: ${m.category})`).join("\n")
    : "No purchase motivation data available";

  const objectionSummary = input.postPurchaseObjections.length > 0
    ? input.postPurchaseObjections.map(o => `- ${o.objection} (severity: ${o.severity.toFixed(2)}, frequency: ${o.frequency.toFixed(2)})`).join("\n")
    : "No post-purchase objection data available";

  const rawInputs = (journey as any).rawInputs;
  const derivedMetrics = (journey as any).derivedMetrics;
  const rawDataSection = rawInputs ? `
RAW BUSINESS DATA (${rawInputs.dataWindowDays || 30}-day window):
- Total Customers: ${rawInputs.totalCustomers}
- Total Purchases: ${rawInputs.totalPurchases}
- Returning Customers: ${rawInputs.returningCustomers}
- Average Order Value: $${rawInputs.averageOrderValue || 0}
- Refund Count: ${rawInputs.refundCount || 0}
- Monthly Active Customers: ${rawInputs.monthlyCustomers || 0}

DERIVED METRICS:
- Repeat Purchase Rate: ${((derivedMetrics?.repeatPurchaseRate || 0) * 100).toFixed(1)}%
- Purchase Frequency: ${derivedMetrics?.purchaseFrequency?.toFixed(2) || "N/A"}
- Refund Rate: ${((derivedMetrics?.refundRate || 0) * 100).toFixed(1)}%
- Estimated LTV: $${derivedMetrics?.estimatedLTV?.toFixed(2) || "N/A"}
- Churn Risk Estimate: ${((derivedMetrics?.churnRiskEstimate || 0) * 100).toFixed(1)}%
- Estimated Lifespan: ${derivedMetrics?.estimatedLifespanMonths || "N/A"} months` : "";

  return `You are a Retention Strategy Engine. Analyze the following customer retention data and produce actionable retention outputs.

OFFER STRUCTURE:
- Offer: ${offer.offerName || "Unknown"}
- Core Outcome: ${offer.coreOutcome || "Not defined"}
- Deliverables: ${(offer.deliverables || []).length > 0 ? offer.deliverables.join(", ") : "None specified"}
- Mechanism: ${offer.mechanismDescription || "Not defined"}
- Proof Strength: ${offer.proofStrength ?? "Unknown"}
- Risk Reducers: ${(offer.riskReducers || []).length > 0 ? offer.riskReducers.join(", ") : "None"}

CUSTOMER JOURNEY:
- Avg Time to Conversion: ${journey.avgTimeToConversion ?? "Unknown"} days
- Repeat Purchase Rate: ${journey.repeatPurchaseRate ?? "Unknown"}
- Churn Rate: ${journey.churnRate ?? "Unknown"}
- Customer LTV: ${journey.customerLifetimeValue ?? "Unknown"}
- Retention Window: ${journey.retentionWindowDays ?? "Unknown"} days
- Engagement Decay Rate: ${journey.engagementDecayRate ?? "Unknown"}
${rawDataSection}

TOUCHPOINTS:
${touchpointSummary}

PURCHASE MOTIVATIONS:
${motivationSummary}

POST-PURCHASE OBJECTIONS:
${objectionSummary}

Respond ONLY with a JSON object (no markdown, no explanation) with this exact structure:
{
  "retentionLoops": [
    {
      "name": "string",
      "type": "string (engagement_loop|value_reinforcement|community_loop|habit_loop|reward_loop|milestone_loop|feedback_loop|referral_loop)",
      "description": "string",
      "triggerCondition": "string",
      "expectedImpact": 0.0-1.0,
      "implementationDifficulty": 0.0-1.0,
      "priorityScore": 0.0-1.0
    }
  ],
  "churnRiskFlags": [
    {
      "riskFactor": "string",
      "severity": 0.0-1.0,
      "timeframe": "string",
      "mitigationStrategy": "string",
      "dataConfidence": 0.0-1.0
    }
  ],
  "ltvExpansionPaths": [
    {
      "pathName": "string",
      "description": "string",
      "estimatedLTVIncrease": 0.0-1.0,
      "requiredConditions": ["string"],
      "riskNotes": ["string"],
      "confidenceScore": 0.0-1.0
    }
  ],
  "upsellTriggers": [
    {
      "triggerName": "string",
      "triggerCondition": "string",
      "suggestedOffer": "string",
      "timing": "string",
      "expectedConversionRate": 0.0-1.0,
      "priorityRank": 1
    }
  ]
}`;
}

function buildFallbackResult(input: RetentionInput, guardResult: RetentionGuardResult, startTime: number): RetentionResult {
  const retentionLoops: RetentionLoop[] = [
    {
      name: "Post-Purchase Value Reinforcement",
      type: "value_reinforcement",
      description: "Reinforce value delivery within first 7 days post-purchase through outcome reminders and success milestones",
      triggerCondition: "Customer completes purchase",
      expectedImpact: 0.4,
      implementationDifficulty: 0.3,
      priorityScore: 0.8,
    },
    {
      name: "Engagement Check-in Loop",
      type: "engagement_loop",
      description: "Periodic check-ins to gather feedback, surface usage tips, and prevent silent churn",
      triggerCondition: "14 days since last engagement",
      expectedImpact: 0.35,
      implementationDifficulty: 0.2,
      priorityScore: 0.7,
    },
    {
      name: "Post-Purchase Reinforcement Sequence",
      type: "habit_loop",
      description: "Structured onboarding reinforcement that builds product usage habits in the first 30 days",
      triggerCondition: "Days 1, 3, 7, 14, 30 post-purchase",
      expectedImpact: 0.45,
      implementationDifficulty: 0.4,
      priorityScore: 0.75,
    },
    {
      name: "Win-Back Re-engagement Loop",
      type: "milestone_loop",
      description: "Automated re-engagement for at-risk customers showing declining activity patterns",
      triggerCondition: "30 days of declining engagement or inactivity",
      expectedImpact: 0.3,
      implementationDifficulty: 0.35,
      priorityScore: 0.6,
    },
  ];

  const churnRiskFlags: ChurnRiskFlag[] = [
    {
      riskFactor: "Insufficient retention data — recommend running retention experiments to gather baseline metrics",
      severity: 0.5,
      timeframe: "30-60 days",
      mitigationStrategy: "Implement basic engagement tracking and post-purchase feedback collection",
      dataConfidence: 0.3,
    },
    {
      riskFactor: "No established post-purchase reinforcement — early churn risk elevated",
      severity: 0.6,
      timeframe: "0-14 days post-purchase",
      mitigationStrategy: "Deploy immediate value reinforcement sequence within 48 hours of purchase",
      dataConfidence: 0.4,
    },
  ];

  const ltvExpansionPaths: LTVExpansionPath[] = [
    {
      pathName: "Baseline Engagement Expansion",
      description: "Increase customer touchpoints to establish baseline retention metrics before advanced optimization",
      estimatedLTVIncrease: 0.15,
      requiredConditions: ["Basic engagement tracking active", "Post-purchase email sequence deployed"],
      riskNotes: ["Limited data may lead to conservative estimates"],
      confidenceScore: 0.3,
    },
  ];

  return {
    status: STATUS.PROVISIONAL,
    statusMessage: "Retention analysis is provisional — baseline retention mechanisms generated, retention experiments recommended",
    retentionLoops,
    churnRiskFlags,
    ltvExpansionPaths,
    upsellTriggers: [],
    guardResult,
    boundaryCheck: { passed: true, violations: [] },
    structuralWarnings: [
      "Fallback mode activated due to guard layer flags",
      ...guardResult.flags,
    ],
    confidenceScore: 0.35,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    dataReliability: {
      overallReliability: 0.3,
      isWeak: true,
      advisories: ["Retention data insufficient for high-confidence analysis"],
    },
  };
}

export async function runRetentionEngine(input: RetentionInput): Promise<RetentionResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  const guardResult = runGuardLayer(input);

  // Short-circuit when there is no real data — skip the AI call entirely
  const hasAnySparseData = (
    input.customerJourneyData.touchpoints.length === 0 &&
    input.customerJourneyData.repeatPurchaseRate === null &&
    input.customerJourneyData.churnRate === null &&
    input.purchaseMotivations.length === 0 &&
    (input.offerStructure.coreOutcome === null || input.offerStructure.coreOutcome === "") &&
    input.offerStructure.deliverables.length === 0
  );
  if (hasAnySparseData) {
    console.log("[RetentionEngine] No real data provided — returning fallback without AI call");
    return buildFallbackResult(input, guardResult, startTime);
  }

  if (!guardResult.passed && guardResult.flags.length >= 2) {
    return buildFallbackResult(input, guardResult, startTime);
  }

  if (!guardResult.passed) {
    warnings.push(...guardResult.flags);
  }

  const hasRawInputs = !!(input.customerJourneyData as any)?.rawInputs;
  const rawInputs = (input.customerJourneyData as any)?.rawInputs;
  const rawSignalBoost = hasRawInputs ? (
    (rawInputs.totalCustomers > 0 ? 3 : 0) +
    (rawInputs.totalPurchases > 0 ? 2 : 0) +
    (rawInputs.returningCustomers > 0 ? 2 : 0) +
    (rawInputs.dataWindowDays > 0 ? 1 : 0)
  ) : 0;

  const reliability = assessDataReliability(
    input.customerJourneyData.touchpoints.length + (hasRawInputs ? 2 : 0),
    input.purchaseMotivations.length + input.postPurchaseObjections.length + rawSignalBoost,
    input.offerStructure.coreOutcome !== null || (hasRawInputs && rawInputs.totalCustomers > 0),
    input.offerStructure.deliverables.length > 0 || (hasRawInputs && rawInputs.totalPurchases > 0),
    input.purchaseMotivations.length > 0 || hasRawInputs,
    guardResult.retentionMechanismPresence,
  );

  if (reliability.isWeak) {
    warnings.push("Data reliability is weak — retention confidence will be capped");
  }

  const prompt = buildRetentionPrompt(input);

  let retentionLoops: RetentionLoop[] = [];
  let churnRiskFlags: ChurnRiskFlag[] = [];
  let ltvExpansionPaths: LTVExpansionPath[] = [];
  let upsellTriggers: UpsellTrigger[] = [];
  let finalBoundaryCheck: { clean: boolean; violations: string[] } = { clean: true, violations: [] };

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 3000,
    });

    const rawContent = response.choices?.[0]?.message?.content || "";

    finalBoundaryCheck = sanitizeBoundary(rawContent, BOUNDARY_BLOCKED_PATTERNS);
    if (!finalBoundaryCheck.clean) {
      warnings.push(...finalBoundaryCheck.violations);
    }

    const genericCheck = detectGenericOutput(rawContent);
    if (genericCheck.genericDetected) {
      warnings.push(`Generic output detected: ${genericCheck.genericPhrases.join(", ")}`);
    }

    const cleaned = rawContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = safeJsonParse(cleaned);

    if (parsed) {
      retentionLoops = Array.isArray(parsed.retentionLoops)
        ? parsed.retentionLoops.map((loop: any) => ({
            name: loop.name || "Unnamed Loop",
            type: loop.type || "engagement_loop",
            description: loop.description || "",
            triggerCondition: loop.triggerCondition || "",
            expectedImpact: clamp(loop.expectedImpact ?? 0.5),
            implementationDifficulty: clamp(loop.implementationDifficulty ?? 0.5),
            priorityScore: clamp(loop.priorityScore ?? 0.5),
          }))
        : [];

      churnRiskFlags = Array.isArray(parsed.churnRiskFlags)
        ? parsed.churnRiskFlags.map((flag: any) => ({
            riskFactor: flag.riskFactor || "Unknown risk",
            severity: clamp(flag.severity ?? 0.5),
            timeframe: flag.timeframe || "Unknown",
            mitigationStrategy: flag.mitigationStrategy || "",
            dataConfidence: clamp(flag.dataConfidence ?? 0.3),
          }))
        : [];

      ltvExpansionPaths = Array.isArray(parsed.ltvExpansionPaths)
        ? parsed.ltvExpansionPaths.map((path: any) => ({
            pathName: path.pathName || "Unnamed Path",
            description: path.description || "",
            estimatedLTVIncrease: clamp(path.estimatedLTVIncrease ?? 0),
            requiredConditions: Array.isArray(path.requiredConditions) ? path.requiredConditions : [],
            riskNotes: Array.isArray(path.riskNotes) ? path.riskNotes : [],
            confidenceScore: clamp(path.confidenceScore ?? 0.3),
          }))
        : [];

      upsellTriggers = Array.isArray(parsed.upsellTriggers)
        ? parsed.upsellTriggers.map((trigger: any, idx: number) => ({
            triggerName: trigger.triggerName || "Unnamed Trigger",
            triggerCondition: trigger.triggerCondition || "",
            suggestedOffer: trigger.suggestedOffer || "",
            timing: trigger.timing || "Unknown",
            expectedConversionRate: clamp(trigger.expectedConversionRate ?? 0.1),
            priorityRank: trigger.priorityRank ?? (idx + 1),
          }))
        : [];
    } else {
      warnings.push("Failed to parse AI response — using fallback outputs");
      return buildFallbackResult(input, guardResult, startTime);
    }
  } catch (error: any) {
    console.error(`[RetentionEngine] AI call failed: ${error.message}`);
    warnings.push(`AI processing error: ${error.message}`);
    return buildFallbackResult(input, guardResult, startTime);
  }

  if (retentionLoops.length === 0) {
    const fallback = buildFallbackResult(input, guardResult, startTime);
    retentionLoops = fallback.retentionLoops;
    warnings.push("AI returned no retention loops — baseline retention mechanisms injected");
  }
  if (churnRiskFlags.length === 0) {
    churnRiskFlags = [{
      riskFactor: "No churn risk factors identified by AI — baseline monitoring recommended",
      severity: 0.4,
      timeframe: "30-60 days",
      mitigationStrategy: "Implement engagement tracking to establish churn baselines",
      dataConfidence: 0.3,
    }];
    warnings.push("AI returned no churn risk flags — baseline churn flag injected");
  }

  let rawConfidence =
    guardResult.valueDeliveryClarity * RETENTION_SCORE_WEIGHTS.valueDeliveryClarity +
    (1 - guardResult.trustDecayRisk) * RETENTION_SCORE_WEIGHTS.postPurchaseTrust +
    guardResult.retentionMechanismPresence * RETENTION_SCORE_WEIGHTS.retentionMechanismStrength +
    (retentionLoops.length > 0 ? 0.7 : 0.2) * RETENTION_SCORE_WEIGHTS.churnRiskMitigation +
    (ltvExpansionPaths.length > 0 ? 0.6 : 0.2) * RETENTION_SCORE_WEIGHTS.ltvExpansionViability +
    (upsellTriggers.length > 0 ? 0.6 : 0.2) * RETENTION_SCORE_WEIGHTS.upsellReadiness;

  rawConfidence = clamp(rawConfidence);
  const confidenceScore = normalizeConfidence(rawConfidence, reliability);

  const layersPassed = [
    guardResult.valueDeliveryClarity >= GUARD_THRESHOLDS.minValueDeliveryClarity,
    guardResult.trustDecayRisk <= GUARD_THRESHOLDS.maxTrustDecayRisk,
    guardResult.retentionMechanismPresence >= GUARD_THRESHOLDS.minRetentionMechanismPresence,
    retentionLoops.length > 0,
    churnRiskFlags.length > 0,
  ].filter(Boolean).length;

  const acceptability = assessStrategyAcceptability(
    confidenceScore,
    layersPassed,
    5,
    guardResult.passed,
    warnings,
  );

  if (!finalBoundaryCheck.clean) {
    const fallback = buildFallbackResult(input, guardResult, startTime);
    return {
      ...fallback,
      status: STATUS.GUARD_BLOCKED,
      statusMessage: "Retention analysis blocked — boundary violations in AI output, safe baseline mechanisms provided",
      boundaryCheck: { passed: false, violations: finalBoundaryCheck.violations },
      structuralWarnings: [...deduplicateWarnings(warnings), "Guard blocked original output — replaced with safe baseline retention mechanisms"],
      confidenceScore: 0.15,
      strategyAcceptability: assessStrategyAcceptability(0.15, 0, 5, false, warnings),
    };
  }

  const status = guardResult.passed ? STATUS.COMPLETE : STATUS.PROVISIONAL;
  const dedupedWarnings = deduplicateWarnings(warnings);

  return {
    status,
    statusMessage: guardResult.passed
      ? "Retention analysis complete with validated outputs"
      : "Retention analysis provisional — guard flags present, recommend verification",
    retentionLoops,
    churnRiskFlags,
    ltvExpansionPaths,
    upsellTriggers,
    guardResult,
    boundaryCheck: { passed: true, violations: [] },
    structuralWarnings: dedupedWarnings,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    dataReliability: {
      overallReliability: reliability.overallReliability,
      isWeak: reliability.isWeak,
      advisories: reliability.advisories,
    },
    strategyAcceptability: acceptability,
  };
}
