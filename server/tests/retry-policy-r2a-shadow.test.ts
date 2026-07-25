/**
 * R2a shadow-recommendation test (May 2026, Phase R — Weighted Intelligent
 * Recovery doctrine).
 *
 * Proves that `computeShadowRetryRecommendation` is OBSERVATION-ONLY:
 *   - The production `planRetry` decision is bit-for-bit unchanged whether
 *     or not the shadow helper is invoked (no side effects, no registry
 *     mutation).
 *   - The shadow's `weighted` decision diverges from `current` ONLY for the
 *     pilot field (`offer.painAlignment`) AND only on the `maxAttempts`
 *     axis. Non-pilot fields are no-ops.
 *   - `wouldWiden` correctly fires only when the gate is retry-bearing
 *     (gateShouldRetry=true) — importance widens the retry budget, never
 *     the retry verdict.
 *   - The U5b parity contract is preserved: `planRetry` with the new
 *     `missingFieldId` argument equals `legacyMirrorRetryDecision` for
 *     every input the empty-registry production path can see.
 *   - The `FIELD_IMPORTANCE_REGISTRY` is not mutated by any shadow path
 *     (verified by reading post-test `getFieldImportanceForRetry` for the
 *     pilot id and asserting `undefined`).
 *
 * Doctrine constraints honored (per R2a authorization, May 2026):
 *   - No production retry behavior change.
 *   - No actual retry widening live.
 *   - No registry population.
 *   - No new detection systems.
 *   - Reuses the existing missingFieldId / ownership path.
 */

import {
  planRetry,
  legacyMirrorRetryDecision,
  computeShadowRetryRecommendation,
  type RetryPolicyInput,
  type GateSeverity,
} from "../decision-policy/retry-policy";
import { getFieldImportanceForRetry } from "../shared/weight-schema";

const PILOT_FIELD = "offer.painAlignment";
const PILOT_ENGINE = "offer";
const NON_PILOT_FIELD = "positioning.engineConfidence";

interface CaseResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CaseResult[] = [];
function record(name: string, pass: boolean, detail = "") {
  results.push({ name, pass, detail });
}

