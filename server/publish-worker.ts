import { db } from "./db";
import { publishedPosts, accountState, metaCredentials } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { logAudit } from "./audit";
import * as crypto from "crypto";
import { decryptToken, redactToken } from "./meta-crypto";
import type { MetaMode } from "./meta-status";
import { recordMetaApiCall } from "./meta-metrics";
import { classifyMetaError, classifyNetworkError, recordTemporaryError, recordSuccess, isInBackoff } from "./meta-error-classifier";

const PUBLISH_CHECK_INTERVAL_MS = 2 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2000;
const STALE_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
let publishTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;
let activePublishCount = 0;

function generateLockToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishToMetaWithRetry(
  post: any,
  accessToken: string,
  pageId: string,
  accountId: string
): Promise<{ success: boolean; postId?: string; error?: string; attempts: number; classified?: string }> {
  let lastError = "";
  let lastClassification = "";

  if (isInBackoff(accountId)) {
    await logAudit(accountId, "META_BACKOFF_APPLIED", {
      details: { postId: post.id, reason: "Account in backoff — skipping publish attempt" },
    });
    return { success: false, error: "Account in temporary backoff due to repeated errors", attempts: 0, classified: "BACKOFF_ACTIVE" };
  }

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    if (isShuttingDown) {
      return { success: false, error: "Worker shutting down", attempts: attempt };
    }

    try {
      const result = await publishToMeta(post, accessToken, pageId, accountId);

      if (result.success) {
        return { ...result, attempts: attempt };
      }

      lastError = result.error || "Unknown error";

      const classified = classifyMetaError(
        result.httpStatus || null,
        result.errorCode || null,
        result.errorSubcode || null,
        result.error || null
      );
      lastClassification = classified.category;

      if (classified.classification === "PERMANENT") {
        await logAudit(accountId, "META_API_ERROR", {
          details: {
            postId: post.id,
            error: lastError,
            attempt,
            retryable: false,
            classification: "PERMANENT",
            category: classified.category,
          },
        });
        return { success: false, error: lastError, attempts: attempt, classified: classified.category };
      }

      if (classified.category === "RATE_LIMITED") {
        const backoffResult = recordTemporaryError(accountId);
        await logAudit(accountId, "META_RATE_LIMITED", {
          details: {
            postId: post.id,
            attempt,
            backoffMs: backoffResult.backoffMs,
            totalErrors: backoffResult.totalErrors,
          },
        });
        if (!backoffResult.shouldRetry) {
          return { success: false, error: `Rate limited — max retries exceeded`, attempts: attempt, classified: "RATE_LIMITED" };
        }
        await sleep(backoffResult.backoffMs);
        continue;
      }

      recordTemporaryError(accountId);

      if (isNonRetryableError(lastError)) {
        await logAudit(accountId, "META_API_ERROR", {
          details: { postId: post.id, error: lastError, attempt, retryable: false },
        });
        return { success: false, error: lastError, attempts: attempt, classified: lastClassification };
      }

      if (attempt < MAX_RETRY_ATTEMPTS) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.log(`[PublishWorker] Retry ${attempt}/${MAX_RETRY_ATTEMPTS} for post ${post.id} in ${Math.round(backoff)}ms`);
        await sleep(backoff);
      }
    } catch (error) {
      lastError = String(error);
      recordTemporaryError(accountId);
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
        await sleep(backoff);
      }
    }
  }

  await logAudit(accountId, "PUBLISH_RETRY_FAILED", {
    details: {
      postId: post.id,
      platform: post.platform,
      totalAttempts: MAX_RETRY_ATTEMPTS,
      lastError,
      lastClassification,
    },
  });

  return { success: false, error: `Failed after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError}`, attempts: MAX_RETRY_ATTEMPTS, classified: lastClassification };
}

