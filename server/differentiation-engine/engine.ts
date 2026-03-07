import { aiChat } from "../ai-client";
import {
  ENGINE_VERSION,
  DIFFERENTIATION_SCORE_WEIGHTS,
  COLLISION_RISK_WEIGHTS,
  PROOFABILITY_WEIGHTS,
  AUTHORITY_MODES,
  PROOF_CATEGORIES,
  STATUS,
  MIN_TERRITORIES,
  MIN_OBJECTIONS,
  MIN_PILLAR_SCORE,
  COLLISION_THRESHOLD,
  STABILITY_MIN_PROOFABILITY,
  STABILITY_MIN_TRUST_ALIGNMENT,
} from "./constants";
import type { AuthorityMode, ProofCategory } from "./constants";
import type {
  MIInput,
  AudienceInput,
  PositioningInput,
  Territory,
  CompetitorClaim,
  ClaimCollision,
  ProofDemand,
  TrustGap,
  ProofAsset,
  MechanismCandidate,
  DifferentiationPillar,
  ClaimStructure,
  DifferentiationResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function buildEmptyResult(status: string, message: string, executionTimeMs: number): DifferentiationResult {
  return {
    status,
    statusMessage: message,
    pillars: [],
    proofArchitecture: [],
    claimStructures: [],
    authorityMode: "expert",
    authorityRationale: "",
    mechanismFraming: { name: null, description: "", supported: false, proofBasis: [], type: "none" },
    trustPriorityMap: [],
    claimScores: { averageScore: 0, highestCollision: 0, totalClaims: 0 },
    collisionDiagnostics: [],
    stabilityResult: { stable: false, failures: [message] },
    confidenceScore: 0,
    executionTimeMs,
    engineVersion: ENGINE_VERSION,
    layerDiagnostics: {},
  };
}

export function layer1_positioningIntakeLock(positioning: PositioningInput): { valid: boolean; territories: Territory[]; failures: string[] } {
  const failures: string[] = [];
  const territories = positioning.territories || [];

  if (territories.length < MIN_TERRITORIES) {
    failures.push(`Insufficient territories: ${territories.length} < ${MIN_TERRITORIES}`);
  }

  if (!positioning.stabilityResult) {
    failures.push("Positioning stability result missing");
  }

  const validTerritories = territories.filter(t => t.name && t.name.trim().length > 0);
  if (validTerritories.length === 0 && territories.length > 0) {
    failures.push("All territories have empty names");
  }

  return { valid: failures.length === 0, territories: validTerritories, failures };
}

export function layer2_competitorClaimSurfaceMapping(mi: MIInput): CompetitorClaim[] {
  const claims: CompetitorClaim[] = [];
  const contentDna = typeof mi.contentDnaData === "string" ? safeJsonParse(mi.contentDnaData) : mi.contentDnaData;

  if (contentDna && typeof contentDna === "object") {
    const competitors = Array.isArray(contentDna) ? contentDna : (contentDna.competitors || [contentDna]);
    for (const comp of competitors) {
      const hooks = comp.hooks || comp.hookStyles || [];
      const narratives = comp.narratives || comp.messagingTone || [];
      const compId = comp.competitorId || comp.id || "unknown";

      for (const hook of (Array.isArray(hooks) ? hooks : [])) {
        const hookText = typeof hook === "string" ? hook : hook?.text || hook?.hook || "";
        if (hookText.trim()) {
          claims.push({ competitorId: compId, claim: hookText, source: "hook", category: "messaging", strength: 0.6 });
        }
      }

      for (const narrative of (Array.isArray(narratives) ? narratives : [])) {
        const narText = typeof narrative === "string" ? narrative : narrative?.text || narrative?.narrative || "";
        if (narText.trim()) {
          claims.push({ competitorId: compId, claim: narText, source: "narrative", category: "positioning", strength: 0.7 });
        }
      }

      const positioning = comp.positioning || comp.detectedPositioning || "";
      if (typeof positioning === "string" && positioning.trim()) {
        claims.push({ competitorId: compId, claim: positioning, source: "positioning", category: "strategy", strength: 0.8 });
      }
    }
  }

  const diagnosis = mi.marketDiagnosis || "";
  if (diagnosis.trim()) {
    claims.push({ claim: diagnosis, source: "market_diagnosis", category: "market", strength: 0.5 });
  }

  return claims;
}

export function layer3_claimCollisionDetection(candidateClaims: string[], competitorClaims: CompetitorClaim[]): ClaimCollision[] {
  const collisions: ClaimCollision[] = [];

  for (const candidate of candidateClaims) {
    for (const comp of competitorClaims) {
      const similarity = jaccardSimilarity(candidate, comp.claim);
      const narrativeProximity = similarity * comp.strength;
      const collisionRisk = clamp(
        similarity * COLLISION_RISK_WEIGHTS.similarityToCompetitorClaims +
        narrativeProximity * COLLISION_RISK_WEIGHTS.narrativeProximity
      );

      if (collisionRisk > 0.20) {
        collisions.push({
          candidateClaim: candidate,
          competitorClaim: comp.claim,
          similarity,
          narrativeProximity,
          collisionRisk,
          competitorSource: comp.source,
        });
      }
    }
  }

  return collisions.sort((a, b) => b.collisionRisk - a.collisionRisk);
}

export function layer4_proofDemandMapping(
  audience: AudienceInput,
  territories: Territory[],
): ProofDemand[] {
  const demands: ProofDemand[] = [];
  const objections = Object.entries(audience.objectionMap || {});
  const awareness = audience.awarenessLevel || "unaware";
  const maturity = audience.maturityIndex ?? 0.5;

  const needsStrongProof = awareness === "unaware" || awareness === "problem_aware" || maturity < 0.4;
  const needsComparative = maturity > 0.6 || awareness === "solution_aware" || awareness === "product_aware";

  demands.push({
    category: "outcome_proof",
    priority: needsStrongProof ? 1.0 : 0.7,
    rationale: needsStrongProof ? "Low awareness requires visible outcomes" : "Outcome proof reinforces positioning",
    requiredFor: territories.map(t => t.name),
  });

  if (objections.length > 0) {
    demands.push({
      category: "transparency_proof",
      priority: 0.8,
      rationale: `${objections.length} objections require transparent proof`,
      requiredFor: objections.map(([k]) => k),
    });
  }

  if (needsComparative) {
    demands.push({
      category: "comparative_proof",
      priority: 0.75,
      rationale: "High maturity audience compares options",
      requiredFor: territories.map(t => t.name),
    });
  }

  demands.push({
    category: "process_proof",
    priority: 0.65,
    rationale: "Process proof builds methodology credibility",
    requiredFor: territories.slice(0, 2).map(t => t.name),
  });

  demands.push({
    category: "case_proof",
    priority: 0.60,
    rationale: "Case proof validates real-world application",
    requiredFor: territories.map(t => t.name),
  });

  if (territories.some(t => t.category === "framework" || t.name?.includes("method"))) {
    demands.push({
      category: "framework_proof",
      priority: 0.70,
      rationale: "Territory suggests framework-based differentiation",
      requiredFor: territories.filter(t => t.category === "framework").map(t => t.name),
    });
  }

  return demands.sort((a, b) => b.priority - a.priority);
}

export function layer5_trustGapPrioritization(audience: AudienceInput, territories: Territory[]): TrustGap[] {
  const gaps: TrustGap[] = [];
  const objections = Object.entries(audience.objectionMap || {});
  const territoryNames = territories.map(t => t.name.toLowerCase());

  for (const [objection, data] of objections) {
    const dataObj = typeof data === "object" && data ? data : {};
    const severity = typeof dataObj.severity === "number" ? dataObj.severity : typeof dataObj.frequency === "number" ? dataObj.frequency : 0.5;
    const relevance = territoryNames.some(t =>
      jaccardSimilarity(objection, t) > 0.15
    ) ? 0.8 : 0.4;

    gaps.push({
      objection,
      severity: clamp(severity),
      relevanceToTerritory: clamp(relevance),
      priorityRank: 0,
    });
  }

  gaps.sort((a, b) => (b.severity * b.relevanceToTerritory) - (a.severity * a.relevanceToTerritory));
  gaps.forEach((g, i) => { g.priorityRank = i + 1; });

  return gaps;
}

export function layer6_authorityModeSelection(
  positioning: PositioningInput,
  audience: AudienceInput,
  mi: MIInput,
): { mode: AuthorityMode; rationale: string } {
  const maturity = audience.maturityIndex ?? 0.5;
  const awareness = audience.awarenessLevel || "unaware";
  const flankingMode = positioning.flankingMode;
  const dominanceData = typeof mi.dominanceData === "string" ? safeJsonParse(mi.dominanceData) : mi.dominanceData;
  const hasStrongCompetitors = dominanceData && Array.isArray(dominanceData) && dominanceData.some((d: any) => d.dominanceScore > 0.7);

  if (flankingMode && hasStrongCompetitors) {
    return { mode: "contrarian_specialist", rationale: "Flanking mode against dominant competitors requires contrarian positioning" };
  }

  if (maturity > 0.7 && (awareness === "product_aware" || awareness === "most_aware")) {
    return { mode: "expert", rationale: "High-maturity, high-awareness audience values expertise" };
  }

  if (maturity < 0.3) {
    return { mode: "transparent_guide", rationale: "Low-maturity audience needs education and transparency" };
  }

  if (positioning.territories.some(t => t.name?.toLowerCase().includes("niche") || t.category === "niche")) {
    return { mode: "niche_authority", rationale: "Territory indicates niche specialization" };
  }

  if (awareness === "solution_aware") {
    return { mode: "operator", rationale: "Solution-aware audience values operational proof over thought leadership" };
  }

  return { mode: "expert", rationale: "Default authority mode for balanced audience profile" };
}

export function layer7_proofAssetArchitecture(
  proofDemands: ProofDemand[],
  trustGaps: TrustGap[],
  territories: Territory[],
): ProofAsset[] {
  const assets: ProofAsset[] = [];
  const topGaps = trustGaps.slice(0, 5);

  for (const demand of proofDemands) {
    const gapAlignment = topGaps.some(g =>
      demand.requiredFor.some(r => jaccardSimilarity(g.objection, r) > 0.10)
    ) ? 0.3 : 0;

    const territoryAlignment = territories.some(t =>
      demand.requiredFor.includes(t.name)
    ) ? 0.2 : 0;

    const feasibility = clamp(0.5 + gapAlignment + territoryAlignment);
    const impactScore = clamp(demand.priority * (0.7 + gapAlignment));

    assets.push({
      category: demand.category,
      description: demand.rationale,
      feasibility,
      impactScore,
    });
  }

  return assets.sort((a, b) => b.impactScore - a.impactScore);
}

export function layer8_mechanismConstruction(
  positioning: PositioningInput,
  proofDemands: ProofDemand[],
): MechanismCandidate {
  const hasFrameworkDemand = proofDemands.some(d => d.category === "framework_proof" || d.category === "mechanism_proof");
  const hasProcessDemand = proofDemands.some(d => d.category === "process_proof");
  const diffVector = typeof positioning.differentiationVector === "string"
    ? safeJsonParse(positioning.differentiationVector) : positioning.differentiationVector;

  const axes = Array.isArray(diffVector) ? diffVector : [];
  const hasMethodAxis = axes.some((a: any) =>
    typeof a === "string" ? a.includes("method") || a.includes("process") || a.includes("framework") :
    (a?.axis || a?.name || "").toLowerCase().match(/method|process|framework|system/)
  );

  if (hasFrameworkDemand || hasMethodAxis) {
    return {
      name: null,
      description: "Framework-based differentiation mechanism supported by proof demands and positioning axes",
      supported: true,
      proofBasis: proofDemands.filter(d => d.category === "framework_proof" || d.category === "process_proof").map(d => d.rationale),
      type: "framework",
    };
  }

  if (hasProcessDemand) {
    return {
      name: null,
      description: "Process-based differentiation supported by methodology proof demands",
      supported: true,
      proofBasis: proofDemands.filter(d => d.category === "process_proof").map(d => d.rationale),
      type: "named_process",
    };
  }

  return {
    name: null,
    description: "No unique mechanism strongly supported by current proof architecture",
    supported: false,
    proofBasis: [],
    type: "none",
  };
}

export function layer9_differentiationPillarScoring(
  territories: Territory[],
  competitorClaims: CompetitorClaim[],
  trustGaps: TrustGap[],
  proofDemands: ProofDemand[],
  audience: AudienceInput,
): DifferentiationPillar[] {
  const pillars: DifferentiationPillar[] = [];
  const objections = Object.keys(audience.objectionMap || {});

  for (const territory of territories) {
    const tName = territory.name;
    const tLower = tName.toLowerCase();

    const claimOverlap = competitorClaims.filter(c => jaccardSimilarity(c.claim, tName) > 0.15);
    const uniqueness = clamp(1 - (claimOverlap.length * 0.15));

    const relevantProof = proofDemands.filter(d => d.requiredFor.includes(tName));
    const proofability = clamp(relevantProof.length > 0 ? relevantProof.reduce((s, d) => s + d.priority, 0) / relevantProof.length : 0.3);

    const relevantGaps = trustGaps.filter(g => jaccardSimilarity(g.objection, tLower) > 0.10);
    const trustAlignment = clamp(relevantGaps.length > 0 ? relevantGaps.reduce((s, g) => s + g.relevanceToTerritory, 0) / relevantGaps.length : 0.3);

    const positioningAlignment = clamp(territory.confidenceScore || territory.opportunityScore || 0.5);

    const objectionCoverage = clamp(
      objections.filter(o => jaccardSimilarity(o, tLower) > 0.10).length / Math.max(objections.length, 1)
    );

    const overallScore = clamp(
      uniqueness * DIFFERENTIATION_SCORE_WEIGHTS.uniqueness +
      proofability * DIFFERENTIATION_SCORE_WEIGHTS.proofability +
      trustAlignment * DIFFERENTIATION_SCORE_WEIGHTS.trustAlignment +
      positioningAlignment * DIFFERENTIATION_SCORE_WEIGHTS.positioningAlignment +
      objectionCoverage * DIFFERENTIATION_SCORE_WEIGHTS.objectionCoverage
    );

    pillars.push({
      name: tName,
      description: territory.description || `Differentiation pillar based on ${tName}`,
      uniqueness,
      proofability,
      trustAlignment,
      positioningAlignment,
      objectionCoverage,
      overallScore,
      territory: tName,
      supportingProof: relevantProof.map(d => d.category),
    });
  }

  return pillars.sort((a, b) => b.overallScore - a.overallScore);
}

export function layer10_claimStrengthScoring(
  pillars: DifferentiationPillar[],
  collisions: ClaimCollision[],
  territories: Territory[],
): ClaimStructure[] {
  const claims: ClaimStructure[] = [];

  for (const pillar of pillars) {
    const pillarCollisions = collisions.filter(c =>
      jaccardSimilarity(c.candidateClaim, pillar.name) > 0.15
    );
    const maxCollision = pillarCollisions.length > 0 ? Math.max(...pillarCollisions.map(c => c.collisionRisk)) : 0;

    const distinctiveness = clamp(pillar.uniqueness * (1 - maxCollision));
    const believability = clamp(pillar.proofability * pillar.trustAlignment);
    const defensibility = clamp(pillar.proofability * (1 - maxCollision * 0.5));
    const relevance = clamp(pillar.positioningAlignment * pillar.objectionCoverage + 0.3);

    const overallScore = clamp(
      distinctiveness * 0.30 + believability * 0.25 + defensibility * 0.25 + relevance * 0.20
    );

    claims.push({
      claim: `${pillar.name}: ${pillar.description}`,
      territory: pillar.territory,
      distinctiveness,
      believability,
      defensibility,
      relevance,
      overallScore,
      collisionRisk: maxCollision,
      proofBasis: pillar.supportingProof,
    });
  }

  return claims.sort((a, b) => b.overallScore - a.overallScore);
}

export async function layer11_aiRefinement(
  pillars: DifferentiationPillar[],
  claims: ClaimStructure[],
  mechanism: MechanismCandidate,
  authorityMode: AuthorityMode,
  accountId: string,
): Promise<{ refinedPillars: DifferentiationPillar[]; refinedClaims: ClaimStructure[]; refinedMechanism: MechanismCandidate }> {
  const topPillars = pillars.slice(0, 5);
  const topClaims = claims.slice(0, 5);

  const prompt = `You are refining differentiation language. You must ONLY improve wording clarity and impact.

STRICT RULES:
- Do NOT invent new strategy, audience segments, offers, or execution plans
- Do NOT change the meaning or direction of any pillar or claim
- Do NOT add pricing, packaging, guarantees, CTAs, or channel recommendations
- ONLY refine the language to be clearer, more distinctive, and more compelling
- Respond with ONLY valid JSON, no markdown

Input pillars:
${JSON.stringify(topPillars.map(p => ({ name: p.name, description: p.description })), null, 2)}

Input claims:
${JSON.stringify(topClaims.map(c => ({ claim: c.claim, territory: c.territory })), null, 2)}

Mechanism: ${mechanism.description}
Authority mode: ${authorityMode}

Return JSON:
{
  "pillars": [{ "name": "refined name", "description": "refined description" }],
  "claims": [{ "claim": "refined claim text" }],
  "mechanismDescription": "refined mechanism description"
}`;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You refine differentiation language only. Never invent strategy, audience, offers, channels, or execution plans." },
        { role: "user", content: prompt },
      ],
      accountId,
      endpoint: "differentiation-refinement",
    });

    const rawText = typeof response === "string" ? response : response?.choices?.[0]?.message?.content || "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in AI response");
    const parsed = JSON.parse(jsonMatch[0]);

    const refinedPillars = topPillars.map((p, i) => {
      const refined = parsed.pillars?.[i];
      if (!refined) return p;
      if (sanitizeGuardrail(refined.name) || sanitizeGuardrail(refined.description)) return p;
      return { ...p, name: refined.name || p.name, description: refined.description || p.description };
    });

    const refinedClaims = topClaims.map((c, i) => {
      const refined = parsed.claims?.[i];
      if (!refined) return c;
      if (sanitizeGuardrail(refined.claim)) return c;
      return { ...c, claim: refined.claim || c.claim };
    });

    const refinedMechanism = { ...mechanism };
    if (parsed.mechanismDescription && !sanitizeGuardrail(parsed.mechanismDescription)) {
      refinedMechanism.description = parsed.mechanismDescription;
    }

    return {
      refinedPillars: [...refinedPillars, ...pillars.slice(5)],
      refinedClaims: [...refinedClaims, ...claims.slice(5)],
      refinedMechanism,
    };
  } catch (err: any) {
    console.warn(`[DifferentiationEngine] AI refinement failed, using unrefined output: ${err.message}`);
    return { refinedPillars: pillars, refinedClaims: claims, refinedMechanism: mechanism };
  }
}

