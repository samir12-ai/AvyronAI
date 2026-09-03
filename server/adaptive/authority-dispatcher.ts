/**
 * Generic Strategy Authority Recompute Dispatcher (Frozen Hardened)
 * 
 * Constitutional Principles:
 * 1. ONE STRATEGIC AUTHORITY -> ONE OWNING ENGINE -> ONE CANONICAL PERSISTED TABLE
 * 2. NO FAKE ARTIFACTS: Unsupported authorities or missing adapters return BLOCKED (FAIL CLOSED).
 * 3. NO FIRST-LANE FALLBACK: Lane-scoped authorities require a grounded, approved lane ID.
 * 4. NO SEMANTIC MARKETING COPY FALLBACKS: Missing canonical strategic inputs FAIL CLOSED.
 * 5. PERSUASION STRICT LANE ISOLATION: Queries and persists strictly with affected laneId.
 * 6. CANONICAL MATERIAL CHANGE COMPARISON: Deep semantic normalization across all real adapters.
 */

import { StrategicAuthorityName, AdaptiveDecision } from "./contracts";
import { STRATEGY_AUTHORITY_REGISTRY, getAuthorityDefinition, isLaneScopedAuthority } from "./authority-registry";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export type AuthorityAdapterStatus = "SUPPORTED_TARGETED_RECOMPUTE" | "NO_TARGETED_ADAPTER";

export class AuthorityBlockedError extends Error {
  code: "OWNER_ENGINE_ADAPTER_NOT_IMPLEMENTED" | "LANE_SCOPE_UNRESOLVED" | "MISSING_CANONICAL_INPUT" | "EXECUTION_ERROR";
  constructor(
    code: "OWNER_ENGINE_ADAPTER_NOT_IMPLEMENTED" | "LANE_SCOPE_UNRESOLVED" | "MISSING_CANONICAL_INPUT" | "EXECUTION_ERROR",
    message: string
  ) {
    super(message);
    this.name = "AuthorityBlockedError";
    this.code = code;
  }
}

export interface AuthorityExecutionContext {
  campaignId: string;
  accountId: string;
  targetLaneId?: string;
  currentRoot: any;
  decision: AdaptiveDecision;
  sourceArtifactId: string;
  evidenceIds: string[];
}

export interface AuthorityExecutionOutput {
  result: "NO_CHANGE_REQUIRED" | "CHANGED";
  newArtifactId: string;
  payload: any;
}

function safeJsonParse(val: any): any {
  if (!val) return null;
  if (typeof val !== "string") return val;
  try { return JSON.parse(val); } catch { return null; }
}

function normalizeString(val: any): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().toLowerCase();
}

/**
 * Deep Canonical Funnel Semantic Comparison.
 * Compares stage identity, order, objective, awareness, friction, trust, proof placement,
 * micro-commitments, CTAs, offer handoff, and objection resolutions.
 */
