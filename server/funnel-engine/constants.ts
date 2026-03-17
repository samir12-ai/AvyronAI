export const ENGINE_VERSION = 3;
export const FRESHNESS_THRESHOLD_DAYS = 14;

export const FUNNEL_STRENGTH_WEIGHTS = {
  eligibility: 0.10,
  offerFit: 0.18,
  audienceFriction: 0.15,
  trustPath: 0.18,
  proofPlacement: 0.15,
  commitmentMatch: 0.14,
  integrity: 0.10,
};

export const GENERIC_FUNNEL_PATTERNS = [
  /\b(standard funnel)\b/i,
  /\b(basic sales funnel)\b/i,
  /\b(simple opt.in)\b/i,
  /\b(generic landing page)\b/i,
  /\b(basic lead magnet)\b/i,
  /\b(standard webinar)\b/i,
  /\b(copy.paste funnel)\b/i,
  /\b(template funnel)\b/i,
  /\b(one.size.fits.all)\b/i,
  /\b(plug and play)\b/i,
  /\b(cookie.cutter)\b/i,
];

export const GENERIC_PENALTY = 0.35;

export const BOUNDARY_HARD_PATTERNS: Record<string, RegExp> = {
  "strategy decisions": /\b(strategy decision|strategic repositioning|strategic pivot|strategic overhaul)\b/i,
  "strategic repositioning": /\b(reposition brand|rebrand strategy|market repositioning)\b/i,
  "offer redesign": /\b(offer redesign|redesign the offer|rebuild the offer|restructure offer)\b/i,
  "pricing logic": /\b(pricing model|pricing strategy|price point|pricing calculation|discount structure)\b/i,
  "budget recommendations": /\b(budget recommendation|budget allocation|spending plan|budget optimization)\b/i,
  "channel selection": /\b(channel selection|channel strategy|platform strategy|channel mix)\b/i,
  "media buying": /\b(media buy|ad spend|ad budget|media planning|ad campaign|media mix)\b/i,
  "persuasion copy": /\b(persuasion framework|copywriting|sales copy|persuasion technique|copy template)\b/i,
  "scripts": /\b(sales script|cold call script|outreach script|email script|dm script)\b/i,
  "campaign tasks": /\b(campaign execution|launch sequence|deployment plan|publish schedule|task list)\b/i,
  "financial planning": /\b(financial model|revenue projection|profit margin|break.even|financial plan)\b/i,
  "execution plans": /\b(execution plan|implementation timeline|project plan|rollout schedule)\b/i,
  "content strategy": /\b(content strategy|content calendar|content plan|editorial calendar|content roadmap)\b/i,
  "hooks and headlines": /\b(ad hook|headline formula|click.bait|hook template|attention grab|scroll.stop)\b/i,
  "advertising strategy": /\b(advertising strategy|ad strategy|paid ads|ad creative|ad targeting|retargeting strategy)\b/i,
  "marketing messaging": /\b(marketing message|brand message|tagline|slogan|value proposition statement)\b/i,
  "strategic positioning": /\b(positioning statement|market position|competitive positioning|brand positioning)\b/i,
};

export const BOUNDARY_SOFT_PATTERNS = [
  { pattern: /\bawareness campaign\b/gi, domain: "awareness campaign", replacement: "awareness stage reference" },
  { pattern: /\bbrand awareness\b/gi, domain: "brand awareness", replacement: "market awareness level" },
  { pattern: /\btop.of.funnel awareness\b/gi, domain: "top-of-funnel awareness", replacement: "early-stage awareness" },
  { pattern: /\bawareness messaging\b/gi, domain: "awareness messaging", replacement: "awareness stage context" },
];

export const BOUNDARY_BLOCKED_PATTERNS: Record<string, RegExp> = {
  ...BOUNDARY_HARD_PATTERNS,
};

export const MAX_FUNNEL_STAGES = 6;

export const ENTRY_MECHANISM_TYPES = [
  "diagnostic",
  "challenge",
  "audit",
  "discovery",
  "content_education",
] as const;

export const FUNNEL_TYPES = [
  "direct",
  "webinar",
  "challenge",
  "vsl",
  "application",
  "consultation",
  "tripwire",
  "product-launch",
  "membership",
  "hybrid",
] as const;

export const AWARENESS_TO_FUNNEL_MAP: Record<string, string[]> = {
  unaware: ["challenge", "webinar", "product-launch"],
  problem_aware: ["webinar", "vsl", "challenge"],
  solution_aware: ["direct", "vsl", "consultation"],
  product_aware: ["direct", "tripwire", "application"],
  most_aware: ["direct", "tripwire", "membership"],
};

export const STATUS = {
  COMPLETE: "COMPLETE",
  MISSING_DEPENDENCY: "MISSING_DEPENDENCY",
  INSUFFICIENT_SIGNALS: "INSUFFICIENT_SIGNALS",
  INTEGRITY_FAILED: "INTEGRITY_FAILED",
} as const;

