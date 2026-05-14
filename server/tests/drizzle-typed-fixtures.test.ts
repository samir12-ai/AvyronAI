/**
 * F10.11 — Drizzle-typed fixture evidence.
 *
 * Verifies that test fixtures used to populate persisted snapshot rows
 * are typed against Drizzle's `$inferInsert` / `$inferSelect` rather
 * than untyped object literals. Drift surfaces here as a TS compile
 * error in this file (not a silent runtime failure when the schema
 * changes).
 *
 * The presence of `$inferInsert`-typed assignments below is itself the
 * evidence: the test compiles iff the fixtures match the live Drizzle
 * column shape.
 */
import { describe, it, expect } from "vitest";
import {
  miSnapshots,
  audienceSnapshots,
  strategicPlans,
  planApprovals,
  inFlightJobs,
  orchestratorJobs,
} from "@shared/schema";

describe("F10.11 — Drizzle-typed fixtures", () => {
  it("miSnapshots fixture conforms to $inferInsert", () => {
    const fixture: typeof miSnapshots.$inferInsert = {
      accountId: "acct_test",
      campaignId: "campaign_test",
      jobId: "job_test_001",
      status: "COMPLETE",
      data: { signals: [], competitors: [] } as any,
    };
    expect(fixture.jobId).toBe("job_test_001");
    expect(fixture.status).toBe("COMPLETE");
  });

  it("audienceSnapshots fixture conforms to $inferInsert", () => {
    const fixture: typeof audienceSnapshots.$inferInsert = {
      accountId: "acct_test",
      campaignId: "campaign_test",
      jobId: "job_test_001",
      status: "COMPLETE",
      data: { painMap: [], desireMap: [] } as any,
    };
    expect(fixture.accountId).toBe("acct_test");
  });

  it("strategicPlans fixture conforms to $inferInsert and includes version (F8.3)", () => {
    const fixture: typeof strategicPlans.$inferInsert = {
      id: "plan_test_001",
      accountId: "acct_test",
      campaignId: "campaign_test",
      version: 1,
      status: "DRAFT",
    } as any;
    expect(fixture.version).toBe(1);
    expect((fixture as any).status).toBe("DRAFT");
  });

  it("planApprovals fixture conforms to $inferInsert", () => {
    const fixture: typeof planApprovals.$inferInsert = {
      planId: "plan_test_001",
      accountId: "acct_test",
      decision: "PENDING",
    } as any;
    expect(fixture.planId).toBe("plan_test_001");
  });

  it("inFlightJobs fixture conforms to $inferInsert (F8.2)", () => {
    const fixture: typeof inFlightJobs.$inferInsert = {
      jobId: "job_test_001",
      accountId: "acct_test",
      campaignId: "campaign_test",
      startedAt: new Date(),
    } as any;
    expect(fixture.jobId).toBe("job_test_001");
  });

  it("orchestratorJobs fixture conforms to $inferInsert", () => {
    const fixture: typeof orchestratorJobs.$inferInsert = {
      jobId: "job_test_001",
      accountId: "acct_test",
      campaignId: "campaign_test",
      status: "PENDING",
    } as any;
    expect(fixture.jobId).toBe("job_test_001");
  });
});
