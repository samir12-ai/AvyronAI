export const ENGINE_VERSION = 1;

export const STATUS = {
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  INSUFFICIENT_INPUT: "INSUFFICIENT_INPUT",
  AXIS_REJECTED: "AXIS_REJECTED",
} as const;

export const AXIS_MECHANISM_GUIDANCE: Record<string, { emphasis: string[]; banned: string[] }> = {
  simplicity_and_ease: {
    emphasis: ["simplification", "consolidation", "automation", "removal of complexity", "single-step", "streamlined", "all-in-one", "unified", "eliminates steps"],
    banned: ["complex multi-phase", "advanced technical", "requires expertise", "steep learning curve"],
  },
  cost_affordability: {
    emphasis: ["cost reduction", "replacing expensive teams", "efficiency gains", "budget-friendly", "eliminates overhead", "fraction of the cost", "no hiring required", "self-service"],
    banned: ["premium tier", "enterprise pricing", "custom consulting", "high-touch service"],
  },
  speed_and_efficiency: {
    emphasis: ["fast execution", "rapid deployment", "instant results", "time savings", "accelerated", "minutes not months", "real-time", "immediate", "shortcut"],
    banned: ["long-term program", "gradual improvement", "multi-month rollout", "slow and steady"],
  },
  proof_and_transparency: {
    emphasis: ["verified results", "data-backed", "measurable outcomes", "transparent process", "case-study proven", "evidence-based", "auditable", "trackable"],
    banned: ["trust us", "proprietary black box", "unverified claims", "theoretical"],
  },
  niche_expertise: {
    emphasis: ["specialized knowledge", "industry-specific", "tailored methodology", "domain authority", "insider expertise", "category-specific", "built for [niche]"],
    banned: ["generic solution", "one-size-fits-all", "broad application", "universal platform"],
  },
  value_accessibility: {
    emphasis: ["accessible", "democratized", "no barrier to entry", "affordable", "inclusive", "available to all", "low commitment"],
    banned: ["exclusive", "limited access", "premium-only", "gated"],
  },
  whitespace_positioning: {
    emphasis: ["first-of-its-kind", "nobody else does", "unoccupied territory", "pioneering approach", "category-creating", "novel method"],
    banned: ["industry standard", "proven approach", "well-established", "traditional"],
  },
  demand_driven_authority: {
    emphasis: ["market-demanded", "audience-requested", "high-demand solution", "fills critical gap", "solves urgent need"],
    banned: ["supply-driven", "looking for a problem", "nice-to-have"],
  },
  underserved_audience_focus: {
    emphasis: ["built for overlooked segment", "serves the underserved", "designed for [specific group]", "specialized for [audience]"],
    banned: ["mass market", "everyone can use", "broad appeal"],
  },
};

export const MIN_MECHANISM_CONFIDENCE = 0.4;

export const MECHANISM_STRUCTURAL_TYPES = ["framework", "system", "protocol", "method", "architecture", "engine", "process"] as const;
export type MechanismStructuralType = typeof MECHANISM_STRUCTURAL_TYPES[number];
