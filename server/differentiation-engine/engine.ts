
import { randomUUID } from "crypto";
const log = (ctx: string, msg: string) => console.log(`[${ctx}] ${msg}`);
import { MIInput, AudienceInput, ProfileInput, DifferentiationResult, CanonicalDifferentiationInput, DifferentiationCandidate, PainDisposition } from "./types";
import { proposeDifferentiation } from "./proposer";
import { judgeDifferentiation } from "./judge";

export async function runDifferentiationEngine(
  mi: MIInput,
  aud: AudienceInput,
  profile: ProfileInput,
  runContext?: { accountId?: string; campaignId?: string; jobId?: string; audienceSnapshotId?: string; miSnapshotId?: string }
): Promise<DifferentiationResult> {
  const start = Date.now();
  log("DifferentiationEngine", "Starting strict Proposer->Judge loop");

  // 1. Build CanonicalDifferentiationInput safely
  let corePains = (aud.painRegistry || []).filter((p: any) => 
    p.classification === "CORE_PURCHASE" || 
    p.classification === "CORE" || 
    p.role === "CORE" || 
    p.isCore === true
  );
  
  if (corePains.length === 0) {
    corePains = (aud.painRegistry || []).filter((p: any) => 
      p.classification === "SUPPORTING" || 
      p.classification === "DIRECT_FIT" ||
      (p.classification && p.classification !== "EXCLUDED" && p.classification !== "STRATEGIC_EXCLUDED" && p.classification !== "NON_STRATEGIC")
    );
  }

  if (corePains.length === 0 && Array.isArray(aud.painRegistry) && aud.painRegistry.length > 0) {
    corePains = [aud.painRegistry[0]];
  }

  if (corePains.length === 0) {
    return { status: "SKIPPED", statusMessage: "No CORE_PURCHASE or active strategic pains found", differentiations: [], painDispositions: [], confidenceScore: 0, executionTimeMs: Date.now() - start, engineVersion: 3 };
  }

  const miFacts: any[] = [];
  
  // 1. From dominanceData or dominance array
  const dominanceList = Array.isArray(mi.dominanceData) ? mi.dominanceData : (Array.isArray(mi.dominance) ? mi.dominance : []);
  dominanceList.forEach((dom: any) => {
    const cId = dom.competitorId || dom.id || "competitor";
    const cName = dom.competitorName || dom.name || cId;
    
    // Canonical facts
    (dom.canonicalFacts || []).forEach((f: any) => {
      if (f.fact || f.text) {
        miFacts.push({
          miAuthorityId: f.miAuthorityId || f.id || `mi_fact_${cId}_${f.factType || 'gen'}`,
          competitorId: cId,
          factType: f.factType || "COMPETITOR_FACT",
          fact: `${cName}: ${f.fact || f.text}`,
          miSnapshotId: runContext?.miSnapshotId || ""
        });
      }
    });

    // Weaknesses
    (dom.weaknesses || []).forEach((w: string, idx: number) => {
      miFacts.push({
        miAuthorityId: `mi_weakness_${cId}_${idx + 1}`,
        competitorId: cId,
        factType: "COMPETITOR_WEAKNESS",
        fact: `${cName} weakness: ${w}`,
        miSnapshotId: runContext?.miSnapshotId || ""
      });
    });

    // Strengths
    (dom.strengths || []).forEach((s: string, idx: number) => {
      miFacts.push({
        miAuthorityId: `mi_strength_${cId}_${idx + 1}`,
        competitorId: cId,
        factType: "COMPETITOR_STRENGTH",
        fact: `${cName} strength: ${s}`,
        miSnapshotId: runContext?.miSnapshotId || ""
      });
    });
  });

  // 2. From competitorIntentMap / competitors
  const competitorsList = Array.isArray(mi.competitors) && mi.competitors.length > 0 ? mi.competitors : (Array.isArray(mi.competitorIntentMap) ? mi.competitorIntentMap : []);
  competitorsList.forEach((c: any, idx: number) => {
    const cId = c.competitorId || c.id || `comp_${idx + 1}`;
    const cName = c.competitorName || c.name || `Competitor ${idx + 1}`;
    const cIntent = c.intentType || c.intentCategory || "DEFENSIVE";
    miFacts.push({
      miAuthorityId: `mi_intent_${cId}`,
      competitorId: cId,
      factType: "COMPETITOR_INTENT",
      fact: `${cName} operates with an observed ${cIntent} strategic posture in reviewed market evidence.`,
      miSnapshotId: runContext?.miSnapshotId || ""
    });
  });

  // 3. From opportunitySignals, threatSignals, taggedSignals, signals
  const allSignals = [
    ...(Array.isArray(mi.opportunitySignals) ? mi.opportunitySignals : []),
    ...(Array.isArray(mi.threatSignals) ? mi.threatSignals : []),
    ...(Array.isArray(mi.taggedSignals) ? mi.taggedSignals : []),
    ...(Array.isArray(mi.signals) ? mi.signals : [])
  ];

  allSignals.forEach((s: any, idx: number) => {
    const text = typeof s === "string" ? s : (s.text || s.signal || s.name || "");
    if (text && !miFacts.some(existing => existing.fact === text)) {
      miFacts.push({
        miAuthorityId: `mi_signal_${idx + 1}`,
        competitorId: "market_baseline",
        factType: "MARKET_EVIDENCE_SIGNAL",
        fact: text,
        miSnapshotId: runContext?.miSnapshotId || ""
      });
    }
  });

  const canonicalMi = miFacts;

  // Canonical product truth facts with matching IDs (FAIL-CLOSED: Must come from Business Understanding)
  const canonicalProductTruth: any[] = [];
  if (Array.isArray(aud.productTruthFacts) && aud.productTruthFacts.length > 0) {
    aud.productTruthFacts.forEach((f: any) => {
      canonicalProductTruth.push({
        productTruthFactId: f.productTruthFactId || f.factId || f.id,
        factType: f.factType || "CAPABILITY",
        fact: f.statement || f.fact || f.description || JSON.stringify(f)
      });
    });
  }

  if (canonicalProductTruth.length === 0) {
    return {
      status: "FAILED",
      statusMessage: "PRODUCT_TRUTH_MISSING: Canonical Product Truth is required for differentiation but was empty or missing.",
      differentiations: [],
      painDispositions: [],
      confidenceScore: 0,
      executionTimeMs: Date.now() - start,
      engineVersion: 8
    };
  }

  const canonicalInput: CanonicalDifferentiationInput = {
    lineage: {
      accountId: runContext?.accountId || "",
      campaignId: runContext?.campaignId || "",
      jobId: runContext?.jobId || "",
      audienceSnapshotId: runContext?.audienceSnapshotId || "",
      miSnapshotId: runContext?.miSnapshotId || ""
    },
    corePains: corePains.map((p: any) => ({
      painId: p.painId,
      targetCoverageAuthorityId: p.targetAssessmentAuthorityId || p.targetCoverageAuthorityId || `ta_${p.painId}`,
      productFitAuthorityId: p.productAssessmentAuthorityId || p.productFitAuthorityId || `pa_${p.painId}`,
      coreDecisionId: p.strategicPainDecisionAuthorityId || p.coreDecisionId || `spd_${p.painId}`,
      canonicalPain: p.canonical || p.claim || p.normalizedStatement || p.originalStatement || "",
      segmentIds: p.segmentIds || [p.segmentId].filter(Boolean),
      fitType: p.fitType || "DIRECT_FIT",
      requiredCapability: p.requiredCapability || p.matchedProductCapability || "Product Capability",
      matchedProductCapability: p.matchedProductCapability || p.requiredCapability || "Product Capability",
      productTruthFactIds: (p.productTruthFactIds && p.productTruthFactIds.length > 0) 
        ? p.productTruthFactIds 
        : canonicalProductTruth.map(f => f.productTruthFactId)
    })),
    productTruth: canonicalProductTruth,
    competitiveAuthority: canonicalMi
  };

  // 2. Proposer
  let { differentiations, painDispositions } = await proposeDifferentiation(canonicalInput);

  // Structural generation of differentiationId BEFORE Judge
  differentiations.forEach((d: any) => {
    if (d && typeof d === "object" && !d.differentiationId) {
      d.differentiationId = randomUUID();
    }
  });

  // Structural Completeness Validator
  const inputPainIds = new Set(canonicalInput.corePains.map(p => p.painId));
  const outputPainIds = new Set(painDispositions.map(d => d.painId));
  const missingPains = [...inputPainIds].filter(id => !outputPainIds.has(id));
  
  if (missingPains.length > 0) {
    missingPains.forEach(pid => {
      painDispositions.push({ painId: pid, disposition: "STRUCTURAL_DISPOSITION_MISSING" });
    });
  }

  // 3. Judge
  let judgeResult = await judgeDifferentiation(canonicalInput, differentiations);
  console.log("[DifferentiationEngine] Judge Result Round 1:", JSON.stringify(judgeResult, null, 2));

  // 4. Targeted Repair (1 Attempt Max)
  if (!judgeResult.valid || missingPains.length > 0) {
    log("DifferentiationEngine", "Judge rejected candidates or missing pains detected. Running Targeted Repair...");
    console.log("\n--- STRUCTURAL_DISPOSITION_MISSING TRACE ---\nMissing Pains: " + JSON.stringify(missingPains) + "\n--------------------------------------------");
    
    // Lock accepted candidates
    const rejectedIds = new Set(judgeResult.defects.map(d => d.differentiationId));
    const lockedCandidates = differentiations.filter(d => !rejectedIds.has(d.differentiationId));
    const failedCandidates = differentiations.filter(d => rejectedIds.has(d.differentiationId));

    const repairRes = await proposeDifferentiation(canonicalInput, failedCandidates, judgeResult.defects);
    
    // Repair MUST preserve existing differentiationIds for failed candidates, but since we recreate them,
    // we match them up or generate new ones structurally.
    const newCands = repairRes.differentiations;
    newCands.forEach((d: any) => {
      if (d && typeof d === "object" && !d.differentiationId) {
        d.differentiationId = randomUUID();
      }
    });

    differentiations = [...lockedCandidates, ...newCands];
    
    // Update dispositions cleanly
    const finalDispositions = new Map<string, PainDisposition>();
    painDispositions.forEach(pd => finalDispositions.set(pd.painId, pd));
    repairRes.painDispositions.forEach(pd => finalDispositions.set(pd.painId, pd));
    painDispositions = Array.from(finalDispositions.values());

    // Re-Judge
    judgeResult = await judgeDifferentiation(canonicalInput, differentiations);
    console.log("[DifferentiationEngine] Judge Result Round 2:", JSON.stringify(judgeResult, null, 2));
  }

  // 5. Finalize
  // If judge still rejects some, we drop them or mark them. Exhaustion fails closed.
  const finalRejectedIds = new Set(judgeResult.defects.map(d => d.differentiationId));
  const acceptedDifferentiations = differentiations.filter(d => !finalRejectedIds.has(d.differentiationId));
  
  acceptedDifferentiations.forEach(d => d.isJudgeApproved = true);

  // Update dispositions for failed ones
  acceptedDifferentiations.forEach(d => {
    const pids = Array.isArray(d.corePainIds) ? d.corePainIds : (Array.isArray((d as any).painIds) ? (d as any).painIds : [(d as any).painId || (d as any).corePainId].filter(Boolean));
    pids.forEach(pid => {
      const disp = painDispositions.find(p => p.painId === pid);
      if (disp) { disp.disposition = "ACCEPTED_DIFFERENTIATION"; disp.differentiationId = d.differentiationId; }
    });
  });

  const allAccepted = acceptedDifferentiations.length > 0;

  const pillars = acceptedDifferentiations.map(d => {
    const pids = Array.isArray(d.corePainIds) ? d.corePainIds : (Array.isArray((d as any).painIds) ? (d as any).painIds : [(d as any).painId || (d as any).corePainId].filter(Boolean));
    return {
      name: d.distinctiveProperty || d.differentiationClaim,
      title: d.distinctiveProperty || d.differentiationClaim,
      description: d.differentiationClaim,
      strategy: d.differentiationClaim,
      buyerValue: d.buyerValue,
      painIds: pids,
      proofPoints: [d.proofBoundary].filter(Boolean),
      proofBoundary: d.proofBoundary,
      mechanismName: d.mechanismName,
    };
  });

  const claimStructures = acceptedDifferentiations.map(d => {
    const pids = Array.isArray(d.corePainIds) ? d.corePainIds : (Array.isArray((d as any).painIds) ? (d as any).painIds : [(d as any).painId || (d as any).corePainId].filter(Boolean));
    return {
      claim: d.differentiationClaim,
      distinctiveProperty: d.distinctiveProperty,
      buyerValue: d.buyerValue,
      painIds: pids,
      proofPoints: [d.proofBoundary].filter(Boolean),
      proofBoundary: d.proofBoundary,
    };
  });

  const proofArchitecture = acceptedDifferentiations.map(d => d.proofBoundary).filter(Boolean);

  return {
    status: allAccepted ? "SUCCESS" : "FAILED",
    statusMessage: allAccepted ? "Differentiation computed" : "Semantic exhaustion: NO_SUPPORTED_DIFFERENTIATION",
    differentiations: acceptedDifferentiations,
    pillars,
    claimStructures,
    proofArchitecture,
    painDispositions,
    confidenceScore: allAccepted ? 0.9 : 0.0,
    executionTimeMs: Date.now() - start,
    engineVersion: 3
  };
}



