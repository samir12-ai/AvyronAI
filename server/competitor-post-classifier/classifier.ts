/**
 * Competitor Post Classifier — core classification service.
 *
 * Entry point: classifyCompetitorPost(post, accountId)
 *
 * This is a pure classification service. It does NOT write to the database.
 * Persistence is the responsibility of the caller (or use the batch runner).
 *
 * Reuses:
 *   - aiChat wrapper (budget management, timeout, retry telemetry, replay mock)
 *   - gpt-4.1-mini (same model as AEL, performance interpretation, studio analysis)
 *   - Structured JSON output with strict schema validation
 *
 * Does NOT:
 *   - Generate captions or suggest rewrites
 *   - Import from any pipeline, performance-loop, or market-intelligence module
 *   - Couple itself to any specific consumer
 */

import { aiChat } from "../ai-client";
import {
  CLASSIFIER_VERSION,
  HOOK_ARCHETYPES,
  NARRATIVE_FRAMEWORKS,
  CTA_TYPES,
  OFFER_TYPES,
  EMOTIONAL_TRIGGERS,
  AWARENESS_STAGES,
  POSITIONING_STYLES,
  CONTENT_FORMAT_INTENTS,
  PRIMARY_GOALS,
  CORE_MARKETING_PROMISES,
  type CompetitorPostInput,
  type CompetitorPostClassification,
  type HookArchetype,
  type NarrativeFramework,
  type CtaType,
  type OfferType,
  type EmotionalTrigger,
  type AwarenessStage,
  type PositioningStyle,
  type ContentFormatIntent,
  type PrimaryGoal,
  type CoreMarketingPromise,
} from "./types";

const LOG = "[CompetitorPostClassifier]";

// ---------------------------------------------------------------------------
// Prompt — classification only, no generation.
// The model is explicitly prohibited from inventing content.
// UNKNOWN is always valid; hallucination is explicitly forbidden.
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a marketing content classifier. You receive a single social media post from a competitor. Your ONLY job is to CLASSIFY it using the exact enum values provided. You must NEVER:
- Rewrite the post
- Suggest a caption
- Generate any new content
- Hallucinate dimensions you cannot infer

If a dimension cannot be confidently inferred from the available text, return UNKNOWN.

Return ONLY valid JSON matching this exact schema. No commentary, no explanation, no markdown:
{
  "primaryHook": "verbatim or minimally paraphrased opening hook text, max 10 words, or null if no hook",
  "hookArchetype": one of ${JSON.stringify(HOOK_ARCHETYPES)},
  "primaryAngle": "3–8 word description of the strategic messaging angle, or null if undetectable",
  "narrative": one of ${JSON.stringify(NARRATIVE_FRAMEWORKS)},
  "ctaType": one of ${JSON.stringify(CTA_TYPES)},
  "offerType": one of ${JSON.stringify(OFFER_TYPES)},
  "emotionalTrigger": one of ${JSON.stringify(EMOTIONAL_TRIGGERS)},
  "awarenessStage": one of ${JSON.stringify(AWARENESS_STAGES)},
  "positioningStyle": one of ${JSON.stringify(POSITIONING_STYLES)},
  "contentFormatIntent": one of ${JSON.stringify(CONTENT_FORMAT_INTENTS)},
  "primaryGoal": one of ${JSON.stringify(PRIMARY_GOALS)},
  "coreMarketingPromise": one of ${JSON.stringify(CORE_MARKETING_PROMISES)},

IMPORTANT — narrative field: this describes the STORYTELLING STRUCTURE of the post (how the content is framed), NOT the product lifecycle stage or awareness level. "PRODUCT_AWARE", "PRODUCT_LAUNCH", "PRODUCT_DEMO", "SOLUTION_AWARE" are NOT valid values and must never be used. If the narrative structure is ambiguous, return UNKNOWN. The awarenessStage field (not narrative) captures where the audience is in the buyer journey.
  "confidenceScore": a number between 0.0 and 1.0 representing your overall classification confidence
}

