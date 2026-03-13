import { ENGINE_VERSION } from "../market-intelligence-v3/constants";

export type FreshnessClass = "FRESH" | "AGING" | "NEEDS_REFRESH" | "RESTORED" | "PARTIAL" | "INCOMPATIBLE";

export interface StalenessResult {
  coefficient: number;
  freshnessClass: FreshnessClass;
  ageInDays: number;
  trustScore: number;
  warning: string | null;
  blockedForStrategy: boolean;
}

export interface SchemaValidationResult {
  compatible: boolean;
  missingFields: string[];
  extraFields: string[];
  schemaVersion: number;
  snapshotVersion: number;
  recommendation: "USE" | "USE_WITH_CAUTION" | "INCOMPATIBLE";
}

const FRESHNESS_THRESHOLDS = {
  FRESH_MAX_HOURS: 24,
  AGING_MAX_DAYS: 7,
  NEEDS_REFRESH_MAX_DAYS: 14,
} as const;

const REQUIRED_MI_FIELDS = [
  "signalData",
  "confidenceData",
  "marketState",
  "trajectoryData",
  "dominanceData",
] as const;

const OPTIONAL_MI_FIELDS = [
  "narrativeSynthesis",
  "marketDiagnosis",
  "objectionMapData",
  "contentDnaData",
  "semanticClusterData",
  "diagnosticsData",
  "missingSignalFlags",
] as const;

export function computeStalenessCoefficient(snapshot: any): StalenessResult {
  const now = Date.now();
  const createdAt = snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : now;
  const ageMs = Math.max(0, now - createdAt);
  const ageInDays = Math.round((ageMs / (24 * 60 * 60 * 1000)) * 100) / 100;
  const ageInHours = ageMs / (3600 * 1000);

  const status = snapshot.status || "COMPLETE";

  if (status === "INCOMPATIBLE") {
    return {
      coefficient: 1.0,
      freshnessClass: "INCOMPATIBLE",
      ageInDays,
      trustScore: 0,
      warning: "Snapshot schema is incompatible with current engine version. Re-run analysis.",
      blockedForStrategy: true,
    };
  }

  let freshnessClass: FreshnessClass;
  let coefficient: number;

  if (status === "PARTIAL") {
    freshnessClass = "PARTIAL";
    coefficient = Math.min(1, 0.2 + (ageInDays / FRESHNESS_THRESHOLDS.NEEDS_REFRESH_MAX_DAYS) * 0.8);
  } else if (ageInHours <= FRESHNESS_THRESHOLDS.FRESH_MAX_HOURS) {
    freshnessClass = "FRESH";
    coefficient = ageInHours / FRESHNESS_THRESHOLDS.FRESH_MAX_HOURS * 0.1;
  } else if (ageInDays <= FRESHNESS_THRESHOLDS.AGING_MAX_DAYS) {
    freshnessClass = "AGING";
    coefficient = 0.1 + ((ageInDays - 1) / (FRESHNESS_THRESHOLDS.AGING_MAX_DAYS - 1)) * 0.4;
  } else if (ageInDays <= FRESHNESS_THRESHOLDS.NEEDS_REFRESH_MAX_DAYS) {
    freshnessClass = "NEEDS_REFRESH";
    coefficient = 0.5 + ((ageInDays - FRESHNESS_THRESHOLDS.AGING_MAX_DAYS) /
      (FRESHNESS_THRESHOLDS.NEEDS_REFRESH_MAX_DAYS - FRESHNESS_THRESHOLDS.AGING_MAX_DAYS)) * 0.5;
  } else {
    freshnessClass = "NEEDS_REFRESH";
    coefficient = 1.0;
  }

  coefficient = Math.round(Math.min(1, Math.max(0, coefficient)) * 1000) / 1000;
  const trustScore = Math.round((1 - coefficient) * 1000) / 1000;

  const blockedForStrategy = freshnessClass === "NEEDS_REFRESH" || freshnessClass === "INCOMPATIBLE";

  let warning: string | null = null;
  if (freshnessClass === "NEEDS_REFRESH") {
    warning = `Data is ${Math.round(ageInDays)} days old and needs refresh. Re-run analysis for accurate results.`;
  } else if (freshnessClass === "AGING") {
    warning = `Data is ${Math.round(ageInDays)} days old. Consider re-running analysis for fresher insights.`;
  } else if (freshnessClass === "PARTIAL") {
    warning = `Analysis was completed with partial data. Some signals may be missing.`;
  }

  return { coefficient, freshnessClass, ageInDays, trustScore, warning, blockedForStrategy };
}

