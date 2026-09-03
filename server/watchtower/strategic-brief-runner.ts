import { eq, and, desc, sql, inArray, ne, lt } from "drizzle-orm";
import { db } from "../db";
import { watchtowerStrategicBriefs, pipelineChangeEvents } from "../../shared/schema";
import { buildStrategicContext, type EvidenceRegistryEntry } from "./strategic-brief-context";
import {
  runStrategicInterpreter,
  validateBriefDeterministic,
  runBriefJudge,
  calculateDerivedConfidence,
  type LLMBriefResponse,
  type JudgeResult
} from "./strategic-brief-generator";

const LOG = "[StrategicBriefRunner]";
const MAX_ATTEMPTS = 2;

// Generator, prompt, judge, and evidence code versions for version resolution
export const GENERATOR_VERSION = "v1.0.0";
export const PROMPT_VERSION = "v1.0.0";
export const JUDGE_VERSION = "v1.0.0";
export const EVIDENCE_VERSION = "v1.0.0";

export interface SanitizedFailureDetails {
  stage: string;
  message: string;
  retryability: boolean;
  timestamp: string;
  category: string;
}

// Helper to sanitize failure details (removes stack traces, credentials, keys)
function sanitizeError(stage: string, err: any): SanitizedFailureDetails {
  const message = err?.message || String(err);
  let category = "operational_error";
  if (message.includes("API key") || message.includes("auth") || message.includes("credential")) {
    category = "security_redacted";
  } else if (message.includes("timeout") || message.includes("timed out")) {
    category = "timeout_error";
  } else if (message.includes("JSON")) {
    category = "schema_parsing_error";
  }
  
  // Clean safe message - strip anything resembling API keys or stack traces
  const safeMessage = message
    .replace(/[a-zA-Z0-9_-]{32,}/g, "[REDACTED_IDENTIFIER]")
    .slice(0, 500); // hard size limit

  return {
    stage,
    message: safeMessage,
    retryability: category !== "security_redacted",
    timestamp: new Date().toISOString(),
    category,
  };
}

// Atomically transition is_latest flag for event_id in a single transaction
async function promoteToLatest(briefId: string, eventId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // 1. Demote all existing versions to false
    await tx
      .update(watchtowerStrategicBriefs)
      .set({ isLatest: false, updatedAt: new Date() })
      .where(eq(watchtowerStrategicBriefs.eventId, eventId));

    // 2. Promote the target brief to latest
    await tx
      .update(watchtowerStrategicBriefs)
      .set({ isLatest: true, updatedAt: new Date() })
      .where(eq(watchtowerStrategicBriefs.id, briefId));
  });
}

