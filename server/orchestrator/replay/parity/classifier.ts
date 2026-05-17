/**
 * Task #91 / Phase 4-C — Divergence → Action classifier.
 *
 * Pure function. Given the divergences produced by `classifyReplay()` and
 * a routing table loaded from `divergence_class_routes`, produces the
 * `routedAction` + the resulting `outcome` for the replay run.
 *
 * Routing precedence: BLOCK > WARN > INFO > NOISE. A single BLOCK
 * divergence escalates the entire run to BLOCK regardless of how many
 * NOISE-class divergences accompany it.
 *
 * D5: missing routing entry → throws CONTRACT_INCOMPLETE. NEVER silently
 * substitutes an "UNKNOWN" action.
 */
import type { Divergence, DivergenceClass } from "../types";
import type {
  DivergenceRoutingTable,
  ParityRunOutcome,
  RoutedAction,
} from "./types";

const ACTION_PRIORITY: Record<RoutedAction, number> = {
  NOISE: 0,
  INFO: 1,
  WARN: 2,
  BLOCK: 3,
};

const CLASS_PRIORITY: Record<DivergenceClass, number> = {
  TIMING_ONLY: 0,
  PROVENANCE: 1,
  ORDER: 2,
  BUDGET_LEDGER: 3,
  DEGRADATION_SURFACE: 4,
  STRUCTURAL: 5,
  CANONICAL_FIELD: 6,
};

export interface ClassifierResult {
  outcome: ParityRunOutcome;
  routedAction: RoutedAction | "NONE";
  highestClass: DivergenceClass | null;
  perDivergenceActions: Array<{ divergence: Divergence; action: RoutedAction }>;
}

export class RoutingTableIncompleteError extends Error {
  constructor(public readonly missingClass: DivergenceClass) {
    super(`CONTRACT_INCOMPLETE: divergence_class_routes missing entry for class=${missingClass}`);
  }
}

/**
 * Pure routing. Takes the divergences emitted by `classifyReplay()` and
 * resolves the run's outcome + the highest-priority class observed.
 */
export function classifyDivergences(
  divergences: Divergence[],
  routes: DivergenceRoutingTable,
): ClassifierResult {
  if (divergences.length === 0) {
    return {
      outcome: "PASS",
      routedAction: "NONE",
      highestClass: null,
      perDivergenceActions: [],
    };
  }

  let highestActionPriority = -1;
  let highestAction: RoutedAction = "NOISE";
  let highestClass: DivergenceClass | null = null;
  let highestClassPriority = -1;
  const perDivergenceActions: Array<{ divergence: Divergence; action: RoutedAction }> = [];

  for (const d of divergences) {
    const action = routes[d.class];
    if (!action) throw new RoutingTableIncompleteError(d.class);
    perDivergenceActions.push({ divergence: d, action });
    const ap = ACTION_PRIORITY[action];
    if (ap > highestActionPriority) {
      highestActionPriority = ap;
      highestAction = action;
    }
    const cp = CLASS_PRIORITY[d.class];
    if (cp > highestClassPriority) {
      highestClassPriority = cp;
      highestClass = d.class;
    }
  }

  // Map RoutedAction → ParityRunOutcome. The two enums share names for
  // NOISE/INFO/WARN/BLOCK; PASS is the no-divergence shortcut above and
  // HARNESS_ERROR is only emitted by the caller when the player throws.
  const outcome: ParityRunOutcome = highestAction; // typed by union overlap
  return { outcome, routedAction: highestAction, highestClass, perDivergenceActions };
}
