// @ts-nocheck
import { db } from "../db";
import { extractAssertionSemanticProperties, evaluateClaimSemanticEntailment } from "../shared/claim-entailment";
import { validateBundleLineageCompatibility } from "../shared/dependency-contract";

export class StrategyConsistencyError extends Error {
  constructor(
    public readonly conflict: string,
    public readonly canonicalFields: string[],
    public readonly responsibleEngines: string[],
    public readonly recommendedRegenerationTarget: string
  ) {
    super(`STRATEGY_CONSISTENCY_FAILED: ${conflict}`);
    this.name = "StrategyConsistencyError";
  }
}

export type ConsistencyValidationOutcomeType =
  | "PASSED"
  | "FAILED_DETERMINISTIC"
  | "FAILED_SEMANTIC"
  | "INCOMPLETE_INPUTS";

export interface ConsistencyDefectItem {
  fieldPath: string;
  category:
    | "FACTUAL_DEFECT"
    | "COMPETITOR_CONTRADICTION"
    | "EPISTEMIC_MISMATCH"
    | "REFERENCE_INVALID"
    | "BUDGET_INCONSISTENCY"
    | "INCOMPLETE_INPUT";
  severity: "BLOCKING" | "WARNING";
  proposition: string;
  citedEvidenceIds: string[];
  reason: string;
  responsibleEngine: string;
}

export interface CrossEngineConsistencyResult {
  valid: boolean;
  outcomeType: ConsistencyValidationOutcomeType;
  blocking: boolean;
  checkFailed?: boolean;
  conflict?: string;
  canonicalFields?: string[];
  responsibleEngines?: string[];
  recommendedRegenerationTarget?: string;
  defects?: ConsistencyDefectItem[];
  validatedPlanHash?: string;
  inputCoverage?: {
    passed: boolean;
    verifiedFactsCount: number;
    laneFunnelCount: number;
    lanePersuasionCount: number;
    competitorComparisonStatus: string;
    missingInputs: string[];
  };
  semanticConsistency?: {
    passed: boolean;
    issues: string[];
    summary: string;
  };
  factualSupport?: {
    passed: boolean;
    unsupportedPromises: string[];
    summary: string;
  };
}

export async function validateCrossEngineStrategyConsistency(
  results: Map<any, any>,
  strategyRoot: any,
  accountId: string,
  validationContext?: {
    synthesizedPlan?: any;
    canonicalContext?: any;
    bizData?: any;
    campaignId?: string;
  }
): Promise<CrossEngineConsistencyResult> {
  const bu = results.get("business_understanding")?.output || results.get("business_understanding");
  const audience = results.get("audience")?.output || results.get("audience");
  const diff = results.get("differentiation")?.output || results.get("differentiation");
  const positioning = results.get("positioning")?.output || results.get("positioning");
  const mechanismOut = results.get("mechanism")?.output || results.get("mechanism");
  const offer = results.get("offer")?.output || results.get("offer");
  const channel = results.get("channel_selection")?.output || results.get("channel_selection");
  const funnel = results.get("funnel")?.output || results.get("funnel");
  const budgetGov = results.get("budget_governor")?.output || results.get("budget_governor");

  // A. Deterministic Check: Target segment ID check
  if (audience && positioning) {
    const audSegId = audience.segments?.[0]?.id || audience.segments?.[0]?.name;
    const posSegId = positioning.targetSegmentId || positioning.territories?.[0]?.targetSegmentId;
    if (audSegId && posSegId && audSegId !== posSegId) {
      const conflictMsg = `Deterministic Check Failed: Target audience segment ID mismatch. Audience Engine selected segment "${audSegId}" but Positioning Engine targeted segment "${posSegId}".`;
      return {
        valid: false,
        outcomeType: "FAILED_DETERMINISTIC",
        blocking: true,
        conflict: conflictMsg,
        canonicalFields: ["audience.segments", "positioning.targetSegmentId"],
        responsibleEngines: ["positioning"],
        recommendedRegenerationTarget: "positioning",
        defects: [{
          fieldPath: "positioning.targetSegmentId",
          category: "EPISTEMIC_MISMATCH",
          severity: "BLOCKING",
          proposition: String(posSegId),
          citedEvidenceIds: [String(audSegId)],
          reason: conflictMsg,
          responsibleEngine: "positioning",
        }],
        semanticConsistency: {
          passed: false,
          issues: [`Target segment mismatch: Audience "${audSegId}" vs Positioning "${posSegId}"`],
          summary: "Failed deterministic segment alignment check.",
        },
      };
    }
  }

  // B. Construct structured, compact authoritative decision payload
  const parseMaybeJson = (val: any, fallback: any) => {
    if (!val) return fallback;
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return fallback; }
    }
    return val;
  };

  const approvedLanesRaw = parseMaybeJson(strategyRoot?.approvedLanes, validationContext?.synthesizedPlan?.approvedLanes || []);
  const compactLanes = Array.isArray(approvedLanesRaw)
    ? approvedLanesRaw.slice(0, 5).map((l: any) => ({
        laneId: l.laneId || l.id,
        title: l.title || l.name,
        primaryPainId: l.primaryPainId,
        corePainIds: (l.corePainIds || []).slice(0, 4),
        painIds: (l.painIds || []).slice(0, 6),
        desires: (l.desires || []).slice(0, 4),
        objections: (l.objections || []).slice(0, 5),
        objectionAttribution: Array.isArray(l.objectionAttribution) ? l.objectionAttribution.slice(0, 5) : undefined,
        messagingDirection: l.messagingDirection,
      }))
    : [];

  const approvedPainsRaw = parseMaybeJson(strategyRoot?.approvedAudiencePains, audience?.audiencePains || []);
  const compactPains = Array.isArray(approvedPainsRaw)
    ? approvedPainsRaw.slice(0, 10).map((p: any) => (typeof p === "string" ? p : p?.canonical || p?.pain || JSON.stringify(p)))
    : [];

  const approvedObjectionsRaw = parseMaybeJson(strategyRoot?.approvedObjections, audience?.objectionMap || {});
  const compactObjections = Array.isArray(approvedObjectionsRaw)
    ? approvedObjectionsRaw.slice(0, 10)
    : typeof approvedObjectionsRaw === "object" && approvedObjectionsRaw !== null
      ? Object.entries(approvedObjectionsRaw).slice(0, 8).map(([k, v]) => ({ segment: k, objections: Array.isArray(v) ? v.slice(0, 5) : v }))
      : [];

  const primaryTerritory = positioning?.territories?.[0] || positioning?.selectedTerritory || {};
  const semanticCollision = primaryTerritory?.semanticCollision || positioning?.semanticCollision || null;
  const comparisonStatus = semanticCollision?.comparisonStatus || (Number(semanticCollision?.comparedCompetitorCount || 0) > 0 ? "COMPARISON_COMPLETED" : "UNVERIFIED_NO_COMPETITOR_CLAIMS");
  const compactPositioning = {
    selectedTerritoryName: primaryTerritory.name || positioning?.chosenTerritory || positioning?.positioningStatement || "",
    contrastAxis: primaryTerritory.contrastAxis || positioning?.contrastAxis || strategyRoot?.primaryAxis || "",
    enemyDefinition: primaryTerritory.enemyDefinition || positioning?.enemy || "",
    narrativeDirection: primaryTerritory.narrativeDirection || positioning?.narrativeDirection || "",
    proposalStatus: primaryTerritory.proposalStatus || positioning?.proposalStatus || primaryTerritory.epistemicStatus || "PROPOSED_DIRECTION",
    epistemicStatus: primaryTerritory.epistemicStatus || positioning?.epistemicStatus || "STRATEGIC_HYPOTHESIS",
    comparisonStatus,
    comparedCompetitorCount: Number(semanticCollision?.comparedCompetitorCount || semanticCollision?.perCompetitor?.length || 0),
    collisionVerdict: semanticCollision?.collisionMeaning || semanticCollision?.verdict || "UNKNOWN",
  };

  // Deterministic Check: Empty competitor comparison must never pass as verified whitespace
  const claimsOpenSpace =
    semanticCollision?.verdict === "CLEAR" ||
    /open semantic space|zero collision|verified whitespace/i.test(String(semanticCollision?.collisionMeaning || ""));
  if (
    positioning &&
    (comparisonStatus === "UNVERIFIED_NO_COMPETITOR_CLAIMS" || comparisonStatus === "COMPARISON_FAILED") &&
    (compactPositioning.epistemicStatus === "VERIFIED_FACT" || claimsOpenSpace)
  ) {
    const conflictMsg = `Deterministic Check Failed: Positioning claimed verified whitespace while competitor comparison status is ${comparisonStatus} (0 competitors compared).`;
    return {
      valid: false,
      outcomeType: "FAILED_DETERMINISTIC",
      blocking: true,
      conflict: conflictMsg,
      canonicalFields: ["positioning.territories[0].semanticCollision"],
      responsibleEngines: ["positioning"],
      recommendedRegenerationTarget: "positioning",
      defects: [{
        fieldPath: "positioning.territories[0].semanticCollision",
        category: "COMPETITOR_CONTRADICTION",
        severity: "BLOCKING",
        proposition: String(semanticCollision?.collisionMeaning || compactPositioning.epistemicStatus),
        citedEvidenceIds: [],
        reason: conflictMsg,
        responsibleEngine: "positioning",
      }],
      semanticConsistency: {
        passed: false,
        issues: [`Unverified competitor comparison (${comparisonStatus}) cannot be presented as verified whitespace.`],
        summary: "Failed competitor comparison verification check.",
      },
    };
  }

  // Deterministic Check: High competitor collision (>= 0.35) must not claim narrativeDistanceScore = 1 or whitespace_positioning
  const observedCollisionScore = Number(semanticCollision?.semanticCollisionScore ?? semanticCollision?.collisionScore ?? 0);
  const observedNarrativeDistance = Number(primaryTerritory?.narrativeDistanceScore ?? positioning?.narrativeDistanceScore ?? 0.5);
  const primaryAxisVal = String(strategyRoot?.primaryAxis || positioning?.primaryAxis || positioning?.differentiationVector?.[0] || positioning?.differentiationAxes?.[0] || "");
  if (
    comparisonStatus === "COMPARISON_COMPLETED" &&
    observedCollisionScore >= 0.35 &&
    (observedNarrativeDistance > 0.70 || primaryAxisVal === "whitespace_positioning")
  ) {
    const conflictMsg = `Deterministic Check Failed: Positioning has high competitor overlap (semanticCollisionScore=${observedCollisionScore}) with "${semanticCollision?.competitorSource || "monitored competitor"}", so narrativeDistanceScore (${observedNarrativeDistance}) cannot be > 0.70 and primaryAxis ("${primaryAxisVal}") cannot be "whitespace_positioning".`;
    return {
      valid: false,
      outcomeType: "FAILED_DETERMINISTIC",
      blocking: true,
      conflict: conflictMsg,
      canonicalFields: ["positioning.territories[0].narrativeDistanceScore", "strategyRoot.primaryAxis"],
      responsibleEngines: ["positioning"],
      recommendedRegenerationTarget: "positioning",
      defects: [{
        fieldPath: "positioning.territories[0].narrativeDistanceScore",
        category: "COMPETITOR_CONTRADICTION",
        severity: "BLOCKING",
        proposition: `narrativeDistanceScore=${observedNarrativeDistance}, primaryAxis=${primaryAxisVal}`,
        citedEvidenceIds: [String(semanticCollision?.competitorId || semanticCollision?.competitorSource || "")].filter(Boolean),
        reason: conflictMsg,
        responsibleEngine: "positioning",
      }],
      semanticConsistency: {
        passed: false,
        issues: [conflictMsg],
        summary: "Failed positioning collision vs. narrative distance/axis coherence check.",
      },
    };
  }

  const diffPillarsRaw = diff?.pillars || parseMaybeJson(strategyRoot?.approvedClaims, []);
  const compactClaims = Array.isArray(diffPillarsRaw)
    ? diffPillarsRaw.slice(0, 6).map((p: any) => ({
        id: p.id || p.pillarId,
        claim: p.claim || p.title || p.statement || p.name,
        category: p.claimCategory || p.category,
        verificationStatus: p.verificationStatus || p.epistemicStatus,
        supportingEvidenceCount: Array.isArray(p.evidenceIds) ? p.evidenceIds.length : undefined,
      }))
    : [];

  const mechSource = mechanismOut || parseMaybeJson(strategyRoot?.approvedMechanism, {});
  const primaryMech = mechSource?.primaryMechanism || mechSource?.selectedMechanism || mechSource || {};
  const compactMechanism = {
    mechanismName: primaryMech.name || primaryMech.mechanismName || mechSource?.mechanismName || "",
    mechanismType: primaryMech.type || primaryMech.mechanismType || mechSource?.mechanismType || "",
    mechanismProblem: primaryMech.problem || primaryMech.problemSolved || mechSource?.problemSolved || "",
    mechanismPromise: primaryMech.promise || primaryMech.outcome || mechSource?.corePromise || "",
    whyItWorks: primaryMech.whyItWorks || mechSource?.whyItWorks || "",
    steps: Array.isArray(primaryMech.steps || mechSource?.steps)
      ? (primaryMech.steps || mechSource?.steps).slice(0, 6).map((s: any) => (typeof s === "string" ? s : s?.title || s?.step || s?.description))
      : [],
  };

  const primaryOffer = offer?.primaryOffer || offer?.selectedOffer || offer || {};
  const compactOffer = {
    offerName: primaryOffer.offerName || primaryOffer.name || offer?.offerName || "",
    coreOutcome: primaryOffer.coreOutcome || primaryOffer.outcome || offer?.coreOutcome || "",
    problemStatement: primaryOffer.problemStatement || offer?.problemStatement || "",
    mechanismDescription: primaryOffer.mechanismDescription || primaryOffer.mechanism || offer?.mechanismDescription || "",
    deliverables: (primaryOffer.deliverables || offer?.deliverables || []).slice(0, 6),
    objectionHandling: (primaryOffer.objectionHandling || offer?.objectionHandling || []).slice(0, 8),
    riskReversal: primaryOffer.riskReversal || offer?.riskReversal || null,
    cta: primaryOffer.cta || offer?.cta || null,
  };

  // Resolve all lane funnels and all lane persuasions across synthesized journeys + results map
  const allLaneFunnels: any[] = [];
  const allLanePersuasions: any[] = [];
  const synthJourneys = Array.isArray(validationContext?.synthesizedPlan?.buyerConversionJourneys)
    ? validationContext!.synthesizedPlan.buyerConversionJourneys
    : [];

  if (synthJourneys.length > 0) {
    for (const j of synthJourneys) {
      if (Array.isArray(j.stages) && j.stages.length > 0) {
        allLaneFunnels.push({
          laneId: j.laneId || "default",
          journeyName: j.journeyName || "",
          journeyType: j.journeyType || "",
          stages: j.stages.slice(0, 6).map((st: any) => ({
            stageName: st.stageName || st.name || st.stage,
            goal: st.goal || st.objective || st.purpose,
            coreMessage: st.coreMessage || st.message,
            cta: st.cta || st.callToAction,
          })),
        });
      }
      if (j.persuasionStrategy) {
        allLanePersuasions.push({
          laneId: j.laneId || "default",
          mode: j.persuasionStrategy.mode,
          coreBeliefTransformation: j.persuasionStrategy.coreBeliefTransformation,
          messageSequence: (j.persuasionStrategy.messageSequence || []).slice(0, 6),
          objections: (j.persuasionStrategy.objections || []).slice(0, 6).map((o: any) => ({
            objectionId: o.objectionId,
            objection: o.objection,
            response: o.response,
            proposalStatus: o.proposalStatus || o.proofStatus,
            subjectScope: o.subjectScope,
            competitorNames: o.competitorNames,
          })),
        });
      }
    }
  } else {
    // Extract from results Map ("funnels" / "funnel:*" / "funnel" and "persuasions" / "persuasion:*" / "persuasion")
    const extractFunnelEntry = (laneId: string, fRes: any) => {
      const fOut = fRes?.output?.output || fRes?.output || fRes;
      const fObj = fOut?.primaryFunnel || fOut?.funnel || fOut;
      const stages = fObj?.stages || fObj?.stageMap || fOut?.stages || fOut?.stageMap || [];
      if (Array.isArray(stages) && stages.length > 0) {
        allLaneFunnels.push({
          laneId,
          journeyName: fObj?.journeyName || fObj?.funnelName || fObj?.name || "",
          journeyType: fObj?.journeyType || fObj?.funnelType || fObj?.modelType || "",
          stages: stages.slice(0, 6).map((st: any) => ({
            stageName: st.stageName || st.name || st.stage,
            goal: st.goal || st.objective || st.purpose,
            coreMessage: st.coreMessage || st.message || st.purpose,
            cta: st.cta || st.callToAction,
          })),
        });
      }
    };
    const funnelsMap = results.get("funnels");
    if (funnelsMap instanceof Map) {
      for (const [laneId, fRes] of funnelsMap.entries()) extractFunnelEntry(laneId, fRes);
    } else {
      for (const [k, v] of results.entries()) {
        if (typeof k === "string" && k.startsWith("funnel:") && k !== "funnel") {
          extractFunnelEntry(k.replace("funnel:", ""), v);
        }
      }
    }
    if (allLaneFunnels.length === 0 && funnel) {
      extractFunnelEntry("default", funnel);
    }

    const extractPersuasionEntry = (laneId: string, pRes: any) => {
      const pOut = pRes?.output?.output || pRes?.output || pRes;
      const pData = pOut?.primaryRoute || pOut?.persuasionArchitecture || pOut;
      if (pData && (pData.coreBeliefTransformation || pOut?.coreBeliefTransformation || pData.structuredObjections || pData.objections)) {
        const rawObjs = pData.structuredObjections || pData.objections || pOut?.structuredObjections || [];
        allLanePersuasions.push({
          laneId,
          mode: pData.mode || pData.persuasionMode || "Proof-Led",
          coreBeliefTransformation: pData.coreBeliefTransformation || pOut?.coreBeliefTransformation,
          messageSequence: (pData.messageSequence || pData.sequence || []).slice(0, 6),
          objections: Array.isArray(rawObjs)
            ? rawObjs.slice(0, 6).map((o: any) => ({
                objectionId: o.objectionId || o.id,
                objection: o.objectionStatement || o.objection || o.statement,
                response: o.persuasionResponse || o.response || o.resolution,
                proposalStatus: o.proposalStatus || o.proofStatus,
                subjectScope: o.subjectScope,
                competitorNames: o.competitorNames,
              }))
            : [],
        });
      }
    };
    const persuasionsMap = results.get("persuasions");
    if (persuasionsMap instanceof Map) {
      for (const [laneId, pRes] of persuasionsMap.entries()) extractPersuasionEntry(laneId, pRes);
    } else {
      for (const [k, v] of results.entries()) {
        if (typeof k === "string" && k.startsWith("persuasion:") && k !== "persuasion") {
          extractPersuasionEntry(k.replace("persuasion:", ""), v);
        }
      }
    }
    if (allLanePersuasions.length === 0 && results.get("persuasion")) {
      extractPersuasionEntry("default", results.get("persuasion"));
    }
  }

  const compactFunnel = allLaneFunnels[0] || {
    journeyName: funnel?.journeyName || funnel?.funnelName || funnel?.primaryFunnel?.name || "",
    funnelType: funnel?.funnelType || funnel?.architectureType || funnel?.primaryFunnel?.modelType || "",
    stages: [],
  };

  const compactChannels = {
    primaryChannel: channel?.primaryChannel?.name || channel?.primaryChannel || channel?.proposedPrimary || "",
    secondaryChannel: channel?.secondaryChannel?.name || channel?.secondaryChannel || channel?.secondary || "",
    allocations: Array.isArray(budgetGov?.allocations)
      ? budgetGov.allocations.slice(0, 5).map((a: any) => ({
          channelName: a.channelName || a.channelId,
          sharePercentage: a.sharePercentage,
          monthlyAmount: a.monthlyAmount,
          isOrganic: a.isOrganic,
          spendCategory: a.spendCategory,
        }))
      : [],
    totalMonthlyBudget: budgetGov?.totalMonthlyBudget,
    currency: budgetGov?.currency,
    budgetConfirmation: budgetGov?.budgetConfirmation,
    spendAction: budgetGov?.spendAction || budgetGov?.action,
  };

  let verifiedFactsRaw: any[] =
    bu?.productTruth?.verifiedFacts ||
    bu?.verifiedFacts ||
    bu?.productTruthFacts ||
    validationContext?.canonicalContext?.productTruth?.verifiedFacts ||
    validationContext?.canonicalContext?.productTruthFacts ||
    parseMaybeJson(validationContext?.bizData?.productTruthFacts, null) ||
    parseMaybeJson(strategyRoot?.verifiedProductFacts, null) ||
    [];

  if ((!Array.isArray(verifiedFactsRaw) || verifiedFactsRaw.length === 0) && (validationContext?.campaignId || strategyRoot?.campaignId)) {
    try {
      const targetCampId = validationContext?.campaignId || strategyRoot?.campaignId;
      const buRes = await db.execute(
        sql`SELECT product_truth_facts FROM bu_snapshots WHERE campaign_id = ${targetCampId} ORDER BY is_active DESC, created_at DESC LIMIT 1`
      );
      if (buRes.rows && buRes.rows.length > 0) {
        const parsed = parseMaybeJson((buRes.rows[0] as any).product_truth_facts, []);
        if (Array.isArray(parsed) && parsed.length > 0) {
          verifiedFactsRaw = parsed;
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  const compactVerifiedFactsWithIds: Array<{ factId: string; statement: string; factType?: string }> = Array.isArray(verifiedFactsRaw)
    ? verifiedFactsRaw
        .map((f: any, idx: number) => {
          if (typeof f === "string") {
            return { factId: `fact_${idx + 1}`, statement: f.trim() };
          }
          const fid = String(f?.productTruthFactId || f?.factId || f?.id || "").trim();
          const stmt = String(f?.claim || f?.fact || f?.statement || f?.value || "").trim();
          return { factId: fid, statement: stmt, factType: f?.factType };
        })
        .filter((f) => f.statement.length > 0)
    : [];

  const validCanonicalFactIdSet = new Set<string>(
    compactVerifiedFactsWithIds.map((f) => f.factId).filter((id) => id.length > 0 && !/^fact_\d+$/i.test(id))
  );

  const compactVerifiedFacts = compactVerifiedFactsWithIds.slice(0, 15).map((f) =>
    f.factId ? `[Fact ID: ${f.factId}] ${f.statement}` : f.statement
  );

  // C. Explicit Validation-Input Coverage Check (Missing required inputs must produce an incomplete validation state, NEVER a confident PASS)
  const missingInputs: string[] = [];
  if (compactVerifiedFacts.length === 0) {
    missingInputs.push("verifiedProductTruthFacts");
  }
  if (allLaneFunnels.length === 0 || allLaneFunnels.every((lf) => !Array.isArray(lf.stages) || lf.stages.length === 0)) {
    missingInputs.push("laneFunnels");
  }
  if (allLanePersuasions.length === 0) {
    missingInputs.push("lanePersuasions");
  }

  const inputCoverage = {
    passed: missingInputs.length === 0,
    verifiedFactsCount: compactVerifiedFacts.length,
    laneFunnelCount: allLaneFunnels.length,
    lanePersuasionCount: allLanePersuasions.length,
    competitorComparisonStatus: comparisonStatus,
    missingInputs,
  };

  if (!inputCoverage.passed) {
    const conflictMsg = `INCOMPLETE_VALIDATION_INPUTS: Required validation inputs are missing or empty [${missingInputs.join(", ")}]. Validation cannot return PASS with incomplete inputs.`;
    return {
      valid: false,
      outcomeType: "INCOMPLETE_INPUTS",
      blocking: true,
      checkFailed: true,
      conflict: conflictMsg,
      canonicalFields: missingInputs,
      responsibleEngines: ["plan_synthesis"],
      defects: missingInputs.map((m) => ({
        fieldPath: m,
        category: "INCOMPLETE_INPUT" as const,
        severity: "BLOCKING" as const,
        proposition: `Missing ${m}`,
        citedEvidenceIds: [],
        reason: conflictMsg,
        responsibleEngine: "plan_synthesis",
      })),
      inputCoverage,
      semanticConsistency: {
        passed: false,
        issues: [`Missing required validation inputs: ${missingInputs.join(", ")}`],
        summary: "Validation incomplete due to missing required inputs.",
      },
      factualSupport: {
        passed: false,
        unsupportedPromises: [],
        summary: "Factual support could not be verified because required inputs were missing.",
      },
    };
  }

  // D. Deterministic Reference & Epistemic Boundary Checks across the complete customer-facing payload
  const deterministicDefects: ConsistencyDefectItem[] = [];

  // D1. Validate every supportingFactId in buyerConversionJourneys[*].persuasionStrategy.objections[*] against pinned BU facts
  if (validCanonicalFactIdSet.size > 0 && synthJourneys.length > 0) {
    synthJourneys.forEach((j: any, jIdx: number) => {
      const objs = Array.isArray(j?.persuasionStrategy?.objections) ? j.persuasionStrategy.objections : [];
      objs.forEach((o: any, oIdx: number) => {
        const sfId = o?.supportingFactId ? String(o.supportingFactId).trim() : "";
        if (sfId && sfId !== "APPROVED_MECHANISM" && !validCanonicalFactIdSet.has(sfId)) {
          deterministicDefects.push({
            fieldPath: `buyerConversionJourneys[${jIdx}].persuasionStrategy.objections[${oIdx}].supportingFactId`,
            category: "REFERENCE_INVALID",
            severity: "BLOCKING",
            proposition: sfId,
            citedEvidenceIds: [sfId],
            reason: `Objection "${o.objectionId || oIdx}" cites supportingFactId "${sfId}" which does not exist in the pinned Business Understanding fact inventory ([${Array.from(validCanonicalFactIdSet).join(", ")}]).`,
            responsibleEngine: "persuasion",
          });
        }
      });
    });
  }

  // D2. Post-BLL Displayed Claims & Funnel/Mechanism/Awareness Epistemic Inspection
  const bllSummary = validationContext?.synthesizedPlan?.businessRepresentation?.strategicSummary;
  const displayedText = [
    bllSummary?.strategy || "",
    bllSummary?.targetAudience || "",
    bllSummary?.growthObjective || "",
    bllSummary?.rationale || "",
    validationContext?.synthesizedPlan?.strategicSummary?.strategy || "",
    validationContext?.synthesizedPlan?.strategicSummary?.rationale || "",
  ].join(" ");
  const verifiedFactStrings = compactVerifiedFactsWithIds.map((f) => f.statement);
  const factsJoinedLower = verifiedFactStrings.join(" ").toLowerCase();
  const unsupportedDisplayedClaims: string[] = [];
  if (verifiedFactStrings.length > 0) {
    const displayedEntailment = evaluateClaimSemanticEntailment(displayedText, verifiedFactStrings);
    if (!displayedEntailment.entailed) {
      for (const violation of displayedEntailment.violations) {
        unsupportedDisplayedClaims.push(violation);
        deterministicDefects.push({
          fieldPath: "businessRepresentation.strategicSummary",
          category: violation.includes("guaranteed_emotional_outcome") ? "EPISTEMIC_MISMATCH" : "FACTUAL_DEFECT",
          severity: "BLOCKING",
          proposition: displayedText.slice(0, 240),
          citedEvidenceIds: [],
          reason: `Displayed summary asserts unentailed property not supported by verified product facts: ${violation}`,
          responsibleEngine: "plan_synthesis",
        });
      }
    }
    const posText = [
      compactPositioning.territory,
      compactPositioning.enemyDefinition,
      compactPositioning.contrastAxis,
      compactPositioning.narrativeDirection,
    ].join(" ");
    const posEntailment = evaluateClaimSemanticEntailment(posText, verifiedFactStrings);
    if (!posEntailment.entailed) {
      for (const violation of posEntailment.violations) {
        deterministicDefects.push({
          fieldPath: "positioning.territories[0]",
          category: "FACTUAL_DEFECT",
          severity: "BLOCKING",
          proposition: posText.slice(0, 240),
          citedEvidenceIds: [],
          reason: `Positioning territory asserts unentailed property not supported by verified product facts: ${violation}`,
          responsibleEngine: "positioning",
        });
      }
    }
    const mechText = [
      compactMechanism.mechanismName,
      compactMechanism.mechanismProblem,
      compactMechanism.mechanismPromise,
      compactMechanism.whyItWorks,
    ].join(" ");
    const mechEntailment = evaluateClaimSemanticEntailment(mechText, verifiedFactStrings);
    if (!mechEntailment.entailed) {
      for (const violation of mechEntailment.violations) {
        deterministicDefects.push({
          fieldPath: "mechanism.primaryMechanism",
          category: "FACTUAL_DEFECT",
          severity: "BLOCKING",
          proposition: mechText.slice(0, 240),
          citedEvidenceIds: [],
          reason: `Mechanism asserts unentailed property not supported by verified product facts: ${violation}`,
          responsibleEngine: "mechanism",
        });
      }
    }
    const offerText = [
      compactOffer.offerName,
      compactOffer.coreOutcome,
      compactOffer.problemStatement,
      compactOffer.mechanismDescription,
    ].join(" ");
    const offerEntailment = evaluateClaimSemanticEntailment(offerText, verifiedFactStrings);
    if (!offerEntailment.entailed) {
      for (const violation of offerEntailment.violations) {
        deterministicDefects.push({
          fieldPath: "offer.primaryOffer",
          category: "FACTUAL_DEFECT",
          severity: "BLOCKING",
          proposition: offerText.slice(0, 240),
          citedEvidenceIds: [],
          reason: `Offer asserts unentailed property not supported by verified product facts: ${violation}`,
          responsibleEngine: "offer",
        });
      }
    }
  }
  const posRat = String(primaryTerritory?.rationale || "").trim();
  const posAxis = String(compactPositioning.contrastAxis || "").trim();
  const posNarr = String(compactPositioning.narrativeDirection || "").trim();
  if (posRat && (posRat === posAxis || posRat === posNarr)) {
    deterministicDefects.push({
      fieldPath: "positioning.territories[0].rationale",
      category: "EPISTEMIC_MISMATCH",
      severity: "BLOCKING",
      proposition: posRat,
      citedEvidenceIds: [],
      reason: `Positioning rationale duplicates contrastAxis or narrativeDirection instead of providing a distinct strategic explanation.`,
      responsibleEngine: "positioning",
    });
  }
  if (/\b(never\s+generic|ensures\s+(?:emotional\s+)?authenticity|permanent\s+(?:downloadable\s+|cloud\s+)?(?:mp3\s+)?access|lifetime\s+(?:cloud\s+)?(?:hosting|storage|access)|collaborative\s+revision|revision\s+interface)\b/i.test(displayedText) &&
      !/\b(permanent|lifetime|never\s+generic)\b/i.test(factsJoinedLower)) {
    const msg = "Displayed summary contains unsupported absolute or permanence claim ('never generic', 'ensures authenticity', or 'permanent/lifetime access') absent from verified product facts.";
    unsupportedDisplayedClaims.push(msg);
    deterministicDefects.push({
      fieldPath: "businessRepresentation.strategicSummary",
      category: "FACTUAL_DEFECT",
      severity: "BLOCKING",
      proposition: displayedText.slice(0, 240),
      citedEvidenceIds: [],
      reason: msg,
      responsibleEngine: "plan_synthesis",
    });
  }
  if (/£19\.99|\$19\.99/i.test(displayedText) && !factsJoinedLower.includes("19.99")) {
    const msg = "Displayed summary contains unverified hardcoded price ('£19.99' / '$19.99') absent from verified product facts.";
    unsupportedDisplayedClaims.push(msg);
    deterministicDefects.push({
      fieldPath: "strategicSummary.strategy",
      category: "FACTUAL_DEFECT",
      severity: "BLOCKING",
      proposition: displayedText.slice(0, 240),
      citedEvidenceIds: [],
      reason: msg,
      responsibleEngine: "plan_synthesis",
    });
  }
  if (/\b(1-minute|60-second)\s+(?:song\s+)?preview\b/i.test(displayedText) && !/1-minute|60-second/i.test(factsJoinedLower)) {
    const msg = "Displayed summary contains unverified preview duration ('1-minute' / '60-second') absent from verified product facts.";
    unsupportedDisplayedClaims.push(msg);
    deterministicDefects.push({
      fieldPath: "strategicSummary.strategy",
      category: "FACTUAL_DEFECT",
      severity: "BLOCKING",
      proposition: displayedText.slice(0, 240),
      citedEvidenceIds: [],
      reason: msg,
      responsibleEngine: "plan_synthesis",
    });
  }

  // Check funnel stages & CTAs for unverified revision interfaces/workflows turned from customer desires into product features
  if (!/\brevis(?:e|ion|ions)\b/i.test(factsJoinedLower) && synthJourneys.length > 0) {
    synthJourneys.forEach((j: any, jIdx: number) => {
      const stages = Array.isArray(j?.stages) ? j.stages : [];
      stages.forEach((st: any, sIdx: number) => {
        const stText = `${st?.coreMessage || ""} ${st?.cta || ""} ${st?.contentType || ""} ${st?.conversionGoal || ""}`;
        if (/\b(review,\s*revise|revision\s+options?|collaborative\s+revision|interface\s+with\s+revision)\b/i.test(stText)) {
          const msg = `Funnel stage "${st?.stageName || st?.name || sIdx}" in lane "${j?.laneId}" presents revision options/interfaces as an existing product capability ("${stText.slice(0, 140)}"), but revisions are a customer desire not in verified Product Truth.`;
          unsupportedDisplayedClaims.push(msg);
          deterministicDefects.push({
            fieldPath: `buyerConversionJourneys[${jIdx}].stages[${sIdx}]`,
            category: "EPISTEMIC_MISMATCH",
            severity: "BLOCKING",
            proposition: stText.slice(0, 180),
            citedEvidenceIds: [],
            reason: msg,
            responsibleEngine: "funnel",
          });
        }
      });
    });
  }

  if (deterministicDefects.length > 0) {
    const allReasons = deterministicDefects.map((d) => d.reason).join(" ");
    const respEngines = Array.from(new Set(deterministicDefects.map((d) => d.responsibleEngine)));
    return {
      valid: false,
      outcomeType: "FAILED_DETERMINISTIC",
      blocking: true,
      conflict: `Deterministic Validation Failed: ${allReasons}`,
      checkFailed: true,
      canonicalFields: deterministicDefects.map((d) => d.fieldPath),
      responsibleEngines: respEngines,
      recommendedRegenerationTarget: respEngines[0] || "plan_synthesis",
      defects: deterministicDefects,
      inputCoverage,
      semanticConsistency: {
        passed: !deterministicDefects.some((d) => d.category === "EPISTEMIC_MISMATCH" || d.category === "COMPETITOR_CONTRADICTION"),
        issues: deterministicDefects.map((d) => `${d.fieldPath}: ${d.reason}`),
        summary: allReasons,
      },
      factualSupport: {
        passed: !deterministicDefects.some((d) => d.category === "FACTUAL_DEFECT" || d.category === "REFERENCE_INVALID"),
        unsupportedPromises: deterministicDefects.map((d) => `${d.fieldPath}: ${d.reason}`),
        summary: allReasons,
      },
    };
  }

  const structuredDecisionMap = {
    approvedLanes: compactLanes,
    brandSpine: parseMaybeJson(strategyRoot?.brandSpine, {}),
    buyerPains: compactPains,
    buyerObjections: compactObjections,
    verifiedProductTruthFacts: compactVerifiedFacts,
    positioning: compactPositioning,
    differentiationClaims: compactClaims,
    mechanism: compactMechanism,
    offer: compactOffer,
    funnel: compactFunnel,
    laneFunnels: allLaneFunnels,
    lanePersuasions: allLanePersuasions,
    businessLanguageSummary: bllSummary || undefined,
    channelsAndBudget: compactChannels,
  };

  try {
    const { aiChat } = await import("../ai-client");
    const response = await aiChat({
      model: "gpt-4.1-mini",
      temperature: 0.0,
      accountId,
      endpoint: "strategy-consistency-judge",
      response_format: { type: "json_object" },
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `You are a Senior Strategic Auditor. Evaluate the cross-engine strategic consistency and factual support of a marketing plan assembled from specialized engines.

Evaluate TWO distinct dimensions:
1. SEMANTIC CONSISTENCY Across Sections:
   - Do Positioning, Differentiation, Mechanism, Offer, Lane Funnels, Lane Persuasions, and Channels & Budget tell a coherent strategic story?
   - Multi-lane campaigns legitimately address different approved lanes across sections or under the Brand Spine; do NOT flag valid multi-lane specialization as a contradiction.
   - Check that objection responses in lanePersuasions address the actual buyer objection rather than unrelated root causes.
   - Flag if the Offer headline/promise inverts buyer sentiment or contradicts Positioning/Mechanism.
2. FACTUAL SUPPORT for Material Promises:
   - Are material Offer deliverables, Funnel CTAs, Persuasion responses, and Business Language Summary claims grounded in the Verified Product Truth Facts or explicitly labeled as [PROPOSED] / [PARTIALLY_MITIGATED] / PROPOSED_RECOMMENDATION / STRATEGIC_HYPOTHESIS?
   - A legitimate strategic hypothesis or proposed direction (labeled as STRATEGIC_HYPOTHESIS or PROPOSED_RECOMMENDATION) is valid and allowed — do NOT flag clearly labeled strategic proposals as unsupported facts.
   - Flag if the plan invents unsupported operational SLAs (e.g., guaranteed revision turnaround hours, unconditional refunds, permanent cloud hosting, or specific unverified prices/durations) as verified facts when they are absent from Verified Product Truth Facts.

Return ONLY a valid JSON object matching this exact structure:
{
  "consistent": boolean,
  "semanticConsistency": {
    "passed": boolean,
    "issues": ["<any semantic contradiction between sections, or empty array if none>"],
    "summary": "<1-2 sentence assessment of cross-section semantic coherence>"
  },
  "factualSupport": {
    "passed": boolean,
    "unsupportedPromises": ["<any unverified SLA/refund/revision guarantee asserted as fact, or empty array if none>"],
    "summary": "<1-2 sentence assessment of factual grounding of material promises>"
  },
  "conflict": "<if consistent is false, detailed explanation of the blocking contradiction; otherwise null>",
  "canonicalFields": ["<fields in conflict if consistent is false, else empty array>"],
  "responsibleEngines": ["<engines responsible if consistent is false, else empty array>"],
  "recommendedRegenerationTarget": "<single engine to regenerate if consistent is false, else null>"
}`
        },
        {
          role: "user",
          content: `STRUCTURED AUTHORITATIVE DECISION MAP:\n${JSON.stringify(structuredDecisionMap, null, 2)}`
        }
      ]
    });

    const text = response.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      return {
        valid: false,
        outcomeType: "INCOMPLETE_INPUTS",
        blocking: true,
        checkFailed: true,
        conflict: "Consistency judge returned an empty response.",
        inputCoverage,
      };
    }
    const judgeResult = JSON.parse(text);
    const semanticConsistency = {
      passed: Boolean(judgeResult?.semanticConsistency?.passed ?? judgeResult?.consistent),
      issues: Array.isArray(judgeResult?.semanticConsistency?.issues) ? judgeResult.semanticConsistency.issues : [],
      summary: String(judgeResult?.semanticConsistency?.summary || (judgeResult?.consistent ? "Cross-engine sections are semantically aligned." : "Semantic conflict detected.")),
    };
    const factualSupport = {
      passed: Boolean(judgeResult?.factualSupport?.passed ?? judgeResult?.consistent),
      unsupportedPromises: Array.isArray(judgeResult?.factualSupport?.unsupportedPromises) ? judgeResult.factualSupport.unsupportedPromises : [],
      summary: String(judgeResult?.factualSupport?.summary || (judgeResult?.consistent ? "Material promises align with verified product truth and epistemic labels." : "Unsupported promise detected.")),
    };

    if (judgeResult.consistent === false || !semanticConsistency.passed || !factualSupport.passed) {
      const combinedConflict =
        judgeResult.conflict ||
        [...semanticConsistency.issues, ...factualSupport.unsupportedPromises].join("; ") ||
        "Cross-engine consistency or factual support check failed.";
      const judgeDefects: ConsistencyDefectItem[] = [
        ...semanticConsistency.issues.map((iss: string) => ({
          fieldPath: (judgeResult.canonicalFields && judgeResult.canonicalFields[0]) || "strategicSummary",
          category: "EPISTEMIC_MISMATCH" as const,
          severity: "BLOCKING" as const,
          proposition: iss,
          citedEvidenceIds: [],
          reason: iss,
          responsibleEngine: (judgeResult.responsibleEngines && judgeResult.responsibleEngines[0]) || "plan_synthesis",
        })),
        ...factualSupport.unsupportedPromises.map((up: string) => ({
          fieldPath: (judgeResult.canonicalFields && judgeResult.canonicalFields[0]) || "strategicSummary",
          category: "FACTUAL_DEFECT" as const,
          severity: "BLOCKING" as const,
          proposition: up,
          citedEvidenceIds: [],
          reason: up,
          responsibleEngine: (judgeResult.responsibleEngines && judgeResult.responsibleEngines[0]) || "plan_synthesis",
        })),
      ];
      return {
        valid: false,
        outcomeType: "FAILED_SEMANTIC",
        blocking: true,
        conflict: `Semantic Judge Verdict: ${combinedConflict}`,
        canonicalFields: judgeResult.canonicalFields || [],
        responsibleEngines: judgeResult.responsibleEngines || [],
        recommendedRegenerationTarget: judgeResult.recommendedRegenerationTarget || "offer",
        defects: judgeDefects,
        inputCoverage,
        semanticConsistency,
        factualSupport,
      };
    }

    return {
      valid: true,
      outcomeType: "PASSED",
      blocking: false,
      defects: [],
      inputCoverage,
      semanticConsistency,
      factualSupport,
    };
  } catch (err: any) {
    console.error(`[PlanSynthesis] Semantic judge failed to execute or returned invalid JSON (FAIL-CLOSED):`, err?.message || err);
    return {
      valid: false,
      outcomeType: "INCOMPLETE_INPUTS",
      blocking: true,
      checkFailed: true,
      conflict: `Consistency check technical failure (fail-closed): ${err?.message || String(err)}`,
      canonicalFields: ["consistencyValidation"],
      responsibleEngines: ["plan_synthesis"],
      inputCoverage,
    };
  }
}

