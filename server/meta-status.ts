import { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { accountState, metaCredentials } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./audit";
import { decryptToken, redactToken, isEncryptionConfigured } from "./meta-crypto";

export type MetaMode = "DISCONNECTED" | "PENDING_APPROVAL" | "PERMISSION_MISSING" | "TOKEN_EXPIRED" | "REVOKED" | "DEMO" | "REAL";

const REQUIRED_PUBLISHING_SCOPES = ["pages_manage_posts"];
const REQUIRED_INSIGHTS_SCOPES = ["pages_read_engagement", "read_insights"];
const REQUIRED_IG_PUBLISHING_SCOPES = ["instagram_content_publish"];
const ALL_REQUESTED_SCOPES = [
  "pages_manage_posts",
  "pages_read_engagement",
  "read_insights",
  "pages_show_list",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
  "public_profile",
  "email",
];

export interface MetaStatus {
  metaMode: MetaMode;
  fbPublishingEnabled: boolean;
  insightsEnabled: boolean;
  igPublishingEnabled: boolean;
  grantedScopes: string[];
  missingScopes: string[];
  connectedPageId: string | null;
  connectedPageName: string | null;
  igBusinessId: string | null;
  igUsername: string | null;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  lastHealthCheckAt: string | null;
  demoModeEnabled: boolean;
  encryptionConfigured: boolean;
}

export function computeCapabilities(grantedScopes: string[], hasValidPageToken: boolean, igBusinessId: string | null): {
  fbPublishingEnabled: boolean;
  insightsEnabled: boolean;
  igPublishingEnabled: boolean;
} {
  const hasPublishingScopes = REQUIRED_PUBLISHING_SCOPES.every(s => grantedScopes.includes(s));
  const hasInsightsScopes = REQUIRED_INSIGHTS_SCOPES.every(s => grantedScopes.includes(s));
  const hasIgPublishingScopes = REQUIRED_IG_PUBLISHING_SCOPES.every(s => grantedScopes.includes(s));

  return {
    fbPublishingEnabled: hasPublishingScopes && hasValidPageToken,
    insightsEnabled: hasInsightsScopes && hasValidPageToken,
    igPublishingEnabled: hasIgPublishingScopes && !!igBusinessId && hasValidPageToken,
  };
}

export function computeMissingScopes(grantedScopes: string[]): string[] {
  const coreRequired = ["pages_manage_posts", "pages_read_engagement", "read_insights", "pages_show_list", "instagram_basic"];
  return coreRequired.filter(s => !grantedScopes.includes(s));
}

async function getOrCreateAccountState(accountId: string) {
  let state = await db.select().from(accountState).where(eq(accountState.accountId, accountId)).limit(1);
  if (!state[0]) {
    await db.insert(accountState).values({ accountId }).onConflictDoNothing();
    state = await db.select().from(accountState).where(eq(accountState.accountId, accountId)).limit(1);
  }
  return state[0];
}

async function getCredentials(accountId: string) {
  const creds = await db.select().from(metaCredentials).where(eq(metaCredentials.accountId, accountId)).limit(1);
  return creds[0] || null;
}

export async function transitionMetaMode(accountId: string, newMode: MetaMode, reason: string): Promise<void> {
  const state = await getOrCreateAccountState(accountId);
  const oldMode = (state?.metaMode as MetaMode) || "DISCONNECTED";

  if (oldMode === newMode) return;

  await db.update(accountState)
    .set({
      metaMode: newMode,
      updatedAt: new Date(),
    })
    .where(eq(accountState.accountId, accountId));

  await logAudit(accountId, "META_MODE_TRANSITION", {
    details: {
      oldMode,
      newMode,
      reason,
      timestamp: new Date().toISOString(),
    },
  });

  console.log(`[MetaStatus] Mode transition: ${oldMode} → ${newMode} (${reason}) for account ${accountId}`);
}

export async function getMetaStatus(accountId: string): Promise<MetaStatus> {
  const state = await getOrCreateAccountState(accountId);
  const creds = await getCredentials(accountId);

  const metaMode = (state?.metaMode as MetaMode) || "DISCONNECTED";
  const grantedScopes = state?.metaGrantedScopes ? JSON.parse(state.metaGrantedScopes) : [];
  const missingScopes = state?.metaMissingScopes ? JSON.parse(state.metaMissingScopes) : computeMissingScopes(grantedScopes);

  let hasValidPageToken = false;
  if (creds?.encryptedPageToken && creds?.ivPage && creds?.encryptionKeyVersion) {
    try {
      const token = decryptToken(creds.encryptedPageToken, creds.ivPage, creds.encryptionKeyVersion);
      hasValidPageToken = !!token && token.length > 0;
    } catch {
      hasValidPageToken = false;
    }
  }

  if (creds?.userTokenExpiresAt && new Date(creds.userTokenExpiresAt) < new Date()) {
    if (metaMode === "REAL") {
      await transitionMetaMode(accountId, "TOKEN_EXPIRED", "User token has expired");
    }
    hasValidPageToken = false;
  }

  const capabilities = computeCapabilities(grantedScopes, hasValidPageToken, creds?.igBusinessId || null);
  const demoAllowed = process.env.ALLOW_DEMO_MODE === "true";
  const demoEnabled = demoAllowed && (state?.metaDemoModeEnabled || false);

  return {
    metaMode: metaMode,
    fbPublishingEnabled: metaMode === "REAL" ? capabilities.fbPublishingEnabled : (demoEnabled && metaMode === "DEMO"),
    insightsEnabled: metaMode === "REAL" ? capabilities.insightsEnabled : false,
    igPublishingEnabled: metaMode === "REAL" ? capabilities.igPublishingEnabled : false,
    grantedScopes,
    missingScopes,
    connectedPageId: creds?.pageId || null,
    connectedPageName: creds?.pageName || null,
    igBusinessId: creds?.igBusinessId || null,
    igUsername: creds?.igUsername || null,
    tokenExpiresAt: creds?.userTokenExpiresAt?.toISOString() || null,
    lastVerifiedAt: state?.metaLastVerifiedAt?.toISOString() || null,
    lastHealthCheckAt: creds?.lastHealthCheckAt?.toISOString() || null,
    demoModeEnabled: demoEnabled,
    encryptionConfigured: isEncryptionConfigured(),
  };
}

export function registerMetaStatusRoutes(app: Express) {
  app.get("/api/meta/status", async (req: Request, res: Response) => {
    try {
      const accountId = (req.query.accountId as string) || "default";
      const status = await getMetaStatus(accountId);
      res.json({ success: true, status });
    } catch (error: any) {
      console.error("[MetaStatus] Error fetching status:", error.message);
      res.status(500).json({ error: "Failed to fetch Meta integration status" });
    }
  });

  app.post("/api/meta/disconnect", async (req: Request, res: Response) => {
    try {
      const accountId = req.body?.accountId || "default";

      await db.delete(metaCredentials).where(eq(metaCredentials.accountId, accountId));

      await db.update(accountState)
        .set({
          metaMode: "DISCONNECTED",
          metaGrantedScopes: null,
          metaMissingScopes: null,
          metaLastVerifiedAt: null,
          metaDemoModeEnabled: false,
          updatedAt: new Date(),
        })
        .where(eq(accountState.accountId, accountId));

      await logAudit(accountId, "META_DISCONNECTED", {
        details: { reason: "User requested disconnect", timestamp: new Date().toISOString() },
      });

      res.json({ success: true, message: "Meta integration disconnected. All tokens removed." });
    } catch (error: any) {
      console.error("[MetaStatus] Disconnect error:", error.message);
      res.status(500).json({ error: "Failed to disconnect Meta integration" });
    }
  });

  app.post("/api/meta/reconnect", async (req: Request, res: Response) => {
    try {
      const accountId = req.body?.accountId || "default";

      await db.delete(metaCredentials).where(eq(metaCredentials.accountId, accountId));

      await transitionMetaMode(accountId, "DISCONNECTED", "Reconnect initiated — clearing old credentials");

      res.json({
        success: true,
        message: "Old credentials cleared. Please initiate Meta OAuth to reconnect.",
        action: "redirect_to_oauth",
      });
    } catch (error: any) {
      console.error("[MetaStatus] Reconnect error:", error.message);
      res.status(500).json({ error: "Failed to initiate reconnect" });
    }
  });

  app.post("/api/meta/demo-toggle", async (req: Request, res: Response) => {
    try {
      if (process.env.ALLOW_DEMO_MODE !== "true") {
        return res.status(403).json({ error: "Demo mode is not available in this environment" });
      }

      const accountId = req.body?.accountId || "default";
      const enable = req.body?.enable === true;

      const state = await getOrCreateAccountState(accountId);
      const currentMode = (state?.metaMode as MetaMode) || "DISCONNECTED";

      if (enable) {
        await db.update(accountState)
          .set({ metaDemoModeEnabled: true, metaMode: "DEMO", updatedAt: new Date() })
          .where(eq(accountState.accountId, accountId));
        await logAudit(accountId, "META_MODE_TRANSITION", {
          details: { oldMode: currentMode, newMode: "DEMO", reason: "Admin enabled demo mode" },
        });
      } else {
        await db.update(accountState)
          .set({ metaDemoModeEnabled: false, metaMode: "DISCONNECTED", updatedAt: new Date() })
          .where(eq(accountState.accountId, accountId));
        await logAudit(accountId, "META_MODE_TRANSITION", {
          details: { oldMode: "DEMO", newMode: "DISCONNECTED", reason: "Admin disabled demo mode" },
        });
      }

      res.json({ success: true, demoEnabled: enable });
    } catch (error: any) {
      console.error("[MetaStatus] Demo toggle error:", error.message);
      res.status(500).json({ error: "Failed to toggle demo mode" });
    }
  });
}

export type MetaErrorCode = "META_NOT_CONNECTED" | "META_PERMISSION_MISSING" | "META_TOKEN_EXPIRED" | "META_REVOKED" | "META_PENDING_APPROVAL" | "META_ENCRYPTION_NOT_CONFIGURED";

export async function requireMetaReal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const accountId = (req.query.accountId as string) || (req.body?.accountId as string) || "default";
    const state = await getOrCreateAccountState(accountId);
    const metaMode = (state?.metaMode as MetaMode) || "DISCONNECTED";

    if (metaMode === "REAL") {
      (req as any).metaMode = "REAL";
      (req as any).metaAccountId = accountId;
      next();
      return;
    }

    if (metaMode === "DEMO" && state?.metaDemoModeEnabled && process.env.ALLOW_DEMO_MODE === "true") {
      (req as any).metaMode = "DEMO";
      (req as any).metaAccountId = accountId;
      next();
      return;
    }

    const errorMap: Record<MetaMode, MetaErrorCode> = {
      DISCONNECTED: "META_NOT_CONNECTED",
      PENDING_APPROVAL: "META_PENDING_APPROVAL",
      PERMISSION_MISSING: "META_PERMISSION_MISSING",
      TOKEN_EXPIRED: "META_TOKEN_EXPIRED",
      REVOKED: "META_REVOKED",
      DEMO: "META_NOT_CONNECTED",
      REAL: "META_NOT_CONNECTED",
    };

    const errorCode = errorMap[metaMode] || "META_NOT_CONNECTED";
    const messages: Record<MetaErrorCode, string> = {
      META_NOT_CONNECTED: "Meta Business Suite is not connected. Please connect in Settings.",
      META_PERMISSION_MISSING: "Required Meta permissions have not been granted. Please reconnect with the required scopes.",
      META_TOKEN_EXPIRED: "Your Meta access token has expired. Please reconnect in Settings.",
      META_REVOKED: "Meta app access has been revoked. Please reconnect in Settings.",
      META_PENDING_APPROVAL: "Meta integration is pending approval. Some features are unavailable until approved.",
      META_ENCRYPTION_NOT_CONFIGURED: "Server encryption is not configured. Contact your administrator.",
    };

    res.status(403).json({
      error: errorCode,
      metaMode,
      message: messages[errorCode],
      action: metaMode === "TOKEN_EXPIRED" || metaMode === "REVOKED" ? "reconnect" : "connect",
    });
  } catch (error: any) {
    console.error("[MetaStatus] Middleware error:", error.message);
    res.status(500).json({ error: "Failed to verify Meta integration status" });
  }
}

export async function getDecryptedPageToken(accountId: string): Promise<string | null> {
  const creds = await getCredentials(accountId);
  if (!creds?.encryptedPageToken || !creds?.ivPage || !creds?.encryptionKeyVersion) {
    return null;
  }
  try {
    return decryptToken(creds.encryptedPageToken, creds.ivPage, creds.encryptionKeyVersion);
  } catch (error) {
    console.error("[MetaStatus] Failed to decrypt page token for account:", accountId);
    return null;
  }
}

export async function getDecryptedUserToken(accountId: string): Promise<string | null> {
  const creds = await getCredentials(accountId);
  if (!creds?.encryptedUserToken || !creds?.ivUser || !creds?.encryptionKeyVersion) {
    return null;
  }
  try {
    return decryptToken(creds.encryptedUserToken, creds.ivUser, creds.encryptionKeyVersion);
  } catch (error) {
    console.error("[MetaStatus] Failed to decrypt user token for account:", accountId);
    return null;
  }
}
