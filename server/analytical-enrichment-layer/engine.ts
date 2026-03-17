import { aiChat } from "../ai-client";
import {
  AnalyticalPackage,
  AELInput,
  EMPTY_ANALYTICAL_PACKAGE,
} from "./types";

const LOG_PREFIX = "[AEL]";
const AEL_VERSION = 1;

function buildInputSummary(input: AELInput) {
  const hasMI = !!(input.mi && (input.mi.signalClusters || input.mi.marketState || input.mi.signals));
  const hasAudience = !!(input.audience && (input.audience.painMap || input.audience.pains || input.audience.segments));
  const hasProductDNA = !!(input.productDNA && input.productDNA.coreOffer);
  const hasCompetitiveData = !!(input.competitiveData && (input.competitiveData.competitors?.length > 0 || input.competitiveData.posts?.length > 0));

  let signalCount = 0;
  if (input.mi?.signalClusters) signalCount += input.mi.signalClusters.length;
  if (input.mi?.signals) signalCount += input.mi.signals.length;

  return { hasMI, hasAudience, hasProductDNA, hasCompetitiveData, signalCount };
}

function buildContextBlock(input: AELInput): string {
  const sections: string[] = [];

  if (input.mi) {
    const mi = input.mi;
    sections.push("=== MARKET INTELLIGENCE ===");
    if (mi.marketState) sections.push(`Market State: ${JSON.stringify(mi.marketState).slice(0, 800)}`);
    if (mi.signalClusters) sections.push(`Signal Clusters (${mi.signalClusters.length}): ${JSON.stringify(mi.signalClusters.slice(0, 5)).slice(0, 1200)}`);
    if (mi.trajectoryData) sections.push(`Trajectory: ${JSON.stringify(mi.trajectoryData).slice(0, 600)}`);
    if (mi.intentData) sections.push(`Intent Signals: ${JSON.stringify(mi.intentData).slice(0, 600)}`);
    if (mi.narrativeObjections) sections.push(`Market Objections: ${JSON.stringify(mi.narrativeObjections).slice(0, 600)}`);
    if (mi.dominanceData) sections.push(`Competitive Dominance: ${JSON.stringify(mi.dominanceData).slice(0, 600)}`);
  }

  if (input.audience) {
    const aud = input.audience;
    sections.push("\n=== AUDIENCE INSIGHTS ===");
    if (aud.painMap || aud.pains) sections.push(`Pain Map: ${JSON.stringify(aud.painMap || aud.pains).slice(0, 800)}`);
    if (aud.desireMap || aud.desires) sections.push(`Desire Map: ${JSON.stringify(aud.desireMap || aud.desires).slice(0, 800)}`);
    if (aud.objectionMap || aud.objections) sections.push(`Objection Map: ${JSON.stringify(aud.objectionMap || aud.objections).slice(0, 600)}`);
    if (aud.awarenessLevel) sections.push(`Awareness Level: ${JSON.stringify(aud.awarenessLevel)}`);
    if (aud.segments || aud.audienceSegments) sections.push(`Segments: ${JSON.stringify(aud.segments || aud.audienceSegments).slice(0, 600)}`);
    if (aud.maturityIndex) sections.push(`Maturity Index: ${JSON.stringify(aud.maturityIndex)}`);
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
    if (ci.competitors) sections.push(`Competitors (${ci.competitors.length}): ${JSON.stringify(ci.competitors.slice(0, 3)).slice(0, 600)}`);
    if (ci.posts) sections.push(`Competitor Posts (${ci.posts.length} total, sample): ${JSON.stringify(ci.posts.slice(0, 3)).slice(0, 600)}`);
  }

  return sections.join("\n");
}

