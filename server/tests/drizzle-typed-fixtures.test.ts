/**
 * F10.11 — Drizzle-typed fixture evidence.
 *
 * Verifies that test fixtures used to populate persisted snapshot rows
 * are typed against Drizzle's `$inferInsert` rather than untyped object
 * literals. Drift surfaces here as a TS compile error in this file, not
 * a silent runtime failure when the schema changes.
 *
 * Hardening note (Seal #12 round-2 architect review): every fixture
 * uses `satisfies` against `$inferInsert` — NO `as any`, NO `as unknown
 * as ...` escapes. If a column is renamed, dropped, or its type narrows,
 * `tsc` rejects this file at compile time.
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
  it("miSnapshots fixture conforms to $inferInsert (real text columns)", () => {
    const fixture = {
      accountId: "acct_test",
      campaignId: "campaign_test",
      jobId: "job_test_001",
      status: "COMPLETE",
      competitorData: JSON.stringify({ competitors: [] }),
      signalData: JSON.stringify({ signals: [] }),
      executionMode: "FULL",
      overallConfidence: 0.5,
    } satisfies typeof miSnapshots.$inferInsert;
    expect(fixture.jobId).toBe("job_test_001");
    expect(fixture.status).toBe("COMPLETE");
  });

  it("audienceSnapshots fixture conforms to $inferInsert", () => {
    const fixture = {
      accountId: "acct_test",
      campaignId: "campaign_test",
      jobId: "job_test_001",
      engineVersion: 3,
      audiencePains: JSON.stringify([]),
      desireMap: JSON.stringify([]),
      structuredSignals: JSON.stringify([]),
    } satisfies typeof audienceSnapshots.$inferInsert;
    expect(fixture.accountId).toBe("acct_test");
    expect(fixture.engineVersion).toBe(3);
  });

  it("strategicPlans fixture conforms to $inferInsert and includes version (F8.3)", () => {
    const fixture = {
      id: "plan_test_001",
      accountId: "acct_test",
      blueprintId: "bp_test",
      campaignId: "campaign_test",
      planJson: JSON.stringify({ sections: [] }),
      status: "DRAFT",
      executionStatus: "IDLE",
      version: 1,
    } satisfies typeof strategicPlans.$inferInsert;
    expect(fixture.version).toBe(1);
    expect(fixture.status).toBe("DRAFT");
  });

  it("planApprovals fixture conforms to $inferInsert (F8.4 optimistic locking)", () => {
    const fixture = {
      planId: "plan_test_001",
      accountId: "acct_test",
      decision: "PENDING",
      version: 1,
    } satisfies typeof planApprovals.$inferInsert;
    expect(fixture.planId).toBe("plan_test_001");
    expect(fixture.version).toBe(1);
  });

  it("inFlightJobs fixture conforms to $inferInsert (F8.2 lifecycle)", () => {
    const fixture = {
      jobId: "job_test_001",
      accountId: "acct_test",
      campaignId: "campaign_test",
      startedAt: new Date(),
    } satisfies typeof inFlightJobs.$inferInsert;
    expect(fixture.jobId).toBe("job_test_001");
  });

  it("orchestratorJobs fixture conforms to $inferInsert (uses id PK, not jobId)", () => {
    const fixture = {
      id: "job_test_001",
      blueprintId: "bp_test",
      accountId: "acct_test",
      campaignId: "campaign_test",
      status: "RUNNING",
    } satisfies typeof orchestratorJobs.$inferInsert;
    expect(fixture.id).toBe("job_test_001");
    expect(fixture.status).toBe("RUNNING");
  });
});
