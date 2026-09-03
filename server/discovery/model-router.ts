import { resolveModelForTier, type ModelCapabilityTier } from "../ai-client";

export { resolveModelForTier, type ModelCapabilityTier };

export const DISCOVERY_MODEL_TIERS = {
  MISSION_PLANNER: "HIGH_CAPABILITY" as ModelCapabilityTier,
  IDENTITY_VERIFIER: "HIGH_REASONING" as ModelCapabilityTier,
  RELEVANCE_VERIFIER: "HIGH_CAPABILITY" as ModelCapabilityTier,
  FINAL_JUDGE: "STRATEGIC_REASONING" as ModelCapabilityTier,
  STRUCTURAL_PARSER: "STANDARD_CLASSIFICATION" as ModelCapabilityTier,
};
