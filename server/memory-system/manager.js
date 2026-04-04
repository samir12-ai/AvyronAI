import { db } from "../db";
import { strategyMemory } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { deriveIndustryBaseline } from "./industry-baseline";
const CONFIDENCE_ENFORCEMENT_MAP = [
    { min: 0.0, max: 0.4, strength: "none", multiplier: 0.0 },
    { min: 0.4, max: 0.6, strength: "soft", multiplier: 0.25 },
    { min: 0.6, max: 0.8, strength: "moderate", multiplier: 0.6 },
    { min: 0.8, max: 1.0, strength: "strong", multiplier: 0.9 },
];
function resolveEnforcement(confidenceScore) {
    const clamped = Math.min(1, Math.max(0, confidenceScore));
    for (const band of CONFIDENCE_ENFORCEMENT_MAP) {
        if (clamped >= band.min && clamped <= band.max) {
            return { strength: band.strength, multiplier: band.multiplier };
        }
    }
    return { strength: "none", multiplier: 0 };
}
function rowToSlot(row) {
    return {
        id: row.id,
        accountId: row.accountId,
        campaignId: row.campaignId,
        memoryType: row.memoryType,
        engineName: row.engineName ?? null,
        label: row.label,
        details: row.details ?? null,
        performance: row.performance ?? null,
        score: row.score ?? 0,
        confidenceScore: row.score ?? 0,
        isWinner: row.isWinner ?? false,
        usageCount: row.usageCount ?? 0,
        planId: row.planId ?? null,
        strategyFingerprint: row.strategyFingerprint ?? null,
        updatedAt: row.updatedAt ?? null,
        createdAt: row.createdAt ?? null,
    };
}
export async function loadMemoryBlock(campaignId, accountId, bizData) {
    const rows = await db
        .select()
        .from(strategyMemory)
        .where(and(eq(strategyMemory.accountId, accountId), eq(strategyMemory.campaignId, campaignId)))
        .orderBy(desc(strategyMemory.updatedAt))
        .limit(50);
    const reinforceSlots = [];
    const avoidSlots = [];
    const pendingSlots = [];
    let rhythmSlot = null;
    for (const row of rows) {
        const slot = rowToSlot(row);
        if (slot.memoryType === "content_rhythm") {
            if (!rhythmSlot || (slot.updatedAt && rhythmSlot.updatedAt && slot.updatedAt > rhythmSlot.updatedAt)) {
                rhythmSlot = slot;
            }
            continue;
        }
        if (slot.isWinner) {
            reinforceSlots.push(slot);
        }
        else if (slot.score !== 0) {
            avoidSlots.push(slot);
        }
        else {
            pendingSlots.push(slot);
        }
    }
    const industryBaseline = bizData
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
export function buildConfidenceWeightedConstraints(block) {
    const constraints = [];
    for (const slot of block.reinforceSlots) {
        const { strength, multiplier } = resolveEnforcement(slot.confidenceScore);
        if (strength === "none")
            continue;
        constraints.push({
            label: slot.label,
            details: slot.details,
            enforcementStrength: strength,
            enforcementMultiplier: multiplier,
            confidenceScore: slot.confidenceScore,
            memoryType: slot.memoryType,
            engineName: slot.engineName,
        });
    }
    for (const slot of block.avoidSlots) {
        const { strength, multiplier } = resolveEnforcement(Math.abs(slot.confidenceScore));
        if (strength === "none")
            continue;
        constraints.push({
            label: `[AVOID] ${slot.label}`,
            details: slot.details,
            enforcementStrength: strength,
            enforcementMultiplier: -multiplier,
            confidenceScore: slot.confidenceScore,
            memoryType: slot.memoryType,
            engineName: slot.engineName,
        });
    }
    return constraints;
}
export function serializeMemoryBlockForPrompt(block) {
    const constraints = buildConfidenceWeightedConstraints(block);
    if (constraints.length === 0 && !block.rhythmSlot && !block.industryBaseline)
        return "";
    const parts = ["STRATEGY_MEMORY (confidence-weighted constraints):"];
    const reinforce = constraints.filter(c => c.enforcementMultiplier > 0);
    const avoid = constraints.filter(c => c.enforcementMultiplier < 0);
    if (reinforce.length > 0) {
        parts.push("REINFORCE (confidence-weighted, prefer these directions):");
        for (const c of reinforce) {
            const pct = Math.round(c.enforcementMultiplier * 100);
            parts.push(`  [${c.enforcementStrength.toUpperCase()} ${pct}%] [${c.engineName ?? c.memoryType}] "${c.label}"${c.details ? `: ${c.details}` : ""}`);
        }
    }
    if (avoid.length > 0) {
        parts.push("AVOID (confidence-weighted, do not repeat these):");
        for (const c of avoid) {
            const pct = Math.round(Math.abs(c.enforcementMultiplier) * 100);
            parts.push(`  [${c.enforcementStrength.toUpperCase()} ${pct}%] [${c.engineName ?? c.memoryType}] "${c.label}"${c.details ? `: ${c.details}` : ""}`);
        }
    }
    if (block.rhythmSlot) {
        parts.push(`CONTENT_RHYTHM (adaptive): ${block.rhythmSlot.label} — ${block.rhythmSlot.performance ?? "current distribution"}`);
    }
    if (block.industryBaseline) {
        const b = block.industryBaseline;
        parts.push(`INDUSTRY_BASELINE (${b.objective}/${b.businessType}): Reels ${b.reelsPerWeek}/wk · Carousels ${b.carouselsPerWeek}/wk · Stories ${b.storiesPerDay}/day · Posts ${b.postsPerWeek}/wk`);
    }
    parts.push("INSTRUCTION: Apply REINFORCE directions with weight proportional to their enforcement %. Treat AVOID entries as weighted exclusions. Do not override content rhythm unless confidence for override exceeds 0.7.");
    return parts.join("\n");
}
export function makeStrategyFingerprint(engineName, label, details) {
    const raw = `${engineName}::${label}::${(details || "").slice(0, 100)}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        const char = raw.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return `fp_${Math.abs(hash).toString(36)}`;
}
