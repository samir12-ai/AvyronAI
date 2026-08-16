export type LlmFailureClass = "EVIDENCE_FAILURE" | "GENERATION_QUALITY_FAILURE" | "CONTRACT_FAILURE" | "AUTHORITY_FAILURE" | "TECHNICAL_FAILURE";

export interface JudgeRejection {
  rule: string;
  reason: string;
}

export interface JudgeResult<T> {
  valid: boolean;
  failureClass?: LlmFailureClass;
  rejections?: JudgeRejection[];
  recoveredValue?: T;
}

export interface ReliabilityTelemetry {
  engine: string;
  touchpoint: string;
  attempts: number;
  finalVerdict: "PASS" | "HONEST_FAIL" | "TECHNICAL_FAIL";
  repairLog: {
    attempt: number;
    failureClass: LlmFailureClass;
    rejections: JudgeRejection[];
    repairAttempted: boolean;
    repairOutcome: "PASS" | "FAIL";
  }[];
}

export interface GenerationContext<TInput> {
  engineName: string;
  touchpointName: string;
  authoritativeInput: TInput;
}

export interface ReliabilityConfig {
  maxRepairs?: number;
}

import { z } from "zod";

export const SystemValidationSchema = z.object({
  passed: z.boolean(),
  reason: z.string(),
  confidence: z.enum(["LOW", "HIGH"])
});

export type SystemValidationFlag = z.infer<typeof SystemValidationSchema>;
