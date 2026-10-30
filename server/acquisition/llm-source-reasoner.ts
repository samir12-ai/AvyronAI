import { z } from "zod";
import { aiChat } from "../ai-client";

/**
 * Structured LLM Reasoning for Ambiguous Source Discovery, Account Ownership Assessment,
 * and Page Relevance (Requirement #5).
 *
 * HARD INFRASTRUCTURE GUARANTEES:
 * - The LLM can ONLY evaluate candidate URLs/handles that were actually observed in
 *   website links or search results.
 * - Any URL returned by the LLM that is not verbatim in the provided candidate list
 *   is deterministically rejected (LLM can never invent URLs, actor IDs, or identities).
 * - Unresolved ambiguity is preserved explicitly as AMBIGUOUS_UNRESOLVED rather than
 *   guessed or coerced into a false positive.
 */

export interface SourceOwnershipCandidate {
  candidateIndex?: number;
  index?: number;
  url: string;
  handle?: string | null;
  handleOrId?: string | null;
  title: string;
  snippet: string;
}

export interface SourceOwnershipAssessment {
  decision: "VERIFIED_MATCH" | "REJECTED_MISMATCH" | "AMBIGUOUS_UNRESOLVED" | "THIRD_PARTY_TESTIMONIAL";
  verdict?: "VERIFIED_OFFICIAL" | "REJECTED_MISMATCH" | "AMBIGUOUS_UNRESOLVED" | "THIRD_PARTY_TESTIMONIAL";
  selectedCandidateIndex: number | null;
  selectedUrl: string | null;
  selectedCandidate?: SourceOwnershipCandidate | null;
  confidence: number;
  rationale: string;
  evidenceCited: string[];
}

const ownershipAssessmentSchema = z.object({
  decision: z.enum([
    "VERIFIED_MATCH",
    "REJECTED_MISMATCH",
    "AMBIGUOUS_UNRESOLVED",
    "THIRD_PARTY_TESTIMONIAL",
  ]),
  selectedCandidateIndex: z.number().int().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  rationale: z.string().min(5),
  evidenceCited: z.array(z.string()).default([]),
});

/**
 * Evaluates ambiguous search or link candidates to determine whether any candidate is the
 * official owned profile/destination for `competitorName` (`cleanDomain`) on `platform`.
 */
