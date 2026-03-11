export const ENGINE_VERSION = 3;

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "new positioning": /\b(new positioning|repositioning strategy|pivot positioning|revised positioning)\b/i,
  "new differentiation": /\b(new differentiation|alternative differentiation|revised differentiation)\b/i,
  "new offers": /\b(new offer|redesign offer|revised offer|alternative offer design)\b/i,
  "new funnels": /\b(new funnel|redesign funnel|alternative funnel design)\b/i,
  "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting|headline|tagline|slogan)\b/i,
  "messaging": /\b(marketing message|brand message|messaging framework|messaging strategy)\b/i,
  "persuasion frameworks": /\b(persuasion framework|persuasion technique|influence model|cialdini)\b/i,
  "channel recommendations": /\b(channel recommendation|channel strategy|platform strategy|channel selection|media mix)\b/i,
  "financial calculations": /\b(financial calculation|revenue projection|profit margin|break.even|pricing model|roi calculation)\b/i,
  "campaign steps": /\b(campaign step|campaign execution|launch sequence|deployment plan|publish schedule)\b/i,
  "content strategy": /\b(content strategy|content calendar|editorial calendar|content plan)\b/i,
  "advertising strategy": /\b(ad strategy|advertising strategy|paid ads|ad creative|ad targeting)\b/i,
  "media buying": /\b(media buy|ad spend|ad budget|media planning)\b/i,
  "scripts": /\b(sales script|cold call script|outreach script|email script)\b/i,
};

export const BOUNDARY_SOFT_PATTERNS: { pattern: RegExp; domain: string; replacement: string }[] = [];

export const BOUNDARY_BLOCKED_PATTERNS: Record<string, RegExp> = {
  ...BOUNDARY_HARD_PATTERNS,
};

export const LAYER_NAMES = [
  "strategic_consistency",
  "audience_offer_alignment",
  "positioning_differentiation_compatibility",
  "offer_funnel_compatibility",
  "trust_path_continuity",
  "proof_sufficiency",
  "conversion_feasibility",
  "system_coherence",
] as const;

export const LAYER_WEIGHTS: Record<string, number> = {
  strategic_consistency: 0.18,
  audience_offer_alignment: 0.15,
  positioning_differentiation_compatibility: 0.12,
  offer_funnel_compatibility: 0.15,
  trust_path_continuity: 0.14,
  proof_sufficiency: 0.10,
  conversion_feasibility: 0.10,
  system_coherence: 0.06,
};
