/**
 * Channel Selection decision-gate contract — proof tests (H3, May 2026)
 *
 * The channel_selection engine emits an F10 gate-outcome vocabulary distinct
 * from F1 engine-execution status:
 *   - `primaryChannel.decisionGate.outcome` ∈ { recommended | support_channel | exploratory }
 *
 * Rollout note: the field is registered in `optionalOutputs` during the
 * engine-emit transition window — its strict enum shape is enforced when
 * present, but absence does not retroactively flag legacy snapshots STALE.
 * Promotion to `requiredOutputs` is a follow-on phase.
 *
 * These tests prove:
 *   1. Field is registered with the canonical path
 *   2. Strict enum is z.enum (not z.string) — wrong vocab rejected
 *   3. Each canonical outcome value validates against the shape
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
const gateField: ContractField | undefined =
  contract?.requiredOutputs.find((f) => f.id === "decisionGateOutcome") ??
  contract?.optionalOutputs.find((f) => f.id === "decisionGateOutcome");

// ── S0: registry has the field with canonical path ─────────────────────────
assert(!!gateField, "S0: registry has channel_selection.decisionGateOutcome (transition phase = optional)");
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

// ── S3: doctrine D5 — when promoted to required, missing field MUST be ─────
// CONTRACT_INCOMPLETE. Until promotion, the test asserts the wiring is in
// place: `emptyIsMissing` is set and the field uses a strict enum shape, so
// the eventual promotion is a one-line edit.
assert(
  gateField?.emptyIsMissing === false,
  "S3: emptyIsMissing=false during transition — empty/missing tolerated until engine reliably emits",
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
