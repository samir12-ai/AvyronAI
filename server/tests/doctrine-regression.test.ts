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

// ── Summary ───────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════════");
if (failed === 0) {
  console.log(`${PASS} all assertions passed (${OFFENDERS.length} offenders + ${CLEAN.length} clean)`);
  process.exit(0);
} else {
  console.log(`${FAIL} ${failed} assertion(s) failed`);
  process.exit(1);
}
