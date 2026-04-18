export const ENGINE_PRIORITY_ORDER = [
  { id: "market_intelligence", name: "Market Intelligence", priority: 1, tier: "MARKET_REALITY" },
  { id: "audience", name: "Audience Engine", priority: 2, tier: "MARKET_REALITY" },
  { id: "positioning", name: "Positioning Engine", priority: 3, tier: "POSITIONING" },
  { id: "differentiation", name: "Differentiation Engine", priority: 4, tier: "POSITIONING" },
  { id: "mechanism", name: "Mechanism Engine", priority: 5, tier: "OFFER" },
  { id: "offer", name: "Offer Engine", priority: 6, tier: "OFFER" },
  { id: "awareness", name: "Awareness Engine", priority: 7, tier: "MESSAGING" },
  { id: "funnel", name: "Funnel Engine", priority: 8, tier: "MESSAGING" },
  { id: "persuasion", name: "Persuasion Engine", priority: 9, tier: "MESSAGING" },
  { id: "integrity", name: "Integrity Engine", priority: 10, tier: "MESSAGING" },
  { id: "statistical_validation", name: "Statistical Validation", priority: 11, tier: "FINANCIAL" },
  { id: "budget_governor", name: "Budget Governor", priority: 12, tier: "FINANCIAL" },
  { id: "channel_selection", name: "Channel Selection", priority: 13, tier: "CHANNEL" },
  { id: "iteration", name: "Iteration Engine", priority: 14, tier: "CREATIVE" },
  { id: "retention", name: "Retention Engine", priority: 15, tier: "CREATIVE" },
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
  status: "SUCCESS" | "PARTIAL" | "BLOCKED" | "SKIPPED" | "ERROR" | "DEPTH_BLOCKED" | "SIGNAL_BLOCKED" | "NEEDS_INPUT";
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
    result.status === "SIGNAL_BLOCKED" ||
    result.status === "DEPTH_BLOCKED"
  );
}

export function getEngineTier(engineId: EngineId): PriorityTier {
  const engine = ENGINE_PRIORITY_ORDER.find(e => e.id === engineId);
  return engine?.tier || "CREATIVE";
}
