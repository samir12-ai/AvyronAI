import type {
  EngineIntegrityCheck,
  CrossEngineAlignmentCheck,
  IntegrityReport,
} from "./types";
import type { SignalGovernanceState } from "../signal-governance/types";
import { checkSignalLeakage } from "../signal-governance/engine";

const ALIGNMENT_CHAIN: Array<[string, string]> = [
  ["audience", "positioning"],
  ["positioning", "differentiation"],
  ["differentiation", "mechanism"],
  ["mechanism", "offer"],
  ["offer", "funnel"],
  ["audience", "awareness"],
  ["awareness", "persuasion"],
];

function extractTextContent(output: any): string[] {
  if (!output) return [];
  const texts: string[] = [];

  function walk(obj: any, depth: number) {
    if (depth > 5) return;
    if (typeof obj === "string" && obj.length > 10) {
      texts.push(obj);
    } else if (Array.isArray(obj)) {
      for (const item of obj.slice(0, 50)) walk(item, depth + 1);
    } else if (obj && typeof obj === "object") {
      for (const key of Object.keys(obj).slice(0, 30)) {
        if (key === "snapshotId" || key === "createdAt" || key === "updatedAt") continue;
        walk(obj[key], depth + 1);
      }
    }
  }
  walk(output, 0);
  return texts;
}

function checkOutputTraceability(output: any, sglTraceToken: string | null, engineId: string): boolean {
  if (!output) return false;
  const texts = extractTextContent(output);
  if (texts.length === 0) return false;
  if (output.status === "SIGNAL_GROUNDING_FAILED" || output.status === "SIGNAL_REQUIRED" ||
      output.status === "SIGNAL_DRIFT" || output.status === "DEPTH_FAILED") {
    return false;
  }
  if (output.confidenceScore !== undefined && output.confidenceScore === 0) {
    return false;
  }
  return true;
}

function detectLeakage(output: any): { found: boolean; details: string[] } {
  const texts = extractTextContent(output);
  const details: string[] = [];
  for (const text of texts.slice(0, 100)) {
    const result = checkSignalLeakage(text);
    if (!result.clean) {
      details.push(`Leakage in text: "${text.slice(0, 60)}..." — patterns: [${result.leaks.join(",")}]`);
    }
  }
  return { found: details.length > 0, details };
}

