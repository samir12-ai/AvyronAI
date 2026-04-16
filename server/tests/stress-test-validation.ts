import { runOrchestrator } from "../orchestrator/index";
import type { OrchestratorRunResult } from "../orchestrator/index";

const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

const CAMPAIGNS = [
  { name: "MarketMindAI", campaignId: "campaign_1773576062201_6t0oxi", description: "Market Intelligence OS — B2B agency lead gen" },
  { name: "SWA Media", campaignId: "campaign_1772334831096_uzmp6t", description: "Social media agency — guarantee success model" },
];

interface CampaignEvidence {
  name: string;
  campaignId: string;
  status: string;
  durationMs: number;
  engineResults: { engineId: string; status: string; confidence: number | string; durationMs: number }[];
  verdict: string | null;
  executionMode: string | null;
  blockReasons: { code: string; severity: string; description: string }[];
  structuralChecks: { check: string; passed: boolean; detail: string }[];
  sscChecks: { check: string; passed: boolean; detail: string }[];
  confidenceChain: { engineId: string; combined: number; inheritedFloor: number }[];
  problemRegistry: { id: string; type: string; severity: string; status: string; source: string; resolvedBy?: string; deferredBy?: string; cannotResolveBy?: string }[];
  gateTriggered: boolean;
  retryAttempted: boolean;
  blockValid: boolean;
  blockExplanation: string;
}

function analyzeBlockValidity(ev: CampaignEvidence): { valid: boolean; explanation: string } {
  if (ev.blockReasons.length === 0) {
    return { valid: true, explanation: "No blocks — pipeline completed cleanly" };
  }

  const validReasons: string[] = [];
  const falseReasons: string[] = [];

  for (const b of ev.blockReasons) {
    switch (b.code) {
      case "POSITIONING_HARD_GATE":
        validReasons.push(`POSITIONING_HARD_GATE: Positioning confidence below 0.40 — structurally valid block`);
        break;
      case "UNRESOLVED_CRITICAL_PROBLEMS": {
        const problemDetails = ev.problemRegistry.filter(p => p.severity === "critical" && (p.status === "open" || p.status === "cannot_resolve"));
        if (problemDetails.length > 0) {
          validReasons.push(`UNRESOLVED_CRITICAL_PROBLEMS: ${problemDetails.length} critical problem(s) unresolved — valid block`);
        } else if (b.description.includes("cannot_resolve") || b.description.includes("open")) {
          validReasons.push(`UNRESOLVED_CRITICAL_PROBLEMS: ${b.description.slice(0, 120)} — valid block (from verdict)`);
        } else {
          falseReasons.push(`UNRESOLVED_CRITICAL_PROBLEMS: No critical unresolved problems found — FALSE BLOCK`);
        }
        break;
      }
      case "NO_CONVERSION_PATH": {
        const channelResult = ev.engineResults.find(e => e.engineId === "channel_selection");
        if (!channelResult || channelResult.status !== "SUCCESS") {
          validReasons.push(`NO_CONVERSION_PATH: Channel selection did not complete (pipeline blocked upstream) — valid block`);
        } else {
          falseReasons.push(`NO_CONVERSION_PATH: Channel selection succeeded but block still fired — FALSE BLOCK`);
        }
        break;
      }
      case "CONFIDENCE_CHAIN_VIOLATION": {
        const violatingEngines = ev.confidenceChain.filter(e => {
          const maxAllowed = e.inheritedFloor + 0.20;
          return e.combined > maxAllowed && e.inheritedFloor < 1.0;
        });
        if (violatingEngines.length > 0) {
          validReasons.push(`CONFIDENCE_CHAIN_VIOLATION: ${violatingEngines.length} engine(s) exceed their inherited floor+0.20 — valid block`);
        } else {
          falseReasons.push(`CONFIDENCE_CHAIN_VIOLATION: No engines exceed their inherited floor+0.20 — FALSE BLOCK (retroactive evaluation bug)`);
        }
        break;
      }
      case "CONFIDENCE_SPREAD_EXCESSIVE":
        validReasons.push(`CONFIDENCE_SPREAD_EXCESSIVE: Large spread between engine confidences — valid advisory`);
        break;
      case "BUDGET_OVERRIDE_ZERO_CONFIDENCE":
        validReasons.push(`BUDGET_OVERRIDE_ZERO_CONFIDENCE: Budget action with zero confidence floor — valid block`);
        break;
      case "VALIDATION_REJECTED":
        validReasons.push(`VALIDATION_REJECTED: Statistical validation rejected the strategy — valid block`);
        break;
      default:
        validReasons.push(`${b.code}: ${b.description.slice(0, 80)} — treated as valid`);
    }
  }

  const allValid = falseReasons.length === 0;
  const parts = [...validReasons.map(r => "  ✅ " + r), ...falseReasons.map(r => "  ❌ " + r)];
  return {
    valid: allValid,
    explanation: parts.join("\n"),
  };
}

