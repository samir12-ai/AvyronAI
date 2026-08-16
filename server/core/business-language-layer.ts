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
5. 'action_item': Concrete, actionable next steps in English. **CRITICAL BOUNDARY:** Only suggest observed areas for further investigation or analysis (e.g., "Audit your pricing terms against Competitor X", "Analyze narrative convergence in your next messaging review"). NEVER recommend strategic execution actions (e.g., "Launch a discount offer", "Create new product features", "Change your positioning to X").
`,
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
  };

  const { result } = await generateWithRepair<any, BusinessRepresentation>({
    engineName: "BusinessLanguageLayer",
    touchpointName: "StrategyPlanTranslation",
    authoritativeInput: distilledInput,
    config: { maxRepairs: 2 },

    generate: async (input) => {
      const response = await aiChat({
        model: "gpt-4o",
        temperature: 0.15,
        accountId,
        endpoint: "bll-strategy-translation",
        response_format: { type: "json_object" },
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content: `You are a Senior Strategic Copywriter and Executive Editor.
Translate the following raw, technical strategic plan into natural, professional, and clear business-friendly English.
Your output must trace the approved strategy EXACTLY.

STRICT CONSTRAINTS:
1. Do NOT change the positioning enemy, the contrast axis, target audience demographics, or pricing/offer parameters.
2. Do NOT invent new product features, marketing claims, or target channels.
3. Clean up technical engine terminology (e.g. "Operational Workflow Complexity Gap" should become a customer benefit like "positioning Avyron as the simpler way to run marketing").
4. Keep the output highly readable and engaging for a business owner.
5. You must output a JSON object matching this schema exactly:
{
  "strategicSummary": { "strategy": "...", "targetAudience": "...", "growthObjective": "...", "rationale": "..." },
  "monthlyObjective": { "objective": "..." },
  "contentDistribution": {
    "rationale": "...",
    "contentPillars": [ { "pillar": "pillar name", "examples": ["example 1", ...] } ]
  },
  "executionBlueprintDnaLink": {
    "contentPillarToDna": [ { "pillar": "pillar name", "hookApproach": "...", "ctaStyle": "..." } ],
    "weeklyDnaApplication": "..."
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
      return JSON.parse(text) as BusinessRepresentation;
    },

    judge: async (input, candidate) => {
      const parseResult = BusinessRepresentationSchema.safeParse(candidate);
      if (!parseResult.success) {
        return {
          valid: false,
          failureClass: "SCHEMA_VIOLATION",
          rejections: [parseResult.error.message],
        };
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
      return JSON.parse(text) as BusinessRepresentation;
    },
  });

  return result;
}

