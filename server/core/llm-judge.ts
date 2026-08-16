import { aiChat } from "../ai-client";

export interface JudgeVerdict {
  judge_reasoning: string;
  score: number;
  contains_jargon: boolean;
  hallucinated_facts: boolean;
  pass_verdict: boolean;
}

export async function evaluateLLMOutput(
  rawInput: any,
  llmOutput: any,
  criteria: string,
  accountId: string = "system"
): Promise<JudgeVerdict> {
  const response = await aiChat({
    model: "gpt-4o",
    temperature: 0,
    accountId,
    endpoint: "llm-judge",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an adversarial AI auditor. Compare the ORIGINAL RAW DATA with the LLM TRANSLATION. Your ONLY job is to catch hallucinations (facts not in the raw data) and catch technical jargon. Be ruthless.
        
Criteria to evaluate: ${criteria}

Output a strict JSON structure:
{
  "judge_reasoning": "string (Step-by-step logic comparing raw input vs llm output)",
  "score": "number (0-10)",
  "contains_jargon": "boolean",
  "hallucinated_facts": "boolean",
  "pass_verdict": "boolean (Must be true ONLY if score >= 8, jargon is false, and hallucinated is false)"
}`,
      },
      {
        role: "user",
        content: `ORIGINAL RAW DATA:\n${JSON.stringify(rawInput)}\n\nLLM TRANSLATION:\n${JSON.stringify(llmOutput)}`,
      },
    ],
  });

  const text = response.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(text) as JudgeVerdict;
  } catch (e) {
    return {
      judge_reasoning: "Failed to parse judge output.",
      score: 0,
      contains_jargon: true,
      hallucinated_facts: true,
      pass_verdict: false,
    };
  }
}
