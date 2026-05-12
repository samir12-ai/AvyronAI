/**
 * Seal #8 — CEL doctrine + intelligence honesty proof suite.
 *
 * Each test maps to a sub-finding (F3.1–F3.10). The suite proves:
 *   - F3.1 — orphan-floor 0.20 only when ≥1 grounded claim
 *   - F3.2 — all-orphan retention at confidence ≤0.10 + degraded; no per-territory orphan-penalty cap
 *   - F3.3 — commercial-reasoning rejection registry (parallel surface, NOT replacement)
 *   - F3.4 — judge unparseable / errored → REJECTED (not ACCEPTED-by-default)
 *   - F3.5 — CEL with NO_AEL or NO_MATCHING_RULES → INCOMPLETE (passed=false), not silent PASS
 *   - F3.6 — CEL pass threshold per-rule (default 0.6, critical 0.75); not 0.4
 *   - F3.7 — depth gate fires on ANY marketing-claim presence (factual + inferred + emotional)
 *   - F3.8 — system-default territories tagged provenance + capped at 0.30 confidence
 *   - F3.9 — score values flow into threshold compares without pre-rounding
 *   - F3.10 — AEL `isPartial` propagates onto the synthesized plan via _provenance flag
 *
 * Run via:  npx tsx server/tests/intelligence-honesty.test.ts
 *
 * Doctrine reminder (Task #26): REJECTED still returns null + falls through
 * to legacy. F3.3 ADDS a parallel rejection-surface, it does NOT replace
 * the legacy fallthrough. No test asserts pipeline breakage on rejection.
 */

import {
  enforcePositioningCompliance,
  enforceGenericEngineCompliance,
  isDepthBlocking,
  resolveConstraintThreshold,
  DEFAULT_CONSTRAINT_THRESHOLD,
  CONSTRAINT_THRESHOLDS,
} from "../causal-enforcement-layer/engine";

const enforcePositioningCausalCompliance = enforcePositioningCompliance;
import {
  recordCommercialRejection,
  getCommercialRejections,
  clearCommercialRejections,
} from "../../shared/commercial-dna";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: any, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
}

function section(name: string) { console.log(`\n── ${name} ──`); }

// ─── F3.5 — CEL NO_AEL / NO_MATCHING → INCOMPLETE ────────────────────────
section("F3.5 — CEL absence of AEL/rules → INCOMPLETE (no silent PASS)");
{
  const r1 = enforcePositioningCausalCompliance({} as any, null);
  assert(r1.passed === false, "NO_AEL: passed=false");
  assert(r1.verdict === "INCOMPLETE", "NO_AEL: verdict=INCOMPLETE");
  assert(r1.score === 0, "NO_AEL: score=0");

  const aelNoMatch = { root_causes: [{ rootCause: "weather is nice today" }] } as any;
  const r2 = enforcePositioningCausalCompliance({} as any, aelNoMatch);
  assert(r2.passed === false, "NO_MATCHING_RULES: passed=false");
  assert(r2.verdict === "INCOMPLETE", "NO_MATCHING_RULES: verdict=INCOMPLETE");

  const r3 = enforceGenericEngineCompliance("offer", ["any text"], null);
  assert(r3.passed === false, "Generic NO_AEL: passed=false");
  assert(r3.verdict === "INCOMPLETE", "Generic NO_AEL: verdict=INCOMPLETE");
}

// ─── F3.6 — CEL pass threshold raised + per-rule resolved ────────────────
section("F3.6 — pass threshold default 0.6, critical 0.75");
{
  assert(DEFAULT_CONSTRAINT_THRESHOLD === 0.6, "default threshold = 0.6");
  assert(CONSTRAINT_THRESHOLDS.TRUST_OPACITY_RULE === 0.75, "trust-opacity critical = 0.75");
  assert(resolveConstraintThreshold([]) === 0.6, "empty rules → default 0.6");
  assert(resolveConstraintThreshold(["TRUST_OPACITY_RULE"]) === 0.75, "trust-opacity → 0.75");
  assert(resolveConstraintThreshold(["UNKNOWN_RULE"]) === 0.6, "unknown rule → default 0.6");
  assert(
    resolveConstraintThreshold(["UNKNOWN_RULE", "VALUE_PERCEPTION_RULE"]) === 0.75,
    "max-of-rules picks 0.75",
  );
}

