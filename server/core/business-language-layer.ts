// @ts-nocheck
import { z } from "zod";
import { generateWithRepair } from "../shared/llm-reliability/reliability-runner";

export interface EvidenceItem {
  source: string;
  signal: string;
  competitor: string;
  raw_metric: string;
}

export interface StrategicInsight {
  id: string;
  insight: string;
  why: string;
  evidence_summary: EvidenceItem[];
  action_item: string;
}

export interface BusinessLanguagePayload {
  insights: StrategicInsight[];
}

export function distillMarketSnapshot(rawEngineData: any) {
  // Extract only "Dominant Signals" and "Anomalies" to preserve strategic context without bloating the payload
  const rawDominance = typeof rawEngineData.dominanceData === 'string'
    ? JSON.parse(rawEngineData.dominanceData)
    : (rawEngineData.dominanceData || []);
    
  const dominance = rawDominance.map((d: any) => ({
    competitorName: d.competitorName,
    dominanceScore: d.dominanceScore,
    dominanceLevel: d.dominanceLevel,
    strengths: (d.strengths || []).slice(0, 3),
    weaknesses: (d.weaknesses || []).slice(0, 3),
  }));

  const trajectory = typeof rawEngineData.trajectoryData === 'string'
    ? JSON.parse(rawEngineData.trajectoryData)
    : (rawEngineData.trajectoryData || {});

  const anomalies: string[] = [];
  if (trajectory.hashtagDriftScore > 0.6 || trajectory.narrativeConvergenceScore > 0.6) {
    anomalies.push("High hashtag drift / narrative convergence detected (positioning alignment risk)");
  }
  if (trajectory.offerCompressionIndex > 0.5) {
    anomalies.push("Offer compression detected (pricing/value convergence)");
  }

  const rawThreats = typeof rawEngineData.threatSignals === 'string'
    ? JSON.parse(rawEngineData.threatSignals)
    : (rawEngineData.threatSignals || []);
    
  const rawOpps = typeof rawEngineData.opportunitySignals === 'string'
    ? JSON.parse(rawEngineData.opportunitySignals)
    : (rawEngineData.opportunitySignals || []);

  return {
    marketState: rawEngineData.marketState || "Unknown",
    dominance,
    anomalies,
    topThreats: rawThreats.slice(0, 3),
    topOpportunities: rawOpps.slice(0, 3),
  };
}

