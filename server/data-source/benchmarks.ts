export type DataSourceMode = "campaign_metrics" | "benchmark";

export interface RegionalBenchmark {
  region: string;
  platform: string;
  segment: string;
  cpcRange: { min: number; max: number };
  cpaRange: { min: number; max: number };
  ctrRange: { min: number; max: number };
  conversionRateRange: { min: number; max: number };
  roasRange: { min: number; max: number };
}

const BENCHMARKS: RegionalBenchmark[] = [
  {
    region: "dubai",
    platform: "meta",
    segment: "smb",
    cpcRange: { min: 0.70, max: 1.20 },
    cpaRange: { min: 12, max: 35 },
    ctrRange: { min: 1.2, max: 2.5 },
    conversionRateRange: { min: 2, max: 5 },
    roasRange: { min: 1.5, max: 4.0 },
  },
  {
    region: "dubai",
    platform: "meta",
    segment: "enterprise",
    cpcRange: { min: 1.00, max: 2.50 },
    cpaRange: { min: 25, max: 80 },
    ctrRange: { min: 0.8, max: 2.0 },
    conversionRateRange: { min: 1.5, max: 4 },
    roasRange: { min: 2.0, max: 6.0 },
  },
  {
    region: "uae",
    platform: "meta",
    segment: "smb",
    cpcRange: { min: 0.60, max: 1.10 },
    cpaRange: { min: 10, max: 30 },
    ctrRange: { min: 1.0, max: 2.3 },
    conversionRateRange: { min: 2, max: 5 },
    roasRange: { min: 1.5, max: 4.0 },
  },
  {
    region: "global",
    platform: "meta",
    segment: "smb",
    cpcRange: { min: 0.50, max: 1.50 },
    cpaRange: { min: 10, max: 40 },
    ctrRange: { min: 0.9, max: 2.0 },
    conversionRateRange: { min: 1.5, max: 4.5 },
    roasRange: { min: 1.2, max: 3.5 },
  },
  {
    region: "global",
    platform: "tiktok",
    segment: "smb",
    cpcRange: { min: 0.30, max: 1.00 },
    cpaRange: { min: 8, max: 30 },
    ctrRange: { min: 1.5, max: 3.5 },
    conversionRateRange: { min: 1.0, max: 3.0 },
    roasRange: { min: 1.0, max: 3.0 },
  },
  {
    region: "global",
    platform: "google",
    segment: "smb",
    cpcRange: { min: 1.00, max: 3.00 },
    cpaRange: { min: 15, max: 50 },
    ctrRange: { min: 2.0, max: 5.0 },
    conversionRateRange: { min: 2.0, max: 5.0 },
    roasRange: { min: 1.5, max: 4.5 },
  },
];

function normalizeLocation(location: string): string {
  const lower = location.toLowerCase().trim();
  if (lower.includes("dubai")) return "dubai";
  if (lower.includes("uae") || lower.includes("emirates")) return "uae";
  return "global";
}

export function resolveBenchmark(location: string, platform: string): RegionalBenchmark {
  const region = normalizeLocation(location);
  const normalizedPlatform = platform.toLowerCase().trim();

  let match = BENCHMARKS.find(b => b.region === region && b.platform === normalizedPlatform);
  if (!match) {
    match = BENCHMARKS.find(b => b.region === region && b.platform === "meta");
  }
  if (!match) {
    match = BENCHMARKS.find(b => b.region === "global" && b.platform === normalizedPlatform);
  }
  if (!match) {
    match = BENCHMARKS.find(b => b.region === "global" && b.platform === "meta")!;
  }

  return match;
}

export function getBenchmarkMetrics(benchmark: RegionalBenchmark) {
  const midCPA = (benchmark.cpaRange.min + benchmark.cpaRange.max) / 2;
  const midROAS = (benchmark.roasRange.min + benchmark.roasRange.max) / 2;
  const midCPC = (benchmark.cpcRange.min + benchmark.cpcRange.max) / 2;
  const midCTR = (benchmark.ctrRange.min + benchmark.ctrRange.max) / 2;
  const midConvRate = (benchmark.conversionRateRange.min + benchmark.conversionRateRange.max) / 2;

  return {
    cpa: midCPA,
    roas: midROAS,
    cpc: midCPC,
    ctr: midCTR,
    conversionRate: midConvRate,
    source: "benchmark" as const,
    region: benchmark.region,
    platform: benchmark.platform,
    segment: benchmark.segment,
    ranges: {
      cpa: benchmark.cpaRange,
      roas: benchmark.roasRange,
      cpc: benchmark.cpcRange,
      ctr: benchmark.ctrRange,
      conversionRate: benchmark.conversionRateRange,
    },
  };
}