function isNonRetryableError(error: string): boolean {
  const nonRetryable = [
    "Invalid OAuth",
    "expired",
    "permissions",
    "not authorized",
    "duplicate",
    "already published",
    "No media URI",
  ];
  return nonRetryable.some((e) => error.toLowerCase().includes(e.toLowerCase()));
}

interface PublishResult {
  success: boolean;
  postId?: string;
  error?: string;
  httpStatus?: number;
  errorCode?: number;
  errorSubcode?: number;
}

async function publishToMeta(post: any, accessToken: string, pageId: string, accountId?: string): Promise<PublishResult> {
  const acctId = accountId || post.accountId || "default";
  try {
    const platform = (post.platform || "").toLowerCase();

    if (platform === "facebook" || platform.includes("facebook")) {
      const start = Date.now();
      const fbResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/feed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: post.caption,
            access_token: accessToken,
          }),
        }
      );
      const latency = Date.now() - start;
      const fbData = await fbResponse.json();
      if (fbData.id) {
        recordMetaApiCall(acctId, true, latency);
        recordSuccess(acctId);
        return { success: true, postId: fbData.id };
      }
      const errCode = fbData.error?.code || null;
      const errSubcode = fbData.error?.error_subcode || null;
      recordMetaApiCall(acctId, false, latency, `fb_publish_${errCode || 'unknown'}`);
      return {
        success: false,
        error: fbData.error?.message || "Facebook API error",
        httpStatus: fbResponse.status,
        errorCode: errCode,
        errorSubcode: errSubcode,
      };
    }

    if (platform === "instagram" || platform.includes("instagram")) {
      if (post.mediaUri) {
        const start = Date.now();
        const containerRes = await fetch(
          `https://graph.facebook.com/v18.0/${pageId}/media`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_url: post.mediaUri,
              caption: post.caption,
              access_token: accessToken,
            }),
          }
        );
        const containerLatency = Date.now() - start;
        const containerData = await containerRes.json();
        if (containerData.id) {
          recordMetaApiCall(acctId, true, containerLatency);
          const pubStart = Date.now();
          const publishRes = await fetch(
            `https://graph.facebook.com/v18.0/${pageId}/media_publish`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                creation_id: containerData.id,
                access_token: accessToken,
              }),
            }
          );
          const pubLatency = Date.now() - pubStart;
          const publishData = await publishRes.json();
          if (publishData.id) {
            recordMetaApiCall(acctId, true, pubLatency);
            recordSuccess(acctId);
            return { success: true, postId: publishData.id };
          }
          const pubErrCode = publishData.error?.code || null;
          recordMetaApiCall(acctId, false, pubLatency, `ig_publish_${pubErrCode || 'unknown'}`);
          return {
            success: false,
            error: publishData.error?.message || "Instagram publish error",
            httpStatus: publishRes.status,
            errorCode: pubErrCode,
            errorSubcode: publishData.error?.error_subcode || null,
          };
        }
        const cErrCode = containerData.error?.code || null;
        recordMetaApiCall(acctId, false, containerLatency, `ig_container_${cErrCode || 'unknown'}`);
        return {
          success: false,
          error: containerData.error?.message || "Instagram container error",
          httpStatus: containerRes.status,
          errorCode: cErrCode,
          errorSubcode: containerData.error?.error_subcode || null,
        };
      }
      return { success: false, error: "No media URI for Instagram post" };
    }

    return {
      success: false,
      error: `Unsupported platform: ${platform}. Only Facebook and Instagram are supported.`,
    };
  } catch (error) {
    recordMetaApiCall(acctId, false, 0, "NETWORK_ERROR");
    return { success: false, error: String(error) };
  }
}

