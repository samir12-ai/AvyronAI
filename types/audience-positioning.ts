export interface TargetAudienceViewModel {
  title: string;
  description: string;
  segmentId: string;
  laneId: string;
  commercialRelevance: string;
  buyerRole: string;
  marketType: string;
}

export interface CoreBuyingPainViewModel {
  painId: string;
  title: string;
  rawText: string;
  experience: string;
  commercialImpact: string;
  whyWeCanSolveIt: string;
  reasoning: {
    marketEvidence: string;
    buyerRelevance: string;
    productFit: string;
    strategicDecision: string;
  };
  evidenceSnippets: string[];
  evidenceCount: number;
}

export interface SupportingSignalPain {
  painId: string;
  title: string;
  description: string;
  classification: string;
}

export interface SupportingSignalsViewModel {
  pains: SupportingSignalPain[];
  desires: string[];
  objections: string[];
  triggers: string[];
  emotionalDrivers: string[];
}

export interface ExcludedPainViewModel {
  painId: string;
  title: string;
  reason: string;
  classification: string;
}

export interface ReasoningStep {
  step: string;
  label: string;
  title: string;
  description: string;
  source: string;
  painId?: string;
  capability?: string;
  contrast?: string;
  evidenceCount?: number;
}

export interface BrandConnectionViewModel {
  productTruth: string;
  differentiation: string;
  positioning: string;
  mechanism?: string;
}

export interface ValidationItemViewModel {
  label: string;
  detail: string;
  passed: boolean;
}

export interface DecisionHistoryItemViewModel {
  alternative: string;
  status: string;
  reason: string;
  authority: string;
}

export interface PositioningStatusBadge {
  status: string;
  label: string;
  tone: "success" | "info" | "warning" | "danger" | "neutral";
}

export interface PositioningViewModel {
  umbrellaPosition: string;
  positioningStatement: string;
  contrastAxis: string;
  positioningStatus?: string;
  positioningStatusMessage?: string | null;
  epistemicStatus?: "VERIFIED_FACT" | "EVIDENCE_INFERENCE" | "STRATEGIC_HYPOTHESIS" | "PROPOSED_RECOMMENDATION" | "UNAVAILABLE_OR_FAILED";
  productTruthStatus?: "SUPPORTED_CAPABILITY" | "STRATEGIC_SYNTHESIS" | "PROPOSED_CAPABILITY" | null;
  epistemicLabel?: string;
  rationale?: string;
  assumptions?: string[];
  validationNeeds?: string[];
  supportingEvidenceIds?: string[];
  adoptionStatus?: PositioningStatusBadge;
  factualSupportStatus?: PositioningStatusBadge;
  marketValidationStatus?: PositioningStatusBadge;
  competitiveOverlapStatus?: PositioningStatusBadge;
  intendedBuyer?: {
    segmentName: string;
    laneTitles: string[];
    coreBuyingTension: string;
  };
  chosenEmphasis?: {
    territoryName: string;
    contrastAxis: string;
    narrativeDirection: string;
    enemyDefinition: string;
    rationale: string;
    supportingCapabilities: string[];
  };
  competitiveOverlap?: {
    comparisonStatus: string;
    semanticCollisionScore: number;
    overlapPercent: number;
    closestCompetitor: string;
    competitorClaim: string;
    positioningOutcomeType: string;
    summary: string;
    previewCounterexampleCount: number;
    deliverableCounterexampleCount: number;
    opportunityScore: number;
    saturationLevel: number;
    modelUsed?: string;
  };
  diagnostics?: {
    candidateTerritories: Array<{
      name: string;
      isPrimary: boolean;
      opportunityScore?: number;
      preCollisionOpportunityScore?: number;
      saturationLevel?: number;
      productTruthStatus?: string;
      epistemicStatus?: string;
      contrastAxis?: string;
      narrativeDirection?: string;
      rationale?: string;
    }>;
    perCompetitorOverlap: Array<{
      competitorName: string;
      claim: string;
      score: number;
      relationshipClass?: string;
      rationale?: string;
    }>;
    previewCounterexamples: Array<{
      competitorName: string;
      previewTiming?: string;
      evidenceText: string;
    }>;
    deliverableCounterexamples: Array<{
      competitorName: string;
      evidenceText: string;
    }>;
    collisionRevisionAudit: {
      revisedAfterComparison: boolean;
      retainedInitialCandidate: boolean;
      selectionReason: string;
      initialCollisionScore?: number;
      postRevisionCollisionScore?: number;
      proposedRevisionName?: string;
      proposedRevisionContrastAxis?: string;
    } | null;
    reasoningSteps: string[];
    validationMetadata: {
      candidateHash?: string;
      evidenceSnapshotId?: string;
      validatedAt?: string;
      passed?: boolean;
      note?: string;
    } | null;
  };
  reasoningJourney: {
    step1: ReasoningStep;
    step2: ReasoningStep;
    step3: ReasoningStep;
    step4: ReasoningStep;
  };
  brandSpine: BrandConnectionViewModel;
  validation: ValidationItemViewModel[];
  decisionHistory: DecisionHistoryItemViewModel[];
}

export interface CommercialAudienceSynthesisViewModel {
  selectedOfferingId?: string;
  selectedOfferingName?: string;
  selectedVariantName?: string;
  selectedVariantScope?: string;
  selectedVariantPricing?: { amount?: number; currency?: string } | null;
  comparableCompetitors?: Array<{
    competitorId?: string;
    competitorName: string;
    productOrServiceName?: string;
    pricingSummary?: string;
    evidenceUids?: string[];
  }>;
  reviewBackedStrengths?: Array<{
    competitorName: string;
    strength: string;
    sampleReviewSnippet?: string;
    reviewRating?: number;
    platform?: string;
  }>;
  purchaseSituations?: Array<{
    situation: string;
    urgencyLevel?: "LOW" | "MEDIUM" | "HIGH";
    frequencyContext?: string;
  }>;
  offeringFitBreakdown?: Array<{
    need: string;
    fitType: "DIRECT_FIT" | "STRATEGIC_FIT" | "POOR_FIT";
    provenClauses: string[];
    unresolvedRequirements: string[];
    prerequisites?: string[];
  }>;
  packageOrScopeSuitability?: {
    suitabilityVerdict: "SUITABLE" | "BORDERLINE" | "INSUFFICIENT_EVIDENCE";
    notes: string;
  };
  priceValueLimitations?: Array<{
    dimension: string;
    limitation: string;
    unknownFactor?: string;
  }>;
  proposedCapabilities?: Array<{
    capability: string;
    status: "PROPOSED" | "DEVELOPING" | "VALIDATED";
    prerequisites: string[];
  }>;
}

export interface AudiencePositioningViewModel {
  campaignId: string;
  hasPlan: boolean;
  hasAudience?: boolean;
  hasPositioning?: boolean;
  targetAudience: TargetAudienceViewModel;
  coreBuyingPain: CoreBuyingPainViewModel;
  supportingSignals: SupportingSignalsViewModel;
  excludedPains: ExcludedPainViewModel[];
  positioning: PositioningViewModel;
  commercialAudienceSynthesis?: CommercialAudienceSynthesisViewModel | null;
}

