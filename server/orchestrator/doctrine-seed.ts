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
  type ProductAnchor,
  type RunStrategicContext,
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
 * Tenant-scoped read of a campaign's persisted product anchor. growth_campaigns
 * has no accountId column, so ownership is proven by an inner join to the
 * account's own campaign_selections row (selectedCampaignId === campaignId AND
 * accountId === accountId). Returns null when the account does not own the
 * campaign OR no anchor is set — never another tenant's anchor (NO-TENANT-LEAK).
 * Single source of truth shared by seedDoctrine (run seeding) and read surfaces
 * (e.g. narrative grounding).
 */
export async function loadCampaignProductAnchor(
  campaignId: string,
  accountId: string,
): Promise<ProductAnchor | null> {
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
  return parseProductAnchor(campaign?.productAnchor ?? null);
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

  // Tenant-scoped anchor read (see loadCampaignProductAnchor for the
  // NO-TENANT-LEAK join rule). Absent anchor → business_level_degraded below.
  const productAnchor = await loadCampaignProductAnchor(campaignId, accountId);

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
 * Build the RunStrategicContext that the engine prompt builders + candidate gate
 * battery consume, drawn from the seeded SSC. Returns undefined when no doctrine
 * was seeded (a genuinely doctrine-less run) so the engine omits the doctrine
 * block rather than synthesizing a fake one (D5). Keeps each index.ts call site
 * to one argument.
 */
export function runStrategicContextOf(
  ctx: DoctrineCtxLike,
): RunStrategicContext | undefined {
  const doctrine = ctx.ssc?.doctrine;
  if (!doctrine) return undefined;
  const priorDecisions = Array.isArray(ctx.ssc?.priorDecisions)
    ? ctx.ssc.priorDecisions
    : [];
  return { doctrine, priorDecisions };
}

/**
 * Derive + append the audience engine's validated decision summary so the
 * contradiction gate can defend it in later engines. Called BOTH after a fresh
 * audience run AND on the snapshot-reuse path (a cache hit skips the engine, so
 * without this the downstream contradiction judge would silently abstain
 * forever — the Phase 2 "reuse trap"). No-op when there are no segments.
 */
export function appendAudienceDecision(
  ctx: DoctrineCtxLike,
  segments: Array<{ name: string; description?: string }>,
): void {
  if (!Array.isArray(segments) || segments.length === 0) return;
  const primary = segments[0];
  const names = segments.map((s) => s.name).filter(Boolean);
  const primaryTail = primary.description ? ` — ${primary.description}` : "";
  const summary = `Locked ${segments.length} audience segment(s): ${names.join("; ")}. Primary: ${primary.name}${primaryTail}`;
  appendPriorDecision(ctx, {
    engineId: "audience",
    summary,
    validatedAt: Date.now(),
  });
}

/**
 * Derive + append the positioning engine's validated decision summary so the
 * contradiction gate can defend it in later engines (offer, awareness, …).
 * Called after ctx.positioning is set — a point the fresh AND snapshot-reuse
 * paths both converge through. No-op when there are no territories.
 */
export function appendPositioningDecision(
  ctx: DoctrineCtxLike,
  territories: Array<{ name: string; enemyDefinition?: string }>,
): void {
  if (!Array.isArray(territories) || territories.length === 0) return;
  const primary = territories[0];
  const enemyTail = primary.enemyDefinition ? ` — enemy: ${primary.enemyDefinition}` : "";
  const summary = `Locked positioning on ${territories.length} territory(ies). Primary: ${primary.name}${enemyTail}`;
  appendPriorDecision(ctx, {
    engineId: "positioning",
    summary,
    validatedAt: Date.now(),
  });
}

/**
 * Derive + append the offer engine's validated decision summary. The offer case
 * does NOT converge (the reuse path breaks before the engine call), so callers
 * MUST invoke this on BOTH the reuse branch AND after a fresh run. No-op when
 * there is no named offer.
 */
export function appendOfferDecision(
  ctx: DoctrineCtxLike,
  offer: { offerName?: string; coreOutcome?: string; mechanismDescription?: string } | null | undefined,
): void {
  if (!offer || !offer.offerName) return;
  const outcomeTail = offer.coreOutcome ? ` — outcome: ${offer.coreOutcome}` : "";
  const mechTail = offer.mechanismDescription ? ` | mechanism: ${offer.mechanismDescription}` : "";
  const summary = `Locked offer: ${offer.offerName}${outcomeTail}${mechTail}`;
  appendPriorDecision(ctx, {
    engineId: "offer",
    summary,
    validatedAt: Date.now(),
  });
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
