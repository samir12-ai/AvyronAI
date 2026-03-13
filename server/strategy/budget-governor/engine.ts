import {
  ENGINE_VERSION,
  MIN_VALIDATION_CONFIDENCE_FOR_SCALE,
  MIN_OFFER_PROOF_FOR_SCALE,
  MIN_FUNNEL_STRENGTH_FOR_SCALE,
  CAC_DEVIATION_THRESHOLD,
  MAX_RISK_FOR_EXPANSION,
  TEST_BUDGET_FLOOR,
  TEST_BUDGET_CEILING,
  SCALE_BUDGET_FLOOR,
  SCALE_BUDGET_CEILING,
  KILL_THRESHOLDS,
  RISK_WEIGHTS,
  STATUS,
} from "./constants";
import type {
  BudgetGovernorInput,
  BudgetDecision,
  BudgetRange,
  ExpansionPermission,
  BudgetGuardResult,
  BudgetGovernorResult,
} from "./types";
import { assessStrategyAcceptability } from "../../shared/strategy-acceptability";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function computeRiskScore(input: BudgetGovernorInput): { overallRisk: number; riskFactors: string[]; mitigations: string[] } {
  const riskFactors: string[] = [];
  const mitigations: string[] = [];

  const validationRisk = 1 - clamp(input.validationConfidence);
  if (validationRisk > 0.5) riskFactors.push(`Low validation confidence (${(input.validationConfidence * 100).toFixed(0)}%)`);

  const offerRisk = 1 - clamp(input.offerStrength);
  if (offerRisk > 0.5) riskFactors.push(`Weak offer strength (${(input.offerStrength * 100).toFixed(0)}%)`);

  const funnelRisk = 1 - clamp(input.funnelStrengthScore);
  if (funnelRisk > 0.5) riskFactors.push(`Weak funnel strength (${(input.funnelStrengthScore * 100).toFixed(0)}%)`);

  const channelRiskScore = clamp(input.channelRisk);
  if (channelRiskScore > 0.5) riskFactors.push(`High channel risk (${(input.channelRisk * 100).toFixed(0)}%)`);

  const cacDeviation = input.historicalCPA && input.funnelProjections.expectedCPA
    ? Math.abs(input.funnelProjections.expectedCPA - input.historicalCPA) / Math.max(input.historicalCPA, 1)
    : 0;
  const cacRisk = clamp(cacDeviation / CAC_DEVIATION_THRESHOLD);
  if (cacDeviation > CAC_DEVIATION_THRESHOLD) riskFactors.push(`CAC assumptions deviate ${(cacDeviation * 100).toFixed(0)}% from historical`);

  const marketRisk = clamp(input.marketIntensity);
  if (marketRisk > 0.7) riskFactors.push(`High market intensity (${(input.marketIntensity * 100).toFixed(0)}%)`);

  const overallRisk = clamp(
    validationRisk * RISK_WEIGHTS.validationConfidence +
    offerRisk * RISK_WEIGHTS.offerStrength +
    funnelRisk * RISK_WEIGHTS.funnelStrength +
    channelRiskScore * RISK_WEIGHTS.channelRisk +
    cacRisk * RISK_WEIGHTS.cacRealism +
    marketRisk * RISK_WEIGHTS.marketIntensity
  );

  if (input.offerCompleteness) mitigations.push("Offer is structurally complete");
  if (input.validationConfidence > 0.7) mitigations.push("Strong validation confidence provides safety margin");
  if (input.historicalROAS && input.historicalROAS > 2.0) mitigations.push("Historical ROAS above 2.0x reduces risk");
  if (input.funnelFrictionScore < 0.3) mitigations.push("Low funnel friction reduces drop-off risk");

  return { overallRisk, riskFactors, mitigations };
}

