import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  audienceSnapshots,
  positioningSnapshots,
  miSnapshots,
  strategicPlans,
} from "@shared/schema";
import { requireCampaign } from "../campaign-routes";
import { resolveAccountId } from "../auth";

const LOG = "[Diagnose/Projection]";

// D3: strict enums for every verdict-shaped field on the projection.
const SignalOriginEnum = z.enum(["real", "competitor", "inferred", "fallback", "unknown"]);
const ValidationStateEnum = z.enum(["validated", "provisional", "weak", "rejected", "unknown"]);
const PlanSourceEnum = z.enum([
  "decision_driven",
  "degraded_no_decisions",
  "degraded_ai_failed",
  "deterministic_fallback",
  "unknown",
]);
const DegradationSourceEnum = z.enum([
  "data_quality",
  "missing_dependency",
  "fetch",
  "fallback_plan",
  "system-control",
  "engine_failure",
]);
const ConfidenceBandEnum = z.enum(["strong", "moderate", "low", "unknown"]);

const DegradationSchema = z
  .object({
    flag: z.literal(true),
    reason: z.string(),
    source: DegradationSourceEnum,
    signalOrigin: SignalOriginEnum,
  })
  .nullable();

const AudienceLayerSchema = z.object({
  status: z.string().nullable(),
  defensiveMode: z.boolean(),
  confidenceScore: z.number().nullable(),
  topPains: z.array(z.string()),
  topDesires: z.array(z.string()),
  topObjections: z.array(z.string()),
  inferredCount: z.number().int().nonnegative(),
  signalOrigin: SignalOriginEnum,
  degraded: DegradationSchema,
  sourceEndpoint: z.literal("/api/audience-engine/latest"),
});

const PositioningLayerSchema = z.object({
  snapshotStatus: z.string().nullable(),
  driftDetected: z.boolean(),
  confidenceScore: z.number().nullable(),
  territoryCount: z.number().int().nonnegative(),
  primaryTerritory: z.string().nullable(),
  differentiationStatement: z.string().nullable(),
  signalOrigin: SignalOriginEnum,
  degraded: DegradationSchema,
  sourceEndpoint: z.literal("/api/positioning-engine/latest"),
});

const CompetitiveLayerSchema = z.object({
  status: z.string().nullable(),
  marketDiagnosis: z.string().nullable(),
  confidenceBand: ConfidenceBandEnum,
  realCommentRatio: z.number().nullable(),
  echoChamberRisk: z.number().nullable(),
  sampleBiasFlag: z.boolean(),
  signalOrigin: SignalOriginEnum,
  degraded: DegradationSchema,
  sourceEndpoint: z.literal("/api/ci/mi-v3/snapshots/latest"),
});

const DiagnoseProjectionSchema = z.object({
  campaignId: z.string(),
  accountId: z.string(),
  generatedAt: z.string(),
  validationState: ValidationStateEnum,
  planSource: PlanSourceEnum,
  fallbackPlanIsolated: z.boolean(),
  contractIncompleteFields: z.array(z.string()),
  signalOrigin: z.object({
    real: z.number(),
    competitor: z.number(),
    inferred: z.number(),
    fallback: z.number(),
    unknown: z.number(),
  }),
  layers: z.object({
    audience: AudienceLayerSchema,
    positioning: PositioningLayerSchema,
    competitive: CompetitiveLayerSchema,
  }),
  narrative: z.object({
    summary: z.string(),
    blockers: z.array(z.string()),
    nextLooks: z.array(z.string()),
  }),
});

export type DiagnoseProjection = z.infer<typeof DiagnoseProjectionSchema>;
type AudienceLayer = z.infer<typeof AudienceLayerSchema>;
type PositioningLayer = z.infer<typeof PositioningLayerSchema>;
type CompetitiveLayer = z.infer<typeof CompetitiveLayerSchema>;
type SignalOriginType = z.infer<typeof SignalOriginEnum>;
type PlanSource = z.infer<typeof PlanSourceEnum>;
type ValidationState = z.infer<typeof ValidationStateEnum>;
type Degradation = z.infer<typeof DegradationSchema>;

type JsonRecord = Record<string, unknown>;

function safeJsonParse<T = unknown>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw as T;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function firstStrings(rows: unknown[], field: string, limit = 5): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (out.length >= limit) break;
    if (row && typeof row === "object") {
      const val = (row as JsonRecord)[field];
      if (typeof val === "string" && val.trim()) out.push(val.trim());
    }
  }
  return out;
}

