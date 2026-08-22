import { logger } from "../../logger";
import { JudgeResult, LlmFailureClass, ReliabilityConfig, ReliabilityTelemetry } from "./types";

export interface GenerateWithRepairArgs<TInput, TOutput> {
  engineName: string;
  touchpointName: string;
  authoritativeInput: TInput;
  
  /** Generate the initial candidate */
  generate: (input: TInput) => Promise<TOutput>;
  
  /** 
   * Validate the candidate.
   * Return { valid: true } on success.
   * Return { valid: false, failureClass, rejections } on failure.
   */
  judge: (input: TInput, candidate: TOutput) => Promise<JudgeResult<TOutput>>;
  
  /** 
   * Repair the candidate based on the rejection.
   * Should NOT be called for EVIDENCE_FAILURE or TECHNICAL_FAILURE.
   */
  repair: (
    input: TInput, 
    failedCandidate: TOutput, 
    rejections: NonNullable<JudgeResult<TOutput>['rejections']>
  ) => Promise<TOutput>;
  
  config?: ReliabilityConfig;
}

export class LLMReliabilityError extends Error {
  constructor(
    message: string,
    public readonly failureClass: LlmFailureClass,
    public readonly rejections?: any[],
    public readonly telemetry?: ReliabilityTelemetry
  ) {
    super(message);
    this.name = "LLMReliabilityError";
  }
}

function isRetryable(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  
  // Explicitly non-retryable configuration errors
  if (
    msg.includes("invalid credentials") ||
    msg.includes("missing credentials") ||
    msg.includes("invalid model") ||
    msg.includes("malformed")
  ) {
    return false;
  }
  
  // Retryable transport errors
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("network") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  ) {
    return true;
  }
  
  if (err.status >= 500 || err.status === 429) {
    return true;
  }
  
  return false;
}

