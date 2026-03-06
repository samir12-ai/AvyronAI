export const POSITIONING_ENGINE_VERSION = 3;

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
} as const;

export type PositioningStatus = "COMPLETE" | "MISSING_DEPENDENCY" | "INSUFFICIENT_SIGNALS" | "UNSTABLE";

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
}

export interface StabilityResult {
  isStable: boolean;
  checks: {
    name: string;
    passed: boolean;
    detail: string;
  }[];
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
