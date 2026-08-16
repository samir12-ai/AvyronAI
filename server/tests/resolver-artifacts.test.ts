import { db } from "../db";
import { orchestratorJobs, strategicPlans, buildPlanSnapshots } from "@shared/schema";
import { resolveRunId } from "../orchestrator/run-resolver";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterEach } from "vitest";

describe("Artifact-Aware Run Resolver", () => {
  const accountId = "test-account";
  const campaignId = "test-campaign-" + Date.now();

  beforeAll(async () => {
    await db.delete(buildPlanSnapshots).where(eq(buildPlanSnapshots.campaignId, campaignId));
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, campaignId));
    await db.delete(orchestratorJobs).where(eq(orchestratorJobs.campaignId, campaignId));
  });

  afterEach(async () => {
    await db.delete(buildPlanSnapshots).where(eq(buildPlanSnapshots.campaignId, campaignId));
    await db.delete(strategicPlans).where(eq(strategicPlans.campaignId, campaignId));
    await db.delete(orchestratorJobs).where(eq(orchestratorJobs.campaignId, campaignId));
  });

  it("A. Production A = Plan A, Production B = BLOCKED no plan -> Preview returns Plan A", async () => {
    const planA = `plan_a_${Date.now()}`;
    await db.insert(orchestratorJobs).values([
      { id: "job_a", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planA, executionMode: "PRODUCTION", completedAt: new Date(1000) },
      { id: "job_b", blueprintId: "orchestrator-v2", accountId, campaignId, status: "BLOCKED", planId: null, executionMode: "PRODUCTION", completedAt: new Date(2000) }
    ]);
    const res = await resolveRunId(campaignId, accountId, null, "PLAN", "PRODUCTION");
    expect(res.runId).toBe("job_a");
    expect(res.planId).toBe(planA);
  });

  it("B. Production A = Plan A, Production B = Plan B -> Preview returns Plan B", async () => {
    const planA = `plan_a_${Date.now()}`;
    const planB = `plan_b_${Date.now()}`;
    await db.insert(orchestratorJobs).values([
      { id: "job_a", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planA, executionMode: "PRODUCTION", completedAt: new Date(1000) },
      { id: "job_b", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planB, executionMode: "PRODUCTION", completedAt: new Date(2000) }
    ]);
    const res = await resolveRunId(campaignId, accountId, null, "PLAN", "PRODUCTION");
    expect(res.runId).toBe("job_b");
    expect(res.planId).toBe(planB);
  });

  it("C. Production A = Plan A, Validation B = Plan B -> Preview returns Plan A", async () => {
    const planA = `plan_a_${Date.now()}`;
    const planB = `plan_b_${Date.now()}`;
    await db.insert(orchestratorJobs).values([
      { id: "job_a", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planA, executionMode: "PRODUCTION", completedAt: new Date(1000) },
      { id: "job_b", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planB, executionMode: "VALIDATION", completedAt: new Date(2000) }
    ]);
    const res = await resolveRunId(campaignId, accountId, null, "PLAN", "PRODUCTION");
    expect(res.runId).toBe("job_a");
  });

  it("D. Explicit request for Validation B -> returns B", async () => {
    const planA = `plan_a_${Date.now()}`;
    const planB = `plan_b_${Date.now()}`;
    await db.insert(orchestratorJobs).values([
      { id: "job_a", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planA, executionMode: "PRODUCTION", completedAt: new Date(1000) },
      { id: "job_b", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planB, executionMode: "VALIDATION", completedAt: new Date(2000) }
    ]);
    const res = await resolveRunId(campaignId, accountId, "job_b", "PLAN", "PRODUCTION");
    expect(res.runId).toBe("job_b");
  });

  it("E. Explicit request for Blocked B with no Plan -> returns B with planId null", async () => {
    const planA = `plan_a_${Date.now()}`;
    await db.insert(orchestratorJobs).values([
      { id: "job_a", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: planA, executionMode: "PRODUCTION", completedAt: new Date(1000) },
      { id: "job_b", blueprintId: "orchestrator-v2", accountId, campaignId, status: "BLOCKED", planId: null, executionMode: "PRODUCTION", completedAt: new Date(2000) }
    ]);
    const res = await resolveRunId(campaignId, accountId, "job_b", "PLAN", "PRODUCTION");
    expect(res.runId).toBe("job_b");
    expect(res.planId).toBeNull();
  });

  it("F. Production A = Build Plan A, Production B = BLOCKED no build plan -> returns A", async () => {
    await db.insert(orchestratorJobs).values([
      { id: "job_a", blueprintId: "orchestrator-v2", accountId, campaignId, status: "COMPLETED", planId: "pA", executionMode: "PRODUCTION", completedAt: new Date(1000) },
      { id: "job_b", blueprintId: "orchestrator-v2", accountId, campaignId, status: "BLOCKED", planId: null, executionMode: "PRODUCTION", completedAt: new Date(2000) }
    ]);
    await db.insert(buildPlanSnapshots).values([
      { id: "bp_a", accountId, campaignId, jobId: "job_a", status: "SUCCESS" }
    ]);
    
    const res = await resolveRunId(campaignId, accountId, null, "BUILD_PLAN", "PRODUCTION");
    expect(res.runId).toBe("job_a");
  });

});
