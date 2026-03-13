import { db } from "../db";
import { campaignSelections, manualCampaignMetrics } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveBenchmark, getBenchmarkMetrics, type DataSourceMode } from "./benchmarks";
import { validateCampaignMetrics } from "./validation";
import {
  assessStatisticalValidity,
  evaluateTransitionEligibility,
  type StatisticalValidityResult,
  type TransitionEligibility,
} from "./statistical-validity";
import { logModeTransition } from "./transition-log";

export interface DataSourceAnomaly {
  severity: "warning" | "critical";
  message: string;
}

export interface ResolvedDataSource {
  mode: DataSourceMode;
  cpa: number;
  roas: number | null;
  spend: number;
  results: number;
  revenue: number;
  isBenchmark: boolean;
  benchmarkLabel: string | null;
  anomalies: DataSourceAnomaly[];
  warnings: string[];
  confidence: number;
  region?: string;
  platform?: string;
  dataOrigin: "benchmark_static" | "benchmark_contextual" | "campaign_verified" | "campaign_fallback";
  switchReason: string | null;
  statisticalValidity: StatisticalValidityResult | null;
  isProjectionOnly: boolean;
  transitionEligibility: TransitionEligibility | null;
}

export async function resolveDataSource(campaignId: string, accountId: string = "default"): Promise<ResolvedDataSource> {
  const [selection] = await db.select().from(campaignSelections)
    .where(and(
      eq(campaignSelections.selectedCampaignId, campaignId),
      eq(campaignSelections.accountId, accountId),
    ))
    .limit(1);

  const configuredMode: DataSourceMode = (selection?.dataSourceMode as DataSourceMode) || "benchmark";
  const location = selection?.campaignLocation || "global";
  const platform = selection?.selectedPlatform || "meta";
  const goalType = selection?.campaignGoalType || "";

  const [metrics] = await db.select().from(manualCampaignMetrics)
    .where(and(
      eq(manualCampaignMetrics.campaignId, campaignId),
      eq(manualCampaignMetrics.accountId, accountId),
    ))
    .orderBy(desc(manualCampaignMetrics.updatedAt))
    .limit(1);

  const campaignConversions = metrics ? (metrics.leads + metrics.conversions) : 0;
  const campaignSpend = metrics?.spend ?? 0;
  const campaignRevenue = metrics?.revenue ?? 0;

  const transitionEligibility = evaluateTransitionEligibility(
    configuredMode,
    campaignConversions,
    campaignSpend,
    campaignRevenue,
  );

  let effectiveMode = configuredMode;
  let switchReason: string | null = null;

  if (configuredMode === "benchmark" && transitionEligibility.eligible && transitionEligibility.recommendedMode === "campaign_metrics") {
    effectiveMode = "campaign_metrics";
    switchReason = transitionEligibility.transitionReason;
    console.log(`[DataSource] ADAPTIVE SWITCH for campaign ${campaignId}: benchmark → campaign_metrics | reason: ${switchReason}`);
    await logModeTransition({
      timestamp: new Date().toISOString(),
      campaignId,
      accountId,
      previousMode: "benchmark",
      newMode: "campaign_metrics",
      transitionReason: switchReason || "Adaptive switch — thresholds met",
      statisticalEvidence: transitionEligibility.statisticalEvidence,
      triggeredBy: "adaptive_switch",
    });
  } else if (configuredMode === "campaign_metrics" && transitionEligibility.eligible && transitionEligibility.recommendedMode === "benchmark") {
    effectiveMode = "benchmark";
    switchReason = transitionEligibility.transitionReason;
    console.log(`[DataSource] ADAPTIVE DOWNGRADE for campaign ${campaignId}: campaign_metrics → benchmark | reason: ${switchReason}`);
    await logModeTransition({
      timestamp: new Date().toISOString(),
      campaignId,
      accountId,
      previousMode: "campaign_metrics",
      newMode: "benchmark",
      transitionReason: switchReason || "Adaptive downgrade — statistical validity lost",
      statisticalEvidence: transitionEligibility.statisticalEvidence,
      triggeredBy: "validation_fallback",
    });
  }

  if (effectiveMode === "benchmark") {
    const benchmarkResult = resolveBenchmarkSource(location, platform, goalType);
    benchmarkResult.switchReason = switchReason;
    benchmarkResult.transitionEligibility = transitionEligibility;

    if (campaignConversions > 0 || campaignSpend > 0) {
      benchmarkResult.statisticalValidity = assessStatisticalValidity(campaignConversions, campaignSpend, campaignRevenue);
    }

    if (switchReason) {
      benchmarkResult.warnings.push(`Mode reverted to benchmark: ${switchReason}`);
    }

    return benchmarkResult;
  }

  if (!metrics || campaignSpend <= 0 || campaignConversions <= 0) {
    console.log(`[DataSource] Campaign ${campaignId} has campaign_metrics mode but insufficient data — falling back to benchmark`);
    const fallback = resolveBenchmarkSource(location, platform, goalType);
    fallback.warnings.push("Campaign metrics mode selected but insufficient data available — using benchmark fallback");
    fallback.dataOrigin = "campaign_fallback";
    fallback.switchReason = switchReason || "Insufficient campaign data for metrics mode";
    fallback.transitionEligibility = transitionEligibility;
    return fallback;
  }

  const cpa = campaignSpend / Math.max(campaignConversions, 1);
  const computedROAS = campaignSpend > 0 && campaignRevenue > 0 ? campaignRevenue / campaignSpend : null;

  const validation = validateCampaignMetrics({
    spend: campaignSpend,
    results: campaignConversions,
    cpa,
    revenue: campaignRevenue > 0 ? campaignRevenue : undefined,
    channelSource: platform,
  });

  if (!validation.valid) {
    console.log(`[DataSource] Campaign ${campaignId} metrics failed validation: ${validation.errors.join(", ")}`);
    const fallback = resolveBenchmarkSource(location, platform, goalType);
    fallback.warnings.push(`Campaign metrics failed validation: ${validation.errors.join("; ")}. Using benchmark fallback.`);
    fallback.dataOrigin = "campaign_fallback";
    fallback.switchReason = "Campaign metrics failed validation";
    fallback.transitionEligibility = transitionEligibility;
    return fallback;
  }

  const statisticalValidity = assessStatisticalValidity(campaignConversions, campaignSpend, campaignRevenue);

  let confidence = statisticalValidity.confidenceLevel;

  const structuredAnomalies: DataSourceAnomaly[] = validation.anomalies.map(msg => ({
    severity: msg.toLowerCase().includes("roas") && msg.includes(`${20}x`) ? "critical" as const : "warning" as const,
    message: msg,
  }));

  return {
    mode: "campaign_metrics",
    cpa,
    roas: computedROAS,
    spend: campaignSpend,
    results: campaignConversions,
    revenue: campaignRevenue,
    isBenchmark: false,
    benchmarkLabel: null,
    anomalies: structuredAnomalies,
    warnings: validation.warnings,
    confidence,
    platform,
    dataOrigin: "campaign_verified",
    switchReason,
    statisticalValidity,
    isProjectionOnly: false,
    transitionEligibility,
  };
}

