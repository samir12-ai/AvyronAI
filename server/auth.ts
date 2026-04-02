import { Router, Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "avyron_jwt_secret_" + (process.env.REPL_ID || "dev");
if (!process.env.JWT_SECRET) {
  console.warn("[Auth] WARNING: JWT_SECRET not set — using fallback. Set JWT_SECRET in production.");
}
const TRIAL_DAYS = 7;

export class AuthConfigurationError extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
    this.status = 401;
  }
}
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

interface JwtPayload {
  userId: string;
  email: string;
  accountId?: string;
}

export interface AuthRequest extends Request {
  userId?: string;
  accountId?: string;
}

const ADMIN_ACCOUNT_IDS = new Set([
  "a2d87878-a1e9-41ea-a8a5-90beff569673",
]);

export function resolveAccountId(req: AuthRequest): string {
  if (!req.accountId) {
    throw new AuthConfigurationError("Authentication required: no account context found on request. Ensure this route is protected by authMiddleware.");
  }
  return req.accountId;
}

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.accountId || !ADMIN_ACCOUNT_IDS.has(req.accountId)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function generateToken(userId: string, email: string, accountId: string): string {
  return jwt.sign({ userId, email, accountId } as JwtPayload, JWT_SECRET, { expiresIn: "14d" });
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.userId = payload.userId;
  req.accountId = payload.accountId || payload.userId;
  next();
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      req.userId = payload.userId;
      req.accountId = payload.accountId || payload.userId;
    }
  }
  next();
}

export function registerAuthRoutes(app: Router) {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      const emailLower = email.toLowerCase().trim();

      const existing = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (existing.length > 0) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const now = new Date();
      const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

      const [newUser] = await db.insert(users).values({
        username: emailLower,
        password: passwordHash,
        email: emailLower,
        trialStart: now,
        trialEnd,
        subscriptionStatus: "trial",
        hasSeenIntro: false,
      }).returning();

      const userAccountId = newUser.id;
      await db.update(users).set({ accountId: userAccountId }).where(eq(users.id, newUser.id));

      const token = generateToken(newUser.id, emailLower, userAccountId);

      res.status(201).json({
        token,
        user: {
          id: newUser.id,
          email: emailLower,
          name: name || emailLower.split("@")[0],
          subscriptionStatus: "trial",
          planType: "trial",
          videoCredits: 0,
          trialEnd: trialEnd.toISOString(),
          hasSeenIntro: false,
          accountId: userAccountId,
          isAdmin: ADMIN_ACCOUNT_IDS.has(userAccountId),
        },
      });
    } catch (error: any) {
      console.error("[Auth] Register error:", error);
      if (error?.code === "23505") {
        return res.status(409).json({ error: "An account with this email already exists" });
      }
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      const emailLower = email.toLowerCase().trim();

      const [user] = await db.select().from(users).where(eq(users.email, emailLower)).limit(1);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const userAccountId = user.accountId || user.id;
      if (!user.accountId) {
        await db.update(users).set({ accountId: userAccountId }).where(eq(users.id, user.id));
      }

      const token = generateToken(user.id, emailLower, userAccountId);

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.email?.split("@")[0] || "User",
          subscriptionStatus: status,
          planType: user.planType || "trial",
          videoCredits: user.videoCredits ?? 0,
          trialEnd: user.trialEnd?.toISOString() || null,
          hasSeenIntro: user.hasSeenIntro ?? false,
          accountId: userAccountId,
          isAdmin: ADMIN_ACCOUNT_IDS.has(userAccountId),
        },
      });
    } catch (error) {
      console.error("[Auth] Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.email?.split("@")[0] || "User",
          subscriptionStatus: status,
          planType: user.planType || "trial",
          videoCredits: user.videoCredits ?? 0,
          trialEnd: user.trialEnd?.toISOString() || null,
          hasSeenIntro: user.hasSeenIntro ?? false,
          accountId: user.accountId || user.id,
          isAdmin: ADMIN_ACCOUNT_IDS.has(user.accountId || user.id),
        },
      });
    } catch (error) {
      console.error("[Auth] Me error:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/seen-intro", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      await db.update(users).set({ hasSeenIntro: true }).where(eq(users.id, payload.userId));
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Seen intro error:", error);
      res.status(500).json({ error: "Failed to update" });
    }
  });

  app.post("/api/onboarding/track", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { event, ...data } = req.body;
    console.log(`[Onboarding] ${event} | user=${payload.userId}`, JSON.stringify(data));
    res.json({ success: true });
  });

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    try {
      if (STRIPE_WEBHOOK_SECRET) {
        const sig = req.headers["x-webhook-secret"] || req.headers["stripe-signature"];
        if (sig !== STRIPE_WEBHOOK_SECRET) {
          console.warn("[Stripe] Webhook rejected: invalid signature");
          return res.status(403).json({ error: "Forbidden" });
        }
      } else {
        const internalKey = req.headers["x-internal-key"];
        if (internalKey !== JWT_SECRET) {
          console.warn("[Stripe] Webhook rejected: no secret configured and no valid internal key");
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const { userId, status, plan, addCredits } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "Missing userId" });
      }

      const validStatuses = ["active", "expired"];
      const safeStatus = validStatuses.includes(status) ? status : "active";

      const PLAN_VIDEO_CREDITS: Record<string, number> = {
        growth: 2,
        ultra: 5,
      };

      const updateData: Record<string, any> = {
        subscriptionStatus: safeStatus,
      };

      if (safeStatus === "active") {
        updateData.planType = "paid";

        if (plan && PLAN_VIDEO_CREDITS[plan]) {
          updateData.videoCredits = PLAN_VIDEO_CREDITS[plan];
        }
      }

      if (typeof addCredits === "number" && addCredits > 0) {
        await db.update(users).set({
          ...updateData,
          videoCredits: sql`COALESCE(${users.videoCredits}, 0) + ${addCredits}`,
        }).where(eq(users.id, userId));
      } else {
        await db.update(users).set(updateData).where(eq(users.id, userId));
      }

      console.log(`[Conversion] Payment confirmed for user ${userId} — status: ${safeStatus}, plan: ${plan || "none"}, addCredits: ${addCredits || 0}`);
      res.json({ success: true });
    } catch (error) {
      console.error("[Stripe] Webhook error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  app.get("/api/auth/subscription-status", async (req: AuthRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const payload = verifyToken(authHeader.slice(7));
    if (!payload) {
      return res.status(401).json({ error: "Invalid token" });
    }

    try {
      const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const now = new Date();
      const isTrialActive = user.trialEnd ? now < user.trialEnd : false;
      const trialDaysRemaining = user.trialEnd
        ? Math.max(0, Math.ceil((user.trialEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        : 0;

      const status = user.subscriptionStatus === "active" ? "active" :
                     isTrialActive ? "trial" : "expired";

      if (status === "expired") {
        console.log(`[Conversion] User ${payload.userId} (${user.email}) reached upgrade screen — trial expired`);
      }

      res.json({
        status,
        trialEnd: user.trialEnd?.toISOString() || null,
        trialDaysRemaining,
        isActive: status === "active" || status === "trial",
        videoCredits: user.videoCredits ?? 0,
      });
    } catch (error) {
      console.error("[Auth] Subscription status error:", error);
      res.status(500).json({ error: "Failed to check status" });
    }
  });
}
