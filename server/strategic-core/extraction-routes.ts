import type { Express, Request, Response } from "express";
import { aiChat } from "../ai-client";
import { db } from "../db";
import {
  strategicBlueprints,
  businessDataLayer,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  offerSnapshots,
  funnelSnapshots,
  integritySnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
} from "@shared/schema";
import { inArray, eq, and, desc } from "drizzle-orm";
import { logAuditEvent } from "./audit-logger";
import { getEngineReadinessState } from "../market-intelligence-v3/engine-state";
import { ENGINE_VERSION } from "../market-intelligence-v3/constants";

const CREATIVE_BLUEPRINT_PROMPT = `You are a marketing creative strategist. Given campaign context, business data, competitor intelligence, market signals, and ENGINE OUTPUTS from the MarketMind pipeline, generate a structured Creative Blueprint.

Your task is to synthesize the engine outputs into actionable creative direction.

CRITICAL RULES:
- Respond with ONLY a valid JSON object. No markdown, no explanation, no free text.
- Each field MUST have a confidence score (0-100) based on how much input data supports the recommendation.
- ENGINE OUTPUTS are the PRIMARY source of truth. Use them directly:
  • Positioning Engine → detectedPositioning (use the selected territory/statement)
  • Offer Engine → detectedOffer (use the offer name and core outcome)
  • Audience Engine → detectedAudienceGuess (use segments and pain profiles)
  • Funnel Engine → detectedFunnelStage (use the funnel type and stage)
  • Persuasion Engine → detectedCTA, hookDirection, narrativeStructure (use the primary route's CTA, hook strategy, narrative arc)
  • Differentiation Engine → contentAngle (use pillars and claims)
  • Awareness Engine → hookDirection refinement (use awareness level and route)
  • Channel Selection → formatSuggestion (match channel to format)
- If an engine output exists, confidence should be 70-95 (data-backed).
- Only set confidence to 40-60 if extrapolating from limited data.
- Only use "INSUFFICIENT_DATA" if truly no engine output OR business context exists.

FIELD-TO-ENGINE MAPPING (use these as your primary source for each field):
- detectedOffer: Offer Engine (offerName + coreOutcome) → compose the offer positioning
- detectedPositioning: Positioning Engine (selectedTerritory, positioningStatement) → map to premium|discount|authority|convenience|value
- detectedCTA: Persuasion Engine (primaryRoute.ctaApproach) → specific call-to-action
- detectedAudienceGuess: Audience Engine (segments, pain points) → target audience description
- detectedFunnelStage: Funnel Engine (funnelType, selectedFunnelType) → awareness|consideration|conversion|retention
- hookDirection: Persuasion Engine (hookStrategy) + Awareness Engine (awarenessLevel) → hook approach
- narrativeStructure: Persuasion Engine (narrativeArc) → story structure
- contentAngle: Differentiation Engine (pillars, claims) → unique angle
- visualDirection: Overall brand positioning + audience emotional drivers → visual style
- formatSuggestion: Channel Selection (primaryChannel) → reel|post|story|carousel

Response format (strict JSON only):
{
  "detectedLanguage": "string (primary language for content)",
  "transcribedText": null,
  "ocrText": null,
  "detectedOffer": { "value": "string (from Offer Engine output)", "confidence": 0-100, "source": "offer_engine" },
  "detectedPositioning": { "value": "premium|discount|authority|convenience|value", "confidence": 0-100, "source": "positioning_engine" },
  "detectedCTA": { "value": "string (from Persuasion Engine)", "confidence": 0-100, "source": "persuasion_engine" },
  "detectedAudienceGuess": { "value": "string (from Audience Engine)", "confidence": 0-100, "source": "audience_engine" },
  "detectedFunnelStage": { "value": "awareness|consideration|conversion|retention", "confidence": 0-100, "source": "funnel_engine" },
  "detectedPriceIfVisible": { "value": null, "confidence": 0 },
  "hookDirection": { "value": "string (from Persuasion + Awareness Engines)", "confidence": 0-100, "source": "persuasion_engine" },
  "narrativeStructure": { "value": "string (from Persuasion Engine narrative arc)", "confidence": 0-100, "source": "persuasion_engine" },
  "contentAngle": { "value": "string (from Differentiation Engine)", "confidence": 0-100, "source": "differentiation_engine" },
  "visualDirection": { "value": "string (visual style from positioning + audience)", "confidence": 0-100, "source": "positioning_engine" },
  "formatSuggestion": { "value": "reel|post|story|carousel", "confidence": 0-100, "source": "channel_selection" }
}`;

