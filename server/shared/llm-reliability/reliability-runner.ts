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

export async function generateWithRepair<TInput, TOutput>(
  args: GenerateWithRepairArgs<TInput, TOutput>
): Promise<{ result: TOutput; telemetry: ReliabilityTelemetry }> {
  const maxAttempts = (args.config?.maxRepairs ?? 2) + 1; // 1 initial + maxRepairs
  
  const telemetry: ReliabilityTelemetry = {
    engine: args.engineName,
    touchpoint: args.touchpointName,
    attempts: 0,
    finalVerdict: "HONEST_FAIL",
    repairLog: []
  };

  let candidate: TOutput;
  let currentAttempt = 1;

  try {
    // 1. Initial Generation
    telemetry.attempts = currentAttempt;
    candidate = await args.generate(args.authoritativeInput);
  } catch (err: any) {
    telemetry.finalVerdict = "TECHNICAL_FAIL";
    logger.error(`[${args.engineName}::${args.touchpointName}] Technical failure during initial generation:`, err);
    throw new LLMReliabilityError(`Technical failure: ${err.message}`, "TECHNICAL_FAILURE", undefined, telemetry);
  }

  while (currentAttempt <= maxAttempts) {
    let judgeResult: JudgeResult<TOutput>;
    
    // 2. Validation
    try {
      judgeResult = await args.judge(args.authoritativeInput, candidate);
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

    const failureClass = judgeResult.failureClass ?? "GENERATION_QUALITY_FAILURE";
    const rejections = judgeResult.rejections ?? [];

    logger.warn({ rejections }, `[${args.engineName}::${args.touchpointName}] Judge rejection (attempt ${currentAttempt}): ${failureClass}`);

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
      candidate = await args.repair(args.authoritativeInput, candidate, rejections);
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
