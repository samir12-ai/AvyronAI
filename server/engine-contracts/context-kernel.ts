import { db } from '../db';
import { businessDataLayer, manualCampaignMetrics, ciCompetitors, performanceSnapshots } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

export const MARKET_MODES = ['GROWTH', 'SUSTAIN', 'DEFENSIVE', 'EXPLORATORY'] as const;
export type MarketMode = (typeof MARKET_MODES)[number];

export const AWARENESS_LEVELS = ['LOW', 'MODERATE', 'HIGH', 'SATURATED'] as const;
export type AwarenessLevel = (typeof AWARENESS_LEVELS)[number];

export const COMPETITION_LEVELS = ['LOW', 'MODERATE', 'HIGH', 'DOMINANT'] as const;
export type CompetitionLevel = (typeof COMPETITION_LEVELS)[number];

export const PRICING_BANDS = ['BUDGET', 'MID', 'PREMIUM', 'LUXURY'] as const;
export type PricingBand = (typeof PRICING_BANDS)[number];

export const GROWTH_DIRECTIONS = ['SCALING', 'STABLE', 'DECLINING', 'PIVOTING'] as const;
export type GrowthDirection = (typeof GROWTH_DIRECTIONS)[number];

export interface StrategicContext {
  marketMode: MarketMode;
  awarenessLevel: AwarenessLevel;
  competitionLevel: CompetitionLevel;
  pricingBand: PricingBand;
  growthDirection: GrowthDirection;
  dataConfidence: number;
  campaignId: string;
  accountId: string;
}

export class ContextKernelError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = 'ContextKernelError';
    this.code = 'CONTEXT_KERNEL_ERROR';
  }
}

function deriveMarketMode(objective: string | null, budget: string | null): MarketMode {
  const obj = (objective || '').toUpperCase();
  const budgetNum = parseFloat(budget || '0') || 0;

  if (obj.includes('GROWTH') || obj.includes('SCALE')) return 'GROWTH';
  if (obj.includes('DEFEND') || obj.includes('PROTECT') || obj.includes('RETAIN')) return 'DEFENSIVE';
  if (obj.includes('EXPLOR') || obj.includes('TEST') || obj.includes('LAUNCH')) return 'EXPLORATORY';
  if (budgetNum > 5000) return 'GROWTH';
  if (budgetNum > 1000) return 'SUSTAIN';
  if (budgetNum > 0) return 'EXPLORATORY';
  return 'SUSTAIN';
}

function deriveAwarenessLevel(impressions: number, clicks: number): AwarenessLevel {
  if (impressions === 0 && clicks === 0) return 'LOW';
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  if (impressions > 100000 && ctr < 0.5) return 'SATURATED';
  if (impressions > 50000) return 'HIGH';
  if (impressions > 10000) return 'MODERATE';
  return 'LOW';
}

function deriveCompetitionLevel(competitorCount: number, avgEngagement: number): CompetitionLevel {
  if (competitorCount === 0) return 'LOW';
  if (competitorCount >= 5 && avgEngagement > 3) return 'DOMINANT';
  if (competitorCount >= 3 || avgEngagement > 2) return 'HIGH';
  if (competitorCount >= 1) return 'MODERATE';
  return 'LOW';
}

function derivePricingBand(priceRange: string | null): PricingBand {
  const range = (priceRange || '').toLowerCase();
  if (range.includes('luxury') || range.includes('premium+')) return 'LUXURY';
  if (range.includes('premium') || range.includes('high')) return 'PREMIUM';
  if (range.includes('budget') || range.includes('low') || range.includes('cheap')) return 'BUDGET';

  const nums = (priceRange || '').match(/\d+/g);
  if (nums && nums.length > 0) {
    const maxPrice = Math.max(...nums.map(Number));
    if (maxPrice >= 500) return 'LUXURY';
    if (maxPrice >= 100) return 'PREMIUM';
    if (maxPrice >= 30) return 'MID';
    return 'BUDGET';
  }

  return 'MID';
}

