import { z } from "zod";

export const SignalOriginTypeEnum = z.enum([
  "real",
  "competitor",
  "inferred",
  "fallback",
  "unknown",
]);
export type SignalOriginType = z.infer<typeof SignalOriginTypeEnum>;

export const ValidationStateEnum = z.enum([
  "validated",
  "provisional",
  "weak",
  "rejected",
  "unknown",
]);
export type ValidationState = z.infer<typeof ValidationStateEnum>;

export const PlanSourceEnum = z.enum([
  "decision_driven",
  "degraded_no_decisions",
  "degraded_ai_failed",
  "deterministic_fallback",
  "unknown",
]);
export type PlanSource = z.infer<typeof PlanSourceEnum>;

export const DegradationSourceEnum = z.enum([
  "fetch",
  "ai_timeout",
  "ai_failure",
  "data_quality",
  "fallback_plan",
  "system-control",
  "contract_incomplete",
  "missing_dependency",
  "stale_snapshot",
]);

export const DegradationSchema = z.object({
  flag: z.literal(true),
  reason: z.string(),
  source: DegradationSourceEnum,
  signalOrigin: SignalOriginTypeEnum,
});
export type Degradation = z.infer<typeof DegradationSchema>;

export const SignalOriginDistributionSchema = z.object({
  real: z.number(),
  competitor: z.number(),
  inferred: z.number(),
  fallback: z.number(),
  unknown: z.number(),
});
export type SignalOriginDistribution = z.infer<typeof SignalOriginDistributionSchema>;

export const RoasModeEnum = z.enum(["REAL", "MANUAL", "PLAN", "UNAVAILABLE"]);

export const FatigueSeverityEnum = z.enum(["none", "warn", "critical", "unavailable"]);
export const FatigueAffectedSurfaceEnum = z.enum(["audience", "creative", "mixed", "unknown"]);
export const FatigueReasonCodeEnum = z.enum([
  "CTR_DECLINE",
  "FREQUENCY_HIGH",
  "IMPRESSIONS_RISING",
  "INSUFFICIENT_DATA",
  "REACH_SATURATED",
]);

export const TrajectoryDeltaSeverityEnum = z.enum([
  "none",
  "watch",
  "warn",
  "critical",
  "unknown",
]);
export type TrajectoryDeltaSeverity = z.infer<typeof TrajectoryDeltaSeverityEnum>;

export const TrajectoryDeltaSchema = z.object({
  field: z.string(),
  previous: z.number(),
  current: z.number(),
  delta: z.number(),
  severity: TrajectoryDeltaSeverityEnum,
});

export const RetentionSeverityEnum = z.enum([
  "none",
  "watch",
  "risk",
  "urgent",
  "unavailable",
]);
export const ChurnIndicatorEnum = z.enum([
  "RETENTION_LOOPS_MISSING",
  "CHURN_RISK_FLAG",
  "LTV_COMPRESSION",
  "UPSELL_GAP",
  "BOUNDARY_VIOLATION",
  "WEAK_DATA_RELIABILITY",
]);

export const EarlyWarningVerdictEnum = z.enum(["CALM", "WATCH", "ACT", "BLOCK"]);
export type EarlyWarningVerdict = z.infer<typeof EarlyWarningVerdictEnum>;

export const RoasSignalSchema = z.object({
  value: z.number().nullable(),
  delta: z.number().nullable(),
  mode: RoasModeEnum,
  signalOrigin: SignalOriginTypeEnum,
  degraded: DegradationSchema.nullable(),
  sourceEndpoint: z.literal("/api/dashboard/metrics"),
});

export const CreativeFatigueSignalSchema = z.object({
  severity: FatigueSeverityEnum,
  affectedSurface: FatigueAffectedSurfaceEnum,
  reasonCodes: z.array(FatigueReasonCodeEnum),
  signalOrigin: SignalOriginTypeEnum,
  degraded: DegradationSchema.nullable(),
  sourceEndpoint: z.literal("/api/guardrails/fatigue"),
});

export const CompetitorTrajectoryShiftSchema = z.object({
  severity: TrajectoryDeltaSeverityEnum,
  deltas: z.array(TrajectoryDeltaSchema),
  heating: z.number().nullable(),
  angleSaturation: z.number().nullable(),
  narrativeConvergence: z.number().nullable(),
  signalOrigin: SignalOriginTypeEnum,
  degraded: DegradationSchema.nullable(),
  sourceEndpoint: z.literal("/api/ci/mi-v3/trajectory"),
});

export const RetentionRiskSignalSchema = z.object({
  severity: RetentionSeverityEnum,
  churnIndicators: z.array(ChurnIndicatorEnum),
  signalOrigin: SignalOriginTypeEnum,
  degraded: DegradationSchema.nullable(),
  sourceEndpoint: z.literal("/api/strategy/retention-engine/latest"),
});

export const EarlyWarningResponseSchema = z.object({
  campaignId: z.string(),
  accountId: z.string(),
  generatedAt: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  signalOrigin: SignalOriginDistributionSchema,
  degraded: DegradationSchema.nullable(),
  validationState: ValidationStateEnum,
  planSource: PlanSourceEnum,
  fallbackPlanIsolated: z.boolean(),
  signals: z.object({
    roas: RoasSignalSchema,
    creativeFatigue: CreativeFatigueSignalSchema,
    competitorTrajectoryShift: CompetitorTrajectoryShiftSchema,
    retentionRisk: RetentionRiskSignalSchema,
  }),
  earlyWarningVerdict: EarlyWarningVerdictEnum,
  earlyWarningRationale: z.string(),
  contractIncompleteFields: z.array(z.string()),
});

export type EarlyWarningResponse = z.infer<typeof EarlyWarningResponseSchema>;
export type RoasSignal = z.infer<typeof RoasSignalSchema>;
export type CreativeFatigueSignal = z.infer<typeof CreativeFatigueSignalSchema>;
export type CompetitorTrajectoryShift = z.infer<typeof CompetitorTrajectoryShiftSchema>;
export type RetentionRiskSignal = z.infer<typeof RetentionRiskSignalSchema>;
