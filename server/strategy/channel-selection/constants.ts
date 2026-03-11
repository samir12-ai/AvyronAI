import type { SoftPattern } from "../../engine-hardening/types";

export const ENGINE_VERSION = 1;

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  GUARD_BLOCKED: "GUARD_BLOCKED",
  FALLBACK: "FALLBACK",
} as const;

export const CHANNEL_TYPES = [
  "social_organic",
  "social_paid",
  "search_paid",
  "search_organic",
  "email",
  "referral",
  "direct",
  "community",
  "partnerships",
  "content_platform",
] as const;

export const CHANNEL_DEFINITIONS: Record<string, { label: string; type: typeof CHANNEL_TYPES[number]; baseEfficiency: number; minBudget: number }> = {
  instagram_organic: { label: "Instagram Organic", type: "social_organic", baseEfficiency: 0.65, minBudget: 0 },
  instagram_paid: { label: "Instagram Paid", type: "social_paid", baseEfficiency: 0.70, minBudget: 500 },
  facebook_organic: { label: "Facebook Organic", type: "social_organic", baseEfficiency: 0.50, minBudget: 0 },
  facebook_paid: { label: "Facebook Paid", type: "social_paid", baseEfficiency: 0.72, minBudget: 500 },
  google_search: { label: "Google Search Ads", type: "search_paid", baseEfficiency: 0.75, minBudget: 1000 },
  google_organic: { label: "Google SEO", type: "search_organic", baseEfficiency: 0.60, minBudget: 0 },
  youtube_organic: { label: "YouTube Organic", type: "content_platform", baseEfficiency: 0.55, minBudget: 0 },
  youtube_paid: { label: "YouTube Ads", type: "social_paid", baseEfficiency: 0.68, minBudget: 1000 },
  email_marketing: { label: "Email Marketing", type: "email", baseEfficiency: 0.80, minBudget: 0 },
  tiktok_organic: { label: "TikTok Organic", type: "social_organic", baseEfficiency: 0.58, minBudget: 0 },
  tiktok_paid: { label: "TikTok Ads", type: "social_paid", baseEfficiency: 0.62, minBudget: 500 },
  linkedin_organic: { label: "LinkedIn Organic", type: "social_organic", baseEfficiency: 0.45, minBudget: 0 },
  linkedin_paid: { label: "LinkedIn Ads", type: "social_paid", baseEfficiency: 0.55, minBudget: 1000 },
  referral_program: { label: "Referral Program", type: "referral", baseEfficiency: 0.85, minBudget: 0 },
  community_building: { label: "Community Building", type: "community", baseEfficiency: 0.50, minBudget: 0 },
  partnerships: { label: "Strategic Partnerships", type: "partnerships", baseEfficiency: 0.60, minBudget: 0 },
};

export const AWARENESS_CHANNEL_MAP: Record<string, string[]> = {
  unaware: ["social_organic", "content_platform", "community"],
  problem_aware: ["social_organic", "social_paid", "search_organic", "content_platform"],
  solution_aware: ["search_paid", "social_paid", "email", "content_platform"],
  product_aware: ["search_paid", "email", "referral", "direct"],
  most_aware: ["email", "referral", "direct", "partnerships"],
};

export const PERSUASION_CHANNEL_COMPATIBILITY: Record<string, string[]> = {
  education_first: ["content_platform", "social_organic", "email", "community"],
  proof_driven: ["social_paid", "search_paid", "email", "referral"],
  authority_led: ["social_organic", "content_platform", "partnerships", "community"],
  scarcity_urgency: ["social_paid", "email", "direct"],
  trust_building: ["email", "community", "referral", "content_platform"],
};

export const LAYER_NAMES = [
  "audience_density_assessment",
  "awareness_channel_mapping",
  "persuasion_mode_compatibility",
  "budget_constraint_check",
  "cost_efficiency_scoring",
  "risk_assessment",
  "channel_fit_scoring",
  "guard_layer",
] as const;

export const LAYER_WEIGHTS: Record<string, number> = {
  audience_density_assessment: 0.20,
  awareness_channel_mapping: 0.15,
  persuasion_mode_compatibility: 0.15,
  budget_constraint_check: 0.10,
  cost_efficiency_scoring: 0.15,
  risk_assessment: 0.10,
  channel_fit_scoring: 0.10,
  guard_layer: 0.05,
};

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting)\b/i,
  "ad creatives": /\b(ad creative|creative asset|banner design|creative brief)\b/i,
  "content calendar": /\b(content calendar|editorial calendar|posting schedule)\b/i,
  "funnel redesign": /\b(funnel redesign|new funnel|redesign funnel)\b/i,
  "offer redesign": /\b(offer redesign|new offer|redesign offer)\b/i,
  "persuasion frameworks": /\b(persuasion framework|persuasion technique|influence model)\b/i,
  "scripts": /\b(sales script|cold call script|outreach script)\b/i,
};

export const BOUNDARY_SOFT_PATTERNS: SoftPattern[] = [
  { pattern: /\b(hook|hooks|opening hook)\b/gi, domain: "hook", replacement: "entry trigger" },
  { pattern: /\b(headline|headlines)\b/gi, domain: "headline", replacement: "attention signal" },
  { pattern: /\b(scroll.?stop)\b/gi, domain: "scroll stop", replacement: "attention capture" },
];
