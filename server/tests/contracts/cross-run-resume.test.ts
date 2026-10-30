import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildStrategyRoot, type StrategyRootInput } from "../../shared/strategy-root";
import { db } from "../../db";
import {
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  strategyRoots,
} from "@shared/schema";
import { getTableName } from "drizzle-orm";

describe("Contract: Cross-Run Resume Provenance Validation (StrategyRoot)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const getTable = (t: any) => {
    if (t === audienceSnapshots) return "audience_snapshots";
    if (t === positioningSnapshots) return "positioning_snapshots";
    if (t === differentiationSnapshots) return "differentiation_snapshots";
    if (t === mechanismSnapshots) return "mechanism_snapshots";
    if (t === strategyRoots) return "strategy_roots";
    try {
      return getTableName(t);
    } catch {
      return t?.name || t?._?.name;
    }
  };

  const setupTxMock = () => {
    vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => {
      const txMock = {
        execute: () => Promise.resolve([]),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ id: "root_new_1" }]),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([{ id: "root_new_1", rootHash: "hash_1" }]),
          }),
        }),
      };
      return await callback(txMock);
    });
  };

  const baseInput: StrategyRootInput = {
    campaignId: "camp_1",
    accountId: "acc_1",
    primaryAxis: "simplicity",
    contrastAxisText: "complexity vs effortless automation",
    audienceSnapshotId: "aud_snap_1",
    positioningSnapshotId: "pos_snap_1",
    differentiationSnapshotId: "diff_snap_1",
    mechanismSnapshotId: "mech_snap_1",
    approvedAudiencePains: [
      {
        painId: "pain_1",
        canonical: "Manual data entry takes too long",
        classification: "CORE_PURCHASE",
        rank: 1,
        eligible: true,
        allowedUses: ["positioning", "mechanism", "offer_core"],
        productFit: "ELIGIBLE",
        fitType: "DIRECT_FIT",
        lineage: {
          accountId: "acc_1",
          audienceSnapshotId: "aud_snap_1",
        },
      },
    ],
    approvedPositioningContext: { narrativeDirection: "Automation First" },
    approvedProofTypes: ["benchmark"],
    approvedObjections: ["Implementation takes too long"],
    approvedClaims: [{ claim: "10x faster execution" }],
  };

  it("1. Approves DAG parent-child linkages when snapshots come from different job IDs (cross-run resume)", async () => {
    setupTxMock();
    vi.spyOn(db, "select").mockImplementation((() => {
      const queryBuilder = {
        from: (table: any) => ({
          where: () => ({
            limit: () => {
              const tableName = getTable(table);
              if (tableName === "audience_snapshots") {
                return [{ id: "aud_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_run_1" }];
              }
              if (tableName === "positioning_snapshots") {
                return [{ id: "pos_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_run_2", audienceSnapshotId: "aud_snap_1" }];
              }
              if (tableName === "differentiation_snapshots") {
                return [{ id: "diff_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_run_3", audienceSnapshotId: "aud_snap_1", positioningSnapshotId: "pos_snap_1" }];
              }
              if (tableName === "mechanism_snapshots") {
                return [{ id: "mech_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_run_4", positioningSnapshotId: "pos_snap_1", differentiationSnapshotId: "diff_snap_1" }];
              }
              if (tableName === "strategy_roots") {
                return [];
              }
              return [];
            },
          }),
        }),
      };
      return queryBuilder;
    }) as any);

    const result = await buildStrategyRoot(baseInput);
    expect(result).toBeDefined();
    expect(result.id).toBe("root_new_1");
  });

  it("2. Fails closed with tenant_isolation_violation if a child snapshot belongs to another account", async () => {
    setupTxMock();
    vi.spyOn(db, "select").mockImplementation((() => ({
      from: (table: any) => ({
        where: () => ({
          limit: () => {
            const tableName = getTable(table);
            if (tableName === "audience_snapshots") {
              return [{ id: "aud_snap_1", accountId: "FOREIGN_ACCOUNT", campaignId: "camp_1", jobId: "job_1" }];
            }
            if (tableName === "positioning_snapshots") {
              return [{ id: "pos_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_2", audienceSnapshotId: "aud_snap_1" }];
            }
            if (tableName === "differentiation_snapshots") {
              return [{ id: "diff_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_2", audienceSnapshotId: "aud_snap_1", positioningSnapshotId: "pos_snap_1" }];
            }
            if (tableName === "mechanism_snapshots") {
              return [{ id: "mech_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_2", positioningSnapshotId: "pos_snap_1", differentiationSnapshotId: "diff_snap_1" }];
            }
            return [];
          },
        }),
      }),
    })) as any);

    await expect(buildStrategyRoot(baseInput)).rejects.toThrow(/tenant_isolation_violation/);
  });

  it("3. Fails closed with provenance_linkage_mismatch if DAG linkages between child snapshots are mismatched", async () => {
    setupTxMock();
    vi.spyOn(db, "select").mockImplementation((() => ({
      from: (table: any) => ({
        where: () => ({
          limit: () => {
            const tableName = getTable(table);
            if (tableName === "audience_snapshots") {
              return [{ id: "aud_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_1" }];
            }
            if (tableName === "positioning_snapshots") {
              return [{ id: "pos_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_2", audienceSnapshotId: "aud_snap_DIFFERENT" }];
            }
            if (tableName === "differentiation_snapshots") {
              return [{ id: "diff_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_2", audienceSnapshotId: "aud_snap_1", positioningSnapshotId: "pos_snap_1" }];
            }
            if (tableName === "mechanism_snapshots") {
              return [{ id: "mech_snap_1", accountId: "acc_1", campaignId: "camp_1", jobId: "job_2", positioningSnapshotId: "pos_snap_1", differentiationSnapshotId: "diff_snap_1" }];
            }
            return [];
          },
        }),
      }),
    })) as any);

    await expect(buildStrategyRoot(baseInput)).rejects.toThrow(/provenance_linkage_mismatch/);
  });
});
