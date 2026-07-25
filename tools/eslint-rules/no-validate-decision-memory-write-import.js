/**
 * Custom ESLint rule: no-validate-decision-memory-write-import
 *
 * Task #66 / Phase 3 — Enforcement Consolidation.
 *
 * `validateDecisionForMemoryWrite` is the single memory-write gate and it
 * delegates to `policyEnforcedMemoryCheck`. Importing it outside the
 * decision-policy module re-opens the dual-gate seam: a second consumer of
 * the gate function is exactly the divergence Phase 1 closed (two callers
 * evolving different pre/post-conditions around the same check).
 *
 * Internal allowlist: any file inside server/decision-policy/ (the module
 * that owns the gate). Widen ONLY with an architect note — add the approved
 * consumer path to ALLOWED_PATH_FRAGMENTS below.
 *
 * Scope is defined in eslint.config.js:
 *   files:   server/**\/*.ts
 *   ignores: server/tests/**, server/migrations/**
 */

"use strict";

const GATE_NAME = "validateDecisionForMemoryWrite";

// Path fragments (posix-normalized) whose files MAY import the gate.
const ALLOWED_PATH_FRAGMENTS = ["server/decision-policy/"];

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid importing validateDecisionForMemoryWrite outside decision-policy — one gate, one consumer surface.",
      recommended: false,
    },
    schema: [],
    messages: {
      gateImport:
        "Importing `validateDecisionForMemoryWrite` outside server/decision-policy/ is forbidden. " +
        "Memory writes go through memoryStore, which already applies the gate (policyEnforcedMemoryCheck). " +
        "A second direct consumer re-opens the dual-gate seam closed in Task #66.",
    },
  },

  create(context) {
    const filename = (context.filename || context.getFilename() || "").replace(/\\/g, "/");
    const isAllowed = ALLOWED_PATH_FRAGMENTS.some((frag) => filename.includes(frag));
    if (isAllowed) return {};

    return {
      ImportSpecifier(node) {
        const importedName =
          node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
        if (importedName === GATE_NAME) {
          context.report({ node, messageId: "gateImport" });
        }
      },
      // const { validateDecisionForMemoryWrite } = require("...")
      VariableDeclarator(node) {
        if (
          node.init &&
          node.init.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          node.init.callee.name === "require" &&
          node.id.type === "ObjectPattern"
        ) {
          for (const prop of node.id.properties) {
            if (
              prop.type === "Property" &&
              prop.key.type === "Identifier" &&
              prop.key.name === GATE_NAME
            ) {
              context.report({ node: prop, messageId: "gateImport" });
            }
          }
        }
      },
    };
  },
};
