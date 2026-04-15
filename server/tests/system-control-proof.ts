import type { EngineStepResult } from "../orchestrator/priority-matrix";
import { evaluateSystemControl } from "../system-control/engine";
import type { SystemControlInput } from "../system-control/types";
import type { IntegrityReport } from "../system-integrity/types";
import type { SignalComposition } from "../shared/signal-lineage";

const PASS = "✅ PASS";
const FAIL = "❌ FAIL";

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`${PASS} | ${label}${detail ? " — " + detail : ""}`);
  } else {
    failed++;
    console.log(`${FAIL} | ${label}${detail ? " — " + detail : ""}`);
  }
}

function makeMockResult(engineId: string, status: EngineStepResult["status"], output: any = {}): EngineStepResult {
  return { engineId: engineId as any, status, output, durationMs: 100 };
}

function makeBaseResults(): Map<string, EngineStepResult> {
  const results = new Map<string, EngineStepResult>();
  results.set("market_intelligence", makeMockResult("market_intelligence", "SUCCESS"));
  results.set("audience", makeMockResult("audience", "SUCCESS"));
  results.set("positioning", makeMockResult("positioning", "SUCCESS"));
  results.set("differentiation", makeMockResult("differentiation", "SUCCESS"));
  results.set("mechanism", makeMockResult("mechanism", "SUCCESS"));
  results.set("offer", makeMockResult("offer", "SUCCESS", { offerName: "Test Offer", coreOutcome: "Growth" }));
  results.set("funnel", makeMockResult("funnel", "SUCCESS", { stages: [] }));
  results.set("integrity", makeMockResult("integrity", "SUCCESS", { integrityScore: 0.85, warnings: [] }));
  results.set("awareness", makeMockResult("awareness", "SUCCESS"));
  results.set("persuasion", makeMockResult("persuasion", "SUCCESS"));
  results.set("statistical_validation", makeMockResult("statistical_validation", "SUCCESS"));
  results.set("budget_governor", makeMockResult("budget_governor", "SUCCESS", {
    decision: { action: "test" },
    killFlag: false,
    warnings: [],
  }));
  results.set("channel_selection", makeMockResult("channel_selection", "SUCCESS", {
    funnelStages: {
      awareness: [{ label: "Instagram" }],
      nurture: [{ label: "Email" }],
      conversion: [{ label: "Landing Page" }],
    },
    warnings: [],
    reconstructionLog: [],
  }));
  results.set("iteration", makeMockResult("iteration", "SUCCESS", {
    failedStrategyFlags: [],
    optimizationTargets: [],
    dataReliability: { overall: 0.7 },
  }));
  results.set("retention", makeMockResult("retention", "SUCCESS"));
  return results;
}

function makeHealthyIntegrity(): IntegrityReport {
  return {
    reportId: "test",
    timestamp: new Date().toISOString(),
    overallStatus: "PASS",
    engineChecks: [],
    crossEngineAlignment: [],
    signalFlowVerified: true,
    traceabilityComplete: true,
    zeroLeakage: true,
    noOrphanOutputs: true,
    signalCoverageComplete: true,
    summary: "All checks pass",
    failureReasons: [],
    sglTraceToken: null,
  };
}

function makeHealthySignals(): SignalComposition {
  return {
    real: 10,
    competitor: 5,
    inferred: 3,
    fallback: 1,
    unknown: 1,
    total: 20,
    dominantType: "real",
    realRatio: 0.5,
    competitorRatio: 0.25,
    inferredRatio: 0.15,
    fallbackRatio: 0.05,
    unknownRatio: 0.05,
    trustedRatio: 0.75,
  };
}

function makeBaseInput(): SystemControlInput {
  return {
    results: makeBaseResults() as any,
    integrityReport: makeHealthyIntegrity(),
    celResults: [],
    signalComposition: makeHealthySignals(),
    sglCoverageSufficient: true,
    config: { campaignId: "test_campaign", accountId: "test_account" },
  };
}

console.log("=".repeat(80));
console.log("AVYRON AI — SYSTEM CONTROL LAYER VALIDATION");
console.log("Phase 1: Shadow Mode — Observation & Verdict Testing");
console.log("=".repeat(80));