// ─── F3.7 — depth gate fires on ANY marketing claim ──────────────────────
section("F3.7 — depth gate covers factual + inferred + emotional");
{
  const lowDepthFactual = {
    causalDepthScore: 0.10,
    factualClaimCount: 2,
    claimBreakdown: { factual: 2, inferred: 0, emotional: 0 },
  } as any;
  const lowDepthInferredOnly = {
    causalDepthScore: 0.10,
    factualClaimCount: 0,
    claimBreakdown: { factual: 0, inferred: 3, emotional: 0 },
  } as any;
  const lowDepthEmotionalOnly = {
    causalDepthScore: 0.10,
    factualClaimCount: 0,
    claimBreakdown: { factual: 0, inferred: 0, emotional: 1 },
  } as any;
  const lowDepthEmpty = {
    causalDepthScore: 0.10,
    factualClaimCount: 0,
    claimBreakdown: { factual: 0, inferred: 0, emotional: 0 },
  } as any;
  assert(isDepthBlocking(lowDepthFactual) === true, "factual claim → blocking");
  assert(isDepthBlocking(lowDepthInferredOnly) === true, "inferred-only → blocking (NEW)");
  assert(isDepthBlocking(lowDepthEmotionalOnly) === true, "emotional-only → blocking (NEW)");
  assert(isDepthBlocking(lowDepthEmpty) === false, "no claims → NOT blocking");
}

// ─── F3.3 — commercial-reasoning rejection registry ──────────────────────
section("F3.3 — rejection registry: parallel surface, NOT a replacement");
{
  const runKey = "test-account-A";
  clearCommercialRejections(runKey);
  assert(getCommercialRejections(runKey).length === 0, "registry starts empty after clear");

  recordCommercialRejection(runKey, {
    module: "audience.buyerPsychology",
    reason: "FINAL_REJECTED",
    detail: "judge said no",
  });
  recordCommercialRejection(runKey, {
    module: "awareness.narrativeReframe",
    reason: "JUDGE_ERROR",
    detail: "JUDGE_ERROR: timeout",
  });

  const reads = getCommercialRejections(runKey);
  assert(reads.length === 2, "registry holds 2 rejections");
  assert(reads[0].reason === "FINAL_REJECTED", "first is FINAL_REJECTED");
  assert(reads[1].reason === "JUDGE_ERROR", "second is JUDGE_ERROR");
  assert(typeof reads[0].emittedAt === "number", "emittedAt is timestamp");

  // Cross-run isolation
  recordCommercialRejection("test-account-B", {
    module: "offer.valueArchitect",
    reason: "FINAL_REJECTED",
    detail: "x",
  });
  assert(getCommercialRejections(runKey).length === 2, "cross-account isolation: A unaffected by B");

  clearCommercialRejections(runKey);
  assert(getCommercialRejections(runKey).length === 0, "clear empties the registry");
  assert(getCommercialRejections("test-account-B").length === 1, "clear is scoped");
  clearCommercialRejections("test-account-B");

  // Unknown runKey
  assert(getCommercialRejections("never-recorded").length === 0, "unknown runKey → empty");

  // Empty runKey is a no-op
  recordCommercialRejection("", { module: "audience.buyerPsychology", reason: "FINAL_REJECTED", detail: "" });
  assert(getCommercialRejections("").length === 0, "empty runKey is a no-op");
}

// ─── F3.4 — judge errors are NOT accept-by-default (smoke at module level)
section("F3.4 — judge unparseable / errored → REJECTED, not ACCEPTED");
{
  // Source-level proof (no AI call): inspect that the modules' judge
  // failure paths have been rewritten to surface JUDGE_ERROR. This
  // catches future regressions that try to re-introduce the silent
  // accept-on-error fallback.
  const fs = require("fs") as typeof import("fs");
  const reframeSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../awareness-engine/narrative-reframe.ts"),
    "utf8",
  );
  const buyerSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../audience-engine/buyer-psychology.ts"),
    "utf8",
  );
  assert(
    !reframeSrc.includes(`verdict: "ACCEPTED", reason: "judge unparseable`),
    "narrative-reframe: no accept-on-unparseable",
  );
  assert(
    !reframeSrc.includes(`verdict: "ACCEPTED", reason: "judge errored`),
    "narrative-reframe: no accept-on-error",
  );
  assert(reframeSrc.includes("JUDGE_ERROR"), "narrative-reframe: JUDGE_ERROR surfaced");
  assert(
    !buyerSrc.includes(`accepting v1 as fallback`),
    "buyer-psychology: no accept-on-error fallback",
  );
  assert(buyerSrc.includes("JUDGE_ERROR"), "buyer-psychology: JUDGE_ERROR surfaced");
}

