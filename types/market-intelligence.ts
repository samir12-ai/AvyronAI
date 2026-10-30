export interface MarketPatternViewModel {
  id: string;
  patternName: string;
  category: 'promise' | 'audience' | 'positioning' | 'offer' | 'content';
  whatWeAreSeeing: string;
  whoIsDoingIt: Array<{
    competitorId: string;
    competitorName: string;
  }>;
  whyItMatters: string;
  evidenceSummary: string;
}

export interface MarketOverviewViewModel {
  headline: string;
  marketSummary: string;
  marketState: string;
  dominantTheme: string;
  confidence: {
    score: number;
    level: string;
    label: string;
  };
  freshness: {
    days: number;
    status: 'FRESH' | 'AGING' | 'STALE';
    label: string;
  };
  totalCompetitorsAnalyzed: number;
  totalCompetitorsActive?: number;
  totalCompetitorsRegistered?: number;
  totalCompetitorsWithUnderstanding?: number;
  coveragePercentage?: number;
  evidenceCoverage?: {
    count: number;
    total: number;
    percentage: number;
    basis: string;
  };
  analyticalConfidence?: {
    score: number;
    level: string;
    label: string;
    rationale: string;
  };
  processingCompletion?: {
    count: number;
    total: number;
    percentage: number;
    label: string;
  };
  targetMarket?: string;
  pricingSummary?: string;
  cohortMetrics?: {
    targetMarket: string;
    targetMarketSource: string;
    localCount: number;
    internationalCount: number;
    totalPrimaryCohort: number;
    localPercentage: number;
    totalMonitoredLibrary: number;
    majorityStatus: string;
  };
  keyPatterns: MarketPatternViewModel[];
  marketDiagnosis: string;
  opportunities: string[];
  threats: string[];

  // Section B: Competitor Positioning & Brand Claims
  positioningSummaries?: Array<{
    competitorId: string;
    competitorName: string;
    positioningStatement: string;
    primaryPromise: string;
    isBrandClaim: boolean;
    claimSource?: string;
  }>;

  // Section C: Products, Pricing & Commercial Terms
  commercialTerms?: Array<{
    competitorId: string;
    competitorName: string;
    termType: 'SHIPPING' | 'RETURNS' | 'PRICING_MODEL' | 'DELIVERY';
    label: string;
    detail: string;
    evidenceContext: string;
  }>;

  // Section D: Attributed Customer Voice
  customerVoiceEvidence?: Array<{
    id: string;
    competitorName?: string;
    platform: string;
    sourceUrl?: string;
    verbatimExcerpt: string;
    strategicTheme: string;
    publishedDate?: string;
  }>;

  // Section F: Grounded Strategic Findings
  groundedFindings?: {
    opportunities: Array<{
      title: string;
      observation: string;
      scopeTag?: 'OBSERVED_IN_TARGET_MARKET' | 'GLOBAL_PATTERN' | 'PROPOSED_OPPORTUNITY';
      scopeLabel?: string;
      prerequisite: string;
      groundedEvidence: string;
    }>;
    risks: Array<{
      title: string;
      riskFactor: string;
      scopeTag?: 'OBSERVED_IN_TARGET_MARKET' | 'GLOBAL_PATTERN' | 'PROPOSED_OPPORTUNITY';
      scopeLabel?: string;
      mitigation: string;
      competitorsExhibiting: string[];
    }>;
  };
}

export interface CompetitorCapabilityViewModel {
  id: string;
  statement: string;
  category?: string;
  status: 'ESTABLISHED' | 'INFERRED' | 'NOT_ESTABLISHED';
  statusLabel: string;
  rationale?: string;
  evidenceRefIds: string[];
}

export interface CompetitorPositioningViewModel {
  statement: string;
  categoryFrame?: string;
  primaryPromise?: string;
  status: string;
  statusLabel: string;
  strategicEmphasis: string[];
  supportElements: string[];
}

export interface CompetitorTargetRoleViewModel {
  roleTitle: string;
  roleType: 'USER' | 'BUYER' | 'DECISION_MAKER';
  status: string;
  statusLabel: string;
}

export interface CompetitorOfferViewModel {
  offerStatement: string;
  planPackage?: string;
  freeEntry?: string;
  cta?: string;
  pricing?: string;
  statusLabel: string;
}

export interface CompetitorProofViewModel {
  proofType: 'CASE_STUDY' | 'CUSTOMER_LOGO' | 'TESTIMONIAL' | 'BENCHMARK' | 'QUANTIFIED_CLAIM';
  typeLabel: string;
  statement: string;
}

export interface CompetitorMarketingPlaybookStep {
  step: 'ATTRACT' | 'EDUCATE' | 'PROVE' | 'CONVERT';
  label: string;
  description: string;
  observedTactic: string;
}

export interface CompetitorRecurringIdeaViewModel {
  idea: string;
  observedIn: string;
  frequency: string;
  likelyObjective: string;
}