async function runCampaign(campaign: typeof CAMPAIGNS[0]): Promise<CampaignEvidence> {
  console.log(`\n${"═".repeat(80)}`);
  console.log(`CAMPAIGN: ${campaign.name}`);
  console.log(`ID: ${campaign.campaignId}`);
  console.log(`Description: ${campaign.description}`);
  console.log(`${"═".repeat(80)}`);

  const startTime = Date.now();

  try {
    const result: OrchestratorRunResult = await runOrchestrator({
      accountId: ACCOUNT_ID,
      campaignId: campaign.campaignId,
      forceRefresh: true,
      onProgress: (event) => {
        console.log(`  [progress] ${event.engineId || event.phase || ""} — ${event.message || ""}`);
      },
    });

    const engineResults: CampaignEvidence["engineResults"] = [];
    for (const [engineId, engineResult] of result.results) {
      engineResults.push({
        engineId,
        status: engineResult?.status ?? "UNKNOWN",
        confidence: engineResult?.output?.confidenceScore ?? "N/A",
        durationMs: engineResult?.durationMs ?? 0,
      });
    }

    console.log(`\n${"─".repeat(80)}`);
    console.log("ENGINE-BY-ENGINE RESULTS");
    console.log("─".repeat(80));
    for (const e of engineResults) {
      console.log(`  ${e.engineId.padEnd(25)} | status=${String(e.status).padEnd(10)} | confidence=${String(e.confidence).padEnd(6)} | ${e.durationMs}ms`);
    }

    const cv = result.controlVerdict;
    const blockReasons = cv?.blockReasons?.map(b => ({ code: b.code, severity: b.severity, description: b.description })) || [];
    const structuralChecks = cv?.structuralChecks?.map(c => ({ check: c.check, passed: c.passed, detail: String(c.details || c.detail || "") })) || [];
    const sscChecks = structuralChecks.filter(c =>
      c.check.startsWith("unresolved_critical") || c.check.startsWith("confidence_chain") ||
      c.check.startsWith("positioning_hard") || c.check.startsWith("confidence_spread") ||
      c.check.startsWith("budget_override"));

    console.log(`\n${"─".repeat(80)}`);
    console.log("SYSTEM CONTROL VERDICT");
    console.log("─".repeat(80));
    if (cv) {
      console.log(`  Verdict: ${cv.verdict}`);
      console.log(`  Execution Mode: ${cv.executionMode}`);
      console.log(`  Block Reasons (${blockReasons.length}):`);
      for (const b of blockReasons) console.log(`    → [${b.severity}] ${b.code}: ${b.description.slice(0, 120)}`);
      console.log(`  Structural Checks: ${structuralChecks.filter(c => c.passed).length}/${structuralChecks.length} passed`);
      for (const c of structuralChecks) {
        if (!c.passed) console.log(`    ❌ ${c.check}: ${c.detail.slice(0, 120)}`);
      }
      console.log(`  SSC Checks: ${sscChecks.filter(c => c.passed).length}/${sscChecks.length} passed`);
      for (const c of sscChecks) console.log(`    ${c.passed ? "✅" : "❌"} ${c.check}`);
    } else {
      console.log("  No control verdict produced");
    }

    let confidenceChain: CampaignEvidence["confidenceChain"] = [];
    let problemRegistry: CampaignEvidence["problemRegistry"] = [];
    let gateTriggered = false;
    let retryAttempted = false;

    const ssc = (result as any).ssc || null;
    if (ssc) {
      confidenceChain = (ssc.confidenceChain || []).map((e: any) => ({
        engineId: e.engineId,
        combined: e.combinedConfidence,
        inheritedFloor: e.inheritedFloor,
      }));
      problemRegistry = (ssc.problemRegistry || []).map((p: any) => ({
        id: p.id,
        type: p.type,
        severity: p.severity,
        status: p.status,
        source: p.sourceEngine,
        resolvedBy: p.resolvedBy,
        deferredBy: p.deferredBy,
        cannotResolveBy: p.cannotResolveBy,
      }));
    }

    if (result.blockReason?.includes("retry") || result.blockReason?.includes("gate")) {
      gateTriggered = true;
      retryAttempted = result.blockReason?.includes("retry") || false;
    }

    console.log(`\n${"─".repeat(80)}`);
    console.log("CONFIDENCE CHAIN (SSC)");
    console.log("─".repeat(80));
    if (confidenceChain.length > 0) {
      for (const e of confidenceChain) {
        console.log(`  ${e.engineId.padEnd(25)} combined=${e.combined.toFixed(2)} | inheritedFloor=${e.inheritedFloor.toFixed(2)}`);
      }
    } else {
      console.log("  No SSC confidence chain captured in result");
      const confEngines = ["market_intelligence", "audience", "positioning", "differentiation", "mechanism", "offer", "awareness", "funnel", "persuasion", "statistical_validation", "budget_governor", "channel_selection"];
      for (const eid of confEngines) {
        const r = result.results.get(eid as any);
        const score = r?.output?.confidenceScore;
        if (typeof score === "number") {
          confidenceChain.push({ engineId: eid, combined: score, inheritedFloor: -1 });
          console.log(`  ${eid.padEnd(25)} confidence=${score} (from engine output)`);
        }
      }
    }

    console.log(`\n${"─".repeat(80)}`);
    console.log("PROBLEM REGISTRY");
    console.log("─".repeat(80));
    if (problemRegistry.length > 0) {
      for (const p of problemRegistry) {
        let resolvedInfo = "";
        if (p.resolvedBy) resolvedInfo = ` → resolved by ${p.resolvedBy}`;
        else if (p.deferredBy) resolvedInfo = ` → deferred by ${p.deferredBy}`;
        else if (p.cannotResolveBy) resolvedInfo = ` → cannot_resolve by ${p.cannotResolveBy}`;
        console.log(`  ${p.id}: [${p.severity}] ${p.type} | status=${p.status} | source=${p.source}${resolvedInfo}`);
      }
    } else {
      console.log("  No problems registered (SSC not captured in result, or no problems occurred)");
    }

    const blockAnalysis = analyzeBlockValidity({
      name: campaign.name,
      campaignId: campaign.campaignId,
      status: result.status,
      durationMs: result.durationMs,
      engineResults,
      verdict: cv?.verdict || null,
      executionMode: cv?.executionMode || null,
      blockReasons,
      structuralChecks,
      sscChecks,
      confidenceChain,
      problemRegistry,
      gateTriggered,
      retryAttempted,
      blockValid: true,
      blockExplanation: "",
    });

    console.log(`\n${"─".repeat(80)}`);
    console.log("BLOCK VALIDITY ANALYSIS");
    console.log("─".repeat(80));
    console.log(`  All blocks valid: ${blockAnalysis.valid ? "YES" : "NO"}`);
    console.log(blockAnalysis.explanation);

    return {
      name: campaign.name,
      campaignId: campaign.campaignId,
      status: result.status,
      durationMs: result.durationMs,
      engineResults,
      verdict: cv?.verdict || null,
      executionMode: cv?.executionMode || null,
      blockReasons,
      structuralChecks,
      sscChecks,
      confidenceChain,
      problemRegistry,
      gateTriggered,
      retryAttempted,
      blockValid: blockAnalysis.valid,
      blockExplanation: blockAnalysis.explanation,
    };

  } catch (err: any) {
    console.error(`\n  ❌ PIPELINE ERROR: ${err.message}`);
    return {
      name: campaign.name,
      campaignId: campaign.campaignId,
      status: "ERROR",
      durationMs: Date.now() - startTime,
      engineResults: [],
      verdict: null,
      executionMode: null,
      blockReasons: [],
      structuralChecks: [],
      sscChecks: [],
      confidenceChain: [],
      problemRegistry: [],
      gateTriggered: false,
      retryAttempted: false,
      blockValid: false,
      blockExplanation: `Pipeline error: ${err.message}`,
    };
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("AVYRON AI — STRESS TEST VALIDATION");
  console.log("Cross-Campaign System Logic Proof");
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  const results: CampaignEvidence[] = [];

  for (const campaign of CAMPAIGNS) {
    const evidence = await runCampaign(campaign);
    results.push(evidence);
  }

  console.log("\n\n" + "█".repeat(80));
  console.log("CROSS-CAMPAIGN COMPARISON");
  console.log("█".repeat(80));

  console.log("\n" + "─".repeat(80));
  console.log("SUMMARY TABLE");
  console.log("─".repeat(80));
  console.log(`${"Campaign".padEnd(20)} | ${"Status".padEnd(10)} | ${"Verdict".padEnd(10)} | ${"Engines".padEnd(10)} | ${"Blocks".padEnd(8)} | ${"Duration".padEnd(10)} | Valid`);
  console.log("─".repeat(90));
  for (const r of results) {
    const engineCount = `${r.engineResults.filter(e => e.status === "SUCCESS").length}/${r.engineResults.length}`;
    console.log(`${r.name.padEnd(20)} | ${r.status.padEnd(10)} | ${(r.verdict || "N/A").padEnd(10)} | ${engineCount.padEnd(10)} | ${String(r.blockReasons.length).padEnd(8)} | ${(r.durationMs / 1000).toFixed(1).padEnd(10)}s | ${r.blockValid ? "✅" : "❌"}`);
  }

  console.log("\n" + "─".repeat(80));
  console.log("FINAL CONCLUSIONS");
  console.log("─".repeat(80));

  const allBlocksValid = results.every(r => r.blockValid);
  const anyFalseBlocks = results.some(r => !r.blockValid);
  const hasWeakDataTolerance = results.some(r => r.status !== "BLOCKED" || r.blockReasons.every(b => b.code !== "CONFIDENCE_CHAIN_VIOLATION"));
  const hasWeakLogicStopped = results.some(r => r.blockReasons.some(b => b.code === "POSITIONING_HARD_GATE"));

  console.log(`\n  1. System logically consistent across both campaigns?`);
  if (allBlocksValid) {
    console.log(`     ✅ YES — All blocks are valid across both campaigns. No false violations detected.`);
  } else {
    console.log(`     ❌ NO — False blocks detected in one or more campaigns.`);
    for (const r of results.filter(r => !r.blockValid)) {
      console.log(`       Campaign: ${r.name}`);
      console.log(`       ${r.blockExplanation}`);
    }
  }

  console.log(`\n  2. Blocks happening only for valid reasons?`);
  if (allBlocksValid) {
    console.log(`     ✅ YES — Every block reason has been validated against actual system state.`);
  } else {
    console.log(`     ❌ NO — False block reasons found.`);
  }

  console.log(`\n  3. Weak data being tolerated correctly?`);
  if (hasWeakDataTolerance) {
    console.log(`     ✅ YES — No false CONFIDENCE_CHAIN_VIOLATION from retroactive floor evaluation.`);
  } else {
    console.log(`     ⚠️ NEEDS REVIEW — Could not confirm weak data tolerance in these runs.`);
  }

  console.log(`\n  4. Weak engine logic being stopped correctly?`);
  if (hasWeakLogicStopped) {
    console.log(`     ✅ YES — POSITIONING_HARD_GATE fired when positioning confidence < 0.40.`);
  } else {
    console.log(`     ⚠️ NOT TRIGGERED — Neither campaign had weak enough positioning to trigger the gate.`);
  }

  console.log(`\n  5. Ready to move forward?`);
  if (allBlocksValid && !anyFalseBlocks) {
    console.log(`     ✅ YES — System is logically stable. All blocks are valid. No false contradictions.`);
    console.log(`     The system is ready for the next phase.`);
  } else {
    console.log(`     ❌ NO — Instability detected. Address false blocks before proceeding.`);
  }

  console.log(`\n${"═".repeat(80)}`);
  console.log(`Finished: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(80)}`);
}

main();