function runGuard(input: BudgetGovernorInput, riskScore: number): BudgetGuardResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  const overrides: string[] = [];

  if (input.validationConfidence < MIN_VALIDATION_CONFIDENCE_FOR_SCALE && input.validationState !== "validated") {
    violations.push(`Validation confidence (${(input.validationConfidence * 100).toFixed(0)}%) below scaling threshold (${(MIN_VALIDATION_CONFIDENCE_FOR_SCALE * 100).toFixed(0)}%)`);
  }

  if (input.offerProofScore < MIN_OFFER_PROOF_FOR_SCALE) {
    violations.push(`Offer proof score (${(input.offerProofScore * 100).toFixed(0)}%) below minimum for scaling (${(MIN_OFFER_PROOF_FOR_SCALE * 100).toFixed(0)}%)`);
  }

  const cacDeviation = input.historicalCPA && input.funnelProjections.expectedCPA
    ? Math.abs(input.funnelProjections.expectedCPA - input.historicalCPA) / Math.max(input.historicalCPA, 1)
    : 0;
  if (cacDeviation > CAC_DEVIATION_THRESHOLD) {
    violations.push(`CAC assumptions unrealistic — ${(cacDeviation * 100).toFixed(0)}% deviation from historical CPA`);
  }

  if (input.funnelStrengthScore < MIN_FUNNEL_STRENGTH_FOR_SCALE) {
    warnings.push(`Funnel strength (${(input.funnelStrengthScore * 100).toFixed(0)}%) is below ideal scaling threshold`);
  }

  if (riskScore > MAX_RISK_FOR_EXPANSION) {
    warnings.push(`Overall risk (${(riskScore * 100).toFixed(0)}%) exceeds expansion safety threshold`);
  }

  if (input.marketIntensity > 0.8) {
    warnings.push("High market intensity — competitive pressure may inflate costs");
  }

  return {
    passed: violations.length === 0,
    violations,
    warnings,
    overrides,
  };
}

function determineBudgetDecision(input: BudgetGovernorInput, riskScore: number, guardResult: BudgetGuardResult): BudgetDecision {
  if (input.offerStrength < KILL_THRESHOLDS.minOfferStrength ||
      input.validationConfidence < KILL_THRESHOLDS.minValidationConfidence ||
      riskScore > KILL_THRESHOLDS.maxRisk) {
    return {
      action: "halt",
      reasoning: "Critical thresholds breached — strategy fundamentals too weak for any budget allocation",
    };
  }

  if (input.validationConfidence < MIN_VALIDATION_CONFIDENCE_FOR_SCALE) {
    return {
      action: "hold",
      reasoning: `Validation confidence (${(input.validationConfidence * 100).toFixed(0)}%) below ${(MIN_VALIDATION_CONFIDENCE_FOR_SCALE * 100).toFixed(0)}% threshold — holding budget until confidence improves`,
    };
  }

  if (!guardResult.passed) {
    return {
      action: "test",
      reasoning: `Guard violations detected (${guardResult.violations.length}) — limiting to test budget until issues are resolved`,
    };
  }

  if (input.validationConfidence > 0.75 &&
      input.offerStrength > 0.7 &&
      input.funnelStrengthScore > 0.65 &&
      riskScore < 0.35) {
    return {
      action: "scale",
      reasoning: "Strong validation, offer, and funnel metrics with acceptable risk — scaling is supported",
    };
  }

  if (input.validationConfidence >= 0.5 && input.offerStrength >= 0.5 && riskScore <= 0.6) {
    return {
      action: "hold",
      reasoning: "Moderate signals — maintain current budget and monitor for improvement before scaling",
    };
  }

  return {
    action: "test",
    reasoning: "Insufficient confidence for scaling — limited test budget recommended to gather more data",
  };
}

function computeTestBudgetRange(input: BudgetGovernorInput, riskScore: number): BudgetRange {
  const confidenceFactor = clamp(input.validationConfidence, 0.2, 1.0);
  const riskAdjustment = 1 - (riskScore * 0.4);

  const recommended = Math.round(
    TEST_BUDGET_FLOOR + (TEST_BUDGET_CEILING - TEST_BUDGET_FLOOR) * confidenceFactor * riskAdjustment
  );

  return {
    min: TEST_BUDGET_FLOOR,
    max: TEST_BUDGET_CEILING,
    recommended: clamp(recommended, TEST_BUDGET_FLOOR, TEST_BUDGET_CEILING),
    currency: "USD",
  };
}

