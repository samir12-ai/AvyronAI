import { db } from "../db";
import { campaignSelections, manualCampaignMetrics } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveBenchmark, getBenchmarkMetrics, type DataSourceMode } from "./benchmarks";
import { validateCampaignMetrics } from "./validation";

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
}

export async function resolveDataSource(campaignId: string, accountId: string = "default"): Promise<ResolvedDataSource> {
  const [selection] = await db.select().from(campaignSelections)
    .where(and(
      eq(campaignSelections.selectedCampaignId, campaignId),
      eq(campaignSelections.accountId, accountId),
    ))
    .limit(1);

  const mode: DataSourceMode = (selection?.dataSourceMode as DataSourceMode) || "benchmark";
  const location = selection?.campaignLocation || "global";
  const platform = selection?.selectedPlatform || "meta";

  if (mode === "benchmark") {
    return resolveBenchmarkSource(location, platform);
  }

  const [metrics] = await db.select().from(manualCampaignMetrics)
    .where(and(
      eq(manualCampaignMetrics.campaignId, campaignId),
      eq(manualCampaignMetrics.accountId, accountId),
    ))
    .orderBy(desc(manualCampaignMetrics.updatedAt))
    .limit(1);

  if (!metrics || metrics.spend <= 0 || (metrics.leads + metrics.conversions) <= 0) {
    console.log(`[DataSource] Campaign ${campaignId} has campaign_metrics mode but insufficient data — falling back to benchmark`);
    const fallback = resolveBenchmarkSource(location, platform);
    fallback.warnings.push("Campaign metrics mode selected but insufficient data available — using benchmark fallback");
    return fallback;
  }

  const results = metrics.leads + metrics.conversions;
  const cpa = metrics.spend / Math.max(results, 1);
  const revenue = metrics.revenue || 0;
  const computedROAS = metrics.spend > 0 && revenue > 0 ? revenue / metrics.spend : null;

  const validation = validateCampaignMetrics({
    spend: metrics.spend,
    results,
    cpa,
    revenue: revenue > 0 ? revenue : undefined,
    channelSource: platform,
  });

  if (!validation.valid) {
    console.log(`[DataSource] Campaign ${campaignId} metrics failed validation: ${validation.errors.join(", ")}`);
    const fallback = resolveBenchmarkSource(location, platform);
    fallback.warnings.push(`Campaign metrics failed validation: ${validation.errors.join("; ")}. Using benchmark fallback.`);
    return fallback;
  }

  const hasRevenue = revenue > 0;
  const hasEnoughData = metrics.spend > 50 && results >= 5;
  const confidence = hasEnoughData ? (hasRevenue ? 0.85 : 0.7) : 0.55;

  const structuredAnomalies: DataSourceAnomaly[] = validation.anomalies.map(msg => ({
    severity: msg.toLowerCase().includes("roas") && msg.includes(`${20}x`) ? "critical" as const : "warning" as const,
    message: msg,
  }));

  return {
    mode: "campaign_metrics",
    cpa,
    roas: computedROAS,
    spend: metrics.spend,
    results,
    revenue,
    isBenchmark: false,
    benchmarkLabel: null,
    anomalies: structuredAnomalies,
    warnings: validation.warnings,
    confidence,
    platform,
  };
}

function resolveBenchmarkSource(location: string, platform: string): ResolvedDataSource {
  const benchmark = resolveBenchmark(location, platform);
  const metrics = getBenchmarkMetrics(benchmark);

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
    confidence: 0.6,
    region: benchmark.region,
    platform: benchmark.platform,
  };
}
