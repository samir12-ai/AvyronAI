import type { EngineId, EngineStepResult } from "../orchestrator/priority-matrix";
import type { IntegrityReport } from "../system-integrity/types";
import type { ComplianceResult } from "../causal-enforcement-layer/engine";
import type { SignalComposition } from "../shared/signal-lineage";
import type { SharedStrategicContext } from "../orchestrator/shared-strategic-context";
import type { StructuralCheck, BlockReason, Downgrade, BlockCode, DowngradeCode, CheckStatus } from "./types";
import { isUnverified, isVerifiedFail } from "./types";
import {
  FUNNEL_STRENGTH_MINIMUM_FOR_SCALE,
  SIGNAL_TRUST_MINIMUM_FOR_LAUNCH,
  SIGNAL_GROUNDING_FAILURE_THRESHOLD,
  CHANNEL_CONFIDENCE_MINIMUM,
} from "./constants";
import { requireContractField } from "../orchestrator/contract-registry";

// Phase C1 (May 2026) — funnelStages cutover. The 5 historical readers of
// `channel_selection.output.funnelStages` (which the engine actually writes
// at `funnelReconstruction.funnelStages`) now route through the contract
// boundary helper. The registry's legacyPaths entry continues to resolve
// snapshots stamped with the old shape so this PR is safe for in-flight runs.
type ChannelFunnelStages = {
  awareness: any[];
  nurture: any[];
  conversion: any[];
};

function readChannelFunnelStages(
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null,
):
  | { kind: "ok"; stages: ChannelFunnelStages }
  | { kind: "not_reached"; statusSeen: string }
  | { kind: "stale"; reason: string }
  | { kind: "incomplete"; reason: string } {
  const fr = requireContractField<ChannelFunnelStages>(
    "channel_selection",
    "funnelStages",
    results,
    currentJobId,
  );
  if (fr.status === "OK") return { kind: "ok", stages: fr.value };
  if (fr.status === "NOT_REACHED") return { kind: "not_reached", statusSeen: "MISSING" };
  if (fr.status === "STALE") return { kind: "stale", reason: fr.reason };
  return { kind: "incomplete", reason: fr.reason };
}

// -----------------------------------------------------------------------------
// Phase R (May 2026) reliability helpers
// -----------------------------------------------------------------------------
// Construct a check result with the correct (status, passed) pair. The boolean
// `passed` is preserved only for backward compatibility with legacy readers —
// the source of truth is `status`. Verdict-level logic must use `status === "PASS"`,
// never `passed === true`. See server/system-control/types.ts for semantics.
// -----------------------------------------------------------------------------

function pass(check: string, details: string): StructuralCheck {
  return { check, passed: true, status: "PASS", details };
}

function fail(check: string, details: string): StructuralCheck {
  return { check, passed: false, status: "FAIL", details };
}

function notReached(check: string, engineLabel: string, statusSeen: string): StructuralCheck {
  return {
    check,
    passed: false,
    status: statusSeen === "TIMEOUT" ? "TIMEOUT" : "NOT_REACHED",
    details: `${check}: ${engineLabel} did not produce required input (status=${statusSeen}) — check could not be verified`,
    unverifiedReason: `${engineLabel}_${statusSeen.toLowerCase()}`,
  };
}

function unknown(check: string, reason: string): StructuralCheck {
  return {
    check,
    passed: false,
    status: "UNKNOWN",
    details: `${check}: required input missing — ${reason}`,
    unverifiedReason: reason,
  };
}

function stale(check: string, reason: string): StructuralCheck {
  // STALE: a check could only be evaluated using snapshot data that does NOT
  // belong to the current run (sourceJobId mismatch, or snapshot-trust class
  // NEEDS_REFRESH/INCOMPATIBLE). Treated as unverified — see UNVERIFIED_STATUSES
  // in types.ts. collectBlockReasons promotes a STALE-only batch to the
  // STALE_SNAPSHOT_EVIDENCE block code; STALE never counts as PASS.
  return {
    check,
    passed: false,
    status: "STALE",
    details: `${check}: only stale prior-run evidence available — ${reason}`,
    unverifiedReason: reason,
  };
}

function skipped(check: string, reason: string): StructuralCheck {
  // Use SKIPPED only when the check is genuinely Not-Applicable to the current
  // system state (e.g. no objections were declared so objection-coverage cannot
  // apply). SKIPPED is treated as "unverified" by verdict logic and will block
  // a PASS verdict — that is intentional. If something is *truly* always-OK,
  // model it as PASS, not SKIPPED.
  return {
    check,
    passed: false,
    status: "SKIPPED",
    details: `${check}: not applicable — ${reason}`,
    unverifiedReason: reason,
  };
}

/**
 * Engine statuses that mean "the engine did not successfully produce output."
 * Includes TIMEOUT (Phase R). Used by every check that reads engine output to
 * decide whether to mark the check NOT_REACHED instead of fabricating a PASS.
 */
const ENGINE_NOT_REACHED_STATUSES = new Set([
  "SKIPPED",
  "BLOCKED",
  "ERROR",
  "TIMEOUT",
  "SIGNAL_BLOCKED",
  "DEPTH_BLOCKED",
  "BLOCKED_BY_INTEGRITY",
  "NEEDS_INPUT",
]);

function engineDidNotComplete(result: EngineStepResult | undefined): { notReached: true; status: string } | { notReached: false } {
  if (!result) return { notReached: true, status: "MISSING" };
  if (ENGINE_NOT_REACHED_STATUSES.has(result.status)) {
    return { notReached: true, status: result.status };
  }
  return { notReached: false };
}

// -----------------------------------------------------------------------------
// Structural checks
// -----------------------------------------------------------------------------