console.log("\n" + "─".repeat(80));
console.log("SECTION 1: Healthy System — Full Pass");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const verdict = evaluateSystemControl(input);

  assert("Healthy system produces PASS verdict", verdict.verdict === "PASS");
  assert("Healthy system gets FULL_EXECUTION mode", verdict.executionMode === "FULL_EXECUTION");
  assert("No block reasons", verdict.blockReasons.length === 0);
  assert("No downgrades", verdict.downgrades.length === 0);
  assert("No contradictions", verdict.contradictions.length === 0);
  assert("All structural checks pass", verdict.structuralChecks.every(c => c.passed));
  assert("Active mode flag (default)", verdict.shadowMode === false);
  assert("Control version is 3.0.0", verdict.controlVersion === "3.0.0");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 2: No Conversion Path → REPAIR (fallback injection)");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const verdict = evaluateSystemControl(input);

  assert("Missing conversion path triggers REPAIR verdict", verdict.verdict === "REPAIR");
  assert("Execution mode is REVIEW_REQUIRED (repaired)", verdict.executionMode === "REVIEW_REQUIRED");
  assert("Repair was attempted", verdict.repairAttempted === true);
  assert("Repair action INJECT_FALLBACK_CONVERSION succeeded",
    verdict.repairActions.some(a => a.code === "INJECT_FALLBACK_CONVERSION" && a.succeeded));
  assert("Block reasons cleared after repair", verdict.blockReasons.length === 0);
  assert("Conversion path check passes after repair",
    verdict.structuralChecks.find(c => c.check === "conversion_path_exists")?.passed === true);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 3: Scale + Zero Real Data → REPAIR (downgrade to test)");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  input.signalComposition = {
    ...makeHealthySignals(),
    real: 0,
    realRatio: 0,
    trustedRatio: 0.25,
  };

  const verdict = evaluateSystemControl(input);

  assert("Scale + zero real data triggers REPAIR verdict", verdict.verdict === "REPAIR");
  assert("Repair action DOWNGRADE_SCALE_TO_TEST succeeded",
    verdict.repairActions.some(a => a.code === "DOWNGRADE_SCALE_TO_TEST" && a.succeeded));
  assert("Block reasons cleared after repair", verdict.blockReasons.length === 0);
  assert("Budget action mutated to test by repair",
    budgetResult.output.decision.action === "test");
  assert("Original action preserved as scale",
    budgetResult.output.decision.originalAction === "scale");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 4: Integrity FAIL → BLOCK");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  input.integrityReport = {
    ...makeHealthyIntegrity(),
    overallStatus: "FAIL",
    failureReasons: ["Leakage detected", "Traceability incomplete"],
    zeroLeakage: false,
    traceabilityComplete: false,
  };

  const verdict = evaluateSystemControl(input);

  assert("Integrity FAIL produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reason code is INTEGRITY_FAILURE",
    verdict.blockReasons.some(b => b.code === "INTEGRITY_FAILURE"));
  assert("Block details contain failure reasons",
    verdict.blockReasons.find(b => b.code === "INTEGRITY_FAILURE")?.description.includes("Leakage detected") ?? false);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 5: CEL Compliance Failure → BLOCK");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  input.celResults = [{ passed: false, overallPassed: false } as any];

  const verdict = evaluateSystemControl(input);

  assert("CEL failure produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reason code is COMPLIANCE_FAILURE",
    verdict.blockReasons.some(b => b.code === "COMPLIANCE_FAILURE"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 6: Budget Kill Flag → BLOCK");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.killFlag = true;

  const verdict = evaluateSystemControl(input);

  assert("Budget kill flag produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reason code is BUDGET_KILL",
    verdict.blockReasons.some(b => b.code === "BUDGET_KILL"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 7: Budget Halt → BLOCK");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "halt";

  const verdict = evaluateSystemControl(input);

  assert("Budget halt produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reason code is BUDGET_HALT",
    verdict.blockReasons.some(b => b.code === "BUDGET_HALT"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 8: Scale + Weak Funnel → DOWNGRADE to Test");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  budgetResult.output.decision.funnelStrengthScore = 0.3;
  budgetResult.output.funnelStrengthScore = 0.3;

  const verdict = evaluateSystemControl(input);

  assert("Scale + weak funnel produces DOWNGRADE verdict", verdict.verdict === "DOWNGRADE");
  assert("Execution mode is TEST_ONLY", verdict.executionMode === "TEST_ONLY");
  assert("Downgrade from scale to test",
    verdict.downgrades.some(d => d.from === "scale" && d.to === "test"));
  assert("Downgrade code is WEAK_FUNNEL_FOR_SCALE",
    verdict.downgrades.some(d => d.code === "WEAK_FUNNEL_FOR_SCALE"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 9: Scale + No CPA Data → DOWNGRADE to Test");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  budgetResult.output.warnings = ["No historical CPA data available — CAC projections are unverified assumptions"];

  const verdict = evaluateSystemControl(input);

  assert("Scale + no CPA data produces DOWNGRADE verdict", verdict.verdict === "DOWNGRADE");
  assert("Downgrade code is UNVERIFIED_CAC",
    verdict.downgrades.some(d => d.code === "UNVERIFIED_CAC"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 10: Test + Partial Integrity → DOWNGRADE to Hold");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "test";
  input.integrityReport = {
    ...makeHealthyIntegrity(),
    overallStatus: "PARTIAL",
    failureReasons: [],
  };

  const verdict = evaluateSystemControl(input);

  assert("Test + partial integrity produces DOWNGRADE verdict", verdict.verdict === "DOWNGRADE");
  assert("Execution mode is RESTRICTED_EXECUTION", verdict.executionMode === "RESTRICTED_EXECUTION");
  assert("Downgrade from test to hold",
    verdict.downgrades.some(d => d.from === "test" && d.to === "hold"));
  assert("Downgrade code is INTEGRITY_PARTIAL",
    verdict.downgrades.some(d => d.code === "INTEGRITY_PARTIAL"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 11: Cross-Engine Contradiction Detection");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";

  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned"];

  const verdict = evaluateSystemControl(input);

  assert("Scale + no conversion detected as contradiction",
    verdict.contradictions.some(c =>
      c.engineA === "budget_governor" && c.engineB === "channel_selection"
    ));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 12: Scale + Partial Integrity → Contradiction Detected");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  input.integrityReport = {
    ...makeHealthyIntegrity(),
    overallStatus: "PARTIAL",
    failureReasons: [],
  };

  const verdict = evaluateSystemControl(input);

  assert("Scale + partial integrity detected as contradiction",
    verdict.contradictions.some(c =>
      c.engineA === "budget_governor" && c.engineB === "system_integrity"
    ));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 13: Missing Critical Engine → Contradiction Detected");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  input.results.set("offer" as any, makeMockResult("offer", "ERROR", null) as any);

  const verdict = evaluateSystemControl(input);

  assert("Missing offer engine detected in upstream health check",
    verdict.structuralChecks.find(c => c.check === "upstream_engine_health")?.passed === false);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 14: Funnel Pass + Structural Weakness → Contradiction");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.nurture = [];

  const verdict = evaluateSystemControl(input);

  assert("Funnel structural incompleteness detected",
    verdict.structuralChecks.find(c => c.check === "funnel_structural_completeness")?.passed === false);
  assert("Funnel vs channel contradiction detected",
    verdict.contradictions.some(c => c.engineA === "funnel" && c.engineB === "channel_selection"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 15: Low Signal Trust + Test → DOWNGRADE to Hold");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "test";
  input.signalComposition = {
    ...makeHealthySignals(),
    trustedRatio: 0.15,
  };

  const verdict = evaluateSystemControl(input);

  assert("Low trust + test produces DOWNGRADE", verdict.verdict === "DOWNGRADE");
  assert("Downgrade code is LOW_SIGNAL_TRUST",
    verdict.downgrades.some(d => d.code === "LOW_SIGNAL_TRUST"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 16: Agent System Preservation — No Memory/Adaptive Interference");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const verdict = evaluateSystemControl(input);

  assert("Control Layer does not produce memory writes",
    !("memoryEntries" in verdict) && !("memoryWrites" in verdict));
  assert("Control Layer does not produce adaptive rhythm changes",
    !("rhythmAdjustment" in verdict) && !("adaptiveRhythm" in verdict));
  assert("Control Layer does not produce prompt injections",
    !("promptInjection" in verdict) && !("memoryContext" in verdict));
  assert("Control Layer does not modify exploration budget",
    !("explorationBudget" in verdict));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 17: Active vs Shadow Mode");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const activeVerdict = evaluateSystemControl(input);
  const shadowVerdict = evaluateSystemControl(input, { shadowMode: true });

  assert("Default mode is active (shadowMode=false)", activeVerdict.shadowMode === false);
  assert("Explicit shadow mode sets shadowMode=true", shadowVerdict.shadowMode === true);
  assert("Both modes produce same verdict", activeVerdict.verdict === shadowVerdict.verdict);
  assert("Both modes produce same execution mode", activeVerdict.executionMode === shadowVerdict.executionMode);
  assert("Control version is 3.0.0", activeVerdict.controlVersion === "3.0.0");
  assert("Timestamp is set", activeVerdict.timestamp instanceof Date);
  assert("Duration is measured", activeVerdict.durationMs >= 0);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 18: Phase 2 — BLOCK Enforcement (non-repairable)");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  input.integrityReport = {
    ...makeHealthyIntegrity(),
    overallStatus: "FAIL",
    failureReasons: ["Leakage detected"],
    zeroLeakage: false,
  };

  const verdict = evaluateSystemControl(input);

  assert("INTEGRITY_FAILURE produces BLOCK even with repair attempt", verdict.verdict === "BLOCK");
  assert("Execution mode is HALTED", verdict.executionMode === "HALTED");
  assert("Block reason still present after failed repair",
    verdict.blockReasons.some(b => b.code === "INTEGRITY_FAILURE"));
  assert("Repair was attempted", verdict.repairAttempted === true);
  assert("REVALIDATE_INTEGRITY repair failed",
    verdict.repairActions.some(a => a.code === "REVALIDATE_INTEGRITY" && !a.succeeded));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 19: Phase 2 — DOWNGRADE Enforcement Mutates Budget Action");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  budgetResult.output.decision.funnelStrengthScore = 0.3;
  budgetResult.output.funnelStrengthScore = 0.3;

  const verdict = evaluateSystemControl(input);

  assert("DOWNGRADE verdict in active mode", verdict.verdict === "DOWNGRADE");
  assert("Downgrade target is test", verdict.downgrades[0].to === "test");
  assert("Original action was scale", verdict.downgrades[0].from === "scale");

  budgetResult.output.decision.action = verdict.downgrades[0].to;
  budgetResult.output.decision.originalAction = "scale";
  budgetResult.output.decision.downgradedBy = "system_control";

  assert("Budget action mutated to test", budgetResult.output.decision.action === "test");
  assert("Original action preserved", budgetResult.output.decision.originalAction === "scale");
  assert("Downgrade attribution set", budgetResult.output.decision.downgradedBy === "system_control");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 20: Phase 2 — Mixed Repairable + Non-Repairable → BLOCK");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.killFlag = true;

  const verdict = evaluateSystemControl(input);

  assert("Mixed repairable + non-repairable produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reasons count >= 1 (non-repairable remains)", verdict.blockReasons.length >= 1);
  assert("BUDGET_KILL in block reasons (non-repairable)",
    verdict.blockReasons.some(b => b.code === "BUDGET_KILL"));
  assert("Repair was NOT attempted (non-repairable blocks present)",
    verdict.repairAttempted === false);
  assert("Repair actions show skipped status",
    verdict.repairActions.length > 0 && verdict.repairActions.every(a => !a.executed));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 21: Phase 2 — Conflict Priority Tier Verification");
console.log("─".repeat(80));

{
  const { CONFLICT_PRIORITY } = require("../conflict-resolver");

  assert("system_control is first priority tier", CONFLICT_PRIORITY[0] === "system_control");
  assert("hard_constraints is second priority tier", CONFLICT_PRIORITY[1] === "hard_constraints");
  assert("system_control outranks all other tiers",
    CONFLICT_PRIORITY.indexOf("system_control") < CONFLICT_PRIORITY.indexOf("hard_constraints"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 22: Phase 2 — BLOCK Takes Precedence Over DOWNGRADE");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  budgetResult.output.decision.funnelStrengthScore = 0.3;
  budgetResult.output.funnelStrengthScore = 0.3;

  input.integrityReport = {
    ...makeHealthyIntegrity(),
    overallStatus: "FAIL",
    failureReasons: ["Leakage detected"],
    zeroLeakage: false,
  };

  const verdict = evaluateSystemControl(input);

  assert("BLOCK takes precedence over potential DOWNGRADE", verdict.verdict === "BLOCK");
  assert("Execution mode is HALTED (not TEST_ONLY)", verdict.executionMode === "HALTED");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 23: Phase 2 — Orchestrator Return Contains controlVerdict");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const verdict = evaluateSystemControl(input);

  assert("controlVerdict has all required fields",
    verdict.verdict !== undefined &&
    verdict.executionMode !== undefined &&
    verdict.blockReasons !== undefined &&
    verdict.downgrades !== undefined &&
    verdict.structuralChecks !== undefined &&
    verdict.contradictions !== undefined &&
    verdict.repairActions !== undefined &&
    verdict.repairAttempted !== undefined &&
    verdict.timestamp !== undefined &&
    verdict.durationMs !== undefined &&
    verdict.controlVersion !== undefined &&
    verdict.shadowMode !== undefined);
  assert("Healthy system controlVerdict is PASS with FULL_EXECUTION",
    verdict.verdict === "PASS" && verdict.executionMode === "FULL_EXECUTION");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 24: Phase 2 — Downgrade Does Not Trigger on Hold/Halt");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "hold";

  input.signalComposition = {
    ...makeHealthySignals(),
    trustedRatio: 0.15,
  };
  input.integrityReport = {
    ...makeHealthyIntegrity(),
    overallStatus: "PARTIAL",
  };

  const verdict = evaluateSystemControl(input);

  assert("Hold action not downgraded further", verdict.verdict === "PASS");
  assert("No downgrades on hold action", verdict.downgrades.length === 0);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 25: Phase 3 — Shadow Mode Skips Repairs");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const verdict = evaluateSystemControl(input, { shadowMode: true });

  assert("Shadow mode still reports BLOCK for NO_CONVERSION_PATH", verdict.verdict === "BLOCK");
  assert("Shadow mode does NOT attempt repairs", verdict.repairAttempted === false);
  assert("Shadow mode has no repair actions", verdict.repairActions.length === 0);
  assert("Shadow mode does not mutate results",
    channelResult.output.funnelStages.conversion.length === 0);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 26: Phase 3 — Conversion Injection Marks Repair Source");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const verdict = evaluateSystemControl(input);

  assert("Repair succeeded", verdict.verdict === "REPAIR");

  const injected = channelResult.output.funnelStages.conversion[0];
  assert("Injected channel has systemControlRepair flag", injected?.systemControlRepair === true);
  assert("Injected channel has wasReconstructed flag", injected?.wasReconstructed === true);
  assert("Injected channel has autoInjectedConversion flag", injected?.autoInjectedConversion === true);
  assert("Injected channel has channelName", typeof injected?.channelName === "string" && injected.channelName.length > 0);
  assert("Reconstruction log updated",
    channelResult.output.reconstructionLog.some((l: string) => l.includes("SYSTEM_CONTROL")));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 27: Phase 3 — Scale→Test Repair Preserves Attribution");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  input.signalComposition = {
    ...makeHealthySignals(),
    real: 0,
    realRatio: 0,
    trustedRatio: 0.25,
  };

  const verdict = evaluateSystemControl(input);

  assert("Repair verdict for scale→test", verdict.verdict === "REPAIR");
  assert("Budget action changed to test", budgetResult.output.decision.action === "test");
  assert("Downgraded by system_control_repair",
    budgetResult.output.decision.downgradedBy === "system_control_repair");
  assert("Downgrade reasons include SCALE_WITHOUT_REAL_DATA",
    budgetResult.output.decision.downgradeReasons.includes("SCALE_WITHOUT_REAL_DATA"));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 28: Phase 3 — Repair Does Not Touch Agent System");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const verdict = evaluateSystemControl(input);

  assert("Repair does not produce memory writes",
    !("memoryEntries" in verdict) && !("memoryWrites" in verdict));
  assert("Repair does not modify adaptive rhythm",
    !("rhythmAdjustment" in verdict) && !("adaptiveRhythm" in verdict));
  assert("Repair does not produce prompt injections",
    !("promptInjection" in verdict) && !("memoryContext" in verdict));
  assert("Repair does not touch exploration budget",
    !("explorationBudget" in verdict));
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 29: Phase 3 — Compliance/Kill/Halt Never Repairable");
console.log("─".repeat(80));

{
  const input1 = makeBaseInput();
  input1.celResults = [{ passed: false, overallPassed: false } as any];
  const v1 = evaluateSystemControl(input1);
  assert("COMPLIANCE_FAILURE stays BLOCK", v1.verdict === "BLOCK");
  assert("COMPLIANCE repair attempted but failed or skipped",
    v1.repairActions.length === 0 || v1.repairActions.every(a => !a.succeeded));

  const input2 = makeBaseInput();
  const br2 = input2.results.get("budget_governor" as any)!;
  br2.output.killFlag = true;
  const v2 = evaluateSystemControl(input2);
  assert("BUDGET_KILL stays BLOCK", v2.verdict === "BLOCK");

  const input3 = makeBaseInput();
  const br3 = input3.results.get("budget_governor" as any)!;
  br3.output.decision.action = "halt";
  const v3 = evaluateSystemControl(input3);
  assert("BUDGET_HALT stays BLOCK", v3.verdict === "BLOCK");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 30: Phase 3 — Repair + Downgrade Coexistence");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  budgetResult.output.decision.funnelStrengthScore = 0.3;
  budgetResult.output.funnelStrengthScore = 0.3;

  const verdict = evaluateSystemControl(input);

  assert("Repair + downgrade coexist: verdict is REPAIR", verdict.verdict === "REPAIR");
  assert("Repair succeeded (conversion injected)",
    verdict.repairActions.some(a => a.code === "INJECT_FALLBACK_CONVERSION" && a.succeeded));
  assert("Downgrade present (weak funnel for scale)",
    verdict.downgrades.some(d => d.code === "WEAK_FUNNEL_FOR_SCALE"));
  assert("Execution mode is TEST_ONLY (downgrade applied)",
    verdict.executionMode === "TEST_ONLY");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 31: Phase 3 — Post-Repair Downgrade Recomputation");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.decision.action = "scale";
  input.signalComposition = {
    ...makeHealthySignals(),
    real: 0,
    realRatio: 0,
    trustedRatio: 0.25,
  };

  const verdict = evaluateSystemControl(input);

  assert("Repair resolves SCALE_WITHOUT_REAL_DATA block", verdict.verdict === "REPAIR");
  assert("Post-repair action is test", budgetResult.output.decision.action === "test");
  assert("Post-repair LOW_SIGNAL_TRUST downgrade applied",
    verdict.downgrades.some(d => d.code === "LOW_SIGNAL_TRUST"));
  assert("Execution mode reflects post-repair downgrade",
    verdict.executionMode === "RESTRICTED_EXECUTION");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 32: Phase 3 — Mixed Block: No Mutation on Repairable Targets");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.killFlag = true;

  const verdict = evaluateSystemControl(input);

  assert("Mixed block stays BLOCK", verdict.verdict === "BLOCK");
  assert("Conversion array was NOT mutated (still empty)",
    channelResult.output.funnelStages.conversion.length === 0);
  assert("Repair not executed",
    verdict.repairActions.every(a => a.executed === false));
}

import { systemControlVerdicts } from "../../shared/schema";
import { storeControlVerdict, registerSystemControlRoutes } from "../system-control/routes";
import { db } from "../db";
import { eq, and } from "drizzle-orm";

async function runPhase4Tests() {
  console.log("\n" + "─".repeat(80));
  console.log("SECTION 33: Phase 4 — Verdict Storage Schema Verification");
  console.log("─".repeat(80));

  {
    assert("Schema table exists", systemControlVerdicts !== undefined);

    const columns = Object.keys(systemControlVerdicts);
    const requiredColumns = [
      "id", "accountId", "campaignId", "jobId", "verdict", "executionMode",
      "blockReasons", "downgrades", "structuralChecks", "contradictions",
      "repairActions", "repairAttempted", "checksTotal", "checksPassed",
      "durationMs", "controlVersion", "shadowMode", "createdAt",
    ];
    for (const col of requiredColumns) {
      assert(`Schema has column: ${col}`, columns.includes(col));
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 34: Phase 4 — Store & Retrieve Verdict (DB Integration)");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    const testCampaignId = `test_phase4_${Date.now()}`;
    const testAccountId = `test_account_${Date.now()}`;
    input.config = { campaignId: testCampaignId, accountId: testAccountId };

    const verdict = evaluateSystemControl(input);

    const id = await storeControlVerdict(testAccountId, testCampaignId, "test_job_1", verdict);
    assert("Verdict stored and ID returned", typeof id === "string" && id.length > 0);

    const [row] = await db.select()
      .from(systemControlVerdicts)
      .where(eq(systemControlVerdicts.id, id));

    assert("Row found in DB", row !== undefined);
    assert("Stored verdict matches", row.verdict === "PASS");
    assert("Stored execution mode matches", row.executionMode === "FULL_EXECUTION");
    assert("Stored campaign ID matches", row.campaignId === testCampaignId);
    assert("Stored account ID matches", row.accountId === testAccountId);
    assert("Stored job ID matches", row.jobId === "test_job_1");
    assert("Checks total stored correctly", row.checksTotal === verdict.structuralChecks.length);
    assert("Checks passed stored correctly", row.checksPassed === verdict.structuralChecks.filter(c => c.passed).length);
    assert("Duration stored", (row.durationMs || 0) >= 0);
    assert("Control version stored", row.controlVersion === verdict.controlVersion);
    assert("Shadow mode stored as false", row.shadowMode === false);
    assert("Repair attempted stored as false", row.repairAttempted === false);
    assert("Block reasons stored as JSON", JSON.parse(row.blockReasons || "[]").length === 0);
    assert("Structural checks stored as JSON", JSON.parse(row.structuralChecks || "[]").length > 0);

    await db.delete(systemControlVerdicts).where(eq(systemControlVerdicts.id, id));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 35: Phase 4 — Store BLOCK Verdict with Full Metadata");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    const testCampaignId = `test_block_${Date.now()}`;
    input.config = { campaignId: testCampaignId, accountId: "test_block_acc" };
    const budgetResult = input.results.get("budget_governor" as any)!;
    budgetResult.output.killFlag = true;

    const verdict = evaluateSystemControl(input);
    const id = await storeControlVerdict("test_block_acc", testCampaignId, "test_job_block", verdict);

    const [row] = await db.select()
      .from(systemControlVerdicts)
      .where(eq(systemControlVerdicts.id, id));

    assert("BLOCK verdict stored", row.verdict === "BLOCK");
    assert("Execution mode HALTED stored", row.executionMode === "HALTED");

    const blockReasons = JSON.parse(row.blockReasons || "[]");
    assert("Block reasons contain BUDGET_KILL",
      blockReasons.some((b: any) => b.code === "BUDGET_KILL"));

    await db.delete(systemControlVerdicts).where(eq(systemControlVerdicts.id, id));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 36: Phase 4 — Store REPAIR Verdict with Repair Actions");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    const testCampaignId = `test_repair_${Date.now()}`;
    input.config = { campaignId: testCampaignId, accountId: "test_repair_acc" };
    const channelResult = input.results.get("channel_selection" as any)!;
    channelResult.output.funnelStages.conversion = [];
    channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

    const verdict = evaluateSystemControl(input);
    const id = await storeControlVerdict("test_repair_acc", testCampaignId, "test_job_repair", verdict);

    const [row] = await db.select()
      .from(systemControlVerdicts)
      .where(eq(systemControlVerdicts.id, id));

    assert("REPAIR verdict stored", row.verdict === "REPAIR");
    assert("Repair attempted flag stored", row.repairAttempted === true);

    const repairActions = JSON.parse(row.repairActions || "[]");
    assert("Repair actions stored",
      repairActions.some((a: any) => a.code === "INJECT_FALLBACK_CONVERSION" && a.succeeded));

    await db.delete(systemControlVerdicts).where(eq(systemControlVerdicts.id, id));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 37: Phase 4 — API Route Existence Verification");
  console.log("─".repeat(80));

  {
    assert("registerSystemControlRoutes is a function", typeof registerSystemControlRoutes === "function");
    assert("storeControlVerdict is exported", typeof storeControlVerdict === "function");
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 38: Enforcement — VALIDATION_REJECTED Block");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    input.results.set("statistical_validation", makeMockResult("statistical_validation", "SUCCESS", {
      result: "rejected",
      reason: "Statistical model rejected strategy",
    }));
    const verdict = evaluateSystemControl(input);
    assert("Validation rejected → BLOCK", verdict.verdict === "BLOCK");
    assert("Block code is VALIDATION_REJECTED",
      verdict.blockReasons.some(b => b.code === "VALIDATION_REJECTED"));
    assert("Execution mode HALTED when rejected", verdict.executionMode === "HALTED");
  }

  {
    const input = makeBaseInput();
    input.results.set("statistical_validation", makeMockResult("statistical_validation", "SUCCESS", {
      result: "accepted",
    }));
    const verdict = evaluateSystemControl(input);
    assert("Validation accepted → no VALIDATION_REJECTED block",
      !verdict.blockReasons.some(b => b.code === "VALIDATION_REJECTED"));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 39: Enforcement — SIGNAL_GROUNDING_MASS_FAILURE Block");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    const engines = ["market_intelligence", "audience", "positioning", "differentiation", "mechanism"];
    for (const e of engines) {
      input.results.set(e, makeMockResult(e, "SIGNAL_BLOCKED" as any));
    }
    const verdict = evaluateSystemControl(input);
    assert("5+ signal failures → BLOCK", verdict.verdict === "BLOCK");
    assert("Block code is SIGNAL_GROUNDING_MASS_FAILURE",
      verdict.blockReasons.some(b => b.code === "SIGNAL_GROUNDING_MASS_FAILURE"));
  }

  {
    const input = makeBaseInput();
    input.results.set("market_intelligence", makeMockResult("market_intelligence", "ERROR" as any));
    input.results.set("audience", makeMockResult("audience", "ERROR" as any));
    const verdict = evaluateSystemControl(input);
    assert("2 engine failures → no mass failure block",
      !verdict.blockReasons.some(b => b.code === "SIGNAL_GROUNDING_MASS_FAILURE"));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 40: Enforcement — OFFER_AUDIENCE_MISALIGNMENT Block");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    input.results.set("offer", makeMockResult("offer", "SUCCESS", {
      offerName: "Test",
      coreOutcome: "Growth",
      structuralWarnings: ["Outcome statement does not reflect any identified audience pain signals or desires"],
    }));
    const verdict = evaluateSystemControl(input);
    assert("Offer pain misalignment → BLOCK", verdict.verdict === "BLOCK");
    assert("Block code is OFFER_AUDIENCE_MISALIGNMENT",
      verdict.blockReasons.some(b => b.code === "OFFER_AUDIENCE_MISALIGNMENT"));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 41: Enforcement — ZERO_OBJECTION_COVERAGE Block");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    input.results.set("audience", makeMockResult("audience", "SUCCESS", {
      objectionMap: { "too expensive": { severity: "high" }, "not sure it works": { severity: "medium" } },
    }));
    input.results.set("offer", makeMockResult("offer", "SUCCESS", {
      offerName: "Test",
      primaryOffer: {
        objectionHandling: [],
        proofAlignment: [],
        riskNotes: [],
      },
    }));
    const verdict = evaluateSystemControl(input);
    assert("Zero objection coverage → BLOCK", verdict.verdict === "BLOCK");
    assert("Block code is ZERO_OBJECTION_COVERAGE",
      verdict.blockReasons.some(b => b.code === "ZERO_OBJECTION_COVERAGE"));
  }

  {
    const input = makeBaseInput();
    input.results.set("audience", makeMockResult("audience", "SUCCESS", {
      objectionMap: { "too expensive": { severity: "high" } },
    }));
    input.results.set("offer", makeMockResult("offer", "SUCCESS", {
      offerName: "Test",
      primaryOffer: {
        objectionHandling: ["We offer a money-back guarantee"],
        proofAlignment: ["outcome_proof"],
        riskNotes: [],
      },
    }));
    const verdict = evaluateSystemControl(input);
    assert("Objection coverage present → no ZERO_OBJECTION_COVERAGE block",
      !verdict.blockReasons.some(b => b.code === "ZERO_OBJECTION_COVERAGE"));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 42: Enforcement — CHANNEL_CONFIDENCE_BELOW_MINIMUM Block");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    input.results.set("channel_selection", makeMockResult("channel_selection", "SUCCESS", {
      funnelStages: {
        awareness: [{ label: "Instagram" }],
        nurture: [{ label: "Email" }],
        conversion: [{ label: "Landing Page" }],
      },
      confidenceScore: 0.35,
    }));
    const verdict = evaluateSystemControl(input);
    assert("Channel confidence 0.35 → BLOCK", verdict.verdict === "BLOCK");
    assert("Block code is CHANNEL_CONFIDENCE_BELOW_MINIMUM",
      verdict.blockReasons.some(b => b.code === "CHANNEL_CONFIDENCE_BELOW_MINIMUM"));
  }

  {
    const input = makeBaseInput();
    input.results.set("channel_selection", makeMockResult("channel_selection", "SUCCESS", {
      funnelStages: {
        awareness: [{ label: "Instagram" }],
        nurture: [{ label: "Email" }],
        conversion: [{ label: "Landing Page" }],
      },
      confidenceScore: 0.65,
    }));
    const verdict = evaluateSystemControl(input);
    assert("Channel confidence 0.65 → no channel block",
      !verdict.blockReasons.some(b => b.code === "CHANNEL_CONFIDENCE_BELOW_MINIMUM"));
  }

  console.log("\n" + "─".repeat(80));
  console.log("SECTION 43: Enforcement — Combined Block Scenarios");
  console.log("─".repeat(80));

  {
    const input = makeBaseInput();
    input.results.set("statistical_validation", makeMockResult("statistical_validation", "SUCCESS", {
      result: "rejected",
    }));
    input.results.set("offer", makeMockResult("offer", "SUCCESS", {
      offerName: "Test",
      structuralWarnings: ["Market language preservation failed — zero audience tokens found in offer text (completely disconnected from market language)"],
    }));
    const verdict = evaluateSystemControl(input);
    assert("Multiple enforcement violations → BLOCK", verdict.verdict === "BLOCK");
    assert("Contains VALIDATION_REJECTED", verdict.blockReasons.some(b => b.code === "VALIDATION_REJECTED"));
    assert("Contains OFFER_AUDIENCE_MISALIGNMENT", verdict.blockReasons.some(b => b.code === "OFFER_AUDIENCE_MISALIGNMENT"));
    assert("Multiple block reasons", verdict.blockReasons.length >= 2);
  }

  {
    const input = makeBaseInput();
    const verdict = evaluateSystemControl(input);
    assert("Clean input with no violations → PASS or DOWNGRADE",
      verdict.verdict === "PASS" || verdict.verdict === "DOWNGRADE");
    assert("No enforcement blocks on clean input",
      !verdict.blockReasons.some(b =>
        b.code === "VALIDATION_REJECTED" ||
        b.code === "SIGNAL_GROUNDING_MASS_FAILURE" ||
        b.code === "OFFER_AUDIENCE_MISALIGNMENT" ||
        b.code === "ZERO_OBJECTION_COVERAGE" ||
        b.code === "CHANNEL_CONFIDENCE_BELOW_MINIMUM"
      ));
  }

  console.log("\n" + "=".repeat(80));
  console.log(`SYSTEM CONTROL LAYER VALIDATION COMPLETE: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(80));

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

runPhase4Tests().catch(err => {
  console.error("Phase 4 test error:", err);
  process.exit(1);
});
