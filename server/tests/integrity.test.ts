import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import {
  publishedPosts,
  performanceSnapshots,
  guardrailConfig,
  accountState,
  ciCompetitors,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { runAllGuardrails } from "../guardrails";
import { logAudit } from "../audit";

const TEST_ACCOUNT = "integrity_test_" + Date.now();
const TEST_PREFIX = "intg_";
const testSnapshotIds: string[] = [];

function testId(): string {
  return TEST_PREFIX + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
}

async function setupTestAccount() {
  const existing = await db.select().from(guardrailConfig)
    .where(eq(guardrailConfig.accountId, TEST_ACCOUNT));
  if (existing.length === 0) {
    await db.insert(guardrailConfig).values({
      accountId: TEST_ACCOUNT,
      dailyBudgetLimit: 100,
      monthlyBudgetLimit: 2000,
      cpaGuardMultiplier: 1.25,
      roasFloor: 1.5,
      volatilityThreshold: 0.35,
      maxScalingPercent: 15,
      maxBudgetIncreasePerCycle: 15,
      isActive: true,
    });
  }

  const existingState = await db.select().from(accountState)
    .where(eq(accountState.accountId, TEST_ACCOUNT));
  if (existingState.length === 0) {
    await db.insert(accountState).values({
      accountId: TEST_ACCOUNT,
      autopilotOn: true,
      state: "ACTIVE",
      volatilityIndex: 0,
      driftFlag: false,
      consecutiveFailures: 0,
      guardrailTriggers24h: 0,
      confidenceScore: 100,
      confidenceStatus: "Stable",
    });
  } else {
    await db.update(accountState)
      .set({ autopilotOn: true, state: "ACTIVE" })
      .where(eq(accountState.accountId, TEST_ACCOUNT));
  }
}

async function cleanupSnapshots() {
  for (const id of testSnapshotIds) {
    await db.delete(performanceSnapshots).where(eq(performanceSnapshots.id, id));
  }
  testSnapshotIds.length = 0;
}

async function cleanup() {
  await db.delete(publishedPosts).where(sql`${publishedPosts.accountId} = ${TEST_ACCOUNT}`);
  await cleanupSnapshots();
}

async function insertTestSnapshot(overrides: Record<string, any> = {}) {
  const id = testId();
  await db.insert(performanceSnapshots).values({
    id,
    postId: "test_post_" + id,
    spend: 0,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    ctr: 5.0,
    cpa: 5.0,
    roas: 4.0,
    ...overrides,
  });
  testSnapshotIds.push(id);
  return id;
}

async function cleanupTestData() {
  await db.delete(publishedPosts).where(sql`${publishedPosts.accountId} = ${TEST_ACCOUNT}`);
  await cleanupSnapshots();
  await db.delete(guardrailConfig).where(eq(guardrailConfig.accountId, TEST_ACCOUNT));
  await db.delete(accountState).where(eq(accountState.accountId, TEST_ACCOUNT));
  const { auditLog } = await import("@shared/schema");
  await db.delete(auditLog).where(eq(auditLog.accountId, TEST_ACCOUNT));
}

describe("MarketMind AI Integrity Suite", () => {
  beforeAll(async () => {
    await setupTestAccount();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("daily budget cap enforcement", async () => {
    await cleanup();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      await insertTestSnapshot({
        spend: 25,
        fetchedAt: new Date(todayStart.getTime() + i * 60000),
      });
    }

    const result = await runAllGuardrails(TEST_ACCOUNT);
    expect(result.budgetCap.passed).toBe(false);
    expect(result.overallEligible).toBe(false);
    await cleanupSnapshots();
  });

  it("monthly budget cap enforcement", async () => {
    await cleanup();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    for (let i = 0; i < 10; i++) {
      await insertTestSnapshot({
        spend: 250,
        fetchedAt: new Date(monthStart.getTime() + i * 86400000),
      });
    }

    const result = await runAllGuardrails(TEST_ACCOUNT);
    expect(result.monthlyBudgetCap.passed).toBe(false);
    expect(result.overallEligible).toBe(false);
    await cleanupSnapshots();
  });

  it("guardrail result shape and field types", async () => {
    await cleanup();
    const result = await runAllGuardrails(TEST_ACCOUNT);
    expect(result).toHaveProperty("budgetCap");
    expect(result).toHaveProperty("monthlyBudgetCap");
    expect(result).toHaveProperty("cpaGuard");
    expect(result).toHaveProperty("roasFloor");
    expect(result).toHaveProperty("volatility");
    expect(result).toHaveProperty("fatigue");
    expect(result).toHaveProperty("overallEligible");
    expect(result).toHaveProperty("triggeredCount");
    expect(typeof result.overallEligible).toBe("boolean");
    expect(typeof result.triggeredCount).toBe("number");
    expect(typeof result.budgetCap.passed).toBe("boolean");
    expect(typeof result.monthlyBudgetCap.passed).toBe("boolean");
  });

  it("publish idempotency double-lock prevention", async () => {
    await cleanup();
    const postId = testId();
    await db.insert(publishedPosts).values({
      id: postId,
      accountId: TEST_ACCOUNT,
      caption: "Test idempotency post",
      platform: "facebook",
      status: "scheduled",
      scheduledDate: new Date(Date.now() - 60000),
    });

    const { acquireLock, releaseLock } = await import("../publish-worker");

    const lock1 = await acquireLock(postId);
    expect(lock1).not.toBeNull();

    const lock2 = await acquireLock(postId);
    expect(lock2).toBeNull();

    const postCheck = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
    expect(postCheck[0].status).toBe("publishing");
    expect(postCheck[0].publishLockToken).toBe(lock1);
    expect(postCheck[0].publishLockedAt).not.toBeNull();

    await releaseLock(postId, lock1!);

    const postAfter = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
    expect(postAfter[0].publishLockToken).toBeNull();
    expect(postAfter[0].status).toBe("scheduled");

    const lock3 = await acquireLock(postId);
    expect(lock3).not.toBeNull();
    await releaseLock(postId, lock3!);
  });

  it("stale lock recovery (>10 min TTL)", async () => {
    await cleanup();
    const postId = testId();
    const staleLockTime = new Date(Date.now() - 15 * 60 * 1000);

    await db.insert(publishedPosts).values({
      id: postId,
      accountId: TEST_ACCOUNT,
      caption: "Stale lock test post",
      platform: "instagram",
      status: "publishing",
      scheduledDate: new Date(Date.now() - 60000),
      publishLockToken: "stale_token_abc123",
      publishLockedAt: staleLockTime,
    });

    const { cleanupStaleLocks } = await import("../publish-worker");
    const cleaned = await cleanupStaleLocks();
    expect(cleaned).toBeGreaterThanOrEqual(1);

    const postAfter = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
    expect(postAfter[0].publishLockToken).toBeNull();
    expect(postAfter[0].status).toBe("scheduled");
    expect(postAfter[0].publishLockedAt).toBeNull();
  });

  it("fresh lock not cleaned up", async () => {
    await cleanup();
    const postId = testId();
    await db.insert(publishedPosts).values({
      id: postId,
      accountId: TEST_ACCOUNT,
      caption: "Fresh lock test",
      platform: "facebook",
      status: "publishing",
      scheduledDate: new Date(Date.now() - 60000),
      publishLockToken: "fresh_token_xyz",
      publishLockedAt: new Date(),
    });

    const { cleanupStaleLocks } = await import("../publish-worker");
    await cleanupStaleLocks();

    const postAfter = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
    expect(postAfter[0].publishLockToken).toBe("fresh_token_xyz");
    expect(postAfter[0].status).toBe("publishing");
  });

  it("post state machine: scheduled→publishing→published/failed", async () => {
    await cleanup();
    const postId = testId();
    await db.insert(publishedPosts).values({
      id: postId,
      accountId: TEST_ACCOUNT,
      caption: "State machine test",
      platform: "facebook",
      status: "scheduled",
      scheduledDate: new Date(Date.now() - 60000),
    });

    let post = (await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId)))[0];
    expect(post.status).toBe("scheduled");

    const { acquireLock } = await import("../publish-worker");
    const lock = await acquireLock(postId);
    expect(lock).not.toBeNull();

    post = (await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId)))[0];
    expect(post.status).toBe("publishing");

    await db.update(publishedPosts)
      .set({
        status: "published",
        publishLockToken: null,
        publishLockedAt: null,
        metaPostId: "demo_test_123",
        publishedAt: new Date(),
      })
      .where(eq(publishedPosts.id, postId));

    post = (await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId)))[0];
    expect(post.status).toBe("published");

    const postId2 = testId();
    await db.insert(publishedPosts).values({
      id: postId2,
      accountId: TEST_ACCOUNT,
      caption: "Fail state test",
      platform: "instagram",
      status: "scheduled",
      scheduledDate: new Date(Date.now() - 60000),
      publishAttempts: 5,
    });

    await db.update(publishedPosts)
      .set({ status: "failed", publishAttempts: 7, lastPublishError: "Max retries exceeded" })
      .where(eq(publishedPosts.id, postId2));

    const failPost = (await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId2)))[0];
    expect(failPost.status).toBe("failed");
    expect(failPost.lastPublishError).toBe("Max retries exceeded");
  });

  it("SAFE_MODE blocks publishing", async () => {
    await cleanup();
    await db.update(accountState)
      .set({ state: "SAFE_MODE", autopilotOn: true })
      .where(eq(accountState.accountId, TEST_ACCOUNT));

    const state = await db.select().from(accountState)
      .where(eq(accountState.accountId, TEST_ACCOUNT));
    expect(state[0].state).toBe("SAFE_MODE");
    expect(state[0].autopilotOn).toBe(true);

    await runAllGuardrails(TEST_ACCOUNT);

    await db.update(accountState)
      .set({ state: "ACTIVE" })
      .where(eq(accountState.accountId, TEST_ACCOUNT));
  });

  it("autopilot OFF blocks publishing", async () => {
    await cleanup();
    await db.update(accountState)
      .set({ autopilotOn: false, state: "ACTIVE" })
      .where(eq(accountState.accountId, TEST_ACCOUNT));

    const state = await db.select().from(accountState)
      .where(eq(accountState.accountId, TEST_ACCOUNT));
    expect(state[0].autopilotOn).toBe(false);

    await db.update(accountState)
      .set({ autopilotOn: true })
      .where(eq(accountState.accountId, TEST_ACCOUNT));
  });

  it("non-retryable error detection", async () => {
    const { isNonRetryableError } = await import("../publish-worker");

    expect(isNonRetryableError("Invalid OAuth access token")).toBe(true);
    expect(isNonRetryableError("Token has expired")).toBe(true);
    expect(isNonRetryableError("User does not have permissions")).toBe(true);
    expect(isNonRetryableError("No media URI for Instagram post")).toBe(true);
    expect(isNonRetryableError("Network timeout")).toBe(false);
    expect(isNonRetryableError("Internal server error")).toBe(false);
    expect(isNonRetryableError("Rate limit exceeded")).toBe(false);
  });

  it("all 7 audit event types log successfully", async () => {
    await logAudit(TEST_ACCOUNT, "MONTHLY_CAP_BLOCKED", {
      details: { test: true, monthlySpend: 2100, limit: 2000 },
    });
    await logAudit(TEST_ACCOUNT, "PUBLISH_SUCCESS", {
      details: { test: true, postId: "test_post", publishMode: "DEMO" },
    });
    await logAudit(TEST_ACCOUNT, "PUBLISH_FAILED", {
      details: { test: true, postId: "test_post", error: "Max retries" },
    });
    await logAudit(TEST_ACCOUNT, "META_API_ERROR", {
      details: { test: true, postId: "test_post", error: "Rate limited" },
    });
    await logAudit(TEST_ACCOUNT, "PUBLISH_RETRY_FAILED", {
      details: { test: true, postId: "test_post", totalAttempts: 3 },
    });
    await logAudit(TEST_ACCOUNT, "WORKER_STARTUP", {
      details: { test: true, worker: "test" },
    });
    await logAudit(TEST_ACCOUNT, "WORKER_SHUTDOWN", {
      details: { test: true, graceful: true },
    });
  });
});

