
import { aiChat } from "../ai-client";
import { CanonicalDifferentiationInput, DifferentiationCandidate, PainDisposition } from "./types";
const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);

const PROPOSER_PROMPT = `
You are the Avyron Differentiation Proposer.
Your job is to identify a defensible, evidence-backed difference for the product regarding the provided CORE pains.

RULES:
1. PROCESS ALL PAINS: You must return a disposition for every CORE pain provided.
2. USE ONLY PROVIDED AUTHORITY: You may only cite productTruthFactIds and miAuthorityIds present in the input. Do not invent IDs.
3. POSITIVE-VS-POSITIVE CONTRAST: Prefer comparing Avyron's established capability (e.g. real-time market signal mirror & semantic Judge verification) against what competitors establish (e.g. static reporting, manual campaign setups, or unverified LLM generation).
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
  log("DifferentiationProposer", "Running batched proposer call");
  
  const systemPrompt = PROPOSER_PROMPT + JSON.stringify({ input, failedCandidates, defects }, null, 2);
  
  const userPrompt = `Propose differentiations for these CORE pains. Return JSON in the exact shape:
{
  "differentiations": [
    {
      "painId": "string (matching input CORE pain id)",
      "differentiationClaim": "string (grounded contrast between Avyron's established capability and reviewed competitor workflows)",
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
    temperature: 0.2, max_tokens: 4000
  });

  try {
    const parsed = JSON.parse(response.choices?.[0]?.message?.content || "{}");
    const rawDiffs = Array.isArray(parsed.differentiations) ? parsed.differentiations : [];
    const differentiations: DifferentiationCandidate[] = rawDiffs.map((d: any) => {
      if (typeof d === "string") {
        return {
          painId: input.corePains[0]?.painId || "pain_1",
          differentiationClaim: d,
          distinctiveProperty: "Real-time evidence verification vs static execution",
          buyerValue: "Prevents targeting errors by grounding strategy in live evidence",
          mechanismName: "Live Market Mirror with Pre-Synthesis Semantic Judging",
          proofBoundary: "Avyron AI verified pipeline",
          corePainIds: [input.corePains[0]?.painId || "pain_1"],
          ourEstablishedFacts: [],
          competitorContrastingFacts: []
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

