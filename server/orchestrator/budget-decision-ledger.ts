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
export type GovernanceState = "CLEAR" | "REVIEW_REQUIRED" | "RESTRICTED" | "BLOCKED";
export type BudgetConfirmation = "user_confirmed" | "unconfirmed" | "missing";

export interface GovernedBudgetState {
  spendAction: BudgetAction;                 // halt|hold|test|scale — the SPENDING action only
  action?: BudgetAction;                     // alias for spendAction
  executionMode: "recommendation_only" | "execution";
  governanceState: GovernanceState;          // review/approval status — separate from spendAction
  reasons: Array<{ code: string; detail: string }>;
  reasoning?: string;                        // convenient summary of reasons
  source: "ledger" | "budget_governor_emit" | "governance_failure";
  budgetConfirmation: BudgetConfirmation;
  verdictId: string | null;                  // system_control_verdicts.id when known
  totalMonthlyBudget?: number | null;
  currency?: string;
}

export const SYSTEM_CONTROL_TARGET_MAP: Record<string, { spendAction: BudgetAction; governanceState: GovernanceState }> = {
  halt: { spendAction: "halt", governanceState: "BLOCKED" },
  hold: { spendAction: "hold", governanceState: "RESTRICTED" },
  test: { spendAction: "test", governanceState: "CLEAR" },
  scale: { spendAction: "scale", governanceState: "CLEAR" },
  review_required: { spendAction: "hold", governanceState: "REVIEW_REQUIRED" },
  needs_reconciliation: { spendAction: "hold", governanceState: "REVIEW_REQUIRED" },
};

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
  /** Governance review/approval state after downgrade. */
  governanceState?: GovernanceState;
  /** System Control verdict ID if available. */
  verdictId?: string | null;
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
    super(`BudgetDecisionLedger: downgrade target "${invalidTo}" is not a valid System Control target (${Object.keys(SYSTEM_CONTROL_TARGET_MAP).join("|")})`);
    this.name = "InvalidBudgetDowngradeError";
  }
}

export interface BudgetDecisionLedgerInput {
  jobId: string;
  originalAction: BudgetAction;
  proposedDowngrades: Array<{ to: string; code: string }>;
  /** When the prior repair already attributed itself, the orchestrator should not overwrite. */
  alreadyAttributedTo?: BudgetDowngradeSource | null;
  verdictId?: string | null;
  now?: number;
}

const GOVERNANCE_SEVERITY: Record<GovernanceState, number> = {
  BLOCKED: 0,
  REVIEW_REQUIRED: 1,
  RESTRICTED: 2,
  CLEAR: 3,
};

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

  // Fail-closed validation: every proposed `to` MUST be a recognized System Control target.
  // An unknown value upstream is a contract violation (system-control emitted
  // an unrecognized downgrade target) and we refuse to silently coerce.
  for (const d of input.proposedDowngrades) {
    if (!SYSTEM_CONTROL_TARGET_MAP[d.to]) {
      throw new InvalidBudgetDowngradeError(d.to);
    }
  }
  if (!isBudgetAction(input.originalAction)) {
    throw new InvalidBudgetDowngradeError(input.originalAction);
  }

  // Map each target to its structured spendAction and governanceState
  const mappedTargets = input.proposedDowngrades.map(d => SYSTEM_CONTROL_TARGET_MAP[d.to]);

  const targetSpendAction = mappedTargets.reduce<BudgetAction>(
    (most, candidate) =>
      DOWNGRADE_SEVERITY[candidate.spendAction] < DOWNGRADE_SEVERITY[most] ? candidate.spendAction : most,
    mappedTargets[0].spendAction,
  );

  const targetGovernanceState = mappedTargets.reduce<GovernanceState>(
    (most, candidate) =>
      GOVERNANCE_SEVERITY[candidate.governanceState] < GOVERNANCE_SEVERITY[most] ? candidate.governanceState : most,
    mappedTargets[0].governanceState,
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
    finalAction: actionMutated ? targetSpendAction : input.originalAction,
    governanceState: targetGovernanceState,
    verdictId: input.verdictId ?? null,
    downgradeSource,
    downgradeReasons,
    actionMutated,
    writer: "system_control_downgrade",
  };
}

/**
 * Authoritative resolver for the governed budget state.
 *
 * Separates SPENDING action (spendAction: halt|hold|test|scale) from
 * GOVERNANCE review status (governanceState: CLEAR|REVIEW_REQUIRED|RESTRICTED|BLOCKED).
 */
