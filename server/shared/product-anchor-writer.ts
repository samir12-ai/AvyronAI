import { db } from "../db";
import { growthCampaigns, productAnchorAudit } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { computeAnchorHash, type ProductAnchor } from "./strategic-doctrine";

/**
 * ============================================================================
 * AUDITED PRODUCT ANCHOR WRITER — the ONLY legitimate anchor write path
 * ============================================================================
 *
 * Product Identity (CAPABILITY_NAMESPACE) may only change through this helper
 * so that every write preserves: writer, source, reason, previous value, new
 * value, validation decision, campaign/account, timestamp.
 *
 * Direct SQL writes cannot be prevented at the DB layer, so they are DETECTED:
 * checkAnchorAuditConsistency() compares the live anchor hash against the
 * newest audit row and logs ANCHOR_WRITE_UNAUDITED loudly when they diverge.
 */

export type AnchorWriteSource =
  | "campaign_create"
  | "user_edit"
  | "user_clear"
  | "dna_enrichment_resolve"
  | "operator_cleanup";

export async function writeProductAnchorAudited(params: {
  campaignId: string;
  campaignName?: string;
  accountId: string;
  writer: string; // e.g. "PUT /api/campaigns/:campaignId/product-anchor"
  source: AnchorWriteSource;
  reason: string;
  newAnchor: ProductAnchor | null; // null = clear
  validationDecision: string; // SCHEMA_VALID | ACCEPT | USER_CONFIRMED | CLEARED | ...
}): Promise<void> {
  const { campaignId, accountId } = params;
  const existing = await db
    .select({ productAnchor: growthCampaigns.productAnchor, name: growthCampaigns.name })
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);
  const previousValue = existing.length > 0 ? (existing[0].productAnchor as unknown) : null;

  if (params.newAnchor === null) {
    if (existing.length > 0) {
      await db
        .update(growthCampaigns)
        .set({ productAnchor: null, updatedAt: new Date() })
        .where(eq(growthCampaigns.id, campaignId));
    }
  } else {
    await db
      .insert(growthCampaigns)
      .values({
        id: campaignId,
        name: params.campaignName ?? (existing[0]?.name || campaignId),
        productAnchor: params.newAnchor,
      })
      .onConflictDoUpdate({
        target: growthCampaigns.id,
        set: { productAnchor: params.newAnchor, updatedAt: new Date() },
      });
  }

  await db.insert(productAnchorAudit).values({
    campaignId,
    accountId,
    writer: params.writer,
    source: params.source,
    reason: params.reason,
    previousValue: previousValue ?? null,
    newValue: params.newAnchor ?? null,
    validationDecision: params.validationDecision,
    anchorHash: computeAnchorHash(params.newAnchor),
  });
  console.log(
    `[ProductAnchorWriter] ANCHOR_WRITE_AUDITED | campaign=${campaignId} | source=${params.source} | decision=${params.validationDecision} | hash=${computeAnchorHash(params.newAnchor)}`,
  );
}

/**
 * Detection for direct unaudited writes: called at doctrine-seed time. When
 * the live anchor's hash differs from the newest audit row's hash (or an
 * anchor exists with no audit rows at all), logs ANCHOR_WRITE_UNAUDITED
 * loudly. Never throws and never blocks the run — detection, not enforcement
 * (B2/B3): pre-audit legacy anchors would otherwise brick every campaign.
 */
export async function checkAnchorAuditConsistency(
  campaignId: string,
  liveAnchor: ProductAnchor | null,
): Promise<{ consistent: boolean; reason: string }> {
  try {
    const liveHash = computeAnchorHash(liveAnchor);
    const rows = await db
      .select({ anchorHash: productAnchorAudit.anchorHash, createdAt: productAnchorAudit.createdAt })
      .from(productAnchorAudit)
      .where(eq(productAnchorAudit.campaignId, campaignId))
      .orderBy(desc(productAnchorAudit.createdAt))
      .limit(1);
    if (rows.length === 0) {
      if (liveAnchor === null) return { consistent: true, reason: "NO_ANCHOR_NO_AUDIT" };
      console.error(
        `[ProductAnchorWriter] ANCHOR_WRITE_UNAUDITED | campaign=${campaignId} | live anchor (hash=${liveHash}) has NO audit trail — written outside the audited path (legacy or direct SQL)`,
      );
      return { consistent: false, reason: "ANCHOR_WITHOUT_AUDIT_TRAIL" };
    }
    if (rows[0].anchorHash !== liveHash) {
      console.error(
        `[ProductAnchorWriter] ANCHOR_WRITE_UNAUDITED | campaign=${campaignId} | live hash=${liveHash} != newest audited hash=${rows[0].anchorHash} — anchor changed outside the audited path`,
      );
      return { consistent: false, reason: "HASH_MISMATCH_WITH_AUDIT" };
    }
    return { consistent: true, reason: "OK" };
  } catch (err) {
    // Detection must never take down a run (e.g. table missing pre-migration).
    console.error(`[ProductAnchorWriter] AUDIT_CONSISTENCY_CHECK_FAILED | campaign=${campaignId} | ${err instanceof Error ? err.message : String(err)}`);
    return { consistent: true, reason: "CHECK_FAILED_OPEN" };
  }
}
