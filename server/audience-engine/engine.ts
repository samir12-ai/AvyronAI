import { db } from "../db";
import { audienceSnapshots, miSnapshots, ciCompetitors, ciCompetitorPosts, ciCompetitorComments, growthCampaigns } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  AUDIENCE_ENGINE_VERSION,
  AUDIENCE_THRESHOLDS,
  PAIN_CLUSTERS,
  DESIRE_CLUSTERS,
  OBJECTION_CLUSTERS,
  TRANSFORMATION_PATTERNS,
  EMOTIONAL_DRIVER_PATTERNS,
  AWARENESS_PATTERNS,
  MATURITY_KEYWORDS,
  INTENT_KEYWORDS,
  LANGUAGE_PATTERNS,
  type PatternCluster,
} from "./constants";
import { aiChat } from "../ai-client";

interface EvidenceMeta {
  evidenceCount: number;
  confidenceScore: number;
  sourceSignals: string[];
  inputSnapshotId: string | null;
}

interface SignalItem extends EvidenceMeta {
  canonical: string;
  frequency: number;
  evidence: string[];
}

interface LanguageSignals extends EvidenceMeta {
  problemExpressions: { count: number; samples: string[] };
  questionPatterns: { count: number; samples: string[] };
  goalExpressions: { count: number; samples: string[] };
  totalAnalyzed: number;
}

interface AwarenessResult extends EvidenceMeta {
  level: "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware";
  distribution: Record<string, number>;
}

interface MaturityResult extends EvidenceMeta {
  level: "beginner" | "developing" | "mature";
  distribution: Record<string, number>;
  indicators: string[];
}

interface IntentDistribution extends EvidenceMeta {
  curiosity: number;
  learning: number;
  comparison: number;
  purchaseIntent: number;
  totalClassified: number;
}

interface AudienceSegment extends EvidenceMeta {
  name: string;
  description: string;
  painProfile: string[];
  desireProfile: string[];
  objectionProfile: string[];
  motivationProfile: string[];
  estimatedPercentage: number;
}

interface SegmentDensityItem extends EvidenceMeta {
  segment: string;
  densityScore: number;
  signalCount: number;
}

interface AdsTargetingHint extends EvidenceMeta {
  suggestedInterests: string[];
  suggestedBehaviors: string[];
  suggestedAgeRange: { min: number; max: number };
  suggestedGender: string;
  suggestedLocations: string[];
  rationale: string;
}

function matchPatternClusters(
  texts: string[],
  clusters: PatternCluster[],
  inputSnapshotId: string | null,
): SignalItem[] {
  const results: Map<string, { count: number; evidence: string[]; matchedPatterns: Set<string> }> = new Map();

  for (const cluster of clusters) {
    results.set(cluster.canonical, { count: 0, evidence: [], matchedPatterns: new Set() });
  }

  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const cluster of clusters) {
      for (const pattern of cluster.patterns) {
        if (lower.includes(pattern)) {
          const entry = results.get(cluster.canonical)!;
          entry.count++;
          entry.matchedPatterns.add(pattern);
          if (entry.evidence.length < 3) {
            entry.evidence.push(text.slice(0, 150));
          }
          break;
        }
      }
    }
  }

  return Array.from(results.entries())
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([canonical, data]) => ({
      canonical,
      frequency: data.count,
      evidence: data.evidence,
      evidenceCount: data.count,
      confidenceScore: Math.min(0.95, 0.3 + (data.count / Math.max(texts.length, 1)) * 2),
      sourceSignals: Array.from(data.matchedPatterns),
      inputSnapshotId,
    }));
}