export function resolveGovernedBudgetState(budgetGovernorOutput: any): GovernedBudgetState {
  if (!budgetGovernorOutput) {
    return {
      spendAction: "hold",
      executionMode: "recommendation_only",
      governanceState: "BLOCKED",
      reasons: [{ code: "OUTPUT_MISSING", detail: "Budget governor output is missing or null." }],
      source: "governance_failure",
      budgetConfirmation: "missing",
      verdictId: null,
    };
  }

  // 1. Governance failure (e.g. System Control decision could not be persisted/stamped)
  if (budgetGovernorOutput._governanceFailure) {
    return {
      spendAction: "hold",
      executionMode: "recommendation_only",
      governanceState: "BLOCKED",
      reasons: [{ code: "GOVERNANCE_FAILURE", detail: "System Control decision could not be persisted or stamped onto budget state." }],
      source: "governance_failure",
      budgetConfirmation: budgetGovernorOutput.budgetConfirmation || "unconfirmed",
      verdictId: budgetGovernorOutput.verdictId || null,
    };
  }

  const budgetConfirmation: BudgetConfirmation =
    budgetGovernorOutput.budgetConfirmation === "user_confirmed"
      ? "user_confirmed"
      : (budgetGovernorOutput.totalMonthlyBudget === null || budgetGovernorOutput.totalMonthlyBudget === undefined)
        ? "missing"
        : "unconfirmed";

  const verdictId = budgetGovernorOutput._ledgerEntry?.verdictId || budgetGovernorOutput.verdictId || null;
  const totalMonthlyBudget = budgetGovernorOutput.totalMonthlyBudget ?? null;
  const currency = budgetGovernorOutput.currency || "USD";

  // 2. Authoritative ledger entry from System Control downgrade
  const ledger = budgetGovernorOutput._ledgerEntry as BudgetDecisionLedgerEntry | undefined;
  if (ledger && isBudgetAction(ledger.finalAction)) {
    const govState: GovernanceState = ledger.governanceState
      || (ledger.finalAction === "halt" ? "BLOCKED" : ledger.finalAction === "hold" ? "REVIEW_REQUIRED" : "CLEAR");
    const reasons = (ledger.downgradeReasons || []).map((code: string) => ({
      code,
      detail: `Downgraded by ${ledger.downgradeSource}: ${code}`,
    }));

    return {
      spendAction: ledger.finalAction,
      action: ledger.finalAction,
      executionMode: budgetGovernorOutput.executionMode || (budgetGovernorOutput.decision?.executionMode) || "recommendation_only",
      governanceState: govState,
      reasons,
      reasoning: reasons.map(r => r.detail).join("; "),
      source: "ledger",
      budgetConfirmation,
      verdictId,
      totalMonthlyBudget,
      currency,
    };
  }

  // 3. Emitted action from Budget Governor
  const rawAction = budgetGovernorOutput.decision?.action;
  const isExecutionMode = budgetGovernorOutput.executionMode === "execution" || budgetGovernorOutput.mode === "execution";

  // Recommendation-only mode: spendAction is always "hold" with honest reasoning, not synthetic "test"
  if (!isExecutionMode) {
    const reasons = [{
      code: "RECOMMENDATION_ONLY",
      detail: budgetGovernorOutput.decision?.reasoning || "Recommendation-only mode: no live spend authorized without user confirmation and execution approval.",
    }];
    const governanceState: GovernanceState = budgetConfirmation === "user_confirmed" ? "CLEAR" : "REVIEW_REQUIRED";

    return {
      spendAction: "hold",
      action: "hold",
      executionMode: "recommendation_only",
      governanceState,
      reasons,
      reasoning: reasons.map(r => r.detail).join("; "),
      source: "budget_governor_emit",
      budgetConfirmation,
      verdictId,
      totalMonthlyBudget,
      currency,
    };
  }

  // Execution mode with valid budget action
  if (typeof rawAction === "string" && isBudgetAction(rawAction)) {
    const reasons: Array<{ code: string; detail: string }> = [];
    let govState: GovernanceState = "CLEAR";
    if (budgetConfirmation !== "user_confirmed") {
      govState = "REVIEW_REQUIRED";
      reasons.push({ code: "BUDGET_UNCONFIRMED", detail: "Budget amount has not been confirmed by the user." });
    }
    if (rawAction === "halt") govState = "BLOCKED";
    else if (rawAction === "hold" && govState !== "BLOCKED") govState = "RESTRICTED";

    return {
      spendAction: rawAction,
      action: rawAction,
      executionMode: "execution",
      governanceState: govState,
      reasons,
      reasoning: reasons.map(r => r.detail).join("; ") || (budgetGovernorOutput.decision?.reasoning ?? ""),
      source: "budget_governor_emit",
      budgetConfirmation,
      verdictId,
      totalMonthlyBudget,
      currency,
    };
  }

  // Fallback if action is unknown or invalid
  const fallbackReasons = [{ code: "INVALID_ACTION", detail: `Unrecognized budget action "${rawAction}".` }];
  return {
    spendAction: "hold",
    action: "hold",
    executionMode: "recommendation_only",
    governanceState: "BLOCKED",
    reasons: fallbackReasons,
    reasoning: fallbackReasons.map(r => r.detail).join("; "),
    source: "governance_failure",
    budgetConfirmation,
    verdictId,
    totalMonthlyBudget,
    currency,
  };
}