export const ENTRY_ROUTE_TO_FUNNEL_FAMILIES: Record<string, { allowed: string[]; blocked: string[] }> = {
  pain_entry: {
    allowed: ["webinar", "vsl", "consultation", "hybrid"],
    blocked: ["tripwire", "product-launch"],
  },
  opportunity_entry: {
    allowed: ["challenge", "webinar", "product-launch", "hybrid", "membership"],
    blocked: ["application"],
  },
  myth_breaker_entry: {
    allowed: ["webinar", "vsl", "challenge", "hybrid"],
    blocked: ["direct", "tripwire"],
  },
  authority_entry: {
    allowed: ["webinar", "consultation", "application", "vsl", "hybrid"],
    blocked: ["challenge", "tripwire"],
  },
  proof_led_entry: {
    allowed: ["webinar", "vsl", "consultation", "application", "hybrid"],
    blocked: ["challenge", "tripwire"],
  },
  diagnostic_entry: {
    allowed: ["challenge", "webinar", "consultation", "hybrid"],
    blocked: ["direct", "tripwire"],
  },
};

export const TRUST_HEAVY_FUNNELS = ["webinar", "vsl", "consultation", "application", "hybrid"];
export const TRUST_LIGHT_FUNNELS = ["challenge", "tripwire", "direct", "product-launch"];

export const TRIGGER_CLASS_TO_FUNNEL_FAMILY: Record<string, { preferred: string[]; penalized: string[] }> = {
  hidden_cost: {
    preferred: ["webinar", "vsl", "consultation"],
    penalized: ["tripwire", "product-launch"],
  },
  missed_opportunity: {
    preferred: ["challenge", "webinar", "product-launch", "hybrid"],
    penalized: ["application"],
  },
  outdated_method: {
    preferred: ["webinar", "vsl", "challenge", "hybrid"],
    penalized: ["direct", "tripwire"],
  },
  authority_gap: {
    preferred: ["webinar", "consultation", "application", "vsl"],
    penalized: ["challenge", "tripwire"],
  },
  trust_breakdown: {
    preferred: ["webinar", "vsl", "consultation", "application"],
    penalized: ["direct", "tripwire", "challenge"],
  },
  competitor_weakness: {
    preferred: ["challenge", "webinar", "vsl", "product-launch"],
    penalized: ["membership"],
  },
};

export const LOW_READINESS_STAGES = ["unaware", "problem_aware"];
export const HIGH_READINESS_STAGES = ["product_aware", "most_aware"];

export const AWARENESS_ROUTE_TO_ENTRY_MECHANISMS: Record<string, { allowed: string[]; blocked: string[] }> = {
  pain_entry: {
    allowed: ["diagnostic", "audit", "content_education"],
    blocked: ["challenge"],
  },
  opportunity_entry: {
    allowed: ["challenge", "discovery", "content_education"],
    blocked: ["audit"],
  },
  myth_breaker_entry: {
    allowed: ["content_education", "diagnostic", "audit"],
    blocked: ["challenge"],
  },
  authority_entry: {
    allowed: ["audit", "content_education", "discovery"],
    blocked: ["challenge"],
  },
  proof_led_entry: {
    allowed: ["audit", "content_education", "discovery"],
    blocked: ["challenge"],
  },
  diagnostic_entry: {
    allowed: ["diagnostic", "audit", "content_education"],
    blocked: ["challenge", "discovery"],
  },
};

export const TRIGGER_CLASS_TO_ENTRY_MECHANISMS: Record<string, { preferred: string[]; blocked: string[] }> = {
  hidden_cost: {
    preferred: ["diagnostic", "audit"],
    blocked: ["challenge"],
  },
  missed_opportunity: {
    preferred: ["challenge", "discovery"],
    blocked: [],
  },
  outdated_method: {
    preferred: ["content_education", "diagnostic"],
    blocked: ["challenge"],
  },
  authority_gap: {
    preferred: ["audit", "content_education"],
    blocked: ["challenge"],
  },
  trust_breakdown: {
    preferred: ["audit", "content_education", "diagnostic"],
    blocked: ["challenge"],
  },
  competitor_weakness: {
    preferred: ["challenge", "discovery", "diagnostic"],
    blocked: [],
  },
};

export const TRUST_STATE_ENTRY_OVERRIDES: Record<string, { blocked: string[] }> = {
  low: { blocked: ["challenge", "discovery"] },
  broken: { blocked: ["challenge", "discovery"] },
  fragile: { blocked: ["challenge"] },
};

export const COMMITMENT_TOLERANCE_MAP: Record<string, number> = {
  challenge: 0.6,
  webinar: 0.4,
  vsl: 0.3,
  direct: 0.7,
  application: 0.8,
  consultation: 0.7,
  tripwire: 0.1,
  "product-launch": 0.3,
  membership: 0.6,
  hybrid: 0.4,
};
