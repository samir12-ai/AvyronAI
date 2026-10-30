/**
 * Structured Task Eligibility & Intent Classification
 * 
 * Replaces naive copy-based string blocking (e.g. "[REVIEW]", "prerequisites", "requires implementation")
 * with semantic task operational purposes, parent-plan authority, dependency tracking,
 * and claim entailment verification.
 */

import { evaluateClaimSemanticEntailment } from "./claim-entailment";

export type TaskOperationalPurpose =
  | "REVIEW_RESULTS"        // Performance reviews, metric retrospectives, analytics audits, weekly planning
  | "COLLECT_EVIDENCE"       // Customer surveys, testing, interviews, empirical measurements
  | "IMPLEMENT_PROPOSAL"     // Internal capability construction (e.g. build sizing guide, establish return workflow)
  | "ADVERTISE_CAPABILITY"   // Public outbound marketing (ads, reels, social posts, promotional messaging)
  | "OPERATIONAL_DELIVERY";  // Standard fulfillment, customer engagement, post scheduling

export interface TaskEligibilityContext {
  planStatus: "DRAFT" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  isPlanDesignatedActive: boolean;
  verifiedEvidenceTexts: string[];
  claimReferences?: string[];
  unresolvedDependencies?: string[];
  explicitRestrictions?: string[];
}

export interface TaskEligibilityResult {
  isEligible: boolean;
  purpose: TaskOperationalPurpose;
  blockCode?:
    | "PLAN_NOT_ACTIVE"
    | "PLAN_UNAPPROVED"
    | "UNGROUNDED_ADVERTISING_CLAIM"
    | "UNRESOLVED_DEPENDENCY"
    | "EXPLICIT_RESTRICTION"
    | "DRAFT_LIFECYCLE";
  reason?: string;
  identifiedClaim?: string;
}

/**
 * Determine the structured operational purpose of a task from its metadata and copy.
 */
export function determineTaskPurpose(task: {
  taskType?: string;
  category?: string;
  title?: string;
  description?: string;
  purpose?: string;
}): TaskOperationalPurpose {
  if (task.purpose) {
    const pUpper = task.purpose.toUpperCase();
    if (pUpper.includes("REVIEW")) return "REVIEW_RESULTS";
    if (pUpper.includes("EVIDENCE") || pUpper.includes("LEARNING")) return "COLLECT_EVIDENCE";
    if (pUpper.includes("IMPLEMENT") || pUpper.includes("PROPOSAL")) return "IMPLEMENT_PROPOSAL";
    if (pUpper.includes("ADVERTIS") || pUpper.includes("PUBLIC") || pUpper.includes("OUTBOUND")) return "ADVERTISE_CAPABILITY";
    if (pUpper.includes("DELIVERY") || pUpper.includes("OPERATIONAL")) return "OPERATIONAL_DELIVERY";
  }

  const type = (task.taskType || "").toLowerCase();
  const cat = (task.category || "").toLowerCase();
  const title = (task.title || "").toLowerCase();

  // 1. Review Results (Metrics, Retrospectives, Planning)
  if (
    type === "review" ||
    cat === "review" ||
    cat === "planning" ||
    type === "measurement" ||
    title.includes("weekly review") ||
    title.includes("performance review") ||
    title.includes("metric review") ||
    title.includes("retrospective")
  ) {
    return "REVIEW_RESULTS";
  }

  // 2. Collect Evidence (Surveys, testing, interviews)
  if (
    type === "market_learning" ||
    cat === "evidence" ||
    cat === "testing" ||
    title.includes("collect customer feedback") ||
    title.includes("interview buyers") ||
    title.includes("survey")
  ) {
    return "COLLECT_EVIDENCE";
  }

  // 3. Implement Proposal (Internal capability build, sizing calibration, return logistics setup)
  if (
    type === "proof_asset" ||
    type === "implementation" ||
    cat === "proposal_implementation" ||
    cat === "operations_setup" ||
    title.includes("build and validate") ||
    title.includes("create sizing guide") ||
    title.includes("onboard logistics partner") ||
    title.includes("establish return workflow") ||
    title.includes("draft operational terms")
  ) {
    return "IMPLEMENT_PROPOSAL";
  }

  // 4. Advertising Capability (Ads, launch campaigns, social content promoting features)
  if (
    type === "launch" ||
    type === "ads" ||
    cat === "ads" ||
    type === "content_production" ||
    type === "content" ||
    cat === "creation" ||
    cat === "scripting" ||
    cat === "filming" ||
    title.includes("ad set") ||
    title.includes("reel script") ||
    title.includes("carousel") ||
    title.includes("promote") ||
    title.includes("campaign launch")
  ) {
    return "ADVERTISE_CAPABILITY";
  }

  // 5. Operational Delivery
  if (
    type === "engagement" ||
    cat === "community" ||
    title.includes("respond to inbound") ||
    title.includes("customer support")
  ) {
    return "OPERATIONAL_DELIVERY";
  }

  return "ADVERTISE_CAPABILITY";
}

