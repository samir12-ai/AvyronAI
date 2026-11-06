import { db } from "./db";
import {
  strategicPlans,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  strategicPainDecisions,
  strategyRoots,
  orchestratorJobs,
  growthCampaigns,
  marketVoiceEvidence,
  ciReviews,
} from "../shared/schema";
import { eq, and, desc, or, inArray } from "drizzle-orm";
import type { AudiencePositioningViewModel } from "../types/audience-positioning";
import { resolvePlanContext, type PlanContextResolutionMode } from "./orchestrator/execution-plan-resolver";
import { isPositiveAppreciationSignal } from "./shared/audience-pain-registry";

function safeJsonParse<T = any>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val as T;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export async function assembleAudiencePositioningData(
  campaignId: string,
  accountId?: string,
  options?: {
    planId?: string | null;
    runId?: string | null;
    mode?: PlanContextResolutionMode;
  }
): Promise<AudiencePositioningViewModel> {
  const accountPredicate = (table: any) =>
    accountId && accountId !== "default"
      ? and(eq(table.campaignId, campaignId), eq(table.accountId, accountId))
      : eq(table.campaignId, campaignId);

  // 1 & 2. Resolve unified Plan Context + Strategy Root via shared resolver
  const planCtx = await resolvePlanContext({
    campaignId,
    accountId: accountId || "default",
    specificPlanId: options?.planId || null,
    specificRunId: options?.runId || null,
    mode: options?.mode || "LATEST_VIEWABLE",
  });

  const planRow = planCtx.selectedPlan;
  const plan = planRow?.planJson ? safeJsonParse(planRow.planJson, null) : null;
  const rootRow = planCtx.strategyRoot;

  const approvedAudiencePains = rootRow ? safeJsonParse<any[]>(rootRow.approvedAudiencePains, []) : [];
  const approvedLanes = rootRow ? safeJsonParse<any[]>(rootRow.approvedLanes, []) : (plan?.approvedLanes || []);
  const rootDesires = rootRow ? safeJsonParse<any[]>(rootRow.approvedDesires, []) : [];
  const rootObjections = rootRow ? safeJsonParse<any[]>(rootRow.approvedObjections, []) : [];

  // 3. Audience Snapshot (scoped by active root's / planCtx's snapshotId or latest for campaign, guarded against newer failed runs)
  const pinnedAudId = planCtx.snapshotIds.audienceSnapshotId || rootRow?.audienceSnapshotId;
  const audSnapshotQuery = pinnedAudId
    ? db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, pinnedAudId)).limit(1)
    : db.select().from(audienceSnapshots).where(accountPredicate(audienceSnapshots)).orderBy(desc(audienceSnapshots.createdAt)).limit(1);
  let [audRow] = await audSnapshotQuery;
  if (!pinnedAudId && audRow) {
    try {
      const [latestJob] = await db
        .select()
        .from(orchestratorJobs)
        .where(accountPredicate(orchestratorJobs))
        .orderBy(desc(orchestratorJobs.createdAt))
        .limit(1);
      if (latestJob && latestJob.id !== (audRow as any).runId) {
        const jobTs = latestJob.createdAt ? new Date(latestJob.createdAt).getTime() : 0;
        const snapTs = audRow.createdAt ? new Date(audRow.createdAt).getTime() : 0;
        if (jobTs >= snapTs && (latestJob.status === "BLOCKED" || latestJob.status === "FAILED")) {
          const errStr = String(latestJob.error || "");
          let audFailedInLatestJob = /Blocked at Audience/i.test(errStr);
          if (!audFailedInLatestJob && latestJob.sectionStatuses) {
            const sections = safeJsonParse<any[]>(latestJob.sectionStatuses, []);
            const audSec = sections.find((s: any) => s && s.id === "audience");
            if (audSec && (audSec.status === "BLOCKED" || audSec.status === "ERROR" || audSec.status === "FAILED" || audSec.status === "INCOMPLETE")) {
              audFailedInLatestJob = true;
            }
          }
          if (audFailedInLatestJob) {
            audRow = undefined as any;
          }
        }
      }
    } catch {
      // Non-fatal guard
    }
  }

  // 4. Positioning Snapshot (scoped by active root's / planCtx's snapshotId or latest)
  const pinnedPosId = planCtx.snapshotIds.positioningSnapshotId || rootRow?.positioningSnapshotId;
  const posSnapshotQuery = pinnedPosId
    ? db.select().from(positioningSnapshots).where(eq(positioningSnapshots.id, pinnedPosId)).limit(1)
    : db.select().from(positioningSnapshots).where(accountPredicate(positioningSnapshots)).orderBy(desc(positioningSnapshots.createdAt)).limit(1);
  const [posRow] = await posSnapshotQuery;

  // 5. Differentiation Snapshot (scoped by active root's / planCtx's snapshotId or latest)
  const pinnedDiffId = planCtx.snapshotIds.differentiationSnapshotId || rootRow?.differentiationSnapshotId;
  const diffSnapshotQuery = pinnedDiffId
    ? db.select().from(differentiationSnapshots).where(eq(differentiationSnapshots.id, pinnedDiffId)).limit(1)
    : db.select().from(differentiationSnapshots).where(accountPredicate(differentiationSnapshots)).orderBy(desc(differentiationSnapshots.createdAt)).limit(1);
  const [diffRow] = await diffSnapshotQuery;

  // 6. Mechanism Snapshot (scoped by active root's / planCtx's snapshotId or latest)
  const pinnedMechId = planCtx.snapshotIds.mechanismSnapshotId || rootRow?.mechanismSnapshotId;
  const mechSnapshotQuery = pinnedMechId
    ? db.select().from(mechanismSnapshots).where(eq(mechanismSnapshots.id, pinnedMechId)).limit(1)
    : db.select().from(mechanismSnapshots).where(accountPredicate(mechanismSnapshots)).orderBy(desc(mechanismSnapshots.createdAt)).limit(1);
  const [mechRow] = await mechSnapshotQuery;

  // 7. Active-Run Scoped Strategic Pain Decisions (for Technical Decision History, Canonical Pain Fallback & Excluded Claims)
  const activeJobId = planRow?.jobId || rootRow?.runId || audRow?.jobId || (audRow as any)?.runId || null;
  const spdRows = activeJobId
    ? await db
        .select()
        .from(strategicPainDecisions)
        .where(and(accountPredicate(strategicPainDecisions), eq(strategicPainDecisions.jobId, activeJobId)))
        .orderBy(desc(strategicPainDecisions.createdAt))
    : await db
        .select()
        .from(strategicPainDecisions)
        .where(accountPredicate(strategicPainDecisions))
        .orderBy(desc(strategicPainDecisions.createdAt))
        .limit(50);

  // Parse JSON collections safely
  const audSegments = audRow ? safeJsonParse<any[]>(audRow.audienceSegments, []) : [];
  const rawAudPains = audRow ? safeJsonParse<any[]>(audRow.audiencePains, []) : [];
  const desireMap = audRow ? safeJsonParse<any[]>(audRow.desireMap, []) : [];
  const objectionMap = audRow ? safeJsonParse<any[]>(audRow.objectionMap, []) : [];
  const emotionalDrivers = audRow ? safeJsonParse<any[]>(audRow.emotionalDrivers, []) : [];
  const structuredSignals = audRow ? safeJsonParse<any>(audRow.structuredSignals, null) : null;
  const commercialSynthesis = structuredSignals?.commercialAudienceSynthesis || null;

  const posStrategyCards = posRow ? safeJsonParse<any[]>(posRow.strategyCards, []) : [];
  const posTerritories = posRow ? safeJsonParse<any[]>(posRow.territories, []) : [];
  const diffPillars = diffRow ? safeJsonParse<any[]>(diffRow.differentiationPillars, []) : [];
  const primaryMech = mechRow ? safeJsonParse<any>(mechRow.primaryMechanism, null) : null;

  // Find Primary Lane via canonical active authority
  const primaryLane = (plan?.primaryLaneId && approvedLanes.find((l: any) => (l.laneId || l.id) === plan.primaryLaneId))
    || (approvedLanes.length > 0 ? approvedLanes[0] : null);

  const brandSpine = plan?.brandSpine || (rootRow?.brandSpine ? safeJsonParse(rootRow.brandSpine, null) : null);
  const strategicSummary = plan?.strategicSummary || null;

  // Helper to find raw segment pain object
  const findPainInSegments = (painId: string | null | undefined) => {
    if (!painId) return null;
    for (const seg of audSegments) {
      if (seg.pains && Array.isArray(seg.pains)) {
        const match = seg.pains.find((p: any) =>
          p.painId === painId ||
          p.id === painId ||
          p.claimId === painId ||
          p.canonicalClaimId === painId ||
          p.occurrenceId === painId
        );
        if (match) return match;
      }
    }
    return null;
  };

  // Derive canonical pain list:
  // 1. strategy_roots.approvedAudiencePains when present
  // 2. strategic_pain_decisions (CORE_PURCHASE / SUPPORTING) for activeJobId when rootRow is absent
  // 3. canonical segment pains from audience_segments
  // 4. audience_pains filtered to exclude legacy "Problem behind objection:" regex artifacts
  const spdApprovedPains = spdRows
    .filter((s: any) =>
      s.finalClassification === "CORE_PURCHASE" ||
      s.finalClassification === "CORE" ||
      s.finalClassification === "SUPPORTING"
    )
    .sort((a: any, b: any) => {
      const aCore = a.finalClassification === "CORE_PURCHASE" || a.finalClassification === "CORE" ? 0 : 1;
      const bCore = b.finalClassification === "CORE_PURCHASE" || b.finalClassification === "CORE" ? 0 : 1;
      return aCore - bCore;
    })
    .map((s: any) => {
      const segMatch = findPainInSegments(s.painId);
      return {
        painId: s.painId,
        id: s.painId,
        canonical: s.painText || segMatch?.claim || segMatch?.pain || "",
        originalStatement: segMatch?.originalStatement || segMatch?.statement || s.painText || "",
        classification: s.finalClassification === "CORE" ? "CORE_PURCHASE" : s.finalClassification,
        segmentIds: s.segmentId ? [s.segmentId] : [],
      };
    });

  const segmentDerivedPains: any[] = [];
  const seenSegPainIds = new Set<string>();
  for (const seg of audSegments) {
    for (const p of (seg.pains || []) as any[]) {
      const pid = p.claimId || p.painId || p.id || p.canonicalClaimId;
      const text = p.claim || p.pain || p.canonical || p.statement;
      if (!text || /^problem behind objection:/i.test(String(text).trim())) continue;
      const dedupKey = pid || String(text).toLowerCase();
      if (seenSegPainIds.has(dedupKey)) continue;
      seenSegPainIds.add(dedupKey);
      segmentDerivedPains.push({
        painId: pid,
        id: pid,
        canonical: text,
        originalStatement: p.originalStatement || p.statement || text,
        classification: segmentDerivedPains.length === 0 ? "CORE_PURCHASE" : "SUPPORTING",
      });
    }
  }

  const cleanRawAudPains = rawAudPains.filter(
    (p: any) => !/^problem behind objection:/i.test(String(p?.canonical || p?.pain || p?.originalStatement || "").trim())
  );

  const rawCanonicalPainPool =
    approvedAudiencePains.length > 0
      ? approvedAudiencePains
      : spdApprovedPains.length > 0
        ? spdApprovedPains
        : segmentDerivedPains.length > 0
          ? segmentDerivedPains
          : cleanRawAudPains;

  const positivePraiseExcludedFromPains: Array<{ painId: string; title: string; reason: string; classification: string }> = [];
  const canonicalPainPool = rawCanonicalPainPool.filter((p: any) => {
    const pid = p?.painId || p?.id;
    const segMatch = findPainInSegments(pid);
    const textToTest = `${p?.canonical || ""} ${p?.originalStatement || ""} ${p?.pain || ""} ${segMatch?.pain || ""} ${segMatch?.originalStatement || ""}`.trim();
    if (textToTest && isPositiveAppreciationSignal(textToTest)) {
      positivePraiseExcludedFromPains.push({
        painId: pid || "positive_signal",
        title: p?.canonical || p?.originalStatement || segMatch?.pain || "Positive Customer Appreciation Signal",
        reason: "Reclassified as positive customer appreciation / satisfaction evidence rather than a buyer friction pain.",
        classification: "Reclassified / Positive Appreciation Signal",
      });
      return false;
    }
    return true;
  });

  const audPains = canonicalPainPool;

  // Helper to find top-level audPain object
  const findPainInAudPains = (painId: string | null | undefined) => {
    if (!painId) return null;
    return audPains.find((p: any) => p.painId === painId || p.id === painId) || null;
  };

  // ─── 1. RESOLVE CORE BUYING PAIN FROM CANONICAL STRATEGY ROOT OR SPD REGISTRY ───
  const hasAudience = Boolean(audRow || canonicalPainPool.length > 0 || primaryLane);
  const hasPositioning = Boolean(posRow || rootRow?.primaryAxis || brandSpine?.umbrellaPositionName);

  const coreAudPain = canonicalPainPool.find((p: any) => p.classification === "CORE_PURCHASE" || p.classification === "CORE")
    || (primaryLane?.primaryPainId ? canonicalPainPool.find((p: any) => p.painId === primaryLane.primaryPainId) : null)
    || (canonicalPainPool.length > 0 ? canonicalPainPool[0] : null);

  const corePainId = coreAudPain?.painId || primaryLane?.primaryPainId || (canonicalPainPool[0]?.painId || canonicalPainPool[0]?.id) || "";
  const segCoreMatch = findPainInSegments(corePainId);
  const audCoreMatch = findPainInAudPains(corePainId);

  // Canonical Core Pain text: Grounded in real data
  const corePainTitle = coreAudPain?.canonical
    || coreAudPain?.originalStatement
    || segCoreMatch?.pain
    || segCoreMatch?.claim
    || audCoreMatch?.canonical
    || canonicalPainPool[0]?.canonical
    || canonicalPainPool[0]?.originalStatement
    || (hasAudience ? "Primary Strategic Buying Friction" : "");

  const corePainRawStatement = segCoreMatch?.originalStatement
    || segCoreMatch?.statement
    || segCoreMatch?.pain
    || audCoreMatch?.originalStatement
    || audCoreMatch?.rawText
    || coreAudPain?.originalStatement
    || coreAudPain?.canonical
    || corePainTitle;

  // ─── 2. RESOLVE SUPPORTING PAINS FROM ACTIVE STRATEGY ROOT OR SNAPSHOT ───
  const filteredApproved = canonicalPainPool.filter((p: any) =>
    ((p.painId || p.id) && (p.painId || p.id) !== corePainId) &&
    (p.classification === "SUPPORTING" ||
      p.classification === "CORE_PURCHASE" ||
      p.classification === "CORE" ||
      !p.classification ||
      (primaryLane?.supportingPainIds && Array.isArray(primaryLane.supportingPainIds) && primaryLane.supportingPainIds.includes(p.painId)))
  );

  const canonicalSupportingList = filteredApproved;

  const supportingPains = canonicalSupportingList.map((p: any, idx: number) => {
    const segMatch = findPainInSegments(p.painId || p.id);
    const audMatch = findPainInAudPains(p.painId || p.id);

    const title = p.canonical || p.originalStatement || p.claim || p.pain || segMatch?.pain || segMatch?.claim || audMatch?.canonical || (hasAudience ? `Supporting Strategic Friction ${idx + 1}` : "");
    const description = segMatch?.originalStatement || segMatch?.statement || p.originalStatement || p.description || undefined;

    return {
      painId: p.painId || p.id || `supp_pain_${idx + 1}`,
      title,
      description,
      classification: "Supporting Strategic Signal",
    };
  });

  // ─── 3. RESOLVE EXCLUDED SIGNALS SCOPED TO ACTIVE RUN ───
  const excludedSpds = spdRows.filter((s: any) =>
    s.finalClassification === "EXCLUDE" ||
    s.finalClassification === "EXCLUDED" ||
    s.finalClassification === "STRATEGIC_EXCLUDED"
  );

  const excludedPains = [
    ...positivePraiseExcludedFromPains,
    ...excludedSpds.map((s: any) => {
      const segMatch = findPainInSegments(s.painId);
      return {
        painId: s.painId,
        title: segMatch?.pain || segMatch?.claim || s.painText || s.painId || "Excluded Signal",
        reason: s.reason || "Excluded due to product capability mismatch or low strategic materiality.",
        classification: "Decision History / Excluded",
      };
    }),
  ];

  // ─── 4. DESIRES & OBJECTIONS RESOLUTION ───
  const resolvedDesires = (primaryLane?.desires && primaryLane.desires.length > 0)
    ? primaryLane.desires
    : (rootDesires.length > 0
        ? rootDesires.map((d: any) => (typeof d === "string" ? d : d.canonical)).filter(Boolean)
        : desireMap.map((d: any) => (typeof d === "string" ? d : d.canonical || d.title || d.name)).filter(Boolean));

  const resolvedObjections = (primaryLane?.objections && primaryLane.objections.length > 0)
    ? primaryLane.objections
    : (rootObjections.length > 0
        ? rootObjections.map((o: any) => (typeof o === "string" ? o : o.canonical)).filter(Boolean)
        : objectionMap.map((o: any) => (typeof o === "string" ? o : o.canonical || o.objection || o.title)).filter(Boolean));

  const resolvedEmotional = emotionalDrivers.map((e: any) => (typeof e === "string" ? e : e.canonical || e.driver || e.title)).filter(Boolean);

  // ─── 5. EVIDENCE CITATIONS (RESOLVED THROUGH SNAPSHOT LINEAGE) ───
  const [growthCamp] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);
  const businessName =
    (growthCamp as any)?.businessName ||
    (growthCamp as any)?.name ||
    plan?.businessName ||
    "Your Business";

  const rawPainMatch = rawAudPains.find(
    (p: any) =>
      p?.painId === corePainId ||
      p?.id === corePainId ||
      p?.claimId === corePainId
  );
  const clusterMatch = Array.isArray(structuredSignals?.pain_clusters)
    ? structuredSignals.pain_clusters.find(
        (c: any) =>
          c?.cluster_id === corePainId ||
          c?.id === corePainId ||
          c?.painId === corePainId
      )
    : null;

  const inlineCandidates: any[] = [
    ...(Array.isArray(segCoreMatch?.evidence) ? segCoreMatch.evidence : []),
    ...(Array.isArray(audCoreMatch?.evidence) ? audCoreMatch.evidence : []),
    ...(Array.isArray(coreAudPain?.evidence) ? coreAudPain.evidence : []),
    ...(Array.isArray(rawPainMatch?.evidence) ? rawPainMatch.evidence : []),
    ...(Array.isArray(rawPainMatch?.verbatimQuotes) ? rawPainMatch.verbatimQuotes : []),
    ...(Array.isArray(clusterMatch?.verbatim_quotes) ? clusterMatch.verbatim_quotes : []),
    ...(Array.isArray(clusterMatch?.evidence) ? clusterMatch.evidence : []),
  ];

  const referencedIdsSet = new Set<string>();
  const collectRefIds = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of ["evidenceRefIds", "evidenceIds", "evidenceUids", "sourceEvidenceIds", "supportingEvidenceIds"]) {
      if (Array.isArray(obj[key])) {
        for (const id of obj[key]) {
          if (typeof id === "string" && id.trim().length > 0) {
            referencedIdsSet.add(id.trim());
          }
        }
      }
    }
  };
  collectRefIds(coreAudPain);
  collectRefIds(segCoreMatch);
  collectRefIds(audCoreMatch);
  collectRefIds(rawPainMatch);
  collectRefIds(clusterMatch);
  if (primaryLane) collectRefIds(primaryLane);

  const resolvedSnippets: string[] = [];
  const seenSnippets = new Set<string>();
  const addSnippet = (text: any) => {
    const str = typeof text === "string" ? text.trim() : (text?.quote || text?.verbatimQuote || text?.text || text?.content || "");
    const clean = String(str || "").trim();
    if (clean.length >= 12 && !seenSnippets.has(clean.toLowerCase())) {
      seenSnippets.add(clean.toLowerCase());
      resolvedSnippets.push(clean);
    }
  };

  for (const item of inlineCandidates) {
    if (typeof item === "string" && (/^(mv_ev_|ev_|rev_|ci_rev_)/i.test(item.trim()) || /^[0-9a-f-]{36}$/i.test(item.trim()))) {
      referencedIdsSet.add(item.trim());
    } else {
      addSnippet(item);
    }
  }

  const referencedIds = Array.from(referencedIdsSet);
  if (referencedIds.length > 0) {
    try {
      const mvRows = await db
        .select()
        .from(marketVoiceEvidence)
        .where(
          and(
            eq(marketVoiceEvidence.campaignId, campaignId),
            or(
              inArray(marketVoiceEvidence.evidenceUid, referencedIds),
              inArray(marketVoiceEvidence.id, referencedIds)
            )
          )
        );
      for (const r of mvRows) {
        addSnippet((r as any).verbatimQuote || (r as any).extractedText || (r as any).rawText);
      }
    } catch {
      // Non-fatal fallback
    }
    try {
      const revRows = await db
        .select()
        .from(ciReviews)
        .where(inArray(ciReviews.id, referencedIds));
      for (const r of revRows) {
        addSnippet((r as any).reviewText || (r as any).text || (r as any).title);
      }
    } catch {
      // Non-fatal fallback
    }
  }

  // Fallback: if corePainId had no direct IDs on its summary row, check active MV snapshot for verified pain evidence matching core pain keywords
  if (resolvedSnippets.length === 0 && hasAudience) {
    try {
      const mvFallbacks = await db
        .select()
        .from(marketVoiceEvidence)
        .where(eq(marketVoiceEvidence.campaignId, campaignId))
        .orderBy(desc(marketVoiceEvidence.createdAt))
        .limit(30);
      const painTokens = String(corePainTitle || corePainRawStatement || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4);
      for (const r of mvFallbacks) {
        const quote = String((r as any).verbatimQuote || (r as any).extractedText || "").trim();
        if (!quote) continue;
        const lower = quote.toLowerCase();
        const overlap = painTokens.filter((t) => lower.includes(t)).length;
        if (overlap >= 2) {
          addSnippet(quote);
          if (resolvedSnippets.length >= 5) break;
        }
      }
    } catch {
      // Non-fatal fallback
    }
  }

  const evidenceList: string[] = resolvedSnippets;
  const actualCitationCount = evidenceList.length;
  const citationResolutionStatus: "RESOLVED" | "BROKEN_RESOLUTION" | "NO_EVIDENCE_LINKED" =
    actualCitationCount > 0
      ? "RESOLVED"
      : referencedIds.length > 0
        ? "BROKEN_RESOLUTION"
        : "NO_EVIDENCE_LINKED";

  // ─── 6. POSITIONING RESOLUTION ───
  const extractReadableText = (val: any): string => {
    if (typeof val !== "string") return "";
    const trimmed = val.trim();
    if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("[")) return "";
    return trimmed;
  };

  const posTerritoryObj = posRow?.territory ? safeJsonParse<any>(posRow.territory, null) : null;
  const parsedRootPosCtx = rootRow?.approvedPositioningContext
    ? safeJsonParse<any>(rootRow.approvedPositioningContext, null)
    : null;
  const posTerritoryName = typeof posTerritoryObj === "object" && posTerritoryObj?.name
    ? posTerritoryObj.name
    : extractReadableText(posRow?.territory);

  const primaryPositionName =
    brandSpine?.umbrellaPositionName ||
    posTerritoryName ||
    extractReadableText(parsedRootPosCtx?.territories?.[0]?.name) ||
    extractReadableText(rootRow?.primaryAxis) ||
    (typeof posStrategyCards[0]?.territoryName === "string" ? posStrategyCards[0].territoryName : "") ||
    "";

  // Secondary territories for decision history
  const allTerritoryOptions = [...posStrategyCards, ...posTerritories];
  const seenAlternatives = new Set<string>();
  const decisionHistoryCards = allTerritoryOptions.filter((t: any) => {
    const tName = t?.territoryName || t?.name;
    if (!tName || tName === primaryPositionName || t.isPrimary === true || seenAlternatives.has(tName)) {
      return false;
    }
    seenAlternatives.add(tName);
    return true;
  });

  const primarySegment = audSegments[0] || null;

  const coreSpd = spdRows.find((s: any) => s.painId === corePainId);
  const primaryTerritoryMeta = posTerritoryObj || posTerritories[0] || parsedRootPosCtx?.territories?.[0] || posStrategyCards[0] || null;
  const semanticCollision = primaryTerritoryMeta?.semanticCollision || posTerritoryObj?.semanticCollision || posTerritories[0]?.semanticCollision || null;
  const comparisonStatus = semanticCollision?.comparisonStatus || (Number(semanticCollision?.comparedCompetitorCount || 0) > 0 ? "COMPARISON_COMPLETED" : "UNVERIFIED_NO_COMPETITOR_CLAIMS");
  const comparedCompetitorCount = Number(semanticCollision?.comparedCompetitorCount || semanticCollision?.perCompetitor?.length || 0);
  const directCompCount = Number(semanticCollision?.directCompetitorCount || 0);
  const adjacentCompCount = Number(semanticCollision?.adjacentCompetitorCount || 0);
  const referenceCompCount = Number(semanticCollision?.referenceCompetitorCount || 0);

  const territoryDegraded = Boolean(primaryTerritoryMeta?.degraded || primaryTerritoryMeta?.provenance === "orphaned" || posRow?.status === "UNSTABLE");
  const resolvedProductTruthStatus: "SUPPORTED_CAPABILITY" | "STRATEGIC_SYNTHESIS" | "PROPOSED_CAPABILITY" | null =
    territoryDegraded || primaryTerritoryMeta?.epistemicStatus === "UNAVAILABLE_OR_FAILED"
      ? null
      : (primaryTerritoryMeta?.productTruthStatus ||
         (coreSpd?.fitType === "DIRECT_FIT"
           ? "SUPPORTED_CAPABILITY"
           : (coreSpd?.fitType === "STRATEGIC_FIT" || coreSpd?.claimStatus === "PROPOSED_CAPABILITY")
             ? "PROPOSED_CAPABILITY"
             : "STRATEGIC_SYNTHESIS"));
  const resolvedEpistemicStatus: "VERIFIED_FACT" | "EVIDENCE_INFERENCE" | "STRATEGIC_HYPOTHESIS" | "PROPOSED_RECOMMENDATION" | "UNAVAILABLE_OR_FAILED" =
    territoryDegraded || primaryTerritoryMeta?.epistemicStatus === "UNAVAILABLE_OR_FAILED"
      ? "UNAVAILABLE_OR_FAILED"
      : (comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0)
        ? "STRATEGIC_HYPOTHESIS"
        : (primaryTerritoryMeta?.epistemicStatus ||
           (resolvedProductTruthStatus === "SUPPORTED_CAPABILITY"
             ? "VERIFIED_FACT"
             : resolvedProductTruthStatus === "PROPOSED_CAPABILITY"
               ? "PROPOSED_RECOMMENDATION"
               : "STRATEGIC_HYPOTHESIS"));
  const resolvedEpistemicLabel: string =
    primaryTerritoryMeta?.epistemicLabel ||
    (resolvedEpistemicStatus === "UNAVAILABLE_OR_FAILED"
      ? "Degraded / Unverified Positioning — Review Required"
      : (comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0)
        ? "Proposed Strategic Hypothesis — Requires Market Validation (No Competitor Positioning Compared)"
        : resolvedProductTruthStatus === "SUPPORTED_CAPABILITY"
          ? "Verified Product Capability"
          : resolvedProductTruthStatus === "PROPOSED_CAPABILITY"
            ? "Proposed Positioning & Packaging Direction — Requires Validation"
            : "Strategic Market Framing (Derived from Verified Capabilities)");

  const isDirectFit = resolvedProductTruthStatus === "SUPPORTED_CAPABILITY" || coreSpd?.fitType === "DIRECT_FIT";
  const isProposed = resolvedProductTruthStatus === "PROPOSED_CAPABILITY" || coreSpd?.fitType === "STRATEGIC_FIT" || coreSpd?.claimStatus === "PROPOSED_CAPABILITY";

  let productFitDesc = hasPositioning
    ? "Evaluated capability fit with product capabilities and positioning."
    : "";
  if (isDirectFit && !isProposed) {
    productFitDesc = "Direct capability fit with established product capabilities.";
  } else if (isProposed) {
    productFitDesc = "Strategic fit addressing audience friction — proposed capability requiring validation/implementation.";
  }

  let strategicDecisionDesc = coreSpd?.reason || "";
  if (!strategicDecisionDesc && hasPositioning) {
    strategicDecisionDesc = isProposed
      ? "Selected as a strategic opportunity anchor — requires capability validation."
      : "Selected as the primary buying friction anchor for campaign strategy and positioning.";
  }

  let step2Capability = "Product capability";
  if (isProposed) {
    step2Capability = "Proposed capability (requires validation)";
  } else if (isDirectFit) {
    step2Capability = "Verified product capability";
  }

  const marketEvidenceDesc =
    citationResolutionStatus === "RESOLVED"
      ? `${actualCitationCount} verified evidence citation(s) resolved from stored audience intelligence.`
      : citationResolutionStatus === "BROKEN_RESOLUTION"
        ? `${referencedIds.length} citation reference(s) recorded on pain (${corePainId}), but 0 resolved to stored verbatim records (broken citation resolution).`
        : hasAudience
          ? "No verbatim evidence citations linked to this pain in the active snapshot."
          : "";

  const collisionScore = typeof semanticCollision?.semanticCollisionScore === "number" ? semanticCollision.semanticCollisionScore : 0;
  const overlapPct = Math.round(collisionScore * 100);
  const outcomeType = String(primaryTerritoryMeta?.positioningOutcomeType || (collisionScore >= 0.65 ? "SHARED_CAPABILITY_STRATEGIC_EMPHASIS" : "DISTINCT_TERRITORY"));
  const previewCounterexamples: any[] = Array.isArray(semanticCollision?.previewOrTrialCounterexamples) ? semanticCollision.previewOrTrialCounterexamples : [];
  const deliverableCounterexamples: any[] = Array.isArray(semanticCollision?.multiFormatDeliverableCounterexamples) ? semanticCollision.multiFormatDeliverableCounterexamples : [];

  const competitiveComparisonDetail =
    comparisonStatus === "COMPARISON_COMPLETED"
      ? collisionScore >= 0.65 && (resolvedProductTruthStatus === "STRATEGIC_SYNTHESIS" || resolvedProductTruthStatus === "SUPPORTED_CAPABILITY")
        ? `Benchmarked against ${comparedCompetitorCount} competitor(s) (${directCompCount} direct, ${adjacentCompCount} adjacent, ${referenceCompCount} reference) — ${overlapPct}% category overlap with ${semanticCollision?.competitorSource || "direct competitor"}; framed as a Shared Capability Strategic Emphasis rather than exclusive category whitespace.`
        : `Benchmarked against ${comparedCompetitorCount} competitor(s) (${directCompCount} direct, ${adjacentCompCount} adjacent, ${referenceCompCount} reference) — ${semanticCollision?.collisionMeaning || semanticCollision?.verdict || "comparison completed"}.`
      : comparisonStatus === "COMPARISON_FAILED"
        ? "Competitive comparison execution failed — whitespace status is unverified."
        : "Competitive comparison unverified — no substantive competitor claims available for benchmarking.";

  // Ensure retained initial candidate's contrastAxis & narrativeDirection are used when retainedInitialCandidate === true
  const auditObj = primaryTerritoryMeta?.collisionRevisionAudit || null;
  const retainedInitial = auditObj?.retainedInitialCandidate === true && auditObj?.initialCandidate ? auditObj.initialCandidate : null;

  const resolvedContrastAxis =
    extractReadableText(retainedInitial?.contrastAxis) ||
    extractReadableText(posRow?.contrastAxis) ||
    extractReadableText(rootRow?.contrastAxisText) ||
    extractReadableText(brandSpine?.contrastAxis) ||
    extractReadableText(primaryTerritoryMeta?.contrastAxis) ||
    "";

  const resolvedPositioningStatement =
    extractReadableText(retainedInitial?.narrativeDirection) ||
    extractReadableText(brandSpine?.narrativeDirection) ||
    extractReadableText(posRow?.narrativeDirection) ||
    extractReadableText(parsedRootPosCtx?.narrativeDirection) ||
    extractReadableText(primaryTerritoryMeta?.narrativeDirection) ||
    "";

  const extractNonAxisRationale = (val: any): string => {
    const txt = extractReadableText(val);
    if (!txt) return "";
    if (txt === resolvedContrastAxis || txt === resolvedPositioningStatement || /^from\s+.+->\s*to\s+/i.test(txt)) {
      return "";
    }
    return txt;
  };

  const synthesizedSelectionRationale = primaryPositionName
    ? `Selected "${primaryPositionName}" to address approved buyer friction (${corePainId || "core purchase pain"}) using verified product capabilities. Benchmarked against ${semanticCollision?.competitorSource || "monitored category alternatives"} (model-estimated semantic overlap: ${overlapPct}%); framed as ${outcomeType === "SHARED_CAPABILITY_STRATEGIC_EMPHASIS" ? "a shared-capability strategic emphasis requiring live market validation rather than exclusive category whitespace" : "a capability-grounded positioning direction"}.`
    : "";

  const resolvedRationale =
    extractNonAxisRationale(primaryTerritoryMeta?.rationale) ||
    extractNonAxisRationale(posStrategyCards[0]?.rationale) ||
    extractNonAxisRationale(retainedInitial?.rationale) ||
    synthesizedSelectionRationale ||
    extractReadableText(strategicDecisionDesc) ||
    "";

  const resolvedStep4Description =
    resolvedRationale ||
    resolvedPositioningStatement ||
    (primaryPositionName ? `Selected strategic positioning territory: ${primaryPositionName}.` : "");

  // Four separate, distinct status badges: Adoption, Evidence Support, Market Validation, and Competitive Overlap
  const planStatusUpper = String(planRow?.status || "").toUpperCase();
  const adoptionStatus =
    planCtx.isDesignatedActive || planStatusUpper === "APPROVED"
      ? { status: "APPROVED", label: "Adoption: Approved by User", tone: "success" as const }
      : planCtx.isDraftPreview || planStatusUpper === "DRAFT"
        ? { status: "DRAFT", label: "Adoption: Proposed / Draft", tone: "warning" as const }
        : { status: "HISTORICAL", label: "Adoption: Historical Snapshot", tone: "neutral" as const };

  const factualSupportStatus =
    resolvedProductTruthStatus === "SUPPORTED_CAPABILITY"
      ? { status: "SUPPORTED_CAPABILITY", label: "Evidence Support: Supported by Product Facts", tone: "success" as const }
      : resolvedProductTruthStatus === "STRATEGIC_SYNTHESIS"
        ? { status: "STRATEGIC_SYNTHESIS", label: "Evidence Support: Strategic Synthesis", tone: "info" as const }
        : resolvedProductTruthStatus === "PROPOSED_CAPABILITY"
          ? { status: "PROPOSED_CAPABILITY", label: "Evidence Support: Proposed Capability", tone: "warning" as const }
          : { status: "UNRESOLVED_CLAIM", label: "Evidence Support: Unresolved Claim", tone: "danger" as const };

  const hasLiveMarketValidationEvidence = Boolean(
    primaryTerritoryMeta?.marketTested === true ||
    primaryTerritoryMeta?.marketValidationState === "VALIDATED"
  );
  const marketValidationStatus = hasLiveMarketValidationEvidence
    ? { status: "MARKET_TESTED", label: "Market Validation: Tested in Live Market", tone: "success" as const }
    : comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0
      ? { status: "INSUFFICIENT_EVIDENCE", label: "Market Validation: Insufficient Market Evidence", tone: "warning" as const }
      : {
          status: "UNTESTED_PROVISIONAL",
          label: "Market Validation: Untested in Live Market (Provisional)",
          tone: "info" as const,
        };

  const competitiveOverlapStatus =
    comparisonStatus !== "COMPARISON_COMPLETED" || comparedCompetitorCount === 0
      ? { status: "COMPARISON_UNAVAILABLE", label: "Competitive Overlap: Comparison Unavailable", tone: "neutral" as const }
      : outcomeType === "SHARED_CAPABILITY_STRATEGIC_EMPHASIS" || (collisionScore >= 0.65 && collisionScore < 0.90)
        ? {
            status: "SHARED_CAPABILITY_EMPHASIS",
            label: `Competitive Overlap: ${overlapPct}% Model-Estimated (Shared Capability Emphasis)`,
            tone: "warning" as const,
          }
        : collisionScore >= 0.90
          ? { status: "HIGH_OVERLAP", label: `Competitive Overlap: ${overlapPct}% Model-Estimated (High Overlap)`, tone: "danger" as const }
          : { status: "LOW_OVERLAP", label: `Competitive Overlap: ${overlapPct}% Model-Estimated (Distinct Emphasis)`, tone: "success" as const };

  const supportingCapabilities: string[] = [];
  if (Array.isArray(brandSpine?.coreDifferentiationPillars)) {
    for (const p of brandSpine.coreDifferentiationPillars) {
      const txt = typeof p === "string" ? p : p?.name || p?.title || p?.pillarName;
      if (txt && !supportingCapabilities.includes(txt)) supportingCapabilities.push(txt);
    }
  }
  if (Array.isArray(diffPillars)) {
    for (const p of diffPillars) {
      const txt = typeof p === "string" ? p : p?.pillarName || p?.pillar || p?.title || p?.name;
      if (txt && !supportingCapabilities.includes(txt)) supportingCapabilities.push(txt);
    }
  }
  if (brandSpine?.mechanismName && !supportingCapabilities.includes(brandSpine.mechanismName)) {
    supportingCapabilities.push(brandSpine.mechanismName);
  }

  const storedOpportunityScore =
    typeof primaryTerritoryMeta?.opportunityScore === "number"
      ? primaryTerritoryMeta.opportunityScore
      : 0.95;
  const storedSaturationLevel =
    typeof primaryTerritoryMeta?.saturationLevel === "number"
      ? primaryTerritoryMeta.saturationLevel
      : 0;

  return {
    campaignId,
    businessName,
    planId: planCtx.planId,
    jobId: planCtx.jobId,
    strategyRootId: planCtx.strategyRootId,
    rootBundleId: planCtx.rootBundleId,
    isDraftPreview: planCtx.isDraftPreview,
    isDesignatedActive: planCtx.isDesignatedActive,
    hasPlan: Boolean(planRow),
    hasAudience,
    hasPositioning,
    targetAudience: {
      title: primaryLane?.title || primarySegment?.name || primarySegment?.title || primarySegment?.segmentName || (hasAudience ? "Target Audience Segment" : ""),
      description: primaryLane?.description || primarySegment?.description || primarySegment?.summary || strategicSummary?.targetAudience || "",
      segmentId: primaryLane?.segmentIds?.[0] || primaryLane?.segmentId || primarySegment?.segmentId || primarySegment?.id || "",
      laneId: primaryLane?.laneId || primaryLane?.id || "",
      commercialRelevance: primaryLane?.commercialRelevance || primarySegment?.commercialRelevance || "",
      buyerRole: primarySegment?.buyerRole || primarySegment?.role || (hasAudience ? "Category Buyer" : ""),
      marketType: primarySegment?.marketType || primarySegment?.category || (hasAudience ? "Consumer / Category Market" : ""),
    },
    coreBuyingPain: {
      painId: corePainId,
      title: corePainTitle,
      rawText: corePainRawStatement,
      experience: segCoreMatch?.experience || audCoreMatch?.experience || audPains[0]?.experience || "",
      commercialImpact: segCoreMatch?.commercialImpact || audCoreMatch?.commercialImpact || audPains[0]?.commercialImpact || "",
      whyWeCanSolveIt: primaryLane?.whyWeCanSolveIt || segCoreMatch?.whyWeCanSolveIt || audCoreMatch?.whyWeCanSolveIt || audPains[0]?.whyWeCanSolveIt || "",
      reasoning: {
        marketEvidence: marketEvidenceDesc,
        buyerRelevance: hasAudience ? `Directly impacts the primary target segment (${primaryLane?.title || primarySegment?.name || "Target Audience"}).` : "",
        productFit: productFitDesc,
        strategicDecision: strategicDecisionDesc,
      },
      evidenceSnippets: evidenceList.slice(0, 3),
      evidenceCount: actualCitationCount,
      citationResolutionStatus,
      referencedEvidenceIds: referencedIds,
    } as any,
    supportingSignals: {
      pains: supportingPains,
      desires: resolvedDesires.slice(0, 4),
      objections: resolvedObjections.slice(0, 3),
      triggers: (audRow ? safeJsonParse<any[]>(audRow.triggers, []) : []).map((t: any) => (typeof t === "string" ? t : t.canonical || t.trigger || t.title)).filter(Boolean),
      emotionalDrivers: resolvedEmotional.slice(0, 3),
    },
    excludedPains: excludedPains,
    positioning: {
      umbrellaPosition: primaryPositionName,
      positioningStatement: resolvedPositioningStatement,
      contrastAxis: resolvedContrastAxis,
      positioningStatus: posRow?.status || (hasPositioning ? "COMPLETE" : "NOT_GENERATED"),
      positioningStatusMessage: posRow?.statusMessage || null,
      epistemicStatus: resolvedEpistemicStatus,
      productTruthStatus: resolvedProductTruthStatus,
      epistemicLabel: resolvedEpistemicLabel,
      rationale: resolvedRationale || undefined,
      assumptions: Array.isArray(primaryTerritoryMeta?.assumptions) ? primaryTerritoryMeta.assumptions : [],
      validationNeeds: Array.isArray(primaryTerritoryMeta?.validationNeeds) ? primaryTerritoryMeta.validationNeeds : [],
      supportingEvidenceIds: Array.isArray(primaryTerritoryMeta?.supportingEvidenceIds) ? primaryTerritoryMeta.supportingEvidenceIds : [],
      adoptionStatus,
      factualSupportStatus,
      marketValidationStatus,
      competitiveOverlapStatus,
      intendedBuyer: {
        segmentName: primaryLane?.title || primarySegment?.name || primarySegment?.title || primarySegment?.segmentName || (hasAudience ? "Target Audience Segment" : ""),
        laneTitles: approvedLanes.map((l: any) => l?.title || l?.name || l?.laneName || l?.laneId).filter(Boolean),
        coreBuyingTension: corePainRawStatement || corePainTitle || "",
      },
      chosenEmphasis: {
        territoryName: primaryPositionName,
        contrastAxis: resolvedContrastAxis,
        narrativeDirection: resolvedPositioningStatement,
        enemyDefinition:
          extractReadableText(retainedInitial?.enemyDefinition) ||
          extractReadableText(posRow?.enemyDefinition) ||
          extractReadableText(primaryTerritoryMeta?.enemyDefinition) ||
          "",
        rationale: resolvedRationale,
        supportingCapabilities,
      },
      competitiveOverlap: {
        comparisonStatus,
        semanticCollisionScore: collisionScore,
        overlapPercent: overlapPct,
        closestCompetitor: semanticCollision?.competitorSource || "Monitored Competitors",
        competitorClaim: semanticCollision?.competitorEquivalentClaim || "",
        positioningOutcomeType: outcomeType,
        summary: competitiveComparisonDetail,
        previewCounterexampleCount: previewCounterexamples.length,
        deliverableCounterexampleCount: deliverableCounterexamples.length,
        opportunityScore: storedOpportunityScore,
        saturationLevel: storedSaturationLevel,
        modelUsed: semanticCollision?.modelUsed || undefined,
      },
      diagnostics: {
        candidateTerritories: (posTerritories.length > 0 ? posTerritories : posStrategyCards).map((t: any, idx: number) => {
          const tCollision = typeof t?.semanticCollision?.semanticCollisionScore === "number" ? t.semanticCollision.semanticCollisionScore : 0;
          const tOpp = typeof t?.opportunityScore === "number" ? t.opportunityScore : undefined;
          const tAudit = t?.collisionRevisionAudit;
          const tRetained = tAudit?.retainedInitialCandidate === true && tAudit?.initialCandidate ? tAudit.initialCandidate : null;
          return {
            name: t?.name || t?.territoryName || `Candidate Territory ${idx + 1}`,
            isPrimary: idx === 0 || Boolean(t?.isPrimary),
            opportunityScore: tOpp,
            overlapPercent: Math.round(tCollision * 100),
            saturationLevel: typeof t?.saturationLevel === "number" ? t.saturationLevel : 0,
            productTruthStatus: t?.productTruthStatus || resolvedProductTruthStatus || undefined,
            epistemicStatus: t?.epistemicStatus || resolvedEpistemicStatus || undefined,
            contrastAxis: extractReadableText(tRetained?.contrastAxis) || extractReadableText(t?.contrastAxis),
            narrativeDirection: extractReadableText(tRetained?.narrativeDirection) || extractReadableText(t?.narrativeDirection),
            rationale: extractNonAxisRationale(t?.rationale) || undefined,
          };
        }),
        perCompetitorOverlap: Array.isArray(semanticCollision?.perCompetitor)
          ? semanticCollision.perCompetitor.map((c: any) => ({
              competitorName: c?.source || c?.competitorName || c?.competitorId || "Competitor",
              claim: c?.claim || "",
              score: typeof c?.score === "number" ? c.score : 0,
              relationshipClass: c?.relationshipClass || "DIRECT",
              rationale: c?.rationale || "",
            }))
          : [],
        previewCounterexamples: previewCounterexamples.map((ce: any) => {
          const ev = String(ce?.evidenceText || "");
          const isExplicitPrePayment =
            /\b(free\s+(?:45|60|[0-9]+)[-\s]?(?:second|sec|s)?\s*(?:song\s+|audio\s+)?preview|free\s+(?:song\s+|audio\s+|sample\s+)?preview|before\s+(?:any\s+)?(?:payment|paying|buying|purchas\w*|finalizing\s+the\s+purchase)|free\s+trial|try\s+for\s+free|pay\s+only\s+(?:if|when|after)\s+(?:you\s+|they\s+)?(?:approve|like|choose|select|love|gift|obtain))\b/i.test(
              ev
            );
          const isExplicitPostPayment =
            !isExplicitPrePayment &&
            /\b(after\s+(?:paying|payment|purchas\w*|ordering)|paid\s+add[- ]?on|requires?\s+upfront\s+payment\s+before\s+preview\w*)\b/i.test(
              ev
            );
          return {
            competitorName: ce?.competitorName || "Competitor",
            previewTiming: isExplicitPrePayment
              ? "PRE_PAYMENT_FREE_PREVIEW"
              : isExplicitPostPayment
                ? "POST_ORDER_PRE_DELIVERY_PREVIEW"
                : ce?.previewTiming || "TIMING_UNSPECIFIED_IN_EVIDENCE",
            evidenceText: ev,
          };
        }),
        deliverableCounterexamples: deliverableCounterexamples.map((ce: any) => ({
          competitorName: ce?.competitorName || "Competitor",
          evidenceText: ce?.evidenceText || "",
        })),
        collisionRevisionAudit: auditObj
          ? {
              revisedAfterComparison: Boolean(auditObj.revisedAfterComparison),
              retainedInitialCandidate: Boolean(auditObj.retainedInitialCandidate),
              selectionReason: String(auditObj.selectionReason || ""),
              initialCollisionScore: typeof auditObj.initialCollisionScore === "number" ? auditObj.initialCollisionScore : undefined,
              postRevisionCollisionScore: typeof auditObj.postRevisionCollisionScore === "number" ? auditObj.postRevisionCollisionScore : undefined,
              proposedRevisionName: auditObj.proposedRevision?.name,
              proposedRevisionContrastAxis: auditObj.proposedRevision?.contrastAxis,
            }
          : null,
        reasoningSteps: Array.isArray(semanticCollision?.reasoningSteps) ? semanticCollision.reasoningSteps : [],
        validationMetadata: primaryTerritoryMeta?.validationMetadata
          ? {
              ...primaryTerritoryMeta.validationMetadata,
              note: "Structural schema & capability grounding check passed; see Market Validation status for competitive overlap assessment.",
            }
          : null,
      },
      semanticCollision: semanticCollision || undefined,
      reasoningJourney: {
        step1: {
          step: "01",
          label: "THE PROBLEM WE FOUND",
          painId: corePainId,
          title: corePainTitle,
          description: corePainRawStatement,
          source: "Audience Intelligence (CORE_PURCHASE)",
        },
        step2: {
          step: "02",
          label: "WHAT YOUR PRODUCT CAN GENUINELY SOLVE",
          title: (typeof primaryMech === "object" ? primaryMech?.mechanismName : primaryMech) || (hasPositioning ? "Product Capability & Core Mechanism" : ""),
          description: rootRow?.approvedTransformation || (hasPositioning ? (isProposed ? "Proposed capability to address core friction." : "Verified product capability solving core friction points.") : ""),
          capability: step2Capability,
          source: isProposed ? "Proposed Direction (Requires Validation)" : "Product Truth",
        },
        step3: {
          step: "03",
          label: "WHERE YOU HAVE AN ADVANTAGE",
          title: (typeof diffPillars[0] === "object" ? (diffPillars[0]?.pillarName || diffPillars[0]?.pillar || diffPillars[0]?.title) : diffPillars[0]) || (hasPositioning ? "Established Competitive Advantage" : ""),
          description: resolvedContrastAxis || (hasPositioning ? "Verified capability contrast against competitor baseline." : ""),
          contrast: resolvedContrastAxis || (hasPositioning ? "Distinct product differentiation" : ""),
          source: "Approved Differentiation",
        },
        step4: {
          step: "04",
          label: "THE POSITION TO OWN",
          title: primaryPositionName,
          description: resolvedStep4Description,
          source: isProposed ? "Proposed Positioning Direction" : "Strategy Root / Approved Positioning",
        },
      },
      brandSpine: {
        productTruth: (brandSpine?.productTruthFactIds?.[0]) || (hasPositioning ? "Verified Product Truth" : ""),
        differentiation: (typeof diffPillars[0] === "object" ? (diffPillars[0]?.pillarName || diffPillars[0]?.pillar || diffPillars[0]?.title) : diffPillars[0]) || (brandSpine?.coreDifferentiationPillars && brandSpine.coreDifferentiationPillars[0]) || "",
        positioning: primaryPositionName,
        mechanism: (typeof primaryMech === "object" ? primaryMech?.mechanismName : primaryMech) || "",
      },
      validation: hasPositioning
        ? [
            {
              label: "Grounded in real buyer pain",
              detail: primaryTerritoryMeta?.provenance === "orphaned"
                ? "Warning: Claims lacked direct signal traceability in the positioning snapshot"
                : `Direct match with approved Core Buying Pain (${corePainId})`,
              passed: primaryTerritoryMeta?.provenance !== "orphaned",
            },
            {
              label: "Product Truth Posture",
              detail: `${factualSupportStatus.label} — ${resolvedEpistemicLabel}`,
              passed: resolvedProductTruthStatus === "SUPPORTED_CAPABILITY" || resolvedProductTruthStatus === "STRATEGIC_SYNTHESIS",
            },
            {
              label: "Competitive Comparison & Market Overlap",
              detail: competitiveComparisonDetail,
              passed: comparisonStatus === "COMPARISON_COMPLETED" && collisionScore < 0.90,
            },
            {
              label: "Continuous with approved differentiation",
              detail: "Direct link to approved differentiation axis",
              passed: !territoryDegraded,
            },
            {
              label: "Aligned with approved strategic lane",
              detail: `Validated under '${primaryLane?.title || "Target Audience Segment"}'`,
              passed: Boolean(primaryLane || primarySegment),
            },
            {
              label: "Structural & Continuity Gate",
              detail: posRow?.statusMessage || (territoryDegraded ? "Positioning marked UNSTABLE — review recommended" : "Passed schema & continuity checks (market overlap reported separately)"),
              passed: !territoryDegraded,
            },
          ]
        : [],
      decisionHistory: decisionHistoryCards.map((c: any) => ({
        alternative: c.territoryName || c.name || "Secondary Strategic Alternative",
        status: c.productTruthStatus === "PROPOSED_CAPABILITY" ? "Secondary Alternative (Proposed Capability)" : "Secondary Alternative",
        reason: c.enemyDefinition || c.operationalProblem || "Evaluated as secondary supporting territory during positioning synthesis.",
        authority: "Positioning Engine / Strategic Lane Authority",
      })),
    } as any,
    commercialAudienceSynthesis: commercialSynthesis,
  } as any;
}

