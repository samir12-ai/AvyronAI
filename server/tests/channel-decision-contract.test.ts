/**
 * Channel Selection decision-gate contract — proof tests (H3, May 2026)
 *
 * The channel_selection engine emits an F10 gate-outcome vocabulary distinct
 * from F1 engine-execution status:
 *   - `primaryChannel.decisionGate.outcome` ∈ { recommended | support_channel | exploratory }
 *
 * Rollout note (post Seal #9 / F2.10): the field is now registered in
 * `requiredOutputs` with `emptyIsMissing: true`. The H3 transitional
 * exception (optional placement) is RETIRED. Absence at the pipeline gate
 * surfaces as CONTRACT_INCOMPLETE per doctrine D5; presence is enforced
 * with the strict enum shape.
 *
 * These tests prove:
 *   1. Field is registered in `requiredOutputs` with the canonical path
 *   2. Strict enum is z.enum (not z.string) — wrong vocab rejected
 *   3. Each canonical outcome value validates against the shape
 *   4. emptyIsMissing=true (post-promotion D5 contract)
 *
 * Run with:  npx tsx server/tests/channel-decision-contract.test.ts
 */

import { getContract } from "../orchestrator/contract-registry/helpers";
import type { ContractField } from "../orchestrator/contract-registry/types";

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";

let failed = 0;

function assert(cond: boolean, label: string, detail: string = "") {
  if (cond) console.log(`${PASS} ${label}${detail ? ` | ${detail}` : ""}`);
  else { console.log(`${FAIL} ${label}${detail ? ` | ${detail}` : ""}`); failed++; }
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Channel Selection — decisionGate.outcome Contract (H3)");
console.log("══════════════════════════════════════════════════════════════════\n");

const contract = getContract("channel_selection");
// Seal #9 / F2.10: lookup is REQUIRED-only. Optional fallback removed so a
// regression that demoted the field back to `optionalOutputs` would fail S0
// instead of silently passing on the legacy lookup path.
const gateField: ContractField | undefined =
  contract?.requiredOutputs.find((f) => f.id === "decisionGateOutcome");

// ── S0: registry has the field in requiredOutputs with canonical path ─────
assert(!!gateField, "S0: channel_selection.decisionGateOutcome is in requiredOutputs (post Seal #9 promotion)");
assert(
  JSON.stringify(gateField?.path) === JSON.stringify(["primaryChannel", "decisionGate", "outcome"]),
  "S0: canonical path is ['primaryChannel','decisionGate','outcome']",
);

// ── S0b: shape is a strict enum (z.enum), not z.string ────────────────────
// Probe by parsing — `z.enum` rejects unknown literals; `z.string` accepts any string.
{
  const ok = gateField?.shape.safeParse("recommended");
  const wrong = gateField?.shape.safeParse("any-arbitrary-value");
  assert(!!ok && ok.success === true, "S0b: shape accepts canonical literal 'recommended'");
  assert(
    !!wrong && wrong.success === false,
    "S0b: shape REJECTS arbitrary string — proves z.enum tightening (not z.string)",
  );
}

// ── S1: each canonical outcome validates ───────────────────────────────────
for (const outcome of ["recommended", "support_channel", "exploratory"]) {
  const r = gateField?.shape.safeParse(outcome);
  assert(
    !!r && r.success === true,
    `S1: canonical outcome '${outcome}' passes strict-enum shape`,
  );
}

// ── S2: wrong vocabularies rejected ────────────────────────────────────────
const wrongVocabs = ["RECOMMENDED", "primary", "approved", "PASS", "BLOCK", "support", "test", "halt"];
for (const outcome of wrongVocabs) {
  const r = gateField?.shape.safeParse(outcome);
  assert(
    !!r && r.success === false,
    `S2: wrong-vocab outcome='${outcome}' rejected by strict enum`,
  );
}

// ── S3: doctrine D5 — promotion landed in Seal #9 (F2.10). The field is now
// in `requiredOutputs` with `emptyIsMissing: true`, so absence is reported
// as CONTRACT_INCOMPLETE at the pipeline gate (`validateContractCompleteness`)
// instead of being silently tolerated. The H3 transitional exception is
// retired; this assertion locks in the post-promotion contract shape.
assert(
  gateField?.emptyIsMissing === true,
  "S3: emptyIsMissing=true post-promotion — missing canonical surfaces as CONTRACT_INCOMPLETE",
);

console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log("  SUITE: ALL TESTS PASSED — channel decision contract is hardened.");
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(0);
} else {
  console.log(`  SUITE: ${failed} TEST(S) FAILED.`);
  console.log("══════════════════════════════════════════════════════════════════\n");
  process.exit(1);
}
