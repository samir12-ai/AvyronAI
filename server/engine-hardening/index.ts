import type {
  DataReliabilityDiagnostics,
  BoundaryCheckResult,
  SignalDiagnostics,
  NarrativeOverlapResult,
  ValidationSession,
  GenericOutputResult,
  AlignmentCheckResult,
  SoftPattern,
  BoundaryEnforcementResult,
} from "./types";

export type {
  DataReliabilityDiagnostics,
  BoundaryCheckResult,
  SignalDiagnostics,
  NarrativeOverlapResult,
  ValidationSession,
  GenericOutputResult,
  AlignmentCheckResult,
  SoftPattern,
  BoundaryEnforcementResult,
};

const GENERIC_PHRASES = [
  "grow your business",
  "scale faster",
  "improve marketing",
  "boost your sales",
  "increase revenue",
  "get more customers",
  "take your business to the next level",
  "maximize your potential",
  "unlock growth",
  "supercharge your",
  "transform your business",
  "level up your",
  "dominate your market",
  "crush the competition",
  "skyrocket your",
  "drive results",
  "game changer",
  "next level",
  "cutting edge",
  "best in class",
  "world class",
  "industry leading",
  "revolutionary",
  "groundbreaking",
  "disruptive",
];

export function sanitizeBoundary(
  text: string,
  blockedPatterns: Record<string, RegExp>
): BoundaryCheckResult {
  const violations: string[] = [];
  for (const [domain, pattern] of Object.entries(blockedPatterns)) {
    if (pattern.test(text)) {
      violations.push(`Boundary violation: output contains "${domain}" domain content`);
    }
  }
  return { clean: violations.length === 0, violations };
}

export function enforceBoundaryWithSanitization(
  text: string,
  hardPatterns: Record<string, RegExp>,
  softPatterns: SoftPattern[],
): BoundaryEnforcementResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  let sanitizedText = text;
  let sanitized = false;

  for (const [domain, pattern] of Object.entries(hardPatterns)) {
    if (pattern.test(text)) {
      violations.push(`Hard boundary violation: "${domain}" domain content detected`);
    }
  }

  if (violations.length > 0) {
    return { clean: false, violations, sanitized: false, sanitizedText: text, warnings };
  }

  for (const sp of softPatterns) {
    if (sp.pattern.test(sanitizedText)) {
      warnings.push(`Soft boundary: "${sp.domain}" wording normalized to "${sp.replacement}"`);
      sanitizedText = sanitizedText.replace(sp.pattern, sp.replacement);
      sanitized = true;
    }
  }

  return { clean: true, violations: [], sanitized, sanitizedText, warnings };
}

export function applySoftSanitization(text: string, softPatterns: SoftPattern[]): string {
  if (!text) return text;
  let result = text;
  for (const sp of softPatterns) {
    result = result.replace(sp.pattern, sp.replacement);
  }
  return result;
}

export function normalizeConfidence(
  rawScore: number,
  reliability: DataReliabilityDiagnostics
): number {
  if (reliability.isWeak) {
    return Math.min(rawScore * 0.6, 0.65);
  }
  if (reliability.overallReliability < 0.6) {
    return Math.min(rawScore * 0.8, 0.80);
  }
  return rawScore;
}

export function assessDataReliability(
  competitorCount: number,
  signalCount: number,
  hasPositioning: boolean,
  hasDifferentiation: boolean,
  hasAudience: boolean,
  upstreamConfidence: number
): DataReliabilityDiagnostics {
  const advisories: string[] = [];

  const signalDensity = Math.min(signalCount / 20, 1.0);
  const competitorValidity = Math.min(competitorCount / 5, 1.0);

  if (signalCount < 5 && competitorCount < 2) {
    advisories.push(`Low signal density AND competitor coverage: only ${signalCount} signals from ${competitorCount} competitor(s) — strategic conclusions may be unreliable`);
  } else if (signalCount < 3 && competitorCount < 3) {
    advisories.push(`Very low signal density: only ${signalCount} signals from ${competitorCount} competitor(s) — insufficient data for reliable analysis`);
  }

  let diversityScore = 0;
  if (hasPositioning) diversityScore += 0.33;
  if (hasDifferentiation) diversityScore += 0.33;
  if (hasAudience) diversityScore += 0.34;
  const signalDiversity = diversityScore;

  const narrativeStability = (hasPositioning && hasDifferentiation) ? 1.0 : 0.5;
  if (!hasPositioning || !hasDifferentiation) {
    advisories.push("Incomplete upstream narrative — positioning or differentiation data missing");
  }

  const marketMaturityConfidence = upstreamConfidence;

  const overallReliability =
    signalDensity * 0.25 +
    signalDiversity * 0.20 +
    narrativeStability * 0.20 +
    competitorValidity * 0.20 +
    marketMaturityConfidence * 0.15;

  const isWeak = overallReliability < 0.45;
  if (isWeak) {
    advisories.push(`Data reliability is WEAK (${overallReliability.toFixed(2)}) — all confidence scores will be capped`);
  }

  return {
    signalDensity,
    signalDiversity,
    narrativeStability,
    competitorValidity,
    marketMaturityConfidence,
    overallReliability,
    isWeak,
    advisories,
  };
}

