import { aiChat } from "../ai-client";
import { logSafe } from "../log-redact";
import { recordInferencePartial } from "../operations-guardian/ai-pressure-stats";
import {
  AnalyticalPackage,
  AELInput,
  EMPTY_ANALYTICAL_PACKAGE,
} from "./types";

const LOG_PREFIX = "[AEL-v2]";
const AEL_VERSION = 2;

// Task #59 / Phase 1C — feed the Guardian aggregator at every isPartial=true
// return. Returning the same string keeps the pre-existing partialReason
// value unchanged; the side-effect is the recorder call. Wrapped because
// a recorder failure must NEVER break AEL output (Seal #15: logged is OK,
// silent is not).
function notePartialReason(reason: string): string {
  try {
    recordInferencePartial(reason);
  } catch (err) {
    console.error("[OperationsGuardian] AEL_PARTIAL_RECORD_FAILED", { reason, err });
  }
  return reason;
}

function buildInputSummary(input: AELInput) {
  // MI runtime shape (MIv3DiagnosticResult): top-level dominanceData/trajectoryData/threatSignals/opportunitySignals/narrativeObjectionMap,
  // and `output` containing marketState/marketDiagnosis/competitorIntentMap, plus signal_data via output.audienceIntentSignals.
  const mi = input.mi;
  const miMarketState = mi?.marketState ?? mi?.output?.marketState;
  const miSignals =
    mi?.signalClusters ??
    mi?.signals ??
    mi?.output?.audienceIntentSignals ??
    mi?.threatSignals ??
    mi?.opportunitySignals;
  const miHasNarrative = !!(mi?.output?.marketDiagnosis || mi?.output?.narrativeSynthesis || mi?.narrativeObjectionMap);
  const miHasCompetitive = !!(mi?.dominanceData?.length > 0 || mi?.output?.competitorIntentMap?.length > 0);
  const hasMI = !!(mi && (miMarketState || (Array.isArray(miSignals) && miSignals.length > 0) || miHasNarrative || miHasCompetitive));

  const hasAudience = !!(input.audience && (input.audience.audiencePains || input.audience.painMap || input.audience.pains || input.audience.segments || input.audience.audienceSegments));
  const hasProductDNA = !!(input.productDNA && (input.productDNA.coreOffer || input.productDNA.businessType));
  const hasCompetitiveData = !!(
    input.competitiveData && (
      (Array.isArray(input.competitiveData.competitors) && input.competitiveData.competitors.length > 0) ||
      (Array.isArray(input.competitiveData.posts) && input.competitiveData.posts.length > 0)
    )
  );

  let signalCount = 0;
  if (Array.isArray(mi?.signalClusters)) signalCount += mi.signalClusters.length;
  if (Array.isArray(mi?.signals)) signalCount += mi.signals.length;
  if (Array.isArray(mi?.threatSignals)) signalCount += mi.threatSignals.length;
  if (Array.isArray(mi?.opportunitySignals)) signalCount += mi.opportunitySignals.length;
  if (Array.isArray(mi?.output?.audienceIntentSignals)) signalCount += mi.output.audienceIntentSignals.length;
  if (Array.isArray(mi?.output?.competitorIntentMap)) signalCount += mi.output.competitorIntentMap.length;

  return { hasMI, hasAudience, hasProductDNA, hasCompetitiveData, signalCount };
}

function buildContextBlock(input: AELInput): string {
  const sections: string[] = [];

  if (input.mi) {
    const mi = input.mi;
    const out = mi.output || {};
    sections.push("=== MARKET INTELLIGENCE RAW DATA ===");
    const marketState = mi.marketState ?? out.marketState;
    if (marketState) sections.push(`Market State: ${JSON.stringify(marketState).slice(0, 1200)}`);
    if (out.marketDiagnosis) sections.push(`Market Diagnosis: ${JSON.stringify(out.marketDiagnosis).slice(0, 1200)}`);
    const signalClusters = mi.signalClusters ?? mi.signals ?? out.audienceIntentSignals;
    if (Array.isArray(signalClusters) && signalClusters.length > 0) {
      sections.push(`Signal Clusters (${signalClusters.length}): ${JSON.stringify(signalClusters.slice(0, 8)).slice(0, 2000)}`);
    }
    if (Array.isArray(mi.threatSignals) && mi.threatSignals.length > 0) {
      sections.push(`Threat Signals (${mi.threatSignals.length}): ${JSON.stringify(mi.threatSignals.slice(0, 10)).slice(0, 1200)}`);
    }
    if (Array.isArray(mi.opportunitySignals) && mi.opportunitySignals.length > 0) {
      sections.push(`Opportunity Signals (${mi.opportunitySignals.length}): ${JSON.stringify(mi.opportunitySignals.slice(0, 10)).slice(0, 1200)}`);
    }
    if (mi.trajectoryData) sections.push(`Market Trajectory: ${JSON.stringify(mi.trajectoryData).slice(0, 800)}`);
    const intentData = mi.intentData ?? out.competitorIntentMap;
    if (intentData) sections.push(`Buyer/Competitor Intent Signals: ${JSON.stringify(intentData).slice(0, 800)}`);
    const narrativeObjections = mi.narrativeObjections ?? mi.narrativeObjectionMap;
    if (narrativeObjections) sections.push(`Market Objections & Resistance: ${JSON.stringify(narrativeObjections).slice(0, 800)}`);
    if (mi.dominanceData) sections.push(`Competitive Dominance Patterns: ${JSON.stringify(mi.dominanceData).slice(0, 800)}`);
    if (mi.competitorPosts || mi.posts) sections.push(`Competitor Content Sample: ${JSON.stringify((mi.competitorPosts || mi.posts || []).slice(0, 5)).slice(0, 1000)}`);
    if (mi.comments || mi.audienceComments) sections.push(`Audience Comments: ${JSON.stringify((mi.comments || mi.audienceComments || []).slice(0, 10)).slice(0, 1200)}`);
    if (mi.telemetry) {
      const t = mi.telemetry;
      sections.push(`Pipeline Trace: competitorsCount=${t.competitorsCount ?? 0} | postSampleSize=${t.postSampleSize ?? 0} | commentSampleSize=${t.commentSampleSize ?? 0} | postsProcessed=${t.postsProcessed ?? 0} | commentsProcessed=${t.commentsProcessed ?? 0} | executionMode=${t.executionMode}`);
    }
  }

  if (input.audience) {
    const aud = input.audience;
    sections.push("\n=== AUDIENCE DATA ===");
    const painData = aud.audiencePains || aud.painMap || aud.pains;
    if (painData) sections.push(`Pain Data: ${JSON.stringify(painData).slice(0, 1200)}`);
    if (aud.desireMap || aud.desires) sections.push(`Desire Data: ${JSON.stringify(aud.desireMap || aud.desires).slice(0, 1000)}`);
    if (aud.objectionMap || aud.objections) sections.push(`Objection Data: ${JSON.stringify(aud.objectionMap || aud.objections).slice(0, 800)}`);
    if (aud.awarenessLevel) sections.push(`Awareness Level: ${JSON.stringify(aud.awarenessLevel)}`);
    if (aud.segments || aud.audienceSegments) sections.push(`Audience Segments: ${JSON.stringify(aud.segments || aud.audienceSegments).slice(0, 800)}`);
    if (aud.maturityIndex) sections.push(`Market Maturity Index: ${JSON.stringify(aud.maturityIndex)}`);
    if (aud.buyingBehavior) sections.push(`Buying Behavior: ${JSON.stringify(aud.buyingBehavior).slice(0, 600)}`);
  }

  if (input.productDNA) {
    const dna = input.productDNA;
    sections.push("\n=== PRODUCT DNA ===");
    sections.push(`Business Type: ${dna.businessType || "unknown"}`);
    sections.push(`Core Offer: ${dna.coreOffer || "unknown"}`);
    sections.push(`Core Problem Solved: ${dna.coreProblemSolved || "unknown"}`);
    sections.push(`Unique Mechanism: ${dna.uniqueMechanism || "unknown"}`);
    sections.push(`Strategic Advantage: ${dna.strategicAdvantage || "unknown"}`);
    sections.push(`Target Audience: ${dna.targetAudienceSegment || "unknown"}`);
    sections.push(`Target Decision Maker: ${dna.targetDecisionMaker || "unknown"}`);
    sections.push(`Price Range: ${dna.priceRange || "unknown"}`);
  }

  if (input.competitiveData) {
    const ci = input.competitiveData;
    sections.push("\n=== COMPETITIVE DATA ===");
    if (ci.competitors) sections.push(`Competitors (${ci.competitors.length}): ${JSON.stringify(ci.competitors.slice(0, 5)).slice(0, 1000)}`);
    if (ci.posts) sections.push(`Competitor Posts (${ci.posts.length} total): ${JSON.stringify(ci.posts.slice(0, 5)).slice(0, 1000)}`);
  }

  return sections.join("\n");
}

