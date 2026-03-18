export const POSITIONING_ENGINE_VERSION = 4;

export const POSITIONING_THRESHOLDS = {
  MIN_AUDIENCE_SIGNALS: 3,
  MIN_COMPETITOR_COUNT: 2,
  NARRATIVE_SATURATION_THRESHOLD: 0.70,
  OPPORTUNITY_SCORE_THRESHOLD: 0.30,
  AUTHORITY_GAP_FLANKING_THRESHOLD: 0.65,
  TERRITORY_OVERLAP_THRESHOLD: 0.75,
  MIN_PAIN_ALIGNMENT: 0.20,
  MAX_TERRITORIES: 4,
  MIN_TERRITORIES: 2,
  STABILITY_SATURATION_LIMIT: 0.80,
  DOMINANT_COMPETITOR_THRESHOLD: 0.70,
  NARRATIVE_COLLISION_MIN_DISTANCE: 0.25,
  GENERIC_TERRITORY_PENALTY: 0.25,
  NARRATIVE_DISTANCE_MAX_WITH_OVERLAP: 0.75,
  KEYWORD_OVERLAP_DISTANCE_CAP_THRESHOLD: 0.25,
  CROSS_CAMPAIGN_SIMILARITY_THRESHOLD: 0.75,
  CROSS_CAMPAIGN_PENALTY: 0.20,
  FLANKING_ENGAGEMENT_THRESHOLD: 0.50,
  FLANKING_NARRATIVE_OWNERSHIP_THRESHOLD: 0.60,
  FLANKING_CONTENT_VOLUME_THRESHOLD: 0.50,
  MIN_SATURATION_FLOOR_PER_COMPETITOR: 0.03,
} as const;

export const GENERIC_TERRITORY_PATTERNS: string[] = [
  "financial improvement",
  "save time",
  "save money",
  "social recognition",
  "make money",
  "increase revenue",
  "grow business",
  "be successful",
  "get results",
  "improve life",
  "better health",
  "more energy",
  "time freedom",
  "work-life balance",
  "personal growth",
  "self improvement",
  "digital marketing",
  "online presence",
  "brand awareness",
  "customer satisfaction",
  "quality service",
  "professional development",
  "career growth",
  "efficiency",
  "productivity",
  "innovation",
  "transformation",
  "empowerment",
  "wellness",
  "lifestyle",
];

export type PositioningStatus = "COMPLETE" | "MISSING_DEPENDENCY" | "INSUFFICIENT_SIGNALS" | "UNSTABLE" | "INTEGRITY_FAILED" | "SIGNAL_REQUIRED" | "SIGNAL_DRIFT";

export const BOUNDARY_BLOCKED_PATTERNS: Record<string, RegExp> = {
  "ad copy": /\b(ad copy|sales copy|copywriting|creative copy|ad creative)\b/i,
  "funnel design": /\b(funnel design|funnel stage|funnel step|sales funnel|conversion funnel|funnel structure|funnel redesign)\b/i,
  "content calendars": /\b(content calendar|editorial calendar|posting schedule|content plan|publishing schedule)\b/i,
};

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "ad copy": /\b(ad copy|sales copy|copywriting|creative copy|ad creative)\b/i,
  "funnel design": /\b(funnel design|funnel stage|funnel step|sales funnel|conversion funnel|funnel structure|funnel redesign)\b/i,
  "content calendars": /\b(content calendar|editorial calendar|posting schedule|content plan|publishing schedule)\b/i,
};

import type { SoftPattern } from "../engine-hardening/types";

export const BOUNDARY_SOFT_PATTERNS: SoftPattern[] = [
  { pattern: /\bpricing\b/gi, domain: "pricing", replacement: "market value context" },
  { pattern: /\bprice point\b/gi, domain: "price point", replacement: "market value context" },
  { pattern: /\boffer pricing\b/gi, domain: "offer pricing", replacement: "market value context" },
  { pattern: /\bcompetitive analysis\b/gi, domain: "competitive analysis", replacement: "competitive landscape assessment" },
  { pattern: /\bcompetitor analysis\b/gi, domain: "competitor analysis", replacement: "competitive landscape assessment" },
  { pattern: /\bcompetitor comparison\b/gi, domain: "competitor comparison", replacement: "competitive landscape assessment" },
  { pattern: /\bcompetitive audit\b/gi, domain: "competitive audit", replacement: "competitive landscape assessment" },
  { pattern: /\bswot analysis\b/gi, domain: "swot analysis", replacement: "strategic assessment" },
];

export interface Territory {
  name: string;
  opportunityScore: number;
  narrativeDistanceScore: number;
  painAlignment: string[];
  desireAlignment: string[];
  enemyDefinition: string;
  contrastAxis: string;
  narrativeDirection: string;
  isStable: boolean;
  stabilityNotes: string[];
  evidenceSignals: string[];
  confidenceScore: number;
}

export interface StrategyCard {
  territoryName: string;
  enemyDefinition: string;
  narrativeDirection: string;
  evidenceSignals: string[];
  confidenceScore: number;
  isPrimary: boolean;
}

export interface MarketPowerEntry {
  competitorName: string;
  authorityScore: number;
  contentDominanceScore: number;
  narrativeOwnershipIndex: number;
  engagementStrength: number;
}

export interface OpportunityGap {
  territory: string;
  saturationLevel: number;
  audienceDemand: number;
  competitorAuthority: number;
  opportunityScore: number;
  painSignals: string[];
  desireSignals: string[];
  signalSource?: string;
}

export interface StabilityAdvisory {
  type: "dominant_competitor" | "flanking_recommended" | "niche_required";
  message: string;
  competitorName?: string;
  authorityScore?: number;
}

export interface StabilityResult {
  isStable: boolean;
  checks: {
    name: string;
    passed: boolean;
    detail: string;
  }[];
  advisories: StabilityAdvisory[];
  fallbackApplied: boolean;
  fallbackReason?: string;
}

export const FLANKING_STRATEGIES = [
  "niche_specialization",
  "underserved_segment",
  "contrarian_positioning",
  "speed_advantage",
  "simplicity_advantage",
  "community_driven",
  "transparency_play",
] as const;
