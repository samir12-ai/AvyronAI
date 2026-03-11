import type { SoftPattern } from "../../engine-hardening/types";

export const ENGINE_VERSION = 4;

export const SIGNAL_EQUIVALENCE_MAP: Record<string, { canonicalClusters: string[]; traceOrigin: string }> = {
  offer_outcome: {
    canonicalClusters: ["audience_pain", "audience_desire", "market_opportunity"],
    traceOrigin: "offer",
  },
  offer_mechanism: {
    canonicalClusters: ["market_opportunity", "audience_pain"],
    traceOrigin: "offer",
  },
  offer_proof: {
    canonicalClusters: ["emotional_driver", "audience_pain", "audience_objection"],
    traceOrigin: "offer",
  },
  persuasion_driver: {
    canonicalClusters: ["emotional_driver", "audience_pain", "audience_desire"],
    traceOrigin: "persuasion",
  },
  awareness_trigger: {
    canonicalClusters: ["market_opportunity", "audience_pain"],
    traceOrigin: "awareness",
  },
  awareness_entry: {
    canonicalClusters: ["audience_desire", "market_opportunity"],
    traceOrigin: "awareness",
  },
};

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;

export const LAYER_NAMES = [
  "evidence_density_assessment",
  "claim_signal_alignment",
  "narrative_vs_signal_check",
  "assumption_detection",
  "cross_engine_consistency",
  "proof_strength_validation",
  "confidence_calibration",
] as const;

export const LAYER_WEIGHTS: Record<string, number> = {
  evidence_density_assessment: 0.20,
  claim_signal_alignment: 0.20,
  narrative_vs_signal_check: 0.15,
  assumption_detection: 0.15,
  cross_engine_consistency: 0.10,
  proof_strength_validation: 0.10,
  confidence_calibration: 0.10,
};

export const NARRATIVE_CLAIM_PATTERNS = [
  "our audience wants",
  "the market needs",
  "competitors are failing",
  "this will work because",
  "everyone knows",
  "it's obvious that",
  "clearly the best",
  "guaranteed results",
  "proven to work",
  "industry standard",
] as const;

export const ASSUMPTION_INDICATORS = [
  "we believe",
  "we assume",
  "it seems like",
  "probably",
  "most likely",
  "should work",
  "might be",
  "could be",
  "we think",
  "presumably",
  "in our experience",
  "typically",
  "generally speaking",
  "we expect",
] as const;

export const EVIDENCE_TYPES = [
  "market_signal",
  "competitor_data",
  "audience_feedback",
  "performance_metric",
  "proof_element",
  "objection_data",
] as const;

export const VALIDATION_STATES = {
  VALIDATED: "validated",
  PROVISIONAL: "provisional",
  WEAK: "weak",
  REJECTED: "rejected",
} as const;

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting)\b/i,
  "ad creatives": /\b(ad creative|creative asset|banner design)\b/i,
  "content calendar": /\b(content calendar|editorial calendar|posting schedule)\b/i,
  "media plans": /\b(media plan|media planning|media buy)\b/i,
  "execution tasks": /\b(execution task|deployment plan|launch sequence)\b/i,
};

export const BOUNDARY_SOFT_PATTERNS: SoftPattern[] = [
  { pattern: /\b(guaranteed|guarantee)\b/gi, domain: "guarantee", replacement: "evidence-supported expectation" },
  { pattern: /\b(proven formula)\b/gi, domain: "proven formula", replacement: "signal-validated approach" },
  { pattern: /\b(best practice)\b/gi, domain: "best practice", replacement: "evidence-based pattern" },
];

export const EVIDENCE_DENSITY_THRESHOLDS = {
  STRONG: 0.7,
  MODERATE: 0.4,
  WEAK: 0.2,
} as const;

export const CLAIM_CONFIDENCE_THRESHOLDS = {
  VALIDATED: 0.7,
  PROVISIONAL: 0.5,
  WEAK: 0.3,
} as const;

export const SIGNAL_GROUNDING_THRESHOLD = 0.4;
