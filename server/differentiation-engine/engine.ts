import { aiChat } from "../ai-client";
import { formatAELForPrompt } from "../analytical-enrichment-layer/engine";
import {
  buildCausalDirectiveForPrompt,
  enforceEngineDepthCompliance,
  applyDepthPenalty,
  isDepthBlocking,
  buildDepthRejectionDirective,
  buildDepthGateResult,
  DEPTH_GATE_MAX_RETRIES,
  type DepthGateResult,
  type DepthComplianceResult,
} from "../causal-enforcement-layer/engine";
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
  BOUNDARY_HARD_PATTERNS,
  BOUNDARY_SOFT_PATTERNS,
  SIGNAL_WEIGHTS,
  SOFT_FAILURE_PROOFABILITY,
  SOFT_FAILURE_TRUST_ALIGNMENT,
} from "./constants";
import {
  enforceBoundaryWithSanitization,
  applySoftSanitization,
  assessDataReliability,
  normalizeConfidence,
  detectGenericOutput,
  type DataReliabilityDiagnostics,
} from "../engine-hardening";
import type { AuthorityMode, ProofCategory } from "./constants";
import type {
  MIInput,
  AudienceInput,
  PositioningInput,
  ProfileInput,
  ProfileSignals,
  Territory,
  CompetitorClaim,
  ClaimCollision,
  ProofDemand,
  TrustGap,
  ProofAsset,
  MechanismCandidate,
  MechanismCore,
  DifferentiationPillar,
  ClaimStructure,
  DifferentiationResult,
} from "./types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

const OBJECTION_DERIVATION_PATTERNS: { painPattern: RegExp; objection: string }[] = [
  { painPattern: /\b(low growth|no growth|slow growth|stagnant|plateau)\b/i, objection: "This solution will not actually improve growth results" },
  { painPattern: /\b(lack of trust|trust issue|credib|skeptic|doubt)\b/i, objection: "This provider may not be credible or trustworthy" },
  { painPattern: /\b(too expensive|cost|price|budget|afford)\b/i, objection: "The cost may not justify the expected return" },
  { painPattern: /\b(complexity|complicated|confus|overwhelm|difficult)\b/i, objection: "This solution may be too complex to implement effectively" },
  { painPattern: /\b(time|slow|takes too long|wait|delay)\b/i, objection: "Results may take too long to materialize" },
  { painPattern: /\b(generic|same|commodity|undifferentiat|cookie.?cutter)\b/i, objection: "This looks like every other solution on the market" },
  { painPattern: /\b(control|autonom|lock.?in|depend)\b/i, objection: "This solution may create unwanted dependency or loss of control" },
  { painPattern: /\b(scale|capacity|limit|bottleneck)\b/i, objection: "This approach may not scale with business growth" },
  { painPattern: /\b(risk|fail|uncertain|gamble|unproven)\b/i, objection: "The risk of failure outweighs the potential benefit" },
  { painPattern: /\b(quality|inconsisten|unreliable|hit.?or.?miss)\b/i, objection: "Quality and consistency of results cannot be guaranteed" },
];

function deriveObjectionsFromAudienceData(audience: AudienceInput): Record<string, any> {
  const derived: Record<string, any> = {};

  const existingObjections = audience.objectionMap || {};
  for (const [k, v] of Object.entries(existingObjections)) {
    derived[k] = v;
  }

  const pains = Array.isArray(audience.audiencePains) ? audience.audiencePains : [];
  const painTexts: string[] = pains.map((p: any) => {
    if (typeof p === "string") return p;
    return p.canonical || p.pain || p.description || p.text || "";
  }).filter(Boolean);

  for (const painText of painTexts) {
    for (const { painPattern, objection } of OBJECTION_DERIVATION_PATTERNS) {
      if (painPattern.test(painText) && !derived[objection]) {
        derived[objection] = { frequency: 0.5, severity: 0.5, source: "derived_from_pain", originalPain: painText };
      }
    }
  }

  const emotionalDrivers = Array.isArray(audience.emotionalDrivers) ? audience.emotionalDrivers : [];
  for (const driver of emotionalDrivers) {
    const driverText = typeof driver === "string" ? driver : driver.driver || driver.text || driver.name || "";
    if (!driverText) continue;
    const lower = driverText.toLowerCase();
    if (/\b(fear|anxiety|worry|concern|hesitat|reluct)\b/.test(lower) && !derived[driverText]) {
      derived[`Hesitation: ${driverText}`] = { frequency: 0.4, severity: 0.4, source: "derived_from_emotion" };
    }
  }

  const desireEntries = Array.isArray(audience.desireMap) ? audience.desireMap : Object.entries(audience.desireMap || {});
  for (const entry of desireEntries) {
    const desireText = typeof entry === "string" ? entry :
      Array.isArray(entry) ? String(entry[0]) :
      (entry as any).canonical || (entry as any).desire || "";
    if (!desireText) continue;
    const lower = desireText.toLowerCase();
    if (/\b(proven|guarantee|evidence|certainty|assurance)\b/.test(lower)) {
      const obj = `Demand for proof: ${desireText}`;
      if (!derived[obj]) {
        derived[obj] = { frequency: 0.5, severity: 0.5, source: "derived_from_desire" };
      }
    }
  }

  if (Object.keys(derived).length < 2 && painTexts.length > 0) {
    for (let i = 0; i < Math.min(2, painTexts.length) && Object.keys(derived).length < 2; i++) {
      const fallback = `Concern about: ${painTexts[i]}`;
      if (!derived[fallback]) {
        derived[fallback] = { frequency: 0.3, severity: 0.3, source: "synthetic_fallback" };
      }
    }
  }

  if (Object.keys(derived).length < 2) {
    const defaults = [
      "This solution may not deliver on its promises",
      "The approach may not be suitable for my specific situation",
    ];
    for (const d of defaults) {
      if (Object.keys(derived).length >= 2) break;
      if (!derived[d]) {
        derived[d] = { frequency: 0.2, severity: 0.2, source: "synthetic_baseline" };
      }
    }
  }

  return derived;
}

