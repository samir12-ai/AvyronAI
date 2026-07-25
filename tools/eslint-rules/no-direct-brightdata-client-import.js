/**
 * Custom ESLint rule: no-direct-brightdata-client-import
 *
 * Forbids importing `brightdata-client` (the Bright Data Unlocker API
 * transport module) anywhere except the proxy-pool-manager. The pool manager
 * is the single choke point that wires every scrape request through:
 *   - rate-limiter token acquisition (call-site responsibility, preserved)
 *   - session/quarantine bookkeeping + block classification
 *   - SCRAPING_UNCONFIGURED fail-fast
 *
 * A scraper importing the client directly would bypass all of that — the
 * exact drift this rebuild (2026-07) is designed to prevent.
 *
 * Scope + allowlist are defined in eslint.config.js:
 *   files:   server/**\/*.ts
 *   ignores: server/competitive-intelligence/proxy-pool-manager.ts,
 *            server/competitive-intelligence/brightdata-client.ts (self),
 *            server/tests/**
 */

"use strict";

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct imports of brightdata-client outside proxy-pool-manager — all scrape transport must go through the pool manager.",
      recommended: false,
    },
    schema: [],
    messages: {
      directClientImport:
        "Direct import of brightdata-client is forbidden. All scrape transport MUST go through proxy-pool-manager " +
        "(`poolFetch` / `ctx.poolFetch`) so rate limiting, quarantine, block classification, and the " +
        "SCRAPING_UNCONFIGURED fail-fast contract are enforced on every request.",
    },
  },

  create(context) {
    function checkSource(node, sourceValue) {
      if (typeof sourceValue !== "string") return;
      if (/(^|\/)brightdata-client(\.ts|\.js)?$/.test(sourceValue)) {
        context.report({ node, messageId: "directClientImport" });
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node, node.source && node.source.value);
      },
      ImportExpression(node) {
        if (node.source && node.source.type === "Literal") {
          checkSource(node, node.source.value);
        }
      },
      CallExpression(node) {
        // require("...brightdata-client")
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
