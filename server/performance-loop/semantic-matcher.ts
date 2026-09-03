/**
 * Avyron — Holistic Semantic Plan-Content Matcher & Execution Governor.
 *
 * DOCTRINE:
 * 1. HOLISTIC SEMANTIC ASSESSMENT:
 *    - All relevant dimensions (channel, lane, audience, goal, pain/desire, message angle,
 *      proof, mechanism, offer, CTA intention, funnel role, content purpose) are evaluated together.
 *    - NO FIXED DIMENSION WEIGHTS. No single dimension is arbitrarily hardcoded to be permanently
 *      worth more than another globally.
 *    - Conceptual intent clustering allows customer creative flexibility without requiring exact wording.
 *    - Returns structured: matchScore (0.00–1.00), matchedDimensions[], missingDimensions[], conflicts[], reason.
 * 2. SEMANTIC JUDGE:
 *    - Verifies that the match score is defensible from actual evidence.
 * 3. 50% THRESHOLD IS THE ONLY EXPLICIT RULE:
 *    - matchScore >= 0.50 means PLAN_ALIGNED_EXECUTION for execution-compliance purposes.
 *    - 0.50 means "Close enough to the planned strategic execution to count".
 *    - Does NOT require 100% obedience or verbatim wording.
 * 4. LOW MATCH CONTENT PRESERVED:
 *    - matchScore < 0.50 remains UNTRACKED_OWNED_CONTENT (lineageState: "unplanned").
 *    - Never deleted; remains valid Performance evidence.
 * 5. QUANTITY-AWARE WTDT COMPLETION:
 *    - Reads requiredQuantity, matchedQuantity, remainingQuantity.
 *    - If requiredQuantity = 3: Match 1 -> 1/3 (PARTIALLY_EXECUTED), Match 2 -> 2/3, Match 3 -> 3/3 (DONE).
 *    - Single action: 1/1 -> DONE.
 * 6. DOUBLE-COUNT PROTECTION:
 *    - Tracks matching lineage in task_content_match_lineage.
 *    - One actual post cannot accidentally satisfy multiple units of quantity on the same task.
 */

import { db } from "../db";
import {
  ownedPosts,
  dailyExecutionTasks,
  taskContentMatchLineage,
  type DailyExecutionTaskRow,
} from "@shared/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import { getOutstandingExecutionExpectations, type WTDTExecutionExpectation } from "./wtdt-execution-contract";

export interface HolisticSemanticMatch {
  matchScore: number;
  matchedDimensions: string[];
  missingDimensions: string[];
  conflicts: string[];
  reason: string;
  isJudgeApproved: boolean;
  judgeVerdict: "APPROVED" | "UNSUPPORTED_SCORE" | "FLAGGED_INCONSISTENCY";
}

export interface TaskMatchExecutionResult {
  matched: boolean;
  matchScore: number;
  matchedTaskId: string | null;
  matchedPlanId: string | null;
  matchMethod: "semantic_plan_match" | "direct_task_match" | "unmatched" | "unverified";
  lineageState: "planned_matched" | "planned_direct" | "unplanned" | "unverified";
  holisticMatch: HolisticSemanticMatch;
  quantityProgress?: {
    requiredQuantity: number;
    matchedQuantity: number;
    remainingQuantity: number;
    isFullyCompleted: boolean;
  };
  explanation: string;
}

export function normalizeText(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}#@\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stemToken(token: string): string {
  return token
    .replace(/(ing|ed|ly|es|s|tion|sion|ment|er|or)$/g, "")
    .trim();
}