async function loadAudienceLayer(campaignId: string, accountId: string): Promise<{ layer: AudienceLayer; incomplete: string[] }> {
  const incomplete: string[] = [];
  try {
    const [row] = await db
      .select()
      .from(audienceSnapshots)
      .where(and(eq(audienceSnapshots.campaignId, campaignId), eq(audienceSnapshots.accountId, accountId)))
      .orderBy(desc(audienceSnapshots.createdAt))
      .limit(1);

    if (!row) {
      incomplete.push("layers.audience.status");
      return {
        layer: {
          status: null,
          defensiveMode: false,
          confidenceScore: null,
          topPains: [],
          topDesires: [],
          topObjections: [],
          inferredCount: 0,
          signalOrigin: "unknown",
          degraded: {
            flag: true,
            reason: "No audience snapshot for this campaign yet",
            source: "missing_dependency",
            signalOrigin: "unknown",
          },
          sourceEndpoint: "/api/audience-engine/latest",
        },
        incomplete,
      };
    }

    const r = row as unknown as JsonRecord;
    const painMap = asArray(safeJsonParse(r.painMap));
    const desireMap = asArray(safeJsonParse(r.desireMap));
    const objectionMap = asArray(safeJsonParse(r.objectionMap));
    const status = typeof r.status === "string" ? r.status : null;
    const defensiveMode = r.defensiveMode === true;
    const confidenceScore = typeof r.confidenceScore === "number" ? r.confidenceScore : null;

    const allEntries = [...painMap, ...desireMap, ...objectionMap];
    let inferredCount = 0;
    for (const entry of allEntries) {
      if (entry && typeof entry === "object") {
        const sources = asArray((entry as JsonRecord).sourceSignals);
        if (sources.some(s => typeof s === "string" && s.startsWith("inferred_"))) inferredCount++;
      }
    }

    const isPartial = status === "PARTIAL" || status === "DATASET_TOO_SMALL" || status === "INSUFFICIENT_SIGNALS";
    const origin: SignalOriginType = defensiveMode || isPartial ? "inferred" : "real";
    const degraded: Degradation = (defensiveMode || isPartial)
      ? {
          flag: true,
          reason: defensiveMode ? "Audience engine in defensive mode (low signal quality)" : `Audience snapshot status=${status}`,
          source: "data_quality",
          signalOrigin: "inferred",
        }
      : null;

    return {
      layer: {
        status,
        defensiveMode,
        confidenceScore,
        topPains: firstStrings(painMap, "label"),
        topDesires: firstStrings(desireMap, "label"),
        topObjections: firstStrings(objectionMap, "label"),
        inferredCount,
        signalOrigin: origin,
        degraded,
        sourceEndpoint: "/api/audience-engine/latest",
      },
      incomplete,
    };
  } catch (err) {
    incomplete.push("layers.audience.status");
    return {
      layer: {
        status: null,
        defensiveMode: false,
        confidenceScore: null,
        topPains: [],
        topDesires: [],
        topObjections: [],
        inferredCount: 0,
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: `Audience load failed: ${err instanceof Error ? err.message : String(err)}`,
          source: "fetch",
          signalOrigin: "unknown",
        },
        sourceEndpoint: "/api/audience-engine/latest",
      },
      incomplete,
    };
  }
}

