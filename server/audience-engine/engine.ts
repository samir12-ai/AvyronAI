import { db } from "../db";
import { audienceSnapshots, miSnapshots, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, growthCampaigns } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  AUDIENCE_ENGINE_VERSION,
  AUDIENCE_THRESHOLDS,
  SOPHISTICATION_KEYWORDS,
  INTENT_KEYWORDS,
  PAIN_KEYWORDS,
} from "./constants";
import { aiChat } from "../ai-client";

interface PainCluster {
  category: string;
  frequency: number;
  evidence: string[];
  severity: "high" | "medium" | "low";
}

interface SophisticationResult {
  level: "beginner" | "informed" | "sophisticated";
  confidence: number;
  signals: { beginner: number; informed: number; sophisticated: number };
  evidenceSamples: string[];
}

interface IntentDistribution {
  problemSeeking: number;
  curiosity: number;
  purchaseIntent: number;
  validation: number;
  totalClassified: number;
}

interface AudiencePersona {
  name: string;
  demographicHints: string;
  motivation: string;
  primaryPain: string;
  barriers: string[];
  desiredTransformation: string;
  estimatedPercentage: number;
}

interface AdsTargetingHint {
  suggestedInterests: string[];
  suggestedBehaviors: string[];
  suggestedAgeRange: { min: number; max: number };
  suggestedGender: string;
  suggestedLocations: string[];
  rationale: string;
}

export interface AudienceEngineResult {
  audiencePains: PainCluster[];
  audienceSophisticationLevel: SophisticationResult;
  audienceIntentDistribution: IntentDistribution;
  audiencePersonas: AudiencePersona[];
  adsTargetingHints: AdsTargetingHint[];
  inputSummary: {
    postsAnalyzed: number;
    commentsAnalyzed: number;
    competitorsAnalyzed: number;
    miSnapshotId: string | null;
    miSnapshotAge: string | null;
  };
  engineVersion: number;
  executionTimeMs: number;
  snapshotId: string;
}

function extractPains(comments: string[], captions: string[]): PainCluster[] {
  const painCounts: Record<string, { count: number; evidence: string[] }> = {};

  const allText = [...comments, ...captions];

  for (const [category, keywords] of Object.entries(PAIN_KEYWORDS)) {
    painCounts[category] = { count: 0, evidence: [] };
    for (const text of allText) {
      const lower = text.toLowerCase();
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          painCounts[category].count++;
          if (painCounts[category].evidence.length < 3) {
            painCounts[category].evidence.push(text.slice(0, 120));
          }
          break;
        }
      }
    }
  }

  return Object.entries(painCounts)
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([category, data]) => ({
      category: category.replace(/_/g, " ").toLowerCase(),
      frequency: data.count,
      evidence: data.evidence,
      severity: data.count >= 10 ? "high" as const : data.count >= 4 ? "medium" as const : "low" as const,
    }));
}

function detectSophistication(comments: string[], captions: string[]): SophisticationResult {
  const allText = [...comments, ...captions];
  const signals = { beginner: 0, informed: 0, sophisticated: 0 };
  const evidence: string[] = [];

  for (const text of allText) {
    const lower = text.toLowerCase();

    for (const kw of SOPHISTICATION_KEYWORDS.BEGINNER) {
      if (lower.includes(kw)) { signals.beginner++; break; }
    }
    for (const kw of SOPHISTICATION_KEYWORDS.INFORMED) {
      if (lower.includes(kw)) { signals.informed++; break; }
    }
    for (const kw of SOPHISTICATION_KEYWORDS.SOPHISTICATED) {
      if (lower.includes(kw)) {
        signals.sophisticated++;
        if (evidence.length < 3) evidence.push(text.slice(0, 120));
        break;
      }
    }
  }

  const total = signals.beginner + signals.informed + signals.sophisticated;
  if (total === 0) {
    return { level: "beginner", confidence: 0.3, signals, evidenceSamples: [] };
  }

  const ratios = {
    beginner: signals.beginner / total,
    informed: signals.informed / total,
    sophisticated: signals.sophisticated / total,
  };

  let level: "beginner" | "informed" | "sophisticated";
  let confidence: number;

  if (ratios.sophisticated > 0.3) {
    level = "sophisticated";
    confidence = Math.min(0.95, 0.5 + ratios.sophisticated);
  } else if (ratios.informed > 0.3) {
    level = "informed";
    confidence = Math.min(0.95, 0.5 + ratios.informed);
  } else {
    level = "beginner";
    confidence = Math.min(0.95, 0.5 + ratios.beginner);
  }

  return { level, confidence, signals, evidenceSamples: evidence };
}

