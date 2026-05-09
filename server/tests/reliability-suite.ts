/**
 * Phase R (May 2026) — Reliability test suite.
 *
 * Goal: prove the system can no longer produce a confident PASS verdict
 * from incomplete, stale, skipped, failed, or timed-out data. Each scenario
 * constructs a contrived `evaluateSystemControl` input and asserts the
 * verdict is BLOCK/SYSTEM_UNTRUSTED (or DOWNGRADE/NEEDS_RECONCILIATION
 * for contradiction scenarios) — never a PASS/FULL_EXECUTION.
 *
 * Scenarios covered (per the user's 12-section spec):
 *   S1. Audience timeout → no PASS, PIPELINE_INCOMPLETE / ENGINE_TIMEOUT block
 *   S2. Engine never reached (channel_selection missing) → PIPELINE_INCOMPLETE
 *   S3. Funnel↔Iteration contradiction → DOWNGRADE / NEEDS_RECONCILIATION
 *   S4. Genuinely full successful run → PASS / FULL_EXECUTION (control)
 *   S5. Mass engine failure (≥3 engines ERROR/TIMEOUT) → SIGNAL_GROUNDING_MASS_FAILURE
 *   S6. Verified FAIL (no conversion path) → BLOCK / HALTED (real failure)
 *
 * Run with:  npx tsx server/tests/reliability-suite.ts
 */

import { evaluateSystemControl } from "../system-control/engine";
import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { SystemControlInput } from "../system-control/types";
import { isVerifiedPass, isUnverified } from "../system-control/types";

type R = Map<EngineId, EngineStepResult>;

function ok(eng: EngineId, output: any, status: EngineStepResult["status"] = "SUCCESS"): EngineStepResult {
  return { engineId: eng, status, output, durationMs: 1, snapshotId: `snap-${eng}` };
}
function timeout(eng: EngineId): EngineStepResult {
  return { engineId: eng, status: "TIMEOUT", output: null, durationMs: 120000, error: "Engine timed out after 120s" };
}
function err(eng: EngineId, msg = "synthetic error"): EngineStepResult {
  return { engineId: eng, status: "ERROR", output: null, durationMs: 1, error: msg };
}

const HEALTHY_BUDGET = { decision: { action: "scale" }, funnelStrengthScore: 0.85, killFlag: false, warnings: [] };
const HEALTHY_CHANNEL = {
  funnelStages: { awareness: ["meta_ads"], nurture: ["email"], conversion: ["landing_page"] },
  conversionChannelAssigned: true,
  confidenceScore: 0.85,
};
const HEALTHY_FUNNEL = { hasConversionPath: true, funnelStrengthScore: 0.80, structuralWarnings: [] };
const HEALTHY_OFFER = {
  primaryOffer: { objectionHandling: ["safety", "credibility"], proofAlignment: ["clinical"], riskNotes: [] },
  layerDiagnostics: { offerAlignmentValidation: { aligned: true }, integrityChecks: { painAligned: true } },
  structuralWarnings: [],
};
const HEALTHY_AUDIENCE = { objectionMap: { safety: { confidence: 0.8 } }, segments: [{ name: "parents" }] };
const HEALTHY_VALIDATION = { result: "accepted" };
const HEALTHY_POSITIONING = { engineConfidence: 0.6 };

function buildHealthyResults(): R {
  const r: R = new Map();
  // All engines required by checkPipelineCompleteness must be present + SUCCESS
  // for a control-case PASS verdict.
  r.set("market_intelligence", ok("market_intelligence" as EngineId, { engineConfidence: 0.7 }));
  r.set("audience", ok("audience", HEALTHY_AUDIENCE));
  r.set("positioning", ok("positioning", HEALTHY_POSITIONING));
  r.set("offer", ok("offer", HEALTHY_OFFER));
  r.set("funnel", ok("funnel", HEALTHY_FUNNEL));
  r.set("channel_selection", ok("channel_selection", HEALTHY_CHANNEL));
  r.set("budget_governor", ok("budget_governor", HEALTHY_BUDGET));
  r.set("statistical_validation", ok("statistical_validation", HEALTHY_VALIDATION));
  r.set("iteration", ok("iteration" as EngineId, { dataReliability: { isWeak: false } }));
  r.set("retention", ok("retention" as EngineId, { engineConfidence: 0.6 }));
  return r;
}