export async function buildAnalyticalPackage(input: AELInput): Promise<AnalyticalPackage> {
  const startTime = Date.now();
  const inputSummary = buildInputSummary(input);

  console.log(`${LOG_PREFIX} BUILD_START | campaign=${input.campaignId} | hasMI=${inputSummary.hasMI} | hasAudience=${inputSummary.hasAudience} | hasProductDNA=${inputSummary.hasProductDNA} | hasCI=${inputSummary.hasCompetitiveData} | signals=${inputSummary.signalCount}`);

  if (!inputSummary.hasMI && !inputSummary.hasAudience) {
    console.log(`${LOG_PREFIX} SKIP | No MI or Audience data available — returning empty package`);
    // the empty-input branch must also flag
    // the package as partial so System Control can detect it. Pre-#28 this
    // returned EMPTY without `isPartial=true`, letting downstream consumers
    // believe a clean COMPLETE package was emitted.
    return {
      ...EMPTY_ANALYTICAL_PACKAGE,
      status: "INCOMPLETE",
      generatedAt: new Date().toISOString(),
      inputSummary,
      isPartial: true,
      partialReason: notePartialReason("EMPTY_ANALYTICAL_PACKAGE"),
      partialDetail: "no MI or Audience input available",
    };
  }

  const contextBlock = buildContextBlock(input);

  const systemPrompt = `You are a Deep Causal Interpretation Engine — the Analytical Enrichment Layer (AEL v2).

YOUR MISSION:
You interpret WHY things happen, not WHAT is happening. You extract ROOT CAUSES beneath surface signals. You model causal chains that explain buyer behavior. You identify the REAL reasons people don't convert — not the obvious ones.

CRITICAL DISTINCTION:
- Surface signal: "Users complain about price"
- Deep interpretation: "Users lack trust in ROI justification — they can't see how the investment pays back, so any price feels too high. The real barrier is proof of value, not affordability."

- Surface signal: "Users want simplicity"
- Deep interpretation: "Users fear wasting time on something that won't work for their specific situation. The real barrier is mechanism comprehension — they don't understand HOW it works, so they default to requesting simplicity as a proxy for certainty."

YOU MUST:
1. ALWAYS dig beneath surface signals to find the actual cause
2. ALWAYS explain WHY, not just WHAT
3. ALWAYS model causal chains: pain → cause → impact → behavior
4. ALWAYS identify what's REALLY stopping conversion
5. ALWAYS detect when surface complaints mask deeper issues
6. ALWAYS rank insights by conversion impact

YOU MUST NOT:
- Label signals without interpretation (e.g., "affordability issue" alone is REJECTED)
- Group multiple distinct pains into one generic category
- Use vague descriptors like "simplicity", "ease of use", "quality" without causal reasoning
- Make strategic recommendations or decisions — you INTERPRET, engines DECIDE
- Fabricate data — if evidence is weak, say so in confidence_notes

OUTPUT FORMAT (strict JSON):
{
  "root_causes": [
    {
      "surfaceSignal": "what the data literally shows",
      "deepCause": "the actual underlying reason (WHY)",
      "causalReasoning": "step-by-step reasoning from signal to cause — show your analytical work",
      "sourceData": "specific data point, quote, or metric that supports this",
      "confidenceLevel": "high|medium|low"
    }
  ],
  "pain_types": [
    {
      "painPoint": "specific pain identified",
      "painType": "trust|financial|knowledge_gap|status_identity|efficiency",
      "severity": "critical|moderate|minor",
      "underlyingCause": "WHY this pain exists — the deeper reason, not just the symptom",
      "evidence": "data that proves this"
    }
  ],
  "causal_chains": [
    {
      "pain": "what hurts",
      "cause": "why it hurts",
      "impact": "what happens because of this pain",
      "behavior": "what the buyer does (or doesn't do) as a result",
      "conversionEffect": "how this specifically blocks or delays conversion"
    }
  ],
  "buying_barriers": [
    {
      "barrier": "specific reason the user is NOT converting",
      "rootCause": "deeper reason behind this barrier",
      "userThinking": "what the buyer is actually thinking (their internal monologue)",
      "requiredResolution": "what would need to change for them to convert",
      "severity": "blocking|major|moderate"
    }
  ],
  "mechanism_gaps": [
    {
      "area": "aspect of the product/service",
      "whatUserDoesNotUnderstand": "specific comprehension gap",
      "whyItMatters": "impact on purchase decision",
      "currentPerception": "what the user currently thinks/believes",
      "idealPerception": "what they need to understand",
      "gapSeverity": "critical|moderate|minor"
    }
  ],
  "trust_gaps": [
    {
      "gap": "specific trust deficit",
      "barrier": "what prevents trust from forming",
      "currentTrustLevel": "none|low|moderate|high",
      "requiredTrustLevel": "low|moderate|high|very_high",
      "proofRequired": "specific type of proof that would close this gap"
    }
  ],
  "contradiction_flags": [
    {
      "surfaceSignal": "what the data appears to show",
      "actualReality": "what's really happening underneath",
      "whyMisleading": "why the surface interpretation is wrong or incomplete",
      "correctInterpretation": "how this should actually be understood",
      "severity": "blocking|concerning|minor"
    }
  ],
  "priority_ranking": [
    {
      "insight": "the key insight being ranked",
      "dimension": "which analytical dimension this comes from",
      "impactOnConversion": "critical|high|moderate|low",
      "frequency": "pervasive|common|occasional|rare",
      "actionability": "immediate|short_term|long_term",
      "rank": 1
    }
  ],
  "confidence_notes": [
    {
      "area": "analytical area",
      "note": "observation about data quality, gaps, or limitations",
      "dataQuality": "strong|adequate|weak|insufficient"
    }
  ]
}

QUALITY GATES (outputs that violate these are REJECTED):
1. Every root_cause must have a surfaceSignal that DIFFERS from its deepCause
2. Every causal_chain must follow the complete pain→cause→impact→behavior→conversionEffect flow
3. Every buying_barrier must include the buyer's internal thinking (userThinking)
4. At least one contradiction_flag where a surface complaint masks a deeper issue
5. priority_ranking MUST order insights by conversion impact — the #1 item is the MOST important thing to address
6. No generic labels without causal justification — "simplicity" alone = REJECTED
7. Each array should have 3-8 entries based on data richness. Return empty array only if genuinely no data.`;

  const userPrompt = `Perform deep causal interpretation of the following market and audience data.

DO NOT organize or label the data. INTERPRET it. Explain WHY things are happening. Find what's hidden beneath the surface.

${contextBlock}

Return ONLY valid JSON matching the specified format. No markdown, no explanation, no strategic recommendations.`;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      accountId: input.accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673",
      endpoint: "analytical-enrichment",
      max_tokens: 4000,
      temperature: 0.4,
      timeoutMs: 90000,
    });

    const content = response.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(logSafe(`${LOG_PREFIX} PARSE_FAIL | No JSON found in response`));
      return { ...EMPTY_ANALYTICAL_PACKAGE, status: "INCOMPLETE", generatedAt: new Date().toISOString(), inputSummary, isPartial: true, partialReason: notePartialReason("AEL_PARSE_FAILURE"), partialDetail: "AEL response contained no parseable JSON" };
    }

    const parsed = (() => {
      const raw = jsonMatch[0];
      // First attempt: direct parse
      try { return JSON.parse(raw); } catch (_) {}
      // Repair: replace invalid \' escape sequences (not valid JSON) with plain '
      const repaired1 = raw.replace(/\\'/g, "'");
      try { return JSON.parse(repaired1); } catch (_) {}
      // Repair: strip "thinking" fields that leak into the JSON
      const repaired2 = repaired1.replace(/"thinking"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?\s*/g, "");
      try { return JSON.parse(repaired2); } catch (_) {}
      // Repair: normalize other common LLM escape artifacts (\") at start of string values
      const repaired3 = repaired2.replace(/:\s*\\"([^"]*?)\\"/g, (_m: string, p1: string) => `: "${p1}"`);
      try { return JSON.parse(repaired3); } catch (finalErr: any) {
        console.warn(logSafe(`${LOG_PREFIX} PARSE_REPAIR_EXHAUSTED | tried 4 strategies | last_error=${finalErr.message?.slice(0, 80)}`));
        throw finalErr;
      }
    })();
    const elapsed = Date.now() - startTime;

    const pkg: AnalyticalPackage = {
      root_causes: Array.isArray(parsed.root_causes) ? parsed.root_causes : [],
      pain_types: Array.isArray(parsed.pain_types) ? parsed.pain_types : [],
      causal_chains: Array.isArray(parsed.causal_chains) ? parsed.causal_chains : [],
      buying_barriers: Array.isArray(parsed.buying_barriers) ? parsed.buying_barriers : [],
      mechanism_gaps: Array.isArray(parsed.mechanism_gaps) ? parsed.mechanism_gaps : [],
      trust_gaps: Array.isArray(parsed.trust_gaps) ? parsed.trust_gaps : [],
      contradiction_flags: Array.isArray(parsed.contradiction_flags) ? parsed.contradiction_flags : [],
      priority_ranking: Array.isArray(parsed.priority_ranking) ? parsed.priority_ranking : [],
      confidence_notes: Array.isArray(parsed.confidence_notes) ? parsed.confidence_notes : [],
      generatedAt: new Date().toISOString(),
      version: AEL_VERSION,
      inputSummary,
    };

    const qualityCheck = validateAELQuality(pkg);

    console.log(`${LOG_PREFIX} BUILD_COMPLETE | campaign=${input.campaignId} | elapsed=${elapsed}ms | rootCauses=${pkg.root_causes.length} | pains=${pkg.pain_types.length} | causalChains=${pkg.causal_chains.length} | barriers=${pkg.buying_barriers.length} | mechGaps=${pkg.mechanism_gaps.length} | trustGaps=${pkg.trust_gaps.length} | contradictions=${pkg.contradiction_flags.length} | priorities=${pkg.priority_ranking.length} | quality=${qualityCheck.passed ? "PASS" : "WARN:" + qualityCheck.issues.join(",")}`);

    return pkg;
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.error(logSafe(`${LOG_PREFIX} BUILD_ERROR | campaign=${input.campaignId} | elapsed=${elapsed}ms | error=${err.message}`));
    return { ...EMPTY_ANALYTICAL_PACKAGE, status: "INCOMPLETE", generatedAt: new Date().toISOString(), inputSummary, isPartial: true, partialReason: notePartialReason("AEL_BUILD_ERROR"), partialDetail: `AEL build failed: ${err.message}` };
  }
}

