import type { Express, Request, Response } from "express";
import { getActiveRoot, invalidateDownstreamOnRegeneration } from "./shared/strategy-root";
import { db } from "./db";
import { miSnapshots, audienceSnapshots, positioningSnapshots, differentiationSnapshots, mechanismSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export function registerStrategyRootRoutes(app: Express) {
  app.get("/api/strategy-root/active", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const root = await getActiveRoot(campaignId, accountId);

      if (!root) {
        return res.json({ exists: false });
      }

      const snapshotBindings: Record<string, { exists: boolean; createdAt?: string }> = {};
      const checkIds: [string, string, any][] = [
        ["mi", root.miSnapshotId, miSnapshots],
        ["audience", root.audienceSnapshotId, audienceSnapshots],
        ["positioning", root.positioningSnapshotId, positioningSnapshots],
        ["differentiation", root.differentiationSnapshotId, differentiationSnapshots],
        ["mechanism", root.mechanismSnapshotId, mechanismSnapshots],
      ];

      for (const [key, snapshotId, table] of checkIds) {
        try {
          const [snap] = await db.select({ id: table.id, createdAt: table.createdAt })
            .from(table)
            .where(eq(table.id, snapshotId))
            .limit(1);
          snapshotBindings[key] = snap
            ? { exists: true, createdAt: snap.createdAt?.toISOString() }
            : { exists: false };
        } catch {
          snapshotBindings[key] = { exists: false };
        }
      }

      const allSnapshotsValid = Object.values(snapshotBindings).every(b => b.exists);

      res.json({
        exists: true,
        id: root.id,
        runId: root.runId,
        rootHash: root.rootHash,
        primaryAxis: root.primaryAxis,
        contrastAxisText: root.contrastAxisText,
        approvedMechanism: safeJsonParse(root.approvedMechanism),
        approvedAudiencePains: safeJsonParse(root.approvedAudiencePains),
        approvedDesires: safeJsonParse(root.approvedDesires),
        approvedTransformation: root.approvedTransformation,
        approvedClaim: root.approvedClaim,
        approvedPromise: root.approvedPromise,
        miSnapshotId: root.miSnapshotId,
        audienceSnapshotId: root.audienceSnapshotId,
        positioningSnapshotId: root.positioningSnapshotId,
        differentiationSnapshotId: root.differentiationSnapshotId,
        mechanismSnapshotId: root.mechanismSnapshotId,
        status: root.status,
        createdAt: root.createdAt,
        snapshotBindings,
        allSnapshotsValid,
      });
    } catch (error: any) {
      console.error("[StrategyRoot] Active fetch error:", error.message);
      res.status(500).json({ error: "Failed to fetch strategy root" });
    }
  });

  app.get("/api/strategy-root/validate", async (req: Request, res: Response) => {
    try {
      const campaignId = req.query.campaignId as string;
      const accountId = (req as any).accountId || "default";

      if (!campaignId) {
        return res.status(400).json({ error: "campaignId is required" });
      }

      const root = await getActiveRoot(campaignId, accountId);

      if (!root) {
        return res.json({
          valid: false,
          hasRoot: false,
          message: "No active Strategy Root. Run the full pipeline (Product DNA → MI → Audience → Positioning → Differentiation → Mechanism) to create one.",
        });
      }

      const latestSnapshots: Record<string, { id: string; createdAt: string } | null> = {};

      const [latestMi] = await db.select({ id: miSnapshots.id, createdAt: miSnapshots.createdAt })
        .from(miSnapshots)
        .where(and(eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
        .orderBy(desc(miSnapshots.createdAt))
        .limit(1);
      latestSnapshots.mi = latestMi ? { id: latestMi.id, createdAt: latestMi.createdAt?.toISOString() || "" } : null;

      const [latestAud] = await db.select({ id: audienceSnapshots.id, createdAt: audienceSnapshots.createdAt })
        .from(audienceSnapshots)
        .where(and(eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
        .orderBy(desc(audienceSnapshots.createdAt))
        .limit(1);
      latestSnapshots.audience = latestAud ? { id: latestAud.id, createdAt: latestAud.createdAt?.toISOString() || "" } : null;

      const [latestPos] = await db.select({ id: positioningSnapshots.id, createdAt: positioningSnapshots.createdAt })
        .from(positioningSnapshots)
        .where(and(eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
        .orderBy(desc(positioningSnapshots.createdAt))
        .limit(1);
      latestSnapshots.positioning = latestPos ? { id: latestPos.id, createdAt: latestPos.createdAt?.toISOString() || "" } : null;

      const [latestDiff] = await db.select({ id: differentiationSnapshots.id, createdAt: differentiationSnapshots.createdAt })
        .from(differentiationSnapshots)
        .where(and(eq(differentiationSnapshots.campaignId, campaignId), eq(differentiationSnapshots.accountId, accountId)))
        .orderBy(desc(differentiationSnapshots.createdAt))
        .limit(1);
      latestSnapshots.differentiation = latestDiff ? { id: latestDiff.id, createdAt: latestDiff.createdAt?.toISOString() || "" } : null;

      const [latestMech] = await db.select({ id: mechanismSnapshots.id, createdAt: mechanismSnapshots.createdAt })
        .from(mechanismSnapshots)
        .where(and(eq(mechanismSnapshots.campaignId, campaignId), eq(mechanismSnapshots.accountId, accountId)))
        .orderBy(desc(mechanismSnapshots.createdAt))
        .limit(1);
      latestSnapshots.mechanism = latestMech ? { id: latestMech.id, createdAt: latestMech.createdAt?.toISOString() || "" } : null;

      const drift: string[] = [];
      if (latestSnapshots.mi && latestSnapshots.mi.id !== root.miSnapshotId) drift.push("MI");
      if (latestSnapshots.audience && latestSnapshots.audience.id !== root.audienceSnapshotId) drift.push("Audience");
      if (latestSnapshots.positioning && latestSnapshots.positioning.id !== root.positioningSnapshotId) drift.push("Positioning");
      if (latestSnapshots.differentiation && latestSnapshots.differentiation.id !== root.differentiationSnapshotId) drift.push("Differentiation");
      if (latestSnapshots.mechanism && latestSnapshots.mechanism.id !== root.mechanismSnapshotId) drift.push("Mechanism");

      const isValid = drift.length === 0;

      res.json({
        valid: isValid,
        hasRoot: true,
        rootId: root.id,
        rootHash: root.rootHash,
        runId: root.runId,
        drift,
        message: isValid
          ? "Strategy Root is current — all snapshot bindings match latest engine outputs."
          : `Strategy Root is stale. The following engines have newer outputs: ${drift.join(", ")}. Re-run the Mechanism Engine to regenerate the root.`,
        latestSnapshots,
        rootSnapshots: {
          mi: root.miSnapshotId,
          audience: root.audienceSnapshotId,
          positioning: root.positioningSnapshotId,
          differentiation: root.differentiationSnapshotId,
          mechanism: root.mechanismSnapshotId,
        },
      });
    } catch (error: any) {
      console.error("[StrategyRoot] Validate error:", error.message);
      res.status(500).json({ error: "Failed to validate strategy root" });
    }
  });

  console.log("[StrategyRoot] Routes registered: GET /api/strategy-root/active, GET /api/strategy-root/validate");
}

function safeJsonParse(text: any): any {
  if (!text) return null;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return null; }
}
