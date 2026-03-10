export const ENGINE_VERSION = 1;

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;

export const PERSUASION_MODES = [
  "authority_led",
  "proof_led",
  "reciprocity_led",
  "scarcity_led",
  "social_proof_led",
  "empathy_led",
  "logic_led",
  "contrast_led",
] as const;

export const INFLUENCE_DRIVERS = [
  "authority",
  "social_proof",
  "reciprocity",
  "scarcity",
  "consistency",
  "liking",
  "proof_of_work",
  "contrast",
  "specificity",
  "risk_reversal",
] as const;

export const TRUST_SEQUENCE_STAGES = [
  "acknowledge_pain",
  "demonstrate_understanding",
  "present_proof",
  "establish_authority",
  "remove_risk",
  "invite_commitment",
] as const;

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "marketing copy": /\b(marketing copy|ad copy|sales copy|copywriting)\b/i,
  "ad creatives": /\b(ad creative|creative asset|banner design|creative brief)\b/i,
  "ad hooks": /\b(ad hook|hook line|opening hook|scroll.?stop)\b/i,
  "sales scripts": /\b(sales script|cold call script|outreach script|email script)\b/i,
  "content calendar": /\b(content calendar|editorial calendar|posting schedule|content plan)\b/i,
  "channel recommendations": /\b(channel recommendation|channel strategy|platform strategy|channel selection|media mix)\b/i,
  "funnel redesign": /\b(funnel redesign|new funnel|redesign funnel|alternative funnel design)\b/i,
  "offer redesign": /\b(offer redesign|new offer|redesign offer|revised offer)\b/i,
  "new positioning": /\b(new positioning|repositioning strategy|pivot positioning|revised positioning)\b/i,
  "media plans": /\b(media plan|media planning|media buy|ad spend allocation)\b/i,
  "budgets": /\b(budget allocation|financial budget|ad budget|spend recommendation)\b/i,
  "execution tasks": /\b(execution task|deployment plan|launch sequence|publish schedule|campaign step)\b/i,
  "content ideas": /\b(content idea|blog post idea|social media idea|content suggestion)\b/i,
  "headline generation": /\b(headline|subject line|email subject|tagline|slogan)\b/i,
};

import type { SoftPattern } from "../engine-hardening/types";

export const BOUNDARY_SOFT_PATTERNS: SoftPattern[] = [
  { pattern: /\b(call to action|CTA)\b/gi, domain: "CTA", replacement: "commitment invitation" },
  { pattern: /\b(landing page copy)\b/gi, domain: "landing page copy", replacement: "persuasion sequence" },
  { pattern: /\b(email sequence)\b/gi, domain: "email sequence", replacement: "trust-building sequence" },
  { pattern: /\b(sales page)\b/gi, domain: "sales page", replacement: "persuasion architecture" },
];

export const LAYER_NAMES = [
  "awareness_to_persuasion_fit",
  "objection_detection",
  "trust_barrier_mapping",
  "influence_driver_selection",
  "proof_priority_mapping",
  "message_order_logic",
  "anti_hype_guard",
  "persuasion_strength_scoring",
] as const;

export const LAYER_WEIGHTS: Record<string, number> = {
  awareness_to_persuasion_fit: 0.15,
  objection_detection: 0.15,
  trust_barrier_mapping: 0.15,
  influence_driver_selection: 0.10,
  proof_priority_mapping: 0.10,
  message_order_logic: 0.10,
  anti_hype_guard: 0.15,
  persuasion_strength_scoring: 0.10,
};

export const HYPE_PATTERNS = [
  "guaranteed results",
  "overnight success",
  "get rich quick",
  "effortless",
  "no work required",
  "instant results",
  "unlimited",
  "never fail",
  "100% guaranteed",
  "risk free",
  "magic formula",
  "secret method",
  "once in a lifetime",
  "act now or lose",
  "limited time only",
  "last chance ever",
  "double your money",
  "triple your income",
  "passive income guaranteed",
  "zero effort required",
];

export const GENERIC_PERSUASION_PHRASES = [
  "build trust",
  "create urgency",
  "leverage social proof",
  "establish authority",
  "overcome objections",
  "address pain points",
  "drive conversions",
  "maximize engagement",
  "boost credibility",
  "increase trust",
  "persuade your audience",
  "influence decisions",
  "create desire",
  "build rapport",
  "close the deal",
];
