import { aiChat } from "../ai-client";
import type {
  IntelligenceScores,
  StorytellingIntelligence,
  ConversionIntelligence,
  PerformanceContext,
  MarketArchetype,
  DominanceState,
} from "./intelligence-scores";
import type { CombinedCreativeOutput } from "./creative-expansion";

export interface ScriptItem {
  title: string;
  hook_0_2s: string;
  setup_2_6s: string;
  tension_6_12s: string;
  reveal_12_18s: string;
  proof_line_optional: string;
  soft_close_or_cta: string;
  on_screen_text: string;
  shot_suggestions: string[];
  caption_short: string;
  kpi_target: "engagement" | "leads" | "authority";
}

export interface ScriptsBatch {
  mode_used: "authority_building" | "trust_nurture" | "direct_response" | "hybrid";
  scripts: ScriptItem[];
}

export interface CreativeConcept {
  concept_name: string;
  disruptive_angle: string;
  format: "reel" | "carousel" | "hybrid";
  visual_metaphor: string;
  emotional_trigger: string;
  differentiation_factor: string;
  execution_note: string;
}

export interface CreativeConcepts {
  strategic_mode: string;
  concepts: CreativeConcept[];
  subtle_conversion_layer: string;
  risk_level: "low" | "moderate" | "bold";
}

export interface SSEOCEOutput {
  scripts_batch: ScriptsBatch;
  creative_concepts: CreativeConcepts;
}

export interface SSEOCEFailure {
  status: "GENERATION_FAILED";
  reason: string;
}

export interface BlueprintInput {
  offer: string;
  icp: string;
  location?: string;
  kpi_goal?: string;
}

const REQUIRED_SCRIPT_KEYS: (keyof ScriptItem)[] = [
  "title", "hook_0_2s", "setup_2_6s", "tension_6_12s", "reveal_12_18s",
  "soft_close_or_cta", "on_screen_text", "shot_suggestions", "caption_short", "kpi_target",
];

const REQUIRED_CONCEPT_KEYS: (keyof CreativeConcept)[] = [
  "concept_name", "disruptive_angle", "format", "visual_metaphor",
  "emotional_trigger", "differentiation_factor", "execution_note",
];

function determineMode(si: StorytellingIntelligence, ci: ConversionIntelligence): ScriptsBatch["mode_used"] {
  if (si.narrative_strategy_mode === "direct_response") return "direct_response";
  if (si.narrative_strategy_mode === "authority_building") return "authority_building";
  if (si.narrative_strategy_mode === "trust_nurture") return "trust_nurture";
  if (si.narrative_strategy_mode === "identity_building") return "authority_building";
  return "hybrid";
}

function buildDirective(
  mode: ScriptsBatch["mode_used"],
  dominance: DominanceState,
  si: StorytellingIntelligence,
  ci: ConversionIntelligence,
): string {
  const parts: string[] = [];

  if (mode !== "direct_response") {
    parts.push("CRITICAL: Do NOT generate aggressive CTAs (no 'DM now', 'Book now', 'Buy now' as primary actions). Use soft closes: invitations, curiosity hooks, value anchors.");
  }

  if (dominance.dominance_state === "DOMINANT") {
    parts.push("Competitor is DOMINANT. Generate differentiation scripts — do NOT copy their style. Find unique angles.");
  } else if (dominance.dominance_state === "WEAK") {
    parts.push("Competitor is WEAK. Generate aggressive, speed-based disruptive hooks to capture attention fast.");
  }

  if (si.storytelling_present && ci.cta_presence_score < 30) {
    parts.push("Storytelling is strong but CTA is absent. For creative_concepts, suggest ONLY layered soft conversion — no direct CTA injection.");
  }

  parts.push("All scripts MUST be localized to Dubai context (references to Dubai, UAE, regional business culture).");
  parts.push("NEVER fabricate results, metrics, or client outcomes. Use hypothetical framing if needed.");

  return parts.join("\n");
}