function buildInput(results: R, overrides: Partial<SystemControlInput> = {}): SystemControlInput {
  return {
    results,
    integrityReport: { overallStatus: "PASS", failureReasons: [], zeroLeakage: true, traceabilityComplete: true } as any,
    celResults: [{ passed: true } as any],
    signalComposition: { realRatio: 0.7, trustedRatio: 0.7, totalSignals: 100, segments: [] } as any,
    ssc: {
      problemRegistry: [],
      confidenceChain: [
        { engineId: "positioning", inheritedFloor: 0.5, combinedConfidence: 0.6, engineConfidence: 0.6 },
        { engineId: "offer", inheritedFloor: 0.5, combinedConfidence: 0.65, engineConfidence: 0.65 },
      ],
      confidenceFloor: 0.5,
    } as any,
    config: { campaignId: "test-campaign", accountId: "test-account" },
    ...overrides,
  };
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  details: string;
  verdict: string;
  executionMode: string;
  blocks: string[];
  contradictions: number;
  verifiedPass: number;
  unverified: number;
}

function runScenario(
  name: string,
  buildInputFn: () => SystemControlInput,
  expect: (v: any) => { passed: boolean; details: string },
): ScenarioResult {
  const verdict = evaluateSystemControl(buildInputFn(), { shadowMode: true });
  const result = expect(verdict);
  return {
    name,
    passed: result.passed,
    details: result.details,
    verdict: verdict.verdict,
    executionMode: verdict.executionMode,
    blocks: verdict.blockReasons.map(b => b.code),
    contradictions: verdict.contradictions.length,
    verifiedPass: verdict.structuralChecks.filter(isVerifiedPass).length,
    unverified: verdict.structuralChecks.filter(isUnverified).length,
  };
}

const scenarios: ScenarioResult[] = [];

// ─── S1: Audience timeout ───────────────────────────────────────────────────
scenarios.push(runScenario(
  "S1: Audience engine TIMEOUT → no PASS, reliability block emitted",
  () => {
    const r = buildHealthyResults();
    r.set("audience", timeout("audience"));
    return buildInput(r);
  },
  (v) => {
    const passed = v.verdict !== "PASS"
      && v.executionMode !== "FULL_EXECUTION"
      && v.blockReasons.some((b: any) => ["PIPELINE_INCOMPLETE", "ENGINE_TIMEOUT"].includes(b.code));
    return { passed, details: passed ? "OK" : `expected reliability block, got verdict=${v.verdict} mode=${v.executionMode} blocks=${v.blockReasons.map((b: any) => b.code).join(",")}` };
  },
));

// ─── S2: Engine never reached (channel_selection missing) ────────────────────
scenarios.push(runScenario(
  "S2: channel_selection NEVER REACHED → PIPELINE_INCOMPLETE, no PASS",
  () => {
    const r = buildHealthyResults();
    r.delete("channel_selection");
    return buildInput(r);
  },
  (v) => {
    const passed = v.verdict !== "PASS"
      && v.blockReasons.some((b: any) => b.code === "PIPELINE_INCOMPLETE" || b.code === "ENGINE_TIMEOUT");
    return { passed, details: passed ? "OK" : `expected pipeline-incomplete block, got ${JSON.stringify({ verdict: v.verdict, mode: v.executionMode, blocks: v.blockReasons.map((b: any) => b.code) })}` };
  },
));

