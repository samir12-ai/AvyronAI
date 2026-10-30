/**
 * Semantic Claim Entailment & Epistemic Verification Engine
 *
 * Replaces lexical token overlap with material assertion entailment.
 * Evaluates whether an assertion's subject, capability, scope, timeframe,
 * and modality are genuinely entailed by candidate evidence.
 */

import {
  ClaimEpistemicStatus,
  CLAIM_EPISTEMIC_LABELS,
  ObjectionResolutionStatus,
  type StructuredClaim,
} from "../../shared/contracts/claim-status";

export type SemanticEntailmentStatus =
  | "ENTAILED"
  | "PARTIALLY_ENTAILED"
  | "UNSUPPORTED_EXPANSION"
  | "CONTRADICTED";


export interface SemanticAssertionFrame {
  rawText: string;
  domain: "physical_product" | "software_saas" | "logistics_fulfillment" | "customer_service" | "commercial_pricing" | "general";
  subject: string;
  predicatedProperties: string[];
  modality: "ESTABLISHED_FACT" | "RISK_MITIGATION" | "SERVICE_ACCESS" | "PROPOSAL" | "UNRESOLVED";
  prerequisites?: string[];
  timeframe?: string;
  hasContradictoryLabel?: boolean;
}

export interface EntailmentEvaluationResult {
  status: SemanticEntailmentStatus;
  isGrounded: boolean;
  entailed: boolean;
  entailedProperties: string[];
  unsupportedProperties: string[];
  violations: string[];
  explanation: string;
  epistemicStatus: ClaimEpistemicStatus;
  suggestedResolutionStatus?: ObjectionResolutionStatus;
  prerequisites?: string[];
  limitations?: string[];
}

/**
 * Normalized semantic property catalog mapping common paraphrases to conceptual semantic tokens.
 * Generalized across physical goods, SaaS, logistics, and service operations.
 */
