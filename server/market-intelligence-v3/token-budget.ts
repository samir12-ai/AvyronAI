import type { ExecutionMode, TokenBudgetEstimate } from "./types";
import { MI_TOKEN_BUDGET, MI_COST_LIMITS } from "./constants";

export function estimateTokenUsage(
  competitorCount: number,
  totalComments: number,
  totalPosts: number,
): number {
  const cappedCompetitors = Math.min(competitorCount, MI_COST_LIMITS.MAX_COMPETITORS);
  const cappedComments = Math.min(totalComments, MI_COST_LIMITS.MAX_TOTAL_COMMENTS);
  const cappedPosts = Math.min(totalPosts, cappedCompetitors * MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR);

  const postTokens = cappedPosts * MI_TOKEN_BUDGET.TOKENS_PER_POST;
  const commentTokens = cappedComments * MI_TOKEN_BUDGET.TOKENS_PER_COMMENT;
  const baseTokens = MI_TOKEN_BUDGET.BASE_PROMPT_TOKENS;
  const narrativeTokens = MI_TOKEN_BUDGET.NARRATIVE_TOKENS;

  return baseTokens + postTokens + commentTokens + narrativeTokens;
}

export function selectExecutionMode(projectedTokens: number): { mode: ExecutionMode; reason: string | null } {
  if (projectedTokens <= MI_TOKEN_BUDGET.FULL_MODE_CEILING) {
    return { mode: "FULL", reason: null };
  }
  if (projectedTokens <= MI_TOKEN_BUDGET.FULL_MODE_CEILING * 1.5) {
    return { mode: "REDUCED", reason: `Projected tokens (${projectedTokens}) exceed FULL ceiling (${MI_TOKEN_BUDGET.FULL_MODE_CEILING})` };
  }
  return { mode: "LIGHT", reason: `Projected tokens (${projectedTokens}) exceed REDUCED ceiling, switching to deterministic-only` };
}

export function computeTokenBudget(
  competitorCount: number,
  totalComments: number,
  totalPosts: number,
): TokenBudgetEstimate {
  const projectedTokens = estimateTokenUsage(competitorCount, totalComments, totalPosts);
  const { mode, reason } = selectExecutionMode(projectedTokens);

  let ceiling: number;
  switch (mode) {
    case "FULL":
      ceiling = MI_TOKEN_BUDGET.FULL_MODE_CEILING;
      break;
    case "REDUCED":
      ceiling = MI_TOKEN_BUDGET.REDUCED_MODE_CEILING;
      break;
    case "LIGHT":
      ceiling = MI_TOKEN_BUDGET.LIGHT_MODE_CEILING;
      break;
  }

  return {
    projectedTokens,
    ceiling,
    selectedMode: mode,
    downgradeReason: reason,
  };
}

export function applySampling(
  posts: any[],
  comments: any[],
  mode: ExecutionMode,
): { sampledPosts: any[]; sampledComments: any[] } {
  let maxPosts: number;
  let maxComments: number;

  switch (mode) {
    case "FULL":
      maxPosts = MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR;
      maxComments = MI_COST_LIMITS.MAX_COMMENTS_PER_COMPETITOR;
      break;
    case "REDUCED":
      maxPosts = Math.floor(MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR * 0.5);
      maxComments = Math.floor(MI_COST_LIMITS.MAX_COMMENTS_PER_COMPETITOR * 0.5);
      break;
    case "LIGHT":
      maxPosts = Math.floor(MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR * 0.25);
      maxComments = 0;
      break;
  }

  const sampledPosts = stratifiedSample(posts, maxPosts);
  const sampledComments = comments.slice(0, maxComments);

  return { sampledPosts, sampledComments };
}

function stratifiedSample<T extends { timestamp?: string }>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items;

  const sorted = [...items].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  const result: T[] = [];
  const step = sorted.length / maxCount;
  for (let i = 0; i < maxCount; i++) {
    result.push(sorted[Math.floor(i * step)]);
  }
  return result;
}
