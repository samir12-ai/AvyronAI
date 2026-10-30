
import { aiChat } from "../ai-client";
import {
  CanonicalDifferentiationInput,
  DifferentiationCandidate,
  JudgeDefect,
  PainDisposition,
} from "./types";

const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);

const PROPOSER_PROMPT = `
You are the Differentiation Proposer.
Your mandate is to formulate defensible, commercially meaningful, evidence-supported strategic differentiation for the offering regarding the provided CORE pains and Strategic Lanes.

7-STEP REASONING CONTRACT:
1. IDENTIFY BUYER DECISION TENSION:
   - Examine the cited CORE pain, its linked customerEvidence, and the Strategic Lane.
   - What specific decision friction, distrust, or purchase hesitation is the buyer experiencing?
   - Keep product facts and customer experiences distinguishable in your explanation while allowing both to contribute appropriately.

2. IDENTIFY VERIFIED OFFERING CAPABILITIES (PRACTICAL GROUNDING STANDARD):
   - Examine ourProductFacts / Product Truth facts.
   - Faithful paraphrases of verified product facts, ordinary descriptive wording, coherent combinations of complementary facts, and bounded explanations of buyer value ARE PERMITTED. Do NOT require every phrase to appear verbatim in ourProductFacts.
   - Distinguish natural description from a material new promise:
     * Verified ingredient provenance (e.g. Antep pistachio use) supports describing the ingredient and its provenance; it does NOT automatically establish guaranteed superior taste.
     * Verified production frequency (e.g. daily production in Gaziantep) supports describing production frequency and workflow; it does NOT automatically establish guaranteed moistness, mold prevention, or guaranteed freshness on arrival.
   - ANTI-PAIN-INVERSION RULE: NEVER invert a customer pain into an unverified product attribute or guarantee absent from ourProductFacts. Bound any unproven guarantees explicitly in proofBoundary.

3. IDENTIFY WHAT COMPETITIVE & CUSTOMER EVIDENCE ACTUALLY ESTABLISHES:
   - Examine BOTH competitiveAuthority (miFacts) AND customerEvidence (canonical customer reviews/comments).
   - Customer reviews and comments about a specific competitor ARE valid competitive evidence when cited with their canonical customerEvidenceId and bounded to their actual scope:
     * A competitor-linked review (competitorId present) can support: "A customer reviewing [Competitor] reported [experience]." It does NOT support universal claims like "[Competitor] always sells..."
     * If a review has a specific productOrVariantScope (e.g. a supermarket plastic-packaged variant), keep the statement scoped to that product/variant—never generalize it to every product sold by that competitor.
     * If a review is marked isAllegation=true (e.g. alleging ingredient substitution), it MUST remain an attributed customer allegation unless independent evidence establishes the underlying ingredient fact.
     * Unattributed customer voice (no competitorId) may establish a buyer concern in the market without attributing behavior to any specific competitor.
     * Multiple reports justify broader wording ONLY when their independence (distinct authors/sources) and scope justify it; never invent prevalence.

4. CHOOSE THE EXPLICIT COMPARISON BASELINE MODE (NO DISCLAIMER TRAP):
   - In comparisonBaseline, choose the mode supported by available evidence:
     a) COMPETITOR_FACT: Verified competitor facts from competitiveAuthority (cite miAuthorityIds and competitorIds). State factual comparison within the cited scope.
     b) COMPETITOR_CUSTOMER_VOICE: Competitor-linked customer voice from customerEvidence with a verified competitorId (cite customerEvidenceIds and competitorIds). State the attributed customer experience/complaint within its exact product/variant and allegation scope. (Empty miAuthorityIds is completely valid when customerEvidenceIds supports the baseline.)
     c) UNATTRIBUTED_MARKET_VOICE: Unattributed customer voice from customerEvidence without a competitorId (cite customerEvidenceIds; keep competitorIds empty). State the buyer concern reported by customers without inventing competitor attribution.
     d) STRATEGIC_MARKET_EMPHASIS: When no comparative claim is made (miAuthorityIds=[], customerEvidenceIds=[], competitorIds=[]), write a neutral statement focused on the product's verified strengths addressing the supported buyer concern.
   - FORBIDDEN DISCLAIMER TRAP: NEVER make an uncited claim about competitor practices or complaints and append "though specific competitor details/practices are unverified". A disclaimer does NOT cure an unsupported accusation.

5. FORMULATE COMMERCIALLY MEANINGFUL DISTINCTION:
   - Determine strategicForm:
     * DOCUMENTED_COMPARATIVE_CONTRAST when supported by COMPETITOR_FACT or COMPETITOR_CUSTOMER_VOICE.
     * STRATEGIC_MARKET_EMPHASIS when focusing on our verified combination of capabilities addressing the buyer concern (with STRATEGIC_MARKET_EMPHASIS or UNATTRIBUTED_MARKET_VOICE baseline).
   - Synthesize complementary verified facts from ourProductFacts and explain how this combination addresses the buyer's decision tension, while keeping unproven guarantees in proofBoundary.

6. BIND FACTUAL ASSERTIONS TO UNIQUE REFERENCES:
   - Cite each relevant productTruthFactId once (no duplicate IDs).
   - Cite miAuthorityIds and/or customerEvidenceIds in comparisonBaseline matching the chosen evidenceBasisType.

7. EXPLAIN BUYER VALUE AND LANE RELEVANCE:
   - Articulate how the verified capabilities address the buyer's purchase tension within the strategic lane without promising unverified outcomes.
`;