export function sanitizeGuardrail(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  const offerPatterns = /\b(pricing|price point|guarantee|bonus|discount|package|bundle|upsell|downsell|free trial|money.back)\b/;
  const channelPatterns = /\b(instagram|facebook|tiktok|linkedin|youtube|reels|stories|carousel|ad campaign|media buy|content calendar|posting schedule)\b/;
  const audiencePatterns = /\b(new segment|new persona|audience definition|target demographic|age group \d)/;
  const copyPatterns = /\b(ad copy|landing page|email sequence|sales page|headline:\s|body copy|cta button)\b/;

  return offerPatterns.test(lower) || channelPatterns.test(lower) || audiencePatterns.test(lower) || copyPatterns.test(lower);
}

export function layer12_stabilityGuard(
  pillars: DifferentiationPillar[],
  claims: ClaimStructure[],
  collisions: ClaimCollision[],
  territories: Territory[],
): { stable: boolean; failures: string[] } {
  const failures: string[] = [];
  const territoryNames = new Set(territories.map(t => t.name));

  for (const pillar of pillars) {
    if (!territoryNames.has(pillar.territory)) {
      failures.push(`Pillar "${pillar.name}" references territory "${pillar.territory}" not in approved territories`);
    }
  }

  const highCollisions = collisions.filter(c => c.collisionRisk >= COLLISION_THRESHOLD);
  if (highCollisions.length > 0) {
    failures.push(`${highCollisions.length} claim(s) exceed collision threshold (≥${COLLISION_THRESHOLD})`);
  }

  const avgProofability = pillars.length > 0 ? pillars.reduce((s, p) => s + p.proofability, 0) / pillars.length : 0;
  if (avgProofability < STABILITY_MIN_PROOFABILITY) {
    failures.push(`Average proofability (${avgProofability.toFixed(2)}) below threshold (${STABILITY_MIN_PROOFABILITY})`);
  }

  const avgTrustAlignment = pillars.length > 0 ? pillars.reduce((s, p) => s + p.trustAlignment, 0) / pillars.length : 0;
  if (avgTrustAlignment < STABILITY_MIN_TRUST_ALIGNMENT) {
    failures.push(`Average trust alignment (${avgTrustAlignment.toFixed(2)}) below threshold (${STABILITY_MIN_TRUST_ALIGNMENT})`);
  }

  const weakClaims = claims.filter(c => c.overallScore < MIN_PILLAR_SCORE);
  if (weakClaims.length === claims.length && claims.length > 0) {
    failures.push(`All claims below minimum score threshold (${MIN_PILLAR_SCORE})`);
  }

  return { stable: failures.length === 0, failures };
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}

