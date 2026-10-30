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
    answerType: "TEXT" | "NUMBER" | "BOOLEAN" | "CHOICE" | "STRUCTURED_BASELINE";
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
- LinkedIn Provider: ${JSON.stringify(dossier.linkedInFact || null)}
- Provider Failures: ${JSON.stringify(dossier.providerFailures)}
${userAnswerContext ? `- User Confirmed Clarification Answer: "${userAnswerContext}"` : ""}

CRITICAL INVARIANTS:
1. MISSING DATA ≠ NEW BUSINESS, AND OPERATING AGE ≠ SALES. Missing commercial metrics or social history do NOT prove a business is new, and operating age alone (>6 months) NEVER implies verified historical sales or commercial maturity. If commercial baseline evidence is missing and no user confirmation exists, emit mode="UNKNOWN" and confidence="LOW".
2. Mode "BUILD" means early/new business or a business with confirmed 0 historical paying customers establishing repeatable market demand, prospect flow, lead capture, and initial proof. If the user explicitly confirms the business has 0 historical paying customers / 0 sales history, you MUST classify mode="BUILD" (confidence="HIGH" or "MEDIUM" based on user confirmation).
3. Mode "OPTIMIZE" means established business with confirmed historical paying customers or sales revenue. Requires verified pipeline evidence to identify primaryBottleneck ("REACH" | "ENGAGEMENT" | "INTENT" | "CONVERSATION" | "CONVERSION" | "RETENTION" | "NONE").
4. If commercial baseline evidence is absent, emit mode="UNKNOWN", list missingCriticalFacts, and generate a structured baseline ClarificationRequest with missingFactType="business_operating_baseline" and answerType="STRUCTURED_BASELINE". NEVER combine operating age and paying customers into a single boolean yes/no question. Ask clearly for: (a) operating history duration (months) and (b) whether the business has verified historical paying customers (and optional count/revenue).
5. DO NOT generate a ClarificationRequest if the user has ALREADY provided a confirmed baseline answer in the dossier. Once answered, set clarificationRequest = null.

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
    "missingFactType": "business_operating_baseline",
    "question": "Please confirm your business baseline: (1) How many months has your business been actively operating? (2) Has your business acquired paying customers prior to this campaign window (and if so, approximately how many)?",
    "answerType": "STRUCTURED_BASELINE",
    "reason": "Separates operating duration from verified commercial traction so Avyron can calibrate BUILD vs. OPTIMIZE mode without conflating business age with sales."
  } | null
}`;

  const hasVerifiedSalesOrCustomers =
    dossier.manualTruthFact?.hasHistoricalPaidCustomers === true ||
    (typeof dossier.manualTruthFact?.historicalCustomerCount === "number" &&
      dossier.manualTruthFact.historicalCustomerCount > 0) ||
    (typeof dossier.manualTruthFact?.weeklyPayingCustomers === "number" &&
      dossier.manualTruthFact.weeklyPayingCustomers > 0) ||
    (typeof dossier.manualTruthFact?.salesRevenue === "number" &&
      dossier.manualTruthFact.salesRevenue > 0);

  const isUserConfirmedNew =
    !hasVerifiedSalesOrCustomers &&
    (!!userAnswerContext?.toLowerCase().includes("new") ||
      !!userAnswerContext?.toLowerCase().includes("no sales") ||
      !!userAnswerContext?.toLowerCase().includes("0 paying customers") ||
      dossier.manualTruthFact?.hasHistoricalPaidCustomers === false ||
      (!!dossier.manualTruthFact?.hasUserTruth &&
        (dossier.manualTruthFact.historicalCustomerCount === 0 ||
          dossier.manualTruthFact.salesRevenue === 0 ||
          dossier.manualTruthFact.userAnswer?.toLowerCase().includes("new") ||
          dossier.manualTruthFact.userAnswer?.toLowerCase().includes("no sales"))));

  const isUserConfirmedEstablished = hasVerifiedSalesOrCustomers;

  const hasAnsweredBaseline =
    !!userAnswerContext ||
    !!dossier.manualTruthFact?.hasBaselineTruth ||
    (dossier.manualTruthFact?.hasHistoricalPaidCustomers !== null &&
      dossier.manualTruthFact?.hasHistoricalPaidCustomers !== undefined);

  const defaultClarificationRequest = hasAnsweredBaseline
    ? null
    : {
        missingFactType: "business_operating_baseline",
        question:
          "Please confirm your business baseline: (1) How many months has your business been actively operating? (2) Has your business acquired paying customers prior to this campaign window (and if so, approximately how many)?",
        answerType: "STRUCTURED_BASELINE" as const,
        reason:
          "Separates operating duration from verified commercial traction so Avyron can calibrate BUILD vs. OPTIMIZE mode without conflating business age with sales.",
      };

  const defaultEvidenceRefIds = [
    dossier.websiteFact?.evidenceRefId,
    dossier.instagramFact?.evidenceRefId,
    dossier.linkedInFact?.evidenceRefId,
    dossier.manualTruthFact?.evidenceRefId,
  ].filter(Boolean) as string[];

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
        missingCriticalFacts: ["Confirmed business operating duration", "Confirmed historical paying customer baseline"],
        evidenceRefIds: defaultEvidenceRefIds,
        clarificationRequest: defaultClarificationRequest,
      };
    }

    const finalMode: ExecutionMode = isUserConfirmedNew
      ? "BUILD"
      : isUserConfirmedEstablished
        ? "OPTIMIZE"
        : (parsed.mode || "UNKNOWN");
    const finalConfidence: ExecutionConfidence =
      isUserConfirmedNew || isUserConfirmedEstablished ? "HIGH" : (parsed.confidence || "LOW");

    const normalizedClarificationRequest = hasAnsweredBaseline
      ? null
      : {
          ...defaultClarificationRequest!,
          reason: parsed.clarificationRequest?.reason || defaultClarificationRequest!.reason,
        };

    return {
      mode: finalMode,
      primaryBottleneck: parsed.primaryBottleneck || (isUserConfirmedEstablished ? "CONVERSION" : isUserConfirmedNew ? "REACH" : "UNKNOWN"),
      confidence: finalConfidence,
      reasoning: parsed.reasoning || "Evaluation based on factual dossier.",
      evidenceSummary: parsed.evidenceSummary || "Verified source evidence analyzed.",
      missingCriticalFacts: hasAnsweredBaseline ? [] : (Array.isArray(parsed.missingCriticalFacts) ? parsed.missingCriticalFacts : ["Confirmed business operating duration", "Confirmed historical paying customer baseline"]),
      evidenceRefIds: Array.isArray(parsed.evidenceRefIds) && parsed.evidenceRefIds.length > 0 ? parsed.evidenceRefIds : defaultEvidenceRefIds,
      clarificationRequest: normalizedClarificationRequest,
    };
  } catch (err: any) {
    const fallbackMode: ExecutionMode = isUserConfirmedNew
      ? "BUILD"
      : isUserConfirmedEstablished
        ? "OPTIMIZE"
        : "UNKNOWN";
    const fallbackBottleneck: PrimaryBottleneck = isUserConfirmedEstablished
      ? "CONVERSION"
      : isUserConfirmedNew
        ? "REACH"
        : "UNKNOWN";
    const fallbackConfidence: ExecutionConfidence =
      isUserConfirmedNew || isUserConfirmedEstablished ? "HIGH" : "LOW";

    return {
      mode: fallbackMode,
      primaryBottleneck: fallbackBottleneck,
      confidence: fallbackConfidence,
      reasoning: hasAnsweredBaseline
        ? `Deterministic dossier evaluation (${fallbackMode} mode established from confirmed baseline/window truth).`
        : `Awaiting business baseline confirmation (${err.message}).`,
      evidenceSummary: hasAnsweredBaseline
        ? "Verified user baseline and channel evidence evaluated."
        : "Factual dossier collected; awaiting user baseline confirmation.",
      missingCriticalFacts: hasAnsweredBaseline
        ? []
        : ["Confirmed business operating duration", "Confirmed historical paying customer baseline"],
      evidenceRefIds: defaultEvidenceRefIds,
      clarificationRequest: defaultClarificationRequest,
    };
  }
}
