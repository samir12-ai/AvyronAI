/**
 * Task #93 / Phase 4-E — Divergence-to-module path attribution.
 *
 * Best-effort mapping of a divergence path (e.g. "plan.systemControl.verdict")
 * to a module id ("system-control"). Used only for METRIC LABELS and DB
 * provenance — no longer used for auto-revert (which was removed along
 * with the cutover system).
 *
 * Extracted from the deleted `auto-revert.ts` so the parity job + DB
 * provenance writer still have a single attribution function.
 */
export interface ModuleAttribution {
  moduleId: string;
  /** Legacy module-flag tag (informational only — flags no longer exist). */
  moduleFlag: string;
}

const PATH_PREFIX_RULES: Array<{ prefix: string; attr: ModuleAttribution }> = [
  { prefix: "plan.systemControl", attr: { moduleId: "system-control", moduleFlag: "SYS_CONTROL" } },
  { prefix: "plan.priorityMatrix", attr: { moduleId: "priority-matrix", moduleFlag: "PRIORITY_MATRIX" } },
  { prefix: "plan.synthesis", attr: { moduleId: "plan-synthesis", moduleFlag: "PLAN_SYNTHESIS" } },
  { prefix: "plan.budget", attr: { moduleId: "budget-decision-ledger", moduleFlag: "BUDGET_LEDGER" } },
  { prefix: "plan.context", attr: { moduleId: "ctx-resolve", moduleFlag: "CTX_RESOLVE" } },
];

export function attributeDivergenceToModule(path: string): ModuleAttribution | null {
  for (const rule of PATH_PREFIX_RULES) {
    if (path === rule.prefix || path.startsWith(`${rule.prefix}.`)) {
      return rule.attr;
    }
  }
  return null;
}
