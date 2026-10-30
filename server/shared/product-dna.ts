import crypto from "crypto";
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
  sourceRef?: string;
  scope?: string;
  qualifications?: string;
}

export interface CanonicalProductTruthSnapshot {
  snapshotId: string;
  accountId: string;
  campaignId: string;
  campaignOfferingId: string | null;
  businessUnderstandingAuthorityId: string;
  targetUnderstandingAuthorityId: string | null;
  fingerprint: string;
  facts: readonly ProductTruthFactItem[];
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
  accountId?: string;
  campaignId?: string;
  campaignOfferingId?: string;
  businessUnderstandingAuthorityId?: string;
  targetUnderstandingAuthorityId?: string;
  snapshotId?: string;
  snapshotFingerprint?: string;
  canonicalProductTruthSnapshot?: CanonicalProductTruthSnapshot;
  targetRoles?: TargetRoleItem[];
  productTruthFacts?: ProductTruthFactItem[];
}

export function computeProductTruthFingerprint(params: {
  snapshotId?: string | null;
  campaignOfferingId?: string | null;
  facts: ReadonlyArray<Partial<ProductTruthFactItem> & { fact?: string; id?: string; factId?: string }>;
}): string {
  const normalizedFacts = (params.facts || [])
    .map((f) => {
      const id = String(f.productTruthFactId || f.factId || f.id || "").trim();
      const type = String(f.factType || "CAPABILITY").trim().toUpperCase();
      const stmt = String(f.statement || f.fact || "").trim();
      const status = String(f.status || "VERIFIED").trim().toUpperCase();
      const scope = String(f.scope || "").trim();
      const quals = Array.isArray(f.qualifications)
        ? f.qualifications.map((q: any) => String(q || "").trim()).filter(Boolean).join("; ")
        : String(f.qualifications || f.rationale || "").trim();
      return `${id}|${type}|${status}|${scope}|${quals}|${stmt}`;
    })
    .sort();
  const payload = JSON.stringify({
    snapshotId: String(params.snapshotId || "").trim(),
    campaignOfferingId: String(params.campaignOfferingId || "").trim(),
    facts: normalizedFacts,
  });
  return "pt_" + crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function verifyProductTruthSnapshotLineage(
  dnaOrSnapshot: Partial<ProductDNA & CanonicalProductTruthSnapshot> | null | undefined,
  expected?: {
    accountId?: string | null;
    campaignId?: string | null;
    campaignOfferingId?: string | null;
    expectedOfferingId?: string | null;
    snapshotId?: string | null;
    expectedSnapshotId?: string | null;
    fingerprint?: string | null;
    expectedFingerprint?: string | null;
  },
  caller?: string,
): void {
  if (!dnaOrSnapshot || !expected) return;
  const prefix = caller ? `[${caller}] ` : "";

  const expectedAccount = expected.accountId;
  const actualAccount = dnaOrSnapshot.accountId || dnaOrSnapshot.canonicalProductTruthSnapshot?.accountId;
  if (expectedAccount && actualAccount && actualAccount !== expectedAccount) {
    throw new Error(
      `${prefix}PRODUCT_TRUTH_ACCOUNT_MISMATCH: Canonical Product Truth snapshot account "${actualAccount}" does not match expected account "${expectedAccount}"`,
    );
  }

  const expectedCampaign = expected.campaignId;
  const actualCampaign = dnaOrSnapshot.campaignId || dnaOrSnapshot.canonicalProductTruthSnapshot?.campaignId;
  if (expectedCampaign && actualCampaign && actualCampaign !== expectedCampaign) {
    throw new Error(
      `${prefix}PRODUCT_TRUTH_CAMPAIGN_MISMATCH: Canonical Product Truth snapshot campaign "${actualCampaign}" does not match expected campaign "${expectedCampaign}"`,
    );
  }

  const expectedOffering = expected.campaignOfferingId ?? expected.expectedOfferingId ?? null;
  const actualOffering =
    dnaOrSnapshot.campaignOfferingId ||
    dnaOrSnapshot.canonicalProductTruthSnapshot?.campaignOfferingId ||
    null;
  if (expectedOffering && actualOffering !== expectedOffering) {
    throw new Error(
      `${prefix}PRODUCT_TRUTH_OFFERING_MISMATCH: Canonical Product Truth snapshot offering "${actualOffering || "none"}" does not match expected offering "${expectedOffering}"`,
    );
  }

  // Also verify individual fact offering scope if facts carry campaignOfferingId
  const facts = dnaOrSnapshot.productTruthFacts || dnaOrSnapshot.facts || [];
  if (expectedOffering && Array.isArray(facts)) {
    const mismatchedFact = facts.find(
      (f: any) => f?.campaignOfferingId && f.campaignOfferingId !== expectedOffering,
    );
    if (mismatchedFact) {
      throw new Error(
        `${prefix}PRODUCT_TRUTH_OFFERING_MISMATCH: Fact "${mismatchedFact.productTruthFactId}" belongs to offering "${mismatchedFact.campaignOfferingId}", expected "${expectedOffering}"`,
      );
    }
  }

  const expectedSnap = expected.snapshotId ?? expected.expectedSnapshotId ?? null;
  const actualSnapId =
    dnaOrSnapshot.snapshotId ||
    dnaOrSnapshot.businessUnderstandingAuthorityId ||
    dnaOrSnapshot.canonicalProductTruthSnapshot?.snapshotId ||
    null;
  if (expectedSnap && actualSnapId !== expectedSnap) {
    throw new Error(
      `${prefix}PRODUCT_TRUTH_VERSION_MISMATCH: Canonical Product Truth snapshot version "${actualSnapId || "none"}" does not match expected snapshot "${expectedSnap}"`,
    );
  }

  const expectedFp = expected.fingerprint ?? expected.expectedFingerprint ?? null;
  const actualFp =
    dnaOrSnapshot.snapshotFingerprint ||
    dnaOrSnapshot.fingerprint ||
    dnaOrSnapshot.canonicalProductTruthSnapshot?.fingerprint ||
    null;
  if (expectedFp && actualFp && actualFp !== expectedFp) {
    throw new Error(
      `${prefix}PRODUCT_TRUTH_FINGERPRINT_MISMATCH: Canonical Product Truth fingerprint "${actualFp}" does not match expected "${expectedFp}"`,
    );
  }
}

export async function loadProductDNA(
  campaignId: string,
  accountId: string,
  options?: {
    expectedOfferingId?: string | null;
    expectedSnapshotId?: string | null;
    expectedFingerprint?: string | null;
  },
): Promise<ProductDNA | null> {
  const conditions = [
    eq(businessUnderstandingSnapshots.campaignId, campaignId),
    eq(businessUnderstandingSnapshots.accountId, accountId),
  ];
  if (options?.expectedSnapshotId) {
    conditions.push(eq(businessUnderstandingSnapshots.id, options.expectedSnapshotId));
  }

  const [buSnap] = await db
    .select({
      id: businessUnderstandingSnapshots.id,
      campaignOfferingId: businessUnderstandingSnapshots.campaignOfferingId,
      payload: businessUnderstandingSnapshots.businessUnderstanding,
    })
    .from(businessUnderstandingSnapshots)
    .where(and(...conditions))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);

  if (!buSnap && options?.expectedSnapshotId) {
    throw new Error(
      `PRODUCT_TRUTH_VERSION_MISMATCH: Expected Business Understanding snapshot "${options.expectedSnapshotId}" not found for campaign "${campaignId}"`,
    );
  }

  if (buSnap?.payload) {
    const data = buSnap.payload as any;
    const offering = data.campaignOffering || {};
    const target = data.targetUnderstanding || {};
    const resolvedOfferingId = buSnap.campaignOfferingId || offering.campaignOfferingId || null;

    if (options?.expectedOfferingId && resolvedOfferingId !== options.expectedOfferingId) {
      throw new Error(
        `PRODUCT_TRUTH_OFFERING_MISMATCH: Loaded snapshot offering "${resolvedOfferingId || "none"}" does not match expected offering "${options.expectedOfferingId}"`,
      );
    }

    const targetRoles: TargetRoleItem[] = Array.isArray(target.targetRoles) ? target.targetRoles : [];
    const rawFacts: any[] = Array.isArray(offering.productTruthFacts) ? offering.productTruthFacts : [];
    const verifiedRawFacts = rawFacts.filter(
      (f: any) => String(f?.status || "WEBSITE_ESTABLISHED").trim().toUpperCase() !== "UNKNOWN"
    );

    const productTruthFacts: ProductTruthFactItem[] = (verifiedRawFacts.length > 0 ? verifiedRawFacts : rawFacts).map((f: any, idx: number) => {
      const fid = String(f.productTruthFactId || f.factId || f.id || `pt_fact_${idx + 1}`).trim();
      const origType = String(f.factType || "CAPABILITY").trim().toUpperCase();
      return Object.freeze({
        productTruthFactId: fid,
        statement: String(f.statement || f.fact || "").trim(),
        factType: origType,
        status: f.status ? String(f.status).trim() : "VERIFIED",
        rationale: f.rationale ? String(f.rationale).trim() : undefined,
        evidenceRefIds: Array.isArray(f.evidenceRefIds) ? [...f.evidenceRefIds] : undefined,
        campaignOfferingId: f.campaignOfferingId || resolvedOfferingId || undefined,
        sourceRef: f.sourceRef || `product_truth.facts[${fid}]`,
        scope: f.scope ? String(f.scope).trim() : undefined,
        qualifications: f.qualifications
          ? String(f.qualifications).trim()
          : f.rationale
            ? String(f.rationale).trim()
            : undefined,
      });
    });

    Object.freeze(productTruthFacts);

    const snapshotId = buSnap.id || data.businessUnderstandingAuthorityId || "";
    const snapshotFingerprint = computeProductTruthFingerprint({
      snapshotId,
      campaignOfferingId: resolvedOfferingId,
      facts: productTruthFacts,
    });

    const canonicalProductTruthSnapshot: CanonicalProductTruthSnapshot = Object.freeze({
      snapshotId,
      accountId,
      campaignId,
      campaignOfferingId: resolvedOfferingId,
      businessUnderstandingAuthorityId: snapshotId,
      targetUnderstandingAuthorityId: target.targetUnderstandingAuthorityId || null,
      fingerprint: snapshotFingerprint,
      facts: productTruthFacts,
    });

    if (options?.expectedFingerprint && snapshotFingerprint !== options.expectedFingerprint) {
      throw new Error(
        `PRODUCT_TRUTH_FINGERPRINT_MISMATCH: Loaded snapshot fingerprint "${snapshotFingerprint}" does not match expected "${options.expectedFingerprint}"`,
      );
    }

    // Extract target roles from canonical targetRoles array
    const decisionMakerRole =
      targetRoles.find((r) => r.roleType === "DECISION_MAKER")?.roleTitle ||
      (targetRoles.length > 0 ? targetRoles[0].roleTitle : null);

    const buyerOrUserRole =
      targetRoles.find((r) => r.roleType === "BUYER" || r.roleType === "USER")?.roleTitle ||
      (targetRoles.length > 1 ? targetRoles[1].roleTitle : decisionMakerRole);

    // Extract core problem & unique mechanism from canonical product truth facts
    const capabilityFacts = productTruthFacts.filter((f) => f.factType === "CAPABILITY" || !f.factType);
    const mechanismSourceFacts = capabilityFacts.length > 0 ? capabilityFacts : productTruthFacts;
    const uniqueMechanism =
      mechanismSourceFacts.length > 0
        ? mechanismSourceFacts.map((f) => f.statement).slice(0, 2).join("; ")
        : offering.offeringName
          ? `${offering.offeringName} Core Capability`
          : null;

    const coreProblem =
      productTruthFacts.find(
        (f) =>
          f.statement.toLowerCase().includes("problem") ||
          f.statement.toLowerCase().includes("struggle") ||
          f.statement.toLowerCase().includes("fragmented") ||
          f.statement.toLowerCase().includes("overhead") ||
          f.statement.toLowerCase().includes("focuses on"),
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
      strategicAdvantage: mechanismSourceFacts.length > 2 ? mechanismSourceFacts[2].statement : null,
      targetDecisionMaker,
      businessType,
      coreOffer,
      targetAudienceSegment: targetAudienceSegment || "Target Market",
      priceRange,
      accountId,
      campaignId,
      campaignOfferingId: resolvedOfferingId || undefined,
      businessUnderstandingAuthorityId: snapshotId || undefined,
      targetUnderstandingAuthorityId: target.targetUnderstandingAuthorityId || undefined,
      snapshotId: snapshotId || undefined,
      snapshotFingerprint,
      canonicalProductTruthSnapshot,
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
  if (dna.snapshotId || dna.snapshotFingerprint) {
    lines.push(
      `- Product Truth Snapshot: id=${dna.snapshotId || "n/a"} | fingerprint=${dna.snapshotFingerprint || "n/a"}${dna.campaignOfferingId ? ` | offeringId=${dna.campaignOfferingId}` : ""}`,
    );
  }

  if (dna.targetRoles && dna.targetRoles.length > 0) {
    lines.push(`- Canonical Target Roles:`);
    for (const r of dna.targetRoles) {
      lines.push(`  * [${r.roleType || "ROLE"}] ${r.roleTitle}${r.rationale ? `: ${r.rationale}` : ""} (ID: ${r.targetRoleFactId})`);
    }
  } else {
    if (dna.targetDecisionMaker) lines.push(`- Target Decision Maker: ${dna.targetDecisionMaker}`);
    if (dna.targetAudienceSegment) lines.push(`- Target Audience Segment: ${dna.targetAudienceSegment}`);
  }

  if (dna.productTruthFacts && dna.productTruthFacts.length > 0) {
    lines.push(`- Canonical Product Truth Facts:`);
    for (const f of dna.productTruthFacts) {
      lines.push(
        `  * [${f.factType || "FACT"}] ${f.statement} (Fact ID: ${f.productTruthFactId}${f.status ? `, Status: ${f.status}` : ""}${f.scope ? `, Scope: ${f.scope}` : ""})`,
      );
    }
  } else {
    if (dna.coreProblemSolved) lines.push(`- Core Problem Solved: ${dna.coreProblemSolved}`);
    if (dna.uniqueMechanism) lines.push(`- Unique Mechanism: ${dna.uniqueMechanism}`);
    if (dna.strategicAdvantage) lines.push(`- Strategic Advantage: ${dna.strategicAdvantage}`);
  }

  return lines.join("\n");
}