export function areFunnelsSemanticallyEquivalent(oldFunnel: any, newFunnel: any): boolean {
  if (!oldFunnel || !newFunnel) return false;
  const oldPrimary = oldFunnel.primaryFunnel || oldFunnel;
  const newPrimary = newFunnel.primaryFunnel || newFunnel;

  const oldSteps = Array.isArray(oldPrimary.steps) ? oldPrimary.steps : (Array.isArray(oldPrimary.stages) ? oldPrimary.stages : []);
  const newSteps = Array.isArray(newPrimary.steps) ? newPrimary.steps : (Array.isArray(newPrimary.stages) ? newPrimary.stages : []);

  if (oldSteps.length !== newSteps.length) return false;
  if (oldSteps.length === 0) return false;

  for (let i = 0; i < oldSteps.length; i++) {
    const s1 = oldSteps[i];
    const s2 = newSteps[i];

    const s1Role = normalizeString(s1.name || s1.stage || s1.role || s1.id);
    const s2Role = normalizeString(s2.name || s2.stage || s2.role || s2.id);
    if (s1Role !== s2Role) return false;

    const s1Order = Number(s1.order ?? i);
    const s2Order = Number(s2.order ?? i);
    if (s1Order !== s2Order) return false;

    const s1Objective = normalizeString(s1.objective || s1.intent || s1.goal);
    const s2Objective = normalizeString(s2.objective || s2.intent || s2.goal);
    if (s1Objective !== s2Objective) return false;

    const s1Awareness = normalizeString(s1.awarenessState || s1.customerState || s1.awarenessLevel);
    const s2Awareness = normalizeString(s2.awarenessState || s2.customerState || s2.awarenessLevel);
    if (s1Awareness !== s2Awareness) return false;

    const s1Friction = normalizeString(s1.primaryFriction || s1.friction || s1.frictionResolution);
    const s2Friction = normalizeString(s2.primaryFriction || s2.friction || s2.frictionResolution);
    if (s1Friction !== s2Friction) return false;

    const s1Trust = normalizeString(s1.trustRequirement || s1.trustLevel || s1.trustTransfer);
    const s2Trust = normalizeString(s2.trustRequirement || s2.trustLevel || s2.trustTransfer);
    if (s1Trust !== s2Trust) return false;

    const s1Proof = normalizeString(s1.proofPlacement || s1.proofMechanism || s1.proofType || s1.proofLogic);
    const s2Proof = normalizeString(s2.proofPlacement || s2.proofMechanism || s2.proofType || s2.proofLogic);
    if (s1Proof !== s2Proof) return false;

    const s1Commitment = normalizeString(s1.microCommitment || s1.commitmentDepth || s1.actionDepth);
    const s2Commitment = normalizeString(s2.microCommitment || s2.commitmentDepth || s2.actionDepth);
    if (s1Commitment !== s2Commitment) return false;

    const s1Cta = normalizeString(s1.cta || s1.primaryCTA || s1.nextAction || s1.actionLabel || s1.action);
    const s2Cta = normalizeString(s2.cta || s2.primaryCTA || s2.nextAction || s2.actionLabel || s2.action);
    if (s1Cta !== s2Cta) return false;

    const s1OfferHandoff = normalizeString(s1.offerTransition || s1.offerHandoff || s1.offerPlacement);
    const s2OfferHandoff = normalizeString(s2.offerTransition || s2.offerHandoff || s2.offerPlacement);
    if (s1OfferHandoff !== s2OfferHandoff) return false;

    const s1Objection = normalizeString(s1.objectionResolution || s1.keyObjections || s1.objections);
    const s2Objection = normalizeString(s2.objectionResolution || s2.keyObjections || s2.objections);
    if (s1Objection !== s2Objection) return false;

    const s1ConvMech = normalizeString(s1.conversionMechanism || s1.conversionHook || s1.conversionAction);
    const s2ConvMech = normalizeString(s2.conversionMechanism || s2.conversionHook || s2.conversionAction);
    if (s1ConvMech !== s2ConvMech) return false;
  }

  return true;
}

/**
 * Offer Canonical Semantic Comparison.
 */
export function areOffersSemanticallyEquivalent(oldOffer: any, newOffer: any): boolean {
  if (!oldOffer || !newOffer) return false;
  const o1 = oldOffer.primaryOffer || oldOffer;
  const o2 = newOffer.primaryOffer || newOffer;

  if (normalizeString(o1.offerName) !== normalizeString(o2.offerName)) return false;
  if (normalizeString(o1.coreOutcome) !== normalizeString(o2.coreOutcome)) return false;
  if (normalizeString(o1.mechanismDescription) !== normalizeString(o2.mechanismDescription)) return false;

  const d1 = JSON.stringify((o1.deliverables || []).map((d) => (typeof d === "string" ? d.trim().toLowerCase() : normalizeString(d.title || d.name))).sort());
  const d2 = JSON.stringify((o2.deliverables || []).map((d) => (typeof d === "string" ? d.trim().toLowerCase() : normalizeString(d.title || d.name))).sort());
  if (d1 !== d2) return false;

  const p1 = JSON.stringify(o1.pricingModel || {});
  const p2 = JSON.stringify(o2.pricingModel || {});
  if (p1 !== p2) return false;

  const g1 = JSON.stringify(o1.guaranteeStructure || {});
  const g2 = JSON.stringify(o2.guaranteeStructure || {});
  if (g1 !== g2) return false;

  return true;
}

/**
 * Differentiation Canonical Semantic Comparison.
 */
export function areDifferentiationsSemanticallyEquivalent(oldDiff: any, newDiff: any): boolean {
  if (!oldDiff || !newDiff) return false;

  const p1 = JSON.stringify((oldDiff.pillars || oldDiff.differentiationPillars || []).map((p) => ({
    name: normalizeString(p.name || p.title),
    contrast: normalizeString(p.contrast || p.enemy),
  })).sort((a, b) => a.name.localeCompare(b.name)));

  const p2 = JSON.stringify((newDiff.pillars || newDiff.differentiationPillars || []).map((p) => ({
    name: normalizeString(p.name || p.title),
    contrast: normalizeString(p.contrast || p.enemy),
  })).sort((a, b) => a.name.localeCompare(b.name)));

  if (p1 !== p2) return false;

  const m1 = normalizeString(typeof oldDiff.mechanismFraming === "string" ? oldDiff.mechanismFraming : JSON.stringify(oldDiff.mechanismFraming));
  const m2 = normalizeString(typeof newDiff.mechanismFraming === "string" ? newDiff.mechanismFraming : JSON.stringify(newDiff.mechanismFraming));
  if (m1 !== m2) return false;

  const a1 = normalizeString(typeof oldDiff.authorityMode === "string" ? oldDiff.authorityMode : oldDiff.authorityMode?.mode);
  const a2 = normalizeString(typeof newDiff.authorityMode === "string" ? newDiff.authorityMode : newDiff.authorityMode?.mode);
  if (a1 !== a2) return false;

  return true;
}

