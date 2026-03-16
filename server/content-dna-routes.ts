import { Express, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";
import {
  contentDna,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  offerSnapshots,
  funnelSnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  strategicPlans,
  businessDataLayer,
} from "../shared/schema";
import { aiChat } from "./ai-client";
import { requireCampaign } from "./campaign-routes";

const safeJson = (v: any) => {
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return null;
  }
};

const truncJson = (obj: any, maxLen = 1200): string => {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj);
  return s?.substring(0, maxLen) || "";
};

async function gatherEngineContext(campaignId: string, accountId: string) {
  const [
    miData, audData, posData, diffData, offerData,
    funnelData, awarenessData, persuasionData, channelData,
    iterData, businessData,
  ] = await Promise.all([
    db.select({
      marketDiagnosis: miSnapshots.marketDiagnosis,
      competitorData: miSnapshots.competitorData,
      narrativeSynthesis: miSnapshots.narrativeSynthesis,
      multiSourceSignals: miSnapshots.multiSourceSignals,
      sourceAvailability: miSnapshots.sourceAvailability,
    }).from(miSnapshots)
      .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId)))
      .orderBy(desc(miSnapshots.createdAt)).limit(1),
    db.select({
      audiencePains: audienceSnapshots.audiencePains,
      audienceSegments: audienceSnapshots.audienceSegments,
      emotionalDrivers: audienceSnapshots.emotionalDrivers,
      desireMap: audienceSnapshots.desireMap,
      awarenessLevel: audienceSnapshots.awarenessLevel,
    }).from(audienceSnapshots)
      .where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
      .orderBy(desc(audienceSnapshots.createdAt)).limit(1),
    db.select({
      territory: positioningSnapshots.territory,
      narrativeDirection: positioningSnapshots.narrativeDirection,
      enemyDefinition: positioningSnapshots.enemyDefinition,
      contrastAxis: positioningSnapshots.contrastAxis,
    }).from(positioningSnapshots)
      .where(and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId)))
      .orderBy(desc(positioningSnapshots.createdAt)).limit(1),
    db.select({
      differentiationPillars: differentiationSnapshots.differentiationPillars,
      mechanismCore: differentiationSnapshots.mechanismCore,
      mechanismFraming: differentiationSnapshots.mechanismFraming,
      proofArchitecture: differentiationSnapshots.proofArchitecture,
      authorityMode: differentiationSnapshots.authorityMode,
    }).from(differentiationSnapshots)
      .where(and(eq(differentiationSnapshots.accountId, accountId), eq(differentiationSnapshots.campaignId, campaignId)))
      .orderBy(desc(differentiationSnapshots.createdAt)).limit(1),
    db.select({
      primaryOffer: offerSnapshots.primaryOffer,
      hookMechanismAlignment: offerSnapshots.hookMechanismAlignment,
    }).from(offerSnapshots)
      .where(and(eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.campaignId, campaignId)))
      .orderBy(desc(offerSnapshots.createdAt)).limit(1),
    db.select({
      primaryFunnel: funnelSnapshots.primaryFunnel,
      trustPathAnalysis: funnelSnapshots.trustPathAnalysis,
    }).from(funnelSnapshots)
      .where(and(eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.campaignId, campaignId)))
      .orderBy(desc(funnelSnapshots.createdAt)).limit(1),
    db.select({
      primaryRoute: awarenessSnapshots.primaryRoute,
      awarenessStrengthScore: awarenessSnapshots.awarenessStrengthScore,
    }).from(awarenessSnapshots)
      .where(and(eq(awarenessSnapshots.accountId, accountId), eq(awarenessSnapshots.campaignId, campaignId)))
      .orderBy(desc(awarenessSnapshots.createdAt)).limit(1),
    db.select({
      primaryRoute: persuasionSnapshots.primaryRoute,
      persuasionStrengthScore: persuasionSnapshots.persuasionStrengthScore,
    }).from(persuasionSnapshots)
      .where(and(eq(persuasionSnapshots.accountId, accountId), eq(persuasionSnapshots.campaignId, campaignId)))
      .orderBy(desc(persuasionSnapshots.createdAt)).limit(1),
    db.select({
      result: channelSelectionSnapshots.result,
    }).from(channelSelectionSnapshots)
      .where(and(eq(channelSelectionSnapshots.accountId, accountId), eq(channelSelectionSnapshots.campaignId, campaignId)))
      .orderBy(desc(channelSelectionSnapshots.createdAt)).limit(1),
    db.select({
      result: iterationSnapshots.result,
    }).from(iterationSnapshots)
      .where(and(eq(iterationSnapshots.accountId, accountId), eq(iterationSnapshots.campaignId, campaignId)))
      .orderBy(desc(iterationSnapshots.createdAt)).limit(1),
    db.select().from(businessDataLayer)
      .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)))
      .limit(1),
  ]);

  const parts: string[] = [];

  const biz = businessData[0];
  if (biz) {
    parts.push(`BUSINESS PROFILE:\nOffer: ${biz.coreOffer || "N/A"}\nType: ${biz.businessType || "N/A"}\nLocation: ${biz.businessLocation || "N/A"}\nPrice Range: ${biz.priceRange || "N/A"}\nTarget Age: ${biz.targetAudienceAge || "N/A"}\nTarget Segment: ${biz.targetAudienceSegment || "N/A"}\nBudget: ${biz.monthlyBudget || "N/A"}\nObjective: ${biz.funnelObjective || "N/A"}\nConversion Channel: ${biz.primaryConversionChannel || "N/A"}`);
  }

  const mi = miData[0];
  if (mi) {
    parts.push(`MARKET INTELLIGENCE:\nDiagnosis: ${truncJson(safeJson(mi.marketDiagnosis))}\nNarrative: ${truncJson(safeJson(mi.narrativeSynthesis))}\nCompetitors: ${truncJson(safeJson(mi.competitorData))}`);
  }

  const aud = audData[0];
  if (aud) {
    parts.push(`AUDIENCE ENGINE:\nPains: ${truncJson(safeJson(aud.audiencePains))}\nDesires: ${truncJson(safeJson(aud.desireMap))}\nEmotional Drivers: ${truncJson(safeJson(aud.emotionalDrivers))}\nSegments: ${truncJson(safeJson(aud.audienceSegments))}\nAwareness Level: ${aud.awarenessLevel || "N/A"}`);
  }

  const pos = posData[0];
  if (pos) {
    parts.push(`POSITIONING ENGINE:\nTerritory: ${truncJson(safeJson(pos.territory))}\nNarrative Direction: ${truncJson(safeJson(pos.narrativeDirection))}\nEnemy: ${truncJson(safeJson(pos.enemyDefinition))}\nContrast: ${truncJson(safeJson(pos.contrastAxis))}`);
  }

  const diff = diffData[0];
  if (diff) {
    parts.push(`DIFFERENTIATION ENGINE:\nPillars: ${truncJson(safeJson(diff.differentiationPillars))}\nMechanism: ${truncJson(safeJson(diff.mechanismCore))}\nFraming: ${truncJson(safeJson(diff.mechanismFraming))}\nProof: ${truncJson(safeJson(diff.proofArchitecture))}\nAuthority Mode: ${diff.authorityMode || "N/A"}`);
  }

  const offer = offerData[0];
  if (offer) {
    parts.push(`OFFER ENGINE:\nPrimary Offer: ${truncJson(safeJson(offer.primaryOffer))}\nHook Alignment: ${truncJson(safeJson(offer.hookMechanismAlignment))}`);
  }

  const funnel = funnelData[0];
  if (funnel) {
    parts.push(`FUNNEL ENGINE:\nPrimary Funnel: ${truncJson(safeJson(funnel.primaryFunnel))}\nTrust Path: ${truncJson(safeJson(funnel.trustPathAnalysis))}`);
  }

  const awareness = awarenessData[0];
  if (awareness) {
    parts.push(`AWARENESS ENGINE:\nPrimary Route: ${truncJson(safeJson(awareness.primaryRoute))}\nStrength: ${awareness.awarenessStrengthScore || "N/A"}`);
  }

  const persuasion = persuasionData[0];
  if (persuasion) {
    parts.push(`PERSUASION ENGINE:\nPrimary Route: ${truncJson(safeJson(persuasion.primaryRoute))}\nStrength: ${persuasion.persuasionStrengthScore || "N/A"}`);
  }

  const channel = channelData[0];
  if (channel) {
    parts.push(`CHANNEL SELECTION:\n${truncJson(safeJson(channel.result))}`);
  }

  const iter = iterData[0];
  if (iter) {
    parts.push(`ITERATION LEARNINGS:\n${truncJson(safeJson(iter.result))}`);
  }

  const miForSources = miData[0];
  if (miForSources?.multiSourceSignals) {
    try {
      const multiSource = typeof miForSources.multiSourceSignals === "string" ? JSON.parse(miForSources.multiSourceSignals) : miForSources.multiSourceSignals;
      if (multiSource && typeof multiSource === "object") {
        const websiteSignals: string[] = [];
        const blogSignals: string[] = [];
        for (const compData of Object.values(multiSource as Record<string, any>)) {
          if ((compData as any)?.website) {
            const ws = (compData as any).website;
            if (ws.headlineExtractions?.length) websiteSignals.push(`Headlines: ${ws.headlineExtractions.slice(0, 3).join(", ")}`);
            if (ws.ctaPatterns?.length) websiteSignals.push(`CTAs: ${ws.ctaPatterns.slice(0, 3).join(", ")}`);
          }
          if ((compData as any)?.blog) {
            const blog = (compData as any).blog;
            if (blog.topicClusters?.length) blogSignals.push(`Topics: ${blog.topicClusters.slice(0, 3).join(", ")}`);
          }
        }
        if (websiteSignals.length > 0 || blogSignals.length > 0) {
          let section = "MULTI-SOURCE INTELLIGENCE:";
          if (websiteSignals.length > 0) section += `\nWebsite Signals:\n${websiteSignals.join("\n")}`;
          if (blogSignals.length > 0) section += `\nBlog Signals:\n${blogSignals.join("\n")}`;
          parts.push(section);
        }
      }
    } catch {}
  }

  return { contextString: parts.join("\n\n---\n\n"), businessProfile: biz || null };
}