function analyzeLanguage(
  comments: string[],
  captions: string[],
  inputSnapshotId: string | null,
): LanguageSignals {
  const allText = [...comments, ...captions];
  const result: LanguageSignals = {
    problemExpressions: { count: 0, samples: [] },
    questionPatterns: { count: 0, samples: [] },
    goalExpressions: { count: 0, samples: [] },
    totalAnalyzed: allText.length,
    evidenceCount: 0,
    confidenceScore: 0,
    sourceSignals: [],
    inputSnapshotId,
  };

  for (const text of allText) {
    const lower = text.toLowerCase();

    for (const pattern of LANGUAGE_PATTERNS.PROBLEM_EXPRESSIONS) {
      if (lower.includes(pattern)) {
        result.problemExpressions.count++;
        if (result.problemExpressions.samples.length < 3) {
          result.problemExpressions.samples.push(text.slice(0, 120));
        }
        break;
      }
    }

    for (const pattern of LANGUAGE_PATTERNS.QUESTION_PATTERNS) {
      if (lower.includes(pattern)) {
        result.questionPatterns.count++;
        if (result.questionPatterns.samples.length < 3) {
          result.questionPatterns.samples.push(text.slice(0, 120));
        }
        break;
      }
    }

    for (const pattern of LANGUAGE_PATTERNS.GOAL_EXPRESSIONS) {
      if (lower.includes(pattern)) {
        result.goalExpressions.count++;
        if (result.goalExpressions.samples.length < 3) {
          result.goalExpressions.samples.push(text.slice(0, 120));
        }
        break;
      }
    }
  }

  const total = result.problemExpressions.count + result.questionPatterns.count + result.goalExpressions.count;
  result.evidenceCount = total;
  result.confidenceScore = Math.min(0.95, total > 0 ? 0.4 + (total / Math.max(allText.length, 1)) : 0.2);
  result.sourceSignals = ["comments", "captions"];

  return result;
}

