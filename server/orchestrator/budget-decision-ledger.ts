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

/**
 * Task #70 / Phase 7 — authoritative resolver for the current budget action.
 *
 * Replaces direct reads of `budgetResult.output.decision.action` (the
 * mutable back-compat mirror) with a single ledger-aware resolver. When
 * the orchestrator stamped a `_ledgerEntry` onto the budget output, the
 * ledger entry's `finalAction` is the canonical resolved action (it is
 * the value the system-control downgrade branch authoritatively
 * recorded). When no ledger entry was stamped, the budget governor's
 * emitted action is the source of truth.
 *
 * Callers MUST use this resolver instead of reading the mirror field
 * directly — that's how the B1 silent-collision protection (the whole
 * point of the ledger) actually takes effect downstream.
 */
export interface BudgetOutputView {
  decision?: { action?: string; [k: string]: any } | null;
  _ledgerEntry?: BudgetDecisionLedgerEntry | null;
  [k: string]: any;
}
export function resolveBudgetActionFromLedger(
  budgetOutput: BudgetOutputView | null | undefined,
): { action: BudgetAction | null; source: "ledger_entry" | "budget_governor_emit" | "absent" } {
  if (!budgetOutput) return { action: null, source: "absent" };
  const stamped = budgetOutput._ledgerEntry;
  if (stamped && isBudgetAction(stamped.finalAction)) {
    return { action: stamped.finalAction, source: "ledger_entry" };
  }
  const raw = budgetOutput.decision?.action;
  if (typeof raw === "string" && isBudgetAction(raw)) {
    return { action: raw, source: "budget_governor_emit" };
  }
  return { action: null, source: "absent" };
}
export type BudgetDowngradeSource = "system_control" | "system_control_repair";

/**
 * Task #70 / Phase 7 — three-writer ledger layout.
 *
 * Pre-Task-#70 the orchestrator's system-control downgrade branch and
 * plan-synthesis halt branch both touched the budget decision shape
 * without a discriminator. A "system-control downgraded test→hold" and
 * a "plan-synthesis forced halt because budget_governor itself said halt"
 * collided silently — readers could not tell which writer last touched
 * the action field (the B1 silent collision).
 *
 * `BudgetDecisionLedgerWriter` distinguishes the three legitimate writers.
 * `BudgetDecisionLedger` is the structured ledger view exposed on the run
 * result — `original` is always the budget governor's emit, and the two
 * override slots are independently observable.
 */
export type BudgetDecisionLedgerWriter =
  | "budget_governor"
  | "system_control_downgrade"
  | "synthesis_halt_override";

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
  /** Writer that authored this entry (Task #70 / Phase 7). */
  writer: BudgetDecisionLedgerWriter;
}

/**
 * Three-slot ledger view (Task #70 / Phase 7).
 *
 * Each slot is independently nullable — the run result carries the
 * structured surface so auditors can ask "what did budget governor say?"
 * vs "did system-control override it?" vs "did plan-synthesis force a
 * halt?" without parsing free-text reasons.
 */
export interface BudgetDecisionLedger {
  /** Always present once budget governor has emitted — the as-decided budget action. */
  original: { action: BudgetAction; jobId: string; decidedAt: number } | null;
  /** Populated when system-control's verdict downgraded the action. */
  systemControlDowngrade: BudgetDecisionLedgerEntry | null;
  /** Populated when plan-synthesis forced a halt plan, overriding whatever budget said. */
  synthesisHaltOverride: SynthesisHaltOverrideEntry | null;
}

export interface SynthesisHaltOverrideEntry {
  eventId: string;
  jobId: string;
  decidedAt: number;
  /** Budget action seen by plan-synthesis (post any system_control downgrade). */
  observedAction: BudgetAction;
  /** Final action enforced by synthesis (always "halt" today; widen if needed). */
  enforcedAction: "halt";
  /** Free-text reason emitted by plan-synthesis (e.g. "budgetKillFlag=true"). */
  reason: string;
  writer: "synthesis_halt_override";
}

export interface SynthesisHaltOverrideInput {
  jobId: string;
  observedAction: BudgetAction;
  reason: string;
  now?: number;
}

/**
 * Pure recorder for the third writer (plan-synthesis halt branch).
 * Mirrors the contract of `computeBudgetDecisionLedgerEntry`: no
 * mutation, fails loud on bad input.
 */
export function recordSynthesisHaltOverride(
  input: SynthesisHaltOverrideInput,
): SynthesisHaltOverrideEntry {
  if (!isBudgetAction(input.observedAction)) {
    throw new InvalidBudgetDowngradeError(input.observedAction);
  }
  const now = input.now ?? Date.now();
  return {
    eventId: `bsh_${now}_${Math.random().toString(36).slice(2, 8)}`,
    jobId: input.jobId,
    decidedAt: now,
    observedAction: input.observedAction,
    enforcedAction: "halt",
    reason: input.reason,
    writer: "synthesis_halt_override",
  };
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
    writer: "system_control_downgrade",
  };
}
