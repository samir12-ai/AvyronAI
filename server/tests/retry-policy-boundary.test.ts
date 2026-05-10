/**
 * U5a guard test — boundary enforcement.
 *
 * Per user constraint (U-series, May 2026): "do NOT touch per-engine
 * REJECTED-loop retries." The orchestrator gate-retry policy lives at
 * `server/decision-policy/retry-policy.ts` (planRetry) and applies ONLY
 * at the orchestrator gate boundary. Per-engine REJECTED-loop modules
 * (designer + LLM judge + 1 retry + null fallback) own their own retry
 * contract and MUST NOT consult planRetry.
 *
 * This test scans the five per-engine REJECTED-loop module files and
 * fails the build if any of them imports from
 * `decision-policy/retry-policy`. Documentation alone cannot prevent
 * accidental coupling — this test does.
 *
 * If you have a legitimate reason to add such an import, do not edit
 * this test to remove the file from FORBIDDEN_IMPORTERS — instead, open
 * a fresh user authorization (the boundary is a user constraint, not a
 * doctrine convention).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * The five per-engine REJECTED-loop modules enumerated in
 * `replit.md` (Marketing-logic engine upgrade, Apr 2026). These are the
 * commercial-reasoning modules whose designer + LLM judge + 1-retry
 * contract is preserved as-is.
 */
const FORBIDDEN_IMPORTERS = [
  "server/persuasion-engine/trust-transfer.ts",
  "server/positioning-engine/category-game.ts",
  "server/offer-engine/value-architect.ts",
  "server/audience-engine/buyer-psychology.ts",
  "server/awareness-engine/narrative-reframe.ts",
];

/** Any import path that resolves to retry-policy.ts is a violation. */
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*decision-policy\/retry-policy['"]/,
  /from\s+['"][^'"]*decision-policy\/retry-policy\.[tj]s['"]/,
  /require\s*\(\s*['"][^'"]*decision-policy\/retry-policy['"]\s*\)/,
];

interface Violation {
  file: string;
  line: number;
  text: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const rel of FORBIDDEN_IMPORTERS) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.warn(`[retry-policy-boundary] note: ${rel} does not exist (yet?). Skipping — boundary still enforced if/when created.`);
      continue;
    }
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    lines.forEach((text, idx) => {
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        if (pattern.test(text)) {
          violations.push({ file: rel, line: idx + 1, text: text.trim() });
          break;
        }
      }
    });
  }
  return violations;
}

const violations = scan();

console.log("U5a Retry-Policy Boundary Test");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`Scanned ${FORBIDDEN_IMPORTERS.length} per-engine REJECTED-loop modules.`);

if (violations.length === 0) {
  console.log("");
  console.log("✓ BOUNDARY HOLDS");
  console.log("  No per-engine REJECTED-loop module imports decision-policy/retry-policy.");
  console.log("  planRetry remains gate-only. User constraint preserved.");
  process.exit(0);
}

console.log("");
console.log("✗ BOUNDARY VIOLATED");
console.log("  The following per-engine REJECTED-loop modules import the");
console.log("  orchestrator gate retry policy. This violates the user constraint");
console.log("  'do NOT touch per-engine REJECTED-loop retries' (U-series, May 2026).");
console.log("");
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}`);
  console.log(`    ${v.text}`);
}
console.log("");
console.log("  Resolve by either:");
console.log("    1. Removing the import (preferred — REJECTED-loop owns its own retry).");
console.log("    2. Opening a fresh user authorization to widen the gate-only boundary.");
process.exit(1);