// ─── F3.1 / F3.2 / F3.8 — positioning provenance + orphan handling ───────
section("F3.1/F3.2/F3.8 — positioning provenance, orphan retention, system-default cap (source proof)");
{
  // Source-level proof (avoiding heavy DB/MI dep): assert the new branches
  // are present and the old logic has been removed.
  const fs = require("fs") as typeof import("fs");
  const posSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../positioning-engine/engine.ts"),
    "utf8",
  );
  // F3.8 — system-default cap + provenance tag
  assert(
    posSrc.includes(`provenance = "system_default"`),
    "F3.8: system_default provenance tag present",
  );
  assert(
    posSrc.includes(`Math.min(territory.confidenceScore, 0.30)`),
    "F3.8: system-default capped at 0.30",
  );
  // F3.2 — no per-territory orphan-penalty ceiling
  assert(
    !posSrc.includes(`maxOrphanPenalty = 0.10`),
    "F3.2: per-territory orphan-cap removed",
  );
  // F3.2 — all-orphan retained, not dropped
  assert(
    posSrc.includes(`Math.min(territory.confidenceScore, 0.10)`),
    "F3.2: all-orphan retention at ≤0.10",
  );
  assert(
    posSrc.includes(`degraded = true`),
    "F3.2: all-orphan marked degraded",
  );
  // F3.1 — floor 0.20 only on partial-orphan path (≥1 grounded)
  assert(
    posSrc.includes(`Math.max(0.20, territory.confidenceScore - totalPenalty)`),
    "F3.1: floor 0.20 (partial-orphan path)",
  );
}

// ─── F3.9 — no pre-rounding before threshold compares ───────────────────
section("F3.9 — values flow into threshold compares without pre-rounding");
{
  const fs = require("fs") as typeof import("fs");
  const celSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../causal-enforcement-layer/engine.ts"),
    "utf8",
  );
  const posSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../positioning-engine/engine.ts"),
    "utf8",
  );
  assert(
    !celSrc.includes(`Math.round(depthComponents.reduce`),
    "F3.9: CEL depth no longer pre-rounded",
  );
  assert(
    !posSrc.includes(`Math.round(primaryTerritory.confidenceScore * 100) / 100`),
    "F3.9: positioning rawConfidence no longer pre-rounded",
  );
}

