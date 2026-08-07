/**
 * SUPPLEMENTARY BUSINESS CONTEXT — not the primary product anchor.
 *
 * Historical label: "Product DNA". Canonical label going forward: "Product Context".
 * Status: supplementary_context_only — engines prefer the Product Identity
 * anchor (growth_campaigns.product_anchor, loaded by doctrine-seed.ts) when
 * it is set. This module provides additional business-context fields
 * (priceRange, targetAudienceSegment, strategicAdvantage, targetDecisionMaker)
 * that have no equivalent in the product_anchor schema and therefore cannot
 * be removed from engine context without a schema addition + migration.
 *
 * DO NOT add new consumers of this module. New product-level reads should
 * go through loadCampaignProductAnchor (server/orchestrator/doctrine-seed.ts).
 *
 * Safe to deprecate backend after:
 *   - product_anchor schema is extended to cover priceRange, targetAudienceSegment,
 *     strategicAdvantage, targetDecisionMaker
 *   - all engine call sites that consume these fields are migrated
 *   - zero active readers remain
 */
import { db } from "../db";
import { businessDataLayer } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface ProductDNA {
  productCategory: string | null;
  coreProblemSolved: string | null;
  uniqueMechanism: string | null;
  strategicAdvantage: string | null;
  targetDecisionMaker: string | null;
  businessType: string;
  coreOffer: string;
  targetAudienceSegment: string;
  priceRange: string;
}

export async function loadProductDNA(campaignId: string, accountId: string): Promise<ProductDNA | null> {
  const [bizData] = await db.select().from(businessDataLayer)
    .where(and(
      eq(businessDataLayer.campaignId, campaignId),
      eq(businessDataLayer.accountId, accountId),
    ))
    .limit(1);

  if (!bizData) return null;

  return {
    productCategory: bizData.productCategory || null,
    coreProblemSolved: bizData.coreProblemSolved || null,
    uniqueMechanism: bizData.uniqueMechanism || null,
    strategicAdvantage: bizData.strategicAdvantage || null,
    targetDecisionMaker: bizData.targetDecisionMaker || null,
    businessType: bizData.businessType,
    coreOffer: bizData.coreOffer,
    targetAudienceSegment: bizData.targetAudienceSegment,
    priceRange: bizData.priceRange,
  };
}

/**
 * Format supplementary business context for LLM prompts.
 *
 * Note: Product Identity (product_anchor) takes precedence over this block
 * in engine grounding. This block is included as supplementary context for
 * fields not yet covered by the product_anchor schema.
 */
export function formatProductDNAForPrompt(dna: ProductDNA): string {
  const lines: string[] = [];
  lines.push(`PRODUCT CONTEXT:`);
  lines.push(`- Business Type: ${dna.businessType}`);
  lines.push(`- Core Offer: ${dna.coreOffer}`);
  lines.push(`- Target Audience: ${dna.targetAudienceSegment}`);
  lines.push(`- Price Range: ${dna.priceRange}`);
  if (dna.productCategory) lines.push(`- Product Category: ${dna.productCategory}`);
  if (dna.coreProblemSolved) lines.push(`- Core Problem Solved: ${dna.coreProblemSolved}`);
  if (dna.uniqueMechanism) lines.push(`- Unique Mechanism: ${dna.uniqueMechanism}`);
  if (dna.strategicAdvantage) lines.push(`- Strategic Advantage: ${dna.strategicAdvantage}`);
  if (dna.targetDecisionMaker) lines.push(`- Target Decision Maker: ${dna.targetDecisionMaker}`);
  return lines.join("\n");
}
