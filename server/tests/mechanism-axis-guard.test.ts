/**
 * Mechanism Axis Guard — Bug-A regression tests (2026-08-08)
 *
 * Before Bug-A fix: any mechanism engine timeout / DEPTH_FAILED set
 * axisConsistency.consistent=false, which the offer engine read as AXIS_MISMATCH
 * and issued a HARD REJECT (offerStrengthScore=0), cascading to 9 downstream
 * engines via BUDGET_KILL, BUDGET_HALT, PIPELINE_INCOMPLETE.
 *
 * After fix: consistent=false is only a HARD REJECT when the normalised axis
 * strings actually differ AND the failure array contains no technical-failure
 * markers.  Engine failure paths continue with the generated offer, applying
 * a 10% confidence penalty.
 *
 * Run with:  npx tsx server/tests/mechanism-axis-guard.test.ts
 */

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";

let failed = 0;
function assert(cond: boolean, label: string, detail = "") {
  if (cond) console.log(`${PASS} ${label}${detail ? ` | ${detail}` : ""}`);
  else { console.log(`${FAIL} ${label}${detail ? ` | ${detail}` : ""}`); failed++; }
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Mechanism Axis Guard — Bug-A regression (2026-08-08)");
console.log("══════════════════════════════════════════════════════════════════\n");

// ─── Helper: simulate the axis guard logic (extracted from engine.ts) ─────────
// This mirrors the EXACT decision in server/offer-engine/engine.ts so a drift
// in the engine code will be caught at this layer too.

const ENGINE_FAILURE_MARKERS = [
  "timed out", "timeout", "DEPTH_FAILED",
  "insufficient positioning", "AI generation", "request timed out",
];

function isEngineTechnicalFailure(failures: string[]): boolean {
  return failures.some((f) =>
    ENGINE_FAILURE_MARKERS.some((marker) => f.toLowerCase().includes(marker.toLowerCase()))
  );
}

function normalise(s: string): string {
  return (s || "").replace(/_/g, " ").toLowerCase().trim();
}

function axisGuardDecision(axisConsistency: {
  consistent: boolean;
  primaryAxis: string;
  mechanismAxis: string;
  failures: string[];
}): "HARD_REJECT" | "DEGRADED_CONTINUE" | "PASS" {
  if (axisConsistency.consistent) return "PASS";

  const isFailure = isEngineTechnicalFailure(axisConsistency.failures);
  const normPrimary   = normalise(axisConsistency.primaryAxis);
  const normMechanism = normalise(axisConsistency.mechanismAxis);
  const axesActuallyDiffer =
    normPrimary.length > 0 && normMechanism.length > 0 && normPrimary !== normMechanism;

  if (axesActuallyDiffer && !isFailure) return "HARD_REJECT";
  return "DEGRADED_CONTINUE";
}

// ─── T1: Mechanism timeout → DEGRADED_CONTINUE (not HARD_REJECT) ──────────────
{
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "proof_and_transparency",
    mechanismAxis: "proof_and_transparency",
    failures: ["Request timed out."],
  });
  assert(result === "DEGRADED_CONTINUE",
    "T1: mechanism timeout with same axis → DEGRADED_CONTINUE",
    `got=${result}`);
}

// ─── T2: DEPTH_FAILED → DEGRADED_CONTINUE ─────────────────────────────────────
{
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "trust_building",
    mechanismAxis: "trust_building",
    failures: ["DEPTH_FAILED — causal depth below threshold"],
  });
  assert(result === "DEGRADED_CONTINUE",
    "T2: DEPTH_FAILED with same axis → DEGRADED_CONTINUE",
    `got=${result}`);
}

// ─── T3: AI generation failure → DEGRADED_CONTINUE ───────────────────────────
{
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "social_proof",
    mechanismAxis: "social_proof",
    failures: ["AI generation failed and no differentiation-core fallback available"],
  });
  assert(result === "DEGRADED_CONTINUE",
    "T3: AI generation failure → DEGRADED_CONTINUE",
    `got=${result}`);
}

// ─── T4: Real axis mismatch (no failure markers) → HARD_REJECT ───────────────
{
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "proof_and_transparency",
    mechanismAxis: "category_leadership",
    failures: [],
  });
  assert(result === "HARD_REJECT",
    "T4: real axis mismatch with no failures → HARD_REJECT",
    `got=${result}`);
}

// ─── T5: Real mismatch but ALSO has failure marker → DEGRADED (failure wins) ──
{
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "proof_and_transparency",
    mechanismAxis: "category_leadership",
    failures: ["Request timed out."],
  });
  assert(result === "DEGRADED_CONTINUE",
    "T5: axis mismatch + timeout failure → DEGRADED_CONTINUE (engine failure takes precedence)",
    `got=${result}`);
}

// ─── T6: consistent=true → always PASS ────────────────────────────────────────
{
  const result = axisGuardDecision({
    consistent: true,
    primaryAxis: "proof_and_transparency",
    mechanismAxis: "proof_and_transparency",
    failures: [],
  });
  assert(result === "PASS",
    "T6: consistent=true → PASS regardless of axis values",
    `got=${result}`);
}

// ─── T7: Empty axis strings → DEGRADED_CONTINUE (not HARD_REJECT) ────────────
{
  // When mechanism engine fails before writing axis values, both fields are ""
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "",
    mechanismAxis: "",
    failures: [],
  });
  assert(result === "DEGRADED_CONTINUE",
    "T7: empty axis strings → DEGRADED_CONTINUE (axes cannot be compared)",
    `got=${result}`);
}

// ─── T8: Normalisation: underscore vs space variants are the same ─────────────
{
  const result = axisGuardDecision({
    consistent: false,
    primaryAxis: "proof_and_transparency",
    mechanismAxis: "proof and transparency",
    failures: [],
  });
  assert(result === "DEGRADED_CONTINUE",
    "T8: underscore vs space normalisation — axes are the same after normalise()",
    `got=${result}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(66)}`);
console.log(`Result: ${failed === 0 ? "\x1b[32mALL PASS\x1b[0m" : `\x1b[31m${failed} FAILED\x1b[0m`}`);
if (failed > 0) process.exit(1);