export function extractProfileSignals(profile: ProfileInput | null): ProfileSignals {
  if (!profile) {
    return { claimTokens: new Set(), offerTokens: new Set(), audienceTokens: new Set(), strategyTokens: new Set(), signalCount: 0, hasProfile: false };
  }

  const tokenizeProfile = (text: string | null): string[] => {
    if (!text) return [];
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2);
  };

  const offerTokens = new Set([
    ...tokenizeProfile(profile.coreOffer),
    ...tokenizeProfile(profile.coreProblemSolved),
    ...tokenizeProfile(profile.uniqueMechanism),
  ]);
  const audienceTokens = new Set([
    ...tokenizeProfile(profile.targetAudienceSegment),
    ...tokenizeProfile(profile.targetAudienceAge),
    ...tokenizeProfile(profile.targetDecisionMaker),
  ]);
  const strategyTokens = new Set([
    ...tokenizeProfile(profile.funnelObjective),
    ...tokenizeProfile(profile.goalDescription),
    ...tokenizeProfile(profile.priceRange),
    ...tokenizeProfile(profile.strategicAdvantage),
  ]);
  const claimTokens = new Set([
    ...tokenizeProfile(profile.businessType),
    ...tokenizeProfile(profile.coreOffer),
    ...tokenizeProfile(profile.businessLocation),
    ...tokenizeProfile(profile.productCategory),
  ]);

  const signalCount = offerTokens.size + audienceTokens.size + strategyTokens.size + claimTokens.size;

  return { claimTokens, offerTokens, audienceTokens, strategyTokens, signalCount, hasProfile: signalCount > 0 };
}