// ─── F3.10 — AEL partial propagation interface present ──────────────────
section("F3.10 — SynthesizedPlan exposes _provenance.aelPartialPropagated");
{
  const fs = require("fs") as typeof import("fs");
  const synthSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../orchestrator/plan-synthesis.ts"),
    "utf8",
  );
  const orchSrc = fs.readFileSync(
    require("path").resolve(__dirname, "../orchestrator/index.ts"),
    "utf8",
  );
  assert(
    synthSrc.includes("aelPartialPropagated"),
    "F3.10: SynthesizedPlan declares aelPartialPropagated",
  );
  assert(
    synthSrc.includes("commercialReasoningRejected"),
    "F3.3 contract: SynthesizedPlan declares commercialReasoningRejected",
  );
  assert(
    orchSrc.includes("getCommercialRejections(config.accountId)"),
    "F3.3 wiring: orchestrator collects rejections by accountId",
  );
  assert(
    orchSrc.includes("aelPartialPropagated: aelPartial"),
    "F3.10 wiring: orchestrator propagates AEL isPartial",
  );
  assert(
    orchSrc.includes("clearCommercialRejections(config.accountId)"),
    "F3.3 lifecycle: orchestrator clears registry at run start",
  );
  // Architect-pass-1 fix: F3.4 unparseable judge → REJECTED for buyer-psychology
  const buyerSrc2 = fs.readFileSync(
    require("path").resolve(__dirname, "../audience-engine/buyer-psychology.ts"),
    "utf8",
  );
  assert(
    /unparseable judge output/.test(buyerSrc2) && /JUDGE_ERROR: unparseable/.test(buyerSrc2),
    "F3.4 (buyer-psych): unparseable judge → REJECTED + JUDGE_ERROR (not NOT_RUN)",
  );
  // Architect-pass-1 fix: F3.3+F3.10 persistence — degradation re-persisted to planJson
  assert(
    /db\.update\(strategicPlans\)[\s\S]{0,200}planJson:\s*JSON\.stringify\(planResult\.plan\)/.test(orchSrc),
    "F3.3/F3.10 persistence: degradation re-persisted to strategicPlans.planJson",
  );
  assert(
    orchSrc.includes("PLAN_DEGRADE_PERSIST_FAILED"),
    "F3.3/F3.10 persistence: failure path logged with PLAN_DEGRADE_PERSIST_FAILED",
  );

  // Architect-pass-2 fix: F3.4 uniformity — all 3 remaining commercial modules
  // must NOT accept-by-default on judge failure / unparseable.
  const path = require("path");
  const cgSrc = fs.readFileSync(path.resolve(__dirname, "../positioning-engine/category-game.ts"), "utf8");
  const vaSrc = fs.readFileSync(path.resolve(__dirname, "../offer-engine/value-architect.ts"), "utf8");
  const ttSrc = fs.readFileSync(path.resolve(__dirname, "../persuasion-engine/trust-transfer.ts"), "utf8");
  // category-game
  assert(!/JUDGE_FAILED[^]{0,80}accepting v1 as fallback[^]{0,80}judgeVerdict\s*=\s*"ACCEPTED"/.test(cgSrc),
    "F3.4 (category-game): judge catch no longer sets ACCEPTED");
  assert(/JUDGE_ERROR: unparseable judge output/.test(cgSrc),
    "F3.4 (category-game): unparseable judge → JUDGE_ERROR");
  assert(/JUDGE_ERROR: \$\{err\.message\}/.test(cgSrc),
    "F3.4 (category-game): judge call failure → JUDGE_ERROR");
  // value-architect
  assert(!/JUDGE_FAILED[^]{0,80}accepting v1 as fallback[^]{0,80}judgeVerdict\s*=\s*"ACCEPTED"/.test(vaSrc),
    "F3.4 (value-architect): judge catch no longer sets ACCEPTED");
  assert(/JUDGE_ERROR: unparseable judge output/.test(vaSrc),
    "F3.4 (value-architect): unparseable judge → JUDGE_ERROR");
  assert(/JUDGE_ERROR: \$\{err\.message\}/.test(vaSrc),
    "F3.4 (value-architect): judge call failure → JUDGE_ERROR");
  // trust-transfer
  assert(!/judgeVerdict\s*:\s*"ACCEPTED"\s*\|\s*"REJECTED"\s*=\s*"ACCEPTED"/.test(ttSrc),
    "F3.4 (trust-transfer): judgeVerdict default no longer ACCEPTED");
  assert(/judgeVerdict\s*:\s*"ACCEPTED"\s*\|\s*"REJECTED"\s*=\s*"REJECTED"/.test(ttSrc),
    "F3.4 (trust-transfer): judgeVerdict default is REJECTED");
  assert(/JUDGE_ERROR: unparseable judge output/.test(ttSrc),
    "F3.4 (trust-transfer): unparseable judge → JUDGE_ERROR");
  assert(/JUDGE_ERROR: unparseable retry-judge output/.test(ttSrc),
    "F3.4 (trust-transfer): unparseable retry-judge → JUDGE_ERROR (no silent ACCEPT)");

  // Architect-pass-2 fix: F3.3 concurrency — registry now ALS-keyed.
  const dnaSrc = fs.readFileSync(path.resolve(__dirname, "../../shared/commercial-dna.ts"), "utf8");
  assert(/AsyncLocalStorage/.test(dnaSrc) && /__commercialRunKeyALS/.test(dnaSrc),
    "F3.3 concurrency: registry uses AsyncLocalStorage for per-run isolation");
  assert(/export function enterCommercialRunKey/.test(dnaSrc),
    "F3.3 concurrency: enterCommercialRunKey exported");
  assert(/__commercialRunKeyALS\.getStore\(\)\s*\|\|\s*explicit/.test(dnaSrc),
    "F3.3 concurrency: ALS scope wins over explicit runKey arg");
  assert(/enterCommercialRunKey\(jobId\)/.test(orchSrc),
    "F3.3 concurrency: orchestrator enters jobId-scoped ALS context");
}