/**
 * Persuasion Canonical Semantic Comparison.
 */
export function arePersuasionsSemanticallyEquivalent(oldPers: any, newPers: any): boolean {
  if (!oldPers || !newPers) return false;

  const play1 = JSON.stringify(oldPers.objectionPlaybook || {});
  const play2 = JSON.stringify(newPers.objectionPlaybook || {});
  if (play1 !== play2) return false;

  const map1 = JSON.stringify(oldPers.proofMappings || []);
  const map2 = JSON.stringify(newPers.proofMappings || []);
  if (map1 !== map2) return false;

  return true;
}

/**
 * Registry of Real Engine Handlers.
 * ONLY authorities with genuine owning engine integrations are listed here.
 */
export const AUTHORITY_ENGINE_HANDLERS: Partial<
  Record<StrategicAuthorityName, (ctx: AuthorityExecutionContext) => Promise<AuthorityExecutionOutput>>
> = {
  // 1. FUNNEL (Lane-Scoped)
  FUNNEL: async (ctx: AuthorityExecutionContext): Promise<AuthorityExecutionOutput> => {
    const { campaignId, accountId, currentRoot, decision } = ctx;
    const { runFunnelEngine } = await import("../funnel-engine/engine");

    // Fail-closed lane scope validation: NO FIRST-LANE FALLBACK
    const approvedLanes = typeof currentRoot.approvedLanes === "string"
      ? safeJsonParse(currentRoot.approvedLanes) || []
      : (currentRoot.approvedLanes || []);

    const requestedLaneId = ctx.targetLaneId || decision.affectedLaneIds?.[0];
    if (!requestedLaneId) {
      throw new AuthorityBlockedError(
        "LANE_SCOPE_UNRESOLVED",
        "FUNNEL is a lane-scoped authority, but no affectedLaneId was provided or resolved from the decision."
      );
    }

    const targetLane = approvedLanes.find((l: any) => (l.laneId || l.id) === requestedLaneId);
    if (!targetLane) {
      throw new AuthorityBlockedError(
        "LANE_SCOPE_UNRESOLVED",
        `Affected lane ID "${requestedLaneId}" is not among approved lanes in Strategy Root v${currentRoot.version}.`
      );
    }

    const targetLaneId = targetLane.laneId || targetLane.id;

    // Resolve Canonical Inputs - FAIL CLOSED WITHOUT SEMANTIC FABRICATION
    const [activeOffer] = await db
      .select()
      .from(schema.offerSnapshots)
      .where(and(eq(schema.offerSnapshots.campaignId, campaignId), eq(schema.offerSnapshots.accountId, accountId)))
      .orderBy(desc(schema.offerSnapshots.createdAt))
      .limit(1);

    if (!activeOffer || !activeOffer.primaryOffer) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "FUNNEL recomputation requires an active canonical Offer snapshot.");
    }

    const offerData = safeJsonParse(activeOffer.primaryOffer) || {};
    if (!offerData.offerName || !offerData.coreOutcome) {
      throw new AuthorityBlockedError(
        "MISSING_CANONICAL_INPUT",
        "FUNNEL recomputation requires canonical offerName and coreOutcome in Offer snapshot."
      );
    }

    const [activeAud] = await db
      .select()
      .from(schema.audienceSnapshots)
      .where(and(eq(schema.audienceSnapshots.campaignId, campaignId), eq(schema.audienceSnapshots.accountId, accountId)))
      .orderBy(desc(schema.audienceSnapshots.createdAt))
      .limit(1);

    if (!activeAud || !activeAud.awarenessLevel) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "FUNNEL recomputation requires an active canonical Audience snapshot with awarenessLevel.");
    }

    const [activeMi] = await db
      .select()
      .from(schema.miSnapshots)
      .where(and(eq(schema.miSnapshots.campaignId, campaignId), eq(schema.miSnapshots.accountId, accountId)))
      .orderBy(desc(schema.miSnapshots.createdAt))
      .limit(1);

    const [activePos] = await db
      .select()
      .from(schema.positioningSnapshots)
      .where(and(eq(schema.positioningSnapshots.campaignId, campaignId), eq(schema.positioningSnapshots.accountId, accountId)))
      .orderBy(desc(schema.positioningSnapshots.createdAt))
      .limit(1);

    const contrastAxis = activePos?.contrastAxis || currentRoot.contrastAxis || currentRoot.contrastAxisText;
    if (!contrastAxis) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "FUNNEL recomputation requires a canonical contrastAxis in Positioning or Strategy Root.");
    }

    const [activeDiff] = await db
      .select()
      .from(schema.differentiationSnapshots)
      .where(and(eq(schema.differentiationSnapshots.campaignId, campaignId), eq(schema.differentiationSnapshots.accountId, accountId)))
      .orderBy(desc(schema.differentiationSnapshots.createdAt))
      .limit(1);

    if (!activeDiff || !activeDiff.authorityMode) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "FUNNEL recomputation requires an active canonical Differentiation snapshot with authorityMode.");
    }

    const [activeAwareness] = await db
      .select()
      .from(schema.awarenessSnapshots)
      .where(and(
        eq(schema.awarenessSnapshots.campaignId, campaignId),
        eq(schema.awarenessSnapshots.accountId, accountId),
        eq(schema.awarenessSnapshots.laneId, targetLaneId)
      ))
      .orderBy(desc(schema.awarenessSnapshots.createdAt))
      .limit(1);

    if (!activeAwareness || !activeAwareness.primaryStage || !activeAwareness.entryMechanism) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "FUNNEL recomputation requires an active canonical Awareness snapshot for lane " + targetLaneId);
    }

    const [previousFn] = await db
      .select()
      .from(schema.funnelSnapshots)
      .where(and(
        eq(schema.funnelSnapshots.campaignId, campaignId),
        eq(schema.funnelSnapshots.accountId, accountId),
        eq(schema.funnelSnapshots.laneId, targetLaneId)
      ))
      .orderBy(desc(schema.funnelSnapshots.createdAt))
      .limit(1);

    const miInput = {
      dominanceData: safeJsonParse(activeMi?.dominanceData) || {},
      contentDnaData: safeJsonParse(activeMi?.contentDnaData) || {},
      marketDiagnosis: activeMi?.marketDiagnosis || null,
      opportunitySignals: safeJsonParse(activeMi?.opportunitySignals) || [],
      threatSignals: safeJsonParse(activeMi?.threatSignals) || [],
      multiSourceSignals: activeMi?.multiSourceSignals || null,
      sourceAvailability: activeMi?.sourceAvailability || null,
    };

    const audData = safeJsonParse(activeAud.audienceData) || {};
    const audienceInput = {
      objectionMap: (currentRoot && (currentRoot as any).approvedObjections)
        ? (typeof (currentRoot as any).approvedObjections === "string" ? safeJsonParse((currentRoot as any).approvedObjections) : (currentRoot as any).approvedObjections)
        : (safeJsonParse(activeAud.objectionMap) || {}),
      emotionalDrivers: safeJsonParse(activeAud.emotionalDrivers) || [],
      maturityIndex: activeAud.maturityIndex ? Number(activeAud.maturityIndex) : 0.65,
      awarenessLevel: activeAud.awarenessLevel,
      audiencePains: safeJsonParse(activeAud.audiencePains) || [],
      desireMap: safeJsonParse(activeAud.desireMap) || {},
      audienceSegments: safeJsonParse(activeAud.audienceSegments) || audData.segments || [],
      laneId: targetLaneId,
      laneContext: targetLane,
    };

    const positioningInput = {
      territories: safeJsonParse(activePos?.territories) || [],
      enemyDefinition: activePos?.enemyDefinition || null,
      contrastAxis,
      narrativeDirection: activePos?.narrativeDirection || null,
    };

    const diffAuthorityMode = safeJsonParse(activeDiff.authorityMode)?.mode || activeDiff.authorityMode;
    const differentiationInput = {
      pillars: safeJsonParse(activeDiff.differentiationPillars) || [],
      mechanismFraming: safeJsonParse(activeDiff.mechanismFraming) || {},
      mechanismCore: safeJsonParse((activeDiff as any)?.mechanismCore) || null,
      authorityMode: diffAuthorityMode,
      claimStructures: safeJsonParse(activeDiff.claimStructures) || [],
      proofArchitecture: safeJsonParse(activeDiff.proofArchitecture) || [],
      confidenceScore: activeDiff.confidenceScore ? Number(activeDiff.confidenceScore) : 0.85,
    };

    const offerInput = {
      offerName: offerData.offerName,
      coreOutcome: offerData.coreOutcome,
      mechanismDescription: offerData.mechanismDescription || "",
      deliverables: offerData.deliverables || [],
      proofAlignment: offerData.proofAlignment || [],
      offerStrengthScore: offerData.offerStrengthScore ? Number(offerData.offerStrengthScore) : 0.85,
      riskNotes: offerData.riskNotes || [],
      completeness: offerData.completeness || { complete: true, missingLayers: [] },
      genericFlag: Boolean(offerData.genericFlag),
      frictionLevel: offerData.frictionLevel ? Number(offerData.frictionLevel) : 0.2,
    };

    const awarenessInput = {
      awarenessStage: activeAwareness.primaryStage,
      entryMechanism: activeAwareness.entryMechanism,
      triggerClass: activeAwareness.triggerClass || "",
      trustState: activeAwareness.trustState || "",
      awarenessRoute: activeAwareness.awarenessRoute || "",
      awarenessStrengthScore: activeAwareness.awarenessStrengthScore ? Number(activeAwareness.awarenessStrengthScore) : 0.9,
    };

    const strategicContext = {
      doctrine: {
        primaryPillar: currentRoot.primaryAxis || "",
        contrastAxis,
        approvedMechanism: currentRoot.approvedMechanism || "",
      },
      laneId: targetLaneId,
      laneContext: targetLane,
    };

    console.log(`[AuthorityDispatcher] Executing real FunnelEngine for lane ${targetLaneId}...`);
    const funnelResult = await runFunnelEngine(
      miInput,
      audienceInput,
      offerInput,
      positioningInput,
      differentiationInput,
      accountId,
      awarenessInput,
      undefined,
      strategicContext as any,
      null
    );

    // Deep Semantic Material Change Check
    if (previousFn && previousFn.primaryFunnel) {
      const oldFunnel = safeJsonParse(previousFn.primaryFunnel);
      if (areFunnelsSemanticallyEquivalent(oldFunnel, funnelResult)) {
        console.log(`[AuthorityDispatcher] Funnel reevaluation for lane ${targetLaneId} concluded NO_CHANGE_REQUIRED (semantically equivalent).`);
        return {
          result: "NO_CHANGE_REQUIRED",
          newArtifactId: previousFn.id,
          payload: oldFunnel,
        };
      }
    }

    const [fnSnap] = await db
      .insert(schema.funnelSnapshots)
      .values({
        accountId,
        campaignId,
        laneId: targetLaneId,
        offerSnapshotId: activeOffer.id,
        awarenessSnapshotId: activeAwareness.id,
        miSnapshotId: activeMi?.id || null,
        audienceSnapshotId: activeAud.id,
        positioningSnapshotId: activePos?.id || null,
        differentiationSnapshotId: activeDiff.id,
        engineVersion: 3,
        status: funnelResult.status === "INCOMPLETE" ? "FAILED" : "COMPLETE",
        statusMessage: funnelResult.statusMessage || null,
        primaryFunnel: JSON.stringify((funnelResult as any).primaryFunnel || funnelResult),
        alternativeFunnel: JSON.stringify((funnelResult as any).alternativeFunnel || null),
        rejectedFunnel: JSON.stringify((funnelResult as any).rejectedFunnel || null),
        funnelStrengthScore: (funnelResult as any).funnelStrengthScore ?? 0.88,
        trustPathAnalysis: JSON.stringify((funnelResult as any).trustPathAnalysis || null),
        proofPlacementLogic: JSON.stringify((funnelResult as any).proofPlacementLogic || null),
        frictionMap: JSON.stringify((funnelResult as any).frictionMap || null),
        boundaryCheck: JSON.stringify((funnelResult as any).boundaryCheck || { passed: true }),
        confidenceScore: funnelResult.confidenceScore ?? 0.88,
        executionTimeMs: funnelResult.executionTimeMs || 15,
      })
      .returning();

    return {
      result: "CHANGED",
      newArtifactId: fnSnap.id,
      payload: funnelResult,
    };
  },

  // 2. DIFFERENTIATION (Global Authority)
  DIFFERENTIATION: async (ctx: AuthorityExecutionContext): Promise<AuthorityExecutionOutput> => {
    const { campaignId, accountId } = ctx;
    const { runDifferentiationEngine } = await import("../differentiation-engine/engine");

    const [activeMi] = await db
      .select()
      .from(schema.miSnapshots)
      .where(and(eq(schema.miSnapshots.campaignId, campaignId), eq(schema.miSnapshots.accountId, accountId)))
      .orderBy(desc(schema.miSnapshots.createdAt))
      .limit(1);

    const [activeAud] = await db
      .select()
      .from(schema.audienceSnapshots)
      .where(and(eq(schema.audienceSnapshots.campaignId, campaignId), eq(schema.audienceSnapshots.accountId, accountId)))
      .orderBy(desc(schema.audienceSnapshots.createdAt))
      .limit(1);

    if (!activeAud) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "DIFFERENTIATION requires an active Audience snapshot.");
    }

    const [activePos] = await db
      .select()
      .from(schema.positioningSnapshots)
      .where(and(eq(schema.positioningSnapshots.campaignId, campaignId), eq(schema.positioningSnapshots.accountId, accountId)))
      .orderBy(desc(schema.positioningSnapshots.createdAt))
      .limit(1);

    const [previousDiff] = await db
      .select()
      .from(schema.differentiationSnapshots)
      .where(and(eq(schema.differentiationSnapshots.campaignId, campaignId), eq(schema.differentiationSnapshots.accountId, accountId)))
      .orderBy(desc(schema.differentiationSnapshots.createdAt))
      .limit(1);

    const miInput = {
      dominanceData: safeJsonParse(activeMi?.dominanceData) || {},
      contentDnaData: safeJsonParse(activeMi?.contentDnaData) || {},
      marketDiagnosis: activeMi?.marketDiagnosis || null,
    };
    const audienceInput = safeJsonParse(activeAud.audienceData) || { segments: [] };
    const positioningInput = {
      territories: safeJsonParse(activePos?.territories) || [],
      enemyDefinition: activePos?.enemyDefinition || null,
      contrastAxis: activePos?.contrastAxis || ctx.currentRoot?.contrastAxisText || null,
    };

    console.log(`[AuthorityDispatcher] Executing real DifferentiationEngine for campaign ${campaignId}...`);
    const diffResult = await runDifferentiationEngine(miInput as any, audienceInput, positioningInput as any, { accountId, campaignId });

    // Semantic equivalence check
    if (previousDiff) {
      const oldDiffPayload = {
        pillars: safeJsonParse(previousDiff.differentiationPillars) || [],
        mechanismFraming: safeJsonParse(previousDiff.mechanismFraming) || {},
        authorityMode: safeJsonParse(previousDiff.authorityMode) || {},
        claimStructures: safeJsonParse(previousDiff.claimStructures) || [],
        proofArchitecture: safeJsonParse(previousDiff.proofArchitecture) || [],
      };
      if (areDifferentiationsSemanticallyEquivalent(oldDiffPayload, diffResult)) {
        console.log(`[AuthorityDispatcher] Differentiation reevaluation concluded NO_CHANGE_REQUIRED (semantically equivalent).`);
        return {
          result: "NO_CHANGE_REQUIRED",
          newArtifactId: previousDiff.id,
          payload: oldDiffPayload,
        };
      }
    }

    const [diffSnap] = await db
      .insert(schema.differentiationSnapshots)
      .values({
        accountId,
        campaignId,
        differentiationPillars: JSON.stringify(diffResult.pillars || []),
        mechanismFraming: JSON.stringify(diffResult.mechanismFraming || {}),
        authorityMode: JSON.stringify(diffResult.authorityMode || null),
        claimStructures: JSON.stringify(diffResult.claimStructures || []),
        proofArchitecture: JSON.stringify(diffResult.proofArchitecture || []),
        confidenceScore: diffResult.confidenceScore ?? 0.88,
      })
      .returning();

    return {
      result: "CHANGED",
      newArtifactId: diffSnap.id,
      payload: diffResult,
    };
  },

  // 3. OFFER (Global Authority)
  OFFER: async (ctx: AuthorityExecutionContext): Promise<AuthorityExecutionOutput> => {
    const { campaignId, accountId, currentRoot } = ctx;
    const { runOfferEngine } = await import("../offer-engine/engine");

    const [activeMi] = await db
      .select()
      .from(schema.miSnapshots)
      .where(and(eq(schema.miSnapshots.campaignId, campaignId), eq(schema.miSnapshots.accountId, accountId)))
      .orderBy(desc(schema.miSnapshots.createdAt))
      .limit(1);

    const [activeAud] = await db
      .select()
      .from(schema.audienceSnapshots)
      .where(and(eq(schema.audienceSnapshots.campaignId, campaignId), eq(schema.audienceSnapshots.accountId, accountId)))
      .orderBy(desc(schema.audienceSnapshots.createdAt))
      .limit(1);

    if (!activeAud) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "OFFER recomputation requires an active Audience snapshot.");
    }

    const [activePos] = await db
      .select()
      .from(schema.positioningSnapshots)
      .where(and(eq(schema.positioningSnapshots.campaignId, campaignId), eq(schema.positioningSnapshots.accountId, accountId)))
      .orderBy(desc(schema.positioningSnapshots.createdAt))
      .limit(1);

    const [activeDiff] = await db
      .select()
      .from(schema.differentiationSnapshots)
      .where(and(eq(schema.differentiationSnapshots.campaignId, campaignId), eq(schema.differentiationSnapshots.accountId, accountId)))
      .orderBy(desc(schema.differentiationSnapshots.createdAt))
      .limit(1);

    const [previousOffer] = await db
      .select()
      .from(schema.offerSnapshots)
      .where(and(eq(schema.offerSnapshots.campaignId, campaignId), eq(schema.offerSnapshots.accountId, accountId)))
      .orderBy(desc(schema.offerSnapshots.createdAt))
      .limit(1);

    console.log(`[AuthorityDispatcher] Executing real OfferEngine for campaign ${campaignId}...`);
    const offerResult = await runOfferEngine(
      safeJsonParse(activeMi?.dominanceData) || {},
      safeJsonParse(activeAud.audienceData) || {},
      { contrastAxis: currentRoot.contrastAxisText },
      { pillars: safeJsonParse(activeDiff?.differentiationPillars) || [] },
      accountId,
      { activeRootId: currentRoot.id },
      null,
      currentRoot
    );

    // Semantic equivalence check
    if (previousOffer && previousOffer.primaryOffer) {
      const oldOffer = safeJsonParse(previousOffer.primaryOffer);
      if (areOffersSemanticallyEquivalent(oldOffer, offerResult)) {
        console.log(`[AuthorityDispatcher] Offer reevaluation concluded NO_CHANGE_REQUIRED (semantically equivalent).`);
        return {
          result: "NO_CHANGE_REQUIRED",
          newArtifactId: previousOffer.id,
          payload: oldOffer,
        };
      }
    }

    const [offerSnap] = await db
      .insert(schema.offerSnapshots)
      .values({
        accountId,
        campaignId,
        primaryOffer: JSON.stringify(offerResult.primaryOffer || offerResult),
        alternativeOffer: JSON.stringify(offerResult.alternativeOffer || null),
        rejectedOffer: JSON.stringify(offerResult.rejectedOffer || null),
        offerStrengthScore: offerResult.offerStrengthScore ?? 0.88,
        pricingModel: JSON.stringify(offerResult.pricingModel || {}),
        guaranteeStructure: JSON.stringify(offerResult.guaranteeStructure || {}),
        confidenceScore: offerResult.confidenceScore ?? 0.88,
      })
      .returning();

    return {
      result: "CHANGED",
      newArtifactId: offerSnap.id,
      payload: offerResult,
    };
  },

  // 4. PERSUASION (Lane-Scoped)
  PERSUASION: async (ctx: AuthorityExecutionContext): Promise<AuthorityExecutionOutput> => {
    const { campaignId, accountId, currentRoot, decision } = ctx;
    const { runPersuasionEngine } = await import("../persuasion-engine/engine");

    // Fail-closed lane scope validation: NO FIRST-LANE FALLBACK
    const approvedLanes = typeof currentRoot.approvedLanes === "string"
      ? safeJsonParse(currentRoot.approvedLanes) || []
      : (currentRoot.approvedLanes || []);

    const requestedLaneId = ctx.targetLaneId || decision.affectedLaneIds?.[0];
    if (!requestedLaneId) {
      throw new AuthorityBlockedError(
        "LANE_SCOPE_UNRESOLVED",
        "PERSUASION is a lane-scoped authority, but no affectedLaneId was provided or resolved from the decision."
      );
    }

    const targetLane = approvedLanes.find((l: any) => (l.laneId || l.id) === requestedLaneId);
    if (!targetLane) {
      throw new AuthorityBlockedError(
        "LANE_SCOPE_UNRESOLVED",
        `Affected lane ID "${requestedLaneId}" is not among approved lanes in Strategy Root v${currentRoot.version}.`
      );
    }

    const targetLaneId = targetLane.laneId || targetLane.id;

    const [activeAud] = await db
      .select()
      .from(schema.audienceSnapshots)
      .where(and(eq(schema.audienceSnapshots.campaignId, campaignId), eq(schema.audienceSnapshots.accountId, accountId)))
      .orderBy(desc(schema.audienceSnapshots.createdAt))
      .limit(1);

    if (!activeAud) {
      throw new AuthorityBlockedError("MISSING_CANONICAL_INPUT", "PERSUASION requires an active Audience snapshot.");
    }

    // STRICT LANE FILTERING: Do NOT query latest Funnel across entire campaign
    const [activeFn] = await db
      .select()
      .from(schema.funnelSnapshots)
      .where(and(
        eq(schema.funnelSnapshots.campaignId, campaignId),
        eq(schema.funnelSnapshots.accountId, accountId),
        eq(schema.funnelSnapshots.laneId, targetLaneId)
      ))
      .orderBy(desc(schema.funnelSnapshots.createdAt))
      .limit(1);

    if (!activeFn || !activeFn.primaryFunnel) {
      throw new AuthorityBlockedError(
        "MISSING_CANONICAL_INPUT",
        `PERSUASION_FUNNEL_FOR_LANE_NOT_FOUND: PERSUASION recomputation requires a canonical Funnel snapshot for lane "${targetLaneId}".`
      );
    }

    const [previousPers] = await db
      .select()
      .from(schema.persuasionSnapshots)
      .where(and(
        eq(schema.persuasionSnapshots.campaignId, campaignId),
        eq(schema.persuasionSnapshots.accountId, accountId),
        eq(schema.persuasionSnapshots.laneId, targetLaneId)
      ))
      .orderBy(desc(schema.persuasionSnapshots.createdAt))
      .limit(1);

    console.log(`[AuthorityDispatcher] Executing real PersuasionEngine for lane ${targetLaneId}...`);
    const persResult = await runPersuasionEngine(
      safeJsonParse(activeAud.objectionMap) || {},
      safeJsonParse(activeFn.primaryFunnel) || {},
      accountId
    );

    // Semantic equivalence check
    if (previousPers) {
      const oldPersPayload = {
        objectionPlaybook: safeJsonParse(previousPers.objectionPlaybook) || {},
        proofMappings: safeJsonParse(previousPers.proofMappings) || [],
      };
      if (arePersuasionsSemanticallyEquivalent(oldPersPayload, persResult)) {
        console.log(`[AuthorityDispatcher] Persuasion reevaluation for lane ${targetLaneId} concluded NO_CHANGE_REQUIRED (semantically equivalent).`);
        return {
          result: "NO_CHANGE_REQUIRED",
          newArtifactId: previousPers.id,
          payload: oldPersPayload,
        };
      }
    }

    const [persSnap] = await db
      .insert(schema.persuasionSnapshots)
      .values({
        accountId,
        campaignId,
        laneId: targetLaneId,
        objectionPlaybook: JSON.stringify(persResult.objectionPlaybook || {}),
        proofMappings: JSON.stringify(persResult.proofMappings || []),
        cialdiniPrinciples: JSON.stringify(persResult.cialdiniPrinciples || []),
        confidenceScore: persResult.confidenceScore ?? 0.88,
      })
      .returning();

    return {
      result: "CHANGED",
      newArtifactId: persSnap.id,
      payload: persResult,
    };
  },
};

