import { Router, Response } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, adminMiddleware, AuthRequest } from "./auth";

const TRIAL_DAYS = 7;

export function registerStagingAdminRoutes(app: Router) {
  const router = Router();

  router.use(authMiddleware);
  router.use(adminMiddleware);

  router.get("/users", async (_req: AuthRequest, res: Response) => {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          email: users.email,
          accountId: users.accountId,
          subscriptionStatus: users.subscriptionStatus,
          planType: users.planType,
          videoCredits: users.videoCredits,
          trialStart: users.trialStart,
          trialEnd: users.trialEnd,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(users.createdAt);

      const now = new Date();
      const enriched = allUsers.map((u) => {
        const isTrialActive = u.trialEnd ? now < u.trialEnd : false;
        const resolvedStatus =
          u.subscriptionStatus === "active"
            ? "active"
            : isTrialActive
              ? "trial"
              : "expired";
        const trialDaysRemaining = u.trialEnd
          ? Math.max(
              0,
              Math.ceil(
                (u.trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
              ),
            )
          : 0;
        return {
          ...u,
          resolvedStatus,
          trialDaysRemaining,
          trialStart: u.trialStart?.toISOString() ?? null,
          trialEnd: u.trialEnd?.toISOString() ?? null,
          createdAt: u.createdAt?.toISOString() ?? null,
        };
      });

      res.json({ users: enriched });
    } catch (error) {
      console.error("[StagingAdmin] List users error:", error);
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  router.post(
    "/users/:userId/set-subscription",
    async (req: AuthRequest, res: Response) => {
      const { userId } = req.params;
      const { subscriptionStatus, planType, videoCredits, trialEnd } = req.body;

      const validStatuses = ["trial", "active", "expired"];
      if (subscriptionStatus && !validStatuses.includes(subscriptionStatus)) {
        return res.status(400).json({
          error: `subscriptionStatus must be one of: ${validStatuses.join(", ")}`,
        });
      }

      try {
        const updateData: Record<string, any> = {};

        if (subscriptionStatus !== undefined)
          updateData.subscriptionStatus = subscriptionStatus;
        if (planType !== undefined) updateData.planType = planType;
        if (typeof videoCredits === "number")
          updateData.videoCredits = videoCredits;
        if (trialEnd !== undefined)
          updateData.trialEnd = trialEnd ? new Date(trialEnd) : null;

        if (Object.keys(updateData).length === 0) {
          return res.status(400).json({ error: "No fields provided to update" });
        }

        await db.update(users).set(updateData).where(eq(users.id, userId));

        const [updated] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!updated) {
          return res.status(404).json({ error: "User not found" });
        }

        console.log(
          `[StagingAdmin] Updated user ${userId} (${updated.email}):`,
          updateData,
        );
        res.json({
          success: true,
          user: {
            id: updated.id,
            email: updated.email,
            subscriptionStatus: updated.subscriptionStatus,
            planType: updated.planType,
            videoCredits: updated.videoCredits,
            trialEnd: updated.trialEnd?.toISOString() ?? null,
          },
        });
      } catch (error) {
        console.error("[StagingAdmin] Set subscription error:", error);
        res.status(500).json({ error: "Failed to update subscription" });
      }
    },
  );

  router.post(
    "/users/:userId/simulate/:scenario",
    async (req: AuthRequest, res: Response) => {
      const { userId, scenario } = req.params;
      const now = new Date();

      const scenarios: Record<string, Record<string, any>> = {
        trial_active: {
          subscriptionStatus: "trial",
          planType: "trial",
          trialStart: now,
          trialEnd: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
          videoCredits: 0,
        },
        trial_expiring: {
          subscriptionStatus: "trial",
          planType: "trial",
          trialStart: new Date(
            now.getTime() - (TRIAL_DAYS - 1) * 24 * 60 * 60 * 1000,
          ),
          trialEnd: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          videoCredits: 0,
        },
        trial_expired: {
          subscriptionStatus: "trial",
          planType: "trial",
          trialStart: new Date(
            now.getTime() - (TRIAL_DAYS + 1) * 24 * 60 * 60 * 1000,
          ),
          trialEnd: new Date(now.getTime() - 60 * 1000),
          videoCredits: 0,
        },
        active_growth: {
          subscriptionStatus: "active",
          planType: "paid",
          videoCredits: 2,
        },
        active_ultra: {
          subscriptionStatus: "active",
          planType: "paid",
          videoCredits: 5,
        },
        downgraded: {
          subscriptionStatus: "expired",
          planType: "trial",
          videoCredits: 0,
        },
      };

      const update = scenarios[scenario];
      if (!update) {
        return res.status(400).json({
          error: `Unknown scenario. Valid options: ${Object.keys(scenarios).join(", ")}`,
        });
      }

      try {
        await db.update(users).set(update).where(eq(users.id, userId));

        const [updated] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!updated) {
          return res.status(404).json({ error: "User not found" });
        }

        console.log(
          `[StagingAdmin] Simulated "${scenario}" for user ${userId} (${updated.email})`,
        );
        res.json({
          success: true,
          scenario,
          user: {
            id: updated.id,
            email: updated.email,
            subscriptionStatus: updated.subscriptionStatus,
            planType: updated.planType,
            videoCredits: updated.videoCredits,
            trialEnd: updated.trialEnd?.toISOString() ?? null,
          },
        });
      } catch (error) {
        console.error("[StagingAdmin] Simulate scenario error:", error);
        res.status(500).json({ error: "Failed to simulate scenario" });
      }
    },
  );

  router.post(
    "/users/:userId/add-credits",
    async (req: AuthRequest, res: Response) => {
      const { userId } = req.params;
      const { amount } = req.body;

      if (typeof amount !== "number" || amount === 0) {
        return res
          .status(400)
          .json({ error: "amount must be a non-zero number" });
      }

      try {
        await db
          .update(users)
          .set({
            videoCredits: sql`GREATEST(0, COALESCE(${users.videoCredits}, 0) + ${amount})`,
          })
          .where(eq(users.id, userId));

        const [updated] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!updated) {
          return res.status(404).json({ error: "User not found" });
        }

        console.log(
          `[StagingAdmin] Adjusted credits for user ${userId} (${updated.email}) by ${amount > 0 ? "+" : ""}${amount} → now ${updated.videoCredits}`,
        );
        res.json({
          success: true,
          videoCredits: updated.videoCredits,
        });
      } catch (error) {
        console.error("[StagingAdmin] Add credits error:", error);
        res.status(500).json({ error: "Failed to adjust credits" });
      }
    },
  );

  app.use("/api/admin/staging", router);
}