export function cleanJsonString(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, '');
  s = s.replace(/\s*```\s*$/i, '');
  s = s.trim();
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON object found in response");
  }
  s = jsonMatch[0];
  s = s.replace(/\/\/[^\n]*/g, '');
  s = s.replace(/,\s*([\]}])/g, '$1');
  s = s.replace(/[\x00-\x1F\x7F]/g, (ch: string) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
    return '';
  });
  return s;
}

function buildFallbackBlueprint(): any {
  return {
    detectedLanguage: "unknown",
    transcribedText: null,
    ocrText: null,
    detectedOffer: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedPositioning: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedCTA: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedAudienceGuess: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedFunnelStage: { value: "INSUFFICIENT_DATA", confidence: 0 },
    detectedPriceIfVisible: { value: null, confidence: 0 },
    hookDirection: { value: "INSUFFICIENT_DATA", confidence: 0 },
    narrativeStructure: { value: "INSUFFICIENT_DATA", confidence: 0 },
    contentAngle: { value: "INSUFFICIENT_DATA", confidence: 0 },
    visualDirection: { value: "INSUFFICIENT_DATA", confidence: 0 },
    formatSuggestion: { value: "INSUFFICIENT_DATA", confidence: 0 },
  };
}

function normalizeExtraction(raw: any): any {
  const fields = [
    "detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess",
    "detectedFunnelStage", "detectedPriceIfVisible",
    "hookDirection", "narrativeStructure", "contentAngle", "visualDirection", "formatSuggestion",
  ];
  const result: any = {
    detectedLanguage: raw.detectedLanguage || "unknown",
    transcribedText: null,
    ocrText: null,
  };

  for (const field of fields) {
    const val = raw[field];
    if (val && typeof val === "object" && "value" in val && "confidence" in val) {
      result[field] = {
        value: val.value === null || val.value === undefined || val.value === "" ? "INSUFFICIENT_DATA" : val.value,
        confidence: typeof val.confidence === "number" ? Math.max(0, Math.min(100, val.confidence)) : 0,
        source: val.source || null,
      };
    } else if (val !== null && val !== undefined && val !== "" && val !== "null") {
      result[field] = { value: val, confidence: 50, source: null };
    } else {
      result[field] = { value: "INSUFFICIENT_DATA", confidence: 0, source: null };
    }

    if (result[field].value === "INSUFFICIENT_DATA") {
      result[field].confidence = 0;
    }
  }

  return result;
}

function safeParseJson(text: string | null | undefined): any {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function loadEngineOutputs(accountId: string, campaignId: string): Promise<string> {
  const sections: string[] = [];

  try {
    const [aud] = await db.select().from(audienceSnapshots)
      .where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
      .orderBy(desc(audienceSnapshots.createdAt)).limit(1);
    if (aud) {
      sections.push(`AUDIENCE ENGINE:`);
      const pains = safeParseJson(aud.audiencePains);
      const desires = safeParseJson(aud.desireMap);
      const objections = safeParseJson(aud.objectionMap);
      const segments = safeParseJson(aud.audienceSegments);
      const emotions = safeParseJson(aud.emotionalDrivers);
      if (pains?.length) sections.push(`- Pain Points: ${pains.slice(0, 5).map((p: any) => typeof p === 'string' ? p : p.pain || p.label || JSON.stringify(p)).join('; ')}`);
      if (desires?.length) sections.push(`- Desires: ${desires.slice(0, 5).map((d: any) => typeof d === 'string' ? d : d.desire || d.label || JSON.stringify(d)).join('; ')}`);
      if (objections?.length) sections.push(`- Objections: ${objections.slice(0, 5).map((o: any) => typeof o === 'string' ? o : o.objection || o.label || JSON.stringify(o)).join('; ')}`);
      if (segments?.length) sections.push(`- Segments: ${segments.slice(0, 3).map((s: any) => typeof s === 'string' ? s : s.name || s.label || JSON.stringify(s)).join('; ')}`);
      if (emotions?.length) sections.push(`- Emotional Drivers: ${emotions.slice(0, 3).map((e: any) => typeof e === 'string' ? e : e.driver || e.label || JSON.stringify(e)).join('; ')}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] audience error: ${err.message}`); }

  try {
    const [pos] = await db.select().from(positioningSnapshots)
      .where(and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.status, "COMPLETE")))
      .orderBy(desc(positioningSnapshots.createdAt)).limit(1);
    if (pos) {
      sections.push(`POSITIONING ENGINE:`);
      if (pos.territory) {
        const terr = safeParseJson(pos.territory);
        sections.push(`- Territory: ${terr?.name || terr?.territory || (typeof terr === 'string' ? terr : pos.territory.slice(0, 200))}`);
      }
      const territories = safeParseJson(pos.territories);
      if (territories?.length) sections.push(`- Territories: ${territories.slice(0, 3).map((t: any) => t.name || t.territory || JSON.stringify(t)).join('; ')}`);
      if (pos.narrativeDirection) sections.push(`- Narrative Direction: ${pos.narrativeDirection.slice(0, 200)}`);
      if (pos.contrastAxis) sections.push(`- Contrast Axis: ${pos.contrastAxis.slice(0, 200)}`);
      if (pos.enemyDefinition) sections.push(`- Enemy Definition: ${pos.enemyDefinition.slice(0, 200)}`);
      if (pos.differentiationVector) sections.push(`- Differentiation Vector: ${pos.differentiationVector.slice(0, 200)}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] positioning error: ${err.message}`); }

  try {
    const [diff] = await db.select().from(differentiationSnapshots)
      .where(and(eq(differentiationSnapshots.accountId, accountId), eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.status, "COMPLETE")))
      .orderBy(desc(differentiationSnapshots.createdAt)).limit(1);
    if (diff) {
      sections.push(`DIFFERENTIATION ENGINE:`);
      const pillars = safeParseJson(diff.differentiationPillars);
      const claims = safeParseJson(diff.claimStructures);
      const proof = safeParseJson(diff.proofArchitecture);
      if (pillars?.length) sections.push(`- Pillars: ${pillars.slice(0, 3).map((p: any) => p.name || p.pillar || JSON.stringify(p)).join('; ')}`);
      if (claims?.length) sections.push(`- Claims: ${claims.slice(0, 3).map((c: any) => c.claim || c.statement || JSON.stringify(c)).join('; ')}`);
      if (proof?.length) sections.push(`- Proof Points: ${proof.slice(0, 3).map((p: any) => p.asset || p.proof || JSON.stringify(p)).join('; ')}`);
      if (diff.authorityMode) sections.push(`- Authority Mode: ${diff.authorityMode}`);
      if (diff.mechanismFraming) sections.push(`- Mechanism: ${diff.mechanismFraming.slice(0, 200)}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] differentiation error: ${err.message}`); }

  try {
    const [offer] = await db.select().from(offerSnapshots)
      .where(and(eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.campaignId, campaignId), eq(offerSnapshots.status, "COMPLETE")))
      .orderBy(desc(offerSnapshots.createdAt)).limit(1);
    if (offer) {
      sections.push(`OFFER ENGINE:`);
      const primary = safeParseJson(offer.primaryOffer);
      if (primary) {
        if (primary.offerName) sections.push(`- Offer Name: ${primary.offerName}`);
        if (primary.coreOutcome) sections.push(`- Core Outcome: ${primary.coreOutcome}`);
        if (primary.mechanism) sections.push(`- Mechanism: ${primary.mechanism}`);
        if (primary.deliverables?.length) sections.push(`- Deliverables: ${primary.deliverables.slice(0, 5).join('; ')}`);
        if (primary.riskReducers?.length) sections.push(`- Risk Reducers: ${primary.riskReducers.slice(0, 3).join('; ')}`);
      }
      if (offer.offerStrengthScore) sections.push(`- Strength Score: ${offer.offerStrengthScore}`);
      if (offer.hookMechanismAlignment) sections.push(`- Hook-Mechanism Alignment: ${offer.hookMechanismAlignment}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] offer error: ${err.message}`); }

  try {
    const [funnel] = await db.select().from(funnelSnapshots)
      .where(and(eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.campaignId, campaignId), eq(funnelSnapshots.status, "COMPLETE")))
      .orderBy(desc(funnelSnapshots.createdAt)).limit(1);
    if (funnel) {
      sections.push(`FUNNEL ENGINE:`);
      const primary = safeParseJson(funnel.primaryFunnel);
      if (primary) {
        if (primary.funnelType) sections.push(`- Funnel Type: ${primary.funnelType}`);
        if (primary.stages?.length) sections.push(`- Stages: ${primary.stages.map((s: any) => s.name || s.stage || JSON.stringify(s)).join(' → ')}`);
        if (primary.trustPath) sections.push(`- Trust Path: ${typeof primary.trustPath === 'string' ? primary.trustPath : JSON.stringify(primary.trustPath).slice(0, 200)}`);
      }
      if (funnel.selectedOption) sections.push(`- Selected Option: ${funnel.selectedOption}`);
      if (funnel.funnelStrengthScore) sections.push(`- Strength Score: ${funnel.funnelStrengthScore}`);
      const trustAnalysis = safeParseJson(funnel.trustPathAnalysis);
      if (trustAnalysis) sections.push(`- Trust Analysis: ${JSON.stringify(trustAnalysis).slice(0, 200)}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] funnel error: ${err.message}`); }

  try {
    const [integ] = await db.select().from(integritySnapshots)
      .where(and(eq(integritySnapshots.accountId, accountId), eq(integritySnapshots.campaignId, campaignId), eq(integritySnapshots.status, "COMPLETE")))
      .orderBy(desc(integritySnapshots.createdAt)).limit(1);
    if (integ) {
      sections.push(`INTEGRITY ENGINE:`);
      if (integ.overallIntegrityScore) sections.push(`- Overall Integrity Score: ${integ.overallIntegrityScore}`);
      if (integ.safeToExecute !== null) sections.push(`- Safe to Execute: ${integ.safeToExecute}`);
      const warnings = safeParseJson(integ.structuralWarnings);
      if (warnings?.length) sections.push(`- Warnings: ${warnings.slice(0, 3).join('; ')}`);
      const inconsistencies = safeParseJson(integ.flaggedInconsistencies);
      if (inconsistencies?.length) sections.push(`- Inconsistencies: ${inconsistencies.slice(0, 3).map((i: any) => typeof i === 'string' ? i : JSON.stringify(i)).join('; ')}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] integrity error: ${err.message}`); }

  try {
    const [aware] = await db.select().from(awarenessSnapshots)
      .where(and(eq(awarenessSnapshots.accountId, accountId), eq(awarenessSnapshots.campaignId, campaignId), eq(awarenessSnapshots.status, "COMPLETE")))
      .orderBy(desc(awarenessSnapshots.createdAt)).limit(1);
    if (aware) {
      sections.push(`AWARENESS ENGINE:`);
      const primary = safeParseJson(aware.primaryRoute);
      if (primary) {
        sections.push(`- Primary Route: ${primary.routeName || primary.name || JSON.stringify(primary).slice(0, 200)}`);
        if (primary.awarenessLevel) sections.push(`- Awareness Level: ${primary.awarenessLevel}`);
        if (primary.hookApproach) sections.push(`- Hook Approach: ${primary.hookApproach}`);
        if (primary.contentStrategy) sections.push(`- Content Strategy: ${primary.contentStrategy}`);
      }
      if (aware.awarenessStrengthScore) sections.push(`- Strength Score: ${aware.awarenessStrengthScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] awareness error: ${err.message}`); }

  try {
    const [pers] = await db.select().from(persuasionSnapshots)
      .where(and(eq(persuasionSnapshots.accountId, accountId), eq(persuasionSnapshots.campaignId, campaignId), eq(persuasionSnapshots.status, "COMPLETE")))
      .orderBy(desc(persuasionSnapshots.createdAt)).limit(1);
    if (pers) {
      sections.push(`PERSUASION ENGINE:`);
      const primary = safeParseJson(pers.primaryRoute);
      if (primary) {
        sections.push(`- Primary Route: ${primary.routeName || primary.name || JSON.stringify(primary).slice(0, 200)}`);
        if (primary.hookStrategy) sections.push(`- Hook Strategy: ${primary.hookStrategy}`);
        if (primary.ctaApproach) sections.push(`- CTA Approach: ${primary.ctaApproach}`);
        if (primary.narrativeArc) sections.push(`- Narrative Arc: ${primary.narrativeArc}`);
        if (primary.objectionHandling) sections.push(`- Objection Handling: ${primary.objectionHandling}`);
      }
      if (pers.persuasionStrengthScore) sections.push(`- Strength Score: ${pers.persuasionStrengthScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] persuasion error: ${err.message}`); }

  try {
    const [statVal] = await db.select().from(strategyValidationSnapshots)
      .where(and(eq(strategyValidationSnapshots.accountId, accountId), eq(strategyValidationSnapshots.campaignId, campaignId), eq(strategyValidationSnapshots.status, "COMPLETE")))
      .orderBy(desc(strategyValidationSnapshots.createdAt)).limit(1);
    if (statVal) {
      sections.push(`STATISTICAL VALIDATION:`);
      const result = safeParseJson(statVal.result);
      if (result) {
        if (result.validationState) sections.push(`- Validation State: ${result.validationState}`);
        if (result.claimConfidenceScore) sections.push(`- Claim Confidence: ${result.claimConfidenceScore}`);
        if (result.evidenceStrength) sections.push(`- Evidence Strength: ${result.evidenceStrength}`);
      }
      if (statVal.confidenceScore) sections.push(`- Overall Confidence: ${statVal.confidenceScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] statValidation error: ${err.message}`); }

  try {
    const [budget] = await db.select().from(budgetGovernorSnapshots)
      .where(and(eq(budgetGovernorSnapshots.accountId, accountId), eq(budgetGovernorSnapshots.campaignId, campaignId), eq(budgetGovernorSnapshots.status, "COMPLETE")))
      .orderBy(desc(budgetGovernorSnapshots.createdAt)).limit(1);
    if (budget) {
      sections.push(`BUDGET GOVERNOR:`);
      const result = safeParseJson(budget.result);
      if (result) {
        if (result.decision) sections.push(`- Decision: ${result.decision}`);
        if (result.reasoning) sections.push(`- Reasoning: ${result.reasoning}`);
        if (result.allocations) sections.push(`- Allocations: ${JSON.stringify(result.allocations).slice(0, 200)}`);
      }
      if (budget.confidenceScore) sections.push(`- Confidence: ${budget.confidenceScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] budget error: ${err.message}`); }

  try {
    const [chan] = await db.select().from(channelSelectionSnapshots)
      .where(and(eq(channelSelectionSnapshots.accountId, accountId), eq(channelSelectionSnapshots.campaignId, campaignId), eq(channelSelectionSnapshots.status, "COMPLETE")))
      .orderBy(desc(channelSelectionSnapshots.createdAt)).limit(1);
    if (chan) {
      sections.push(`CHANNEL SELECTION:`);
      const result = safeParseJson(chan.result);
      if (result) {
        const primary = result.primaryChannel;
        const secondary = result.secondaryChannel;
        if (primary) sections.push(`- Primary Channel: ${primary.channelName || primary.name || JSON.stringify(primary).slice(0, 100)}`);
        if (secondary) sections.push(`- Secondary Channel: ${secondary.channelName || secondary.name || JSON.stringify(secondary).slice(0, 100)}`);
        if (result.rejectedChannels?.length) sections.push(`- Rejected: ${result.rejectedChannels.map((c: any) => c.channelName || c.name).join(', ')}`);
      }
      if (chan.confidenceScore) sections.push(`- Confidence: ${chan.confidenceScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] channel error: ${err.message}`); }

  try {
    const [iter] = await db.select().from(iterationSnapshots)
      .where(and(eq(iterationSnapshots.accountId, accountId), eq(iterationSnapshots.campaignId, campaignId), eq(iterationSnapshots.status, "COMPLETE")))
      .orderBy(desc(iterationSnapshots.createdAt)).limit(1);
    if (iter) {
      sections.push(`ITERATION ENGINE:`);
      const result = safeParseJson(iter.result);
      if (result) {
        if (result.nextTestHypotheses?.length) sections.push(`- Test Hypotheses: ${result.nextTestHypotheses.slice(0, 2).map((h: any) => h.hypothesis || JSON.stringify(h)).join('; ')}`);
        if (result.optimizationTargets?.length) sections.push(`- Optimization Targets: ${result.optimizationTargets.slice(0, 2).map((t: any) => t.targetArea || JSON.stringify(t)).join('; ')}`);
        if (result.iterationPlan?.length) sections.push(`- Plan Steps: ${result.iterationPlan.length}`);
      }
      if (iter.confidenceScore) sections.push(`- Confidence: ${iter.confidenceScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] iteration error: ${err.message}`); }

  try {
    const [ret] = await db.select().from(retentionSnapshots)
      .where(and(eq(retentionSnapshots.accountId, accountId), eq(retentionSnapshots.campaignId, campaignId), eq(retentionSnapshots.status, "COMPLETE")))
      .orderBy(desc(retentionSnapshots.createdAt)).limit(1);
    if (ret) {
      sections.push(`RETENTION ENGINE:`);
      const result = safeParseJson(ret.result);
      if (result) {
        if (result.retentionLoops?.length) sections.push(`- Retention Loops: ${result.retentionLoops.slice(0, 3).map((l: any) => l.name || JSON.stringify(l)).join('; ')}`);
        if (result.churnRiskFlags?.length) sections.push(`- Churn Risks: ${result.churnRiskFlags.slice(0, 3).map((c: any) => c.riskFactor || JSON.stringify(c)).join('; ')}`);
        if (result.ltvExpansionPaths?.length) sections.push(`- LTV Paths: ${result.ltvExpansionPaths.length}`);
      }
      if (ret.confidenceScore) sections.push(`- Confidence: ${ret.confidenceScore}`);
    }
  } catch (err: any) { console.warn(`[EngineLoad] retention error: ${err.message}`); }

  return sections.join("\n");
}

export async function generateBlueprintForId(blueprintId: string): Promise<{
  success: boolean;
  error?: string;
  blueprintId?: string;
  blueprintVersion?: number;
  status?: string;
  draftBlueprint?: any;
  extractionFallbackUsed?: boolean;
  parseFailedReason?: string | null;
  _meta?: any;
}> {
  const [blueprint] = await db.select().from(strategicBlueprints).where(eq(strategicBlueprints.id, blueprintId)).limit(1);
  if (!blueprint) {
    return { success: false, error: "Blueprint not found" };
  }

  if (!["GATE_PASSED", "EXTRACTION_COMPLETE", "EXTRACTION_FALLBACK", "ANALYSIS_COMPLETE"].includes(blueprint.status)) {
    return { success: false, error: "Blueprint must pass Phase 0 gate before creative blueprint generation" };
  }

  const campaignContext = blueprint.campaignContext ? JSON.parse(blueprint.campaignContext) : null;
  const competitorUrls = blueprint.competitorUrls ? JSON.parse(blueprint.competitorUrls) : [];
  const asp = blueprint.averageSellingPrice;

  const resolvedCampaignId = campaignContext?.campaignId || blueprint.campaignId;

  const [latestMiForCheck] = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, blueprint.accountId),
      eq(miSnapshots.campaignId, resolvedCampaignId),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const miReadiness = getEngineReadinessState(
    latestMiForCheck || null,
    resolvedCampaignId,
    ENGINE_VERSION,
    14,
  );

  console.log(`[StrategicCore] Phase 1 MI readiness check: state=${miReadiness.state} | campaign=${resolvedCampaignId} | blueprint=${blueprintId}`);

  if (miReadiness.state !== "READY") {
    console.log(`[StrategicCore] Phase 1 blocked — MI not ready: ${JSON.stringify(miReadiness.diagnostics)}`);
    return {
      success: false,
      error: "MI_NOT_READY",
    };
  }

  let businessData: any = null;
  if (resolvedCampaignId) {
    const [bd] = await db.select().from(businessDataLayer)
      .where(eq(businessDataLayer.campaignId, resolvedCampaignId))
      .limit(1);
    if (bd) businessData = bd;
  }

  let marketSignals: any = null;
  if (resolvedCampaignId) {
    const [latestSnapshot] = await db.select({
      marketDiagnosis: miSnapshots.marketDiagnosis,
      threatSignals: miSnapshots.threatSignals,
      opportunitySignals: miSnapshots.opportunitySignals,
      trajectoryData: miSnapshots.trajectoryData,
    }).from(miSnapshots)
      .where(and(
        eq(miSnapshots.accountId, blueprint.accountId),
        eq(miSnapshots.campaignId, resolvedCampaignId),
        inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
      ))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(1);

    if (latestSnapshot) {
      marketSignals = {
        diagnosis: latestSnapshot.marketDiagnosis,
        threats: latestSnapshot.threatSignals ? JSON.parse(latestSnapshot.threatSignals) : [],
        opportunities: latestSnapshot.opportunitySignals ? JSON.parse(latestSnapshot.opportunitySignals) : [],
        trajectory: latestSnapshot.trajectoryData ? JSON.parse(latestSnapshot.trajectoryData) : null,
      };
    }
  }

  let contextBlock = `CAMPAIGN CONTEXT:\n`;
  if (campaignContext) {
    contextBlock += `- Campaign: ${campaignContext.campaignName}\n`;
    contextBlock += `- Objective: ${campaignContext.objective}\n`;
    contextBlock += `- Location: ${campaignContext.location || "Not specified"}\n`;
    contextBlock += `- Platform: ${campaignContext.platform || "meta"}\n`;
  }
  contextBlock += `- Average Selling Price: $${asp || "Not specified"}\n`;
  contextBlock += `- Competitors Tracked: ${competitorUrls.length}\n`;

  if (businessData) {
    contextBlock += `\nBUSINESS PROFILE:\n`;
    contextBlock += `- Business Type: ${businessData.businessType || "Unknown"}\n`;
    contextBlock += `- Core Offer: ${businessData.coreOffer || "Unknown"}\n`;
    contextBlock += `- Price Range: ${businessData.priceRange || "Unknown"}\n`;
    contextBlock += `- Target Audience Age: ${businessData.targetAudienceAge || "Unknown"}\n`;
    contextBlock += `- Target Segment: ${businessData.targetAudienceSegment || "Unknown"}\n`;
    contextBlock += `- Monthly Budget: ${businessData.monthlyBudget || "Unknown"}\n`;
    contextBlock += `- Funnel Objective: ${businessData.funnelObjective || "Unknown"}\n`;
    contextBlock += `- Conversion Channel: ${businessData.primaryConversionChannel || "Unknown"}\n`;
    if (businessData.businessLocation) contextBlock += `- Location: ${businessData.businessLocation}\n`;
  }

  if (marketSignals) {
    contextBlock += `\nMARKET INTELLIGENCE:\n`;
    if (marketSignals.diagnosis) {
      contextBlock += `- Market Diagnosis: ${marketSignals.diagnosis}\n`;
    }
    if (marketSignals.threats?.length > 0) {
      contextBlock += `- Threat Signals:\n`;
      for (const t of marketSignals.threats.slice(0, 5)) {
        contextBlock += `  • ${t}\n`;
      }
    }
    if (marketSignals.opportunities?.length > 0) {
      contextBlock += `- Market Openings:\n`;
      for (const o of marketSignals.opportunities.slice(0, 5)) {
        contextBlock += `  • ${o}\n`;
      }
    }
    if (marketSignals.trajectory) {
      const traj = marketSignals.trajectory;
      contextBlock += `- Market Heating Index: ${traj.marketHeatingIndex ?? "N/A"}\n`;
      contextBlock += `- Narrative Convergence: ${traj.narrativeConvergenceScore ?? "N/A"}\n`;
    }
  }

  if (competitorUrls.length > 0) {
    contextBlock += `\nCOMPETITOR URLS:\n`;
    for (const url of competitorUrls.slice(0, 10)) {
      contextBlock += `- ${url}\n`;
    }
  }

  let engineOutputBlock = "";
  try {
    engineOutputBlock = await loadEngineOutputs(blueprint.accountId || "default", resolvedCampaignId);
    if (engineOutputBlock) {
      contextBlock += `\nENGINE PIPELINE OUTPUTS (use as PRIMARY data source for blueprint fields):\n${engineOutputBlock}\n`;
      console.log(`[StrategicCore] Engine outputs loaded for blueprint: ${engineOutputBlock.split('\n').filter((l: string) => l.endsWith(':')).length} engines found`);
    } else {
      console.log(`[StrategicCore] No engine outputs available — blueprint will use business data and MI only`);
    }
  } catch (err: any) {
    console.warn(`[StrategicCore] Failed to load engine outputs: ${err.message}`);
  }

  let rawBlueprint: any = null;
  let extractionFallbackUsed = false;
  let parseFailedReason: string | null = null;

  try {
    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: CREATIVE_BLUEPRINT_PROMPT },
        { role: "user", content: `Generate a Creative Blueprint based on this strategic data:\n\n${contextBlock}` },
      ],
      max_tokens: 2000,
      accountId: blueprint.accountId || "default",
      endpoint: "strategic-creative-blueprint",
    });

    const rawText = typeof response === "string" ? response : response?.choices?.[0]?.message?.content || "";
    const cleaned = cleanJsonString(rawText);
    rawBlueprint = JSON.parse(cleaned);
  } catch (err: any) {
    console.error("[StrategicCore] Creative blueprint generation attempt 1 failed:", err.message);

    try {
      const retryResponse = await aiChat({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: CREATIVE_BLUEPRINT_PROMPT + "\n\nPREVIOUS ATTEMPT FAILED. Return ONLY a valid JSON object. No markdown. No comments." },
          { role: "user", content: `Generate a Creative Blueprint:\n\n${contextBlock}` },
        ],
        max_tokens: 2000,
        accountId: blueprint.accountId || "default",
        endpoint: "strategic-creative-blueprint-retry",
      });

      const retryText = typeof retryResponse === "string" ? retryResponse : retryResponse?.choices?.[0]?.message?.content || "";
      const cleaned = cleanJsonString(retryText);
      rawBlueprint = JSON.parse(cleaned);
    } catch (retryErr: any) {
      console.error("[StrategicCore] Creative blueprint generation attempt 2 failed:", retryErr.message);
    }
  }

  if (!rawBlueprint) {
    extractionFallbackUsed = true;
    parseFailedReason = "AI_GENERATION_FAILED";
    console.warn(`[StrategicCore] Creative blueprint fallback triggered: ${parseFailedReason}`);
    rawBlueprint = {};
  }

  const draftBlueprint = normalizeExtraction(rawBlueprint);

  const allInsufficient = ["detectedOffer", "detectedPositioning", "detectedCTA", "detectedAudienceGuess", "detectedFunnelStage"].every(
    f => draftBlueprint[f]?.value === "INSUFFICIENT_DATA"
  );
  if (allInsufficient && !extractionFallbackUsed) {
    extractionFallbackUsed = true;
    parseFailedReason = "EMPTY_FIELDS";
  }

  draftBlueprint.extractionFallbackUsed = extractionFallbackUsed;
  draftBlueprint.parseFailedReason = parseFailedReason;
  draftBlueprint.generationSource = "AI_STRATEGY";

  const finalStatus = extractionFallbackUsed ? "EXTRACTION_FALLBACK" : "EXTRACTION_COMPLETE";

  await db.update(strategicBlueprints)
    .set({
      status: finalStatus,
      creativeMediaType: "ai_generated",
      draftBlueprint: JSON.stringify(draftBlueprint),
      creativeAnalysis: JSON.stringify(draftBlueprint),
      confirmedBlueprint: null,
      marketMap: null,
      validationResult: null,
      orchestratorPlan: null,
      analysisCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(strategicBlueprints.id, blueprintId));

  await logAuditEvent({
    accountId: blueprint.accountId,
    campaignId: blueprint.campaignId || undefined,
    blueprintId,
    blueprintVersion: blueprint.blueprintVersion,
    event: extractionFallbackUsed ? "CREATIVE_BLUEPRINT_FALLBACK" : "CREATIVE_BLUEPRINT_GENERATED",
    details: {
      source: "AI_STRATEGY",
      allInsufficient,
      extractionFallbackUsed,
      parseFailedReason,
      hasMarketSignals: !!marketSignals,
      hasBusinessData: !!businessData,
      hasEngineOutputs: !!engineOutputBlock,
    },
  });

  return {
    success: true,
    blueprintId,
    blueprintVersion: blueprint.blueprintVersion,
    status: finalStatus,
    draftBlueprint,
    extractionFallbackUsed,
    parseFailedReason,
    _meta: {
      source: "AI_STRATEGY",
      allFieldsInsufficient: allInsufficient,
      hasMarketSignals: !!marketSignals,
      hasBusinessData: !!businessData,
      hasEngineOutputs: !!engineOutputBlock,
      engineOutputSections: engineOutputBlock ? engineOutputBlock.split('\n').filter((l: string) => l.endsWith(':')).map((l: string) => l.replace(':', '').trim()) : [],
    },
  };
}

export function registerExtractionRoutes(app: Express) {
  app.post("/api/strategic/generate-creative-blueprint", async (req: Request, res: Response) => {
    try {
      const { blueprintId } = req.body;

      if (!blueprintId) {
        return res.status(400).json({ error: "blueprintId is required" });
      }

      const result = await generateBlueprintForId(blueprintId);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (error: any) {
      console.error("[StrategicCore] Creative blueprint generation error:", error.message);
      res.status(500).json({ error: "Failed to generate creative blueprint. Please try again." });
    }
  });
}
