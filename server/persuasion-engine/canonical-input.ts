/**
 * Canonical Persuasion Input Contract
 * 
 * Enforces strict architectural separation of:
 * 1. Product Truth (verified capabilities, policies, fact IDs, source references)
 * 2. Approved Strategic Authority (positioning axis, approved mechanism, claims)
 * 3. Lane Context (canonical lane ID, segment, buyer objections/tensions, role)
 * 4. Proposals and Unknowns (unverified capabilities, proposed marketing assets, missing proof)
 */

export interface AuthoritativeProductFact {
  factId: string;
  statement: string;
  factType: string; // "CAPABILITY" | "DELIVERY_MECHANISM" | "PRICING_FACT" | "USE_CASE" | "PROOF" | "BOUNDARY"
  status?: string;   // e.g. "WEBSITE_ESTABLISHED" | "USER_CONFIRMED"
  rationale?: string;
  evidenceRefIds?: string[];
  campaignId?: string;
  accountId?: string;
}

export interface ApprovedStrategicAuthority {
  strategyRootId: string;
  primaryAxis: string;
  contrastAxisText: string;
  approvedMechanism: {
    name: string;
    description: string;
    steps?: string[];
    promise?: string;
    status?: string;
  };
  approvedClaims?: string[];
  approvedPromise?: string | null;
  narrativeDirection?: string;
  enemyDefinition?: string;
}

export interface LanePersuasionContext {
  laneId: string;
  title: string;
  description?: string;
  targetRole?: string;
  segmentId?: string;
  segmentName?: string;
  primaryPainId?: string;
  corePainIds?: string[];
  objections: string[];
  desires?: string[];
  funnelStage?: string;
  funnelType?: string;
  awarenessStage?: string;
}

export interface ProposalsAndUnknowns {
  unverifiedCapabilities?: string[];
  proposedMarketingAssets?: string[];
  missingProofGaps?: string[];
}

export interface CanonicalPersuasionInput {
  productTruth: AuthoritativeProductFact[];
  strategicAuthority: ApprovedStrategicAuthority;
  laneContext: LanePersuasionContext;
  proposalsAndUnknowns: ProposalsAndUnknowns;
  accountId: string;
  campaignId: string;
}

export class CanonicalPersuasionInputError extends Error {
  code = "PERSUASION_INPUT_MALFORMED" as const;
  constructor(public missingFields: string[]) {
    super(`Canonical Persuasion Input validation failed — missing: ${missingFields.join(", ")}`);
    this.name = "CanonicalPersuasionInputError";
  }
}

/**
 * Validates that CanonicalPersuasionInput has all required authorities.
 * Fails closed without falling back to placeholder strings or fake capabilities.
 */
export function validateCanonicalPersuasionInput(input: any): CanonicalPersuasionInput {
  const missing: string[] = [];
  if (!input) {
    throw new CanonicalPersuasionInputError(["canonical_input"]);
  }

  // 1. Product Truth validation
  if (!Array.isArray(input.productTruth) || input.productTruth.length === 0) {
    missing.push("productTruth (must contain at least one verified AuthoritativeProductFact with factId)");
  } else {
    for (let i = 0; i < input.productTruth.length; i++) {
      const f = input.productTruth[i];
      if (!f || typeof f !== "object" || !f.statement || !f.statement.trim()) {
        missing.push(`productTruth[${i}].statement`);
      }
      if (!f.factId || typeof f.factId !== "string" || !f.factId.trim()) {
        missing.push(`productTruth[${i}].factId`);
      }
    }
  }

  // 2. Strategic Authority validation
  if (!input.strategicAuthority || typeof input.strategicAuthority !== "object") {
    missing.push("strategicAuthority");
  } else {
    if (!input.strategicAuthority.primaryAxis) missing.push("strategicAuthority.primaryAxis");
    if (!input.strategicAuthority.approvedMechanism?.name) {
      missing.push("strategicAuthority.approvedMechanism.name");
    }
  }

  // 3. Lane Context validation
  if (!input.laneContext || typeof input.laneContext !== "object") {
    missing.push("laneContext");
  } else {
    if (!input.laneContext.laneId) missing.push("laneContext.laneId");
    if (!Array.isArray(input.laneContext.objections) || input.laneContext.objections.length === 0) {
      missing.push("laneContext.objections (must contain at least one buyer objection to resolve)");
    }
  }

  if (missing.length > 0) {
    throw new CanonicalPersuasionInputError(missing);
  }

  return input as CanonicalPersuasionInput;
}