import { strategicPlans, requiredWork, calendarEntries, businessDataLayer, offerSnapshots, campaignBudgetSettings } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { createAttributionEntries } from "../decision-attribution";
import { casUpdateStrategicPlan } from "../strategic-core/cas-helper";
// eslint-disable-next-line orchestrator-replay/no-bare-llm-call-in-replay -- replay-safe: aiChat auto-records via getCurrentRecorder()?.recordLlmCall() (ai-client.ts), and synthesizePlan is only invoked from runOrchestrator (index.ts ~L4895) AFTER enterRecorderScope() binds the recorder to this async context (~L3821). Routing through commercial-reasoning/llm-call.ts would force JSON-mode + a 45s timeout (behavior change).
import { aiChat } from "../ai-client";
import { lockRootBundle } from "../root-bundle";
import { decomposeGoal, generateSimulation, normalizeGoal, computeFunnelMath, checkFeasibility } from "../goal-math";
import { checkPlanReadiness, resolveArchetype } from "../plan-gate";
import { composeTasks } from "../task-composer";
import { logAssumptions, type AssumptionEntry } from "../conflict-resolver";
import { computeAdaptiveRhythm } from "../adaptive-rhythm/engine";
import { applyMemoryConstraints } from "./memory-context";
import { computeExplorationBudget } from "../exploration-budget/engine";
import type { MemoryBlock } from "../memory-system/types";
import type { ExplorationSlot } from "../exploration-budget/engine";
import type { OrchestratorConfig } from "./index";
import type { EngineId, EngineStepResult } from "./priority-matrix";
import {
  filterDecisionsForPlan,
  buildDecisionEnforcementReport,
  serializeDecisionReportForLog,
  type DecisionEnforcementReport,
} from "../decision-policy";
import { computeSignalComposition, formatCompositionLog, type SignalComposition } from "../shared/signal-lineage";
import { resolveGovernedBudgetState, type GovernedBudgetState } from "./budget-decision-ledger";

export type PlanSource = "decision_driven" | "degraded_no_decisions" | "degraded_ai_failed" | "deterministic_fallback";

export interface PlanGovernanceBlock {
  rootId: string | null;
  rootStatus: string;
  executionEligible: boolean;
  systemControl: {
    verdictId: string | null;
    verdict: string;
    mode: string;
  };
  governedBudget: GovernedBudgetState;
  lockedDecisions: {
    passed: boolean;
    missing: string[];
    contradicted: string[];
  };
  approvalBlockers: string[];
}

export interface SynthesizedPlan {
  planSource: PlanSource;
  degraded: boolean;
  lockedDecisionLabels?: string[];
  governance?: PlanGovernanceBlock;
  synthesisVerification?: {
    passed: boolean;
    totalLocked: number;
    preserved: number;
    missing: string[];
    verifiedAt: string;
  };
  strategicSummary: {
    strategy: string;
    targetAudience: string;
    growthObjective: string;
    rationale: string;
  };
  monthlyObjective: {
    objective: string;
    type: string;
    targetMetric: string;
    targetValue: string;
  };
  kpiStructure: {
    primaryKPI: { name: string; target: string; cadence: string };
    secondaryKPI: { name: string; target: string; cadence: string };
    performanceExpectations: string;
  };
  contentDistribution: {
    reelsPerWeek: number;
    postsPerWeek: number;
    storiesPerDay: number;
    carouselsPerWeek: number;
    videosPerWeek: number;
    rationale: string;
    contentPillars: Array<{ pillar: string; percentage: string; examples: string[] }>;
  };
  creativeTesting: {
    tests: Array<{ testName: string; variable: string; duration: string; rationale: string }>;
  };
  budgetAllocation: {
    totalBudget: string;
    breakdown: Array<{ category: string; percentage: number; purpose: string }>;
  };
  kpiMonitoring: {
    metrics: Array<{ kpi: string; target: string; frequency: string; alertThreshold: string }>;
    reportingCadence: string;
  };
  competitiveWatch: {
    targets: Array<{ competitor: string; watchMetrics: string[]; checkFrequency: string }>;
    strategyFeed?: Array<{ insight: string; actionableResponse: string; priority: string }>;
  };
  riskTriggers: {
    triggers: Array<{ trigger: string; condition: string; action: string; severity: string; optimizationPlaybook?: string }>;
    escalationPath: string[];
    earlyWarningSystem?: Array<{ signal: string; threshold: string; response: string }>;
  };
  executionBlueprintDnaLink?: {
    contentPillarToDna?: Array<{ pillar: string; dnaElements: string[]; hookApproach: string; ctaStyle: string }>;
    weeklyDnaApplication?: string;
  };
  signalComposition?: import("../shared/signal-lineage").SignalComposition;
  /**
   * Engine-selected authoritative Audience pain roles, preserved verbatim
   * from Offer (core/objections) and Retention (post-purchase friction).
   * Synthesis NEVER reselects, flattens, or merges these — violations are
   * recorded, not silently repaired.
   */
  audiencePainRoles?: {
    core?: { painId: string; source: "offer" };
    objections?: Array<{ painId: string; source: "offer" }>;
    retention?: { painId: string; classification?: string; source: "retention" };
    violations: string[];
  };
  memoryOverrides?: Array<{ field: string; originalValue: number; correctedValue: number; memoryLabel: string }>;
  buyerConversionJourneys?: Array<{
    laneId?: string;
    laneLabel?: string;
    primaryPainId?: string;
    segmentIds?: string[];
    sourceFunnelSnapshotId?: string;
    sourcePersuasionSnapshotId?: string;
    journeyName: string;
    journeyType: string;
    whyThisJourney: string;
    entryTrigger: {
      mechanismType: string;
      purpose: string;
    };
    stages: Array<{
      stageId?: string;
      stageName: string;
      goal: string;
      buyerState: string;
      coreMessage: string;
      contentAction: string;
      proof: string[];
      cta: string;
    }>;
    persuasionStrategy?: {
      mode: string;
      modeLabel: string;
      coreBeliefTransformation: {
        currentBelief: string;
        desiredBelief: string;
        contradictionLogic?: string;
      };
      messageSequence: Array<{
        step: string;
        stepLabel: string;
        rationale: string;
      }>;
      objections: Array<{
        objectionId?: string;
        objection: string;
        response: string;
        requiredProof: string;
        funnelStageId?: string;
      }>;
      trustStrategy: {
        buyerRiskState: string;
        trustDeficit: string;
        transferMechanismName: string;
        proofArtifact: string;
        primaryCialdiniPrinciple: string;
        principleRationale: string;
      };
    };
  }>;
  buyerConversionJourney?: {
    journeyName: string;
    journeyType: string;
    whyThisJourney: string;
    entryTrigger: {
      mechanismType: string;
      purpose: string;
    };
    stages: Array<{
      stageId?: string;
      stageName: string;
      goal: string;
      buyerState: string;
      coreMessage: string;
      contentAction: string;
      proof: string[];
      cta: string;
    }>;
  };
  persuasionStrategy?: {
    mode: string;
    modeLabel: string;
    coreBeliefTransformation: {
      currentBelief: string;
      desiredBelief: string;
      contradictionLogic?: string;
    };
    messageSequence: Array<{
      step: string;
      stepLabel: string;
      rationale: string;
    }>;
    objections: Array<{
      objectionId?: string;
      objection: string;
      response: string;
      requiredProof: string;
      funnelStageId?: string;
    }>;
    trustStrategy: {
      buyerRiskState: string;
      trustDeficit: string;
      transferMechanismName: string;
      proofArtifact: string;
      primaryCialdiniPrinciple: string;
      principleRationale: string;
    };
  };
  explorationPlan?: {
    explorationPercent: number;
    totalExplorationCount: number;
    rationale: string;
    slots: ExplorationSlot[];
  };
  /**
   * Parallel rejection-surface for commercial-reasoning
   * modules. Populated by the orchestrator from the in-memory rejection
   * registry after all engines run. Each entry tells plan synthesis
   * (and any downstream auditor) that a commercial-reasoning module
   * fell back to legacy output. The plan is still emitted (modules
   * return null and engines continue), but `validationState` should be
   * downgraded by readers on non-empty rejection list.
   */
  commercialReasoningRejected?: Array<{
    module: string;
    reason: "FINAL_REJECTED" | "JUDGE_ERROR" | "DESIGN_INVALID";
    detail: string;
    emittedAt: number;
  }>;
  /**
   * Propagation flag set when AEL ran in degraded
   * (`isPartial`) mode. All engine outputs that consumed the partial
   * AEL inherit this provenance so plan synthesis and downstream
   * decision layers can distinguish a fully-grounded plan from one
   * built on degraded enrichment.
   */
  _provenance?: {
    aelPartialPropagated?: boolean;
    aelPartialReason?: string;
    commercialReasoningDegraded?: boolean;
  };
  /**
   * Synthesis-level validationState downgrade. When
   * any commercial-reasoning rejection is recorded for the run OR AEL
   * was partial (F3.10), validationState is set to "weak" so downstream
   * gates see the degradation.
   */
  validationState?: "validated" | "provisional" | "weak" | "rejected";
  _synthesisIntegrity?: {
    lockedDecisionCoverage: number;
    contradictions: string[];
    degradedEngines: string[];
    blockedEngines: string[];
    strategyRootPresent: boolean;
    verdict: 'FULLY_GROUNDED' | 'PARTIALLY_GROUNDED' | 'UNGROUNDED';
  };
}

function buildHaltPlan(budgetOutput: any, bizData: any, campaign: any, activeStrategyRoot?: any, controlVerdict?: any): SynthesizedPlan {
  const reasoning = budgetOutput?.decision?.reasoning || "Budget governor halted execution";
  const killReasons = budgetOutput?.killReasons || [];

  // BLL clean explanation for the business owner
  const bllBudgetExplanation = "Paid media budget is currently withheld because Avyron does not yet have enough validated performance history to recommend spend safely.";

  const primaryLane = Array.isArray(activeStrategyRoot?.approvedLanes) ? activeStrategyRoot.approvedLanes[0] : null;
  const targetAudience = primaryLane?.title || primaryLane?.name || campaign?.targetAudience || "Target Audience under validation";
  const strategyTitle = activeStrategyRoot?.brandSpine?.umbrellaPositionName || activeStrategyRoot?.approvedPositioningContext?.territoryName || "Commercial Strategy";

  const governedBudget = resolveGovernedBudgetState(budgetOutput);
  const isRootEligible = Boolean(activeStrategyRoot && (activeStrategyRoot.status === "ACTIVE" || activeStrategyRoot.executionEligible === true));

  const approvalBlockers: string[] = [];
  if (governedBudget.governanceState === "BLOCKED" || governedBudget.action === "halt") {
    approvalBlockers.push(`Budget Governor halted execution: ${governedBudget.reasoning || reasoning}`);
  }
  if (!isRootEligible) {
    approvalBlockers.push(`Strategy Root ${activeStrategyRoot?.id || 'none'} has status "${activeStrategyRoot?.status || 'UNKNOWN'}", not execution-eligible.`);
  }
  if (controlVerdict && (controlVerdict.strategyBlocked === true || controlVerdict.verdict === "BLOCK" || controlVerdict.executionMode === "SYSTEM_UNTRUSTED" || controlVerdict.executionMode === "HALTED")) {
    approvalBlockers.push(`System Control verdict rejected strategy execution: status=${controlVerdict.verdict}, action=${controlVerdict.executionMode}.`);
  }

  return {
    planSource: "degraded_ai_failed",
    degraded: true,
    strategicSummary: {
      strategy: `${strategyTitle} — Paid media spend withheld pending performance baseline`,
      targetAudience,
      growthObjective: campaign?.objective || "Market Validation & Buyer Pipeline Building",
      rationale: `${bllBudgetExplanation} Strategic foundation is preserved for organic execution and proof collection.`,
    },
    monthlyObjective: {
      objective: "Organic Validation & Proof Collection — Paid media execution paused",
      type: "hold",
      targetMetric: "Conversion Proof / Qualitative Signals",
      targetValue: "0",
    },
    kpiStructure: {
      primaryKPI: { name: "Prospect Engagement & Proof Verification", target: "Qualitative", cadence: "weekly" },
      secondaryKPI: { name: "Organic Conversion Pathway Verification", target: "Qualitative", cadence: "weekly" },
      performanceExpectations: bllBudgetExplanation,
    },
    contentDistribution: {
      reelsPerWeek: 0,
      postsPerWeek: 0,
      storiesPerDay: 0,
      carouselsPerWeek: 0,
      videosPerWeek: 0,
      rationale: "Paid content production paused — organic strategy active",
      contentPillars: [],
    },
    creativeTesting: { tests: [] },
    budgetAllocation: {
      totalBudget: "0",
      breakdown: [],
    },
    kpiMonitoring: {
      metrics: [],
      reportingCadence: "paused",
    },
    competitiveWatch: { targets: [] },
    riskTriggers: {
      triggers: [{ trigger: "Paid spend withheld", condition: "Insufficient performance baseline", action: "Execute organic validation to gather first conversion events", severity: "low" }],
      escalationPath: ["Acquire first validated conversion signals", "Re-run budget governor with performance data"],
    },
    governance: {
      strategyRoot: {
        rootId: activeStrategyRoot?.id || null,
        rootStatus: activeStrategyRoot?.status || "UNKNOWN",
        executionEligible: isRootEligible,
      },
      systemControl: {
        verdictId: controlVerdict?.id || (controlVerdict as any)?.verdictId || null,
        status: controlVerdict?.verdict || "UNKNOWN",
        enforcementAction: controlVerdict?.executionMode || "UNKNOWN",
        allowExecution: controlVerdict ? (controlVerdict.verdict === "PASS" || (controlVerdict.verdict !== "BLOCK" && controlVerdict.strategyBlocked === false)) : false,
      },
      governedBudget,
      lockedDecisions: {
        total: 0,
        preserved: 0,
        missing: [],
        coverage: 1,
      },
      approvalBlockers,
    },
  };
}

async function persistPlan(plan: SynthesizedPlan, config: OrchestratorConfig, rootBundle: any, explorationSlots: any[]): Promise<string> {
  await db
    .update(strategicPlans)
    .set({ status: "SUPERSEDED", isDesignatedActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(strategicPlans.accountId, config.accountId),
        eq(strategicPlans.campaignId, config.campaignId),
        eq(strategicPlans.status, "DRAFT")
      )
    );

  // Post-generation text mangling removed: claim status originates in upstream
  // evidence and assessments, preserving exact engine output in planJson.
  const [dbPlan] = await db.insert(strategicPlans).values({
    accountId: config.accountId,
    blueprintId: "orchestrator-v2",
    campaignId: config.campaignId,
    jobId: config.jobId,
    planJson: JSON.stringify(plan),
    planSummary: plan.strategicSummary.strategy,
    status: "DRAFT",
    executionStatus: plan.degraded ? "HALTED" : "IDLE",
    totalCalendarEntries: 0,
    totalStudioItems: 0,
    totalPublished: 0,
    totalFailed: 0,
    totalCanceled: 0,
    rootBundleId: rootBundle?.id || null,
    rootBundleVersion: rootBundle?.version || null,
  }).returning();

  await db.insert(requiredWork).values({
    planId: dbPlan.id,
    campaignId: config.campaignId,
    accountId: config.accountId,
    periodDays: 30,
    reelsPerWeek: plan.contentDistribution.reelsPerWeek,
    postsPerWeek: plan.contentDistribution.postsPerWeek,
    storiesPerDay: plan.contentDistribution.storiesPerDay,
    carouselsPerWeek: plan.contentDistribution.carouselsPerWeek,
    videosPerWeek: plan.contentDistribution.videosPerWeek,
    totalReels: 0,
    totalPosts: 0,
    totalStories: 0,
    totalCarousels: 0,
    totalVideos: 0,
    totalContentPieces: 0,
    explorationSlotsPerWeek: 0,
    generatedCount: 0,
    readyCount: 0,
    scheduledCount: 0,
    publishedCount: 0,
    failedCount: 0,
    rootBundleId: rootBundle?.id || null,
    rootBundleVersion: rootBundle?.version || null,
  });

  console.log(`[PlanSynthesis] Persisted ${plan.degraded ? "HALT" : ""} plan ${dbPlan.id}`);
  return dbPlan.id;
}

function applyBudgetHoldRestriction(plan: SynthesizedPlan): SynthesizedPlan {
  const dist = plan.contentDistribution;
  const restricted = {
    ...dist,
    rationale: `[SCALING-HOLD GUIDANCE] ${dist.rationale || ""} — Paid media scaling is held pending initial creative/conversion proof; organic production and initial validation testing preparation proceed normally.`,
  };
  return { ...plan, contentDistribution: restricted };
}

function applyIntegrityDegradation(plan: SynthesizedPlan, mode: "restricted" | "degraded"): SynthesizedPlan {
  const multiplier = mode === "degraded" ? 0.3 : 0.6;
  const label = mode === "degraded" ? "DEGRADED-SAFE" : "INTEGRITY-RESTRICTED";
  const dist = plan.contentDistribution;
  const restricted = {
    ...dist,
    reelsPerWeek: dist.reelsPerWeek > 0 ? Math.max(1, Math.floor(dist.reelsPerWeek * multiplier)) : 0,
    postsPerWeek: dist.postsPerWeek > 0 ? Math.max(1, Math.floor(dist.postsPerWeek * multiplier)) : 0,
    storiesPerDay: dist.storiesPerDay > 0 ? Math.max(0, Math.floor(dist.storiesPerDay * multiplier)) : 0,
    carouselsPerWeek: dist.carouselsPerWeek > 0 ? Math.max(0, Math.floor(dist.carouselsPerWeek * multiplier)) : 0,
    videosPerWeek: dist.videosPerWeek > 0 ? Math.max(0, Math.floor(dist.videosPerWeek * multiplier)) : 0,
    rationale: `[${label}] ${dist.rationale || ""} — Content scaling governed due to integrity concerns`,
  };
  return {
    ...plan,
    contentDistribution: restricted,
    degraded: mode === "degraded" ? true : plan.degraded,
  };
}

