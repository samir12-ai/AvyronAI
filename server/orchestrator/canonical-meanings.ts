import type { AwarenessMeaningRef } from "./shared-strategic-context";

export type AwarenessStage =
  | "unaware"
  | "problem_aware"
  | "solution_aware"
  | "product_aware"
  | "most_aware";

export const AWARENESS_MEANINGS: Record<AwarenessStage, AwarenessMeaningRef> = {
  unaware: {
    stage: "unaware",
    trustLevel: "none",
    searchIntentExists: false,
    comparisonBehavior: false,
    conversionReadiness: "not_ready",
    proofRequirement: "educational",
    educationLevel: "full",
    allowedFunnelTypes: ["content_education", "quiz", "diagnostic"],
    blockedFunnelTypes: [
      "direct",
      "tripwire",
      "application",
      "product-launch",
    ],
    allowedChannelRoles: ["discovery"],
    allowedPersuasionModes: ["education_proof_hybrid"],
  },
  problem_aware: {
    stage: "problem_aware",
    trustLevel: "low",
    searchIntentExists: false,
    comparisonBehavior: false,
    conversionReadiness: "needs_nurture",
    proofRequirement: "educational",
    educationLevel: "moderate",
    allowedFunnelTypes: ["webinar", "challenge", "quiz", "diagnostic"],
    blockedFunnelTypes: ["direct", "tripwire"],
    allowedChannelRoles: ["discovery", "nurture"],
    allowedPersuasionModes: ["empathy_led"],
  },
  solution_aware: {
    stage: "solution_aware",
    trustLevel: "moderate",
    searchIntentExists: true,
    comparisonBehavior: true,
    conversionReadiness: "evaluating",
    proofRequirement: "comparative",
    educationLevel: "minimal",
    allowedFunnelTypes: ["webinar", "challenge", "consult"],
    blockedFunnelTypes: [],
    allowedChannelRoles: ["discovery", "nurture", "conversion"],
    allowedPersuasionModes: ["contrast_led"],
  },
  product_aware: {
    stage: "product_aware",
    trustLevel: "moderate",
    searchIntentExists: true,
    comparisonBehavior: true,
    conversionReadiness: "evaluating",
    proofRequirement: "decisive",
    educationLevel: "minimal",
    allowedFunnelTypes: [
      "webinar",
      "challenge",
      "consult",
      "direct",
      "application",
    ],
    blockedFunnelTypes: [],
    allowedChannelRoles: ["discovery", "nurture", "conversion"],
    allowedPersuasionModes: ["proof_led"],
  },
  most_aware: {
    stage: "most_aware",
    trustLevel: "high",
    searchIntentExists: true,
    comparisonBehavior: false,
    conversionReadiness: "ready",
    proofRequirement: "not_needed",
    educationLevel: "none",
    allowedFunnelTypes: [
      "direct",
      "tripwire",
      "application",
      "product-launch",
    ],
    blockedFunnelTypes: [],
    allowedChannelRoles: ["nurture", "conversion"],
    allowedPersuasionModes: ["proof_led"],
  },
};

export function resolveAwarenessMeaning(
  stage: unknown
): AwarenessMeaningRef | null {
  let raw: string | undefined;
  if (typeof stage === "string") {
    raw = stage;
  } else if (stage != null && typeof stage === "object" && "level" in stage) {
    const lvl = (stage as Record<string, unknown>).level;
    if (typeof lvl === "string") raw = lvl;
  }
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (normalized in AWARENESS_MEANINGS) {
    const src = AWARENESS_MEANINGS[normalized as AwarenessStage];
    return {
      ...src,
      allowedFunnelTypes: [...src.allowedFunnelTypes],
      blockedFunnelTypes: [...src.blockedFunnelTypes],
      allowedChannelRoles: [...src.allowedChannelRoles],
      allowedPersuasionModes: [...src.allowedPersuasionModes],
    };
  }
  return null;
}