async function acquireLock(postId: string): Promise<string | null> {
  const lockToken = generateLockToken();
  try {
    const result = await db.update(publishedPosts)
      .set({
        publishLockToken: lockToken,
        publishLockedAt: new Date(),
        status: "publishing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(publishedPosts.id, postId),
          sql`(${publishedPosts.publishLockToken} IS NULL OR ${publishedPosts.publishLockToken} = '')`,
          sql`${publishedPosts.status} = 'scheduled'`
        )
      )
      .returning({ id: publishedPosts.id });

    return result.length > 0 ? lockToken : null;
  } catch {
    return null;
  }
}

async function releaseLock(postId: string, lockToken: string): Promise<void> {
  await db.update(publishedPosts)
    .set({
      publishLockToken: null,
      publishLockedAt: null,
      status: "scheduled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(publishedPosts.id, postId),
        eq(publishedPosts.publishLockToken, lockToken)
      )
    );
}

async function cleanupStaleLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_TIMEOUT_MS);
  const stale = await db.update(publishedPosts)
    .set({
      publishLockToken: null,
      publishLockedAt: null,
      status: "scheduled",
      updatedAt: new Date(),
    })
    .where(
      and(
        sql`${publishedPosts.publishLockToken} IS NOT NULL`,
        sql`${publishedPosts.status} = 'publishing'`,
        sql`${publishedPosts.publishLockedAt} < ${cutoff}`
      )
    )
    .returning({ id: publishedPosts.id });

  if (stale.length > 0) {
    console.log(`[PublishWorker] Cleaned up ${stale.length} stale lock(s): ${stale.map(s => s.id).join(", ")}`);
    for (const s of stale) {
      await logAudit("system", "GUARDRAIL_TRIGGER", {
        details: {
          action: "stale_lock_cleanup",
          postId: s.id,
          lockTimeoutMs: STALE_LOCK_TIMEOUT_MS,
        },
      });
    }
  }

  return stale.length;
}

async function getAccountMetaMode(accountId: string): Promise<MetaMode> {
  const state = await db.select().from(accountState)
    .where(eq(accountState.accountId, accountId))
    .limit(1);
  return (state[0]?.metaMode as MetaMode) || "DISCONNECTED";
}

async function getServerSidePageToken(accountId: string): Promise<{ token: string; pageId: string; igBusinessId: string | null } | null> {
  const creds = await db.select().from(metaCredentials)
    .where(eq(metaCredentials.accountId, accountId))
    .limit(1);
  const cred = creds[0];
  if (!cred?.encryptedPageToken || !cred?.ivPage || !cred?.encryptionKeyVersion || !cred?.pageId) {
    return null;
  }
  try {
    const token = decryptToken(cred.encryptedPageToken, cred.ivPage, cred.encryptionKeyVersion);
    return { token, pageId: cred.pageId, igBusinessId: cred.igBusinessId || null };
  } catch {
    return null;
  }
}

