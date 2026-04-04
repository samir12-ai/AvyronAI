import { db } from "../db";
import { strategyMemory } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface MemoryEntry {
  id: string;
  engineName: string | null;
  label: string;
  memoryType: string;
  details: string | null;
  isWinner: boolean;
  score: number;
  strategyFingerprint: string | null;
  planId: string | null;
  updatedAt: Date | null;
}

export interface MemoryConstraintBlock {
  reinforcePatterns: MemoryEntry[];
  avoidPatterns: MemoryEntry[];
}

export async function buildMemoryContext(
  campaignId: string,
  accountId: string,
): Promise<MemoryConstraintBlock> {
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
    .limit(20);

  const reinforcePatterns: MemoryEntry[] = [];
  const avoidPatterns: MemoryEntry[] = [];

  for (const row of rows) {
    const entry: MemoryEntry = {
      id: row.id,
      engineName: row.engineName ?? null,
      label: row.label,
      memoryType: row.memoryType,
      details: row.details ?? null,
      isWinner: row.isWinner ?? false,
      score: row.score ?? 0,
      strategyFingerprint: row.strategyFingerprint ?? null,
      planId: row.planId ?? null,
      updatedAt: row.updatedAt ?? null,
    };

    if (entry.isWinner) {
      reinforcePatterns.push(entry);
    } else {
      avoidPatterns.push(entry);
    }
  }

  return { reinforcePatterns, avoidPatterns };
}

export function serializeMemoryContextForPrompt(block: MemoryConstraintBlock): string {
  if (block.reinforcePatterns.length === 0 && block.avoidPatterns.length === 0) {
    return "";
  }

  const reinforceLines = block.reinforcePatterns.map(
    (e) =>
      `  - [${e.engineName ?? e.memoryType}] "${e.label}"${e.details ? `: ${e.details}` : ""} (score: ${e.score.toFixed(2)})`,
  );

  const avoidLines = block.avoidPatterns.map(
    (e) =>
      `  - [${e.engineName ?? e.memoryType}] "${e.label}"${e.details ? `: ${e.details}` : ""} (score: ${e.score.toFixed(2)})`,
  );

  const parts: string[] = [
    "MEMORY_CONSTRAINTS (from prior orchestrator runs for this campaign):",
  ];

  if (reinforceLines.length > 0) {
    parts.push(
      "REINFORCE — strategies that previously succeeded (prefer these directions):",
      ...reinforceLines,
    );
  }

  if (avoidLines.length > 0) {
    parts.push(
      "AVOID — strategies that previously failed or underperformed (do not repeat these):",
      ...avoidLines,
    );
  }

  parts.push(
    "INSTRUCTION: treat AVOID entries as hard exclusions — do not recommend any strategy labeled in the AVOID list above. Prefer directions listed under REINFORCE when applicable.",
  );

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