// ─── Pass-4 fixes: F3.5 isPartial gate + reason field + registry cap ────
section("Pass-4 — CEL isPartial gate + reason field + registry cap");
{
  const path = require("path");
  const fs = require("fs") as typeof import("fs");
  const celSrc = fs.readFileSync(path.resolve(__dirname, "../causal-enforcement-layer/engine.ts"), "utf8");
  const celTypesSrc = fs.readFileSync(path.resolve(__dirname, "../causal-enforcement-layer/types.ts"), "utf8");
  const dnaSrc2 = fs.readFileSync(path.resolve(__dirname, "../../shared/commercial-dna.ts"), "utf8");
  const orchSrc2 = fs.readFileSync(path.resolve(__dirname, "../orchestrator/index.ts"), "utf8");

  // F3.5 reason field on contract
  assert(/reason\?\s*:\s*string/.test(celTypesSrc),
    "Pass-4 F3.5: ComplianceResult declares optional `reason: string`");

  // F3.5 isPartial gate in BOTH enforce functions
  assert(/enforcePositioningCompliance[\s\S]{0,3000}ael\.isPartial\s*===\s*true[\s\S]{0,400}reason\s*=\s*"AEL_PARTIAL"/.test(celSrc),
    "Pass-4 F3.5: enforcePositioningCompliance gates on ael.isPartial → AEL_PARTIAL");
  assert(/enforceGenericEngineCompliance[\s\S]{0,3000}ael\.isPartial\s*===\s*true[\s\S]{0,400}reason\s*=\s*"AEL_PARTIAL"/.test(celSrc),
    "Pass-4 F3.5: enforceGenericEngineCompliance gates on ael.isPartial → AEL_PARTIAL");

  // F3.5 reason set on AEL_MISSING + NO_MATCHING_RULES + OK + violation paths
  assert((celSrc.match(/reason\s*=\s*"AEL_MISSING"/g) || []).length >= 2,
    "Pass-4 F3.5: reason='AEL_MISSING' set on both enforce functions");
  assert(/reason\s*=\s*"NO_MATCHING_RULES"/.test(celSrc),
    "Pass-4 F3.5: reason='NO_MATCHING_RULES' set on generic compliance");
  assert((celSrc.match(/"OK"/g) || []).length >= 2,
    "Pass-4 F3.5: reason='OK' set on PASS paths (positioning + generic)");
  assert(/reason\s*=\s*blockingViolations\[0\]\.violationType/.test(celSrc),
    "Pass-4 F3.5: blocking-violation reason = first violationType");

  // F3.3 LRU cap + end-of-run cleanup
  assert(/__COMMERCIAL_REGISTRY_MAX_KEYS\s*=\s*1000/.test(dnaSrc2),
    "Pass-4 F3.3: registry has bounded MAX_KEYS=1000 cap");
  assert(/__commercialRejections\.keys\(\)\.next\(\)\.value/.test(dnaSrc2),
    "Pass-4 F3.3: registry evicts oldest entry on overflow (FIFO/LRU)");
  assert(/end-of-run registry cleanup[\s\S]{0,400}clearCommercialRejections\(jobId\)/.test(orchSrc2),
    "Pass-4 F3.3: orchestrator clears registry at end-of-run");
}

// ─── Pass-4 live behavioral: CEL isPartial gate ─────────────────────────
section("Pass-4 live — CEL isPartial returns INCOMPLETE + AEL_PARTIAL");
{
  const { enforcePositioningCompliance, enforceGenericEngineCompliance } =
    require("../causal-enforcement-layer/engine");
  const partialAel: any = {
    isPartial: true,
    partialReason: "synthesis_failure",
    root_causes: [
      { surfaceSignal: "x", deepCause: "y", confidenceLevel: "high" },
    ],
  };
  const posResult = enforcePositioningCompliance([], partialAel);
  assert(posResult.verdict === "INCOMPLETE" && posResult.reason === "AEL_PARTIAL" && posResult.passed === false,
    "Pass-4 F3.5 live: positioning isPartial → INCOMPLETE + AEL_PARTIAL + passed=false");
  const genResult = enforceGenericEngineCompliance("offer", ["x"], partialAel);
  assert(genResult.verdict === "INCOMPLETE" && genResult.reason === "AEL_PARTIAL" && genResult.passed === false,
    "Pass-4 F3.5 live: generic isPartial → INCOMPLETE + AEL_PARTIAL + passed=false");

  // Missing AEL still produces AEL_MISSING (not regressed)
  const noAel = enforcePositioningCompliance([], null);
  assert(noAel.verdict === "INCOMPLETE" && noAel.reason === "AEL_MISSING",
    "Pass-4 F3.5 live: null AEL → INCOMPLETE + AEL_MISSING (no regression)");
}