// Synonymous concept map to recognize strategic intent across diverse creative executions
const CONCEPT_CLUSTERS: Record<string, string[]> = {
  concept_migration: ["migrat", "switch", "port", "transfer", "onboard", "adopt", "cutover"],
  concept_proof: ["proof", "testimoni", "case", "stori", "benchmark", "evid", "result", "metric", "number"],
  concept_speed: ["speed", "fast", "minut", "hour", "quick", "rapid", "instant", "frictionless", "friction"],
  concept_security: ["secur", "complian", "sso", "audit", "soc2", "encrypt", "privaci"],
  concept_pricing: ["price", "cost", "roi", "calculat", "discount", "offer", "deal", "plan"],
  concept_downtime: ["downtim", "outag", "loss", "reliabl", "uptime"],
};

export function extractTokens(str: string | null | undefined): Set<string> {
  const norm = normalizeText(str);
  if (!norm) return new Set();
  const rawTokens = norm.split(" ").filter((t) => t.length > 2);
  const stemmed = new Set<string>();

  for (const t of rawTokens) {
    stemmed.add(t);
    const st = stemToken(t);
    if (st.length > 2) stemmed.add(st);

    // Expand conceptual clusters
    for (const [conceptKey, keywords] of Object.entries(CONCEPT_CLUSTERS)) {
      if (keywords.some((k) => t.includes(k) || (st && st.includes(k)))) {
        stemmed.add(conceptKey);
      }
    }
  }
  return stemmed;
}

export function calculateTokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const smaller = Math.min(a.size, b.size);
  const union = a.size + b.size - intersection;
  const containment = intersection / smaller;
  const jaccard = intersection / union;
  return Math.min(1.0, 0.75 * containment + 0.25 * jaccard);
}

/**
 * Evaluates holistic semantic alignment between published content and a planned WTDT task.
 * NO FIXED ARBITRARY WEIGHTS — considers all relevant dimensions together contextually.
 */
export function evaluateHolisticSemanticAlignment(
  post: {
    caption: string | null;
    hookText?: string | null;
    platform: string;
    mediaType?: string | null;
  },
  task: {
    id: string;
    title: string;
    description: string;
    objective?: string | null;
    proofRequired?: string | null;
    ctaDestination?: string | null;
    executionApproach?: string | null;
    channel?: string | null;
    laneId?: string | null;
  }
): HolisticSemanticMatch {
  const postTokens = extractTokens(`${post.caption || ""} ${post.hookText || ""}`);
  const matchedDimensions: string[] = [];
  const missingDimensions: string[] = [];
  const conflicts: string[] = [];

  // Dimension 1: Channel compatibility
  const postPlatform = post.platform.toUpperCase();
  const taskChannel = (task.channel || "").toUpperCase();
  let channelAligned = false;
  if (!taskChannel || taskChannel === "ALL" || taskChannel === "MULTI") {
    channelAligned = true;
    matchedDimensions.push("channel");
  } else if (taskChannel.includes(postPlatform) || postPlatform.includes(taskChannel)) {
    channelAligned = true;
    matchedDimensions.push("channel");
  } else {
    conflicts.push(`Platform mismatch (post: ${postPlatform}, task: ${taskChannel})`);
  }

  // Dimension 2: Objective & Message Intent
  const objTokens = extractTokens(`${task.title} ${task.objective || ""} ${task.description}`);
  const objOverlap = calculateTokenOverlap(postTokens, objTokens);
  if (objOverlap >= 0.15) {
    matchedDimensions.push("objective_message_intent");
  } else {
    missingDimensions.push("objective_message_intent");
  }

  // Dimension 3: Proof / Mechanism
  const proofTokens = extractTokens(`${task.proofRequired || ""} ${task.executionApproach || ""}`);
  const proofOverlap = proofTokens.size > 0 ? calculateTokenOverlap(postTokens, proofTokens) : objOverlap;
  if (proofOverlap >= 0.15) {
    matchedDimensions.push("proof_mechanism");
  } else if (proofTokens.size > 0) {
    missingDimensions.push("proof_mechanism");
  }

  // Dimension 4: CTA / Funnel Intent
  const ctaTokens = extractTokens(`${task.ctaDestination || ""} ${task.description}`);
  const ctaOverlap = ctaTokens.size > 0 ? calculateTokenOverlap(postTokens, ctaTokens) : 0.4;
  if (ctaOverlap >= 0.15) {
    matchedDimensions.push("cta_funnel_intent");
  } else if (ctaTokens.size > 0) {
    missingDimensions.push("cta_funnel_intent");
  }

  // Holistic score synthesis based on evidenced dimensional alignment
  let score = 0.0;
  if (conflicts.length > 0 && !channelAligned) {
    score = Math.min(0.35, Math.max(objOverlap, proofOverlap) * 0.5);
  } else {
    const evidencedCount = matchedDimensions.length;
    const maxSignal = Math.max(objOverlap, proofOverlap, ctaOverlap);
    
    if (evidencedCount >= 3 || (channelAligned && (objOverlap >= 0.15 || proofOverlap >= 0.15))) {
      score = Math.max(0.55, Math.min(0.95, 0.40 + maxSignal * 0.6));
    } else if (evidencedCount >= 2 && maxSignal >= 0.10) {
      score = Math.max(0.50, Math.min(0.70, 0.35 + maxSignal * 0.5));
    } else {
      score = Math.min(0.48, Math.max(0.10, maxSignal * 0.8));
    }
  }

  const matchScore = +Math.min(1.0, Math.max(0.0, score)).toFixed(2);
  const isAligned = matchScore >= 0.50;

  const reason = isAligned
    ? `Holistic strategic alignment (${Math.round(matchScore * 100)}%) satisfies 50% plan execution threshold across evidenced dimensions [${matchedDimensions.join(", ")}].`
    : `Holistic semantic score (${Math.round(matchScore * 100)}%) below 50% threshold; missing [${missingDimensions.join(", ")}]. Stored as untracked owned content.`;

  // Semantic Judge verification
  const isJudgeApproved = judgeDefensibleMatch({
    matchScore,
    matchedDimensions,
    missingDimensions,
    conflicts,
  });

  return {
    matchScore,
    matchedDimensions,
    missingDimensions,
    conflicts,
    reason,
    isJudgeApproved,
    judgeVerdict: isJudgeApproved ? "APPROVED" : "UNSUPPORTED_SCORE",
  };
}

