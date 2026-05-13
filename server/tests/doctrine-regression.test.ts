/**
 * Doctrine D1 regression — Seal #9 (F10.3)
 *
 * Proves the custom ESLint rule `semantic/no-semantic-fallback` flags
 * every offender shape and stays silent on every clean shape.
 *
 * Coverage:
 *   - H6 baseline:     RHS identifier / RHS member-read (`b ?? a.status`)
 *   - H8 widening:     LHS member-read fallback (`a?.outcome ?? b`)
 *   - H8 widening:     ternary branch verdict-shape read
 *   - Seal #9 (F10.3): alias-variable (`const status = a || b`)
 *   - Seal #9 (F10.3): destructured default (`const { status = "x" } = obj`)
 *
 * Run with:  npx tsx server/tests/doctrine-regression.test.ts
 */

import { RuleTester } from "eslint";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("../../.local/eslint-rules/no-semantic-fallback.js");

const PASS = "\x1b[32m[PASS]\x1b[0m";
const FAIL = "\x1b[31m[FAIL]\x1b[0m";
let failed = 0;

function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`${PASS} ${label}`);
  } catch (err) {
    console.log(`${FAIL} ${label}`);
    console.log(`        ${(err as Error).message.split("\n")[0]}`);
    failed++;
  }
}

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  Doctrine D1 Regression — semantic/no-semantic-fallback");
console.log("══════════════════════════════════════════════════════════════════\n");

const tester = new RuleTester({
  languageOptions: {
    parser: require("@typescript-eslint/parser"),
    parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  },
});

// ── Offender suite (rule MUST report) ────────────────────────────────────

const OFFENDERS: Array<{ label: string; code: string; messageId: string }> = [
  // H6 RHS identifier
  { label: "H6 — RHS identifier `?? status`", code: `const x = a ?? status;`, messageId: "semanticFallbackRhs" },
  // H6 RHS member-read
  { label: "H6 — RHS member `?? a.outcome`", code: `const x = b ?? a.outcome;`, messageId: "semanticFallbackRhs" },
  // H8 LHS member-read
  { label: "H8 — LHS member `a?.outcome ?? b`", code: `const x = a?.outcome ?? b;`, messageId: "semanticFallbackLhs" },
  { label: "H8 — LHS member `a?.status || b`", code: `const x = a?.status || b;`, messageId: "semanticFallbackLhs" },
  // H8 ternary
  { label: "H8 — ternary consequent verdict-shape", code: `const x = c ? a.outcome : b;`, messageId: "semanticFallbackTernary" },
  { label: "H8 — ternary alternate verdict-shape", code: `const x = c ? b : a.verdict;`, messageId: "semanticFallbackTernary" },
  // Seal #9 alias-variable
  { label: "F10.3 — alias `const status = a || b`", code: `const status = a || b;`, messageId: "semanticFallbackAlias" },
  { label: "F10.3 — alias `let verdict = a ?? b`", code: `let verdict = a ?? b;`, messageId: "semanticFallbackAlias" },
  { label: "F10.3 — alias-ternary `const outcome = c ? a : b`", code: `const outcome = c ? a : b;`, messageId: "semanticFallbackAlias" },
  // Seal #9 destructured default
  { label: "F10.3 — destructured `{ status = \"x\" }`", code: `const { status = "PENDING" } = obj;`, messageId: "semanticFallbackDestructured" },
  { label: "F10.3 — destructured `{ outcome = ... }`", code: `const { outcome = "fallback" } = obj;`, messageId: "semanticFallbackDestructured" },
];

for (const off of OFFENDERS) {
  check(`OFFENDER: ${off.label}`, () => {
    tester.run("no-semantic-fallback", rule, {
      valid: [],
      invalid: [
        {
          code: `declare const a: any; declare const b: any; declare const c: boolean; declare const obj: any; declare const status: any; declare const verdict: any; declare const outcome: any; ${off.code}`,
          errors: [{ messageId: off.messageId }],
        },
      ],
    });
  });
}

// ── Clean suite (rule MUST stay silent) ──────────────────────────────────

