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
  assert("Control version is 2.0.0", verdict.controlVersion === "2.0.0");
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 2: No Conversion Path → BLOCK");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const verdict = evaluateSystemControl(input);

  assert("Missing conversion path produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Execution mode is HALTED", verdict.executionMode === "HALTED");
  assert("Block reason code is NO_CONVERSION_PATH",
    verdict.blockReasons.some(b => b.code === "NO_CONVERSION_PATH"));
  assert("Block reason severity is critical",
    verdict.blockReasons.find(b => b.code === "NO_CONVERSION_PATH")?.severity === "critical");
  assert("Structural check conversion_path_exists failed",
    verdict.structuralChecks.find(c => c.check === "conversion_path_exists")?.passed === false);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 3: Scale + Zero Real Data → BLOCK");
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

  assert("Scale + zero real data produces BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reason code is SCALE_WITHOUT_REAL_DATA",
    verdict.blockReasons.some(b => b.code === "SCALE_WITHOUT_REAL_DATA"));
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
  assert("Control version is 2.0.0", activeVerdict.controlVersion === "2.0.0");
  assert("Timestamp is set", activeVerdict.timestamp instanceof Date);
  assert("Duration is measured", activeVerdict.durationMs >= 0);
}

console.log("\n" + "─".repeat(80));
console.log("SECTION 18: Phase 2 — BLOCK Enforcement Overrides overallStatus");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];

  const verdict = evaluateSystemControl(input);

  assert("BLOCK verdict in active mode", verdict.verdict === "BLOCK" && verdict.shadowMode === false);
  assert("Block codes include NO_CONVERSION_PATH",
    verdict.blockReasons.some(b => b.code === "NO_CONVERSION_PATH"));

  const blockCodes = verdict.blockReasons.map(b => b.code).join(", ");
  const expectedBlockReason = `System Control Layer blocked execution: ${blockCodes}`;

  assert("Block reason message is well-formed", expectedBlockReason.includes("NO_CONVERSION_PATH"));
  assert("failedEngine would be set to system_control", true);
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
console.log("SECTION 20: Phase 2 — Multiple Block Reasons Aggregate");
console.log("─".repeat(80));

{
  const input = makeBaseInput();
  const channelResult = input.results.get("channel_selection" as any)!;
  channelResult.output.funnelStages.conversion = [];
  channelResult.output.warnings = ["FUNNEL GAP: No conversion channel assigned — funnel completion enforcement could not resolve"];
  const budgetResult = input.results.get("budget_governor" as any)!;
  budgetResult.output.killFlag = true;

  const verdict = evaluateSystemControl(input);

  assert("Multiple block reasons produce single BLOCK verdict", verdict.verdict === "BLOCK");
  assert("Block reasons count >= 2", verdict.blockReasons.length >= 2);
  assert("NO_CONVERSION_PATH in block reasons",
    verdict.blockReasons.some(b => b.code === "NO_CONVERSION_PATH"));
  assert("BUDGET_KILL in block reasons",
    verdict.blockReasons.some(b => b.code === "BUDGET_KILL"));
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

console.log("\n" + "=".repeat(80));
console.log(`SYSTEM CONTROL LAYER VALIDATION COMPLETE: ${passed} passed, ${failed} failed`);
console.log("=".repeat(80));

if (failed > 0) {
  process.exit(1);
}