async function checkAndPublishDuePosts() {
  if (isShuttingDown) return;

  try {
    await cleanupStaleLocks();

    const now = new Date();
    const duePosts = await db.select().from(publishedPosts)
      .where(
        sql`${publishedPosts.status} = 'scheduled' AND ${publishedPosts.scheduledDate} <= ${now} AND (${publishedPosts.publishLockToken} IS NULL OR ${publishedPosts.publishLockToken} = '')`
      )
      .limit(20);

    if (duePosts.length === 0) return;

    for (const post of duePosts) {
      if (isShuttingDown) break;

      const accountId = post.accountId || "default";
      const lockToken = await acquireLock(post.id);
      if (!lockToken) {
        console.log(`[PublishWorker] Skipping post ${post.id} — already locked`);
        continue;
      }

      activePublishCount++;
      try {
        const state = await db.select().from(accountState)
          .where(eq(accountState.accountId, accountId))
          .limit(1);

        const acctState = state[0];
        if (!acctState?.autopilotOn) {
          await releaseLock(post.id, lockToken);
          continue;
        }

        if (acctState.state === "SAFE_MODE") {
          await releaseLock(post.id, lockToken);
          continue;
        }

        const metaMode = (acctState.metaMode as MetaMode) || "DISCONNECTED";
        let publishMode: "REAL" | "DEMO" | "BLOCKED" = "BLOCKED";
        let result: { success: boolean; postId?: string; error?: string; attempts: number };

        if (metaMode === "REAL") {
          const serverTokens = await getServerSidePageToken(accountId);
          if (!serverTokens) {
            await logAudit(accountId, "PUBLISH_FAILED", {
              details: {
                postId: post.id,
                reason: "Server-side page token not available despite meta_mode=REAL",
              },
            });
            await db.update(publishedPosts)
              .set({
                status: "failed",
                lastPublishError: "Page token unavailable. Please reconnect Meta.",
                publishLockToken: null,
                publishLockedAt: null,
                publishMode: "BLOCKED",
                updatedAt: new Date(),
              })
              .where(and(eq(publishedPosts.id, post.id), eq(publishedPosts.publishLockToken, lockToken)));
            activePublishCount--;
            continue;
          }

          publishMode = "REAL";
          result = await publishToMetaWithRetry(post, serverTokens.token, serverTokens.pageId, accountId);
        } else if (metaMode === "DEMO" && acctState.metaDemoModeEnabled && process.env.ALLOW_DEMO_MODE === "true") {
          publishMode = "DEMO";
          result = {
            success: true,
            postId: undefined,
            attempts: 1,
          };
        } else {
          await logAudit(accountId, "PUBLISH_FAILED", {
            details: {
              postId: post.id,
              reason: `Cannot publish: meta_mode=${metaMode}`,
              metaMode,
            },
          });
          await db.update(publishedPosts)
            .set({
              status: "failed",
              lastPublishError: `Meta not connected (mode: ${metaMode}). Connect Meta Business Suite to publish.`,
              publishLockToken: null,
              publishLockedAt: null,
              publishMode: "BLOCKED",
              updatedAt: new Date(),
            })
            .where(and(eq(publishedPosts.id, post.id), eq(publishedPosts.publishLockToken, lockToken)));
          activePublishCount--;
          continue;
        }

        if (result.success) {
          await db.update(publishedPosts)
            .set({
              status: "published",
              metaPostId: result.postId || null,
              publishedAt: new Date(),
              publishMode,
              publishAttempts: result.attempts,
              publishLockToken: null,
              publishLockedAt: null,
              lastPublishError: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(publishedPosts.id, post.id),
                eq(publishedPosts.publishLockToken, lockToken)
              )
            );

          await logAudit(accountId, "PUBLISH_SUCCESS", {
            details: {
              postId: post.id,
              metaPostId: result.postId,
              platform: post.platform,
              publishMode,
              attempts: result.attempts,
              caption: post.caption?.substring(0, 100),
            },
          });

          console.log(`[PublishWorker] [${publishMode}] Published post ${post.id} to ${post.platform} (attempts: ${result.attempts})`);
        } else {
          const currentAttempts = (post.publishAttempts || 0) + result.attempts;

          await db.update(publishedPosts)
            .set({
              status: currentAttempts >= MAX_RETRY_ATTEMPTS * 2 ? "failed" : "scheduled",
              publishAttempts: currentAttempts,
              lastPublishError: result.error || null,
              publishLockToken: null,
              publishLockedAt: null,
              publishMode,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(publishedPosts.id, post.id),
                eq(publishedPosts.publishLockToken, lockToken)
              )
            );

          const finalStatus = currentAttempts >= MAX_RETRY_ATTEMPTS * 2 ? "PUBLISH_FAILED" : "META_API_ERROR";
          await logAudit(accountId, finalStatus as any, {
            details: {
              postId: post.id,
              platform: post.platform,
              error: result.error,
              publishMode,
              totalAttempts: currentAttempts,
            },
          });

          console.error(`[PublishWorker] [${publishMode}] Failed post ${post.id}: ${result.error} (total attempts: ${currentAttempts})`);
        }
      } finally {
        activePublishCount--;
      }
    }
  } catch (error) {
    console.error("[PublishWorker] Error in publish check:", error);
  }
}