function classifyIntents(comments: string[]): IntentDistribution {
  let problemSeeking = 0;
  let curiosity = 0;
  let purchaseIntent = 0;
  let validation = 0;
  let totalClassified = 0;

  for (const text of comments) {
    const lower = text.toLowerCase();
    let classified = false;

    for (const kw of INTENT_KEYWORDS.PURCHASE_INTENT) {
      if (lower.includes(kw)) { purchaseIntent++; classified = true; break; }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.PROBLEM_SEEKING) {
        if (lower.includes(kw)) { problemSeeking++; classified = true; break; }
      }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.CURIOSITY) {
        if (lower.includes(kw)) { curiosity++; classified = true; break; }
      }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.VALIDATION) {
        if (lower.includes(kw)) { validation++; classified = true; break; }
      }
    }
    if (classified) totalClassified++;
  }

  if (totalClassified === 0) {
    return { problemSeeking: 25, curiosity: 25, purchaseIntent: 25, validation: 25, totalClassified: 0 };
  }

  return {
    problemSeeking: Math.round((problemSeeking / totalClassified) * 100),
    curiosity: Math.round((curiosity / totalClassified) * 100),
    purchaseIntent: Math.round((purchaseIntent / totalClassified) * 100),
    validation: Math.round((validation / totalClassified) * 100),
    totalClassified,
  };
}

async function constructPersonas(
  pains: PainCluster[],
  sophistication: SophisticationResult,
  intents: IntentDistribution,
  businessContext: { industry: string; coreOffer: string; targetAudience: string },
  commentSamples: string[],
  accountId: string = "default",
): Promise<AudiencePersona[]> {
  try {
    const prompt = `You are an audience research analyst. Based on the following market evidence, construct 2-3 structured audience personas.

BUSINESS CONTEXT:
- Industry: ${businessContext.industry}
- Core Offer: ${businessContext.coreOffer}
- Target Audience: ${businessContext.targetAudience}

AUDIENCE PAIN CLUSTERS (from comments/captions):
${pains.map(p => `- ${p.category}: frequency=${p.frequency}, severity=${p.severity}`).join("\n")}

AUDIENCE SOPHISTICATION: ${sophistication.level} (confidence: ${(sophistication.confidence * 100).toFixed(0)}%)

INTENT DISTRIBUTION:
- Problem seeking: ${intents.problemSeeking}%
- Curiosity/learning: ${intents.curiosity}%
- Purchase intent: ${intents.purchaseIntent}%
- Validation/social proof: ${intents.validation}%

SAMPLE COMMENTS (real audience language):
${commentSamples.slice(0, 15).map(c => `"${c.slice(0, 100)}"`).join("\n")}

Return a JSON array of 2-3 personas. Each persona:
{
  "name": "descriptive persona name",
  "demographicHints": "age/gender/location hints from evidence",
  "motivation": "what drives them",
  "primaryPain": "their main struggle",
  "barriers": ["barrier1", "barrier2"],
  "desiredTransformation": "what they want to become/achieve",
  "estimatedPercentage": number (must total ~100)
}

Return ONLY the JSON array, no markdown.`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1500,
      endpoint: "audience-engine-personas",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error("[AudienceEngine] Persona construction failed:", err.message);
    return [{
      name: "Primary Audience",
      demographicHints: "Unable to determine — insufficient AI response",
      motivation: "Seeking solutions in " + businessContext.industry,
      primaryPain: pains[0]?.category || "general challenges",
      barriers: ["information overload", "trust concerns"],
      desiredTransformation: "Achieve results with " + businessContext.coreOffer,
      estimatedPercentage: 100,
    }];
  }
}

async function translateToAdsTargeting(
  personas: AudiencePersona[],
  sophistication: SophisticationResult,
  businessContext: { industry: string; coreOffer: string; targetAudience: string; location: string },
  accountId: string = "default",
): Promise<AdsTargetingHint[]> {
  try {
    const prompt = `You are a Meta Ads targeting expert. Translate these audience personas into Meta Ads Manager compatible targeting suggestions.

BUSINESS: ${businessContext.industry} — ${businessContext.coreOffer}
LOCATION: ${businessContext.location || "Not specified"}
AUDIENCE SOPHISTICATION: ${sophistication.level}

PERSONAS:
${personas.map(p => `- ${p.name}: ${p.motivation}. Pain: ${p.primaryPain}. Transform: ${p.desiredTransformation}`).join("\n")}

For each persona, return a targeting suggestion:
{
  "suggestedInterests": ["real Meta interest categories"],
  "suggestedBehaviors": ["real Meta behavior targeting options"],
  "suggestedAgeRange": { "min": number, "max": number },
  "suggestedGender": "all" | "male" | "female",
  "suggestedLocations": ["country/region suggestions"],
  "rationale": "brief explanation"
}

Return ONLY a JSON array matching the personas count. Use real Meta Ads targeting options.`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      endpoint: "audience-engine-ads-targeting",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error("[AudienceEngine] Ads targeting translation failed:", err.message);
    return [{
      suggestedInterests: [businessContext.industry],
      suggestedBehaviors: ["Engaged shoppers"],
      suggestedAgeRange: { min: 18, max: 55 },
      suggestedGender: "all",
      suggestedLocations: [businessContext.location || "United States"],
      rationale: "Fallback targeting based on business context",
    }];
  }
}