export async function generateWithRepair<TInput, TOutput>(
  args: GenerateWithRepairArgs<TInput, TOutput>
): Promise<{ result: TOutput; telemetry: ReliabilityTelemetry }> {
  const maxAttempts = (args.config?.maxRepairs ?? 2) + 1; // 1 initial + maxRepairs
  
  const telemetry: ReliabilityTelemetry = {
    engine: args.engineName,
    touchpoint: args.touchpointName,
    attempts: 0,
    technicalRetries: 0,
    finalVerdict: "HONEST_FAIL",
    repairLog: []
  };

  const runWithTechnicalRetry = async <T>(fn: () => Promise<T>): Promise<T> => {
    let techAttempts = 1;
    const maxTechAttempts = (args.config?.maxTechnicalRetries ?? 2) + 1;
    
    while (true) {
      try {
        if (techAttempts > 1) {
          telemetry.technicalRetries++;
        }
        return await fn();
      } catch (err: any) {
        if (!isRetryable(err) || techAttempts >= maxTechAttempts) {
           throw err; // Non-retryable or exhausted
        }
        logger.warn(`[${args.engineName}::${args.touchpointName}] Technical failure on attempt ${techAttempts}. Retries left: ${maxTechAttempts - techAttempts}. Error: ${err.message}`);
        techAttempts++;
        // short delay
        await new Promise(r => setTimeout(r, 10));
      }
    }
  };

  let candidate: TOutput;
  let currentAttempt = 1;

  try {
    // 1. Initial Generation
    telemetry.attempts = currentAttempt;
    candidate = await runWithTechnicalRetry(async () => await args.generate(args.authoritativeInput));
  } catch (err: any) {
    telemetry.finalVerdict = "TECHNICAL_FAIL";
    logger.error(`[${args.engineName}::${args.touchpointName}] Technical failure during initial generation:`, err);
    throw new LLMReliabilityError(`Technical failure: ${err.message}`, "TECHNICAL_FAILURE", undefined, telemetry);
  }

  while (currentAttempt <= maxAttempts) {
    let judgeResult: JudgeResult<TOutput>;
    
    // 2. Validation
    try {
      const attemptString = `\n========== ATTEMPT ${currentAttempt} ==========\n${typeof candidate === 'string' ? candidate : JSON.stringify(candidate, null, 2)}\n===================================\n`;
      const fs = require('fs');
      fs.appendFileSync('C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\b8fb5dac-575e-4c9c-8460-77f7f7b3318d\\scratch\\audience_semantic_trace.txt', attemptString);

      judgeResult = await runWithTechnicalRetry(async () => await args.judge(args.authoritativeInput, candidate));
    } catch (err: any) {
      telemetry.finalVerdict = "TECHNICAL_FAIL";
      logger.error(`[${args.engineName}::${args.touchpointName}] Technical failure during judging (attempt ${currentAttempt}):`, err);
      throw new LLMReliabilityError(`Judge technical failure: ${err.message}`, "TECHNICAL_FAILURE", undefined, telemetry);
    }

    if (judgeResult.valid) {
      telemetry.finalVerdict = "PASS";
      if (currentAttempt > 1) {
        telemetry.repairLog[telemetry.repairLog.length - 1].repairOutcome = "PASS";
      }
      return { 
        result: judgeResult.recoveredValue !== undefined ? judgeResult.recoveredValue : candidate, 
        telemetry 
      };
    }

    if (!judgeResult.valid) {
      telemetry.repairLog.push({
        attempt: currentAttempt,
        failureClass: judgeResult.failureClass || "GENERATION_QUALITY_FAILURE",
        rejections: judgeResult.rejections || [],
        repairAttempted: false,
        repairOutcome: "FAIL",
      });
      const fs = require('fs');
      try {
        fs.appendFileSync('C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\b8fb5dac-575e-4c9c-8460-77f7f7b3318d\\scratch\\audience_semantic_trace.txt', `\n--- JUDGE REJECTION ---\n${JSON.stringify(judgeResult.rejections, null, 2)}\n-----------------------\n`);
      } catch(e) {}
      logger.warn(`[${args.engineName}::${args.touchpointName}] Judge rejection (attempt ${currentAttempt}): ${judgeResult.failureClass}`);
    }

    const failureClass = judgeResult.failureClass ?? "GENERATION_QUALITY_FAILURE";
    const rejections = judgeResult.rejections ?? [];

    logger.warn(`[${args.engineName}::${args.touchpointName}] Judge rejection (attempt ${currentAttempt}): ${failureClass}`);

    // 3. Failure Classification & Short Circuits
    if (failureClass === "EVIDENCE_FAILURE" || failureClass === "TECHNICAL_FAILURE") {
      telemetry.finalVerdict = "HONEST_FAIL";
      throw new LLMReliabilityError(`Honest Block: ${failureClass}`, failureClass, rejections, telemetry);
    }

    if (currentAttempt >= maxAttempts) {
      telemetry.finalVerdict = "HONEST_FAIL";
      logger.error(`[${args.engineName}::${args.touchpointName}] Exhausted ${maxAttempts} attempts. Applying Soft Fail.`);
      
      if (telemetry.repairLog.length > 0) {
        telemetry.repairLog[telemetry.repairLog.length - 1].repairOutcome = "FAIL";
      }

      if (args.config?.failClosed) {
        throw new LLMReliabilityError(`Exhausted ${maxAttempts} attempts without a valid result`, "GENERATION_QUALITY_FAILURE", rejections, telemetry);
      }

      const flag = {
        passed: false,
        reason: `${failureClass}: ${rejections.map(r => r.reason).join(" | ")}`,
        confidence: "LOW" as const
      };

      // Soft Fail: return candidate with metadata
      let softCandidate = candidate;
      if (typeof candidate === "string") {
        try {
          const parsed = JSON.parse(candidate);
          parsed._system_validation = flag;
          softCandidate = JSON.stringify(parsed) as any;
        } catch {
          // Unparseable JSON, wrap it
          softCandidate = JSON.stringify({ _raw_candidate: candidate, _system_validation: flag }) as any;
        }
      } else if (typeof candidate === "object" && candidate !== null) {
        (softCandidate as any)._system_validation = flag;
      } else if (judgeResult.recoveredValue) {
        // Fallback to recovered value if it exists
        softCandidate = judgeResult.recoveredValue;
        if (typeof softCandidate === "object" && softCandidate !== null) {
           (softCandidate as any)._system_validation = flag;
        }
      }
      
      return {
        result: softCandidate,
        telemetry
      };
    }

    // 4. Targeted Repair
    const repairLogEntry = {
      attempt: currentAttempt,
      failureClass,
      rejections,
      repairAttempted: true,
      repairOutcome: "FAIL" as "PASS" | "FAIL" // Updated if next loop passes
    };
    telemetry.repairLog.push(repairLogEntry);

    try {
      candidate = await runWithTechnicalRetry(async () => await args.repair(args.authoritativeInput, candidate, rejections));
      currentAttempt++;
      telemetry.attempts = currentAttempt;
    } catch (err: any) {
      telemetry.finalVerdict = "TECHNICAL_FAIL";
      logger.error(`[${args.engineName}::${args.touchpointName}] Technical failure during repair:`, err);
      throw new LLMReliabilityError(`Repair technical failure: ${err.message}`, "TECHNICAL_FAILURE", undefined, telemetry);
    }
  }

  // Fallback (should not be reached due to loop condition)
  throw new LLMReliabilityError("Unexpected loop exit", "TECHNICAL_FAILURE", undefined, telemetry);
}
