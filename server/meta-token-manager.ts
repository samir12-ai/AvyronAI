import { db } from "./db";
import { metaCredentials, accountState } from "@shared/schema";
import { eq } from "drizzle-orm";
import { encryptToken, decryptToken, redactToken } from "./meta-crypto";
import { transitionMetaMode, computeCapabilities, computeMissingScopes } from "./meta-status";
import { logAudit } from "./audit";
import { recordMetaApiCall } from "./meta-metrics";
import { classifyMetaError, classifyNetworkError, recordTemporaryError, recordSuccess } from "./meta-error-classifier";

const FB_API_VERSION = "v21.0";
const TOKEN_EXTENSION_THRESHOLD_DAYS = 14;
const HEALTH_CHECK_INTERVAL_HOURS = 24;

export interface TokenExchangeResult {
  success: boolean;
  longLivedToken?: string;
  expiresIn?: number;
  error?: string;
}

export interface PageTokenResult {
  success: boolean;
  pages?: Array<{
    id: string;
    name: string;
    accessToken: string;
    igBusinessId?: string;
    igUsername?: string;
  }>;
  error?: string;
}

export interface PermissionVerifyResult {
  granted: string[];
  declined: string[];
  expired: string[];
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<TokenExchangeResult> {
  const appId = process.env.META_APP_ID || "";
  const appSecret = process.env.META_APP_SECRET || "";

  if (!appId || !appSecret) {
    return { success: false, error: "META_APP_ID or META_APP_SECRET not configured" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`
    );
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message || "Token exchange failed" };
    }

    if (!data.access_token) {
      return { success: false, error: "No access token in exchange response" };
    }

    return {
      success: true,
      longLivedToken: data.access_token,
      expiresIn: data.expires_in || 5184000,
    };
  } catch (error) {
    return { success: false, error: `Token exchange network error: ${String(error)}` };
  }
}

export async function fetchPages(userToken: string): Promise<PageTokenResult> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`
    );
    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message || "Failed to fetch pages" };
    }

    if (!data.data || data.data.length === 0) {
      return { success: false, error: "No Facebook Pages found. You need to be an admin of at least one Facebook Page." };
    }

    const pages = [];
    for (const page of data.data) {
      let igBusinessId: string | undefined;
      let igUsername: string | undefined;

      if (page.instagram_business_account?.id) {
        try {
          const igResponse = await fetch(
            `https://graph.facebook.com/${FB_API_VERSION}/${page.instagram_business_account.id}?fields=username&access_token=${userToken}`
          );
          const igData = await igResponse.json();
          if (igData.username) {
            igBusinessId = page.instagram_business_account.id;
            igUsername = igData.username;
          }
        } catch {}
      }

      pages.push({
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        igBusinessId,
        igUsername,
      });
    }

    return { success: true, pages };
  } catch (error) {
    return { success: false, error: `Failed to fetch pages: ${String(error)}` };
  }
}

export async function verifyPermissions(userToken: string): Promise<PermissionVerifyResult> {
  const result: PermissionVerifyResult = { granted: [], declined: [], expired: [] };

  try {
    const response = await fetch(
      `https://graph.facebook.com/${FB_API_VERSION}/me/permissions?access_token=${userToken}`
    );
    const data = await response.json();

    if (data.error) {
      console.error("[MetaTokenManager] Permission verification error:", data.error.message);
      return result;
    }

    for (const perm of data.data || []) {
      if (perm.status === "granted") {
        result.granted.push(perm.permission);
      } else if (perm.status === "declined") {
        result.declined.push(perm.permission);
      } else if (perm.status === "expired") {
        result.expired.push(perm.permission);
      }
    }
  } catch (error) {
    console.error("[MetaTokenManager] Permission verification network error:", error);
  }

  return result;
}