export function checkConversionPath(
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null = null,
): StructuralCheck {
  const channelResult = results.get("channel_selection");
  const reach = engineDidNotComplete(channelResult);
  if (reach.notReached) {
    return notReached("conversion_path_exists", "channel_selection", reach.status);
  }

  // C1 cutover: route through the contract boundary helper so this check
  // and the 4 sibling readers all resolve from the same canonical path
  // (`funnelReconstruction.funnelStages`) with legacyPath fallback.
  const stagesResult = readChannelFunnelStages(results, currentJobId);
  const output = channelResult!.output;
  const conversionChannels =
    stagesResult.kind === "ok" ? stagesResult.stages.conversion ?? null : null;
  if (stagesResult.kind === "stale") {
    return stale("conversion_path_exists", `channel_selection.funnelStages: ${stagesResult.reason}`);
  }
  const conversionAssigned = output?.conversionChannelAssigned === true;

  if (conversionAssigned && (!conversionChannels || conversionChannels.length === 0)) {
    // Engine claims it assigned a conversion channel but the array is empty —
    // we can't verify either way without a channels array.
    return unknown("conversion_path_exists", "engine claims conversionChannelAssigned=true but funnelStages.conversion is empty/missing");
  }

  if (!conversionChannels || !Array.isArray(conversionChannels) || conversionChannels.length === 0) {
    const warnings: string[] = output?.structuralWarnings || output?.warnings || [];
    const hasFunnelGapWarning = warnings.some((w: string) => w.includes("FUNNEL GAP"));
    return fail(
      "conversion_path_exists",
      hasFunnelGapWarning
        ? "No conversion channel assigned and funnel completion enforcement failed"
        : "No conversion channel found in channel selection output",
    );
  }

  return pass("conversion_path_exists", `${conversionChannels.length} conversion channel(s) assigned`);
}

export function checkSignalGrounding(
  signalComposition: SignalComposition | null,
  budgetAction: string | null,
): StructuralCheck {
  if (!signalComposition) {
    return unknown("signal_grounding", "no signal composition data available — cannot verify grounding");
  }

  const hasRealData = signalComposition.realRatio > 0;
  const isScaling = budgetAction === "scale";

  if (isScaling && !hasRealData) {
    return fail(
      "signal_grounding",
      `Budget action is "scale" but realRatio=${signalComposition.realRatio.toFixed(2)} — zero real performance data`,
    );
  }

  if (isScaling && signalComposition.trustedRatio < SIGNAL_TRUST_MINIMUM_FOR_LAUNCH) {
    return fail(
      "signal_grounding",
      `Budget action is "scale" but trustedRatio=${signalComposition.trustedRatio.toFixed(2)} — below ${SIGNAL_TRUST_MINIMUM_FOR_LAUNCH} minimum`,
    );
  }

  return pass(
    "signal_grounding",
    `realRatio=${signalComposition.realRatio.toFixed(2)} trustedRatio=${signalComposition.trustedRatio.toFixed(2)} budgetAction=${budgetAction}`,
  );
}

export function checkIntegrityStatus(integrityReport: IntegrityReport | null): StructuralCheck {
  if (!integrityReport) {
    return unknown("integrity_status", "no integrity report available — cannot verify integrity");
  }

  if (integrityReport.overallStatus === "FAIL") {
    return fail("integrity_status", `Integrity FAIL: ${integrityReport.failureReasons.join("; ")}`);
  }

  return pass(
    "integrity_status",
    `Integrity ${integrityReport.overallStatus} — leakage=${integrityReport.zeroLeakage ? "none" : "detected"} traceability=${integrityReport.traceabilityComplete ? "complete" : "incomplete"}`,
  );
}

export function checkCELCompliance(celResults: ComplianceResult[]): StructuralCheck {
  if (!celResults || celResults.length === 0) {
    return unknown("cel_compliance", "no CEL results available — cannot verify causal compliance");
  }

  const failed = celResults.filter((c: any) => c.passed === false || c.overallPassed === false);
  if (failed.length > 0) {
    return fail("cel_compliance", `${failed.length} CEL check(s) failed`);
  }

  return pass("cel_compliance", `${celResults.length} CEL check(s) passed`);
}

export function checkUpstreamEngineHealth(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const critical: EngineId[] = ["offer", "funnel", "positioning"];
  const failures: string[] = [];
  const timedOut: string[] = [];
  const missing: string[] = [];

  for (const engineId of critical) {
    const result = results.get(engineId);
    if (!result) {
      missing.push(engineId);
      continue;
    }
    if (result.status === "ERROR" || result.status === "BLOCKED" || result.status === "SIGNAL_BLOCKED") {
      failures.push(`${engineId}:${result.status}`);
    } else if (result.status === "TIMEOUT") {
      timedOut.push(engineId);
    }
  }

  if (failures.length > 0) {
    return fail("upstream_engine_health", `Critical engine failures: ${failures.join(", ")}`);
  }

  if (timedOut.length > 0) {
    // Genuine TIMEOUT — preserve the status so recovery can route correctly
    // (timeout suggests retry; missing suggests pipeline-orchestration bug).
    return notReached("upstream_engine_health", `engines_timed_out=[${timedOut.join(",")}]`, "TIMEOUT");
  }

  if (missing.length > 0) {
    // Engines that were never registered in the results map at all — this is
    // not a TIMEOUT (we have no evidence the engine ever started); it is an
    // UNKNOWN reliability state. Distinguishing this matters for diagnostics
    // and for recovery-intelligence routing.
    return unknown("upstream_engine_health", `critical engines absent from results map: [${missing.join(",")}]`);
  }

  return pass("upstream_engine_health", "All critical upstream engines healthy");
}

/**
 * Phase R (May 2026) — global pipeline-completeness gate.
 *
 * Independent of every other structural check. Iterates the full results map
 * + a static required-engine list. Any engine that is MISSING from the
 * results map, or present with a non-completed status (TIMEOUT/ERROR/
 * SKIPPED/BLOCKED/SIGNAL_BLOCKED/DEPTH_BLOCKED/BLOCKED_BY_INTEGRITY/
 * NEEDS_INPUT) means we ran an incomplete pipeline and we cannot trust the
 * verdict. Returns NOT_REACHED (or TIMEOUT if every failure was a timeout)
 * which propagates into the reliability-block path in collectBlockReasons.
 *
 * This is the structural-check counterpart of the same conservative rule
 * recovery-intelligence applies (assessUpstreamReliability).
 */
const PIPELINE_REQUIRED_ENGINES: EngineId[] = [
  "market_intelligence",
  "audience",
  "positioning",
  "offer",
  "funnel",
  "channel_selection",
  "statistical_validation",
  "budget_governor",
  "iteration",
  "retention",
];