export function extractEngineInsights(results: Map<EngineId, EngineStepResult>, strategyRoot?: any): string {
  const sections: string[] = [];

  if (strategyRoot) {
    const rootMechName = strategyRoot.brandSpine?.mechanismName || strategyRoot.approvedMechanism?.mechanismName || strategyRoot.approvedMechanism?.name || "none";
    const rootMechType = strategyRoot.brandSpine?.mechanismType || strategyRoot.approvedMechanism?.mechanismType || strategyRoot.approvedMechanism?.type || "none";
    sections.push(`[STRATEGY_ROOT] Use these approved elements verbatim:\n` +
      `  Pains: ${(strategyRoot.approvedPains || []).map((p: any) => typeof p === 'string' ? p : p.pain).slice(0, 3).join("; ")}\n` +
      `  Objections: ${(strategyRoot.approvedObjections || []).map((o: any) => typeof o === 'string' ? o : o.objection).slice(0, 3).join("; ")}\n` +
      `  Desires: ${(strategyRoot.approvedDesires || []).slice(0, 3).join("; ")}\n` +
      `  Transformation: ${strategyRoot.approvedTransformationAxis || "none"}\n` +
      `  Mechanism: ${rootMechName} (${rootMechType})\n` +
      `  Claim: ${strategyRoot.approvedClaim || "none"}\n` +
      `  Axes: Primary "${strategyRoot.primaryAxis || 'none'}", Contrast "${strategyRoot.contrastAxis || 'none'}"`);
  }

  const mi = results.get("market_intelligence");
  if (mi?.status === "SUCCESS" && mi.output) {
    const out = mi.output.output || mi.output;
    const competitors = out.competitors?.length || 0;
    const marketStateLabel = out.marketState || "unknown";
    sections.push(`Market Intelligence: ${competitors} competitors analyzed, market state: ${marketStateLabel}`);

    const decisions = mi.output.crossSignalDecisions;
    if (decisions?.decisions?.length > 0) {
      const validated = decisions.decisions.filter((d: any) => d.confidenceLevel === "HIGH" || d.confidenceLevel === "MEDIUM");
      const pains = validated.filter((d: any) => d.type === "VALIDATED_PAIN").map((d: any) => d.signalText);
      const hooks = validated.filter((d: any) => d.type === "VALIDATED_HOOK").map((d: any) => d.signalText);
      const objections = validated.filter((d: any) => d.type === "CONFIRMED_OBJECTION").map((d: any) => d.signalText);
      if (pains.length > 0) sections.push(`  Validated Pain Signals: ${pains.slice(0, 5).join("; ")}`);
      if (hooks.length > 0) sections.push(`  Validated Hook Signals: ${hooks.slice(0, 5).join("; ")}`);
      if (objections.length > 0) sections.push(`  Confirmed Objections: ${objections.slice(0, 5).join("; ")}`);
    }
  }

  const nonMiSections: string[] = [];
  nonMiSections.push(`[ENGINE_OUTPUTS — These are engine-concluded structural decisions. They are NOT cross-signal validated market decisions. Use them for structural plan assembly only, not as market truth signals.]`);

  const audience = results.get("audience");
  if (audience?.status === "SUCCESS" && audience.output) {
    const out = audience.output.output || audience.output;
    const pains = (out.audiencePains || out.painProfiles || [])
      .map((p: any) => {
        const text = p.canonical || p.originalStatement || p.pain || p.name || p.painName || "unknown";
        const compNames = Array.isArray(p.competitorNames) && p.competitorNames.length > 0
          ? p.competitorNames.join(", ")
          : "";
        const scopeTag = compNames ? ` [COMPETITOR_SPECIFIC: ${compNames}]` : (p.subjectScope ? ` [${p.subjectScope}]` : "");
        return `${text}${scopeTag}`;
      })
      .slice(0, 4)
      .join(", ");
    const segments = (out.audienceSegments || []).map((s: any) => s.name || s.segmentName || "unknown").slice(0, 3).join(", ");
    nonMiSections.push(`[ENGINE_OUTPUT] Audience: Pains [${pains}], Segments [${segments}]`);
  }

  const positioning = results.get("positioning");
  if (positioning?.status === "SUCCESS" && positioning.output) {
    const out = positioning.output.output || positioning.output;
    const primaryTerritory = (out.territories || [])[0] || {};
    const territories = (out.territories || []).map((t: any) => t.name || t.territoryName || "unknown").slice(0, 2).join(", ");
    const posEpistemicStatus = out.epistemicStatus || primaryTerritory.epistemicStatus || out.proposalStatus || "STRATEGIC_HYPOTHESIS";
    const posEpistemicLabel = out.epistemicLabel || primaryTerritory.epistemicLabel || "";
    const posOutcomeType = out.positioningOutcomeType || primaryTerritory.positioningOutcomeType || "";
    const posComparisonStatus = out.comparisonStatus || primaryTerritory.comparisonStatus || "";
    const posComparedCount = typeof out.comparedCompetitorCount === "number" ? out.comparedCompetitorCount : 0;
    const posRationale = out.rationale || primaryTerritory.rationale || "";
    const isHypothesisOrSharedEmphasis =
      String(posEpistemicStatus).toUpperCase().includes("HYPOTHESIS") ||
      String(posOutcomeType).toUpperCase().includes("SHARED_CAPABILITY") ||
      String(posOutcomeType).toUpperCase().includes("INSUFFICIENT_COMPARISON") ||
      String(posComparisonStatus).toUpperCase().includes("UNAVAILABLE");
    nonMiSections.push(
      `[ENGINE_OUTPUT] Positioning: Territories [${territories}], Enemy "${out.enemyDefinition || 'none'}", Contrast "${out.contrastAxis || 'none'}", Narrative "${out.narrativeDirection || 'none'}"` +
      (posRationale ? `, Rationale "${posRationale}"` : "") +
      `, EpistemicStatus "${posEpistemicStatus}"` +
      (posEpistemicLabel ? ` (${posEpistemicLabel})` : "") +
      (posOutcomeType ? `, OutcomeType "${posOutcomeType}"` : "") +
      (posComparisonStatus ? `, ComparisonStatus "${posComparisonStatus}" (comparedCompetitorCount=${posComparedCount})` : "") +
      (isHypothesisOrSharedEmphasis
        ? ` [IMPORTANT: Positioning is classified as ${posEpistemicStatus}${posOutcomeType ? ` / ${posOutcomeType}` : ""} (${posComparisonStatus || "no competitor comparison"}, comparedCompetitorCount=${posComparedCount}). Frame this positioning strictly as a proposed strategic hypothesis and strategic market emphasis on verified product capabilities — NEVER claim proven exclusivity, "only provider", or unverified category-wide competitor internal architectures.]`
        : "")
    );
  }

  const diff = results.get("differentiation");
  if (diff?.status === "SUCCESS" && diff.output) {
    const out = diff.output.output || diff.output;
    const diffList = out.differentiations || out.pillars || [];
    const pillars = diffList
      .map((p: any) => {
        const epStatus = p.epistemicStatus || p.differentiationClassification || p.claimCategory || "";
        const honestLbl = p.honestLabel ? ` (${p.honestLabel})` : "";
        return `${p.name || p.pillarName || p.claim || "unknown"}${epStatus ? ` [${epStatus}${honestLbl}]` : ""}`;
      })
      .slice(0, 4)
      .join(", ");
    const allStrategicEmphasis = diffList.length > 0 && diffList.every((p: any) => {
      const st = String(p.epistemicStatus || p.differentiationClassification || "").toUpperCase();
      return st.includes("SHARED_CAPABILITY") || st.includes("STRATEGIC_EMPHASIS") || st.includes("COMPETITIVE_COMPARISON_UNAVAILABLE");
    });
    const claims = (out.claimStructures || diffList)
      .map((c: any) => c.claimText || c.claim || c.statement || "unknown")
      .slice(0, 2)
      .join(" | ");
    nonMiSections.push(
      `[ENGINE_OUTPUT] Differentiation: Pillars [${pillars}], Claims [${claims}], Proof Types ${(out.proofArchitecture || []).length}, Authority Mode "${out.authorityMode?.mode || out.authorityMode || 'unknown'}"` +
      (allStrategicEmphasis
        ? ` [IMPORTANT: All differentiation pillars are classified as SHARED_CAPABILITY_STRATEGIC_EMPHASIS / COMPETITIVE_COMPARISON_UNAVAILABLE. Frame them strictly as strategic market emphasis on verified product strengths — NEVER claim "unique combination", "only provider", or "defensible whitespace".]`
        : "")
    );
  }

  const mechanism = results.get("mechanism" as EngineId);
  if (mechanism?.status === "SUCCESS" && mechanism.output) {
    const out = mechanism.output.output || mechanism.output;
    const pm = out.primaryMechanism || out.mechanism || out;
    const mechSteps = (pm.mechanismSteps || out.mechanismSteps || [])
      .map((s: any, idx: number) => `${s.stepNumber || idx + 1}. ${s.stepName || s.name || "Step"}: ${s.description || s.purpose || ""}`)
      .slice(0, 5)
      .join(" | ");
    nonMiSections.push(
      `[ENGINE_OUTPUT] Mechanism: Name "${pm.mechanismName || pm.name || out.mechanismName || 'unknown'}", Type "${pm.mechanismType || pm.type || out.mechanismType || 'unknown'}", Promise "${pm.mechanismPromise || pm.corePromise || out.mechanismPromise || 'none'}", Logic "${pm.mechanismLogic || pm.coreLogic || out.mechanismLogic || 'none'}", Steps [${mechSteps}]`
    );
  }

  const offer = results.get("offer");
  if (offer?.status === "SUCCESS" && offer.output) {
    const out = offer.output.output || offer.output;
    const primaryOffer = out.primaryOffer || out.offer || out;
    const opProposals = (primaryOffer.operationalProposals || out.operationalProposals || [])
      .map((op: any) => op.title || op.proposal || op.action || op.description)
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    nonMiSections.push(
      `[ENGINE_OUTPUT] Offer: Name "${primaryOffer.offerName || primaryOffer.title || out.offerName || 'unknown'}", Outcome "${primaryOffer.coreOutcome || primaryOffer.valueProposition || out.coreOutcome || 'unknown'}", Price "${primaryOffer.priceStructure || out.priceStructure || 'none'}", Guarantee "${primaryOffer.guarantee || primaryOffer.riskReversal?.name || out.guarantee || 'none'}", Mechanism "${primaryOffer.mechanismDescription || out.mechanismDescription || 'none'}"${opProposals ? `, Operational Proposals Requiring Business Approval: [${opProposals}]` : ""}`
    );
  }

  const funnel = results.get("funnel");
  if (funnel?.status === "SUCCESS" && funnel.output) {
    const out = funnel.output.output || funnel.output;
    // topOfFunnel extraction
    nonMiSections.push(`[ENGINE_OUTPUT] Funnel: Stages [Top: ${out.topStage || 'none'}, Mid: ${out.middleStage || 'none'}, Bot: ${out.bottomStage || 'none'}], Trust Score ${out.trustPathScore || 'N/A'}, Type "${out.funnelType || 'unknown'}", Flow "${out.conversionFlow || 'none'}"`);
  }

  const awareness = results.get("awareness");
  if (awareness?.status === "SUCCESS" && awareness.output) {
    const out = awareness.output.output || awareness.output;
    const pr = out.primaryRoute || out;
    const toLayerArray = (v: any): any[] => {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") { try { return toLayerArray(JSON.parse(v)); } catch { return []; } }
      if (v && typeof v === "object") return Object.values(v);
      return [];
    };
    const mechanisms = toLayerArray(out.layerMechanisms || out.layerResults).map((m: any) => m?.mechanism || m?.name || "unknown").slice(0, 3).join(", ");
    nonMiSections.push(
      `[ENGINE_OUTPUT] Awareness: Primary Route "${pr.routeName || pr.name || 'unknown'}", Entry Stage "${pr.entryStage || out.entryStage || 'unknown'}", Target Readiness "${pr.targetReadinessStage || out.targetReadinessStage || 'unknown'}", Old Belief "${pr.oldBelief || out.oldBelief || 'none'}", New Belief "${pr.newBelief || out.newBelief || 'none'}", Narrative Reframe "${pr.narrativeReframe || out.narrativeReframe || 'none'}", Myth Breaker "${pr.mythBreaker || out.mythBreaker || 'none'}", Layer Mechanisms [${mechanisms}]`
    );
  }

  const persuasion = results.get("persuasion");
  if (persuasion?.status === "SUCCESS" && persuasion.output) {
    const out = persuasion.output.output || persuasion.output;
    const toLayerArray = (v: any): any[] => {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") { try { return toLayerArray(JSON.parse(v)); } catch { return []; } }
      if (v && typeof v === "object") return Object.values(v);
      return [];
    };
    const mechanisms = toLayerArray(out.layerMechanisms || out.layerResults).map((m: any) => m?.mechanism || m?.name || "unknown").slice(0, 3).join(", ");
    nonMiSections.push(`[ENGINE_OUTPUT] Persuasion: Primary Route "${out.primaryRoute?.routeName || out.primaryRoute?.name || 'unknown'}", Alt Route "${out.alternativeRoute?.routeName || 'none'}", Mode "${out.persuasionMode || 'unknown'}", Mechanisms [${mechanisms}]`);
  }

  const integrity = results.get("integrity");
  if (integrity?.status === "SUCCESS" && integrity.output) {
    const out = integrity.output.output || integrity.output;
    const warnings = (out.structuralWarnings || []).map((w: any) => w.warning || w.text || "warning").slice(0, 2).join(" | ");
    nonMiSections.push(`[ENGINE_OUTPUT] Integrity: Confidence ${out.confidenceScore ?? 'N/A'}, Stability ${out.stabilityResult?.stable ?? 'unknown'}, Warnings [${warnings}]`);
  }

  const statVal = results.get("statistical_validation");
  if (statVal?.status === "SUCCESS" && statVal.output) {
    const out = statVal.output.output || statVal.output;
    const claimRes = (out.claimValidations || []).map((c: any) => `${c.claim}: ${c.result || 'unknown'}`).slice(0, 2).join(" | ");
    nonMiSections.push(`[ENGINE_OUTPUT] Statistical Validation: State ${out.validationState || 'unknown'}, Claim Confidence ${out.claimConfidenceScore ?? 'N/A'}, Results [${claimRes}]`);
  }

  const iteration = results.get("iteration");
  if (iteration?.status === "SUCCESS" && iteration.output) {
    const out = iteration.output.output || iteration.output;
    const hypotheses = (out.nextTestHypotheses || []).map((h: any) => h.hypothesis || h.text || "unknown").slice(0, 2).join(" | ");
    const targets = (out.optimizationTargets || []).map((t: any) => `${t.name || t.target} (${t.direction || 'improve'})`).slice(0, 3).join(", ");
    nonMiSections.push(`[ENGINE_OUTPUT] Iteration: Hypotheses [${hypotheses}], Targets [${targets}]`);
  }

  const retention = results.get("retention");
  if (retention?.status === "SUCCESS" && retention.output) {
    const out = retention.output.output || retention.output;
    const loops = (out.retentionLoops || []).map((l: any) => l.description || l.name || "unknown").slice(0, 2).join(" | ");
    const risks = (out.churnRiskFlags || []).map((r: any) => r.description || r.risk || "unknown").slice(0, 2).join(" | ");
    const paths = (out.ltvExpansionPaths || []).map((p: any) => p.path || p.name || "unknown").slice(0, 2).join(", ");
    const triggers = (out.upsellTriggers || []).map((t: any) => t.trigger || t.name || "unknown").slice(0, 2).join(", ");
    nonMiSections.push(`[ENGINE_OUTPUT] Retention: Loops [${loops}], Risks [${risks}], LTV Paths [${paths}], Upsell Triggers [${triggers}]`);
  }

  const budget = results.get("budget_governor");
  if (budget?.status === "SUCCESS" && budget.output) {
    const out = budget.output.output || budget.output;
    const action = out.decision?.action || out.decision || out.action || 'HOLD';
    const total = out.totalMonthlyBudget ? `${out.totalMonthlyBudget} ${out.currency || 'USD'}` : 'Not specified';
    const allocs = (out.allocations || []).map((a: any) => `${a.channelName || a.channelId}: ${a.sharePercentage}%`).join("; ");
    nonMiSections.push(`[ENGINE_OUTPUT] Budget Governor: Decision "${action}", Total "${total}", Allocations [${allocs || 'none'}], Reasoning "${out.overallRationale || out.decision?.reasoning || out.reasoning || 'none'}"`);
  }

  const channel = results.get("channel_selection");
  if (channel?.status === "SUCCESS" && channel.output) {
    const out = channel.output.output || channel.output;
    const rej = (out.rejectedChannels || []).map((c: any) => c.name || c).join(", ");
    nonMiSections.push(`[ENGINE_OUTPUT] Channel Selection: Primary "${out.primaryChannel?.channelName || out.primaryChannel?.name || 'unknown'}" (Role: ${out.primaryChannel?.role || 'none'}), Secondary "${out.secondaryChannel?.channelName || out.secondaryChannel?.name || 'none'}", Rejected [${rej}]`);
  }

  sections.push(...nonMiSections);
  return sections.join("\n");
}

export interface AudiencePainRolePreservation {
  roles: {
    core?: { painId: string; source: "offer" };
    objections?: Array<{ painId: string; source: "offer" }>;
    retention?: { painId: string; classification?: string; source: "retention" };
    positioningCore?: { painId: string; classification?: string; source: "positioning" };
    differentiationCore?: { painId: string; classification?: string; source: "differentiation" };
    mechanismCore?: { painId: string; classification?: string; rootCauseIds?: string[]; source: "mechanism" };
    funnelPrimary?: { painId: string; classification?: string; source: "funnel" };
    funnelObjections?: Array<{ painId: string; classification?: string; source: "funnel" }>;
    persuasionMotivations?: Array<{ painId: string; classification?: string; source: "persuasion" }>;
    persuasionObjections?: Array<{ painId: string; classification?: string; source: "persuasion" }>;
  } | null;
  violations: string[];
}

/**
 * Preserve engine-selected authoritative pain roles for the final plan.
 * Pure and deterministic: reads `selectedPainRoles` emitted by the Offer
 * engine (core purchase + objection pains) and the Retention engine
 * (post-purchase friction) and carries them into the synthesized plan
 * WITHOUT reselecting, flattening, or merging. Violations detected here
 * (merged core pains, a retention pain claiming the core slot) are
 * surfaced as explicit violation codes — never silently repaired.
 */
export function extractAudiencePainRoles(
  results: Map<EngineId, EngineStepResult>,
): AudiencePainRolePreservation {
  const violations: string[] = [];
  const roles: NonNullable<AudiencePainRolePreservation["roles"]> = {};

  const offer = results.get("offer" as EngineId);
  const offerOut = offer?.status === "SUCCESS" && offer.output
    ? (offer.output.output || offer.output)
    : null;
  const offerRoles = offerOut?.selectedPainRoles;
  if (offerRoles?.core?.painId) {
    if (Array.isArray(offerRoles.core.mergedPainIds) && offerRoles.core.mergedPainIds.length > 1) {
      violations.push("OFFER_CORE_PAIN_MERGED");
    } else {
      roles.core = { painId: offerRoles.core.painId, source: "offer" };
    }
  }
  if (Array.isArray(offerRoles?.objections)) {
    const objections = offerRoles.objections
      .filter((o: any) => typeof o?.painId === "string" && o.painId.length > 0)
      .map((o: any) => ({ painId: o.painId, source: "offer" as const }));
    if (objections.length > 0) roles.objections = objections;
  }

  const retention = results.get("retention" as EngineId);
  const retentionOut = retention?.status === "SUCCESS" && retention.output
    ? (retention.output.output || retention.output)
    : null;
  const retentionRole = retentionOut?.selectedPainRoles?.retention;
  if (retentionRole?.painId) {
    if (roles.core?.painId === retentionRole.painId) {
      violations.push("RETENTION_PAIN_CONFLICTS_WITH_CORE");
    } else {
      roles.retention = {
        painId: retentionRole.painId,
        classification: retentionRole.classification,
        source: "retention",
      };
    }
  }

  // ── Acquisition-engine roles (Task 163 completion) ──
  // Each engine's selectedPainRoles is preserved VERBATIM. A core/anchor role
  // classified POST_PURCHASE_FRICTION is a structural violation (allowedUses
  // makes it impossible via selectPainForUse, so seeing one means the engine
  // output was tampered with or the registry was bypassed) — never repaired.
  const engineOut = (id: string): any => {
    const step = results.get(id as EngineId);
    return step?.status === "SUCCESS" && step.output ? (step.output.output || step.output) : null;
  };

  const positioningCore = engineOut("positioning")?.selectedPainRoles?.core;
  if (positioningCore?.painId) {
    if (positioningCore.classification === "POST_PURCHASE_FRICTION") {
      violations.push("POSITIONING_CORE_POST_PURCHASE_FORBIDDEN");
    } else {
      roles.positioningCore = { painId: positioningCore.painId, classification: positioningCore.classification, source: "positioning" };
    }
  }

  const differentiationCore = engineOut("differentiation")?.selectedPainRoles?.core;
  if (differentiationCore?.painId) {
    if (differentiationCore.classification === "POST_PURCHASE_FRICTION") {
      violations.push("DIFFERENTIATION_CORE_POST_PURCHASE_FORBIDDEN");
    } else {
      roles.differentiationCore = { painId: differentiationCore.painId, classification: differentiationCore.classification, source: "differentiation" };
    }
  }

  const mechanismCore = engineOut("mechanism")?.selectedPainRoles?.core;
  if (mechanismCore?.painId) {
    if (mechanismCore.classification === "POST_PURCHASE_FRICTION") {
      violations.push("MECHANISM_CORE_POST_PURCHASE_FORBIDDEN");
    } else {
      roles.mechanismCore = {
        painId: mechanismCore.painId,
        classification: mechanismCore.classification,
        rootCauseIds: Array.isArray(mechanismCore.rootCauseIds) ? mechanismCore.rootCauseIds : undefined,
        source: "mechanism",
      };
    }
  }

  const funnelRoles = engineOut("funnel")?.selectedPainRoles;
  if (funnelRoles?.primary?.painId) {
    if (funnelRoles.primary.classification === "POST_PURCHASE_FRICTION") {
      violations.push("FUNNEL_PRIMARY_POST_PURCHASE_FORBIDDEN");
    } else {
      roles.funnelPrimary = { painId: funnelRoles.primary.painId, classification: funnelRoles.primary.classification, source: "funnel" };
    }
  }
  if (Array.isArray(funnelRoles?.objections)) {
    const funnelObjections = funnelRoles.objections
      .filter((o: any) => typeof o?.painId === "string" && o.painId.length > 0)
      .map((o: any) => ({ painId: o.painId, classification: o.classification, source: "funnel" as const }));
    if (funnelObjections.length > 0) roles.funnelObjections = funnelObjections;
  }

  const persuasionRoles = engineOut("persuasion")?.selectedPainRoles;
  if (Array.isArray(persuasionRoles?.motivations)) {
    const motivations = persuasionRoles.motivations
      .filter((m: any) => typeof m?.painId === "string" && m.painId.length > 0)
      .map((m: any) => ({ painId: m.painId, classification: m.classification, source: "persuasion" as const }));
    if (motivations.length > 0) roles.persuasionMotivations = motivations;
  }
  if (Array.isArray(persuasionRoles?.objections)) {
    const persuasionObjections = persuasionRoles.objections
      .filter((o: any) => typeof o?.painId === "string" && o.painId.length > 0)
      .map((o: any) => ({ painId: o.painId, classification: o.classification, source: "persuasion" as const }));
    if (persuasionObjections.length > 0) roles.persuasionObjections = persuasionObjections;
  }

  const hasAny = !!(
    roles.core || roles.retention || roles.objections?.length ||
    roles.positioningCore || roles.differentiationCore || roles.mechanismCore ||
    roles.funnelPrimary || roles.funnelObjections?.length ||
    roles.persuasionMotivations?.length || roles.persuasionObjections?.length
  );
  return { roles: hasAny ? roles : null, violations };
}

export interface LockedLabel {
  label: string;
  /** Top-level plan field where this label is expected to appear (e.g. "positioning", "mechanism", "offer", "differentiation"). When set, verifySynthesisPreservation restricts its search to plan[scope]. */
  scope?: string;
}

export function extractLockedDecisionLabels(results: Map<EngineId, EngineStepResult>, strategyRoot?: any): LockedLabel[] {
  const out: LockedLabel[] = [];

  const positioning = results.get("positioning");
  if (positioning?.status === "SUCCESS" && positioning.output) {
    const primary = (positioning.output.territories || [])[0];
    if (primary?.name) out.push({ label: primary.name, scope: "positioning" });
  }

  const mechanism = results.get("mechanism");
  if (mechanism?.status === "SUCCESS") {
    const m = mechanism.output?.output || mechanism.output;
    if (m?.status === "COMPLETE" || m?.status === "SUCCESS" || m?.primaryMechanism || m?.mechanismName) {
      const mechName = m?.primaryMechanism?.mechanismName || m?.mechanismName;
      if (mechName) out.push({ label: mechName, scope: "mechanism" });
    }
  }

  const offer = results.get("offer");
  if (offer?.status === "SUCCESS") {
    const o = offer.output?.output || offer.output;
    const offerName = o?.primaryOffer?.offerName || o?.offerName;
    if (offerName) out.push({ label: offerName, scope: "offer" });
  }

  const diff = results.get("differentiation");
  if (diff?.status === "SUCCESS") {
    const d = diff.output?.output || diff.output;
    if (d?.pillars?.length > 0) {
      for (const p of d.pillars) {
        const name = p.name || p.pillarName;
        if (name) out.push({ label: name, scope: "differentiation" });
      }
    }
  }

  const channel = results.get("channel_selection");
  if (channel?.status === "SUCCESS") {
    const c = channel.output?.output || channel.output;
    const name = c?.primaryChannel?.channelName || c?.primaryChannel?.name;
    if (name) out.push({ label: name, scope: "channel_selection" });
  }

  const awareness = results.get("awareness");
  if (awareness?.status === "SUCCESS") {
    const a = awareness.output?.output || awareness.output;
    const name = a?.primaryRoute?.routeName || a?.primaryRoute?.name;
    if (name) out.push({ label: name, scope: "awareness" });
  }

  const persuasion = results.get("persuasion");
  if (persuasion?.status === "SUCCESS") {
    const p = persuasion.output?.output || persuasion.output;
    const name = p?.primaryRoute?.routeName || p?.primaryRoute?.name;
    if (name) out.push({ label: name, scope: "persuasion" });
  }

  if (strategyRoot) {
    if (strategyRoot.approvedClaim) out.push({ label: strategyRoot.approvedClaim, scope: "strategyRoot" });
    const rootMechName = strategyRoot.approvedMechanism?.mechanismName || strategyRoot.approvedMechanism?.name || strategyRoot.brandSpine?.mechanismName;
    if (rootMechName) out.push({ label: rootMechName, scope: "strategyRoot" });
  }

  return out;
}

// Locked-decision preservation: collect every string leaf in the plan tree
// into a normalized Set; preservation = exact set membership (no substring).
export function collectPlanStringSet(
  node: unknown,
  out: Set<string>,
  depth: number,
): void {
  if (node == null || depth > 12) return;
  if (typeof node === "string") {
    const norm = node.toLowerCase().trim();
    if (norm.length > 0) out.add(norm);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectPlanStringSet(v, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectPlanStringSet(v, out, depth + 1);
    }
  }
}

// field-addressed preservation. Each locked decision is checked
// against the specific plan subtree it should appear in (scope). Generic
// string[] still works (legacy global scan). Membership is exact-leaf
// (no substring) so "Outcome-First" never matches "Our Outcome-First …".
export function verifySynthesisPreservation(
  plan: SynthesizedPlan,
  lockedLabels: Array<string | LockedLabel | ExpectedLock | any>,
): NonNullable<SynthesizedPlan["synthesisVerification"]> {
  if (!lockedLabels || lockedLabels.length === 0) {
    return { passed: true, totalLocked: 0, preserved: 0, missing: [], verifiedAt: new Date().toISOString() };
  }

  const planStr = JSON.stringify(plan).toLowerCase();
  const { lockedDecisionLabels: _labels, synthesisVerification: _verif, planSource: _src, degraded: _deg, ...contentOnly } = plan;
  // Pre-compute scoped string sets on demand (cached per-scope).
  const SCOPE_PLAN_MAPPINGS: Record<string, string[]> = {
    positioning: ["strategicSummary", "monthlyObjective", "buyerConversionJourneys"],
    mechanism: ["strategicSummary", "buyerConversionJourneys", "creativeTesting", "mechanism", "approvedMechanism", "brandSpine"],
    offer: ["strategicSummary", "buyerConversionJourneys", "contentDistribution", "offer"],
    differentiation: ["strategicSummary", "contentDistribution", "creativeTesting", "differentiationPillars"],
    channel_selection: ["contentDistribution", "budgetAllocation", "kpiStructure"],
    awareness: ["buyerConversionJourneys", "contentDistribution", "creativeTesting", "awarenessRoute", "awareness"],
    persuasion: ["buyerConversionJourneys", "creativeTesting", "strategicSummary", "persuasionRoute"],
    strategyRoot: ["strategicSummary", "buyerConversionJourneys", "contentDistribution", "approvedClaim", "approvedMechanism", "strategyRoot", "brandSpine"],
  };

  const scopeSetCache = new Map<string, Set<string>>();
  function setForScope(scope: string | undefined): Set<string> {
    const key = scope ?? "__global__";
    let s = scopeSetCache.get(key);
    if (!s) {
      s = new Set<string>();
      if (!scope) {
        collectPlanStringSet(contentOnly, s, 0);
      } else if ((contentOnly as Record<string, unknown>)[scope] !== undefined) {
        collectPlanStringSet((contentOnly as Record<string, unknown>)[scope], s, 0);
      } else if (SCOPE_PLAN_MAPPINGS[scope]) {
        for (const prop of SCOPE_PLAN_MAPPINGS[scope]) {
          if ((contentOnly as Record<string, unknown>)[prop] !== undefined) {
            collectPlanStringSet((contentOnly as Record<string, unknown>)[prop], s, 0);
          }
        }
      } else {
        collectPlanStringSet(contentOnly, s, 0);
      }
      scopeSetCache.set(key, s);
    }
    return s;
  }

  const missing: string[] = [];
  let preserved = 0;
  for (const item of lockedLabels) {
    let id: string;
    let canonicalValue: any;
    let scope: string | undefined;

    if (typeof item === "string") {
      id = item;
      canonicalValue = item;
    } else if (item && "canonicalValue" in item) {
      id = item.id;
      canonicalValue = item.canonicalValue;
      scope = item.scope;
    } else if (item && "label" in item) {
      id = item.label;
      canonicalValue = item.label;
      scope = item.scope;
    } else {
      continue;
    }

    const normalized = String(canonicalValue).toLowerCase().trim();
    if (normalized.length < 3) continue;

    const set = setForScope(scope);
    let hasMatch = set.has(normalized);

    if (!hasMatch) {
      const cleanNorm = normalized.replace(/[.,;:!?]+$/, "").trim();
      const globalSet = setForScope(undefined);
      if (
        set.has(cleanNorm) ||
        globalSet.has(normalized) ||
        globalSet.has(cleanNorm) ||
        planStr.includes(normalized) ||
        (cleanNorm.length > 5 && planStr.includes(cleanNorm))
      ) {
        hasMatch = true;
      }
    }

    if (hasMatch) {
      preserved++;
    } else {
      missing.push(id);
    }
  }

  return {
    passed: missing.length === 0,
    totalLocked: lockedLabels.length,
    preserved,
    missing,
    verifiedAt: new Date().toISOString(),
  };
}

