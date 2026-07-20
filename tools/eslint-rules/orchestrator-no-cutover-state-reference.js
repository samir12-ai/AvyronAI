/**
 * Custom ESLint rule: orchestrator-no-cutover-state-reference
 *
 * Task #93 / Phase 4-E — cutover deletion guard.
 *
 * The controlled-runtime-cutover system (Phase 4-D: admin routes, state
 * singleton, dispatch, auto-revert) was DELETED. The `cutover_state` table
 * was archived by migration 032 and MUST NOT be referenced by runtime
 * code again — a new reader/writer would resurrect the promotion state
 * machine that Phase 4-E removed.
 *
 * Bans in runtime .ts code:
 *   - string/template literals containing "cutover_state" (raw SQL)
 *   - identifiers `cutoverState` / `CutoverState` (Drizzle table object /
 *     type names)
 *   - import sources containing "cutover-state" / "cutover_state"
 *
 * Comments mentioning the deletion remain fine (AST rules never see
 * comments). Migration SQL files (.sql) are outside ESLint scope by
 * nature; migration .ts helpers are not exempted — archived means
 * archived.
 *
 * Scope is defined in eslint.config.js: files: server/**\/*.ts
 */

"use strict";

const TABLE_NAME = "cutover_state";
const BANNED_IDENTIFIERS = new Set(["cutoverState", "CutoverState"]);

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid references to the archived cutover_state table — the cutover system was deleted in Phase 4-E.",
      recommended: false,
    },
    schema: [],
    messages: {
      cutoverReference:
        "Reference to `{{what}}` is forbidden. The cutover system was deleted in Task #93 / Phase 4-E and the " +
        "cutover_state table archived by migration 032. Do not resurrect promotion state.",
    },
  },

  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string" && node.value.includes(TABLE_NAME)) {
          context.report({ node, messageId: "cutoverReference", data: { what: TABLE_NAME } });
        }
      },
      TemplateElement(node) {
        const raw = node.value && node.value.raw;
        if (typeof raw === "string" && raw.includes(TABLE_NAME)) {
          context.report({ node, messageId: "cutoverReference", data: { what: TABLE_NAME } });
        }
      },
      Identifier(node) {
        if (BANNED_IDENTIFIERS.has(node.name)) {
          context.report({ node, messageId: "cutoverReference", data: { what: node.name } });
        }
      },
      ImportDeclaration(node) {
        const src = node.source && node.source.value;
        if (
          typeof src === "string" &&
          (src.includes("cutover-state") || src.includes(TABLE_NAME))
        ) {
          context.report({ node, messageId: "cutoverReference", data: { what: src } });
        }
      },
    };
  },
};
