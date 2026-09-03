/**
 * Adapters for Existing Avyron Artifacts to Canonical Adaptive Contracts
 * 
 * Constitutional Principle:
 * Connect existing database models and snapshots to canonical Authority Envelopes,
 * Adaptive Signals, Competitor Sources, and Evidence Items without duplicate authorities.
 */

import {
  AuthorityEnvelope,
  AdaptiveSignal,
  CompetitorSource,
  EvidenceItem,
  StrategicAuthorityName,
} from "./contracts";

/**
 * Wraps any arbitrary strategic payload into a standard AuthorityEnvelope.
 */
export function wrapInAuthorityEnvelope<T>(
  authorityType: StrategicAuthorityName | string,
  artifactId: string,
  campaignId: string,
  accountId: string,
  payload: T,
  options?: {
    runId?: string | null;
    strategyRootId?: string | null;
    strategyRootVersion?: number | null;
    entityIds?: string[];
    evidenceIds?: string[];
    generatedAt?: string;
  }
): AuthorityEnvelope<T> {
  return {
    authorityType,
    artifactId,
    campaignId,
    accountId,
    runId: options?.runId || null,
    strategyRootId: options?.strategyRootId || null,
    strategyRootVersion: options?.strategyRootVersion || null,
    entityIds: options?.entityIds || [],
    evidenceIds: options?.evidenceIds || [],
    generatedAt: options?.generatedAt || new Date().toISOString(),
    payload,
    envelopeVersion: "1.0.0",
  };
}

/**
 * Adapts a Strategy Root row to an AuthorityEnvelope.
 */
export function adaptStrategyRootToEnvelope(root: any): AuthorityEnvelope<any> {
  const lanes = typeof root.approvedLanes === "string" ? JSON.parse(root.approvedLanes) : (root.approvedLanes || []);
  const laneIds = lanes.map((l: any) => l.laneId || l.id).filter(Boolean);

  return wrapInAuthorityEnvelope(
    "STRATEGY_ROOT",
    root.id,
    root.campaignId,
    root.accountId,
    root,
    {
      runId: root.runId,
      strategyRootId: root.id,
      strategyRootVersion: root.rootVersion || root.version || 1,
      entityIds: laneIds,
      generatedAt: root.createdAt instanceof Date ? root.createdAt.toISOString() : (root.createdAt || new Date().toISOString()),
    }
  );
}

/**
 * Adapts a Differentiation Snapshot to an AuthorityEnvelope.
 */
export function adaptDifferentiationToEnvelope(snapshot: any): AuthorityEnvelope<any> {
  const data = typeof snapshot.snapshotData === "string" 
    ? JSON.parse(snapshot.snapshotData) 
    : (snapshot.snapshotData || snapshot.primaryRoute || snapshot);

  return wrapInAuthorityEnvelope(
    "DIFFERENTIATION",
    snapshot.id,
    snapshot.campaignId,
    snapshot.accountId,
    data,
    {
      runId: snapshot.jobId,
      strategyRootId: snapshot.strategyRootId,
      entityIds: [],
      evidenceIds: [],
      generatedAt: snapshot.createdAt instanceof Date ? snapshot.createdAt.toISOString() : (snapshot.createdAt || new Date().toISOString()),
    }
  );
}

/**
 * Adapts a PerformanceContext row to an AdaptiveSignal.
 */
export function adaptPerformanceContextToSignal(context: any): AdaptiveSignal | null {
  const signals = adaptPerformanceContextToSignals(context);
  return signals.length > 0 ? signals[0] : null;
}

/**
 * Extracts all discrete performance warnings/signals from a PerformanceContext container row.
 * One PerformanceContext (container) -> multiple discrete AdaptiveSignals (each with its own signalId).
 * 
 * Constitutional Principle:
 * A warning represents a discrete problem, not a healthy baseline or empty state.
 * If primaryBottleneck is 'NONE' or 'UNKNOWN', no bottleneck warning is produced.
 * If there are no bottlenecks or proof gaps, an empty array is returned.
 */