function computeScaleBudgetRange(input: BudgetGovernorInput, riskScore: number): BudgetRange {
  if (riskScore > MAX_RISK_FOR_EXPANSION) {
    return {
      min: 0,
      max: 0,
      recommended: 0,
      currency: "USD",
    };
  }

  const confidenceFactor = clamp(input.validationConfidence, 0.3, 1.0);
  const offerFactor = clamp(input.offerStrength, 0.3, 1.0);
  const combinedFactor = (confidenceFactor * 0.5 + offerFactor * 0.3 + (1 - riskScore) * 0.2);

  const recommended = Math.round(
    SCALE_BUDGET_FLOOR + (SCALE_BUDGET_CEILING - SCALE_BUDGET_FLOOR) * combinedFactor
  );

  return {
    min: SCALE_BUDGET_FLOOR,
    max: SCALE_BUDGET_CEILING,
    recommended: clamp(recommended, SCALE_BUDGET_FLOOR, SCALE_BUDGET_CEILING),
    currency: "USD",
  };
}

function computeExpansionPermission(input: BudgetGovernorInput, riskScore: number, guardResult: BudgetGuardResult): ExpansionPermission {
  const blockers: string[] = [];
  const conditions: string[] = [];

  if (!guardResult.passed) {
    blockers.push(...guardResult.violations);
  }

  if (riskScore > MAX_RISK_FOR_EXPANSION) {
    blockers.push(`Overall risk (${(riskScore * 100).toFixed(0)}%) exceeds expansion threshold`);
  }

  if (input.validationConfidence < MIN_VALIDATION_CONFIDENCE_FOR_SCALE) {
    blockers.push("Validation confidence insufficient for expansion");
  }

  if (blockers.length === 0) {
    conditions.push("Monitor CPA daily during first scaling period");
    conditions.push("Set automated alerts for ROAS drops below 1.5x");
    if (input.marketIntensity > 0.5) {
      conditions.push("Review competitor spend weekly due to market intensity");
    }
  }

  const maxScaleFactor = blockers.length > 0
    ? 1.0
    : riskScore < 0.3 ? 3.0 : riskScore < 0.5 ? 2.0 : 1.5;

  return {
    allowed: blockers.length === 0,
    maxScaleFactor,
    conditions,
    blockers,
  };
}

function assessCACRealism(input: BudgetGovernorInput): {
  realistic: boolean;
  estimatedCAC: number;
  industryBenchmarkCAC: number;
  deviation: number;
  warnings: string[];
} {
  const estimatedCAC = input.funnelProjections.expectedCPA || 0;
  const historicalCAC = input.historicalCPA || estimatedCAC;
  const benchmarkCAC = historicalCAC > 0 ? historicalCAC : estimatedCAC * 1.2;
  const deviation = benchmarkCAC > 0 ? Math.abs(estimatedCAC - benchmarkCAC) / benchmarkCAC : 0;
  const warnings: string[] = [];

  if (deviation > CAC_DEVIATION_THRESHOLD) {
    warnings.push(`Projected CAC ($${estimatedCAC.toFixed(2)}) deviates ${(deviation * 100).toFixed(0)}% from benchmark ($${benchmarkCAC.toFixed(2)})`);
  }

  if (estimatedCAC < 1) {
    warnings.push("Projected CAC below $1 — likely unrealistic without proof");
  }

  if (input.historicalCPA === null) {
    warnings.push("No historical CPA data available — CAC projections are unverified assumptions");
  }

  return {
    realistic: deviation <= CAC_DEVIATION_THRESHOLD && estimatedCAC >= 1,
    estimatedCAC,
    industryBenchmarkCAC: benchmarkCAC,
    deviation,
    warnings,
  };
}

