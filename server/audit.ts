import { db } from "./db";
import { auditLog } from "@shared/schema";

export type AuditEventType =
  | "GUARDRAIL_TRIGGER"
  | "AUTO_EXECUTION"
  | "BLOCKED_DECISION"
  | "DRIFT_DETECTED"
  | "DRIFT_CLEARED"
  | "SAFE_MODE_ACTIVATED"
  | "SAFE_MODE_CLEARED"
  | "AUTOPILOT_TOGGLED"
  | "EMERGENCY_STOP"
  | "JOB_STARTED"
  | "JOB_COMPLETED"
  | "JOB_FAILED"
  | "VOLATILITY_CHANGE"
  | "OUTCOME_EVALUATED"
  | "FATIGUE_DETECTED"
  | "STATE_CHANGE"
  | "CONFIDENCE_UPDATED"
  | "STATE_TRANSITION"
  | "MONTHLY_CAP_BLOCKED"
  | "PUBLISH_RETRY_FAILED"
  | "META_API_ERROR"
  | "PUBLISH_SUCCESS"
  | "PUBLISH_FAILED"
  | "WORKER_SHUTDOWN"
  | "WORKER_STARTUP"
  | "FEATURE_FLAG_TOGGLED"
  | "FLAG_DEPENDENCY_BLOCKED"
  | "LEAD_ENGINE_GLOBAL_KILL"
  | "LEAD_CAPTURED"
  | "LEAD_STATUS_CHANGED"
  | "CTA_VARIANT_GENERATED"
  | "CTA_AUTO_PROMOTED"
  | "CONVERSION_EVENT"
  | "FUNNEL_BOTTLENECK_DETECTED"
  | "LEAD_MAGNET_GENERATED"
  | "LANDING_PAGE_PUBLISHED"
  | "REVENUE_ATTRIBUTED"
  | "AI_LEAD_OPTIMIZATION_RUN"
  | "LEAD_ENGINE_CYCLE"
  | "INTELLIGENCE_RUN"
  | "STRATEGY_RECOMMENDED"
  | "STRATEGY_APPLIED"
  | "STRATEGY_REJECTED"
  | "SIGNAL_SUPPRESSED"
  | "SIGNAL_DOWNGRADED"
  | "DATA_INTEGRITY_WARNING"
  | "META_MODE_TRANSITION"
  | "META_TOKEN_EXCHANGED"
  | "META_TOKEN_EXPIRED"
  | "META_TOKEN_REVOKED"
  | "META_PERMISSION_VERIFIED"
  | "META_HEALTH_CHECK"
  | "META_AUTO_EXTENSION"
  | "META_DISCONNECTED"
  | "META_CONNECTED"
  | "METRICS_RESET"
  | "META_TEMPORARY_ERROR"
  | "META_RATE_LIMITED"
  | "META_BACKOFF_APPLIED"
  | "DOMINANCE_RUN"
  | "DOMINANCE_ANALYSIS_COMPLETED"
  | "DOMINANCE_MOD_PROPOSED"
  | "DOMINANCE_MODIFICATIONS_GENERATED"
  | "DOMINANCE_MOD_APPROVED"
  | "DOMINANCE_MODIFICATIONS_APPROVED"
  | "DOMINANCE_MOD_REJECTED"
  | "DOMINANCE_MODIFICATIONS_REJECTED"
  | "DOMINANCE_MOD_APPLIED"
  | "DOMINANCE_FALLBACK_ACKNOWLEDGED"
  | "DOMINANCE_RETRY"
  | "DOMINANCE_ROLLBACK";

export async function logAudit(
  accountId: string,
  eventType: AuditEventType,
  options: {
    decisionId?: string;
    details?: Record<string, unknown>;
    guardrailResult?: Record<string, unknown>;
    riskLevel?: string;
    executionStatus?: string;
    preMetrics?: Record<string, unknown>;
    postMetrics?: Record<string, unknown>;
  } = {}
) {
  try {
    await db.insert(auditLog).values({
      accountId,
      eventType,
      decisionId: options.decisionId || null,
      details: options.details ? JSON.stringify(options.details) : null,
      guardrailResult: options.guardrailResult ? JSON.stringify(options.guardrailResult) : null,
      riskLevel: options.riskLevel || null,
      executionStatus: options.executionStatus || null,
      preMetrics: options.preMetrics ? JSON.stringify(options.preMetrics) : null,
      postMetrics: options.postMetrics ? JSON.stringify(options.postMetrics) : null,
    });
  } catch (error) {
    console.error("[Audit] Failed to log event:", eventType, error);
  }
}
