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

export async function loadProductDNA(campaignId: string, accountId: string = "default"): Promise<ProductDNA | null> {
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

export function formatProductDNAForPrompt(dna: ProductDNA): string {
  const lines: string[] = [];
  lines.push(`PRODUCT DNA (Source of Truth):`);
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