async function loadPositioningLayer(campaignId: string, accountId: string): Promise<{ layer: PositioningLayer; incomplete: string[] }> {
  const incomplete: string[] = [];
  try {
    const [row] = await db
      .select()
      .from(positioningSnapshots)
      .where(and(eq(positioningSnapshots.campaignId, campaignId), eq(positioningSnapshots.accountId, accountId)))
      .orderBy(desc(positioningSnapshots.createdAt))
      .limit(1);

    if (!row) {
      incomplete.push("layers.positioning.snapshotStatus");
      return {
        layer: {
          snapshotStatus: null,
          driftDetected: false,
          confidenceScore: null,
          territoryCount: 0,
          primaryTerritory: null,
          differentiationStatement: null,
          signalOrigin: "unknown",
          degraded: {
            flag: true,
            reason: "No positioning snapshot for this campaign yet",
            source: "missing_dependency",
            signalOrigin: "unknown",
          },
          sourceEndpoint: "/api/positioning-engine/latest",
        },
        incomplete,
      };
    }

    const r = row as unknown as JsonRecord;
    const status = typeof r.snapshotStatus === "string" ? r.snapshotStatus : null;
    const stability = safeJsonParse<JsonRecord>(r.stabilityResult);
    const driftDetected = stability?.driftDetected === true;
    const confidenceScore = typeof stability?.confidenceScore === "number" ? stability.confidenceScore : null;
    const territories = asArray(safeJsonParse(r.territories));
    const primary = safeJsonParse<JsonRecord>(r.territory);
    const diffVector = safeJsonParse<JsonRecord>(r.differentiationVector);

    const isPartial = status === "PARTIAL";
    const origin: SignalOriginType = isPartial || driftDetected ? "inferred" : "real";
    const degraded: Degradation = (isPartial || driftDetected)
      ? {
          flag: true,
          reason: isPartial ? "Positioning snapshot is PARTIAL" : "Positioning stability drift detected",
          source: "data_quality",
          signalOrigin: "inferred",
        }
      : null;

    return {
      layer: {
        snapshotStatus: status,
        driftDetected,
        confidenceScore,
        territoryCount: territories.length,
        primaryTerritory: typeof primary?.name === "string" ? primary.name : null,
        differentiationStatement: typeof diffVector?.statement === "string" ? diffVector.statement : null,
        signalOrigin: origin,
        degraded,
        sourceEndpoint: "/api/positioning-engine/latest",
      },
      incomplete,
    };
  } catch (err) {
    incomplete.push("layers.positioning.snapshotStatus");
    return {
      layer: {
        snapshotStatus: null,
        driftDetected: false,
        confidenceScore: null,
        territoryCount: 0,
        primaryTerritory: null,
        differentiationStatement: null,
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: `Positioning load failed: ${err instanceof Error ? err.message : String(err)}`,
          source: "fetch",
          signalOrigin: "unknown",
        },
        sourceEndpoint: "/api/positioning-engine/latest",
      },
      incomplete,
    };
  }
}

async function loadCompetitiveLayer(campaignId: string, accountId: string): Promise<{ layer: CompetitiveLayer; incomplete: string[] }> {
  const incomplete: string[] = [];
  try {
    const [row] = await db
      .select()
      .from(miSnapshots)
      .where(and(eq(miSnapshots.campaignId, campaignId), eq(miSnapshots.accountId, accountId)))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(1);

    if (!row) {
      incomplete.push("layers.competitive.status");
      return {
        layer: {
          status: null,
          marketDiagnosis: null,
          confidenceBand: "unknown",
          realCommentRatio: null,
          echoChamberRisk: null,
          sampleBiasFlag: false,
          signalOrigin: "unknown",
          degraded: {
            flag: true,
            reason: "No competitive intelligence snapshot for this campaign yet",
            source: "missing_dependency",
            signalOrigin: "unknown",
          },
          sourceEndpoint: "/api/ci/mi-v3/snapshots/latest",
        },
        incomplete,
      };
    }

    const r = row as unknown as JsonRecord;
    const status = typeof r.status === "string" ? r.status : null;
    const diagnostics = safeJsonParse<JsonRecord>(r.diagnosticsData) ?? safeJsonParse<JsonRecord>(r.diagnostics) ?? {};
    const confidence = safeJsonParse<JsonRecord>(r.confidence) ?? {};
    const marketDiagnosis = typeof r.marketDiagnosis === "string"
      ? r.marketDiagnosis
      : (typeof diagnostics.marketDiagnosis === "string" ? diagnostics.marketDiagnosis : null);

    const confidenceLevel = typeof confidence.level === "string" ? confidence.level.toLowerCase() : "";
    let confidenceBand: CompetitiveLayer["confidenceBand"] = "unknown";
    if (confidenceLevel === "strong") confidenceBand = "strong";
    else if (confidenceLevel === "moderate") confidenceBand = "moderate";
    else if (confidenceLevel === "low" || confidenceLevel === "weak") confidenceBand = "low";

    const realCommentRatio = typeof diagnostics.realCommentRatio === "number" ? diagnostics.realCommentRatio : null;
    const echoChamberRisk = typeof diagnostics.echoChamberRisk === "number" ? diagnostics.echoChamberRisk : null;
    const sampleBiasFlag = diagnostics.sampleBiasFlag === true;
    const isPartial = status === "PARTIAL";
    const isThin = (realCommentRatio !== null && realCommentRatio < 0.3) || sampleBiasFlag;

    const origin: SignalOriginType = isPartial ? "inferred" : "competitor";
    const degraded: Degradation = (isPartial || isThin)
      ? {
          flag: true,
          reason: isPartial ? "MIv3 snapshot is PARTIAL" : "Thin or biased competitive sample",
          source: "data_quality",
          signalOrigin: origin,
        }
      : null;

    return {
      layer: {
        status,
        marketDiagnosis,
        confidenceBand,
        realCommentRatio,
        echoChamberRisk,
        sampleBiasFlag,
        signalOrigin: origin,
        degraded,
        sourceEndpoint: "/api/ci/mi-v3/snapshots/latest",
      },
      incomplete,
    };
  } catch (err) {
    incomplete.push("layers.competitive.status");
    return {
      layer: {
        status: null,
        marketDiagnosis: null,
        confidenceBand: "unknown",
        realCommentRatio: null,
        echoChamberRisk: null,
        sampleBiasFlag: false,
        signalOrigin: "unknown",
        degraded: {
          flag: true,
          reason: `Competitive load failed: ${err instanceof Error ? err.message : String(err)}`,
          source: "fetch",
          signalOrigin: "unknown",
        },
        sourceEndpoint: "/api/ci/mi-v3/snapshots/latest",
      },
      incomplete,
    };
  }
}

