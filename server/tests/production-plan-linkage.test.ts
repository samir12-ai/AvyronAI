import "dotenv/config";
import { describe, it, expect } from "vitest";
import { db } from "../db";
import { orchestratorJobs, strategicPlans } from "@shared/schema";
import { resolveRunId } from "../orchestrator/run-resolver";
import { eq } from "drizzle-orm";

describe("Production Plan Linkage & Resolver Invariants (Parts 7 & 8)", () => {
  const testCampaignId = `campaign_test_${Date.now()}`;
  const testAccountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  it("PART 7: Production Job creation links planId and resolves correctly via resolveRunId", async () => {
    const jobId = `orch_test_${Date.now()}_1`;
    const planId = `plan_test_${Date.now()}_1`;

    // 1. Create strategic plan (simulating synthesizePlan output)
    await db.insert(strategicPlans).values({
      id: planId,
      blueprintId: "orchestrator-v2",
      campaignId: testCampaignId,
      accountId: testAccountId,
      status: "APPROVED",
      planJson: JSON.stringify({ test: true }),
    });

    // 2. Production orchestrator inserts job and sets planId + status: COMPLETED on finish
    await db.insert(orchestratorJobs).values({
      id: jobId,
      blueprintId: "orchestrator-v2",
      accountId: testAccountId,
      campaignId: testCampaignId,
      status: "COMPLETED",
      planId: planId,
      completedAt: new Date(),
    });

    // 3. Verify orchestrator_jobs[jobId].planId === planId
    const [job] = await db
      .select()
      .from(orchestratorJobs)
      .where(eq(orchestratorJobs.id, jobId));
    expect(job).toBeDefined();
    expect(job.planId).toBe(planId);
    expect(job.status).toBe("COMPLETED");

    // 4. Verify resolveRunId(campaignId, accountId) returns the exact same planId
    const resolved = await resolveRunId(testCampaignId, testAccountId);
    expect(resolved.runId).toBe(jobId);
    expect(resolved.planId).toBe(planId);
  });

  it("PART 8: Failure mode test - Newer completed job resolves over older job", async () => {
    const oldJobId = `orch_old_${Date.now()}`;
    const oldPlanId = `plan_old_${Date.now()}`;
    const newJobId = `orch_new_${Date.now()}`;
    const newPlanId = `plan_new_${Date.now()}`;

    // Old job completed 10 minutes ago
    const oldTime = new Date(Date.now() - 10 * 60 * 1000);
    await db.insert(strategicPlans).values({
      id: oldPlanId,
      blueprintId: "orchestrator-v2",
      campaignId: testCampaignId,
      accountId: testAccountId,
      status: "APPROVED",
      planJson: JSON.stringify({ version: "old" }),
    });
    await db.insert(orchestratorJobs).values({
      id: oldJobId,
      blueprintId: "orchestrator-v2",
      accountId: testAccountId,
      campaignId: testCampaignId,
      status: "COMPLETED",
      planId: oldPlanId,
      completedAt: oldTime,
    });

    // New job completed now
    const newTime = new Date();
    await db.insert(strategicPlans).values({
      id: newPlanId,
      blueprintId: "orchestrator-v2",
      campaignId: testCampaignId,
      accountId: testAccountId,
      status: "APPROVED",
      planJson: JSON.stringify({ version: "new" }),
    });
    await db.insert(orchestratorJobs).values({
      id: newJobId,
      blueprintId: "orchestrator-v2",
      accountId: testAccountId,
      campaignId: testCampaignId,
      status: "COMPLETED",
      planId: newPlanId,
      completedAt: newTime,
    });

    // Resolve active plan
    const resolved = await resolveRunId(testCampaignId, testAccountId);
    expect(resolved.runId).toBe(newJobId);
    expect(resolved.planId).toBe(newPlanId);
    expect(resolved.planId).not.toBe(oldPlanId);
  });
});