export async function buildAnalyticalPackage(input: AELInput): Promise<AnalyticalPackage> {
  const startTime = Date.now();
  const inputSummary = buildInputSummary(input);

  console.log(`${LOG_PREFIX} BUILD_START | campaign=${input.campaignId} | hasMI=${inputSummary.hasMI} | hasAudience=${inputSummary.hasAudience} | hasProductDNA=${inputSummary.hasProductDNA} | hasCI=${inputSummary.hasCompetitiveData} | signals=${inputSummary.signalCount}`);

  if (!inputSummary.hasMI && !inputSummary.hasAudience) {
    console.log(`${LOG_PREFIX} SKIP | No MI or Audience data available — returning empty package`);
    return { ...EMPTY_ANALYTICAL_PACKAGE, generatedAt: new Date().toISOString(), inputSummary };
  }

  const contextBlock = buildContextBlock(input);

  const systemPrompt = `You are an Analytical Enrichment Layer (AEL) — a precision analysis tool.

YOUR ROLE:
- Analyze raw market intelligence, audience insights, product DNA, and competitive data
- Produce STRUCTURED ANALYTICAL CONTEXT that helps downstream engines make better decisions
- You do NOT make strategic decisions yourself

STRICT RULES:
- Do NOT generate positioning statements, offer copy, funnel designs, or messaging
- Do NOT say "the positioning should be..." or "the offer should include..."
- ONLY produce analytical observations, patterns, gaps, and candidates for deeper investigation
- Every insight must cite which input data supports it

OUTPUT FORMAT (strict JSON):
{
  "root_cause_candidates": [{"claim": "...", "sourceEngine": "MI|Audience|ProductDNA|CI", "evidence": "specific data point", "confidenceLevel": "high|medium|low"}],
  "pain_type_map": [{"painPoint": "...", "painType": "functional|emotional|social|financial|identity", "severity": "critical|moderate|minor", "evidence": "..."}],
  "trust_gap_map": [{"gap": "...", "barrier": "what prevents trust", "currentTrustLevel": "none|low|moderate|high", "requiredTrustLevel": "low|moderate|high|very_high"}],
  "mechanism_gap_hints": [{"area": "...", "currentState": "what exists now", "idealState": "what would close the gap", "gapSeverity": "critical|moderate|minor"}],
  "proof_need_hints": [{"claim": "claim that needs proof", "proofType": "testimonial|data|demonstration|authority|social", "urgency": "immediate|important|nice_to_have"}],
  "strategic_angle_candidates": [{"angle": "...", "rationale": "why this angle has potential", "targetSegment": "who this appeals to", "differentiationPotential": "high|medium|low"}],
  "contradiction_flags": [{"element1": "...", "element2": "...", "nature": "description of contradiction", "severity": "blocking|concerning|minor"}],
  "confidence_notes": [{"area": "...", "note": "observation about data quality/coverage", "dataQuality": "strong|adequate|weak|insufficient"}]
}

QUALITY REQUIREMENTS:
- Be SPECIFIC, not generic. "Users want simplicity" is BAD. "73% of competitor comments mention frustration with multi-step onboarding (avg 5.2 steps)" is GOOD.
- Cite actual numbers, patterns, and data points from the input
- Each array should have 3-8 entries based on data richness
- If data is insufficient for a category, return an empty array — never fabricate`;

  const userPrompt = `Analyze the following upstream data and produce a structured analytical package.

${contextBlock}

Return ONLY valid JSON matching the specified format. No markdown, no explanation, no strategy recommendations.`;

  try {
    const response = await aiChat({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 3000,
      temperature: 0.3,
    });

    const content = response.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`${LOG_PREFIX} PARSE_FAIL | No JSON found in response`);
      return { ...EMPTY_ANALYTICAL_PACKAGE, generatedAt: new Date().toISOString(), inputSummary };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const elapsed = Date.now() - startTime;

    const pkg: AnalyticalPackage = {
      root_cause_candidates: parsed.root_cause_candidates || [],
      pain_type_map: parsed.pain_type_map || [],
      trust_gap_map: parsed.trust_gap_map || [],
      mechanism_gap_hints: parsed.mechanism_gap_hints || [],
      proof_need_hints: parsed.proof_need_hints || [],
      strategic_angle_candidates: parsed.strategic_angle_candidates || [],
      contradiction_flags: parsed.contradiction_flags || [],
      confidence_notes: parsed.confidence_notes || [],
      generatedAt: new Date().toISOString(),
      inputSummary,
    };

    console.log(`${LOG_PREFIX} BUILD_COMPLETE | campaign=${input.campaignId} | elapsed=${elapsed}ms | rootCauses=${pkg.root_cause_candidates.length} | pains=${pkg.pain_type_map.length} | trustGaps=${pkg.trust_gap_map.length} | mechGaps=${pkg.mechanism_gap_hints.length} | proofNeeds=${pkg.proof_need_hints.length} | angles=${pkg.strategic_angle_candidates.length} | contradictions=${pkg.contradiction_flags.length} | confidenceNotes=${pkg.confidence_notes.length}`);

    return pkg;
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.warn(`${LOG_PREFIX} BUILD_ERROR | campaign=${input.campaignId} | elapsed=${elapsed}ms | error=${err.message}`);
    return { ...EMPTY_ANALYTICAL_PACKAGE, generatedAt: new Date().toISOString(), inputSummary };
  }
}

