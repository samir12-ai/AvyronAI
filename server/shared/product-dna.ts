import { db } from "../db";
import { businessUnderstandingSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export interface TargetRoleItem {
  targetRoleFactId: string;
  roleTitle: string;
  roleType: string;
  rationale?: string;
  status?: string;
  evidenceRefIds?: string[];
  campaignOfferingId?: string;
}

export interface ProductTruthFactItem {
  productTruthFactId: string;
  statement: string;
  factType: string;
  status?: string;
  rationale?: string;
  evidenceRefIds?: string[];
  campaignOfferingId?: string;
}

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
  campaignOfferingId?: string;
  businessUnderstandingAuthorityId?: string;
  targetUnderstandingAuthorityId?: string;
  targetRoles?: TargetRoleItem[];
  productTruthFacts?: ProductTruthFactItem[];
}

export async function loadProductDNA(campaignId: string, accountId: string): Promise<ProductDNA | null> {
  const [buSnap] = await db.select({
    id: businessUnderstandingSnapshots.id,
    campaignOfferingId: businessUnderstandingSnapshots.campaignOfferingId,
    payload: businessUnderstandingSnapshots.businessUnderstanding
  })
    .from(businessUnderstandingSnapshots)
    .where(and(
      eq(businessUnderstandingSnapshots.campaignId, campaignId),
      eq(businessUnderstandingSnapshots.accountId, accountId)
    ))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);
    
  if (buSnap?.payload) {
    const data = buSnap.payload as any;
    const offering = data.campaignOffering || {};
    const target = data.targetUnderstanding || {};
    const targetRoles: TargetRoleItem[] = Array.isArray(target.targetRoles) ? target.targetRoles : [];
    const productTruthFacts: ProductTruthFactItem[] = Array.isArray(offering.productTruthFacts) ? offering.productTruthFacts : [];

    // Extract target roles from canonical targetRoles array
    const decisionMakerRole = targetRoles.find(r => r.roleType === "DECISION_MAKER")?.roleTitle
      || (targetRoles.length > 0 ? targetRoles[0].roleTitle : null);
    
    const buyerOrUserRole = targetRoles.find(r => r.roleType === "BUYER" || r.roleType === "USER")?.roleTitle
      || (targetRoles.length > 1 ? targetRoles[1].roleTitle : decisionMakerRole);

    // Extract core problem & unique mechanism from canonical product truth facts
    const capabilityFacts = productTruthFacts.filter(f => f.factType === "CAPABILITY" || !f.factType);
    const uniqueMechanism = capabilityFacts.length > 0
      ? capabilityFacts.map(f => f.statement).slice(0, 2).join("; ")
      : (offering.offeringName ? `${offering.offeringName} Core Capability` : null);

    const coreProblem = productTruthFacts.find(f => 
      f.statement.toLowerCase().includes("problem") || 
      f.statement.toLowerCase().includes("struggle") || 
      f.statement.toLowerCase().includes("fragmented") || 
      f.statement.toLowerCase().includes("overhead") ||
      f.statement.toLowerCase().includes("focuses on")
    )?.statement || (offering.category ? `Challenges addressed by ${offering.category}` : null);

    const businessType = data.businessModel || offering.category || "B2B SaaS";
    const coreOffer = offering.offeringName || data.businessName || "Offering";
    const productCategory = offering.category || data.generalIndustry || null;
    const priceRange = offering.pricingModel || "Subscription-based";
    const targetDecisionMaker = decisionMakerRole || null;
    const targetAudienceSegment = buyerOrUserRole || decisionMakerRole || null;

    return {
      productCategory,
      coreProblemSolved: coreProblem,
      uniqueMechanism,
      strategicAdvantage: capabilityFacts.length > 2 ? capabilityFacts[2].statement : null,
      targetDecisionMaker,
      businessType,
      coreOffer,
      targetAudienceSegment: targetAudienceSegment || "Target Market",
      priceRange,
      campaignOfferingId: buSnap.campaignOfferingId || offering.campaignOfferingId || undefined,
      businessUnderstandingAuthorityId: buSnap.id || data.businessUnderstandingAuthorityId || undefined,
      targetUnderstandingAuthorityId: target.targetUnderstandingAuthorityId || undefined,
      targetRoles,
      productTruthFacts,
    };
  }

  return null;
}

/**
 * Format supplementary business context for LLM prompts with rich canonical grounding.
 */
export function formatProductDNAForPrompt(dna: ProductDNA): string {
  const lines: string[] = [];
  lines.push(`PRODUCT & TARGET CONTEXT:`);
  if (dna.businessType) lines.push(`- Business Type: ${dna.businessType}`);
  if (dna.coreOffer) lines.push(`- Core Offer: ${dna.coreOffer}`);
  if (dna.productCategory) lines.push(`- Product Category: ${dna.productCategory}`);
  if (dna.priceRange) lines.push(`- Pricing Model / Price Range: ${dna.priceRange}`);
  
  if (dna.targetRoles && dna.targetRoles.length > 0) {
    lines.push(`- Canonical Target Roles:`);
    for (const r of dna.targetRoles) {
      lines.push(`  * [${r.roleType || 'ROLE'}] ${r.roleTitle}${r.rationale ? `: ${r.rationale}` : ''} (ID: ${r.targetRoleFactId})`);
    }
  } else {
    if (dna.targetDecisionMaker) lines.push(`- Target Decision Maker: ${dna.targetDecisionMaker}`);
    if (dna.targetAudienceSegment) lines.push(`- Target Audience Segment: ${dna.targetAudienceSegment}`);
  }

  if (dna.productTruthFacts && dna.productTruthFacts.length > 0) {
    lines.push(`- Canonical Product Truth Capabilities & Facts:`);
    for (const f of dna.productTruthFacts) {
      lines.push(`  * [${f.factType || 'FACT'}] ${f.statement} (Fact ID: ${f.productTruthFactId})`);
    }
  } else {
    if (dna.coreProblemSolved) lines.push(`- Core Problem Solved: ${dna.coreProblemSolved}`);
    if (dna.uniqueMechanism) lines.push(`- Unique Mechanism: ${dna.uniqueMechanism}`);
    if (dna.strategicAdvantage) lines.push(`- Strategic Advantage: ${dna.strategicAdvantage}`);
  }

  return lines.join("\n");
}

