
import { aiChat } from "../ai-client";
import { CanonicalDifferentiationInput, DifferentiationCandidate, DifferentiationJudgeOutput } from "./types";
const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);

const JUDGE_PROMPT = `
You are the Independent Differentiation Judge.
Evaluate each proposed differentiation candidate against the exact original CanonicalDifferentiationInput.

Check 13 Criteria:
1. PAIN_FIDELITY: Does the difference address the cited CORE pain(s)?
2. PRODUCT_TRUTH_FIDELITY: Do cited productTruthFactIds support the product claim?
3. MI3_FIDELITY: Do cited miAuthorityIds support the competitive baseline?
4. DISTINCTIVENESS: Is there a real functional/operating difference or contrast?
5. INTERCHANGEABILITY: Could a credible competitor say the same thing?
6. BUYER_RELEVANCE: Does it matter for this pain?
7. CAPABILITY_VS_DIFFERENTIATION: Is this just describing a capability?
8. VALUE_VS_DIFFERENTIATION: Is this just generic value (e.g. saves time)?
9. MECHANISM_FIDELITY: Was a mechanism invented or overclaimed?
10. COMPETITIVE_SCOPE: Does it overclaim beyond MI3 scope?
11. LINEAGE_VALIDITY: Are all cited IDs EXACTLY valid members of the canonical input?
12. SPECIFICITY: Is this strategically specific?
13. NO_UNSUPPORTED_NEGATIVE_CLAIMS: Does the claim assert "Competitor lacks X" or "Competitor cannot do X" without explicit MI evidence? (Phrases like "Equivalent capability was not established in reviewed competitor evidence" are acceptable; blanket assertions of competitor absence are NOT).
14. POSITIVE_CONTRAST_VALIDITY: If Avyron's Product Truth specifies a distinct technical capability/mechanism and the competitive baseline states equivalent capability was not established or uses legacy manual templates, then this is a VALID positive contrast. Do NOT reject valid positive contrasts under GENERIC_INTERCHANGEABLE.

Return a JSON object: { valid: boolean, defects: [ { differentiationId, code, reason, rejectedFields, fixDirective } ] }
Allowed codes: GENERIC_INTERCHANGEABLE, CAPABILITY_NOT_DIFFERENTIATION, VALUE_MISTAKEN_FOR_DIFFERENTIATION, PRODUCT_TRUTH_UNSUPPORTED, MI_BASELINE_UNSUPPORTED, COMPETITIVE_SCOPE_OVERCLAIM, MECHANISM_HALLUCINATED, PAIN_MEANING_DRIFT, BUYER_VALUE_NOT_ESTABLISHED, LINEAGE_REFERENCE_INVALID, SPECIFICITY_LACKING, UNSUPPORTED_NEGATIVE_CLAIM
`;

export async function judgeDifferentiation(
  input: CanonicalDifferentiationInput,
  candidates: DifferentiationCandidate[]
): Promise<DifferentiationJudgeOutput> {
  log("DifferentiationJudge", "Running independent semantic judge");
  
  const systemPrompt = JUDGE_PROMPT + "\\n\\nCANONICAL INPUT:\\n" + JSON.stringify(input, null, 2) + "\\n\\nCANDIDATES:\\n" + JSON.stringify(candidates, null, 2);
  
  const response = await aiChat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Return the defects JSON object." }
    ],
    response_format: { type: "json_object" },
    model: "gpt-4.1-mini",
    accountId: (input as any).accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
    endpoint: "differentiation",
    temperature: 0.1, max_tokens: 4000
  });

  try {
    const parsed = JSON.parse(response.choices?.[0]?.message?.content || "{}");
    return {
      valid: parsed.valid !== false && (parsed.defects || []).length === 0,
      defects: parsed.defects || []
    };
  } catch(e) {
    log("DifferentiationJudge", `Failed to parse LLM response: ${e}`);
    return { valid: false, defects: [{ code: "GENERIC_INTERCHANGEABLE", reason: "Parse failure", rejectedFields: [], fixDirective: "Fix output format" }] };
  }
}