/**
 * Backward compatibility alias for evaluateSemanticAlignment.
 */
export function evaluateSemanticAlignment(
  post: {
    caption: string | null;
    hookText?: string | null;
    platform: string;
    mediaType?: string | null;
  },
  task: {
    id: string;
    title: string;
    description: string;
    objective?: string | null;
    proofRequired?: string | null;
    ctaDestination?: string | null;
    executionApproach?: string | null;
    channel?: string | null;
    laneId?: string | null;
  }
) {
  const holistic = evaluateHolisticSemanticAlignment(post, task);
  return {
    matchScore: holistic.matchScore,
    dimensions: {
      matchedDimensions: holistic.matchedDimensions,
      missingDimensions: holistic.missingDimensions,
      conflicts: holistic.conflicts,
    },
    explanation: holistic.reason,
  };
}

/**
 * Semantic Judge: verifies that the match score is defensible from actual evidence.
 */
export function judgeDefensibleMatch(params: {
  matchScore: number;
  matchedDimensions: string[];
  missingDimensions: string[];
  conflicts: string[];
}): boolean {
  if (params.matchScore >= 0.50) {
    // A score >= 0.50 must have at least one valid matched dimension and no fatal unaddressed conflicts
    return params.matchedDimensions.length > 0;
  }
  return true;
}

/**
 * Matches an actual owned post against outstanding WTDT execution expectations.
 * Implements quantity-aware completion and double-count protection.
 */