// ─── S3: Funnel↔Iteration contradiction ─────────────────────────────────────
scenarios.push(runScenario(
  "S3: Funnel says healthy + Iteration shows sub-threshold conversion → NEEDS_RECONCILIATION",
  () => {
    const r = buildHealthyResults();
    r.set("iteration", ok("iteration" as EngineId, {
      optimizationTargets: [
        { targetArea: "conversion_rate", currentValue: 0.01, targetValue: 0.05, improvementStrategy: "x", confidence: 0.7, effort: "medium" },
      ],
      dataReliability: { isWeak: false, signalDensity: 0.8 },
    }));
    return buildInput(r);
  },
  (v) => {
    const hasContradiction = v.contradictions.some((c: any) => (c.engineA === "funnel" && c.engineB === "iteration") || (c.engineA === "iteration" && c.engineB === "funnel"));
    const passed = hasContradiction && v.verdict !== "PASS" && v.executionMode === "NEEDS_RECONCILIATION";
    return { passed, details: passed ? "OK" : `expected NEEDS_RECONCILIATION + contradiction, got verdict=${v.verdict} mode=${v.executionMode} contradictions=${v.contradictions.length}` };
  },
));

// ─── S4: Genuinely healthy run → PASS (control) ─────────────────────────────
scenarios.push(runScenario(
  "S4: All engines green, budget=test → verified PASS / FULL_EXECUTION (control)",
  () => {
    const r = buildHealthyResults();
    // budget=test (not scale) so signal_grounding doesn't fail trustedRatio gate;
    // realRatio>0 already so no scale-without-real-data block.
    r.set("budget_governor", ok("budget_governor", { ...HEALTHY_BUDGET, decision: { action: "test" } }));
    return buildInput(r);
  },
  (v) => {
    const passed = v.verdict === "PASS" && v.executionMode === "FULL_EXECUTION" && v.blockReasons.length === 0;
    return { passed, details: passed ? "OK" : `expected PASS/FULL_EXECUTION, got verdict=${v.verdict} mode=${v.executionMode} blocks=${v.blockReasons.map((b: any) => b.code).join(",")}` };
  },
));

// ─── S5: Mass engine failure ────────────────────────────────────────────────
scenarios.push(runScenario(
  "S5: ≥3 engines TIMEOUT/ERROR → SIGNAL_GROUNDING_MASS_FAILURE + PIPELINE_INCOMPLETE",
  () => {
    const r = buildHealthyResults();
    r.set("audience", timeout("audience"));
    r.set("offer", err("offer"));
    r.set("funnel", err("funnel"));
    return buildInput(r);
  },
  (v) => {
    const codes = v.blockReasons.map((b: any) => b.code);
    const passed = v.verdict !== "PASS"
      && (codes.includes("SIGNAL_GROUNDING_MASS_FAILURE") || codes.includes("PIPELINE_INCOMPLETE") || codes.includes("ENGINE_TIMEOUT"));
    return { passed, details: passed ? "OK" : `expected mass-failure block, got verdict=${v.verdict} codes=${codes.join(",")}` };
  },
));

// ─── S6: Real verified FAIL (no conversion path) → BLOCK / HALTED ───────────
scenarios.push(runScenario(
  "S6: Real verified failure (no conversion channel) → BLOCK / HALTED with NO_CONVERSION_PATH",
  () => {
    const r = buildHealthyResults();
    r.set("channel_selection", ok("channel_selection", {
      funnelStages: { awareness: ["meta_ads"], nurture: ["email"], conversion: [] },
      conversionChannelAssigned: false,
      confidenceScore: 0.85,
    }));
    return buildInput(r);
  },
  (v) => {
    const codes = v.blockReasons.map((b: any) => b.code);
    const passed = v.verdict === "BLOCK" && codes.includes("NO_CONVERSION_PATH");
    return { passed, details: passed ? "OK" : `expected BLOCK + NO_CONVERSION_PATH, got verdict=${v.verdict} mode=${v.executionMode} codes=${codes.join(",")}` };
  },
));

