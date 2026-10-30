import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import bcrypt from "bcryptjs";
import http from "http";
import { generateAccessToken, verifyToken } from "../auth";
import { registerAuthRoutes } from "../auth";
import { registerStrategyExperienceRoutes } from "../strategy-experience/routes";
import { whatToDoTodayRouter } from "../what-to-do-today/routes";
import { registerCreativeRoutes } from "../creative-routes";
import { reportsRouter } from "../reports-routes";
import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { StrategyExperienceService } from "../strategy-experience/service";
import { assembleDashboardOverview } from "../dashboard/overview-engine";

describe("Runtime Cleanup & Truth Enforcement Regression Suite", () => {
  let server: http.Server;
  let baseUrl: string;
  const testAccountId = "acc_test_truth_101";
  const otherAccountId = "acc_test_intruder_202";
  const testCampaignId = "camp_test_truth_303";
  let testUserId: string;
  let testAuthToken: string;
  let intruderAuthToken: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    // Middleware mirroring production index.ts auth gate
    app.use((req: any, res, next) => {
      const auth = req.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        const token = auth.slice(7);
        const payload = verifyToken(token);
        if (payload) {
          req.userId = payload.userId;
          req.accountId = payload.accountId;
          req.user = { id: payload.userId, accountId: payload.accountId, role: "owner" };
        }
      }
      next();
    });

    registerAuthRoutes(app);
    registerStrategyExperienceRoutes(app);
    registerCreativeRoutes(app);
    app.use("/api/what-to-do-today", whatToDoTodayRouter);
    app.use("/api/reports", reportsRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Setup test user in database
    const rawPass = "  pass with spaces  ";
    const hashed = await bcrypt.hash(rawPass, 10);
    const uniqueSuffix = Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const email = `truth_test_${uniqueSuffix}@test.com`;

    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        username: `TruthTester_${uniqueSuffix}`,
        password: hashed,
        accountId: testAccountId,
        role: "owner",
        subscriptionStatus: "active",
      })
      .returning();

    testUserId = user.id;
    testAuthToken = generateAccessToken(testUserId, user.email, testAccountId);

    intruderAuthToken = generateAccessToken("intruder_user_id", "intruder@test.com", otherAccountId);

    // Create campaign selection for test account
    await db
      .insert(schema.campaignSelections)
      .values({
        accountId: testAccountId,
        selectedCampaignId: testCampaignId,
        selectedCampaignName: "Test Campaign",
        campaignGoalType: "conversions",
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      if (testUserId) {
        await db.delete(schema.users).where(eq(schema.users.id, testUserId));
      }
      await db.delete(schema.campaignSelections).where(eq(schema.campaignSelections.accountId, testAccountId));
      await db.delete(schema.strategicPlans).where(eq(schema.strategicPlans.accountId, testAccountId));
      await db.delete(schema.strategyRoots).where(eq(schema.strategyRoots.accountId, testAccountId));
    } catch {}
  });

  describe("1. Authentication & Backdoor Elimination", () => {
    it("rejects login when password is missing or blank", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/required/i);
    });

    it("verifies passwords verbatim without trimming leading/trailing spaces", async () => {
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, testUserId)).limit(1);

      // Attempt login with trimmed password (which is wrong)
      const resTrimmed = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email, password: "pass with spaces" }),
      });
      expect(resTrimmed.status).toBe(401);

      // Attempt login with exact password with spaces (which is correct)
      const resExact = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email, password: "  pass with spaces  " }),
      });
      const exactData = await resExact.json();
      expect(resExact.status).toBe(200);
      expect(exactData.token).toBeDefined();
    });

    it("rejects dev-user-mock-uuid backdoor token on /api/auth/me", async () => {
      const backdoorToken = generateAccessToken(
        "dev-user-mock-uuid",
        "dev@avyron.test",
        "dev-account-mock-uuid"
      );

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${backdoorToken}` },
      });
      const data = await res.json();

      // Backdoor was removed; dev-user-mock-uuid has no database row -> returns 404
      expect(res.status).not.toBe(200);
      expect(data.user?.email).not.toBe("dev@avyron.test");
    });
  });

  describe("2. Strategy Lifecycle Semantics & Plan Resolution", () => {
    it("labels candidate DRAFT as DRAFT, never as LIVE", async () => {
      const uniqueCampaign = `camp_draft_${Date.now()}`;
      await db.insert(schema.campaignSelections).values({
        accountId: testAccountId,
        selectedCampaignId: uniqueCampaign,
        selectedCampaignName: "Draft Campaign",
        campaignGoalType: "conversions",
      });

      // Insert an unapproved DRAFT plan
      await db.insert(schema.strategicPlans).values({
        accountId: testAccountId,
        campaignId: uniqueCampaign,
        blueprintId: "bp_1",
        planJson: "{}",
        status: "DRAFT",
        isDesignatedActive: false,
      });

      const res = await StrategyExperienceService.getActiveStrategy(uniqueCampaign, testAccountId, testUserId);
      expect(res.status).toBe("DRAFT");
      expect(res.status).not.toBe("LIVE");
    });

    it("resolves designated approved plan as LIVE", async () => {
      const uniqueCampaign = `camp_live_${Date.now()}`;
      await db.insert(schema.campaignSelections).values({
        accountId: testAccountId,
        selectedCampaignId: uniqueCampaign,
        selectedCampaignName: "Live Campaign",
        campaignGoalType: "conversions",
      });

      // Insert active root
      await db.insert(schema.strategyRoots).values({
        accountId: testAccountId,
        campaignId: uniqueCampaign,
        status: "ACTIVE",
        runId: `run_${Date.now()}`,
        rootHash: "hash_live_1",
        miSnapshotId: "snap_mi_1",
        audienceSnapshotId: "snap_aud_1",
        positioningSnapshotId: "snap_pos_1",
        differentiationSnapshotId: "snap_diff_1",
        mechanismSnapshotId: "snap_mech_1",
      });

      // Insert designated approved plan
      await db.insert(schema.strategicPlans).values({
        accountId: testAccountId,
        campaignId: uniqueCampaign,
        blueprintId: "bp_1",
        planJson: "{}",
        status: "APPROVED",
        isDesignatedActive: true,
      });

      const res = await StrategyExperienceService.getActiveStrategy(uniqueCampaign, testAccountId, testUserId);
      expect(res.status).toBe("LIVE");
    });

    it("does not displace an approved designated active plan when a newer draft candidate exists", async () => {
      const uniqueCampaign = `camp_preserve_live_${Date.now()}`;
      await db.insert(schema.campaignSelections).values({
        accountId: testAccountId,
        selectedCampaignId: uniqueCampaign,
        selectedCampaignName: "Preserve Live Campaign",
        campaignGoalType: "conversions",
      });

      // Insert active root
      await db.insert(schema.strategyRoots).values({
        accountId: testAccountId,
        campaignId: uniqueCampaign,
        status: "ACTIVE",
        runId: `run_${Date.now()}`,
        rootHash: "hash_live_2",
        miSnapshotId: "snap_mi_2",
        audienceSnapshotId: "snap_aud_2",
        positioningSnapshotId: "snap_pos_2",
        differentiationSnapshotId: "snap_diff_2",
        mechanismSnapshotId: "snap_mech_2",
      });

      // Insert designated active approved plan (version 1)
      const [approvedPlan] = await db.insert(schema.strategicPlans).values({
        accountId: testAccountId,
        campaignId: uniqueCampaign,
        blueprintId: "bp_1",
        planJson: "{}",
        status: "APPROVED",
        version: 1,
        isDesignatedActive: true,
      }).returning();

      // Later, user generates a candidate DRAFT (version 2)
      const [draftPlan] = await db.insert(schema.strategicPlans).values({
        accountId: testAccountId,
        campaignId: uniqueCampaign,
        blueprintId: "bp_2",
        planJson: "{}",
        status: "DRAFT",
        version: 2,
        isDesignatedActive: false,
      }).returning();

      const res = await StrategyExperienceService.getActiveStrategy(uniqueCampaign, testAccountId, testUserId);
      expect(res.status).toBe("LIVE");
      expect(res.designatedActivePlanId).toBe(approvedPlan.id);
      expect(res.candidateDraftPlanId).toBe(draftPlan.id);
    });
  });

  describe("3. Tenant Boundary & Authorization", () => {
    it("rejects cross-account access to execution routes", async () => {
      const res = await fetch(`${baseUrl}/api/what-to-do-today/today/${testCampaignId}`, {
        headers: { Authorization: `Bearer ${intruderAuthToken}` },
      });

      // Intruder account does not own testCampaignId -> 404 (CampaignOwnershipError)
      expect(res.status).toBe(404);
    });

    it("rejects unauthenticated requests to strategy active endpoint", async () => {
      const res = await fetch(`${baseUrl}/api/strategy/active/${testCampaignId}`);
      expect(res.status).toBe(401);
    });
  });

  describe("4. Synthetic Fallback Elimination", () => {
    it("returns 503 instead of persisting sample video when video provider is unconfigured", async () => {
      delete process.env.GOOGLE_GEMINI_API_KEY;

      const res = await fetch(`${baseUrl}/api/creative/generate-video`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${testAuthToken}`,
        },
        body: JSON.stringify({
          prompt: "Test prompt truth",
          aspect: "9:16",
          duration: 8,
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(503);
      expect(data.error).toBe("VIDEO_GENERATION_UNAVAILABLE");

      // Verify no row was inserted into generatedCreatives
      const creatives = await db
        .select()
        .from(schema.generatedCreatives)
        .where(
          and(
            eq(schema.generatedCreatives.accountId, testAccountId),
            eq(schema.generatedCreatives.prompt, "Test prompt truth")
          )
        );
      expect(creatives.length).toBe(0);
    });

    it("returns empty reports array without auto-seeding August 2026 demo report", async () => {
      const uniqueCampaign = `camp_clean_rep_${Date.now()}`;
      await db.insert(schema.campaignSelections).values({
        accountId: testAccountId,
        selectedCampaignId: uniqueCampaign,
        selectedCampaignName: "Clean Report Campaign",
        campaignGoalType: "conversions",
      });

      const res = await fetch(`${baseUrl}/api/reports/monthly?campaignId=${uniqueCampaign}`, {
        headers: { Authorization: `Bearer ${testAuthToken}` },
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.reports).toEqual([]);
    });

    it("does not inject synthetic tasks into overview-engine for buffer campaign", async () => {
      const bufferCampaign = `camp_buffer_test_${Date.now()}`;
      await db.insert(schema.campaignSelections).values({
        accountId: testAccountId,
        selectedCampaignId: bufferCampaign,
        selectedCampaignName: "Buffer Campaign",
        campaignGoalType: "conversions",
      });

      const overview = await assembleDashboardOverview(testAccountId, bufferCampaign, testUserId);
      expect(overview.whatToDoTodayCard.tasks.length).toBe(0);
      expect(overview.whatToDoTodayCard.tasks.some(t => t.title === "Publish YouTube product demo")).toBe(false);
    });
  });
});