function deriveGrowthDirection(revenue: number, spend: number, roas: number): GrowthDirection {
  if (revenue === 0 && spend === 0) return 'PIVOTING';
  if (roas >= 3) return 'SCALING';
  if (roas >= 1.5) return 'STABLE';
  if (roas > 0 && roas < 1) return 'DECLINING';
  if (spend > 0 && revenue === 0) return 'PIVOTING';
  return 'STABLE';
}

function computeDataConfidence(sources: {
  hasBusinessData: boolean;
  hasMetrics: boolean;
  hasCompetitors: boolean;
  hasPerformance: boolean;
  competitorDataQuality: number;
}): number {
  let score = 0;
  const weights = { businessData: 30, metrics: 25, competitors: 25, performance: 20 };

  if (sources.hasBusinessData) score += weights.businessData;
  if (sources.hasMetrics) score += weights.metrics;
  if (sources.hasCompetitors) score += weights.competitors * (sources.competitorDataQuality / 100);
  if (sources.hasPerformance) score += weights.performance;

  return Math.round(Math.min(100, Math.max(0, score)));
}

export async function buildStrategicContext(
  campaignId: string,
  accountId: string
): Promise<StrategicContext> {
  if (!campaignId || !accountId) {
    throw new ContextKernelError('campaignId and accountId are required to build strategic context');
  }

  const [bdl] = await db
    .select()
    .from(businessDataLayer)
    .where(and(eq(businessDataLayer.campaignId, campaignId), eq(businessDataLayer.accountId, accountId)))
    .limit(1);

  const [metrics] = await db
    .select()
    .from(manualCampaignMetrics)
    .where(and(eq(manualCampaignMetrics.campaignId, campaignId), eq(manualCampaignMetrics.accountId, accountId)))
    .orderBy(desc(manualCampaignMetrics.updatedAt))
    .limit(1);

  const competitors = await db
    .select()
    .from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  const perfSnapshots = await db
    .select()
    .from(performanceSnapshots)
    .where(eq(performanceSnapshots.postId, campaignId))
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(10);

  const impressions = metrics?.impressions || 0;
  const clicks = metrics?.clicks || 0;
  const revenue = metrics?.revenue || 0;
  const spend = metrics?.spend || 0;
  const roas = spend > 0 ? revenue / spend : 0;

  const enrichedCompetitors = competitors.filter(c => c.enrichmentStatus === "ENRICHED");
  const avgEngagement = competitors.length > 0
    ? competitors.reduce((sum, c) => sum + (c.engagementRatio || 0), 0) / competitors.length
    : 0;

  const competitorFieldCount = competitors.reduce((total, c) => {
    let filled = 0;
    if (c.postingFrequency) filled++;
    if (c.contentTypeRatio) filled++;
    if (c.engagementRatio) filled++;
    if (c.ctaPatterns) filled++;
    if (c.hookStyles) filled++;
    if (c.messagingTone) filled++;
    return total + filled;
  }, 0);
  const maxFields = competitors.length * 6;
  const enrichmentRatio = competitors.length > 0 ? enrichedCompetitors.length / competitors.length : 0;
  const competitorDataQuality = maxFields > 0 ? ((competitorFieldCount / maxFields) * 100) * (0.5 + 0.5 * enrichmentRatio) : 0;

  const dataConfidence = computeDataConfidence({
    hasBusinessData: !!bdl,
    hasMetrics: !!metrics,
    hasCompetitors: competitors.length > 0,
    hasPerformance: perfSnapshots.length > 0,
    competitorDataQuality,
  });

  return {
    marketMode: deriveMarketMode(bdl?.funnelObjective || null, bdl?.monthlyBudget || null),
    awarenessLevel: deriveAwarenessLevel(impressions, clicks),
    competitionLevel: deriveCompetitionLevel(competitors.length, avgEngagement),
    pricingBand: derivePricingBand(bdl?.priceRange || null),
    growthDirection: deriveGrowthDirection(revenue, spend, roas),
    dataConfidence,
    campaignId,
    accountId,
  };
}