/**
 * Phase R T002 — snapshot-freshness gate.
 *
 * For every required engine, inspect its output for an attached
 * `_provenance` block (set by snapshot-reuse.ts:safeReuse on cache hits).
 * If the result is a reuse from a different jobId, OR the snapshot is
 * classified NEEDS_REFRESH/INCOMPATIBLE by snapshot-trust, the check fails
 * STALE. This guarantees no PASS verdict can be issued from snapshots that
 * silently belong to a previous run.
 *
 * Engine results without provenance are assumed to be fresh-from-this-run
 * (snapshot-reuse only attaches provenance on cache hits). Therefore this
 * check is non-disruptive when the orchestrator runs every engine end-to-end.
 *
 * If `currentJobId` is null/undefined we skip the check entirely (legacy
 * caller path); explicit opt-in only.
 */
export function checkSnapshotFreshness(
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null | undefined,
): StructuralCheck {
  if (!currentJobId) {
    // Legacy callers (or test inputs) that have not opted into the freshness
    // gate must not be punished — return PASS-noop. The orchestrator's only
    // call site (server/orchestrator/index.ts) ALWAYS supplies currentJobId,
    // so production verdicts are always gated.
    return pass("snapshot_freshness", "freshness gate not opted-in (no currentJobId)");
  }

  const staleEngines: string[] = [];
  const detail: string[] = [];

  for (const engineId of PIPELINE_REQUIRED_ENGINES) {
    const result = results.get(engineId);
    if (!result) continue; // pipeline-completeness check owns the missing case
    const provenance = (result.output as any)?._provenance;
    if (!provenance || provenance.wasReused !== true) continue;

    const sourceJobId = provenance.sourceJobId ?? null;
    const freshnessClass = provenance.freshnessClass ?? null;
    const ageInDays = provenance.ageInDays;

    const jobMismatch = sourceJobId !== null && sourceJobId !== currentJobId;
    const schemaIncompatible = freshnessClass === "INCOMPATIBLE";
    const needsRefresh = freshnessClass === "NEEDS_REFRESH";

    if (jobMismatch || schemaIncompatible || needsRefresh) {
      staleEngines.push(engineId);
      const reasons: string[] = [];
      if (jobMismatch) reasons.push(`sourceJobId=${sourceJobId ?? "null"}≠currentJobId=${currentJobId}`);
      if (schemaIncompatible) reasons.push(`schema=INCOMPATIBLE`);
      if (needsRefresh) reasons.push(`freshness=NEEDS_REFRESH`);
      if (typeof ageInDays === "number") reasons.push(`age=${ageInDays}d`);
      detail.push(`${engineId}[${reasons.join(",")}]`);
    }
  }

  if (staleEngines.length === 0) {
    return pass("snapshot_freshness", "all required engines fresh-from-current-run or freshly reused");
  }

  return stale(
    "snapshot_freshness",
    `stale_engines=[${staleEngines.join(",")}] details=${detail.join(";")}`,
  );
}

export function checkPipelineCompleteness(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const missing: string[] = [];
  const timedOut: string[] = [];
  const errored: string[] = [];
  const skipped: string[] = [];
  const blocked: string[] = [];

  for (const engineId of PIPELINE_REQUIRED_ENGINES) {
    const result = results.get(engineId);
    if (!result) { missing.push(engineId); continue; }
    switch (result.status) {
      case "TIMEOUT": timedOut.push(engineId); break;
      case "ERROR": errored.push(engineId); break;
      case "SKIPPED": skipped.push(engineId); break;
      case "BLOCKED":
      case "SIGNAL_BLOCKED":
      case "DEPTH_BLOCKED":
      case "BLOCKED_BY_INTEGRITY":
      case "NEEDS_INPUT":
        blocked.push(`${engineId}:${result.status}`);
        break;
    }
  }

  const totalUnreached = missing.length + timedOut.length + errored.length + skipped.length + blocked.length;
  if (totalUnreached === 0) {
    return pass("pipeline_completeness", `All ${PIPELINE_REQUIRED_ENGINES.length} required engines completed`);
  }

  // If the only failures were timeouts, surface as TIMEOUT so the reliability
  // block code becomes ENGINE_TIMEOUT and recovery can route to retry.
  // Otherwise NOT_REACHED for the broader pipeline-incomplete bucket.
  const onlyTimeouts = timedOut.length > 0 && errored.length === 0 && missing.length === 0
    && skipped.length === 0 && blocked.length === 0;
  const summaryParts: string[] = [];
  if (missing.length) summaryParts.push(`missing=[${missing.join(",")}]`);
  if (timedOut.length) summaryParts.push(`timed_out=[${timedOut.join(",")}]`);
  if (errored.length) summaryParts.push(`errored=[${errored.join(",")}]`);
  if (skipped.length) summaryParts.push(`skipped=[${skipped.join(",")}]`);
  if (blocked.length) summaryParts.push(`blocked=[${blocked.join(",")}]`);
  const summary = summaryParts.join(" ");

  return notReached(
    "pipeline_completeness",
    `pipeline_incomplete (${totalUnreached}/${PIPELINE_REQUIRED_ENGINES.length} engines unreached): ${summary}`,
    onlyTimeouts ? "TIMEOUT" : "MISSING",
  );
}

export function checkFunnelStructuralCompleteness(
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null = null,
): StructuralCheck {
  const channelResult = results.get("channel_selection");
  const reach = engineDidNotComplete(channelResult);
  if (reach.notReached) {
    return notReached("funnel_structural_completeness", "channel_selection", reach.status);
  }

  // C1 cutover: contract-boundary read replaces the broken legacy-only path
  // (`output.funnelStages`). The canonical location is
  // `output.funnelReconstruction.funnelStages`; legacy is tolerated.
  const stagesResult = readChannelFunnelStages(results, currentJobId);
  if (stagesResult.kind === "stale") {
    return stale("funnel_structural_completeness", `channel_selection.funnelStages: ${stagesResult.reason}`);
  }
  if (stagesResult.kind === "incomplete" || stagesResult.kind === "not_reached") {
    return unknown(
      "funnel_structural_completeness",
      stagesResult.kind === "incomplete"
        ? `channel_selection produced no funnelStages (${stagesResult.reason})`
        : "channel_selection result missing from results map",
    );
  }
  const stages = stagesResult.stages;
  const awareness = Array.isArray(stages.awareness) ? stages.awareness.length : 0;
  const nurture = Array.isArray(stages.nurture) ? stages.nurture.length : 0;
  const conversion = Array.isArray(stages.conversion) ? stages.conversion.length : 0;

  const missing: string[] = [];
  if (awareness === 0) missing.push("awareness");
  if (nurture === 0) missing.push("nurture");
  if (conversion === 0) missing.push("conversion");

  if (missing.length > 0) {
    return fail(
      "funnel_structural_completeness",
      `Missing funnel stages: ${missing.join(", ")} (awareness=${awareness}, nurture=${nurture}, conversion=${conversion})`,
    );
  }

  return pass(
    "funnel_structural_completeness",
    `All stages present (awareness=${awareness}, nurture=${nurture}, conversion=${conversion})`,
  );
}

