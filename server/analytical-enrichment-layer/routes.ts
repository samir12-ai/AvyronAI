import { Express, Request, Response } from "express";
import { buildAnalyticalPackage, getAELVersion } from "./engine";
import { loadProductDNA } from "../shared/product-dna";
import { db } from "../db";
import { miSnapshots } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { AnalyticalPackage } from "./types";

import { authMiddleware, resolveAccountId, type AuthRequest } from "../auth";
import { assertCampaignBelongsTo, handleOwnershipError } from "../auth-helpers";
const LOG_PREFIX = "[AEL-Routes]";

// P1-4 (runtime-truth-isolation): bounded LRU cache. Previously unbounded
// (one entry per (account, campaign) pair could grow indefinitely). Hard
// size cap + LRU touch on read/write + TTL enforcement on every read. Key
// remains `${accountId}:${campaignId}` — cross-tenant isolation enforced;
// cross-run blending within a tenant is gated downstream by classifyTrust.
const aelCache = new Map<string, { pkg: AnalyticalPackage; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const AEL_MAX_ENTRIES = 500;

function aelCacheTouch(key: string, value: { pkg: AnalyticalPackage; timestamp: number }): void {
  aelCache.delete(key);
  aelCache.set(key, value);
  while (aelCache.size > AEL_MAX_ENTRIES) {
    const oldest = aelCache.keys().next().value;
    if (oldest === undefined) break;
    aelCache.delete(oldest);
    console.warn(`${LOG_PREFIX} CACHE_LRU_EVICT | key=${oldest} | reason=size_cap`);
  }
}

export function getCachedAEL(campaignId: string, accountId: string): AnalyticalPackage | null {
  const key = `${accountId}:${campaignId}`;
  const entry = aelCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    aelCache.delete(key);
    return null;
  }
  aelCacheTouch(key, entry);
  return entry.pkg;
}

export function setCachedAEL(campaignId: string, accountId: string, pkg: AnalyticalPackage): void {
  const key = `${accountId}:${campaignId}`;
  aelCacheTouch(key, { pkg, timestamp: Date.now() });
}

export function registerAELRoutes(app: Express) {
  app.post("/api/ael/build", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { campaignId } = req.body;
      const accountId = resolveAccountId(req);

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }
      // Doctrine W5 (architect-#9 MEDIUM): canonical helper at boundary;
      // inline accountId WHERE below remains as defence-in-depth.
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }

      console.log(`${LOG_PREFIX} BUILD_REQUEST | campaign=${campaignId}`);

      const [miSnapshot] = await db.select().from(miSnapshots)
        .where(and(
          eq(miSnapshots.campaignId, campaignId),
          eq(miSnapshots.accountId, accountId),
          inArray(miSnapshots.status, ["COMPLETE", "PARTIAL"]),
        ))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);

      if (!miSnapshot) {
        return res.json({
          success: false,
          message: "No MI snapshot available. Run Market Intelligence analysis first.",
          package: null,
        });
      }

      const miResult = typeof miSnapshot.result === "string"
        ? JSON.parse(miSnapshot.result)
        : miSnapshot.result;

      const productDNA = await loadProductDNA(campaignId, accountId);

      const pkg = await buildAnalyticalPackage({
        mi: miResult,
        audience: null,
        productDNA,
        accountId,
        campaignId,
      });

      setCachedAEL(campaignId, accountId, pkg);

      return res.json({
        success: true,
        package: pkg,
        version: getAELVersion(),
        cached: false,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} BUILD_ERROR | ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/ael/status/:campaignId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { campaignId } = req.params;
      const accountId = resolveAccountId(req);
      try { await assertCampaignBelongsTo(accountId, campaignId); }
      catch (e) { if (handleOwnershipError(e, res)) return; throw e; }
      const cacheKey = `${accountId}:${campaignId}`;
      const cached = getCachedAEL(campaignId, accountId);

      return res.json({
        success: true,
        hasCachedPackage: !!cached,
        version: getAELVersion(),
        package: cached || null,
        cacheAge: cached ? Date.now() - (aelCache.get(cacheKey)?.timestamp || 0) : null,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} STATUS_ERROR | ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  });

  console.log(`${LOG_PREFIX} Routes registered: POST /api/ael/build, GET /api/ael/status/:campaignId | version=${getAELVersion()}`);
}