function validateAELQuality(pkg: AnalyticalPackage): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const rc of pkg.root_causes) {
    if (rc.surfaceSignal && rc.deepCause && rc.surfaceSignal.toLowerCase().trim() === rc.deepCause.toLowerCase().trim()) {
      issues.push(`root_cause_echo: "${rc.surfaceSignal}" same as deepCause`);
    }
    if (!rc.causalReasoning || rc.causalReasoning.length < 20) {
      issues.push(`shallow_reasoning: "${rc.surfaceSignal}"`);
    }
  }

  for (const cc of pkg.causal_chains) {
    if (!cc.pain || !cc.cause || !cc.impact || !cc.behavior || !cc.conversionEffect) {
      issues.push(`incomplete_chain: missing fields`);
    }
  }

  for (const bb of pkg.buying_barriers) {
    if (!bb.userThinking || bb.userThinking.length < 10) {
      issues.push(`missing_user_thinking: "${bb.barrier}"`);
    }
  }

  if (pkg.contradiction_flags.length === 0 && pkg.root_causes.length > 0) {
    issues.push(`no_contradictions_detected`);
  }

  if (pkg.priority_ranking.length === 0 && pkg.root_causes.length > 0) {
    issues.push(`no_priority_ranking`);
  }

  const genericTerms = ["simplicity", "ease of use", "quality", "value", "affordability"];
  for (const pt of pkg.pain_types) {
    if (genericTerms.some(t => pt.painPoint.toLowerCase() === t) && (!pt.underlyingCause || pt.underlyingCause.length < 15)) {
      issues.push(`generic_pain_no_cause: "${pt.painPoint}"`);
    }
  }

  return { passed: issues.length === 0, issues };
}