export function checkBudgetFunnelAlignment(results: Map<EngineId, EngineStepResult>): {
  contradiction: boolean;
  details: string;
  downgrade: Downgrade | null;
} {
  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output) {
    return { contradiction: false, details: "No budget output — check skipped", downgrade: null };
  }

  const action = budgetResult.output.decision?.action;
  const funnelStrength = budgetResult.output.funnelStrengthScore ?? budgetResult.output.decision?.funnelStrengthScore ?? null;

  if (action === "scale" && funnelStrength !== null && funnelStrength < FUNNEL_STRENGTH_MINIMUM_FOR_SCALE) {
    return {
      contradiction: true,
      details: `Budget says "scale" but funnelStrength=${funnelStrength.toFixed(2)} < ${FUNNEL_STRENGTH_MINIMUM_FOR_SCALE} threshold`,
      downgrade: {
        from: "scale",
        to: "test",
        reason: `Funnel strength ${funnelStrength.toFixed(2)} is below scaling threshold ${FUNNEL_STRENGTH_MINIMUM_FOR_SCALE}`,
        code: "WEAK_FUNNEL_FOR_SCALE" as DowngradeCode,
        affectedEngine: "budget_governor",
      },
    };
  }

  return { contradiction: false, details: `Budget action=${action} funnelStrength=${funnelStrength?.toFixed(2) ?? "n/a"} — aligned`, downgrade: null };
}

export function checkBudgetCACVerification(results: Map<EngineId, EngineStepResult>): {
  unverified: boolean;
  details: string;
  downgrade: Downgrade | null;
} {
  const budgetResult = results.get("budget_governor");
  if (!budgetResult?.output) {
    return { unverified: false, details: "No budget output — check skipped", downgrade: null };
  }

  const action = budgetResult.output.decision?.action;
  const warnings: string[] = budgetResult.output.warnings || [];
  const hasNoCACData = warnings.some((w: string) => w.includes("No historical CPA data"));

  if (action === "scale" && hasNoCACData) {
    return {
      unverified: true,
      details: "Budget action is 'scale' but no historical CPA data exists — CAC projections unverified",
      downgrade: {
        from: "scale",
        to: "test",
        reason: "No historical CPA data — scaling with unverified CAC projections",
        code: "UNVERIFIED_CAC" as DowngradeCode,
        affectedEngine: "budget_governor",
      },
    };
  }

  return { unverified: false, details: `Budget action=${action} CPA data=${hasNoCACData ? "missing" : "present"}`, downgrade: null };
}

export function checkValidationResult(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const validationResult = results.get("statistical_validation");
  const reach = engineDidNotComplete(validationResult);
  if (reach.notReached) {
    return notReached("validation_result", "statistical_validation", reach.status);
  }

  // H6 (2026-05-10): canonical-only verdict read.
  // The previous chain `output?.result || output?.validationResult || output?.status`
  // was a live D1 violation — F1 engine-execution status (`status`) cannot
  // satisfy the F3 validation-verdict contract (`validationState`).
  // ESLint rule `semantic/no-semantic-fallback` flagged this site.
  const output = validationResult!.output;
  const result = output?.validationState ?? output?.result?.validationState ?? null;

  if (result === "rejected") {
    return fail("validation_result", `Statistical validation validationState="rejected" — strategy rejected by validation engine`);
  }

  return pass("validation_result", `Statistical validation validationState="${result ?? "n/a"}"`);
}

export function checkSignalGroundingMassFailure(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const failedEngines: string[] = [];
  const allEngines = Array.from(results.entries());

  for (const [engineId, result] of allEngines) {
    if (result.status === "SIGNAL_BLOCKED" || result.status === "ERROR" || result.status === "TIMEOUT") {
      failedEngines.push(`${engineId}:${result.status}`);
    }
  }

  if (failedEngines.length >= SIGNAL_GROUNDING_FAILURE_THRESHOLD) {
    return fail(
      "signal_grounding_mass_failure",
      `${failedEngines.length} engines in SIGNAL_BLOCKED/ERROR/TIMEOUT state (threshold=${SIGNAL_GROUNDING_FAILURE_THRESHOLD}): ${failedEngines.join(", ")}`,
    );
  }

  return pass(
    "signal_grounding_mass_failure",
    `${failedEngines.length} engine(s) in failure state — below threshold of ${SIGNAL_GROUNDING_FAILURE_THRESHOLD}`,
  );
}

/**
 * P0-6 (launch-closure W2-T2 architect-finding fix): dedicated structural
 * check that surfaces the offer-engine `OFFER_INPUT_INSUFFICIENT` hard-block
 * as a verified FAIL even when the orchestrator marked the engine BLOCKED
 * (which would otherwise short-circuit `engineDidNotComplete` to notReached
 * and leave the block code orphaned). Reads the engine's
 * `layerDiagnostics.blockCode` directly off `result.output` so it works in
 * both BLOCKED and INSUFFICIENT_SIGNALS exit shapes.
 */