function findOrphanOutputs(output: any, sglSignalTexts: Set<string>): string[] {
  if (!output || sglSignalTexts.size === 0) return [];
  const orphans: string[] = [];

  const claims: string[] = [];
  if (output.validatedClaims) {
    for (const c of output.validatedClaims) {
      claims.push(typeof c === "string" ? c : c.claim || c.title || "");
    }
  }
  if (output.territories) {
    for (const t of output.territories) {
      claims.push(t.name || "");
    }
  }
  if (output.claims) {
    for (const c of output.claims) {
      claims.push(typeof c === "string" ? c : c.claim || c.title || "");
    }
  }

  for (const claim of claims.filter(c => c.length > 5)) {
    const claimWords = new Set(claim.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    let matched = false;
    for (const sigText of sglSignalTexts) {
      const sigWords = new Set(sigText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      let overlap = 0;
      for (const w of claimWords) {
        if (sigWords.has(w)) overlap++;
      }
      if (overlap >= 2 || (claimWords.size <= 3 && overlap >= 1)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      orphans.push(claim.slice(0, 100));
    }
  }
  return orphans;
}

function checkAlignmentPair(
  sourceOutput: any,
  targetOutput: any,
  sourceId: string,
  targetId: string,
): CrossEngineAlignmentCheck {
  if (!sourceOutput || !targetOutput) {
    return {
      sourceEngine: sourceId,
      targetEngine: targetId,
      aligned: true,
      alignmentScore: 0,
      mismatches: !sourceOutput ? [`${sourceId} has no output`] : [`${targetId} has no output`],
    };
  }

  const sourceTexts = extractTextContent(sourceOutput);
  const targetTexts = extractTextContent(targetOutput);

  if (sourceTexts.length === 0 || targetTexts.length === 0) {
    return {
      sourceEngine: sourceId,
      targetEngine: targetId,
      aligned: true,
      alignmentScore: 0.5,
      mismatches: [],
    };
  }

  const sourceWords = new Set<string>();
  for (const text of sourceTexts.slice(0, 30)) {
    for (const word of text.toLowerCase().split(/\s+/).filter(w => w.length > 4)) {
      sourceWords.add(word);
    }
  }

  let matchCount = 0;
  let totalWords = 0;
  for (const text of targetTexts.slice(0, 30)) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    totalWords += words.length;
    for (const word of words) {
      if (sourceWords.has(word)) matchCount++;
    }
  }

  const alignmentScore = totalWords > 0 ? Math.min(1, matchCount / Math.min(totalWords, 50)) : 0;
  const aligned = alignmentScore >= 0.05;

  const mismatches: string[] = [];
  if (!aligned) {
    mismatches.push(`Low vocabulary overlap between ${sourceId} and ${targetId} (score=${alignmentScore.toFixed(3)})`);
  }

  return {
    sourceEngine: sourceId,
    targetEngine: targetId,
    aligned,
    alignmentScore: Math.round(alignmentScore * 1000) / 1000,
    mismatches,
  };
}

export function runSystemIntegrityValidation(
  engineOutputs: Record<string, any>,
  sglState: SignalGovernanceState | null,
): IntegrityReport {
  const reportId = `SIV_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const engineChecks: EngineIntegrityCheck[] = [];
  const crossAlignments: CrossEngineAlignmentCheck[] = [];
  const failureReasons: string[] = [];

  const sglSignalTexts = new Set<string>();
  if (sglState) {
    for (const sig of sglState.governedSignals) {
      sglSignalTexts.add(sig.text);
    }
  }

  const ENGINE_IDS = [
    "market_intelligence", "audience", "positioning",
    "differentiation", "mechanism", "offer",
    "funnel", "awareness", "persuasion",
  ];

  for (const eid of ENGINE_IDS) {
    const output = engineOutputs[eid];

    if (!output) {
      engineChecks.push({
        engineId: eid,
        status: "SKIPPED",
        receivedValidSignals: false,
        outputTraceable: false,
        signalMappingComplete: false,
        noRawDataPassthrough: true,
        alignedWithUpstream: true,
        leakageDetected: false,
        orphanOutputs: [],
        details: [`${eid} has no output — skipped or blocked`],
      });
      continue;
    }

    if (output.status === "SIGNAL_BLOCKED" || output.status === "DEPTH_BLOCKED" ||
        output.status === "MISSING_DEPENDENCY" || output.status === "SIGNAL_GROUNDING_FAILED" ||
        output.status === "SIGNAL_REQUIRED" || output.status === "SIGNAL_DRIFT") {
      engineChecks.push({
        engineId: eid,
        status: "BLOCKED",
        receivedValidSignals: false,
        outputTraceable: false,
        signalMappingComplete: false,
        noRawDataPassthrough: true,
        alignedWithUpstream: false,
        leakageDetected: false,
        orphanOutputs: [],
        details: [`${eid} was blocked: ${output.statusMessage || output.status}`],
      });
      failureReasons.push(`${eid}: ${output.status} — ${output.statusMessage || "blocked"}`);
      continue;
    }

    const sglConsumed = sglState?.consumptionLog.find(c => c.engineId === eid);
    const receivedValidSignals = eid === "market_intelligence" || eid === "audience" || !!sglConsumed;
    const outputTraceable = checkOutputTraceability(output, sglState?.traceToken || null, eid);
    const leakageResult = detectLeakage(output);
    const orphans = findOrphanOutputs(output, sglSignalTexts);

    const signalMappingComplete = eid === "market_intelligence" || eid === "audience" ||
      (receivedValidSignals && (sglConsumed?.signalsConsumed.length || 0) > 0);

    const sglCoverageFailed = sglConsumed && !sglConsumed.coverageReport.coverageSufficient;

    const details: string[] = [];
    if (!receivedValidSignals && eid !== "market_intelligence" && eid !== "audience") {
      details.push(`${eid} did not consume signals through SGL`);
    }
    if (sglCoverageFailed) {
      details.push(`SGL coverage insufficient: missing [${sglConsumed!.coverageReport.missingCategories.join(",")}]`);
    }
    if (leakageResult.found) {
      details.push(...leakageResult.details.slice(0, 3));
    }
    if (orphans.length > 0) {
      details.push(`${orphans.length} orphan output(s) not traceable to source signals`);
    }
    if (!outputTraceable) {
      details.push(`Output not traceable — engine returned failure status or zero confidence`);
    }

    let status: "PASS" | "FAIL" = "PASS";
    if (leakageResult.found || !outputTraceable) {
      status = "FAIL";
    }
    if (!receivedValidSignals && eid !== "market_intelligence" && eid !== "audience") {
      status = "FAIL";
    }
    if (status === "FAIL") {
      failureReasons.push(`${eid}: ${details.join("; ")}`);
    }

    engineChecks.push({
      engineId: eid,
      status,
      receivedValidSignals,
      outputTraceable,
      signalMappingComplete,
      noRawDataPassthrough: !leakageResult.found,
      alignedWithUpstream: true,
      leakageDetected: leakageResult.found,
      orphanOutputs: orphans.slice(0, 5),
      details,
    });
  }

  for (const [sourceId, targetId] of ALIGNMENT_CHAIN) {
    const sourceOutput = engineOutputs[sourceId];
    const targetOutput = engineOutputs[targetId];
    const alignment = checkAlignmentPair(sourceOutput, targetOutput, sourceId, targetId);
    crossAlignments.push(alignment);

    const check = engineChecks.find(c => c.engineId === targetId);
    if (check && !alignment.aligned) {
      check.alignedWithUpstream = false;
      check.details.push(`Misaligned with upstream ${sourceId}`);
      failureReasons.push(`Cross-engine: ${targetId} not aligned with ${sourceId}`);
    }
  }

  const signalFlowVerified = engineChecks
    .filter(c => c.status !== "SKIPPED" && c.status !== "BLOCKED")
    .every(c => c.receivedValidSignals || c.engineId === "market_intelligence" || c.engineId === "audience");

  const traceabilityComplete = engineChecks
    .filter(c => c.status !== "SKIPPED" && c.status !== "BLOCKED")
    .every(c => c.outputTraceable);

  const zeroLeakage = engineChecks.every(c => !c.leakageDetected);

  const noOrphanOutputs = engineChecks.every(c => c.orphanOutputs.length === 0);

  const signalCoverageComplete = sglState?.coverageReport.coverageSufficient ?? false;

  const allAligned = crossAlignments.every(a => a.aligned);

  const passedCount = engineChecks.filter(c => c.status === "PASS").length;
  const totalActive = engineChecks.filter(c => c.status !== "SKIPPED").length;

  let overallStatus: "PASS" | "FAIL" | "PARTIAL";
  if (failureReasons.length === 0 && signalFlowVerified && traceabilityComplete && zeroLeakage && allAligned) {
    overallStatus = "PASS";
  } else if (passedCount > 0) {
    overallStatus = "PARTIAL";
  } else {
    overallStatus = "FAIL";
  }

  const summary =
    `SystemIntegrityValidator | status=${overallStatus} | ` +
    `engines=${passedCount}/${totalActive} passed | ` +
    `signalFlow=${signalFlowVerified} | traceability=${traceabilityComplete} | ` +
    `leakage=${!zeroLeakage} | orphans=${!noOrphanOutputs} | ` +
    `crossAlignment=${allAligned} | signalCoverage=${signalCoverageComplete} | ` +
    `failures=${failureReasons.length}`;

  console.log(`[SIV] ${summary}`);

  return {
    reportId,
    timestamp: new Date().toISOString(),
    overallStatus,
    engineChecks,
    crossEngineAlignment: crossAlignments,
    signalFlowVerified,
    traceabilityComplete,
    zeroLeakage,
    noOrphanOutputs,
    signalCoverageComplete,
    summary,
    failureReasons,
    sglTraceToken: sglState?.traceToken || null,
  };
}
