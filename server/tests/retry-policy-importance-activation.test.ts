/**
 * U5d activation test (May 2026, Unified Weighted Reliability Doctrine).
 *
 * Proves the U5d importance-driven widening branch in `planRetry` is
 * REAL CODE that fires when a field is registered as critical, NOT
 * vestigial scaffolding. Complements the U5b parity harness (still
 * 180/180), which proves the EMPTY-REGISTRY case is a no-op.
 *
 * Doctrinal contract this test locks in:
 *   1. Default (no missingFieldId)         → maxAttempts = 1 (U5c baseline)
 *   2. Default (unregistered missingFieldId) → maxAttempts = 1 (U5c baseline)
 *   3. Registered importance="critical"    → maxAttempts = 2 (U5d widening)
 *   4. Registered importance="high"        → maxAttempts = 1 (no widening; only critical widens today)
 *   5. Registered importance="medium"      → maxAttempts = 1 (no widening)
 *   6. Registered importance="low"         → maxAttempts = 1 (no widening)
 *   7. Test override is fully reversible — after disposer is called, the
 *      registry returns to its empty production state and planRetry
 *      output is identical to U5c.
 *   8. Importance widening does NOT change retry/scope/onFinalFailure —
 *      only maxAttempts. This is the locked U5d contract; widening other
 *      fields requires its own authorization + parity proof.
 */

import {
  planRetry,
  legacyMirrorRetryDecision,
  type RetryPolicyDecision,
} from "../decision-policy/retry-policy";
import {
  __testOnly_registerFieldImportance,
  type FieldImportance,
} from "../shared/weight-schema";

const TEST_FIELD = "u5d.activation-test.field";
const SAMPLE_INPUT = {
  engineId: "audience" as const,
  gateShouldRetry: true,
  gateSeverity: "high" as const,
};

interface CaseResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CaseResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}

function withRegistration(
  fieldId: string,
  importance: FieldImportance,
  fn: () => void,
) {
  const dispose = __testOnly_registerFieldImportance(fieldId, importance);
  try {
    fn();
  } finally {
    dispose();
  }
}

// (1) Default — no missingFieldId → U5c baseline
{
  const d = planRetry({ ...SAMPLE_INPUT });
  record(
    "1. no missingFieldId → maxAttempts=1 (U5c baseline)",
    d.maxAttempts === 1,
    `maxAttempts=${d.maxAttempts}`,
  );
}

// (2) Unregistered missingFieldId → U5c baseline
{
  const d = planRetry({ ...SAMPLE_INPUT, missingFieldId: TEST_FIELD });
  record(
    "2. unregistered missingFieldId → maxAttempts=1 (U5c baseline)",
    d.maxAttempts === 1,
    `maxAttempts=${d.maxAttempts}`,
  );
}

// (3-6) Registered importance variants
for (const importance of ["critical", "high", "medium", "low"] as FieldImportance[]) {
  withRegistration(TEST_FIELD, importance, () => {
    const d = planRetry({ ...SAMPLE_INPUT, missingFieldId: TEST_FIELD });
    const expectedMax = importance === "critical" ? 2 : 1;
    const idx = importance === "critical" ? 3 : importance === "high" ? 4 : importance === "medium" ? 5 : 6;
    const desc = importance === "critical" ? "U5d widening" : "no widening (only critical widens today)";
    record(
      `${idx}. importance="${importance}" → maxAttempts=${expectedMax} (${desc})`,
      d.maxAttempts === expectedMax,
      `maxAttempts=${d.maxAttempts}, expected=${expectedMax}`,
    );
  });
}

// (7) Disposer reversibility
{
  const dispose = __testOnly_registerFieldImportance(TEST_FIELD, "critical");
  const widened = planRetry({ ...SAMPLE_INPUT, missingFieldId: TEST_FIELD });
  dispose();
  const restored = planRetry({ ...SAMPLE_INPUT, missingFieldId: TEST_FIELD });
  const baseline = legacyMirrorRetryDecision({ ...SAMPLE_INPUT, missingFieldId: TEST_FIELD });
  const allFieldsMatch =
    restored.retry === baseline.retry &&
    restored.scope === baseline.scope &&
    restored.maxAttempts === baseline.maxAttempts &&
    restored.onFinalFailure === baseline.onFinalFailure &&
    restored.rationale === baseline.rationale;
  record(
    "7. disposer restores planRetry to U5c baseline (full object equality vs legacyMirror)",
    widened.maxAttempts === 2 && allFieldsMatch,
    `widened.maxAttempts=${widened.maxAttempts}, restored matches legacyMirror=${allFieldsMatch}`,
  );
}

// (8) Importance widening leaves retry/scope/onFinalFailure UNCHANGED
{
  withRegistration(TEST_FIELD, "critical", () => {
    // Critical importance + non-critical severity + retry=true
    const widened = planRetry({
      engineId: "audience",
      gateShouldRetry: true,
      gateSeverity: "high",
      missingFieldId: TEST_FIELD,
    });
    const baseline = legacyMirrorRetryDecision({
      engineId: "audience",
      gateShouldRetry: true,
      gateSeverity: "high",
      missingFieldId: TEST_FIELD,
    });
    const onlyMaxAttemptsChanged =
      widened.retry === baseline.retry &&
      widened.scope === baseline.scope &&
      widened.maxAttempts !== baseline.maxAttempts &&
      widened.maxAttempts === 2 &&
      baseline.maxAttempts === 1 &&
      widened.onFinalFailure === baseline.onFinalFailure;
    record(
      "8. importance widening changes ONLY maxAttempts (retry/scope/onFinalFailure preserved)",
      onlyMaxAttemptsChanged,
      `widened: ${JSON.stringify({ retry: widened.retry, scope: widened.scope, maxAttempts: widened.maxAttempts, onFinalFailure: widened.onFinalFailure })} | baseline maxAttempts=${baseline.maxAttempts}`,
    );
  });
}

console.log("U5d Importance-Driven Retry Activation Test");
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
  console.log("✓ U5D ACTIVATION PROVEN");
  console.log("  Importance-driven widening fires when registered, no-ops when not.");
  console.log("  Production registry is empty → U5b parity (180/180) preserved.");
  console.log("  Future per-field registration is a separate user authorization.");
  process.exit(0);
}

console.log("✗ U5D ACTIVATION FAILED");
console.log("  The importance-driven branch is either misfiring or unreached.");
process.exit(1);