function computeProfileGroundingScore(
  territoryName: string,
  profileSignals: ProfileSignals,
): number {
  if (!profileSignals.hasProfile) return 0;

  const tTokens = new Set(territoryName.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
  if (tTokens.size === 0) return 0;

  let matchCount = 0;
  const allProfileTokens = new Set([
    ...profileSignals.claimTokens,
    ...profileSignals.offerTokens,
    ...profileSignals.audienceTokens,
    ...profileSignals.strategyTokens,
  ]);

  for (const t of tTokens) {
    if (allProfileTokens.has(t)) matchCount++;
  }

  const directMatch = tTokens.size > 0 ? matchCount / tTokens.size : 0;

  let semanticBoost = 0;
  const tLower = territoryName.toLowerCase();
  for (const token of profileSignals.offerTokens) {
    if (tLower.includes(token) && token.length > 3) { semanticBoost += 0.1; break; }
  }
  for (const token of profileSignals.strategyTokens) {
    if (tLower.includes(token) && token.length > 3) { semanticBoost += 0.05; break; }
  }

  return clamp(directMatch + semanticBoost);
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
    mechanismCore: { mechanismName: "", mechanismType: "none", mechanismSteps: [], mechanismPromise: "", mechanismProblem: "", mechanismLogic: "" },
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

  const multiSource = typeof mi.multiSourceSignals === "string" ? safeJsonParse(mi.multiSourceSignals) : mi.multiSourceSignals;
  if (multiSource && typeof multiSource === "object") {
    for (const [compId, compData] of Object.entries(multiSource as Record<string, any>)) {
      if (compData?.website) {
        for (const headline of (compData.website.headlineExtractions || []).slice(0, 5)) {
          claims.push({ competitorId: compId, claim: headline, source: "website_headline", category: "positioning", strength: 0.85 });
        }
        for (const offer of (compData.website.offerStructure || []).slice(0, 3)) {
          claims.push({ competitorId: compId, claim: offer, source: "website_offer", category: "offer", strength: 0.8 });
        }
        for (const proof of (compData.website.proofStructure || []).slice(0, 3)) {
          claims.push({ competitorId: compId, claim: proof, source: "website_proof", category: "proof", strength: 0.75 });
        }
      }
    }
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
  claims?: ClaimStructure[],
  pillars?: DifferentiationPillar[],
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

  const validatedClaimCount = claims ? claims.filter(c => c.overallScore >= MIN_PILLAR_SCORE).length : 0;
  const avgProofability = pillars && pillars.length > 0
    ? pillars.reduce((s, p) => s + p.proofability, 0) / pillars.length : 0;
  const hasStructuralSupport = validatedClaimCount >= 2 && avgProofability >= 0.50;

  if ((hasFrameworkDemand || hasMethodAxis) && hasStructuralSupport) {
    return {
      name: null,
      description: "Framework-based differentiation mechanism supported by proof demands and positioning axes",
      supported: true,
      proofBasis: proofDemands.filter(d => d.category === "framework_proof" || d.category === "process_proof").map(d => d.rationale),
      type: "framework",
    };
  }

  if (hasProcessDemand && hasStructuralSupport) {
    return {
      name: null,
      description: "Process-based differentiation supported by methodology proof demands",
      supported: true,
      proofBasis: proofDemands.filter(d => d.category === "process_proof").map(d => d.rationale),
      type: "named_process",
    };
  }

  if (hasFrameworkDemand || hasMethodAxis || hasProcessDemand) {
    return {
      name: null,
      description: "Differentiation direction identified but insufficient structural support for formal mechanism framing",
      supported: false,
      proofBasis: proofDemands.filter(d => d.category === "process_proof" || d.category === "framework_proof").map(d => d.rationale),
      type: "none",
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

const ACTION_VERBS = [
  "identify", "build", "deploy", "analyze", "map", "extract", "validate",
  "optimize", "transform", "implement", "assess", "design", "construct",
  "evaluate", "integrate", "measure", "execute", "diagnose", "calibrate",
  "audit", "prioritize", "activate", "align", "resolve", "structure",
  "sequence", "test", "refine", "synthesize", "accelerate", "consolidate",
  "differentiate", "establish", "formulate", "generate", "leverage",
  "mobilize", "orchestrate", "penetrate", "quantify", "reconfigure",
  "segment", "systematize", "uncover", "verify",
];

const THEME_ONLY_PATTERN = /^[A-Za-z\s]+\s+(approach|method|system|framework|protocol|strategy|model|process)$/i;

export function validateMechanismIsTransformation(core: MechanismCore): { valid: boolean; failures: string[] } {
  const failures: string[] = [];

  if (THEME_ONLY_PATTERN.test(core.mechanismName.trim())) {
    const words = core.mechanismName.trim().split(/\s+/);
    const hasVerb = words.some(w => ACTION_VERBS.includes(w.toLowerCase()));
    if (!hasVerb) {
      failures.push(`mechanismName "${core.mechanismName}" is a theme label (noun + type) with no operational verb or process language`);
    }
  }

  if (core.mechanismSteps.length === 0) {
    failures.push("mechanismSteps is empty — no transformation steps defined");
  } else {
    const stepsWithoutActionVerbs = core.mechanismSteps.filter(step => {
      const stepLower = step.toLowerCase();
      return !ACTION_VERBS.some(verb => stepLower.includes(verb));
    });
    if (stepsWithoutActionVerbs.length === core.mechanismSteps.length) {
      failures.push(`No mechanismSteps contain action-oriented language. Steps: [${core.mechanismSteps.join(", ")}]`);
    } else if (stepsWithoutActionVerbs.length > 0) {
      failures.push(`${stepsWithoutActionVerbs.length}/${core.mechanismSteps.length} mechanismSteps lack action verbs: [${stepsWithoutActionVerbs.join(", ")}]`);
    }
  }

  if (core.mechanismLogic && !ACTION_VERBS.some(verb => core.mechanismLogic.toLowerCase().includes(verb))) {
    failures.push("mechanismLogic does not describe HOW transformation happens — no action verbs found");
  }

  return { valid: failures.length === 0, failures };
}

export function refineMechanismFromTheme(core: MechanismCore, pillars: DifferentiationPillar[], trustGaps: TrustGap[]): MechanismCore {
  let refinedName = core.mechanismName;
  if (THEME_ONLY_PATTERN.test(refinedName.trim())) {
    const parts = refinedName.trim().split(/\s+/);
    const typePart = parts[parts.length - 1];
    const themePart = parts.slice(0, -1).join(" ");
    const processVerbs = ["Build", "Deploy", "Transform", "Activate", "Implement"];
    const verb = processVerbs[Math.floor(themePart.length % processVerbs.length)];
    refinedName = `${verb} & ${themePart} ${typePart}`;
  }

  const refinedSteps = core.mechanismSteps.map((step, idx) => {
    const stepLower = step.toLowerCase();
    if (ACTION_VERBS.some(verb => stepLower.includes(verb))) {
      return step;
    }
    const stepVerbs = ["Identify", "Analyze", "Build", "Deploy", "Validate"];
    const verb = stepVerbs[idx % stepVerbs.length];
    return `${verb} ${step}`;
  });

  if (refinedSteps.length === 0 && pillars.length > 0) {
    const stepVerbs = ["Identify", "Analyze", "Build", "Deploy", "Validate"];
    const topPillars = pillars.filter(p => p.overallScore >= 0.3).slice(0, 5);
    for (let i = 0; i < topPillars.length; i++) {
      refinedSteps.push(`${stepVerbs[i % stepVerbs.length]} ${topPillars[i].name}`);
    }
  }

  let refinedLogic = core.mechanismLogic;
  if (refinedLogic && !ACTION_VERBS.some(verb => refinedLogic.toLowerCase().includes(verb))) {
    const topProblem = trustGaps.length > 0
      ? trustGaps.sort((a, b) => b.severity - a.severity)[0].objection
      : "the core challenge";
    refinedLogic = `${refinedName} systematically resolves ${topProblem} by executing ${refinedSteps.length} structured transformation steps: ${refinedSteps.join(" → ")}`;
  }

  console.log(`[DifferentiationEngine-V3] MECHANISM_REFINED | original="${core.mechanismName}" | refined="${refinedName}" | steps=${refinedSteps.length}`);

  return {
    mechanismName: refinedName,
    mechanismType: core.mechanismType,
    mechanismSteps: refinedSteps,
    mechanismPromise: core.mechanismPromise,
    mechanismProblem: core.mechanismProblem,
    mechanismLogic: refinedLogic,
  };
}

export function buildMechanismCore(
  mechanism: MechanismCandidate,
  pillars: DifferentiationPillar[],
  trustGaps: TrustGap[],
  positioning: PositioningInput,
): MechanismCore {
  const MECHANISM_TYPE_MAP: Record<string, MechanismCore["mechanismType"]> = {
    framework: "framework",
    named_process: "method",
    branded_method: "method",
    system: "system",
    none: "none",
  };

  const mechanismType = MECHANISM_TYPE_MAP[mechanism.type] || "none";

  const mechanismName = mechanism.name || (pillars.length > 0 ? `${pillars[0].name} ${mechanismType !== "none" ? mechanismType : "approach"}` : "");

  const mechanismSteps = pillars
    .filter(p => p.overallScore >= 0.4)
    .slice(0, 5)
    .map(p => p.name);

  const topPain = trustGaps.length > 0
    ? trustGaps.sort((a, b) => b.severity - a.severity)[0].objection
    : "";
  const mechanismProblem = topPain || (positioning.enemyDefinition || "");

  const topTerritory = positioning.territories.length > 0
    ? positioning.territories[0].name
    : "";
  const mechanismPromise = topTerritory
    ? `Achieve ${topTerritory} through a structured ${mechanismType !== "none" ? mechanismType : "approach"}`
    : mechanism.description;

  const mechanismLogic = mechanism.supported
    ? `${mechanismName} resolves ${mechanismProblem} using ${mechanismSteps.length} structured steps: ${mechanismSteps.join(" → ")}. Backed by: ${mechanism.proofBasis.slice(0, 3).join("; ")}`
    : `Differentiation direction identified but mechanism lacks structural support for formal framing`;

  let core: MechanismCore = {
    mechanismName,
    mechanismType,
    mechanismSteps,
    mechanismPromise,
    mechanismProblem,
    mechanismLogic,
  };

  const validation = validateMechanismIsTransformation(core);
  if (!validation.valid) {
    console.log(`[DifferentiationEngine-V3] MECHANISM_VALIDATION_FAILED | failures=${validation.failures.length} | ${validation.failures.join(" | ")}`);
    core = refineMechanismFromTheme(core, pillars, trustGaps);
  }

  return core;
}

export function layer9_differentiationPillarScoring(
  territories: Territory[],
  competitorClaims: CompetitorClaim[],
  trustGaps: TrustGap[],
  proofDemands: ProofDemand[],
  audience: AudienceInput,
  mi?: MIInput,
  profileSignals?: ProfileSignals,
): DifferentiationPillar[] {
  const pillars: DifferentiationPillar[] = [];
  const objections = Object.keys(audience.objectionMap || {});

  const dominanceData = mi ? (typeof mi.dominanceData === "string" ? safeJsonParse(mi.dominanceData) : mi.dominanceData) : [];
  const competitorAuthorities: number[] = Array.isArray(dominanceData)
    ? dominanceData.map((d: any) => {
        const raw = d.dominanceScore || d.score || 0;
        return clamp(raw > 1 ? raw / 100 : raw);
      })
    : [];

  for (const territory of territories) {
    const tName = territory.name;
    const tLower = tName.toLowerCase();
    const tTokens = new Set(tokenize(tName));

    const claimOverlap = competitorClaims.filter(c => jaccardSimilarity(c.claim, tName) > 0.15);
    const narrativeDistance = claimOverlap.length > 0
      ? 1 - (claimOverlap.reduce((s, c) => s + jaccardSimilarity(c.claim, tName), 0) / claimOverlap.length)
      : 0.9;

    const totalClaims = competitorClaims.length || 1;
    const signalRarity = clamp(1 - (claimOverlap.length / totalClaims));

    const competitorNarratives = competitorClaims.map(c => c.claim.toLowerCase());
    let saturationCount = 0;
    for (const narrative of competitorNarratives) {
      const nTokens = new Set(tokenize(narrative));
      let overlap = 0;
      for (const t of tTokens) { if (nTokens.has(t)) overlap++; }
      if (tTokens.size > 0 && overlap / tTokens.size >= 0.3) saturationCount++;
    }
    const territorySaturation = clamp(saturationCount / Math.max(competitorNarratives.length, 1));

    const rawUniqueness = (narrativeDistance * 0.40) + (signalRarity * 0.35) + ((1 - territorySaturation) * 0.25);
    const marketUniqueness = clamp(Math.min(rawUniqueness, 0.95));

    const relevantProof = proofDemands.filter(d => d.requiredFor.includes(tName));
    const marketProofability = clamp(relevantProof.length > 0 ? relevantProof.reduce((s, d) => s + d.priority, 0) / relevantProof.length : 0.3);

    const relevantGaps = trustGaps.filter(g => jaccardSimilarity(g.objection, tLower) > 0.10);
    const marketTrustAlignment = clamp(relevantGaps.length > 0 ? relevantGaps.reduce((s, g) => s + g.relevanceToTerritory, 0) / relevantGaps.length : 0.3);

    const avgCompetitorAuthority = competitorAuthorities.length > 0
      ? competitorAuthorities.reduce((s, a) => s + a, 0) / competitorAuthorities.length : 0;
    const narrativeOverlapPressure = claimOverlap.length > 0
      ? claimOverlap.reduce((s, c) => s + jaccardSimilarity(c.claim, tName), 0) / claimOverlap.length : 0;
    const positioningPressure = clamp(
      (avgCompetitorAuthority * 0.40) + (narrativeOverlapPressure * 0.35) + (territorySaturation * 0.25)
    );
    const positioningAlignment = clamp(1 - positioningPressure);

    const objectionCoverage = clamp(
      objections.filter(o => jaccardSimilarity(o, tLower) > 0.10).length / Math.max(objections.length, 1)
    );

    const profileGrounding = profileSignals ? computeProfileGroundingScore(tName, profileSignals) : 0;
    const hasProfileData = profileSignals?.hasProfile ?? false;

    const profileUniquenessBasis = clamp(profileGrounding * 0.6 + 0.3);
    const profileProofabilityBasis = clamp(profileGrounding * 0.7 + 0.2);
    const profileTrustBasis = clamp(profileGrounding * 0.5 + 0.25);

    const uniqueness = hasProfileData
      ? clamp(marketUniqueness * SIGNAL_WEIGHTS.MARKET + profileUniquenessBasis * SIGNAL_WEIGHTS.PROFILE)
      : marketUniqueness;

    const proofability = hasProfileData
      ? clamp(marketProofability * SIGNAL_WEIGHTS.MARKET + profileProofabilityBasis * SIGNAL_WEIGHTS.PROFILE)
      : marketProofability;

    const trustAlignment = hasProfileData
      ? clamp(marketTrustAlignment * SIGNAL_WEIGHTS.MARKET + profileTrustBasis * SIGNAL_WEIGHTS.PROFILE)
      : marketTrustAlignment;

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
  analyticalEnrichment?: any,
  depthRejectionContext?: string,
): Promise<{ refinedPillars: DifferentiationPillar[]; refinedClaims: ClaimStructure[]; refinedMechanism: MechanismCandidate }> {
  const topPillars = pillars.slice(0, 5);
  const topClaims = claims.slice(0, 5);
  const aelBlock = formatAELForPrompt(analyticalEnrichment || null);
  const causalDirective = buildCausalDirectiveForPrompt(analyticalEnrichment || null);
  if (aelBlock) console.log(`[DifferentiationEngine-V3] AEL_INJECTED | enrichmentSize=${aelBlock.length}chars | causalDirective=${causalDirective.length}chars`);

  const prompt = `You are refining differentiation language. You must ONLY improve wording clarity and impact.
${aelBlock}${causalDirective}${depthRejectionContext ? `\n${depthRejectionContext}\n` : ""}
STRICT RULES:
- Do NOT invent new strategy, audience segments, offers, or execution plans
- Do NOT change the meaning or direction of any pillar or claim
- Do NOT add pricing, packaging, guarantees, CTAs, or channel recommendations
- Do NOT generate strategic decisions, funnel structures, offer designs, or execution plans
- Do NOT reference downstream engines (Strategy, Offer, Funnel, Financial, Execution)
- ONLY output differentiation territories, claim strength, proof architecture, and mechanism framing
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
  const strategyPatterns = /\b(strategic plan|execution plan|funnel stage|funnel step|offer structure|revenue model|financial forecast|budget allocation|campaign strategy)\b/;
  const executionPatterns = /\b(publish now|schedule post|send email|launch campaign|deploy funnel|activate sequence|run campaign)\b/;

  return offerPatterns.test(lower) || channelPatterns.test(lower) || audiencePatterns.test(lower) || copyPatterns.test(lower) || strategyPatterns.test(lower) || executionPatterns.test(lower);
}

export function validateTerritoryEvidenceDensity(
  pillars: DifferentiationPillar[],
  proofDemands: ProofDemand[],
  trustGaps: TrustGap[],
  competitorClaims: CompetitorClaim[],
): { validatedPillars: DifferentiationPillar[]; downgradedCount: number } {
  let downgradedCount = 0;

  const validatedPillars = pillars.map(pillar => {
    const tName = pillar.name;
    const tLower = tName.toLowerCase();

    const proofClusters = new Set(
      proofDemands
        .filter(d => d.requiredFor.includes(tName))
        .map(d => d.category)
    );
    const trustClusters = trustGaps.filter(g => jaccardSimilarity(g.objection, tLower) > 0.10);
    const competitorEvidence = competitorClaims.filter(c => jaccardSimilarity(c.claim, tName) > 0.10);

    const semanticClusterCount = proofClusters.size;

    let sourceCount = 0;
    if (proofClusters.size > 0) sourceCount++;
    if (trustClusters.length > 0) sourceCount++;
    if (competitorEvidence.length > 0) sourceCount++;

    const hasMinClusters = semanticClusterCount >= 2;
    const hasMinSources = sourceCount >= 2;

    if (!hasMinClusters || !hasMinSources) {
      downgradedCount++;
      const factor = 0.6;
      return {
        ...pillar,
        uniqueness: clamp(pillar.uniqueness * factor),
        proofability: clamp(pillar.proofability * factor),
        trustAlignment: clamp(pillar.trustAlignment * factor),
        positioningAlignment: clamp(pillar.positioningAlignment * factor),
        overallScore: clamp(pillar.overallScore * factor),
        description: pillar.description + " [exploratory — low evidence density]",
      };
    }

    return pillar;
  });

  return { validatedPillars, downgradedCount };
}

export function layer12_stabilityGuard(
  pillars: DifferentiationPillar[],
  claims: ClaimStructure[],
  collisions: ClaimCollision[],
  territories: Territory[],
  hasProfileSignals: boolean = false,
): { stable: boolean; failures: string[]; warnings: string[]; lowConfidence: boolean } {
  const failures: string[] = [];
  const warnings: string[] = [];
  let groundingWarningCount = 0;
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
  if (avgProofability < SOFT_FAILURE_PROOFABILITY) {
    failures.push(`Average proofability critically low (${avgProofability.toFixed(2)}) — insufficient signal grounding`);
  } else if (avgProofability < STABILITY_MIN_PROOFABILITY) {
    warnings.push(`Insufficient signal grounding – running analysis with limited confidence (proofability: ${avgProofability.toFixed(2)} < ${STABILITY_MIN_PROOFABILITY})`);
    groundingWarningCount++;
  }

  const avgTrustAlignment = pillars.length > 0 ? pillars.reduce((s, p) => s + p.trustAlignment, 0) / pillars.length : 0;
  if (avgTrustAlignment < SOFT_FAILURE_TRUST_ALIGNMENT) {
    failures.push(`Average trust alignment critically low (${avgTrustAlignment.toFixed(2)}) — insufficient signal grounding`);
  } else if (avgTrustAlignment < STABILITY_MIN_TRUST_ALIGNMENT) {
    warnings.push(`Insufficient signal grounding – running analysis with limited confidence (trust alignment: ${avgTrustAlignment.toFixed(2)} < ${STABILITY_MIN_TRUST_ALIGNMENT})`);
    groundingWarningCount++;
  }

  const weakClaims = claims.filter(c => c.overallScore < MIN_PILLAR_SCORE);
  if (weakClaims.length === claims.length && claims.length > 0) {
    if (hasProfileSignals) {
      warnings.push(`All claims below minimum score threshold (${MIN_PILLAR_SCORE}) — profile signals provide partial grounding`);
      groundingWarningCount++;
    } else {
      failures.push(`All claims below minimum score threshold (${MIN_PILLAR_SCORE})`);
    }
  }

  const lowConfidence = groundingWarningCount > 0 && failures.length === 0;

  return { stable: failures.length === 0, failures, warnings, lowConfidence };
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
  profile?: ProfileInput | null,
  analyticalEnrichment?: any,
): Promise<DifferentiationResult> {
  const startTime = Date.now();
  const diagnostics: Record<string, any> = {};

  const profileSignals = extractProfileSignals(profile || null);
  diagnostics.profileSignals = {
    hasProfile: profileSignals.hasProfile,
    signalCount: profileSignals.signalCount,
    claimTokenCount: profileSignals.claimTokens.size,
    offerTokenCount: profileSignals.offerTokens.size,
    audienceTokenCount: profileSignals.audienceTokens.size,
    strategyTokenCount: profileSignals.strategyTokens.size,
  };

  console.log(`[DifferentiationEngine-V3] Starting 12-layer pipeline | profileSignals=${profileSignals.hasProfile ? profileSignals.signalCount : "none"} | dualSignalModel=${profileSignals.hasProfile}`);

  const l1 = layer1_positioningIntakeLock(positioning);
  diagnostics.layer1 = { valid: l1.valid, territoryCount: l1.territories.length, failures: l1.failures };
  if (!l1.valid) {
    console.log(`[DifferentiationEngine-V3] Layer 1 FAILED: ${l1.failures.join(", ")}`);
    return buildEmptyResult(STATUS.MISSING_DEPENDENCY, `Positioning intake failed: ${l1.failures.join("; ")}`, Date.now() - startTime);
  }

  const originalObjectionCount = Object.keys(audience.objectionMap || {}).length;
  const enrichedObjectionMap = deriveObjectionsFromAudienceData(audience);
  const enrichedObjectionCount = Object.keys(enrichedObjectionMap).length;
  const objectionWasDerived = enrichedObjectionCount > originalObjectionCount;

  if (objectionWasDerived) {
    console.log(`[DifferentiationEngine-V3] Objection derivation: ${originalObjectionCount} explicit → ${enrichedObjectionCount} total (${enrichedObjectionCount - originalObjectionCount} derived from audience data)`);
  }

  const enrichedAudience: AudienceInput = {
    ...audience,
    objectionMap: enrichedObjectionMap,
  };

  const l2Claims = layer2_competitorClaimSurfaceMapping(mi);
  diagnostics.layer2 = { claimCount: l2Claims.length };

  const competitorClaimCount = l2Claims.length;
  const audienceSignalCount = (audience.audiencePains || []).length + Object.keys(enrichedObjectionMap).length + (audience.emotionalDrivers || []).length;
  const dataReliability = assessDataReliability(
    competitorClaimCount,
    audienceSignalCount,
    !!positioning.narrativeDirection,
    !!(l1.territories.length > 0),
    !!(audience.audiencePains && audience.audiencePains.length > 0),
    0,
  );
  diagnostics.dataReliability = dataReliability;
  if (dataReliability.isWeak) {
    console.log(`[DifferentiationEngine-V3] WEAK_DATA | reliability=${dataReliability.overallReliability.toFixed(2)} | advisories=${dataReliability.advisories.length}`);
  }

  const candidateClaims = l1.territories.map(t => t.name);
  const l3Collisions = layer3_claimCollisionDetection(candidateClaims, l2Claims);
  diagnostics.layer3 = { collisionCount: l3Collisions.length, highRisk: l3Collisions.filter(c => c.collisionRisk >= COLLISION_THRESHOLD).length };

  const l4ProofDemands = layer4_proofDemandMapping(enrichedAudience, l1.territories);
  diagnostics.layer4 = { proofDemandCount: l4ProofDemands.length };

  const l5TrustGaps = layer5_trustGapPrioritization(enrichedAudience, l1.territories);
  diagnostics.layer5 = { trustGapCount: l5TrustGaps.length };

  const l6Authority = layer6_authorityModeSelection(positioning, enrichedAudience, mi);
  diagnostics.layer6 = { mode: l6Authority.mode, rationale: l6Authority.rationale };

  const l7ProofAssets = layer7_proofAssetArchitecture(l4ProofDemands, l5TrustGaps, l1.territories);
  diagnostics.layer7 = { assetCount: l7ProofAssets.length };

  const lowObjectionDensity = originalObjectionCount === 0;
  diagnostics.objectionDerivation = {
    originalCount: originalObjectionCount,
    enrichedCount: enrichedObjectionCount,
    derivedCount: enrichedObjectionCount - originalObjectionCount,
    lowDensity: lowObjectionDensity,
  };

  const l9RawPillars = layer9_differentiationPillarScoring(l1.territories, l2Claims, l5TrustGaps, l4ProofDemands, enrichedAudience, mi, profileSignals);
  const evidenceDensity = validateTerritoryEvidenceDensity(l9RawPillars, l4ProofDemands, l5TrustGaps, l2Claims);
  const l9Pillars = evidenceDensity.validatedPillars.sort((a, b) => b.overallScore - a.overallScore);
  diagnostics.layer9 = { pillarCount: l9Pillars.length, topScore: l9Pillars[0]?.overallScore ?? 0, downgradedPillars: evidenceDensity.downgradedCount };

  const l10Claims = layer10_claimStrengthScoring(l9Pillars, l3Collisions, l1.territories);
  diagnostics.layer10 = { claimCount: l10Claims.length, avgScore: l10Claims.length > 0 ? l10Claims.reduce((s, c) => s + c.overallScore, 0) / l10Claims.length : 0 };

  const l8Mechanism = layer8_mechanismConstruction(positioning, l4ProofDemands, l10Claims, l9Pillars);
  const l8MechanismCore = buildMechanismCore(l8Mechanism, l9Pillars, l5TrustGaps, positioning);
  diagnostics.layer8 = { supported: l8Mechanism.supported, type: l8Mechanism.type, mechanismCore: l8MechanismCore };

  let finalPillars = l9Pillars;
  let finalClaims = l10Claims;
  let finalMechanism = l8Mechanism;

  const depthGateMaxAttempts = DEPTH_GATE_MAX_RETRIES + 1;
  const depthGateLog: string[] = [];
  let depthRejectionContext = "";
  let celDepth: DepthComplianceResult | null = null;
  let depthGateResult: DepthGateResult | null = null;

  for (let depthAttempt = 1; depthAttempt <= depthGateMaxAttempts; depthAttempt++) {
    if (depthAttempt > 1) {
      console.log(`[DifferentiationEngine-V3] DEPTH_GATE: Regenerating attempt ${depthAttempt}/${depthGateMaxAttempts}`);
    }

    finalPillars = l9Pillars;
    finalClaims = l10Claims;
    finalMechanism = l8Mechanism;

    try {
      const l11 = await layer11_aiRefinement(l9Pillars, l10Claims, l8Mechanism, l6Authority.mode, accountId, analyticalEnrichment, depthRejectionContext || undefined);
      finalPillars = l11.refinedPillars;
      finalClaims = l11.refinedClaims;
      finalMechanism = l11.refinedMechanism;
      diagnostics.layer11 = { aiRefined: true, attempt: depthAttempt };
    } catch (err: any) {
      diagnostics.layer11 = { aiRefined: false, error: err.message, attempt: depthAttempt };
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

    const boundaryText = [
      ...finalPillars.map(p => `${p.name} ${p.description}`),
      ...finalClaims.map(c => c.claim),
      finalMechanism.description,
    ].join(" ");
    const boundaryResult = enforceBoundaryWithSanitization(boundaryText, BOUNDARY_HARD_PATTERNS, BOUNDARY_SOFT_PATTERNS);
    if (!boundaryResult.clean) {
      console.error(`[DifferentiationEngine-V3] BOUNDARY VIOLATION: ${boundaryResult.violations.join("; ")}`);
      const result = buildEmptyResult("INTEGRITY_FAILED", `Boundary enforcement failed: ${boundaryResult.violations.join("; ")}`, Date.now() - startTime);
      result.confidenceScore = 0;
      result.layerDiagnostics = diagnostics;
      return result;
    }
    if (boundaryResult.sanitized && boundaryResult.warnings.length > 0) {
      console.log(`[DifferentiationEngine-V3] BOUNDARY SANITIZED: ${boundaryResult.warnings.join("; ")}`);
      diagnostics.boundarySanitization = { sanitized: boundaryResult.sanitized, warnings: boundaryResult.warnings };
      for (const p of finalPillars) {
        p.name = applySoftSanitization(p.name, BOUNDARY_SOFT_PATTERNS);
        p.description = applySoftSanitization(p.description, BOUNDARY_SOFT_PATTERNS);
      }
      for (const c of finalClaims) {
        c.claim = applySoftSanitization(c.claim, BOUNDARY_SOFT_PATTERNS);
      }
      finalMechanism.description = applySoftSanitization(finalMechanism.description, BOUNDARY_SOFT_PATTERNS);
    }

    celDepth = enforceEngineDepthCompliance(
      "differentiation",
      [
        ...finalPillars.map(p => `${p.name} ${p.description}`),
        ...finalClaims.map(c => c.claim),
        finalMechanism.description,
      ],
      analyticalEnrichment || null,
    );

    if (!analyticalEnrichment || !isDepthBlocking(celDepth)) {
      depthGateLog.push(`Attempt ${depthAttempt}: PASSED (depthScore=${celDepth.causalDepthScore})`);
      depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog);
      if (celDepth.violations.length > 0) {
        for (const logEntry of celDepth.enforcementLog) {
          console.log(`[DifferentiationEngine-V3] CEL_DEPTH: ${logEntry}`);
        }
      } else {
        console.log(`[DifferentiationEngine-V3] CEL_DEPTH: CLEAN | depthScore=${celDepth.causalDepthScore} | rootCauseRefs=${celDepth.rootCauseReferences}`);
      }
      break;
    }

    depthGateLog.push(`Attempt ${depthAttempt}: BLOCKED (depthScore=${celDepth.causalDepthScore}, violations=${celDepth.violations.length})`);
    console.log(`[DifferentiationEngine-V3] DEPTH_GATE: Attempt ${depthAttempt} BLOCKED | depthScore=${celDepth.causalDepthScore} | violations=${celDepth.violations.length}`);

    if (depthAttempt >= depthGateMaxAttempts) {
      depthGateResult = buildDepthGateResult(celDepth, depthAttempt, depthGateMaxAttempts, depthGateLog);
      console.log(`[DifferentiationEngine-V3] DEPTH_GATE: FINAL FAILURE after ${depthGateMaxAttempts} attempts — returning DEPTH_FAILED`);
      const failedResult = buildEmptyResult("DEPTH_FAILED", `Depth gate failed after ${depthGateMaxAttempts} attempts: depthScore=${celDepth.causalDepthScore}`, Date.now() - startTime);
      failedResult.confidenceScore = 0;
      failedResult.layerDiagnostics = { ...diagnostics, depthGate: depthGateResult };
      (failedResult as any).celDepthCompliance = celDepth;
      (failedResult as any).depthGateResult = depthGateResult;
      return failedResult;
    }

    depthRejectionContext = buildDepthRejectionDirective(celDepth, depthAttempt);
  }

  const l12Stability = layer12_stabilityGuard(finalPillars, finalClaims, l3Collisions, l1.territories, profileSignals.hasProfile);
  diagnostics.layer12 = { stable: l12Stability.stable, failures: l12Stability.failures, warnings: l12Stability.warnings, lowConfidence: l12Stability.lowConfidence };

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
  } else if (l12Stability.lowConfidence) {
    status = STATUS.LOW_CONFIDENCE;
    statusMessage = `Insufficient signal grounding – running analysis with limited confidence. ${l12Stability.warnings.join("; ")}`;
    console.log(`[DifferentiationEngine-V3] LOW_CONFIDENCE | warnings=${l12Stability.warnings.length} | profileSignals=${profileSignals.hasProfile}`);
  }

  const allDiffText = [
    ...finalPillars.map(p => `${p.name} ${p.description}`),
    ...finalClaims.map(c => c.claim),
    finalMechanism.description,
  ].join(" ");
  const genericOutputCheck = detectGenericOutput(allDiffText);
  diagnostics.genericOutputCheck = genericOutputCheck;
  if (genericOutputCheck.genericDetected) {
    console.log(`[DifferentiationEngine-V3] GENERIC_OUTPUT_PENALTY | phrases=${genericOutputCheck.genericPhrases.length} | penalty=${genericOutputCheck.penalty.toFixed(2)}`);
  }

  const avgClaimScore = finalClaims.length > 0 ? finalClaims.reduce((s, c) => s + c.overallScore, 0) / finalClaims.length : 0;
  const objectionDensityFactor = lowObjectionDensity ? 0.85 : 1.0;
  const genericPenaltyFactor = genericOutputCheck.genericDetected ? (1 - genericOutputCheck.penalty) : 1;
  const depthPenaltyFactor = celDepth!.passed ? 1.0 : Math.max(0.5, celDepth!.score);
  const stabilityFactor = l12Stability.stable ? (l12Stability.lowConfidence ? 0.75 : 1) : 0.6;
  const rawConfidence = clamp(avgClaimScore * stabilityFactor * objectionDensityFactor * genericPenaltyFactor * depthPenaltyFactor);
  const confidenceScore = normalizeConfidence(rawConfidence, dataReliability);
  const confidenceNormalized = rawConfidence !== confidenceScore;
  diagnostics.confidenceNormalized = confidenceNormalized;
  if (confidenceNormalized) {
    diagnostics.rawConfidence = rawConfidence;
  }

  console.log(`[DifferentiationEngine-V3] Complete | status=${status} | pillars=${finalPillars.length} | claims=${finalClaims.length} | confidence=${confidenceScore.toFixed(2)} | stable=${l12Stability.stable} | lowConfidence=${l12Stability.lowConfidence} | collisions=${highCollisionCount} | profileSignals=${profileSignals.hasProfile}`);

  return {
    status,
    statusMessage,
    pillars: finalPillars,
    proofArchitecture: l7ProofAssets,
    claimStructures: finalClaims,
    authorityMode: l6Authority.mode,
    authorityRationale: l6Authority.rationale,
    mechanismFraming: finalMechanism,
    mechanismCore: l8MechanismCore,
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
    celDepthCompliance: celDepth!,
    depthGateResult,
  };
}
