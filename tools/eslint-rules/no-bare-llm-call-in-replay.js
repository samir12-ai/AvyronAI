/**
 * Custom ESLint rule: no-bare-llm-call-in-replay
 *
 * Forbids direct imports of `aiChat`, `aiGemini`, `getOpenAI`, `getGemini`
 * from `server/ai-client.ts` inside directories that MUST route all LLM
 * calls through `withReplayRecorder` (and through the ai-client.ts wrappers
 * that auto-record into the active recorder scope).
 *
 * Scope (defined in eslint.config.js):
 *   - server/orchestrator/replay/**  (Phase 4-A replay harness)
 *   - server/commercial-reasoning/** (Phase 4-A commercial reasoning core)
 *
 * Background:
 *   - eslint.config.js has referenced this rule since P4-A replay landed,
 *     but the rule file itself was missing on disk — a pre-existing config
 *     drift closed by Phase 4-A commercial-reasoning rollout. See
 *     `.local/plans/phase-4-commercial-reasoning-core.md` §4 note 8.
 *
 * Allowed pattern (replay-safe):
 *
 *     import { aiChat } from "../../ai-client";
 *     ^^^ FORBIDDEN inside scoped dirs.
 *
 *     // Replay-safe equivalent: call through the wrapper that funnels
 *     // every LLM call into `getCurrentRecorder()?.recordLlmCall(...)`.
 *     import { callWithRecorder } from "../commercial-reasoning/llm-call";
 *
 * Suppression:
 *   - Use `// eslint-disable-next-line orchestrator-replay/no-bare-llm-call-in-replay`
 *     ONLY when the file IS the recorder boundary itself (e.g. the LLM
 *     wrapper module that performs the bare import in order to RE-export
 *     the recorder-wrapped version).
 */

"use strict";

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid direct imports of ai-client.ts LLM entry points in replay-scoped directories — all LLM calls must route through the recorder boundary.",
      recommended: false,
    },
    schema: [],
    messages: {
      bareLlmImport:
        "Bare import of '{{name}}' from ai-client is forbidden inside replay-scoped directories. " +
        "All LLM calls in this scope MUST route through `withReplayRecorder` so cassettes capture them. " +
        "Use the local LLM wrapper (e.g. `commercial-reasoning/llm-call.ts`) that re-exports the recorder-aware version. " +
        "If this file IS the recorder boundary itself, add `// eslint-disable-next-line orchestrator-replay/no-bare-llm-call-in-replay` with a justification.",
    },
  },

  create(context) {
    const FORBIDDEN_NAMES = new Set([
      "aiChat",
      "aiGemini",
      "getOpenAI",
      "getGemini",
    ]);

    /**
     * Match imports whose source ends with `ai-client` or `ai-client.ts`.
     * We do not match by absolute path because relative-depth varies per
     * file inside the scoped directories.
     */
    function isAiClientSource(source) {
      if (typeof source !== "string") return false;
      return /(^|\/)ai-client(\.ts)?$/.test(source);
    }

    return {
      ImportDeclaration(node) {
        if (!isAiClientSource(node.source && node.source.value)) return;
        for (const spec of node.specifiers || []) {
          // ImportSpecifier covers named imports: import { aiChat } from ...
          if (spec.type === "ImportSpecifier" && spec.imported && FORBIDDEN_NAMES.has(spec.imported.name)) {
            context.report({
              node: spec,
              messageId: "bareLlmImport",
              data: { name: spec.imported.name },
            });
          }
          // ImportDefaultSpecifier: import aiChat from ...  (unlikely but
          // be defensive in case someone re-exports as default).
          if (spec.type === "ImportDefaultSpecifier" && spec.local && FORBIDDEN_NAMES.has(spec.local.name)) {
            context.report({
              node: spec,
              messageId: "bareLlmImport",
              data: { name: spec.local.name },
            });
          }
        }
      },
      // Cover dynamic import + require for completeness.
      CallExpression(node) {
        const isRequire =
          node.callee && node.callee.type === "Identifier" && node.callee.name === "require";
        const isImport = node.callee && node.callee.type === "Import";
        if (!isRequire && !isImport) return;
        const arg = node.arguments && node.arguments[0];
        if (!arg || arg.type !== "Literal" || !isAiClientSource(arg.value)) return;
        context.report({
          node,
          messageId: "bareLlmImport",
          data: { name: isRequire ? "require(ai-client)" : "import(ai-client)" },
        });
      },
    };
  },
};
