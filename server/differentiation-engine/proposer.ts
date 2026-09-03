
import { aiChat } from "../ai-client";
import { CanonicalDifferentiationInput, DifferentiationCandidate, PainDisposition } from "./types";
const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);

const PROPOSER_PROMPT = `
You are the Differentiation Proposer.
Your job is to identify a defensible, evidence-backed difference for the product regarding the provided CORE pains.

RULES:
1. PROCESS ALL PAINS: You must return a disposition for every CORE pain provided.
2. USE ONLY PROVIDED AUTHORITY: You may only cite productTruthFactIds and miAuthorityIds present in the input. Do not invent IDs.
3. POSITIVE-VS-POSITIVE CONTRAST: Prefer comparing our product's established capabilities (strictly from ourProductFacts / canonical Product Truth) against what competitors establish in miFacts (or note that equivalent capability was not established in reviewed competitor evidence).
4. ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE: If a capability is not established on a competitor's site, state "Equivalent capability was not established in reviewed competitor evidence." DO NOT claim "Competitor lacks X" or "Competitor cannot do X" unless explicitly backed by MI evidence.
5. NO MECHANISM INVENTION: Only claim an ESTABLISHED mechanism if it is explicitly backed by Product Truth.
6. DIFFERENTIATION != CAPABILITY: Merely doing something is not differentiation. You must prove a contrast to a competitor.
7. NO GENERIC VALUE: "Saves time" or "Better AI" is not a valid differentiation.

INPUT DATA:
`;

export async function proposeDifferentiation(
  input: CanonicalDifferentiationInput,
  failedCandidates: any[] = [],
  defects: any[] = []
): Promise<{ differentiations: DifferentiationCandidate[], painDispositions: PainDisposition[] }> {
  const boundedInput = {
    ...input,
    corePains: (input.corePains || []).slice(0, 3),
    miFacts: (input.miFacts || []).slice(0, 10),
    ourProductFacts: (input.ourProductFacts || []).slice(0, 10),
  };
  const systemPrompt = PROPOSER_PROMPT + JSON.stringify({ input: boundedInput, failedCandidates, defects }, null, 2);
  
  const userPrompt = `Propose differentiations for these CORE pains. Return JSON in the exact shape:
{
  "differentiations": [
    {
      "painId": "string (matching input CORE pain id)",
      "differentiationClaim": "string (grounded contrast between our product's established capability from ourProductFacts and reviewed competitor workflows)",
      "distinctiveProperty": "string",
      "buyerValue": "string",
      "mechanismName": "string",
      "proofBoundary": "string",
      "ourEstablishedFacts": ["productTruthFactId..."],
      "competitorContrastingFacts": ["competitorFactId..."]
    }
  ],
  "painDispositions": [
    {
      "painId": "string",
      "disposition": "ACCEPTED_DIFFERENTIATION"
    }
  ]
}`;

  const response = await aiChat({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    model: "gpt-4.1-mini",
    accountId: (input as any).accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
    endpoint: "differentiation",
    temperature: 0.1, max_tokens: 4000
  });

  try {
    const parsed = JSON.parse(response.choices?.[0]?.message?.content || "{}");
    const rawDiffs = Array.isArray(parsed.differentiations) ? parsed.differentiations : [];
    const differentiations: DifferentiationCandidate[] = rawDiffs.map((d: any) => {
      if (typeof d === "string") {
        return {
          painId: input.corePains[0]?.painId || "pain_1",
          differentiationClaim: d,
          distinctiveProperty: "Established product capability contrast",
          buyerValue: "Direct capability fit addressing core buyer pain",
          mechanismName: input.corePains[0]?.requiredCapability || "Established Product Mechanism",
          proofBoundary: "Product Truth verification",
          corePainIds: [input.corePains[0]?.painId || "pain_1"],
          ourEstablishedFacts: (input.ourProductFacts || []).map((f: any) => f.productTruthFactId || f.id).filter(Boolean),
          competitorContrastingFacts: (input.miFacts || []).map((f: any) => f.miAuthorityId || f.id).filter(Boolean)
        };
      }
      return d;
    });

    return {
      differentiations,
      painDispositions: Array.isArray(parsed.painDispositions) ? parsed.painDispositions : []
    };
  } catch(e) {
    log("DifferentiationProposer", `Failed to parse LLM response: ${e}`);
    return { differentiations: [], painDispositions: [] };
  }
}

