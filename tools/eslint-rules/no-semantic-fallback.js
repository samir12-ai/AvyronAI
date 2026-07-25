/**
 * Custom ESLint rule: no-semantic-fallback (H6 + H8, May 2026)
 *
 * Forbids semantic-fallback patterns on live decision/reporting code paths:
 *
 *   1. Logical fallback (?? / ||) where EITHER side reads a forbidden
 *      verdict-shape field name (`status`, `verdict`, `outcome`):
 *        ✗ x ?? alt              ← H6 baseline (RHS identifier)
 *        ✗ x?.outcome ?? alt     ← H8 (LHS member read — the offender is on
 *                                  the LEFT, returning the generic field's
 *                                  value when present)
 *        ✗ alt ?? x?.outcome     ← H6 baseline (RHS member read)
 *        ✗ x?.status || y        ← H8 (LHS member read)
 *
 *   2. Conditional expression (ternary) where EITHER branch is a forbidden
 *      verdict-shape field read:
 *        ✗ cond ? x?.outcome : alt
 *        ✗ cond ? alt : x?.outcome
 *
 * These are forbidden by the Semantic Contract Hardening doctrine (D1):
 * substituting one field's meaning for another (or reading a generic field
 * name as a stand-in for the canonical contract field) breaks contract
 * enforcement.
 *
 * Use `// eslint-disable-next-line semantic/no-semantic-fallback` with a
 * justification comment for the rare legitimate cases — typically a content
 * field (e.g. calendar entry workflow status, lead pipeline status, AI judge
 * accept/reject) that happens to be named status/verdict/outcome but is NOT
 * the canonical contract field for any verdict-shape semantic.
 *
 * Wired in eslint.config.js, scoped to live decision-bearing dirs (H8 widened
 * scope — see config for the full glob list).
 */