/**
 * Evaluates whether a task is eligible for execution or promotion.
 *
 * Distinguishes:
 * - Reviewing results: Always eligible under an approved plan.
 * - Collecting evidence: Always eligible under an approved plan.
 * - Implementing a proposed capability: Eligible internal implementation work.
 * - Advertising an existing capability: Requires verified evidence supporting that assertion.
 */
export function evaluateTaskEligibility(
  task: {
    id?: string;
    taskType?: string;
    category?: string;
    title: string;
    description?: string;
    status?: string;
    dependencies?: string[];
    purpose?: string;
    claimReferences?: string[];
    explicitRestrictions?: string[];
  },
  context: TaskEligibilityContext
): TaskEligibilityResult {
  const purpose = determineTaskPurpose(task);

  // 1. Parent Plan Authority: Must be APPROVED
  if (context.planStatus !== "APPROVED") {
    return {
      isEligible: false,
      purpose,
      blockCode: "PLAN_UNAPPROVED",
      reason: `Task belongs to a plan in status '${context.planStatus}', not APPROVED.`,
    };
  }

  // 2. Parent Plan Authority: Must be DESIGNATED ACTIVE for execution
  if (!context.isPlanDesignatedActive) {
    return {
      isEligible: false,
      purpose,
      blockCode: "PLAN_NOT_ACTIVE",
      reason: `Task belongs to a plan that is not the designated active execution plan.`,
    };
  }

  // 3. Unresolved explicit dependencies
  const deps = task.dependencies || context.unresolvedDependencies || [];
  if (deps.length > 0) {
    return {
      isEligible: false,
      purpose,
      blockCode: "UNRESOLVED_DEPENDENCY",
      reason: `Task has unresolved prerequisites/dependencies: ${deps.join("; ")}`,
    };
  }

  // 4. Explicit Restrictions
  const restrictions = task.explicitRestrictions || context.explicitRestrictions || [];
  if (restrictions.length > 0) {
    return {
      isEligible: false,
      purpose,
      blockCode: "EXPLICIT_RESTRICTION",
      reason: `Task carries explicit operational restrictions: ${restrictions.join("; ")}`,
    };
  }

  // 5. Purpose-specific validation
  // Reviewing results, collecting evidence, and implementing proposals are ELIGIBLE internal operations!
  if (purpose === "REVIEW_RESULTS" || purpose === "COLLECT_EVIDENCE" || purpose === "IMPLEMENT_PROPOSAL" || purpose === "OPERATIONAL_DELIVERY") {
    return {
      isEligible: true,
      purpose,
    };
  }

  // 6. Advertising an existing capability: Requires evidence validation!
  if (purpose === "ADVERTISE_CAPABILITY") {
    const textToValidate = `${task.title}. ${task.description || ""}`.trim();
    const entailment = evaluateClaimSemanticEntailment(textToValidate, context.verifiedEvidenceTexts);

    // If task copy makes factual capability assertions that are unsupported expansions:
    if (!entailment.isGrounded && entailment.status === "UNSUPPORTED_EXPANSION") {
      return {
        isEligible: false,
        purpose,
        blockCode: "UNGROUNDED_ADVERTISING_CLAIM",
        reason: `Advertising task asserts unverified capabilities (${entailment.unsupportedProperties.join(", ")}) not supported by Product Truth evidence.`,
        identifiedClaim: textToValidate,
      };
    }

    if (entailment.status === "CONTRADICTED") {
      return {
        isEligible: false,
        purpose,
        blockCode: "UNGROUNDED_ADVERTISING_CLAIM",
        reason: `Advertising task has contradictory claim modality or asserts proposal is already validated.`,
        identifiedClaim: textToValidate,
      };
    }
  }

  return {
    isEligible: true,
    purpose,
  };
}
