import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildAudiencePainRegistry } from "../../shared/audience-pain-registry";
import { buildStrategyRoot } from "../../shared/strategy-root";
import { db } from "../../db";
import { audienceSnapshots, positioningSnapshots, differentiationSnapshots, mechanismSnapshots } from "@shared/schema";

describe("Contract: Lineage (Provenance) vs Grounding (Materiality) Independence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Grounding Failure: Artifact with valid lineage fails grounding when evidence UIDs cannot be resolved", () => {
    // Empty canonical registry Map: 'ev_unregistered_999' does not exist
    const emptyCanonicalMap = new Map();

    const painWithUngroundedEvidence = {
      painId: "pain_ungrounded_1",
      canonical: "Users cannot sync accounts",
      evidenceUids: ["ev_unregistered_999"],
      lineage: {
        accountId: "acc_1",
        audienceSnapshotId: "aud_snap_1",
      },
    };

    const registry = buildAudiencePainRegistry(
      [painWithUngroundedEvidence],
      { accountId: "acc_1", audienceSnapshotId: "aud_snap_1" },
      emptyCanonicalMap
    );

    // Invariant: Ungrounded evidence is dropped / excluded even though lineage is present
    expect(registry.length).toBe(0);
  });

  it("2. Lineage Failure: Artifact with grounded evidence fails closed when tenant isolation is violated", async () => {
    vi.spyOn(db, "select").mockImplementation((() => ({
      from: (table: any) => ({
        where: () => ({
          limit: () => {
            if (table === audienceSnapshots) {
              return [{ id: "aud_snap_1", accountId: "FOREIGN_TENANT", campaignId: "camp_1", jobId: "job_1" }];
            }
            if (table === positioningSnapshots) {
              return [{ id: "pos_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_1", audienceSnapshotId: "aud_snap_1" }];
            }
            if (table === differentiationSnapshots) {
              return [{ id: "diff_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_1", audienceSnapshotId: "aud_snap_1", positioningSnapshotId: "pos_snap_1" }];
            }
            if (table === mechanismSnapshots) {
              return [{ id: "mech_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_1", positioningSnapshotId: "pos_snap_1", differentiationSnapshotId: "diff_snap_1" }];
            }
            return [];
          },
        }),
      }),
    })) as any);

    const input = {
      campaignId: "camp_1",
      accountId: "acc_1",
      primaryAxis: "simplicity",
      contrastAxisText: "complexity vs speed",
      audienceSnapshotId: "aud_snap_1",
      positioningSnapshotId: "pos_snap_1",
      differentiationSnapshotId: "diff_snap_1",
      mechanismSnapshotId: "mech_snap_1",
      approvedAudiencePains: [
        {
          painId: "pain_grounded_1",
          canonical: "Sync takes 4 hours",
          classification: "CORE_PURCHASE" as const,
          rank: 1,
          eligible: true,
          allowedUses: ["positioning" as const],
          productFit: "ELIGIBLE" as const,
          fitType: "DIRECT_FIT" as const,
          lineage: { accountId: "acc_1", audienceSnapshotId: "aud_snap_1" },
        },
      ],
      approvedPositioningContext: { narrativeDirection: "Simplicity First" },
      approvedProofTypes: ["benchmark"],
      approvedObjections: ["takes too long"],
      approvedClaims: [{ claim: "Instant sync" }],
    };

    // Invariant: Tenant isolation violation rejects even if pains are internally valid
    await expect(buildStrategyRoot(input)).rejects.toThrow(/tenant_isolation_violation/);
  });
});
