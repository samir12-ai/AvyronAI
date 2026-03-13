import type { SemanticSignalCategory, SemanticSignal, CompetitorContentDNA } from "../market-intelligence-v3/types";
import type { SignalQualityScore } from "../shared/signal-quality-gate";

const CLEAN_PIPE_CONFIDENCE_FLOOR = 0.85;

export interface BridgedSignal {
  canonical: string;
  category: "pain" | "desire" | "objection";
  sourceCategory: SemanticSignalCategory | string;
  snippet: string;
  strength: number;
  parentSignalId: string;
  competitorId: string;
  competitorName: string;
  confidenceScore: number;
  bridgeSource: "semantic_signal" | "content_dna";
}

export interface SemanticBridgeResult {
  painSignals: BridgedSignal[];
  desireSignals: BridgedSignal[];
  objectionSignals: BridgedSignal[];
  totalIngested: number;
  totalFiltered: number;
  totalPassed: number;
  bridgeIntegrity: boolean;
  conflictsResolved: number;
  cleanPipeEnforced: boolean;
}

const PAIN_CATEGORIES: SemanticSignalCategory[] = ["pain_signal"];
const PAIN_DNA_TYPES = ["hook:problem", "narrative:problem_solution", "narrative:mistake_fix"];
const DESIRE_DNA_TYPES = ["narrative:before_after", "narrative:story_lesson", "narrative:how_to"];
const OBJECTION_DNA_TYPES = ["cta:trust", "narrative:mistake_fix"];
const DESIRE_CATEGORIES: SemanticSignalCategory[] = ["desire_signal", "transformation_statement"];
const OBJECTION_CATEGORIES: SemanticSignalCategory[] = ["audience_objection", "competitor_weakness"];

function generateSignalId(source: string, category: string, competitorId: string, index: number): string {
  return `bridge_${source}_${category}_${competitorId}_${index}`;
}

