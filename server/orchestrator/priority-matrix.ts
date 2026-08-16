/**
 * Canonical engine priority + dependency matrix.
 *
 * Task #67 / T-S5-C2: the `dependencies` field declares which upstream
 * engine outputs each engine reads from `ctx`. The orchestrator's scoped
 * rerun branch uses this to fail-closed when a hydration source is missing
 * (e.g. positioning-only rerun where the cached MI/audience snapshots can
 * not be loaded). Pre-Task-#67, the orchestrator would silently run engines
 * on empty inputs and emit a "completed" plan with degraded confidence.
 *
 * `dependencies` lists DIRECT upstream context reads only — not the full
 * transitive closure. `validateScopedHydration()` walks the closure when
 * deciding whether a scoped rerun has the inputs it needs.
 */
// Task #70 / Phase 7 — Domain Composition Cleanup.
//   - integrity retiered MESSAGING → VALIDATION (it is a cross-engine
//     consistency verdict, not a messaging output).
//   - statistical_validation retiered FINANCIAL → VALIDATION (joins
//     integrity as the second VALIDATION-tier engine; budget_governor
//     consumes the merged validation verdict).
//   - channel_selection retiered CHANNEL → ALLOCATION (CHANNEL folded
//     into ALLOCATION — a single tier covering "where spend goes").
//   - iteration + retention retiered CREATIVE → OPTIMIZATION (CREATIVE
//     renamed — these engines optimize the live system, they do not
//     produce creative).
export const ENGINE_PRIORITY_ORDER = [
  { id: "market_intelligence", name: "Market Intelligence", priority: 1, tier: "MARKET_REALITY", dependencies: [] as readonly string[] },
  { id: "audience", name: "Audience Engine", priority: 2, tier: "MARKET_REALITY", dependencies: ["market_intelligence"] as readonly string[] },
  { id: "positioning", name: "Positioning Engine", priority: 3, tier: "POSITIONING", dependencies: ["market_intelligence", "audience"] as readonly string[] },
  { id: "differentiation", name: "Differentiation Engine", priority: 4, tier: "POSITIONING", dependencies: ["market_intelligence", "audience", "positioning"] as readonly string[] },
  { id: "mechanism", name: "Mechanism Engine", priority: 5, tier: "OFFER", dependencies: ["audience", "positioning", "differentiation"] as readonly string[] },
  { id: "offer", name: "Offer Engine", priority: 6, tier: "OFFER", dependencies: ["audience", "positioning", "mechanism"] as readonly string[] },
  { id: "awareness", name: "Awareness Engine", priority: 7, tier: "MESSAGING", dependencies: ["audience", "positioning", "offer"] as readonly string[] },
  { id: "funnel", name: "Funnel Engine", priority: 8, tier: "MESSAGING", dependencies: ["audience", "offer", "awareness"] as readonly string[] },
  { id: "persuasion", name: "Persuasion Engine", priority: 9, tier: "MESSAGING", dependencies: ["audience", "offer", "awareness", "funnel"] as readonly string[] },
  { id: "integrity", name: "Integrity Engine", priority: 10, tier: "VALIDATION", dependencies: ["positioning", "offer", "awareness", "funnel", "persuasion"] as readonly string[] },
  { id: "statistical_validation", name: "Statistical Validation", priority: 11, tier: "VALIDATION", dependencies: ["market_intelligence", "audience", "integrity"] as readonly string[] },
  { id: "budget_governor", name: "Budget Governor", priority: 12, tier: "FINANCIAL", dependencies: ["statistical_validation", "integrity"] as readonly string[] },
  { id: "channel_selection", name: "Channel Selection", priority: 13, tier: "ALLOCATION", dependencies: ["audience", "funnel", "budget_governor"] as readonly string[] },
  { id: "iteration", name: "Iteration Engine", priority: 14, tier: "OPTIMIZATION", dependencies: ["funnel", "persuasion", "budget_governor", "channel_selection"] as readonly string[] },
  { id: "retention", name: "Retention Engine", priority: 15, tier: "OPTIMIZATION", dependencies: ["audience", "offer", "funnel"] as readonly string[] },
] as const;

export type EngineId = typeof ENGINE_PRIORITY_ORDER[number]["id"];