async function fetchPostMetrics() {
  if (isShuttingDown) return;

  try {
    const published = await db.select().from(publishedPosts)
      .where(
        sql`${publishedPosts.status} = 'published' AND ${publishedPosts.metaPostId} IS NOT NULL AND (${publishedPosts.lastMetricsFetch} IS NULL OR ${publishedPosts.lastMetricsFetch} < NOW() - INTERVAL '6 hours')`
      )
      .limit(20);

    if (published.length === 0) return;

    for (const post of published) {
      if (isShuttingDown) break;

      if (!post.metaPostId) continue;

      try {
        const accountId = post.accountId || "default";
        const metaMode = await getAccountMetaMode(accountId);
        if (metaMode !== "REAL") continue;

        const serverTokens = await getServerSidePageToken(accountId);
        if (!serverTokens) continue;

        const metricsRes = await fetch(
          `https://graph.facebook.com/v21.0/${post.metaPostId}/insights?metric=post_impressions,post_engaged_users,post_clicks&access_token=${serverTokens.token}`
        );
        const metricsData = await metricsRes.json();

        if (metricsData.data) {
          let impressions = 0, engagement = 0, clicks = 0;
          for (const metric of metricsData.data) {
            if (metric.name === "post_impressions") impressions = metric.values?.[0]?.value || 0;
            if (metric.name === "post_engaged_users") engagement = metric.values?.[0]?.value || 0;
            if (metric.name === "post_clicks") clicks = metric.values?.[0]?.value || 0;
          }

          await db.update(publishedPosts)
            .set({
              impressions,
              reach: Math.floor(impressions * 0.7),
              engagement,
              clicks,
              lastMetricsFetch: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(publishedPosts.id, post.id));
        }
      } catch (error) {
        console.error(`[PublishWorker] Metrics fetch failed for post ${post.id}:`, String(error));
      }
    }
  } catch (error) {
    console.error("[PublishWorker] Error fetching metrics:", error);
  }
}

export function startPublishWorker() {
  if (publishTimer) return;
  isShuttingDown = false;

  console.log(`[PublishWorker] Starting publish worker (2-min interval, server-side token mode)`);

  logAudit("system", "WORKER_STARTUP", {
    details: {
      worker: "publish-worker",
      tokenMode: "server_side_encrypted",
      retryConfig: { maxAttempts: MAX_RETRY_ATTEMPTS, baseBackoffMs: BASE_BACKOFF_MS },
    },
  }).catch(() => {});

  publishTimer = setInterval(async () => {
    if (!isShuttingDown) {
      await checkAndPublishDuePosts();
      await fetchPostMetrics();
    }
  }, PUBLISH_CHECK_INTERVAL_MS);

  setTimeout(async () => {
    if (!isShuttingDown) {
      await checkAndPublishDuePosts();
      await fetchPostMetrics();
    }
  }, 10000);
}

export { cleanupStaleLocks, acquireLock, releaseLock, isNonRetryableError, STALE_LOCK_TIMEOUT_MS, MAX_RETRY_ATTEMPTS };

export async function stopPublishWorker(): Promise<void> {
  isShuttingDown = true;

  if (publishTimer) {
    clearInterval(publishTimer);
    publishTimer = null;
  }

  const maxWait = 30000;
  const start = Date.now();
  while (activePublishCount > 0 && Date.now() - start < maxWait) {
    await sleep(500);
  }

  await logAudit("system", "WORKER_SHUTDOWN", {
    details: {
      worker: "publish-worker",
      graceful: activePublishCount === 0,
      pendingPublishes: activePublishCount,
    },
  }).catch(() => {});

  console.log(`[PublishWorker] Stopped (graceful: ${activePublishCount === 0})`);
}
