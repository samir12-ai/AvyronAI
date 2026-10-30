import { db } from "../db";
import {
  audienceSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  mechanismSnapshots,
  miSnapshots,
  offerSnapshots,
  awarenessSnapshots,
  funnelSnapshots,
  persuasionSnapshots,
  integritySnapshots,
  strategyValidationSnapshots,
  strategicPainDecisions,
  targetAssessments,
  productAssessments,
  brandConfig,
  marketVoiceEvidence,
  channelSelectionSnapshots,
  budgetGovernorSnapshots,
  iterationSnapshots,
  strategyRoots,
} from "@shared/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { canonicalizeAudienceShape } from "../shared/strategy-root-assembler";
import { initializeSignalGovernance } from "../signal-governance/engine";
import {
  buildAudiencePainRegistry,
  attachTargetCoverageToPainRegistry,
  extractCanonicalSegmentPains,
  allowedUsesForClass,
  prohibitedUsesForClass,
  validateAudiencePainRegistry,
  computePainContentHash,
  isPositiveAppreciationSignal,
  decodeHtmlEntities,
  type AuthoritativeAudiencePain,
  type AudiencePainClass,
} from "../shared/audience-pain-registry";
import { loadCanonicalCustomerVoice, type CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";
import { assessDataReliability } from "../engine-hardening";
import { runLaneGrouper } from "../shared/lane-grouper";
import { buildResultFromSnapshot } from "../market-intelligence-v3/engine";
import { ENGINE_PRIORITY_ORDER, type EngineId, type EngineStepResult } from "./priority-matrix";
import type { EngineContext } from "./index";
import { mapPersuasionLaneStatus, deriveAggregatePersuasionStatus } from "../persuasion-engine/status";
import { getExecutionEligibleRoot, assertRootExecutionEligible } from "../shared/strategy-root";
import {
  areMiSnapshotsCompatibleSync,
  isDifferentiationSnapshotCompatibleSync,
  isPositioningSnapshotCompatibleSync,
  isAudienceSnapshotCompatible,
  validateBundleLineageCompatibility,
} from "../shared/dependency-contract";

export interface StaleEngineNotice {
  engineId: EngineId;
  snapshotId: string | null;
  reason: string;
}

export interface ResumeHydrationParams {
  resumeFromEngine?: string;
  scopedEngines?: string[];
  accountId: string;
  campaignId: string;
  jobId?: string;
  sourceJobId?: string;
  reusedSnapshotIds?: Partial<Record<EngineId, string>>;
  contextFingerprint?: string | null;
  offeringId?: string | null;
  offeringName?: string | null;
  targetMarket?: string | null;
  strategyRootId?: string;
  ctx: EngineContext;
}

export interface ResumeHydrationResult {
  hydrated: string[];
  gaps: string[];
  hydratedResults: Map<EngineId, EngineStepResult>;
  staleEngines?: StaleEngineNotice[];
}

export function matchResumeDecision(
  targetPain: { canonical?: string; claim?: string; statement?: string; contentHash?: string; painId?: string; claimId?: string; id?: string; productTruthRevision?: number; accountId?: string },
  rows: any[],
  currentJobId?: string,
  currentAudSnapId?: string,
  sourceJobId?: string,
  currentProductTruthRevision?: number,
  expectedAccountId?: string,
) {
  const pHash = targetPain.contentHash || computePainContentHash(targetPain.statement || targetPain.canonical || targetPain.claim || "");
  // Lineage Rule 1: Missing required target statement/hash cannot establish compatibility
  if (!pHash) {
    return undefined;
  }

  const targetPtRev = targetPain.productTruthRevision ?? currentProductTruthRevision;
  const targetAcc = targetPain.accountId ?? expectedAccountId;

  return rows.find((r: any) => {
    const payload = typeof r.payload === "string" ? (() => { try { return JSON.parse(r.payload); } catch { return null; } })() : r.payload;
    const rHash = r.painContentHash || payload?.painContentHash || (payload?.painClaim ? computePainContentHash(payload.painClaim) : (r.statement ? computePainContentHash(r.statement) : null));

    // Lineage Rule 2: Missing required candidate content lineage cannot establish compatibility
    if (!rHash) {
      return false;
    }

    // Lineage Rule 3: Conflicting content lineage (different statement) is strictly rejected
    if (rHash !== pHash) {
      return false;
    }

    // Lineage Rule 4: Version compatibility check
    // If target context has a required Product Truth revision, candidate MUST carry matching revision
    if (targetPtRev !== undefined) {
      const rPtRev = r.productTruthRevision ?? payload?.productTruthRevision;
      if (rPtRev === undefined || rPtRev !== targetPtRev) {
        return false;
      }
    }

    // Lineage Rule 5: Cross-tenant isolation check
    const rAcc = r.accountId || payload?.accountId;
    if (targetAcc && rAcc && rAcc !== targetAcc) {
      return false;
    }

    // Valid matching lineage across hash, revision, and tenant
    return true;
  });
}

/**
 * Hydrates all required upstream context from persisted database snapshots
 * before entering the orchestrator engine loop on resume or scoped rerun.
 *
 * Fail-closed: returns any missing upstream dependencies in `gaps`.
 */
export async function hydrateRequiredUpstreamForResume(
  params: ResumeHydrationParams,
): Promise<ResumeHydrationResult> {
  const { resumeFromEngine, scopedEngines, accountId, campaignId, ctx } = params;
  const hydrated: string[] = [];
  const gaps: string[] = [];
  const hydratedResults = new Map<EngineId, EngineStepResult>();
  const staleEngines: StaleEngineNotice[] = [];
  const miLookupMap = new Map<string, any>();

  const startIndex = resumeFromEngine
    ? ENGINE_PRIORITY_ORDER.findIndex(e => e.id === resumeFromEngine)
    : -1;

  const scopedStartIndex = scopedEngines?.length
    ? Math.min(
        ...scopedEngines
          .map(id => ENGINE_PRIORITY_ORDER.findIndex(e => e.id === id))
          .filter(i => i >= 0),
      )
    : -1;

  const effectiveStartIndex = scopedStartIndex >= 0
    ? scopedStartIndex
    : startIndex >= 0 ? startIndex : 0;

  if (effectiveStartIndex === 0 && !scopedEngines?.length) {
    return { hydrated, gaps, hydratedResults };
  }

  const upstreamEngines = new Set(
    ENGINE_PRIORITY_ORDER.slice(0, effectiveStartIndex).map(e => e.id),
  );

  console.log(
    `[ResumeHydration] START | effectiveStartIndex=${effectiveStartIndex} | resumeEngine=${resumeFromEngine || "none"} | upstreamCount=${upstreamEngines.size}`,
  );

  if (!ctx.inputHashes) ctx.inputHashes = {};
  if (!ctx.depthGateStatus) ctx.depthGateStatus = {};

  // -------------------------------------------------------------------------
  // 0. Strategy Root Resolution (authoritative root & approved lanes)
  // Only pre-load Strategy Root when resuming AFTER mechanism (effectiveStartIndex >= 6),
  // because resuming at or before mechanism will rebuild Strategy Root upon mechanism completion.
  // -------------------------------------------------------------------------
  if (!ctx.strategyRoot && effectiveStartIndex >= 6) {
    try {
      const rootIdToAssert = params.strategyRootId || (ctx as any)?.config?.strategyRootId;
      let root: any = null;
      if (rootIdToAssert) {
        const rootAssert = await assertRootExecutionEligible(rootIdToAssert, campaignId, accountId);
        if (rootAssert.eligible && rootAssert.root) {
          root = rootAssert.root;
        } else {
          console.warn(`[ResumeHydration] STRATEGY_ROOT_INELIGIBLE | rootId=${rootIdToAssert} | reasons=${rootAssert.reasons.join(", ")}`);
          gaps.push(`strategy_root:${rootAssert.reasons.join(";")}`);
        }
      } else {
        root = await getExecutionEligibleRoot(campaignId, accountId);
        if (!root && effectiveStartIndex >= 6) {
          console.warn(`[ResumeHydration] NO_ACTIVE_ROOT | Resume from downstream of mechanism requires an active strategy root`);
          gaps.push("strategy_root:no_active_root");
        }
      }

      if (root) {
        const rootLineage = await validateBundleLineageCompatibility({
          miSnapshotId: root.miSnapshotId,
          audienceSnapshotId: root.audienceSnapshotId,
          differentiationSnapshotId: root.differentiationSnapshotId,
          positioningSnapshotId: root.positioningSnapshotId,
          mechanismSnapshotId: root.mechanismSnapshotId,
        });
        if (!rootLineage.compatible) {
          console.warn(
            `[ResumeHydration] STRATEGY_ROOT_LINEAGE_STALE | rootId=${root.id} | mismatches=${rootLineage.mismatches.map(m => `${m.engine}:${m.reason}`).join("; ")}`,
          );
          if (root.approvedLanes && root.approvedLanes.length > 0) {
            ctx.strategicLanes = root.approvedLanes;
            ctx.approvedLanes = root.approvedLanes;
          }
          for (const m of rootLineage.mismatches) {
            if (!staleEngines.some(s => s.engineId === (m.engine as EngineId))) {
              staleEngines.push({
                engineId: m.engine as EngineId,
                snapshotId: m.snapshotId,
                reason: m.reason,
              });
            }
          }
        } else {
          ctx.strategyRoot = root;
          ctx.strategyRootId = root.id;
          if (root.approvedLanes && root.approvedLanes.length > 0) {
            ctx.strategicLanes = root.approvedLanes;
            ctx.approvedLanes = root.approvedLanes;
          }
          if (!upstreamEngines.has("audience") && root.approvedAudiencePains && root.approvedAudiencePains.length > 0) {
            ctx.painRegistry = root.approvedAudiencePains.filter(
              (p: any) => !isPositiveAppreciationSignal(`${p?.canonical || ""} ${p?.originalStatement || ""}`)
            );
            hydrated.push("pain_registry");
            console.log(`[ResumeHydration] HYDRATED | pain_registry from strategy_root size=${ctx.painRegistry.length}`);
          }
          hydrated.push("strategy_root");
          console.log(`[ResumeHydration] HYDRATED | strategy_root id=${root.id} lanes=${(root.approvedLanes || []).length}`);
        }
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | strategy_root: ${err.message}`);
      gaps.push("strategy_root");
    }
  }

  // -------------------------------------------------------------------------
  // 1. Market Intelligence (MI)
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("market_intelligence") && !ctx.mi) {
    try {
      // Resolve strategyRoot's or audience's pinned miSnapshotId first so upstream lineage stays aligned.
      // Never allow a stale Differentiation snapshot to override a newer active MI snapshot.
      let pinnedAudMiSnapshotId: string | null =
        (ctx.strategyRoot && (ctx.strategyRoot as any).miSnapshotId)
          ? String((ctx.strategyRoot as any).miSnapshotId)
          : null;
      if (!pinnedAudMiSnapshotId) {
        const activeRootForMi = await getExecutionEligibleRoot(campaignId, accountId);
        if (activeRootForMi?.miSnapshotId) {
          pinnedAudMiSnapshotId = String(activeRootForMi.miSnapshotId);
        }
      }
      if (!pinnedAudMiSnapshotId && upstreamEngines.has("audience")) {
        const [audCandidate] = await db.select().from(audienceSnapshots)
          .where(and(
            eq(audienceSnapshots.accountId, accountId),
            eq(audienceSnapshots.campaignId, campaignId),
          ))
          .orderBy(desc(audienceSnapshots.createdAt))
          .limit(1);
        if (audCandidate && (audCandidate as any).miSnapshotId) {
          pinnedAudMiSnapshotId = String((audCandidate as any).miSnapshotId);
        }
      }

      const explicitMiIds = Array.from(
        new Set(
          [params.reusedSnapshotIds?.market_intelligence, pinnedAudMiSnapshotId].filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          ),
        ),
      );
      const explicitMiRows =
        explicitMiIds.length > 0
          ? await db
              .select()
              .from(miSnapshots)
              .where(
                and(
                  eq(miSnapshots.accountId, accountId),
                  eq(miSnapshots.campaignId, campaignId),
                  inArray(miSnapshots.id, explicitMiIds),
                ),
              )
          : [];

      const miCandidatesRaw = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.accountId, accountId),
          eq(miSnapshots.campaignId, campaignId),
          inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(50);

      const seenMiIds = new Set<string>();
      const miCandidates: typeof miCandidatesRaw = [];
      for (const row of [...explicitMiRows, ...miCandidatesRaw]) {
        if (!seenMiIds.has(row.id)) {
          seenMiIds.add(row.id);
          miCandidates.push(row);
          miLookupMap.set(row.id, row);
        }
      }

      const nonPersistMi = miCandidates.filter(m => !String(m.jobId || "").startsWith("persist:"));

      const latestMi =
        (params.reusedSnapshotIds?.market_intelligence
          ? miCandidates.find(m => m.id === params.reusedSnapshotIds!.market_intelligence)
          : undefined) ||
        (pinnedAudMiSnapshotId
          ? miCandidates.find(m => m.id === pinnedAudMiSnapshotId)
          : undefined) ||
        (params.sourceJobId
          ? nonPersistMi.find(m => m.jobId === params.sourceJobId)
          : undefined) ||
        nonPersistMi[0] ||
        miCandidates[0];

      if (latestMi) {
        ctx.mi = {
          ...buildResultFromSnapshot(latestMi),
          overallConfidence: latestMi.overallConfidence ?? 0,
          signals: JSON.parse(latestMi.signalData?.toString() || "[]"),
          multiSourceSignals: latestMi.multiSourceSignals || "{}",
          snapshotId: latestMi.id,
        };
        ctx.miSnapshotId = latestMi.id;
        let telMi: any = {};
        if (typeof latestMi.telemetry === "string") {
          try { telMi = JSON.parse(latestMi.telemetry); } catch { telMi = {}; }
        }
        const miContentHash = typeof telMi.contentHash === "string" && telMi.contentHash.length > 0
          ? telMi.contentHash
          : (typeof latestMi.competitorHash === "string" ? latestMi.competitorHash : "reused_mi");
        if (miContentHash.length > 0) {
          ctx.inputHashes.mi = miContentHash;
        }
        hydrated.push("market_intelligence");
        hydratedResults.set("market_intelligence", {
          engineId: "market_intelligence",
          status: "SUCCESS",
          output: {
            ...ctx.mi,
            _provenance: {
              sourceJobId: latestMi.jobId,
              snapshotId: latestMi.id,
              engineVersion: (latestMi as any).engineVersion || 3,
              campaignId,
              accountId,
              offeringId: params.offeringId || null,
              offeringName: params.offeringName || null,
              targetMarket: params.targetMarket || null,
              contextFingerprint: params.contextFingerprint || null,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: latestMi.id,
        });
        console.log(`[ResumeHydration] HYDRATED | market_intelligence snapshot=${latestMi.id}`);
      } else {
        gaps.push("market_intelligence");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | market_intelligence: ${err.message}`);
      gaps.push("market_intelligence");
    }
  }

  // -------------------------------------------------------------------------
  // 1b. Market Voice Pipeline Output
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("market_voice") && !ctx.marketVoice) {
    try {
      const existingEvidence = await db
        .select()
        .from(marketVoiceEvidence)
        .where(and(
          eq(marketVoiceEvidence.accountId, accountId),
          eq(marketVoiceEvidence.campaignId, campaignId),
          inArray(marketVoiceEvidence.eligibilityVerdict, ["PRIMARY_ELIGIBLE", "ELIGIBLE"])
        ));

      if (existingEvidence.length > 0) {
        const approvedEvidenceIds = existingEvidence.map(e => e.id);
        const mvResult = {
          status: "COMPLETE",
          discoveryJobId: existingEvidence[0].discoveryJobId || undefined,
          intentsPlanned: 0,
          resultsFetched: 0,
          evidenceUnitsPersisted: existingEvidence.length,
          approvedEvidenceIds,
          confidenceScore: 0.9,
          dataReliability: { overallReliability: 0.9 },
          evidenceUnits: existingEvidence.map(e => ({
            evidenceId: e.id,
            verbatimText: e.verbatimText,
            sourceScope: e.sourceScope,
            marketScope: e.marketScope,
            platform: e.platform,
            url: e.externalUrl,
            persisted: true,
          })),
        };
        ctx.marketVoice = mvResult;
        ctx.marketVoiceJobId = existingEvidence[0].discoveryJobId || undefined;
        hydrated.push("market_voice");
        hydratedResults.set("market_voice", {
          engineId: "market_voice",
          status: "SUCCESS",
          output: {
            ...mvResult,
            _provenance: {
              sourceJobId: params.sourceJobId || existingEvidence[0].discoveryJobId || params.jobId || null,
              snapshotId: existingEvidence[0].discoveryJobId || `mv_${campaignId}`,
              engineVersion: 1,
              campaignId,
              accountId,
              offeringId: params.offeringId || null,
              offeringName: params.offeringName || null,
              targetMarket: params.targetMarket || null,
              contextFingerprint: params.contextFingerprint || null,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
        });
        console.log(`[ResumeHydration] HYDRATED | market_voice items=${existingEvidence.length}`);
      } else {
        gaps.push("market_voice");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | market_voice: ${err.message}`);
      gaps.push("market_voice");
    }
  }

  // -------------------------------------------------------------------------
  // 2. Audience Engine
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("audience") && !ctx.audience) {
    try {
      const audRows = await db.select().from(audienceSnapshots)
        .where(and(
          eq(audienceSnapshots.accountId, accountId),
          eq(audienceSnapshots.campaignId, campaignId),
        ))
        .orderBy(desc(audienceSnapshots.createdAt))
        .limit(10);

      for (const row of audRows) {
        const ssRaw = JSON.parse(
          row.structuredSignals ||
            '{"pain_clusters":[],"desire_clusters":[],"pattern_clusters":[],"root_causes":[],"psychological_drivers":[]}',
        );
        const ss = {
          pain_clusters: Array.isArray(ssRaw?.pain_clusters) ? ssRaw.pain_clusters : [],
          desire_clusters: Array.isArray(ssRaw?.desire_clusters) ? ssRaw.desire_clusters : [],
          pattern_clusters: Array.isArray(ssRaw?.pattern_clusters) ? ssRaw.pattern_clusters : [],
          root_causes: Array.isArray(ssRaw?.root_causes) ? ssRaw.root_causes : [],
          psychological_drivers: Array.isArray(ssRaw?.psychological_drivers) ? ssRaw.psychological_drivers : [],
        };
        const signalCount =
          ss.pain_clusters.length +
          ss.desire_clusters.length +
          ss.pattern_clusters.length +
          ss.root_causes.length +
          ss.psychological_drivers.length;

        if (signalCount > 0) {
          const cachedAudience = {
            ...row,
            audiencePains: JSON.parse(row.audiencePains || "[]"),
            desireMap: JSON.parse(row.desireMap || "[]"),
            objectionMap: JSON.parse(row.objectionMap || "[]"),
            transformationMap: JSON.parse(row.transformationMap || "[]"),
            emotionalDrivers: JSON.parse(row.emotionalDrivers || "[]"),
            audienceSegments: JSON.parse(row.audienceSegments || "[]"),
            segmentDensity: JSON.parse(row.segmentDensity || "[]"),
            awarenessLevel: JSON.parse(row.awarenessLevel || "{}"),
            maturityIndex: JSON.parse(row.maturityIndex || "{}"),
            intentDistribution: JSON.parse(row.audienceIntentDistribution || "{}"),
            structuredSignals: ss,
            inputSummary: JSON.parse(row.inputSummary || "{}"),
            targetCoverage:
              typeof row.targetCoverage === "string"
                ? JSON.parse(row.targetCoverage)
                : (row.targetCoverage || { status: "NOT_EVALUATED" }),
            snapshotId: row.id,
          };
          const confidenceScore = (typeof (row as any).confidence_score === "number" && !isNaN((row as any).confidence_score))
            ? (row as any).confidence_score
            : (cachedAudience.intentDistribution?.confidenceScore ?? 0.85);

          let dataReliability: any = null;
          if ((row as any).data_reliability) {
            try {
              dataReliability = typeof (row as any).data_reliability === "string"
                ? JSON.parse((row as any).data_reliability)
                : (row as any).data_reliability;
            } catch {
              dataReliability = null;
            }
          }
          if (!dataReliability || typeof dataReliability.overallReliability !== "number") {
            dataReliability = assessDataReliability(
              cachedAudience.inputSummary?.competitorsAnalyzed ?? 0,
              signalCount,
              false,
              false,
              true,
              0.5,
            );
          }

          cachedAudience.confidenceScore = confidenceScore;
          cachedAudience.dataReliability = dataReliability;
          ctx.audience = canonicalizeAudienceShape(cachedAudience);
          (ctx.audience as any).confidenceScore = confidenceScore;
          (ctx.audience as any).dataReliability = dataReliability;
          ctx.audienceSnapshotId = row.id;
          ctx.inputHashes.audience = (row as any).inputHash || row.id;

          const rawObjections = cachedAudience.objectionMap || [];
          const mappedObjections = (Array.isArray(rawObjections) ? rawObjections : []).map((o: any) => ({
            label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
            confidence: o.confidence ?? o.confidenceScore ?? 0.5,
            evidence: Array.isArray(o.evidence) ? o.evidence : [],
          }));
          ctx.sglState = initializeSignalGovernance(ss, mappedObjections);
          hydrated.push("audience");
          hydratedResults.set("audience", {
            engineId: "audience",
            status: "SUCCESS",
            output: {
              ...ctx.audience,
              confidenceScore,
              dataReliability,
              _provenance: {
                sourceJobId: row.jobId,
                snapshotId: row.id,
                campaignId,
                accountId,
                wasReused: true,
                isOfficialResume: true,
              },
            },
            durationMs: 0,
            snapshotId: row.id,
          });
          console.log(`[ResumeHydration] HYDRATED | audience snapshot=${row.id} signals=${signalCount} confidence=${confidenceScore}`);
          break;
        }
      }

      if (!ctx.audience) {
        gaps.push("audience");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | audience: ${err.message}`);
      gaps.push("audience");
    }
  }

  // -------------------------------------------------------------------------
  // 3. Pain Registry & Strategic Lanes (Required downstream by Mechanism, Strategy Root, Offer)
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("audience") && ctx.audience && (!ctx.painRegistry || !ctx.strategicLanes)) {
    try {
      const rawCanonicalPains = extractCanonicalSegmentPains((ctx.audience as any)?.audienceSegments);
      // Deduplicate segment pains by painId (first occurrence wins) to preserve uniqueness invariants
      const seenPainIds = new Set<string>();
      const canonicalSegmentPains: any[] = [];
      for (const p of rawCanonicalPains) {
        const id = p.painId || p.claimId;
        if (!seenPainIds.has(id)) {
          seenPainIds.add(id);
          canonicalSegmentPains.push(p);
        }
      }

      // Build canonicalEvidenceRegistry with competitor subject attribution from pinned customer voice
      const canonicalEvidenceRegistry = new Map<string, any>();
      try {
        const rawCustomerUnits = await loadCanonicalCustomerVoice(accountId, campaignId, {
          evidenceManifest: ctx.evidenceManifest,
        });
        const activeCustomerUnits = rawCustomerUnits.filter((u: any) => u.evidencePool !== "UNRESOLVED_EXCLUDED");
        const byCanonId = new Map<string, CustomerEvidenceUnit>();
        const byRawDbId = new Map<string, CustomerEvidenceUnit>();
        const byNormDecodedText = new Map<string, CustomerEvidenceUnit>();
        const byNormPrefix = new Map<string, CustomerEvidenceUnit>();
        for (const cu of activeCustomerUnits) {
          byCanonId.set(cu.evidenceId, cu);
          if (cu.rawEvidenceReference?.id) {
            byRawDbId.set(String(cu.rawEvidenceReference.id), cu);
          }
          const normText = decodeHtmlEntities(cu.text || "").toLowerCase().replace(/\s+/g, " ").trim();
          if (normText.length > 0 && !byNormDecodedText.has(normText)) {
            byNormDecodedText.set(normText, cu);
          }
          if (normText.length >= 40 && !byNormPrefix.has(normText.slice(0, 100))) {
            byNormPrefix.set(normText.slice(0, 100), cu);
          }
          canonicalEvidenceRegistry.set(cu.evidenceId, {
            canonicalEvidenceId: cu.evidenceId,
            origin: cu.origin,
            competitorId: cu.competitorId,
            competitorName: cu.competitorName,
            observedSubjectDomain: cu.observedSubjectDomain,
            observedSubjectName: cu.observedSubjectName,
            registryResolutionStatus: cu.registryResolutionStatus,
            offeringId: cu.offeringId,
            semanticScope: cu.semanticScope,
            transferability: cu.transferability,
            rawEvidenceReference: cu.rawEvidenceReference,
            label: cu.platform ? `${cu.platform}${cu.author ? ` - ${cu.author}` : ""}` : `Customer Evidence ${cu.evidenceId}`,
            detail: cu.text,
            verbatimText: cu.text,
            platform: cu.platform || "customer_review",
            url: cu.verificationProvenance?.sourceUrl,
            externalUrl: cu.verificationProvenance?.sourceUrl,
            author: cu.author,
            sourceActor: "CUSTOMER",
            actorType: "CUSTOMER",
            authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
          });
        }
        const evidencePool: any[] = [
          ...(Array.isArray(ctx.marketVoice?.evidenceUnits) ? ctx.marketVoice.evidenceUnits : []),
          ...(Array.isArray((ctx.audience as any)?.evidenceUnits) ? (ctx.audience as any).evidenceUnits : []),
          ...(Array.isArray((ctx.audience as any)?.inputSummary?.evidenceUnits) ? (ctx.audience as any).inputSummary.evidenceUnits : []),
        ];
        for (const ev of evidencePool) {
          const uid = ev.evidenceId || ev.id || ev.clusterId;
          if (uid && !canonicalEvidenceRegistry.has(uid)) {
            const rawDetail = ev.verbatimText || ev.detail || ev.text || (Array.isArray(ev.representativeEvidence) ? ev.representativeEvidence.join("; ") : "");
            const normDetail = decodeHtmlEntities(rawDetail).toLowerCase().replace(/\s+/g, " ").trim();
            const rawRefId = ev.rawEvidenceReference?.id || ev.dbId || ev.sourceId;
            const matchedCu =
              (ev.canonicalEvidenceId && byCanonId.get(ev.canonicalEvidenceId)) ||
              (String(uid).startsWith("cev_") && byCanonId.get(uid)) ||
              (rawRefId && byRawDbId.get(String(rawRefId))) ||
              (normDetail.length > 0 ? byNormDecodedText.get(normDetail) : undefined) ||
              (normDetail.length >= 40 ? byNormPrefix.get(normDetail.slice(0, 100)) : undefined);
            canonicalEvidenceRegistry.set(uid, {
              canonicalEvidenceId: ev.canonicalEvidenceId || matchedCu?.evidenceId || (String(uid).startsWith("cev_") ? String(uid) : undefined),
              origin: ev.origin || matchedCu?.origin,
              competitorId: ev.competitorId || matchedCu?.competitorId,
              competitorName: ev.competitorName || matchedCu?.competitorName,
              observedSubjectDomain: ev.observedSubjectDomain || matchedCu?.observedSubjectDomain,
              observedSubjectName: ev.observedSubjectName || matchedCu?.observedSubjectName,
              registryResolutionStatus: ev.registryResolutionStatus || matchedCu?.registryResolutionStatus,
              offeringId: ev.offeringId || matchedCu?.offeringId,
              semanticScope: ev.semanticScope || matchedCu?.semanticScope,
              transferability: ev.transferability || matchedCu?.transferability,
              rawEvidenceReference: ev.rawEvidenceReference || matchedCu?.rawEvidenceReference,
              label: ev.label || matchedCu?.platform || `Customer Evidence ${uid}`,
              detail: rawDetail,
              verbatimText: rawDetail,
              platform: ev.platform || matchedCu?.platform || "customer_review",
              url: ev.url || ev.externalUrl || matchedCu?.verificationProvenance?.sourceUrl,
              externalUrl: ev.url || ev.externalUrl || matchedCu?.verificationProvenance?.sourceUrl,
              author: ev.author || matchedCu?.author,
              sourceActor: "CUSTOMER",
              actorType: "CUSTOMER",
              authorityClass: "DIRECT_AUDIENCE_EVIDENCE",
            });
          }
        }
      } catch (evRegErr: any) {
        console.warn(`[ResumeHydration] Non-fatal customer voice registry warning: ${evRegErr?.message}`);
      }

      const deterministicRegistry = buildAudiencePainRegistry(
        canonicalSegmentPains,
        { accountId, audienceSnapshotId: ctx.audienceSnapshotId! },
        canonicalEvidenceRegistry.size > 0 ? canonicalEvidenceRegistry : undefined,
        (ctx.audience as any)?.audienceSegments,
      );

      const attachedRegistry = attachTargetCoverageToPainRegistry(
        deterministicRegistry,
        (ctx.audience as any)?.targetCoverage || { status: "NOT_EVALUATED" },
        (ctx.audience as any)?.audienceSegments ?? [],
      );

      // Load persisted decisions from strategic_pain_decisions, target_assessments, product_assessments
      const spdRows = await db.select().from(strategicPainDecisions)
        .where(and(
          eq(strategicPainDecisions.accountId, accountId),
          eq(strategicPainDecisions.campaignId, campaignId),
        ))
        .orderBy(desc(strategicPainDecisions.createdAt));

      const taRows = await db.select().from(targetAssessments)
        .where(and(
          eq(targetAssessments.accountId, accountId),
          eq(targetAssessments.campaignId, campaignId),
        ))
        .orderBy(desc(targetAssessments.createdAt));

      const paRows = await db.select().from(productAssessments)
        .where(and(
          eq(productAssessments.accountId, accountId),
          eq(productAssessments.campaignId, campaignId),
        ))
        .orderBy(desc(productAssessments.createdAt));

      const currentJobId = ctx.jobId;
      const currentAudSnapId = ctx.audienceSnapshotId;
      const sourceJobId = (ctx.audience as any)?._provenance?.sourceJobId || (ctx.audience as any)?.jobId || params.sourceJobId || (ctx as any)?.sourceJobId;
      const sameJobSpdRows = sourceJobId
        ? spdRows.filter((r: any) => r.jobId === sourceJobId)
        : [];

      let hydratedRegistry: AuthoritativeAudiencePain[] = [];

      if (sameJobSpdRows.length > 0) {
        // Reconstitute post-atomicity split pains and their persisted grounded materiality directly from the source job's strategic_pain_decisions
        const seenSpdPainIds = new Set<string>();
        const uniqueSameJobSpd = sameJobSpdRows.filter((r: any) => {
          if (!r.painId || seenSpdPainIds.has(r.painId)) return false;
          seenSpdPainIds.add(r.painId);
          return true;
        });

        const rawAtomicPains = uniqueSameJobSpd.map((spd: any, idx: number) => {
          const spdPayload = typeof spd.payload === "string" ? (() => { try { return JSON.parse(spd.payload); } catch { return null; } })() : spd.payload;
          const basePid = String(spd.painId || "").replace(/_split_\d+$/, "");
          const parentPain = attachedRegistry.find((p: any) => p.painId === spd.painId || p.painId === basePid) || attachedRegistry[0];
          const canonicalText = spdPayload?.painClaim || parentPain?.canonical || "";
          const persistedMateriality = spdPayload?.materiality || parentPain?.materiality;
          return {
            ...(parentPain || {}),
            painId: spd.painId,
            claimId: spd.painId,
            canonical: canonicalText,
            originalStatement: parentPain?.originalStatement || canonicalText,
            rank: idx + 1,
            materiality: persistedMateriality,
            evidenceUids: Array.isArray(persistedMateriality?.rawEvidenceUids)
              ? persistedMateriality.rawEvidenceUids
              : (parentPain?.evidenceUids || []),
            segmentId: parentPain?.segmentId,
            segmentIds: parentPain?.segmentIds,
            segmentName: parentPain?.segmentName,
            affectedBuyer: parentPain?.affectedBuyer,
            _spdRow: spd,
            _spdPayload: spdPayload,
          };
        });

        const builtAtomicRegistry = attachTargetCoverageToPainRegistry(
          buildAudiencePainRegistry(
            rawAtomicPains,
            { accountId, audienceSnapshotId: ctx.audienceSnapshotId! },
            canonicalEvidenceRegistry.size > 0 ? canonicalEvidenceRegistry : undefined,
            (ctx.audience as any)?.audienceSegments,
          ),
          (ctx.audience as any)?.targetCoverage || { status: "NOT_EVALUATED" },
          (ctx.audience as any)?.audienceSegments ?? [],
        );

        hydratedRegistry = builtAtomicRegistry.map((pain: any) => {
          const spd = uniqueSameJobSpd.find((r: any) => r.painId === pain.painId);
          const spdPayload = typeof spd?.payload === "string" ? (() => { try { return JSON.parse(spd.payload); } catch { return null; } })() : spd?.payload;
          const ta = taRows.find((r: any) => r.id === spd?.targetAssessmentAuthorityId || (r.jobId === sourceJobId && r.painId === pain.painId));
          const pa = paRows.find((r: any) => r.id === spd?.productAssessmentAuthorityId || (r.jobId === sourceJobId && r.painId === pain.painId));
          const taPayload = typeof ta?.payload === "string" ? (() => { try { return JSON.parse(ta.payload); } catch { return null; } })() : ta?.payload;
          const paPayload = typeof pa?.payload === "string" ? (() => { try { return JSON.parse(pa.payload); } catch { return null; } })() : pa?.payload;

          const rawClass = spd?.finalClassification || spdPayload?.finalClassification;
          const finalClass: AudiencePainClass =
            rawClass === "CORE_PURCHASE"
              ? "CORE_PURCHASE"
              : rawClass === "SUPPORTING"
                ? "SUPPORTING"
                : "UNKNOWN";
          const allowedUses = allowedUsesForClass(finalClass);
          const prohibitedUses = prohibitedUsesForClass(finalClass);
          const fitType = pa?.fitType || paPayload?.fitType || spdPayload?.productFitType || pain.fitType || "UNKNOWN";
          const coverageDecision = ta?.decision || taPayload?.decision || spdPayload?.targetCoverageDecision || pain.coverageDecision || "NOT_COVERED";
          const productFit = (fitType === "DIRECT_FIT" || fitType === "STRATEGIC_FIT")
            ? "ELIGIBLE"
            : (fitType === "UNKNOWN" ? "UNKNOWN" : "INELIGIBLE");
          const eligible = finalClass !== "UNKNOWN" && allowedUses.length > 0 && pain.canonical.length > 0;
          const pHash = pain.contentHash || computePainContentHash(pain.canonical || "");

          return {
            ...pain,
            contentHash: pHash,
            classification: finalClass,
            strategicPainDecisionAuthorityId: spd?.id || spd?.strategicPainDecisionAuthorityId || spdPayload?.strategicPainDecisionAuthorityId,
            targetAssessmentAuthorityId: spd?.targetAssessmentAuthorityId || ta?.id || taPayload?.targetAssessmentAuthorityId,
            productAssessmentAuthorityId: spd?.productAssessmentAuthorityId || pa?.id || paPayload?.productAssessmentAuthorityId,
            targetUnderstandingAuthorityId: spdPayload?.targetUnderstandingAuthorityId,
            campaignOfferingId: spdPayload?.campaignOfferingId,
            productTruthFactIds: spdPayload?.productTruthFactIds,
            coverageDecision,
            fitType,
            allowedUses,
            prohibitedUses,
            productFit,
            eligible,
            classifierVersion: "strategic_pain_pipeline_v3",
            classificationReason: spd?.reason || spdPayload?.reason || pain.classificationReason || "unclassified",
            lineage: { accountId, audienceSnapshotId: ctx.audienceSnapshotId! },
          };
        });
      } else {
        hydratedRegistry = attachedRegistry.map((pain: any) => {
          const pHash = pain.contentHash || computePainContentHash(pain.canonical || pain.claim || "");
          // Content-addressed or strictly same-job matching (no cross-job positional collision or stale truth reuse)
          const ptRev = pain.productTruthRevision || (ctx as any)?.productTruthRevision || (ctx.businessUnderstanding as any)?.revision;
          const spd = matchResumeDecision(pain, spdRows, currentJobId, currentAudSnapId, sourceJobId, ptRev, accountId);
          const ta = matchResumeDecision(pain, taRows, currentJobId, currentAudSnapId, sourceJobId, ptRev, accountId);
          const pa = matchResumeDecision(pain, paRows, currentJobId, currentAudSnapId, sourceJobId, ptRev, accountId);

          let finalClass: AudiencePainClass =
            pain.classification === "CORE_PURCHASE" || pain.classification === "SUPPORTING"
              ? pain.classification
              : "UNKNOWN";
          let classificationReason = pain.classificationReason || "unclassified";
          let spdAuthorityId = pain.strategicPainDecisionAuthorityId;

          if (spd) {
            const spdPayload = typeof spd.payload === "string" ? (() => { try { return JSON.parse(spd.payload); } catch { return null; } })() : spd.payload;
            spdAuthorityId = spd.strategicPainDecisionAuthorityId || spdPayload?.strategicPainDecisionAuthorityId;
            classificationReason = spd.reason || spdPayload?.reason || classificationReason;
            const rawClass = spd.finalClassification || spdPayload?.finalClassification;
            if (rawClass === "CORE_PURCHASE") {
              finalClass = "CORE_PURCHASE";
            } else if (rawClass === "SUPPORTING") {
              finalClass = "SUPPORTING";
            } else if (rawClass) {
              finalClass = "UNKNOWN";
            }
          }

          const allowedUses = allowedUsesForClass(finalClass);
          const prohibitedUses = prohibitedUsesForClass(finalClass);
          const taPayload = typeof ta?.payload === "string" ? (() => { try { return JSON.parse(ta.payload); } catch { return null; } })() : ta?.payload;
          const paPayload = typeof pa?.payload === "string" ? (() => { try { return JSON.parse(pa.payload); } catch { return null; } })() : pa?.payload;
          const fitType = pa?.fitType || paPayload?.fitType || pain.fitType || (finalClass !== "UNKNOWN" ? "STRATEGIC_FIT" : "UNKNOWN");
          const coverageDecision = ta?.decision || taPayload?.decision || pain.coverageDecision || "NOT_COVERED";
          const productFit = (fitType === "DIRECT_FIT" || fitType === "STRATEGIC_FIT")
            ? "ELIGIBLE"
            : (fitType === "UNKNOWN" ? "UNKNOWN" : "INELIGIBLE");
          const eligible = finalClass !== "UNKNOWN" && allowedUses.length > 0 && pain.canonical.length > 0;

          return {
            ...pain,
            contentHash: pHash,
            classification: finalClass,
            strategicPainDecisionAuthorityId: spdAuthorityId,
            targetAssessmentAuthorityId: ta?.targetAssessmentAuthorityId || taPayload?.targetAssessmentAuthorityId || pain.targetAssessmentAuthorityId,
            productAssessmentAuthorityId: pa?.productAssessmentAuthorityId || paPayload?.productAssessmentAuthorityId || pain.productAssessmentAuthorityId,
            coverageDecision,
            fitType,
            allowedUses,
            prohibitedUses,
            productFit,
            eligible,
            classifierVersion: "strategic_pain_pipeline_v3",
            classificationReason,
            lineage: { accountId, audienceSnapshotId: ctx.audienceSnapshotId! },
          };
        });
      }

      const primaryLanePainIds = new Set<string>();
      const rawLanes = (ctx.audience as any)?.strategicLanes || (ctx as any)?.strategicLanes || [];
      if (Array.isArray(rawLanes)) {
        for (const l of rawLanes) {
          if (l?.primaryPainId) primaryLanePainIds.add(l.primaryPainId);
          if (Array.isArray(l?.corePainIds) && l.corePainIds[0]) primaryLanePainIds.add(l.corePainIds[0]);
        }
      }

      hydratedRegistry = hydratedRegistry.map((entry: any) => {
        const canonicalText = String(entry.canonical || "");
        const origText = String(entry.originalStatement || "");
        if (isPositiveAppreciationSignal(`${canonicalText} ${origText}`)) {
          return {
            ...entry,
            classification: "UNKNOWN" as AudiencePainClass,
            eligible: false,
            allowedUses: [],
            prohibitedUses: prohibitedUsesForClass("UNKNOWN"),
            classificationReason: `Excluded from pain registry: positive customer appreciation / testimonial signal (${entry.classificationReason || "satisfaction signal"}) — preserved as desire/satisfaction evidence rather than a buyer friction pain.`,
          };
        }
        if (primaryLanePainIds.has(entry.painId)) {
          return {
            ...entry,
            _isPrimaryLaneCore: true,
          };
        }
        return entry;
      });

      const painVal = validateAudiencePainRegistry(hydratedRegistry, {
        accountId,
        audienceSnapshotId: ctx.audienceSnapshotId!,
      });

      if (!painVal.valid) {
        console.warn(`[ResumeHydration] PAIN_REGISTRY_VALIDATION_FAILED | issues=${painVal.issues.join(", ")}`);
        gaps.push(`pain_registry:${painVal.issues.join(",")}`);
      } else {
        ctx.painRegistry = hydratedRegistry;
        if (ctx.audience) {
          (ctx.audience as any).painRegistry = hydratedRegistry;
        }
        hydrated.push("pain_registry");
        console.log(`[ResumeHydration] HYDRATED | pain_registry size=${hydratedRegistry.length}`);

        // Reconstitute strategic lanes & synchronize audiencePains with enriched canonical pain registry
        const authorizedLanePains = hydratedRegistry
          .filter(
            p =>
              (p.classification === "CORE_PURCHASE" || p.classification === "SUPPORTING") &&
              p.eligible &&
              !isPositiveAppreciationSignal(`${p.canonical || ""} ${p.originalStatement || ""}`),
          )
          .sort((a, b) => {
            const aRank = a.classification === "CORE_PURCHASE" ? 0 : 1;
            const bRank = b.classification === "CORE_PURCHASE" ? 0 : 1;
            return aRank - bRank;
          });

        if (authorizedLanePains.length > 0 && ctx.audience) {
          const canonicalPainArray = authorizedLanePains.map((p: any) => {
            const evUids = Array.isArray(p.evidenceUids) && p.evidenceUids.length > 0
              ? p.evidenceUids
              : (Array.isArray(p.evidenceIds) ? p.evidenceIds : []);
            const passages = Array.isArray(p.supportingPassages) && p.supportingPassages.length > 0
              ? p.supportingPassages
              : (Array.isArray(p.materiality?.evidence)
                  ? p.materiality.evidence.map((it: any) => it.supportingPassage || it.verbatimText || it.boundedExcerpt).filter(Boolean)
                  : []);
            const uniqCount = p.uniqueEvidenceCount ?? p.evidenceCount ?? (evUids.length || 1);
            return {
              painId: p.painId,
              id: p.painId,
              canonical: p.canonical,
              originalStatement: p.originalStatement || p.canonical,
              classification: p.classification,
              frequency: uniqCount,
              evidenceCount: uniqCount,
              uniqueEvidenceCount: uniqCount,
              citationCount: p.citationCount ?? evUids.length,
              evidenceIds: evUids,
              evidenceUids: evUids,
              evidence: passages.slice(0, 3),
              supportingPassages: passages,
              affectedBuyer: p.affectedBuyer,
              context: p.context,
              prevalenceLimitations: p.prevalenceLimitations || [],
              conflictingEvidence: p.conflictingEvidence || [],
              competitorRelationshipScopes: p.competitorRelationshipScopes || [],
              materiality: p.materiality,
              confidenceScore: typeof p.confidenceScore === "number" ? p.confidenceScore : 0.85,
              confidence: typeof p.confidenceScore === "number" ? p.confidenceScore : 0.85,
              segmentIds: p.segmentIds || [],
              sourceSignals: ["canonical_pain_registry"],
            };
          });
          const existingSs = (ctx.audience as any).structuredSignals || {
            pain_clusters: [],
            desire_clusters: [],
            pattern_clusters: [],
            root_causes: [],
            psychological_drivers: [],
          };
          const syncedStructuredSignals = {
            ...existingSs,
            pain_clusters: canonicalPainArray,
          };
          (ctx.audience as any).painMap = canonicalPainArray;
          (ctx.audience as any).audiencePains = canonicalPainArray;
          (ctx.audience as any).structuredSignals = syncedStructuredSignals;
          const audHydrated = hydratedResults.get("audience");
          if (audHydrated && audHydrated.output) {
            audHydrated.output.painMap = canonicalPainArray;
            audHydrated.output.audiencePains = canonicalPainArray;
            audHydrated.output.structuredSignals = syncedStructuredSignals;
            audHydrated.output.painRegistry = hydratedRegistry;
          }
          try {
            const rawObjs = (ctx.audience as any)?.objectionMap || [];
            const mappedObjs = (Array.isArray(rawObjs) ? rawObjs : []).map((o: any) => ({
              label: o.label ?? o.canonical ?? o.pain ?? o.signal ?? "",
              confidence: o.confidence ?? o.confidenceScore ?? 0.5,
              evidence: Array.isArray(o.evidence) ? o.evidence : [],
            }));
            ctx.sglState = initializeSignalGovernance(syncedStructuredSignals, mappedObjs);
          } catch {
            // keep existing sglState if re-init fails
          }
          if (ctx.audienceSnapshotId) {
            try {
              await db
                .update(audienceSnapshots)
                .set({
                  audiencePains: JSON.stringify(canonicalPainArray),
                  structuredSignals: JSON.stringify(syncedStructuredSignals),
                })
                .where(eq(audienceSnapshots.id, ctx.audienceSnapshotId));
            } catch (syncErr: any) {
              console.warn(`[ResumeHydration] Non-fatal audiencePains canonical sync warning: ${syncErr?.message}`);
            }
          }
        }

        const rawSegments = (ctx.audience as any)?.audienceSegments ?? [];
        const authorizedPainIds = new Set(authorizedLanePains.map(p => p.painId));
        const authorizedSegments = rawSegments.filter((seg: any) => {
          const segPains = Array.isArray(seg.pains) ? seg.pains : [];
          const segPainIds = segPains.map((p: any) => p.claimId || p.painId || p.id || p);
          return segPainIds.some((pid: string) => authorizedPainIds.has(pid)) ||
                 authorizedLanePains.some((ap: any) => (ap.segmentIds || []).includes(seg.id));
        });

        const rawAudienceObjections = Array.isArray((ctx.audience as any)?.objectionMap)
          ? (ctx.audience as any).objectionMap
          : Array.isArray((ctx.audience as any)?.objections)
            ? (ctx.audience as any).objections
            : [];

        const sanitizeLaneText = (text: string): string => {
          if (!text || typeof text !== "string") return "";
          return text.replace(/\s+/g, " ").trim();
        };

        const tokenizeForObjMatch = (text: string): string[] => {
          const stop = new Set(["the", "and", "for", "with", "that", "from", "some", "customers", "report", "find", "their", "song", "songs", "personalized", "services", "service", "about", "after", "when", "into", "more", "than", "lack"]);
          return String(text || "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(t => t.length >= 4 && !stop.has(t));
        };

        const enrichLaneWithAttribution = (lane: any) => {
          const stableLaneId = lane.laneId || lane.id;
          const coreIds = (Array.isArray(lane.corePainIds) ? lane.corePainIds : [lane.primaryPainId].filter(Boolean))
            .filter((pid: string) => authorizedPainIds.has(pid));
          const explicitSuppIds = [
            ...(Array.isArray(lane.supportingPainIds) ? lane.supportingPainIds : []),
            ...(Array.isArray(lane.painIds) ? lane.painIds : []),
          ].filter((pid: string) => authorizedPainIds.has(pid) && !coreIds.includes(pid));
          // Also include authorized segment-sibling pains (e.g. seg_1_pain_3 for lane_1 when primaryPainId is seg_1_pain_1)
          // that are not claimed as primary/core by another lane
          const primarySegPrefixes = new Set(
            coreIds
              .map((pid: string) => {
                const m = String(pid).match(/^(seg_\d+)_/);
                return m ? m[1] : null;
              })
              .filter(Boolean) as string[]
          );
          const segmentSiblingIds = hydratedRegistry
            .filter((hp: any) => {
              if (!hp?.painId || !authorizedPainIds.has(hp.painId)) return false;
              if (coreIds.includes(hp.painId) || explicitSuppIds.includes(hp.painId)) return false;
              if (primaryLanePainIds.has(hp.painId)) return false;
              const m = String(hp.painId).match(/^(seg_\d+)_/);
              return m && primarySegPrefixes.has(m[1]);
            })
            .map((hp: any) => hp.painId);
          const suppIds = [...new Set([...explicitSuppIds, ...segmentSiblingIds])];
          const allLanePainIds = [...new Set([...coreIds, ...suppIds])];
          const competitorSubjectAttribution = allLanePainIds.map((pid: string) => {
            const pEntry = hydratedRegistry.find((hp: any) => hp.painId === pid);
            const scopes = Array.isArray(pEntry?.competitorRelationshipScopes) ? pEntry.competitorRelationshipScopes : [];
            const matEv = Array.isArray((pEntry as any)?.materiality?.evidence) ? (pEntry as any).materiality.evidence : [];
            const rawEvUids = Array.isArray(pEntry?.evidenceUids) ? pEntry.evidenceUids : [];
            const regEvItems = rawEvUids.map((uid: string) => canonicalEvidenceRegistry.get(uid)).filter(Boolean);
            const compNames = [
              ...scopes.map((s: any) => (typeof s === "object" ? s?.competitorName : undefined)),
              ...matEv.map((ev: any) => ev?.competitorName || ev?.observedSubjectDomain),
              ...regEvItems.map((ev: any) => ev?.competitorName || ev?.observedSubjectName || ev?.observedSubjectDomain),
            ].filter((n: any): n is string => typeof n === "string" && n.trim().length > 0);
            const compIds = [
              ...scopes.map((s: any) => (typeof s === "object" ? s?.competitorId : undefined)),
              ...matEv.map((ev: any) => ev?.competitorId),
              ...regEvItems.map((ev: any) => ev?.competitorId),
            ].filter((id: any): id is string => typeof id === "string" && id.trim().length > 0);
            const observedDomains = [
              ...matEv.map((ev: any) => ev?.observedSubjectDomain),
              ...regEvItems.map((ev: any) => ev?.observedSubjectDomain),
            ].filter((d: any): d is string => typeof d === "string" && d.trim().length > 0);
            const hasCompetitorSpecific =
              compNames.length > 0 ||
              compIds.length > 0 ||
              observedDomains.length > 0 ||
              scopes.some((s: any) => (typeof s === "string" ? s.includes("COMPETITOR") : s?.scope === "COMPETITOR_SPECIFIC" || s?.scope?.includes("COMPETITOR")));
            const registryResolutionStatus = compIds.length > 0
              ? "REGISTERED_COMPETITOR"
              : (compNames.length > 0 || observedDomains.length > 0 ? "OBSERVED_UNREGISTERED_SUBJECT" : "UNATTRIBUTED");
            return {
              painId: pid,
              canonical: pEntry?.canonical || "",
              subjectScope: hasCompetitorSpecific ? "COMPETITOR_SPECIFIC" : "UNATTRIBUTED_MARKET",
              competitorNames: [...new Set(compNames)],
              competitorIds: [...new Set(compIds)],
              observedSubjectDomains: [...new Set(observedDomains)],
              registryResolutionStatus,
            };
          });

          const lanePainEntries = allLanePainIds
            .map((pid: string) => hydratedRegistry.find((hp: any) => hp.painId === pid))
            .filter(Boolean);

          const rawLaneObjs = Array.isArray(lane.objections) ? lane.objections : [];
          const objectionAttribution = rawLaneObjs.map((rawObj: any, idx: number) => {
            const objText = typeof rawObj === "string"
              ? rawObj
              : String(rawObj?.statement || rawObj?.canonical || rawObj?.objection || "").trim();
            const explicitObjId = typeof rawObj === "object" && (rawObj?.objectionId || rawObj?.id)
              ? String(rawObj.objectionId || rawObj.id)
              : null;

            // Match to canonical Audience objection entry by explicit ID or exact/normalized statement
            const matchedAudObj = rawAudienceObjections.find((ao: any) => {
              if (!ao) return false;
              const aoId = ao.objectionId || ao.id;
              if (explicitObjId && aoId && String(aoId) === explicitObjId) return true;
              const aoText = String(ao.canonical || ao.statement || ao.objection || "").trim().toLowerCase();
              return aoText.length > 0 && aoText === objText.toLowerCase();
            });

            // Also check if this objection maps to an authorized pain in hydratedRegistry (exact or best token overlap within lane)
            let matchedPainEntry = hydratedRegistry.find((hp: any) => {
              if (!hp) return false;
              if (explicitObjId && hp.painId === explicitObjId) return true;
              const hpText = String(hp.canonical || hp.originalStatement || "").trim().toLowerCase();
              return hpText.length > 0 && hpText === objText.toLowerCase();
            });

            if (!matchedPainEntry && objText.length > 0) {
              const objToks = tokenizeForObjMatch(objText);
              let bestSim = 0;
              const seenSearchIds = new Set<string>();
              const searchPool = [...lanePainEntries, ...hydratedRegistry].filter((hp: any) => {
                if (!hp || !hp.painId || seenSearchIds.has(hp.painId)) return false;
                seenSearchIds.add(hp.painId);
                return true;
              });
              for (const hp of searchPool) {
                const hpToks = tokenizeForObjMatch(`${hp.canonical || ""} ${hp.originalStatement || ""}`);
                if (objToks.length === 0 || hpToks.length === 0) continue;
                const shared = objToks.filter(ot =>
                  hpToks.some(ht => ht === ot || (ot.length >= 5 && ht.length >= 5 && ot.slice(0, 5) === ht.slice(0, 5)))
                ).length;
                if (shared === 0) continue;
                const inLaneBonus = allLanePainIds.includes(hp.painId) ? 0.05 : 0;
                const sim = (shared / Math.sqrt(objToks.length * hpToks.length)) + inLaneBonus;
                if (sim > bestSim && (shared >= 2 || (shared >= 1 && objToks.length <= 2))) {
                  bestSim = sim;
                  matchedPainEntry = hp;
                }
              }
            }

            const resolvedObjId =
              explicitObjId ||
              matchedAudObj?.objectionId ||
              matchedAudObj?.id ||
              `${stableLaneId || "lane"}_obj_${idx + 1}`;

            const scopes = [
              ...(Array.isArray(rawObj?.competitorRelationshipScopes) ? rawObj.competitorRelationshipScopes : []),
              ...(Array.isArray(matchedAudObj?.competitorRelationshipScopes) ? matchedAudObj.competitorRelationshipScopes : []),
              ...(Array.isArray(matchedPainEntry?.competitorRelationshipScopes) ? matchedPainEntry.competitorRelationshipScopes : []),
            ];
            const matEv = [
              ...(Array.isArray((matchedAudObj as any)?.materiality?.evidence) ? (matchedAudObj as any).materiality.evidence : []),
              ...(Array.isArray((matchedPainEntry as any)?.materiality?.evidence) ? (matchedPainEntry as any).materiality.evidence : []),
            ];
            const evIds = [
              ...(Array.isArray(rawObj?.evidenceIds) ? rawObj.evidenceIds : []),
              ...(Array.isArray(matchedAudObj?.evidenceIds) ? matchedAudObj.evidenceIds : []),
              ...(Array.isArray(matchedAudObj?.evidenceUids) ? matchedAudObj.evidenceUids : []),
              ...(Array.isArray(matchedPainEntry?.evidenceUids) ? matchedPainEntry.evidenceUids : []),
              ...(Array.isArray(matchedPainEntry?.evidenceIds) ? matchedPainEntry.evidenceIds : []),
              ...matEv.map((ev: any) => ev?.evidenceUid),
            ].filter((id: any): id is string => typeof id === "string" && id.trim().length > 0);
            const regEvItems = evIds.map((uid: string) => canonicalEvidenceRegistry.get(uid)).filter(Boolean);
            const compNames = [
              ...(Array.isArray(rawObj?.competitorNames) ? rawObj.competitorNames : []),
              ...scopes.map((s: any) => (typeof s === "object" ? s?.competitorName : undefined)),
              ...matEv.map((ev: any) => ev?.competitorName || ev?.observedSubjectDomain),
              ...regEvItems.map((ev: any) => ev?.competitorName || ev?.observedSubjectName || ev?.observedSubjectDomain),
            ].filter((n: any): n is string => typeof n === "string" && n.trim().length > 0);
            const compIds = [
              ...(Array.isArray(rawObj?.competitorIds) ? rawObj.competitorIds : []),
              ...scopes.map((s: any) => (typeof s === "object" ? s?.competitorId : undefined)),
              ...matEv.map((ev: any) => ev?.competitorId),
              ...regEvItems.map((ev: any) => ev?.competitorId),
            ].filter((id: any): id is string => typeof id === "string" && id.trim().length > 0);
            const observedDomains = [
              ...matEv.map((ev: any) => ev?.observedSubjectDomain),
              ...regEvItems.map((ev: any) => ev?.observedSubjectDomain),
            ].filter((d: any): d is string => typeof d === "string" && d.trim().length > 0);

            const hasCompSpecific =
              rawObj?.subjectScope === "COMPETITOR_SPECIFIC" ||
              compNames.length > 0 ||
              compIds.length > 0 ||
              observedDomains.length > 0 ||
              scopes.some((s: any) => (typeof s === "string" ? s.includes("COMPETITOR") : s?.scope === "COMPETITOR_SPECIFIC" || s?.scope?.includes("COMPETITOR")));
            const registryResolutionStatus = compIds.length > 0
              ? "REGISTERED_COMPETITOR"
              : (compNames.length > 0 || observedDomains.length > 0 ? "OBSERVED_UNREGISTERED_SUBJECT" : "UNATTRIBUTED");

            return {
              objectionId: resolvedObjId,
              statement: objText,
              linkedPainId: matchedPainEntry?.painId || matchedAudObj?.painId || null,
              subjectScope: hasCompSpecific ? "COMPETITOR_SPECIFIC" : "UNATTRIBUTED_MARKET",
              competitorNames: [...new Set(compNames)],
              competitorIds: [...new Set(compIds)],
              observedSubjectDomains: [...new Set(observedDomains)],
              registryResolutionStatus,
              evidenceIds: [...new Set(evIds)],
            };
          });

          const cleanPrimaryPainId = (lane.primaryPainId && authorizedPainIds.has(lane.primaryPainId))
            ? lane.primaryPainId
            : (coreIds[0] || allLanePainIds[0] || lane.primaryPainId);
          return {
            ...lane,
            id: stableLaneId,
            laneId: stableLaneId,
            primaryPainId: cleanPrimaryPainId,
            corePainIds: coreIds.length > 0 ? coreIds : lane.corePainIds,
            supportingPainIds: suppIds,
            painIds: allLanePainIds.length > 0
              ? allLanePainIds
              : (Array.isArray(lane.painIds) ? lane.painIds.filter((pid: string) => authorizedPainIds.has(pid)) : []),
            desires: Array.isArray(lane.desires) ? lane.desires.map((d: any) => typeof d === "string" ? sanitizeLaneText(d) : d) : lane.desires,
            proofNeeds: Array.isArray(lane.proofNeeds) ? lane.proofNeeds.map((p: any) => typeof p === "string" ? sanitizeLaneText(p) : p) : lane.proofNeeds,
            messagingDirection: typeof lane.messagingDirection === "string" ? sanitizeLaneText(lane.messagingDirection) : lane.messagingDirection,
            competitorSubjectAttribution,
            objectionAttribution,
          };
        };

        if (!ctx.strategicLanes || ctx.strategicLanes.length === 0) {
          try {
            let existingRoot: any = await getExecutionEligibleRoot(campaignId, accountId);
            if (!existingRoot) {
              const candidateRoots = await db
                .select()
                .from(strategyRoots)
                .where(and(eq(strategyRoots.accountId, accountId), eq(strategyRoots.campaignId, campaignId)))
                .orderBy(desc(strategyRoots.createdAt))
                .limit(5);
              existingRoot = candidateRoots.find((r: any) => {
                const lanes = typeof r.approvedLanes === "string" ? (() => { try { return JSON.parse(r.approvedLanes); } catch { return []; } })() : r.approvedLanes;
                return (!ctx.audienceSnapshotId || r.audienceSnapshotId === ctx.audienceSnapshotId) && Array.isArray(lanes) && lanes.length > 0;
              });
              if (existingRoot && typeof existingRoot.approvedLanes === "string") {
                try { existingRoot.approvedLanes = JSON.parse(existingRoot.approvedLanes); } catch { existingRoot.approvedLanes = []; }
              }
            }
            if (
              existingRoot &&
              (!ctx.audienceSnapshotId || existingRoot.audienceSnapshotId === ctx.audienceSnapshotId) &&
              Array.isArray(existingRoot.approvedLanes) &&
              existingRoot.approvedLanes.length > 0
            ) {
              const validExistingLanes = existingRoot.approvedLanes.filter((l: any) => {
                const cIds = Array.isArray(l?.corePainIds) ? l.corePainIds : [l?.primaryPainId].filter(Boolean);
                return cIds.some((pid: string) => authorizedPainIds.has(pid));
              });
              if (validExistingLanes.length > 0) {
                ctx.strategicLanes = validExistingLanes;
                console.log(`[ResumeHydration] REUSED_ROOT_LANES | Loaded ${validExistingLanes.length} stable lanes from root ${existingRoot.id} matching audienceSnapshotId=${ctx.audienceSnapshotId}`);
              }
            }
          } catch (rootLaneErr: any) {
            console.warn(`[ResumeHydration] Non-fatal existing root lane lookup warning: ${rootLaneErr?.message}`);
          }
        }

        if (ctx.strategicLanes && ctx.strategicLanes.length > 0) {
          const enrichedLanes = ctx.strategicLanes.map(enrichLaneWithAttribution);
          ctx.strategicLanes = enrichedLanes;
          ctx.approvedLanes = enrichedLanes;
          hydrated.push("strategic_lanes");
          console.log(`[ResumeHydration] USING_APPROVED_LANES | Root has ${enrichedLanes.length} approved lanes — enriched with competitorSubjectAttribution and cleaned positive signals`);
        } else if (authorizedLanePains.length > 0) {
          const lanes = await runLaneGrouper(
            authorizedSegments.length > 0 ? authorizedSegments : rawSegments,
            authorizedLanePains,
            {
              accountId,
              campaignId,
              jobId: params.jobId || "resume_hydration",
            },
          );
          if (lanes && lanes.length > 0) {
            const enrichedLanes = lanes.map(enrichLaneWithAttribution);
            ctx.strategicLanes = enrichedLanes;
            ctx.approvedLanes = enrichedLanes;
            hydrated.push("strategic_lanes");
            console.log(`[ResumeHydration] HYDRATED | strategic_lanes count=${enrichedLanes.length}`);
          } else {
            console.warn("[ResumeHydration] WARN | Lane grouping returned 0 lanes");
            gaps.push("strategic_lanes");
          }
        } else {
          console.warn("[ResumeHydration] WARN | Zero authorized pains for strategic lanes");
          gaps.push("strategic_lanes:zero_authorized_pains");
        }

        // Sync cleaned approvedAudiencePains and enriched approvedLanes onto ctx.strategyRoot & strategy_roots DB
        if (ctx.strategyRoot && authorizedLanePains.length > 0) {
          const cleanedRootPains = authorizedLanePains.map((p: any) => ({
            ...p,
            painId: p.painId,
            canonical: p.canonical,
            originalStatement: p.originalStatement || p.canonical,
            classification: p.classification,
            allowedUses: Array.isArray(p.allowedUses) && p.allowedUses.length > 0 ? p.allowedUses : allowedUsesForClass(p.classification),
            prohibitedUses: Array.isArray(p.prohibitedUses) ? p.prohibitedUses : prohibitedUsesForClass(p.classification),
            eligible: p.eligible ?? true,
            productFit: p.productFit || "ELIGIBLE",
            fitType: p.fitType || "STRATEGIC_FIT",
            competitorRelationshipScopes: p.competitorRelationshipScopes || [],
          }));
          ctx.strategyRoot.approvedAudiencePains = cleanedRootPains as any;
          if (ctx.approvedLanes && ctx.approvedLanes.length > 0) {
            ctx.strategyRoot.approvedLanes = ctx.approvedLanes as any;
          }
          if (ctx.strategyRootId) {
            try {
              await db
                .update(strategyRoots)
                .set({
                  approvedAudiencePains: JSON.stringify(cleanedRootPains),
                  ...(ctx.approvedLanes && ctx.approvedLanes.length > 0
                    ? { approvedLanes: JSON.stringify(ctx.approvedLanes) }
                    : {}),
                })
                .where(eq(strategyRoots.id, ctx.strategyRootId));
            } catch (rootSyncErr: any) {
              console.warn(`[ResumeHydration] Non-fatal strategyRoot pain/lane sync warning: ${rootSyncErr?.message}`);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | pain_registry / strategic_lanes: ${err.message}`);
      gaps.push("pain_registry");
    }
  }

  // -------------------------------------------------------------------------
  // 4. Differentiation
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("differentiation") && !ctx.differentiation) {
    try {
      const diffCandidates = await db.select().from(differentiationSnapshots)
        .where(and(
          eq(differentiationSnapshots.accountId, accountId),
          eq(differentiationSnapshots.campaignId, campaignId),
          inArray(differentiationSnapshots.status, ["SUCCESS", "COMPLETE"]),
        ))
        .orderBy(desc(differentiationSnapshots.createdAt))
        .limit(10);

      const missingDiffMiIds = Array.from(
        new Set(
          diffCandidates
            .map(d => d.miSnapshotId)
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0 && !miLookupMap.has(id)),
        ),
      );
      if (missingDiffMiIds.length > 0) {
        const extraMiRows = await db
          .select()
          .from(miSnapshots)
          .where(inArray(miSnapshots.id, missingDiffMiIds));
        for (const r of extraMiRows) {
          miLookupMap.set(r.id, r);
        }
      }

      const isDiffLineageCompatible = (d: any) =>
        isDifferentiationSnapshotCompatibleSync({
          diffRow: d,
          expectedMiSnapshotId: ctx.miSnapshotId,
          expectedAudienceSnapshotId: ctx.audienceSnapshotId,
          miRowLookup: miLookupMap,
        }).compatible;

      const requestedDiffId = params.reusedSnapshotIds?.differentiation;
      const diffRow = requestedDiffId
        ? diffCandidates.find(d => d.id === requestedDiffId && isDiffLineageCompatible(d))
        : (params.sourceJobId
            ? diffCandidates.find(d => d.jobId === params.sourceJobId && isDiffLineageCompatible(d))
            : undefined) ||
          diffCandidates.find(isDiffLineageCompatible);

      if (diffRow) {
        const pillars = JSON.parse(diffRow.differentiationPillars || "[]");
        const claimStructures = JSON.parse(diffRow.claimStructures || "[]");
        const proofArchitecture = JSON.parse(diffRow.proofArchitecture || "[]");
        let mechanismCore: any = null;
        if (diffRow.mechanismCore && diffRow.mechanismCore !== "null") {
          try {
            mechanismCore = typeof diffRow.mechanismCore === "string" ? JSON.parse(diffRow.mechanismCore) : diffRow.mechanismCore;
          } catch { mechanismCore = null; }
        }
        let mechanismFraming: any = null;
        if (diffRow.mechanismFraming && diffRow.mechanismFraming !== "null") {
          try {
            mechanismFraming = typeof diffRow.mechanismFraming === "string" ? JSON.parse(diffRow.mechanismFraming) : diffRow.mechanismFraming;
          } catch { mechanismFraming = null; }
        }

        if (mechanismCore && typeof mechanismCore === "object") {
          mechanismCore = {
            mechanismName: mechanismCore.mechanismName || pillars[0]?.name || "Validated Mechanism",
            mechanismType: mechanismCore.mechanismType || "system",
            mechanismSteps: Array.isArray(mechanismCore.mechanismSteps)
              ? mechanismCore.mechanismSteps
              : (Array.isArray(pillars[0]?.supportingProof) && pillars[0].supportingProof.length > 0
                  ? pillars[0].supportingProof
                  : [pillars[0]?.description || pillars[0]?.name || "Core delivery step"]),
            mechanismPromise: mechanismCore.mechanismPromise || mechanismCore.buyerOutcome || pillars[0]?.buyerValue || "",
            mechanismProblem: mechanismCore.mechanismProblem || pillars[0]?.comparisonBaseline?.statement || "",
            mechanismLogic: mechanismCore.mechanismLogic || mechanismCore.coreLogic || pillars[0]?.description || "",
            ...mechanismCore,
          };
          if (!mechanismCore.mechanismType) mechanismCore.mechanismType = "system";
          if (!Array.isArray(mechanismCore.mechanismSteps)) mechanismCore.mechanismSteps = [];
        }
        if (mechanismFraming && typeof mechanismFraming === "object") {
          mechanismFraming = {
            type: mechanismFraming.type || "system",
            supported: mechanismFraming.supported ?? true,
            proofBasis: mechanismFraming.proofBasis || mechanismFraming.proofSignals || [],
            ...mechanismFraming,
          };
        }

        ctx.differentiation = {
          ...diffRow,
          pillars,
          differentiations: pillars,
          differentiationPillars: pillars,
          claimStructures,
          validatedClaims: claimStructures,
          proofArchitecture,
          mechanismCore,
          mechanismFraming,
          celDepthCompliance: {
            engineId: "differentiation",
            passed: true,
            score: 0.9,
            causalDepthScore: 0.9,
            violations: [],
            appliedRules: [],
            rootCausesEvaluated: 1,
            enforcementLog: [],
          },
          snapshotId: diffRow.id,
        };
        ctx.differentiationSnapshotId = diffRow.id;
        ctx.inputHashes.differentiation = diffRow.inputHash || "reused_diff";
        hydrated.push("differentiation");
        hydratedResults.set("differentiation", {
          engineId: "differentiation",
          status: "SUCCESS",
          output: {
            ...ctx.differentiation,
            _provenance: {
              sourceJobId: diffRow.jobId,
              snapshotId: diffRow.id,
              campaignId,
              accountId,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: diffRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | differentiation snapshot=${diffRow.id}`);
      } else if (diffCandidates.length > 0) {
        const targetStaleCandidate =
          (requestedDiffId ? diffCandidates.find(d => d.id === requestedDiffId) : undefined) ||
          diffCandidates[0];
        const staleCheck = isDifferentiationSnapshotCompatibleSync({
          diffRow: targetStaleCandidate,
          expectedMiSnapshotId: ctx.miSnapshotId,
          expectedAudienceSnapshotId: ctx.audienceSnapshotId,
          miRowLookup: miLookupMap,
        });
        console.warn(`[ResumeHydration] STALE_SNAPSHOT_REJECTED | engine=differentiation | snapshot=${targetStaleCandidate.id} | reason=${staleCheck.reason}`);
        if (!staleEngines.some(s => s.engineId === "differentiation")) {
          staleEngines.push({
            engineId: "differentiation",
            snapshotId: targetStaleCandidate.id,
            reason: staleCheck.reason,
          });
        }
      } else {
        gaps.push("differentiation");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | differentiation: ${err.message}`);
      gaps.push("differentiation");
    }
  }

  // -------------------------------------------------------------------------
  // 5. Positioning
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("positioning") && !ctx.positioning && !staleEngines.some(s => s.engineId === "differentiation")) {
    try {
      const posCandidates = await db.select().from(positioningSnapshots)
        .where(and(
          eq(positioningSnapshots.accountId, accountId),
          eq(positioningSnapshots.campaignId, campaignId),
          inArray(positioningSnapshots.status, ["SUCCESS", "COMPLETE", "PARTIAL"]),
        ))
        .orderBy(desc(positioningSnapshots.createdAt))
        .limit(10);

      const missingPosMiIds = Array.from(
        new Set(
          posCandidates
            .map(p => p.miSnapshotId)
            .filter((id): id is string => typeof id === "string" && id.trim().length > 0 && !miLookupMap.has(id)),
        ),
      );
      if (missingPosMiIds.length > 0) {
        const extraMiRows = await db
          .select()
          .from(miSnapshots)
          .where(inArray(miSnapshots.id, missingPosMiIds));
        for (const r of extraMiRows) {
          miLookupMap.set(r.id, r);
        }
      }

      const isPosLineageCompatible = (p: any) =>
        isPositioningSnapshotCompatibleSync({
          posRow: p,
          expectedMiSnapshotId: ctx.miSnapshotId,
          expectedAudienceSnapshotId: ctx.audienceSnapshotId,
          expectedDifferentiationSnapshotId: ctx.differentiationSnapshotId,
          miRowLookup: miLookupMap,
        }).compatible;

      const posRow =
        (params.reusedSnapshotIds?.positioning
          ? posCandidates.find(p => p.id === params.reusedSnapshotIds!.positioning && isPosLineageCompatible(p))
          : undefined) ||
        (params.sourceJobId
          ? posCandidates.find(p => p.jobId === params.sourceJobId && isPosLineageCompatible(p))
          : undefined) ||
        posCandidates.find(isPosLineageCompatible);

      if (posRow) {
        const territory = JSON.parse(posRow.territory || "{}");
        const territories = JSON.parse(posRow.territories || "[]");
        const differentiationVector = JSON.parse(posRow.differentiationVector || "[]");
        const proofSignals = JSON.parse(posRow.proofSignals || "[]");
        const strategyCards = JSON.parse(posRow.strategyCards || "[]");
        let stabilityResult: any = {};
        try {
          stabilityResult = JSON.parse(posRow.stabilityResult || "{}");
        } catch { stabilityResult = {}; }
        const isStable = stabilityResult?.isStable === true;
        const reconstitutedEngineConfidence = (typeof (posRow as any).engineConfidence === "number" && (posRow as any).engineConfidence > 0)
          ? (posRow as any).engineConfidence
          : isStable ? 0.85 : ((posRow.confidenceScore && posRow.confidenceScore > 0) ? posRow.confidenceScore : 0.35);
        const reconstitutedDataConfidence = (typeof (posRow as any).dataConfidence === "number" && (posRow as any).dataConfidence > 0)
          ? (posRow as any).dataConfidence
          : 0.95;

        const rawEpistemic =
          (posRow as any).epistemicStatus ||
          territory?.proposalStatus ||
          territory?.epistemicStatus ||
          (posRow.status === "PARTIAL" ? "PROPOSED" : undefined);
        const proposalStatus =
          rawEpistemic === "PROPOSED" || rawEpistemic === "STRATEGIC_HYPOTHESIS"
            ? "PROPOSED"
            : rawEpistemic === "EVIDENCE_BACKED"
              ? "EVIDENCE_BACKED"
              : undefined;

        ctx.positioning = {
          ...posRow,
          territory,
          territories,
          differentiationVector,
          proofSignals,
          strategyCards,
          stabilityResult,
          proposalStatus,
          epistemicStatus: (posRow as any).epistemicStatus || proposalStatus,
          engineConfidence: reconstitutedEngineConfidence,
          dataConfidence: reconstitutedDataConfidence,
          confidenceScore: (posRow.confidenceScore && posRow.confidenceScore > 0) ? posRow.confidenceScore : reconstitutedEngineConfidence,
          snapshotId: posRow.id,
        };
        ctx.positioningSnapshotId = posRow.id;
        ctx.inputHashes.positioning = posRow.inputHash || "reused_pos";
        hydrated.push("positioning");
        hydratedResults.set("positioning", {
          engineId: "positioning",
          status: "SUCCESS",
          output: {
            ...ctx.positioning,
            engineConfidence: reconstitutedEngineConfidence,
            dataConfidence: reconstitutedDataConfidence,
            confidenceScore: (posRow.confidenceScore && posRow.confidenceScore > 0) ? posRow.confidenceScore : reconstitutedEngineConfidence,
            _provenance: {
              sourceJobId: posRow.jobId,
              snapshotId: posRow.id,
              engineVersion: (posRow as any).engineVersion || 1,
              campaignId,
              accountId,
              offeringId: params.offeringId || null,
              offeringName: params.offeringName || null,
              targetMarket: params.targetMarket || null,
              contextFingerprint: params.contextFingerprint || null,
              proposalStatus,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: posRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | positioning snapshot=${posRow.id} proposalStatus=${proposalStatus || "standard"}`);
      } else if (posCandidates.length > 0) {
        const staleCheck = isPositioningSnapshotCompatibleSync({
          posRow: posCandidates[0],
          expectedMiSnapshotId: ctx.miSnapshotId,
          expectedAudienceSnapshotId: ctx.audienceSnapshotId,
          expectedDifferentiationSnapshotId: ctx.differentiationSnapshotId,
          miRowLookup: miLookupMap,
        });
        console.warn(`[ResumeHydration] STALE_SNAPSHOT_REJECTED | engine=positioning | snapshot=${posCandidates[0].id} | reason=${staleCheck.reason}`);
        if (!staleEngines.some(s => s.engineId === "positioning")) {
          staleEngines.push({
            engineId: "positioning",
            snapshotId: posCandidates[0].id,
            reason: staleCheck.reason,
          });
        }
      } else {
        gaps.push("positioning");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | positioning: ${err.message}`);
      gaps.push("positioning");
    }
  }

  // -------------------------------------------------------------------------
  // 5b. Mechanism Engine
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("mechanism") && !ctx.mechanism) {
    try {
      const mechCandidates = await db.select().from(mechanismSnapshots)
        .where(and(
          eq(mechanismSnapshots.accountId, accountId),
          eq(mechanismSnapshots.campaignId, campaignId),
          inArray(mechanismSnapshots.status, ["SUCCESS", "COMPLETE"]),
        ))
        .orderBy(desc(mechanismSnapshots.createdAt))
        .limit(10);

      const isMechLineageCompatible = (m: any) => {
        if (ctx.positioningSnapshotId && m.positioningSnapshotId && m.positioningSnapshotId !== ctx.positioningSnapshotId) return false;
        if (ctx.differentiationSnapshotId && m.differentiationSnapshotId && m.differentiationSnapshotId !== ctx.differentiationSnapshotId) return false;
        if (ctx.audienceSnapshotId && m.audienceSnapshotId && m.audienceSnapshotId !== ctx.audienceSnapshotId) return false;
        return true;
      };

      const mechRow =
        (params.reusedSnapshotIds?.mechanism
          ? mechCandidates.find(m => m.id === params.reusedSnapshotIds!.mechanism && isMechLineageCompatible(m))
          : undefined) ||
        (params.sourceJobId
          ? mechCandidates.find(m => m.jobId === params.sourceJobId && isMechLineageCompatible(m))
          : undefined) ||
        mechCandidates.find(isMechLineageCompatible);

      if (mechRow) {
        let primaryMechanism: any = null;
        let alternativeMechanism: any = null;
        try {
          primaryMechanism = typeof mechRow.primaryMechanism === "string" ? JSON.parse(mechRow.primaryMechanism) : mechRow.primaryMechanism;
        } catch { primaryMechanism = mechRow.primaryMechanism; }
        try {
          alternativeMechanism = typeof mechRow.alternativeMechanism === "string" ? JSON.parse(mechRow.alternativeMechanism) : mechRow.alternativeMechanism;
        } catch { alternativeMechanism = mechRow.alternativeMechanism; }

        const mechConf = (typeof (mechRow as any).confidenceScore === "number" && (mechRow as any).confidenceScore > 0)
          ? (mechRow as any).confidenceScore
          : 0.90;

        ctx.mechanism = {
          ...mechRow,
          primaryMechanism,
          alternativeMechanism,
          confidenceScore: mechConf,
          celDepthCompliance: {
            engineId: "mechanism",
            passed: true,
            score: 0.85,
            causalDepthScore: 0.85,
            violations: [],
            appliedRules: [],
            rootCausesEvaluated: 1,
            enforcementLog: [],
          },
          snapshotId: mechRow.id,
        };
        ctx.mechanismSnapshotId = mechRow.id;
        ctx.inputHashes.mechanism = mechRow.inputHash || "reused_mech";
        hydrated.push("mechanism");
        hydratedResults.set("mechanism", {
          engineId: "mechanism",
          status: "SUCCESS",
          output: {
            ...ctx.mechanism,
            _provenance: {
              sourceJobId: mechRow.jobId,
              snapshotId: mechRow.id,
              campaignId,
              accountId,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: mechRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | mechanism snapshot=${mechRow.id}`);
      } else {
        gaps.push("mechanism");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | mechanism: ${err.message}`);
      gaps.push("mechanism");
    }
  }

  // -------------------------------------------------------------------------
  // 5c. Strategy Root
  // -------------------------------------------------------------------------
  if (!ctx.strategyRoot && effectiveStartIndex >= 6) {
    try {
      const root = await getExecutionEligibleRoot(campaignId, accountId);
      if (root) {
        ctx.strategyRoot = root;
        ctx.strategyRootId = root.id;
        if (!ctx.strategicLanes && root.approvedLanes && root.approvedLanes.length > 0) {
          ctx.strategicLanes = root.approvedLanes;
          ctx.approvedLanes = root.approvedLanes;
        }
        hydrated.push("strategy_root");
        console.log(`[ResumeHydration] HYDRATED | strategy_root id=${root.id} lanes=${(root.approvedLanes || []).length}`);
      } else {
        console.warn(`[ResumeHydration] WARN | No active execution-eligible strategy root found for campaign ${campaignId}`);
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | strategy_root: ${err.message}`);
    }
  }

  // Ensure strategyRoot.brandSpine and approvedMechanism carry the hydrated primaryMechanism
  if (ctx.strategyRoot && ctx.mechanism) {
    const primaryMech = (ctx.mechanism as any)?.primaryMechanism;
    const resolvedMechName = primaryMech?.mechanismName || primaryMech?.name || (ctx.mechanism as any)?.mechanismName || null;
    if (resolvedMechName) {
      const existingSpine = ((ctx.strategyRoot as any).brandSpine || {}) as Record<string, any>;
      if (!existingSpine.mechanismName || !existingSpine.mechanismSteps?.length) {
        (ctx.strategyRoot as any).brandSpine = {
          ...existingSpine,
          mechanismName: existingSpine.mechanismName || resolvedMechName,
          mechanismType: existingSpine.mechanismType || primaryMech?.mechanismType || null,
          mechanismPromise: existingSpine.mechanismPromise || primaryMech?.mechanismPromise || primaryMech?.whyItWorks || null,
          mechanismSteps: (existingSpine.mechanismSteps?.length ? existingSpine.mechanismSteps : primaryMech?.mechanismSteps) || [],
        };
        if ((ctx.strategyRoot as any).id) {
          try {
            await db.update(strategyRoots)
              .set({ brandSpine: (ctx.strategyRoot as any).brandSpine })
              .where(eq(strategyRoots.id, (ctx.strategyRoot as any).id));
            console.log(`[ResumeHydration] Synced mechanism "${resolvedMechName}" into strategy_roots.brand_spine for root ${(ctx.strategyRoot as any).id}`);
          } catch (err: any) {
            console.warn(`[ResumeHydration] Warning - failed to sync brandSpine to strategy_roots: ${err?.message}`);
          }
        }
      }
      if (!(ctx.strategyRoot as any).approvedMechanism && primaryMech) {
        (ctx.strategyRoot as any).approvedMechanism = primaryMech;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. Analytical Enrichment Layer (AEL)
  // -------------------------------------------------------------------------
  if (!ctx.analyticalEnrichment) {
    try {
      const res = await db.execute(sql`
        SELECT id, package, is_partial, partial_reason
        FROM ael_snapshots
        WHERE account_id = ${accountId} AND campaign_id = ${campaignId}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const aelRow = (res.rows as any[])?.[0];
      if (aelRow?.package) {
        ctx.analyticalEnrichment = typeof aelRow.package === "string"
          ? JSON.parse(aelRow.package)
          : aelRow.package;
        ctx.aelSnapshotId = aelRow.id;
        hydrated.push("analytical_enrichment");
        console.log(`[ResumeHydration] HYDRATED | analytical_enrichment snapshot=${aelRow.id}`);
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] AEL optional load warning: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // 7. Offer
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("offer") && !ctx.offer) {
    try {
      const conditions = [
        eq(offerSnapshots.accountId, accountId),
        eq(offerSnapshots.campaignId, campaignId),
        inArray(offerSnapshots.status, ["SUCCESS", "COMPLETE"]),
      ];
      if (ctx.strategyRootId) {
        conditions.push(eq(offerSnapshots.strategyRootId, ctx.strategyRootId));
      }

      const [offerRow] = await db.select().from(offerSnapshots)
        .where(and(...conditions))
        .orderBy(desc(offerSnapshots.createdAt))
        .limit(1);

      const isInvalidated = offerRow
        ? offerRow.status === "INVALIDATED" || /invalidated|review required|superseded/i.test(offerRow.statusMessage || "")
        : false;

      if (offerRow && !isInvalidated) {
        const primaryOffer = typeof offerRow.primaryOffer === "string" ? JSON.parse(offerRow.primaryOffer) : offerRow.primaryOffer;
        const alternativeOffer = offerRow.alternativeOffer && typeof offerRow.alternativeOffer === "string" ? JSON.parse(offerRow.alternativeOffer) : offerRow.alternativeOffer;
        const rejectedOffer = offerRow.rejectedOffer && typeof offerRow.rejectedOffer === "string" ? JSON.parse(offerRow.rejectedOffer) : offerRow.rejectedOffer;
        const positioningConsistency = offerRow.positioningConsistency && typeof offerRow.positioningConsistency === "string" ? JSON.parse(offerRow.positioningConsistency) : offerRow.positioningConsistency;
        const hookMechanismAlignment = offerRow.hookMechanismAlignment && typeof offerRow.hookMechanismAlignment === "string" ? JSON.parse(offerRow.hookMechanismAlignment) : offerRow.hookMechanismAlignment;
        const structuralWarnings = offerRow.structuralWarnings && typeof offerRow.structuralWarnings === "string" ? JSON.parse(offerRow.structuralWarnings) : (offerRow.structuralWarnings || []);
        const layerDiagnostics = offerRow.layerDiagnostics && typeof offerRow.layerDiagnostics === "string" ? JSON.parse(offerRow.layerDiagnostics) : (offerRow.layerDiagnostics || {});

        ctx.offer = {
          ...offerRow,
          primaryOffer,
          alternativeOffer,
          rejectedOffer,
          positioningConsistency,
          hookMechanismAlignment,
          structuralWarnings,
          layerDiagnostics,
          snapshotId: offerRow.id,
        };
        ctx.offerSnapshotId = offerRow.id;
        ctx.inputHashes.offer = offerRow.inputHash || "reused_offer";
        hydrated.push("offer");
        hydratedResults.set("offer", {
          engineId: "offer",
          status: "SUCCESS",
          output: {
            ...ctx.offer,
            _provenance: {
              sourceJobId: offerRow.jobId,
              consumingJobId: (ctx.config as any)?.currentJobId || null,
              snapshotId: offerRow.id,
              campaignId,
              accountId,
              positioningSnapshotId: offerRow.positioningSnapshotId,
              mechanismSnapshotId: (offerRow as any).mechanismSnapshotId || (offerRow as any).differentiationSnapshotId,
              audienceSnapshotId: offerRow.audienceSnapshotId,
              status: offerRow.status,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: offerRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | offer snapshot=${offerRow.id}`);
      } else {
        gaps.push("offer");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | offer: ${err.message}`);
      gaps.push("offer");
    }
  }

  // -------------------------------------------------------------------------
  // 8. Awareness
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("awareness") && !ctx.awareness) {
    try {
      const [awRow] = await db.select().from(awarenessSnapshots)
        .where(and(
          eq(awarenessSnapshots.accountId, accountId),
          eq(awarenessSnapshots.campaignId, campaignId),
          inArray(awarenessSnapshots.status, ["SUCCESS", "COMPLETE"]),
        ))
        .orderBy(desc(awarenessSnapshots.createdAt))
        .limit(1);

      const isInvalidated = awRow
        ? awRow.status === "INVALIDATED" || /invalidated|review required|superseded/i.test(awRow.statusMessage || "")
        : false;
      const offerMismatch = awRow && ctx.offerSnapshotId && awRow.offerSnapshotId && awRow.offerSnapshotId !== ctx.offerSnapshotId;

      if (awRow && !isInvalidated && !offerMismatch) {
        const primaryRoute = typeof awRow.primaryRoute === "string" ? JSON.parse(awRow.primaryRoute) : awRow.primaryRoute;
        const alternativeRoute = awRow.alternativeRoute && typeof awRow.alternativeRoute === "string" ? JSON.parse(awRow.alternativeRoute) : awRow.alternativeRoute;
        const rejectedRoute = awRow.rejectedRoute && typeof awRow.rejectedRoute === "string" ? JSON.parse(awRow.rejectedRoute) : awRow.rejectedRoute;
        const layerResults = awRow.layerResults && typeof awRow.layerResults === "string" ? JSON.parse(awRow.layerResults) : awRow.layerResults;
        const structuralWarnings = awRow.structuralWarnings && typeof awRow.structuralWarnings === "string" ? JSON.parse(awRow.structuralWarnings) : (awRow.structuralWarnings || []);

        ctx.awareness = {
          ...awRow,
          primaryRoute,
          alternativeRoute,
          rejectedRoute,
          layerResults,
          structuralWarnings,
          snapshotId: awRow.id,
        };
        ctx.awarenessSnapshotId = awRow.id;
        ctx.inputHashes.awareness = awRow.inputHash || "reused_awareness";
        hydrated.push("awareness");
        hydratedResults.set("awareness", {
          engineId: "awareness",
          status: "SUCCESS",
          output: {
            ...ctx.awareness,
            _provenance: {
              sourceJobId: awRow.jobId,
              snapshotId: awRow.id,
              campaignId,
              accountId,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: awRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | awareness snapshot=${awRow.id}`);
      } else {
        gaps.push("awareness");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | awareness: ${err.message}`);
      gaps.push("awareness");
    }
  }

  // -------------------------------------------------------------------------
  // 9. Funnel (Multi-lane)
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("funnel") && !ctx.funnel) {
    try {
      const funnelRows = await db.select().from(funnelSnapshots)
        .where(and(
          eq(funnelSnapshots.accountId, accountId),
          eq(funnelSnapshots.campaignId, campaignId),
          inArray(funnelSnapshots.status, ["SUCCESS", "COMPLETE"]),
        ))
        .orderBy(desc(funnelSnapshots.createdAt))
        .limit(10);

      if (funnelRows.length > 0) {
        const targetJobId = funnelRows[0].jobId;
        const candidateFunnels = funnelRows.filter(r => {
          if (r.jobId !== targetJobId) return false;
          const isInvalidated = r.status === "INVALIDATED" || /invalidated|review required|superseded/i.test(r.statusMessage || "");
          return !isInvalidated;
        });

        // Filter funnels by approved strategic lanes if present
        const approvedLaneIds = new Set((ctx.strategicLanes || []).map((l: any) => l.laneId));
        const jobFunnels = approvedLaneIds.size > 0
          ? candidateFunnels.filter(r => approvedLaneIds.has(r.laneId))
          : candidateFunnels;

        if (jobFunnels.length === 0) {
          console.warn(`[ResumeHydration] FUNNEL_LANE_MISMATCH_OR_INVALIDATED | candidateCount=${candidateFunnels.length} approvedLanes=${approvedLaneIds.size}`);
          gaps.push("funnel:lane_mismatch_or_invalidated");
        } else {
          const funnelsByLane = new Map<string, any>();

          for (const fRow of jobFunnels) {
            const primaryFunnel = typeof fRow.primaryFunnel === "string" ? JSON.parse(fRow.primaryFunnel) : fRow.primaryFunnel;
            const alternativeFunnel = fRow.alternativeFunnel && typeof fRow.alternativeFunnel === "string" ? JSON.parse(fRow.alternativeFunnel) : fRow.alternativeFunnel;
            const rejectedFunnel = fRow.rejectedFunnel && typeof fRow.rejectedFunnel === "string" ? JSON.parse(fRow.rejectedFunnel) : fRow.rejectedFunnel;
            const parsed = {
              ...fRow,
              primaryFunnel,
              alternativeFunnel,
              rejectedFunnel,
              snapshotId: fRow.id,
              laneId: fRow.laneId || "lane_1",
            };
            const laneId = fRow.laneId || "lane_1";
            funnelsByLane.set(laneId, parsed);
            hydratedResults.set(`funnel:${laneId}` as any, {
              engineId: `funnel:${laneId}` as any,
              status: "SUCCESS",
              output: parsed,
              durationMs: 0,
              snapshotId: fRow.id,
            });
          }

          const primaryRow = jobFunnels[0];
          const primaryFunnel = typeof primaryRow.primaryFunnel === "string" ? JSON.parse(primaryRow.primaryFunnel) : primaryRow.primaryFunnel;
          ctx.funnel = {
            ...primaryRow,
            primaryFunnel,
            snapshotId: primaryRow.id,
          };
          ctx.funnelSnapshotId = primaryRow.id;
          ctx.funnelSnapshotIds = jobFunnels.map(r => r.id);
          ctx.funnelsByLane = funnelsByLane;
          ctx.inputHashes.funnel = primaryRow.inputHash || "reused_funnel";
          hydrated.push("funnel");
          hydratedResults.set("funnel", {
            engineId: "funnel",
            status: "SUCCESS",
            output: {
              ...ctx.funnel,
              _provenance: {
                sourceJobId: primaryRow.jobId,
                snapshotId: primaryRow.id,
                campaignId,
                accountId,
                wasReused: true,
                isOfficialResume: true,
              },
            },
            durationMs: 0,
            snapshotId: primaryRow.id,
          });
          console.log(`[ResumeHydration] HYDRATED | funnel count=${jobFunnels.length} primarySnapshot=${primaryRow.id}`);
        }
      } else {
        gaps.push("funnel");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | funnel: ${err.message}`);
      gaps.push("funnel");
    }
  }

  // -------------------------------------------------------------------------
  // 10. Persuasion (Multi-lane)
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("persuasion") && !ctx.persuasion) {
    try {
      const persRows = await db.select().from(persuasionSnapshots)
        .where(and(
          eq(persuasionSnapshots.accountId, accountId),
          eq(persuasionSnapshots.campaignId, campaignId),
        ))
        .orderBy(desc(persuasionSnapshots.createdAt))
        .limit(10);

      if (persRows.length > 0) {
        const targetJobId = persRows[0].jobId;
        const candidatePers = persRows.filter(r => {
          if (r.jobId !== targetJobId) return false;
          const isInvalidated = r.status === "INVALIDATED" || /invalidated|review required|superseded/i.test(r.statusMessage || "");
          return !isInvalidated;
        });

        const approvedLaneIds = new Set((ctx.strategicLanes || []).map((l: any) => l.laneId));
        const jobPers = approvedLaneIds.size > 0
          ? candidatePers.filter(r => approvedLaneIds.has(r.laneId))
          : candidatePers;

        if (jobPers.length === 0) {
          console.warn(`[ResumeHydration] PERSUASION_LANE_MISMATCH_OR_INVALIDATED | candidateCount=${candidatePers.length} approvedLanes=${approvedLaneIds.size}`);
          gaps.push("persuasion:lane_mismatch_or_invalidated");
        } else {
          const persuasionsByLane = new Map<string, any>();

          for (const pRow of jobPers) {
            const primaryRoute = typeof pRow.primaryRoute === "string" ? JSON.parse(pRow.primaryRoute) : pRow.primaryRoute;
            const parsed = {
              ...pRow,
              primaryRoute,
              snapshotId: pRow.id,
              laneId: pRow.laneId || "lane_1",
            };
            const laneId = pRow.laneId || "lane_1";
            persuasionsByLane.set(laneId, parsed);
            const laneStatus = mapPersuasionLaneStatus(pRow);
            hydratedResults.set(`persuasion:${laneId}` as any, {
              engineId: `persuasion:${laneId}` as any,
              status: laneStatus,
              output: parsed,
              durationMs: 0,
              snapshotId: pRow.id,
            });
          }

          const primaryRow = jobPers[0];
          const primaryRoute = typeof primaryRow.primaryRoute === "string" ? JSON.parse(primaryRow.primaryRoute) : primaryRow.primaryRoute;
          ctx.persuasion = {
            ...primaryRow,
            primaryRoute,
            snapshotId: primaryRow.id,
          };
          ctx.persuasionSnapshotId = primaryRow.id;
          ctx.persuasionsByLane = persuasionsByLane;
          ctx.inputHashes.persuasion = primaryRow.inputHash || "reused_persuasion";
          hydrated.push("persuasion");
          const aggStatus = deriveAggregatePersuasionStatus(Array.from(persuasionsByLane.values()));
          hydratedResults.set("persuasion", {
            engineId: "persuasion",
            status: aggStatus,
            output: {
              ...ctx.persuasion,
              _provenance: {
                sourceJobId: primaryRow.jobId,
                consumingJobId: (ctx.config as any)?.currentJobId || null,
                snapshotId: primaryRow.id,
                campaignId,
                accountId,
                wasReused: true,
                isOfficialResume: true,
              },
            },
            durationMs: 0,
            snapshotId: primaryRow.id,
          });
          console.log(`[ResumeHydration] HYDRATED | persuasion count=${jobPers.length} primarySnapshot=${primaryRow.id}`);
        }
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | persuasion: ${err.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // 11. Integrity
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("integrity") && !ctx.integrity) {
    try {
      const conditions = [
        eq(integritySnapshots.accountId, accountId),
        eq(integritySnapshots.campaignId, campaignId),
        inArray(integritySnapshots.status, ["SUCCESS", "COMPLETE"]),
      ];
      if (ctx.strategyRootId) {
        conditions.push(eq(integritySnapshots.strategyRootId, ctx.strategyRootId));
      }

      let [integRow] = await db.select().from(integritySnapshots)
        .where(and(...conditions))
        .orderBy(desc(integritySnapshots.createdAt))
        .limit(1);

      if (!integRow && ctx.strategyRootId) {
        // Same-run integrity snapshots are persisted before/without a root binding.
        [integRow] = await db.select().from(integritySnapshots)
          .where(and(
            eq(integritySnapshots.accountId, accountId),
            eq(integritySnapshots.campaignId, campaignId),
            inArray(integritySnapshots.status, ["SUCCESS", "COMPLETE"]),
          ))
          .orderBy(desc(integritySnapshots.createdAt))
          .limit(1);
      }

      const isInvalidated = integRow
        ? integRow.status === "INVALIDATED" || /invalidated|review required|superseded/i.test(integRow.statusMessage || "")
        : false;

      if (integRow && !isInvalidated) {
        const layerResults = integRow.layerResults && typeof integRow.layerResults === "string" ? JSON.parse(integRow.layerResults) : integRow.layerResults;
        const structuralWarnings = integRow.structuralWarnings && typeof integRow.structuralWarnings === "string" ? JSON.parse(integRow.structuralWarnings) : (integRow.structuralWarnings || []);
        const flaggedInconsistencies = integRow.flaggedInconsistencies && typeof integRow.flaggedInconsistencies === "string" ? JSON.parse(integRow.flaggedInconsistencies) : (integRow.flaggedInconsistencies || []);

        ctx.integrity = {
          ...integRow,
          layerResults,
          structuralWarnings,
          flaggedInconsistencies,
          snapshotId: integRow.id,
        };
        ctx.integritySnapshotId = integRow.id;
        ctx.inputHashes.integrity = integRow.inputHash || "reused_integrity";
        hydrated.push("integrity");
        hydratedResults.set("integrity", {
          engineId: "integrity",
          status: "SUCCESS",
          output: {
            ...ctx.integrity,
            _provenance: {
              sourceJobId: integRow.jobId,
              snapshotId: integRow.id,
              campaignId,
              accountId,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: integRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | integrity snapshot=${integRow.id}`);
      } else {
        gaps.push("integrity");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | integrity: ${err.message}`);
      gaps.push("integrity");
    }
  }

  // -------------------------------------------------------------------------
  // 12. Statistical Validation
  // -------------------------------------------------------------------------
  if (upstreamEngines.has("statistical_validation") && !ctx.statisticalValidation) {
    try {
      const [statRow] = await db.select().from(strategyValidationSnapshots)
        .where(and(
          eq(strategyValidationSnapshots.accountId, accountId),
          eq(strategyValidationSnapshots.campaignId, campaignId),
          inArray(strategyValidationSnapshots.status, ["SUCCESS", "COMPLETE"]),
        ))
        .orderBy(desc(strategyValidationSnapshots.createdAt))
        .limit(1);

      if (statRow) {
        const result = typeof statRow.result === "string" ? JSON.parse(statRow.result) : statRow.result;
        const layerResults = statRow.layerResults && typeof statRow.layerResults === "string" ? JSON.parse(statRow.layerResults) : statRow.layerResults;
        const structuralWarnings = statRow.structuralWarnings && typeof statRow.structuralWarnings === "string" ? JSON.parse(statRow.structuralWarnings) : (statRow.structuralWarnings || []);

        ctx.statisticalValidation = {
          ...statRow,
          result,
          layerResults,
          structuralWarnings,
          snapshotId: statRow.id,
        };
        ctx.statisticalValidationSnapshotId = statRow.id;
        ctx.inputHashes.statistical_validation = statRow.inputHash || "reused_stat_val";
        hydrated.push("statistical_validation");
        hydratedResults.set("statistical_validation", {
          engineId: "statistical_validation",
          status: "SUCCESS",
          output: {
            ...ctx.statisticalValidation,
            _provenance: {
              sourceJobId: statRow.jobId,
              snapshotId: statRow.id,
              campaignId,
              accountId,
              wasReused: true,
              isOfficialResume: true,
            },
          },
          durationMs: 0,
          snapshotId: statRow.id,
        });
        console.log(`[ResumeHydration] HYDRATED | statistical_validation snapshot=${statRow.id}`);
      } else {
        gaps.push("statistical_validation");
      }
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | statistical_validation: ${err.message}`);
      gaps.push("statistical_validation");
    }
  }

  // -------------------------------------------------------------------------
  // 13-15. Channel Selection, Budget Governor, Iteration (generic snapshot reuse)
  // -------------------------------------------------------------------------
  const lateStages: Array<{
    engineId: EngineId;
    table: any;
    ctxKey: string;
    snapKey: string;
    hashKey: string;
  }> = [
    { engineId: "channel_selection" as EngineId, table: channelSelectionSnapshots, ctxKey: "channelSelection", snapKey: "channelSelectionSnapshotId", hashKey: "channel_selection" },
    { engineId: "budget_governor" as EngineId, table: budgetGovernorSnapshots, ctxKey: "budgetGovernor", snapKey: "budgetGovernorSnapshotId", hashKey: "budget_governor" },
    { engineId: "iteration" as EngineId, table: iterationSnapshots, ctxKey: "iteration", snapKey: "iterationSnapshotId", hashKey: "iteration" },
  ];
  for (const st of lateStages) {
    if (!upstreamEngines.has(st.engineId) || (ctx as any)[st.ctxKey]) continue;
    try {
      const [row] = await db.select().from(st.table)
        .where(and(
          eq(st.table.accountId, accountId),
          eq(st.table.campaignId, campaignId),
          inArray(st.table.status, ["SUCCESS", "COMPLETE", "ACTIVE", "PARTIAL"]),
        ))
        .orderBy(desc(st.table.createdAt))
        .limit(1);
      if (!row) {
        gaps.push(st.engineId);
        continue;
      }
      const parse = (v: any) => (v && typeof v === "string" ? JSON.parse(v) : v);
      const result = parse((row as any).result) || {};
      (ctx as any)[st.ctxKey] = { ...result, snapshotId: (row as any).id };
      (ctx as any)[st.snapKey] = (row as any).id;
      ctx.inputHashes[st.hashKey] = (row as any).inputHash || `reused_${st.hashKey}`;
      hydrated.push(st.engineId);
      hydratedResults.set(st.engineId, {
        engineId: st.engineId,
        status: "SUCCESS",
        output: {
          ...(ctx as any)[st.ctxKey],
          _provenance: {
            sourceJobId: (row as any).jobId,
            snapshotId: (row as any).id,
            campaignId,
            accountId,
            wasReused: true,
            isOfficialResume: true,
          },
        },
        durationMs: 0,
        snapshotId: (row as any).id,
      } as EngineStepResult);
      console.log(`[ResumeHydration] HYDRATED | ${st.engineId} snapshot=${(row as any).id}`);
    } catch (err: any) {
      console.warn(`[ResumeHydration] FAILED | ${st.engineId}: ${err.message}`);
      gaps.push(st.engineId);
    }
  }

  if (staleEngines.length > 0) {
    const staleIndices = staleEngines
      .map(s => ENGINE_PRIORITY_ORDER.findIndex(e => e.id === s.engineId))
      .filter(i => i >= 0);
    if (staleIndices.length > 0) {
      const earliestStaleIdx = Math.min(...staleIndices);
      const downstreamInvalidatedEngines = new Set<string>(
        ENGINE_PRIORITY_ORDER.slice(earliestStaleIdx).map(e => e.id),
      );
      if (earliestStaleIdx <= 5) {
        downstreamInvalidatedEngines.add("strategy_root");
        ctx.strategyRoot = undefined;
        ctx.strategyRootId = undefined;
      }
      const ctxClearMap: Record<string, Array<keyof EngineContext | string>> = {
        differentiation: ["differentiation", "differentiationSnapshotId"],
        positioning: ["positioning", "positioningSnapshotId"],
        mechanism: ["mechanism", "mechanismSnapshotId"],
        offer: ["offer", "offerSnapshotId"],
        awareness: ["awareness", "awarenessSnapshotId"],
        funnel: ["funnel", "funnelSnapshotId", "funnelSnapshotIds", "funnelsByLane"],
        persuasion: ["persuasion", "persuasionSnapshotId", "persuasionsByLane"],
        integrity: ["integrity", "integritySnapshotId"],
        statistical_validation: ["statisticalValidation", "statisticalValidationSnapshotId"],
        channel_selection: ["channelSelection", "channelSelectionSnapshotId"],
        budget_governor: ["budgetGovernor", "budgetGovernorSnapshotId"],
        iteration: ["iteration", "iterationSnapshotId"],
      };
      for (const eng of downstreamInvalidatedEngines) {
        for (const k of ctxClearMap[eng] || []) {
          delete (ctx as any)[k];
        }
        if ((ctx as any).inputHashes && eng in (ctx as any).inputHashes) {
          delete (ctx as any).inputHashes[eng];
        }
        hydratedResults.delete(eng as EngineId);
        for (const hrKey of Array.from(hydratedResults.keys())) {
          if (String(hrKey).startsWith(`${eng}:`)) {
            hydratedResults.delete(hrKey);
          }
        }
      }
      for (let i = hydrated.length - 1; i >= 0; i--) {
        const baseId = hydrated[i].split(":")[0];
        if (downstreamInvalidatedEngines.has(baseId)) {
          hydrated.splice(i, 1);
        }
      }
      for (let i = gaps.length - 1; i >= 0; i--) {
        const baseId = gaps[i].split(":")[0];
        if (downstreamInvalidatedEngines.has(baseId)) {
          gaps.splice(i, 1);
        }
      }
    }
  }

  if (!(ctx as any).previousResults || !((ctx as any).previousResults instanceof Map)) {
    (ctx as any).previousResults = new Map<EngineId, EngineStepResult>();
  }
  for (const [engId, stepRes] of hydratedResults.entries()) {
    if (stepRes && stepRes.output && typeof stepRes.output === "object") {
      const existingProv = (stepRes.output as any)._provenance || {};
      (stepRes.output as any)._provenance = {
        ...existingProv,
        sourceJobId: existingProv.sourceJobId || params.sourceJobId || params.jobId || null,
        snapshotId: existingProv.snapshotId || stepRes.snapshotId || null,
        engineVersion: existingProv.engineVersion || 1,
        accountId,
        campaignId,
        offeringId: existingProv.offeringId ?? params.offeringId ?? null,
        offeringName: existingProv.offeringName ?? params.offeringName ?? null,
        targetMarket: existingProv.targetMarket ?? params.targetMarket ?? null,
        contextFingerprint: existingProv.contextFingerprint ?? params.contextFingerprint ?? null,
        wasReused: true,
        isOfficialResume: true,
      };
    }
    (ctx as any).previousResults.set(engId, stepRes);
  }

  console.log(
    `[ResumeHydration] COMPLETE | hydrated=[${hydrated.join(",")}] | gaps=[${gaps.join(",")}] | stale=[${staleEngines.map(s => `${s.engineId}(${s.snapshotId || "none"})`).join(",")}]`,
  );

  return { hydrated, gaps, hydratedResults, staleEngines };
}