export type PriorityTier =
  | "MARKET_REALITY"
  | "POSITIONING"
  | "OFFER"
  | "MESSAGING"
  | "VALIDATION"
  | "FINANCIAL"
  | "ALLOCATION"
  | "OPTIMIZATION";

const TIER_RANK: Record<PriorityTier, number> = {
  MARKET_REALITY: 1,
  POSITIONING: 2,
  OFFER: 3,
  MESSAGING: 4,
  VALIDATION: 5,
  FINANCIAL: 6,
  ALLOCATION: 7,
  OPTIMIZATION: 8,
};

// Task #70 / Phase 7 — CV-03 (tier-rank consistency check).
//
// Catches authoring drift at module-load time: every engine in
// ENGINE_PRIORITY_ORDER must carry a tier declared in TIER_RANK, every
// tier value used must be in the PriorityTier union, and the priority
// numbers must move monotonically through non-decreasing tier ranks
// (lower-tier engines never run after a higher-tier engine). A failure
// here is a build-time defect and aborts process boot rather than
// silently re-ordering the pipeline.
function assertTierRankConsistency(): void {
  let lastTierRank = 0;
  for (const eng of ENGINE_PRIORITY_ORDER) {
    const tier = eng.tier as PriorityTier;
    const rank = TIER_RANK[tier];
    if (rank === undefined) {
      throw new Error(
        `[priority-matrix] CV-03 tier-rank inconsistency: engine "${eng.id}" declares tier "${eng.tier}" which is not registered in TIER_RANK`,
      );
    }
    if (rank < lastTierRank) {
      throw new Error(
        `[priority-matrix] CV-03 tier-rank inconsistency: engine "${eng.id}" tier=${tier} (rank=${rank}) appears after a tier with rank=${lastTierRank} — priority order MUST flow non-decreasing through tier ranks`,
      );
    }
    lastTierRank = rank;
  }
}
assertTierRankConsistency();

export interface PriorityViolation {
  engine: string;
  tier: PriorityTier;
  violation: string;
  blockedBy: string;
  blockedByTier: PriorityTier;
}

export function checkPriorityViolation(
  currentEngine: EngineId,
  upstreamResults: Map<EngineId, EngineStepResult>
): PriorityViolation | null {
  const current = ENGINE_PRIORITY_ORDER.find(e => e.id === currentEngine);
  if (!current) return null;

  for (const [upstreamId, result] of upstreamResults) {
    const upstream = ENGINE_PRIORITY_ORDER.find(e => e.id === upstreamId);
    if (!upstream) continue;

    if (TIER_RANK[upstream.tier] < TIER_RANK[current.tier] && (result.status === "BLOCKED" || result.status === "ERROR")) {
      return {
        engine: current.name,
        tier: current.tier,
        violation: `Cannot proceed: higher-priority ${upstream.tier} layer has blocking result`,
        blockedBy: upstream.name,
        blockedByTier: upstream.tier,
      };
    }
  }

  return null;
}

export interface NeedsInputPayload {
  engine: EngineId;
  missingFields: string[];
  prefillableFields: Record<string, any>;
}

export interface EngineStepResult {
  engineId: EngineId;
  status: "SUCCESS" | "PARTIAL" | "BLOCKED" | "SKIPPED" | "SKIPPED_AWAITING_LIVE_DATA" | "ERROR" | "DEPTH_BLOCKED" | "SIGNAL_BLOCKED" | "NEEDS_INPUT" | "BLOCKED_BY_INTEGRITY" | "TIMEOUT" | "CONTRACT_INCOMPLETE";
  output: any;
  snapshotId?: string;
  durationMs: number;
  error?: string;
  blockReason?: string;
  needsInput?: NeedsInputPayload;
}

/**
 * Returns true if a failed engine result must halt downstream execution.
 *
 * PRE-LAUNCH HARDENING (G.3): The previous threshold (`<= OFFER`) let
 * MESSAGING-tier failures (Awareness, Funnel, Persuasion, Integrity) pass
 * through to FINANCIAL/CHANNEL, so spend and distribution decisions could
 * be made on top of a failed messaging strategy. We now block downstream on
 * ANY of these statuses regardless of tier — every engine produces input
 * for the next, so no failure can be "silently skipped".
 *
 * DEPTH_BLOCKED is also a blocking status: it indicates the CEL Depth Gate
 * rejected the output as ungrounded.
 */