export async function assessAmbiguousSourceOwnershipWithLlm(params: {
  competitorName?: string;
  entityName?: string;
  cleanDomain?: string;
  officialDomain?: string;
  platform: string;
  accountId?: string;
  candidates: SourceOwnershipCandidate[];
}): Promise<SourceOwnershipAssessment> {
  const competitorName = params.competitorName || params.entityName || "";
  const cleanDomain = params.cleanDomain || params.officialDomain || "";
  const { platform, candidates } = params;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      decision: "AMBIGUOUS_UNRESOLVED",
      verdict: "AMBIGUOUS_UNRESOLVED",
      selectedCandidateIndex: null,
      selectedUrl: null,
      selectedCandidate: null,
      confidence: 0,
      rationale: "No candidate URLs provided for ownership assessment.",
      evidenceCited: [],
    };
  }

  // Deterministic pre-guard: build an exact lookup map by candidateIndex and normalized URL
  const normalizedCandidates = candidates.map((c, idx) => ({
    ...c,
    candidateIndex: c.candidateIndex ?? c.index ?? idx,
    handle: c.handle ?? c.handleOrId ?? null,
  }));
  const candidateByIndex = new Map<number, (typeof normalizedCandidates)[0]>();
  for (const c of normalizedCandidates) {
    candidateByIndex.set(c.candidateIndex, c);
  }

  // Skip live LLM call if OpenAI/Gemini credentials are disabled or in unit test mock mode without AI
  if (process.env.DISABLE_LLM_SOURCE_REASONER === "1" || (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY)) {
    return {
      decision: "AMBIGUOUS_UNRESOLVED",
      verdict: "AMBIGUOUS_UNRESOLVED",
      selectedCandidateIndex: null,
      selectedUrl: null,
      selectedCandidate: null,
      confidence: 0,
      rationale: "LLM source reasoner unavailable; preserving unresolved ambiguity.",
      evidenceCited: [],
    };
  }

  try {
    const prompt = `You are an evidence-grounded Brand & Account Ownership Verifier.
Target Business Name: "${competitorName}"
Target Website Domain: "${cleanDomain}"
Target Platform: "${platform}"

Below are candidate URLs observed in external search results. Determine whether any candidate is the OFFICIAL profile/review page for "${competitorName}" (${cleanDomain}), a third-party creator/customer testimonial about "${competitorName}", a different business/person with a similar name or handle substring (REJECTED_MISMATCH), or too ambiguous to verify (AMBIGUOUS_UNRESOLVED).

STRICT RULES:
1. Never invent or modify a URL. You may only reference a candidate by its exact \`candidateIndex\`.
2. Choose "VERIFIED_MATCH" ONLY if the handle, title, or snippet provides clear, specific evidence linking the account to the business "${competitorName}" (${cleanDomain}) and its industry/offering.
3. Reject accounts whose handle adds unrelated personal/topic words (e.g. food, spiritual healing, unrelated creators/musicians in another language) or where two entities merely share a generic phrase: return "REJECTED_MISMATCH".
4. If the evidence is inconclusive or lacks domain/offering confirmation, return "AMBIGUOUS_UNRESOLVED" and preserve the uncertainty.

CANDIDATES:
${JSON.stringify(normalizedCandidates, null, 2)}

Return ONLY valid JSON matching:
{
  "decision": "VERIFIED_MATCH" | "REJECTED_MISMATCH" | "AMBIGUOUS_UNRESOLVED" | "THIRD_PARTY_TESTIMONIAL",
  "selectedCandidateIndex": number | null,
  "confidence": number (0.0 to 1.0),
  "rationale": "concise evidence-backed explanation",
  "evidenceCited": ["exact quote or signal from candidate title/snippet/url"]
}`;

    const rawResponse: any = await aiChat({
      model: "gpt-4.1-mini",
      max_tokens: 800,
      accountId: params.accountId || "system",
      endpoint: "source-ownership-assessment",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.0,
    } as any);

    const rawText =
      typeof rawResponse === "string"
        ? rawResponse
        : rawResponse?.choices?.[0]?.message?.content || "{}";
    const cleanedJson = String(rawText).replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    const parsedJson = JSON.parse(cleanedJson || "{}");
    const validated = ownershipAssessmentSchema.safeParse(parsedJson);
    if (!validated.success) {
      return {
        decision: "AMBIGUOUS_UNRESOLVED",
        verdict: "AMBIGUOUS_UNRESOLVED",
        selectedCandidateIndex: null,
        selectedUrl: null,
        selectedCandidate: null,
        confidence: 0,
        rationale: "Structured LLM ownership output failed schema validation; preserving ambiguity.",
        evidenceCited: [],
      };
    }

    const data = validated.data;
    const matchedCandidate =
      data.selectedCandidateIndex != null ? candidateByIndex.get(data.selectedCandidateIndex) ?? null : null;

    // HARD GUARD: If LLM claimed VERIFIED_MATCH or THIRD_PARTY_TESTIMONIAL but did not reference a valid input candidate, reject!
    if ((data.decision === "VERIFIED_MATCH" || data.decision === "THIRD_PARTY_TESTIMONIAL") && !matchedCandidate) {
      return {
        decision: "AMBIGUOUS_UNRESOLVED",
        verdict: "AMBIGUOUS_UNRESOLVED",
        selectedCandidateIndex: null,
        selectedUrl: null,
        selectedCandidate: null,
        confidence: 0,
        rationale: "LLM selected a candidate index not present in input candidates; rejected by deterministic guard.",
        evidenceCited: [],
      };
    }

    // Require high confidence (>= 0.75) for VERIFIED_MATCH
    if (data.decision === "VERIFIED_MATCH" && data.confidence < 0.75) {
      return {
        decision: "AMBIGUOUS_UNRESOLVED",
        verdict: "AMBIGUOUS_UNRESOLVED",
        selectedCandidateIndex: matchedCandidate?.candidateIndex ?? null,
        selectedUrl: null,
        selectedCandidate: null,
        confidence: data.confidence,
        rationale: `Confidence (${data.confidence.toFixed(2)}) below 0.75 verification threshold: ${data.rationale}`,
        evidenceCited: data.evidenceCited,
      };
    }

    const verdict = data.decision === "VERIFIED_MATCH" ? "VERIFIED_OFFICIAL" : data.decision;
    return {
      decision: data.decision,
      verdict,
      selectedCandidateIndex: matchedCandidate?.candidateIndex ?? null,
      selectedUrl: matchedCandidate?.url ?? null,
      selectedCandidate: matchedCandidate,
      confidence: data.confidence,
      rationale: data.rationale,
      evidenceCited: data.evidenceCited,
    };
  } catch (err: any) {
    return {
      decision: "AMBIGUOUS_UNRESOLVED",
      verdict: "AMBIGUOUS_UNRESOLVED",
      selectedCandidateIndex: null,
      selectedUrl: null,
      selectedCandidate: null,
      confidence: 0,
      rationale: `LLM ownership assessment error (${err?.message || "unknown"}); preserving unresolved ambiguity.`,
      evidenceCited: [],
    };
  }
}