coreMarketingPromise captures WHAT the post is fundamentally promising to the customer — the underlying value proposition (e.g. "Save Time", "Better Quality", "Family Experience"). It is NOT the hook, angle wording, emotional trigger, or CTA. Ask: "What is the customer actually being promised?" Return UNKNOWN only when no clear promise exists.`;
}

function buildUserContent(post: CompetitorPostInput): string {
  const lines: string[] = ["Classify this competitor post:"];

  if (post.hookText) {
    lines.push(`Hook Text: ${post.hookText}`);
  }

  if (post.caption) {
    // Cap caption length to keep tokens predictable.
    const cap = post.caption.length > 1200 ? post.caption.slice(0, 1200) + "…" : post.caption;
    lines.push(`Caption: ${cap}`);
  }

  if (post.hashtags) {
    const hashtagPreview = post.hashtags.length > 300
      ? post.hashtags.slice(0, 300) + "…"
      : post.hashtags;
    lines.push(`Hashtags: ${hashtagPreview}`);
  }

  if (post.mediaType) {
    lines.push(`Media Type: ${post.mediaType}`);
  }

  // Provide engagement signal for confidence calibration (not for hallucination).
  const engagementParts: string[] = [];
  if (post.likes !== null) engagementParts.push(`likes=${post.likes}`);
  if (post.comments !== null) engagementParts.push(`comments=${post.comments}`);
  if (post.views !== null) engagementParts.push(`views=${post.views}`);
  if (engagementParts.length > 0) {
    lines.push(`Engagement: ${engagementParts.join(", ")}`);
  }

  if (!post.caption && !post.hookText) {
    lines.push("(No caption or hook text available — classify with UNKNOWN for text-dependent dimensions)");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Schema validation — strict enum membership check + confidence bounds.
// Returns null on valid, or an array of error strings on invalid.
// ---------------------------------------------------------------------------

function validateClassificationShape(raw: unknown): string[] | null {
  if (!raw || typeof raw !== "object") return ["not an object"];
  const r = raw as Record<string, unknown>;

  const errors: string[] = [];

  const checkEnum = <T extends string>(field: string, allowed: readonly T[]) => {
    if (!allowed.includes(r[field] as T)) {
      errors.push(`${field}: "${r[field]}" not in allowed set`);
    }
  };

  checkEnum("hookArchetype", HOOK_ARCHETYPES);
  checkEnum("narrative", NARRATIVE_FRAMEWORKS);
  checkEnum("ctaType", CTA_TYPES);
  checkEnum("offerType", OFFER_TYPES);
  checkEnum("emotionalTrigger", EMOTIONAL_TRIGGERS);
  checkEnum("awarenessStage", AWARENESS_STAGES);
  checkEnum("positioningStyle", POSITIONING_STYLES);
  checkEnum("contentFormatIntent", CONTENT_FORMAT_INTENTS);
  checkEnum("primaryGoal", PRIMARY_GOALS);
  checkEnum("coreMarketingPromise", CORE_MARKETING_PROMISES);

  const conf = r["confidenceScore"];
  if (typeof conf !== "number" || conf < 0 || conf > 1) {
    errors.push(`confidenceScore: "${conf}" must be a number 0.0–1.0`);
  }

  // primaryHook and primaryAngle are nullable strings — just type-check.
  if (r["primaryHook"] !== null && typeof r["primaryHook"] !== "string") {
    errors.push(`primaryHook must be a string or null`);
  }
  if (r["primaryAngle"] !== null && typeof r["primaryAngle"] !== "string") {
    errors.push(`primaryAngle must be a string or null`);
  }

  return errors.length > 0 ? errors : null;
}

// ---------------------------------------------------------------------------
// Main export — classifyCompetitorPost
//
// Retry policy: 2 attempts max. On a schema validation failure the second
// attempt includes the validation errors so the model can self-correct.
// On a second failure, throws — the caller / batch runner handles persistence
// of a FAILED classification state.
// ---------------------------------------------------------------------------

export async function classifyCompetitorPost(
  post: CompetitorPostInput,
  accountId: string,
): Promise<CompetitorPostClassification> {
  const tag = `post=${post.id} competitor=${post.competitorId}`;
  let lastRaw: string = "";
  let lastErrors: string[] = [];

  // Map field name → its allowed enum for richer self-correction messages.
  const FIELD_ALLOWED: Record<string, readonly string[]> = {
    hookArchetype: HOOK_ARCHETYPES,
    narrative: NARRATIVE_FRAMEWORKS,
    ctaType: CTA_TYPES,
    offerType: OFFER_TYPES,
    emotionalTrigger: EMOTIONAL_TRIGGERS,
    awarenessStage: AWARENESS_STAGES,
    positioningStyle: POSITIONING_STYLES,
    contentFormatIntent: CONTENT_FORMAT_INTENTS,
    primaryGoal: PRIMARY_GOALS,
    coreMarketingPromise: CORE_MARKETING_PROMISES,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    let userContent: string;
    if (attempt === 2 && lastErrors.length > 0) {
      // Build a correction block that re-states the exact allowed values for
      // every field that failed, so the model cannot re-invent another wrong
      // value on the second try.
      const corrections = lastErrors.map((err) => {
        const fieldMatch = err.match(/^(\w+):/);
        const field = fieldMatch ? fieldMatch[1] : null;
        const allowed = field ? FIELD_ALLOWED[field] : null;
        return allowed
          ? `  ${err}. Allowed values for ${field}: ${JSON.stringify(allowed)}`
          : `  ${err}`;
      });
      userContent = `${buildUserContent(post)}\n\n[SELF-CORRECTION] Your previous response had schema errors. Correct ONLY the listed fields and return the full valid JSON:\n${corrections.join("\n")}`;
    } else {
      userContent = buildUserContent(post);
    }

    const response = await aiChat({
      model: "gpt-4.1-mini",
      max_tokens: 600,
      accountId,
      endpoint: "competitor-post-classifier",
      temperature: 0,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: userContent },
      ],
    });

    lastRaw = response.choices?.[0]?.message?.content ?? "";

    let parsed: unknown;
    try {
      const jsonMatch = lastRaw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in response");
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr: any) {
      lastErrors = [`JSON parse failed: ${parseErr.message}`, `Raw: ${lastRaw.slice(0, 200)}`];
      console.warn(`${LOG} PARSE_ERROR attempt=${attempt} ${tag}`, lastErrors);
      if (attempt === 2) {
        throw new Error(`${LOG} classifyCompetitorPost failed after ${attempt} attempts — parse error. ${tag}`);
      }
      continue;
    }

    const schemaErrors = validateClassificationShape(parsed);
    if (schemaErrors) {
      lastErrors = schemaErrors;
      console.warn(`${LOG} SCHEMA_ERROR attempt=${attempt} ${tag}`, schemaErrors);
      if (attempt === 2) {
        throw new Error(`${LOG} classifyCompetitorPost failed after ${attempt} attempts — schema errors: ${schemaErrors.join(", ")}. ${tag}`);
      }
      continue;
    }

    // Valid — assemble and return.
    const r = parsed as Record<string, unknown>;
    const result: CompetitorPostClassification = {
      postId: post.id,
      competitorId: post.competitorId,
      primaryHook: (r["primaryHook"] as string | null) ?? null,
      hookArchetype: r["hookArchetype"] as HookArchetype,
      primaryAngle: (r["primaryAngle"] as string | null) ?? null,
      narrative: r["narrative"] as NarrativeFramework,
      ctaType: r["ctaType"] as CtaType,
      offerType: r["offerType"] as OfferType,
      emotionalTrigger: r["emotionalTrigger"] as EmotionalTrigger,
      awarenessStage: r["awarenessStage"] as AwarenessStage,
      positioningStyle: r["positioningStyle"] as PositioningStyle,
      contentFormatIntent: r["contentFormatIntent"] as ContentFormatIntent,
      primaryGoal: r["primaryGoal"] as PrimaryGoal,
      coreMarketingPromise: r["coreMarketingPromise"] as CoreMarketingPromise,
      confidenceScore: r["confidenceScore"] as number,
      classifierVersion: CLASSIFIER_VERSION,
    };

    console.log(`${LOG} CLASSIFIED ${tag} attempt=${attempt} confidence=${result.confidenceScore}`);
    return result;
  }

  // TypeScript flow — unreachable, but keeps the return type sound.
  throw new Error(`${LOG} Unexpected exit from retry loop. ${tag}`);
}
