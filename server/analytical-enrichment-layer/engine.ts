import { aiChat } from "../ai-client";
import {
  AnalyticalPackage,
  AELInput,
  EMPTY_ANALYTICAL_PACKAGE,
} from "./types";

const LOG_PREFIX = "[AEL-v2]";
const AEL_VERSION = 2;

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
    // Seal #10 / Task #28 / F2.4 — the empty-input branch must also flag
    // the package as partial so System Control can detect it. Pre-#28 this
    // returned EMPTY without `isPartial=true`, letting downstream consumers
    // believe a clean COMPLETE package was emitted.
    return {
      ...EMPTY_ANALYTICAL_PACKAGE,
      generatedAt: new Date().toISOString(),
      inputSummary,
      isPartial: true,
      partialReason: "EMPTY_ANALYTICAL_PACKAGE: no MI or Audience input available",
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
      max_tokens: 4000,
      temperature: 0.4,
      timeoutMs: 90000,
    });

    const content = response.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} PARSE_FAIL | No JSON found in response`);
      return { ...EMPTY_ANALYTICAL_PACKAGE, generatedAt: new Date().toISOString(), inputSummary, isPartial: true, partialReason: "AEL response contained no parseable JSON" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
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
    console.error(`${LOG_PREFIX} BUILD_ERROR | campaign=${input.campaignId} | elapsed=${elapsed}ms | error=${err.message}`);
    return { ...EMPTY_ANALYTICAL_PACKAGE, generatedAt: new Date().toISOString(), inputSummary, isPartial: true, partialReason: `AEL build failed: ${err.message}` };
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

export function formatAELForPrompt(pkg: AnalyticalPackage | null): string {
  if (!pkg) return "";
  const totalInsights =
    (pkg.root_causes?.length || 0) +
    (pkg.pain_types?.length || 0) +
    (pkg.causal_chains?.length || 0) +
    (pkg.buying_barriers?.length || 0) +
    (pkg.mechanism_gaps?.length || 0) +
    (pkg.trust_gaps?.length || 0);

  if (totalInsights === 0) return "";

  const sections: string[] = [];
  if (pkg.isPartial === true) {
    sections.push("\n⚠ AEL_PARTIAL_NOTICE: Analytical enrichment is DEGRADED (partialReason=" + (pkg.partialReason || "unknown") + ").");
    sections.push("Treat all derived inferences as PROVISIONAL. Do not rely on root-cause depth as load-bearing evidence.\n");
  }
  sections.push("\n═══ DEEP ANALYTICAL CONTEXT (AEL v2 — Causal Interpretation) ═══");
  sections.push("These are INTERPRETED insights — root causes beneath surface signals.");
  sections.push("Use them to DEEPEN your analysis. Your engine logic remains the sole decision-maker.\n");

  if (pkg.root_causes?.length > 0) {
    sections.push("── ROOT CAUSES (WHY, not WHAT) ──");
    for (const rc of pkg.root_causes) {
      sections.push(`  • Surface: "${rc.surfaceSignal}"`);
      sections.push(`    Deep cause: ${rc.deepCause} [${rc.confidenceLevel}]`);
      sections.push(`    Reasoning: ${rc.causalReasoning}`);
      sections.push(`    Evidence: ${rc.sourceData}`);
    }
  }

  if (pkg.causal_chains?.length > 0) {
    sections.push("\n── CAUSAL CHAINS (pain → cause → impact → behavior) ──");
    for (const cc of pkg.causal_chains) {
      sections.push(`  • ${cc.pain} → ${cc.cause} → ${cc.impact} → ${cc.behavior}`);
      sections.push(`    Conversion effect: ${cc.conversionEffect}`);
    }
  }

  if (pkg.buying_barriers?.length > 0) {
    sections.push("\n── BUYING BARRIERS (why users DON'T convert) ──");
    for (const bb of pkg.buying_barriers) {
      sections.push(`  • [${bb.severity}] ${bb.barrier}`);
      sections.push(`    Root cause: ${bb.rootCause}`);
      sections.push(`    Buyer thinking: "${bb.userThinking}"`);
      sections.push(`    Required resolution: ${bb.requiredResolution}`);
    }
  }

  if (pkg.pain_types?.length > 0) {
    sections.push("\n── PAIN TYPES (classified with causal depth) ──");
    for (const p of pkg.pain_types) {
      sections.push(`  • [${p.severity}/${p.painType}] ${p.painPoint}`);
      sections.push(`    Underlying cause: ${p.underlyingCause}`);
      sections.push(`    Evidence: ${p.evidence}`);
    }
  }

  if (pkg.mechanism_gaps?.length > 0) {
    sections.push("\n── MECHANISM COMPREHENSION GAPS ──");
    for (const mg of pkg.mechanism_gaps) {
      sections.push(`  • [${mg.gapSeverity}] ${mg.area}`);
      sections.push(`    User doesn't understand: ${mg.whatUserDoesNotUnderstand}`);
      sections.push(`    Why it matters: ${mg.whyItMatters}`);
      sections.push(`    Current belief: "${mg.currentPerception}" → Needs to understand: "${mg.idealPerception}"`);
    }
  }

  if (pkg.trust_gaps?.length > 0) {
    sections.push("\n── TRUST GAPS ──");
    for (const tg of pkg.trust_gaps) {
      sections.push(`  • ${tg.gap} — barrier: ${tg.barrier}`);
      sections.push(`    Trust: ${tg.currentTrustLevel} → needed: ${tg.requiredTrustLevel}`);
      sections.push(`    Proof required: ${tg.proofRequired}`);
    }
  }

  if (pkg.contradiction_flags?.length > 0) {
    sections.push("\n── CONTRADICTIONS & MISLEADING SIGNALS ──");
    for (const cf of pkg.contradiction_flags) {
      sections.push(`  • [${cf.severity}] Surface says: "${cf.surfaceSignal}"`);
      sections.push(`    Actually: ${cf.actualReality}`);
      sections.push(`    Why misleading: ${cf.whyMisleading}`);
      sections.push(`    Correct interpretation: ${cf.correctInterpretation}`);
    }
  }

  if (pkg.priority_ranking?.length > 0) {
    sections.push("\n── STRATEGIC PRIORITY (ranked by conversion impact) ──");
    for (const pr of pkg.priority_ranking.slice(0, 5)) {
      sections.push(`  ${pr.rank}. [${pr.impactOnConversion}] ${pr.insight} (${pr.dimension}, ${pr.frequency}, ${pr.actionability})`);
    }
  }

  if (pkg.confidence_notes?.length > 0) {
    sections.push("\n── DATA CONFIDENCE ──");
    for (const cn of pkg.confidence_notes) {
      sections.push(`  • [${cn.dataQuality}] ${cn.area}: ${cn.note}`);
    }
  }

  sections.push("\n═══ END DEEP ANALYTICAL CONTEXT ═══\n");

  return sections.join("\n");
}

export function getAELVersion(): number {
  return AEL_VERSION;
}
