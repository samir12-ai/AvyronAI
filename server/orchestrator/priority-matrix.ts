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
  { id: "integrity", name: "Integrity Engine", priority: 10, tier: "MESSAGING", dependencies: ["positioning", "offer", "awareness", "funnel", "persuasion"] as readonly string[] },
  { id: "statistical_validation", name: "Statistical Validation", priority: 11, tier: "FINANCIAL", dependencies: ["market_intelligence", "audience", "integrity"] as readonly string[] },
  { id: "budget_governor", name: "Budget Governor", priority: 12, tier: "FINANCIAL", dependencies: ["statistical_validation", "integrity"] as readonly string[] },
  { id: "channel_selection", name: "Channel Selection", priority: 13, tier: "CHANNEL", dependencies: ["audience", "funnel", "budget_governor"] as readonly string[] },
  { id: "iteration", name: "Iteration Engine", priority: 14, tier: "CREATIVE", dependencies: ["funnel", "persuasion", "budget_governor", "channel_selection"] as readonly string[] },
  { id: "retention", name: "Retention Engine", priority: 15, tier: "CREATIVE", dependencies: ["audience", "offer", "funnel"] as readonly string[] },
] as const;

export type EngineId = typeof ENGINE_PRIORITY_ORDER[number]["id"];

export type PriorityTier = "MARKET_REALITY" | "POSITIONING" | "OFFER" | "MESSAGING" | "FINANCIAL" | "CHANNEL" | "CREATIVE";

const TIER_RANK: Record<PriorityTier, number> = {
  MARKET_REALITY: 1,
  POSITIONING: 2,
  OFFER: 3,
  MESSAGING: 4,
  FINANCIAL: 5,
  CHANNEL: 6,
  CREATIVE: 7,
};

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
  status: "SUCCESS" | "PARTIAL" | "BLOCKED" | "SKIPPED" | "ERROR" | "DEPTH_BLOCKED" | "SIGNAL_BLOCKED" | "NEEDS_INPUT" | "BLOCKED_BY_INTEGRITY" | "TIMEOUT" | "CONTRACT_INCOMPLETE";
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

export function getEngineTier(engineId: EngineId): PriorityTier {
  const engine = ENGINE_PRIORITY_ORDER.find(e => e.id === engineId);
  return engine?.tier || "CREATIVE";
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
