import type { DataSourceMode } from "./benchmarks";

export interface MetricsValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  anomalies: string[];
  computedROAS: number | null;
}

export interface CampaignMetricsInput {
  spend: number;
  results: number;
  cpa: number;
  revenue?: number;
  channelSource?: string;
}

const ANOMALY_CPA_FLOOR = 1;
const ANOMALY_ROAS_CEILING = 20;

export function validateCampaignMetrics(metrics: CampaignMetricsInput): MetricsValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const anomalies: string[] = [];

  if (metrics.spend <= 0) {
    errors.push("Total Spend must be greater than 0");
  }

  if (metrics.results <= 0) {
    errors.push("Results (conversions or leads) must be greater than 0");
  }

  if (metrics.spend > 0 && metrics.results > 0) {
    const expectedCPA = metrics.spend / metrics.results;
    const cpaDeviation = Math.abs(metrics.cpa - expectedCPA) / Math.max(expectedCPA, 0.01);
    if (cpaDeviation > 0.15) {
      errors.push(`CPA ($${metrics.cpa.toFixed(2)}) is inconsistent with Spend/Results — expected ~$${expectedCPA.toFixed(2)}`);
    }
  }

  let computedROAS: number | null = null;
  if (metrics.revenue !== undefined && metrics.revenue > 0 && metrics.spend > 0) {
    computedROAS = metrics.revenue / metrics.spend;
  }

  if (metrics.cpa > 0 && metrics.cpa < ANOMALY_CPA_FLOOR) {
    anomalies.push(`CPA ($${metrics.cpa.toFixed(2)}) is below $${ANOMALY_CPA_FLOOR} — this is unusually low and may indicate data error`);
  }

  if (computedROAS !== null && computedROAS > ANOMALY_ROAS_CEILING) {
    anomalies.push(`ROAS (${computedROAS.toFixed(1)}x) exceeds ${ANOMALY_ROAS_CEILING}x — this is unusually high and may indicate data error`);
  }

  if (!metrics.revenue || metrics.revenue <= 0) {
    warnings.push("Revenue not provided — ROAS cannot be computed. Financial projections will be limited.");
  }

  if (!metrics.channelSource) {
    warnings.push("Channel source not specified — using default platform benchmarks for comparison.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    anomalies,
    computedROAS,
  };
}

export function validateDataSourceMode(mode: string): mode is DataSourceMode {
  return mode === "campaign_metrics" || mode === "benchmark";
}
