import { db } from "../db";
import { strategicAuditLogs } from "@shared/schema";

export type AuditEvent =
  | "GATE_PASSED"
  | "EXTRACTION_COMPLETED"
  | "FIELD_EDITED"
  | "BLUEPRINT_CONFIRMED"
  | "BLUEPRINT_RESET"
  | "VALIDATION_COMPLETED"
  | "VALIDATION_FAILED"
  | "ORCHESTRATOR_GENERATED"
  | "DEMO_LOADED"
  | "LOCATION_BLOCKED";

interface AuditLogInput {
  accountId: string;
  campaignId?: string;
  blueprintId?: string;
  blueprintVersion?: number;
  event: AuditEvent;
  details?: Record<string, any>;
}

export async function logAuditEvent(input: AuditLogInput): Promise<void> {
  try {
    await db.insert(strategicAuditLogs).values({
      accountId: input.accountId,
      campaignId: input.campaignId || null,
      blueprintId: input.blueprintId || null,
      blueprintVersion: input.blueprintVersion || null,
      event: input.event,
      details: input.details ? JSON.stringify(input.details) : null,
      timestamp: new Date(),
    });
  } catch (err: any) {
    console.error("[AuditLog] Failed to log event:", input.event, err.message);
  }
}