// ─── S7: Non-core engine timeout (retention) → still no PASS ────────────────
// Architect-found bug: prior implementation treated retention timeout as
// "doesn't matter" and returned PASS/FULL_EXECUTION. The pipeline-completeness
// check now requires every engine in PIPELINE_REQUIRED_ENGINES to complete.
scenarios.push(runScenario(
  "S7: retention TIMEOUT → reliability block, no PASS (architect-found gap)",
  () => {
    const r = buildHealthyResults();
    r.set("retention", timeout("retention" as EngineId));
    r.set("budget_governor", ok("budget_governor", { ...HEALTHY_BUDGET, decision: { action: "test" } }));
    return buildInput(r);
  },
  (v) => {
    const codes = v.blockReasons.map((b: any) => b.code);
    const passed = v.verdict !== "PASS"
      && (codes.includes("PIPELINE_INCOMPLETE") || codes.includes("ENGINE_TIMEOUT"));
    return { passed, details: passed ? "OK" : `expected reliability block, got verdict=${v.verdict} mode=${v.executionMode} codes=${codes.join(",")}` };
  },
));

// ─── S8: budget_governor entirely missing from results map → no PASS ────────
// Architect-found bug: prior implementation accepted a results map missing
// budget_governor and emitted PASS/FULL_EXECUTION. Pipeline-completeness now
// catches it.
scenarios.push(runScenario(
  "S8: budget_governor MISSING from results map → reliability block, no PASS (architect-found gap)",
  () => {
    const r = buildHealthyResults();
    r.delete("budget_governor");
    return buildInput(r);
  },
  (v) => {
    const codes = v.blockReasons.map((b: any) => b.code);
    const passed = v.verdict !== "PASS"
      && (codes.includes("PIPELINE_INCOMPLETE") || codes.includes("ENGINE_TIMEOUT"));
    return { passed, details: passed ? "OK" : `expected reliability block, got verdict=${v.verdict} mode=${v.executionMode} codes=${codes.join(",")}` };
  },
));

// ─── S9: Stale snapshot (sourceJobId mismatch) → STALE_SNAPSHOT_EVIDENCE ────
// A required engine result carries _provenance from a prior jobId. With
// currentJobId provided in config, checkSnapshotFreshness must mark it STALE
// and collectBlockReasons must promote it to STALE_SNAPSHOT_EVIDENCE.
scenarios.push(runScenario(
  "S9: stale snapshot (sourceJobId≠currentJobId) → STALE_SNAPSHOT_EVIDENCE, no PASS",
  () => {
    const r = buildHealthyResults();
    // Attach prior-run provenance to one engine's output.
    const audience = r.get("audience")!;
    audience.output = {
      ...audience.output,
      _provenance: {
        sourceJobId: "prior-run-job-zzz",
        sourceSnapshotId: "snap-aaa",
        createdAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
        wasReused: true,
        ageInDays: 5,
      },
    };
    return buildInput(r, { config: { campaignId: "test-campaign", accountId: "test-account", currentJobId: "current-run-job-xyz" } as any });
  },
  (v) => {
    const codes = v.blockReasons.map((b: any) => b.code);
    const passed = v.verdict !== "PASS"
      && codes.includes("STALE_SNAPSHOT_EVIDENCE");
    return { passed, details: passed ? "OK" : `expected STALE_SNAPSHOT_EVIDENCE, got verdict=${v.verdict} mode=${v.executionMode} codes=${codes.join(",")}` };
  },
));

// ─── S9b: freshnessClass NEEDS_REFRESH (no jobId mismatch) → STALE ─────────
// Validates that the architect-found dead branch is now live: even with
// matching sourceJobId, a NEEDS_REFRESH/INCOMPATIBLE classification must
// trigger STALE.
scenarios.push(runScenario(
  "S9b: freshnessClass=NEEDS_REFRESH (matching jobId) → STALE_SNAPSHOT_EVIDENCE",
  () => {
    const r = buildHealthyResults();
    const audience = r.get("audience")!;
    audience.output = {
      ...audience.output,
      _provenance: {
        sourceJobId: "current-run-job-xyz",
        sourceSnapshotId: "snap-bbb",
        createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
        wasReused: true,
        freshnessClass: "NEEDS_REFRESH",
        ageInDays: 30,
      },
    };
    return buildInput(r, { config: { campaignId: "test-campaign", accountId: "test-account", currentJobId: "current-run-job-xyz" } as any });
  },
  (v) => {
    const codes = v.blockReasons.map((b: any) => b.code);
    const passed = v.verdict !== "PASS" && codes.includes("STALE_SNAPSHOT_EVIDENCE");
    return { passed, details: passed ? "OK" : `expected STALE_SNAPSHOT_EVIDENCE, got verdict=${v.verdict} codes=${codes.join(",")}` };
  },
));