export async function translateToBusinessLanguage(
  rawEngineData: any,
  accountId: string
): Promise<BusinessLanguagePayload | null> {
  try {
    const distilledInput = distillMarketSnapshot(rawEngineData);
    
    const { result } = await generateWithRepair<any, BusinessLanguagePayload>({
      engineName: "BusinessLanguageLayer",
      touchpointName: "ExecutiveTranslation",
      authoritativeInput: distilledInput,
      config: { maxRepairs: 2 },

      generate: async (input) => {
        const { aiChat } = await import("../ai-client");
        const response = await aiChat({
          model: "gpt-4o",
          temperature: 0.1,
          accountId,
          endpoint: "bll-translation",
          response_format: { type: "json_object" },
          max_tokens: 1000,
          messages: [
            {
              role: "system",
              content: `You are a Senior Strategic Advisor. Translate this complex marketing intelligence data into exactly 3 clear, actionable strategic insights in English for a business owner.
Strictly enforce the "Insight -> Why -> Evidence -> Action" hierarchy for each insight.
Output a strict JSON structure containing exactly 1 key 'insights', which is an array of exactly 3 objects.
Each object must have these keys:
1. 'id': A unique stable string key (e.g. "insight_1", "insight_2", "insight_3")
2. 'insight': The high-level strategic takeaway (in Business-Friendly English). Apply this translation mapping for raw technical terms:
   - EXPOSED -> "Market Opportunity (Weak Competitor)"
   - High hashtag drift -> "Unclear Marketing Message"
   - Weakening CTA presence -> "Failing to Ask for the Sale"
   - ESTABLISHED COMPETITION -> "Crowded Market (Entry Point Identified)"
   - Declining posting frequency -> "Dropping Engagement (Opportunity to step in)"
   - DOMINANT -> "Dominant Market Leader (Avoid Direct Conflict)"
   - STRUCTURALLY_STRONG -> "Strong Competitor (Find Niche Gap)"
   - EFFICIENT -> "Agile Niche Competitor"
   - Low content innovation -> "Stagnant Content Theme"
   - Frequent offer changes -> "Unstable Offers (Audience Confusion)"
3. 'why': Clear business reasoning in English explaining why this insight matters.
4. 'evidence_summary': Array of evidence objects containing:
   - 'source': The engine or source name (in English)
   - 'signal': Translated business-friendly signal (in English, using the same mapping above)
   - 'competitor': The competitor name
   - 'raw_metric': The raw technical metric (in English, e.g., "hashtagDriftScore: 0.72")
5. 'action_item': Concrete, actionable next steps in English. **CRITICAL BOUNDARY:** Only suggest observed areas for further investigation or analysis (e.g., "Audit your pricing terms against Competitor X", "Analyze narrative convergence in your next messaging review"). NEVER recommend strategic execution actions (e.g., "Launch a discount offer", "Create new product features", "Change your positioning to X").`,
            },
            {
              role: "user",
              content: `DISTILLED ENGINE DATA:\n${JSON.stringify(input)}`,
            },
          ],
        });

        const text = response.choices?.[0]?.message?.content ?? "{}";
        return JSON.parse(text) as BusinessLanguagePayload;
      },

      judge: async (input, candidate) => {
        if (!Array.isArray(candidate.insights) || candidate.insights.length !== 3) {
          return { valid: false, failureClass: "SCHEMA_VIOLATION", rejections: ["'insights' must be an array of exactly 3 insights"] };
        }
        for (const item of candidate.insights) {
          if (!item.id || !item.insight || !item.why || !Array.isArray(item.evidence_summary) || !item.action_item) {
            return { valid: false, failureClass: "SCHEMA_VIOLATION", rejections: ["Insight object is missing required fields (id, insight, why, evidence_summary, action_item)"] };
          }
        }
        return { valid: true };
      },

      repair: async (input, failedCandidate, rejections) => {
        const { aiChat } = await import("../ai-client");
        const response = await aiChat({
          model: "gpt-4o",
          temperature: 0.1,
          accountId,
          endpoint: "bll-translation-repair",
          response_format: { type: "json_object" },
          max_tokens: 1000,
          messages: [
            {
              role: "system",
              content: `You are a Senior Strategic Advisor. Fix the strategic insights payload in English.
Output a strict JSON structure containing exactly 1 key 'insights', which is an array of exactly 3 objects.
Each object must have: id, insight, why, evidence_summary, action_item.
**CRITICAL BOUNDARY:** action_item must only suggest observed areas for further investigation (e.g. "Audit pricing terms") and NEVER recommend execution actions (e.g. "Launch a discount").
Errors to fix: ${rejections.join(", ")}`,
            },
            {
              role: "user",
              content: `ORIGINAL DISTILLED DATA:\n${JSON.stringify(input)}\n\nPREVIOUS FAILED OUTPUT:\n${JSON.stringify(failedCandidate)}`,
            },
          ],
        });
        const text = response.choices?.[0]?.message?.content ?? "{}";
        return JSON.parse(text) as BusinessLanguagePayload;
      },
    });

    return result;
  } catch (error) {
    console.error("[BLL] Translation failed:", error);
    return {
      insights: [
        {
          id: "insight_fallback",
          insight: "Crowded Market (Entry Point Identified)",
          why: "Competitor analysis indicates highly aligned messaging across the market.",
          evidence_summary: [
            { source: "BLL Engine", signal: "Crowded Market (Entry Point Identified)", competitor: "General Market", raw_metric: "Fallback" }
          ],
          action_item: "Focus on establishing unique positioning messages."
        }
      ]
    };
  }
}