export function runBudgetGovernorEngine(input: BudgetGovernorInput): BudgetGovernorResult {
  const startTime = Date.now();
  const structuralWarnings: string[] = [];

  try {
    const { overallRisk, riskFactors, mitigations } = computeRiskScore(input);
    const guardResult = runGuard(input, overallRisk);
    const decision = determineBudgetDecision(input, overallRisk, guardResult);
    const testBudgetRange = computeTestBudgetRange(input, overallRisk);
    const scaleBudgetRange = computeScaleBudgetRange(input, overallRisk);
    const expansionPermission = computeExpansionPermission(input, overallRisk, guardResult);
    const cacAssumptionCheck = assessCACRealism(input);

    if (cacAssumptionCheck.warnings.length > 0) {
      structuralWarnings.push(...cacAssumptionCheck.warnings);
    }
    if (guardResult.warnings.length > 0) {
      structuralWarnings.push(...guardResult.warnings);
    }

    const killFlag = decision.action === "halt";
    const killReasons: string[] = [];
    if (killFlag) {
      if (input.offerStrength < KILL_THRESHOLDS.minOfferStrength) killReasons.push("Offer strength below minimum viable threshold");
      if (input.validationConfidence < KILL_THRESHOLDS.minValidationConfidence) killReasons.push("Validation confidence critically low");
      if (overallRisk > KILL_THRESHOLDS.maxRisk) killReasons.push("Overall risk exceeds maximum safe threshold");
    }

    let layersPassed = 0;
    const totalLayers = 5;
    if (guardResult.passed) layersPassed++;
    if (cacAssumptionCheck.realistic) layersPassed++;
    if (overallRisk < MAX_RISK_FOR_EXPANSION) layersPassed++;
    if (input.offerCompleteness) layersPassed++;
    if (input.validationConfidence >= 0.5) layersPassed++;

    const rawConfidence = clamp(
      input.validationConfidence * 0.3 +
      input.offerStrength * 0.25 +
      (1 - overallRisk) * 0.25 +
      input.funnelStrengthScore * 0.2
    );

    const confidenceScore = killFlag ? Math.min(rawConfidence, 0.15) : rawConfidence;

    const strategyAcceptability = assessStrategyAcceptability(
      confidenceScore,
      layersPassed,
      totalLayers,
      guardResult.passed,
      structuralWarnings
    );

    const executionTimeMs = Date.now() - startTime;

    return {
      status: killFlag ? STATUS.HALTED : guardResult.passed ? STATUS.COMPLETE : STATUS.PARTIAL,
      statusMessage: decision.reasoning,
      decision,
      testBudgetRange,
      scaleBudgetRange,
      expansionPermission,
      killFlag,
      killReasons,
      guardResult,
      riskAssessment: { overallRisk, riskFactors, mitigations },
      cacAssumptionCheck,
      boundaryCheck: { passed: guardResult.passed, violations: guardResult.violations },
      structuralWarnings,
      confidenceScore,
      executionTimeMs,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: {
        riskScore: overallRisk,
        guardPassed: guardResult.passed,
        cacRealistic: cacAssumptionCheck.realistic,
        expansionAllowed: expansionPermission.allowed,
        layersPassed,
        totalLayers,
      },
      strategyAcceptability,
    };
  } catch (error: any) {
    return {
      status: STATUS.FAILED,
      statusMessage: `Budget Governor engine error: ${error.message}`,
      decision: { action: "halt", reasoning: "Engine failure — halting all budget decisions" },
      testBudgetRange: { min: 0, max: 0, recommended: 0, currency: "USD" },
      scaleBudgetRange: { min: 0, max: 0, recommended: 0, currency: "USD" },
      expansionPermission: { allowed: false, maxScaleFactor: 1.0, conditions: [], blockers: ["Engine failure"] },
      killFlag: true,
      killReasons: ["Engine execution failed"],
      guardResult: { passed: false, violations: ["Engine failure"], warnings: [], overrides: [] },
      riskAssessment: { overallRisk: 1.0, riskFactors: ["Engine failure"], mitigations: [] },
      cacAssumptionCheck: { realistic: false, estimatedCAC: 0, industryBenchmarkCAC: 0, deviation: 0, warnings: ["Engine failure"] },
      boundaryCheck: { passed: false, violations: ["Engine failure"] },
      structuralWarnings: [`Engine error: ${error.message}`],
      confidenceScore: 0,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
      layerDiagnostics: { error: error.message },
    };
  }
}
