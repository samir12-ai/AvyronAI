/**
 * Custom ESLint rule: no-direct-strategy-memory-write
 *
 * Task #64 / Phase 1 — Canonical Fact Ownership.
 *
 * `strategy_memory` has exactly ONE authoritative writer: memoryStore
 * (server/memory-system/store.ts) via upsertByFingerprint / updateById /
 * applyDecayUpdate. Direct `db.insert(strategyMemory)` /
 * `db.update(strategyMemory)` / `db.delete(strategyMemory)` calls anywhere
 * else bypass the policy gate (policyEnforcedMemoryCheck), the CV-06 write
 * metrics, and fingerprint dedup — the exact drift Phase 1 closed (there
 * were 14 scattered direct writes before consolidation).
 *
 * Scope + allowlist are defined in eslint.config.js:
 *   files:   server/**\/*.ts
 *   ignores: server/memory-system/store.ts (the authoritative writer),
 *            server/tests/**, server/migrations/**
 */

"use strict";

const WRITE_METHODS = new Set(["insert", "update", "delete"]);

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct db.insert/update/delete(strategyMemory) outside memoryStore — strategy_memory has a single authoritative writer.",
      recommended: false,
    },
    schema: [],
    messages: {
      directWrite:
        "Direct {{method}}(strategyMemory) is forbidden. strategy_memory is written ONLY through memoryStore " +
        "(server/memory-system/store.ts) so the policy gate, CV-06 metrics, and fingerprint dedup apply to every write.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        const prop = node.callee.property;
        const methodName =
          prop.type === "Identifier"
            ? prop.name
            : prop.type === "Literal"
              ? prop.value
              : null;
        if (!WRITE_METHODS.has(methodName)) return;
        const firstArg = node.arguments[0];
        if (!firstArg) return;
        if (firstArg.type === "Identifier" && firstArg.name === "strategyMemory") {
          context.report({
            node,
            messageId: "directWrite",
            data: { method: methodName },
          });
        }
      },
    };
  },
};
