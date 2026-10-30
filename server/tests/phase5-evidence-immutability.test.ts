import "dotenv/config";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "../db";
import { evidenceRegistry, reasoningRuns } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  registerEvidence,
  getEvidenceByUids,
  resolveEvidenceItem,
  resolveEvidenceItemsBatch,
  recordReasoningRun,
  versionedSourceId,
  type RegistryEntry,
} from "../strategic-reasoning/evidence-registry";

describe("Phase 5: Evidence Registry Version Resolution & Immutability", () => {
  const synthAccountId = `tenant_synth_p5_${Date.now()}`;
  const synthCampaignId = `camp_synth_p5_${Date.now()}`;
  const crossTenantAccountId = `tenant_synth_cross_${Date.now()}`;

  beforeEach(async () => {
    await db.delete(evidenceRegistry).where(eq(evidenceRegistry.campaignId, synthCampaignId));
    await db.delete(reasoningRuns).where(eq(reasoningRuns.campaignId, synthCampaignId));
  });

  afterEach(async () => {
    await db.delete(evidenceRegistry).where(eq(evidenceRegistry.campaignId, synthCampaignId));
    await db.delete(reasoningRuns).where(eq(reasoningRuns.campaignId, synthCampaignId));
  });

  it("proves immutable versioning: A and B both resolve truthfully, cross-tenant is rejected, and historical runs preserve exact inputs", async () => {
    const rawRowId = "review_prod_442";

    // 1. Save evidence version A
    const payloadA = "Customer noted: Delivery was prompt but box corners were dented during transit.";
    const sourceIdA = versionedSourceId(rawRowId, payloadA);
    const entryA: RegistryEntry = {
      kind: "customer_review",
      sourceTable: "ci_competitor_reviews",
      sourceId: sourceIdA,
      label: "Transit damage observation v1",
      detail: payloadA,
      observedAt: new Date("2026-04-01T10:00:00Z"),
    };
    const [uidA] = await registerEvidence(synthAccountId, synthCampaignId, [entryA]);
    expect(uidA).toBeDefined();
    expect(uidA).toContain(sourceIdA);

    // 2. Create a changed version B (supersedes A)
    const payloadB = "Customer noted: Revised review - manufacturer replaced dented box with reinforced metal tin.";
    const sourceIdB = versionedSourceId(rawRowId, payloadB);
    const entryB: RegistryEntry = {
      kind: "customer_review",
      sourceTable: "ci_competitor_reviews",
      sourceId: sourceIdB,
      label: "Transit damage observation v2",
      detail: payloadB,
      observedAt: new Date("2026-04-02T10:00:00Z"),
      supersedesUid: uidA,
    };
    const [uidB] = await registerEvidence(synthAccountId, synthCampaignId, [entryB]);
    expect(uidB).toBeDefined();
    expect(uidB).not.toBe(uidA);

    // 3. Resolve A and retrieve the unchanged original payload
    const resolvedA = await resolveEvidenceItem({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      uid: uidA,
    });
    expect(resolvedA).not.toBeNull();
    expect(resolvedA?.id).toBe(uidA);
    expect(resolvedA?.textSnippet).toBe(payloadA);
    expect(resolvedA?.title).toBe("Transit damage observation v1");

    // 4. Resolve B and retrieve the new payload
    const resolvedB = await resolveEvidenceItem({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      uid: uidB,
    });
    expect(resolvedB).not.toBeNull();
    expect(resolvedB?.id).toBe(uidB);
    expect(resolvedB?.textSnippet).toBe(payloadB);
    expect(resolvedB?.title).toBe("Transit damage observation v2");
    expect(resolvedB?.supersedesUid).toBe(uidA);

    // Batch resolve both
    const batch = await resolveEvidenceItemsBatch({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      uids: [uidA, uidB],
    });
    expect(batch[uidA]?.textSnippet).toBe(payloadA);
    expect(batch[uidB]?.textSnippet).toBe(payloadB);

    // 5. Reject cross-tenant references
    const crossTenantResolved = await resolveEvidenceItem({
      accountId: crossTenantAccountId,
      campaignId: synthCampaignId,
      uid: uidA,
    });
    expect(crossTenantResolved).toBeNull();

    const crossTenantBatch = await resolveEvidenceItemsBatch({
      accountId: crossTenantAccountId,
      campaignId: synthCampaignId,
      uids: [uidA, uidB],
    });
    expect(crossTenantBatch[uidA]).toBeUndefined();
    expect(crossTenantBatch[uidB]).toBeUndefined();

    // 6. Preserve a historical assessment's exact input references
    const historicalRunId = await recordReasoningRun({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      layer: "strategic_reasoning",
      status: "accepted_ai",
      contextFingerprint: "fingerprint_v1_historical",
      output: {
        claim: "Fragile packaging requires reinforced container",
        fit: "STRATEGIC_FIT",
        unresolvedRequirement: "Certified drop testing required",
      },
      refMap: { "REF-1": uidA },
      evidenceUids: [uidA],
    });
    expect(historicalRunId).not.toBeNull();

    // Retrieve historical run from DB and verify exact reference persists to version A
    const runs = await db
      .select()
      .from(reasoningRuns)
      .where(eq(reasoningRuns.id, historicalRunId!));
    expect(runs).toHaveLength(1);
    const refMap = JSON.parse(runs[0].refMap || "{}");
    expect(refMap["REF-1"]).toBe(uidA);

    // Resolving historical reference returns Version A payload, NOT Version B
    const historicalCitation = await resolveEvidenceItem({
      accountId: synthAccountId,
      campaignId: synthCampaignId,
      uid: refMap["REF-1"],
    });
    expect(historicalCitation?.textSnippet).toBe(payloadA);
    expect(historicalCitation?.textSnippet).not.toBe(payloadB);
  });
});
