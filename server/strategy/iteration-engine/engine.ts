import {
  ENGINE_VERSION,
  ENGINE_NAME,
  MIN_PERFORMANCE_DATA_POINTS,
  MIN_CREATIVE_COUNT,
  MIN_FUNNEL_STAGES,
  CTR_FLOOR,
  CPA_CEILING_MULTIPLIER,
  ROAS_FLOOR,
  CONVERSION_RATE_FLOOR,
  MAX_CONCURRENT_TESTS,
  MIN_TEST_DURATION_DAYS,
  MAX_TEST_DURATION_DAYS,
  OPTIMIZATION_CONFIDENCE_THRESHOLD,
  SCALING_CONFIDENCE_THRESHOLD,
  BOUNDARY_BLOCKED_PATTERNS,
  FAILED_TEST_REPEAT_WINDOW_DAYS,
  STATUS,
} from "./constants";
import { assessStrategyAcceptability } from "../../shared/strategy-acceptability";
import { deduplicateWarnings, deduplicateByField } from "../dependency-validation";
import type {
  IterationPerformanceInput,
  IterationFunnelInput,
  IterationCreativeInput,
  IterationPersuasionInput,
  TestHypothesis,
  OptimizationTarget,
  FailedStrategyFlag,
  IterationPlanStep,
  LayerResult,
  IterationResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function sanitizeBoundary(text: string): { passed: boolean; violations: string[] } {
  if (!text) return { passed: true, violations: [] };
  const violations: string[] = [];
  for (const [domain, pattern] of Object.entries(BOUNDARY_BLOCKED_PATTERNS)) {
    if (pattern.test(text)) {
      violations.push(`Boundary violation: ${domain} domain detected`);
    }
  }
  return { passed: violations.length === 0, violations };
}

function assessDataReliability(
  performance: IterationPerformanceInput | null,
  funnel: IterationFunnelInput | null,
  creative: IterationCreativeInput | null,
): {
  signalDensity: number;
  performanceDataQuality: number;
  overallReliability: number;
  isWeak: boolean;
  advisories: string[];
} {
  const advisories: string[] = [];
  let signalDensity = 0;
  let performanceDataQuality = 0;

  if (performance) {
    const hasImpressions = performance.impressions > 0;
    const hasClicks = performance.clicks > 0;
    const hasConversions = performance.conversions > 0;
    const hasSpend = performance.spend > 0;

    let dataPoints = 0;
    if (hasImpressions) dataPoints++;
    if (hasClicks) dataPoints++;
    if (hasConversions) dataPoints++;
    if (hasSpend) dataPoints++;
    if (performance.ctr > 0) dataPoints++;
    if (performance.roas > 0) dataPoints++;

    signalDensity = clamp(dataPoints / 6);
    performanceDataQuality = clamp(dataPoints / MIN_PERFORMANCE_DATA_POINTS);

    if (dataPoints < MIN_PERFORMANCE_DATA_POINTS) {
      advisories.push(`Low performance data: only ${dataPoints} data points available (minimum ${MIN_PERFORMANCE_DATA_POINTS})`);
    }
  } else {
    advisories.push("No campaign performance data available");
  }

  let funnelScore = 0;
  if (funnel && (funnel.stageConversions?.length || 0) >= MIN_FUNNEL_STAGES) {
    funnelScore = 0.33;
  } else if (funnel) {
    funnelScore = 0.15;
  }

  let creativeScore = 0;
  if (creative && creative.totalCreatives >= MIN_CREATIVE_COUNT) {
    creativeScore = 0.33;
  } else if (creative) {
    creativeScore = 0.15;
  }

  const overallReliability = clamp(signalDensity * 0.34 + funnelScore + creativeScore);
  const isWeak = overallReliability < 0.3;

  if (isWeak) {
    advisories.push(`Data reliability is WEAK (${overallReliability.toFixed(2)}) — iteration plans will be conservative`);
  }

  return { signalDensity, performanceDataQuality, overallReliability, isWeak, advisories };
}

function layer1_performanceAnalysis(
  performance: IterationPerformanceInput | null,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (!performance) {
    return { layerName: "Performance Analysis", passed: false, score: 0, findings: ["No performance data available"], warnings: ["Cannot generate optimization targets without performance data"] };
  }

  if (performance.ctr < CTR_FLOOR) {
    findings.push(`CTR (${(performance.ctr * 100).toFixed(2)}%) is below floor (${(CTR_FLOOR * 100).toFixed(2)}%) — creative or targeting issue`);
    warnings.push("Critical: CTR below minimum viable threshold");
  } else {
    score += 0.25;
  }

  if (performance.roas > 0 && performance.roas < ROAS_FLOOR) {
    findings.push(`ROAS (${performance.roas.toFixed(2)}) below floor (${ROAS_FLOOR}) — cost efficiency issue`);
    warnings.push("ROAS indicates unprofitable spend");
  } else if (performance.roas >= ROAS_FLOOR) {
    score += 0.25;
  }

  if (performance.conversions > 0 && performance.clicks > 0) {
    const convRate = performance.conversions / performance.clicks;
    if (convRate < CONVERSION_RATE_FLOOR) {
      findings.push(`Conversion rate (${(convRate * 100).toFixed(2)}%) below threshold — funnel or offer issue`);
    } else {
      score += 0.25;
    }
  }

  if (performance.engagementRate > 0.03) {
    findings.push(`Engagement rate (${(performance.engagementRate * 100).toFixed(2)}%) is healthy`);
    score += 0.25;
  } else if (performance.engagementRate > 0) {
    findings.push(`Low engagement rate (${(performance.engagementRate * 100).toFixed(2)}%) — content resonance issue`);
  }

  return { layerName: "Performance Analysis", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

function layer2_funnelAnalysis(
  funnel: IterationFunnelInput | null,
  performance: IterationPerformanceInput | null = null,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (!funnel && performance && performance.impressions > 0) {
    const clickRate = performance.clicks > 0 ? performance.clicks / performance.impressions : 0;
    const convRate = performance.clicks > 0 && performance.conversions > 0 ? performance.conversions / performance.clicks : 0;
    const overallConv = performance.impressions > 0 && performance.conversions > 0 ? performance.conversions / performance.impressions : 0;

    findings.push("Funnel synthesized from campaign performance data");
    findings.push(`Impression → Click: ${(clickRate * 100).toFixed(1)}% conversion`);
    if (convRate > 0) {
      findings.push(`Click → Conversion: ${(convRate * 100).toFixed(1)}% conversion`);
    }

    score += 0.3;

    if (clickRate < 0.01) {
      findings.push("Awareness-to-interest bottleneck detected — low click-through from impressions");
    } else {
      score += 0.2;
    }

    if (convRate > 0 && convRate < 0.01) {
      findings.push("Interest-to-action bottleneck detected — low conversion from clicks");
    } else if (convRate >= 0.01) {
      score += 0.2;
    }

    if (overallConv >= CONVERSION_RATE_FLOOR) {
      score += 0.3;
    } else if (overallConv > 0) {
      score += 0.1;
      warnings.push(`Overall funnel conversion (${(overallConv * 100).toFixed(2)}%) is below optimal threshold`);
    }

    return { layerName: "Funnel Analysis", passed: score >= 0.4, score: clamp(score), findings, warnings };
  }

  if (!funnel) {
    return { layerName: "Funnel Analysis", passed: false, score: 0, findings: ["No funnel data available"], warnings: ["Cannot identify funnel bottlenecks"] };
  }

  const stages = funnel.stageConversions || [];
  if (stages.length < MIN_FUNNEL_STAGES) {
    return { layerName: "Funnel Analysis", passed: false, score: 0.2, findings: [`Only ${stages.length} funnel stages tracked`], warnings: ["Insufficient funnel granularity"] };
  }

  score += 0.3;

  for (const stage of stages) {
    if (stage.conversionRate < 0.1) {
      findings.push(`Bottleneck at "${stage.stageName}": ${(stage.conversionRate * 100).toFixed(1)}% conversion`);
    }
  }

  const dropOffs = funnel.dropOffPoints || [];
  if (dropOffs.length > 0) {
    findings.push(`${dropOffs.length} drop-off point(s) identified: ${dropOffs.slice(0, 3).join(", ")}`);
    score += 0.2;
  }

  if (funnel.overallConversionRate >= CONVERSION_RATE_FLOOR) {
    score += 0.3;
  } else {
    warnings.push(`Overall funnel conversion rate (${(funnel.overallConversionRate * 100).toFixed(2)}%) below threshold`);
  }

  score += 0.2;

  return { layerName: "Funnel Analysis", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

function layer3_creativeAnalysis(
  creative: IterationCreativeInput | null,
  performance: IterationPerformanceInput | null = null,
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 0;

  if (!creative && performance && performance.impressions > 0) {
    findings.push("Creative performance inferred from campaign metrics");

    const ctr = performance.ctr > 0 ? performance.ctr : (performance.clicks > 0 ? performance.clicks / performance.impressions : 0);
    const convRate = performance.clicks > 0 && performance.conversions > 0 ? performance.conversions / performance.clicks : 0;

    score += 0.3;

    if (ctr >= CTR_FLOOR) {
      findings.push(`Estimated creative CTR: ${(ctr * 100).toFixed(2)}% — above minimum threshold`);
      score += 0.25;
    } else {
      findings.push(`Estimated creative CTR: ${(ctr * 100).toFixed(2)}% — below threshold, creative refresh recommended`);
    }

    if (convRate >= CONVERSION_RATE_FLOOR) {
      findings.push(`Estimated creative conversion: ${(convRate * 100).toFixed(2)}% — performing`);
      score += 0.25;
    } else if (convRate > 0) {
      findings.push(`Estimated creative conversion: ${(convRate * 100).toFixed(2)}% — optimization opportunity`);
      score += 0.1;
    }

    if (performance.engagementRate > 0.03) {
      findings.push(`Engagement rate (${(performance.engagementRate * 100).toFixed(2)}%) suggests creative resonance`);
      score += 0.2;
    } else if (performance.engagementRate > 0) {
      findings.push(`Low engagement rate (${(performance.engagementRate * 100).toFixed(2)}%) — consider creative variants`);
      score += 0.1;
    }

    return { layerName: "Creative Analysis", passed: score >= 0.4, score: clamp(score), findings, warnings };
  }

  if (!creative) {
    return { layerName: "Creative Analysis", passed: false, score: 0, findings: ["No creative data available"], warnings: ["Cannot evaluate creative performance"] };
  }

  if (creative.totalCreatives >= MIN_CREATIVE_COUNT) {
    score += 0.3;
  }

  const topPerformers = creative.topPerformers || [];
  const bottomPerformers = creative.bottomPerformers || [];

  if (topPerformers.length > 0) {
    findings.push(`${topPerformers.length} top-performing creative(s) identified`);
    score += 0.3;
    for (const top of topPerformers.slice(0, 3)) {
      findings.push(`Winner: "${top.label}" — CTR ${(top.ctr * 100).toFixed(2)}%, Conv ${(top.conversionRate * 100).toFixed(2)}%`);
    }
  }

  if (bottomPerformers.length > 0) {
    findings.push(`${bottomPerformers.length} underperforming creative(s) flagged for review`);
    for (const bottom of bottomPerformers.slice(0, 2)) {
      findings.push(`Underperformer: "${bottom.label}" — CTR ${(bottom.ctr * 100).toFixed(2)}%`);
    }
  }

  const fatigueSignals = creative.fatigueSignals || [];
  if (fatigueSignals.length > 0) {
    warnings.push(`Creative fatigue detected: ${fatigueSignals.slice(0, 3).join("; ")}`);
  } else {
    score += 0.2;
  }

  score += 0.2;

  return { layerName: "Creative Analysis", passed: score >= 0.5, score: clamp(score), findings, warnings };
}

function layer4_guardLayer(
  hypotheses: TestHypothesis[],
  failedFlags: FailedStrategyFlag[],
  reliability: { isWeak: boolean; overallReliability: number },
): LayerResult {
  const findings: string[] = [];
  const warnings: string[] = [];
  let score = 1.0;

  if (hypotheses.length > MAX_CONCURRENT_TESTS) {
    const excess = hypotheses.length - MAX_CONCURRENT_TESTS;
    warnings.push(`Too many concurrent tests (${hypotheses.length}) — limit is ${MAX_CONCURRENT_TESTS}, removing ${excess} lowest-priority`);
    score -= 0.2;
  }

  const recentFailures = failedFlags.filter(f => !f.shouldRetry);
  for (const hyp of hypotheses) {
    const matchesFailure = recentFailures.some(f =>
      f.strategyName.toLowerCase().includes(hyp.variable.toLowerCase()) ||
      hyp.hypothesis.toLowerCase().includes(f.strategyName.toLowerCase())
    );
    if (matchesFailure) {
      warnings.push(`Hypothesis "${hyp.hypothesis}" repeats a recently failed strategy — blocked`);
      score -= 0.15;
    }
  }

  const highRiskCount = hypotheses.filter(h => h.riskLevel === "high").length;
  if (highRiskCount > 1) {
    warnings.push(`${highRiskCount} high-risk tests proposed simultaneously — limit to 1`);
    score -= 0.1;
  }

  if (reliability.isWeak) {
    warnings.push("Data reliability too weak for aggressive optimization — defaulting to conservative testing");
    score -= 0.2;
  }

  for (const hyp of hypotheses) {
    if (hyp.testDurationDays < MIN_TEST_DURATION_DAYS) {
      warnings.push(`Test "${hyp.hypothesis}" duration (${hyp.testDurationDays}d) below minimum (${MIN_TEST_DURATION_DAYS}d)`);
      score -= 0.05;
    }
  }

  findings.push(`Guard evaluated ${hypotheses.length} hypotheses, ${failedFlags.length} failed strategies`);

  return { layerName: "Iteration Guard", passed: score >= 0.6, score: clamp(score), findings, warnings };
}

function generateHypotheses(
  performance: IterationPerformanceInput | null,
  funnel: IterationFunnelInput | null,
  creative: IterationCreativeInput | null,
  persuasion: IterationPersuasionInput | null,
): TestHypothesis[] {
  const hypotheses: TestHypothesis[] = [];

  if (performance) {
    if (performance.ctr < CTR_FLOOR * 2) {
      hypotheses.push({
        hypothesisId: generateId(),
        hypothesis: "Test new hook angles to improve click-through rate",
        variable: "creative_hook",
        expectedOutcome: `Increase CTR from ${(performance.ctr * 100).toFixed(2)}% to ${(performance.ctr * 100 * 1.5).toFixed(2)}%`,
        priority: "high",
        riskLevel: "low",
        testDurationDays: 7,
        successMetric: "ctr",
        successThreshold: performance.ctr * 1.3,
      });
    }

    if (performance.roas > 0 && performance.roas < ROAS_FLOOR * 1.5) {
      hypotheses.push({
        hypothesisId: generateId(),
        hypothesis: "Optimize targeting to improve return on ad spend",
        variable: "audience_targeting",
        expectedOutcome: `Increase ROAS from ${performance.roas.toFixed(2)} to ${(performance.roas * 1.3).toFixed(2)}`,
        priority: "high",
        riskLevel: "moderate",
        testDurationDays: 10,
        successMetric: "roas",
        successThreshold: performance.roas * 1.2,
      });
    }

    if (performance.cpa > 0) {
      hypotheses.push({
        hypothesisId: generateId(),
        hypothesis: "Test landing page variants to reduce cost per acquisition",
        variable: "landing_page",
        expectedOutcome: `Reduce CPA from ${performance.cpa.toFixed(2)} to ${(performance.cpa * 0.8).toFixed(2)}`,
        priority: "medium",
        riskLevel: "low",
        testDurationDays: 7,
        successMetric: "cpa",
        successThreshold: performance.cpa * 0.85,
      });
    }
  }

  if (funnel) {
    const stages = funnel.stageConversions || [];
    const worstStage = stages.reduce<{ stageName: string; conversionRate: number } | null>(
      (worst, s) => (!worst || s.conversionRate < worst.conversionRate) ? s : worst, null
    );
    if (worstStage && worstStage.conversionRate < 0.3) {
      hypotheses.push({
        hypothesisId: generateId(),
        hypothesis: `Optimize "${worstStage.stageName}" stage to reduce drop-off`,
        variable: `funnel_stage_${worstStage.stageName.toLowerCase().replace(/\s+/g, "_")}`,
        expectedOutcome: `Increase ${worstStage.stageName} conversion from ${(worstStage.conversionRate * 100).toFixed(1)}% to ${(worstStage.conversionRate * 100 * 1.5).toFixed(1)}%`,
        priority: "high",
        riskLevel: "moderate",
        testDurationDays: 7,
        successMetric: "stage_conversion_rate",
        successThreshold: worstStage.conversionRate * 1.3,
      });
    }
  }

  if (creative) {
    const fatigueSignals = creative.fatigueSignals || [];
    if (fatigueSignals.length > 0) {
      hypotheses.push({
        hypothesisId: generateId(),
        hypothesis: "Introduce fresh creative variants to combat fatigue",
        variable: "creative_rotation",
        expectedOutcome: "Restore engagement levels by rotating in new creative assets",
        priority: "medium",
        riskLevel: "low",
        testDurationDays: 5,
        successMetric: "engagement_rate",
        successThreshold: 0.03,
      });
    }
  }

  if (persuasion && persuasion.persuasionStrengthScore < 0.6) {
    hypotheses.push({
      hypothesisId: generateId(),
      hypothesis: "Test alternative persuasion angle with stronger objection handling",
      variable: "persuasion_mode",
      expectedOutcome: "Improve conversion by addressing unresolved objections",
      priority: "medium",
      riskLevel: "moderate",
      testDurationDays: 10,
      successMetric: "conversion_rate",
      successThreshold: CONVERSION_RATE_FLOOR * 2,
    });
  }

  return hypotheses.slice(0, MAX_CONCURRENT_TESTS + 2);
}

function generateOptimizationTargets(
  performance: IterationPerformanceInput | null,
  funnel: IterationFunnelInput | null,
): OptimizationTarget[] {
  const targets: OptimizationTarget[] = [];

  if (performance) {
    if (performance.ctr > 0 && performance.ctr < 0.02) {
      targets.push({
        targetArea: "Click-Through Rate",
        currentValue: performance.ctr,
        targetValue: Math.min(performance.ctr * 1.5, 0.05),
        improvementStrategy: "Test new headlines, visuals, and hook formats",
        confidence: clamp(performance.impressions > 1000 ? 0.7 : 0.4),
        effort: "medium",
      });
    }

    if (performance.cpa > 0) {
      targets.push({
        targetArea: "Cost Per Acquisition",
        currentValue: performance.cpa,
        targetValue: performance.cpa * 0.75,
        improvementStrategy: "Optimize audience targeting and bid strategy",
        confidence: clamp(performance.conversions > 10 ? 0.7 : 0.4),
        effort: "high",
      });
    }

    if (performance.engagementRate > 0 && performance.engagementRate < 0.03) {
      targets.push({
        targetArea: "Engagement Rate",
        currentValue: performance.engagementRate,
        targetValue: 0.03,
        improvementStrategy: "Improve content relevance and call-to-action clarity",
        confidence: 0.5,
        effort: "low",
      });
    }
  }

  if (funnel && funnel.overallConversionRate < 0.05) {
    targets.push({
      targetArea: "Funnel Conversion Rate",
      currentValue: funnel.overallConversionRate,
      targetValue: Math.min(funnel.overallConversionRate * 2, 0.1),
      improvementStrategy: "Reduce friction at identified drop-off points",
      confidence: 0.5,
      effort: "high",
    });
  }

  return targets;
}

function detectFailedStrategies(
  performance: IterationPerformanceInput | null,
  creative: IterationCreativeInput | null,
): FailedStrategyFlag[] {
  const flags: FailedStrategyFlag[] = [];

  if (performance) {
    if (performance.roas > 0 && performance.roas < 0.5) {
      flags.push({
        strategyName: "Current spend allocation",
        failureReason: `ROAS of ${performance.roas.toFixed(2)} indicates deeply unprofitable campaign spend`,
        failureDate: new Date().toISOString(),
        shouldRetry: false,
        retryConditions: ["Complete audience retargeting", "New creative assets", "Offer restructure"],
      });
    }

    if (performance.ctr > 0 && performance.ctr < CTR_FLOOR * 0.5) {
      flags.push({
        strategyName: "Current creative approach",
        failureReason: `CTR of ${(performance.ctr * 100).toFixed(3)}% far below viable threshold`,
        failureDate: new Date().toISOString(),
        shouldRetry: true,
        retryConditions: ["New hook angles tested", "Alternative visual styles deployed"],
      });
    }
  }

  if (creative) {
    const bottomPerformers = creative.bottomPerformers || [];
    for (const bp of bottomPerformers.slice(0, 3)) {
      if (bp.ctr < CTR_FLOOR * 0.3 && bp.impressions > 500) {
        flags.push({
          strategyName: `Creative: ${bp.label}`,
          failureReason: `CTR ${(bp.ctr * 100).toFixed(3)}% with ${bp.impressions} impressions — statistically failed`,
          failureDate: new Date().toISOString(),
          shouldRetry: false,
          retryConditions: [],
        });
      }
    }
  }

  return flags;
}

function generateIterationPlan(
  hypotheses: TestHypothesis[],
  targets: OptimizationTarget[],
  reliability: { isWeak: boolean },
): IterationPlanStep[] {
  const steps: IterationPlanStep[] = [];
  let stepNumber = 1;

  const activeHypotheses = hypotheses
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, reliability.isWeak ? 1 : MAX_CONCURRENT_TESTS);

  for (const hyp of activeHypotheses) {
    steps.push({
      stepNumber: stepNumber++,
      action: hyp.hypothesis,
      variable: hyp.variable,
      duration: `${hyp.testDurationDays} days`,
      successCriteria: `${hyp.successMetric} >= ${hyp.successThreshold}`,
      fallbackAction: hyp.riskLevel === "high"
        ? "Revert to previous configuration and re-evaluate"
        : "Extend test duration by 50% before concluding",
    });
  }

  for (const target of targets.slice(0, 2)) {
    if (target.confidence >= OPTIMIZATION_CONFIDENCE_THRESHOLD) {
      steps.push({
        stepNumber: stepNumber++,
        action: target.improvementStrategy,
        variable: target.targetArea.toLowerCase().replace(/\s+/g, "_"),
        duration: "7-14 days",
        successCriteria: `${target.targetArea} moves from ${target.currentValue.toFixed(4)} toward ${target.targetValue.toFixed(4)}`,
        fallbackAction: "Maintain current approach while gathering more data",
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      stepNumber: 1,
      action: "Maintain current configuration and gather baseline data",
      variable: "baseline_collection",
      duration: "7 days",
      successCriteria: "Sufficient data points collected for analysis",
      fallbackAction: "Extend data collection period",
    });
  }

  return steps;
}

function generateBenchmarkExplorationHypotheses(): TestHypothesis[] {
  return [
    {
      hypothesisId: generateId(),
      hypothesis: "Test primary hook angle variations to establish baseline CTR benchmarks",
      variable: "creative_hook",
      expectedOutcome: "Establish CTR baseline above industry floor of 0.5%",
      priority: "high",
      riskLevel: "low",
      testDurationDays: 7,
      successMetric: "ctr",
      successThreshold: CTR_FLOOR,
    },
    {
      hypothesisId: generateId(),
      hypothesis: "Test audience segment targeting to identify highest-converting cohort",
      variable: "audience_targeting",
      expectedOutcome: "Identify top 2-3 audience segments by conversion rate",
      priority: "high",
      riskLevel: "low",
      testDurationDays: 10,
      successMetric: "conversion_rate",
      successThreshold: CONVERSION_RATE_FLOOR,
    },
    {
      hypothesisId: generateId(),
      hypothesis: "Test landing page messaging variants to optimize initial conversion flow",
      variable: "landing_page",
      expectedOutcome: "Establish conversion rate baseline and identify winning copy direction",
      priority: "medium",
      riskLevel: "low",
      testDurationDays: 7,
      successMetric: "conversion_rate",
      successThreshold: CONVERSION_RATE_FLOOR * 1.5,
    },
    {
      hypothesisId: generateId(),
      hypothesis: "Test offer presentation formats to determine optimal value communication",
      variable: "offer_format",
      expectedOutcome: "Determine which offer format produces highest engagement",
      priority: "medium",
      riskLevel: "low",
      testDurationDays: 7,
      successMetric: "engagement_rate",
      successThreshold: 0.03,
    },
  ];
}

function generateBenchmarkOptimizationTargets(): OptimizationTarget[] {
  return [
    {
      targetArea: "Click-Through Rate",
      currentValue: 0,
      targetValue: CTR_FLOOR * 2,
      confidence: 0.3,
      effort: "low" as const,
      improvementStrategy: "Launch initial creative variants with distinct hook angles to establish CTR baseline",
    },
    {
      targetArea: "Conversion Rate",
      currentValue: 0,
      targetValue: CONVERSION_RATE_FLOOR * 2,
      confidence: 0.25,
      effort: "medium" as const,
      improvementStrategy: "Deploy landing page with clear value proposition and conversion tracking to establish baseline",
    },
  ];
}

function generateBenchmarkExplorationPlan(): IterationPlanStep[] {
  return [
    {
      stepNumber: 1,
      action: "Launch initial campaign with 2-3 creative hook variants to establish CTR and engagement baselines",
      variable: "creative_hook",
      duration: "7 days",
      successCriteria: "Minimum 1000 impressions collected with measurable CTR differentiation between variants",
      fallbackAction: "Extend collection period to 14 days and verify tracking setup",
    },
    {
      stepNumber: 2,
      action: "Run audience segment test across 2-3 target cohorts to identify conversion potential",
      variable: "audience_targeting",
      duration: "10 days",
      successCriteria: "At least 10 conversions per segment for statistical comparison",
      fallbackAction: "Narrow to 2 segments and increase per-segment budget allocation",
    },
    {
      stepNumber: 3,
      action: "Deploy landing page A/B test with winning creative to optimize conversion funnel entry",
      variable: "landing_page",
      duration: "7 days",
      successCriteria: "Conversion rate exceeds baseline floor with ≥95% confidence",
      fallbackAction: "Iterate on landing page copy based on engagement heatmap data",
    },
  ];
}

export async function runIterationEngine(
  performance: IterationPerformanceInput | null,
  funnel: IterationFunnelInput | null,
  creative: IterationCreativeInput | null,
  persuasion: IterationPersuasionInput | null,
  memoryContext?: string,
): Promise<IterationResult> {
  const startTime = Date.now();

  if (memoryContext) {
    console.log(`[IterationEngine] Memory context active (${memoryContext.length} chars) — avoid/reinforce patterns available for optimization target selection`);
  }

  const effectiveFunnel = funnel;
  const effectiveCreative = creative;

  const reliability = assessDataReliability(performance, effectiveFunnel || (performance ? {} as any : null), effectiveCreative || (performance ? {} as any : null));

  const perfLayer = layer1_performanceAnalysis(performance);
  const funnelLayer = layer2_funnelAnalysis(effectiveFunnel, performance);
  const creativeLayer = layer3_creativeAnalysis(effectiveCreative, performance);

  const layerResults: LayerResult[] = [perfLayer, funnelLayer, creativeLayer];
  const structuralWarnings: string[] = [];

  if (!performance && !funnel && !creative) {
    const benchmarkHypotheses = generateBenchmarkExplorationHypotheses();
    const benchmarkTargets = generateBenchmarkOptimizationTargets();
    const benchmarkPlan = generateBenchmarkExplorationPlan();

    return {
      status: STATUS.BENCHMARK_EXPLORATION,
      statusMessage: "No campaign data available — operating in Benchmark Exploration Mode with baseline hypotheses",
      nextTestHypotheses: benchmarkHypotheses,
      optimizationTargets: benchmarkTargets,
      failedStrategyFlags: [],
      iterationPlan: benchmarkPlan,
      layerResults,
      structuralWarnings: ["Benchmark Exploration Mode active — hypotheses are derived from industry baselines, not campaign data"],
      boundaryCheck: { passed: true, violations: [] },
      dataReliability: reliability,
      confidenceScore: 0.2,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
    };
  }

  let hypotheses = generateHypotheses(performance, funnel, creative, persuasion);
  if (hypotheses.length === 0) {
    hypotheses = generateBenchmarkExplorationHypotheses().slice(0, 2);
    structuralWarnings.push("No data-driven hypotheses generated — baseline exploration hypotheses injected");
  }
  const targets = generateOptimizationTargets(performance, funnel);
  const failedFlags = detectFailedStrategies(performance, creative);

  if (memoryContext) {
    const lines = memoryContext.split("\n");
    const reinforceTerms: string[] = [];
    const avoidTerms: string[] = [];
    let mode: "none" | "reinforce" | "avoid" = "none";
    for (const line of lines) {
      if (line.includes("REINFORCE") || line.includes("Reinforce") || line.includes("reinforce")) mode = "reinforce";
      else if (line.includes("AVOID") || line.includes("Avoid") || line.includes("avoid")) mode = "avoid";
      else if (mode === "reinforce") reinforceTerms.push(line.toLowerCase());
      else if (mode === "avoid") avoidTerms.push(line.toLowerCase());
    }
    const memoryAdjLog: string[] = [];
    for (const target of targets) {
      const targetText = `${target.metric || ""} ${target.improvementStrategy || ""}`.toLowerCase();
      const matchesReinforce = reinforceTerms.some(t => t.length > 3 && targetText.includes(t.trim().split(/\s+/)[0]));
      const matchesAvoid = avoidTerms.some(t => t.length > 3 && targetText.includes(t.trim().split(/\s+/)[0]));
      if (matchesReinforce) {
        target.priority = Math.min((target.priority || 0.5) + 0.15, 1.0);
        memoryAdjLog.push(`REINFORCE priority boost → ${target.metric}`);
      } else if (matchesAvoid) {
        target.priority = Math.max((target.priority || 0.5) - 0.2, 0.05);
        memoryAdjLog.push(`AVOID priority cut → ${target.metric}`);
      }
    }
    if (memoryAdjLog.length > 0) {
      console.log(`[IterationEngine] Memory context applied ${memoryAdjLog.length} optimization target adjustment(s): ${memoryAdjLog.join(", ")}`);
    } else {
      console.log(`[IterationEngine] Memory context active (${memoryContext.length} chars) — no direct target matches, patterns available for future runs`);
    }
  }

  const guardLayer = layer4_guardLayer(hypotheses, failedFlags, reliability);
  layerResults.push(guardLayer);

  for (const lr of layerResults) {
    structuralWarnings.push(...lr.warnings);
  }
  structuralWarnings.push(...reliability.advisories);

  const dedupedWarnings = deduplicateWarnings(structuralWarnings);
  structuralWarnings.length = 0;
  structuralWarnings.push(...dedupedWarnings);

  const dedupedHypotheses = deduplicateByField(hypotheses, "variable");
  const filteredHypotheses = dedupedHypotheses.slice(0, reliability.isWeak ? 1 : MAX_CONCURRENT_TESTS);

  const iterationPlan = generateIterationPlan(filteredHypotheses, targets, reliability);

  const allOutputText = [
    ...filteredHypotheses.map(h => h.hypothesis),
    ...targets.map(t => t.improvementStrategy),
    ...iterationPlan.map(s => s.action),
  ].join(" ");
  const boundaryCheck = sanitizeBoundary(allOutputText);

  if (!boundaryCheck.passed) {
    const safeHypotheses = generateBenchmarkExplorationHypotheses().slice(0, 1);
    const safeTargets = generateBenchmarkOptimizationTargets().slice(0, 1);
    const safePlan = generateBenchmarkExplorationPlan().slice(0, 1);

    return {
      status: STATUS.GUARD_BLOCKED,
      statusMessage: "Iteration plan output violated boundary protections — safe fallback hypotheses provided",
      nextTestHypotheses: safeHypotheses,
      optimizationTargets: safeTargets,
      failedStrategyFlags: failedFlags,
      iterationPlan: safePlan,
      layerResults,
      structuralWarnings: [...structuralWarnings, "Guard blocked original output — replaced with safe baseline hypotheses"],
      boundaryCheck,
      dataReliability: reliability,
      confidenceScore: 0.1,
      executionTimeMs: Date.now() - startTime,
      engineVersion: ENGINE_VERSION,
    };
  }

  const layersPassed = layerResults.filter(l => l.passed).length;
  const totalLayers = layerResults.length;
  const avgLayerScore = layerResults.reduce((s, l) => s + l.score, 0) / Math.max(totalLayers, 1);

  let rawConfidence = clamp(
    avgLayerScore * 0.4 +
    reliability.overallReliability * 0.3 +
    (guardLayer.passed ? 0.3 : 0.1)
  );

  if (reliability.isWeak) {
    rawConfidence = Math.min(rawConfidence * 0.6, 0.5);
  }

  const confidenceScore = clamp(rawConfidence);

  const status = guardLayer.passed ? STATUS.COMPLETE : STATUS.PROVISIONAL;
  const statusMessage = status === STATUS.PROVISIONAL
    ? "Iteration plan generated with guard warnings — operating in conservative mode"
    : `Iteration analysis complete: ${filteredHypotheses.length} test hypotheses, ${targets.length} optimization targets`;

  const acceptability = assessStrategyAcceptability(
    confidenceScore,
    layersPassed,
    totalLayers,
    guardLayer.passed,
    structuralWarnings,
  );

  return {
    status,
    statusMessage,
    nextTestHypotheses: filteredHypotheses,
    optimizationTargets: targets,
    failedStrategyFlags: failedFlags,
    iterationPlan,
    layerResults,
    structuralWarnings,
    boundaryCheck,
    dataReliability: reliability,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    strategyAcceptability: acceptability,
  };
}