export async function runDifferentiationEngine(
  mi: MIInput,
  audience: AudienceInput,
  positioning: PositioningInput,
  accountId: string,
): Promise<DifferentiationResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  console.log(`[DifferentiationEngine-V3] Starting 12-layer pipeline`);

  const l1 = layer1_positioningIntakeLock(positioning);
  diagnostics.layer1 = { valid: l1.valid, territoryCount: l1.territories.length, failures: l1.failures };
  if (!l1.valid) {
    console.log(`[DifferentiationEngine-V3] Layer 1 FAILED: ${l1.failures.join(", ")}`);
    return buildEmptyResult(STATUS.MISSING_DEPENDENCY, `Positioning intake failed: ${l1.failures.join("; ")}`, Date.now() - startTime);
  }

  const objectionCount = Object.keys(audience.objectionMap || {}).length;
  if (objectionCount < MIN_OBJECTIONS) {
    console.log(`[DifferentiationEngine-V3] Insufficient signals: ${objectionCount} objections < ${MIN_OBJECTIONS}`);
    return buildEmptyResult(STATUS.INSUFFICIENT_SIGNALS, `Insufficient audience signals: ${objectionCount} objections`, Date.now() - startTime);
  }

  const l2Claims = layer2_competitorClaimSurfaceMapping(mi);
  diagnostics.layer2 = { claimCount: l2Claims.length };

  const candidateClaims = l1.territories.map(t => t.name);
  const l3Collisions = layer3_claimCollisionDetection(candidateClaims, l2Claims);
  diagnostics.layer3 = { collisionCount: l3Collisions.length, highRisk: l3Collisions.filter(c => c.collisionRisk >= COLLISION_THRESHOLD).length };

  const l4ProofDemands = layer4_proofDemandMapping(audience, l1.territories);
  diagnostics.layer4 = { proofDemandCount: l4ProofDemands.length };

  const l5TrustGaps = layer5_trustGapPrioritization(audience, l1.territories);
  diagnostics.layer5 = { trustGapCount: l5TrustGaps.length };

  const l6Authority = layer6_authorityModeSelection(positioning, audience, mi);
  diagnostics.layer6 = { mode: l6Authority.mode, rationale: l6Authority.rationale };

  const l7ProofAssets = layer7_proofAssetArchitecture(l4ProofDemands, l5TrustGaps, l1.territories);
  diagnostics.layer7 = { assetCount: l7ProofAssets.length };

  const l8Mechanism = layer8_mechanismConstruction(positioning, l4ProofDemands);
  diagnostics.layer8 = { supported: l8Mechanism.supported, type: l8Mechanism.type };

  const l9Pillars = layer9_differentiationPillarScoring(l1.territories, l2Claims, l5TrustGaps, l4ProofDemands, audience);
  diagnostics.layer9 = { pillarCount: l9Pillars.length, topScore: l9Pillars[0]?.overallScore ?? 0 };

  const l10Claims = layer10_claimStrengthScoring(l9Pillars, l3Collisions, l1.territories);
  diagnostics.layer10 = { claimCount: l10Claims.length, avgScore: l10Claims.length > 0 ? l10Claims.reduce((s, c) => s + c.overallScore, 0) / l10Claims.length : 0 };

  let finalPillars = l9Pillars;
  let finalClaims = l10Claims;
  let finalMechanism = l8Mechanism;

  try {
    const l11 = await layer11_aiRefinement(l9Pillars, l10Claims, l8Mechanism, l6Authority.mode, accountId);
    finalPillars = l11.refinedPillars;
    finalClaims = l11.refinedClaims;
    finalMechanism = l11.refinedMechanism;
    diagnostics.layer11 = { aiRefined: true };
  } catch (err: any) {
    diagnostics.layer11 = { aiRefined: false, error: err.message };
  }

  finalPillars = finalPillars.map(p => ({
    ...p,
    name: sanitizeGuardrail(p.name) ? p.territory : p.name,
    description: sanitizeGuardrail(p.description) ? `Differentiation pillar based on ${p.territory}` : p.description,
  }));
  finalClaims = finalClaims.map(c => ({
    ...c,
    claim: sanitizeGuardrail(c.claim) ? `${c.territory}: differentiation claim` : c.claim,
  }));
  if (sanitizeGuardrail(finalMechanism.description)) {
    finalMechanism = { ...finalMechanism, description: "Mechanism description redacted — guardrail violation" };
  }

  const l12Stability = layer12_stabilityGuard(finalPillars, finalClaims, l3Collisions, l1.territories);
  diagnostics.layer12 = { stable: l12Stability.stable, failures: l12Stability.failures };

  const allHighCollision = l3Collisions.every(c => c.collisionRisk >= COLLISION_THRESHOLD) && l3Collisions.length > 0;
  const highCollisionCount = l3Collisions.filter(c => c.collisionRisk >= COLLISION_THRESHOLD).length;

  let status = STATUS.COMPLETE;
  let statusMessage: string | null = null;

  if (allHighCollision && l3Collisions.length >= l1.territories.length) {
    status = STATUS.COLLISION_RISK;
    statusMessage = `All differentiation claims have high collision risk with competitor claims`;
  } else if (!l12Stability.stable) {
    status = STATUS.UNSTABLE;
    statusMessage = `Stability check failed: ${l12Stability.failures.join("; ")}`;
  }

  const avgClaimScore = finalClaims.length > 0 ? finalClaims.reduce((s, c) => s + c.overallScore, 0) / finalClaims.length : 0;
  const confidenceScore = clamp(avgClaimScore * (l12Stability.stable ? 1 : 0.6));

  console.log(`[DifferentiationEngine-V3] Complete | status=${status} | pillars=${finalPillars.length} | claims=${finalClaims.length} | confidence=${confidenceScore.toFixed(2)} | stable=${l12Stability.stable} | collisions=${highCollisionCount}`);

  return {
    status,
    statusMessage,
    pillars: finalPillars,
    proofArchitecture: l7ProofAssets,
    claimStructures: finalClaims,
    authorityMode: l6Authority.mode,
    authorityRationale: l6Authority.rationale,
    mechanismFraming: finalMechanism,
    trustPriorityMap: l5TrustGaps,
    claimScores: {
      averageScore: avgClaimScore,
      highestCollision: l3Collisions.length > 0 ? Math.max(...l3Collisions.map(c => c.collisionRisk)) : 0,
      totalClaims: finalClaims.length,
    },
    collisionDiagnostics: l3Collisions,
    stabilityResult: l12Stability,
    confidenceScore,
    executionTimeMs: Date.now() - startTime,
    engineVersion: ENGINE_VERSION,
    layerDiagnostics: diagnostics,
  };
}