function detectAwareness(
  comments: string[],
  inputSnapshotId: string | null,
): AwarenessResult {
  const distribution: Record<string, number> = {
    unaware: 0,
    problem_aware: 0,
    solution_aware: 0,
    product_aware: 0,
    most_aware: 0,
  };

  const levelKeys: [string, readonly string[]][] = [
    ["most_aware", AWARENESS_PATTERNS.MOST_AWARE],
    ["product_aware", AWARENESS_PATTERNS.PRODUCT_AWARE],
    ["solution_aware", AWARENESS_PATTERNS.SOLUTION_AWARE],
    ["problem_aware", AWARENESS_PATTERNS.PROBLEM_AWARE],
    ["unaware", AWARENESS_PATTERNS.UNAWARE],
  ];

  let totalMatched = 0;

  for (const text of comments) {
    const lower = text.toLowerCase();
    let matched = false;
    for (const [level, patterns] of levelKeys) {
      for (const p of patterns) {
        if (lower.includes(p)) {
          distribution[level]++;
          totalMatched++;
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
  }

  let dominantLevel = "problem_aware";
  let maxCount = 0;
  for (const [level, count] of Object.entries(distribution)) {
    if (count > maxCount) {
      maxCount = count;
      dominantLevel = level;
    }
  }

  const pct: Record<string, number> = {};
  for (const [level, count] of Object.entries(distribution)) {
    pct[level] = totalMatched > 0 ? Math.round((count / totalMatched) * 100) : 20;
  }

  return {
    level: dominantLevel as AwarenessResult["level"],
    distribution: pct,
    evidenceCount: totalMatched,
    confidenceScore: totalMatched > 5 ? Math.min(0.9, 0.4 + (totalMatched / Math.max(comments.length, 1))) : 0.3,
    sourceSignals: ["comments"],
    inputSnapshotId,
  };
}

function detectMaturity(
  comments: string[],
  captions: string[],
  inputSnapshotId: string | null,
): MaturityResult {
  const allText = [...comments, ...captions];
  const signals = { beginner: 0, developing: 0, mature: 0 };
  const indicators: string[] = [];

  for (const text of allText) {
    const lower = text.toLowerCase();

    for (const kw of MATURITY_KEYWORDS.MATURE) {
      if (lower.includes(kw)) {
        signals.mature++;
        if (indicators.length < 5) indicators.push(kw);
        break;
      }
    }
    for (const kw of MATURITY_KEYWORDS.DEVELOPING) {
      if (lower.includes(kw)) { signals.developing++; break; }
    }
    for (const kw of MATURITY_KEYWORDS.BEGINNER) {
      if (lower.includes(kw)) { signals.beginner++; break; }
    }
  }

  const total = signals.beginner + signals.developing + signals.mature;
  const dist: Record<string, number> = {
    beginner: total > 0 ? Math.round((signals.beginner / total) * 100) : 34,
    developing: total > 0 ? Math.round((signals.developing / total) * 100) : 33,
    mature: total > 0 ? Math.round((signals.mature / total) * 100) : 33,
  };

  let level: "beginner" | "developing" | "mature" = "beginner";
  if (signals.mature > signals.developing && signals.mature > signals.beginner) level = "mature";
  else if (signals.developing > signals.beginner) level = "developing";

  return {
    level,
    distribution: dist,
    indicators,
    evidenceCount: total,
    confidenceScore: total > 5 ? Math.min(0.95, 0.4 + (total / Math.max(allText.length, 1))) : 0.3,
    sourceSignals: ["comments", "captions"],
    inputSnapshotId,
  };
}

function classifyIntents(
  comments: string[],
  inputSnapshotId: string | null,
): IntentDistribution {
  let curiosity = 0;
  let learning = 0;
  let comparison = 0;
  let purchaseIntent = 0;
  let totalClassified = 0;

  for (const text of comments) {
    const lower = text.toLowerCase();
    let classified = false;

    for (const kw of INTENT_KEYWORDS.PURCHASE_INTENT) {
      if (lower.includes(kw)) { purchaseIntent++; classified = true; break; }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.COMPARISON) {
        if (lower.includes(kw)) { comparison++; classified = true; break; }
      }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.LEARNING) {
        if (lower.includes(kw)) { learning++; classified = true; break; }
      }
    }
    if (!classified) {
      for (const kw of INTENT_KEYWORDS.CURIOSITY) {
        if (lower.includes(kw)) { curiosity++; classified = true; break; }
      }
    }
    if (classified) totalClassified++;
  }

  if (totalClassified === 0) {
    return {
      curiosity: 25, learning: 25, comparison: 25, purchaseIntent: 25,
      totalClassified: 0,
      evidenceCount: 0,
      confidenceScore: 0.2,
      sourceSignals: ["comments"],
      inputSnapshotId,
    };
  }

  return {
    curiosity: Math.round((curiosity / totalClassified) * 100),
    learning: Math.round((learning / totalClassified) * 100),
    comparison: Math.round((comparison / totalClassified) * 100),
    purchaseIntent: Math.round((purchaseIntent / totalClassified) * 100),
    totalClassified,
    evidenceCount: totalClassified,
    confidenceScore: Math.min(0.95, 0.4 + (totalClassified / Math.max(comments.length, 1))),
    sourceSignals: ["comments"],
    inputSnapshotId,
  };
}

function computeSegmentDensity(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  segments: AudienceSegment[],
  inputSnapshotId: string | null,
): SegmentDensityItem[] {
  const totalSignals = painMap.reduce((s, p) => s + p.frequency, 0) + desireMap.reduce((s, d) => s + d.frequency, 0);

  return segments.map(seg => {
    let signalCount = 0;
    for (const pain of painMap) {
      if (seg.painProfile.some(p => pain.canonical.toLowerCase().includes(p.toLowerCase()))) {
        signalCount += pain.frequency;
      }
    }
    for (const desire of desireMap) {
      if (seg.desireProfile.some(d => desire.canonical.toLowerCase().includes(d.toLowerCase()))) {
        signalCount += desire.frequency;
      }
    }
    const densityScore = totalSignals > 0 ? Math.round((signalCount / totalSignals) * 100) : Math.round(100 / Math.max(segments.length, 1));
    return {
      segment: seg.name,
      densityScore,
      signalCount,
      evidenceCount: signalCount,
      confidenceScore: totalSignals > 0 ? Math.min(0.95, 0.3 + (signalCount / totalSignals) * 2) : 0.2,
      sourceSignals: ["painMap", "desireMap"],
      inputSnapshotId,
    };
  });
}

async function constructSegments(
  painMap: SignalItem[],
  desireMap: SignalItem[],
  objectionMap: SignalItem[],
  emotionalDrivers: SignalItem[],
  maturity: MaturityResult,
  awareness: AwarenessResult,
  businessContext: { industry: string; coreOffer: string; targetAudience: string },
  commentSamples: string[],
  accountId: string,
  inputSnapshotId: string | null,
): Promise<AudienceSegment[]> {
  try {
    const prompt = `You are an audience research analyst. Based on market evidence, construct 2-4 distinct audience segments.

BUSINESS: ${businessContext.industry} — ${businessContext.coreOffer}

PAIN MAP (from real audience data):
${painMap.slice(0, 8).map(p => `- ${p.canonical}: frequency=${p.frequency}, confidence=${(p.confidenceScore * 100).toFixed(0)}%`).join("\n")}

DESIRE MAP:
${desireMap.slice(0, 8).map(d => `- ${d.canonical}: frequency=${d.frequency}`).join("\n")}

OBJECTION MAP:
${objectionMap.slice(0, 6).map(o => `- ${o.canonical}: frequency=${o.frequency}`).join("\n")}

EMOTIONAL DRIVERS:
${emotionalDrivers.slice(0, 6).map(e => `- ${e.canonical}: frequency=${e.frequency}`).join("\n")}

MARKET MATURITY: ${maturity.level}
AWARENESS LEVEL: ${awareness.level}

SAMPLE COMMENTS (real audience language):
${commentSamples.slice(0, 12).map(c => `"${c.slice(0, 100)}"`).join("\n")}

Return a JSON array of 2-4 segments. Each segment:
{
  "name": "segment name",
  "description": "brief description",
  "painProfile": ["pain1", "pain2"],
  "desireProfile": ["desire1", "desire2"],
  "objectionProfile": ["objection1"],
  "motivationProfile": ["motivation1", "motivation2"],
  "estimatedPercentage": number (must total ~100)
}

Return ONLY the JSON array, no markdown.`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 2000,
      endpoint: "audience-engine-v3-segments",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as any[];

    return parsed.map(seg => ({
      ...seg,
      evidenceCount: painMap.length + desireMap.length + objectionMap.length,
      confidenceScore: Math.min(0.9, 0.5 + (painMap.length + desireMap.length) * 0.03),
      sourceSignals: ["painMap", "desireMap", "objectionMap", "emotionalDrivers"],
      inputSnapshotId,
    }));
  } catch (err: any) {
    console.error("[AudienceEngine-V3] Segment construction failed:", err.message);
    return [{
      name: "Primary Audience",
      description: "Main audience segment based on available data",
      painProfile: painMap.slice(0, 3).map(p => p.canonical),
      desireProfile: desireMap.slice(0, 3).map(d => d.canonical),
      objectionProfile: objectionMap.slice(0, 2).map(o => o.canonical),
      motivationProfile: emotionalDrivers.slice(0, 2).map(e => e.canonical),
      estimatedPercentage: 100,
      evidenceCount: painMap.length + desireMap.length,
      confidenceScore: 0.3,
      sourceSignals: ["painMap", "desireMap"],
      inputSnapshotId,
    }];
  }
}

async function translateToAdsTargeting(
  segments: AudienceSegment[],
  maturity: MaturityResult,
  businessContext: { industry: string; coreOffer: string; location: string },
  accountId: string,
  inputSnapshotId: string | null,
): Promise<AdsTargetingHint[]> {
  try {
    const prompt = `You are a Meta Ads targeting expert. Translate audience segments into Meta Ads Manager targeting suggestions.

BUSINESS: ${businessContext.industry} — ${businessContext.coreOffer}
LOCATION: ${businessContext.location || "Not specified"}
MARKET MATURITY: ${maturity.level}

SEGMENTS:
${segments.map(s => `- ${s.name}: Pains=${s.painProfile.join(", ")}. Desires=${s.desireProfile.join(", ")}. Objections=${s.objectionProfile.join(", ")}`).join("\n")}

For each segment, return:
{
  "suggestedInterests": ["real Meta interest categories"],
  "suggestedBehaviors": ["real Meta behavior targeting options"],
  "suggestedAgeRange": { "min": number, "max": number },
  "suggestedGender": "all" | "male" | "female",
  "suggestedLocations": ["country/region suggestions"],
  "rationale": "brief explanation"
}

Return ONLY a JSON array matching the segments count. Use real Meta Ads targeting options.`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      endpoint: "audience-engine-v3-ads-targeting",
      accountId,
    });

    const content = response.choices[0]?.message?.content?.trim() || "[]";
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as any[];

    return parsed.map(hint => ({
      ...hint,
      evidenceCount: segments.length,
      confidenceScore: 0.6,
      sourceSignals: ["audienceSegments", "maturityIndex"],
      inputSnapshotId,
    }));
  } catch (err: any) {
    console.error("[AudienceEngine-V3] Ads targeting failed:", err.message);
    return [{
      suggestedInterests: [businessContext.industry],
      suggestedBehaviors: ["Engaged shoppers"],
      suggestedAgeRange: { min: 18, max: 55 },
      suggestedGender: "all",
      suggestedLocations: [businessContext.location || "United States"],
      rationale: "Fallback targeting based on business context",
      evidenceCount: 0,
      confidenceScore: 0.2,
      sourceSignals: ["fallback"],
      inputSnapshotId,
    }];
  }
}

