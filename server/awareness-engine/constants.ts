export const ENGINE_VERSION = 2;

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;

export const ENTRY_ROUTES = [
  "pain_entry",
  "opportunity_entry",
  "myth_breaker_entry",
  "authority_entry",
  "proof_led_entry",
  "diagnostic_entry",
] as const;

export const READINESS_STAGES = [
  "unaware",
  "problem_aware",
  "solution_aware",
  "product_aware",
  "most_aware",
] as const;

export const TRIGGER_CLASSES = [
  "hidden_cost",
  "missed_opportunity",
  "outdated_method",
  "authority_gap",
  "trust_breakdown",
  "competitor_weakness",
] as const;

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting)\b/i,
  "ad creatives": /\b(ad creative|creative asset|banner design|creative brief)\b/i,
  "content calendar": /\b(content calendar|editorial calendar|posting schedule|content plan)\b/i,
  "channel recommendations": /\b(channel recommendation|channel strategy|platform strategy|channel selection|media mix)\b/i,
  "funnel redesign": /\b(funnel redesign|new funnel|redesign funnel|alternative funnel design)\b/i,
  "offer redesign": /\b(offer redesign|new offer|redesign offer|revised offer)\b/i,
  "new positioning": /\b(new positioning|repositioning strategy|pivot positioning|revised positioning)\b/i,
  "persuasion frameworks": /\b(persuasion framework|persuasion technique|influence model|cialdini)\b/i,
  "media plans": /\b(media plan|media planning|media buy|ad spend allocation)\b/i,
  "budgets": /\b(budget allocation|financial budget|ad budget|spend recommendation)\b/i,
  "execution tasks": /\b(execution task|deployment plan|launch sequence|publish schedule|campaign step)\b/i,
  "scripts": /\b(sales script|cold call script|outreach script|email script)\b/i,
};

import type { SoftPattern } from "../engine-hardening/types";

export const BOUNDARY_SOFT_PATTERNS: SoftPattern[] = [
  { pattern: /\b(hook|hooks|opening hook)\b/gi, domain: "hook", replacement: "entry trigger" },
  { pattern: /\b(headline|headlines)\b/gi, domain: "headline", replacement: "attention signal" },
  { pattern: /\b(scroll.?stop)\b/gi, domain: "scroll stop", replacement: "attention capture" },
  { pattern: /\b(subject line|email subject)\b/gi, domain: "subject line", replacement: "attention signal" },
];

export const LAYER_NAMES = [
  "market_entry_detection",
  "awareness_readiness_mapping",
  "attention_trigger_mapping",
  "narrative_entry_alignment",
  "awareness_funnel_fit",
  "trust_readiness_guard",
  "generic_awareness_detector",
  "awareness_strength_scoring",
] as const;

export const LAYER_WEIGHTS: Record<string, number> = {
  market_entry_detection: 0.15,
  awareness_readiness_mapping: 0.15,
  attention_trigger_mapping: 0.10,
  narrative_entry_alignment: 0.15,
  awareness_funnel_fit: 0.15,
  trust_readiness_guard: 0.10,
  generic_awareness_detector: 0.10,
  awareness_strength_scoring: 0.10,
};

export const GENERIC_PHRASES = [
  "grow your business",
  "scale faster",
  "improve marketing",
  "boost your sales",
  "increase revenue",
  "get more customers",
  "take your business to the next level",
  "maximize your potential",
  "unlock growth",
  "supercharge your",
  "transform your business",
  "level up your",
  "dominate your market",
  "crush the competition",
  "skyrocket your",
];