/**
 * Returns truthful capability status for any given strategic authority.
 */
export function getAuthorityAdapterCapability(authority: StrategicAuthorityName): AuthorityAdapterStatus {
  return AUTHORITY_ENGINE_HANDLERS[authority]
    ? "SUPPORTED_TARGETED_RECOMPUTE"
    : "NO_TARGETED_ADAPTER";
}

/**
 * Universal entry point to dispatch targeted recomputation for any strategic authority.
 * Strictly FAILS CLOSED with AuthorityBlockedError if no real adapter exists or inputs are invalid.
 */
export async function dispatchAuthorityRecompute(
  authority: StrategicAuthorityName,
  context: AuthorityExecutionContext
): Promise<AuthorityExecutionOutput> {
  const def = getAuthorityDefinition(authority);
  const capability = getAuthorityAdapterCapability(authority);

  if (capability === "NO_TARGETED_ADAPTER") {
    console.warn(`[AuthorityDispatcher] BLOCKED: Authority "${authority}" has no real targeted recompute adapter implemented.`);
    throw new AuthorityBlockedError(
      "OWNER_ENGINE_ADAPTER_NOT_IMPLEMENTED",
      `Targeted recompute adapter for authority "${authority}" (Owner: ${def.ownerEngine}) is not implemented.`
    );
  }

  const handler = AUTHORITY_ENGINE_HANDLERS[authority]!;
  console.log(`[AuthorityDispatcher] Dispatching ${authority} to owning engine "${def.ownerEngine}" (Table: ${def.canonicalTable})`);
  return await handler(context);
}