export interface CompactPromptOptions {
  targetPainIds?: string[];
}

/**
 * Builds a compact, stage-appropriate, traceable prompt view from the canonical
 * differentiation input without duplicating arrays (`productTruth`/`ourProductFacts`,
 * `competitiveAuthority`/`miFacts`, nested `corePains[].customerEvidence` + top-level
 * `customerEvidence`) or serializing raw database rows (`rawEvidenceReference`).
 *
 * Preserves:
 * - All verified `ourProductFacts` with stable `productTruthFactId`s
 * - Coverage of all selected competitors in `miFacts` with stable `miAuthorityId`s
 * - All customer evidence linked to the active `corePains`, all competitor-attributed
 *   customer evidence (`competitorId` present), and representative unattributed evidence
 *   across buyer lanes (both supporting and contradictory/qualified)
 */
export function buildCompactDifferentiationPromptInput(
  input: CanonicalDifferentiationInput,
  options?: CompactPromptOptions
) {
  const ourProductFactsRaw =
    input.ourProductFacts && input.ourProductFacts.length > 0
      ? input.ourProductFacts
      : input.productTruth || [];
  const miFactsRaw =
    input.miFacts && input.miFacts.length > 0
      ? input.miFacts
      : input.competitiveAuthority || [];
  const customerEvidenceRaw = input.customerEvidence || [];

  const allCorePains = (input.corePains || []).slice(0, 3);
  const targetPainSet =
    options?.targetPainIds && options.targetPainIds.length > 0
      ? new Set(options.targetPainIds)
      : null;
  const activeCorePains = targetPainSet
    ? allCorePains.filter((p) => targetPainSet.has(p.painId))
    : allCorePains;
  const effectiveCorePains = activeCorePains.length > 0 ? activeCorePains : allCorePains;
  const activePainIds = new Set(effectiveCorePains.map((p) => p.painId));

  // 1. Compact ourProductFacts (single canonical list, no duplicate `productTruth` key)
  const ourProductFacts = ourProductFactsRaw.map((f: any) => ({
    productTruthFactId: f.productTruthFactId || f.factId || f.id,
    fact: f.fact || f.statement || "",
    category: f.category || "capability",
    confidence: f.confidence,
  }));

  // 2. Compact miFacts covering every selected competitor in canonicalMi (no duplicate `competitiveAuthority` key)
  const seenMiKey = new Set<string>();
  const miFacts: Array<Record<string, unknown>> = [];
  for (const m of miFactsRaw as any[]) {
    const compId = m.competitorId || "";
    const stmt = String(m.statement || m.fact || "").trim();
    const dedupKey = `${compId}::${stmt.toLowerCase().slice(0, 120)}`;
    if (seenMiKey.has(dedupKey)) continue;
    seenMiKey.add(dedupKey);
    miFacts.push({
      miAuthorityId: m.miAuthorityId || m.id,
      competitorId: compId || undefined,
      competitorName: m.competitorName || undefined,
      category: m.category || m.signalType || undefined,
      statement: stmt.length > 280 ? `${stmt.slice(0, 277)}...` : stmt,
    });
  }

  // 3. Select & compact customerEvidence (strip giant `rawEvidenceReference` DB rows; avoid re-embedding inside corePains)
  const citedPainCustIds = new Set<string>();
  for (const p of effectiveCorePains) {
    for (const cid of p.customerEvidenceIds || []) {
      if (cid) citedPainCustIds.add(cid);
    }
    for (const ce of p.customerEvidence || []) {
      if (ce?.customerEvidenceId) citedPainCustIds.add(ce.customerEvidenceId);
    }
  }

  const selectedCustMap = new Map<string, any>();
  const toCompactCe = (ce: any) => ({
    customerEvidenceId: ce.customerEvidenceId,
    painIds: Array.isArray(ce.painIds) ? ce.painIds : [],
    competitorId: ce.competitorId || undefined,
    competitorName: ce.competitorName || undefined,
    sourceType: ce.sourceType || undefined,
    productOrVariantScope: ce.productOrVariantScope || undefined,
    isAllegation: Boolean(ce.isAllegation),
    author: ce.author || undefined,
    verbatimText:
      typeof ce.verbatimText === "string" && ce.verbatimText.length > 420
        ? `${ce.verbatimText.slice(0, 417)}...`
        : ce.verbatimText || "",
  });

  // Always include: (a) all evidence linked to active corePains, (b) all competitor-attributed customer evidence
  for (const ce of customerEvidenceRaw) {
    if (!ce?.customerEvidenceId) continue;
    const isLinkedToPain =
      citedPainCustIds.has(ce.customerEvidenceId) ||
      (Array.isArray(ce.painIds) && ce.painIds.some((pid: string) => activePainIds.has(pid)));
    const isCompetitorAttributed =
      typeof ce.competitorId === "string" && ce.competitorId.trim().length > 0;
    if (isLinkedToPain || isCompetitorAttributed) {
      selectedCustMap.set(ce.customerEvidenceId, toCompactCe(ce));
    }
  }

  // Also include representative unattributed items (including any allegation/qualified items) if pool is small
  for (const ce of customerEvidenceRaw) {
    if (selectedCustMap.size >= 30) break;
    if (!ce?.customerEvidenceId || selectedCustMap.has(ce.customerEvidenceId)) continue;
    if ((Array.isArray(ce.painIds) && ce.painIds.length > 0) || ce.isAllegation || ce.productOrVariantScope) {
      selectedCustMap.set(ce.customerEvidenceId, toCompactCe(ce));
    }
  }
  for (const ce of customerEvidenceRaw) {
    if (selectedCustMap.size >= 24) break;
    if (!ce?.customerEvidenceId || selectedCustMap.has(ce.customerEvidenceId)) continue;
    selectedCustMap.set(ce.customerEvidenceId, toCompactCe(ce));
  }

  // 4. Compact corePains (reference customerEvidenceIds without duplicating full customerEvidence objects)
  const corePains = effectiveCorePains.map((p: any) => ({
    painId: p.painId,
    canonicalPain: p.canonicalPain,
    segmentIds: p.segmentIds || [],
    fitType: p.fitType,
    requiredCapability: p.requiredCapability,
    matchedProductCapability: p.matchedProductCapability,
    productTruthFactIds: p.productTruthFactIds || [],
    customerEvidenceIds: p.customerEvidenceIds || [],
  }));

  // 5. Compact strategicLanes (avoid re-serializing nested full segment/pain objects)
  const strategicLanes = (input.strategicLanes || []).map((l: any) => ({
    laneId: l.laneId || l.id,
    laneName: l.laneName || l.name || l.label,
    segmentIds: l.segmentIds || [],
    corePainIds: l.corePainIds || l.painIds || [],
    strategicRationale: l.strategicRationale || l.rationale || undefined,
  }));

  return {
    lineage: input.lineage,
    corePains,
    ourProductFacts,
    miFacts,
    customerEvidence: Array.from(selectedCustMap.values()),
    strategicLanes,
    marketContext: input.marketContext || {},
  };
}

