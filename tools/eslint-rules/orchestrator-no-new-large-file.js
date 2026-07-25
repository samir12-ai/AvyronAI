/**
 * Custom ESLint rule: orchestrator-no-new-large-file
 *
 * Task #90 / Phase 4-B (ceiling ratchet maintained through P4-E).
 *
 * Two line ceilings, counted as CODE lines (blank lines and comment-only
 * lines excluded — the orchestrator index carries heavy doctrine comments
 * that must never be an incentive to delete):
 *
 *   (1) server/orchestrator/index.ts ≤ orchestratorIndexMaxLines
 *       (current ceiling 5000 — ratchet DOWN with every Phase-4
 *       extraction, never up; see OD-3 in the intelligence archive).
 *   (2) Every .ts file inside an EXTRACTED sibling module ≤ maxModuleLines
 *       (200). A module file growing past 200 lines is a second
 *       runOrchestrator forming.
 *
 * Pre-decomposition subsystems (contract-registry, replay) are NOT under
 * the 200 ceiling — they predate the scaffold and have their own review
 * history (e.g. contract-registry/registry.ts).
 *
 * Scope is defined in eslint.config.js: files: server/**\/*.ts, options
 * { maxModuleLines: 200, orchestratorIndexMaxLines: 5000 }.
 */

"use strict";

const EXTRACTED_MODULES = [
  "engine-invocation-loop",
  "gate-retry-loop",
  "post-run-projections",
  "result-assembly",
  "scoped-hydrate-driver",
  "synthesis-degradation-builder",
  "system-control-composition",
];

function countCodeLines(text) {
  const lines = text.split(/\r?\n/);
  let count = 0;
  let inBlockComment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (line.startsWith("*")) continue; // JSDoc continuation
    count += 1;
  }
  return count;
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Cap server/orchestrator/index.ts at the ratcheted line ceiling and extracted-module files at maxModuleLines.",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          maxModuleLines: { type: "integer", minimum: 1 },
          orchestratorIndexMaxLines: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      indexTooLarge:
        "server/orchestrator/index.ts has {{actual}} code lines — ceiling is {{max}}. " +
        "The ceiling only ratchets DOWN (OD-3): extract responsibility into a sibling module instead of growing the index.",
      moduleTooLarge:
        "Extracted module file has {{actual}} code lines — per-module ceiling is {{max}}. " +
        "Split the module before it becomes a second runOrchestrator (Task #90).",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const maxModuleLines = options.maxModuleLines || 200;
    const orchestratorIndexMaxLines = options.orchestratorIndexMaxLines || 5000;

    const filename = (context.filename || context.getFilename() || "").replace(/\\/g, "/");

    const isOrchestratorIndex = /\/server\/orchestrator\/index\.ts$/.test(filename);
    const isModuleFile = EXTRACTED_MODULES.some((m) =>
      filename.includes(`/server/orchestrator/${m}/`)
    );

    if (!isOrchestratorIndex && !isModuleFile) return {};

    return {
      Program(node) {
        const actual = countCodeLines(context.sourceCode.getText());
        if (isOrchestratorIndex && actual > orchestratorIndexMaxLines) {
          context.report({
            node,
            messageId: "indexTooLarge",
            data: { actual: String(actual), max: String(orchestratorIndexMaxLines) },
          });
        } else if (isModuleFile && actual > maxModuleLines) {
          context.report({
            node,
            messageId: "moduleTooLarge",
            data: { actual: String(actual), max: String(maxModuleLines) },
          });
        }
      },
    };
  },
};