export function shouldBlockDownstream(result: EngineStepResult): boolean {
  return (
    result.status === "BLOCKED" ||
    result.status === "ERROR" ||
    result.status === "TIMEOUT" ||
    result.status === "SIGNAL_BLOCKED" ||
    result.status === "DEPTH_BLOCKED" ||
    result.status === "BLOCKED_BY_INTEGRITY" ||
    result.status === "CONTRACT_INCOMPLETE"
  );
}

/**
 * Task #70 / Phase 7 — strict mode.
 *
 * Pre-Task-#70 this returned a "CREATIVE" sentinel for any unknown engine
 * id, which silently classified mistyped or removed engines into the
 * lowest-priority tier instead of surfacing the bug. We now fail-loud:
 * an unknown engineId is a contract violation and the caller's bug must
 * be visible at the call site, not laundered into a tier default.
 */
export function getEngineTier(engineId: EngineId): PriorityTier {
  const engine = ENGINE_PRIORITY_ORDER.find(e => e.id === engineId);
  if (!engine) {
    throw new Error(`[priority-matrix] getEngineTier: unknown engineId "${engineId}" — not registered in ENGINE_PRIORITY_ORDER`);
  }
  return engine.tier as PriorityTier;
}

/**
 * Map of canonical engine id → key on the orchestrator's EngineContext where
 * its hydrated output is expected to live. Used by `validateScopedHydration`
 * to detect missing inputs for a scoped rerun.
 *
 * Keys here must match the `EngineContext` shape in `server/orchestrator/index.ts`
 * (positioning → ctx.positioning, channel_selection → ctx.channelSelection,
 * etc.). If you add a new engine, register its ctx key here.
 */
export const ENGINE_CONTEXT_KEY: Record<string, string> = {
  market_intelligence: "mi",
  audience: "audience",
  positioning: "positioning",
  differentiation: "differentiation",
  mechanism: "mechanism",
  offer: "offer",
  awareness: "awareness",
  funnel: "funnel",
  persuasion: "persuasion",
  integrity: "integrity",
  statistical_validation: "statisticalValidation",
  budget_governor: "budgetGovernor",
  channel_selection: "channelSelection",
  iteration: "iteration",
  retention: "retention",
};

/**
 * Task #67 / T-S5-C2 — scoped-rerun fail-closed validator.
 *
 * Given the set of engines a scoped rerun intends to execute, and the
 * EngineContext after the hydration pass has run, returns the list of
 * upstream-context inputs that are required (transitively) but missing.
 *
 * Caller contract:
 *   - When the returned array is non-empty, the orchestrator MUST abort the
 *     run with overallStatus=BLOCKED + blockReason naming the missing inputs.
 *     Running the scoped engines on empty inputs would emit a degraded plan
 *     under a non-degraded label, which is the exact silent-failure category
 *     the founding continuity doctrine forbids (Seal #15).
 *
 * Returns: array of `{ engineId, missingDependency, ctxKey }` entries.
 */
export interface ScopedHydrationGap {
  engineId: string;
  missingDependency: string;
  ctxKey: string;
}

export function validateScopedHydration(
  scopedEngineIds: readonly string[],
  ctx: Record<string, unknown>,
): ScopedHydrationGap[] {
  if (!scopedEngineIds || scopedEngineIds.length === 0) return [];

  const scopedSet = new Set(scopedEngineIds);

  // Walk transitive deps of every scoped engine.
  const required = new Set<string>();
  const stack: string[] = [...scopedEngineIds];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const def = ENGINE_PRIORITY_ORDER.find(e => e.id === cur);
    if (!def) continue;
    for (const dep of def.dependencies) {
      if (required.has(dep)) continue;
      required.add(dep);
      stack.push(dep);
    }
  }

  // For every required dependency that is NOT itself in scope, the ctx slot
  // must already be populated by the hydration pass.
  const gaps: ScopedHydrationGap[] = [];
  for (const dep of required) {
    if (scopedSet.has(dep)) continue; // will be produced this run
    const ctxKey = ENGINE_CONTEXT_KEY[dep];
    if (!ctxKey) continue; // engine not registered — defensive skip
    const val = ctx[ctxKey];
    if (val === undefined || val === null) {
      gaps.push({ engineId: dep, missingDependency: dep, ctxKey });
    }
  }

  return gaps;
}
