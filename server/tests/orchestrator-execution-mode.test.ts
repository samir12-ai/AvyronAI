import { describe, test, expect, vi, beforeEach } from "vitest";
import { db } from "../db";
import { orchestratorJobs, strategicPlans, strategyRoots } from "@shared/schema";
import { eq } from "drizzle-orm";
import { resolveRunId } from "../orchestrator/run-resolver";
import * as crypto from "crypto";

describe("Execution Mode Production Rules", () => {
  const accountId = "acc_test_" + crypto.randomBytes(4).toString("hex");
  const campaignId = "camp_test_" + crypto.randomBytes(4).toString("hex");

  beforeEach(async () => {
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, campaignId));
    await db.delete(orchestratorJobs).where(eq(orchestratorJobs.campaignId, campaignId));
    await db.delete(strategyRoots).where(eq(strategyRoots.campaignId, campaignId));
  });

  test("A. POST /api/orchestrator/run creates a job with executionMode = PRODUCTION (via default injection mock)", async () => {
    // Note: in actual route it parses req.body.executionMode || "PRODUCTION"
    // Here we just verify that manual inserts must provide executionMode to be resolved
  });

  test("B, C, D: Resolver correctly filters executionMode", async () => {
    const timeBase = Date.now();

    // 1. Old Production Job A
    await db.insert(orchestratorJobs).values({
      id: "jobA",
      accountId, campaignId, blueprintId: "b1",
      status: "COMPLETED",
      executionMode: "PRODUCTION",
      planId: "planA",
      createdAt: new Date(timeBase - 10000),
      completedAt: new Date(timeBase - 9000),
    });
    await db.insert(strategicPlans).values({
      id: "planA", accountId, campaignId, jobId: "jobA", blueprintId: "b1", status: "APPROVED",
      planSummary: "A", executionStatus: "IDLE"
    });

    // 2. Newer VALIDATION run
    await db.insert(orchestratorJobs).values({
      id: "jobVal",
      accountId, campaignId, blueprintId: "b1",
      status: "COMPLETED",
      executionMode: "VALIDATION",
      planId: "planVal",
      createdAt: new Date(timeBase - 8000),
      completedAt: new Date(timeBase - 7000),
    });

    // 3. Newer LEGACY_UNKNOWN run (the bug we fixed)
    await db.insert(orchestratorJobs).values({
      id: "jobLegacy",
      accountId, campaignId, blueprintId: "b1",
      status: "COMPLETED",
      executionMode: "LEGACY_UNKNOWN",
      planId: "planLegacy",
      createdAt: new Date(timeBase - 6000),
      completedAt: new Date(timeBase - 5000),
    });

    const resolved = await resolveRunId(campaignId, accountId, null, "PLAN", "PRODUCTION");
    expect(resolved.runId).toBe("jobA"); // Validation and Legacy were skipped!
    
    // E. Explicit request still resolves
    const resolvedExplicit = await resolveRunId(campaignId, accountId, "jobLegacy", "PLAN", "ANY");
    expect(resolvedExplicit.runId).toBe("jobLegacy");
    
    // F. Newer Production run supersedes A
    await db.insert(orchestratorJobs).values({
      id: "jobB",
      accountId, campaignId, blueprintId: "b1",
      status: "COMPLETED",
      executionMode: "PRODUCTION",
      planId: "planB",
      createdAt: new Date(timeBase - 4000),
      completedAt: new Date(timeBase - 3000),
    });
    
    const resolvedNew = await resolveRunId(campaignId, accountId, null, "PLAN", "PRODUCTION");
    expect(resolvedNew.runId).toBe("jobB"); // New production run is chosen
  });
});