export async function generateContentDna(campaignId: string, accountId: string, planId?: string, rootBundleId?: string | null, rootBundleVersion?: number | null): Promise<any> {
  const { contextString, businessProfile } = await gatherEngineContext(campaignId, accountId);

  if (!contextString || contextString.length < 50) {
    throw new Error("Insufficient engine data to generate Content DNA. Run engines first.");
  }

  const coreOffer = businessProfile?.coreOffer || "Not specified";
  const conversionChannel = businessProfile?.primaryConversionChannel || "Not specified";

  const systemPrompt = `You are a senior content strategist for a marketing AI system called MarketMind.
Your job is to synthesize deep engine analysis into a practical Content DNA blueprint.

CRITICAL RULE: The user's real business offer is "${coreOffer}" with conversion via ${conversionChannel}.
All content DNA must stay anchored to this real offer. You may refine and optimize the messaging around it, but you must NOT disconnect from what the business actually sells.

You will receive detailed engine outputs from Market Intelligence, Audience, Positioning, Differentiation, Offer, Funnel, Awareness, Persuasion, Channel Selection, and Iteration engines.

Synthesize ALL of this into a structured Content DNA with these 8 sections. Return ONLY valid JSON matching this exact structure:

{
  "messagingCore": {
    "primaryValuePromise": "string",
    "positioningEmphasis": "string",
    "toneStyle": "string",
    "trustStyle": "string",
    "persuasionIntensity": "string (1-10 scale with description)"
  },
  "ctaDna": {
    "primaryCtaType": "string",
    "ctaDeliveryStyle": "string",
    "softVsDirectRule": "string",
    "ctaExamples": ["string", "string", "string"]
  },
  "hookDna": {
    "preferredHookTypes": ["string", "string"],
    "hookIntensity": "string",
    "recommendedOpeningStyle": "string",
    "recommendedHookDuration": "string",
    "hookExamples": ["string", "string", "string"]
  },
  "narrativeDna": {
    "preferredStructure": "string",
    "problemSolutionBalance": "string",
    "trustBuildingSequence": "string",
    "authorityVsRelatability": "string",
    "storytellingGuidance": "string"
  },
  "contentAngleDna": {
    "dominantAngles": ["string", "string"],
    "anglesToAvoid": ["string"],
    "educationalVsProofVsOfferRatio": "string",
    "trustBuildingLogic": "string"
  },
  "visualDna": {
    "visualDirection": "string",
    "talkingHeadVsProofVsDemo": "string",
    "staticVsDynamic": "string",
    "simplicityVsPolished": "string"
  },
  "formatDna": {
    "reelBehavior": "string",
    "carouselBehavior": "string",
    "storyBehavior": "string",
    "postBehavior": "string",
    "formatPriority": "string"
  },
  "executionRules": {
    "alwaysInclude": ["string", "string"],
    "neverDo": ["string", "string"],
    "funnelMovement": "string",
    "offerSupport": "string"
  },
  "snapshot": {
    "ctaType": "string (short label)",
    "hookStyle": "string (short label)",
    "hookDuration": "string (short)",
    "narrativeStyle": "string (short)",
    "contentAngle": "string (short)",
    "formatPriority": "string (short)",
    "toneStyle": "string (short)"
  },
  "contentInstructions": {
    "hookGuide": {
      "structure": "Step-by-step hook construction guide",
      "examples": ["3 specific hook scripts tailored to this business"],
      "avoidPatterns": ["What NOT to open with"]
    },
    "narrativeBreakdown": {
      "reelScript": "Beat-by-beat reel narrative structure (e.g. Problem 0-3s → Educate 3-12s → Proof 12-20s → CTA 20-25s)",
      "carouselFlow": "Slide-by-slide carousel structure",
      "postStructure": "Opening → Body → CTA post format"
    },
    "ctaPlacement": {
      "reelCta": "When and how to place CTA in reels",
      "carouselCta": "CTA slide strategy",
      "storyCta": "Story CTA approach",
      "softVsHard": "When to use soft vs direct CTA"
    },
    "visualDirection": {
      "talkingHead": "Guidelines for talking head content",
      "bRoll": "B-roll and proof footage direction",
      "textOverlays": "Text overlay style and placement",
      "thumbnailStrategy": "Cover image / thumbnail guidance"
    }
  }
}

Make every field specific to THIS business. No generic marketing advice. Use the engine data to derive precise, actionable guidance.
The contentInstructions section must be a practical content production manual — specific enough that a content creator can follow it without additional context.`;

  const response = await aiChat({
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Here is the full engine analysis to synthesize:\n\n${contextString}` },
    ],
    max_tokens: 3000,
    temperature: 0.4,
    accountId,
    endpoint: "content-dna-generate",
  });

  const raw = response.choices?.[0]?.message?.content || "";
  let parsed: any;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    throw new Error("Failed to parse Content DNA response from AI");
  }

  await db.insert(contentDna).values({
    campaignId,
    accountId,
    planId: planId || null,
    messagingCore: JSON.stringify(parsed.messagingCore),
    ctaDna: JSON.stringify(parsed.ctaDna),
    hookDna: JSON.stringify(parsed.hookDna),
    narrativeDna: JSON.stringify(parsed.narrativeDna),
    contentAngleDna: JSON.stringify(parsed.contentAngleDna),
    visualDna: JSON.stringify(parsed.visualDna),
    formatDna: JSON.stringify(parsed.formatDna),
    executionRules: JSON.stringify(parsed.executionRules),
    snapshot: JSON.stringify(parsed.snapshot),
    contentInstructions: parsed.contentInstructions ? JSON.stringify(parsed.contentInstructions) : null,
    status: "active",
    rootBundleId: rootBundleId || null,
    rootBundleVersion: rootBundleVersion || null,
  });

  return parsed;
}

export async function getLatestContentDna(campaignId: string, accountId: string) {
  const rows = await db.select().from(contentDna)
    .where(and(
      eq(contentDna.campaignId, campaignId),
      eq(contentDna.accountId, accountId),
      eq(contentDna.status, "active"),
    ))
    .orderBy(desc(contentDna.generatedAt))
    .limit(1);

  if (!rows[0]) return null;

  const row = rows[0];
  return {
    id: row.id,
    campaignId: row.campaignId,
    planId: row.planId,
    messagingCore: safeJson(row.messagingCore),
    ctaDna: safeJson(row.ctaDna),
    hookDna: safeJson(row.hookDna),
    narrativeDna: safeJson(row.narrativeDna),
    contentAngleDna: safeJson(row.contentAngleDna),
    visualDna: safeJson(row.visualDna),
    formatDna: safeJson(row.formatDna),
    executionRules: safeJson(row.executionRules),
    contentInstructions: safeJson(row.contentInstructions),
    snapshot: safeJson(row.snapshot),
    generatedAt: row.generatedAt,
  };
}

export function registerContentDnaRoutes(app: Express) {
  app.post("/api/content-dna/generate", requireCampaign, async (req: Request, res: Response) => {
    try {
      const { accountId, campaignId } = (req as any).campaignContext;
      const { planId } = req.body || {};
      const result = await generateContentDna(campaignId, accountId, planId);
      res.json({ success: true, contentDna: result });
    } catch (err: any) {
      console.error("[Content DNA] Generation error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/content-dna/:campaignId", async (req: Request, res: Response) => {
    try {
      const campaignId = req.params.campaignId;
      const accountId = (req.query.accountId as string) || "default";
      const dna = await getLatestContentDna(campaignId, accountId);
      if (!dna) {
        return res.json({ success: true, contentDna: null, message: "No Content DNA generated yet" });
      }
      res.json({ success: true, contentDna: dna });
    } catch (err: any) {
      console.error("[Content DNA] Fetch error:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