export function adaptPerformanceContextToSignals(context: any): AdaptiveSignal[] {
  if (!context) return [];

  const evidenceIds = Array.isArray(context.evidenceRefIds)
    ? context.evidenceRefIds
    : (typeof context.evidenceRefIds === "string" ? JSON.parse(context.evidenceRefIds) : []);

  const severityMap: Record<string, any> = {
    HIGH: "CRITICAL",
    MEDIUM: "HIGH",
    LOW: "MEDIUM",
  };

  const confidenceScore = context.confidence === "HIGH" ? 0.9 : (context.confidence === "MEDIUM" ? 0.7 : 0.4);
  const signals: AdaptiveSignal[] = [];

  // Discrete primary bottleneck signal (only if a real bottleneck exists)
  const normBottleneck = (context.primaryBottleneck || "").toUpperCase().trim();
  if (normBottleneck && normBottleneck !== "UNKNOWN" && normBottleneck !== "NONE" && normBottleneck !== "NULL") {
    signals.push({
      signalId: `sig_perf_bottleneck_${context.id}`,
      campaignId: context.campaignId || context.campaign_id,
      accountId: context.accountId || context.account_id,
      sourceDomain: "PERFORMANCE",
      sourceArtifactId: context.id, // Parent container ID
      entityIds: [context.businessExecutionStateId || context.business_execution_state_id].filter(Boolean),
      evidenceIds,
      signalType: context.primaryBottleneck,
      summary: context.currentReality || `Performance bottleneck identified: ${context.primaryBottleneck}`,
      severity: severityMap[context.confidence] || "MEDIUM",
      confidence: confidenceScore,
      observedAt: context.createdAt instanceof Date ? context.createdAt.toISOString() : (context.createdAt || new Date().toISOString()),
      createdAt: new Date().toISOString(),
      metadata: {
        mode: context.mode,
        bottleneck: context.primaryBottleneck,
      },
    });
  }

  // Discrete weakest signals / proof gaps
  const weakest = Array.isArray(context.weakestSignals) ? context.weakestSignals : [];
  for (let i = 0; i < weakest.length; i++) {
    const rawGap = weakest[i];
    if (rawGap && rawGap !== "NONE" && rawGap !== "UNKNOWN") {
      signals.push({
        signalId: `sig_perf_gap_${context.id}_${i}`,
        campaignId: context.campaignId || context.campaign_id,
        accountId: context.accountId || context.account_id,
        sourceDomain: "PERFORMANCE",
        sourceArtifactId: context.id, // Parent container ID
        entityIds: [context.businessExecutionStateId].filter(Boolean),
        evidenceIds,
        signalType: "PERFORMANCE_GAP",
        summary: rawGap,
        severity: "HIGH",
        confidence: confidenceScore,
        observedAt: context.createdAt instanceof Date ? context.createdAt.toISOString() : (context.createdAt || new Date().toISOString()),
        createdAt: new Date().toISOString(),
        metadata: {
          mode: context.mode,
          gapIndex: i,
        },
      });
    }
  }

  return signals;
}

/**
 * Adapts a Watchtower / PipelineChangeEvent row to an AdaptiveSignal.
 */
export function adaptWatchtowerEventToAdaptiveSignal(
  event: any,
  options?: {
    confirmationState?: "PRELIMINARY" | "CONFIRMED" | "CONTRADICTED" | "CLOSED" | "EXPIRED" | "REVERTED";
    evidenceIds?: string[];
  }
): AdaptiveSignal {
  let resolvedConfirmationState: "PRELIMINARY" | "CONFIRMED" | "CONTRADICTED" | "CLOSED" | "EXPIRED" | "REVERTED" = "PRELIMINARY";

  if (options?.confirmationState) {
    resolvedConfirmationState = options.confirmationState;
  } else if (event.status === "confirmed" || (event.validatedAt !== null && event.validatedAt !== undefined)) {
    resolvedConfirmationState = "CONFIRMED";
  } else if (event.status === "archived" || event.status === "dismissed" || event.status === "superseded" || event.status === "reverted") {
    resolvedConfirmationState = event.status === "reverted" ? "REVERTED" : "CLOSED";
  } else {
    resolvedConfirmationState = "PRELIMINARY";
  }

  let extractedEvidenceIds: string[] = options?.evidenceIds || [];
  if (extractedEvidenceIds.length === 0 && event.evidence) {
    if (Array.isArray(event.evidence)) {
      extractedEvidenceIds = event.evidence;
    } else if (typeof event.evidence === "string") {
      try {
        const parsed = JSON.parse(event.evidence);
        if (Array.isArray(parsed)) {
          extractedEvidenceIds = parsed.map((e: any) => typeof e === "string" ? e : (e.evidenceUid || e.id)).filter(Boolean);
        } else if (parsed && typeof parsed === "object") {
          extractedEvidenceIds = Object.values(parsed).filter((v: any) => typeof v === "string");
        }
      } catch {
        extractedEvidenceIds = [event.evidence];
      }
    }
  }

  const severityMap: Record<string, any> = {
    critical: "CRITICAL",
    high: "HIGH",
    medium: "MEDIUM",
    low: "LOW",
    CRITICAL: "CRITICAL",
    HIGH: "HIGH",
    MEDIUM: "MEDIUM",
    LOW: "LOW",
  };

  return {
    signalId: `sig_watchtower_${event.id}`,
    campaignId: event.campaignId || event.campaign_id,
    accountId: event.accountId || event.account_id,
    sourceDomain: "MARKET",
    sourceArtifactId: event.id, // Watchtower Event ID
    entityIds: [event.competitorId, event.entityId].filter(Boolean),
    competitorId: event.competitorId || null,
    evidenceIds: extractedEvidenceIds,
    signalType: event.kind || event.changeDimension || event.eventType || "MARKET_CHANGE_EVENT",
    summary: event.evidenceSummary || `Watchtower market change: ${event.kind || event.changeDimension || event.eventType}`,
    severity: severityMap[event.severity] || "MEDIUM",
    confidence: typeof event.confidence === "number" ? event.confidence : 0.85,
    confirmationState: resolvedConfirmationState,
    observedAt: event.eventDate instanceof Date ? event.eventDate.toISOString() : (event.eventDate || event.createdAt instanceof Date ? event.createdAt.toISOString() : new Date().toISOString()),
    createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : (event.createdAt || new Date().toISOString()),
    metadata: {
      kind: event.kind,
      scope: event.scope,
      toValue: event.toValue,
      status: event.status,
      baselineSnapshotId: event.baselineSnapshotId,
      currentSnapshotId: event.currentSnapshotId,
    },
  };
}

