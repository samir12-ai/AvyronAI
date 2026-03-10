export const ENGINE_VERSION = 6;
export const FRESHNESS_THRESHOLD_DAYS = 14;

export const DIFFERENTIATION_SCORE_WEIGHTS = {
  uniqueness: 0.30,
  proofability: 0.25,
  trustAlignment: 0.20,
  positioningAlignment: 0.15,
  objectionCoverage: 0.10,
};

export const COLLISION_RISK_WEIGHTS = {
  similarityToCompetitorClaims: 0.60,
  narrativeProximity: 0.40,
};

export const PROOFABILITY_WEIGHTS = {
  evidenceAvailability: 0.40,
  mechanismClarity: 0.30,
  objectionResolutionPotential: 0.30,
};

export const AUTHORITY_MODES = [
  "expert",
  "operator",
  "transparent_guide",
  "contrarian_specialist",
  "niche_authority",
] as const;

export type AuthorityMode = typeof AUTHORITY_MODES[number];

export const PROOF_CATEGORIES = [
  "case_proof",
  "process_proof",
  "transparency_proof",
  "comparative_proof",
  "framework_proof",
  "mechanism_proof",
  "outcome_proof",
] as const;

export type ProofCategory = typeof PROOF_CATEGORIES[number];

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INSUFFICIENT_SIGNALS: "INSUFFICIENT_SIGNALS",
  UNSTABLE: "UNSTABLE",
  COLLISION_RISK: "COLLISION_RISK",
} as const;

export const MIN_TERRITORIES = 1;
export const MIN_OBJECTIONS = 1;
export const MIN_PILLAR_SCORE = 0.35;
export const COLLISION_THRESHOLD = 0.70;
export const STABILITY_MIN_PROOFABILITY = 0.30;
export const STABILITY_MIN_TRUST_ALIGNMENT = 0.25;

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting|creative copy)\b/i,
  "funnel stages": /\b(funnel stage|funnel step|funnel design|sales funnel|conversion funnel|funnel structure)\b/i,
  "financial projections": /\b(financial projection|revenue forecast|financial forecast|budget allocation|revenue model|financial plan)\b/i,
};

export const BOUNDARY_SOFT_PATTERNS = [
  { pattern: /\bheadlines?\b/gi, domain: "headlines", replacement: "claim statements" },
  { pattern: /\bsubject line\b/gi, domain: "subject line", replacement: "claim framing" },
  { pattern: /\bemail subject\b/gi, domain: "email subject", replacement: "claim framing" },
  { pattern: /\bhook text\b/gi, domain: "hook text", replacement: "attention claim" },
];

export const BOUNDARY_BLOCKED_PATTERNS: Record<string, RegExp> = {
  ...BOUNDARY_HARD_PATTERNS,
};