async function loadPlanContext(campaignId: string, accountId: string): Promise<{
  planSource: PlanSource;
  fallbackPlanIsolated: boolean;
}> {
  try {
    const [row] = await db
      .select()
      .from(strategicPlans)
      .where(and(eq(strategicPlans.campaignId, campaignId), eq(strategicPlans.accountId, accountId)))
      .orderBy(desc(strategicPlans.createdAt))
      .limit(1);

    if (!row) return { planSource: "unknown", fallbackPlanIsolated: false };
    const r = row as unknown as JsonRecord;
    const raw = typeof r.planSource === "string" ? r.planSource : null;
    const allowed: PlanSource[] = ["decision_driven", "degraded_no_decisions", "degraded_ai_failed", "deterministic_fallback"];
    const planSource: PlanSource = (raw && (allowed as readonly string[]).includes(raw))
      ? (raw as PlanSource)
      : "unknown";
    const fallbackPlanIsolated = planSource === "deterministic_fallback" || planSource === "degraded_ai_failed";
    return { planSource, fallbackPlanIsolated };
  } catch {
    return { planSource: "unknown", fallbackPlanIsolated: false };
  }
}

function composeOriginDistribution(origins: SignalOriginType[]) {
  const dist = { real: 0, competitor: 0, inferred: 0, fallback: 0, unknown: 0 };
  if (origins.length === 0) return dist;
  for (const o of origins) dist[o] += 1;
  const total = origins.length;
  (Object.keys(dist) as Array<keyof typeof dist>).forEach(k => {
    dist[k] = +(dist[k] / total).toFixed(4);
  });
  return dist;
}

function composeValidationState(planSource: PlanSource, anyDegraded: boolean, incompleteCount: number): ValidationState {
  if (planSource === "unknown" && incompleteCount >= 2) return "unknown";
  if (planSource === "deterministic_fallback" || planSource === "degraded_ai_failed") return "weak";
  if (anyDegraded || incompleteCount > 0) return "provisional";
  if (planSource === "decision_driven") return "validated";
  return "provisional";
}