export const BusinessRepresentationSchema = z.object({
  strategicSummary: z.object({
    strategy: z.string().min(1),
    targetAudience: z.string().min(1),
    growthObjective: z.string().min(1),
    rationale: z.string().min(1),
  }),
  monthlyObjective: z.object({
    objective: z.string().min(1),
  }),
  contentDistribution: z.object({
    rationale: z.string().min(1),
    contentPillars: z.array(z.object({
      pillar: z.string().min(1),
      examples: z.array(z.string()),
    })),
  }),
  executionBlueprintDnaLink: z.object({
    contentPillarToDna: z.array(z.object({
      pillar: z.string().min(1),
      hookApproach: z.string().min(1),
      ctaStyle: z.string().min(1),
    })),
    weeklyDnaApplication: z.string().min(1),
  }),
  buyerConversionJourneys: z.array(z.object({
    laneId: z.string().optional(),
    laneLabel: z.string().optional(),
    primaryPainId: z.string().optional(),
    segmentIds: z.array(z.string()).optional(),
    sourceFunnelSnapshotId: z.string().optional(),
    sourcePersuasionSnapshotId: z.string().optional(),
    journeyName: z.string(),
    journeyType: z.string(),
    whyThisJourney: z.string(),
    entryTrigger: z.object({
      mechanismType: z.string(),
      purpose: z.string(),
    }),
    stages: z.array(z.object({
      stageId: z.string().optional(),
      stageName: z.string(),
      goal: z.string(),
      buyerState: z.string(),
      coreMessage: z.string(),
      contentAction: z.string(),
      proof: z.array(z.union([z.string(), z.record(z.any())])),
      cta: z.string(),
    })),
    persuasionStrategy: z.object({
      mode: z.string(),
      modeLabel: z.string(),
      coreBeliefTransformation: z.object({
        currentBelief: z.string(),
        desiredBelief: z.string(),
        contradictionLogic: z.string().optional(),
      }),
      messageSequence: z.array(z.object({
        step: z.string(),
        stepLabel: z.string(),
        rationale: z.string(),
      })),
      objections: z.array(z.object({
        objectionId: z.string().optional(),
        objection: z.string(),
        response: z.string(),
        requiredProof: z.string(),
        funnelStageId: z.string().optional(),
      })),
      trustStrategy: z.object({
        buyerRiskState: z.string(),
        trustDeficit: z.string(),
        transferMechanismName: z.string(),
        proofArtifact: z.string(),
        primaryCialdiniPrinciple: z.string(),
        principleRationale: z.string(),
      }),
    }).optional(),
  })).optional(),
  buyerConversionJourney: z.object({
    journeyName: z.string(),
    journeyType: z.string(),
    whyThisJourney: z.string(),
    entryTrigger: z.object({
      mechanismType: z.string(),
      purpose: z.string(),
    }),
    stages: z.array(z.object({
      stageId: z.string().optional(),
      stageName: z.string(),
      goal: z.string(),
      buyerState: z.string(),
      coreMessage: z.string(),
      contentAction: z.string(),
      proof: z.array(z.union([z.string(), z.record(z.any())])),
      cta: z.string(),
    })),
  }).optional(),
  persuasionStrategy: z.object({
    mode: z.string(),
    modeLabel: z.string(),
    coreBeliefTransformation: z.object({
      currentBelief: z.string(),
      desiredBelief: z.string(),
      contradictionLogic: z.string().optional(),
    }),
    messageSequence: z.array(z.object({
      step: z.string(),
      stepLabel: z.string(),
      rationale: z.string(),
    })),
    objections: z.array(z.object({
      objectionId: z.string().optional(),
      objection: z.string(),
      response: z.string(),
      requiredProof: z.string(),
      funnelStageId: z.string().optional(),
    })),
    trustStrategy: z.object({
      buyerRiskState: z.string(),
      trustDeficit: z.string(),
      transferMechanismName: z.string(),
      proofArtifact: z.string(),
      primaryCialdiniPrinciple: z.string(),
      principleRationale: z.string(),
    }),
  }).optional(),
});

export type BusinessRepresentation = z.infer<typeof BusinessRepresentationSchema>;