export function buildStructuredAELBlock(ael: any): string {
  if (!ael) return "";
  const sections: string[] = [];
  const rootCauses = ael.root_causes || [];
  const causalChains = ael.causal_chains || [];
  const buyingBarriers = ael.buying_barriers || [];

  if (rootCauses.length === 0 && causalChains.length === 0 && buyingBarriers.length === 0) return "";

  sections.push("\n═══ AEL CAUSAL STRUCTURE (you MUST use these identifiers in your output) ═══\n");

  if (rootCauses.length > 0) {
    sections.push("ROOT CAUSES:");
    rootCauses.slice(0, 5).forEach((rc: any, i: number) => {
      sections.push(`  [RC${i + 1}] Surface: "${rc.surfaceSignal}" → Deep cause: "${rc.deepCause}" [${rc.confidenceLevel}]`);
    });
  }

  if (causalChains.length > 0) {
    sections.push("\nCAUSAL CHAINS:");
    causalChains.slice(0, 5).forEach((cc: any, i: number) => {
      sections.push(`  [CC${i + 1}] ${cc.pain} → ${cc.cause} → ${cc.impact} → ${cc.behavior} (conversion: ${cc.conversionEffect})`);
    });
  }

  if (buyingBarriers.length > 0) {
    sections.push("\nBUYING BARRIERS:");
    buyingBarriers.slice(0, 5).forEach((bb: any, i: number) => {
      sections.push(`  [BB${i + 1}] [${bb.severity}] ${bb.barrier} — root: ${bb.rootCause} — resolution: ${bb.requiredResolution}`);
    });
  }

  sections.push("\n═══ END AEL STRUCTURE ═══\n");
  return sections.join("\n");
}
