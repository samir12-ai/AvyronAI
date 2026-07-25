import { z } from 'zod';
import { OUTPUT_TYPES, type OutputType } from './output-types';

export const EngineOutputSchema = z.object({
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(100),
  dataCompleteness: z.number().min(0).max(100),
  scope: z.string().min(1),
  outputType: z.enum(OUTPUT_TYPES),
  riskFlag: z.string().optional(),
  payload: z.any().optional(),
});

export type EngineOutput = z.infer<typeof EngineOutputSchema>;

export class EngineContractError extends Error {
  code: string;
  violations: string[];
  constructor(message: string, violations: string[]) {
    super(message);
    this.name = 'EngineContractError';
    this.code = 'ENGINE_CONTRACT_VIOLATION';
    this.violations = violations;
  }
}

export function validateEngineOutput(output: unknown): EngineOutput {
  const result = EngineOutputSchema.safeParse(output);
  if (!result.success) {
    const violations = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new EngineContractError(
      `Engine output does not match Unified Engine Contract. Violations: [${violations.join('; ')}]`,
      violations
    );
  }
  return result.data;
}

export function wrapEngineOutput(
  rawData: any,
  metadata: {
    score: number;
    reasoning: string;
    confidence: number;
    dataCompleteness: number;
    scope: string;
    outputType: OutputType;
    riskFlag?: string;
  }
): EngineOutput {
  const output: EngineOutput = {
    score: metadata.score,
    reasoning: metadata.reasoning,
    confidence: metadata.confidence,
    dataCompleteness: metadata.dataCompleteness,
    scope: metadata.scope,
    outputType: metadata.outputType,
    riskFlag: metadata.riskFlag,
    payload: rawData,
  };
  return validateEngineOutput(output);
}