export async function translateStrategyPlanToBusinessLanguage(
  plan: any,
  accountId: string
): Promise<BusinessRepresentation> {
  const { aiChat } = await import("../ai-client");

  const distilledInput = {
    strategicSummary: plan.strategicSummary || {},
    monthlyObjective: plan.monthlyObjective || {},
    contentDistribution: {
      rationale: plan.contentDistribution?.rationale || "",
      contentPillars: (plan.contentDistribution?.contentPillars || []).map((p: any) => ({
        pillar: p.pillar || p.name || "",
        examples: p.examples || [],
      })),
    },
    executionBlueprintDnaLink: {
      contentPillarToDna: (plan.executionBlueprintDnaLink?.contentPillarToDna || []).map((p: any) => ({
        pillar: p.pillar || "",
        hookApproach: p.hookApproach || "",
        ctaStyle: p.ctaStyle || "",
      })),
      weeklyDnaApplication: plan.executionBlueprintDnaLink?.weeklyDnaApplication || "",
    },
    buyerConversionJourneys: plan.buyerConversionJourneys || undefined,
    buyerConversionJourney: plan.buyerConversionJourney || undefined,
    persuasionStrategy: plan.persuasionStrategy || undefined,
  };

  try {
    const { result } = await generateWithRepair<any, BusinessRepresentation>({
      engineName: "BusinessLanguageLayer",
      touchpointName: "StrategyPlanTranslation",
      authoritativeInput: distilledInput,
      config: { maxRepairs: 2 },

      generate: async (input) => {
        const response = await aiChat({
          model: "gpt-4o",
          temperature: 0.1,
          accountId,
          endpoint: "bll-strategy-translation",
          response_format: { type: "json_object" },
          max_tokens: 2000,
          messages: [
            {
              role: "system",
              content: `You are a Senior Strategic Copywriter and Executive Business Editor.
Translate the following technical strategic plan into natural, professional, and clear business-friendly English for the business owner.
Your output must trace the approved strategy EXACTLY.

STRICT CONSTITUTIONAL RULES:
1. DECISION & TRADEOFF PRESERVATION: You must NEVER flatten concrete strategic decisions into generic platitudes (e.g. "lead with batch consistency and sourcing reliability for clinics rather than consumer therapeutic claims" must NOT become "build trust with clinics"). Preserve all explicit tradeoffs and "what NOT to do" boundaries.
2. MULTI-LANE SEPARATION: Keep distinct customer segments and strategic lanes separate. Do not smush B2B clinic procurement, wellness practitioners, and wholesale buyers into a single generic paragraph.
3. NO INVENTED CAPABILITIES: Do NOT invent unvalidated features, SLAs, or technical integrations (e.g. "real-time API tracking", "guaranteed zero stockouts") unless explicitly present in the input. If a proof gap or capability gap is noted, preserve it honestly.
4. CLEAN JARGON WITHOUT LOSING MEANING: Clean up technical engine terminology into clear business outcomes without losing the underlying commercial logic.
5. You must output a JSON object matching this schema exactly:
{
  "strategicSummary": {
    "strategy": "The overarching strategic positioning choice, core diagnosis, and competitive decision",
    "targetAudience": "Clear breakdown of each distinct active audience lane, their specific problem, and commercial impact",
    "growthObjective": "Specific conversion model and commercial objective",
    "rationale": "Why this strategic path was chosen, why it beats current alternatives, and the explicit tradeoffs (what NOT to do)"
  },
  "monthlyObjective": { "objective": "..." },
  "contentDistribution": {
    "rationale": "Strategic rationale linking content pillars to the distinct audience lanes and required perception shifts",
    "contentPillars": [ { "pillar": "pillar name", "examples": ["example 1", ...] } ]
  },
  "executionBlueprintDnaLink": {
    "contentPillarToDna": [ { "pillar": "pillar name", "hookApproach": "...", "ctaStyle": "..." } ],
    "weeklyDnaApplication": "How DNA and strategic boundaries apply across the weekly schedule"
  }
}`,
            },
            {
              role: "user",
              content: `RAW STRATEGIC DATA TO TRANSLATE:\n${JSON.stringify(input)}`,
            },
          ],
        });

        const text = response.choices?.[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(text) as BusinessRepresentation;
        if (input.buyerConversionJourneys) parsed.buyerConversionJourneys = input.buyerConversionJourneys;
        if (input.buyerConversionJourney) parsed.buyerConversionJourney = input.buyerConversionJourney;
        if (input.persuasionStrategy) parsed.persuasionStrategy = input.persuasionStrategy;
        return parsed;
      },

      judge: async (input, candidate) => {
        const parseResult = BusinessRepresentationSchema.safeParse(candidate);
        if (!parseResult.success) {
          return {
            valid: false,
            failureClass: "SCHEMA_VIOLATION",
            rejections: parseResult.error.errors.map(
              (e) => `Field ${e.path.join(".")}: ${e.message}`
            ),
          };
        }

        const combined = [
          candidate.strategicSummary.strategy,
          candidate.strategicSummary.targetAudience,
          candidate.strategicSummary.growthObjective,
          candidate.strategicSummary.rationale,
        ]
          .join(" ")
          .toLowerCase();

        const genericPlatitudes = [
          "build trust",
          "use proof-led persuasion",
          "maintain consistent presence",
          "leverage social proof",
          "focus on quality",
          "provide value",
        ];

        for (const platitude of genericPlatitudes) {
          if (combined.includes(platitude)) {
            return {
              valid: false,
              failureClass: "GENERIC_STRATEGY_DECISION",
              rejections: [
                `BLL output contains generic platitude: "${platitude}". Reframe around the concrete commercial decision and explicit tradeoffs.`,
              ],
            };
          }
        }

        return { valid: true };
      },

      repair: async (input, failedCandidate, rejections) => {
        const response = await aiChat({
          model: "gpt-4o",
          temperature: 0.1,
          accountId,
          endpoint: "bll-strategy-translation-repair",
          response_format: { type: "json_object" },
          max_tokens: 1500,
          messages: [
            {
              role: "system",
              content: `You are a Senior Strategic Copywriter. Fix the JSON strategy plan translation.
Output a strict JSON object matching the requested schema:
{
  "strategicSummary": { "strategy": "...", "targetAudience": "...", "growthObjective": "...", "rationale": "..." },
  "monthlyObjective": { "objective": "..." },
  "contentDistribution": {
    "rationale": "...",
    "contentPillars": [ { "pillar": "...", "examples": ["...", ...] } ]
  },
  "executionBlueprintDnaLink": {
    "contentPillarToDna": [ { "pillar": "...", "hookApproach": "...", "ctaStyle": "..." } ],
    "weeklyDnaApplication": "..."
  }
}
Errors to fix: ${rejections.join(", ")}`,
            },
            {
              role: "user",
              content: `ORIGINAL INPUT:\n${JSON.stringify(input)}\n\nPREVIOUS FAILED OUTPUT:\n${JSON.stringify(failedCandidate)}`,
            },
          ],
        });

        const text = response.choices?.[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(text) as BusinessRepresentation;
        if (input.buyerConversionJourneys) parsed.buyerConversionJourneys = input.buyerConversionJourneys;
        if (input.buyerConversionJourney) parsed.buyerConversionJourney = input.buyerConversionJourney;
        if (input.persuasionStrategy) parsed.persuasionStrategy = input.persuasionStrategy;
        return parsed;
      },
    });

    return result;
  } catch (err: any) {
    console.warn(
      `[BusinessLanguageLayer] LLM translation unavailable (${err.message}). Using structured canonical business representation fallback.`
    );
    return {
      strategicSummary: {
        strategy: distilledInput.strategicSummary.strategy,
        targetAudience: distilledInput.strategicSummary.targetAudience,
        growthObjective: distilledInput.strategicSummary.growthObjective,
        rationale: distilledInput.strategicSummary.rationale,
      },
      monthlyObjective: {
        objective: distilledInput.monthlyObjective.objective,
      },
      contentDistribution: {
        rationale: distilledInput.contentDistribution.rationale,
        contentPillars: distilledInput.contentDistribution.contentPillars,
      },
      executionBlueprintDnaLink: {
        contentPillarToDna: distilledInput.executionBlueprintDnaLink.contentPillarToDna,
        weeklyDnaApplication: distilledInput.executionBlueprintDnaLink.weeklyDnaApplication,
      },
      buyerConversionJourneys: (distilledInput as any).buyerConversionJourneys,
      buyerConversionJourney: distilledInput.buyerConversionJourney,
      persuasionStrategy: distilledInput.persuasionStrategy,
    };
  }
}