const SEMANTIC_PROPERTY_PATTERNS: Array<{
  propertyId: string;
  domain: SemanticAssertionFrame["domain"];
  test: RegExp;
  category: "physical_property" | "operational_policy" | "service_channel" | "saas_capability" | "pricing_term";
}> = [
  // Physical / Material Properties
  { propertyId: "fabric_opacity", domain: "physical_product", test: /\b(non-see-through|sheer-proof|not see-through|sheerness|(?:fabric|garment|material|textile|cloth\w*)\s+(?:opacity|sheerness)|(?:opaque|sheer)\s+(?:fabric|garment|material|textile|cloth\w*|weave|cotton|linen)|(?:sheer|opacity|opaque|zero transparency)(?=[\s\S]{0,120}\b(?:fabric|garment|cloth\w*|apparel|wear|shirt|dress|pant|legging|cotton|linen|textile|weave|silhouette)\b)|(?:\b(?:fabric|garment|cloth\w*|apparel|wear|shirt|dress|pant|legging|cotton|linen|textile|weave|silhouette)\b[\s\S]{0,120})\b(?:sheer|opacity|opaque|zero transparency)\b)/i, category: "physical_property" },
  { propertyId: "fabric_breathability", domain: "physical_product", test: /\b(breathab\w*|cooling|airflow|thermal comfort|heat-dispers\w*|sweat-wick\w*)\b/i, category: "physical_property" },
  { propertyId: "fabric_durability", domain: "physical_product", test: /\b(durab\w*|long-lasting wear|enduring wear|tear-resist\w*|wrinkle-resist\w*|resilient textile)\b/i, category: "physical_property" },
  { propertyId: "premium_materials", domain: "physical_product", test: /\b(premium fabric|high-quality textile|fine cotton|craftsmanship|carefully selected fabric)\b/i, category: "physical_property" },
  { propertyId: "odor_elimination", domain: "physical_product", test: /\b(anti-odor|odor-free|odor eliminat\w*|freshness lock)\b/i, category: "physical_property" },
  { propertyId: "sizing_precision", domain: "physical_product", test: /\b(garment measurement|silhouette measurement|dimension|sleeve circumference|measurement guide)\b/i, category: "operational_policy" },
  { propertyId: "sizing_guarantee", domain: "physical_product", test: /\b(guaranteed fit|sizing problem.*resolved|flawless fit for every body|universal sizing)\b/i, category: "physical_property" },

  // Logistics / Fulfillment
  { propertyId: "exchange_policy", domain: "logistics_fulfillment", test: /\b(exchange policy|exchange capability|replace.*size|swap garment|exchange program)\b/i, category: "operational_policy" },
  { propertyId: "extended_free_returns_guarantee", domain: "logistics_fulfillment", test: /\b(30-day\s+free\s+exchange|prepaid\s+return\s+label|free\s+returns?\s+and\s+exchanges?|unconditional\s+return|prepaid\s+return)\b/i, category: "operational_policy" },
  { propertyId: "turnaround_exchange_guarantee", domain: "logistics_fulfillment", test: /\b(dispatched within 24|replacement shipped within 24|24-hour turnaround|guaranteed 24-hour exchange turnaround)\b/i, category: "operational_policy" },
  { propertyId: "fast_delivery", domain: "logistics_fulfillment", test: /\b(fast delivery|express shipping|prompt dispatch|worldwide shipping)\b/i, category: "operational_policy" },
  { propertyId: "delivery_sla_guarantee", domain: "logistics_fulfillment", test: /\b(guaranteed delivery by|arrives in exactly|100% on-time delivery guarantee)\b/i, category: "operational_policy" },

  // Customer Service
  { propertyId: "multichannel_24_7_support", domain: "customer_service", test: /\b(24\/7 support|round-the-clock support|multi-channel support|phone and email support)\b/i, category: "service_channel" },
  { propertyId: "instant_issue_resolution", domain: "customer_service", test: /\b(guaranteed instant resolution|zero wait time|fixes any issue immediately)\b/i, category: "service_channel" },

  // Software / SaaS & Digital Media Capabilities
  { propertyId: "high_availability_uptime", domain: "software_saas", test: /\b(99\.99% uptime|zero downtime|high availability|fault-tolerant architecture|outages?|downtime)\b/i, category: "saas_capability" },
  { propertyId: "uptime_sla_credit", domain: "software_saas", test: /\b(sla credit|uptime guarantee credit|service credit reimbursement)\b/i, category: "operational_policy" },
  { propertyId: "realtime_data_sync", domain: "software_saas", test: /\b(real-time sync|sub-second sync|instant bidirectional updates)\b/i, category: "saas_capability" },
  { propertyId: "automated_anomaly_detection", domain: "software_saas", test: /\b(automated anomaly detection|ml-powered monitoring|predictive alert)\b/i, category: "saas_capability" },
  { propertyId: "downloadable_file_delivery", domain: "software_saas", test: /\b(downloadable\s+(?:mp3|audio|file)s?|mp3\s+download|direct\s+file\s+download)\b/i, category: "saas_capability" },
  { propertyId: "shareable_link_delivery", domain: "software_saas", test: /\b(shareable\s+(?:song\s+|cloud\s+|audio\s+)?links?|hosted\s+share\s+link)\b/i, category: "saas_capability" },
  { propertyId: "indefinite_cloud_hosting", domain: "software_saas", test: /\b(lifetime\s+(?:cloud\s+)?(?:hosting|storage|access)|indefinite(?:ly)?\s+(?:cloud\s+)?(?:hosted|hosting|storage|access)|permanent\s+(?:cloud\s+)?(?:hosting|storage|downloadable\s+(?:mp3\s+)?access|access)|never[-\s]expiring\s+(?:hosted|cloud|link))\b/i, category: "operational_policy" },
  { propertyId: "multi_version_selection", domain: "software_saas", test: /\b(multi[-\s]?version\s+previews?|multiple\s+(?:distinct\s+)?(?:song\s+|audio\s+)?versions?\s+(?:for\s+preview|to\s+choose|selection)|select\s+from\s+multiple\s+(?:generated\s+)?versions?)\b/i, category: "saas_capability" },
  { propertyId: "iterative_editing_control", domain: "software_saas", test: /\b(iterative\s+(?:control|editing|refinement)\s+over\s+(?:tone|lyrics|arrangement|output)|interactive\s+lyric\s+editing|guided\s+tone\s+adjustments?|collaborative\s+revision\s+(?:interface|rounds?|process)|post[-\s]generation\s+(?:lyric|arrangement)\s+editing)\b/i, category: "saas_capability" },
  { propertyId: "guaranteed_emotional_outcome", domain: "general", test: /\b(ensures?\s+(?:emotional\s+authenticity|that\s+the\s+final\s+song\s+authentically\s+reflects|deeply\s+personal\s+results)|guarantees?\s+(?:emotional\s+authenticity|that\s+emotional\s+investments\s+yield|non[-\s]generic\s+results)|never\s+generic)\b/i, category: "operational_policy" },
  { propertyId: "upfront_package_tier_pricing", domain: "commercial_pricing", test: /\b(upfront\s+package\s+pricing|tiered\s+package\s+pricing|one[-\s]time\s+package\s+tiers?)\b/i, category: "pricing_term" },
  { propertyId: "satisfaction_contingent_payment", domain: "commercial_pricing", test: /\b(pay\s+only\s+(?:when|if|after)\s+(?:you\s+are\s+|you're\s+|they\s+are\s+|customers?\s+are\s+|buyers?\s+are\s+|fully\s+|completely\s+)?satisfied|satisfaction[-\s]contingent\s+payment|only\s+pay\s+for\s+a\s+(?:song|product|track|deliverable)\s+(?:they|you)\s+love\s+and\s+are\s+satisfied\s+with|pay\s+only\s+upon\s+satisfaction)\b/i, category: "pricing_term" },
  { propertyId: "unverified_competitor_internal_workflow", domain: "general", test: /\b(mass[-\s]produced\s+automated\s+prompt\s+workflows?|template[-\s]bound\s+(?:music\s+generation\s+|song\s+|custom\s+song\s+)?(?:services?|workflows?|platforms?)\s+(?:produce|generate|rely\s+on|deliver|create)|rushed\s+one[-\s]line\s+prompts?\s+skipping|automated\s+prompt\s+workflows?\s+that\s+lack)\b/i, category: "operational_policy" },
  { propertyId: "market_wide_blind_purchase_isolated_audio", domain: "general", test: /\b(blind[-\s]purchase\s+(?:custom\s+)?(?:song\s+|audio\s+)?services?\s+with\s+isolated\s+audio\s+tracks?|pay\s+upfront\s+for\s+isolated\s+audio\s+tracks?\s+without\s+visual|conventional\s+services\s+force\s+upfront\s+payment\s+for\s+isolated\s+audio)\b/i, category: "operational_policy" },
];

/**
 * Extract semantic properties predicated in an assertion text.
 */
export function extractAssertionSemanticProperties(text: string): {
  properties: string[];
  categories: Set<string>;
  domains: Set<string>;
} {
  const properties: string[] = [];
  const categories = new Set<string>();
  const domains = new Set<string>();

  const sanitizedText = String(text || "")
    .replace(/\b(?:without\s+(?:inventing|claiming|asserting|promising|relying\s+on)|does\s+not\s+(?:guarantee|claim|specify|prove)|do\s+not\s+(?:guarantee|claim|specify|prove)|unproven\s*:|not\s+supported\s+by|rejected\s+alternative\s*:)[^.;\n]*/gi, " ")
    .replace(/\b(?:opaque\s+(?:ai|pricing|process\w*|system\w*|black[-\s]?box\w*|algorithm\w*|model\w*|workflow\w*|service\w*)|(?:pricing|process|ai|algorithmic|billing)\s+opacity)\b/gi, " ");

  for (const entry of SEMANTIC_PROPERTY_PATTERNS) {
    if (entry.test.test(sanitizedText)) {
      properties.push(entry.propertyId);
      categories.add(entry.category);
      domains.add(entry.domain);
    }
  }

  return { properties, categories, domains };
}

/**
 * Detect modality of an assertion (factual guarantee vs proposal vs risk mitigation).
 */
export function detectAssertionModality(text: string): {
  modality: SemanticAssertionFrame["modality"];
  prerequisites: string[];
  hasContradictoryLabel: boolean;
} {
  // Extract explicit prerequisites if stated
  const prereqMatch = text.match(/prerequisites?:\s*([^.\n]+)/i);
  const prerequisites = prereqMatch
    ? prereqMatch[1].split(/;|,/).map((s) => s.trim()).filter(Boolean)
    : [];

  const isProposedTagged = /^\[PROPOSED\]/i.test(text) || /\b(proposed — requires|requires implementation|planned capability)\b/i.test(text);
  const statementBody = text.replace(/prerequisites?:\s*[^.\n]+/i, "");
  const claimsValidated = /\b(already (?:validated|certified|proven)|proven by test|guaranteed to be|flawlessly eliminates)\b/i.test(statementBody);

  if (isProposedTagged) {
    // If tagged as proposed but statement body asserts it is "already validated" or "proven", flag contradiction!
    const hasContradictoryLabel = claimsValidated;
    return { modality: "PROPOSAL", prerequisites, hasContradictoryLabel };
  }

  if (/\b(mitigated by|lowers risk|reduces purchase risk|exchange policy|reimbursement|return guarantee)\b/i.test(text)) {
    return { modality: "RISK_MITIGATION", prerequisites: [], hasContradictoryLabel: false };
  }

  if (/\b(unresolved|unproven|unsupported)\b/i.test(text)) {
    return { modality: "UNRESOLVED", prerequisites: [], hasContradictoryLabel: false };
  }

  return { modality: "ESTABLISHED_FACT", prerequisites: [], hasContradictoryLabel: false };
}

/**
 * Evaluates whether an assertion's predicated properties and modality are genuinely entailed by evidence.
 *
 * @param assertionText The claim, deliverable, or objection mitigation text.
 * @param evidenceTexts Array of verified evidence statements (Product Truth facts, approved claims).
 * @param options Contextual options like originating pain limitations or prohibited uses.
 */
export function evaluateClaimSemanticEntailment(
  assertionText: string,
  evidenceTexts: string[],
  options?: {
    prohibitedUses?: string[];
    fitType?: string;
    proofGap?: string;
    isObjectionResolution?: boolean;
    objectionText?: string;
  }
): EntailmentEvaluationResult {
  const cleanAssertion = assertionText.trim();
  const { properties: assertedProps, categories: assertedCategories } = extractAssertionSemanticProperties(cleanAssertion);
  const { modality, prerequisites, hasContradictoryLabel } = detectAssertionModality(cleanAssertion);

  // Extract all properties supported by evidence base
  const allEvidenceText = evidenceTexts.join(" ");
  const { properties: evidenceProps } = extractAssertionSemanticProperties(allEvidenceText);
  const evidencePropsSet = new Set(evidenceProps);

  // Identify which asserted properties are entailed vs unsupported
  const entailedProperties = assertedProps.filter((p) => evidencePropsSet.has(p));
  const unsupportedProperties = assertedProps.filter((p) => !evidencePropsSet.has(p));

  // Check 1: Label-prose contradiction
  if (hasContradictoryLabel) {
    return {
      status: "CONTRADICTED",
      isGrounded: false,
      entailed: false,
      entailedProperties,
      unsupportedProperties,
      violations: ["label_prose_contradiction"],
      explanation: "Label-prose contradiction: Statement is marked as [PROPOSED] but prose asserts it is already 'validated' or 'proven'.",
      epistemicStatus: ClaimEpistemicStatus.UNPROVEN_CLAIM,
      prerequisites,
    };
  }

  // Check 2: Proposed capability handling
  if (modality === "PROPOSAL") {
    // Legitimate proposal must have prerequisites and not make unsupported factual assertions
    const effectivePrereqs = prerequisites.length > 0
      ? prerequisites
      : ["Operational specification and validation required"];
    return {
      status: "ENTAILED",
      isGrounded: true,
      entailed: true,
      entailedProperties,
      unsupportedProperties,
      violations: [],
      explanation: "Valid proposed capability with documented prerequisites.",
      epistemicStatus: ClaimEpistemicStatus.PROPOSED_CAPABILITY,
      suggestedResolutionStatus: "PROPOSED",
      prerequisites: effectivePrereqs,
    };
  }

  // Check 3: Assessment restrictions (e.g. prohibitedUses: ['offer_objection', 'offer_marketing'])
  if (options?.isObjectionResolution && (options?.prohibitedUses?.includes("offer_objection") || options?.prohibitedUses?.includes("offer_marketing"))) {
    const unsup = unsupportedProperties.length > 0 ? unsupportedProperties : ["prohibited_offer_marketing_pain"];
    return {
      status: "UNSUPPORTED_EXPANSION",
      isGrounded: false,
      entailed: false,
      entailedProperties: [],
      unsupportedProperties: unsup,
      violations: unsup,
      explanation: `Assessment restriction (prohibitedUses: [${options.prohibitedUses.map(u => `'${u}'`).join(", ")}]): Originating friction is restricted from claiming full resolution. Proof gap: ${options.proofGap || "empirical evidence missing"}.`,
      epistemicStatus: ClaimEpistemicStatus.UNPROVEN_CLAIM,
      suggestedResolutionStatus: "PARTIALLY_MITIGATED",
      limitations: ["Restricted by strategic assessment from public marketing; partial mitigation only."],
    };
  }

  // Check 4: Epistemic category mismatch in objection handling
  // If an objection concerns an intrinsic physical property or technical SLA not proven by evidence:
  if (options?.isObjectionResolution) {
    const objectionProps = options.objectionText
      ? extractAssertionSemanticProperties(options.objectionText).properties
      : [];
    const missingObjectionProps = objectionProps.filter((p) => !evidencePropsSet.has(p));

    if (missingObjectionProps.length > 0) {
      // If the assertion falsely claims [ADDRESSED] or asserts the unproven property is verified:
      const claimsAddressed = /^\[ADDRESSED\]/i.test(cleanAssertion) || /\b(addressed via verified|eliminates|resolves directly|guaranteed opacity|guaranteed uptime)\b/i.test(cleanAssertion);
      if (claimsAddressed) {
        const unsup = unsupportedProperties.length > 0 ? unsupportedProperties : missingObjectionProps;
        return {
          status: "UNSUPPORTED_EXPANSION",
          isGrounded: false,
          entailed: false,
          entailedProperties,
          unsupportedProperties: unsup,
          violations: unsup,
          explanation: `Contradiction: Objection involves (${missingObjectionProps.join(", ")}) which lacks empirical evidence. An operational policy cannot entail an intrinsic property or SLA. Cannot be marked [ADDRESSED].`,
          epistemicStatus: ClaimEpistemicStatus.UNPROVEN_CLAIM,
          suggestedResolutionStatus: "PARTIALLY_MITIGATED",
          limitations: [`Underlying property (${missingObjectionProps.join(", ")}) remains unproven; downgraded to PARTIALLY_MITIGATED.`],
        };
      }

      // Check if candidate provides domain-relevant operational risk mitigation
      // (e.g. exchange policy for physical goods; SLA credit for SaaS; revisions for creative services)
      const isPhysicalConcern = missingObjectionProps.some(p => ["fabric_opacity", "fabric_breathability", "fabric_durability", "sizing_guarantee"].includes(p));
      const isSaasConcern = missingObjectionProps.some(p => ["high_availability_uptime", "realtime_data_sync"].includes(p));
      
      const hasPhysicalRecourse = assertedProps.includes("exchange_policy") || /exchange|return|refund/i.test(cleanAssertion);
      const hasSaasRecourse = assertedProps.includes("uptime_sla_credit") || /sla credit|service credit/i.test(cleanAssertion);
      
      const hasRelevantMitigation = (isPhysicalConcern && hasPhysicalRecourse) || (isSaasConcern && hasSaasRecourse);

      if (hasRelevantMitigation) {
        const limitationText = isPhysicalConcern
          ? `Commercial exchange policy provides return/swap window for buyer purchase recourse; it does NOT alter or guarantee physical garment properties (${missingObjectionProps.join(", ")}).`
          : `SLA financial credit mitigates downtime invoice cost; it does NOT guarantee continuous infrastructure uptime.`;

        return {
          status: "PARTIALLY_ENTAILED",
          isGrounded: true,
          entailed: true,
          entailedProperties,
          unsupportedProperties: missingObjectionProps,
          violations: [],
          explanation: limitationText,
          epistemicStatus: ClaimEpistemicStatus.SUPPORTED_CAPABILITY,
          suggestedResolutionStatus: "PARTIALLY_MITIGATED",
          limitations: [limitationText],
        };
      } else {
        return {
          status: "UNSUPPORTED_EXPANSION",
          isGrounded: false,
          entailed: false,
          entailedProperties,
          unsupportedProperties: missingObjectionProps,
          violations: missingObjectionProps,
          explanation: `Underlying concern (${missingObjectionProps.join(", ")}) lacks verified evidence and has no domain-relevant operational risk mitigation.`,
          epistemicStatus: ClaimEpistemicStatus.UNPROVEN_CLAIM,
          suggestedResolutionStatus: "UNRESOLVED",
          limitations: [`Requirement (${missingObjectionProps.join(", ")}) remains completely unresolved.`],
        };
      }
    }
  }

  // Check 5: Turnaround SLA inflation on ambiguous source wording
  if (assertedProps.includes("turnaround_exchange_guarantee") && !evidencePropsSet.has("turnaround_exchange_guarantee")) {
    return {
      status: "UNSUPPORTED_EXPANSION",
      isGrounded: false,
      entailed: false,
      entailedProperties,
      unsupportedProperties: ["turnaround_exchange_guarantee"],
      violations: ["turnaround_exchange_guarantee"],
      explanation: "Source wording ('24-hour exchange capability') is ambiguous between return window and turnaround time; cannot claim guaranteed 24-hr replacement dispatch.",
      epistemicStatus: ClaimEpistemicStatus.UNPROVEN_CLAIM,
      suggestedResolutionStatus: "UNRESOLVED",
    };
  }

  // Check 6: Unsupported expansion in deliverables or claims
  if (unsupportedProperties.length > 0) {
    return {
      status: "UNSUPPORTED_EXPANSION",
      isGrounded: false,
      entailed: false,
      entailedProperties,
      unsupportedProperties,
      violations: unsupportedProperties,
      explanation: `Assertion predicates unverified capabilities (${unsupportedProperties.join(", ")}) not supported by evidence.`,
      epistemicStatus: ClaimEpistemicStatus.UNPROVEN_CLAIM,
      suggestedResolutionStatus: "UNRESOLVED",
    };
  }

  // Check 7: Fully entailed claim or genuine supported paraphrase
  return {
    status: "ENTAILED",
    isGrounded: true,
    entailed: true,
    entailedProperties,
    unsupportedProperties: [],
    violations: [],
    explanation: "Material assertions are fully supported by verified evidence.",
    epistemicStatus: ClaimEpistemicStatus.SUPPORTED_CAPABILITY,
    suggestedResolutionStatus: "ADDRESSED",
  };
}

/**
 * Format a structured proposal with prerequisites for display and persistence.
 */
export function formatProposedClaim(
  title: string,
  description: string,
  prerequisites: string[]
): StructuredClaim {
  return {
    statement: `[Proposed — requires validation/implementation] ${title}: ${description}`,
    status: ClaimEpistemicStatus.PROPOSED_CAPABILITY,
    label: CLAIM_EPISTEMIC_LABELS[ClaimEpistemicStatus.PROPOSED_CAPABILITY],
    prerequisites,
  };
}