function inferSegmentFromGoalType(goalType: string): string | undefined {
  const lower = goalType.toLowerCase();
  if (lower.includes("saas") || lower.includes("software") || lower.includes("b2b") || lower.includes("subscription")) return "saas";
  if (lower.includes("enterprise") || lower.includes("corporate")) return "enterprise";
  if (lower.includes("retail") || lower.includes("ecommerce") || lower.includes("e-commerce") || lower.includes("smb") || lower.includes("small business")) return "smb";
  return undefined;
}

function resolveBenchmarkSource(location: string, platform: string, goalType: string = ""): ResolvedDataSource {
  const segment = inferSegmentFromGoalType(goalType);
  const benchmark = resolveBenchmark(location, platform, segment);
  const metrics = getBenchmarkMetrics(benchmark);
  const benchmarkConfidence = benchmark.confidenceWeight ?? 0.6;

  return {
    mode: "benchmark",
    cpa: metrics.cpa,
    roas: metrics.roas,
    spend: 0,
    results: 0,
    revenue: 0,
    isBenchmark: true,
    benchmarkLabel: `Benchmark-based projections (${benchmark.region.toUpperCase()} – ${benchmark.platform.toUpperCase()} ${benchmark.segment.toUpperCase()})`,
    anomalies: [],
    warnings: [],
    confidence: benchmarkConfidence,
    region: benchmark.region,
    platform: benchmark.platform,
    dataOrigin: "benchmark_contextual",
    switchReason: null,
    statisticalValidity: null,
    isProjectionOnly: true,
    transitionEligibility: null,
  };
}
