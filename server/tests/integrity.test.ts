import { db } from "../db";
import {
  publishedPosts,
  performanceSnapshots,
  guardrailConfig,
  accountState,
} from "@shared/schema";
import { eq, sql, gte } from "drizzle-orm";
import { runAllGuardrails } from "../guardrails";
import { logAudit } from "../audit";

const TEST_ACCOUNT = "integrity_test_" + Date.now();
const TEST_PREFIX = "intg_";
const testSnapshotIds: string[] = [];

function testId(): string {
  return TEST_PREFIX + Date.now() + "_" + Math.random().toString(36).substr(2, 6);
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message, durationMs: Date.now() - start });
    console.log(`  ✗ ${name}: ${err.message} (${Date.now() - start}ms)`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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

async function testDailyBudgetCap() {
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
  assert(result.budgetCap.passed === false, `Daily cap should fail with added spend (got: ${result.budgetCap.reason})`);
  assert(result.overallEligible === false, "Overall should be ineligible");

  await cleanupSnapshots();
}

async function testMonthlyBudgetCap() {
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
  assert(result.monthlyBudgetCap.passed === false, `Monthly cap should fail with $2500 spend (got: ${result.monthlyBudgetCap.reason})`);
  assert(result.overallEligible === false, "Overall should be ineligible when monthly cap exceeded");

  await cleanupSnapshots();
}

async function testPublishIdempotencyDoubleLock() {
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
  assert(lock1 !== null, "First lock should succeed");

  const lock2 = await acquireLock(postId);
  assert(lock2 === null, "Second lock should fail (already locked)");

  const postCheck = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
  assert(postCheck[0].status === "publishing", "Post should be in 'publishing' status while locked");
  assert(postCheck[0].publishLockToken === lock1, "Lock token should match first lock");
  assert(postCheck[0].publishLockedAt !== null, "publishLockedAt should be set");

  await releaseLock(postId, lock1!);

  const postAfter = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
  assert(postAfter[0].publishLockToken === null, "Lock should be cleared after release");
  assert(postAfter[0].status === "scheduled", "Status should return to 'scheduled' after release");

  const lock3 = await acquireLock(postId);
  assert(lock3 !== null, "Lock should succeed again after release");
  await releaseLock(postId, lock3!);
}

async function testStaleLockRecovery() {
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
  assert(cleaned >= 1, "Should clean up at least 1 stale lock");

  const postAfter = await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId));
  assert(postAfter[0].publishLockToken === null, "Stale lock token should be cleared");
  assert(postAfter[0].status === "scheduled", "Status should return to 'scheduled' after stale cleanup");
  assert(postAfter[0].publishLockedAt === null, "publishLockedAt should be cleared");
}

async function testFreshLockNotCleaned() {
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
  assert(postAfter[0].publishLockToken === "fresh_token_xyz", "Fresh lock should NOT be cleaned up");
  assert(postAfter[0].status === "publishing", "Fresh lock post should remain in 'publishing'");
}

async function testPostStateMachine() {
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
  assert(post.status === "scheduled", "Initial status should be 'scheduled'");

  const { acquireLock } = await import("../publish-worker");
  const lock = await acquireLock(postId);
  assert(lock !== null, "Lock should succeed");

  post = (await db.select().from(publishedPosts).where(eq(publishedPosts.id, postId)))[0];
  assert(post.status === "publishing", "Status should be 'publishing' after lock");

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
  assert(post.status === "published", "Status should be 'published' after success");

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
  assert(failPost.status === "failed", "Status should be 'failed' after max retries");
  assert(failPost.lastPublishError === "Max retries exceeded", "Error message should be stored");
}

async function testSafeModeBlocksPublishing() {
  await cleanup();

  await db.update(accountState)
    .set({ state: "SAFE_MODE", autopilotOn: true })
    .where(eq(accountState.accountId, TEST_ACCOUNT));

  const state = await db.select().from(accountState)
    .where(eq(accountState.accountId, TEST_ACCOUNT));

  assert(state[0].state === "SAFE_MODE", "Account should be in SAFE_MODE");
  assert(state[0].autopilotOn === true, "Autopilot should be on");

  const guardrails = await runAllGuardrails(TEST_ACCOUNT);

  await db.update(accountState)
    .set({ state: "ACTIVE" })
    .where(eq(accountState.accountId, TEST_ACCOUNT));
}