export function checkOfferInputSufficient(
  results: Map<EngineId, EngineStepResult>,
  currentJobId: string | null = null,
): StructuralCheck {
  const offerResult = results.get("offer");
  if (!offerResult) {
    return notReached("offer_input_sufficient", "offer", "MISSING");
  }

  // Seal #9 (F2.2 #1 / pass-4) — canonical contract read. The offer engine's
  // `status` field is registered in OFFER_CONTRACT (z.enum), so we read it
  // through the boundary helper instead of via bespoke `output?.status`
  // logic. This satisfies D2 (each meaning has its own canonical field),
  // D3 (strict enum shape), and D5 (missing canonical → CONTRACT_INCOMPLETE
  // surfaced as `unknown(...)` instead of silently substituted).
  const statusRead = requireContractField<string>("offer", "status", results, currentJobId);

  const output = offerResult.output as any | null;
  // `blockCode` is NOT a contract-registered field — it's an engine-internal
  // diagnostic. Reading it via the if/else helper below keeps the
  // alias-detector quiet (the local var is renamed off the `code` suffix
  // anyway, but we use plain if-blocks for clarity).
  let blockCodeValue: string | null = null;
  if (typeof output?.layerDiagnostics?.blockCode === "string" && output.layerDiagnostics.blockCode.length > 0) {
    blockCodeValue = output.layerDiagnostics.blockCode;
  } else if (typeof output?.blockCode === "string" && output.blockCode.length > 0) {
    blockCodeValue = output.blockCode;
  }

  const isInsufficientSignals = statusRead.status === "OK" && statusRead.value === "INSUFFICIENT_SIGNALS";
  const blocked =
    blockCodeValue === "OFFER_INPUT_INSUFFICIENT" ||
    isInsufficientSignals ||
    (offerResult.status === "BLOCKED" && typeof offerResult.blockReason === "string" && offerResult.blockReason.includes("OFFER_INPUT_INSUFFICIENT"));
  if (blocked) {
    let detail: string;
    if (typeof output?.statusMessage === "string" && output.statusMessage.length > 0) {
      detail = output.statusMessage;
    } else if (typeof offerResult.blockReason === "string" && offerResult.blockReason.length > 0) {
      detail = offerResult.blockReason;
    } else {
      detail = "Offer engine reported insufficient input — no audience pains and no raw market-language pain phrases available.";
    }
    return fail("offer_input_sufficient", `OFFER_INPUT_INSUFFICIENT: ${detail}`);
  }

  // Architect pass-4 finding: explicit branch handling for every
  // ContractFieldResult status. requireContractField returns NOT_REACHED
  // whenever engine status is not SUCCESS|PARTIAL — so ERROR/TIMEOUT/SKIPPED
  // (and BLOCKED without the OFFER_INPUT_INSUFFICIENT signal already caught
  // above) must NOT fall through to pass(). NOT_REACHED → emit notReached()
  // so the verdict pipeline correctly attributes the gap to the engine's
  // execution status. Other non-OK statuses (INCOMPLETE / INVALID / STALE)
  // → D5 unknown() with CONTRACT_INCOMPLETE attribution.
  if (statusRead.status === "NOT_REACHED") {
    return notReached("offer_input_sufficient", "offer", offerResult.status);
  }
  if (statusRead.status !== "OK") {
    return unknown(
      "offer_input_sufficient",
      `CONTRACT_INCOMPLETE: offer engine canonical \`status\` field unreadable (${statusRead.status}: ${statusRead.reason}) — cannot verify pain-input sufficiency`,
    );
  }

  return pass("offer_input_sufficient", "Offer engine has sufficient pain input");
}

export function checkOfferAudienceMisalignment(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const offerResult = results.get("offer");
  const reach = engineDidNotComplete(offerResult);
  if (reach.notReached) {
    return notReached("offer_audience_misalignment", "offer", reach.status);
  }
  if (!offerResult!.output) {
    return unknown("offer_audience_misalignment", "offer engine reported success but produced no output");
  }

  const output = offerResult!.output;
  const warnings: string[] = Array.isArray(output.structuralWarnings) ? output.structuralWarnings : [];
  const alignmentValidation = output.layerDiagnostics?.offerAlignmentValidation || output.offerAlignmentValidation;

  const hasPainMisalignment = warnings.some((w: string) =>
    w.includes("does not reflect any identified audience pain") ||
    w.includes("Market language preservation failed") ||
    w.includes("completely disconnected from market language")
  );

  const alignmentFailed = alignmentValidation && alignmentValidation.aligned === false;

  const integrityChecks = output.layerDiagnostics?.integrityChecks;
  const painNotAligned = integrityChecks && integrityChecks.painAligned === false;

  if (hasPainMisalignment || (alignmentFailed && painNotAligned)) {
    return fail(
      "offer_audience_misalignment",
      `Offer does not address audience pains — ${hasPainMisalignment ? "pain signal mismatch detected" : "alignment validation failed with pain misalignment"}`,
    );
  }

  return pass("offer_audience_misalignment", "Offer addresses audience pains");
}

export function checkZeroObjectionCoverage(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const offerResult = results.get("offer");
  const audienceResult = results.get("audience");
  const offerReach = engineDidNotComplete(offerResult);
  const audienceReach = engineDidNotComplete(audienceResult);
  if (offerReach.notReached) {
    return notReached("zero_objection_coverage", "offer", offerReach.status);
  }
  if (audienceReach.notReached) {
    return notReached("zero_objection_coverage", "audience", audienceReach.status);
  }
  if (!offerResult!.output || !audienceResult!.output) {
    return unknown("zero_objection_coverage", "offer or audience produced empty output");
  }

  const objectionMap = audienceResult!.output.objectionMap || {};
  const objections = Object.keys(objectionMap);

  if (objections.length === 0) {
    // Genuinely not applicable: there are no objections to cover. This is a
    // verified-PASS condition because we successfully read the audience output
    // and confirmed zero objections — not a "data missing" situation.
    return pass("zero_objection_coverage", "No audience objections declared — coverage requirement vacuously satisfied");
  }

  const offerOutput = offerResult!.output;
  const primaryOffer = offerOutput.primaryOffer || offerOutput;
  const objectionHandling = Array.isArray(primaryOffer.objectionHandling) ? primaryOffer.objectionHandling : [];
  const riskNotes = Array.isArray(primaryOffer.riskNotes) ? primaryOffer.riskNotes : [];
  const proofAlignment = Array.isArray(primaryOffer.proofAlignment) ? primaryOffer.proofAlignment :
    (Array.isArray(primaryOffer.proofLayer?.alignedProofTypes) ? primaryOffer.proofLayer.alignedProofTypes : []);

  const hasAnyCoverage = objectionHandling.length > 0 || proofAlignment.length > 0 ||
    riskNotes.some((n: string) => n.toLowerCase().includes("objection") || n.toLowerCase().includes("risk"));

  if (!hasAnyCoverage) {
    return fail(
      "zero_objection_coverage",
      `${objections.length} audience objection(s) exist but offer has zero objection coverage — no objection handling, proof alignment, or risk mitigation`,
    );
  }

  return pass("zero_objection_coverage", `Objection coverage present for ${objections.length} audience objection(s)`);
}