export interface CompetitorContentIntelligenceViewModel {
  postingFrequencyText: string;
  dominantFormats: string[];
  dominantHooks: string[];
  primaryGoals: string[];
  ctaPatterns: string[];
  emotionalDrivers: string[];
  awarenessStages: string[];
  sourcePostsCount: number;
  samplePosts: Array<{
    id: string;
    caption: string;
    hookText?: string;
    primaryAngle?: string;
    ctaType?: string;
    likes?: number;
    comments?: number;
    timestamp?: string;
  }>;
}

export interface CompetitorRecentChangeViewModel {
  eventId: string;
  status: 'CONFIRMED' | 'UNDER_REVIEW' | 'ARCHIVED';
  kind: string;
  title: string;
  description: string;
  whyItMatters: string;
  observedAt: string;
}

export interface CompetitorComparisonViewModel {
  theyEmphasize: string;
  youEstablish: string;
  strategicDifference: string;
  epistemicNote: string;
}

export interface CompetitorEvidenceItemViewModel {
  id: string;
  sourceType: 'website' | 'social_post' | 'profile' | 'customer_review';
  sourceUrl?: string;
  excerpt: string;
  context: string;
  capturedAt?: string;
}

export interface CompetitorSummaryItemViewModel {
  competitorId: string;
  name: string;
  websiteUrl: string;
  category: string;
  oneLineSummary: string;
  primaryPositioning: string;
  tier: string;
  strategicRole?: string;
  isPrimaryCohort?: boolean;
  geographicStatus?: 'LOCAL_MARKET' | 'GLOBAL_RELEVANT' | 'DIRECT_LEBANON' | 'REGIONAL_DELIVERS_TO_LEBANON' | 'REFERENCE_BRAND' | 'UNKNOWN';
  geographicLabel?: string;
  hasWebsiteData: boolean;
  hasSocialData: boolean;
  recentChangesCount: number;
  latestChangeHeadline?: string;
  freshnessLabel: string;
  capabilitiesCount: number;
}

export interface CompetitorDossierViewModel {
  competitorId: string;
  identity: {
    name: string;
    websiteUrl: string;
    socialHandle?: string;
    category: string;
    oneLineSummary: string;
    primaryAudience: string;
    dataFreshnessLabel: string;
    sourcesReviewedCount: number;
    geographicStatus?: 'LOCAL_MARKET' | 'GLOBAL_RELEVANT' | 'DIRECT_LEBANON' | 'REGIONAL_DELIVERS_TO_LEBANON' | 'REFERENCE_BRAND' | 'UNKNOWN';
    geographicLabel?: string;
    geographicDetails?: string;
  };
  whatTheyDo: {
    coreProductSummary: string;
    keyJobs: string[];
    commercialRole: string;
    status: 'COMPLETE' | 'PARTIAL_EVIDENCE' | 'INSUFFICIENT_DATA';
  };
  whatTheyOffer: {
    capabilities: CompetitorCapabilityViewModel[];
    totalCount: number;
    semanticGroups: Array<{
      groupName: string;
      items: CompetitorCapabilityViewModel[];
    }>;
  };
  whoTheyTarget: {
    targetRoles: CompetitorTargetRoleViewModel[];
    primaryAudience: string;
    secondaryAudiences: string[];
    businessSize?: string;
  };
  howTheyPosition: {
    primaryPosition: string;
    corePromise: string;
    categoryFrame: string;
    mechanisms: string[];
    proofs: CompetitorProofViewModel[];
    strategicLanguage: string[];
  };
  howTheyMarket: {
    marketingSystemSummary: string;
    contentIntelligence: CompetitorContentIntelligenceViewModel;
    playbook: CompetitorMarketingPlaybookStep[];
  };
  recurringIdeas: CompetitorRecurringIdeaViewModel[];
  offersAndCommercialMotion: {
    offers: CompetitorOfferViewModel[];
    pricingFraming: string;
    primaryCtaBehavior: string;
    geographicAvailability?: string;
    knownDeliveredCost?: string;
  };
  proofStrategy: {
    proofItems: CompetitorProofViewModel[];
    dominantProofType: string;
  };
  whatChanged: {
    changes: CompetitorRecentChangeViewModel[];
    totalCount: number;
  };
  whatThisTellsUs: {
    strategicRead: string;
    whyAvyronThinksThis: string[];
  };
  howThisComparesToYou: CompetitorComparisonViewModel;
  opportunitiesAndThreats: {
    whatToWatch: string[];
    possibleOpenings: string[];
  };
  evidenceDossier: {
    items: CompetitorEvidenceItemViewModel[];
    totalCount: number;
  };
  epistemicStatus: {
    websiteEstablished: boolean;
    socialEstablished: boolean;
    dataCompletenessScore: number;
    freshnessLabel: string;
  };
}

export interface MarketIntelligenceBundleViewModel {
  campaignId: string;
  overview: MarketOverviewViewModel;
  competitors: CompetitorSummaryItemViewModel[];
  activeDossier?: CompetitorDossierViewModel;
}