// ─── Pass-4 live: registry LRU cap enforcement ──────────────────────────
section("Pass-4 live — registry LRU cap evicts oldest on overflow");
{
  const { recordCommercialRejection: rec2, getCommercialRejections: get2,
          clearCommercialRejections: clr2,
          __commercialRegistrySize, __commercialRegistryMaxKeys } =
    require("../../shared/commercial-dna");
  const cap = __commercialRegistryMaxKeys();
  // Drain everything left from prior tests
  for (let i = 0; i < cap + 10; i++) clr2(`drain-${i}`);
  const baseSize = __commercialRegistrySize();
  // Write cap+50 distinct keys (no ALS scope → uses explicit key)
  for (let i = 0; i < cap + 50; i++) {
    rec2(`run-${i}`, { module: "audience.buyerPsychology", reason: "FINAL_REJECTED", detail: `${i}` } as any);
  }
  const size = __commercialRegistrySize();
  assert(size <= cap,
    `Pass-4 F3.3 live: registry size (${size}) ≤ cap (${cap}) after overflow writes`);
  assert(get2(`run-0`).length === 0,
    "Pass-4 F3.3 live: oldest key (run-0) evicted");
  assert(get2(`run-${cap + 49}`).length === 1,
    "Pass-4 F3.3 live: newest key retained");
  // Clean up
  for (let i = 0; i < cap + 60; i++) clr2(`run-${i}`);
}

// ─── F3.3 concurrency live behavioral test ──────────────────────────────
async function runConcurrencyTest() {
  section("F3.3 concurrency — ALS-scoped registry isolates parallel runs");
  const { recordCommercialRejection: rec, getCommercialRejections: get,
          clearCommercialRejections: clr, runWithCommercialRunKey: runWith } =
    require("../../shared/commercial-dna");
  const accountId = "acc-shared";
  clr(accountId);
  const runA = runWith("jobA", async () => {
    rec(accountId, { module: "audience.buyerPsychology", reason: "FINAL_REJECTED", detail: "A" });
    return get(accountId);
  });
  const runB = runWith("jobB", async () => {
    rec(accountId, { module: "offer.valueArchitect", reason: "JUDGE_ERROR", detail: "B" });
    return get(accountId);
  });
  const [a, b] = await Promise.all([runA, runB]);
  assert(a.length === 1 && a[0].detail === "A", "ALS scope A isolated to jobA");
  assert(b.length === 1 && b[0].detail === "B", "ALS scope B isolated to jobB");
  assert(get(accountId).length === 0, "outside ALS scope: accountId-keyed slot unaffected");
}

