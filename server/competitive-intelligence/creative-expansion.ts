import OpenAI from "openai";
import type {
  IntelligenceScores,
} from "./intelligence-scores";

export interface CreativeExpansion {
  dominance_strategy_mode: string;
  attack_angles: string[];
  content_pillars: string[];
  conversion_injection_idea: string;
  narrative_disruption_idea: string;
}

export async function generateCreativeExpansion(
  scores: IntelligenceScores,
  competitorName: string
): Promise<CreativeExpansion> {
  const { conversion_intelligence, narrative_intelligence, performance_context, archetype, dominance } = scores;

  const convGaps: string[] = [];
  if (conversion_intelligence.cta_presence_score < 40) convGaps.push("low CTA presence");
  if (conversion_intelligence.offer_clarity_score < 30) convGaps.push("unclear offers");
  if (conversion_intelligence.funnel_visibility_score < 30) convGaps.push("weak funnel visibility");

  const narrGaps: string[] = [];
  if (!narrative_intelligence.narrative_arc_detected) narrGaps.push("no narrative arc");
  if (narrative_intelligence.emotional_intensity_score < 30) narrGaps.push("low emotional intensity");
  if (narrative_intelligence.identity_targeting_strength < 30) narrGaps.push("weak identity targeting");

  const prompt = `You are a competitive intelligence strategist. Given a competitor's intelligence profile, output a structured creative expansion plan.

Competitor: ${competitorName}
Archetype: ${archetype}
Dominance: ${dominance.dominance_state} (score: ${dominance.dominance_score})
Conversion gaps: ${convGaps.length > 0 ? convGaps.join(", ") : "none detected"}
Narrative gaps: ${narrGaps.length > 0 ? narrGaps.join(", ") : "none detected"}
Persuasion style: ${narrative_intelligence.persuasion_style}
Conversion style: ${conversion_intelligence.conversion_style}
Dominant format: ${performance_context.dominant_format}
Engagement quality: ${performance_context.engagement_quality_score}/100

Return ONLY this JSON (no markdown, no explanation):
{
  "dominance_strategy_mode": "<one of: ATTACK, DEFEND, DISRUPT, CONSOLIDATE, EXPLOIT>",
  "attack_angles": ["<angle1>", "<angle2>", "<angle3>", "<angle4>", "<angle5>"],
  "content_pillars": ["<pillar1>", "<pillar2>", "<pillar3>"],
  "conversion_injection_idea": "<one sentence>",
  "narrative_disruption_idea": "<one sentence>"
}`;

  try {
    const openai = new OpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    const cleaned = content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      dominance_strategy_mode: parsed.dominance_strategy_mode || "CONSOLIDATE",
      attack_angles: (parsed.attack_angles || []).slice(0, 5),
      content_pillars: (parsed.content_pillars || []).slice(0, 3),
      conversion_injection_idea: parsed.conversion_injection_idea || "",
      narrative_disruption_idea: parsed.narrative_disruption_idea || "",
    };
  } catch (err: any) {
    console.error("[Creative Expansion] GPT call failed:", err.message);
    return {
      dominance_strategy_mode: "CONSOLIDATE",
      attack_angles: [],
      content_pillars: [],
      conversion_injection_idea: "",
      narrative_disruption_idea: "",
    };
  }
}
