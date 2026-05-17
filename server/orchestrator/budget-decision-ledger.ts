/**
 * Budget Decision Ledger — Task #67 / T-S5-C9.
 *
 * Before this module existed, the orchestrator's system-control downgrade
 * branch mutated `budgetResult.output.decision.{action,originalAction,
 * downgradedBy,downgradeReasons}` in place. The mutation was the ONLY record
 * of "system control adjusted the budget action"; auditors had no separate
 * decision row to query, and a second pass (e.g. a different repair action,
 * or a future re-evaluation) would have overwritten the originalAction field
 * silently.
 *
 * This module builds a pure, append-only ledger entry from the inputs of a
 * single downgrade event. The orchestrator still writes the back-compat
 * fields onto `budgetResult.output.decision` so existing readers
 * (`repair-actions.ts`, `system-control-proof.ts`, plan-synthesis budget
 * inspection) keep working — but the ledger entry is the canonical record
 * surfaced on `OrchestratorRunResult.budgetDecisionLedger` for auditors.
 *
 * Doctrine alignment:
 *   - D2: each piece of meaning has its own field (action, originalAction,
 *         downgradeSource, downgradeReasons live on the ledger entry, not on
 *         a generic "decision" blob).
 *   - D4: legacy in-place fields remain for display/back-compat but the
 *         ledger is the source of truth for verdict logic.
 */

export type BudgetAction = "halt" | "hold" | "test" | "scale";
export type BudgetDowngradeSource = "system_control" | "system_control_repair";

export interface BudgetDecisionLedgerEntry {
  /** Stable per-event id so auditors can correlate logs to ledger rows. */
  eventId: string;
  /** Pipeline jobId the downgrade was attributed to. */
  jobId: string;
  /** Wall-clock timestamp the downgrade was decided (epoch ms). */
  decidedAt: number;
  /** Budget action emitted by the budget governor engine. */
  originalAction: BudgetAction;
  /** Budget action after downgrade. */
  finalAction: BudgetAction;
  /** Which layer drove the downgrade. */
  downgradeSource: BudgetDowngradeSource;
  /** Structured codes from `controlVerdict.downgrades`. */
  downgradeReasons: string[];
  /** Whether the action was actually mutated (false = idempotent no-op). */
  actionMutated: boolean;
}

const DOWNGRADE_SEVERITY: Record<BudgetAction, number> = {
  halt: -1,
  hold: 0,
  test: 1,
  scale: 2,
};

const VALID_BUDGET_ACTIONS: ReadonlySet<string> = new Set<BudgetAction>([
  "halt",
  "hold",
  "test",
  "scale",
]);

function isBudgetAction(value: string): value is BudgetAction {
  return VALID_BUDGET_ACTIONS.has(value);
}

/**
 * Doctrine-aligned (D3): the system-control downgrade enum is strict. An
 * unknown `to` value is a contract violation upstream and must fail loud
 * here — never be silently coerced or skipped.
 */
export class InvalidBudgetDowngradeError extends Error {
  constructor(public readonly invalidTo: string) {
    super(`BudgetDecisionLedger: downgrade target "${invalidTo}" is not a valid BudgetAction (${Array.from(VALID_BUDGET_ACTIONS).join("|")})`);
    this.name = "InvalidBudgetDowngradeError";
  }
}

export interface BudgetDecisionLedgerInput {
  jobId: string;
  originalAction: BudgetAction;
  proposedDowngrades: Array<{ to: string; code: string }>;
  /** When the prior repair already attributed itself, the orchestrator should not overwrite. */
  alreadyAttributedTo?: BudgetDowngradeSource | null;
  now?: number;
}

/**
 * Pure computation of the downgrade ledger entry. NO mutation of inputs.
 *
 * Returns `null` when the downgrades list is empty (defensive — callers should
 * already gate on `controlVerdict.downgrades.length > 0`).
 */
export function computeBudgetDecisionLedgerEntry(
  input: BudgetDecisionLedgerInput,
): BudgetDecisionLedgerEntry | null {
  if (!input.proposedDowngrades || input.proposedDowngrades.length === 0) {
    return null;
  }

  // Fail-closed validation: every proposed `to` MUST be a valid BudgetAction.
  // An unknown value upstream is a contract violation (system-control emitted
  // a downgrade target outside the enum) and we refuse to silently coerce.
  for (const d of input.proposedDowngrades) {
    if (!isBudgetAction(d.to)) {
      throw new InvalidBudgetDowngradeError(d.to);
    }
  }
  if (!isBudgetAction(input.originalAction)) {
    throw new InvalidBudgetDowngradeError(input.originalAction);
  }

  // Pick the most severe (lowest-rank) downgrade target. After validation
  // above, every `d.to` is statically known to be a BudgetAction.
  const validatedTargets = input.proposedDowngrades.map(d => d.to as BudgetAction);
  const targetAction = validatedTargets.reduce<BudgetAction>(
    (most, candidate) =>
      DOWNGRADE_SEVERITY[candidate] < DOWNGRADE_SEVERITY[most] ? candidate : most,
    validatedTargets[0],
  );

  const downgradeReasons = input.proposedDowngrades.map(d => d.code);

  // When a repair action already attributed itself we must NOT overwrite
  // (idempotent no-op). The ledger still records the proposed downgrade so
  // auditors can see system-control would have applied it as well.
  const actionMutated = input.alreadyAttributedTo !== "system_control_repair";
  const downgradeSource: BudgetDowngradeSource =
    input.alreadyAttributedTo === "system_control_repair"
      ? "system_control_repair"
      : "system_control";

  const now = input.now ?? Date.now();
  const eventId = `bdl_${now}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    eventId,
    jobId: input.jobId,
    decidedAt: now,
    originalAction: input.originalAction,
    finalAction: actionMutated ? targetAction : input.originalAction,
    downgradeSource,
    downgradeReasons,
    actionMutated,
  };
}