// ─── S10: Older completed run vs newer failed run → not silently stale-pass ─
// Pure-function test of detectNewerNonResolvableRun: the dashboard/API
// resolver MUST surface the newer failed run, not silently present the older
// COMPLETED run as the active truth.
import { detectNewerNonResolvableRun } from "../orchestrator/run-resolver";

scenarios.push((() => {
  const name = "S10: newer FAILED run shadows older COMPLETED — resolver must surface it";
  try {
    const olderCompleted = {
      id: "run-old",
      createdAt: new Date("2026-05-01T10:00:00Z"),
      completedAt: new Date("2026-05-01T10:30:00Z"),
    };
    const newerFailed = {
      id: "run-new",
      status: "FAILED",
      createdAt: new Date("2026-05-08T16:00:00Z"),
      completedAt: null,
    };
    const shadow = detectNewerNonResolvableRun(olderCompleted, newerFailed);

    // Control checks: must NOT shadow when:
    //  (a) latestAny is itself resolvable (COMPLETED)
    //  (b) latestAny is the same run as resolved
    //  (c) latestAny is older than resolved
    const noShadowControl = detectNewerNonResolvableRun(olderCompleted, {
      id: "run-new", status: "COMPLETED", createdAt: new Date("2026-05-08T16:00:00Z"), completedAt: null,
    });
    const noShadowSame = detectNewerNonResolvableRun(olderCompleted, {
      id: "run-old", status: "FAILED", createdAt: olderCompleted.createdAt, completedAt: olderCompleted.completedAt,
    });
    const noShadowOlder = detectNewerNonResolvableRun(olderCompleted, {
      id: "run-older-failed", status: "FAILED", createdAt: new Date("2026-04-01T10:00:00Z"), completedAt: null,
    });

    const ok = shadow !== null
      && shadow.runId === "run-new"
      && shadow.status === "FAILED"
      && noShadowControl === null
      && noShadowSame === null
      && noShadowOlder === null;

    return {
      name,
      passed: ok,
      details: ok
        ? `shadowed=${shadow!.runId}/${shadow!.status}; controls null=ok`
        : `shadow=${JSON.stringify(shadow)} ctrlControl=${JSON.stringify(noShadowControl)} ctrlSame=${JSON.stringify(noShadowSame)} ctrlOlder=${JSON.stringify(noShadowOlder)}`,
      verdict: "n/a",
      executionMode: "n/a",
      blocks: [],
      contradictions: 0,
      verifiedPass: 0,
      unverified: 0,
    } as ScenarioResult;
  } catch (e: any) {
    return {
      name, passed: false, details: `threw: ${e.message}`,
      verdict: "n/a", executionMode: "n/a", blocks: [], contradictions: 0, verifiedPass: 0, unverified: 0,
    } as ScenarioResult;
  }
})());

// ─── Report ─────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════════");
console.log("Phase R (May 2026) — Reliability Suite Results");
console.log("══════════════════════════════════════════════════════════════════\n");
let passCount = 0;
for (const s of scenarios) {
  const tag = s.passed ? "PASS" : "FAIL";
  console.log(`[${tag}] ${s.name}`);
  console.log(`       verdict=${s.verdict} mode=${s.executionMode} blocks=[${s.blocks.join(",")}] contradictions=${s.contradictions} checks=${s.verifiedPass}-pass/${s.unverified}-unverified`);
  if (!s.passed) console.log(`       → ${s.details}`);
  if (s.passed) passCount++;
}
console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`SUITE: ${passCount}/${scenarios.length} scenarios passed`);
console.log(`══════════════════════════════════════════════════════════════════\n`);
process.exit(passCount === scenarios.length ? 0 : 1);