export function detectGenericOutput(text: string): GenericOutputResult {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of GENERIC_PHRASES) {
    if (lower.includes(phrase)) {
      found.push(phrase);
    }
  }
  const penalty = Math.min(found.length * 0.05, 0.3);
  return {
    genericDetected: found.length > 0,
    genericPhrases: found,
    penalty,
  };
}

const activeSessions = new Map<string, ValidationSession>();
const SESSION_TTL_MS = 5 * 60 * 1000;

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      activeSessions.delete(key);
    }
  }
}

export function checkValidationSession(
  sessionId: string | undefined,
  engineName: string,
  campaignId: string,
  maxCallsPerEngine: number = 2
): { allowed: boolean; warning: string | null } {
  if (!sessionId) {
    return { allowed: true, warning: null };
  }

  cleanExpiredSessions();

  const key = `${sessionId}_${campaignId}`;
  let session = activeSessions.get(key);
  if (!session) {
    session = {
      sessionId,
      campaignId,
      engineCalls: {},
      createdAt: Date.now(),
    };
    activeSessions.set(key, session);
  }

  const currentCalls = session.engineCalls[engineName] || 0;
  if (currentCalls >= maxCallsPerEngine) {
    return {
      allowed: false,
      warning: `Revalidation loop detected: ${engineName} already called ${currentCalls} time(s) in session ${sessionId} — blocking to prevent infinite loop`,
    };
  }

  session.engineCalls[engineName] = currentCalls + 1;
  return { allowed: true, warning: null };
}

export function detectNarrativeOverlap(
  competitorNarratives: string[]
): NarrativeOverlapResult {
  const warnings: string[] = [];
  const duplicates: string[] = [];

  const normalizedNarratives = competitorNarratives.map(n =>
    n.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()
  );

  const phraseCount = new Map<string, number>();
  for (const narrative of normalizedNarratives) {
    const words = narrative.split(/\s+/);
    for (let i = 0; i < words.length - 2; i++) {
      const trigram = words.slice(i, i + 3).join(" ");
      if (trigram.length > 8) {
        phraseCount.set(trigram, (phraseCount.get(trigram) || 0) + 1);
      }
    }
  }

  for (const [phrase, count] of phraseCount.entries()) {
    if (count >= 3) {
      duplicates.push(phrase);
    }
  }

  const overlapScore = Math.min(duplicates.length / 10, 1.0);
  const saturationPenalty = overlapScore * 0.15;

  if (duplicates.length > 0) {
    warnings.push(`Market narrative saturation detected: ${duplicates.length} phrase(s) repeated across 3+ competitors`);
  }

  return {
    overlapDetected: duplicates.length > 0,
    overlapScore,
    duplicateNarratives: duplicates.slice(0, 10),
    saturationPenalty,
    warnings,
  };
}

export function logSignalDiagnostics(
  engineName: string,
  stats: Partial<SignalDiagnostics>
): SignalDiagnostics {
  const diagnostics: SignalDiagnostics = {
    engineName,
    postsProcessed: stats.postsProcessed || 0,
    signalsDetected: stats.signalsDetected || 0,
    signalsFiltered: stats.signalsFiltered || 0,
    signalsUsed: stats.signalsUsed || 0,
    timestamp: Date.now(),
  };
  console.log(
    `[${engineName}] SignalDiagnostics | posts=${diagnostics.postsProcessed} detected=${diagnostics.signalsDetected} filtered=${diagnostics.signalsFiltered} used=${diagnostics.signalsUsed}`
  );
  return diagnostics;
}

export async function pruneOldSnapshots(
  db: any,
  table: any,
  campaignId: string,
  maxRetained: number = 20,
  accountId: string = "default"
): Promise<number> {
  try {
    const { eq, and, desc } = await import("drizzle-orm");
    const all = await db
      .select({ id: table.id, createdAt: table.createdAt })
      .from(table)
      .where(and(eq(table.campaignId, campaignId), eq(table.accountId, accountId)))
      .orderBy(desc(table.createdAt));

    if (all.length <= maxRetained) return 0;

    const toDelete = all.slice(maxRetained);
    const idsToDelete = toDelete.map((r: any) => r.id);

    let deleted = 0;
    for (const id of idsToDelete) {
      await db.delete(table).where(eq(table.id, id));
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[SnapshotPruning] Pruned ${deleted} old snapshot(s) for campaign ${campaignId}`);
    }
    return deleted;
  } catch (error: any) {
    console.error(`[SnapshotPruning] Error pruning snapshots: ${error.message}`);
    return 0;
  }
}

export function checkCrossEngineAlignment(
  checks: Array<{ name: string; aligned: boolean; reason: string }>
): AlignmentCheckResult {
  const misalignments: string[] = [];
  for (const check of checks) {
    if (!check.aligned) {
      misalignments.push(`${check.name}: ${check.reason}`);
    }
  }
  const confidencePenalty = Math.min(misalignments.length * 0.05, 0.2);
  return {
    aligned: misalignments.length === 0,
    misalignments,
    confidencePenalty,
  };
}

export function createEmptyReliability(advisory: string = "Not assessed"): DataReliabilityDiagnostics {
  return {
    signalDensity: 0,
    signalDiversity: 0,
    narrativeStability: 0,
    competitorValidity: 0,
    marketMaturityConfidence: 0,
    overallReliability: 0,
    isWeak: true,
    advisories: [advisory],
  };
}