// Main generation pipeline execution
export async function executeBriefJob(briefId: string): Promise<void> {
  const [briefRow] = await db
    .select()
    .from(watchtowerStrategicBriefs)
    .where(eq(watchtowerStrategicBriefs.id, briefId))
    .limit(1);

  if (!briefRow) {
    console.error(`${LOG} Job ${briefId} not found`);
    return;
  }

  // Atomic claim using transaction guard
  const wasClaimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: watchtowerStrategicBriefs.status })
      .from(watchtowerStrategicBriefs)
      .where(eq(watchtowerStrategicBriefs.id, briefId))
      .limit(1);

    if (row?.status !== "queued") return false;

    await tx
      .update(watchtowerStrategicBriefs)
      .set({
        status: "generating",
        startedAt: new Date(),
        updatedAt: new Date(),
        attemptCount: briefRow.attemptCount + 1,
      })
      .where(eq(watchtowerStrategicBriefs.id, briefId));
    return true;
  });

  if (!wasClaimed) {
    console.log(`${LOG} Job ${briefId} already processed/claimed by another thread`);
    return;
  }

  console.log(`${LOG} Started brief generation for job ${briefId} (event ${briefRow.eventId})`);

  try {
    // 1. Context collection
    const context = await buildStrategicContext(briefRow.eventId, briefRow.campaignId, briefRow.accountId);

    // Save versions to table for absolute traceability
    await db
      .update(watchtowerStrategicBriefs)
      .set({
        contextFingerprint: context.contextFingerprint,
        evidenceRegistry: context.evidenceRegistry,
        contextLineage: context.contextLineage,
        sourceVersions: context.sourceVersions,
        updatedAt: new Date(),
      })
      .where(eq(watchtowerStrategicBriefs.id, briefId));

    // 2. Check Idempotency - Reuse identical ready context
    const [existingMatch] = await db
      .select()
      .from(watchtowerStrategicBriefs)
      .where(
        and(
          eq(watchtowerStrategicBriefs.eventId, briefRow.eventId),
          eq(watchtowerStrategicBriefs.contextFingerprint, context.contextFingerprint),
          eq(watchtowerStrategicBriefs.promptVersion, PROMPT_VERSION),
          eq(watchtowerStrategicBriefs.generatorVersion, GENERATOR_VERSION),
          eq(watchtowerStrategicBriefs.judgeVersion, JUDGE_VERSION),
          eq(watchtowerStrategicBriefs.evidenceVersion, EVIDENCE_VERSION),
          inArray(watchtowerStrategicBriefs.status, ["ready", "insufficient_evidence"]),
          eq(watchtowerStrategicBriefs.isLatest, true)
        )
      )
      .limit(1);

    if (existingMatch) {
      console.log(`${LOG} Idempotency hit. Copying completed brief from ${existingMatch.id} to ${briefId}`);
      await db
        .update(watchtowerStrategicBriefs)
        .set({
          status: existingMatch.status,
          brief: existingMatch.brief,
          deterministicViolations: existingMatch.deterministicViolations,
          judgeResult: existingMatch.judgeResult,
          modelProposedConfidence: existingMatch.modelProposedConfidence,
          finalValidatedConfidence: existingMatch.finalValidatedConfidence,
          confidenceAdjustmentReasons: existingMatch.confidenceAdjustmentReasons,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(watchtowerStrategicBriefs.id, briefId));
      
      await promoteToLatest(briefId, briefRow.eventId);
      return;
    }

    // 3. LLM Strategy Interpretation
    let briefResponse: LLMBriefResponse;
    try {
      briefResponse = await runStrategicInterpreter(briefRow.eventId, context.evidenceRegistry, briefRow.accountId);
    } catch (llmErr) {
      throw { stage: "llm_generation", error: llmErr };
    }

    // 4. Update status to validating
    await db
      .update(watchtowerStrategicBriefs)
      .set({ status: "validating", updatedAt: new Date() })
      .where(eq(watchtowerStrategicBriefs.id, briefId));

    // Fallback if registry was marked insufficient
    if (briefResponse.executiveSummary === "INSUFFICIENT_EVIDENCE") {
      await db
        .update(watchtowerStrategicBriefs)
        .set({
          status: "insufficient_evidence",
          brief: briefResponse,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(watchtowerStrategicBriefs.id, briefId));
      await promoteToLatest(briefId, briefRow.eventId);
      return;
    }

    // 5. Deterministic Validation & Judge verification
    let violations = validateBriefDeterministic(briefResponse, context.evidenceRegistry);
    let judgeResult: JudgeResult | null = null;
    
    if (violations.length === 0) {
      judgeResult = await runBriefJudge(briefResponse, context.evidenceRegistry, briefRow.accountId);
      
      // Enforce claim-level Judge policies (fail if unsupported critical claims are found)
      const unsupportedCritical = judgeResult.claims.some(
        (c) => c.verdict === "unsupported" && 
               briefResponse.claims.find((cl) => cl.claimId === c.claimId)?.criticality === "critical"
      );
      
      if (judgeResult.verdict === "REJECT" || unsupportedCritical) {
        violations.push("Judge validation rejected: " + judgeResult.claims.map(c => `${c.claimId}: ${c.verdict} (${c.violations.join(", ")})`).join("; "));
      }
    }

    // Self-correction Retry Loop (once)
    if (violations.length > 0) {
      console.log(`${LOG} Validation failed: ${violations.join(", ")}. Retrying self-correction with feedback...`);
      try {
        const retryBriefResponse = await runStrategicInterpreter(
          briefRow.eventId,
          context.evidenceRegistry,
          briefRow.accountId,
          violations
        );
        const retryViolations = validateBriefDeterministic(retryBriefResponse, context.evidenceRegistry);
        
        let retryJudgeResult: JudgeResult | null = null;
        if (retryViolations.length === 0) {
          retryJudgeResult = await runBriefJudge(retryBriefResponse, context.evidenceRegistry, briefRow.accountId);
          
          const retryUnsupportedCritical = retryJudgeResult.claims.some(
            (c) => c.verdict === "unsupported" && 
                   retryBriefResponse.claims.find((cl) => cl.claimId === c.claimId)?.criticality === "critical"
          );

          if (retryJudgeResult.verdict === "PASS" && !retryUnsupportedCritical) {
            briefResponse = retryBriefResponse;
            violations = [];
            judgeResult = retryJudgeResult;
          } else {
            violations = [
              "Judge retry validation rejected: " + 
              retryJudgeResult.claims.map(c => `${c.claimId}: ${c.verdict} (${c.violations.join(", ")})`).join("; ")
            ];
          }
        } else {
          violations = retryViolations;
        }
      } catch (retryErr) {
        console.error(`${LOG} Self-correction retry crashed:`, retryErr);
      }
    }

    // Check if we ultimately failed validation
    if (violations.length > 0) {
      await db
        .update(watchtowerStrategicBriefs)
        .set({
          status: "failed",
          deterministicViolations: violations,
          judgeResult,
          failureCode: "VALIDATION_FAILED",
          failureDetails: sanitizeError("validation", new Error(violations.join("; "))),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(watchtowerStrategicBriefs.id, briefId));
      await promoteToLatest(briefId, briefRow.eventId);
      return;
    }

    // Reroute unsupported claims (filter them out of the UI presentation)
    const validClaims = briefResponse.claims.filter(claim => {
      const jClaim = judgeResult?.claims.find(jc => jc.claimId === claim.claimId);
      return jClaim && jClaim.verdict !== "unsupported";
    });
    briefResponse.claims = validClaims;

    // 6. Calculate derived confidence
    const { finalConfidence, adjustmentReasons } = calculateDerivedConfidence(briefResponse, context.evidenceRegistry, judgeResult);

    // 7. Save completed ready brief
    await db
      .update(watchtowerStrategicBriefs)
      .set({
        status: "ready",
        brief: briefResponse,
        judgeResult,
        modelProposedConfidence: briefResponse.modelProposedConfidence,
        finalValidatedConfidence: finalConfidence,
        confidenceAdjustmentReasons: adjustmentReasons,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(watchtowerStrategicBriefs.id, briefId));

    await promoteToLatest(briefId, briefRow.eventId);
    console.log(`${LOG} Successfully completed brief ${briefId} (status: ready)`);

  } catch (err: any) {
    const stage = err?.stage || "execution";
    const rawError = err?.error || err;
    console.error(`${LOG} Brief run ${briefId} failed at stage ${stage}:`, rawError);

    await db
      .update(watchtowerStrategicBriefs)
      .set({
        status: "failed",
        failureCode: "JOB_RUN_CRASH",
        failureDetails: sanitizeError(stage, rawError),
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(watchtowerStrategicBriefs.id, briefId));
    
    await promoteToLatest(briefId, briefRow.eventId);
  }
}

// Enqueue generation task (Idempotent active generation check)
export async function enqueueBrief(
  eventId: string,
  campaignId: string,
  accountId: string,
  competitorId?: string,
  supersedesBriefId?: string
): Promise<string> {
  // Check active run
  const [activeRun] = await db
    .select({ id: watchtowerStrategicBriefs.id })
    .from(watchtowerStrategicBriefs)
    .where(
      and(
        eq(watchtowerStrategicBriefs.eventId, eventId),
        inArray(watchtowerStrategicBriefs.status, ["queued", "generating", "validating"])
      )
    )
    .limit(1);

  if (activeRun) {
    console.log(`${LOG} Active brief run already exists: ${activeRun.id}`);
    return activeRun.id;
  }

  const briefId = `brief_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Insert queued row - empty placeholders for registries
  await db.insert(watchtowerStrategicBriefs).values({
    id: briefId,
    eventId,
    accountId,
    campaignId,
    competitorId: competitorId || null,
    status: "queued",
    contextFingerprint: "pending",
    generatorVersion: GENERATOR_VERSION,
    promptVersion: PROMPT_VERSION,
    judgeVersion: JUDGE_VERSION,
    evidenceVersion: EVIDENCE_VERSION,
    supersedesBriefId: supersedesBriefId || null,
    attemptCount: 0,
    isLatest: true,
  });

  // Demote previous latest
  await db
    .update(watchtowerStrategicBriefs)
    .set({ isLatest: false, updatedAt: new Date() })
    .where(and(eq(watchtowerStrategicBriefs.eventId, eventId), ne(watchtowerStrategicBriefs.id, briefId)));

  // Non-blocking trigger of background worker execution
  executeBriefJob(briefId).catch((err) =>
    console.error(`${LOG} Asynchronous job worker failed:`, err)
  );

  return briefId;
}

// Stuck job recovery sweeper running on startup
export async function recoverStaleBriefJobs(): Promise<void> {
  const STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
  const threshold = new Date(Date.now() - STALE_TIMEOUT_MS);

  try {
    const staleBriefs = await db
      .select({ id: watchtowerStrategicBriefs.id, attemptCount: watchtowerStrategicBriefs.attemptCount })
      .from(watchtowerStrategicBriefs)
      .where(
        and(
          inArray(watchtowerStrategicBriefs.status, ["generating", "validating"]),
          lt(watchtowerStrategicBriefs.updatedAt, threshold)
        )
      );

    if (staleBriefs.length === 0) return;

    console.log(`${LOG} Found ${staleBriefs.length} stale brief job(s) to recover`);

    for (const b of staleBriefs) {
      if (b.attemptCount >= MAX_ATTEMPTS) {
        await db
          .update(watchtowerStrategicBriefs)
          .set({
            status: "failed",
            failureCode: "STUCK_JOB_TIMEOUT",
            failureDetails: {
              stage: "orchestration",
              message: "Job execution timed out and exceeded attempt limits",
              retryability: true,
              timestamp: new Date().toISOString(),
              category: "timeout_stuck_job"
            },
            updatedAt: new Date()
          })
          .where(eq(watchtowerStrategicBriefs.id, b.id));
      } else {
        await db
          .update(watchtowerStrategicBriefs)
          .set({ status: "queued", updatedAt: new Date() })
          .where(eq(watchtowerStrategicBriefs.id, b.id));
        
        // Re-execute background job
        executeBriefJob(b.id).catch((err) =>
          console.error(`${LOG} Asynchronous recovery worker failed:`, err)
        );
      }
    }
  } catch (err) {
    console.error(`${LOG} Stale sweeper recovery failed:`, err);
  }
}