export function classifyFreshness(snapshot: any): FreshnessClass {
  return computeStalenessCoefficient(snapshot).freshnessClass;
}

export function validateSnapshotSchema(snapshot: any, currentVersion: number = ENGINE_VERSION): SchemaValidationResult {
  const snapshotVersion = snapshot.analysisVersion ?? snapshot.version ?? 0;
  const missingFields: string[] = [];
  const extraFields: string[] = [];

  for (const field of REQUIRED_MI_FIELDS) {
    const value = snapshot[field];
    if (value === null || value === undefined || value === "") {
      missingFields.push(field);
    } else if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed === null || (typeof parsed === "object" && Object.keys(parsed).length === 0)) {
          missingFields.push(field);
        }
      } catch {
        // non-JSON string is acceptable (e.g., marketState = "STABLE")
      }
    }
  }

  const knownFields = new Set<string>([...REQUIRED_MI_FIELDS, ...OPTIONAL_MI_FIELDS]);
  const metadataFields = new Set([
    "id", "accountId", "campaignId", "status", "analysisVersion", "version",
    "createdAt", "updatedAt", "dataFreshnessDays", "executionTimeMs",
    "dataStatus", "mode", "goalMode", "executionMode", "cacheInvalidationReason",
    "snapshotStatus", "enrichmentStatus", "competitorCount",
  ]);
  if (snapshot && typeof snapshot === "object") {
    for (const key of Object.keys(snapshot)) {
      if (!knownFields.has(key) && !metadataFields.has(key) && key.endsWith("Data")) {
        extraFields.push(key);
      }
    }
  }

  let recommendation: "USE" | "USE_WITH_CAUTION" | "INCOMPATIBLE";

  if (missingFields.length >= 3) {
    recommendation = "INCOMPATIBLE";
  } else if (missingFields.length > 0 || snapshotVersion !== currentVersion) {
    recommendation = "USE_WITH_CAUTION";
  } else {
    recommendation = "USE";
  }

  return {
    compatible: recommendation !== "INCOMPATIBLE",
    missingFields,
    extraFields,
    schemaVersion: currentVersion,
    snapshotVersion,
    recommendation,
  };
}

export interface FreshnessMetadata {
  freshnessClass: FreshnessClass;
  ageInDays: number;
  trustScore: number;
  stalenessCoefficient: number;
  warning: string | null;
  blockedForStrategy: boolean;
  schemaCompatible: boolean;
  schemaRecommendation: "USE" | "USE_WITH_CAUTION" | "INCOMPATIBLE";
}

export function buildFreshnessMetadata(snapshot: any): FreshnessMetadata {
  const staleness = computeStalenessCoefficient(snapshot);
  const schema = validateSnapshotSchema(snapshot);

  let freshnessClass = staleness.freshnessClass;
  let blockedForStrategy = staleness.blockedForStrategy;

  if (!schema.compatible) {
    freshnessClass = "INCOMPATIBLE";
    blockedForStrategy = true;
  }

  return {
    freshnessClass,
    ageInDays: staleness.ageInDays,
    trustScore: staleness.trustScore,
    stalenessCoefficient: staleness.coefficient,
    warning: !schema.compatible
      ? "Snapshot schema is incompatible with current engine. Re-run analysis."
      : staleness.warning,
    blockedForStrategy,
    schemaCompatible: schema.compatible,
    schemaRecommendation: schema.recommendation,
  };
}

export function logFreshnessTraceability(engineName: string, snapshot: any, metadata?: FreshnessMetadata): void {
  const fm = metadata || buildFreshnessMetadata(snapshot);
  console.log(
    `[${engineName}] DATA_FRESHNESS | class=${fm.freshnessClass} | age=${fm.ageInDays}d | trust=${fm.trustScore} | staleness=${fm.stalenessCoefficient} | schema=${fm.schemaRecommendation} | blockedForStrategy=${fm.blockedForStrategy}`
  );
}
