import { loadMemoryBlock, serializeMemoryBlockForPrompt, makeStrategyFingerprint } from "../memory-system/manager";
export async function buildMemoryContext(campaignId, accountId, bizData) {
    return loadMemoryBlock(campaignId, accountId, bizData);
}
export function serializeMemoryContextForPrompt(block) {
    return serializeMemoryBlockForPrompt(block);
}
export { makeStrategyFingerprint };
