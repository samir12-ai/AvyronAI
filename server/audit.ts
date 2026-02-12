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
  | "STATE_TRANSITION";

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
