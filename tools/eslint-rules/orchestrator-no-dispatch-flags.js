/**
 * Custom ESLint rule: orchestrator-no-dispatch-flags
 *
 * Task #93 / Phase 4-E — dispatch deletion guard.
 *
 * The per-module dispatch system (`ORCH_USE_<MODULE>` env flags routing
 * between legacy runOrchestrator and extracted modules) was DELETED in
 * Phase 4-E. Legacy runOrchestrator is the ONLY working path; the scaffold
 * throws SCAFFOLD_NOT_WIRED. Reading an ORCH_USE_* env var anywhere would
 * silently resurrect a second execution path — the exact drift OD-1
 * classifies as forbidden (only one execution path may exist).
 *
 * Bans every read shape:
 *   process.env.ORCH_USE_X
 *   process.env["ORCH_USE_X"]
 *   const { ORCH_USE_X } = process.env
 *
 * Comments and doc strings that merely MENTION the flag family are fine
 * (they document the deletion).
 *
 * Scope is defined in eslint.config.js: files: server/**\/*.ts
 */

"use strict";

const FLAG_PREFIX = "ORCH_USE_";

function isProcessEnv(node) {
  return (
    node &&
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "process" &&
    ((node.property.type === "Identifier" && node.property.name === "env") ||
      (node.property.type === "Literal" && node.property.value === "env"))
  );
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid ORCH_USE_* env reads — the module dispatch system was deleted in Phase 4-E; one execution path only.",
      recommended: false,
    },
    schema: [],
    messages: {
      dispatchFlagRead:
        "Reading `{{name}}` is forbidden. The ORCH_USE_* dispatch system was deleted in Task #93 / Phase 4-E — " +
        "legacy runOrchestrator is the only execution path. Do not resurrect per-module dispatch via env flags.",
    },
  },

  create(context) {
    return {
      MemberExpression(node) {
        if (!isProcessEnv(node.object)) return;
        let name = null;
        if (!node.computed && node.property.type === "Identifier") {
          name = node.property.name;
        } else if (node.property.type === "Literal" && typeof node.property.value === "string") {
          name = node.property.value;
        }
        if (name && name.startsWith(FLAG_PREFIX)) {
          context.report({ node, messageId: "dispatchFlagRead", data: { name } });
        }
      },
      VariableDeclarator(node) {
        if (!node.init || !isProcessEnv(node.init)) return;
        if (node.id.type !== "ObjectPattern") return;
        for (const prop of node.id.properties) {
          if (
            prop.type === "Property" &&
            prop.key.type === "Identifier" &&
            prop.key.name.startsWith(FLAG_PREFIX)
          ) {
            context.report({
              node: prop,
              messageId: "dispatchFlagRead",
              data: { name: prop.key.name },
            });
          }
        }
      },
    };
  },
};