function shadowFor(input: RetryPolicyInput) {
  return computeShadowRetryRecommendation({
    ...input,
    pilotField: PILOT_FIELD,
    pilotOwningEngine: PILOT_ENGINE,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// (1) Production planRetry decision is unchanged when missingFieldId is
//     forwarded — the empty registry guarantees no widening.
// ──────────────────────────────────────────────────────────────────────────
{
  const SEVERITIES: GateSeverity[] = ["critical", "high", "medium"];
  const RETRYS = [true, false];
  const FIELDS = [undefined, PILOT_FIELD, NON_PILOT_FIELD];
  const ENGINES = ["positioning", "offer", "statistical_validation", "channel_selection"];
  let drift = 0;
  let cases = 0;
  for (const engineId of ENGINES) {
    for (const sev of SEVERITIES) {
      for (const r of RETRYS) {
        for (const f of FIELDS) {
          cases++;
          const input: RetryPolicyInput = {
            engineId,
            gateShouldRetry: r,
            gateSeverity: sev,
            missingFieldId: f,
          };
          const planned = planRetry(input);
          const legacy = legacyMirrorRetryDecision(input);
          const same =
            planned.retry === legacy.retry &&
            planned.scope === legacy.scope &&
            planned.maxAttempts === legacy.maxAttempts &&
            planned.onFinalFailure === legacy.onFinalFailure &&
            planned.rationale === legacy.rationale;
          if (!same) drift++;
        }
      }
    }
  }
  record(
    `1. planRetry parity preserved with missingFieldId forwarded (${cases} cases, registry empty)`,
    drift === 0,
    `cases=${cases} drift=${drift}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// (2) Shadow on a non-pilot field is a no-op: current === weighted.
// ──────────────────────────────────────────────────────────────────────────
{
  const s = shadowFor({
    engineId: "positioning",
    gateShouldRetry: true,
    gateSeverity: "critical",
    missingFieldId: NON_PILOT_FIELD,
  });
  const sameDecision =
    s.current.retry === s.weighted.retry &&
    s.current.scope === s.weighted.scope &&
    s.current.maxAttempts === s.weighted.maxAttempts &&
    s.current.onFinalFailure === s.weighted.onFinalFailure;
  record(
    "2. non-pilot field → shadow is a no-op (current === weighted, both axes flat)",
    sameDecision && s.matchedPilot === false && s.wouldRetry === false && s.wouldWiden === false && s.budgetAxisWidened === false,
    `matchedPilot=${s.matchedPilot} wouldRetry=${s.wouldRetry} wouldWiden=${s.wouldWiden} budgetAxisWidened=${s.budgetAxisWidened} reason="${s.reason}"`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// (3) Shadow on the pilot field with retry-bearing gate → wouldWiden=true,
//     wouldRetry=false (importance widens maxAttempts only, never `retry`).
// ──────────────────────────────────────────────────────────────────────────
{
  const s = shadowFor({
    engineId: "offer",
    gateShouldRetry: true,
    gateSeverity: "critical",
    missingFieldId: PILOT_FIELD,
  });
  const correct =
    s.matchedPilot === true &&
    s.wouldWiden === true &&
    s.budgetAxisWidened === true &&
    s.wouldRetry === false &&
    s.current.maxAttempts === 1 &&
    s.weighted.maxAttempts === 2 &&
    s.current.retry === s.weighted.retry &&
    s.current.onFinalFailure === s.weighted.onFinalFailure &&
    s.field === PILOT_FIELD &&
    s.owningEngine === PILOT_ENGINE &&
    s.importance === "critical";
  record(
    "3. pilot + retry-bearing gate → wouldWiden=true, wouldRetry=false, maxAttempts 1→2",
    correct,
    `matchedPilot=${s.matchedPilot} wouldRetry=${s.wouldRetry} wouldWiden=${s.wouldWiden} ` +
      `current.maxAttempts=${s.current.maxAttempts} weighted.maxAttempts=${s.weighted.maxAttempts} ` +
      `field=${s.field} owningEngine=${s.owningEngine} importance=${s.importance}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// (4) Shadow on the pilot field with halt-path gate (gateShouldRetry=false):
//     - retry decision is unchanged (importance never re-enables a halted retry)
//     - the RAW budget axis still grows (planRetry sets maxAttempts=2 whenever
//       importance==="critical", regardless of retry) — this is reported
//       truthfully so log readers see the latent shift
//     - `wouldWiden` is FALSE because the wider budget is operationally inert
//       (no retry will be spent)
//     - `reason` explicitly says "budget-axis-widened-but-inert"
// ──────────────────────────────────────────────────────────────────────────
{
  const s = shadowFor({
    engineId: "offer",
    gateShouldRetry: false,
    gateSeverity: "critical",
    missingFieldId: PILOT_FIELD,
  });
  const correct =
    s.matchedPilot === true &&
    s.wouldWiden === false &&            // operational widening = false
    s.budgetAxisWidened === true &&      // raw structural axis = true
    s.wouldRetry === false &&            // retry decision unchanged
    s.current.retry === false &&
    s.weighted.retry === false &&        // halt-path preserved
    s.current.maxAttempts === 1 &&
    s.weighted.maxAttempts === 2 &&      // raw budget axis still moves
    s.reason.includes("budget-axis-widened-but-inert");
  record(
    "4. pilot + halt-path → wouldWiden=false but raw budget axis truthfully reported (inert)",
    correct,
    `matchedPilot=${s.matchedPilot} wouldRetry=${s.wouldRetry} wouldWiden=${s.wouldWiden} ` +
      `current.retry=${s.current.retry} weighted.retry=${s.weighted.retry} ` +
      `current.maxAttempts=${s.current.maxAttempts} weighted.maxAttempts=${s.weighted.maxAttempts} ` +
      `reason="${s.reason}"`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// (5) Shadow with no missingFieldId → no-op (no observation possible).
// ──────────────────────────────────────────────────────────────────────────
{
  const s = shadowFor({
    engineId: "offer",
    gateShouldRetry: true,
    gateSeverity: "critical",
    missingFieldId: undefined,
  });
  record(
    "5. missing missingFieldId → matchedPilot=false, wouldWiden=false",
    s.matchedPilot === false && s.wouldWiden === false && s.wouldRetry === false,
    `matchedPilot=${s.matchedPilot} field=${s.field} reason="${s.reason}"`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// (6) computeShadowRetryRecommendation does NOT mutate the production
//     registry. After invoking shadow on every gate, the pilot field id
//     must still be unregistered (lookup returns undefined).
// ──────────────────────────────────────────────────────────────────────────
{
  // Run shadow for every gate's missingFieldId on every severity/retry combo.
  const FIELDS = [
    "positioning.engineConfidence",
    "offer.painAlignment",
    "statistical_validation.validationState",
    "channel_selection.conversionChannels",
    undefined,
  ];
  for (const f of FIELDS) {
    for (const sev of ["critical", "high", "medium"] as GateSeverity[]) {
      for (const r of [true, false]) {
        shadowFor({
          engineId: "offer",
          gateShouldRetry: r,
          gateSeverity: sev,
          missingFieldId: f,
        });
      }
    }
  }
  // Verify: production registry still has no opinion on the pilot field.
  const importance = getFieldImportanceForRetry(PILOT_FIELD);
  record(
    "6. shadow path does NOT mutate FIELD_IMPORTANCE_REGISTRY (pilot still unregistered)",
    importance === undefined,
    `getFieldImportanceForRetry("${PILOT_FIELD}") === ${String(importance)}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
// (7) After the shadow has run, calling planRetry on the pilot field
//     STILL returns maxAttempts=1 (production behavior unchanged).
// ──────────────────────────────────────────────────────────────────────────
{
  const d = planRetry({
    engineId: "offer",
    gateShouldRetry: true,
    gateSeverity: "critical",
    missingFieldId: PILOT_FIELD,
  });
  record(
    "7. post-shadow planRetry on pilot field → maxAttempts=1 (production unchanged)",
    d.maxAttempts === 1,
    `maxAttempts=${d.maxAttempts}`,
  );
}

// ──────────────────────────────────────────────────────────────────────────
console.log("R2a Shadow Recommendation Test (Phase R — observation only)");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`Cases: ${results.length}`);
console.log("");

let allPassed = true;
for (const r of results) {
  const tag = r.pass ? "✓" : "✗";
  console.log(`  ${tag} ${r.name}`);
  if (!r.pass) {
    console.log(`      ${r.detail}`);
    allPassed = false;
  }
}
console.log("");

if (allPassed) {
  console.log("✓ R2A SHADOW RECOMMENDATION PROVEN OBSERVATION-ONLY");
  console.log("  Production planRetry unchanged. Registry untouched.");
  console.log("  Shadow diverges from current ONLY on pilot field (offer.painAlignment)");
  console.log("  AND only along the maxAttempts axis on retry-bearing gates.");
  process.exit(0);
}

console.log("✗ R2A SHADOW TEST FAILED");
console.log("  Either the shadow is leaking into production behavior, or the");
console.log("  pilot scoping/widening logic is incorrect.");
process.exit(1);
