import { db } from "../db";
import { miSnapshots, competitorWebData } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { MultiSourceSignals, WebsiteSignals, BlogSignals, InstagramSignals, SourceAvailability } from "../market-intelligence-v3/source-types";

export interface MultiSourceContext {
  sourceAvailability: SourceAvailability;
  perCompetitor: Record<string, {
    competitorName: string;
    instagram: InstagramSignals | null;
    website: WebsiteSignals | null;
    blog: BlogSignals | null;
    signalConfidence: number;
    reconciliationNotes: string[];
  }>;
  aggregated: {
    allHeadlines: string[];
    allOfferPhrases: string[];
    allCTAs: string[];
    allProofBlocks: string[];
    allGuarantees: string[];
    allPricingAnchors: string[];
    allFeatures: string[];
    allHooks: string[];
    allBlogTopics: string[];
    allEducationalThemes: string[];
  };
  hasMeaningfulWebData: boolean;
  hasMeaningfulBlogData: boolean;
}

function safeJson(val: string | null | undefined, fallback: any): any {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export async function loadMultiSourceContext(miSnapshotId: string): Promise<MultiSourceContext | null> {
  try {
    const [snap] = await db.select({
      multiSourceSignals: miSnapshots.multiSourceSignals,
      sourceAvailability: miSnapshots.sourceAvailability,
    }).from(miSnapshots).where(eq(miSnapshots.id, miSnapshotId)).limit(1);

    if (!snap) return null;

    const sourceAvailability: SourceAvailability = safeJson(snap.sourceAvailability, {
      instagram: true, website: false, blog: false,
      availableSources: ["instagram"], missingSourcesCount: 2, primarySource: "instagram",
    });

    const perCompetitorRaw = safeJson(snap.multiSourceSignals, {});
    const perCompetitor: MultiSourceContext["perCompetitor"] = {};

    const allHeadlines: string[] = [];
    const allOfferPhrases: string[] = [];
    const allCTAs: string[] = [];
    const allProofBlocks: string[] = [];
    const allGuarantees: string[] = [];
    const allPricingAnchors: string[] = [];
    const allFeatures: string[] = [];
    const allHooks: string[] = [];
    const allBlogTopics: string[] = [];
    const allEducationalThemes: string[] = [];

    for (const [compId, data] of Object.entries(perCompetitorRaw as Record<string, any>)) {
      perCompetitor[compId] = {
        competitorName: data.competitorName || "Unknown",
        instagram: data.instagram || null,
        website: data.website || null,
        blog: data.blog || null,
        signalConfidence: data.signalConfidence || 0.3,
        reconciliationNotes: data.reconciliationNotes || [],
      };

      if (data.website) {
        allHeadlines.push(...(data.website.headlineExtractions || []));
        allOfferPhrases.push(...(data.website.offerStructure || []));
        allCTAs.push(...(data.website.funnelCTAs || []));
        allProofBlocks.push(...(data.website.proofStructure || []));
        allGuarantees.push(...(data.website.guarantees || []));
        allPricingAnchors.push(...(data.website.pricingModel || []));
        allFeatures.push(...(data.website.featureHierarchy || []));
      }

      if (data.instagram) {
        allHooks.push(...(data.instagram.hooks || []));
      }

      if (data.blog) {
        allBlogTopics.push(...(data.blog.topicClusters || []));
        allEducationalThemes.push(...(data.blog.educationalThemes || []));
      }
    }

    return {
      sourceAvailability,
      perCompetitor,
      aggregated: {
        allHeadlines: [...new Set(allHeadlines)].slice(0, 30),
        allOfferPhrases: [...new Set(allOfferPhrases)].slice(0, 20),
        allCTAs: [...new Set(allCTAs)].slice(0, 20),
        allProofBlocks: [...new Set(allProofBlocks)].slice(0, 20),
        allGuarantees: [...new Set(allGuarantees)].slice(0, 15),
        allPricingAnchors: [...new Set(allPricingAnchors)].slice(0, 10),
        allFeatures: [...new Set(allFeatures)].slice(0, 20),
        allHooks: [...new Set(allHooks)].slice(0, 20),
        allBlogTopics: [...new Set(allBlogTopics)].slice(0, 15),
        allEducationalThemes: [...new Set(allEducationalThemes)].slice(0, 15),
      },
      hasMeaningfulWebData: allHeadlines.length > 0 || allOfferPhrases.length > 0,
      hasMeaningfulBlogData: allBlogTopics.length > 0 || allEducationalThemes.length > 0,
    };
  } catch (err: any) {
    console.error(`[MultiSourceLoader] Failed to load context for snapshot ${miSnapshotId}:`, err.message);
    return null;
  }
}

export function buildMultiSourcePromptSection(ctx: MultiSourceContext): string {
  const lines: string[] = [];
  lines.push("\n## MULTI-SOURCE INTELLIGENCE");
  lines.push(`Source Availability: ${ctx.sourceAvailability.availableSources.join(", ") || "Instagram only"}`);
  lines.push(`Missing Sources: ${ctx.sourceAvailability.missingSourcesCount}/3`);

  if (ctx.hasMeaningfulWebData) {
    lines.push("\n### WEBSITE SIGNALS (Product & Positioning Truth)");
    if (ctx.aggregated.allHeadlines.length > 0) {
      lines.push(`Competitor Headlines: ${ctx.aggregated.allHeadlines.slice(0, 10).join(" | ")}`);
    }
    if (ctx.aggregated.allOfferPhrases.length > 0) {
      lines.push(`Offer Phrases: ${ctx.aggregated.allOfferPhrases.slice(0, 8).join(" | ")}`);
    }
    if (ctx.aggregated.allCTAs.length > 0) {
      lines.push(`CTA Patterns: ${ctx.aggregated.allCTAs.slice(0, 8).join(" | ")}`);
    }
    if (ctx.aggregated.allProofBlocks.length > 0) {
      lines.push(`Proof Signals: ${ctx.aggregated.allProofBlocks.slice(0, 6).join(" | ")}`);
    }
    if (ctx.aggregated.allGuarantees.length > 0) {
      lines.push(`Guarantees: ${ctx.aggregated.allGuarantees.slice(0, 5).join(" | ")}`);
    }
    if (ctx.aggregated.allPricingAnchors.length > 0) {
      lines.push(`Pricing Anchors: ${ctx.aggregated.allPricingAnchors.slice(0, 5).join(" | ")}`);
    }
    if (ctx.aggregated.allFeatures.length > 0) {
      lines.push(`Feature Hierarchy: ${ctx.aggregated.allFeatures.slice(0, 8).join(" | ")}`);
    }
  }

  if (ctx.aggregated.allHooks.length > 0) {
    lines.push("\n### INSTAGRAM SIGNALS (Content Behavior)");
    lines.push(`Hook Patterns: ${ctx.aggregated.allHooks.slice(0, 8).join(" | ")}`);
  }

  if (ctx.hasMeaningfulBlogData) {
    lines.push("\n### BLOG SIGNALS (Education & Authority)");
    if (ctx.aggregated.allBlogTopics.length > 0) {
      lines.push(`Topic Clusters: ${ctx.aggregated.allBlogTopics.slice(0, 8).join(" | ")}`);
    }
    if (ctx.aggregated.allEducationalThemes.length > 0) {
      lines.push(`Educational Themes: ${ctx.aggregated.allEducationalThemes.slice(0, 8).join(" | ")}`);
    }
  }

  const allNotes = Object.values(ctx.perCompetitor)
    .flatMap(c => c.reconciliationNotes)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  if (allNotes.length > 0) {
    lines.push("\n### SOURCE RECONCILIATION NOTES");
    for (const note of allNotes.slice(0, 5)) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}

export function buildSourceFallbackContext(ctx: MultiSourceContext | null): string {
  if (!ctx) return "\nNo multi-source signals available. Using profile card and Instagram data only.";

  const lines: string[] = [];
  if (!ctx.sourceAvailability.website && !ctx.sourceAvailability.blog) {
    lines.push("\nSource fallback active: No website or blog data. Positioning and offer analysis derived from Instagram hooks and profile card.");
  } else if (!ctx.sourceAvailability.instagram) {
    lines.push("\nSource fallback active: No Instagram data. Content behavior analysis derived from website headlines and blog titles.");
  }

  if (!ctx.sourceAvailability.website) {
    lines.push("Website source missing — positioning language and offer structure are inferred rather than directly observed.");
  }
  if (!ctx.sourceAvailability.blog) {
    lines.push("Blog source missing — educational themes and topic clusters unavailable for this analysis.");
  }

  return lines.join("\n");
}
