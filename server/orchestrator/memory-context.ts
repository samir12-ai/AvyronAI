import { loadMemoryBlock, serializeMemoryBlockForPrompt, makeStrategyFingerprint } from "../memory-system/manager";
import type { MemoryBlock, MemorySlot } from "../memory-system/types";

export type { MemoryBlock as MemoryConstraintBlock, MemorySlot as MemoryEntry };

export async function buildMemoryContext(
  campaignId: string,
  accountId: string,
  bizData?: { funnelObjective?: string; businessType?: string; monthlyBudget?: string } | null,
): Promise<MemoryBlock> {
  return loadMemoryBlock(campaignId, accountId, bizData);
}

export function serializeMemoryContextForPrompt(block: MemoryBlock): string {
  return serializeMemoryBlockForPrompt(block);
}

export { makeStrategyFingerprint };