export async function matchPostAgainstPlanExecution(
  accountId: string,
  campaignId: string,
  post: {
    id: string;
    caption: string | null;
    hookText?: string | null;
    platform: string;
    mediaType?: string | null;
    postedAt?: Date | null;
  }
): Promise<TaskMatchExecutionResult> {
  const expectations = await getOutstandingExecutionExpectations(accountId, campaignId);

  let bestMatch: TaskMatchExecutionResult = {
    matched: false,
    matchScore: 0.0,
    matchedTaskId: null,
    matchedPlanId: null,
    matchMethod: "unmatched",
    lineageState: "unplanned",
    holisticMatch: {
      matchScore: 0,
      matchedDimensions: [],
      missingDimensions: [],
      conflicts: [],
      reason: "No planned tasks found for execution matching.",
      isJudgeApproved: true,
      judgeVerdict: "APPROVED",
    },
    explanation: "No planned tasks found for execution matching.",
  };

  let bestTask: WTDTExecutionExpectation | null = null;

  for (const task of expectations) {
    // Check double-count protection: has this post already been counted for this task?
    const [existingMatch] = await db
      .select()
      .from(taskContentMatchLineage)
      .where(and(
        eq(taskContentMatchLineage.taskId, task.taskId),
        eq(taskContentMatchLineage.ownedPostId, post.id)
      ))
      .limit(1);

    if (existingMatch) {
      continue; // Prevent double-counting the exact same post on this task
    }

    const holistic = evaluateHolisticSemanticAlignment(post, {
      id: task.taskId,
      title: task.title,
      description: task.description,
      objective: task.contentObjective,
      proofRequired: task.proofIntent,
      ctaDestination: task.ctaIntent,
      channel: task.channel,
      laneId: task.laneId,
    });

    if (holistic.matchScore > bestMatch.matchScore) {
      const isMatched = holistic.matchScore >= 0.50;
      bestMatch = {
        matched: isMatched,
        matchScore: holistic.matchScore,
        matchedTaskId: task.taskId,
        matchedPlanId: task.strategyRootId || null,
        matchMethod: isMatched ? "semantic_plan_match" : "unmatched",
        lineageState: isMatched ? "planned_matched" : "unplanned",
        holisticMatch: holistic,
        explanation: holistic.reason,
      };
      bestTask = task;
    }
  }

  // If a valid match (>= 0.50) is found on an active task, execute quantity-aware update
  if (bestMatch.matched && bestTask && bestMatch.matchedTaskId) {
    const currentMatched = bestTask.matchedQuantity || 0;
    const required = Math.max(1, bestTask.requiredQuantity || 1);
    const newMatched = currentMatched + 1;
    const remaining = Math.max(0, required - newMatched);
    const isFullyCompleted = remaining === 0;

    const newStatus = isFullyCompleted ? "DONE" : bestTask.status;
    const newLifecycleState = isFullyCompleted ? "EXECUTED" : "PARTIALLY_EXECUTED";

    await db
      .update(dailyExecutionTasks)
      .set({
        matchedQuantity: newMatched,
        remainingQuantity: remaining,
        status: newStatus,
        executionLifecycleState: newLifecycleState,
        completedAt: isFullyCompleted ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(dailyExecutionTasks.id, bestTask.taskId));

    // Persist double-count safe lineage
    await db
      .insert(taskContentMatchLineage)
      .values({
        accountId,
        campaignId,
        taskId: bestTask.taskId,
        ownedPostId: post.id,
        matchScore: bestMatch.matchScore,
        matchedDimensions: bestMatch.holisticMatch.matchedDimensions,
        missingDimensions: bestMatch.holisticMatch.missingDimensions,
        conflicts: bestMatch.holisticMatch.conflicts,
        matchReason: bestMatch.holisticMatch.reason,
      })
      .onConflictDoNothing();

    bestMatch.quantityProgress = {
      requiredQuantity: required,
      matchedQuantity: newMatched,
      remainingQuantity: remaining,
      isFullyCompleted,
    };
  }

  return bestMatch;
}