export function checkChannelConfidenceMinimum(results: Map<EngineId, EngineStepResult>): StructuralCheck {
  const channelResult = results.get("channel_selection");
  const reach = engineDidNotComplete(channelResult);
  if (reach.notReached) {
    return notReached("channel_confidence_minimum", "channel_selection", reach.status);
  }
  if (!channelResult!.output) {
    return unknown("channel_confidence_minimum", "channel_selection produced no output");
  }

  const output = channelResult!.output;
  const confidence = typeof output.confidenceScore === "number" ? output.confidenceScore :
    typeof output.confidence === "number" ? output.confidence : null;

  if (confidence === null) {
    return unknown("channel_confidence_minimum", "channel_selection emitted no confidenceScore field");
  }

  if (confidence < CHANNEL_CONFIDENCE_MINIMUM) {
    return fail(
      "channel_confidence_minimum",
      `Channel selection confidence=${confidence.toFixed(2)} is below minimum threshold ${CHANNEL_CONFIDENCE_MINIMUM}`,
    );
  }

  return pass("channel_confidence_minimum", `Channel confidence=${confidence.toFixed(2)} meets minimum ${CHANNEL_CONFIDENCE_MINIMUM}`);
}

export function checkUnresolvedCriticalProblems(ssc: SharedStrategicContext | null): StructuralCheck {
  if (!ssc) {
    return unknown("unresolved_critical_problems", "no SSC available — problem registry cannot be inspected");
  }

  const unresolved = ssc.problemRegistry.filter(
    (p) => (p.status === "open" || p.status === "cannot_resolve") && p.severity === "critical"
  );

  if (unresolved.length > 0) {
    const descriptions = unresolved.map(p => `${p.id}(${p.status}): ${p.description.slice(0, 80)}`).join("; ");
    return fail("unresolved_critical_problems", `${unresolved.length} critical problem(s) unresolved: ${descriptions}`);
  }

  return pass("unresolved_critical_problems", "No unresolved critical problems");
}

export function checkConfidenceChainIntegrity(ssc: SharedStrategicContext | null): StructuralCheck {
  if (!ssc || ssc.confidenceChain.length === 0) {
    return unknown("confidence_chain_integrity", "no confidence chain data — cannot verify integrity");
  }

  const violations: string[] = [];

  for (const entry of ssc.confidenceChain) {
    const entryFloor = entry.inheritedFloor;
    const maxAllowed = entryFloor + 0.20;
    if (entry.combinedConfidence > maxAllowed && entryFloor < 1.0) {
      violations.push(`${entry.engineId}: combined=${entry.combinedConfidence.toFixed(2)} > floor(${entryFloor.toFixed(2)})+0.20=${maxAllowed.toFixed(2)}`);
    }
  }

  if (violations.length > 0) {
    return fail("confidence_chain_integrity", `${violations.length} engine(s) exceed confidence floor+0.20: ${violations.join("; ")}`);
  }

  return pass("confidence_chain_integrity", `All ${ssc.confidenceChain.length} engines within their inherited floor+0.20 bound`);
}

export function checkPositioningHardGate(ssc: SharedStrategicContext | null): StructuralCheck {
  if (!ssc || ssc.confidenceChain.length === 0) {
    return unknown("positioning_hard_gate", "no confidence chain data — positioning entry cannot be inspected");
  }

  const positioningEntry = ssc.confidenceChain.find(e => e.engineId === "positioning");
  if (!positioningEntry) {
    return unknown("positioning_hard_gate", "no positioning confidence entry in chain — engine likely did not complete");
  }

  if (positioningEntry.engineConfidence < 0.40) {
    return fail(
      "positioning_hard_gate",
      `Positioning engineConfidence=${positioningEntry.engineConfidence.toFixed(2)} is below hard gate threshold 0.40 (gates on engine logic quality, not data reliability)`,
    );
  }

  return pass(
    "positioning_hard_gate",
    `Positioning engineConfidence=${positioningEntry.engineConfidence.toFixed(2)} meets threshold 0.40`,
  );
}

export function checkConfidenceSpread(ssc: SharedStrategicContext | null): StructuralCheck {
  if (!ssc || ssc.confidenceChain.length < 2) {
    return unknown("confidence_spread", "insufficient confidence chain data — at least 2 engines required");
  }

  // statistical_validation emits a *grounding quality* score (lineage
  // composition + signal origin ratios) rather than a self-evaluated engine
  // confidence. Excluded from spread for the same reasons documented prior.
  const comparableEntries = ssc.confidenceChain.filter(
    e => e.engineId !== "statistical_validation",
  );
  if (comparableEntries.length < 2) {
    return unknown("confidence_spread", "insufficient comparable confidence chain data — at least 2 non-statistical engines required");
  }

  const scores = comparableEntries.map(e => e.combinedConfidence);
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const spread = maxScore - minScore;
  const SPREAD_THRESHOLD = 0.50;

  if (spread > SPREAD_THRESHOLD) {
    const maxEngine = comparableEntries.find(e => e.combinedConfidence === maxScore)?.engineId ?? "unknown";
    const minEngine = comparableEntries.find(e => e.combinedConfidence === minScore)?.engineId ?? "unknown";
    return fail(
      "confidence_spread",
      `Confidence spread=${spread.toFixed(2)} exceeds ${SPREAD_THRESHOLD.toFixed(2)} threshold — highest: ${maxEngine}(${maxScore.toFixed(2)}) lowest: ${minEngine}(${minScore.toFixed(2)})`,
    );
  }

  return pass(
    "confidence_spread",
    `Confidence spread=${spread.toFixed(2)} within ${SPREAD_THRESHOLD.toFixed(2)} threshold (statistical_validation grounding-quality score excluded)`,
  );
}