function composeNarrative(args: {
  audience: AudienceLayer;
  positioning: PositioningLayer;
  competitive: CompetitiveLayer;
}): { summary: string; blockers: string[]; nextLooks: string[] } {
  const { audience, positioning, competitive } = args;
  const blockers: string[] = [];
  const nextLooks: string[] = [];

  if (audience.topObjections.length > 0) {
    blockers.push(`Buyers hesitate on: ${audience.topObjections.slice(0, 2).join(" · ")}`);
  }
  if (audience.defensiveMode) blockers.push("Audience signal quality is low — running in defensive mode");
  if (positioning.driftDetected) blockers.push("Positioning has drifted from the prior baseline");
  if (positioning.snapshotStatus === "PARTIAL") blockers.push("Positioning evidence is partial");
  if (competitive.sampleBiasFlag) blockers.push("Competitor sample is biased — diagnosis may be skewed");
  if (competitive.realCommentRatio !== null && competitive.realCommentRatio < 0.3) {
    blockers.push("Thin engagement signal from competitor data");
  }

  if (audience.topPains.length > 0) nextLooks.push(`Address top pain: ${audience.topPains[0]}`);
  if (audience.topDesires.length > 0) nextLooks.push(`Reinforce top desire: ${audience.topDesires[0]}`);
  if (positioning.differentiationStatement) nextLooks.push(`Lean into: ${positioning.differentiationStatement}`);
  if (competitive.marketDiagnosis) nextLooks.push(competitive.marketDiagnosis);

  const summaryParts: string[] = [];
  if (positioning.primaryTerritory) {
    summaryParts.push(`You're positioned in "${positioning.primaryTerritory}"`);
  }
  if (audience.topPains.length > 0 || audience.topObjections.length > 0) {
    summaryParts.push(`speaking to buyers worried about ${(audience.topPains[0] || audience.topObjections[0]).toLowerCase()}`);
  }
  if (competitive.confidenceBand !== "unknown") {
    summaryParts.push(`with ${competitive.confidenceBand} competitive evidence`);
  }
  const summary = summaryParts.length > 0
    ? summaryParts.join(", ") + "."
    : "Diagnosis is still forming — connect data sources and run the engines for a complete picture.";

  return { summary, blockers, nextLooks };
}

export function registerDiagnoseRoutes(app: Express) {
  app.get(
    "/api/diagnose/projection/:campaignId",
    requireCampaign,
    async (req: Request, res: Response) => {
      const t0 = Date.now();
      try {
        const ctx = (req as { campaignContext?: { campaignId?: string; accountId?: string } }).campaignContext;
        const campaignId = String(req.params.campaignId);
        const accountId = String(ctx?.accountId || resolveAccountId(req));

        if (ctx?.campaignId && ctx.campaignId !== campaignId) {
          return res.status(403).json({ error: "Campaign mismatch" });
        }

        const [audience, positioning, competitive, planCtx] = await Promise.all([
          loadAudienceLayer(campaignId, accountId),
          loadPositioningLayer(campaignId, accountId),
          loadCompetitiveLayer(campaignId, accountId),
          loadPlanContext(campaignId, accountId),
        ]);

        const contractIncompleteFields = [
          ...audience.incomplete,
          ...positioning.incomplete,
          ...competitive.incomplete,
        ];

        const origins: SignalOriginType[] = [
          audience.layer.signalOrigin,
          positioning.layer.signalOrigin,
          competitive.layer.signalOrigin,
        ];
        const distribution = composeOriginDistribution(origins);
        const anyDegraded =
          audience.layer.degraded !== null ||
          positioning.layer.degraded !== null ||
          competitive.layer.degraded !== null;

        const validationState = composeValidationState(
          planCtx.planSource,
          anyDegraded,
          contractIncompleteFields.length,
        );

        const narrative = composeNarrative({
          audience: audience.layer,
          positioning: positioning.layer,
          competitive: competitive.layer,
        });

        const projection: DiagnoseProjection = {
          campaignId,
          accountId,
          generatedAt: new Date().toISOString(),
          validationState,
          planSource: planCtx.planSource,
          fallbackPlanIsolated: planCtx.fallbackPlanIsolated,
          contractIncompleteFields,
          signalOrigin: distribution,
          layers: {
            audience: audience.layer,
            positioning: positioning.layer,
            competitive: competitive.layer,
          },
          narrative,
        };

        const parsed = DiagnoseProjectionSchema.safeParse(projection);
        if (!parsed.success) {
          console.error(`${LOG} SCHEMA_VALIDATION_FAILED`, parsed.error.flatten());
          return res.status(500).json({ error: "DIAGNOSE_SCHEMA_FAILED", details: parsed.error.flatten() });
        }

        const ms = Date.now() - t0;
        console.log(`${LOG} validationState=${validationState} planSource=${planCtx.planSource} incomplete=${contractIncompleteFields.length} ms=${ms}`);
        return res.json(parsed.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${LOG} composer_failed`, err);
        return res.status(500).json({ error: "DIAGNOSE_FAILED", details: msg });
      }
    },
  );
}