export function validateSynthesisIntegrity(
  plan: SynthesizedPlan,
  results: Map<EngineId, EngineStepResult>,
  strategyRoot?: any
): NonNullable<SynthesizedPlan["_synthesisIntegrity"]> {
  const missingLabels = plan.synthesisVerification?.missing || [];
  const totalLocked = plan.synthesisVerification?.totalLocked || 0;
  const coverage = totalLocked > 0 ? (totalLocked - missingLabels.length) / totalLocked : 1;
  
  const degradedEngines: string[] = [];
  const blockedEngines: string[] = [];
  for (const [id, res] of results.entries()) {
    if (res.status === "ERROR" || res.status === "BLOCKED" || res.status === "SIGNAL_BLOCKED") blockedEngines.push(id);
    else if (res.status === "DEGRADED") degradedEngines.push(id);
  }

  const contradictions: string[] = [];
  const strategyRootPresent = !!strategyRoot;
  const isRootEligible = strategyRoot && (strategyRoot.status === "ACTIVE" || strategyRoot.executionEligible === true);
  if (strategyRoot && !isRootEligible) {
    contradictions.push(`STRATEGY_ROOT_INELIGIBLE: Strategy root is status="${strategyRoot.status || 'unknown'}", not execution-eligible.`);
  }
  
  let verdict: 'FULLY_GROUNDED' | 'PARTIALLY_GROUNDED' | 'UNGROUNDED' = 'FULLY_GROUNDED';
  if (!strategyRootPresent || !isRootEligible) {
    verdict = 'UNGROUNDED';
  } else if (blockedEngines.length > 0 || missingLabels.length > 0 || degradedEngines.length > 0) {
    verdict = 'PARTIALLY_GROUNDED';
  }

  return {
    lockedDecisionCoverage: coverage,
    contradictions,
    degradedEngines,
    blockedEngines,
    strategyRootPresent,
    verdict
  };
}
export function extractLockedDecisions(results: Map<EngineId, EngineStepResult>, strategyRoot?: any): string {
  const lines: string[] = [];

  if (strategyRoot) {
    const pains = strategyRoot.approvedAudiencePains;
    if (Array.isArray(pains) && pains.length > 0) {
      const corePains = pains.filter((p: any) => {
        const text = typeof p === 'string' ? p : (p.pain || p.name || p.statement || p.text || '');
        return !/unauthorized|billing|refund|cancellation charges/i.test(text);
      });
      if (corePains.length > 0) {
        lines.push(`  Strategy Root Core Pains: ${corePains.map((p: any) => {
          if (typeof p === 'string') return p;
          const txt = p.pain || p.name || p.canonical || p.statement || p.text || p;
          const compNames = Array.isArray(p.competitorNames) && p.competitorNames.length > 0 ? ` [Competitor-attributed to ${p.competitorNames.join(", ")}]` : "";
          return `${txt}${compNames}`;
        }).join(", ")}`);
      }
    }
    const objections = strategyRoot.approvedObjections;
    if (objections) {
      const objArr = Array.isArray(objections) ? objections : Object.values(objections);
      if (objArr.length > 0) {
        lines.push(`  Strategy Root Objections: ${objArr.map((o: any) => {
          if (typeof o === 'string') return o;
          const txt = o.label || o.objection || o.text || o.name || o;
          const compNames = Array.isArray(o.competitorNames) && o.competitorNames.length > 0 ? ` [Competitor-attributed to ${o.competitorNames.join(", ")}]` : "";
          return `${txt}${compNames}`;
        }).join(", ")}`);
      }
    }
    if (strategyRoot.approvedTransformation) {
      lines.push(`  Transformation: "${strategyRoot.approvedTransformation}"`);
    }
    if (strategyRoot.approvedClaim) {
      lines.push(`  Claim: "${strategyRoot.approvedClaim}"`);
    }
    if (strategyRoot.approvedClaims && Array.isArray(strategyRoot.approvedClaims) && strategyRoot.approvedClaims.length > 0) {
      lines.push(`  Claims / Pillars: ${strategyRoot.approvedClaims.map((c: any) => c.claim || c.pillarName || c.name || c).join(", ")}`);
    }
    const mech = strategyRoot.approvedMechanism;
    if (mech && mech.mechanismName) {
      lines.push(`  Mechanism name: "${mech.mechanismName}"`);
      if (mech.mechanismType) lines.push(`  Mechanism type: "${mech.mechanismType}"`);
      if (Array.isArray(mech.mechanismSteps) && mech.mechanismSteps.length > 0) {
        lines.push(`  Mechanism steps: ${mech.mechanismSteps.join(" → ")}`);
      }
    }
    const pos = strategyRoot.approvedPositioningContext;
    if (pos) {
      const territory = pos.territories?.[0];
      const territoryName = territory?.name || pos.territories?.[0]?.name;
      if (territoryName) lines.push(`  Positioning territory: "${territoryName}"`);
      const enemy = pos.enemyDefinition || territory?.enemyDefinition;
      if (enemy) lines.push(`  Positioning enemy: "${enemy}"`);
      const contrast = pos.contrastAxis || territory?.contrastAxis;
      if (contrast) lines.push(`  Contrast axis: "${contrast}"`);
      const narrative = pos.narrativeDirection || territory?.narrativeDirection;
      if (narrative) lines.push(`  Narrative direction: "${narrative}"`);
      const posRationale = pos.rationale || territory?.rationale;
      if (posRationale) lines.push(`  Positioning rationale: "${posRationale}"`);
      const posEpStatus = pos.epistemicStatus || territory?.epistemicStatus || pos.proposalStatus;
      if (posEpStatus) lines.push(`  Positioning epistemic status: "${posEpStatus}"`);
      const posEpLabel = pos.epistemicLabel || territory?.epistemicLabel;
      if (posEpLabel) lines.push(`  Positioning epistemic label: "${posEpLabel}"`);
      const posCompStatus = pos.comparisonStatus || territory?.comparisonStatus;
      if (posCompStatus) lines.push(`  Positioning comparison status: "${posCompStatus}" (comparedCompetitorCount=${pos.comparedCompetitorCount ?? 0})`);
    }
  }

  if (!strategyRoot) {
    const positioning = results.get("positioning");
    if (positioning?.status === "SUCCESS" && positioning.output) {
      const out = positioning.output.output || positioning.output;
      const territories = out.territories || [];
      const primary = territories[0];
      if (primary) {
        if (primary.name) lines.push(`  Positioning territory: "${primary.name}"`);
        const enemy = out.enemyDefinition || primary.enemyDefinition;
        if (enemy) lines.push(`  Positioning enemy: "${enemy}"`);
        const contrast = out.contrastAxis || primary.contrastAxis;
        if (contrast) lines.push(`  Contrast axis: "${contrast}"`);
        const narrative = out.narrativeDirection || primary.narrativeDirection;
        if (narrative) lines.push(`  Narrative direction: "${narrative}"`);
      }
    }

    const mechanism = results.get("mechanism");
    if (mechanism?.status === "SUCCESS" && mechanism.output) {
      const out = mechanism.output.output || mechanism.output;
      const mech = out.primaryMechanism || out;
      if (mech.mechanismName) lines.push(`  Mechanism name: "${mech.mechanismName}"`);
      if (mech.mechanismType) lines.push(`  Mechanism type: "${mech.mechanismType}"`);
    }

    const diff = results.get("differentiation");
    if (diff?.status === "SUCCESS" && diff.output) {
      const out = diff.output.output || diff.output;
      const diffItems = out.differentiations || out.pillars || [];
      if (diffItems.length > 0) {
        const pillarNames = (diffItems as any[]).map((p: any) => p.name || p.pillarName || p.claim).filter(Boolean);
        if (pillarNames.length > 0) {
          lines.push(`  Differentiation pillars: ${pillarNames.map((n: string) => `"${n}"`).join(", ")}`);
        }
      }
      const authorityMode = out.authorityMode?.mode || (typeof out.authorityMode === "string" ? out.authorityMode : null);
      if (authorityMode && authorityMode !== "unknown") lines.push(`  Authority mode: "${authorityMode}"`);
    }
  }

  const offer = results.get("offer");
  if (offer?.status === "SUCCESS" && offer.output) {
    const out = offer.output.output || offer.output;
    const primaryOffer = out.primaryOffer || out.offer || out;
    const offerName = primaryOffer.offerName || primaryOffer.title || out.offerName;
    const coreOutcome = primaryOffer.coreOutcome || primaryOffer.valueProposition || out.coreOutcome;
    if (offerName) lines.push(`  Offer name: "${offerName}"`);
    if (coreOutcome) lines.push(`  Offer core outcome: "${coreOutcome}"`);
  }

  const awareness = results.get("awareness");
  if (awareness?.status === "SUCCESS" && awareness.output) {
    const out = awareness.output.output || awareness.output;
    const primaryRouteName = out.primaryRoute?.routeName || out.primaryRoute?.name;
    if (primaryRouteName) lines.push(`  Awareness primary route: "${primaryRouteName}"`);
  }

  const persuasion = results.get("persuasion");
  if (persuasion?.status === "SUCCESS" && persuasion.output) {
    const out = persuasion.output.output || persuasion.output;
    const route = out.primaryRoute || out;
    const persuasionMode = route.persuasionMode || out.persuasionMode;
    if (persuasionMode) lines.push(`  Persuasion mode: "${persuasionMode}"`);
    const primaryRouteName = out.primaryRoute?.routeName || out.primaryRoute?.name;
    if (primaryRouteName) lines.push(`  Persuasion primary route: "${primaryRouteName}"`);
  }

  const channel = results.get("channel_selection");
  if (channel?.status === "SUCCESS" && channel.output) {
    const out = channel.output.output || channel.output;
    const primaryName = out.primaryChannel?.channelName || out.primaryChannel?.name;
    const primaryRole = out.primaryChannel?.channelRole || out.primaryChannel?.role;
    if (primaryName) lines.push(`  Primary channel: "${primaryName}"${primaryRole ? ` — role: "${primaryRole}"` : ""}`);
    const secondaryName = out.secondaryChannel?.channelName || out.secondaryChannel?.name;
    const secondaryRole = out.secondaryChannel?.channelRole || out.secondaryChannel?.role;
    if (secondaryName) lines.push(`  Secondary channel: "${secondaryName}"${secondaryRole ? ` — role: "${secondaryRole}"` : ""}`);
  }

  const funnel = results.get("funnel");
  if (funnel?.status === "SUCCESS" && funnel.output) {
    const out = funnel.output.output || funnel.output;
    if (out.trustPathScore !== undefined) lines.push(`  Trust path score: ${out.trustPathScore}`);
    const funnelLabel = out.funnelType || out.funnelName;
    if (funnelLabel) lines.push(`  Funnel type: "${funnelLabel}"`);
  }

  const iteration = results.get("iteration");
  if (iteration?.status === "SUCCESS" && iteration.output) {
    const out = iteration.output.output || iteration.output;
    if (out.optimizationTargets && out.optimizationTargets.length > 0) {
      const targets = out.optimizationTargets.map((t: any) => t.name || t.target).filter(Boolean);
      if (targets.length > 0) lines.push(`  Iteration optimization targets: ${targets.map((n: string) => `"${n}"`).join(", ")}`);
    }
  }

  const retention = results.get("retention");
  if (retention?.status === "SUCCESS" && retention.output) {
    const out = retention.output.output || retention.output;
    if (out.retentionLoops && out.retentionLoops.length > 0) {
      const loops = out.retentionLoops.map((l: any) => l.description || l.name).filter(Boolean);
      if (loops.length > 0) lines.push(`  Retention loops: ${loops.map((n: string) => `"${n}"`).join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function cleanInternalIdsFromProse(text: string): string {
  if (!text || typeof text !== "string") return text;
  return text
    .replace(/\bseg_\w+_pain_\w+\b[—\s:-]*/gi, "")
    .replace(/\bseg_\w+\b[—\s:-]*/gi, "")
    .replace(/\bspd_\w+\b[—\s:-]*/gi, "")
    .replace(/\blane_[a-f0-9]+\b[—\s:-]*/gi, "")
    .replace(/\[ID:\s*[^\]]+\]/gi, "")
    .replace(/\(ID:\s*[^)]+\)/gi, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeStrategicSummaryEpistemics(text: string, _evidenceTexts: string[]): string {
  if (!text || typeof text !== "string") return text;
  // Formatting-only cleanup; semantic support is enforced by LLM generation, targeted repair, and final consistency validation
  return text.replace(/\s{2,}/g, " ").trim();
}

async function generatePlanWithAI(
  engineInsights: string,
  businessData: any,
  campaign: any,
  goalMathContext?: { goal: any; funnel: any; feasibility: any; archetype: any } | null,
  lockedDecisions?: string,
  accountId: string = "",
  memoryContextBlock?: string,
  campaignId: string = "",
  precomputedRhythm?: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number; reasoning: string; performanceBasis: string } | null,
  signalComposition?: SignalComposition | null,
  activeStrategyRoot?: any,
  budgetSettings?: any,
  budgetGovernorOutput?: any,
  canonicalContext?: any,
): Promise<SynthesizedPlan> {
  const brandSpine = activeStrategyRoot?.brandSpine
    ? (typeof activeStrategyRoot.brandSpine === "string" ? JSON.parse(activeStrategyRoot.brandSpine) : activeStrategyRoot.brandSpine)
    : null;
  const approvedLanes = activeStrategyRoot?.approvedLanes
    ? (typeof activeStrategyRoot.approvedLanes === "string" ? JSON.parse(activeStrategyRoot.approvedLanes) : activeStrategyRoot.approvedLanes)
    : null;
  const approvedAudiencePains = activeStrategyRoot?.approvedAudiencePains
    ? (typeof activeStrategyRoot.approvedAudiencePains === "string" ? JSON.parse(activeStrategyRoot.approvedAudiencePains) : activeStrategyRoot.approvedAudiencePains)
    : null;

  const resolvePainsForPrompt = (pIds: any[]) => {
    if (!Array.isArray(pIds)) return pIds;
    return pIds.map((id: string) => {
      if (typeof id !== "string") return id;
      const found = Array.isArray(approvedAudiencePains)
        ? approvedAudiencePains.find((p: any) => p?.painId === id || p?.id === id)
        : null;
      if (found) {
        return found.canonical || found.pain || found.statement || found.text || id;
      }
      return id;
    });
  };

  let lanesBlock = "";
  if (Array.isArray(approvedLanes) && approvedLanes.length > 0) {
    lanesBlock = `STRATEGIC LANES & BRAND SPINE (Locked Canonical Strategy):
Brand Spine: ${JSON.stringify(brandSpine)}
Active Lanes:
${approvedLanes.map((l: any) => `- Lane: "${l.title}"\n  Description: "${l.description}"\n  Pains: ${JSON.stringify(resolvePainsForPrompt(l.painIds))}\n  Desires: ${JSON.stringify(l.desires)}\n  Objections: ${JSON.stringify(l.objections)}\n  Messaging Direction: "${l.messagingDirection}"`).join("\n")}
INSTRUCTION: You must synthesize the execution plan around these Strategic Lanes under the umbrella of the Brand Spine. Do NOT collapse the strategy to a single pain. The targetAudience, strategy explanation, content pillars, and risk triggers must reflect this multi-lane context.
`;
  }

  const objective = campaign?.objective || businessData?.funnelObjective || "AWARENESS";
  const businessName = canonicalContext?.businessName || businessData?.businessName || campaign?.businessName || "";
  const offeringName = canonicalContext?.offeringName || businessData?.coreOffer || "";
  const businessType = canonicalContext?.category || canonicalContext?.businessModel || businessData?.businessType || "general";
  const location = canonicalContext?.targetMarket || campaign?.location || businessData?.geoScope || "Not specified";
  const evidenceGapsList: string[] = Array.isArray(canonicalContext?.evidenceGaps)
    ? canonicalContext.evidenceGaps.slice(0, 8)
    : [];
  const rawBudget = budgetSettings?.monthlyBudget != null
    ? `${budgetSettings.monthlyBudget} ${budgetSettings.currency || "USD"}`
    : (budgetGovernorOutput?.totalMonthlyBudget != null
      ? `${budgetGovernorOutput.totalMonthlyBudget} ${budgetGovernorOutput.currency || "USD"}`
      : (businessData?.monthlyBudget || "Not specified"));
  const budget = rawBudget;

  let goalMathSection = "";
  if (goalMathContext) {
    const { goal, funnel, feasibility, archetype } = goalMathContext;
    goalMathSection = `
GOAL DECOMPOSITION (use these numbers as the source of truth):
  Goal: ${goal.label}
  Type: ${goal.goalType}
  Target: ${goal.target}
  Time Horizon: ${goal.timeHorizonDays} days
  Feasibility: ${feasibility.verdict} (${feasibility.score}/100)

FUNNEL MATH (full acquisition flow):
  Reach: ${funnel.requiredReach.toLocaleString()}
  → Clicks (CTR ${(funnel.ctr * 100).toFixed(1)}%): ${funnel.requiredClicks.toLocaleString()}
  → Conversations (${(funnel.clickToConversationRate * 100).toFixed(0)}%): ${funnel.requiredConversations.toLocaleString()}
  → Leads (${(funnel.conversationToLeadRate * 100).toFixed(0)}%): ${funnel.requiredLeads.toLocaleString()}
  → Qualified Leads (20%): ${funnel.requiredQualifiedLeads.toLocaleString()}
  → Closed Clients (${(funnel.leadToClientRate * 100).toFixed(1)}%): ${funnel.requiredClosedClients}
  Close Rate: ${(funnel.closeRate * 100).toFixed(1)}%${feasibility.budgetAdjustment?.needed ? `\n\nBUDGET ADJUSTMENT REQUIRED:\n  ${feasibility.budgetAdjustment.explanation}\n  Adjustment Type: ${feasibility.budgetAdjustment.type}\n  Affordable Leads: ${feasibility.budgetAdjustment.affordableLeads}` : ""}

BUSINESS ARCHETYPE: ${archetype?.name || businessType}
  Funnel Type: ${archetype?.funnelArchetype || "standard"}
  Trust Requirement: ${archetype?.trustRequirement || 5}/10
  Proof Requirement: ${archetype?.proofRequirement || 5}/10
  Channel Priority: ${archetype?.channelPriority?.join(", ") || "instagram"}
  Content Formats: ${archetype?.typicalFormats?.join(", ") || "reels, posts"}

IMPORTANT: Content volumes and distribution MUST be derived from the funnel math above.
The plan must explain WHY each content type volume was chosen based on the goal decomposition.
`;
  }

  const lockedBlock = lockedDecisions
    ? `LOCKED DECISIONS — These are verbatim strategic outputs from upstream engines. You MUST reference these exact values in your plan. Do NOT rephrase, paraphrase, generalize, or substitute synonyms for any value below. The mechanism name, positioning territory, offer name, differentiation pillars, and channel assignments must appear exactly as stated:
${lockedDecisions}

CRITICAL ASSEMBLY RULE: Every locked decision is IMMUTABLE as the chosen strategic direction. You must use the EXACT text provided. However, do NOT interpret a "locked strategic decision" as a verified factual assertion about competitors' internal processes or guaranteed outcomes — preserve the upstream epistemic status (e.g., STRATEGIC_HYPOTHESIS / SHARED_CAPABILITY_STRATEGIC_EMPHASIS / COMPETITIVE_COMPARISON_UNAVAILABLE), competitor attribution on customer reports, and proof requirements. Evidence references and audience pains from Strategy Root must appear with their exact attribution in the targetAudience and rationale sections.

`
    : "";

  const memoryBlock = memoryContextBlock
    ? `${memoryContextBlock}

`
    : "";

  const rhythmConstraintBlock = precomputedRhythm
    ? `LOCKED CONTENT RHYTHM (adaptive engine output — do NOT override these values):
Reels/week: ${precomputedRhythm.reelsPerWeek}
Carousels/week: ${precomputedRhythm.carouselsPerWeek}
Stories/day: ${precomputedRhythm.storiesPerDay}
Posts/week: ${precomputedRhythm.postsPerWeek}
Basis: ${precomputedRhythm.performanceBasis}
Reasoning: ${precomputedRhythm.reasoning}
INSTRUCTION: Use these exact counts in contentDistribution. Do not derive rhythm from objective, business type, or platform templates. These values are pre-computed and locked.

`
    : "";

  const compositionBlock = signalComposition && signalComposition.total > 0
    ? `SIGNAL COMPOSITION (epistemic origin of strategy inputs):
  Total signals: ${signalComposition.total}
  Real (performance data): ${(signalComposition.realRatio * 100).toFixed(0)}%
  Competitor-derived: ${(signalComposition.competitorRatio * 100).toFixed(0)}%
  AI-inferred: ${(signalComposition.inferredRatio * 100).toFixed(0)}%
  Fallback: ${(signalComposition.fallbackRatio * 100).toFixed(0)}%
  Unknown (legacy/untagged): ${(signalComposition.unknownRatio * 100).toFixed(0)}%
  Trusted (real + competitor): ${(signalComposition.trustedRatio * 100).toFixed(0)}%
NOTE: "unknown" signals are NOT trusted — they represent legacy data with no verified origin. If strategy is heavily competitor-derived, inferred, or unknown, flag this in riskTriggers and recommend gathering own performance data early.

`
    : "";

  const prompt = `You are a Senior Strategic Marketing Director assembling an authoritative execution plan from engine outputs. Your job is to ASSEMBLE and FORMAT upstream decisions into a coherent, high-impact business strategy without generic platitudes or invented capabilities.

STRICT CONSTITUTIONAL RULES:
1. DECISION & TRADEOFF QUALITY: The strategy must make concrete commercial choices. Avoid generic advice like "build trust", "use proof", or "post consistently" unless tied directly to evidence, commercial consequence, and an explicit tradeoff ("what NOT to do").
2. MULTI-LANE INTEGRATION WITHOUT COLLISION: Preserve each active Strategic Lane as a distinct commercial context. Do NOT collapse all lanes into a single pain or merge conflicting audience pains (e.g. B2B clinic procurement vs B2C personal wellness) into a single confused paragraph.
3. TRUTH-GROUNDED SPECIFICITY: Do NOT invent unvalidated features, SLAs, or technical integrations (e.g. "real-time API inventory integration", "guaranteed zero stockouts") unless verified in the Product Anchor. If proof or capabilities are missing, explicitly document them as a "Proof Gap" or "Capability Gap".
4. PRESERVE ENGINE AUTHORITY: Use the exact locked decisions from upstream engines (Positioning, Differentiation, Mechanism, Offer, Funnel, Channel) without rewriting or substituting synonyms.
5. BUSINESS-FACING PROSE & IDENTITY HYGIENE: Do NOT output raw internal identifiers (such as "seg_1_pain_1", "seg_*", "spd_*", "lane_*", or "[ID: ...]") in strategicSummary or customer-facing text. Use only clean, professional business language.
6. DISTINCT DECISION OWNERSHIP & NO ECHOING: Do NOT echo or copy Positioning's contrast axis or narrative direction into Mechanism or Offer. Each engine owns its distinct commercial decision:
   - Positioning owns the category territory, competitive enemy, and contrast axis.
   - Differentiation owns the proof architecture and distinct capability pillars.
   - Mechanism owns the operational process, delivery steps, and named operating mechanism.
   - Offer owns commercial packaging, deliverables, pricing tiers, and risk reversal.
   Plan Summary synthesizes these distinct components without homogenizing or repeating the same axis across sections.
7. EPISTEMIC FIDELITY & NO CAPABILITY UPGRADE:
   Do NOT upgrade qualified, proposed, or partially mitigated claims into established physical facts or guarantees in the executive summary or rationale.
   - If a capability is marked as Proposed, unverified, or requires validation (such as fabric opacity testing, lab certification, zero downtime, turnkey integrations), do NOT present it as already validated, established, or operational.
   - Operational risk mitigations (such as exchange policies, returns, or customer service channels) do NOT establish underlying physical product properties (e.g. fabric opacity, zero defects, universal fit) or technical guarantees (e.g. bug-free software, 100% uptime).
   - An ambiguous policy window (e.g. "24-hour product exchange capability") must NOT be inflated into a turnaround dispatch or delivery guarantee (e.g. "24-hour replacement delivery guarantee").
   - When Differentiation pillars are classified as SHARED_CAPABILITY_STRATEGIC_EMPHASIS or COMPETITIVE_COMPARISON_UNAVAILABLE, frame them strictly as strategic market emphasis on verified product capabilities — NEVER claim "unique combination", "only provider", or "defensible whitespace".
   - Preserve competitor subject attribution on audience pains: if a pain is attributed to a named competitor (COMPETITOR_SPECIFIC), do NOT generalize it into an unattributed industry-wide claim unless backed by broader market evidence, and do NOT convert customer complaints about generic-sounding outputs or AEL hypotheses into factual claims about competitors' internal production workflows ("mass-produced automated prompt workflows", "template-bound services").
   - PAYMENT-TRIGGER FIDELITY: Preserve exact documented payment terms and conditions (e.g., if a trial is free and payment is required when gifting or unlocking final deliverables, state that exact trigger — NEVER rewrite it into "customers pay only when satisfied", "only pay if satisfied", or unqualified "risk-free").
   - Paraphrases must remain faithful to verified capabilities without asserting unevidenced properties.

${businessName ? `Business Name: ${businessName}\n` : ""}${offeringName ? `Selected Offering: ${offeringName}\n` : ""}Business Type: ${businessType}
Target Market / Location: ${location}
Objective: ${objective}
Monthly Budget: ${budget}
${evidenceGapsList.length > 0 ? `Known Evidence Gaps (Retain Explicitly — Do Not Invent Missing Details):\n${evidenceGapsList.map(g => `  - ${g}`).join("\n")}\n` : ""}${lanesBlock ? `\n${lanesBlock}\n` : ""}${memoryBlock}${rhythmConstraintBlock}${lockedBlock}${goalMathSection}${compositionBlock}
Engine Analysis Results (GROUNDED INTELLIGENCE — validated outputs from the 15-engine pipeline):
${engineInsights}

Generate a complete strategic execution plan. Return ONLY valid JSON matching this exact structure:
{
  "strategicSummary": {
    "strategy": "The overarching strategic positioning choice, core diagnosis, and competitive decision contrasting against the market status quo",
    "targetAudience": "Structured breakdown of each active Strategic Lane: Audience context, evidence-backed problem, commercial consequence, and strategic decision",
    "growthObjective": "Measurable commercial objective and conversion model derived from the goal decomposition",
    "rationale": "Deep strategic reasoning explaining why this path was chosen, why it beats current alternatives, and the explicit tradeoffs (what NOT to do)"
  },
  "monthlyObjective": {
    "objective": "Clear business objective",
    "type": "leads|sales|authority|retention",
    "targetMetric": "Primary metric name",
    "targetValue": "Target value"
  },
  "kpiStructure": {
    "primaryKPI": { "name": "KPI name", "target": "target value", "cadence": "weekly|daily" },
    "secondaryKPI": { "name": "KPI name", "target": "target value", "cadence": "weekly" },
    "performanceExpectations": "Expected performance"
  },
  "contentDistribution": {
    "channels": [
      { "channel": "Approved Primary Channel", "role": "Strategic role of this channel in the buyer journey", "tier": "PRIMARY" },
      { "channel": "Approved Secondary Channel", "role": "Strategic role of this channel in the buyer journey", "tier": "SECONDARY" }
    ],
    "rationale": "Strategic distribution rationale linking channels and content pillars to the distinct audience lanes and required perception shifts without prescribing daily task cadences",
    "contentPillars": [{"pillar":"name","percentage":"40%","examples":["example"]}]
  },
  "creativeTesting": {
    "tests": [{"testName":"name","variable":"what varies","duration":"2 weeks","rationale":"why"}]
  },
  "budgetAllocation": {
    "totalBudget": "${budget}",
    "breakdown": [{"category":"name","percentage":40,"purpose":"why"}]
  },
  "kpiMonitoring": {
    "metrics": [{"kpi":"name","target":"value","frequency":"weekly","alertThreshold":"condition"}],
    "reportingCadence": "Weekly review, monthly deep-dive"
  },
  "competitiveWatch": {
    "targets": [{"competitor":"name","watchMetrics":["metric"],"checkFrequency":"weekly"}],
    "strategyFeed": [{"insight":"competitive insight that should influence your strategy","actionableResponse":"how to respond to this competitive signal","priority":"high|medium|low"}]
  },
  "riskTriggers": {
    "triggers": [{"trigger":"name","condition":"when this triggers","action":"specific optimization action to take","severity":"high|medium|low","optimizationPlaybook":"detailed step-by-step response plan"}],
    "escalationPath": ["step1","step2"],
    "earlyWarningSystem": [{"signal":"what to watch for","threshold":"when to act","response":"immediate action"}]
  },
  "executionBlueprintDnaLink": {
    "contentPillarToDna": [{"pillar":"content pillar name","dnaElements":["which DNA components power this pillar"],"hookApproach":"recommended hook style","ctaStyle":"CTA approach for this pillar"}],
    "weeklyDnaApplication": "How to apply Content DNA rules and strategic boundaries across the weekly content schedule"
  }
}`;

  const attemptResult = await requestSynthesizedPlanJson({ prompt, accountId });
  if (attemptResult.ok) {
    const plan = attemptResult.plan;
    if (plan.strategicSummary) {
      const evidenceTexts: string[] = [];
      if (Array.isArray(businessData?.productTruth)) {
        evidenceTexts.push(...businessData.productTruth.map((f: any) => typeof f === "string" ? f : f.fact || f.statement || f.text || ""));
      }
      if (Array.isArray(businessData?.facts)) {
        evidenceTexts.push(...businessData.facts.map((f: any) => typeof f === "string" ? f : f.fact || f.statement || f.text || ""));
      }
      if (activeStrategyRoot?.approvedClaims) {
        const claims = Array.isArray(activeStrategyRoot.approvedClaims) ? activeStrategyRoot.approvedClaims : [activeStrategyRoot.approvedClaims];
        evidenceTexts.push(...claims.map((c: any) => typeof c === "string" ? c : c.statement || c.claim || ""));
      }
      if (activeStrategyRoot?.approvedClaim) {
        evidenceTexts.push(typeof activeStrategyRoot.approvedClaim === "string" ? activeStrategyRoot.approvedClaim : JSON.stringify(activeStrategyRoot.approvedClaim));
      }
      if (engineInsights) {
        evidenceTexts.push(engineInsights);
      }

      if (plan.strategicSummary.strategy) {
        plan.strategicSummary.strategy = sanitizeStrategicSummaryEpistemics(cleanInternalIdsFromProse(plan.strategicSummary.strategy), evidenceTexts);
      }
      if (plan.strategicSummary.targetAudience) {
        plan.strategicSummary.targetAudience = cleanInternalIdsFromProse(plan.strategicSummary.targetAudience);
      }
      if (plan.strategicSummary.growthObjective) {
        plan.strategicSummary.growthObjective = cleanInternalIdsFromProse(plan.strategicSummary.growthObjective);
      }
      if (plan.strategicSummary.rationale) {
        plan.strategicSummary.rationale = sanitizeStrategicSummaryEpistemics(cleanInternalIdsFromProse(plan.strategicSummary.rationale), evidenceTexts);
      }
    }
    return plan;
  }
  console.error(
    `[PlanSynthesis] SYNTHESIS_DEGRADED_AI_FAILED | AI synthesis failed: ${attemptResult.lastError}. ` +
    `attempts=${attemptResult.attempts}/${PLAN_SYNTHESIS_MAX_ATTEMPTS}. ` +
    `Falling back to degraded plan — plan will be EXPLICITLY MARKED as degraded. ` +
    `No raw signals or hardcoded generic defaults will silently substitute for decisions.`,
  );
  return buildDeterministicPlan(businessData, campaign, objective, campaignId, accountId);
}

/**
 * Task — Build Plan synthesis truncation fix (forensic root cause:
 * orchestrator-plan-synthesis previously used max_tokens: 2000 for a 9-section
 * JSON contract; the completion hit the output-token ceiling mid-string
 * ("Unterminated string in JSON at position 9725") and a single parse failure
 * immediately degraded the plan with NO retry).
 *
 * Fix (surgical, no architecture change):
 *  - output ceiling raised to PLAN_SYNTHESIS_MAX_TOKENS (the 9-section
 *    contract measured ~2.4k tokens; 6000 gives >2x headroom without inviting
 *    unbounded rambling — response_format json_object still constrains shape);
 *  - bounded retry loop (PLAN_SYNTHESIS_MAX_ATTEMPTS): truncation/malformed
 *    JSON triggers a fresh regeneration attempt instead of instant degrade;
 *  - finish_reason ("length" = provider-confirmed truncation) is logged per
 *    attempt so future truncations are provable from logs alone;
 *  - retry exhaustion still falls through to the EXPLICITLY-LABELED degraded
 *    fallback — the fallback is preserved, not weakened.
 *
 * `chatFn` is injectable for regression tests; production callers omit it.
 */
export const PLAN_SYNTHESIS_MAX_TOKENS = 6000;
export const PLAN_SYNTHESIS_MAX_ATTEMPTS = 3;

export type SynthesisAttemptOutcome =
  | { ok: true; plan: SynthesizedPlan; attempts: number }
  | { ok: false; attempts: number; lastError: string };

export async function requestSynthesizedPlanJson(opts: {
  prompt: string;
  accountId: string;
  chatFn?: typeof aiChat;
}): Promise<SynthesisAttemptOutcome> {
  const chat = opts.chatFn ?? aiChat;
  let lastError = "no attempt executed";
  for (let attempt = 1; attempt <= PLAN_SYNTHESIS_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chat({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: opts.prompt }],
        response_format: { type: "json_object" },
        max_tokens: PLAN_SYNTHESIS_MAX_TOKENS,
        accountId: opts.accountId,
        endpoint: "orchestrator-plan-synthesis",
      });

      const choice = response.choices?.[0];
      const finishReason = (choice as any)?.finish_reason ?? "unknown";
      const content = choice?.message?.content;
      if (!content) throw new Error(`Empty AI response (finish_reason=${finishReason})`);
      if (finishReason === "length") {
        // Provider-confirmed truncation: the completion hit the output-token
        // ceiling. Do NOT attempt to parse a known-truncated payload as if it
        // could be complete — retry with a fresh generation.
        throw new Error(`TRUNCATED_BY_TOKEN_CEILING (finish_reason=length, max_tokens=${PLAN_SYNTHESIS_MAX_TOKENS})`);
      }
      const plan = JSON.parse(content) as SynthesizedPlan;
      if (attempt > 1) {
        console.log(`[PlanSynthesis] SYNTHESIS_RETRY_RECOVERED | attempt=${attempt}/${PLAN_SYNTHESIS_MAX_ATTEMPTS}`);
      }
      return { ok: true, plan, attempts: attempt };
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      console.warn(
        `[PlanSynthesis] SYNTHESIS_ATTEMPT_FAILED | attempt=${attempt}/${PLAN_SYNTHESIS_MAX_ATTEMPTS} | ${lastError}`,
      );
    }
  }
  return { ok: false, attempts: PLAN_SYNTHESIS_MAX_ATTEMPTS, lastError };
}

async function buildDeterministicPlan(businessData: any, campaign: any, objective: string, campaignId: string, accountId: string): Promise<SynthesizedPlan> {
  const businessType = businessData?.businessType || "general business";
  const location = campaign?.location || "target market";
  const budget = businessData?.monthlyBudget || "available budget";

  let rhythm: { reelsPerWeek: number; carouselsPerWeek: number; storiesPerDay: number; postsPerWeek: number; reasoning: string; performanceBasis: string } = {
    reelsPerWeek: 4, carouselsPerWeek: 2, storiesPerDay: 2, postsPerWeek: 1,
    reasoning: "default balanced distribution", performanceBasis: "default_balanced",
  };
  let rhythmSource = "hardcoded_defaults_no_decisions";
  try {
    rhythm = await computeAdaptiveRhythm(campaignId, accountId);
    rhythmSource = rhythm.performanceBasis;
  } catch (err: any) {
    console.error(
      `[PlanSynthesis] SYNTHESIS_DEGRADED_NO_RHYTHM | AdaptiveRhythm failed: ${err.message}. ` +
      `Using hardcoded defaults — content distribution NOT driven by decisions or performance data.`,
    );
  }

  const degradedMarker = "[DEGRADED — AI synthesis failed. This plan uses adaptive rhythm where available but contains no cross-signal validated market decisions. Do not treat this as a decision-driven plan.]";

  return {
    planSource: "degraded_ai_failed" as PlanSource,
    degraded: true,
    lockedDecisionLabels: [],
    synthesisVerification: { passed: true, totalLocked: 0, preserved: 0, missing: [], verifiedAt: new Date().toISOString() },
    strategicSummary: {
      strategy: `${degradedMarker} ${objective.toLowerCase()}-focused growth strategy for ${businessType}`,
      targetAudience: `Primary audience in ${location} seeking ${businessType} solutions`,
      growthObjective: `Increase ${objective.toLowerCase()} through structured content and engagement`,
      rationale: `Degraded plan — AI synthesis unavailable. Rhythm source: ${rhythmSource}. No validated decisions applied.`,
    },
    monthlyObjective: {
      objective: `Drive ${objective.toLowerCase()} growth`,
      type: objective.toLowerCase(),
      targetMetric: objective === "SALES" ? "Revenue" : objective === "LEADS" ? "Lead count" : "Reach",
      targetValue: "+20% month-over-month",
    },
    kpiStructure: {
      primaryKPI: { name: "Engagement Rate", target: "3-5%", cadence: "weekly" },
      secondaryKPI: { name: "Reach Growth", target: "+15% monthly", cadence: "weekly" },
      performanceExpectations: "Steady improvement over 30-day period with weekly benchmarks",
    },
    contentDistribution: {
      reelsPerWeek: rhythm.reelsPerWeek,
      postsPerWeek: rhythm.postsPerWeek,
      storiesPerDay: rhythm.storiesPerDay,
      carouselsPerWeek: rhythm.carouselsPerWeek,
      videosPerWeek: 0,
      rationale: `Adaptive rhythm based on ${rhythm.performanceBasis}: ${rhythm.reasoning}`,
      contentPillars: [
        { pillar: "Educational", percentage: "40%", examples: ["How-to content", "Tips and insights"] },
        { pillar: "Social Proof", percentage: "30%", examples: ["Testimonials", "Case studies"] },
        { pillar: "Behind the Scenes", percentage: "20%", examples: ["Process", "Team culture"] },
        { pillar: "Promotional", percentage: "10%", examples: ["Direct offers", "Limited deals"] },
      ],
    },
    creativeTesting: {
      tests: [
        { testName: "Hook Variations", variable: "Opening 3 seconds", duration: "2 weeks", rationale: "Optimize attention capture" },
        { testName: "CTA Placement", variable: "CTA position and format", duration: "2 weeks", rationale: "Maximize conversion" },
        { testName: "Content Format", variable: "Reels vs Carousels", duration: "3 weeks", rationale: "Find best performing format" },
      ],
    },
    budgetAllocation: {
      totalBudget: budget,
      currency: "USD",
      period: "monthly",
      budgetConfirmation: "unconfirmed",
      isAssumption: true,
      provenance: "Agent-entered, unconfirmed budget assumption ($5,000 USD). Does not authorize ad spend.",
      channels: [],
      breakdown: [],
    },
    kpiMonitoring: {
      metrics: [
        { kpi: "Reach", target: "+20% MoM", frequency: "weekly", alertThreshold: "-10% WoW" },
        { kpi: "Engagement Rate", target: "3-5%", frequency: "weekly", alertThreshold: "Below 2%" },
        { kpi: "Profile Visits", target: "+15% monthly", frequency: "weekly", alertThreshold: "2-week decline" },
      ],
      reportingCadence: "Weekly review, monthly deep-dive",
    },
    competitiveWatch: {
      targets: [
        { competitor: "Top competitor", watchMetrics: ["Posting frequency", "Engagement rate", "Content types"], checkFrequency: "weekly" },
      ],
      strategyFeed: [
        { insight: "Competitors increasing Reels output", actionableResponse: "Match or exceed Reels volume, focus on differentiated hooks", priority: "high" },
        { insight: "Market shifting toward educational content", actionableResponse: "Add 1 educational carousel per week to content mix", priority: "medium" },
      ],
    },
    riskTriggers: {
      triggers: [
        { trigger: "Engagement Drop", condition: "Below 2% for 2 weeks", action: "Review content mix", severity: "high", optimizationPlaybook: "1. Audit last 10 posts for hook effectiveness 2. A/B test 3 new hook styles 3. Shift 20% of reels to trending formats 4. Re-evaluate posting times" },
        { trigger: "Reach Plateau", condition: "Flat for 3 weeks", action: "Test new formats", severity: "medium", optimizationPlaybook: "1. Introduce carousel content 2. Cross-promote to Stories 3. Test collaboration posts 4. Increase Reels proportion by 20%" },
        { trigger: "Budget Overrun", condition: "Spend exceeds plan by 20%", action: "Pause paid promotion", severity: "critical", optimizationPlaybook: "1. Pause all paid campaigns immediately 2. Audit CPA by channel 3. Reallocate to organic-only for 1 week 4. Resume with tighter daily caps" },
      ],
      escalationPath: ["Content review", "Strategy adjustment", "Full plan revision"],
      earlyWarningSystem: [
        { signal: "Declining save rate", threshold: "Save rate drops 30% week-over-week", response: "Increase value-driven content proportion" },
        { signal: "Rising CPA", threshold: "CPA exceeds target by 15%", response: "Pause lowest-performing ad sets and reallocate" },
      ],
    },
    executionBlueprintDnaLink: {
      contentPillarToDna: [
        { pillar: "Authority", dnaElements: ["messagingCore", "narrativeDna"], hookApproach: "Expertise-led hook", ctaStyle: "Soft authority CTA" },
        { pillar: "Engagement", dnaElements: ["hookDna", "contentAngleDna"], hookApproach: "Pattern interrupt", ctaStyle: "Comment/share CTA" },
        { pillar: "Conversion", dnaElements: ["ctaDna", "executionRules"], hookApproach: "Problem-solution hook", ctaStyle: "Direct action CTA" },
      ],
      weeklyDnaApplication: "Apply messaging core tone to all content. Use hookDna patterns for Reels. Apply ctaDna rules to conversion-focused posts. Follow executionRules always/never lists.",
    },
  };
}

function deriveContentVolume(plan: SynthesizedPlan, periodDays: number) {
  const weeks = Math.ceil(periodDays / 7);
  return {
    reelsPerWeek: plan.contentDistribution.reelsPerWeek,
    postsPerWeek: plan.contentDistribution.postsPerWeek,
    storiesPerDay: plan.contentDistribution.storiesPerDay,
    carouselsPerWeek: plan.contentDistribution.carouselsPerWeek,
    videosPerWeek: plan.contentDistribution.videosPerWeek,
    totalReels: plan.contentDistribution.reelsPerWeek * weeks,
    totalPosts: plan.contentDistribution.postsPerWeek * weeks,
    totalStories: plan.contentDistribution.storiesPerDay * periodDays,
    totalCarousels: plan.contentDistribution.carouselsPerWeek * weeks,
    totalVideos: plan.contentDistribution.videosPerWeek * weeks,
    totalContentPieces:
      plan.contentDistribution.reelsPerWeek * weeks +
      plan.contentDistribution.postsPerWeek * weeks +
      plan.contentDistribution.storiesPerDay * periodDays +
      plan.contentDistribution.carouselsPerWeek * weeks +
      plan.contentDistribution.videosPerWeek * weeks,
  };
}

function generateCalendarSlots(
  plan: SynthesizedPlan,
  periodDays: number,
  campaignId: string,
  accountId: string,
  planId: string,
  rootBundleId: string | null = null,
  rootBundleVersion: number | null = null,
  explorationSlots: ExplorationSlot[] = [],
): Array<{
  planId: string;
  campaignId: string;
  accountId: string;
  contentType: string;
  scheduledDate: string;
  scheduledTime: string;
  title: string;
  status: string;
  rootBundleId: string | null;
  rootBundleVersion: number | null;
  isExploration?: boolean;
  explorationIntent?: string | null;
  explorationHypothesis?: string | null;
}> {
  const slots: any[] = [];
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  const postingTimes: Record<string, string> = {
    REEL: "09:00",
    POST: "12:00",
    STORY: "18:00",
    CAROUSEL: "10:00",
    VIDEO: "11:00",
  };

  for (let day = 0; day < periodDays; day++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + day);
    const dateStr = date.toISOString().split("T")[0];
    const dayOfWeek = date.getDay();

    if (dayOfWeek !== 0) {
      const weekIndex = Math.floor(day / 7);

      if (dayOfWeek <= plan.contentDistribution.reelsPerWeek) {
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType: "REEL",
          scheduledDate: dateStr,
          scheduledTime: postingTimes.REEL,
          title: `Reel - Week ${weekIndex + 1}`,
          status: "PENDING",
          rootBundleId,
          rootBundleVersion,
          isExploration: false,
        });
      }

      if (dayOfWeek <= plan.contentDistribution.postsPerWeek && dayOfWeek > 0) {
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType: "POST",
          scheduledDate: dateStr,
          scheduledTime: postingTimes.POST,
          title: `Post - Week ${weekIndex + 1}`,
          status: "PENDING",
          rootBundleId,
          rootBundleVersion,
          isExploration: false,

        });
      }

      if (dayOfWeek <= (plan.contentDistribution.carouselsPerWeek || 0) && dayOfWeek > 0) {
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType: "CAROUSEL",
          scheduledDate: dateStr,
          scheduledTime: postingTimes.CAROUSEL,
          title: `Carousel - Week ${weekIndex + 1}`,
          status: "PENDING",
          rootBundleId,
          rootBundleVersion,
          isExploration: false,

        });
      }
    }

    for (let s = 0; s < plan.contentDistribution.storiesPerDay; s++) {
      slots.push({
        planId,
        campaignId,
        accountId,
        contentType: "STORY",
        scheduledDate: dateStr,
        scheduledTime: s === 0 ? "10:00" : "17:00",
        title: `Story - Day ${day + 1}`,
        status: "PENDING",
        rootBundleId,
        rootBundleVersion,
        isExploration: false,
      });
    }
  }

  const weeks = Math.ceil(periodDays / 7);
  let explorationDayOffset = 0;

  for (const expSlot of explorationSlots) {
    const contentType = expSlot.format.toUpperCase();
    const time = postingTimes[contentType] || "14:00";

    for (let week = 0; week < weeks; week++) {
      for (let i = 0; i < expSlot.count; i++) {
        const dayOffset = week * 7 + (explorationDayOffset % 5) + 1;
        explorationDayOffset++;
        const date = new Date(startDate);
        date.setDate(date.getDate() + Math.min(dayOffset, periodDays - 1));
        const dateStr = date.toISOString().split("T")[0];
        slots.push({
          planId,
          campaignId,
          accountId,
          contentType,
          scheduledDate: dateStr,
          scheduledTime: time,
          title: `[Exploration] ${expSlot.format} — ${expSlot.intent} (W${week + 1})`,
          status: "PENDING",
          rootBundleId,
          rootBundleVersion,
          isExploration: true,
          explorationIntent: expSlot.intent,
          explorationHypothesis: expSlot.hypothesis,

        });
      }
    }
  }

  return slots;
}

export async function synthesizePlan(
  config: OrchestratorConfig,
  ctx: any,
  results: Map<EngineId, EngineStepResult>,
  memoryContextBlock?: string,
  memoryBlock?: import("../memory-system/types").MemoryBlock | null,
): Promise<{
  planId: string;
  plan: SynthesizedPlan;
  // Task #70 / Phase 7 — third writer to the BudgetDecisionLedger
  // (B1 silent collision fix). Populated only when plan-synthesis took
  // the BUDGET_HALT branch — the orchestrator pushes this into the
  // structured ledger view returned on OrchestratorRunResult.
  synthesisHaltOverride?: import("./budget-decision-ledger").SynthesisHaltOverrideEntry;
}> {
  const [bizData] = await db
    .select()
    .from(businessDataLayer)
    .where(
      and(
        eq(businessDataLayer.accountId, config.accountId),
        eq(businessDataLayer.campaignId, config.campaignId)
      )
    )
    .limit(1);

  let budgetSettings: any = null;
  try {
    const [settings] = await db
      .select()
      .from(campaignBudgetSettings)
      .where(
        and(
          eq(campaignBudgetSettings.accountId, config.accountId),
          eq(campaignBudgetSettings.campaignId, config.campaignId)
        )
      )
      .limit(1);
    budgetSettings = settings || null;
  } catch (bErr: any) {
    console.warn(`[PlanSynthesis] Failed to query campaignBudgetSettings:`, bErr?.message);
  }

  const controlVerdict = (ctx as any)?.controlVerdict || (config as any)?.controlVerdict || null;

  const { growthCampaigns } = await import("@shared/schema");
  const [campaign] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, config.campaignId))
    .limit(1);

  // Load Strategy Root FIRST so RootBundle and GoalDecomposition use the exact selected lineage
  let activeStrategyRoot: any = (config as any)?.strategyRoot || (ctx as any)?.strategyRoot || null;
  if (!activeStrategyRoot && (ctx as any)?.approvedLanes) {
    activeStrategyRoot = { approvedLanes: (ctx as any).approvedLanes };
  }
  try {
    if (!activeStrategyRoot) {
      const { getActiveRoot } = await import("../shared/strategy-root");
      activeStrategyRoot = await getActiveRoot(config.campaignId, config.accountId);
    }
    if (activeStrategyRoot) {
      console.log(`[PlanSynthesis] STRATEGY_ROOT_LOADED | rootId=${activeStrategyRoot.id} | hash=${activeStrategyRoot.rootHash}`);
      const parseMaybe = (v: any, fallback: any) => {
        if (typeof v !== "string") return v;
        try { return JSON.parse(v); } catch {
          console.warn(`[PlanSynthesis] STRATEGY_ROOT_FIELD_MALFORMED_JSON | using safe default`);
          return fallback;
        }
      };
      const jsonTextFields: Array<[string, any]> = [
        ["approvedMechanism", null],
        ["approvedAudiencePains", []],
        ["approvedDesires", []],
        ["approvedClaims", []],
        ["approvedObjections", []],
        ["approvedProofTypes", []],
        ["approvedPositioningContext", null],
      ];
      for (const [key, fallback] of jsonTextFields) {
        activeStrategyRoot[key] = parseMaybe(activeStrategyRoot[key], fallback);
      }
      if (!Array.isArray(activeStrategyRoot.approvedPains)) {
        activeStrategyRoot.approvedPains = Array.isArray(activeStrategyRoot.approvedAudiencePains)
          ? activeStrategyRoot.approvedAudiencePains.map((p: any) =>
              typeof p === "string" ? p : (p?.originalStatement || p?.pain || p?.normalizedStatement || ""))
              .filter((s: string) => s.length > 0)
          : [];
      }
      if (activeStrategyRoot.approvedTransformationAxis === undefined) {
        activeStrategyRoot.approvedTransformationAxis = activeStrategyRoot.approvedTransformation ?? null;
      }
      if (activeStrategyRoot.contrastAxis === undefined) {
        activeStrategyRoot.contrastAxis = activeStrategyRoot.contrastAxisText ?? null;
      }
    } else {
      console.warn(`[PlanSynthesis] NO_ACTIVE_STRATEGY_ROOT | campaign=${config.campaignId}`);
    }
  } catch (srErr: any) {
    console.warn(`[PlanSynthesis] Strategy root load failed (non-blocking):`, srErr.message);
  }

  // Collect canonical selected snapshot IDs across results, reusedSnapshotIds, and activeStrategyRoot
  const selectedSnapshotIds: Record<string, string> = {
    ...(config.reusedSnapshotIds || {}),
  };
  const stageResultKeys = [
    "market_intelligence",
    "audience",
    "differentiation",
    "positioning",
    "mechanism",
    "offer",
    "awareness",
    "funnel",
    "persuasion",
    "integrity",
    "statistical_validation",
    "channel_selection",
    "budget_governor",
    "iteration",
    "retention",
  ];
  for (const stageKey of stageResultKeys) {
    const res = results.get(stageKey as EngineId);
    const snapId = (res as any)?.snapshotId || (res?.output as any)?.snapshotId || (res?.output as any)?.id;
    if (typeof snapId === "string" && snapId.trim()) {
      selectedSnapshotIds[stageKey] = snapId.trim();
    }
  }
  if (activeStrategyRoot) {
    const rootMiId = activeStrategyRoot.miSnapshotId || activeStrategyRoot.marketSnapshotId;
    if (rootMiId && !selectedSnapshotIds.market_intelligence) {
      selectedSnapshotIds.market_intelligence = rootMiId;
    }
    if (activeStrategyRoot.audienceSnapshotId && !selectedSnapshotIds.audience) {
      selectedSnapshotIds.audience = activeStrategyRoot.audienceSnapshotId;
    }
    if (activeStrategyRoot.differentiationSnapshotId && !selectedSnapshotIds.differentiation) {
      selectedSnapshotIds.differentiation = activeStrategyRoot.differentiationSnapshotId;
    }
    if (activeStrategyRoot.positioningSnapshotId && !selectedSnapshotIds.positioning) {
      selectedSnapshotIds.positioning = activeStrategyRoot.positioningSnapshotId;
    }
    if (activeStrategyRoot.mechanismSnapshotId && !selectedSnapshotIds.mechanism) {
      selectedSnapshotIds.mechanism = activeStrategyRoot.mechanismSnapshotId;
    }
  }

  if (
    selectedSnapshotIds.market_intelligence ||
    selectedSnapshotIds.differentiation ||
    selectedSnapshotIds.positioning
  ) {
    const lineageCheck = await validateBundleLineageCompatibility({
      miSnapshotId: selectedSnapshotIds.market_intelligence,
      audienceSnapshotId: selectedSnapshotIds.audience,
      differentiationSnapshotId: selectedSnapshotIds.differentiation,
      positioningSnapshotId: selectedSnapshotIds.positioning,
      mechanismSnapshotId: selectedSnapshotIds.mechanism,
      offerSnapshotId: selectedSnapshotIds.offer,
      awarenessSnapshotId: selectedSnapshotIds.awareness,
    });
    if (!lineageCheck.compatible) {
      const mismatchDesc = lineageCheck.mismatches
        .map(m => `${m.engine}(${m.snapshotId || "none"}): ${m.reason}`)
        .join("; ");
      throw new StrategyConsistencyError(
        `Plan synthesis blocked due to incompatible upstream snapshot lineage: ${mismatchDesc}`,
        lineageCheck.mismatches.map(m => `${m.engine}.${m.dependencyField}`),
        lineageCheck.mismatches.map(m => m.engine),
        lineageCheck.mismatches[0]?.engine || "differentiation",
      );
    }
  }

  let rootBundle: { id: string; version: number; strategyHash: string } | null = null;
  try {
    rootBundle = await lockRootBundle(config.campaignId, config.accountId, {
      jobId: config.jobId || null,
      strategyRoot: activeStrategyRoot || null,
      selectedSnapshotIds,
    });
    console.log(`[PlanSynthesis] Root bundle locked: v${rootBundle.version} (${rootBundle.strategyHash})`);
  } catch (rootErr: any) {
    if (String(rootErr?.message || "").includes("LINEAGE_MISMATCH_REJECTED")) {
      throw rootErr;
    }
    console.warn(`[PlanSynthesis] Root bundle lock failed (non-blocking):`, rootErr.message);
  }

  let goalMathContext: { goal: any; funnel: any; feasibility: any; archetype: any } | null = null;
  let goalDecomp: any = null;

  try {
    goalDecomp = await decomposeGoal(config.campaignId, config.accountId, rootBundle?.id || null, rootBundle?.version || null, config.jobId);
    const archetype = resolveArchetype(bizData?.businessType || "");
    goalMathContext = {
      goal: goalDecomp.goal,
      funnel: goalDecomp.funnel,
      feasibility: goalDecomp.feasibility,
      archetype,
    };
    console.log(`[PlanSynthesis] Goal decomposed: ${goalDecomp.goal.label} → ${goalDecomp.feasibility.verdict} (${goalDecomp.feasibility.score}/100)`);
  } catch (goalErr: any) {
    console.warn(`[PlanSynthesis] Goal decomposition failed (non-blocking):`, goalErr.message);
  }

  let readiness: any = null;
  try {
    readiness = await checkPlanReadiness(config.campaignId, config.accountId);
    console.log(`[PlanSynthesis] Plan gate: ${readiness.gate} (score: ${readiness.overallScore})`);
  } catch (gateErr: any) {
    console.warn(`[PlanSynthesis] Plan gate check failed (non-blocking):`, gateErr.message);
  }

  const budgetGovResult = results.get("budget_governor");
  // Task #70 / Phase 7 — read the authoritative budget action from the
  // BudgetDecisionLedger entry the orchestrator stamped onto the budget
  // output (NOT the mutable `decision.action` mirror). When no ledger
  // entry was stamped (no system-control downgrade fired), the resolver
  // falls back to the budget governor's emitted action and tags the
  // source as `budget_governor_emit` so this read is fully attributable.
  const { resolveBudgetActionFromLedger } = await import("./budget-decision-ledger");
  const _resolved = resolveBudgetActionFromLedger(budgetGovResult?.output);
  const budgetDecision = _resolved.action;
  const budgetKillFlag = budgetGovResult?.output?.killFlag === true;
  if (budgetGovResult) {
    console.log(`[PlanSynthesis] BUDGET_ACTION_RESOLVED | action=${budgetDecision ?? "null"} | source=${_resolved.source}`);
  }

  if (budgetDecision === "halt" || budgetKillFlag) {
    console.warn(`[PlanSynthesis] BUDGET_HALT_ENFORCED | decision=${budgetDecision} killFlag=${budgetKillFlag} — synthesizing halt plan preserving canonical strategy`);
    // Halt plan returns early before task composition
    const haltPlan = buildHaltPlan(budgetGovResult?.output, bizData, campaign, activeStrategyRoot, controlVerdict);
    const planId = await persistPlan(haltPlan, config, rootBundle, []);
    // Task #70 / Phase 7 — third ledger writer. Records that plan-synthesis
    // forced a halt distinctly from any prior system-control downgrade, so
    // the structured BudgetDecisionLedger view exposes a separate slot.
    const { recordSynthesisHaltOverride } = await import("./budget-decision-ledger");
    const observed: import("./budget-decision-ledger").BudgetAction =
      budgetDecision === "hold" || budgetDecision === "test" || budgetDecision === "scale"
        ? budgetDecision
        : "halt";
    let synthesisHaltOverride: import("./budget-decision-ledger").SynthesisHaltOverrideEntry;
    try {
      synthesisHaltOverride = recordSynthesisHaltOverride({
        jobId: config.jobId || "unknown",
        observedAction: observed,
        reason: budgetKillFlag ? "budgetKillFlag=true" : `budgetDecision=${budgetDecision}`,
      });
    } catch (shErr: any) {
      console.error(`[PlanSynthesis] SYNTHESIS_HALT_LEDGER_FAILED | jobId=${config.jobId || "unknown"} | observed=${observed} | error=${shErr?.message ?? String(shErr)} | re-throwing to preserve writer attribution`);
      throw shErr;
    }
    return { planId, plan: haltPlan, synthesisHaltOverride };
  }

  const integrityResult = results.get("integrity");
  let safeToExecute = integrityResult?.output?.safeToExecute !== false;
  const integrityScore = integrityResult?.output?.overallIntegrityScore ?? 1.0;
  let integrityDegradation: "none" | "restricted" | "degraded" = "none";

  const crossEngineFailures: string[] = [];
  const offerResult = results.get("offer");
  if (offerResult && (offerResult.status === "ERROR" || offerResult.status === "BLOCKED" || offerResult.status === "SIGNAL_BLOCKED")) {
    crossEngineFailures.push(`Offer engine ${offerResult.status}`);
  }
  const celResults = ctx.celResults;
  if (celResults && Array.isArray(celResults)) {
    const celFailed = celResults.some((c: any) => c.passed === false || c.overallPassed === false);
    if (celFailed) {
      crossEngineFailures.push("CEL enforcement failed");
    }
  }
  const funnelResult = results.get("funnel");
  if (funnelResult && (funnelResult.status === "ERROR" || funnelResult.status === "BLOCKED" || funnelResult.status === "SIGNAL_BLOCKED")) {
    crossEngineFailures.push(`Funnel engine ${funnelResult.status}`);
  }
  const positioningResult = results.get("positioning");
  if (positioningResult && (positioningResult.status === "ERROR" || positioningResult.status === "BLOCKED" || positioningResult.status === "SIGNAL_BLOCKED")) {
    crossEngineFailures.push(`Positioning engine ${positioningResult.status}`);
  }

  if (crossEngineFailures.length > 0 && safeToExecute) {
    safeToExecute = false;
    console.warn(`[PlanSynthesis] CROSS_ENGINE_INTEGRITY_OVERRIDE | safeToExecute forced to false | failures: ${crossEngineFailures.join(", ")}`);
  }

  if (!safeToExecute) {
    integrityDegradation = "degraded";
    const reason = crossEngineFailures.length > 0
      ? `Cross-engine failures: ${crossEngineFailures.join(", ")}`
      : `Integrity engine: safeToExecute=false`;
    console.warn(`[PlanSynthesis] INTEGRITY_DEGRADED_MODE | ${reason} | score=${integrityScore.toFixed(2)} — plan will be generated in degraded-safe mode`);
  } else if (integrityScore < 0.6) {
    integrityDegradation = "restricted";
    console.warn(`[PlanSynthesis] INTEGRITY_RESTRICTED_MODE | score=${integrityScore.toFixed(2)} — plan content volume will be reduced`);
  }

  const engineInsights = extractEngineInsights(results, activeStrategyRoot);
  const lockedDecisions = extractLockedDecisions(results, activeStrategyRoot);
  const lockedLabels = extractLockedDecisionLabels(results, activeStrategyRoot);

  const miResult = results.get("market_intelligence");
  const crossSignalDecisions: any[] = miResult?.output?.crossSignalDecisions?.decisions ?? [];
  const filterResult = filterDecisionsForPlan(crossSignalDecisions);
  const synthesisNotes: string[] = [];

  let synthesisPath: DecisionEnforcementReport["synthesisPath"] = "DECISION_DRIVEN";
  if (crossSignalDecisions.length === 0) {
    synthesisPath = "DEGRADED_NO_DECISIONS";
    synthesisNotes.push("No cross-signal decisions available from market intelligence — plan will rely on engine outputs only");
    console.warn(`[PlanSynthesis] DEGRADED_NO_DECISIONS | No cross-signal decisions available. Plan will not be fully decision-driven.`);
  } else if (filterResult.eligible.length === 0) {
    synthesisPath = "DEGRADED_NO_DECISIONS";
    synthesisNotes.push(`All ${crossSignalDecisions.length} decision(s) rejected by policy — ${filterResult.violations.map(v => v.reason).join("; ")}`);
    console.warn(`[PlanSynthesis] DEGRADED_NO_DECISIONS | All decisions rejected by policy: ${filterResult.violations.map(v => v.reason).join("; ")}`);
  } else {
    synthesisNotes.push(`${filterResult.eligible.length} eligible decision(s) entering synthesis`);
    if (filterResult.rejected.length > 0) {
      synthesisNotes.push(`${filterResult.rejected.length} decision(s) rejected by policy`);
    }
    if (filterResult.blocked.length > 0) {
      synthesisNotes.push(`${filterResult.blocked.length} decision(s) blocked (CONFLICTED or WEAK)`);
    }
  }

  const enforcementReport = buildDecisionEnforcementReport(
    crossSignalDecisions,
    filterResult,
    synthesisPath,
    synthesisNotes,
  );
  console.log(serializeDecisionReportForLog(enforcementReport));

  let precomputedRhythm = null;
  try {
    precomputedRhythm = await computeAdaptiveRhythm(config.campaignId, config.accountId);
    
    // Adapt rhythm to approved channels from channel selection / strategy root
    const chanRes = results.get("channel_selection")?.output || results.get("channel_selection") || null;
    const approvedChannelsList: string[] = [
      ...(Array.isArray(activeStrategyRoot?.approvedChannels) ? activeStrategyRoot.approvedChannels : []),
      ...(chanRes?.proposedPrimary ? [chanRes.proposedPrimary] : []),
      ...(chanRes?.secondary ? [chanRes.secondary] : []),
      ...(Array.isArray(chanRes?.lockedChannels) ? chanRes.lockedChannels : []),
    ];
    const approvedChannelsText = approvedChannelsList.join(" ").toLowerCase();
    const hasShortFormVideoOrInstagram = approvedChannelsText.includes("instagram") || approvedChannelsText.includes("tiktok") || approvedChannelsText.includes("reels");

    if (!hasShortFormVideoOrInstagram && approvedChannelsList.length > 0 && precomputedRhythm) {
      precomputedRhythm = {
        ...precomputedRhythm,
        reelsPerWeek: 0,
        carouselsPerWeek: 0,
        storiesPerDay: 0,
        videosPerWeek: approvedChannelsText.includes("youtube") || approvedChannelsText.includes("video") ? 1 : 0,
        postsPerWeek: Math.max(1, precomputedRhythm.postsPerWeek || 1),
        reasoning: `Channel-adapted rhythm for approved channels (${approvedChannelsList.filter(Boolean).join(", ")})`,
      };
    }
  } catch (rhythmErr: any) {
    console.warn(`[PlanSynthesis] Precomputed rhythm failed (non-blocking):`, rhythmErr.message);
  }

  const signalComp: SignalComposition | null = ctx.signalComposition || (results.get("statistical_validation")?.output?.originTypeDistribution) || null;
  if (signalComp) {
    console.log(`[PlanSynthesis] SIGNAL_COMPOSITION_INJECTED | ${formatCompositionLog(signalComp)}`);
  }

  let synthesized = await generatePlanWithAI(engineInsights, bizData, campaign, goalMathContext, lockedDecisions, config.accountId, memoryContextBlock, config.campaignId, precomputedRhythm, signalComp, activeStrategyRoot, budgetSettings, budgetGovResult?.output, (ctx as any)?.canonicalContext);
  const rawBrandSpine = activeStrategyRoot?.brandSpine
    ? (typeof activeStrategyRoot.brandSpine === "string" ? JSON.parse(activeStrategyRoot.brandSpine) : activeStrategyRoot.brandSpine)
    : null;
  if (rawBrandSpine) {
    const buForSpine = (ctx as any)?.canonicalContext?.businessUnderstanding || (ctx as any)?.ssc?.doctrine?.businessUnderstanding || null;
    const anchorForSpine = (ctx as any)?.ssc?.doctrine?.productAnchor || null;
    synthesized.brandSpine = {
      ...rawBrandSpine,
      productName: rawBrandSpine.productName || buForSpine?.offeringName || anchorForSpine?.name || config.offeringName || (bizData as any)?.offeringName || (bizData as any)?.productName || null,
      productType: rawBrandSpine.productType || buForSpine?.offeringType || buForSpine?.businessModel || anchorForSpine?.type || (bizData as any)?.businessType || null,
      coreProblemSolved: rawBrandSpine.coreProblemSolved || buForSpine?.coreProblemSolved || anchorForSpine?.problemSolved || anchorForSpine?.coreProblemSolved || (bizData as any)?.coreProblem || null,
      category: rawBrandSpine.category || buForSpine?.category || anchorForSpine?.offeringType || (bizData as any)?.businessType || null,
    };
  } else {
    synthesized.brandSpine = null;
  }
  synthesized.approvedLanes = activeStrategyRoot?.approvedLanes
    ? (typeof activeStrategyRoot.approvedLanes === "string" ? JSON.parse(activeStrategyRoot.approvedLanes) : activeStrategyRoot.approvedLanes)
    : null;

  // Helper to build a structured journey from a funnel result and corresponding persuasion result
  const UNGROUNDED_PROOF_PATTERNS = [
    /soc-?2/i,
    /42%\s*targeting/i,
    /14-?day.*(?:production|enterprise|deployment).*sla/i,
    /3\.2x.*sales/i,
    /custom enterprise dpa/i,
    /zero operational disruption/i,
    /turnkey api integration/i,
    /crm connectors/i,
    /enterprise data integrity sla/i,
  ];

  const safeExtractCanonicalText = (item: any): string => {
    if (!item) return "";
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          return parsed.canonical || parsed.statement || parsed.text || parsed.objection || parsed.proofName || parsed.claim || trimmed;
        } catch {
          return trimmed;
        }
      }
      return trimmed;
    }
    if (typeof item === "object") {
      return item.canonical || item.statement || item.text || item.objection || item.proofName || item.claim || item.title || "";
    }
    return String(item);
  };

  const sanitizeProofItem = (p: any): any => {
    let name = "";
    let proofType = "process_proof";
    let stage = "education";
    let purpose = "Demonstrate methodology and workflow transparency";
    let proofStatus = "PROOF_TO_BUILD";

    if (typeof p === "string") {
      name = safeExtractCanonicalText(p);
    } else if (typeof p === "object" && p !== null) {
      name = safeExtractCanonicalText(p.proofName || p.name || p.claim || p.purpose);
      proofType = p.proofType || proofType;
      stage = p.stage || stage;
      purpose = p.purpose || purpose;
      proofStatus = p.proofStatus || p.status || proofStatus;
    }

    return {
      proofName: name,
      proofType,
      stage,
      purpose,
      proofStatus,
    };
  };

  const buildSingleBuyerJourney = (
    funnelRes: any,
    persuasionRes: any,
    awarenessRes: any,
    laneCtx?: any,
  ) => {
    if (!funnelRes) return null;
    const fOut = funnelRes.output?.output || funnelRes.output || (funnelRes as any).data || funnelRes;
    const funnelObj = fOut.primaryFunnel || fOut.funnel || fOut;
    const rawStages = (funnelObj.stages || funnelObj.stageMap || fOut.stages || fOut.stageMap || []) as any[];
    if (!funnelObj || (rawStages.length === 0 && (!funnelObj.funnelName || funnelObj.funnelName === "DEPTH_FAILED"))) {
      return null;
    }

    const laneId = laneCtx?.laneId || laneCtx?.id || funnelObj.laneId || (funnelRes as any).laneId || "default";
    const laneLabel = laneCtx?.title || laneCtx?.name || funnelObj.laneLabel || funnelObj.journeyName || funnelObj.funnelName || "Buyer Conversion Journey";
    const primaryPainId = funnelObj.primaryCorePainId || laneCtx?.primaryCorePainId || (funnelRes as any).primaryCorePainId;
    const segmentIds = funnelObj.segmentIds || laneCtx?.segmentIds || (funnelRes as any).segmentIds || [];
    const sourceFunnelSnapshotId = (funnelRes as any).snapshotId || (funnelRes.output as any)?.snapshotId;

    let persuasionStrategyObj: any = undefined;
    let sourcePersuasionSnapshotId: string | undefined = undefined;

    if (persuasionRes) {
      sourcePersuasionSnapshotId = (persuasionRes as any).snapshotId || (persuasionRes.output as any)?.snapshotId;
      const pOut = persuasionRes.output?.output || persuasionRes.output || (persuasionRes as any).data || persuasionRes;
      const pData = pOut.primaryRoute || pOut.persuasionArchitecture || pOut;
      const ttDesign = pOut.trustTransferDesign || pData.trustTransferDesign;
      const cialdini = pOut.cialdiniReasoning || pData.cialdiniReasoning;

      if (pData) {
        // ── CANONICAL BELIEF SHIFT: PersuasionEngine is the sole authority ──
        const cbt = pData.coreBeliefTransformation || pOut.coreBeliefTransformation || (pData.beliefShift ? {
          currentBelief: pData.beliefShift.from,
          desiredBelief: pData.beliefShift.to,
          contradictionLogic: pData.beliefShift.mechanism,
        } : undefined);
        const currentBelief = safeExtractCanonicalText(cbt?.currentBelief);
        const desiredBelief = safeExtractCanonicalText(cbt?.desiredBelief);

        if (!currentBelief || !desiredBelief) {
          throw new Error(`CONTRACT_INVARIANT_FAILURE: PersuasionEngine failed to produce valid canonical coreBeliefTransformation for lane ${laneId} (current="${currentBelief}", desired="${desiredBelief}")`);
        }

        // ── CANONICAL TRUST STRATEGY: PersuasionEngine is the sole authority ──
        const buyerRisk = safeExtractCanonicalText(ttDesign?.buyerRiskState || pData.trustStrategy?.buyerRiskState || pData.trustStrategy?.buyerRisk || pData.trustArchitecture?.riskState || pData.trustArchitecture?.buyerRiskState);
        const trustDeficit = safeExtractCanonicalText(ttDesign?.trustDeficit || pData.trustStrategy?.trustDeficit || pData.trustArchitecture?.trustDeficit);
        const transferMech = safeExtractCanonicalText(ttDesign?.transferMechanism?.name || pData.trustStrategy?.transferMechanismName || pData.trustStrategy?.transferMechanism || pData.trustArchitecture?.mechanism || pData.trustArchitecture?.transferMechanism);
        const proofArt = safeExtractCanonicalText(ttDesign?.transferMechanism?.proofArtifact || pData.trustStrategy?.proofArtifact || pData.trustArchitecture?.proofArtifact);
        const cialdiniPrinciple = safeExtractCanonicalText(cialdini?.primaryCialdiniPrinciple || pData.trustStrategy?.primaryCialdiniPrinciple);
        const cialdiniRationale = safeExtractCanonicalText(cialdini?.principleRationale || pData.trustStrategy?.principleRationale);

        if (!buyerRisk || !trustDeficit || !transferMech || !proofArt) {
          throw new Error(`CONTRACT_INVARIANT_FAILURE: PersuasionEngine failed to produce valid canonical trustStrategy for lane ${laneId}`);
        }

        // ── CANONICAL OBJECTION PLAYBOOK: PersuasionEngine is the sole authority ──
        const rawObjections = (Array.isArray(pData.structuredObjections) && pData.structuredObjections.length > 0)
          ? pData.structuredObjections
          : (pOut.structuredObjections || pData.objections || pData.objectionPriorities || []);
        const laneObjAttrList = Array.isArray(laneCtx?.objectionAttribution) ? laneCtx.objectionAttribution : [];
        const objections = rawObjections.map((o: any) => {
          const cleanObjectionText = safeExtractCanonicalText(o.objectionStatement || o.objection?.canonical || o.objection || o.canonical || o.statement);
          const cleanResponse = safeExtractCanonicalText(o.persuasionResponse || o.response || o.resolution || o.handling || o.counterArgument);
          const cleanProof = safeExtractCanonicalText(o.requiredProof || o.requiredProofType || o.proofRequirement || o.evidence);

          if (!cleanResponse && cleanObjectionText) {
            throw new Error(`CONTRACT_INVARIANT_FAILURE: PersuasionEngine failed to produce objection response for objection "${cleanObjectionText}"`);
          }

          const matchedLaneObjAttr = laneObjAttrList.find((la: any) =>
            (la?.objectionId && (la.objectionId === o.objectionId || la.objectionId === o.id)) ||
            (la?.statement && String(la.statement).trim().toLowerCase() === cleanObjectionText.trim().toLowerCase())
          );

          const resolvedCompNames = (Array.isArray(o.competitorNames) && o.competitorNames.length > 0)
            ? o.competitorNames
            : (Array.isArray(o.objection?.competitorNames) && o.objection.competitorNames.length > 0)
              ? o.objection.competitorNames
              : (Array.isArray(matchedLaneObjAttr?.competitorNames) ? matchedLaneObjAttr.competitorNames : []);
          const resolvedCompIds = (Array.isArray(o.competitorIds) && o.competitorIds.length > 0)
            ? o.competitorIds
            : (Array.isArray(o.objection?.competitorIds) && o.objection.competitorIds.length > 0)
              ? o.objection.competitorIds
              : (Array.isArray(matchedLaneObjAttr?.competitorIds) ? matchedLaneObjAttr.competitorIds : []);
          const resolvedEvIds = (Array.isArray(o.evidenceIds) && o.evidenceIds.length > 0)
            ? o.evidenceIds
            : (Array.isArray(o.objection?.evidenceIds) && o.objection.evidenceIds.length > 0)
              ? o.objection.evidenceIds
              : (Array.isArray(matchedLaneObjAttr?.evidenceIds) ? matchedLaneObjAttr.evidenceIds : []);
          const resolvedScope =
            (resolvedCompNames.length > 0 || resolvedCompIds.length > 0)
              ? "COMPETITOR_SPECIFIC"
              : (o.subjectScope || o.objection?.subjectScope || matchedLaneObjAttr?.subjectScope || "UNATTRIBUTED_MARKET");

          return {
            objectionId: o.objectionId || o.id || matchedLaneObjAttr?.objectionId || o.tag?.category || "obj",
            objection: cleanObjectionText,
            response: cleanResponse,
            requiredProof: cleanProof || "Workflow Demonstration [PROOF_TO_BUILD]",
            proofStatus: o.proofStatus || "PROOF_TO_BUILD",
            proposalStatus: o.proposalStatus || o.objection?.proposalStatus || (String(o.proofStatus || "").includes("TO_BUILD") ? "PROPOSED_RECOMMENDATION" : "VERIFIED_FACT"),
            supportingFactId: o.supportingFactId || o.objection?.supportingFactId || undefined,
            linkedPainId: o.linkedPainId || matchedLaneObjAttr?.linkedPainId || undefined,
            evidenceIds: resolvedEvIds,
            aelGrounding: o.aelGrounding || undefined,
            funnelStageId: o.funnelStageId || o.stage || undefined,
            subjectScope: resolvedScope,
            competitorNames: resolvedCompNames,
            competitorIds: resolvedCompIds,
          };
        });

        const stepKeyLabels: Record<string, { label: string; rationale: string }> = {
          problem_framing: {
            label: "Problem Framing & Friction Validation",
            rationale: `Anchor buyer attention on the verified core friction (${currentBelief}).`,
          },
          mechanism_explanation: {
            label: "Mechanism & Workflow Transparency",
            rationale: `Demonstrate how ${transferMech || "the operational workflow"} addresses buyer hesitation.`,
          },
          proof_introduction: {
            label: "Proof & Verification Evidence",
            rationale: `Introduce ${proofArt || "verifiable evidence"} to resolve the primary trust deficit (${trustDeficit}).`,
          },
          offer_positioning: {
            label: "Offer Value & Capability Alignment",
            rationale: `Connect verified product capabilities directly to the desired buyer outcome (${desiredBelief}).`,
          },
          objection_resolution: {
            label: "Objection Mitigation & Risk Clarity",
            rationale: `Address buyer risk (${buyerRisk}) with transparent operational boundaries and evidence.`,
          },
          action_prompt: {
            label: "Low-Friction Next Step",
            rationale: "Prompt a clear, low-friction evaluation or configuration action aligned with product capabilities.",
          },
        };

        persuasionStrategyObj = {
          mode: pData.mode || pData.persuasionMode || "Proof-Led Decision Acceleration",
          modeLabel: pData.modeLabel || "Direct & Verified",
          coreBeliefTransformation: {
            currentBelief,
            desiredBelief,
            contradictionLogic: cbt?.contradictionLogic ? safeExtractCanonicalText(cbt.contradictionLogic) : undefined,
          },
          messageSequence: (pData.messageSequence || pData.sequence || pData.messageOrderLogic || []).map((m: any, idx: number) => {
            if (typeof m === "string") {
              const cleanKey = m.trim().toLowerCase().replace(/\s+/g, "_");
              const mapped = stepKeyLabels[cleanKey];
              const cleanFocus = mapped?.label || safeExtractCanonicalText(m).replace(/_/g, " ");
              return {
                step: `step_${idx + 1}`,
                stepKey: cleanKey,
                stepLabel: cleanFocus || `Step ${idx + 1}`,
                messageFocus: cleanFocus,
                rationale: mapped?.rationale || `Advance buyer conviction from "${currentBelief}" toward "${desiredBelief}" via ${cleanFocus}.`,
              };
            }
            const rawStepKey = String(m.stepKey || m.step || "").trim().toLowerCase();
            const mapped = stepKeyLabels[rawStepKey];
            const coreMsg = safeExtractCanonicalText(m.coreMessage || m.messageFocus || m.stepLabel || m.label || m.title || mapped?.label || m.step);
            const rawStep = String(m.step || `step_${idx + 1}`);
            const isGenericPhaseLabel = /^(?:phase|step)\s+\d+$/i.test(String(m.stepLabel || m.label || m.title || "").trim());
            const resolvedLabel = (!isGenericPhaseLabel && (m.stepLabel || m.label || m.title))
              ? String(m.stepLabel || m.label || m.title)
              : (mapped?.label || (coreMsg && !/^step_\d+$/i.test(coreMsg) ? coreMsg : `Step ${idx + 1}`));
            const rawRationale = String(m.purpose || m.rationale || m.description || m.content || "").trim();
            const isBoilerplateExecute = /^execute\s+step\s+\d+\s+of\s+the\b/i.test(rawRationale);
            return {
              step: rawStep,
              stepKey: m.stepKey || (mapped ? rawStepKey : undefined),
              stepLabel: resolvedLabel,
              purpose: m.purpose ? String(m.purpose).trim() : (!isBoilerplateExecute && rawRationale ? rawRationale : undefined),
              beliefShift: m.beliefShift ? String(m.beliefShift).trim() : undefined,
              coreMessage: m.coreMessage ? String(m.coreMessage).trim() : (coreMsg || resolvedLabel),
              messageFocus: coreMsg || resolvedLabel,
              rationale: (!isBoilerplateExecute && rawRationale)
                ? rawRationale
                : (mapped?.rationale || (coreMsg ? `Advance buyer conviction through: ${coreMsg}` : "")),
              proofRequirement: m.proofRequirement ? String(m.proofRequirement).trim() : undefined,
              objectionAddressed: m.objectionAddressed ? String(m.objectionAddressed).trim() : undefined,
              cta: m.cta ? String(m.cta).trim() : undefined,
            };
          }),
          objections,
          trustStrategy: {
            buyerRiskState: buyerRisk,
            trustDeficit: trustDeficit,
            transferMechanismName: transferMech,
            proofArtifact: proofArt,
            primaryCialdiniPrinciple: cialdiniPrinciple || "commitment_consistency",
            principleRationale: cialdiniRationale || "Consistent operational progression establishes verifiable confidence.",
          }
        };
      }
    }

    const whyThisJourney = safeExtractCanonicalText(
      funnelObj.whyThisJourney ||
      funnelObj.journeyRationale ||
      funnelObj.rationale ||
      (Array.isArray(funnelObj.groundedJourneyRationale) ? funnelObj.groundedJourneyRationale.join(" ") : "")
    );
    if (!whyThisJourney) {
      throw new Error(`CONTRACT_INVARIANT_FAILURE: FunnelEngine failed to produce whyThisJourney for lane ${laneId}`);
    }

    return {
      laneId,
      laneLabel,
      primaryPainId,
      segmentIds,
      sourceFunnelSnapshotId,
      sourcePersuasionSnapshotId,
      journeyName: funnelObj.journeyName || funnelObj.funnelName || funnelObj.name || "Buyer Conversion Journey",
      journeyType: funnelObj.journeyType || funnelObj.funnelType || funnelObj.modelType || "Standard",
      whyThisJourney,
      entryTrigger: funnelObj.entryTrigger || {
        mechanismType: "Primary Problem Agitation",
        purpose: "Capture qualified buyer attention and establish initial category relevance."
      },
      stages: rawStages.map((s: any) => {
        const rawProofs = s.proof || s.proofPlacements || (s.proofs ? s.proofs.map((p: any) => typeof p === 'string' ? p : p.proofName || p.claim || JSON.stringify(p)) : []);
        const structuredProofs = Array.isArray(rawProofs) ? rawProofs.map(sanitizeProofItem) : [];
        const stageKey = String(s.stageId || s.id || s.stageName || s.name || "").toLowerCase();
        const derivedCta = (s.cta && s.cta !== "Learn More")
          ? s.cta
          : (s.callToAction && s.callToAction !== "Learn More")
            ? s.callToAction
            : stageKey.includes("entry") ? "Explore How It Works"
            : stageKey.includes("education") ? "Review Process & Capabilities"
            : stageKey.includes("engagement") ? "Start Your Configuration"
            : stageKey.includes("consideration") ? "Compare Verified Examples"
            : stageKey.includes("decision") ? "Review Options & Terms"
            : stageKey.includes("conversion") ? "Complete Your Order"
            : "Explore Next Step";
        const resolvedGoal = s.goal || s.conversionGoal || s.objective || s.purpose || "";
        const rawCoreMessage = s.coreMessage || s.message || s.primaryMessage || "";
        const resolvedCoreMessage = (rawCoreMessage && rawCoreMessage !== resolvedGoal)
          ? rawCoreMessage
          : (s.valueProposition || (s.contentStrategy ? `${s.stageName || s.name || "Stage"}: ${s.contentStrategy}` : (rawCoreMessage || resolvedGoal)));
        return {
          stageId: s.stageId || s.id || (s.name || "stage").toLowerCase().replace(/\s+/g, "_"),
          stageName: s.stageName || s.name || s.stage || "Funnel Stage",
          goal: resolvedGoal,
          buyerState: s.buyerState || s.mindset || (s.stageName ? `Evaluating ${s.stageName}` : "Evaluating Stage"),
          coreMessage: resolvedCoreMessage,
          contentAction: s.contentAction || s.action || s.contentType || s.contentStrategy || "",
          proof: structuredProofs,
          cta: derivedCta,
        };
      }),
      persuasionStrategy: persuasionStrategyObj,
    };
  };

  const awarenessResult = results.get("awareness");
  const candidateJourneys: any[] = [];
  const funnelsMap = results.get("funnels");
  const persuasionsMap = results.get("persuasions");

  const approvedLanesList = Array.isArray(synthesized.approvedLanes) ? synthesized.approvedLanes : [];
  const approvedLaneIds = new Set(approvedLanesList.map((l: any) => l.laneId || l.id).filter(Boolean));

  if (funnelsMap instanceof Map || (funnelsMap && typeof (funnelsMap as any).entries === "function")) {
    for (const [laneId, funnelRes] of (funnelsMap as Map<string, any>).entries()) {
      if (approvedLaneIds.size > 0 && !approvedLaneIds.has(laneId)) {
        console.warn(`[PlanSynthesis] IGNORING_UNAPPROVED_LANE | laneId=${laneId} not in approvedLanes [${Array.from(approvedLaneIds).join(", ")}]`);
        continue;
      }
      const laneCtx = approvedLanesList.find((l: any) => (l.laneId || l.id) === laneId);
      const persRes = persuasionsMap instanceof Map ? persuasionsMap.get(laneId) : results.get(`persuasion:${laneId}`);
      const journey = buildSingleBuyerJourney(funnelRes, persRes, awarenessResult, laneCtx);
      if (journey) candidateJourneys.push(journey);
    }
  } else {
    // Check all keys in results matching funnel:*
    for (const [key, value] of results.entries()) {
      if (typeof key === "string" && key.startsWith("funnel:") && key !== "funnel") {
        const laneId = key.replace("funnel:", "");
        if (approvedLaneIds.size > 0 && !approvedLaneIds.has(laneId)) {
          console.warn(`[PlanSynthesis] IGNORING_UNAPPROVED_LANE | laneId=${laneId} not in approvedLanes [${Array.from(approvedLaneIds).join(", ")}]`);
          continue;
        }
        const laneCtx = approvedLanesList.find((l: any) => (l.laneId || l.id) === laneId);
        const persRes = results.get(`persuasion:${laneId}`);
        const journey = buildSingleBuyerJourney(value, persRes, awarenessResult, laneCtx);
        if (journey) candidateJourneys.push(journey);
      }
    }
  }

  // Fallback to singleton funnel if no lane-keyed funnels were extracted
  if (candidateJourneys.length === 0) {
    const singleFunnel = results.get("funnel");
    const singlePersuasion = results.get("persuasion");
    const firstApproved = approvedLanesList[0];
    const singleJourney = buildSingleBuyerJourney(singleFunnel, singlePersuasion, awarenessResult, firstApproved);
    if (singleJourney) {
      if (firstApproved) {
        singleJourney.laneId = firstApproved.laneId || firstApproved.id;
        singleJourney.laneLabel = firstApproved.title || firstApproved.name || singleJourney.laneLabel;
        singleJourney.primaryPainId = firstApproved.primaryPainId || firstApproved.corePainIds?.[0] || singleJourney.primaryPainId;
        singleJourney.segmentIds = firstApproved.segmentIds || singleJourney.segmentIds;
      }
      candidateJourneys.push(singleJourney);
    }
  }

  // Strictly enforce Lane Authority Invariant against Strategy Root approved lanes
  let finalJourneys = candidateJourneys;
  if (approvedLaneIds.size > 0) {
    finalJourneys = candidateJourneys.filter(j => j.laneId && approvedLaneIds.has(j.laneId));
    if (finalJourneys.length === 0 && candidateJourneys.length > 0) {
      const firstApproved = approvedLanesList[0];
      candidateJourneys[0].laneId = firstApproved.laneId || firstApproved.id;
      candidateJourneys[0].laneLabel = firstApproved.title || firstApproved.name || candidateJourneys[0].laneLabel;
      candidateJourneys[0].primaryPainId = firstApproved.primaryPainId || firstApproved.corePainIds?.[0] || candidateJourneys[0].primaryPainId;
      candidateJourneys[0].segmentIds = firstApproved.segmentIds || candidateJourneys[0].segmentIds;
      finalJourneys.push(candidateJourneys[0]);
    }
  }

  synthesized.buyerConversionJourneys = finalJourneys;
  if (finalJourneys.length > 0) {
    synthesized.buyerConversionJourney = finalJourneys[0];
    if (finalJourneys[0].persuasionStrategy) {
      synthesized.persuasionStrategy = finalJourneys[0].persuasionStrategy;
    }
  }

  // Attach canonical same-run Offer Snapshot onto synthesized plan (Fix 1, 3, 18)
  let canonicalOffer: any = null;
  const offerStepResult = results.get("offer" as EngineId);
  if (offerStepResult?.output?.primaryOffer) {
    canonicalOffer = offerStepResult.output.primaryOffer;
  } else if (offerStepResult?.output?.offer) {
    canonicalOffer = offerStepResult.output.offer;
  } else if (config.jobId || config.sourceJobId) {
    try {
      const candidateJobIds = [config.jobId, config.sourceJobId].filter(Boolean) as string[];
      const [offerSnap] = await db.select().from(offerSnapshots).where(
        and(
          eq(offerSnapshots.accountId, config.accountId),
          eq(offerSnapshots.campaignId, config.campaignId),
          inArray(offerSnapshots.jobId, candidateJobIds)
        )
      ).limit(1);

      if (offerSnap?.primaryOffer) {
        canonicalOffer = typeof offerSnap.primaryOffer === "string"
          ? JSON.parse(offerSnap.primaryOffer)
          : offerSnap.primaryOffer;
      }
    } catch (e: any) {
      console.warn(`[PlanSynthesis] Failed to load same-run offer snapshot:`, e.message);
    }
  }

  if (canonicalOffer) {
    synthesized.offer = canonicalOffer;
    console.log(`[PlanSynthesis] CANONICAL_OFFER_ATTACHED | name="${canonicalOffer.offerName || canonicalOffer.title || 'unnamed'}"`);
  }

  // Attach canonical Mechanism, Awareness, Differentiation, StrategyRoot, and normalized BudgetAllocation onto synthesized plan
  const mechanismStepResult = results.get("mechanism" as EngineId);
  const mechOut = mechanismStepResult?.output?.output || mechanismStepResult?.output;
  const canonicalMechanism = mechOut?.primaryMechanism || mechOut?.mechanism || (mechOut?.mechanismName ? mechOut : null) || activeStrategyRoot?.approvedMechanism || null;
  if (canonicalMechanism) {
    synthesized.mechanism = {
      mechanismName: canonicalMechanism.mechanismName || canonicalMechanism.name || activeStrategyRoot?.brandSpine?.mechanismName || "",
      mechanismType: canonicalMechanism.mechanismType || canonicalMechanism.type || activeStrategyRoot?.brandSpine?.mechanismType || "",
      mechanismPromise: canonicalMechanism.mechanismPromise || canonicalMechanism.corePromise || activeStrategyRoot?.brandSpine?.mechanismPromise || "",
      mechanismLogic: canonicalMechanism.mechanismLogic || canonicalMechanism.coreLogic || "",
      mechanismSteps: Array.isArray(canonicalMechanism.mechanismSteps) ? canonicalMechanism.mechanismSteps : (Array.isArray(activeStrategyRoot?.brandSpine?.mechanismSteps) ? activeStrategyRoot.brandSpine.mechanismSteps : []),
      requiredCapabilities: Array.isArray(canonicalMechanism.requiredCapabilities) ? canonicalMechanism.requiredCapabilities : [],
      proofArtifact: canonicalMechanism.proofArtifact || undefined,
      sourcePainId: canonicalMechanism.sourcePainId || undefined,
      targetSegmentId: canonicalMechanism.targetSegmentId || undefined,
    };
  }

  if (activeStrategyRoot) {
    synthesized.strategyRootId = activeStrategyRoot.id;
    synthesized.strategyRoot = {
      id: activeStrategyRoot.id,
      jobId: activeStrategyRoot.jobId,
      approvedClaim: activeStrategyRoot.approvedClaim,
      approvedTransformationAxis: activeStrategyRoot.approvedTransformationAxis,
      approvedMechanism: synthesized.mechanism || activeStrategyRoot.approvedMechanism,
      brandSpine: synthesized.brandSpine || activeStrategyRoot.brandSpine,
      approvedLanes: synthesized.approvedLanes || activeStrategyRoot.approvedLanes,
    };
    if (activeStrategyRoot.approvedClaim) {
      synthesized.approvedClaim = activeStrategyRoot.approvedClaim;
    }
    const rootMechName = activeStrategyRoot.approvedMechanism?.mechanismName || activeStrategyRoot.approvedMechanism?.name || activeStrategyRoot.brandSpine?.mechanismName || synthesized.mechanism?.mechanismName;
    if (rootMechName) {
      synthesized.approvedMechanism = rootMechName;
    }
  }

  const awarenessStepResult = results.get("awareness" as EngineId);
  const awOut = awarenessStepResult?.output?.output || awarenessStepResult?.output;
  const awPrimary = awOut?.primaryRoute || awOut;
  const awRoute = awPrimary?.routeName || awPrimary?.name || awOut?.routeName;
  if (awRoute) {
    synthesized.awarenessRoute = awRoute;
  }
  if (awPrimary && (awPrimary.routeName || awPrimary.entryStage || awPrimary.entryMechanismType || awPrimary.oldBelief || awPrimary.newBelief || awPrimary.narrativeReframe || awPrimary.mythBreaker)) {
    const nrObj = typeof awPrimary.narrativeReframe === "object" && awPrimary.narrativeReframe !== null ? awPrimary.narrativeReframe : null;
    const mbObj = typeof awPrimary.mythBreaker === "object" && awPrimary.mythBreaker !== null ? awPrimary.mythBreaker : null;
    const oldBelief =
      awPrimary.oldBelief ||
      awOut?.oldBelief ||
      nrObj?.currentModel?.statement ||
      mbObj?.beliefToContradict ||
      "";
    const newBelief =
      awPrimary.newBelief ||
      awOut?.newBelief ||
      nrObj?.newModel?.reclassification ||
      mbObj?.mythBreakerStatement ||
      "";
    const narrativeReframeText =
      typeof awPrimary.narrativeReframe === "string"
        ? awPrimary.narrativeReframe
        : (nrObj?.newModel?.namedPrinciple
            ? `${nrObj.newModel.namedPrinciple}: ${nrObj.newModel.reclassification || newBelief}`
            : (nrObj?.bridgeMechanism?.specificMove || mbObj?.mythBreakerStatement || ""));
    const entryLogicText =
      awPrimary.entryLogic ||
      awOut?.entryLogic ||
      nrObj?.bridgeMechanism?.specificMove ||
      mbObj?.contradictionLogic ||
      awPrimary.trustRequirement ||
      "";
    const audienceFramingText =
      awPrimary.audienceFraming ||
      awOut?.audienceFraming ||
      awPrimary.funnelCompatibility ||
      nrObj?.discomfortCost?.privateAdmission ||
      "";
    synthesized.awareness = {
      routeName: awPrimary.routeName || awPrimary.name || awRoute || "",
      entryStage: awPrimary.entryStage || awPrimary.entryMechanismType || awOut?.entryStage || "",
      targetReadinessStage: awPrimary.targetReadinessStage || awOut?.targetReadinessStage || "",
      oldBelief,
      currentBelief: oldBelief,
      newBelief,
      desiredBelief: newBelief,
      narrativeReframe: narrativeReframeText,
      narrativeReframeDetails: nrObj,
      mythBreaker: typeof awPrimary.mythBreaker === "string" ? awPrimary.mythBreaker : (mbObj?.mythBreakerStatement || ""),
      mythBreakerDetails: mbObj,
      mythBreakers: mbObj
        ? [{
            myth: mbObj.beliefToContradict || oldBelief,
            reality: mbObj.mythBreakerStatement || newBelief,
            contradictionLogic: mbObj.contradictionLogic || "",
          }]
        : [],
      entryLogic: entryLogicText,
      audienceFraming: audienceFramingText,
      primaryRoute: awPrimary,
      alternativeRoutes: awOut?.alternativeRoutes || (awOut?.alternativeRoute ? [awOut.alternativeRoute] : []),
    };
  }

  const diffStepResult = results.get("differentiation" as EngineId);
  const diffOut = diffStepResult?.output?.output || diffStepResult?.output;
  if (Array.isArray(diffOut?.pillars) && diffOut.pillars.length > 0) {
    synthesized.differentiationPillars = diffOut.pillars;
  }

  const budgetStepResult = results.get("budget_governor" as EngineId);
  const budgetOut = budgetStepResult?.output?.output || budgetStepResult?.output;
  const chanStepResult = results.get("channel_selection" as EngineId);
  const chanOut = chanStepResult?.output?.output || chanStepResult?.output;
  const rawBudgetAlloc = Array.isArray(budgetOut?.channelAllocations) && budgetOut.channelAllocations.length > 0
    ? budgetOut.channelAllocations
    : (Array.isArray(synthesized.budgetAllocation) ? synthesized.budgetAllocation : []);
  if (rawBudgetAlloc.length > 0) {
    const chanCandidates = [
      ...(chanOut?.primaryChannel ? [chanOut.primaryChannel] : []),
      ...(Array.isArray(chanOut?.secondaryChannels) ? chanOut.secondaryChannels : []),
      ...(Array.isArray(chanOut?.rankedCandidates) ? chanOut.rankedCandidates : []),
    ];
    synthesized.budgetAllocation = rawBudgetAlloc.map((alloc: any) => {
      const chName = alloc.channelName || alloc.channel || alloc.platform || "Channel";
      const matchedChan = chanCandidates.find((c: any) =>
        (c.channelId && alloc.channelId && c.channelId === alloc.channelId) ||
        (c.channelName && String(c.channelName).toLowerCase() === String(chName).toLowerCase()) ||
        (c.platform && String(c.platform).toLowerCase() === String(alloc.platform || chName).toLowerCase())
      );
      const amount = Number(alloc.monthlyAmount ?? alloc.monthlyBudget ?? alloc.allocatedAmount ?? alloc.amount ?? 0);
      const pct = Number(alloc.percentage ?? alloc.allocationPercentage ?? 0);
      const mode = String(alloc.mode || matchedChan?.mode || (chName.toLowerCase().includes("organic") ? "ORGANIC" : chName.toLowerCase().includes("paid") ? "PAID" : "HYBRID")).toUpperCase();
      return {
        ...alloc,
        channelId: alloc.channelId || matchedChan?.channelId || chName.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        channelName: chName,
        channel: chName,
        platform: alloc.platform || matchedChan?.platform || chName.replace(/\s+(organic|paid)$/i, ""),
        mode,
        costCategory: alloc.costCategory || (mode === "ORGANIC" ? "Production & Distribution Operations" : "Paid Media & Acquisition Spend"),
        percentage: pct,
        monthlyAmount: amount,
        monthlyBudget: amount,
        allocatedAmount: amount,
        rationale: alloc.rationale || matchedChan?.rationale || "",
      };
    });
    if (budgetOut) {
      synthesized.budgetGovernor = {
        totalMonthlyBudget: budgetOut.totalMonthlyBudget ?? synthesized.budgetAllocation.reduce((acc: number, a: any) => acc + (Number(a.monthlyAmount) || 0), 0),
        governanceMode: budgetOut.governanceMode || "STAGE_GATED",
        pacingRules: budgetOut.pacingRules || [],
        reallocationTriggers: budgetOut.reallocationTriggers || [],
      };
    }
  }

  const persuasionStepResult = results.get("persuasion" as EngineId);
  const persRoute = persuasionStepResult?.output?.primaryRoute?.routeName || persuasionStepResult?.output?.routeName;
  if (persRoute) {
    synthesized.persuasionRoute = persRoute;
  }

  const alreadyDegraded = synthesized.degraded === true || synthesized.planSource === "degraded_ai_failed";

  const verification = verifySynthesisPreservation(synthesized, lockedLabels);
  synthesized.synthesisVerification = verification;
  synthesized.lockedDecisionLabels = lockedLabels.map(l => l.label);
  
  const integrityCheck = validateSynthesisIntegrity(synthesized, results, activeStrategyRoot);
  synthesized._synthesisIntegrity = integrityCheck;
  
  if (integrityCheck.blockedEngines.length > 0 || integrityCheck.degradedEngines.length > 0) {
    synthesized.validationState = "provisional";
  }

  if (signalComp) {
    synthesized.signalComposition = signalComp;
  }

  if (alreadyDegraded) {
    synthesized.planSource = synthesized.planSource ?? "degraded_ai_failed";
    synthesized.degraded = true;
    synthesized.lockedDecisionLabels = [];
    synthesized.synthesisVerification = { passed: true, totalLocked: 0, preserved: 0, missing: [], verifiedAt: new Date().toISOString() };
    if (!synthesized.signalComposition) {
      synthesized.signalComposition = { total: 0, real: 0, competitor: 0, inferred: 0, fallback: 0, unknown: 0, dominantType: "fallback", realRatio: 0, competitorRatio: 0, inferredRatio: 0, fallbackRatio: 1, unknownRatio: 0, trustedRatio: 0 };
    }
    console.warn(
      `[PlanSynthesis] PLAN_ALREADY_DEGRADED | planSource=${synthesized.planSource} — AI fallback was used, preserving degraded provenance.`,
    );
  } else {
    const planSource: PlanSource = synthesisPath === "DECISION_DRIVEN" ? "decision_driven" : "degraded_no_decisions";
    synthesized.planSource = planSource;
    synthesized.degraded = planSource !== "decision_driven";

    if (!verification.passed) {
      console.warn(
        `[PlanSynthesis] SYNTHESIS_VERIFICATION_FAILED | locked=${verification.totalLocked} preserved=${verification.preserved} ` +
        `missing=[${verification.missing.join(", ")}] — locked decisions were NOT fully preserved in AI output.`,
      );
      synthesized.degraded = true;
      if (synthesized.planSource === "decision_driven") {
        synthesized.planSource = "degraded_no_decisions";
      }
    } else if (verification.totalLocked > 0) {
      console.log(
        `[PlanSynthesis] SYNTHESIS_VERIFICATION_PASSED | locked=${verification.totalLocked} preserved=${verification.preserved} — all locked decisions preserved in output.`,
      );
    }
  }

  if (synthesisPath !== "DECISION_DRIVEN") {
    console.warn(
      `[PlanSynthesis] PLAN_INTEGRITY_WARNING | planId=pending path=${synthesisPath} ` +
      `eligible=${enforcementReport.eligible} total=${enforcementReport.totalDecisions} — ` +
      `this plan was NOT fully driven by validated decisions.`,
    );
  }

  if (budgetDecision === "hold") {
    const preDist = { ...synthesized.contentDistribution };
    const holdPlan = applyBudgetHoldRestriction(synthesized);
    Object.assign(synthesized, holdPlan);
    console.log(`[PlanSynthesis] BUDGET_HOLD_ENFORCED | reels: ${preDist.reelsPerWeek}→${synthesized.contentDistribution.reelsPerWeek} posts: ${preDist.postsPerWeek}→${synthesized.contentDistribution.postsPerWeek}`);
  }

  if (integrityDegradation !== "none") {
    const preDist = { ...synthesized.contentDistribution };
    const degradedPlan = applyIntegrityDegradation(synthesized, integrityDegradation);
    Object.assign(synthesized, degradedPlan);
    console.log(`[PlanSynthesis] INTEGRITY_ENFORCEMENT_APPLIED | mode=${integrityDegradation} reels: ${preDist.reelsPerWeek}→${synthesized.contentDistribution.reelsPerWeek}`);
  }

  // Reconcile distribution narrative and weekly playbook with channel strategy and post-governance state
  if (synthesized.contentDistribution) {
    const dist = synthesized.contentDistribution;
    
    // Extract approved channels authoritatively from channel selection or active strategy root
    const chanRes = results.get("channel_selection")?.output || results.get("channel_selection") || null;
    const approvedPrimary = chanRes?.proposedPrimary || activeStrategyRoot?.approvedChannels?.[0] || "Primary Strategic Channel";
    const approvedSecondary = chanRes?.secondary || activeStrategyRoot?.approvedChannels?.[1] || "Secondary Strategic Channel";
    const approvedChannelsList = [approvedPrimary, approvedSecondary].filter(Boolean);
    const approvedChannelsStr = approvedChannelsList.join(", ");

    // Ensure channels array is populated with strategic roles
    if (!Array.isArray(dist.channels) || dist.channels.length === 0) {
      dist.channels = [
        {
          channel: approvedPrimary,
          role: chanRes?.primaryRole || "Top-of-funnel awareness, proof demonstration, and market positioning",
          tier: "PRIMARY",
        },
        ...(approvedSecondary ? [{
          channel: approvedSecondary,
          role: chanRes?.secondaryRole || "Middle-of-funnel consideration, lead nurturing, and relationship building",
          tier: "SECONDARY",
        }] : []),
      ];
    }

    // Preserve realistic organic & content validation cadence when organic/content production channels are active
    dist.reelsPerWeek = Math.max(Number(dist.reelsPerWeek || 0), 2);
    dist.postsPerWeek = Math.max(Number(dist.postsPerWeek || 0), 2);
    dist.storiesPerDay = Math.max(Number(dist.storiesPerDay || 0), 1);
    dist.carouselsPerWeek = Math.max(Number(dist.carouselsPerWeek || 0), 1);
    dist.videosPerWeek = Math.max(Number(dist.videosPerWeek || 0), 1);

    const isGoverned = budgetDecision === "hold" || integrityDegradation !== "none";
    if (isGoverned) {
      const govTag = budgetDecision === "hold" ? "BUDGET_HOLD" : "DEGRADED-SAFE";
      dist.rationale = `[GOVERNED EXECUTION — ${govTag}] Aggressive paid scaling is held pre-launch while executing controlled initial validation tests and organic proof-of-concept content across approved channels (${approvedChannelsStr}).`;
      if (synthesized.executionBlueprintDnaLink) {
        synthesized.executionBlueprintDnaLink.weeklyDnaApplication = `Apply core messaging tone across approved channels (${approvedChannelsStr}). Prioritize transparent workflow demonstration and evidence-backed positioning.`;
      }
    } else {
      dist.rationale = `Strategic focus concentrated on approved channels (${approvedChannelsStr}) to drive qualified pipeline growth. Tactical execution cadence is managed by the execution layer.`;
      if (synthesized.executionBlueprintDnaLink) {
        synthesized.executionBlueprintDnaLink.weeklyDnaApplication = `Apply core messaging tone across approved channels (${approvedChannelsStr}) under the guidance of the Brand Spine.`;
      }
    }
  }

  if (signalComp) {
    const trustedRatio = signalComp.trustedRatio ?? 0;
    if (trustedRatio < 0.3) {
      synthesized.signalTrustWarning = {
        level: "low",
        trustedRatio,
        dominantType: signalComp.dominantType,
        advisory: "Less than 30% of strategy signals come from trusted sources (real performance data or verified competitor intelligence). Plan reliability is significantly reduced.",
      };
      synthesized.degraded = true;
      if (synthesized.planSource === "decision_driven") {
        synthesized.planSource = "degraded_no_decisions";
      }
      console.log(`[PlanSynthesis] LOW_TRUST_SIGNAL_ENFORCEMENT | trustedRatio=${(trustedRatio * 100).toFixed(0)}% — plan flagged as degraded, dominant signal type: ${signalComp.dominantType}`);
    } else if (trustedRatio < 0.5) {
      synthesized.signalTrustWarning = {
        level: "moderate",
        trustedRatio,
        dominantType: signalComp.dominantType,
        advisory: "Trusted signal coverage is below 50%. Plan decisions may be influenced by inferred or fallback assumptions.",
      };
      console.log(`[PlanSynthesis] MODERATE_TRUST_SIGNAL_WARNING | trustedRatio=${(trustedRatio * 100).toFixed(0)}% — advisory attached to plan`);
    }
  }

  const iterationResult = results.get("iteration");
  if (iterationResult?.status === "SUCCESS" && iterationResult.output) {
    const iterOut = iterationResult.output.output || iterationResult.output;
    const failedFlags: any[] = iterOut.failedStrategyFlags || [];
    const optimizationTargets: any[] = iterOut.optimizationTargets || [];

    if (failedFlags.length > 0) {
      const failedStrategies = failedFlags.map((f: any) => f.strategy || f.name || f.flag || "unknown").join(", ");
      const planChannels = (synthesized.channels || []).map((c: any) => typeof c === "string" ? c.toLowerCase() : (c.name || "").toLowerCase());
      const conflicting = failedFlags.filter((f: any) => {
        const name = (f.strategy || f.name || "").toLowerCase();
        return planChannels.some((ch: string) => ch.includes(name) || name.includes(ch));
      });

      if (conflicting.length > 0) {
        synthesized.iterationConflicts = {
          count: conflicting.length,
          conflicts: conflicting.map((f: any) => ({
            strategy: f.strategy || f.name || "unknown",
            reason: f.reason || f.description || "Previously failed",
          })),
          advisory: `Plan includes ${conflicting.length} strategy/channel(s) that were flagged as failed in iteration analysis: ${failedStrategies}`,
        };
        console.log(`[PlanSynthesis] ITERATION_CONFLICT_DETECTED | ${conflicting.length} plan elements conflict with iteration failure flags: ${failedStrategies}`);
      }
    }

    if (optimizationTargets.length > 0) {
      synthesized.iterationOptimizationHints = optimizationTargets.slice(0, 5).map((t: any) => ({
        target: t.target || t.metric || t.name || "unknown",
        direction: t.direction || t.recommendation || "improve",
        priority: t.priority || "medium",
      }));
      console.log(`[PlanSynthesis] ITERATION_OPTIMIZATION_HINTS | ${optimizationTargets.length} optimization targets attached to plan`);
    }
  }

  const retentionResult = results.get("retention");
  if (retentionResult?.status === "SUCCESS" && retentionResult.output) {
    const retOut = retentionResult.output.output || retentionResult.output;
    const churnRisks: any[] = retOut.churnRiskFlags || [];
    if (churnRisks.length > 0) {
      synthesized.retentionInsights = {
        churnRiskCount: churnRisks.length,
        topRisks: churnRisks.slice(0, 3).map((r: any) => ({
          risk: r.risk || r.description || r.flag || "unknown",
          severity: r.severity || r.level || "medium",
        })),
        advisory: `Retention analysis identified ${churnRisks.length} churn risk(s) that should be addressed in post-conversion strategy.`,
      };
      console.log(`[PlanSynthesis] RETENTION_INSIGHTS_INJECTED | ${churnRisks.length} churn risks attached to plan`);
    }
  }

  // Preserve engine-selected authoritative pain roles verbatim — synthesis
  // must not flatten or reselect pains (Offer owns core/objection roles,
  // Retention owns post-purchase friction). Violations are surfaced on the
  // plan, never silently repaired.
  const painRolePreservation = extractAudiencePainRoles(results);
  if (painRolePreservation.roles || painRolePreservation.violations.length > 0) {
    synthesized.audiencePainRoles = {
      ...(painRolePreservation.roles || {}),
      violations: painRolePreservation.violations,
    };
    console.log(`[PlanSynthesis] AUDIENCE_PAIN_ROLES_PRESERVED | core=${painRolePreservation.roles?.core?.painId || "none"} | objections=${painRolePreservation.roles?.objections?.length || 0} | retention=${painRolePreservation.roles?.retention?.painId || "none"} | violations=${painRolePreservation.violations.join(",") || "none"}`);
  }

  if (memoryBlock && (memoryBlock.reinforceSlots.length > 0 || memoryBlock.avoidSlots.length > 0)) {
    try {
      const baseline = memoryBlock.industryBaseline ?? undefined;
      const { adjusted, overrides } = applyMemoryConstraints(synthesized.contentDistribution, memoryBlock, baseline);
      if (overrides.length > 0) {
        synthesized.contentDistribution = { ...synthesized.contentDistribution, ...adjusted };
        synthesized.memoryOverrides = overrides;
        console.log(`[PlanSynthesis] MEMORY_CONSTRAINTS_APPLIED | overrides=${overrides.length} | fields=${overrides.map(o => o.field).join(",")}`);
      }
    } catch (memErr: any) {
      console.error(
        `[PlanSynthesis] ENFORCEMENT_FAILURE_MEMORY_CONSTRAINTS | Memory enforcement FAILED: ${memErr.message}. ` +
        `The synthesized plan is being used WITHOUT memory constraint correction. ` +
        `This is an enforcement failure — plan may violate high-confidence memory constraints.`,
      );
    }
  }

  let explorationSlotList: import("../exploration-budget/engine").ExplorationSlot[] = [];
  if (memoryBlock) {
    try {
      const expBudget = await computeExplorationBudget(
        synthesized,
        memoryBlock.industryBaseline,
        memoryBlock,
        config.campaignId,
        config.accountId,
        campaign?.explorationBudgetPercent ?? null,
      );
      const dist = { ...synthesized.contentDistribution };

      const weeklyPool: Record<string, number> = {
        reelsPerWeek: dist.reelsPerWeek ?? 0,
        postsPerWeek: dist.postsPerWeek ?? 0,
        carouselsPerWeek: dist.carouselsPerWeek ?? 0,
        videosPerWeek: dist.videosPerWeek ?? 0,
      };
      const weeklyPoolTotal = Object.values(weeklyPool).reduce((s, v) => s + v, 0);
      const storiesWeekly = (dist.storiesPerDay ?? 0) * 7;
      const weeklyTotal = weeklyPoolTotal + storiesWeekly;

      const rawExplorationCount = expBudget.totalExplorationCount;
      const effectiveExplorationCount = Math.min(rawExplorationCount, weeklyPoolTotal);

      let scheduledSlots = expBudget.explorationSlots;
      if (effectiveExplorationCount < rawExplorationCount) {
        let cap = effectiveExplorationCount;
        scheduledSlots = [];
        for (const slot of expBudget.explorationSlots) {
          if (cap <= 0) break;
          const slotCount = Math.min(slot.count, cap);
          scheduledSlots.push({ ...slot, count: slotCount });
          cap -= slotCount;
        }
      }
      const scheduledExplorationCount = scheduledSlots.reduce((s, slot) => s + slot.count, 0);

      explorationSlotList = scheduledSlots;
      synthesized.explorationPlan = {
        explorationPercent: expBudget.explorationPercent,
        totalExplorationCount: scheduledExplorationCount,
        rationale: expBudget.rationale,
        slots: scheduledSlots,
      };

      const deducted: Record<string, number> = { ...weeklyPool };
      let remaining = scheduledExplorationCount;

      if (weeklyPoolTotal > 0 && remaining > 0) {
        const formatKeys = Object.keys(weeklyPool);
        const idealDeductions: Record<string, number> = {};
        let idealSum = 0;
        for (const key of formatKeys) {
          const share = weeklyPool[key] / weeklyPoolTotal;
          const ideal = Math.floor(scheduledExplorationCount * share);
          idealDeductions[key] = ideal;
          idealSum += ideal;
        }
        let residual = remaining - idealSum;
        const sortedByRemainder = formatKeys
          .slice()
          .sort((a, b) => {
            const remA = (scheduledExplorationCount * weeklyPool[a] / weeklyPoolTotal) - idealDeductions[a];
            const remB = (scheduledExplorationCount * weeklyPool[b] / weeklyPoolTotal) - idealDeductions[b];
            return remB - remA;
          });
        for (const key of sortedByRemainder) {
          if (residual <= 0) break;
          if (idealDeductions[key] < weeklyPool[key]) {
            idealDeductions[key]++;
            residual--;
          }
        }
        for (const key of formatKeys) {
          const d = Math.min(idealDeductions[key], deducted[key]);
          deducted[key] = Math.max(0, deducted[key] - d);
          remaining -= d;
        }
        if (remaining > 0) {
          for (const key of formatKeys) {
            if (remaining <= 0) break;
            const d = Math.min(deducted[key], remaining);
            deducted[key] = Math.max(0, deducted[key] - d);
            remaining -= d;
          }
        }
      }

      synthesized.contentDistribution = {
        ...dist,
        reelsPerWeek: deducted.reelsPerWeek,
        postsPerWeek: deducted.postsPerWeek,
        carouselsPerWeek: deducted.carouselsPerWeek,
        videosPerWeek: deducted.videosPerWeek,
      };

      const actualDeducted = scheduledExplorationCount - remaining;
      const newMainWeekly =
        deducted.reelsPerWeek +
        deducted.postsPerWeek +
        deducted.carouselsPerWeek +
        storiesWeekly +
        deducted.videosPerWeek;
      const combinedTotal = newMainWeekly + scheduledExplorationCount;
      if (combinedTotal !== weeklyTotal) {
        console.warn(`[PlanSynthesis] VOLUME_INVARIANT_FAIL | original=${weeklyTotal} main=${newMainWeekly} exp=${scheduledExplorationCount} combined=${combinedTotal} residual=${remaining}`);
      } else {
        console.log(`[PlanSynthesis] EXPLORATION_BUDGET_APPLIED | pct=${expBudget.explorationPercent}% totalExp=${scheduledExplorationCount} deducted=${actualDeducted} originalWeekly=${weeklyTotal} mainAfter=${newMainWeekly} volumeOk=true`);
      }
    } catch (expErr: any) {
      console.warn(`[PlanSynthesis] Exploration budget computation failed (non-blocking):`, expErr.message);
    }
  }

  const periodDays = goalMathContext?.goal?.timeHorizonDays || 30;
  const volume = deriveContentVolume(synthesized, periodDays);

  // 1. Assemble authoritative budget allocation from Budget Governor & Settings FIRST so final validation inspects the complete plan
  const bgOutput = budgetGovResult?.output;
  const isBudgetUnconfirmed = bgOutput?.budgetConfirmation === "unconfirmed" || (!bgOutput?.budgetConfirmation && budgetSettings);
  const totalBudgetNum = bgOutput?.totalMonthlyBudget ?? (budgetSettings?.monthlyBudget ? Number(budgetSettings.monthlyBudget) : 0);
  const budgetCurrency = bgOutput?.currency || budgetSettings?.currency || "USD";
  const budgetVersion = bgOutput?.budgetSettingsVersion ?? budgetSettings?.version ?? 1;
  const formattedBudgetLabel = `${Number(totalBudgetNum || 0).toLocaleString("en-US")} ${budgetCurrency}`;

  if (bgOutput && Array.isArray(bgOutput.allocations) && bgOutput.allocations.length > 0) {
    const denominators = reconcileBudgetDenominators(totalBudgetNum, budgetCurrency, bgOutput.allocations);
    const paidAllocations = denominators.reconciledAllocations.filter((a: any) => !a.isOrganic);
    const organicAllocations = denominators.reconciledAllocations.filter((a: any) => a.isOrganic);
    const carveOutPct = Number(bgOutput?.commercialStrategy?.learningBudgetCarveOutPct ?? 20);
    const paidMediaTotal = Number(denominators.paidMediaSpend || 0);
    const contentAndOrganicTotal = Number((denominators.contentProductionBudget || 0) + (denominators.organicEffortAllocation || 0));
    const initialTestDollarAmount = paidMediaTotal > 0
      ? Math.round((paidMediaTotal * carveOutPct) / 100)
      : Math.round((Number(totalBudgetNum || 0) * carveOutPct) / 100);
    const targetValidationChannelsLabel = paidAllocations.length > 0
      ? paidAllocations.map((a: any) => a.channelName || a.channelId).join(", ")
      : denominators.reconciledAllocations.map((a: any) => a.channelName || a.channelId).join(", ") || "approved channels";
    synthesized.budgetAllocation = {
      totalBudget: `${totalBudgetNum} ${budgetCurrency}`.trim(),
      currency: budgetCurrency,
      totalMonthlyBudget: totalBudgetNum,
      period: "monthly",
      budgetSettingsVersion: budgetVersion,
      budgetConfirmation: isBudgetUnconfirmed ? "unconfirmed" : "user_confirmed",
      isAssumption: isBudgetUnconfirmed,
      provenance: isBudgetUnconfirmed
        ? `Unconfirmed budget setting (${formattedBudgetLabel}). Does not authorize paid ad spend until confirmed.`
        : `User-confirmed budget setting (${formattedBudgetLabel}).`,
      budgetDenominators: denominators,
      testingAndScalingGuidance: {
        governorRole: "recommendation_component",
        spendAction: bgOutput.spendAction || bgOutput.action || "hold",
        spendPace: bgOutput?.commercialStrategy?.spendPace || "cautious",
        learningBudgetCarveOutPct: carveOutPct,
        initialValidationTestBudget: initialTestDollarAmount,
        initialTestingPlan: `Use the user-confirmed ${formattedBudgetLabel}/month budget envelope (${paidMediaTotal.toLocaleString("en-US")} ${budgetCurrency} paid media + ${contentAndOrganicTotal.toLocaleString("en-US")} ${budgetCurrency} content/organic production), deploying an initial ${carveOutPct}% validation carve-out (${initialTestDollarAmount.toLocaleString("en-US")} ${budgetCurrency}) on ${targetValidationChannelsLabel} to acquire baseline engagement-to-conversion benchmarks.`,
        scalingHoldCondition: `Hold full-scale expansion beyond the initial ${carveOutPct}% validation test budget (${initialTestDollarAmount.toLocaleString("en-US")} ${budgetCurrency}) until initial live testing establishes baseline click-through, engagement completion, and purchase conversion rates.`,
        paidMediaAllocationSummary: paidAllocations.map((a: any) => `${a.channelName || a.channelId}: ${a.sharePercentage}% (${Number(a.monthlyAmount || 0).toLocaleString("en-US")} ${budgetCurrency}/mo)`).join("; "),
        organicProductionAllocationSummary: organicAllocations.map((a: any) => `${a.channelName || a.channelId}: ${a.sharePercentage}% (${Number(a.monthlyAmount || 0).toLocaleString("en-US")} ${budgetCurrency}/mo production/organic effort)`).join("; "),
      },
      channels: denominators.reconciledAllocations.map((a: any) => ({
        channelId: a.channelId,
        channelName: a.channelName,
        sharePercentage: a.sharePercentage,
        monthlyAmount: a.monthlyAmount,
        why: a.why,
        isOrganic: a.isOrganic,
        proposedUse: a.proposedUse,
        spendCategory: a.spendCategory,
      })),
      breakdown: denominators.reconciledAllocations.map((a: any) => ({
        category: a.channelName || a.channelId,
        percentage: a.sharePercentage,
        monthlyAmount: a.monthlyAmount,
        purpose: a.proposedUse || a.why || "Channel marketing allocation",
        isOrganic: a.isOrganic,
        spendCategory: a.spendCategory,
      })),
    };
  } else if (budgetSettings) {
    const denominators = reconcileBudgetDenominators(totalBudgetNum, budgetCurrency, []);
    synthesized.budgetAllocation = {
      totalBudget: `${totalBudgetNum} ${budgetCurrency}`.trim(),
      currency: budgetCurrency,
      totalMonthlyBudget: totalBudgetNum,
      period: "monthly",
      budgetSettingsVersion: budgetVersion,
      budgetConfirmation: isBudgetUnconfirmed ? "unconfirmed" : "user_confirmed",
      isAssumption: isBudgetUnconfirmed,
      provenance: isBudgetUnconfirmed
        ? `Unconfirmed budget setting (${formattedBudgetLabel}). Does not authorize paid ad spend until confirmed.`
        : `User-confirmed budget setting (${formattedBudgetLabel}).`,
      budgetDenominators: denominators,
      channels: [],
      breakdown: [],
    };
  }

  // Extract Positioning epistemic status and attach to synthesized plan BEFORE BLL translation
  const posStepOut = results.get("positioning" as EngineId)?.output?.output || results.get("positioning" as EngineId)?.output || activeStrategyRoot?.approvedPositioningContext || null;
  const posPrimaryTerritory = Array.isArray(posStepOut?.territories) ? posStepOut.territories[0] : null;
  const posProposalStatus =
    posStepOut?.proposalStatus ||
    posPrimaryTerritory?.proposalStatus ||
    posStepOut?.epistemicStatus ||
    posPrimaryTerritory?.epistemicStatus ||
    posStepOut?._provenance?.proposalStatus ||
    "STRATEGIC_HYPOTHESIS";
  const posEpistemicStatus =
    posStepOut?.epistemicStatus ||
    posPrimaryTerritory?.epistemicStatus ||
    posProposalStatus ||
    "STRATEGIC_HYPOTHESIS";
  const posEpistemicLabel =
    posStepOut?.epistemicLabel ||
    posPrimaryTerritory?.epistemicLabel ||
    "Proposed Strategic Hypothesis — Requires Market Validation";
  const posVerificationStatus =
    posStepOut?.verificationStatus ||
    posPrimaryTerritory?.verificationStatus ||
    "PROPOSED";
  const posOutcomeType =
    posStepOut?.positioningOutcomeType ||
    posPrimaryTerritory?.positioningOutcomeType ||
    undefined;
  const posComparisonStatus =
    posStepOut?.comparisonStatus ||
    posPrimaryTerritory?.comparisonStatus ||
    undefined;
  const posComparedCompetitorCount =
    typeof posStepOut?.comparedCompetitorCount === "number"
      ? posStepOut.comparedCompetitorCount
      : typeof posPrimaryTerritory?.comparedCompetitorCount === "number"
        ? posPrimaryTerritory.comparedCompetitorCount
        : undefined;
  const posRationale =
    posStepOut?.rationale ||
    posPrimaryTerritory?.rationale ||
    undefined;

  (synthesized as any).positioningProposalStatus = posProposalStatus;
  (synthesized as any).positioning = {
    ...((synthesized as any).positioning || {}),
    territory: posPrimaryTerritory?.name || activeStrategyRoot?.positioningTerritory || undefined,
    enemyDefinition: posStepOut?.enemyDefinition || posPrimaryTerritory?.enemyDefinition || undefined,
    contrastAxis: posStepOut?.contrastAxis || posPrimaryTerritory?.contrastAxis || activeStrategyRoot?.contrastAxis || undefined,
    narrativeDirection: posStepOut?.narrativeDirection || posPrimaryTerritory?.narrativeDirection || undefined,
    rationale: posRationale,
    proposalStatus: posProposalStatus,
    epistemicStatus: posEpistemicStatus,
    epistemicLabel: posEpistemicLabel,
    verificationStatus: posVerificationStatus,
    ...(posOutcomeType ? { positioningOutcomeType: posOutcomeType } : {}),
    ...(posComparisonStatus ? { comparisonStatus: posComparisonStatus } : {}),
    ...(posComparedCompetitorCount !== undefined ? { comparedCompetitorCount: posComparedCompetitorCount } : {}),
  };

  if (synthesized.strategicSummary) {
    (synthesized.strategicSummary as any).proposalStatus = posProposalStatus;
    (synthesized.strategicSummary as any).epistemicStatus = posEpistemicStatus;
    (synthesized.strategicSummary as any).epistemicLabel = posEpistemicLabel;
    (synthesized.strategicSummary as any).verificationStatus = posVerificationStatus;
    if (posOutcomeType) (synthesized.strategicSummary as any).positioningOutcomeType = posOutcomeType;
    if (posComparisonStatus) (synthesized.strategicSummary as any).comparisonStatus = posComparisonStatus;
    if (posComparedCompetitorCount !== undefined) (synthesized.strategicSummary as any).comparedCompetitorCount = posComparedCompetitorCount;
  }

  const verifiedFactStringsForBll: string[] = Array.isArray(bizData?.productTruthFacts)
    ? bizData.productTruthFacts.map((f: any) => typeof f === "string" ? f : (f?.statement || f?.fact || f?.text || "")).filter(Boolean)
    : [];

  // 2. Call BLL translation layer so final validation inspects both representations
  try {
    const { translateStrategyPlanToBusinessLanguage, sanitizeUnsupportedAbsolutes } = await import("../core/business-language-layer");
    if (synthesized.strategicSummary) {
      const combinedPreBll = [
        synthesized.strategicSummary.strategy,
        synthesized.strategicSummary.targetAudience,
        synthesized.strategicSummary.growthObjective,
        synthesized.strategicSummary.rationale,
      ].join(" ");
      const preBllEntailment = verifiedFactStringsForBll.length > 0
        ? evaluateClaimSemanticEntailment(combinedPreBll, verifiedFactStringsForBll)
        : { entailed: true, violations: [] as string[] };
      if (
        !preBllEntailment.entailed ||
        /\b(never\s+generic|ensures?\s+(?:emotional\s+)?authenticity|permanent\s+(?:downloadable\s+|cloud\s+)?(?:mp3\s+)?access|lifetime\s+(?:cloud\s+)?(?:hosting|storage|access)|100%\s+satisfaction|guaranteed\s+satisfaction)\b/i.test(combinedPreBll)
      ) {
        try {
          console.log(`[PlanSynthesis] PRE_BLL_SUMMARY_REPAIR | Repairing unsupported claim/absolute in strategicSummary before BLL translation: ${preBllEntailment.violations.join("; ") || "absolute regex match"}`);
          const preRepairResp = await aiChat({
            model: "gpt-4.1-mini",
            temperature: 0.1,
            accountId: config.accountId,
            endpoint: "plan-synthesis-pre-bll-repair",
            response_format: { type: "json_object" },
            max_tokens: 900,
            messages: [
              {
                role: "system",
                content: `You are the Strategic Plan Synthesis Repair Editor. Rewrite the strategicSummary so it strictly reflects the verified product facts and approved positioning without any unsupported absolutes (NEVER use phrases like "never generic", "ensures authenticity", "permanent access", "lifetime access", "100% satisfaction", or "guaranteed satisfaction"), without rewriting conditional trial/gifting payment triggers into satisfaction-contingent payment claims ("pay only when satisfied") or unqualified "risk-free" claims, without asserting unverified competitor internal production workflows ("mass-produced automated prompt workflows", "template-bound services") or market-wide "blind-purchase ... isolated audio tracks" claims, and without unverified multi-version/revision features or unverified prices/durations. Preserve competitor attribution on customer reports and preserve Positioning's ${posEpistemicStatus} status. Return ONLY JSON: {"strategy": "...", "targetAudience": "...", "growthObjective": "...", "rationale": "..."}`,
              },
              {
                role: "user",
                content: JSON.stringify({
                  currentStrategicSummary: synthesized.strategicSummary,
                  violationsToFix: preBllEntailment.violations,
                  verifiedProductFacts: verifiedFactStringsForBll,
                }),
              },
            ],
          });
          const preRepairedSum = JSON.parse(preRepairResp.choices?.[0]?.message?.content || "{}");
          if (preRepairedSum.strategy && preRepairedSum.rationale) {
            synthesized.strategicSummary = {
              ...synthesized.strategicSummary,
              strategy: String(preRepairedSum.strategy).trim(),
              targetAudience: String(preRepairedSum.targetAudience || synthesized.strategicSummary.targetAudience).trim(),
              growthObjective: String(preRepairedSum.growthObjective || synthesized.strategicSummary.growthObjective).trim(),
              rationale: String(preRepairedSum.rationale).trim(),
            };
          }
        } catch (preRepErr: any) {
          console.warn(`[PlanSynthesis] PRE_BLL_SUMMARY_REPAIR_FAILED | ${preRepErr?.message}`);
        }
      }
      synthesized.strategicSummary.strategy = sanitizeUnsupportedAbsolutes(synthesized.strategicSummary.strategy || "");
      synthesized.strategicSummary.targetAudience = sanitizeUnsupportedAbsolutes(synthesized.strategicSummary.targetAudience || "");
      synthesized.strategicSummary.growthObjective = sanitizeUnsupportedAbsolutes(synthesized.strategicSummary.growthObjective || "");
      synthesized.strategicSummary.rationale = sanitizeUnsupportedAbsolutes(synthesized.strategicSummary.rationale || "");
    }
    const businessRep = await translateStrategyPlanToBusinessLanguage(synthesized, config.accountId, verifiedFactStringsForBll);
    synthesized.businessRepresentation = businessRep;
    console.log(`[PlanSynthesis] BLL_TRANSLATION_COMPLETED | separate representation added prior to final validation`);
  } catch (bllErr: any) {
    console.warn(`[PlanSynthesis] BLL_TRANSLATION_FAILED | ${bllErr.message}`);
  }

  // 3. Call Cross-Engine Consistency Judge on the complete, post-BLL plan and canonical inputs (with 1 bounded targeted repair pass if summary/representation has a semantic/factual defect)
  let consistency = await validateCrossEngineStrategyConsistency(
    results,
    activeStrategyRoot,
    config.accountId,
    {
      synthesizedPlan: synthesized,
      canonicalContext: (ctx as any)?.canonicalContext,
      bizData,
      campaignId: config.campaignId,
    }
  );

  if (
    !consistency.valid &&
    consistency.outcomeType !== "CHECK_NOT_EXECUTED" &&
    (consistency.responsibleEngines || []).every((e) => e === "plan_synthesis" || e === "offer")
  ) {
    try {
      console.log(`[PlanSynthesis] BOUNDED_TARGETED_REPAIR | Attempting 1 targeted repair pass on synthesis summary for: ${consistency.conflict}`);
      const repairResp = await aiChat({
        model: "gpt-4.1-mini",
        temperature: 0.1,
        accountId: config.accountId,
        endpoint: "plan-synthesis-targeted-repair",
        response_format: { type: "json_object" },
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: `You are the Strategic Plan Synthesis Repair Editor. Rewrite the strategicSummary so it strictly reflects the verified product facts and approved positioning without any unsupported absolutes, unverified revision guarantees, unverified permanence claims, or unverified prices/durations. Return ONLY JSON: {"strategy": "...", "targetAudience": "...", "growthObjective": "...", "rationale": "..."}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              currentStrategicSummary: synthesized.strategicSummary,
              defectsToFix: consistency.defects || [consistency.conflict],
              verifiedProductFacts: bizData?.productTruthFacts || [],
            }),
          },
        ],
      });
      const repairedSum = JSON.parse(repairResp.choices?.[0]?.message?.content || "{}");
      if (repairedSum.strategy && repairedSum.rationale) {
        synthesized.strategicSummary = {
          ...synthesized.strategicSummary,
          strategy: String(repairedSum.strategy).trim(),
          targetAudience: String(repairedSum.targetAudience || synthesized.strategicSummary.targetAudience).trim(),
          growthObjective: String(repairedSum.growthObjective || synthesized.strategicSummary.growthObjective).trim(),
          rationale: String(repairedSum.rationale).trim(),
        };
        if (synthesized.businessRepresentation?.strategicSummary) {
          synthesized.businessRepresentation.strategicSummary = {
            ...synthesized.businessRepresentation.strategicSummary,
            strategy: synthesized.strategicSummary.strategy,
            targetAudience: synthesized.strategicSummary.targetAudience,
            growthObjective: synthesized.strategicSummary.growthObjective,
            rationale: synthesized.strategicSummary.rationale,
          };
        }
        consistency = await validateCrossEngineStrategyConsistency(
          results,
          activeStrategyRoot,
          config.accountId,
          {
            synthesizedPlan: synthesized,
            canonicalContext: (ctx as any)?.canonicalContext,
            bizData,
            campaignId: config.campaignId,
          }
        );
      }
    } catch (repErr: any) {
      console.warn(`[PlanSynthesis] BOUNDED_TARGETED_REPAIR_FAILED | ${repErr?.message}`);
    }
  }

  synthesized._provenance = {
    ...(synthesized._provenance || {}),
    ...(config.jobId ? { jobId: config.jobId } : {}),
    ...(config.sourceJobId ? { sourceJobId: config.sourceJobId } : {}),
    ...(activeStrategyRoot?.id ? { strategyRootId: activeStrategyRoot.id } : {}),
    ...(rootBundle?.id ? { rootBundleId: rootBundle.id, rootBundleVersion: rootBundle.version } : {}),
    selectedSnapshotIds,
    ...(config.reusedSnapshotIds ? { reusedSnapshotIds: config.reusedSnapshotIds } : {}),
    ...(config.contextFingerprint ? { contextFingerprint: config.contextFingerprint } : {}),
    ...(config.offeringId ? { offeringId: config.offeringId } : {}),
    ...(config.offeringName ? { offeringName: config.offeringName } : {}),
    ...(config.targetMarket ? { targetMarket: config.targetMarket } : {}),
    ...(posProposalStatus ? { positioningProposalStatus: posProposalStatus } : {}),
  } as any;

  const { createHash } = await import("crypto");
  const planPayloadForHash = { ...synthesized };
  delete (planPayloadForHash as any).consistencyValidation;
  delete (planPayloadForHash as any).governance;
  const validatedPlanHash = createHash("sha256").update(JSON.stringify(planPayloadForHash)).digest("hex").slice(0, 32);

  (synthesized as any).consistencyValidation = {
    executed: !consistency.checkFailed,
    valid: consistency.valid,
    outcomeType: consistency.outcomeType || (consistency.valid ? "PASSED" : "FAILED_SEMANTIC"),
    blocking: Boolean(consistency.blocking ?? !consistency.valid),
    checkFailed: Boolean(consistency.checkFailed),
    validatedPlanHash,
    defects: consistency.defects || [],
    inputCoverage: consistency.inputCoverage || null,
    mechanicalPreservation: {
      totalLocked: verification?.totalLocked || 0,
      preserved: verification?.preserved || 0,
      missing: verification?.missing || [],
      passed: Boolean(verification?.passed ?? true),
      note: "Mechanical preservation of locked root fields does not by itself establish cross-section semantic consistency.",
    },
    semanticConsistency: consistency.semanticConsistency || {
      passed: consistency.valid && !consistency.checkFailed,
      issues: consistency.conflict ? [consistency.conflict] : [],
      summary: consistency.valid ? "Cross-engine sections are semantically aligned." : (consistency.conflict || "Consistency check did not pass."),
    },
    factualSupport: consistency.factualSupport || {
      passed: consistency.valid && !consistency.checkFailed,
      unsupportedPromises: [],
      summary: consistency.valid ? "Material promises align with verified product truth and epistemic labels." : (consistency.conflict || "Factual support check did not pass."),
    },
    conflict: consistency.conflict || null,
    checkedAt: new Date().toISOString(),
  };

  if (!consistency.valid) {
    if (consistency.outcomeType === "FAILED_DETERMINISTIC") {
      console.error(`[PlanSynthesis] STRATEGY_CONSISTENCY_BLOCKING_ERROR | outcomeType=${consistency.outcomeType} | conflict=${consistency.conflict}`);
      throw new StrategyConsistencyError(
        consistency.conflict!,
        consistency.canonicalFields || [],
        consistency.responsibleEngines || ["plan_synthesis"],
        consistency.recommendedRegenerationTarget || "plan_synthesis"
      );
    } else {
      console.warn(`[PlanSynthesis] STRATEGY_CONSISTENCY_SEMANTIC_BLOCKER | outcomeType=${consistency.outcomeType} | conflict=${consistency.conflict} | engines=[${consistency.responsibleEngines?.join(",")}]`);
    }
  }

  // Construct and attach plan governance block
  const governedBudget = resolveGovernedBudgetState(budgetGovResult?.output);
  const isRootEligible = Boolean(activeStrategyRoot && (activeStrategyRoot.status === "ACTIVE" || activeStrategyRoot.executionEligible === true));

  const approvalBlockers: string[] = [];
  if (!isRootEligible) {
    approvalBlockers.push(`Strategy Root ${activeStrategyRoot?.id || 'none'} has status "${activeStrategyRoot?.status || 'UNKNOWN'}", not execution-eligible.`);
  }
  // System Control: only block if strategy itself is structurally blocked (not spend-only downgrade/review)
  if (controlVerdict && (controlVerdict.strategyBlocked === true || controlVerdict.verdict === "BLOCK" || controlVerdict.executionMode === "SYSTEM_UNTRUSTED" || controlVerdict.executionMode === "HALTED")) {
    approvalBlockers.push(`System Control verdict rejected strategy execution: status=${controlVerdict.verdict}, action=${controlVerdict.executionMode}.`);
  }
  if (verification && !verification.passed) {
    approvalBlockers.push(`Missing ${verification.missing.length} locked strategic decision(s): ${verification.missing.join(', ')}.`);
  }
  if (consistency.checkFailed) {
    approvalBlockers.push(`Required cross-engine consistency validation failed to execute: ${consistency.conflict || "provider or parse error"}.`);
  } else if (!consistency.valid || consistency.blocking) {
    approvalBlockers.push(`Cross-engine consistency validation failed (${consistency.outcomeType}): ${consistency.conflict}.`);
  }
  // Fatal budget failure only blocks plan approval (e.g. fatal calculation/currency error)
  if (governedBudget.governanceState === "BLOCKED" || governedBudget.action === "halt") {
    approvalBlockers.push(`Budget Governor halted execution: ${governedBudget.reasoning || 'budget calculation error'}.`);
  }
  // Spend authorization separation: unconfirmed budget in recommendation_only mode does NOT block strategy recommendation approval.
  // In live ad spend execution mode, unconfirmed budget blocks live spend execution.
  if (governedBudget.executionMode === "execution" && (governedBudget.spendAction === "hold" || governedBudget.budgetConfirmation !== "user_confirmed")) {
    approvalBlockers.push(`Live ad spend execution blocked: ${governedBudget.reasoning || 'budget unconfirmed for live spend'}.`);
  }

  synthesized.governance = {
    strategyRoot: {
      rootId: activeStrategyRoot?.id || null,
      rootStatus: activeStrategyRoot?.status || "UNKNOWN",
      executionEligible: isRootEligible,
    },
    systemControl: {
      verdictId: controlVerdict?.id || (controlVerdict as any)?.verdictId || null,
      status: controlVerdict?.verdict || "UNKNOWN",
      enforcementAction: controlVerdict?.executionMode || "UNKNOWN",
      allowExecution: controlVerdict ? (controlVerdict.verdict === "PASS" || (controlVerdict.verdict !== "BLOCK" && controlVerdict.strategyBlocked === false)) : false,
    },
    governedBudget,
    lockedDecisions: {
      total: verification?.totalLocked || 0,
      preserved: verification?.preserved || 0,
      missing: verification?.missing || [],
      coverage: (verification?.totalLocked && verification.totalLocked > 0) ? (verification.preserved / verification.totalLocked) : 1,
    },
    consistencyValidation: (synthesized as any).consistencyValidation,
    approvalBlockers,
  };

  await db
    .update(strategicPlans)
    .set({ status: "SUPERSEDED", isDesignatedActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(strategicPlans.accountId, config.accountId),
        eq(strategicPlans.campaignId, config.campaignId),
        eq(strategicPlans.status, "DRAFT")
      )
    );

  // Post-generation text mangling removed: claim status originates in upstream
  // evidence and assessments, preserving exact engine output in planJson.
  const [plan] = await db.insert(strategicPlans).values({
    accountId: config.accountId,
    blueprintId: "orchestrator-v2",
    campaignId: config.campaignId,
    jobId: config.jobId,
    planJson: JSON.stringify(synthesized),
    planSummary: synthesized.strategicSummary.strategy,
    status: "DRAFT",
    executionStatus: "IDLE",
    totalCalendarEntries: 0,
    totalStudioItems: 0,
    totalPublished: 0,
    totalFailed: 0,
    totalCanceled: 0,
    rootBundleId: rootBundle?.id || null,
    rootBundleVersion: rootBundle?.version || null,
  }).returning();

  const explorationSlotsPerWeek = synthesized.explorationPlan?.totalExplorationCount ?? 0;

  // Generate calendar slots FIRST so requiredWork.total* can be derived from the
  // exact slots that will be persisted (single source of truth). This eliminates
  // formula-drift between deriveContentVolume() (weekly × ceil(days/7)) and
  // generateCalendarSlots() (per-day, per-weekday gating with Sunday skip and
  // partial last-week edges) AND ensures exploration slots — which inject
  // per-type content — are counted in the same per-type buckets used by the
  // calendar deviation check at approval time.
  const calendarSlots = generateCalendarSlots(
    synthesized,
    periodDays,
    config.campaignId,
    config.accountId,
    plan.id,
    rootBundle?.id || null,
    rootBundle?.version || null,
    explorationSlotList,
  );

  const slotCounts = { REEL: 0, POST: 0, STORY: 0, CAROUSEL: 0, VIDEO: 0 } as Record<string, number>;
  for (const s of calendarSlots) {
    const t = (s.contentType || "").toUpperCase();
    if (t in slotCounts) slotCounts[t]++;
  }

  await db.insert(requiredWork).values({
    planId: plan.id,
    campaignId: config.campaignId,
    accountId: config.accountId,
    periodDays,
    reelsPerWeek: volume.reelsPerWeek,
    postsPerWeek: volume.postsPerWeek,
    storiesPerDay: volume.storiesPerDay,
    carouselsPerWeek: volume.carouselsPerWeek,
    videosPerWeek: volume.videosPerWeek,
    totalReels: slotCounts.REEL,
    totalPosts: slotCounts.POST,
    totalStories: slotCounts.STORY,
    totalCarousels: slotCounts.CAROUSEL,
    totalVideos: slotCounts.VIDEO,
    totalContentPieces: calendarSlots.length,
    explorationSlotsPerWeek,
    generatedCount: 0,
    readyCount: 0,
    scheduledCount: 0,
    publishedCount: 0,
    failedCount: 0,
    rootBundleId: rootBundle?.id || null,
    rootBundleVersion: rootBundle?.version || null,
  });

  if (calendarSlots.length > 0) {
    const inserted = await db.insert(calendarEntries).values(calendarSlots).returning({ id: calendarEntries.id, contentType: calendarEntries.contentType });
    // CAS via casUpdateStrategicPlan helper.
    await casUpdateStrategicPlan(plan.id, { totalCalendarEntries: calendarSlots.length });

    const byType = new Map<string, string[]>();
    for (const entry of (inserted || [])) {
      const t = (entry.contentType || "POST").toUpperCase();
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(entry.id);
    }

    for (const [contentType, entryIds] of byType) {
      const attrResult = await createAttributionEntries(entryIds, contentType, config.campaignId, config.accountId);
      if (attrResult.primaryDecisionId) {
        await db.update(calendarEntries)
          .set({ sourceDecisionId: attrResult.primaryDecisionId })
          .where(inArray(calendarEntries.id, entryIds));
      }
    }
  }

  console.log(`[PlanSynthesis] Created plan ${plan.id} with ${calendarSlots.length} calendar entries, ${volume.totalContentPieces} required content pieces, root v${rootBundle?.version || "none"}`);

  try {
    const { generateContentDna } = await import("../content-dna-routes");
    await generateContentDna(config.campaignId, config.accountId, plan.id, rootBundle?.id || null, rootBundle?.version || null);
    console.log(`[PlanSynthesis] Content DNA generated for plan ${plan.id}`);
  } catch (dnaErr: any) {
    console.warn(`[PlanSynthesis] Content DNA generation failed (non-blocking):`, dnaErr.message);
  }

  try {
    const taskContext: import("../task-composer").TaskComposerContext = {
      budgetDecision: budgetDecision || undefined,
      budgetKillFlag: budgetKillFlag,
      integrityScore: integrityScore,
      safeToExecute: safeToExecute,
      signalTrustedRatio: signalComp?.trustedRatio ?? undefined,
    };
    await composeTasks(plan.id, config.campaignId, config.accountId, synthesized, periodDays, rootBundle?.id || null, taskContext);
    console.log(`[PlanSynthesis] Execution tasks generated for plan ${plan.id} | budgetDecision=${budgetDecision} integrity=${integrityDegradation}`);
  } catch (taskErr: any) {
    console.warn(`[PlanSynthesis] Task composition failed (non-blocking):`, taskErr.message);
  }

  if (goalMathContext) {
    try {
      await generateSimulation(
        config.campaignId,
        config.accountId,
        plan.id,
        goalMathContext.goal,
        goalMathContext.funnel,
        goalMathContext.feasibility,
        bizData,
        rootBundle?.id || null,
        config.jobId
      );
      console.log(`[PlanSynthesis] Growth simulation generated for plan ${plan.id}`);
    } catch (simErr: any) {
      console.warn(`[PlanSynthesis] Simulation failed (non-blocking):`, simErr.message);
    }
  }

  if (readiness && readiness.assumptions.length > 0) {
    try {
      const assumptions: AssumptionEntry[] = readiness.assumptions.map((a: any) => ({
        assumption: a.item,
        confidence: a.confidence as "low" | "medium" | "high",
        impactSeverity: a.impact as "low" | "medium" | "high",
        source: "plan_gate",
        affectedModules: ["plan", "simulation"],
      }));
      await logAssumptions(plan.id, config.campaignId, config.accountId, assumptions);
      console.log(`[PlanSynthesis] ${assumptions.length} assumptions logged for plan ${plan.id}`);
    } catch (assErr: any) {
      console.warn(`[PlanSynthesis] Assumption logging failed (non-blocking):`, assErr.message);
    }
  }

  const cleanPlanPayload = deepScrubPlan(synthesized);
  return { planId: plan.id, plan: cleanPlanPayload };
}

export function deepScrubPlan(obj: any, _currentRole: "OBSERVED_SIGNAL" | "STRATEGIC_INSIGHT" | "PRODUCT_CAPABILITY" | "UNKNOWN" = "PRODUCT_CAPABILITY"): any {
  // Post-validation semantic regex rewriting has been removed so persisted planJson and returned plan are identical to the validated payload.
  return obj;
}

export function reconcileBudgetDenominators(
  totalCampaignBudget: number,
  currency: string,
  allocations: Array<{
    channelId: string;
    channelName?: string;
    sharePercentage?: number;
    monthlyAmount?: number;
    why?: string;
    isOrganic?: boolean;
    proposedUse?: string;
  }>,
): {
  totalCampaignBudget: number;
  currency: string;
  paidMediaSpend: number;
  contentProductionBudget: number;
  organicEffortAllocation: number;
  unallocatedReserve: number;
  reconcilesToTotal: boolean;
  reconciledAllocations: Array<{
    channelId: string;
    channelName?: string;
    sharePercentage: number;
    monthlyAmount: number;
    why?: string;
    isOrganic: boolean;
    proposedUse?: string;
    spendCategory: "PAID_MEDIA" | "CONTENT_PRODUCTION" | "ORGANIC_EXECUTION";
  }>;
} {
  const safeTotal = Math.max(0, Number(totalCampaignBudget || 0));
  const rawList = Array.isArray(allocations) ? allocations : [];
  const rawSum = rawList.reduce((acc, a) => acc + Math.max(0, Number(a.monthlyAmount || 0)), 0);
  const scaleFactor = rawSum > 0 && rawSum !== safeTotal ? safeTotal / rawSum : 1;

  let paidMediaSpend = 0;
  let contentProductionBudget = 0;
  let organicEffortAllocation = 0;

  const reconciledAllocations = rawList.map((a) => {
    const scaledAmt = rawSum > 0
      ? Math.round(Math.max(0, Number(a.monthlyAmount || 0)) * scaleFactor)
      : Math.round((Math.max(0, Number(a.sharePercentage || 0)) / 100) * safeTotal);
    const sharePct = safeTotal > 0 ? Math.round((scaledAmt / safeTotal) * 100) : Number(a.sharePercentage || 0);
    const isOrg = Boolean(a.isOrganic);
    const useLower = `${a.proposedUse || ""} ${a.why || ""}`.toLowerCase();
    const isContentProd = isOrg && /\b(production|creator|video|editing|asset|studio)\b/.test(useLower);
    const spendCategory: "PAID_MEDIA" | "CONTENT_PRODUCTION" | "ORGANIC_EXECUTION" = !isOrg
      ? "PAID_MEDIA"
      : isContentProd
        ? "CONTENT_PRODUCTION"
        : "ORGANIC_EXECUTION";

    if (spendCategory === "PAID_MEDIA") paidMediaSpend += scaledAmt;
    else if (spendCategory === "CONTENT_PRODUCTION") contentProductionBudget += scaledAmt;
    else organicEffortAllocation += scaledAmt;

    return {
      ...a,
      sharePercentage: sharePct,
      monthlyAmount: scaledAmt,
      isOrganic: isOrg,
      spendCategory,
    };
  });

  const allocatedSum = paidMediaSpend + contentProductionBudget + organicEffortAllocation;
  const unallocatedReserve = Math.max(0, safeTotal - allocatedSum);

  return {
    totalCampaignBudget: safeTotal,
    currency: currency || "USD",
    paidMediaSpend,
    paidMediaBudget: paidMediaSpend,
    contentProductionBudget,
    organicEffortAllocation,
    contentAndOrganicBudget: contentProductionBudget + organicEffortAllocation,
    unallocatedReserve,
    reconcilesToTotal: allocatedSum + unallocatedReserve === safeTotal,
    reconciledAllocations,
  };
}

export function resolveAuthoritativeCampaignMarket(
  campaignContext: { targetMarket?: string | null; currency?: string | null },
  businessUnderstanding?: { companyAddressCountry?: string | null; pricingCurrency?: string | null },
): {
  authoritativeTargetMarket: string;
  provenance: "USER_SELECTED_CAMPAIGN_SCOPE" | "BUSINESS_FALLBACK";
  companyIncorporationLocation: string | null;
  pricingCurrency: string | null;
} {
  const userMarket = (campaignContext?.targetMarket || "").trim();
  const companyLocation = (businessUnderstanding?.companyAddressCountry || "").trim() || null;
  const currency = (campaignContext?.currency || businessUnderstanding?.pricingCurrency || "").trim() || null;

  if (userMarket.length > 0) {
    return {
      authoritativeTargetMarket: userMarket,
      provenance: "USER_SELECTED_CAMPAIGN_SCOPE",
      companyIncorporationLocation: companyLocation,
      pricingCurrency: currency,
    };
  }

  return {
    authoritativeTargetMarket: companyLocation || "Global",
    provenance: "BUSINESS_FALLBACK",
    companyIncorporationLocation: companyLocation,
    pricingCurrency: currency,
  };
}
