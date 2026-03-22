import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import { planAssumptions, strategicPlans } from "../shared/schema";

export const CONFLICT_PRIORITY = [
  "hard_constraints",
  "compliance",
  "goal_feasibility",
  "funnel_math",
  "budget_limits",
  "business_fit",
  "channel_fit",
  "content_preference",
  "stylistic_suggestions",
] as const;

export type ConflictCategory = typeof CONFLICT_PRIORITY[number];

export interface ConflictItem {
  id: string;
  sourceEngine: string;
  category: ConflictCategory;
  description: string;
  conflictsWith: string;
  resolution: string;
  winner: string;
}

export interface AssumptionEntry {
  assumption: string;
  confidence: "low" | "medium" | "high";
  impactSeverity: "low" | "medium" | "high";
  source: string;
  affectedModules: string[];
}

export function resolveConflicts(conflicts: ConflictItem[]): ConflictItem[] {
  return conflicts.sort((a, b) => {
    const aPriority = CONFLICT_PRIORITY.indexOf(a.category);
    const bPriority = CONFLICT_PRIORITY.indexOf(b.category);
    return aPriority - bPriority;
  }).map(conflict => {
    const idx = CONFLICT_PRIORITY.indexOf(conflict.category);
    const conflictsWithIdx = CONFLICT_PRIORITY.findIndex(c => c === conflict.conflictsWith);

    if (conflictsWithIdx >= 0 && idx < conflictsWithIdx) {
      conflict.winner = conflict.sourceEngine;
      conflict.resolution = `${conflict.sourceEngine} wins: ${CONFLICT_PRIORITY[idx]} takes priority over ${CONFLICT_PRIORITY[conflictsWithIdx]}`;
    } else if (conflictsWithIdx >= 0 && idx > conflictsWithIdx) {
      conflict.winner = conflict.conflictsWith;
      conflict.resolution = `${conflict.conflictsWith} wins: higher priority rule`;
    }

    return conflict;
  });
}

export async function logAssumptions(
  planId: string,
  campaignId: string,
  accountId: string,
  assumptions: AssumptionEntry[]
) {
  if (assumptions.length === 0) return;

  const values = assumptions.map(a => ({
    planId,
    campaignId,
    accountId,
    assumption: a.assumption,
    confidence: a.confidence,
    impactSeverity: a.impactSeverity,
    source: a.source,
    affectedModules: JSON.stringify(a.affectedModules),
  }));

  await db.insert(planAssumptions).values(values);
  console.log(`[ConflictResolver] Logged ${values.length} assumptions for plan ${planId}`);
}

export async function getAssumptionsForPlan(planId: string) {
  const rows = await db.select().from(planAssumptions)
    .where(eq(planAssumptions.planId, planId));

  return rows.map(r => ({
    ...r,
    affectedModules: r.affectedModules ? (() => { try { return JSON.parse(r.affectedModules); } catch { return []; } })() : [],
  }));
}

function detectImplicitAssumptions(planData: any, bizData: any): AssumptionEntry[] {
  const assumptions: AssumptionEntry[] = [];

  if (!bizData?.closeRate && !bizData?.conversionRate) {
    assumptions.push({
      assumption: "Close rate assumed at 10% (industry average)",
      confidence: "low",
      impactSeverity: "high",
      source: "goal_math",
      affectedModules: ["funnel_math", "simulation", "lead_targets"],
    });
  }

  if (!bizData?.monthlyBudget) {
    assumptions.push({
      assumption: "Budget assumed as modest ($300-500/mo)",
      confidence: "low",
      impactSeverity: "high",
      source: "plan_gate",
      affectedModules: ["budget_allocation", "ad_planning", "simulation"],
    });
  }

  if (!bizData?.primaryConversionChannel) {
    assumptions.push({
      assumption: "Primary channel assumed as Instagram",
      confidence: "medium",
      impactSeverity: "medium",
      source: "channel_selection",
      affectedModules: ["content_distribution", "channel_fit", "ad_planning"],
    });
  }

  if (!bizData?.targetAudienceSegment) {
    assumptions.push({
      assumption: "Target audience derived from business type and location only",
      confidence: "medium",
      impactSeverity: "medium",
      source: "audience_engine",
      affectedModules: ["content_strategy", "messaging", "ad_targeting"],
    });
  }

  return assumptions;
}

export function registerConflictResolverRoutes(app: Express) {
  app.get("/api/plan-assumptions/:planId", async (req: Request, res: Response) => {
    try {
      const assumptions = await getAssumptionsForPlan(req.params.planId);
      const highImpact = assumptions.filter(a => a.impactSeverity === "high");
      const lowConfidence = assumptions.filter(a => a.confidence === "low");

      res.json({
        success: true,
        total: assumptions.length,
        highImpactCount: highImpact.length,
        lowConfidenceCount: lowConfidence.length,
        assumptions,
        conflictPriority: CONFLICT_PRIORITY,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/plan-assumptions/detect", async (req: Request, res: Response) => {
    try {
      const { planId, campaignId } = req.body;
      if (!planId || !campaignId) return res.status(400).json({ error: "planId and campaignId required" });
      const accountId = (req as any).accountId || "default";

      const { businessDataLayer } = await import("../shared/schema");
      const [bizData] = await db.select().from(businessDataLayer)
        .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
        .orderBy(desc(businessDataLayer.createdAt)).limit(1);

      const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
      const planData = plan?.planJson ? JSON.parse(plan.planJson) : null;

      const detected = detectImplicitAssumptions(planData, bizData);
      if (detected.length > 0) {
        await logAssumptions(planId, campaignId, accountId, detected);
      }

      res.json({ success: true, detected: detected.length, assumptions: detected });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log("[ConflictResolver] Routes registered");
}
