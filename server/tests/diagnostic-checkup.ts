import { runOrchestrator } from "../orchestrator/index";
import type { OrchestratorRunResult } from "../orchestrator/index";
import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";

const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

const CAMPAIGNS = [
  { name: "MarketMindAI", campaignId: "campaign_1773576062201_6t0oxi" },
  { name: "SWA Media", campaignId: "campaign_1772334831096_uzmp6t" },
];

const ALL_ENGINE_IDS: EngineId[] = [
  "market_intelligence", "audience", "positioning", "differentiation",
  "mechanism", "offer", "awareness", "funnel", "integrity",
  "persuasion", "statistical_validation", "budget_governor",
  "channel_selection", "iteration", "retention",
];

function safeStr(val: any, maxLen = 200): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return val.slice(0, maxLen);
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try { return JSON.stringify(val).slice(0, maxLen); } catch { return "[unserializable]"; }
}

function deepInspectEngine(engineId: string, result: EngineStepResult | undefined, ssc: any): void {
  const sep = "─".repeat(70);
  console.log(`\n${"═".repeat(70)}`);
  console.log(`ENGINE: ${engineId.toUpperCase()}`);
  console.log(`${"═".repeat(70)}`);

  if (!result) {
    console.log("  STATUS: NOT IN RESULTS (engine never executed)");
    return;
  }

  console.log(`  STATUS: ${result.status}`);
  console.log(`  DURATION: ${result.durationMs ?? "N/A"}ms`);

  if (result.status === "SKIPPED" || result.status === "BLOCKED" || result.status === "SIGNAL_BLOCKED") {
    console.log(`  SKIP REASON: Pipeline halted before this engine`);
    return;
  }

  if (result.status === "ERROR") {
    console.log(`  ERROR: ${safeStr(result.error, 500)}`);
    return;
  }

  const output = result.output;
  if (!output) {
    console.log("  OUTPUT: null (no output produced)");
    return;
  }

  console.log(`\n  ${sep}`);
  console.log("  1. INPUT INTEGRITY");
  console.log(`  ${sep}`);

  if (ssc) {
    const relevantProblems = ssc.problemRegistry?.filter((p: any) =>
      p.relevantEngines?.includes(engineId) || p.sourceEngine === engineId
    ) || [];
    console.log(`  SSC problems relevant to this engine: ${relevantProblems.length}`);
    for (const p of relevantProblems) {
      console.log(`    → ${p.id} [${p.severity}/${p.type}] status=${p.status} | source=${p.sourceEngine} | desc=${safeStr(p.description, 100)}`);
    }
    console.log(`  SSC awareness: ${ssc.awarenessMeaning?.stage || "not set"}`);
    console.log(`  SSC confidenceFloor: ${ssc.confidenceFloor?.toFixed(2) ?? "N/A"}`);
    console.log(`  SSC painMap entries: ${ssc.painMap?.length ?? 0}`);
    console.log(`  SSC desireMap entries: ${ssc.desireMap?.length ?? 0}`);
    console.log(`  SSC objectionMap entries: ${ssc.objectionMap?.length ?? 0}`);
  } else {
    console.log("  SSC: not available in result");
  }

  console.log(`\n  ${sep}`);
  console.log("  2. LOGIC EXECUTION & CONFIDENCE");
  console.log(`  ${sep}`);

  const confidenceScore = output.confidenceScore;
  const engineConfidence = output.engineConfidence;
  const dataConfidence = output.dataConfidence;
  console.log(`  confidenceScore (combined): ${typeof confidenceScore === "number" ? confidenceScore.toFixed(3) : safeStr(confidenceScore)}`);
  console.log(`  engineConfidence: ${typeof engineConfidence === "number" ? engineConfidence.toFixed(3) : safeStr(engineConfidence)}`);
  console.log(`  dataConfidence: ${typeof dataConfidence === "number" ? dataConfidence.toFixed(3) : safeStr(dataConfidence)}`);

  if (ssc) {
    const chainEntry = ssc.confidenceChain?.find((e: any) => e.engineId === engineId);
    if (chainEntry) {
      console.log(`  SSC chain: data=${chainEntry.dataConfidence?.toFixed(2)} engine=${chainEntry.engineConfidence?.toFixed(2)} combined=${chainEntry.combinedConfidence?.toFixed(2)} floor=${chainEntry.inheritedFloor?.toFixed(2)}`);
    }
  }

  switch (engineId) {
    case "market_intelligence":
      console.log(`  marketDiagnosis: ${safeStr(output.marketDiagnosis, 150)}`);
      console.log(`  opportunities: ${Array.isArray(output.opportunities) ? output.opportunities.length : safeStr(output.opportunities)}`);
      console.log(`  threats: ${Array.isArray(output.threats) ? output.threats.length : safeStr(output.threats)}`);
      console.log(`  narrativeObjections: ${output.narrativeObjections?.total ?? "N/A"}`);
      console.log(`  crossSignalDecisions: ${output.crossSignalDecisions?.total ?? "N/A"}`);
      console.log(`  signalQuality: ${safeStr(output.signalQualityGate, 100)}`);
      console.log(`  dataReliability: ${safeStr(output.dataReliability, 150)}`);
      break;

    case "audience":
      console.log(`  segments: ${Array.isArray(output.segments) ? output.segments.length : "N/A"}`);
      console.log(`  pains: ${Array.isArray(output.pains) ? output.pains.length : "N/A"}`);
      if (Array.isArray(output.pains)) {
        for (const p of output.pains.slice(0, 3)) {
          console.log(`    → pain: ${safeStr(p.pain || p.label || p.canonical, 80)} | severity=${p.severity ?? "N/A"}`);
        }
      }
      console.log(`  desires: ${Array.isArray(output.desires) ? output.desires.length : "N/A"}`);
      console.log(`  objections: ${Array.isArray(output.objections) ? output.objections.length : "N/A"}`);
      console.log(`  objectionMap keys: ${output.objectionMap ? Object.keys(output.objectionMap).length : "N/A"}`);
      console.log(`  awarenessLevel: ${safeStr(output.awarenessLevel || output.awareness?.level, 80)}`);
      console.log(`  intentTemperature: ${safeStr(output.intentTemperature, 50)}`);
      break;

    case "positioning":
      console.log(`  positioningAngle: ${safeStr(output.positioningAngle, 120)}`);
      console.log(`  territory: ${safeStr(output.territory?.name || output.territory?.label, 120)}`);
      console.log(`  differentiationVector: ${safeStr(output.differentiationVector, 200)}`);
      console.log(`  contrastAxis: ${safeStr(output.contrastAxis, 120)}`);
      console.log(`  narrativeDirection: ${safeStr(output.narrativeDirection, 120)}`);
      console.log(`  enemyDefinition: ${safeStr(output.enemyDefinition, 120)}`);
      console.log(`  specificityScore: ${output.specificityScore ?? "N/A"}`);
      console.log(`  proofSignals: ${Array.isArray(output.proofSignals) ? output.proofSignals.length : "N/A"}`);
      console.log(`  signalTraceability: ${safeStr(output.signalTraceability, 200)}`);
      break;

    case "differentiation":
      console.log(`  pillars: ${Array.isArray(output.pillars) ? output.pillars.length : "N/A"}`);
      if (Array.isArray(output.pillars)) {
        for (const p of output.pillars.slice(0, 3)) {
          console.log(`    → pillar: ${safeStr(p.name || p.label || p, 100)}`);
        }
      }
      console.log(`  celDepthCompliance: ${safeStr(output.celDepthCompliance, 200)}`);
      break;

    case "mechanism":
      console.log(`  mechanismName: ${safeStr(output.mechanismName || output.mechanism?.name, 120)}`);
      console.log(`  mechanismType: ${safeStr(output.mechanismType || output.mechanism?.type, 80)}`);
      console.log(`  celDepthCompliance: ${safeStr(output.celDepthCompliance, 200)}`);
      break;

    case "offer":
      const primaryOffer = output.primaryOffer || output;
      console.log(`  offerStrengthScore: ${output.offerStrengthScore ?? "N/A"}`);
      console.log(`  offerName: ${safeStr(primaryOffer.offerName || primaryOffer.name, 120)}`);
      console.log(`  painAlignment: ${safeStr(output.signalGrounding?.painAlignment ?? output.painAlignment, 100)}`);
      console.log(`  objectionHandling: ${Array.isArray(primaryOffer.objectionHandling) ? primaryOffer.objectionHandling.length : "N/A"}`);
      if (Array.isArray(primaryOffer.objectionHandling)) {
        for (const oh of primaryOffer.objectionHandling.slice(0, 3)) {
          console.log(`    → objection handled: ${safeStr(oh, 100)}`);
        }
      }
      console.log(`  proofLayer: ${safeStr(output.proofLayer || primaryOffer.proofAlignment, 200)}`);
      console.log(`  riskNotes: ${safeStr(primaryOffer.riskNotes, 200)}`);
      console.log(`  structuralWarnings: ${safeStr(output.structuralWarnings, 200)}`);
      console.log(`  layerDiagnostics: ${safeStr(output.layerDiagnostics, 200)}`);
      break;

    case "awareness":
      console.log(`  primaryRoute: ${safeStr(output.primaryRoute, 200)}`);
      console.log(`  awarenessStrengthScore: ${output.primaryRoute?.awarenessStrengthScore ?? "N/A"}`);
      break;

    case "funnel":
      console.log(`  funnelStrengthScore: ${output.funnelStrengthScore ?? "N/A"}`);
      console.log(`  trustPathAnalysis: ${safeStr(output.trustPathAnalysis, 200)}`);
      console.log(`  trustPathScore: ${output.trustPathScore ?? "N/A"}`);
      console.log(`  stages: ${safeStr(output.stages, 200)}`);
      break;

    case "integrity":
      console.log(`  overallIntegrityScore: ${output.overallIntegrityScore ?? "N/A"}`);
      console.log(`  safeToExecute: ${output.safeToExecute ?? "N/A"}`);
      console.log(`  issues: ${Array.isArray(output.issues) ? output.issues.length : "N/A"}`);
      if (Array.isArray(output.issues)) {
        for (const issue of output.issues.slice(0, 5)) {
          console.log(`    → issue: ${safeStr(issue, 120)}`);
        }
      }
      break;

    case "persuasion":
      console.log(`  sequenceLength: ${Array.isArray(output.sequence) ? output.sequence.length : "N/A"}`);
      console.log(`  celDepthCompliance: ${safeStr(output.celDepthCompliance, 200)}`);
      console.log(`  proofMappingStatus: ${safeStr(output.proofMapping, 200)}`);
      break;

    case "statistical_validation":
      console.log(`  validationState: ${output.validationState || output.status || "N/A"}`);
      console.log(`  result: ${output.result || output.validationResult || "N/A"}`);
      console.log(`  claimConfidenceScore: ${output.claimConfidenceScore ?? "N/A"}`);
      console.log(`  warnings: ${safeStr(output.warnings, 200)}`);
      break;

    case "budget_governor":
      console.log(`  decision: ${safeStr(output.decision, 200)}`);
      console.log(`  killFlag: ${output.killFlag ?? "N/A"}`);
      console.log(`  funnelStrengthScore: ${output.funnelStrengthScore ?? "N/A"}`);
      console.log(`  warnings: ${safeStr(output.warnings, 200)}`);
      break;

    case "channel_selection":
      console.log(`  selectedChannels: ${Array.isArray(output.selectedChannels) ? output.selectedChannels.length : "N/A"}`);
      if (Array.isArray(output.selectedChannels)) {
        for (const ch of output.selectedChannels.slice(0, 5)) {
          console.log(`    → channel: ${safeStr(ch.name || ch.label, 60)} | role=${ch.role ?? "N/A"} | funnelStage=${ch.funnelStage ?? "N/A"}`);
        }
      }
      console.log(`  funnelStages: ${safeStr(output.funnelStages, 200)}`);
      console.log(`  warnings: ${safeStr(output.warnings, 200)}`);
      break;

    case "iteration":
      console.log(`  iterationCount: ${output.iterationCount ?? "N/A"}`);
      console.log(`  optimizationHints: ${safeStr(output.optimizationHints, 200)}`);
      console.log(`  conflictFlags: ${safeStr(output.conflictFlags, 200)}`);
      break;

    case "retention":
      console.log(`  touchpoints: ${Array.isArray(output.touchpoints) ? output.touchpoints.length : "N/A"}`);
      console.log(`  churnRisk: ${safeStr(output.churnRisk, 100)}`);
      console.log(`  postPurchaseObjections: ${safeStr(output.postPurchaseObjections, 200)}`);
      break;
  }

  console.log(`\n  ${sep}`);
  console.log("  3. PROBLEM HANDLING");
  console.log(`  ${sep}`);

  if (ssc) {
    const sourceProblems = ssc.problemRegistry?.filter((p: any) => p.sourceEngine === engineId) || [];
    const resolvedByThis = ssc.problemRegistry?.filter((p: any) => p.resolvedBy === engineId) || [];
    const deferredByThis = ssc.problemRegistry?.filter((p: any) => p.deferredBy === engineId) || [];
    const cannotResolveByThis = ssc.problemRegistry?.filter((p: any) => p.cannotResolveBy === engineId) || [];

    console.log(`  Problems CREATED by this engine: ${sourceProblems.length}`);
    for (const p of sourceProblems) {
      console.log(`    → ${p.id} [${p.severity}/${p.type}] ${safeStr(p.description, 100)} | status=${p.status}`);
    }
    console.log(`  Problems RESOLVED by this engine: ${resolvedByThis.length}`);
    for (const p of resolvedByThis) {
      console.log(`    → ${p.id} [${p.severity}] action=${safeStr(p.resolvedAction, 100)}`);
    }
    console.log(`  Problems DEFERRED by this engine: ${deferredByThis.length}`);
    for (const p of deferredByThis) {
      console.log(`    → ${p.id} [${p.severity}] reason=${safeStr(p.deferredReason, 100)}`);
    }
    console.log(`  Problems CANNOT_RESOLVE by this engine: ${cannotResolveByThis.length}`);
    for (const p of cannotResolveByThis) {
      console.log(`    → ${p.id} [${p.severity}] reason=${safeStr(p.cannotResolveReason, 100)}`);
    }
  }

  console.log(`\n  ${sep}`);
  console.log("  4. OUTPUT QUALITY SUMMARY");
  console.log(`  ${sep}`);
  const hasOutput = !!output;
  const hasConfidence = typeof confidenceScore === "number";
  console.log(`  Has output: ${hasOutput}`);
  console.log(`  Has confidence: ${hasConfidence}`);
  console.log(`  Output keys: ${output ? Object.keys(output).join(", ") : "N/A"}`);
}