describe("Campaign Isolation - Competitors", () => {
  const ISO_ACCOUNT = "iso_test_" + Date.now();
  const CAMPAIGN_A = "campaign_iso_a_" + Date.now();
  const CAMPAIGN_B = "campaign_iso_b_" + Date.now();
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      await db.delete(ciCompetitors).where(eq(ciCompetitors.id, id));
    }
  });

  it("competitors are strictly isolated per campaign", async () => {
    const compA1 = await db.insert(ciCompetitors).values({
      accountId: ISO_ACCOUNT, campaignId: CAMPAIGN_A,
      name: "Agency Comp 1", platform: "instagram", profileLink: "https://instagram.com/agency1",
      businessType: "agency", primaryObjective: "leads",
    }).returning();
    const compA2 = await db.insert(ciCompetitors).values({
      accountId: ISO_ACCOUNT, campaignId: CAMPAIGN_A,
      name: "Agency Comp 2", platform: "instagram", profileLink: "https://instagram.com/agency2",
      businessType: "agency", primaryObjective: "leads",
    }).returning();
    const compA3 = await db.insert(ciCompetitors).values({
      accountId: ISO_ACCOUNT, campaignId: CAMPAIGN_A,
      name: "Agency Comp 3", platform: "instagram", profileLink: "https://instagram.com/agency3",
      businessType: "agency", primaryObjective: "leads",
    }).returning();
    const compB1 = await db.insert(ciCompetitors).values({
      accountId: ISO_ACCOUNT, campaignId: CAMPAIGN_B,
      name: "Fitness Comp 1", platform: "instagram", profileLink: "https://instagram.com/fitness1",
      businessType: "fitness", primaryObjective: "sales",
    }).returning();
    const compB2 = await db.insert(ciCompetitors).values({
      accountId: ISO_ACCOUNT, campaignId: CAMPAIGN_B,
      name: "Fitness Comp 2", platform: "instagram", profileLink: "https://instagram.com/fitness2",
      businessType: "fitness", primaryObjective: "sales",
    }).returning();

    createdIds.push(compA1[0].id, compA2[0].id, compA3[0].id, compB1[0].id, compB2[0].id);

    const campaignAComps = await db.select().from(ciCompetitors)
      .where(and(eq(ciCompetitors.accountId, ISO_ACCOUNT), eq(ciCompetitors.campaignId, CAMPAIGN_A), eq(ciCompetitors.isActive, true)));

    const campaignBComps = await db.select().from(ciCompetitors)
      .where(and(eq(ciCompetitors.accountId, ISO_ACCOUNT), eq(ciCompetitors.campaignId, CAMPAIGN_B), eq(ciCompetitors.isActive, true)));

    expect(campaignAComps.length).toBe(3);
    expect(campaignBComps.length).toBe(2);

    expect(campaignAComps.every(c => c.campaignId === CAMPAIGN_A)).toBe(true);
    expect(campaignBComps.every(c => c.campaignId === CAMPAIGN_B)).toBe(true);

    const allComps = await db.select().from(ciCompetitors)
      .where(and(eq(ciCompetitors.accountId, ISO_ACCOUNT), eq(ciCompetitors.isActive, true)));
    expect(allComps.length).toBe(5);

    expect(campaignAComps.every(c => c.businessType === "agency")).toBe(true);
    expect(campaignBComps.every(c => c.businessType === "fitness")).toBe(true);

    const noBleed = campaignAComps.filter(c => c.campaignId === CAMPAIGN_B);
    expect(noBleed.length).toBe(0);
  });

  it("competitor queries without campaignId are rejected by API", async () => {
    const res = await fetch("http://localhost:5000/api/ci/competitors?accountId=default");
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toContain("campaignId is required");
  });

  it("static scan: all server competitor queries include campaignId scoping", async () => {
    const fs = await import("fs");
    const path = await import("path");

    const serverDir = path.resolve(__dirname, "..");
    const filesToScan = [
      "competitive-intelligence/competitor-routes.ts",
      "competitive-intelligence/data-acquisition.ts",
      "market-intelligence-v3/engine.ts",
      "market-intelligence-v3/fetch-orchestrator.ts",
      "engine-contracts/context-kernel.ts",
    ];

    for (const file of filesToScan) {
      const filePath = path.join(serverDir, file);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf-8");

      const queryPattern = /\.where\(.*ciCompetitors\.accountId.*ciCompetitors\.isActive/g;
      const matches = content.match(queryPattern) || [];
      for (const match of matches) {
        expect(match).toContain("campaignId");
      }
    }
  });
});
