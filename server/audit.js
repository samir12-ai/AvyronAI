import { db } from "./db";
import { auditLog } from "@shared/schema";
export async function logAudit(accountId, eventType, options = {}) {
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
    }
    catch (error) {
        console.error("[Audit] Failed to log event:", eventType, error);
    }
}
