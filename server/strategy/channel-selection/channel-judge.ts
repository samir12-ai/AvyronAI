import { aiChat, isProviderTechnicalFailureError } from "../../ai-client";
import { safeJsonParse } from "../../shared/strategic-doctrine";
import { z } from "zod";
import type {
  OwnedChannelContext,
  CompetitorPlatformData,
  MarketVoiceChannelEvidence,
  DynamicChannelProposalOutput,
} from "./types";
import type { RunStrategicContext, ProductAnchor } from "../../shared/strategic-doctrine";

const JUDGE_MODEL = "gpt-4.1-mini";

export const ChannelJudgeVerdictSchema = z.object({
  verdict: z.enum(["APPROVE", "REPAIR", "BLOCK"]),
  score: z.number().min(0).max(1),
  issues: z.array(z.string()),
  feedbackForRepair: z.string(),
  groundingCheck: z.object({
    businessModelFit: z.boolean(),
    ownedAssetEvaluated: z.boolean(),
    competitorEvidenceAccurate: z.boolean(),
    budgetRealistic: z.boolean(),
    noFabricatedFactualClaims: z.boolean(),
  }),
});

export type ChannelJudgeVerdict = z.infer<typeof ChannelJudgeVerdictSchema>;

export async function judgeChannelProposal(input: {
  proposal: DynamicChannelProposalOutput;
  productAnchor: ProductAnchor | null;
  businessModel: string;
  category: string;
  pricing: string;
  audienceSegments: string[];
  audiencePains: string[];
  awarenessStage: string;
  persuasionMode: string;
  ownedChannels: OwnedChannelContext[];
  competitorPlatforms: CompetitorPlatformData[];
  marketVoiceEvidence: MarketVoiceChannelEvidence[];
  budgetMax: number;
  priorDecisions: { engineId: string; summary: string }[];
  accountId: string;
}): Promise<ChannelJudgeVerdict> {
  const {
    proposal,
    productAnchor,
    businessModel,
    category,
    pricing,
    audienceSegments,
    audiencePains,
    awarenessStage,
    persuasionMode,
    ownedChannels,
    competitorPlatforms,
    marketVoiceEvidence,
    budgetMax,
    priorDecisions,
    accountId,
  } = input;

  const ownedChannelsText = ownedChannels.length > 0
    ? ownedChannels
        .map(
          (c) =>
            `- ${c.platform.toUpperCase()}: handle=${c.handle || "n/a"} | identity=${c.identityStatus} | metricStatus=${c.metricStatus} (${c.metricSource}) | followers=${c.followers != null ? c.followers : "unverified/null"}`
        )
        .join("\n")
    : "(no confirmed owned channels configured)";

  const compText = competitorPlatforms.length > 0
    ? competitorPlatforms
        .map(
          (c) =>
            `- ${c.platform.toUpperCase()}: ${c.activeCompetitorCount}/${c.totalCanonicalCompetitorCount} active competitors (${(c.coverageRatio * 100).toFixed(0)}% coverage), ${c.recentContentCount} recent posts`
        )
        .join("\n")
    : "(no competitor platform data)";

  const mvText = marketVoiceEvidence.length > 0
    ? marketVoiceEvidence.map((m) => `- "${m.quoteText}" [relevance: ${m.relevance}]`).join("\n")
    : "(no specific channel quotes in Market Voice)";

  const priorsText = priorDecisions.length > 0
    ? priorDecisions.map((p) => `- [${p.engineId}] ${p.summary}`).join("\n")
    : "(none)";

  const prompt = `You are a Hostile Channel Strategy Judge. Your role is to critically evaluate a proposed marketing channel recommendation for a business campaign.

═══ CANONICAL BUSINESS CONTEXT ═══
- Product Name: ${productAnchor?.name || "Target Offering"}
- Category: ${category}
- Business Model: ${businessModel}
- Offering Price Range: ${pricing}
- Core Problem / Differentiator: ${productAnchor?.coreProblemSolved || "Core customer problem and market gap"} | ${productAnchor?.differentiatingFeature || "Verified capability contrast against competitor landscape"}

═══ TARGET AUDIENCE & STAGE ═══
- Target Segments: ${audienceSegments.join("; ")}
- Validated Pains: ${audiencePains.join("; ")}
- Awareness Stage: ${awarenessStage}
- Persuasion Mode: ${persuasionMode}
- Test Budget Ceiling: $${budgetMax}

═══ OWNED ASSETS & PROVENANCE ═══
${ownedChannelsText}

═══ CANONICAL COMPETITOR EVIDENCE ═══
${compText}

═══ MARKET VOICE CHANNEL EVIDENCE ═══
${mvText}

═══ VALIDATED PRIOR DECISIONS ═══
${priorsText}

═══ PROPOSED CHANNEL RECOMMENDATION TO JUDGE ═══
${JSON.stringify(proposal, null, 2)}

═══ HOSTILE JUDGING CRITERIA ═══
1. Business Model & Audience Fit: Does the primary recommended channel make genuine strategic sense for this specific business model (e.g. B2C visual eCommerce vs B2B enterprise)?
2. Owned Asset Consideration: If the business has a confirmed owned asset (e.g. Instagram with confirmed identity/followers), did the recommendation explicitly evaluate its distribution advantage (lower activation friction) rather than ignoring it or forcing a brand-new channel from scratch without justification?
3. Competitor Evidence Groundedness: Did the proposal ground its competitor reasoning in actual data (${compText}) without hallucinating fake numbers or non-existent competitor usage?
4. Budget & Execution Realism: Are recommended channels realistic for a $${budgetMax} test budget?
5. Factual Groundedness vs Clichés: Is the rationale specific to this product, audience, and market, or is it generic marketing fluff / clichés? Did the proposal invent unevidenced factual claims (e.g. "90% of buyers are on X")?
6. No Contradictions: Does the recommendation align with prior validated decisions?

Return ONLY valid JSON matching this schema:
{
  "verdict": "APPROVE" | "REPAIR" | "BLOCK",
  "score": <0.0 to 1.0>,
  "issues": ["<specific issue 1>", "<specific issue 2>"],
  "feedbackForRepair": "<clear, actionable instructions for how to fix the recommendation if REPAIR, or empty if APPROVE>",
  "groundingCheck": {
    "businessModelFit": true | false,
    "ownedAssetEvaluated": true | false,
    "competitorEvidenceAccurate": true | false,
    "budgetRealistic": true | false,
    "noFabricatedFactualClaims": true | false
  }
}`;

  try {
    const resp = await aiChat({
      model: JUDGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      endpoint: "channel-strategy-judge",
      accountId,
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = safeJsonParse(raw, ChannelJudgeVerdictSchema);
    if (parsed) {
      return parsed;
    }
  } catch (err: any) {
    console.error(`[ChannelStrategyJudge] Execution error: ${err.message}`);
    if (isProviderTechnicalFailureError(err)) {
      throw err;
    }
  }

  return {
    verdict: "BLOCK",
    score: 0.0,
    issues: ["Channel Strategy Judge failed to produce a valid evaluation"],
    feedbackForRepair: "Re-evaluate channel proposal against business model, owned assets, and competitor evidence.",
    groundingCheck: {
      businessModelFit: false,
      ownedAssetEvaluated: false,
      competitorEvidenceAccurate: false,
      budgetRealistic: false,
      noFabricatedFactualClaims: false,
    },
  };
}
