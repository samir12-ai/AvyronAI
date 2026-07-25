import { runOrchestrator } from "../orchestrator/index";

const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";
const CAMPAIGN_ID = "campaign_1773576062201_6t0oxi";

async function main() {
  console.log("=".repeat(80));
  console.log("AVYRON AI — REAL PIPELINE VALIDATION");
  console.log("Evidence-Based System Behavior Proof");
  console.log("=".repeat(80));
  console.log(`Account: ${ACCOUNT_ID}`);
  console.log(`Campaign: ${CAMPAIGN_ID}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  const progressEvents: string[] = [];

  try {
    const result = await runOrchestrator({
      accountId: ACCOUNT_ID,
      campaignId: CAMPAIGN_ID,
      forceRefresh: true,
      onProgress: (event) => {
        const msg = `[${event.phase || ""}] ${event.engineId || ""} — ${event.message || ""}`;
        progressEvents.push(msg);
        console.log(`  PROGRESS: ${msg}`);
      },
    });

    console.log("\n" + "═".repeat(80));
    console.log("PIPELINE RESULT");
    console.log("═".repeat(80));
    console.log(`Status: ${result.status}`);
    console.log(`Job ID: ${result.jobId}`);
    console.log(`Duration: ${result.durationMs}ms (${(result.durationMs / 1000).toFixed(1)}s)`);
    console.log(`Completed Engines: ${result.completedEngines.join(", ")}`);
    if (result.failedEngine) console.log(`Failed Engine: ${result.failedEngine}`);
    if (result.blockReason) console.log(`Block Reason: ${result.blockReason}`);
    if (result.planId) console.log(`Plan ID: ${result.planId}`);

    console.log("\n" + "─".repeat(80));
    console.log("ENGINE-BY-ENGINE RESULTS");
    console.log("─".repeat(80));

    for (const [engineId, engineResult] of result.results) {
      const confidence = engineResult?.output?.confidenceScore ?? "N/A";
      const status = engineResult?.status ?? "UNKNOWN";
      const duration = engineResult?.durationMs ?? 0;
      console.log(`  ${engineId.padEnd(25)} | status=${status.padEnd(10)} | confidence=${String(confidence).padEnd(6)} | ${duration}ms`);
    }

    console.log("\n" + "─".repeat(80));
    console.log("SYSTEM CONTROL VERDICT");
    console.log("─".repeat(80));

    const cv = result.controlVerdict;
    if (cv) {
      console.log(`  Verdict: ${cv.verdict}`);
      console.log(`  Execution Mode: ${cv.executionMode}`);
      console.log(`  Block Reasons (${cv.blockReasons.length}):`);
      for (const b of cv.blockReasons) {
        console.log(`    → [${b.severity}] ${b.code}: ${b.description.slice(0, 120)}`);
      }
      console.log(`  Downgrades (${cv.downgrades.length}):`);
      for (const d of cv.downgrades) {
        console.log(`    → ${d.code}: ${d.from}→${d.to} | ${d.reason.slice(0, 100)}`);
      }
      console.log(`  Contradictions (${cv.contradictions.length}):`);
      for (const c of cv.contradictions) {
        console.log(`    → ${c.code}: ${c.description.slice(0, 120)}`);
      }
      console.log(`  Repair Actions (${cv.repairActions.length}):`);
      for (const r of cv.repairActions) {
        console.log(`    → ${r.action}: executed=${r.executed} succeeded=${r.succeeded} | ${r.description.slice(0, 100)}`);
      }
      console.log(`  Structural Checks (${cv.structuralChecks.length}):`);
      const failedChecks = cv.structuralChecks.filter(c => !c.passed);
      const passedChecks = cv.structuralChecks.filter(c => c.passed);
      console.log(`    Passed: ${passedChecks.length}`);
      for (const c of passedChecks) {
        console.log(`      ✅ ${c.check}`);
      }
      if (failedChecks.length > 0) {
        console.log(`    Failed: ${failedChecks.length}`);
        for (const c of failedChecks) {
          console.log(`      ❌ ${c.check}: ${String(c.detail || "").slice(0, 120)}`);
        }
      }

      const sscChecks = cv.structuralChecks.filter(c =>
        c.check.startsWith("unresolved_critical") || c.check.startsWith("confidence_chain") ||
        c.check.startsWith("positioning_hard") || c.check.startsWith("confidence_spread") ||
        c.check.startsWith("budget_override"));
      console.log(`\n  SSC-Aware Checks: ${sscChecks.length} (${sscChecks.filter(c => c.passed).length} passed, ${sscChecks.filter(c => !c.passed).length} failed)`);
      for (const c of sscChecks) {
        console.log(`    ${c.passed ? "✅" : "❌"} ${c.check}${c.passed ? "" : " — " + String(c.detail || "").slice(0, 100)}`);
      }
    } else {
      console.log("  No control verdict (pipeline may have errored before System Control)");
    }

    console.log("\n" + "─".repeat(80));
    console.log("CONFIDENCE CHAIN (from engine results)");
    console.log("─".repeat(80));

    const confidenceEngines = [
      "market_intelligence", "audience", "positioning", "differentiation",
      "mechanism", "offer", "awareness", "funnel", "persuasion",
      "statistical_validation", "budget_governor", "channel_selection"
    ];
    const scores: number[] = [];
    for (const eid of confidenceEngines) {
      const r = result.results.get(eid as any);
      const score = r?.output?.confidenceScore;
      if (typeof score === "number") scores.push(score);
      console.log(`  ${eid.padEnd(25)} confidence=${score ?? "N/A"}`);
    }
    if (scores.length > 0) {
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      console.log(`  Floor (min): ${min} | Max: ${max} | Spread: ${(max - min).toFixed(2)}`);
    }

    console.log("\n" + "═".repeat(80));
    console.log("VALIDATION EVIDENCE SUMMARY");
    console.log("═".repeat(80));

    const totalEngines = result.results.size;
    const successEngines = [...result.results.values()].filter(r => r.status === "SUCCESS").length;
    const hasVerdict = !!cv;
    const verdictValue = cv?.verdict || "NONE";
    const sscChecksRan = cv?.structuralChecks.some(c =>
      c.check.startsWith("unresolved_critical") || c.check.startsWith("confidence_chain")) || false;

    console.log(`  Engines executed: ${totalEngines} (${successEngines} succeeded)`);
    console.log(`  System Control ran: ${hasVerdict}`);
    console.log(`  Verdict: ${verdictValue}`);
    console.log(`  SSC checks ran: ${sscChecksRan}`);
    console.log(`  Pipeline status: ${result.status}`);
    console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);

    if (hasVerdict && sscChecksRan) {
      console.log("\n  ✅ REAL PIPELINE VALIDATION COMPLETE — System logic executed with SSC enforcement");
    } else if (hasVerdict) {
      console.log("\n  ✅ REAL PIPELINE VALIDATION COMPLETE — System Control evaluated");
    } else {
      console.log("\n  ⚠️ REAL PIPELINE VALIDATION PARTIAL — Pipeline did not reach System Control");
    }

  } catch (err: any) {
    console.error("\n" + "═".repeat(80));
    console.error("PIPELINE ERROR");
    console.error("═".repeat(80));
    console.error(`Error: ${err.message}`);
    if (err.stack) console.error(err.stack.split("\n").slice(0, 10).join("\n"));
  }

  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main();
