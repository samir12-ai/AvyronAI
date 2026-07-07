import { db } from "../db";
import { and, eq } from "drizzle-orm";
import {
  growthCampaigns,
  businessDataLayer,
  campaignSelections,
} from "@shared/schema";
import type { SharedStrategicContext } from "./shared-strategic-context";
import {
  DOCTRINE_VERSION,
  resolveDoctrine,
  parseProductAnchor,
  type EngineDecisionSummary,
} from "../shared/strategic-doctrine";

/**
 * Phase 0 (AI Proposes / Code Validates) — doctrine seeding + prior-decision
 * append. Kept in a sibling module (not index.ts) so the orchestrator's
 * 5000-line ceiling is preserved; only ~1-line call sites live in index.ts.
 *
 * NO LLM calls here (only DB reads) — this stays outside the replay recorder's
 * bare-LLM-call restriction.
 */

interface DoctrineCtxLike {
  ssc?: SharedStrategicContext;
}

/**
 * Resolve the strategic doctrine for a run and seed it into the SSC before any
 * engine executes. Reads the campaign's product_anchor (nullable) and the
 * business_data_layer row for the business-level fallback. When no anchor is
 * present the doctrine degrades to business-level and stamps
 * resolution = "business_level_degraded" (never a silent substitute).
 *
 * Fail-loud: DB errors propagate. The run already depends on these tables, so a
 * failure here is a genuine environment failure, surfaced rather than swallowed.
 */
export async function seedDoctrine(
  ctx: DoctrineCtxLike,
  campaignId: string,
  accountId: string,
): Promise<void> {
  if (!ctx.ssc) return;

  // Tenant-scope the anchor read. growth_campaigns has no accountId column, so
  // ownership is proven by an inner join to the account's own campaign_selections
  // row (selectedCampaignId === campaignId AND accountId === accountId). If this
  // account does not own the campaign, the join yields no row → anchor treated as
  // absent → business_level_degraded, never another tenant's anchor (NO-TENANT-LEAK).
  const [campaign] = await db
    .select({ productAnchor: growthCampaigns.productAnchor })
    .from(growthCampaigns)
    .innerJoin(
      campaignSelections,
      eq(campaignSelections.selectedCampaignId, growthCampaigns.id),
    )
    .where(
      and(
        eq(growthCampaigns.id, campaignId),
        eq(campaignSelections.accountId, accountId),
      ),
    )
    .limit(1);

  const [biz] = await db
    .select({
      coreOffer: businessDataLayer.coreOffer,
      productCategory: businessDataLayer.productCategory,
    })
    .from(businessDataLayer)
    .where(
      and(
        eq(businessDataLayer.accountId, accountId),
        eq(businessDataLayer.campaignId, campaignId),
      ),
    )
    .limit(1);

  const productAnchor = parseProductAnchor(campaign?.productAnchor ?? null);
  const doctrine = resolveDoctrine({
    productAnchor,
    businessLevelOffer: biz?.coreOffer ?? null,
    productCategory: biz?.productCategory ?? null,
  });

  ctx.ssc.doctrine = doctrine;
  console.log(
    `[Doctrine] SEEDED | campaign=${campaignId} | resolution=${doctrine.resolution} | anchorHash=${doctrine.anchorHash || "none"} | version=${doctrine.version}`,
  );
}

/**
 * Append a validated one-paragraph decision summary from an engine so
 * downstream engines (and the contradiction gate) can reason against it.
 */
export function appendPriorDecision(
  ctx: DoctrineCtxLike,
  summary: EngineDecisionSummary,
): void {
  if (!ctx.ssc) return;
  if (!Array.isArray(ctx.ssc.priorDecisions)) ctx.ssc.priorDecisions = [];
  ctx.ssc.priorDecisions.push(summary);
  console.log(
    `[Doctrine] PRIOR_DECISION | engine=${summary.engineId} | count=${ctx.ssc.priorDecisions.length}`,
  );
}

/**
 * Deterministic salt threaded into every engine input hash so cached snapshots
 * invalidate when the doctrine version changes OR the campaign's product_anchor
 * is edited (anchorHash). Not a decision field — safe to compute defensively.
 */
export function doctrineSalt(ctx: DoctrineCtxLike): string {
  const d = ctx.ssc?.doctrine;
  if (!d) return `${DOCTRINE_VERSION}:`;
  return `${d.version}:${d.anchorHash}`;
}