function validateScriptsBatch(data: any): { valid: boolean; reason?: string } {
  if (!data?.scripts_batch?.scripts || !Array.isArray(data.scripts_batch.scripts)) {
    return { valid: false, reason: "Missing scripts_batch.scripts array" };
  }
  if (data.scripts_batch.scripts.length > 5) {
    return { valid: false, reason: "Exceeds 5 scripts limit" };
  }
  for (let i = 0; i < data.scripts_batch.scripts.length; i++) {
    const s = data.scripts_batch.scripts[i];
    for (const key of REQUIRED_SCRIPT_KEYS) {
      if (!(key in s)) {
        return { valid: false, reason: `Script ${i} missing key: ${key}` };
      }
    }
  }
  return { valid: true };
}

function validateCreativeConcepts(data: any): { valid: boolean; reason?: string } {
  if (!data?.creative_concepts?.concepts || !Array.isArray(data.creative_concepts.concepts)) {
    return { valid: false, reason: "Missing creative_concepts.concepts array" };
  }
  if (data.creative_concepts.concepts.length > 5) {
    return { valid: false, reason: "Exceeds 5 concepts limit" };
  }
  for (let i = 0; i < data.creative_concepts.concepts.length; i++) {
    const c = data.creative_concepts.concepts[i];
    for (const key of REQUIRED_CONCEPT_KEYS) {
      if (!(key in c)) {
        return { valid: false, reason: `Concept ${i} missing key: ${key}` };
      }
    }
  }
  return { valid: true };
}

function validateCtaCompliance(scripts: ScriptItem[], mode: ScriptsBatch["mode_used"]): { valid: boolean; reason?: string } {
  if (mode === "direct_response") return { valid: true };
  const aggressiveCta = /\b(dm\s+(us\s+)?now|book\s+now|buy\s+now|order\s+now|sign\s+up\s+now|register\s+now|call\s+now)\b/i;
  for (let i = 0; i < scripts.length; i++) {
    const closeText = scripts[i].soft_close_or_cta || "";
    if (aggressiveCta.test(closeText)) {
      return { valid: false, reason: `Script ${i} contains aggressive CTA in non-direct mode: "${closeText}"` };
    }
  }
  return { valid: true };
}