/**
 * Legacy alias for adaptWatchtowerEventToAdaptiveSignal.
 */
export const adaptPipelineChangeEventToSignal = adaptWatchtowerEventToAdaptiveSignal;

/**
 * Adapts an EvidenceRegistry row to an EvidenceItem.
 */
export function adaptEvidenceRegistryToItem(evidence: any): EvidenceItem {
  return {
    evidenceId: evidence.evidenceUid || evidence.id,
    campaignId: evidence.campaignId,
    accountId: evidence.accountId,
    competitorId: evidence.sourceTable === "ci_competitors" ? evidence.sourceId : null,
    sourceId: evidence.sourceId || evidence.id,
    snapshotId: null,
    sourceType: evidence.sourceTable || "EVIDENCE_REGISTRY",
    contentType: "REVIEW",
    sourceUrl: "",
    rawText: evidence.detail || "",
    normalizedText: evidence.detail || "",
    publishedAt: evidence.observedAt instanceof Date ? evidence.observedAt.toISOString() : (evidence.observedAt || null),
    capturedAt: evidence.createdAt instanceof Date ? evidence.createdAt.toISOString() : (evidence.createdAt || new Date().toISOString()),
    metadata: {
      kind: evidence.kind,
      label: evidence.label,
    },
  };
}

/**
 * Extracts platform sources from a CI Competitor row.
 */
export function extractCompetitorSources(competitor: any): CompetitorSource[] {
  const sources: CompetitorSource[] = [];
  const compId = competitor.id;
  const campId = competitor.campaignId;
  const accId = competitor.accountId;

  if (competitor.websiteUrl) {
    sources.push({
      sourceId: `src_web_${compId}`,
      competitorId: compId,
      campaignId: campId,
      accountId: accId,
      platform: "WEBSITE",
      canonicalUrl: competitor.websiteUrl,
      status: "ACTIVE",
      activityState: "ACTIVE",
    });
  }

  const socialUrls = typeof competitor.socialUrls === "string" 
    ? JSON.parse(competitor.socialUrls) 
    : (competitor.socialUrls || {});

  const platformMap: Record<string, CompetitorSource["platform"]> = {
    linkedin: "LINKEDIN",
    x: "X",
    twitter: "X",
    instagram: "INSTAGRAM",
    tiktok: "TIKTOK",
    youtube: "YOUTUBE",
    trustpilot: "TRUSTPILOT",
  };

  for (const [key, url] of Object.entries(socialUrls)) {
    if (url && typeof url === "string" && url.startsWith("http")) {
      const platform = platformMap[key.toLowerCase()] || "OTHER";
      sources.push({
        sourceId: `src_${key.toLowerCase()}_${compId}`,
        competitorId: compId,
        campaignId: campId,
        accountId: accId,
        platform,
        canonicalUrl: url,
        status: "ACTIVE",
        activityState: "ACTIVE",
      });
    }
  }

  return sources;
}
