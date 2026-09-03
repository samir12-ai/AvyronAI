
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
13. NO_UNSUPPORTED_NEGATIVE_CLAIMS: Blanket claims that competitors completely lack a capability are forbidden unless backed by MI evidence. Contrast phrasings that frame the difference as "Our product provides X whereas reviewed competitor evidence focuses on Y or does not establish equivalent X" are strictly VALID and MUST NOT be rejected under UNSUPPORTED_NEGATIVE_CLAIM or GENERIC_INTERCHANGEABLE.
14. POSITIVE_CONTRAST_VALIDITY: When our Product Truth specifies verified product capabilities (such as Buffer's specific transparent freemium model, multi-channel scheduling, or team collaboration workflows) grounded in ourProductFacts, accept them as valid differentiated claims when contrasted against the competitor landscape. Do NOT reject valid grounded candidate contrasts under GENERIC_INTERCHANGEABLE.

Return a JSON object: { valid: boolean, defects: [ { differentiationId, code, reason, rejectedFields, fixDirective } ] }
Allowed codes: GENERIC_INTERCHANGEABLE, CAPABILITY_NOT_DIFFERENTIATION, VALUE_MISTAKEN_FOR_DIFFERENTIATION, PRODUCT_TRUTH_UNSUPPORTED, MI_BASELINE_UNSUPPORTED, COMPETITIVE_SCOPE_OVERCLAIM, MECHANISM_HALLUCINATED, PAIN_MEANING_DRIFT, BUYER_VALUE_NOT_ESTABLISHED, LINEAGE_REFERENCE_INVALID, SPECIFICITY_LACKING, UNSUPPORTED_NEGATIVE_CLAIM
`;

export async function judgeDifferentiation(
  input: CanonicalDifferentiationInput,
  candidates: DifferentiationCandidate[]
): Promise<DifferentiationJudgeOutput> {
  log("DifferentiationJudge", "Running independent semantic judge");
  
  const boundedInput = {
    ...input,
    corePains: (input.corePains || []).slice(0, 3),
    miFacts: (input.miFacts || []).slice(0, 10),
    ourProductFacts: (input.ourProductFacts || []).slice(0, 10),
  };
  const systemPrompt = JUDGE_PROMPT + "\n\nCANONICAL INPUT:\n" + JSON.stringify(boundedInput, null, 2) + "\n\nCANDIDATES:\n" + JSON.stringify(candidates, null, 2);
  
  const response = await aiChat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Return the defects JSON object." }
    ],
    response_format: { type: "json_object" },
    model: "gpt-4.1-mini",
    accountId: (input as any).accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
    endpoint: "differentiation",
    temperature: 0.1, max_tokens: 2500
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