export async function runAudienceEngine(accountId: string, campaignId: string): Promise<AudienceEngineResult> {
  const startTime = Date.now();
  console.log(`[AudienceEngine] Starting analysis for account=${accountId} campaign=${campaignId}`);

  const [latestSnapshot] = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, accountId),
      eq(miSnapshots.campaignId, campaignId),
      eq(miSnapshots.status, "COMPLETE"),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const miSnapshotId = latestSnapshot?.id || null;
  const miSnapshotAge = latestSnapshot?.createdAt
    ? `${Math.round((Date.now() - new Date(latestSnapshot.createdAt).getTime()) / 3600000)}h ago`
    : null;

  const competitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true),
    ));

  const competitorIds = competitors.map(c => c.id);

  let posts: { caption: string | null }[] = [];
  let comments: { commentText: string | null }[] = [];

  if (competitorIds.length > 0) {
    posts = await db.select({ caption: ciCompetitorPosts.caption })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(ciCompetitorPosts.scrapedAt))
      .limit(AUDIENCE_THRESHOLDS.MAX_POSTS_TO_ANALYZE);

    comments = await db.select({ commentText: ciCompetitorComments.commentText })
      .from(ciCompetitorComments)
      .where(sql`${ciCompetitorComments.competitorId} IN (${sql.join(competitorIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(desc(ciCompetitorComments.scrapedAt))
      .limit(AUDIENCE_THRESHOLDS.MAX_COMMENTS_TO_ANALYZE);
  }

  const captions = posts.map(p => p.caption).filter((c): c is string => !!c && c.length > 5);
  const commentTexts = comments.map(c => c.commentText).filter((c): c is string => !!c && c.length > 3);

  console.log(`[AudienceEngine] Data: ${competitorIds.length} competitors, ${captions.length} captions, ${commentTexts.length} comments`);

  const [campaign] = await db.select().from(growthCampaigns)
    .where(and(eq(growthCampaigns.id, campaignId), eq(growthCampaigns.accountId, accountId)))
    .limit(1);

  const businessContext = {
    industry: campaign?.name || "General",
    coreOffer: campaign?.name || "Products/Services",
    targetAudience: "Market audience",
    location: "",
  };

  const audiencePains = extractPains(commentTexts, captions);
  const audienceSophisticationLevel = detectSophistication(commentTexts, captions);
  const audienceIntentDistribution = classifyIntents(commentTexts);

  const audiencePersonas = await constructPersonas(
    audiencePains,
    audienceSophisticationLevel,
    audienceIntentDistribution,
    businessContext,
    commentTexts,
    accountId,
  );

  const adsTargetingHints = await translateToAdsTargeting(
    audiencePersonas,
    audienceSophisticationLevel,
    businessContext,
    accountId,
  );

  const executionTimeMs = Date.now() - startTime;

  const inputSummary = {
    postsAnalyzed: captions.length,
    commentsAnalyzed: commentTexts.length,
    competitorsAnalyzed: competitorIds.length,
    miSnapshotId,
    miSnapshotAge,
  };

  const [inserted] = await db.insert(audienceSnapshots).values({
    accountId,
    campaignId,
    miSnapshotId,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    audiencePains: JSON.stringify(audiencePains),
    audienceSophisticationLevel: JSON.stringify(audienceSophisticationLevel),
    audienceIntentDistribution: JSON.stringify(audienceIntentDistribution),
    audiencePersonas: JSON.stringify(audiencePersonas),
    adsTargetingHints: JSON.stringify(adsTargetingHints),
    inputSummary: JSON.stringify(inputSummary),
    executionTimeMs,
  }).returning({ id: audienceSnapshots.id });

  console.log(`[AudienceEngine] Complete in ${executionTimeMs}ms | snapshot=${inserted.id} | pains=${audiencePains.length} | personas=${audiencePersonas.length}`);

  return {
    audiencePains,
    audienceSophisticationLevel,
    audienceIntentDistribution,
    audiencePersonas,
    adsTargetingHints,
    inputSummary,
    engineVersion: AUDIENCE_ENGINE_VERSION,
    executionTimeMs,
    snapshotId: inserted.id,
  };
}

export async function getLatestAudienceSnapshot(accountId: string, campaignId: string) {
  const [snapshot] = await db.select().from(audienceSnapshots)
    .where(and(
      eq(audienceSnapshots.accountId, accountId),
      eq(audienceSnapshots.campaignId, campaignId),
    ))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (!snapshot) return null;

  return {
    ...snapshot,
    audiencePains: JSON.parse(snapshot.audiencePains || "[]"),
    audienceSophisticationLevel: JSON.parse(snapshot.audienceSophisticationLevel || "{}"),
    audienceIntentDistribution: JSON.parse(snapshot.audienceIntentDistribution || "{}"),
    audiencePersonas: JSON.parse(snapshot.audiencePersonas || "[]"),
    adsTargetingHints: JSON.parse(snapshot.adsTargetingHints || "[]"),
    inputSummary: JSON.parse(snapshot.inputSummary || "{}"),
  };
}
