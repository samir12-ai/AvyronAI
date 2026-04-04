import { db } from "../db";
import { strategyMemory } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type {
  MemoryBlock,
  MemorySlot,
  MemoryClass,
  MemoryDirection,
  MemoryContext,
  IndustryBaseline,
  ConfidenceWeightedConstraint,
  EnforcementStrength,
} from "./types";
import { deriveIndustryBaseline } from "./industry-baseline";

const CONFIDENCE_ENFORCEMENT_MAP: Array<{ min: number; max: number; strength: EnforcementStrength; multiplier: number }> = [
  { min: 0.0, max: 0.4, strength: "none",     multiplier: 0.0  },
  { min: 0.4, max: 0.6, strength: "soft",     multiplier: 0.25 },
  { min: 0.6, max: 0.8, strength: "moderate", multiplier: 0.6  },
  { min: 0.8, max: 1.0, strength: "strong",   multiplier: 0.9  },
];

function resolveEnforcement(confidenceScore: number): { strength: EnforcementStrength; multiplier: number } {
  const clamped = Math.min(1, Math.max(0, confidenceScore));
  for (const band of CONFIDENCE_ENFORCEMENT_MAP) {
    if (clamped >= band.min && clamped <= band.max) {
      return { strength: band.strength, multiplier: band.multiplier };
    }
  }
  return { strength: "none", multiplier: 0 };
}

function computeEffectiveConfidence(slot: MemorySlot): number {
  const now = new Date();
  const validatedAt = slot.lastValidatedAt ?? slot.updatedAt ?? slot.createdAt ?? now;
  const periodMs = 7 * 24 * 60 * 60 * 1000;
  const periodsElapsed = Math.max(0, (now.getTime() - validatedAt.getTime()) / periodMs);
  const decayRate = slot.decayRate ?? 0.95;
  return slot.confidenceScore * Math.pow(decayRate, periodsElapsed);
}

function contextMatches(slot: MemorySlot, ctx: MemoryContext): boolean {
  if (slot.industry && slot.industry !== ctx.industry) return false;
  if (slot.platform && slot.platform !== ctx.platform) return false;
  if (slot.campaignType && slot.campaignType !== ctx.campaignType) return false;
  if (slot.funnelObjective && slot.funnelObjective !== ctx.funnelObjective) return false;
  return true;
}

function resolveConflicts(slots: MemorySlot[], ctx: MemoryContext): MemorySlot[] {
  const grouped = new Map<string, MemorySlot[]>();
  for (const slot of slots) {
    const key = slot.strategyFingerprint ?? slot.label.toLowerCase().trim();
    const group = grouped.get(key) ?? [];
    group.push(slot);
    grouped.set(key, group);
  }

  const resolved: MemorySlot[] = [];
  for (const [, group] of grouped) {
    if (group.length === 1) {
      resolved.push(group[0]);
      continue;
    }

    const sorted = group.slice().sort((a, b) => {
      const effA = computeEffectiveConfidence(a);
      const effB = computeEffectiveConfidence(b);
      if (effA !== effB) return effB - effA;

      const timeA = (a.lastValidatedAt ?? a.updatedAt ?? a.createdAt ?? new Date(0)).getTime();
      const timeB = (b.lastValidatedAt ?? b.updatedAt ?? b.createdAt ?? new Date(0)).getTime();
      if (timeA !== timeB) return timeB - timeA;

      const directionOrder: Record<MemoryDirection, number> = { avoid: 0, neutral: 1, reinforce: 2 };
      return directionOrder[a.direction] - directionOrder[b.direction];
    });

    resolved.push(sorted[0]);
  }
  return resolved;
}

function rowToSlot(row: typeof strategyMemory.$inferSelect): MemorySlot {
  const rawDirection = row.direction ?? "neutral";
  const direction: MemoryDirection =
    rawDirection === "reinforce" || rawDirection === "avoid" ? rawDirection : "neutral";

  return {
    id: row.id,
    accountId: row.accountId,
    campaignId: row.campaignId,
    memoryType: row.memoryType as MemoryClass,
    engineName: row.engineName ?? null,
    label: row.label,
    details: row.details ?? null,
    performance: row.performance ?? null,
    score: row.score ?? 0,
    confidenceScore: row.confidenceScore ?? (row.isWinner ? 0.85 : row.score && row.score < 0 ? 0.15 : 0.5),
    direction,
    isWinner: direction === "reinforce",
    usageCount: row.usageCount ?? 0,
    planId: row.planId ?? null,
    strategyFingerprint: row.strategyFingerprint ?? null,
    lastValidatedAt: row.lastValidatedAt ?? null,
    decayRate: row.decayRate ?? 0.95,
    validationCount: row.validationCount ?? 0,
    industry: row.industry ?? null,
    platform: row.platform ?? null,
    campaignType: row.campaignType ?? null,
    funnelObjective: row.funnelObjective ?? null,
    updatedAt: row.updatedAt ?? null,
    createdAt: row.createdAt ?? null,
  };
}