const CLEAN: Array<{ label: string; code: string }> = [
  { label: "plain non-fallback assignment", code: `const x = a.status;` },
  { label: "plain non-verdict alias", code: `const namedAlias = a || b;` },
  { label: "ternary TEST reads forbidden — body does not", code: `const x = a.status ? "yes" : "no";` },
  { label: "if-statement reads forbidden — not in fallback expression", code: `function f(r: any){ if (r) return r.status; return "x"; }` },
  { label: "destructured WITHOUT default for verdict-shape name", code: `const { status } = obj;` },
  // Seal #9 (pass-3) — alias detector intentionally narrow. Suffix-style
  // canonical names assigned via logical fallback at the alias site do
  // NOT trip the alias detector (rationale in no-semantic-fallback.js).
  { label: "pass-3 clean — alias-LHS suffix `validationState` (intentionally silent)", code: `const validationState = a || b;` },
  { label: "pass-3 clean — alias-LHS suffix `decisionAction` (intentionally silent)", code: `const decisionAction = a ?? b;` },
  { label: "pass-3 clean — destructured suffix `validationState` (intentionally silent)", code: `const { validationState = "weak" } = obj;` },
  { label: "pass-3 clean — benign suffix collision `firstName`", code: `const firstName = a || "anon";` },
];

for (const c of CLEAN) {
  check(`CLEAN: ${c.label}`, () => {
    tester.run("no-semantic-fallback", rule, {
      valid: [
        {
          code: `declare const a: any; declare const b: any; declare const obj: any; ${c.code}`,
        },
      ],
      invalid: [],
    });
  });
}

// ── Fixture-file proof (code-review pass-2) ──────────────────────────────
//
// The audit asked for fixture-based lint proof. We additionally lint the
// real fixture files in `.local/eslint-rules/__fixtures__/` and assert the
// rule reports the EXPECTED set of offenders + zero false positives on
// the clean fixture. This protects against the inline-RuleTester suite
// drifting away from the production fixtures.

import { Linter } from "eslint";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsParser = require("@typescript-eslint/parser");

// Flat-config Linter (ESLint 9). `defineRule` was removed in flat config —
// rules are passed inline via the `plugins` map of the per-call config.
const linter = new Linter({ configType: "flat" });

const FIXTURE_DIR = join(__dirname, "..", "..", ".local", "eslint-rules", "__fixtures__");

function lintFixture(name: string): Linter.LintMessage[] {
  const code = readFileSync(join(FIXTURE_DIR, name), "utf-8");
  return linter.verify(code, [
    {
      languageOptions: {
        parser: tsParser,
        parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      },
      plugins: {
        semantic: { rules: { "no-semantic-fallback": rule } },
      },
      rules: { "semantic/no-semantic-fallback": "error" },
    },
  ]);
}

const RULE_ID = "semantic/no-semantic-fallback";

check("FIXTURE — offenders.ts: rule reports ≥11 violations", () => {
  const messages = lintFixture("offenders.ts");
  const violations = messages.filter((m) => m.ruleId === RULE_ID);
  if (violations.length < 11) {
    throw new Error(`expected ≥11 violations, got ${violations.length}: ${violations.map((m) => `L${m.line}:${m.messageId}`).join(", ")}`);
  }
});

check("FIXTURE — offenders.ts: every messageId variant is exercised", () => {
  const messages = lintFixture("offenders.ts");
  const ids = new Set(messages.filter((m) => m.ruleId === RULE_ID).map((m) => m.messageId));
  const required = ["semanticFallbackRhs", "semanticFallbackLhs", "semanticFallbackTernary", "semanticFallbackAlias", "semanticFallbackDestructured"];
  for (const r of required) {
    if (!ids.has(r)) throw new Error(`fixture missing ${r}; have: ${[...ids].join(",")}`);
  }
});

check("FIXTURE — clean.ts: rule reports ZERO violations (no false positives)", () => {
  const messages = lintFixture("clean.ts");
  const violations = messages.filter((m) => m.ruleId === RULE_ID);
  if (violations.length > 0) {
    throw new Error(`expected 0 violations, got ${violations.length}: ${violations.map((v) => `L${v.line}:${v.messageId}=${v.message}`).join(" | ")}`);
  }
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log(`${PASS} all assertions passed (${OFFENDERS.length} offenders + ${CLEAN.length} clean + 3 fixture-file proofs)`);
  process.exit(0);
} else {
  console.log(`${FAIL} ${failed} assertion(s) failed`);
  process.exit(1);
}
