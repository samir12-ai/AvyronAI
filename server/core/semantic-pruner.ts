import { generateWithRepair, LLMReliabilityError } from "../shared/llm-reliability/reliability-runner";
import { z } from "zod";

const prunedOutputSchema = z.object({
  evaluations: z.array(z.object({
    extracted_chunk: z.string(),
    relevance_score: z.number().min(0).max(10),
    judge_reasoning: z.string().describe("Explain EXACTLY why this matches the Formula. If it relates to an irrelevant service, explain why and reject it."),
    is_formula_match: z.boolean()
  }))
});

export async function pruneIrrelevantContext(rawTextDump: string, focusBoundary: string): Promise<string> {
  if (!rawTextDump || rawTextDump.trim().length === 0) return "";
  
  try {
    const { result } = await generateWithRepair<{ dump: string, focus: string }, { evaluations: Array<{ extracted_chunk: string, relevance_score: number, judge_reasoning: string, is_formula_match: boolean }> }>({
      component: "SemanticPruner",
      accountId: "system",
      schema: prunedOutputSchema,
      input: { dump: rawTextDump, focus: focusBoundary },
      promptGenerator: (input) => `
        You are an unforgiving Data Judge. Your Absolute Formula is: ${input.focus}
        You will receive raw competitor/market text. Evaluate it chunk by chunk. 
        If a chunk relates to the Formula, mark is_formula_match true. 
        If it describes an unrelated product/service, mark it false.
        
        Raw Text Dump:
        ${input.dump}
      `,
      maxRetries: 2,
      fastLLM: true
    });
    
    const validChunks = result.evaluations
      .filter(evalItem => evalItem.is_formula_match === true && evalItem.relevance_score >= 7)
      .map(evalItem => evalItem.extracted_chunk);
      
    return validChunks.join("\n\n");
  } catch (err) {
    console.warn("[SemanticPruner] Pruning failed, falling back to raw dump.");
    return rawTextDump; // Fallback gracefully
  }
}