export async function loadMemoryBlock(
  campaignId: string,
  accountId: string,
  bizData?: { funnelObjective?: string; businessType?: string; monthlyBudget?: string } | null,
  memoryContext?: MemoryContext | null,
): Promise<MemoryBlock> {
  const rows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
      )
    )
    .orderBy(desc(strategyMemory.updatedAt))
    .limit(100);

  const ctx: MemoryContext = memoryContext ?? {
    funnelObjective: bizData?.funnelObjective ?? null,
    industry: bizData?.businessType ?? null,
    platform: null,
    campaignType: null,
  };

  const rawSlots: MemorySlot[] = [];
  const reinforceSlots: MemorySlot[] = [];
  const avoidSlots: MemorySlot[] = [];
  const pendingSlots: MemorySlot[] = [];
  let rhythmSlot: MemorySlot | null = null;

  for (const row of rows) {
    const slot = rowToSlot(row);

    if (slot.memoryType === "content_rhythm") {
      if (!rhythmSlot || (slot.updatedAt && rhythmSlot.updatedAt && slot.updatedAt > rhythmSlot.updatedAt)) {
        rhythmSlot = slot;
      }
      continue;
    }

    if (!contextMatches(slot, ctx)) continue;

    const effectiveConfidence = computeEffectiveConfidence(slot);
    if (effectiveConfidence < 0.1) continue;

    rawSlots.push(slot);
  }

  const deduped = resolveConflicts(rawSlots, ctx);

  for (const slot of deduped) {
    const effectiveConfidence = computeEffectiveConfidence(slot);
    const direction = slot.direction;

    if (direction === "reinforce" || (direction === "neutral" && effectiveConfidence >= 0.6)) {
      reinforceSlots.push(slot);
    } else if (direction === "avoid" || (direction === "neutral" && effectiveConfidence < 0.4)) {
      avoidSlots.push(slot);
    } else {
      pendingSlots.push(slot);
    }
  }

  const industryBaseline: IndustryBaseline | null = bizData
    ? deriveIndustryBaseline(bizData.funnelObjective, bizData.businessType, bizData.monthlyBudget)
    : null;

  return {
    campaignId,
    accountId,
    reinforceSlots,
    avoidSlots,
    pendingSlots,
    rhythmSlot,
    industryBaseline,
    loadedAt: new Date(),
  };
}

export function buildConfidenceWeightedConstraints(block: MemoryBlock): ConfidenceWeightedConstraint[] {
  const constraints: ConfidenceWeightedConstraint[] = [];

  for (const slot of block.reinforceSlots) {
    const effectiveConfidence = computeEffectiveConfidence(slot);
    const { strength, multiplier } = resolveEnforcement(effectiveConfidence);
    constraints.push({
      label: slot.label,
      details: slot.details,
      direction: slot.direction,
      enforcementStrength: strength === "none" ? "soft" : strength,
      enforcementMultiplier: strength === "none" ? 0.05 : multiplier,
      confidenceScore: slot.confidenceScore,
      effectiveConfidence,
      memoryType: slot.memoryType,
      engineName: slot.engineName,
    });
  }

  for (const slot of block.avoidSlots) {
    const effectiveConfidence = computeEffectiveConfidence(slot);
    const { strength, multiplier } = resolveEnforcement(effectiveConfidence);
    constraints.push({
      label: slot.label,
      details: slot.details,
      direction: slot.direction,
      enforcementStrength: strength === "none" ? "soft" : strength,
      enforcementMultiplier: strength === "none" ? -0.05 : -multiplier,
      confidenceScore: slot.confidenceScore,
      effectiveConfidence,
      memoryType: slot.memoryType,
      engineName: slot.engineName,
    });
  }

  return constraints;
}

export function serializeMemoryBlockForPrompt(block: MemoryBlock): string {
  const constraints = buildConfidenceWeightedConstraints(block);
  if (constraints.length === 0 && !block.rhythmSlot && !block.industryBaseline) return "";

  const parts: string[] = ["STRATEGY_MEMORY (confidence-weighted constraints):"];

  const reinforce = constraints.filter(c => c.enforcementMultiplier > 0);
  const avoid = constraints.filter(c => c.enforcementMultiplier < 0);

  if (reinforce.length > 0) {
    parts.push("REINFORCE (prefer these directions — weight by confidence band):");
    for (const c of reinforce) {
      const pct = Math.round(c.effectiveConfidence * 100);
      const band = c.effectiveConfidence >= 0.7 ? "STRONG guidance" : c.effectiveConfidence >= 0.4 ? "MODERATE guidance" : "WEAK signal";
      parts.push(`  [${band} ${pct}% effective confidence] [${c.engineName ?? c.memoryType}] "${c.label}"${c.details ? `: ${c.details}` : ""}`);
    }
  }

  if (avoid.length > 0) {
    parts.push("AVOID (confidence-weighted — apply proportionally, not as hard blocks):");
    for (const c of avoid) {
      const pct = Math.round(c.effectiveConfidence * 100);
      const band = c.effectiveConfidence >= 0.7 ? "STRONG guidance" : c.effectiveConfidence >= 0.4 ? "MODERATE guidance" : "WEAK signal";
      parts.push(`  [${band} ${pct}% effective confidence] [${c.engineName ?? c.memoryType}] "${c.label}"${c.details ? `: ${c.details}` : ""}`);
    }
  }

  if (block.rhythmSlot) {
    parts.push(`CONTENT_RHYTHM (adaptive): ${block.rhythmSlot.label} — ${block.rhythmSlot.performance ?? "current distribution"}`);
  }

  if (block.industryBaseline) {
    const b = block.industryBaseline;
    parts.push(`INDUSTRY_BASELINE (${b.objective}/${b.businessType}): Reels ${b.reelsPerWeek}/wk · Carousels ${b.carouselsPerWeek}/wk · Stories ${b.storiesPerDay}/day · Posts ${b.postsPerWeek}/wk`);
  }

  parts.push("INSTRUCTION: Apply all REINFORCE and AVOID entries with weight proportional to their effective confidence band. STRONG guidance (≥70% confidence) carries significant weight. MODERATE guidance (40–70%) is meaningful but not overriding. WEAK signals (<40%) are informational only. Results always take precedence over stored memory — do not override content rhythm unless confidence for override exceeds 0.7.");

  return parts.join("\n");
}

export function makeStrategyFingerprint(engineName: string, label: string, details?: string | null): string {
  const raw = `${engineName}::${label}::${(details || "").slice(0, 100)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}