"use strict";

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid semantic fallback on live decision paths — `??`/`||` chains and ternaries that read or substitute `status`/`verdict`/`outcome`",
      recommended: false,
    },
    schema: [],
    messages: {
      semanticFallbackRhs:
        "Semantic fallback to '{{name}}' on RHS of '{{op}}' is forbidden (Doctrine D1). " +
        "Read the canonical contract field via requireContractField() instead. " +
        "If '{{name}}' is genuinely a content field with the same meaning as the LHS, " +
        "add // eslint-disable-next-line semantic/no-semantic-fallback with a justification.",
      semanticFallbackLhs:
        "Semantic-field read of '{{name}}' on LHS of '{{op}}' is forbidden (Doctrine D1, H8). " +
        "Reading '{{name}}' as a primary value with a fallback alternative substitutes a " +
        "generic field name for the canonical contract field. Use requireContractField() " +
        "or add // eslint-disable-next-line semantic/no-semantic-fallback with a justification.",
      semanticFallbackTernary:
        "Semantic-field read of '{{name}}' in ternary '{{branch}}' branch is forbidden (Doctrine D1, H8). " +
        "Conditional fallback to a generic '{{name}}' field is the same anti-pattern as `?? {{name}}`. " +
        "Use requireContractField() or add // eslint-disable-next-line semantic/no-semantic-fallback with a justification.",
      semanticFallbackAlias:
        "Variable named '{{name}}' assigned via a logical-fallback expression is forbidden (Doctrine D1, Seal #9 / F10.3). " +
        "Aliasing a verdict-shape value through `const {{name}} = a || b` reproduces the no-semantic-fallback anti-pattern at the assignment site — declare a typed read via requireContractField() or rename the local so it is not a verdict-shape identifier.",
      semanticFallbackDestructured:
        "Destructured property '{{name}}' with a default of a verdict-shape value is forbidden (Doctrine D1, Seal #9 / F10.3). " +
        "`const { {{name}} = ... } = obj` silently substitutes a fabricated value when the canonical field is missing. Use requireContractField() to surface CONTRACT_INCOMPLETE explicitly.",
    },
  },

  create(context) {
    const FORBIDDEN = new Set(["status", "verdict", "outcome"]);

    /**
     * Seal #9 (F10.3 — pass-4 final, architect-required broadening): un-
     * anchored alias-detector vocabulary.
     *
     * The audit acceptance criterion for F10.3 is that the alias and
     * destructured detectors flag ANY local identifier containing a
     * verdict-shape token (`status|verdict|outcome|state|action`,
     * case-insensitive) — NOT just suffix matches. This closes the
     * "rename to evade" loophole where `const statusLabel = a || b` or
     * `const actionValue = a ?? b` would silently substitute a generic
     * canonical-field read. The pass-3 suffix-anchored regex was a false
     * negative for these mid/prefix-token names.
     *
     * Engine-internal authoring sites that emit these as the FIRST
     * canonical write of the value are NOT D1 substitutions and are
     * exempted at the call-site via documented
     * `// eslint-disable-next-line semantic/no-semantic-fallback`
     * comments — same pattern as the pass-2 F1 status-authoring
     * exemptions in iteration-engine and retention-engine.
     */
    const FORBIDDEN_ALIAS_RE =
      /(status|verdict|outcome|state|action)/i;

    /**
     * Returns the forbidden field name read by `node`, or `null`.
     * Recognises:
     *   - bare Identifier:       `outcome`
     *   - member access:         `x.outcome`
     *   - optional chain:        `x?.outcome`  (parsed as ChainExpression > MemberExpression)
     *   - chained member access: `x.y.outcome` (only the final property name is checked)
     */
    function readForbiddenName(node) {
      if (!node) return null;
      if (node.type === "Identifier" && FORBIDDEN.has(node.name)) {
        return node.name;
      }
      if (
        node.type === "MemberExpression" &&
        !node.computed &&
        node.property &&
        node.property.type === "Identifier" &&
        FORBIDDEN.has(node.property.name)
      ) {
        return node.property.name;
      }
      if (
        node.type === "ChainExpression" &&
        node.expression &&
        node.expression.type === "MemberExpression" &&
        !node.expression.computed &&
        node.expression.property &&
        node.expression.property.type === "Identifier" &&
        FORBIDDEN.has(node.expression.property.name)
      ) {
        return node.expression.property.name;
      }
      return null;
    }

    function checkLogical(node) {
      if (node.operator !== "||" && node.operator !== "??") return;
      const op = node.operator;
      // RHS check (H6 baseline).
      const rhsName = readForbiddenName(node.right);
      if (rhsName) {
        context.report({
          node: node.right,
          messageId: "semanticFallbackRhs",
          data: { name: rhsName, op },
        });
      }
      // LHS check (H8 — covers `result?.outcome ?? alt` patterns).
      const lhsName = readForbiddenName(node.left);
      if (lhsName) {
        context.report({
          node: node.left,
          messageId: "semanticFallbackLhs",
          data: { name: lhsName, op },
        });
      }
    }

    function checkConditional(node) {
      // ConditionalExpression: cond ? consequent : alternate
      const consName = readForbiddenName(node.consequent);
      if (consName) {
        context.report({
          node: node.consequent,
          messageId: "semanticFallbackTernary",
          data: { name: consName, branch: "consequent" },
        });
      }
      const altName = readForbiddenName(node.alternate);
      if (altName) {
        context.report({
          node: node.alternate,
          messageId: "semanticFallbackTernary",
          data: { name: altName, branch: "alternate" },
        });
      }
    }

    /**
     * Seal #9 (F10.3) — alias-variable detector.
     * Flags `const status = a?.b || c` (and let/var) where the LHS local
     * identifier is a verdict-shape name AND the RHS is a logical-fallback
     * expression. This is the same anti-pattern as `?? status` but hidden
     * behind a rename. Example offender:
     *
     *   const status = engineResult?.status || "PENDING"; // ✗
     *
     * Correct form: `const status = readSectionStatus(engineResult);` or
     * `requireContractField(...)`.
     */
    function checkVariableDeclarator(node) {
      if (
        !node ||
        !node.id ||
        node.id.type !== "Identifier" ||
        !FORBIDDEN_ALIAS_RE.test(node.id.name)
      )
        return;
      const init = node.init;
      if (!init) return;
      // Direct logical fallback at the assignment.
      if (
        init.type === "LogicalExpression" &&
        (init.operator === "||" || init.operator === "??")
      ) {
        context.report({
          node,
          messageId: "semanticFallbackAlias",
          data: { name: node.id.name },
        });
        return;
      }
      // Conditional/ternary aliased to a verdict-shape value.
      if (init.type === "ConditionalExpression") {
        // Already handled by checkConditional for the per-branch reads;
        // we additionally flag when the alias name itself is verdict-shape
        // because that signals a covert verdict mutation site.
        context.report({
          node,
          messageId: "semanticFallbackAlias",
          data: { name: node.id.name },
        });
      }
    }

    /**
     * Seal #9 (F10.3) — destructured-default detector.
     * Flags `const { status = "PENDING" } = obj` (any default value) when
     * the destructured property name is a verdict-shape identifier — the
     * default silently substitutes a fabricated value when the canonical
     * field is missing.
     */
    function checkObjectPattern(node) {
      if (!node || !Array.isArray(node.properties)) return;
      for (const prop of node.properties) {
        if (
          prop.type !== "Property" ||
          !prop.value ||
          prop.value.type !== "AssignmentPattern"
        )
          continue;
        const left = prop.value.left;
        if (
          left &&
          left.type === "Identifier" &&
          FORBIDDEN_ALIAS_RE.test(left.name)
        ) {
          context.report({
            node: prop,
            messageId: "semanticFallbackDestructured",
            data: { name: left.name },
          });
        }
      }
    }

    return {
      LogicalExpression: checkLogical,
      ConditionalExpression: checkConditional,
      VariableDeclarator: checkVariableDeclarator,
      ObjectPattern: checkObjectPattern,
    };
  },
};