export interface FilteredAELContext {
  filteredPkg: AnalyticalPackage;
  primaryRootCauses: RootCause[];
  supportingRootCauses: RootCause[];
  primaryCausalChains: CausalChain[];
  supportingCausalChains: CausalChain[];
  primaryBuyingBarriers: BuyingBarrier[];
  supportingBuyingBarriers: BuyingBarrier[];
  primaryPainTypes: PainTypeEntry[];
  supportingPainTypes: PainTypeEntry[];
  excludedInsightCount: number;
  unresolvedInsightCount: number;
}

/**
 * Filter an AnalyticalPackage against canonical pain authority (StrategicPainDecision / painRegistry).
 *
 * Rules (Phase 1 Global Semantic Authority):
 * - AEL insights MUST establish an ID-based or semantic relationship to pain authority.
 * - Insights linked to CORE_PURCHASE pains become primary strategic authority.
 * - Insights linked to SUPPORTING pains become supporting authority (objections, friction, secondary messaging only).
 * - Insights linked to EXCLUDE / STRATEGIC_EXCLUDED pains are dropped (0 downstream authority).
 * - UNRESOLVED insights (cannot be linked to an approved pain) are dropped (fail closed).
 */
export function filterAELForStrategicUse(
  pkg: AnalyticalPackage | null,
  painRegistry?: any[] | Record<string, any> | null,
  approvedLanes?: any[] | null,
): FilteredAELContext | null {
  if (!pkg) return null;

  // Normalize painRegistry into array
  const registryList: any[] = Array.isArray(painRegistry)
    ? painRegistry
    : (painRegistry && Array.isArray((painRegistry as any).canonicalPains)
      ? (painRegistry as any).canonicalPains
      : (painRegistry && Array.isArray((painRegistry as any).pains)
        ? (painRegistry as any).pains
        : []));

  const pkgRootCauses = pkg.root_causes || (pkg as any).rootCauses || [];
  const pkgCausalChains = pkg.causal_chains || (pkg as any).causalChains || [];
  const pkgBuyingBarriers = pkg.buying_barriers || (pkg as any).buyingBarriers || [];
  const pkgPainTypes = pkg.pain_types || (pkg as any).painTypes || [];

  // If no pain registry is provided, fail closed — unverified AEL has zero downstream strategic authority.
  if (registryList.length === 0) {
    console.log(`${LOG_PREFIX} AEL_FILTER_FAIL_CLOSED | No painRegistry provided — zero AEL insights authorized for downstream prompts`);
    return {
      filteredPkg: {
        ...pkg,
        root_causes: [],
        causal_chains: [],
        buying_barriers: [],
        pain_types: [],
        mechanism_gaps: [],
        trust_gaps: [],
        contradiction_flags: [],
        priority_ranking: [],
      },
      primaryRootCauses: [],
      supportingRootCauses: [],
      primaryCausalChains: [],
      supportingCausalChains: [],
      primaryBuyingBarriers: [],
      supportingBuyingBarriers: [],
      primaryPainTypes: [],
      supportingPainTypes: [],
      excludedInsightCount: 0,
      unresolvedInsightCount: pkgRootCauses.length + pkgCausalChains.length + pkgBuyingBarriers.length,
    };
  }

  const corePainIds = new Set<string>();
  const supportingPainIds = new Set<string>();
  const excludedPainIds = new Set<string>();
  const painByRootCauseId = new Map<string, any[]>();
  const painByEvidenceUid = new Map<string, any[]>();
  const canonicalPains: Array<{ painId: string; classification: string; canonical: string }> = [];

  for (const pain of registryList) {
    const pid = pain.painId || pain.id;
    if (!pid) continue;
    const classification = pain.classification || pain.role || "UNKNOWN";
    if (classification === "CORE_PURCHASE" || classification === "CORE") {
      corePainIds.add(pid);
    } else if (classification === "SUPPORTING" || classification === "OBJECTION") {
      supportingPainIds.add(pid);
    } else if (classification === "EXCLUDE" || classification === "STRATEGIC_EXCLUDED") {
      excludedPainIds.add(pid);
    }

    const rcIds = Array.isArray(pain.rootCauseIds) ? pain.rootCauseIds : [];
    for (const rId of rcIds) {
      if (!painByRootCauseId.has(rId)) painByRootCauseId.set(rId, []);
      painByRootCauseId.get(rId)!.push(pain);
    }

    const evUids = Array.isArray(pain.evidenceUids) ? pain.evidenceUids : [];
    for (const eUid of evUids) {
      if (!painByEvidenceUid.has(eUid)) painByEvidenceUid.set(eUid, []);
      painByEvidenceUid.get(eUid)!.push(pain);
    }

    const rawText = pain.normalizedStatement || pain.canonical || pain.text || pain.originalStatement || "";
    canonicalPains.push({
      painId: pid,
      classification,
      canonical: rawText,
    });
  }

  // Also include explicit primaryPurchasePainId, supportingPainIds, excludedPainIds if present on registry object
  if (painRegistry && typeof painRegistry === "object" && !Array.isArray(painRegistry)) {
    if ((painRegistry as any).primaryPurchasePainId) corePainIds.add((painRegistry as any).primaryPurchasePainId);
    if (Array.isArray((painRegistry as any).supportingPainIds)) {
      for (const sp of (painRegistry as any).supportingPainIds) supportingPainIds.add(sp);
    }
    if (Array.isArray((painRegistry as any).excludedPainIds)) {
      for (const ep of (painRegistry as any).excludedPainIds) excludedPainIds.add(ep);
    }
  }

  const laneSegmentIds = new Set<string>(
    (approvedLanes || []).map((l: any) => l.segmentId || l.id).filter(Boolean)
  );

  const resolveItemAuthority = (
    text: string,
    id?: string,
    explicitPainIds?: string[],
    evidenceUid?: string
  ): { status: "CORE" | "SUPPORTING" | "EXCLUDED" | "UNRESOLVED"; resolvedPainIds: string[] } => {
    // 1. Explicit relatedPainIds
    if (Array.isArray(explicitPainIds) && explicitPainIds.length > 0) {
      const hasCore = explicitPainIds.some((pid) => corePainIds.has(pid));
      const hasSupporting = explicitPainIds.some((pid) => supportingPainIds.has(pid));
      const hasExcluded = explicitPainIds.some((pid) => excludedPainIds.has(pid));

      if (hasExcluded && !hasCore && !hasSupporting) {
        return { status: "EXCLUDED", resolvedPainIds: explicitPainIds };
      }
      if (hasCore) {
        return {
          status: "CORE",
          resolvedPainIds: explicitPainIds.filter((pid) => !excludedPainIds.has(pid)),
        };
      }
      if (hasSupporting) {
        return {
          status: "SUPPORTING",
          resolvedPainIds: explicitPainIds.filter((pid) => !excludedPainIds.has(pid)),
        };
      }
    }

    // 2. ID-based mapping from painByRootCauseId
    if (id && painByRootCauseId.has(id)) {
      const linkedPains = painByRootCauseId.get(id)!;
      const hasCore = linkedPains.some((p) => corePainIds.has(p.painId || p.id));
      const hasSupporting = linkedPains.some((p) => supportingPainIds.has(p.painId || p.id));
      const hasExcluded = linkedPains.some((p) => excludedPainIds.has(p.painId || p.id));

      if (hasExcluded && !hasCore && !hasSupporting) {
        return { status: "EXCLUDED", resolvedPainIds: linkedPains.map((p) => p.painId || p.id) };
      }
      if (hasCore) {
        return {
          status: "CORE",
          resolvedPainIds: linkedPains
            .map((p) => p.painId || p.id)
            .filter((pid) => !excludedPainIds.has(pid)),
        };
      }
      if (hasSupporting) {
        return {
          status: "SUPPORTING",
          resolvedPainIds: linkedPains
            .map((p) => p.painId || p.id)
            .filter((pid) => !excludedPainIds.has(pid)),
        };
      }
    }

    // 3. Evidence UID mapping
    if (evidenceUid && painByEvidenceUid.has(evidenceUid)) {
      const linkedPains = painByEvidenceUid.get(evidenceUid)!;
      const hasCore = linkedPains.some((p) => corePainIds.has(p.painId || p.id));
      const hasSupporting = linkedPains.some((p) => supportingPainIds.has(p.painId || p.id));
      const hasExcluded = linkedPains.some((p) => excludedPainIds.has(p.painId || p.id));

      if (hasExcluded && !hasCore && !hasSupporting) {
        return { status: "EXCLUDED", resolvedPainIds: linkedPains.map((p) => p.painId || p.id) };
      }
      if (hasCore) {
        return {
          status: "CORE",
          resolvedPainIds: linkedPains
            .map((p) => p.painId || p.id)
            .filter((pid) => !excludedPainIds.has(pid)),
        };
      }
      if (hasSupporting) {
        return {
          status: "SUPPORTING",
          resolvedPainIds: linkedPains
            .map((p) => p.painId || p.id)
            .filter((pid) => !excludedPainIds.has(pid)),
        };
      }
    }

    // 4. No explicit canonical ID authority link established -> fail closed as UNRESOLVED (0 downstream authority)
    return { status: "UNRESOLVED", resolvedPainIds: [] };
  };

  const primaryRootCauses: RootCause[] = [];
  const supportingRootCauses: RootCause[] = [];
  const primaryCausalChains: CausalChain[] = [];
  const supportingCausalChains: CausalChain[] = [];
  const primaryBuyingBarriers: BuyingBarrier[] = [];
  const supportingBuyingBarriers: BuyingBarrier[] = [];
  const primaryPainTypes: PainTypeEntry[] = [];
  const supportingPainTypes: PainTypeEntry[] = [];

  let excludedInsightCount = 0;
  let unresolvedInsightCount = 0;

  for (let i = 0; i < pkgRootCauses.length; i++) {
    const rc = pkgRootCauses[i];
    const rcId = `RC${i + 1}`;
    const text = `${rc.surfaceSignal || rc.cause || ""} ${rc.deepCause || ""} ${rc.causalReasoning || ""}`;
    const auth = resolveItemAuthority(text, rcId, (rc as any).relatedPainIds, rc.sourceData);
    if (auth.status === "CORE") primaryRootCauses.push({ ...rc, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "SUPPORTING") supportingRootCauses.push({ ...rc, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "EXCLUDED") excludedInsightCount++;
    else unresolvedInsightCount++;
  }

  for (let i = 0; i < pkgCausalChains.length; i++) {
    const cc = pkgCausalChains[i];
    const ccId = `CC${i + 1}`;
    const text = `${cc.pain || ""} ${cc.cause || ""} ${cc.impact || ""} ${cc.behavior || ""} ${cc.conversionEffect || ""} ${cc.chain || ""}`;
    const auth = resolveItemAuthority(text, ccId, (cc as any).relatedPainIds);
    if (auth.status === "CORE") primaryCausalChains.push({ ...cc, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "SUPPORTING") supportingCausalChains.push({ ...cc, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "EXCLUDED") excludedInsightCount++;
    else unresolvedInsightCount++;
  }

  for (let i = 0; i < pkgBuyingBarriers.length; i++) {
    const bb = pkgBuyingBarriers[i];
    const bbId = `BB${i + 1}`;
    const text = `${bb.barrier || ""} ${bb.rootCause || ""} ${bb.userThinking || ""} ${bb.requiredResolution || ""}`;
    const auth = resolveItemAuthority(text, bbId, (bb as any).relatedPainIds);
    if (auth.status === "CORE") primaryBuyingBarriers.push({ ...bb, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "SUPPORTING") supportingBuyingBarriers.push({ ...bb, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "EXCLUDED") excludedInsightCount++;
    else unresolvedInsightCount++;
  }

  for (const pt of pkgPainTypes) {
    const text = `${pt.painPoint || ""} ${pt.underlyingCause || ""} ${pt.evidence || ""}`;
    const auth = resolveItemAuthority(text, undefined, (pt as any).relatedPainIds, pt.evidence);
    if (auth.status === "CORE") primaryPainTypes.push({ ...pt, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "SUPPORTING") supportingPainTypes.push({ ...pt, relatedPainIds: auth.resolvedPainIds } as any);
    else if (auth.status === "EXCLUDED") excludedInsightCount++;
    else unresolvedInsightCount++;
  }

  const allApprovedRootCauses = [...primaryRootCauses, ...supportingRootCauses];
  const allApprovedCausalChains = [...primaryCausalChains, ...supportingCausalChains];
  const allApprovedBuyingBarriers = [...primaryBuyingBarriers, ...supportingBuyingBarriers];
  const allApprovedPainTypes = [...primaryPainTypes, ...supportingPainTypes];

  console.log(
    `${LOG_PREFIX} AEL_AUTHORITY_FILTERED | primaryRC=${primaryRootCauses.length} supportingRC=${supportingRootCauses.length} | primaryCC=${primaryCausalChains.length} supportingCC=${supportingCausalChains.length} | primaryBB=${primaryBuyingBarriers.length} supportingBB=${supportingBuyingBarriers.length} | excluded=${excludedInsightCount} unresolved=${unresolvedInsightCount}`
  );

  const filteredPkg: AnalyticalPackage = {
    ...pkg,
    root_causes: allApprovedRootCauses,
    causal_chains: allApprovedCausalChains,
    buying_barriers: allApprovedBuyingBarriers,
    pain_types: allApprovedPainTypes,
  };

  return {
    filteredPkg,
    primaryRootCauses,
    supportingRootCauses,
    primaryCausalChains,
    supportingCausalChains,
    primaryBuyingBarriers,
    supportingBuyingBarriers,
    primaryPainTypes,
    supportingPainTypes,
    excludedInsightCount,
    unresolvedInsightCount,
  };
}

export function formatAELForPrompt(
  pkg: AnalyticalPackage | null,
  painRegistry?: any[] | null,
  approvedLanes?: any[] | null,
): string {
  if (!pkg) return "";

  // If painRegistry is provided, filter AEL against authoritative pain decisions
  let activePkg = pkg;
  let primaryRootCauses = pkg.root_causes || [];
  let supportingRootCauses: RootCause[] = [];
  let primaryCausalChains = pkg.causal_chains || [];
  let supportingCausalChains: CausalChain[] = [];
  let primaryBuyingBarriers = pkg.buying_barriers || [];
  let supportingBuyingBarriers: BuyingBarrier[] = [];

  if (painRegistry) {
    const filteredCtx = filterAELForStrategicUse(pkg, painRegistry, approvedLanes);
    if (!filteredCtx) return "";
    activePkg = filteredCtx.filteredPkg;
    primaryRootCauses = filteredCtx.primaryRootCauses;
    supportingRootCauses = filteredCtx.supportingRootCauses;
    primaryCausalChains = filteredCtx.primaryCausalChains;
    supportingCausalChains = filteredCtx.supportingCausalChains;
    primaryBuyingBarriers = filteredCtx.primaryBuyingBarriers;
    supportingBuyingBarriers = filteredCtx.supportingBuyingBarriers;
  }

  const totalInsights =
    (activePkg.root_causes?.length || 0) +
    (activePkg.pain_types?.length || 0) +
    (activePkg.causal_chains?.length || 0) +
    (activePkg.buying_barriers?.length || 0) +
    (activePkg.mechanism_gaps?.length || 0) +
    (activePkg.trust_gaps?.length || 0);

  if (totalInsights === 0) return "";

  const sections: string[] = [];
  if (activePkg.isPartial === true) {
    sections.push("\n⚠ AEL_PARTIAL_NOTICE: Analytical enrichment is DEGRADED (partialReason=" + (activePkg.partialReason || "unknown") + ").");
    sections.push("Treat all derived inferences as PROVISIONAL. Do not rely on root-cause depth as load-bearing evidence.\n");
  }
  sections.push("\n═══ DEEP ANALYTICAL CONTEXT (AEL v2 — Causal Interpretation) ═══");
  sections.push("These are INTERPRETED insights — root causes beneath surface signals authorized by Strategic Pain Decisions.");
  sections.push("Use them to DEEPEN your analysis. Your engine logic remains the sole decision-maker.\n");

  if (primaryRootCauses.length > 0) {
    sections.push("── PRIMARY ROOT CAUSES (CORE PURCHASE PAIN AUTHORITY) ──");
    for (const rc of primaryRootCauses) {
      sections.push(`  • Surface: "${rc.surfaceSignal}"`);
      sections.push(`    Deep cause: ${rc.deepCause} [${rc.confidenceLevel}]`);
      sections.push(`    Reasoning: ${rc.causalReasoning}`);
      sections.push(`    Evidence: ${rc.sourceData}`);
    }
  }

  if (supportingRootCauses.length > 0) {
    sections.push("\n── SUPPORTING ROOT CAUSES (SECONDARY / FRICTION ONLY — CANNOT REPLACE CORE PAIN) ──");
    for (const rc of supportingRootCauses) {
      sections.push(`  • [SUPPORTING] Surface: "${rc.surfaceSignal}"`);
      sections.push(`    Deep cause: ${rc.deepCause} [${rc.confidenceLevel}]`);
      sections.push(`    Reasoning: ${rc.causalReasoning}`);
    }
  }

  if (primaryCausalChains.length > 0) {
    sections.push("\n── CAUSAL CHAINS (pain → cause → impact → behavior) ──");
    for (const cc of primaryCausalChains) {
      sections.push(`  • ${cc.pain} → ${cc.cause} → ${cc.impact} → ${cc.behavior}`);
      sections.push(`    Conversion effect: ${cc.conversionEffect}`);
    }
  }

  if (supportingCausalChains.length > 0) {
    sections.push("\n── SUPPORTING CAUSAL CHAINS (SECONDARY FRICTION) ──");
    for (const cc of supportingCausalChains) {
      sections.push(`  • [SUPPORTING] ${cc.pain} → ${cc.cause} → ${cc.impact} → ${cc.behavior}`);
    }
  }

  if (primaryBuyingBarriers.length > 0) {
    sections.push("\n── BUYING BARRIERS (why users DON'T convert) ──");
    for (const bb of primaryBuyingBarriers) {
      sections.push(`  • [${bb.severity}] ${bb.barrier}`);
      sections.push(`    Root cause: ${bb.rootCause}`);
      sections.push(`    Buyer thinking: "${bb.userThinking}"`);
      sections.push(`    Required resolution: ${bb.requiredResolution}`);
    }
  }

  if (supportingBuyingBarriers.length > 0) {
    sections.push("\n── SUPPORTING BUYING BARRIERS (SECONDARY RESISTANCE) ──");
    for (const bb of supportingBuyingBarriers) {
      sections.push(`  • [SUPPORTING] [${bb.severity}] ${bb.barrier} — resolution: ${bb.requiredResolution}`);
    }
  }

  if (activePkg.pain_types?.length > 0) {
    sections.push("\n── PAIN TYPES (classified with causal depth) ──");
    for (const p of activePkg.pain_types) {
      sections.push(`  • [${p.severity}/${p.painType}] ${p.painPoint}`);
      sections.push(`    Underlying cause: ${p.underlyingCause}`);
      sections.push(`    Evidence: ${p.evidence}`);
    }
  }

  if (activePkg.mechanism_gaps?.length > 0) {
    sections.push("\n── MECHANISM COMPREHENSION GAPS ──");
    for (const mg of activePkg.mechanism_gaps) {
      sections.push(`  • [${mg.gapSeverity}] ${mg.area}`);
      sections.push(`    User doesn't understand: ${mg.whatUserDoesNotUnderstand}`);
      sections.push(`    Why it matters: ${mg.whyItMatters}`);
      sections.push(`    Current belief: "${mg.currentPerception}" → Needs to understand: "${mg.idealPerception}"`);
    }
  }

  if (activePkg.trust_gaps?.length > 0) {
    sections.push("\n── TRUST GAPS ──");
    for (const tg of activePkg.trust_gaps) {
      sections.push(`  • ${tg.gap} — barrier: ${tg.barrier}`);
      sections.push(`    Trust: ${tg.currentTrustLevel} → needed: ${tg.requiredTrustLevel}`);
      sections.push(`    Proof required: ${tg.proofRequired}`);
    }
  }

  if (activePkg.contradiction_flags?.length > 0) {
    sections.push("\n── CONTRADICTIONS & MISLEADING SIGNALS ──");
    for (const cf of activePkg.contradiction_flags) {
      sections.push(`  • [${cf.severity}] Surface says: "${cf.surfaceSignal}"`);
      sections.push(`    Actually: ${cf.actualReality}`);
      sections.push(`    Why misleading: ${cf.whyMisleading}`);
      sections.push(`    Correct interpretation: ${cf.correctInterpretation}`);
    }
  }

  if (activePkg.priority_ranking?.length > 0) {
    sections.push("\n── STRATEGIC PRIORITY (ranked by conversion impact) ──");
    for (const pr of activePkg.priority_ranking.slice(0, 5)) {
      sections.push(`  ${pr.rank}. [${pr.impactOnConversion}] ${pr.insight} (${pr.dimension}, ${pr.frequency}, ${pr.actionability})`);
    }
  }

  if (activePkg.confidence_notes?.length > 0) {
    sections.push("\n── DATA CONFIDENCE ──");
    for (const cn of activePkg.confidence_notes) {
      sections.push(`  • [${cn.dataQuality}] ${cn.area}: ${cn.note}`);
    }
  }

  sections.push("\n═══ END DEEP ANALYTICAL CONTEXT ═══\n");

  return sections.join("\n");
}

export function getAELVersion(): number {
  return AEL_VERSION;
}

/**
 * Phase 3 fix — persist the AnalyticalPackage to `ael_snapshots`.
 *
 * Previously the orchestrator built the package and stashed it on
 * `ctx.analyticalEnrichment` (in-memory only). The narrative layer
 * issues a raw SQL read against `ael_snapshots` to ground its WHY/HOW
 * steps, which silently returned zero rows because nothing ever wrote.
 * Migration 033 created the table; this helper is the single write
 * site. Called from runOrchestrator right after buildAnalyticalPackage.
 *
 * Idempotent: UNIQUE(account, campaign, job) so orchestrator re-runs
 * with the same jobId UPSERT instead of stacking duplicates.
 *
 * Fail-loud-but-don't-block: a persistence failure is logged with the
 * AEL_PERSIST_FAILED tag (operator-visible signal per Seal #15/#16)
 * but does not throw — the in-memory `ctx.analyticalEnrichment` keeps
 * downstream CEL working even if the DB write fails.
 */
export async function persistAELSnapshot(args: {
  accountId: string;
  campaignId: string;
  jobId: string;
  pkg: AnalyticalPackage;
}): Promise<void> {
  const { accountId, campaignId, jobId, pkg } = args;
  if (!accountId || !campaignId || !jobId || !pkg) {
    console.error(`${LOG_PREFIX} AEL_PERSIST_SKIPPED | missing required args | hasAccount=${!!accountId} hasCampaign=${!!campaignId} hasJob=${!!jobId} hasPkg=${!!pkg}`);
    return;
  }
  try {
    const { db } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const id = `ael_${jobId}`;

    // D1/D5 + B1/B4: root_causes / causal_chains / buying_barriers are REQUIRED
    // array fields on AnalyticalPackage. A silent `|| []` lets a MISSING
    // (undefined / non-array) field masquerade on reload as a real
    // "analyzed, found none" result — a fake-success substitution. Distinguish
    // a legitimately-empty array (valid) from a missing field (loud): coerce
    // only genuine arrays, record any field that was absent, and mark the whole
    // snapshot PARTIAL so downstream AEL-absent degradation fires truthfully.
    const missingArrayFields: string[] = [];
    const requireArray = (val: unknown, field: string): unknown[] => {
      if (Array.isArray(val)) return val;
      missingArrayFields.push(field);
      return [];
    };
    const rootCauses = requireArray(pkg.root_causes, "root_causes");
    const causalChains = requireArray(pkg.causal_chains, "causal_chains");
    const buyingBarriers = requireArray(pkg.buying_barriers, "buying_barriers");

    const fieldsMissing = missingArrayFields.length > 0;
    if (fieldsMissing) {
      console.error(
        `${LOG_PREFIX} AEL_FIELD_MISSING | campaign=${campaignId} | job=${jobId} | missing=[${missingArrayFields.join(",")}] — persisting snapshot as PARTIAL (an empty array is NOT a substitute for a missing required field)`,
      );
    }

    const persistIsPartial = !!pkg.isPartial || fieldsMissing;
    let persistPartialReason: string | null;
    if (pkg.partialReason) {
      persistPartialReason = pkg.partialReason;
    } else if (fieldsMissing) {
      persistPartialReason = `AEL_FIELDS_MISSING:${missingArrayFields.join("+")}`;
    } else {
      persistPartialReason = null;
    }

    await db.execute(sql`
      INSERT INTO ael_snapshots (
        id, account_id, campaign_id, job_id,
        root_causes, causal_chains, buying_barriers,
        package, is_partial, partial_reason
      ) VALUES (
        ${id}, ${accountId}, ${campaignId}, ${jobId},
        ${JSON.stringify(rootCauses)}::jsonb,
        ${JSON.stringify(causalChains)}::jsonb,
        ${JSON.stringify(buyingBarriers)}::jsonb,
        ${JSON.stringify(pkg)}::jsonb,
        ${persistIsPartial},
        ${persistPartialReason}
      )
      ON CONFLICT (account_id, campaign_id, job_id) DO UPDATE SET
        root_causes = EXCLUDED.root_causes,
        causal_chains = EXCLUDED.causal_chains,
        buying_barriers = EXCLUDED.buying_barriers,
        package = EXCLUDED.package,
        is_partial = EXCLUDED.is_partial,
        partial_reason = EXCLUDED.partial_reason,
        created_at = now()
    `);
    console.log(`${LOG_PREFIX} AEL_PERSISTED | id=${id} | campaign=${campaignId} | job=${jobId} | rootCauses=${rootCauses.length} | causalChains=${causalChains.length} | buyingBarriers=${buyingBarriers.length} | partial=${persistIsPartial}`);

    // P-5 M4: register each causal item as citable evidence behind its
    // existing [RC#]/[CC#]/[BB#] prompt alias. UIDs are deterministic and
    // content-versioned (EV:causal_claim:ael_snapshots:<snapshotId>:<alias>@<hash>)
    // — computable from the item content via aelEvidenceUid without a lookup,
    // and a re-persisted snapshot (same jobId, regenerated items) mints NEW
    // evidence instead of rewriting what older citations point to.
    // Registration failure never blocks the snapshot.
    try {
      const { registerEvidence, versionedSourceId } = await import("../strategic-reasoning/evidence-registry");
      const causalEntries = [
        ...rootCauses.map((item, i) => ({ alias: `RC${i + 1}`, label: `Root cause ${i + 1}`, item })),
        ...causalChains.map((item, i) => ({ alias: `CC${i + 1}`, label: `Causal chain ${i + 1}`, item })),
        ...buyingBarriers.map((item, i) => ({ alias: `BB${i + 1}`, label: `Buying barrier ${i + 1}`, item })),
      ];
      if (causalEntries.length > 0) {
        await registerEvidence(
          accountId,
          campaignId,
          causalEntries.map((e) => {
            const detail = JSON.stringify(e.item).slice(0, 2000);
            return {
              kind: "causal_claim" as const,
              sourceTable: "ael_snapshots",
              sourceId: versionedSourceId(`${id}:${e.alias}`, detail),
              label: e.label,
              detail,
              observedAt: new Date(),
            };
          }),
        );
        console.log(`${LOG_PREFIX} AEL_EVIDENCE_REGISTERED | id=${id} | items=${causalEntries.length}`);
      }
    } catch (regErr: any) {
      console.error(`${LOG_PREFIX} AEL_EVIDENCE_REGISTER_FAILED | id=${id} | err=${regErr?.message || regErr}`);
    }
  } catch (err: any) {
    console.error(`${LOG_PREFIX} AEL_PERSIST_FAILED | campaign=${campaignId} | job=${jobId} | err=${err?.message || err}`);
  }
}