export function formatAELForPrompt(pkg: AnalyticalPackage | null): string {
  if (!pkg) return "";
  const totalInsights =
    pkg.root_cause_candidates.length +
    pkg.pain_type_map.length +
    pkg.trust_gap_map.length +
    pkg.mechanism_gap_hints.length +
    pkg.proof_need_hints.length +
    pkg.strategic_angle_candidates.length;

  if (totalInsights === 0) return "";

  const sections: string[] = [];
  sections.push("\n═══ ANALYTICAL ENRICHMENT CONTEXT (for depth, NOT for final decisions) ═══");
  sections.push("USE these insights to DEEPEN your analysis. Do NOT copy them as outputs.");
  sections.push("Your engine logic remains the sole decision-maker.\n");

  if (pkg.root_cause_candidates.length > 0) {
    sections.push("── Root-Cause Candidates ──");
    for (const rc of pkg.root_cause_candidates) {
      sections.push(`  • [${rc.confidenceLevel}] ${rc.claim} (source: ${rc.sourceEngine}, evidence: ${rc.evidence})`);
    }
  }

  if (pkg.pain_type_map.length > 0) {
    sections.push("── Pain Type Map ──");
    for (const p of pkg.pain_type_map) {
      sections.push(`  • [${p.severity}/${p.painType}] ${p.painPoint} (evidence: ${p.evidence})`);
    }
  }

  if (pkg.trust_gap_map.length > 0) {
    sections.push("── Trust Gap Map ──");
    for (const tg of pkg.trust_gap_map) {
      sections.push(`  • ${tg.gap} — barrier: ${tg.barrier} (current: ${tg.currentTrustLevel} → needed: ${tg.requiredTrustLevel})`);
    }
  }

  if (pkg.mechanism_gap_hints.length > 0) {
    sections.push("── Mechanism Gap Hints ──");
    for (const mg of pkg.mechanism_gap_hints) {
      sections.push(`  • [${mg.gapSeverity}] ${mg.area}: "${mg.currentState}" → "${mg.idealState}"`);
    }
  }

  if (pkg.proof_need_hints.length > 0) {
    sections.push("── Proof Need Hints ──");
    for (const pn of pkg.proof_need_hints) {
      sections.push(`  • [${pn.urgency}/${pn.proofType}] "${pn.claim}"`);
    }
  }

  if (pkg.strategic_angle_candidates.length > 0) {
    sections.push("── Strategic Angle Candidates ──");
    for (const sa of pkg.strategic_angle_candidates) {
      sections.push(`  • [${sa.differentiationPotential}] ${sa.angle} — ${sa.rationale} (target: ${sa.targetSegment})`);
    }
  }

  if (pkg.contradiction_flags.length > 0) {
    sections.push("── Contradiction Flags ──");
    for (const cf of pkg.contradiction_flags) {
      sections.push(`  • [${cf.severity}] "${cf.element1}" vs "${cf.element2}" — ${cf.nature}`);
    }
  }

  if (pkg.confidence_notes.length > 0) {
    sections.push("── Confidence Notes ──");
    for (const cn of pkg.confidence_notes) {
      sections.push(`  • [${cn.dataQuality}] ${cn.area}: ${cn.note}`);
    }
  }

  sections.push("\n═══ END ANALYTICAL ENRICHMENT ═══\n");

  return sections.join("\n");
}

export function getAELVersion(): number {
  return AEL_VERSION;
}