function canonicalizePainSnippet(snippet: string): string {
  const lower = snippet.toLowerCase();
  if (/frustrat|fed up|sick of|tired of/.test(lower)) return "frustration with lack of results";
  if (/confus|overwhelm|too much|don't understand/.test(lower)) return "confusion and overwhelm";
  if (/no time|too busy|takes too long|busy schedule/.test(lower)) return "time pressure";
  if (/expensive|can't afford|cost|pric|budget/.test(lower)) return "cost and affordability concerns";
  if (/scam|fake|legit|trust|too good/.test(lower)) return "trust and credibility doubts";
  if (/afraid|scared|fear|worried|risk|fail/.test(lower)) return "fear of failure";
  if (/stuck|no results|not working|plateau|waste/.test(lower)) return "frustration with lack of results";
  if (/motivat|consisten|discipline|give up|quit/.test(lower)) return "motivation and consistency issues";
  return snippet.slice(0, 80).trim();
}

function canonicalizeDesireSnippet(snippet: string): string {
  const lower = snippet.toLowerCase();
  if (/muscle|strong|lean|bulk|physique/.test(lower)) return "build muscle / get stronger";
  if (/confiden|self.?esteem|believe/.test(lower)) return "increase confidence";
  if (/money|income|financ|wealth|revenue/.test(lower)) return "financial improvement";
  if (/time|freedom|automat|passive/.test(lower)) return "save time / freedom";
  if (/recogni|status|social|influen/.test(lower)) return "social recognition";
  if (/health|energy|wellness|vitality/.test(lower)) return "health and wellness";
  if (/transform|life.?chang|success|achieve|breakthrough/.test(lower)) return "transformational outcome";
  if (/scale|grow|10x|doubl|tripl/.test(lower)) return "scale and growth";
  return snippet.slice(0, 80).trim();
}

function canonicalizeObjectionSnippet(snippet: string): string {
  const lower = snippet.toLowerCase();
  if (/expensive|afford|cost|pric|budget/.test(lower)) return "too expensive";
  if (/no time|busy|time/.test(lower)) return "no time";
  if (/tried|before|didn't work|already/.test(lower)) return "tried before and failed";
  if (/skeptic|doubt|too good|fake|scam|real/.test(lower)) return "skeptical / trust issues";
  if (/complex|hard|difficult|complicated/.test(lower)) return "complexity / too hard";
  if (/don't|fail|miss|lack|gap|inferior|limit/.test(lower)) return "perceived limitations";
  if (/cheap|overpric|empty|overhype|cookie|generic/.test(lower)) return "competitor credibility gap";
  return snippet.slice(0, 80).trim();
}

function extractSemanticBridgeSignals(
  signalData: any[],
  qualityGateResults: SignalQualityScore[] | null,
): BridgedSignal[] {
  const bridged: BridgedSignal[] = [];
  if (!signalData || !Array.isArray(signalData)) return bridged;

  const qualityMap = new Map<string, number>();
  if (qualityGateResults) {
    for (const qr of qualityGateResults) {
      qualityMap.set(`${qr.sourceCompetitor}_${qr.category}_${qr.snippet?.slice(0, 50)}`, qr.qualityScore);
    }
  }

  for (const competitorResult of signalData) {
    const competitorId = competitorResult.competitorId || "unknown";
    const competitorName = competitorResult.competitorName || "unknown";
    const semanticSignals: SemanticSignal[] = competitorResult.semanticSignals || [];

    let idx = 0;
    for (const signal of semanticSignals) {
      const lookupKey = `${competitorName}_${signal.category}_${signal.snippet?.slice(0, 50)}`;
      const qualityScore = qualityMap.get(lookupKey) ?? signal.strength;

      if (qualityScore < CLEAN_PIPE_CONFIDENCE_FLOOR) {
        idx++;
        continue;
      }

      const parentSignalId = generateSignalId("semantic", signal.category, competitorId, idx);

      if (PAIN_CATEGORIES.includes(signal.category)) {
        bridged.push({
          canonical: canonicalizePainSnippet(signal.snippet),
          category: "pain",
          sourceCategory: signal.category,
          snippet: signal.snippet,
          strength: signal.strength,
          parentSignalId,
          competitorId,
          competitorName,
          confidenceScore: qualityScore,
          bridgeSource: "semantic_signal",
        });
      } else if (DESIRE_CATEGORIES.includes(signal.category)) {
        bridged.push({
          canonical: canonicalizeDesireSnippet(signal.snippet),
          category: "desire",
          sourceCategory: signal.category,
          snippet: signal.snippet,
          strength: signal.strength,
          parentSignalId,
          competitorId,
          competitorName,
          confidenceScore: qualityScore,
          bridgeSource: "semantic_signal",
        });
      } else if (OBJECTION_CATEGORIES.includes(signal.category)) {
        bridged.push({
          canonical: canonicalizeObjectionSnippet(signal.snippet),
          category: "objection",
          sourceCategory: signal.category,
          snippet: signal.snippet,
          strength: signal.strength,
          parentSignalId,
          competitorId,
          competitorName,
          confidenceScore: qualityScore,
          bridgeSource: "semantic_signal",
        });
      }
      idx++;
    }
  }

  return bridged;
}

function extractContentDnaBridgeSignals(
  contentDnaData: CompetitorContentDNA[],
): BridgedSignal[] {
  const bridged: BridgedSignal[] = [];
  if (!contentDnaData || !Array.isArray(contentDnaData)) return bridged;

  for (const dna of contentDnaData) {
    if (dna.dnaConfidence < CLEAN_PIPE_CONFIDENCE_FLOOR) continue;

    const competitorId = dna.competitorId || "unknown";
    const competitorName = dna.competitorName || "unknown";

    if (!dna.evidence || !Array.isArray(dna.evidence)) continue;

    let idx = 0;
    for (const ev of dna.evidence) {
      const parentSignalId = generateSignalId("dna", ev.detectedType, competitorId, idx);
      const snippet = ev.snippet || "";

      if (PAIN_DNA_TYPES.includes(ev.detectedType)) {
        bridged.push({
          canonical: canonicalizePainSnippet(snippet),
          category: "pain",
          sourceCategory: ev.detectedType,
          snippet,
          strength: dna.dnaConfidence,
          parentSignalId,
          competitorId,
          competitorName,
          confidenceScore: dna.dnaConfidence,
          bridgeSource: "content_dna",
        });
      }

      if (DESIRE_DNA_TYPES.includes(ev.detectedType)) {
        bridged.push({
          canonical: canonicalizeDesireSnippet(snippet),
          category: "desire",
          sourceCategory: ev.detectedType,
          snippet,
          strength: dna.dnaConfidence,
          parentSignalId,
          competitorId,
          competitorName,
          confidenceScore: dna.dnaConfidence,
          bridgeSource: "content_dna",
        });
      }

      if (OBJECTION_DNA_TYPES.includes(ev.detectedType)) {
        bridged.push({
          canonical: canonicalizeObjectionSnippet(snippet),
          category: "objection",
          sourceCategory: ev.detectedType,
          snippet,
          strength: dna.dnaConfidence,
          parentSignalId,
          competitorId,
          competitorName,
          confidenceScore: dna.dnaConfidence,
          bridgeSource: "content_dna",
        });
      }
      idx++;
    }

    for (const hookType of dna.hookArchetypes || []) {
      if (hookType === "problem") {
        const hookEvidence = dna.evidence.filter(e => e.detectedType === "hook:problem");
        for (let i = 0; i < hookEvidence.length; i++) {
          const ev = hookEvidence[i];
          bridged.push({
            canonical: canonicalizePainSnippet(ev.snippet || ""),
            category: "pain",
            sourceCategory: "hook:problem",
            snippet: ev.snippet || "",
            strength: dna.dnaConfidence,
            parentSignalId: generateSignalId("dna_hook", "problem", competitorId, i),
            competitorId,
            competitorName,
            confidenceScore: dna.dnaConfidence,
            bridgeSource: "content_dna",
          });
        }
      }
    }

    for (const framework of dna.narrativeFrameworks || []) {
      if (framework === "before_after") {
        const baEvidence = dna.evidence.filter(e => e.detectedType === "narrative:before_after");
        for (let i = 0; i < baEvidence.length; i++) {
          const ev = baEvidence[i];
          bridged.push({
            canonical: canonicalizeDesireSnippet(ev.snippet || ""),
            category: "desire",
            sourceCategory: "narrative:before_after",
            snippet: ev.snippet || "",
            strength: dna.dnaConfidence,
            parentSignalId: generateSignalId("dna_narrative", "before_after", competitorId, i),
            competitorId,
            competitorName,
            confidenceScore: dna.dnaConfidence,
            bridgeSource: "content_dna",
          });
        }
      }
    }
  }

  return bridged;
}

interface ConflictResolutionResult {
  resolved: BridgedSignal[];
  conflictsDetected: number;
}

function resolveConflicts(
  existingSignals: { canonical: string; frequency: number; confidenceScore: number }[],
  bridgedSignals: BridgedSignal[],
): ConflictResolutionResult {
  let conflictsDetected = 0;
  const resolved: BridgedSignal[] = [];

  const existingMap = new Map<string, { frequency: number; confidenceScore: number }>();
  for (const s of existingSignals) {
    existingMap.set(s.canonical.toLowerCase(), { frequency: s.frequency, confidenceScore: s.confidenceScore });
  }

  for (const bridged of bridgedSignals) {
    const existingMatch = existingMap.get(bridged.canonical.toLowerCase());

    if (existingMatch) {
      if (bridged.confidenceScore >= CLEAN_PIPE_CONFIDENCE_FLOOR) {
        conflictsDetected++;
        resolved.push(bridged);
      }
    } else {
      resolved.push(bridged);
    }
  }

  return { resolved, conflictsDetected };
}

export function executeSemanticBridge(
  miSnapshot: any,
): SemanticBridgeResult {
  const emptyResult: SemanticBridgeResult = {
    painSignals: [],
    desireSignals: [],
    objectionSignals: [],
    totalIngested: 0,
    totalFiltered: 0,
    totalPassed: 0,
    bridgeIntegrity: true,
    conflictsResolved: 0,
    cleanPipeEnforced: true,
  };

  if (!miSnapshot) return emptyResult;

  let signalData: any[] = [];
  let contentDnaData: CompetitorContentDNA[] = [];
  let qualityGateResults: SignalQualityScore[] | null = null;

  try {
    signalData = typeof miSnapshot.signalData === "string"
      ? JSON.parse(miSnapshot.signalData) : (miSnapshot.signalData || []);
  } catch { signalData = []; }

  try {
    contentDnaData = typeof miSnapshot.contentDnaData === "string"
      ? JSON.parse(miSnapshot.contentDnaData) : (miSnapshot.contentDnaData || []);
  } catch { contentDnaData = []; }

  try {
    const diagnosticsRaw = typeof miSnapshot.diagnosticsData === "string"
      ? JSON.parse(miSnapshot.diagnosticsData) : (miSnapshot.diagnosticsData || {});
    const gateData = diagnosticsRaw?.signalQualityGate;
    if (gateData?.passedSignalIds) {
      qualityGateResults = null;
    }
  } catch {}

  const semanticBridged = extractSemanticBridgeSignals(signalData, qualityGateResults);
  const dnaBridged = extractContentDnaBridgeSignals(contentDnaData);

  const allBridged = [...semanticBridged, ...dnaBridged];
  const totalIngested = allBridged.length;

  const orphanSignals = allBridged.filter(s => !s.parentSignalId);
  if (orphanSignals.length > 0) {
    console.log(`[SemanticBridge] INTEGRITY_VIOLATION | orphanSignals=${orphanSignals.length} | blocked=true`);
    return {
      ...emptyResult,
      bridgeIntegrity: false,
      totalIngested,
      totalFiltered: totalIngested,
    };
  }

  const painSignals = allBridged.filter(s => s.category === "pain");
  const desireSignals = allBridged.filter(s => s.category === "desire");
  const objectionSignals = allBridged.filter(s => s.category === "objection");

  const totalPassed = painSignals.length + desireSignals.length + objectionSignals.length;
  const totalFiltered = totalIngested - totalPassed;

  console.log(`[SemanticBridge] BRIDGE_COMPLETE | ingested=${totalIngested} | passed=${totalPassed} | filtered=${totalFiltered} | pains=${painSignals.length} | desires=${desireSignals.length} | objections=${objectionSignals.length}`);

  return {
    painSignals,
    desireSignals,
    objectionSignals,
    totalIngested,
    totalFiltered,
    totalPassed,
    bridgeIntegrity: true,
    conflictsResolved: 0,
    cleanPipeEnforced: true,
  };
}

export function mergeBridgedIntoAudienceMap(
  existingSignals: { canonical: string; frequency: number; evidence: string[]; evidenceCount: number; confidenceScore: number; sourceSignals: string[]; inputSnapshotId: string | null }[],
  bridgedSignals: BridgedSignal[],
  miSnapshotId: string | null,
): { merged: typeof existingSignals; conflictsResolved: number } {
  if (bridgedSignals.length === 0) return { merged: existingSignals, conflictsResolved: 0 };

  const { resolved, conflictsDetected } = resolveConflicts(existingSignals, bridgedSignals);

  const mergedMap = new Map<string, typeof existingSignals[0]>();

  for (const s of existingSignals) {
    mergedMap.set(s.canonical.toLowerCase(), { ...s });
  }

  for (const bridged of resolved) {
    const key = bridged.canonical.toLowerCase();
    const existing = mergedMap.get(key);

    if (existing) {
      existing.frequency += 1;
      existing.evidenceCount += 1;
      if (existing.evidence.length < 3) {
        existing.evidence.push(`[MI:${bridged.bridgeSource}] ${bridged.snippet.slice(0, 120)}`);
      }
      existing.confidenceScore = Math.max(existing.confidenceScore, bridged.confidenceScore);
      if (!existing.sourceSignals.includes(bridged.parentSignalId)) {
        existing.sourceSignals.push(bridged.parentSignalId);
      }
    } else {
      mergedMap.set(key, {
        canonical: bridged.canonical,
        frequency: 1,
        evidence: [`[MI:${bridged.bridgeSource}] ${bridged.snippet.slice(0, 120)}`],
        evidenceCount: 1,
        confidenceScore: bridged.confidenceScore,
        sourceSignals: [bridged.parentSignalId],
        inputSnapshotId: miSnapshotId,
      });
    }
  }

  const merged = Array.from(mergedMap.values()).sort((a, b) => b.confidenceScore - a.confidenceScore);

  return { merged, conflictsResolved: conflictsDetected };
}

export function validateBridgeIntegrity(bridgeResult: SemanticBridgeResult): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!bridgeResult.bridgeIntegrity) {
    issues.push("Bridge integrity failed: orphan signals detected without parent_signal_id");
  }

  if (!bridgeResult.cleanPipeEnforced) {
    issues.push("Clean-pipe not enforced: unverified signals may have passed confidence threshold");
  }

  const allSignals = [...bridgeResult.painSignals, ...bridgeResult.desireSignals, ...bridgeResult.objectionSignals];
  const orphans = allSignals.filter(s => !s.parentSignalId);
  if (orphans.length > 0) {
    issues.push(`Inference without evidence: ${orphans.length} signal(s) lack parent_signal_id`);
  }

  const belowThreshold = allSignals.filter(s => s.confidenceScore < CLEAN_PIPE_CONFIDENCE_FLOOR);
  if (belowThreshold.length > 0) {
    issues.push(`Clean-pipe violation: ${belowThreshold.length} signal(s) below ${CLEAN_PIPE_CONFIDENCE_FLOOR} confidence`);
  }

  return { valid: issues.length === 0, issues };
}