export async function proposeDifferentiation(
  input: CanonicalDifferentiationInput
): Promise<{ differentiations: DifferentiationCandidate[]; painDispositions: PainDisposition[] }> {
  log("DifferentiationProposer", "Generating initial differentiation candidates");

  const boundedInput = buildCompactDifferentiationPromptInput(input);

  const systemPrompt = PROPOSER_PROMPT + "\n\nCANONICAL INPUT:\n" + JSON.stringify(boundedInput);

  const userPrompt = `Formulate differentiation candidates for the provided CORE pains adhering to the 7-step reasoning contract.
Return JSON in the exact shape:
{
  "differentiations": [
    {
      "corePainIds": ["string (matching input CORE pain id)"],
      "differentiationClaim": "string (evidence-grounded strategic distinction or market emphasis)",
      "distinctiveProperty": "string (the core capability or combination creating the distinction)",
      "buyerValue": "string (why this addresses the buyer tension in the lane)",
      "mechanismStatus": "ESTABLISHED | NO_DISTINCT_MECHANISM_ESTABLISHED",
      "mechanismName": "string or null",
      "proofBoundary": "string (what is proven by facts vs what is unproven)",
      "strategicForm": "DOCUMENTED_COMPARATIVE_CONTRAST | STRATEGIC_MARKET_EMPHASIS",
      "productTruthFactIds": ["exact productTruthFactId from ourProductFacts"],
      "comparisonBaseline": {
        "statement": "string (grounded baseline matching evidenceBasisType; NEVER use 'unverified competitor details' disclaimers to excuse uncited competitor claims)",
        "evidenceBasisType": "COMPETITOR_FACT | COMPETITOR_CUSTOMER_VOICE | UNATTRIBUTED_MARKET_VOICE | STRATEGIC_MARKET_EMPHASIS",
        "miAuthorityIds": ["exact miAuthorityId from competitiveAuthority or empty array"],
        "customerEvidenceIds": ["exact customerEvidenceId from customerEvidence or empty array"],
        "competitorIds": ["verified competitorId or empty array"]
      }
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
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4.1-mini",
    accountId: (input as any).accountId || input.lineage?.accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
    endpoint: "differentiation",
    temperature: 0.1,
    max_tokens: 4000,
  });

  return parseProposerResponse(response, input);
}

export async function repairDifferentiation(
  input: CanonicalDifferentiationInput,
  failedCandidates: DifferentiationCandidate[],
  defects: JudgeDefect[]
): Promise<{ differentiations: DifferentiationCandidate[]; painDispositions: PainDisposition[] }> {
  log("DifferentiationProposer", "Running targeted semantic repair on rejected candidates");

  const targetPainIds = Array.from(
    new Set(
      failedCandidates.flatMap((c) => c.corePainIds || []).concat(
        defects.map((d) => d.painId).filter((id): id is string => Boolean(id))
      )
    )
  );
  const boundedInput = buildCompactDifferentiationPromptInput(input, {
    targetPainIds: targetPainIds.length > 0 ? targetPainIds : undefined,
  });

  const REPAIR_PROMPT = `
You are the Differentiation Repair Specialist.
Your task is to repair previously rejected differentiation candidates by revising the specific defective fields identified in the Judge's structured defects while preserving already-valid fields.

MANDATORY REPAIR RULES:
1. REPAIR THE DEFECTIVE FIELDS WITHOUT BREAKING ACCEPTED FIELDS:
   - Inspect each defect's rejectedFields (e.g. differentiationClaim, buyerValue, comparisonBaseline.statement).
   - Preserve fields that were NOT rejected unless they depend on a comparative superiority premise that is being removed.
   - If a phrase overstates support (e.g. turning daily production into guaranteed moistness or mold prevention, turning Antep pistachio provenance into guaranteed superior taste, turning MP3 download/link access into guaranteed permanent/unrestricted hosting or immediate ownership, or turning package tier options into guaranteed zero post-purchase/hidden fees), narrow the wording to what ourProductFacts verifies while keeping the useful grounded description.

2. RESOLVE COMPARISON BASELINE DEFECTS PROPERLY (NO DISCLAIMER TRAP):
   - NEVER write competitor-complaint summaries with a disclaimer like "though specific competitor details/practices are unverified" and empty citations! That disclaimer does NOT cure an uncited accusation.
   - Instead, check the pain's linked customerEvidence and miFacts:
     * If valid competitor-linked customer evidence (with a verified competitorId) exists in customerEvidence, cite its customerEvidenceIds and competitorIds, set evidenceBasisType="COMPETITOR_CUSTOMER_VOICE", and bound the wording strictly to the source's attribution, product/variant scope (productOrVariantScope), and allegation status (isAllegation).
     * If valid unattributed customer evidence exists in customerEvidence (no competitorId), either cite customerEvidenceIds with evidenceBasisType="UNATTRIBUTED_MARKET_VOICE" (stating the buyer concern without naming or accusing competitors) OR use a neutral STRATEGIC_MARKET_EMPHASIS baseline focused on our product's verified strengths addressing the buyer concern.
     * If switching to a non-comparative baseline (STRATEGIC_MARKET_EMPHASIS or UNATTRIBUTED_MARKET_VOICE), also remove any dependent superiority claims in differentiationClaim or buyerValue.

3. RETAIN VALID COMPONENTS & DEDUPLICATE CITATIONS:
   - Preserve the candidate's existing differentiationId, valid corePainIds, and unique productTruthFactIds.

4. FAIL-CLOSED INTEGRITY:
   - Only return "COMPETITIVE_EVIDENCE_INSUFFICIENT" or "NO_SUPPORTED_DIFFERENTIATION" if ourProductFacts genuinely has no relevant verified capabilities addressing the pain.
`;

  const repairContext = {
    canonicalInput: boundedInput,
    failedCandidates,
    defects,
  };

  const userPrompt = `Repair the rejected candidates based on the Judge defects and available verified evidence.
Return JSON in the exact shape:
{
  "differentiations": [
    {
      "differentiationId": "string (MUST retain the candidate's existing differentiationId if repairing)",
      "corePainIds": ["string"],
      "differentiationClaim": "string (grounded distinction; narrow any overstated guarantees rather than inventing competitor claims)",
      "distinctiveProperty": "string",
      "buyerValue": "string",
      "mechanismStatus": "ESTABLISHED | NO_DISTINCT_MECHANISM_ESTABLISHED",
      "mechanismName": "string or null",
      "proofBoundary": "string",
      "strategicForm": "DOCUMENTED_COMPARATIVE_CONTRAST | STRATEGIC_MARKET_EMPHASIS",
      "productTruthFactIds": ["exact productTruthFactId"],
      "comparisonBaseline": {
        "statement": "string (grounded in cited miAuthorityIds/customerEvidenceIds or neutral STRATEGIC_MARKET_EMPHASIS; NO 'unverified competitor details' disclaimers)",
        "evidenceBasisType": "COMPETITOR_FACT | COMPETITOR_CUSTOMER_VOICE | UNATTRIBUTED_MARKET_VOICE | STRATEGIC_MARKET_EMPHASIS",
        "miAuthorityIds": ["exact miAuthorityId or empty array"],
        "customerEvidenceIds": ["exact customerEvidenceId or empty array"],
        "competitorIds": ["verified competitorId or empty array"]
      }
    }
  ],
  "painDispositions": [
    {
      "painId": "string",
      "disposition": "ACCEPTED_DIFFERENTIATION | COMPETITIVE_EVIDENCE_INSUFFICIENT | NO_SUPPORTED_DIFFERENTIATION"
    }
  ]
}`;

  const response = await aiChat({
    messages: [
      { role: "system", content: REPAIR_PROMPT + "\n\nREPAIR CONTEXT:\n" + JSON.stringify(repairContext) },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4.1-mini",
    accountId: (input as any).accountId || input.lineage?.accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
    endpoint: "differentiation",
    temperature: 0.1,
    max_tokens: 4000,
  });

  return parseProposerResponse(response, input);
}

function uniqueStrings(arr: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
  }
  return out;
}

function parseProposerResponse(
  response: any,
  input: CanonicalDifferentiationInput
): { differentiations: DifferentiationCandidate[]; painDispositions: PainDisposition[] } {
  try {
    const rawText = response.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(rawText);
    const rawDiffs = Array.isArray(parsed.differentiations) ? parsed.differentiations : [];

    const differentiations: DifferentiationCandidate[] = rawDiffs.map((d: any) => {
      const rawPainIds = Array.isArray(d.corePainIds)
        ? d.corePainIds
        : (Array.isArray(d.painIds) ? d.painIds : [d.painId || input.corePains[0]?.painId].filter(Boolean));
      const painIds = uniqueStrings(rawPainIds);

      const rawFactIds = Array.isArray(d.productTruthFactIds)
        ? d.productTruthFactIds
        : (Array.isArray(d.ourEstablishedFacts) ? d.ourEstablishedFacts : []);
      const factIds = uniqueStrings(rawFactIds);

      const rawMiIds = Array.isArray(d.comparisonBaseline?.miAuthorityIds)
        ? d.comparisonBaseline.miAuthorityIds
        : (Array.isArray(d.competitorContrastingFacts) ? d.competitorContrastingFacts : []);
      const miIds = uniqueStrings(rawMiIds);

      const rawCustomerEvIds = Array.isArray(d.comparisonBaseline?.customerEvidenceIds)
        ? d.comparisonBaseline.customerEvidenceIds
        : (Array.isArray(d.customerEvidenceIds) ? d.customerEvidenceIds : []);
      const customerEvidenceIds = uniqueStrings(rawCustomerEvIds);

      const rawCompetitorIds = Array.isArray(d.comparisonBaseline?.competitorIds)
        ? d.comparisonBaseline.competitorIds
        : [];
      const competitorIds = uniqueStrings(rawCompetitorIds);

      const rawBasis = d.comparisonBaseline?.evidenceBasisType;
      const validBases = new Set([
        "COMPETITOR_FACT",
        "COMPETITOR_CUSTOMER_VOICE",
        "UNATTRIBUTED_MARKET_VOICE",
        "STRATEGIC_MARKET_EMPHASIS",
      ]);
      const inferredBasis = validBases.has(rawBasis)
        ? rawBasis
        : miIds.length > 0
          ? "COMPETITOR_FACT"
          : customerEvidenceIds.length > 0 && competitorIds.length > 0
            ? "COMPETITOR_CUSTOMER_VOICE"
            : customerEvidenceIds.length > 0
              ? "UNATTRIBUTED_MARKET_VOICE"
              : "STRATEGIC_MARKET_EMPHASIS";

      return {
        differentiationId: d.differentiationId || undefined,
        corePainIds: painIds,
        differentiationClaim: d.differentiationClaim || "",
        distinctiveProperty: d.distinctiveProperty || "",
        buyerValue: d.buyerValue || "",
        mechanismStatus: d.mechanismStatus === "ESTABLISHED" ? "ESTABLISHED" : "NO_DISTINCT_MECHANISM_ESTABLISHED",
        mechanismName: d.mechanismName || null,
        proofBoundary: d.proofBoundary || "",
        strategicForm: d.strategicForm === "DOCUMENTED_COMPARATIVE_CONTRAST" ? "DOCUMENTED_COMPARATIVE_CONTRAST" : "STRATEGIC_MARKET_EMPHASIS",
        productTruthFactIds: factIds,
        comparisonBaseline: {
          statement: d.comparisonBaseline?.statement || "",
          miAuthorityIds: miIds,
          customerEvidenceIds,
          competitorIds,
          evidenceBasisType: inferredBasis,
        },
        ourEstablishedFacts: factIds,
        competitorContrastingFacts: miIds,
        customerEvidenceIds,
      };
    });

    const painDispositions: PainDisposition[] = Array.isArray(parsed.painDispositions)
      ? parsed.painDispositions.filter((pd: any) => pd && typeof pd.painId === "string")
      : [];
    const disposedIds = new Set(painDispositions.map((pd) => pd.painId));
    for (const diff of differentiations) {
      for (const pid of diff.corePainIds || []) {
        if (pid && !disposedIds.has(pid)) {
          painDispositions.push({ painId: pid, disposition: "ACCEPTED_DIFFERENTIATION" });
          disposedIds.add(pid);
        }
      }
    }

    return {
      differentiations,
      painDispositions,
    };
  } catch (e: any) {
    log("DifferentiationProposer", `Failed to parse proposer response: ${e.message}`);
    return { differentiations: [], painDispositions: [] };
  }
}