// ─── F3.10 per-consumer isPartial behavioral tests (pass-5) ───────────
function runConsumerGuardTests() {
  section("F3.10 — acknowledgeAelInput / attachAelProvenance / formatAELForPrompt banner");
  const { acknowledgeAelInput, attachAelProvenance } =
    require("../../server/analytical-enrichment-layer/consumer-guard");
  const { formatAELForPrompt } =
    require("../../server/analytical-enrichment-layer/engine");

  const ackNull = acknowledgeAelInput("TestEngine", null, "acc-x");
  assert(ackNull.usable === false && ackNull.partial === false && ackNull.reason === "AEL_MISSING",
    "acknowledgeAelInput(null) → usable=false, partial=false, reason=AEL_MISSING");

  const ackPartial = acknowledgeAelInput("TestEngine",
    { isPartial: true, partialReason: "parse_failure", root_causes: [{ surfaceSignal: "x", deepCause: "y" }] }, "acc-x");
  assert(ackPartial.usable === true && ackPartial.partial === true && ackPartial.reason === "AEL_PARTIAL"
    && ackPartial.partialReason === "parse_failure",
    "acknowledgeAelInput(isPartial:true) → usable=true, partial=true, reason=AEL_PARTIAL, partialReason propagated");

  const ackFull = acknowledgeAelInput("TestEngine",
    { root_causes: [{ surfaceSignal: "x", deepCause: "y" }], pain_types: [], causal_chains: [], buying_barriers: [], mechanism_gaps: [], trust_gaps: [] }, "acc-x");
  assert(ackFull.usable === true && ackFull.partial === false && ackFull.reason === "AEL_OK",
    "acknowledgeAelInput(full) → usable=true, partial=false, reason=AEL_OK");

  const result1: any = { foo: "bar" };
  attachAelProvenance(result1, ackPartial);
  assert(result1._provenance?.aelPartialPropagated === true,
    "attachAelProvenance(partial): result._provenance.aelPartialPropagated=true");
  assert(result1._provenance?.aelAcknowledgement === "AEL_PARTIAL",
    "attachAelProvenance(partial): result._provenance.aelAcknowledgement='AEL_PARTIAL'");
  assert(result1._provenance?.aelPartialReason === "parse_failure",
    "attachAelProvenance(partial): result._provenance.aelPartialReason propagated");

  const result2: any = { _provenance: { existing: "keep-me" }, foo: "bar" };
  attachAelProvenance(result2, ackFull);
  assert(result2._provenance?.existing === "keep-me",
    "attachAelProvenance preserves existing _provenance fields");
  assert(result2._provenance?.aelPartialPropagated === false,
    "attachAelProvenance(full): aelPartialPropagated=false");

  // formatAELForPrompt banner emission
  const fullPkg = {
    root_causes: [{ surfaceSignal: "s", deepCause: "d", causalReasoning: "r", sourceData: "src", confidenceLevel: "high" }],
    pain_types: [], causal_chains: [], buying_barriers: [], mechanism_gaps: [], trust_gaps: [],
  };
  const promptFull = formatAELForPrompt(fullPkg);
  assert(!promptFull.includes("AEL_PARTIAL_NOTICE"),
    "formatAELForPrompt(full): no AEL_PARTIAL_NOTICE banner");

  const partialPkg = { ...fullPkg, isPartial: true, partialReason: "build_error" };
  const promptPartial = formatAELForPrompt(partialPkg);
  assert(promptPartial.includes("AEL_PARTIAL_NOTICE"),
    "formatAELForPrompt(partial): emits AEL_PARTIAL_NOTICE degradation banner");
  assert(promptPartial.includes("partialReason=build_error"),
    "formatAELForPrompt(partial): banner includes partialReason");
  assert(promptPartial.includes("PROVISIONAL"),
    "formatAELForPrompt(partial): banner instructs LLM to treat inferences as PROVISIONAL");

  // F3.10 source-presence: every required AEL consumer imports + invokes the helper
  const fs = require("fs");
  const consumers = [
    "server/positioning-engine/engine.ts",
    "server/awareness-engine/myth-breaker-llm.ts",
    "server/offer-engine/engine.ts",
    "server/offer-engine/identity-llm.ts",
    "server/persuasion-engine/engine.ts",
    "server/persuasion-engine/cialdini-llm.ts",
  ];
  for (const f of consumers) {
    const src = fs.readFileSync(f, "utf8");
    assert(src.includes("acknowledgeAelInput("),
      `${f}: imports + calls acknowledgeAelInput()`);
  }

  // Leaf LLM consumers also attach provenance to their returned result
  const leafConsumers = [
    "server/awareness-engine/myth-breaker-llm.ts",
    "server/offer-engine/identity-llm.ts",
    "server/persuasion-engine/cialdini-llm.ts",
  ];
  for (const f of leafConsumers) {
    const src = fs.readFileSync(f, "utf8");
    assert(src.includes("attachAelProvenance(result"),
      `${f}: calls attachAelProvenance(result, aelAck) on success return`);
  }
}

runConcurrencyTest().then(() => {
  runConsumerGuardTests();
  console.log(`\n══ RESULT ══  passed=${passed}  failed=${failed}`);
  if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
  process.exit(0);
});

// (final exit handled inside runConcurrencyTest().then)