export interface AudienceEngineV3Result {
  languageSignals: LanguageSignals;
  painMap: SignalItem[];
  desireMap: SignalItem[];
  objectionMap: SignalItem[];
  transformationMap: SignalItem[];
  emotionalDrivers: SignalItem[];
  audienceSegments: AudienceSegment[];
  segmentDensity: SegmentDensityItem[];
  awarenessLevel: AwarenessResult;
  maturityIndex: MaturityResult;
  intentDistribution: IntentDistribution;
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

export async function runAudienceEngine(accountId: string, campaignId: string): Promise<AudienceEngineV3Result> {
  const startTime = Date.now();
  console.log(`[AudienceEngine-V3] Starting analysis for account=${accountId} campaign=${campaignId}`);

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
    const idList = sql.join(competitorIds.map(id => sql`${id}`), sql`, `);

    posts = await db.select({ caption: ciCompetitorPosts.caption })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} IN (${idList})`)
      .orderBy(desc(ciCompetitorPosts.createdAt))
      .limit(AUDIENCE_THRESHOLDS.MAX_POSTS_TO_ANALYZE);

    comments = await db.select({ commentText: ciCompetitorComments.commentText })
      .from(ciCompetitorComments)
      .where(sql`${ciCompetitorComments.competitorId} IN (${idList})`)
      .orderBy(desc(ciCompetitorComments.createdAt))
      .limit(AUDIENCE_THRESHOLDS.MAX_COMMENTS_TO_ANALYZE);
  }

  const captions = posts.map(p => p.caption).filter((c): c is string => !!c && c.length > 5);
  const commentTexts = comments.map(c => c.commentText).filter((c): c is string => !!c && c.length > 3);

  console.log(`[AudienceEngine-V3] Data: ${competitorIds.length} competitors, ${captions.length} captions, ${commentTexts.length} comments`);

  const [campaign] = await db.select().from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const businessContext = {
    industry: campaign?.name || "General",
    coreOffer: campaign?.name || "Products/Services",
    targetAudience: "Market audience",
    location: "",
  };

  const allText = [...commentTexts, ...captions];

  const languageSignals = analyzeLanguage(commentTexts, captions, miSnapshotId);
  const painMap = matchPatternClusters(allText, PAIN_CLUSTERS, miSnapshotId);
  const desireMap = matchPatternClusters(allText, DESIRE_CLUSTERS, miSnapshotId);
  const objectionMap = matchPatternClusters(allText, OBJECTION_CLUSTERS, miSnapshotId);
  const transformationMap = matchPatternClusters(allText, TRANSFORMATION_PATTERNS, miSnapshotId);
  const emotionalDrivers = matchPatternClusters(allText, EMOTIONAL_DRIVER_PATTERNS, miSnapshotId);
  const awarenessLevel = detectAwareness(commentTexts, miSnapshotId);
  const maturityIndex = detectMaturity(commentTexts, captions, miSnapshotId);
  const intentDistribution = classifyIntents(commentTexts, miSnapshotId);

  const audienceSegments = await constructSegments(
    painMap, desireMap, objectionMap, emotionalDrivers,
    maturityIndex, awarenessLevel,
    businessContext, commentTexts, accountId, miSnapshotId,
  );

  const segmentDensity = computeSegmentDensity(painMap, desireMap, audienceSegments, miSnapshotId);

  const adsTargetingHints = await translateToAdsTargeting(
    audienceSegments, maturityIndex, businessContext, accountId, miSnapshotId,
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
    languageSignals: JSON.stringify(languageSignals),
    audiencePains: JSON.stringify(painMap),
    desireMap: JSON.stringify(desireMap),
    objectionMap: JSON.stringify(objectionMap),
    transformationMap: JSON.stringify(transformationMap),
    emotionalDrivers: JSON.stringify(emotionalDrivers),
    audienceSegments: JSON.stringify(audienceSegments),
    segmentDensity: JSON.stringify(segmentDensity),
    awarenessLevel: JSON.stringify(awarenessLevel),
    maturityIndex: JSON.stringify(maturityIndex),
    audienceIntentDistribution: JSON.stringify(intentDistribution),
    adsTargetingHints: JSON.stringify(adsTargetingHints),
    inputSummary: JSON.stringify(inputSummary),
    executionTimeMs,
  }).returning({ id: audienceSnapshots.id });

  console.log(`[AudienceEngine-V3] Complete in ${executionTimeMs}ms | snapshot=${inserted.id} | pains=${painMap.length} | desires=${desireMap.length} | segments=${audienceSegments.length}`);

  return {
    languageSignals,
    painMap,
    desireMap,
    objectionMap,
    transformationMap,
    emotionalDrivers,
    audienceSegments,
    segmentDensity,
    awarenessLevel,
    maturityIndex,
    intentDistribution,
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
    languageSignals: JSON.parse(snapshot.languageSignals || "{}"),
    painMap: JSON.parse(snapshot.audiencePains || "[]"),
    desireMap: JSON.parse(snapshot.desireMap || "[]"),
    objectionMap: JSON.parse(snapshot.objectionMap || "[]"),
    transformationMap: JSON.parse(snapshot.transformationMap || "[]"),
    emotionalDrivers: JSON.parse(snapshot.emotionalDrivers || "[]"),
    audienceSegments: JSON.parse(snapshot.audienceSegments || "[]"),
    segmentDensity: JSON.parse(snapshot.segmentDensity || "[]"),
    awarenessLevel: JSON.parse(snapshot.awarenessLevel || "{}"),
    maturityIndex: JSON.parse(snapshot.maturityIndex || "{}"),
    intentDistribution: JSON.parse(snapshot.audienceIntentDistribution || "{}"),
    adsTargetingHints: JSON.parse(snapshot.adsTargetingHints || "[]"),
    inputSummary: JSON.parse(snapshot.inputSummary || "{}"),
  };
}