export function checkBudgetOverrideZeroConfidence(ssc: SharedStrategicContext | null, results: Map<EngineId, EngineStepResult>): StructuralCheck {
  if (!ssc) {
    return unknown("budget_override_zero_confidence", "no SSC available — confidence floor cannot be inspected");
  }

  if (ssc.confidenceFloor !== 0) {
    return pass(
      "budget_override_zero_confidence",
      `Confidence floor=${ssc.confidenceFloor.toFixed(2)} — budget override allowed`,
    );
  }

  const budgetResult = results.get("budget_governor");
  const budgetActionValue = budgetResult?.output?.decision?.action ?? null;

  if (budgetActionValue === "scale" || budgetActionValue === "test") {
    return fail(
      "budget_override_zero_confidence",
      `Budget action="${budgetActionValue}" but confidenceFloor=0 — performance override blocked when system has zero confidence`,
    );
  }

  return pass(
    "budget_override_zero_confidence",
    `Confidence floor=0 but budget action="${budgetActionValue}" — no performance override attempted`,
  );
}

// -----------------------------------------------------------------------------
// Block reason collection
// -----------------------------------------------------------------------------

export function collectBlockReasons(checks: StructuralCheck[], results: Map<EngineId, EngineStepResult>): BlockReason[] {
  const blocks: BlockReason[] = [];

  const budgetResult = results.get("budget_governor");
  const killFlag = budgetResult?.output?.killFlag === true;
  const budgetAction = budgetResult?.output?.decision?.action;

  if (killFlag) {
    blocks.push({
      code: "BUDGET_KILL",
      description: "Budget governor kill flag is active",
      source: "budget_governor",
      severity: "critical",
    });
  }

  if (budgetAction === "halt") {
    blocks.push({
      code: "BUDGET_HALT",
      description: "Budget governor decision is halt",
      source: "budget_governor",
      severity: "critical",
    });
  }

  // Phase R: emit a single PIPELINE_INCOMPLETE block summarising every check
  // that could not be verified. This guarantees an unverified pipeline can
  // never produce a PASS verdict.
  const unverifiedChecks = checks.filter(isUnverified);
  if (unverifiedChecks.length > 0) {
    const timeoutCount = unverifiedChecks.filter(c => c.status === "TIMEOUT").length;
    const staleCount = unverifiedChecks.filter(c => c.status === "STALE").length;
    const notReachedCount = unverifiedChecks.filter(c => c.status === "NOT_REACHED").length;
    const unknownCount = unverifiedChecks.filter(c => c.status === "UNKNOWN").length;
    const summary = unverifiedChecks
      .slice(0, 6)
      .map(c => `${c.check}=${c.status}${c.unverifiedReason ? `(${c.unverifiedReason})` : ""}`)
      .join("; ");
    blocks.push({
      code: timeoutCount > 0 ? "ENGINE_TIMEOUT" : staleCount > 0 ? "STALE_SNAPSHOT_EVIDENCE" : "PIPELINE_INCOMPLETE",
      description: `${unverifiedChecks.length} check(s) could not be verified ` +
        `(timeout=${timeoutCount}, stale=${staleCount}, not_reached=${notReachedCount}, unknown=${unknownCount}). ` +
        `Verdict cannot be trusted. First reasons: ${summary}`,
      source: "system_control_pipeline",
      severity: "critical",
    });
  }

  // Phase R: only emit per-check FAIL blocks for genuinely verified failures.
  // Unverified checks (NOT_REACHED/TIMEOUT/STALE/UNKNOWN/SKIPPED) must not be
  // re-blamed as e.g. NO_CONVERSION_PATH when the truth is "we never ran the
  // engine that decides conversion paths."
  for (const check of checks) {
    if (!isVerifiedFail(check)) continue;

    switch (check.check) {
      case "conversion_path_exists":
        blocks.push({ code: "NO_CONVERSION_PATH", description: check.details, source: "structural_check", severity: "critical" });
        break;
      case "signal_grounding":
        blocks.push({ code: "SCALE_WITHOUT_REAL_DATA", description: check.details, source: "structural_check", severity: "critical" });
        break;
      case "integrity_status":
        blocks.push({ code: "INTEGRITY_FAILURE", description: check.details, source: "system_integrity", severity: "critical" });
        break;
      case "cel_compliance":
        blocks.push({ code: "COMPLIANCE_FAILURE", description: check.details, source: "cel_enforcement", severity: "high" });
        break;
      case "validation_result":
        blocks.push({ code: "VALIDATION_REJECTED", description: check.details, source: "statistical_validation", severity: "critical" });
        break;
      case "signal_grounding_mass_failure":
        blocks.push({ code: "SIGNAL_GROUNDING_MASS_FAILURE", description: check.details, source: "structural_check", severity: "critical" });
        break;
      case "offer_input_sufficient":
        // P0-6 architect-finding fix: route the dedicated insufficient-input
        // FAIL to the canonical BlockCode so recovery-map picks it up.
        blocks.push({ code: "OFFER_INPUT_INSUFFICIENT", description: check.details, source: "offer_engine", severity: "critical" });
        break;
      case "offer_audience_misalignment":
        blocks.push({ code: "OFFER_AUDIENCE_MISALIGNMENT", description: check.details, source: "offer_engine", severity: "high" });
        break;
      case "zero_objection_coverage":
        blocks.push({ code: "ZERO_OBJECTION_COVERAGE", description: check.details, source: "offer_engine", severity: "high" });
        break;
      case "channel_confidence_minimum":
        blocks.push({ code: "CHANNEL_CONFIDENCE_BELOW_MINIMUM", description: check.details, source: "channel_selection", severity: "high" });
        break;
      case "unresolved_critical_problems":
        blocks.push({ code: "UNRESOLVED_CRITICAL_PROBLEMS", description: check.details, source: "ssc_problem_registry", severity: "critical" });
        break;
      case "confidence_chain_integrity":
        blocks.push({ code: "CONFIDENCE_CHAIN_VIOLATION", description: check.details, source: "ssc_confidence_chain", severity: "critical" });
        break;
      case "positioning_hard_gate":
        blocks.push({ code: "POSITIONING_HARD_GATE", description: check.details, source: "ssc_confidence_chain", severity: "critical" });
        break;
      case "confidence_spread":
        blocks.push({ code: "CONFIDENCE_SPREAD_EXCESSIVE", description: check.details, source: "ssc_confidence_chain", severity: "high" });
        break;
      case "budget_override_zero_confidence":
        blocks.push({ code: "BUDGET_OVERRIDE_ZERO_CONFIDENCE", description: check.details, source: "ssc_budget_guard", severity: "critical" });
        break;
      // Runtime Truth Track (May 2026)
      // NOTE: AEL_PARTIAL and SIGNAL_LINEAGE_UNKNOWN_DOMINANT are NOT mapped
      // to blockReasons here. Per session-plan acceptance ("downgrade to
      // REVIEW_REQUIRED"), `evaluateSystemControl` translates these
      // structural FAILs into `downgrades` (verdict=DOWNGRADE,
      // executionMode=REVIEW_REQUIRED) instead of HALTED blocks. Mapping
      // either to a BlockReason here would force verdict=BLOCK +
      // executionMode=HALTED, which is harsher than the intended policy.
      // CONFIDENCE_INTEGRITY_INCOMPLETE IS a hard block: a critical engine
      // emitting no confidence at all means downstream gates were bypassed
      // by the pre-T3.A 0.5-default behaviour and the run cannot be trusted.
      case "confidence_integrity":
        // Only INCOMPLETE maps to a block; DEGRADED is downgraded in engine.ts.
        if (check.details.startsWith("INCOMPLETE")) {
          blocks.push({ code: "CONFIDENCE_INTEGRITY_INCOMPLETE", description: check.details, source: "confidence_integrity", severity: "critical" });
        }
        break;
    }
  }

  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Truth Track (May 2026) — additional structural checks for the
// confidence-integrity (T3.B) and lineage-integrity (T1.A) tracks. Both
// surface previously-soft signals (an `AEL_PARTIAL` console.warn and a
// `HIGH_UNKNOWN_RATIO` console.warn) as structural verdicts so System
// Control can drive a deterministic execution-mode downgrade.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * T3.B — AEL partial-build gate. When the analytical-enrichment package was
 * built with degraded data (parse failure, build error, partial LLM), every
 * downstream strategy engine receives weaker enrichment context. Pre-T3.B
 * the orchestrator only logged `AEL_PARTIAL`; this check converts that into
 * a structural FAIL so the verdict downgrades to REVIEW_REQUIRED.
 *
 * Note: when AEL fully fails, the orchestrator returns an `AEL_BUILD_FAILED`
 * BLOCKED step well before System Control runs. This check fires only on
 * the in-between case: AEL succeeded structurally but came back partial.
 */
export function checkAnalyticalEnrichmentIntegrity(
  isPartial: boolean | undefined,
  reason: string | null | undefined,
): StructuralCheck {
  if (isPartial !== true) {
    return pass(
      "analytical_enrichment_integrity",
      isPartial === false ? "AEL built with full enrichment" : "AEL state not provided",
    );
  }
  return fail(
    "analytical_enrichment_integrity",
    `Analytical Enrichment Layer is PARTIAL (${reason ?? "no reason given"}) — downstream engines consumed degraded enrichment; live execution cannot proceed without review`,
  );
}

/**
 * T1.A — signal-lineage unknown-dominance gate. Pre-T1.A the orchestrator
 * only logged `HIGH_UNKNOWN_RATIO` when more than 30% of signals were
 * legacy/untagged. This check converts that into a structural FAIL so the
 * verdict cannot reach FULL_EXECUTION while strategy is dominated by
 * un-attributable signals.
 *
 * Threshold (0.30) intentionally matches the orchestrator's lineage-build
 * warn threshold — a single source of truth for "untrusted lineage."
 */
/**
 * T3.A v2 — confidence-integrity hard gate. The orchestrator already
 * computes a per-run `ConfidenceIntegritySummary` via
 * `summarizeConfidenceIntegrity()` over the provenance log. Pre-v2 this
 * was returned on the response but never consulted by System Control.
 * This check elevates the summary to a structural verdict so:
 *   - INCOMPLETE (a critical engine emitted no confidence) → maps to
 *     BlockCode.CONFIDENCE_INTEGRITY_INCOMPLETE → verdict BLOCK
 *   - DEGRADED   (default_floor / inferred_synthesis on the chain, no
 *     critical absence) → emitted as FAIL with details prefixed
 *     "DEGRADED:" so engine.ts converts it into a downgrade with
 *     code CONFIDENCE_INTEGRITY_DEGRADED instead of a block
 *   - COMPLETE / absent verdict → PASS
 */
export function checkConfidenceIntegrity(
  verdict: "COMPLETE" | "DEGRADED" | "INCOMPLETE" | null | undefined,
  criticalAbsent: string[] | undefined,
  degradedEngines: string[] | undefined,
): StructuralCheck {
  if (!verdict || verdict === "COMPLETE") {
    return pass(
      "confidence_integrity",
      verdict === "COMPLETE" ? "all engine confidences carry direct_evidence provenance" : "confidence integrity not provided",
    );
  }
  if (verdict === "INCOMPLETE") {
    return fail(
      "confidence_integrity",
      `INCOMPLETE: critical engine(s) emitted no confidence — [${(criticalAbsent ?? []).join(", ")}] — pre-T3.A this would have silently defaulted to 0.5`,
    );
  }
  // DEGRADED — structural FAIL whose details start with "DEGRADED:" so
  // collectBlockReasons skips block-mapping and engine.ts converts to downgrade.
  return fail(
    "confidence_integrity",
    `DEGRADED: ${(degradedEngines ?? []).length} engine(s) carry default_floor/inferred_synthesis provenance — [${(degradedEngines ?? []).join(", ")}]`,
  );
}

const LINEAGE_UNKNOWN_RATIO_FAIL_THRESHOLD = 0.30;
export function checkSignalLineageUnknown(
  signalComposition: SignalComposition | null,
): StructuralCheck {
  if (!signalComposition || signalComposition.total === 0) {
    return pass(
      "signal_lineage_unknown",
      "no signal composition data — lineage check skipped",
    );
  }
  const r = signalComposition.unknownRatio;
  if (r > LINEAGE_UNKNOWN_RATIO_FAIL_THRESHOLD) {
    return fail(
      "signal_lineage_unknown",
      `Signal lineage is dominated by untagged/legacy signals: unknownRatio=${r.toFixed(2)} > ${LINEAGE_UNKNOWN_RATIO_FAIL_THRESHOLD} — strategy origin cannot be trusted`,
    );
  }
  return pass(
    "signal_lineage_unknown",
    `unknownRatio=${r.toFixed(2)} ≤ ${LINEAGE_UNKNOWN_RATIO_FAIL_THRESHOLD}`,
  );
}
