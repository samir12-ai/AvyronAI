import OpenAI from "openai";
import type {
  IntelligenceScores,
  StorytellingIntelligence,
} from "./intelligence-scores";

export interface CreativeExpansion {
  dominance_strategy_mode: string;
  attack_angles: string[];
  content_pillars: string[];
  conversion_injection_idea: string;
  narrative_disruption_idea: string;
}

export interface CreativeStrategy {
  strategic_mode: "authority_takeover" | "narrative_domination" | "conversion_hybrid" | "positioning_disruption" | "trust_acceleration";
  out_of_box_angles: string[];
  storytelling_series_concepts: string[];
  identity_positioning_play: string;
  subtle_conversion_layer: string;
}

export interface CombinedCreativeOutput {
  creative_expansion: CreativeExpansion;
  creative_strategy: CreativeStrategy;
}

export async function generateCreativeExpansion(
  scores: IntelligenceScores,
  competitorName: string
): Promise<CombinedCreativeOutput> {
  const { conversion_intelligence, narrative_intelligence, performance_context, archetype, dominance, storytelling_intelligence } = scores;

  const convGaps: string[] = [];
  if (conversion_intelligence.cta_presence_score < 40) convGaps.push("low CTA presence");
  if (conversion_intelligence.offer_clarity_score < 30) convGaps.push("unclear offers");
  if (conversion_intelligence.funnel_visibility_score < 30) convGaps.push("weak funnel visibility");

  const narrGaps: string[] = [];
  if (!narrative_intelligence.narrative_arc_detected) narrGaps.push("no narrative arc");
  if (narrative_intelligence.emotional_intensity_score < 30) narrGaps.push("low emotional intensity");
  if (narrative_intelligence.identity_targeting_strength < 30) narrGaps.push("weak identity targeting");

  const posGaps: string[] = [];
  if (storytelling_intelligence.authority_building_score < 30) posGaps.push("low authority presence");
  if (storytelling_intelligence.soft_persuasion_strength < 30) posGaps.push("weak soft persuasion");

  const storytellingStrong = storytelling_intelligence.storytelling_present && storytelling_intelligence.authority_building_score >= 40;
  const ctaAbsent = conversion_intelligence.cta_presence_score < 30;

  let cseDirective: string;
  if (ctaAbsent && storytellingStrong) {
    cseDirective = "CRITICAL: Competitor has NO CTA but STRONG storytelling. Do NOT recommend aggressive CTA injection. Instead recommend layered subtle conversion strategies that preserve narrative authority.";
  } else if (dominance.dominance_state === "DOMINANT") {
    cseDirective = "Competitor is DOMINANT. Recommend differentiation strategies, not imitation.";
  } else if (dominance.dominance_state === "WEAK") {
    cseDirective = "Competitor is WEAK. Recommend speed + volume play to establish presence quickly.";
  } else if (!storytelling_intelligence.storytelling_present) {
    cseDirective = "No storytelling detected. Focus creative_strategy on structural dominance and conversion mechanics.";
  } else {
    cseDirective = "Balance narrative and conversion strategies based on gaps.";
  }

  const prompt = `You are a competitive intelligence strategist. Given a competitor's full intelligence profile, output TWO structured objects in a single JSON response.

Competitor: ${competitorName}
Archetype: ${archetype}
Dominance: ${dominance.dominance_state} (score: ${dominance.dominance_score})
Conversion gaps: ${convGaps.length > 0 ? convGaps.join(", ") : "none"}
Narrative gaps: ${narrGaps.length > 0 ? narrGaps.join(", ") : "none"}
Positioning gaps: ${posGaps.length > 0 ? posGaps.join(", ") : "none"}
Persuasion style: ${narrative_intelligence.persuasion_style}
Conversion style: ${conversion_intelligence.conversion_style}
Dominant format: ${performance_context.dominant_format}
Engagement quality: ${performance_context.engagement_quality_score}/100
Storytelling present: ${storytelling_intelligence.storytelling_present}
Storytelling type: ${storytelling_intelligence.storytelling_type}
Narrative strategy mode: ${storytelling_intelligence.narrative_strategy_mode}
Authority building score: ${storytelling_intelligence.authority_building_score}/100
Soft persuasion strength: ${storytelling_intelligence.soft_persuasion_strength}/100

${cseDirective}

Return ONLY this JSON (no markdown, no explanation):
{
  "creative_expansion": {
    "dominance_strategy_mode": "<ATTACK|DEFEND|DISRUPT|CONSOLIDATE|EXPLOIT>",
    "attack_angles": ["<1>","<2>","<3>","<4>","<5>"],
    "content_pillars": ["<1>","<2>","<3>"],
    "conversion_injection_idea": "<one sentence>",
    "narrative_disruption_idea": "<one sentence>"
  },
  "creative_strategy": {
    "strategic_mode": "<authority_takeover|narrative_domination|conversion_hybrid|positioning_disruption|trust_acceleration>",
    "out_of_box_angles": ["<1>","<2>","<3>","<4>","<5>"],
    "storytelling_series_concepts": ["<1>","<2>","<3>"],
    "identity_positioning_play": "<one sentence>",
    "subtle_conversion_layer": "<one sentence>"
  }
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

    const ce = parsed.creative_expansion || {};
    const cs = parsed.creative_strategy || {};

    return {
      creative_expansion: {
        dominance_strategy_mode: ce.dominance_strategy_mode || "CONSOLIDATE",
        attack_angles: (ce.attack_angles || []).slice(0, 5),
        content_pillars: (ce.content_pillars || []).slice(0, 3),
        conversion_injection_idea: ce.conversion_injection_idea || "",
        narrative_disruption_idea: ce.narrative_disruption_idea || "",
      },
      creative_strategy: {
        strategic_mode: cs.strategic_mode || "conversion_hybrid",
        out_of_box_angles: (cs.out_of_box_angles || []).slice(0, 5),
        storytelling_series_concepts: (cs.storytelling_series_concepts || []).slice(0, 3),
        identity_positioning_play: cs.identity_positioning_play || "",
        subtle_conversion_layer: cs.subtle_conversion_layer || "",
      },
    };
  } catch (err: any) {
    console.error("[Creative Expansion+Strategy] GPT call failed:", err.message);
    return {
      creative_expansion: {
        dominance_strategy_mode: "CONSOLIDATE",
        attack_angles: [],
        content_pillars: [],
        conversion_injection_idea: "",
        narrative_disruption_idea: "",
      },
      creative_strategy: {
        strategic_mode: "conversion_hybrid",
        out_of_box_angles: [],
        storytelling_series_concepts: [],
        identity_positioning_play: "",
        subtle_conversion_layer: "",
      },
    };
  }
}