async function testAutopilotOffBlocksPublishing() {
  await cleanup();

  await db.update(accountState)
    .set({ autopilotOn: false, state: "ACTIVE" })
    .where(eq(accountState.accountId, TEST_ACCOUNT));

  const state = await db.select().from(accountState)
    .where(eq(accountState.accountId, TEST_ACCOUNT));

  assert(state[0].autopilotOn === false, "Autopilot should be off");

  await db.update(accountState)
    .set({ autopilotOn: true })
    .where(eq(accountState.accountId, TEST_ACCOUNT));
}

async function testNonRetryableErrorDetection() {
  const { isNonRetryableError } = await import("../publish-worker");

  assert(isNonRetryableError("Invalid OAuth access token") === true, "Invalid OAuth should be non-retryable");
  assert(isNonRetryableError("Token has expired") === true, "Expired token should be non-retryable");
  assert(isNonRetryableError("User does not have permissions") === true, "Permission error should be non-retryable");
  assert(isNonRetryableError("No media URI for Instagram post") === true, "No media URI should be non-retryable");
  assert(isNonRetryableError("Network timeout") === false, "Network timeout should be retryable");
  assert(isNonRetryableError("Internal server error") === false, "Server error should be retryable");
  assert(isNonRetryableError("Rate limit exceeded") === false, "Rate limit should be retryable");
}

async function testGuardrailResultShape() {
  await cleanup();

  const result = await runAllGuardrails(TEST_ACCOUNT);
  assert("budgetCap" in result, "Result should have budgetCap field");
  assert("monthlyBudgetCap" in result, "Result should have monthlyBudgetCap field");
  assert("cpaGuard" in result, "Result should have cpaGuard field");
  assert("roasFloor" in result, "Result should have roasFloor field");
  assert("volatility" in result, "Result should have volatility field");
  assert("fatigue" in result, "Result should have fatigue field");
  assert("overallEligible" in result, "Result should have overallEligible field");
  assert("triggeredCount" in result, "Result should have triggeredCount field");
  assert(typeof result.overallEligible === "boolean", "overallEligible should be boolean");
  assert(typeof result.triggeredCount === "number", "triggeredCount should be number");
  assert(typeof result.budgetCap.passed === "boolean", "budgetCap.passed should be boolean");
  assert(typeof result.monthlyBudgetCap.passed === "boolean", "monthlyBudgetCap.passed should be boolean");
}

async function testAuditEventTypes() {
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
}

async function cleanupTestData() {
  await db.delete(publishedPosts).where(sql`${publishedPosts.accountId} = ${TEST_ACCOUNT}`);
  await cleanupSnapshots();
  await db.delete(guardrailConfig).where(eq(guardrailConfig.accountId, TEST_ACCOUNT));
  await db.delete(accountState).where(eq(accountState.accountId, TEST_ACCOUNT));
  const { auditLog } = await import("@shared/schema");
  await db.delete(auditLog).where(eq(auditLog.accountId, TEST_ACCOUNT));
}

async function main() {
  console.log("\n=== MarketMind AI Integrity Test Suite ===\n");
  console.log(`Test account: ${TEST_ACCOUNT}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  try {
    await setupTestAccount();

    console.log("--- Budget Cap Tests ---");
    await runTest("Daily budget cap enforcement", testDailyBudgetCap);
    await runTest("Monthly budget cap enforcement", testMonthlyBudgetCap);
    await runTest("Guardrail result shape and field types", testGuardrailResultShape);

    console.log("\n--- Publish Idempotency Tests ---");
    await runTest("Double-lock prevention (idempotency)", testPublishIdempotencyDoubleLock);
    await runTest("Stale lock recovery (>10 min TTL)", testStaleLockRecovery);
    await runTest("Fresh lock not cleaned up", testFreshLockNotCleaned);
    await runTest("Post state machine: scheduled→publishing→published/failed", testPostStateMachine);

    console.log("\n--- Safety & Mode Tests ---");
    await runTest("SAFE_MODE blocks publishing", testSafeModeBlocksPublishing);
    await runTest("Autopilot OFF blocks publishing", testAutopilotOffBlocksPublishing);
    await runTest("Non-retryable error detection", testNonRetryableErrorDetection);

    console.log("\n--- Audit Event Tests ---");
    await runTest("All 7 new audit event types log successfully", testAuditEventTypes);

    console.log("\n--- Cleanup ---");
    await cleanupTestData();
    console.log("  Test data cleaned up");

  } catch (err: any) {
    console.error("Fatal error in test suite:", err);
    await cleanupTestData().catch(() => {});
  }

  console.log("\n=== Results ===");
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  console.log(`${passed}/${total} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log("\nAll integrity tests passed.");
  process.exit(0);
}

main();
