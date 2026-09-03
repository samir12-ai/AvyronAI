import { aiChat } from "../ai-client";
import type { NormalizedFactualDossier } from "./source-normalizer";

export type ExecutionMode = "BUILD" | "OPTIMIZE" | "UNKNOWN";
export type PrimaryBottleneck = "REACH" | "ENGAGEMENT" | "INTENT" | "CONVERSATION" | "CONVERSION" | "RETENTION" | "NONE" | "UNKNOWN";
export type ExecutionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface CandidateBusinessExecutionState {
  mode: ExecutionMode;
  primaryBottleneck: PrimaryBottleneck;
  confidence: ExecutionConfidence;
  reasoning: string;
  evidenceSummary: string;
  missingCriticalFacts: string[];
  evidenceRefIds: string[];
  clarificationRequest?: {
    missingFactType: string;
    question: string;
    answerType: "TEXT" | "NUMBER" | "BOOLEAN" | "CHOICE";
    reason: string;
  } | null;
}

export async function evaluateBusinessStateCandidate(
  dossier: NormalizedFactualDossier,
  userAnswerContext?: string
): Promise<CandidateBusinessExecutionState> {
  const prompt = `You are Avyron AI's Business Execution State Intelligence engine.
Analyze the following factual dossier for account "${dossier.accountId}", campaign "${dossier.campaignId}":

FACTUAL DOSSIER:
- Website: ${JSON.stringify(dossier.websiteFact || null)}
- Instagram: ${JSON.stringify(dossier.instagramFact || null)}
- Manual User Truth: ${JSON.stringify(dossier.manualTruthFact || null)}
- TikTok Provider: ${JSON.stringify(dossier.tikTokFact || null)}
- YouTube Provider: ${JSON.stringify(dossier.youTubeFact || null)}
- Provider Failures: ${JSON.stringify(dossier.providerFailures)}
${userAnswerContext ? `- User Confirmed Clarification Answer: "${userAnswerContext}"` : ""}

CRITICAL INVARIANTS:
1. MISSING DATA ≠ NEW BUSINESS. Missing API connections, failed scrapers, or fresh social profile connections alone do NOT prove a business is new. If evidence is missing/uningested AND no user confirmation exists, emit mode="UNKNOWN" and confidence="LOW".
2. Mode "BUILD" means early/new business establishing repeatable market demand, prospect flow, lead capture, and initial proof. If the user explicitly confirms the business is new, or has 0 sales history / 0 historical leads, you MUST classify mode="BUILD" (confidence="HIGH" or "MEDIUM" based on user confirmation).
3. Mode "OPTIMIZE" means established business with confirmed historical sales, customers, or operating history. Requires verified pipeline evidence to identify primaryBottleneck ("REACH" | "ENGAGEMENT" | "INTENT" | "CONVERSATION" | "CONVERSION" | "RETENTION" | "NONE").
4. If evidence is ambiguous AND user confirmation is absent, emit mode="UNKNOWN", list missingCriticalFacts, and generate a dynamic ClarificationRequest. Ask ONLY for facts, NEVER for strategy preferences.
5. DO NOT generate a ClarificationRequest if the user has ALREADY provided a confirmed clarification answer in the dossier (e.g. user confirmed the business is new or has no sales history). Once the user answered, set clarificationRequest = null.

Return ONLY a JSON object matching this schema:
{
  "mode": "BUILD" | "OPTIMIZE" | "UNKNOWN",
  "primaryBottleneck": "REACH" | "ENGAGEMENT" | "INTENT" | "CONVERSATION" | "CONVERSION" | "RETENTION" | "NONE" | "UNKNOWN",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "Detailed factual explanation",
  "evidenceSummary": "Concise summary of verified evidence",
  "missingCriticalFacts": ["list of missing facts"],
  "evidenceRefIds": ["list of cited evidenceRefIds from dossier"],
  "clarificationRequest": {
    "missingFactType": "e.g. paying_customer_activity | business_operating_history",
    "question": "Dynamic factual question tailored to missing evidence",
    "answerType": "TEXT" | "NUMBER" | "BOOLEAN" | "CHOICE",
    "reason": "Why this fact is required to resolve UNKNOWN"
  } | null
}`;

  try {
    const completion = await aiChat({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o-mini",
      max_tokens: 1500,
      accountId: dossier.accountId,
      response_format: { type: "json_object" },
    });

    const contentStr = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(contentStr);
    
    // Hard fallback safety net for missing data invariant
    const hasFailures = dossier.providerFailures.length > 0;
    const hasZeroData = !dossier.instagramFact?.isConnected && !dossier.manualTruthFact?.hasUserTruth && !userAnswerContext;

    if ((hasFailures || hasZeroData) && parsed.mode === "BUILD" && (!dossier.manualTruthFact?.hasUserTruth && !userAnswerContext)) {
      return {
        mode: "UNKNOWN",
        primaryBottleneck: "UNKNOWN",
        confidence: "LOW",
        reasoning: "Insufficient verified historical evidence. Missing provider connections cannot be assumed to be a new business without confirmed truth.",
        evidenceSummary: "Provider data missing or uningested.",
        missingCriticalFacts: ["Confirmed business operating history", "Confirmed customer / lead activity"],
        evidenceRefIds: [dossier.websiteFact?.evidenceRefId, dossier.instagramFact?.evidenceRefId].filter(Boolean) as string[],
        clarificationRequest: {
          missingFactType: "business_operating_history",
          question: "Has your business been actively operating and generating customers or leads prior to connecting Avyron?",
          answerType: "TEXT",
          reason: "Clarifies whether missing platform data represents a brand-new business or uningested historical operations."
        }
      };
    }

    const isUserConfirmedNew =
      !!userAnswerContext?.toLowerCase().includes("new") ||
      !!userAnswerContext?.toLowerCase().includes("no sales") ||
      (!!dossier.manualTruthFact?.hasUserTruth &&
        (dossier.manualTruthFact.historicalCustomerCount === 0 ||
          dossier.manualTruthFact.salesRevenue === 0 ||
          dossier.manualTruthFact.userAnswer?.toLowerCase().includes("new") ||
          dossier.manualTruthFact.userAnswer?.toLowerCase().includes("no sales")));

    const finalMode = isUserConfirmedNew ? "BUILD" : (parsed.mode || "UNKNOWN");
    const finalConfidence = isUserConfirmedNew ? "HIGH" : (parsed.confidence || "LOW");

    return {
      mode: finalMode,
      primaryBottleneck: parsed.primaryBottleneck || "UNKNOWN",
      confidence: finalConfidence,
      reasoning: parsed.reasoning || "Evaluation based on factual dossier.",
      evidenceSummary: parsed.evidenceSummary || "Verified source evidence analyzed.",
      missingCriticalFacts: isUserConfirmedNew ? [] : (Array.isArray(parsed.missingCriticalFacts) ? parsed.missingCriticalFacts : []),
      evidenceRefIds: Array.isArray(parsed.evidenceRefIds) ? parsed.evidenceRefIds : [dossier.websiteFact?.evidenceRefId, dossier.instagramFact?.evidenceRefId].filter(Boolean) as string[],
      clarificationRequest: isUserConfirmedNew ? null : (parsed.clarificationRequest || null),
    };
  } catch (err: any) {
    return {
      mode: "UNKNOWN",
      primaryBottleneck: "UNKNOWN",
      confidence: "LOW",
      reasoning: `LLM evaluation fallback: ${err.message}`,
      evidenceSummary: "Factual dossier collected.",
      missingCriticalFacts: ["Complete LLM evaluation stream"],
      evidenceRefIds: [],
      clarificationRequest: null,
    };
  }
}
