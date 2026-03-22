import { Express, Request, Response } from "express";
import { buildAnalyticalPackage, getAELVersion } from "./engine";
import { loadProductDNA } from "../shared/product-dna";
import { db } from "../db";
import { miSnapshots } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { AnalyticalPackage } from "./types";

const LOG_PREFIX = "[AEL-Routes]";

const aelCache = new Map<string, { pkg: AnalyticalPackage; timestamp: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function getCachedAEL(campaignId: string): AnalyticalPackage | null {
  const entry = aelCache.get(campaignId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    aelCache.delete(campaignId);
    return null;
  }
  return entry.pkg;
}

export function setCachedAEL(campaignId: string, pkg: AnalyticalPackage): void {
  aelCache.set(campaignId, { pkg, timestamp: Date.now() });
}

export function registerAELRoutes(app: Express) {
  app.post("/api/ael/build", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.body;

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

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

      setCachedAEL(campaignId, pkg);

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

  app.get("/api/ael/status/:campaignId", async (req: Request, res: Response) => {
    try {
      const { campaignId } = req.params;
      const cached = getCachedAEL(campaignId);

      return res.json({
        success: true,
        hasCachedPackage: !!cached,
        version: getAELVersion(),
        package: cached || null,
        cacheAge: cached ? Date.now() - (aelCache.get(campaignId)?.timestamp || 0) : null,
      });
    } catch (err: any) {
      console.error(`${LOG_PREFIX} STATUS_ERROR | ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  });

  console.log(`${LOG_PREFIX} Routes registered: POST /api/ael/build, GET /api/ael/status/:campaignId | version=${getAELVersion()}`);
}
