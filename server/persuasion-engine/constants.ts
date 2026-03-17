export const ENGINE_VERSION = 3;

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
  "education_led",
  "diagnostic_led",
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
  "education",
  "diagnosis",
] as const;

export const TRUST_SEQUENCE_STAGES = [
  "acknowledge_pain",
  "demonstrate_understanding",
  "educate_on_problem",
  "present_proof",
  "establish_authority",
  "address_objections",
  "remove_risk",
  "invite_commitment",
] as const;

export const TRUST_BARRIER_TYPES = [
  "low_awareness_skepticism",
  "competitor_similarity_distrust",
  "mechanism_disbelief",
  "outcome_doubt",
  "proof_sensitivity",
  "general_market_fatigue",
  "high_commitment_anxiety",
] as const;

export const OBJECTION_PROOF_MAP: Record<string, string> = {
  mechanism_disbelief: "process_proof",
  outcome_doubt: "outcome_proof",
  applicability_doubt: "case_proof",
  promise_distrust: "transparency_proof",
  risk_fear: "risk_removal_proof",
  price_resistance: "value_proof",
  competitor_comparison: "differentiation_proof",
  time_concern: "efficiency_proof",
};

export const LOW_READINESS_STAGES = ["unaware", "problem_aware"] as const;
export const HIGH_READINESS_STAGES = ["product_aware", "most_aware"] as const;

export const EDUCATION_FIRST_MODES = ["education_led", "diagnostic_led", "empathy_led"] as const;

export const SCARCITY_BLOCKED_CONDITIONS = [
  "low_trust",
  "low_awareness",
  "insufficient_proof",
  "unresolved_objections",
  "educational_funnel",
  "diagnostic_funnel",
] as const;

export const AWARENESS_PERSUASION_MAP: Record<string, string> = {
  unaware: "education_led",
  problem_aware: "empathy_led",
  solution_aware: "contrast_led",
  product_aware: "proof_led",
  most_aware: "proof_led",
};

export const TRUST_PROOF_ESCALATION_ORDER = [
  "process_proof",
  "case_proof",
  "outcome_proof",
  "transparency_proof",
] as const;

export const MESSAGE_ARCHITECTURE_ORDER = [
  "problem",
  "mechanism",
  "proof",
  "outcome",
  "offer",
] as const;

export const MESSAGE_STEP_CATEGORY_MAP: Record<string, string> = {
  acknowledge_pain: "problem",
  educate_on_problem: "problem",
  invite_self_identification: "problem",
  demonstrate_understanding: "problem",
  establish_contrast: "problem",
  explain_mechanism: "mechanism",
  present_proof: "proof",
  illustrative_proof: "proof",
  establish_authority: "proof",
  address_objections: "proof",
  remove_risk: "outcome",
  invite_commitment: "offer",
  soft_next_step: "offer",
};

export const FUNNEL_PERSUASION_COMPATIBILITY: Record<string, string[]> = {
  webinar: ["authority_led", "proof_led", "education_led", "social_proof_led"],
  challenge: ["education_led", "diagnostic_led", "empathy_led", "contrast_led"],
  tripwire: ["proof_led", "logic_led", "contrast_led"],
  application: ["authority_led", "proof_led", "social_proof_led"],
  direct: ["proof_led", "authority_led", "contrast_led", "logic_led"],
  diagnostic: ["diagnostic_led", "education_led", "empathy_led"],
  consultation: ["authority_led", "empathy_led", "proof_led"],
  free_resource: ["education_led", "reciprocity_led", "empathy_led"],
  community: ["social_proof_led", "reciprocity_led", "empathy_led"],
};

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
  "no experience needed",
  "foolproof system",
  "can't fail",
  "money back no questions",
  "life-changing",
  "revolutionary system",
  "breakthrough method",
  "hack your way",
  "shortcut to success",
  "done for you",
  "autopilot income",
  "set and forget",
  "push button",
  "silver bullet",
  "game changer",
  "transform overnight",
  "skyrocket your",
  "explode your",
  "crush the competition",
  "dominate your market",
  "unstoppable",
  "fire your boss",
  "escape the rat race",
  "print money",
  "cash machine",
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
  "nurture leads",
  "warm up the audience",
  "build a relationship",
  "add value first",
  "create a sense of belonging",
];

export const GENERIC_STRUCTURE_PATTERNS = [
  "generic trust-building",
  "standard proof framework",
  "basic risk removal",
  "general authority positioning",
  "template empathy",
  "stock persuasion sequence",
  "default objection handling",
  "placeholder proof",
  "unspecific transformation",
  "vague outcome promise",
];
