/**
 * Custom ESLint rule: orchestrator-module-boundary
 *
 * Task #90 / Phase 4-B — Orchestrator responsibility extraction boundary.
 *
 * The decomposition scaffold extracted sibling modules next to
 * server/orchestrator/index.ts. Two boundary invariants:
 *
 *   (A) Extracted modules MUST NOT reach back into ../index.ts. A module
 *       importing the 5000-line orchestrator index re-creates the tangle
 *       the extraction exists to unwind (and guarantees import cycles once
 *       index.ts starts delegating into the module).
 *
 *   (B) External code (outside server/orchestrator/) MUST NOT import
 *       extracted-module internals. The ONLY sanctioned surface is
 *       server/orchestrator/index.ts re-exports — modules stay swappable
 *       while the scaffold throws SCAFFOLD_NOT_WIRED.
 *
 * NOT covered (intentionally): loose orchestrator files (priority-matrix,
 * run-resolver, job-id, doctrine-seed, memory-context,
 * shared-strategic-context, routes, ...) and the pre-decomposition
 * subsystems `contract-registry` and `replay`, which have their own
 * consumer surfaces (e.g. ai-client → replay/recorder).
 *
 * Scope is defined in eslint.config.js: files: server/**\/*.ts
 */

"use strict";

const path = require("path");

// P4-B/P4-E extracted sibling modules (scaffold, SCAFFOLD_NOT_WIRED).
const EXTRACTED_MODULES = [
  "engine-invocation-loop",
  "gate-retry-loop",
  "post-run-projections",
  "result-assembly",
  "scoped-hydrate-driver",
  "synthesis-degradation-builder",
  "system-control-composition",
];

function posix(p) {
  return p.replace(/\\/g, "/");
}

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce the orchestrator decomposition boundary: modules never import ../index; external code never imports module internals.",
      recommended: false,
    },
    schema: [],
    messages: {
      backImport:
        "Extracted orchestrator module '{{module}}' MUST NOT import server/orchestrator/index.ts. " +
        "Modules receive their inputs as parameters; reaching back into the index re-creates the tangle (Task #90).",
      internalImport:
        "Importing internals of extracted orchestrator module '{{module}}' from outside server/orchestrator/ is forbidden. " +
        "Go through server/orchestrator/index.ts re-exports (Task #90).",
    },
  },

  create(context) {
    const filename = posix(context.filename || context.getFilename() || "");
    const fileDir = path.posix.dirname(filename);

    const orchMatch = filename.match(/^(.*\/server\/orchestrator)\//);
    const insideOrchestrator = orchMatch !== null;
    const containingModule = insideOrchestrator
      ? EXTRACTED_MODULES.find((m) =>
          filename.includes(`/server/orchestrator/${m}/`)
        ) || null
      : null;

    function checkSource(node, sourceValue) {
      if (typeof sourceValue !== "string") return;
      if (!sourceValue.startsWith(".")) return; // relative imports only
      const resolved = posix(path.posix.resolve(fileDir, sourceValue));

      // (A) module → ../index back-import.
      if (containingModule) {
        const orchRoot = orchMatch[1];
        if (
          resolved === `${orchRoot}/index` ||
          resolved === `${orchRoot}/index.ts` ||
          resolved === orchRoot
        ) {
          context.report({
            node,
            messageId: "backImport",
            data: { module: containingModule },
          });
        }
        return;
      }

      // (B) external → module internals.
      if (!insideOrchestrator) {
        for (const mod of EXTRACTED_MODULES) {
          const marker = `/server/orchestrator/${mod}`;
          const idx = resolved.indexOf(marker);
          if (idx !== -1) {
            const rest = resolved.slice(idx + marker.length);
            if (rest === "" || rest.startsWith("/")) {
              context.report({
                node,
                messageId: "internalImport",
                data: { module: mod },
              });
              return;
            }
          }
        }
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source && node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.source) checkSource(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source && node.source.type === "Literal") {
          checkSource(node, node.source.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments.length === 1 &&
          node.arguments[0].type === "Literal"
        ) {
          checkSource(node, node.arguments[0].value);
        }
      },
    };
  },
};