async function runDiagnostic(campaign: typeof CAMPAIGNS[0]): Promise<void> {
  console.log(`\n${"▓".repeat(80)}`);
  console.log(`DIAGNOSTIC: ${campaign.name}`);
  console.log(`Campaign ID: ${campaign.campaignId}`);
  console.log(`${"▓".repeat(80)}`);

  const result: OrchestratorRunResult = await runOrchestrator({
    accountId: ACCOUNT_ID,
    campaignId: campaign.campaignId,
    forceRefresh: true,
    onProgress: (event) => {
      if (event.engineId) {
        console.log(`  [progress] ${event.engineId} — ${event.message || ""}`);
      }
    },
  });

  console.log(`\nPIPELINE STATUS: ${result.status}`);
  console.log(`DURATION: ${result.durationMs}ms`);
  console.log(`COMPLETED ENGINES: ${result.completedEngines.join(", ")}`);
  if (result.blockReason) console.log(`BLOCK REASON: ${result.blockReason}`);
  if (result.failedEngine) console.log(`FAILED ENGINE: ${result.failedEngine}`);

  const ssc = (result as any).ssc || null;

  for (const engineId of ALL_ENGINE_IDS) {
    const engineResult = result.results.get(engineId);
    deepInspectEngine(engineId, engineResult, ssc);
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log("SYSTEM CONTROL VERDICT");
  console.log(`${"═".repeat(70)}`);

  const cv = result.controlVerdict;
  if (cv) {
    console.log(`  Verdict: ${cv.verdict}`);
    console.log(`  Execution Mode: ${cv.executionMode}`);
    console.log(`  Block Reasons: ${cv.blockReasons.length}`);
    for (const b of cv.blockReasons) {
      console.log(`    → [${b.severity}] ${b.code}: ${b.description}`);
    }
    console.log(`  Downgrades: ${cv.downgrades?.length ?? 0}`);
    for (const d of cv.downgrades || []) {
      console.log(`    → ${d.from} → ${d.to}: ${d.reason}`);
    }
    console.log(`  Structural Checks:`);
    for (const c of cv.structuralChecks || []) {
      console.log(`    ${c.passed ? "✅" : "❌"} ${c.check}: ${safeStr(c.details || c.detail, 120)}`);
    }
    console.log(`  Repair Attempted: ${cv.repairAttempted ?? "N/A"}`);
    if (cv.repairActions?.length > 0) {
      for (const r of cv.repairActions) {
        console.log(`    → repair: ${r.action} | target=${r.targetBlock} | executed=${r.executed} | succeeded=${r.succeeded}`);
      }
    }
  }

  if (ssc) {
    console.log(`\n${"═".repeat(70)}`);
    console.log("SSC FINAL STATE");
    console.log(`${"═".repeat(70)}`);
    console.log(`  Confidence Floor: ${ssc.confidenceFloor?.toFixed(2)}`);
    console.log(`  Awareness: ${ssc.awarenessMeaning?.stage || "none"}`);
    console.log(`  Confidence Chain (${ssc.confidenceChain?.length ?? 0} entries):`);
    for (const e of ssc.confidenceChain || []) {
      console.log(`    ${e.engineId.padEnd(25)} data=${e.dataConfidence?.toFixed(2)} engine=${e.engineConfidence?.toFixed(2)} combined=${e.combinedConfidence?.toFixed(2)} floor=${e.inheritedFloor?.toFixed(2)}`);
    }
    console.log(`  Problem Registry (${ssc.problemRegistry?.length ?? 0} entries):`);
    for (const p of ssc.problemRegistry || []) {
      let detail = `${p.id} [${p.severity}/${p.type}] source=${p.sourceEngine} status=${p.status}`;
      if (p.resolvedBy) detail += ` resolvedBy=${p.resolvedBy}`;
      if (p.cannotResolveBy) detail += ` cannotResolveBy=${p.cannotResolveBy}`;
      if (p.deferredBy) detail += ` deferredBy=${p.deferredBy}`;
      console.log(`    ${detail}`);
      console.log(`      desc: ${safeStr(p.description, 150)}`);
      if (p.resolvedAction) console.log(`      action: ${safeStr(p.resolvedAction, 150)}`);
      if (p.cannotResolveReason) console.log(`      reason: ${safeStr(p.cannotResolveReason, 150)}`);
    }
    console.log(`  Contradictions: ${ssc.contradictions?.length ?? 0}`);
    for (const c of ssc.contradictions || []) {
      console.log(`    → ${safeStr(c, 150)}`);
    }
  }
}

async function main() {
  console.log("═".repeat(80));
  console.log("AVYRON AI — FULL ENGINE DIAGNOSTIC CHECK-UP");
  console.log("Post-fix validation pass: Positioning confidence split + Evaluability preconditions");
  console.log(`Date: ${new Date().toISOString()}`);
  console.log("═".repeat(80));

  for (const campaign of CAMPAIGNS) {
    try {
      await runDiagnostic(campaign);
    } catch (err: any) {
      console.error(`\nDIAGNOSTIC FAILED for ${campaign.name}: ${err.message}`);
      console.error(err.stack?.slice(0, 500));
    }
  }

  console.log(`\n${"▓".repeat(80)}`);
  console.log("DIAGNOSTIC COMPLETE");
  console.log(`${"▓".repeat(80)}`);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
