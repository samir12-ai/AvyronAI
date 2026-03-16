import crypto from "crypto";
import { db } from "../db";
import { strategyRoots, offerSnapshots, funnelSnapshots, integritySnapshots } from "@shared/schema";
import { eq, and, desc, ne } from "drizzle-orm";

interface StrategyRootInput {
  campaignId: string;
  accountId: string;
  miSnapshotId: string;
  audienceSnapshotId: string;
  positioningSnapshotId: string;
  differentiationSnapshotId: string;
  mechanismSnapshotId: string;
  primaryAxis: string | null;
  contrastAxisText: string | null;
  approvedMechanism: any;
  approvedAudiencePains: any;
  approvedDesires: any;
  approvedTransformation: string | null;
  approvedClaim: string | null;
  approvedPromise: string | null;
}

export function computeRootHash(input: StrategyRootInput): string {
  const hashPayload = {
    mi: input.miSnapshotId,
    aud: input.audienceSnapshotId,
    pos: input.positioningSnapshotId,
    diff: input.differentiationSnapshotId,
    mech: input.mechanismSnapshotId,
    axis: input.primaryAxis,
    contrast: input.contrastAxisText,
  };
  return crypto.createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex").substring(0, 16);
}

export function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export async function buildStrategyRoot(input: StrategyRootInput): Promise<{
  id: string;
  runId: string;
  rootHash: string;
  isNew: boolean;
}> {
  const rootHash = computeRootHash(input);
  const runId = generateRunId();

  const [existing] = await db.select().from(strategyRoots)
    .where(and(
      eq(strategyRoots.campaignId, input.campaignId),
      eq(strategyRoots.accountId, input.accountId),
      eq(strategyRoots.rootHash, rootHash),
      eq(strategyRoots.status, "ACTIVE"),
    ))
    .limit(1);

  if (existing) {
    console.log(`[StrategyRoot] REUSE | existing root ${existing.id} | hash=${rootHash} | campaign=${input.campaignId}`);
    return { id: existing.id, runId: existing.runId, rootHash, isNew: false };
  }

  await db.update(strategyRoots)
    .set({ status: "SUPERSEDED" })
    .where(and(
      eq(strategyRoots.campaignId, input.campaignId),
      eq(strategyRoots.accountId, input.accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ));

  const [created] = await db.insert(strategyRoots).values({
    accountId: input.accountId,
    campaignId: input.campaignId,
    runId,
    rootHash,
    primaryAxis: input.primaryAxis,
    contrastAxisText: input.contrastAxisText,
    approvedMechanism: JSON.stringify(input.approvedMechanism),
    approvedAudiencePains: JSON.stringify(input.approvedAudiencePains),
    approvedDesires: JSON.stringify(input.approvedDesires),
    approvedTransformation: input.approvedTransformation,
    approvedClaim: input.approvedClaim,
    approvedPromise: input.approvedPromise,
    miSnapshotId: input.miSnapshotId,
    audienceSnapshotId: input.audienceSnapshotId,
    positioningSnapshotId: input.positioningSnapshotId,
    differentiationSnapshotId: input.differentiationSnapshotId,
    mechanismSnapshotId: input.mechanismSnapshotId,
    status: "ACTIVE",
  }).returning();

  console.log(`[StrategyRoot] CREATED | id=${created.id} | hash=${rootHash} | runId=${runId} | campaign=${input.campaignId}`);
  return { id: created.id, runId, rootHash, isNew: true };
}

export async function getActiveRoot(campaignId: string, accountId: string = "default"): Promise<any | null> {
  const [active] = await db.select().from(strategyRoots)
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(1);

  return active || null;
}

export interface RootValidationResult {
  valid: boolean;
  issues: string[];
  rootId: string | null;
  rootHash: string | null;
  runId: string | null;
}

export function validateRootBinding(
  activeRoot: any,
  snapshotIds: {
    miSnapshotId?: string;
    audienceSnapshotId?: string;
    positioningSnapshotId?: string;
    differentiationSnapshotId?: string;
    mechanismSnapshotId?: string;
  }
): RootValidationResult {
  if (!activeRoot) {
    return {
      valid: false,
      issues: ["No active strategy root — run Mechanism Engine to create one"],
      rootId: null,
      rootHash: null,
      runId: null,
    };
  }

  const issues: string[] = [];

  if (snapshotIds.miSnapshotId && snapshotIds.miSnapshotId !== activeRoot.miSnapshotId) {
    issues.push(`MI snapshot mismatch: using ${snapshotIds.miSnapshotId} but root expects ${activeRoot.miSnapshotId}`);
  }
  if (snapshotIds.audienceSnapshotId && snapshotIds.audienceSnapshotId !== activeRoot.audienceSnapshotId) {
    issues.push(`Audience snapshot mismatch: using ${snapshotIds.audienceSnapshotId} but root expects ${activeRoot.audienceSnapshotId}`);
  }
  if (snapshotIds.positioningSnapshotId && snapshotIds.positioningSnapshotId !== activeRoot.positioningSnapshotId) {
    issues.push(`Positioning snapshot mismatch: using ${snapshotIds.positioningSnapshotId} but root expects ${activeRoot.positioningSnapshotId}`);
  }
  if (snapshotIds.differentiationSnapshotId && snapshotIds.differentiationSnapshotId !== activeRoot.differentiationSnapshotId) {
    issues.push(`Differentiation snapshot mismatch: using ${snapshotIds.differentiationSnapshotId} but root expects ${activeRoot.differentiationSnapshotId}`);
  }
  if (snapshotIds.mechanismSnapshotId && snapshotIds.mechanismSnapshotId !== activeRoot.mechanismSnapshotId) {
    issues.push(`Mechanism snapshot mismatch: using ${snapshotIds.mechanismSnapshotId} but root expects ${activeRoot.mechanismSnapshotId}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    rootId: activeRoot.id,
    rootHash: activeRoot.rootHash,
    runId: activeRoot.runId,
  };
}

export async function invalidateDownstreamOnRegeneration(
  campaignId: string,
  accountId: string,
  regeneratedEngine: "positioning" | "differentiation" | "audience" | "mechanism" | "mi"
): Promise<{ supersededRoots: number; invalidatedOffers: number; invalidatedFunnels: number; invalidatedIntegrity: number }> {
  const [activeRoot] = await db.select().from(strategyRoots)
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ))
    .limit(1);

  if (!activeRoot) {
    return { supersededRoots: 0, invalidatedOffers: 0, invalidatedFunnels: 0, invalidatedIntegrity: 0 };
  }

  await db.update(strategyRoots)
    .set({ status: "SUPERSEDED" })
    .where(and(
      eq(strategyRoots.campaignId, campaignId),
      eq(strategyRoots.accountId, accountId),
      eq(strategyRoots.status, "ACTIVE"),
    ));

  console.log(`[StrategyRoot] INVALIDATED | root=${activeRoot.id} | trigger=${regeneratedEngine} | campaign=${campaignId}`);

  return { supersededRoots: 1, invalidatedOffers: 0, invalidatedFunnels: 0, invalidatedIntegrity: 0 };
}

export function validatePreGeneration(activeRoot: any): {
  canGenerate: boolean;
  missingFields: string[];
} {
  if (!activeRoot) {
    return { canGenerate: false, missingFields: ["strategy_root"] };
  }

  const missing: string[] = [];

  if (!activeRoot.primaryAxis) missing.push("primary_axis");
  if (!activeRoot.mechanismSnapshotId) missing.push("approved_mechanism");
  if (!activeRoot.audienceSnapshotId) missing.push("audience_data");
  if (!activeRoot.contrastAxisText) missing.push("contrast_axis");

  const pains = safeJsonParse(activeRoot.approvedAudiencePains);
  if (!pains || (Array.isArray(pains) && pains.length === 0)) {
    missing.push("approved_audience_pains");
  }

  return { canGenerate: missing.length === 0, missingFields: missing };
}

export function validatePostGeneration(
  activeRoot: any,
  generatedOffer: any
): { valid: boolean; issues: string[] } {
  if (!activeRoot || !generatedOffer) {
    return { valid: true, issues: [] };
  }

  const issues: string[] = [];
  const axis = activeRoot.primaryAxis || "";
  const axisTokens = axis.replace(/_/g, " ").toLowerCase().split(/\s+/).filter((t: string) => t.length > 3);

  if (generatedOffer.offerName && axisTokens.length > 0) {
    const nameLC = generatedOffer.offerName.toLowerCase();
    const nameLC2 = (generatedOffer.coreOutcome || "").toLowerCase();
    const combined = `${nameLC} ${nameLC2} ${(generatedOffer.mechanismDescription || "").toLowerCase()}`;
    const hasAxisRef = axisTokens.some((t: string) => combined.includes(t));
    if (!hasAxisRef) {
      issues.push(`Advisory: offer does not reference the active axis "${axis.replace(/_/g, " ")}"`);
    }
  }

  const mechData = safeJsonParse(activeRoot.approvedMechanism);
  if (mechData?.mechanismName && generatedOffer.mechanismDescription) {
    const mechName = mechData.mechanismName.toLowerCase();
    const mechDesc = generatedOffer.mechanismDescription.toLowerCase();
    if (!mechDesc.includes(mechName.substring(0, Math.min(mechName.length, 8)))) {
      issues.push(`Advisory: mechanism "${mechData.mechanismName}" not referenced in offer mechanism`);
    }
  }

  return { valid: issues.length === 0, issues };
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}