export async function storeTokensAfterOAuth(
  accountId: string,
  shortLivedToken: string
): Promise<{ success: boolean; status: string; error?: string }> {
  try {
    const exchangeResult = await exchangeForLongLivedToken(shortLivedToken);
    if (!exchangeResult.success || !exchangeResult.longLivedToken) {
      return { success: false, status: "TOKEN_EXCHANGE_FAILED", error: exchangeResult.error };
    }

    const longLivedToken = exchangeResult.longLivedToken;
    const expiresAt = new Date(Date.now() + (exchangeResult.expiresIn || 5184000) * 1000);

    await logAudit(accountId, "META_TOKEN_EXCHANGED", {
      details: {
        tokenType: "long_lived",
        expiresAt: expiresAt.toISOString(),
        expiresInDays: Math.floor((exchangeResult.expiresIn || 5184000) / 86400),
      },
    });

    const permissions = await verifyPermissions(longLivedToken);
    const missingScopes = computeMissingScopes(permissions.granted);

    await logAudit(accountId, "META_PERMISSION_VERIFIED", {
      details: {
        granted: permissions.granted,
        declined: permissions.declined,
        expired: permissions.expired,
        missing: missingScopes,
      },
    });

    const pagesResult = await fetchPages(longLivedToken);
    if (!pagesResult.success || !pagesResult.pages || pagesResult.pages.length === 0) {
      await transitionMetaMode(accountId, "PERMISSION_MISSING", pagesResult.error || "No pages found");
      return { success: false, status: "NO_PAGES", error: pagesResult.error };
    }

    const selectedPage = pagesResult.pages[0];
    const encryptedUser = encryptToken(longLivedToken);
    const encryptedPage = encryptToken(selectedPage.accessToken);

    await db.delete(metaCredentials).where(eq(metaCredentials.accountId, accountId));
    await db.insert(metaCredentials).values({
      accountId,
      encryptedUserToken: encryptedUser.ciphertext,
      ivUser: encryptedUser.iv,
      encryptedPageToken: encryptedPage.ciphertext,
      ivPage: encryptedPage.iv,
      encryptionKeyVersion: encryptedUser.keyVersion,
      userTokenExpiresAt: expiresAt,
      pageId: selectedPage.id,
      pageName: selectedPage.name,
      igBusinessId: selectedPage.igBusinessId || null,
      igUsername: selectedPage.igUsername || null,
      lastHealthCheckAt: new Date(),
    });

    const hasValidPageToken = true;
    const capabilities = computeCapabilities(permissions.granted, hasValidPageToken, selectedPage.igBusinessId || null);

    if (missingScopes.length > 0 && !capabilities.fbPublishingEnabled) {
      await db.update(accountState)
        .set({
          metaMode: "PERMISSION_MISSING",
          metaGrantedScopes: JSON.stringify(permissions.granted),
          metaMissingScopes: JSON.stringify(missingScopes),
          metaLastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(accountState.accountId, accountId));

      return { success: true, status: "PERMISSION_MISSING" };
    }

    await db.update(accountState)
      .set({
        metaMode: "REAL",
        metaGrantedScopes: JSON.stringify(permissions.granted),
        metaMissingScopes: missingScopes.length > 0 ? JSON.stringify(missingScopes) : null,
        metaLastVerifiedAt: new Date(),
        metaDemoModeEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(accountState.accountId, accountId));

    await logAudit(accountId, "META_CONNECTED", {
      details: {
        pageId: selectedPage.id,
        pageName: selectedPage.name,
        igBusinessId: selectedPage.igBusinessId || null,
        igUsername: selectedPage.igUsername || null,
        capabilities,
        grantedScopes: permissions.granted,
      },
    });

    console.log(`[MetaTokenManager] Account ${accountId} connected: page=${selectedPage.name}, ig=${selectedPage.igUsername || 'none'}`);

    return { success: true, status: "REAL" };
  } catch (error) {
    console.error("[MetaTokenManager] storeTokensAfterOAuth error:", error);
    return { success: false, status: "ERROR", error: String(error) };
  }
}

// NOTE: runHealthCheck is intentionally independent of publish backoff (isInBackoff).
// Publish backoff only pauses publishToMetaWithRetry in the publish worker.
// Health checks always run on schedule regardless of backoff state, ensuring
// token validity and permissions are verified even when publishing is paused.
export async function runHealthCheck(accountId: string): Promise<{
  healthy: boolean;
  action?: string;
  details?: Record<string, any>;
}> {
  try {
    const creds = await db.select().from(metaCredentials).where(eq(metaCredentials.accountId, accountId)).limit(1);
    if (!creds[0]) {
      return { healthy: false, action: "no_credentials" };
    }

    const cred = creds[0];

    if (cred.lastHealthCheckAt) {
      const hoursSince = (Date.now() - new Date(cred.lastHealthCheckAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < HEALTH_CHECK_INTERVAL_HOURS) {
        return { healthy: true, action: "skipped_recent", details: { hoursSinceLastCheck: Math.round(hoursSince) } };
      }
    }

    if (!cred.encryptedUserToken || !cred.ivUser || !cred.encryptionKeyVersion) {
      await transitionMetaMode(accountId, "DISCONNECTED", "Missing encrypted tokens");
      return { healthy: false, action: "missing_tokens" };
    }

    let userToken: string;
    try {
      userToken = decryptToken(cred.encryptedUserToken, cred.ivUser, cred.encryptionKeyVersion);
    } catch {
      await transitionMetaMode(accountId, "TOKEN_EXPIRED", "Failed to decrypt token — possible key rotation");
      return { healthy: false, action: "decryption_failed" };
    }

    const appId = process.env.META_APP_ID || "";
    const appSecret = process.env.META_APP_SECRET || "";
    let tokenValid = false;
    let tokenExpiresAt: number | null = null;

    if (appId && appSecret) {
      const debugStart = Date.now();
      try {
        const debugRes = await fetch(
          `https://graph.facebook.com/debug_token?input_token=${userToken}&access_token=${appId}|${appSecret}`
        );
        const debugLatency = Date.now() - debugStart;
        const debugData = await debugRes.json();

        if (debugData.data) {
          tokenValid = debugData.data.is_valid === true;
          tokenExpiresAt = debugData.data.expires_at || null;

          if (!tokenValid) {
            const errorSubcode = debugData.data.error?.subcode;
            const errorCode = debugData.data.error?.code || null;
            const classified = classifyMetaError(null, errorCode, errorSubcode, debugData.data.error?.message || null);
            recordMetaApiCall(accountId, false, debugLatency, classified.category);

            if (classified.classification === "PERMANENT" && classified.shouldTransitionMode) {
              if (errorSubcode === 458 || errorSubcode === 460) {
                await transitionMetaMode(accountId, "REVOKED", `Token revoked (subcode: ${errorSubcode})`);
                await logAudit(accountId, "META_TOKEN_REVOKED", { details: { subcode: errorSubcode } });
                return { healthy: false, action: "revoked" };
              }
              if (errorSubcode === 463) {
                await transitionMetaMode(accountId, "TOKEN_EXPIRED", "Token expired (debug_token)");
                await logAudit(accountId, "META_TOKEN_EXPIRED", { details: {} });
                return { healthy: false, action: "expired" };
              }
              await transitionMetaMode(accountId, "TOKEN_EXPIRED", "Token invalid (unknown reason)");
              return { healthy: false, action: "invalid" };
            } else {
              const backoff = recordTemporaryError(accountId);
              await logAudit(accountId, "META_TEMPORARY_ERROR", {
                details: { category: classified.category, backoff, errorSubcode, source: "health_check_debug_token" },
              });
              tokenValid = true;
            }
          } else {
            recordMetaApiCall(accountId, true, debugLatency);
            recordSuccess(accountId);
          }
        }
      } catch (debugError) {
        const debugLatency = Date.now() - debugStart;
        const classified = classifyNetworkError();
        recordMetaApiCall(accountId, false, debugLatency, classified.category);
        const backoff = recordTemporaryError(accountId);
        await logAudit(accountId, "META_TEMPORARY_ERROR", {
          details: { category: classified.category, backoff, error: String(debugError), source: "health_check_debug_token" },
        });
        console.warn("[MetaTokenManager] debug_token API call failed (temporary):", String(debugError));
        tokenValid = true;
      }
    } else {
      const meStart = Date.now();
      try {
        const testRes = await fetch(`https://graph.facebook.com/${FB_API_VERSION}/me?access_token=${userToken}`);
        const meLatency = Date.now() - meStart;
        const testData = await testRes.json();
        tokenValid = !testData.error;
        if (testData.error) {
          const code = testData.error.code;
          const subcode = testData.error.error_subcode || null;
          const classified = classifyMetaError(null, code, subcode, testData.error.message || null);
          recordMetaApiCall(accountId, false, meLatency, classified.category);

          if (classified.classification === "PERMANENT" && classified.shouldTransitionMode) {
            await transitionMetaMode(accountId, classified.suggestedMode as any || "TOKEN_EXPIRED", `Token issue (/me check, code=${code})`);
            await logAudit(accountId, "META_TOKEN_EXPIRED", { details: { errorCode: code } });
            return { healthy: false, action: "expired" };
          } else {
            const backoff = recordTemporaryError(accountId);
            await logAudit(accountId, "META_TEMPORARY_ERROR", {
              details: { category: classified.category, backoff, errorCode: code, source: "health_check_me" },
            });
            tokenValid = true;
          }
        } else {
          recordMetaApiCall(accountId, true, meLatency);
          recordSuccess(accountId);
        }
      } catch (meError) {
        const meLatency = Date.now() - meStart;
        recordMetaApiCall(accountId, false, meLatency, "NETWORK_ERROR");
        recordTemporaryError(accountId);
        tokenValid = true;
      }
    }

    if (tokenValid && tokenExpiresAt) {
      const expiresDate = new Date(tokenExpiresAt * 1000);
      const daysUntilExpiry = (expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

      if (daysUntilExpiry < TOKEN_EXTENSION_THRESHOLD_DAYS && daysUntilExpiry > 0) {
        const extensionResult = await exchangeForLongLivedToken(userToken);
        if (extensionResult.success && extensionResult.longLivedToken) {
          const newExpiry = new Date(Date.now() + (extensionResult.expiresIn || 5184000) * 1000);
          const encryptedNew = encryptToken(extensionResult.longLivedToken);

          await db.update(metaCredentials)
            .set({
              encryptedUserToken: encryptedNew.ciphertext,
              ivUser: encryptedNew.iv,
              encryptionKeyVersion: encryptedNew.keyVersion,
              userTokenExpiresAt: newExpiry,
              updatedAt: new Date(),
            })
            .where(eq(metaCredentials.accountId, accountId));

          await logAudit(accountId, "META_AUTO_EXTENSION", {
            details: {
              oldExpiresAt: expiresDate.toISOString(),
              newExpiresAt: newExpiry.toISOString(),
              daysRemaining: Math.round(daysUntilExpiry),
            },
          });

          console.log(`[MetaTokenManager] Auto-extended token for ${accountId}: ${Math.round(daysUntilExpiry)}d → ~60d`);
        } else {
          console.warn(`[MetaTokenManager] Auto-extension failed for ${accountId}: ${extensionResult.error}`);
        }
      }
    }

    const permissions = await verifyPermissions(userToken);
    const missingScopes = computeMissingScopes(permissions.granted);

    await db.update(accountState)
      .set({
        metaGrantedScopes: JSON.stringify(permissions.granted),
        metaMissingScopes: missingScopes.length > 0 ? JSON.stringify(missingScopes) : null,
        metaLastVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accountState.accountId, accountId));

    await db.update(metaCredentials)
      .set({ lastHealthCheckAt: new Date(), updatedAt: new Date() })
      .where(eq(metaCredentials.accountId, accountId));

    const capabilities = computeCapabilities(
      permissions.granted,
      !!cred.encryptedPageToken,
      cred.igBusinessId || null
    );

    if (missingScopes.length > 0 && !capabilities.fbPublishingEnabled) {
      await transitionMetaMode(accountId, "PERMISSION_MISSING", "Health check found missing required scopes");
    } else {
      const state = await db.select().from(accountState).where(eq(accountState.accountId, accountId)).limit(1);
      if (state[0]?.metaMode !== "REAL") {
        await transitionMetaMode(accountId, "REAL", "Health check verified all requirements");
      }
    }

    await logAudit(accountId, "META_HEALTH_CHECK", {
      details: {
        tokenValid,
        capabilities,
        grantedScopes: permissions.granted.length,
        missingScopes: missingScopes.length,
      },
    });

    return { healthy: true, action: "verified", details: { capabilities, missingScopes } };
  } catch (error) {
    console.error("[MetaTokenManager] Health check error for account:", accountId, error);
    return { healthy: false, action: "error", details: { error: String(error) } };
  }
}

export async function runAllHealthChecks(): Promise<void> {
  try {
    const allCreds = await db.select({ accountId: metaCredentials.accountId }).from(metaCredentials);
    for (const cred of allCreds) {
      await runHealthCheck(cred.accountId);
    }
  } catch (error) {
    console.error("[MetaTokenManager] runAllHealthChecks error:", error);
  }
}