export async function generateScriptsAndConcepts(
  intelligence: IntelligenceScores,
  creativeStrategy: CombinedCreativeOutput["creative_strategy"] | null,
  blueprint: BlueprintInput,
): Promise<SSEOCEOutput | SSEOCEFailure> {
  const { storytelling_intelligence: si, conversion_intelligence: ci, performance_context: pc, archetype, dominance } = intelligence;

  const mode = determineMode(si, ci);
  const directive = buildDirective(mode, dominance, si, ci);

  const csContext = creativeStrategy
    ? `Creative strategy mode: ${creativeStrategy.strategic_mode}\nOut-of-box angles available: ${creativeStrategy.out_of_box_angles.join(", ")}\nSubtle conversion layer: ${creativeStrategy.subtle_conversion_layer}`
    : "No prior creative strategy available.";

  const prompt = `You are an expert Dubai-based social media content strategist. Generate BOTH a scripts batch AND creative concepts in a single JSON response.

CONTEXT:
Archetype: ${archetype}
Dominance: ${dominance.dominance_state} (score: ${dominance.dominance_score})
Storytelling type: ${si.storytelling_type}
Narrative strategy: ${si.narrative_strategy_mode}
Authority score: ${si.authority_building_score}/100
Conversion style: ${ci.conversion_style}
CTA presence: ${ci.cta_presence_score}/100
Dominant format: ${pc.dominant_format}
Engagement quality: ${pc.engagement_quality_score}/100
${csContext}

BLUEPRINT:
Offer: ${blueprint.offer}
ICP: ${blueprint.icp}
Location: ${blueprint.location || "Dubai, UAE"}
KPI goal: ${blueprint.kpi_goal || "engagement"}

DIRECTIVES:
${directive}

Return ONLY this JSON (no markdown, no explanation):
{
  "scripts_batch": {
    "mode_used": "${mode}",
    "scripts": [
      {
        "title": "<short title>",
        "hook_0_2s": "<2-second hook line>",
        "setup_2_6s": "<setup 4 seconds>",
        "tension_6_12s": "<tension build 6 seconds>",
        "reveal_12_18s": "<reveal/payoff 6 seconds>",
        "proof_line_optional": "<optional proof line or empty>",
        "soft_close_or_cta": "<soft close or controlled CTA>",
        "on_screen_text": "<text overlay for video>",
        "shot_suggestions": ["<shot1>", "<shot2>"],
        "caption_short": "<Instagram caption under 50 words>",
        "kpi_target": "<engagement|leads|authority>"
      }
    ]
  },
  "creative_concepts": {
    "strategic_mode": "<mode>",
    "concepts": [
      {
        "concept_name": "<name>",
        "disruptive_angle": "<angle>",
        "format": "<reel|carousel|hybrid>",
        "visual_metaphor": "<metaphor>",
        "emotional_trigger": "<trigger>",
        "differentiation_factor": "<factor>",
        "execution_note": "<note>"
      }
    ],
    "subtle_conversion_layer": "<one sentence>",
    "risk_level": "<low|moderate|bold>"
  }
}

Generate 3 scripts and 3 concepts. Keep each script body under 150 words total.`;

  try {
    const response = await aiChat({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.7,
      accountId: "default",
      endpoint: "script-engine",
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    const cleaned = content.replace(/```json?\s*/g, "").replace(/```/g, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("[SSE+OCE] Failed to parse GPT response as JSON");
      return { status: "GENERATION_FAILED", reason: "Invalid JSON response from GPT" };
    }

    const scriptsCheck = validateScriptsBatch(parsed);
    if (!scriptsCheck.valid) {
      console.error("[SSE+OCE] Schema validation failed:", scriptsCheck.reason);
      return { status: "GENERATION_FAILED", reason: `Schema validation: ${scriptsCheck.reason}` };
    }

    const conceptsCheck = validateCreativeConcepts(parsed);
    if (!conceptsCheck.valid) {
      console.error("[SSE+OCE] Schema validation failed:", conceptsCheck.reason);
      return { status: "GENERATION_FAILED", reason: `Schema validation: ${conceptsCheck.reason}` };
    }

    const scripts = parsed.scripts_batch.scripts.slice(0, 5).map((s: any) => ({
      title: s.title || "",
      hook_0_2s: s.hook_0_2s || "",
      setup_2_6s: s.setup_2_6s || "",
      tension_6_12s: s.tension_6_12s || "",
      reveal_12_18s: s.reveal_12_18s || "",
      proof_line_optional: s.proof_line_optional || "",
      soft_close_or_cta: s.soft_close_or_cta || "",
      on_screen_text: s.on_screen_text || "",
      shot_suggestions: Array.isArray(s.shot_suggestions) ? s.shot_suggestions : [],
      caption_short: s.caption_short || "",
      kpi_target: ["engagement", "leads", "authority"].includes(s.kpi_target) ? s.kpi_target : "engagement",
    }));

    const ctaCheck = validateCtaCompliance(scripts, mode);
    if (!ctaCheck.valid) {
      console.error("[SSE+OCE] CTA compliance violated:", ctaCheck.reason);
      return { status: "GENERATION_FAILED", reason: `CTA compliance: ${ctaCheck.reason}` };
    }

    const concepts = parsed.creative_concepts.concepts.slice(0, 5).map((c: any) => ({
      concept_name: c.concept_name || "",
      disruptive_angle: c.disruptive_angle || "",
      format: ["reel", "carousel", "hybrid"].includes(c.format) ? c.format : "reel",
      visual_metaphor: c.visual_metaphor || "",
      emotional_trigger: c.emotional_trigger || "",
      differentiation_factor: c.differentiation_factor || "",
      execution_note: c.execution_note || "",
    }));

    const result: SSEOCEOutput = {
      scripts_batch: {
        mode_used: mode,
        scripts,
      },
      creative_concepts: {
        strategic_mode: parsed.creative_concepts.strategic_mode || "hybrid",
        concepts,
        subtle_conversion_layer: parsed.creative_concepts.subtle_conversion_layer || "",
        risk_level: ["low", "moderate", "bold"].includes(parsed.creative_concepts.risk_level)
          ? parsed.creative_concepts.risk_level
          : "moderate",
      },
    };

    console.log(`[SSE+OCE] Generated ${scripts.length} scripts (mode: ${mode}) + ${concepts.length} concepts | 1 GPT call`);
    return result;
  } catch (err: any) {
    console.error("[SSE+OCE] GPT call failed:", err.message);
    return { status: "GENERATION_FAILED", reason: err.message || "GPT call failed" };
  }
}
