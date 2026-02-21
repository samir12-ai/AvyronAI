import { db } from "./db";
import {
  performanceSnapshots,
  revenueEntries,
  adSpendEntries,
  leads,
  conversionEvents,
  publishedPosts,
  ctaVariants,
} from "@shared/schema";
import { eq, desc, sql, and, isNotNull, min, max, gte, lte } from "drizzle-orm";
import { logAudit } from "./audit";

const LOG_PREFIX = "[CampaignDataLayer]";

export interface CampaignMetrics {
  campaignId: string;
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  totalLeads: number;
  totalImpressions: number;
  totalReach: number;
  totalClicks: number;
  avgCtr: number;
  avgCpa: number;
  avgRoas: number;
  avgCpm: number;
  avgCpc: number;
  contentCount: number;
  publishedCount: number;
  monthSpend: number;
  monthRevenue: number;
  monthConversions: number;
  monthLeads: number;
  monthRoas: string;
  costPerLead: string;
}

export interface LeadToCustomerMapping {
  leadId: string;
  leadCreatedAt: Date | null;
  conversionEventId: string | null;
  conversionAt: Date | null;
  revenueEntryId: string | null;
  revenueAmount: number;
  timeToConversionHours: number | null;
}

export interface RevenueSummary {
  campaignId: string;
  totalRevenue: number;
  monthRevenue: number;
  totalSpend: number;
  monthSpend: number;
  roas: string;
  monthRoas: string;
  revenueByContent: Array<{ postId: string; revenue: number }>;
  revenueByCampaign: Record<string, number>;
  revenueByFunnelStage: Record<string, number>;
  revenueByContentCluster: Record<string, number>;
  revenueByCtaVariant: Array<{ ctaVariantId: string; ctaText: string; revenue: number; conversions: number }>;
  leadToCustomerMap: LeadToCustomerMapping[];
  topRevenueContent: Array<{ postId: string; revenue: number; caption?: string }>;
  costPerLead: string;
  leadToCustomerRate: string;
  avgTimeToConversionHours: string;
}

export interface SeasonalityCheck {
  result: "normal" | "anomalous" | "insufficientData";
  reason: string;
  weekdayAvailable: boolean;
  priorWindowAvg: number;
  weekdayAvg: number | null;
}

export interface SignalValidation {
  validationStatus: "ACTIONABLE" | "LOW_CONFIDENCE" | "NORMAL_VARIATION";
  confidenceScore: number;
  volatilityIndex: number;
  volatilityStdDev: number;
  deltaPct: number;
  baselineWindow: string;
  comparisonWindow: string;
  seasonalityCheck: SeasonalityCheck;
  reasonSummary: string;
}

export interface ExpansionSuggestion {
  suggestedBudgetIncreasePct: number;
  suggestedAudienceExpansion: "lookalike" | "interest_expansion" | "retargeting_depth";
  rationale: string;
}

export interface PerformanceSignal {
  signalType: "SCALE_CANDIDATE" | "REVIEW_NEEDED" | "INSUFFICIENT_DATA_FOR_SIGNALS" | "NORMAL_VARIATION" | "LOW_CONFIDENCE";
  metric: string;
  currentValue: number;
  baselineValue: number;
  ratio: number;
  deltaPct: number;
  postId?: string;
  contentType?: string;
  message: string;
  reasoning: string;
  validation: SignalValidation;
  expansionSuggestion?: ExpansionSuggestion;
}

const SCALE_THRESHOLD = 1.5;
const REVIEW_THRESHOLD = 0.7;
const MIN_SPEND_THRESHOLD = 50;
const MIN_TIMESPAN_HOURS = 72;
const MIN_CONVERSIONS_THRESHOLD = 3;
const SIGNAL_DEDUP_HOURS = 24;
const SIGNAL_DEDUP_DELTA_SHIFT = 0.10;
const CONFIDENCE_THRESHOLD = 60;

const signalCache = new Map<string, { emittedAt: number; deltaPct: number }>();

function snapshotFilter(campaignId: string, accountId: string) {
  return and(
    eq(performanceSnapshots.accountId, accountId),
    eq(performanceSnapshots.campaignId, campaignId),
    isNotNull(performanceSnapshots.campaignId)
  );
}

function revenueFilter(campaignId: string, accountId: string) {
  return and(
    eq(revenueEntries.accountId, accountId),
    eq(revenueEntries.campaignId, campaignId),
    isNotNull(revenueEntries.campaignId)
  );
}

function spendFilter(campaignId: string, accountId: string) {
  return and(
    eq(adSpendEntries.accountId, accountId),
    eq(adSpendEntries.campaignId, campaignId),
    isNotNull(adSpendEntries.campaignId)
  );
}

function conversionFilter(campaignId: string, accountId: string) {
  return and(
    eq(conversionEvents.accountId, accountId),
    eq(conversionEvents.campaignId, campaignId),
    isNotNull(conversionEvents.campaignId)
  );
}

function leadsFilter(campaignId: string, accountId: string) {
  return and(
    eq(leads.accountId, accountId),
    eq(leads.campaignId, campaignId),
    isNotNull(leads.campaignId)
  );
}

function postsFilter(campaignId: string, accountId: string) {
  return and(
    eq(publishedPosts.accountId, accountId),
    eq(publishedPosts.campaignId, campaignId),
    isNotNull(publishedPosts.campaignId)
  );
}

export async function getCampaignMetrics(campaignId: string, accountId: string = "default"): Promise<CampaignMetrics> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const perfData = await db.select().from(performanceSnapshots)
    .where(snapshotFilter(campaignId, accountId))
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(200);

  const allRevenue = await db.select().from(revenueEntries)
    .where(revenueFilter(campaignId, accountId));

  const allSpend = await db.select().from(adSpendEntries)
    .where(spendFilter(campaignId, accountId));

  const allConversions = await db.select().from(conversionEvents)
    .where(conversionFilter(campaignId, accountId));

  const allLeads = await db.select().from(leads)
    .where(leadsFilter(campaignId, accountId));

  const posts = await db.select().from(publishedPosts)
    .where(postsFilter(campaignId, accountId));

  const totalSpend = allSpend.reduce((s, e) => s + (e.amount || 0), 0);
  const totalRevenue = allRevenue.reduce((s, e) => s + (e.amount || 0), 0);
  const totalConversions = allConversions.length;
  const totalImpressions = perfData.reduce((s, p) => s + (p.impressions || 0), 0);
  const totalReach = perfData.reduce((s, p) => s + (p.reach || 0), 0);
  const totalClicks = perfData.reduce((s, p) => s + (p.clicks || 0), 0);

  const monthRevenue = allRevenue
    .filter(r => r.createdAt && r.createdAt >= monthStart)
    .reduce((s, e) => s + (e.amount || 0), 0);
  const monthSpend = allSpend
    .filter(s => s.createdAt && s.createdAt >= monthStart)
    .reduce((s, e) => s + (e.amount || 0), 0);
  const monthLeads = allLeads.filter(l => l.createdAt && l.createdAt >= monthStart).length;
  const monthConversions = allConversions
    .filter(c => c.createdAt && c.createdAt >= monthStart).length;

  const count = perfData.length || 1;
  const avgCtr = perfData.reduce((s, p) => s + (p.ctr || 0), 0) / count;
  const avgCpa = perfData.reduce((s, p) => s + (p.cpa || 0), 0) / count;
  const avgRoas = perfData.reduce((s, p) => s + (p.roas || 0), 0) / count;
  const avgCpm = perfData.reduce((s, p) => s + (p.cpm || 0), 0) / count;
  const avgCpc = perfData.reduce((s, p) => s + (p.cpc || 0), 0) / count;

  return {
    campaignId,
    totalSpend,
    totalRevenue,
    totalConversions,
    totalLeads: allLeads.length,
    totalImpressions,
    totalReach,
    totalClicks,
    avgCtr,
    avgCpa,
    avgRoas,
    avgCpm,
    avgCpc,
    contentCount: posts.length,
    publishedCount: posts.filter(p => p.status === "published").length,
    monthSpend,
    monthRevenue,
    monthConversions,
    monthLeads,
    monthRoas: monthSpend > 0 ? (monthRevenue / monthSpend).toFixed(2) : "N/A",
    costPerLead: monthLeads > 0 ? (monthSpend / monthLeads).toFixed(2) : "0",
  };
}

export async function getRevenueSummary(campaignId: string, accountId: string = "default"): Promise<RevenueSummary> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const allRevenue = await db.select().from(revenueEntries)
    .where(revenueFilter(campaignId, accountId));
  const monthRevEntries = allRevenue.filter(r => r.createdAt && r.createdAt >= monthStart);

  const allSpend = await db.select().from(adSpendEntries)
    .where(spendFilter(campaignId, accountId));
  const monthSpendEntries = allSpend.filter(s => s.createdAt && s.createdAt >= monthStart);

  const totalRevenue = allRevenue.reduce((s, e) => s + (e.amount || 0), 0);
  const monthRevenue = monthRevEntries.reduce((s, e) => s + (e.amount || 0), 0);
  const totalSpend = allSpend.reduce((s, e) => s + (e.amount || 0), 0);
  const monthSpend = monthSpendEntries.reduce((s, e) => s + (e.amount || 0), 0);

  const byPost: Record<string, number> = {};
  const byCampaign: Record<string, number> = {};
  const byFunnelStage: Record<string, number> = {};
  for (const r of allRevenue) {
    if (r.postId) byPost[r.postId] = (byPost[r.postId] || 0) + (r.amount || 0);
    if (r.campaignId) byCampaign[r.campaignId] = (byCampaign[r.campaignId] || 0) + (r.amount || 0);
    if (r.funnelStage) byFunnelStage[r.funnelStage] = (byFunnelStage[r.funnelStage] || 0) + (r.amount || 0);
  }

  const revenueByContent = Object.entries(byPost)
    .map(([postId, revenue]) => ({ postId, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const posts = await db.select().from(publishedPosts)
    .where(postsFilter(campaignId, accountId));
  const postMap = new Map(posts.map(p => [p.id, p]));

  const topRevenueContent = revenueByContent.slice(0, 10).map(item => ({
    postId: item.postId,
    revenue: item.revenue,
    caption: postMap.get(item.postId)?.caption?.substring(0, 100),
  }));

  const perfData = await db.select().from(performanceSnapshots)
    .where(snapshotFilter(campaignId, accountId));
  const byContentCluster: Record<string, number> = {};
  for (const snap of perfData) {
    const cluster = snap.contentAngle || snap.contentType || "unknown";
    const snapRevenue = allRevenue
      .filter(r => r.postId === snap.postId)
      .reduce((s, r) => s + (r.amount || 0), 0);
    if (snapRevenue > 0) {
      byContentCluster[cluster] = (byContentCluster[cluster] || 0) + snapRevenue;
    }
  }

  const allCtaVariants = await db.select().from(ctaVariants)
    .where(and(eq(ctaVariants.accountId, accountId), eq(ctaVariants.campaignId, campaignId)));
  const revenueByCtaVariant: Array<{ ctaVariantId: string; ctaText: string; revenue: number; conversions: number }> = [];
  for (const cta of allCtaVariants) {
    const ctaRevenue = allRevenue
      .filter(r => r.ctaVariantId === cta.id)
      .reduce((s, r) => s + (r.amount || 0), 0);
    const ctaConversions = allRevenue.filter(r => r.ctaVariantId === cta.id).length;
    revenueByCtaVariant.push({
      ctaVariantId: cta.id,
      ctaText: cta.ctaText,
      revenue: ctaRevenue,
      conversions: ctaConversions,
    });
  }
  revenueByCtaVariant.sort((a, b) => b.revenue - a.revenue);

  const allLeads = await db.select().from(leads)
    .where(leadsFilter(campaignId, accountId));
  const monthLeads = allLeads.filter(l => l.createdAt && l.createdAt >= monthStart);
  const convertedLeads = allLeads.filter(l => l.status === "converted");

  const allConversions = await db.select().from(conversionEvents)
    .where(conversionFilter(campaignId, accountId));
  const conversionByLeadId = new Map<string, typeof allConversions[0]>();
  for (const conv of allConversions) {
    if (conv.leadId && !conversionByLeadId.has(conv.leadId)) {
      conversionByLeadId.set(conv.leadId, conv);
    }
  }
  const revenueByLeadId = new Map<string, typeof allRevenue[0]>();
  for (const rev of allRevenue) {
    if (rev.leadId && !revenueByLeadId.has(rev.leadId)) {
      revenueByLeadId.set(rev.leadId, rev);
    }
  }

  const leadToCustomerMap: LeadToCustomerMapping[] = [];
  const conversionTimes: number[] = [];
  for (const lead of convertedLeads) {
    const conv = conversionByLeadId.get(lead.id);
    const rev = revenueByLeadId.get(lead.id);
    let timeToConversionHours: number | null = null;
    if (lead.createdAt && conv?.createdAt) {
      timeToConversionHours = (conv.createdAt.getTime() - lead.createdAt.getTime()) / (1000 * 60 * 60);
      conversionTimes.push(timeToConversionHours);
    }
    leadToCustomerMap.push({
      leadId: lead.id,
      leadCreatedAt: lead.createdAt,
      conversionEventId: conv?.id || null,
      conversionAt: conv?.createdAt || null,
      revenueEntryId: rev?.id || null,
      revenueAmount: rev?.amount || 0,
      timeToConversionHours,
    });
  }

  const avgTimeToConversion = conversionTimes.length > 0
    ? (conversionTimes.reduce((s, t) => s + t, 0) / conversionTimes.length).toFixed(1)
    : "N/A";

  return {
    campaignId,
    totalRevenue,
    monthRevenue,
    totalSpend,
    monthSpend,
    roas: totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : "N/A",
    monthRoas: monthSpend > 0 ? (monthRevenue / monthSpend).toFixed(2) : "N/A",
    revenueByContent,
    revenueByCampaign: byCampaign,
    revenueByFunnelStage: byFunnelStage,
    revenueByContentCluster: byContentCluster,
    revenueByCtaVariant,
    leadToCustomerMap,
    topRevenueContent,
    costPerLead: monthLeads.length > 0 ? (monthSpend / monthLeads.length).toFixed(2) : "0",
    leadToCustomerRate: allLeads.length > 0 ? ((convertedLeads.length / allLeads.length) * 100).toFixed(1) : "0",
    avgTimeToConversionHours: avgTimeToConversion,
  };
}

async function computeDataTimeSpanHours(campaignId: string, accountId: string): Promise<{ hours: number; source: string }> {
  const snapshotSpan = await db.select({
    minTs: min(performanceSnapshots.fetchedAt),
    maxTs: max(performanceSnapshots.fetchedAt),
  }).from(performanceSnapshots)
    .where(snapshotFilter(campaignId, accountId));

  const spendSpan = await db.select({
    minTs: min(adSpendEntries.createdAt),
    maxTs: max(adSpendEntries.createdAt),
  }).from(adSpendEntries)
    .where(spendFilter(campaignId, accountId));

  const eventSpan = await db.select({
    minTs: min(conversionEvents.createdAt),
    maxTs: max(conversionEvents.createdAt),
  }).from(conversionEvents)
    .where(conversionFilter(campaignId, accountId));

  const sources = ["snapshots", "adSpend", "conversionEvents"];
  const results = [snapshotSpan[0], spendSpan[0], eventSpan[0]];
  let maxHours = 0;
  let maxSource = "none";

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.minTs && result?.maxTs) {
      const diffMs = new Date(result.maxTs).getTime() - new Date(result.minTs).getTime();
      const hours = diffMs / (1000 * 60 * 60);
      if (hours > maxHours) {
        maxHours = hours;
        maxSource = sources[i];
      }
    }
  }

  return { hours: maxHours, source: maxSource };
}

function computeRolling7DayBaseline(
  snapshots: any[],
  metricExtractor: (s: any) => number
): { current7d: number; prior7d: number; weekdayAvg: number | null; weekdayAvailable: boolean; all14d: number[] } {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const current7d = snapshots.filter(s => {
    const ts = s.fetchedAt || s.publishedAt;
    return ts && new Date(ts) >= sevenDaysAgo;
  });
  const prior7d = snapshots.filter(s => {
    const ts = s.fetchedAt || s.publishedAt;
    return ts && new Date(ts) >= fourteenDaysAgo && new Date(ts) < sevenDaysAgo;
  });

  const current7dValues = current7d.map(metricExtractor);
  const prior7dValues = prior7d.map(metricExtractor);
  const all14dValues = [...current7dValues, ...prior7dValues];

  const current7dAvg = current7dValues.length > 0
    ? current7dValues.reduce((s, v) => s + v, 0) / current7dValues.length : 0;
  const prior7dAvg = prior7dValues.length > 0
    ? prior7dValues.reduce((s, v) => s + v, 0) / prior7dValues.length : 0;

  const currentDayOfWeek = now.getDay();
  const sameWeekdaySnapshots = snapshots.filter(s => {
    const ts = s.fetchedAt || s.publishedAt;
    if (!ts) return false;
    const d = new Date(ts);
    return d.getDay() === currentDayOfWeek && d >= fourteenDaysAgo;
  });
  const sameWeekdayValues = sameWeekdaySnapshots.map(metricExtractor);
  const weekdayAvailable = sameWeekdayValues.length >= 2;
  const weekdayAvg = weekdayAvailable
    ? sameWeekdayValues.reduce((s, v) => s + v, 0) / sameWeekdayValues.length : null;

  return { current7d: current7dAvg, prior7d: prior7dAvg, weekdayAvg, weekdayAvailable, all14d: all14dValues };
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function validateSignal(
  metricName: string,
  currentValue: number,
  baselineValue: number,
  rolling: ReturnType<typeof computeRolling7DayBaseline>,
  rawSignalType: "SCALE_CANDIDATE" | "REVIEW_NEEDED"
): SignalValidation {
  const deltaPct = baselineValue > 0 ? ((currentValue - baselineValue) / baselineValue) * 100 : 0;
  const stdDev = computeStdDev(rolling.all14d);
  const mean14d = rolling.all14d.length > 0 ? rolling.all14d.reduce((s, v) => s + v, 0) / rolling.all14d.length : 0;
  const volatilityIndex = mean14d > 0 ? (stdDev / mean14d) * 100 : 0;

  const withinOneStdDev = Math.abs(currentValue - mean14d) <= stdDev && stdDev > 0;

  let seasonalityCheck: SeasonalityCheck;
  if (rolling.weekdayAvailable && rolling.weekdayAvg !== null) {
    const weekdayDelta = rolling.weekdayAvg > 0
      ? Math.abs((currentValue - rolling.weekdayAvg) / rolling.weekdayAvg) : 0;
    const isNormalSeasonal = weekdayDelta < 0.15;
    seasonalityCheck = {
      result: isNormalSeasonal ? "normal" : "anomalous",
      reason: isNormalSeasonal
        ? `Current value within 15% of same-weekday average (${rolling.weekdayAvg.toFixed(2)}). Normal seasonal pattern.`
        : `Current value deviates ${(weekdayDelta * 100).toFixed(1)}% from same-weekday average (${rolling.weekdayAvg.toFixed(2)}). Potential anomaly.`,
      weekdayAvailable: true,
      priorWindowAvg: rolling.prior7d,
      weekdayAvg: rolling.weekdayAvg,
    };
  } else {
    const priorDelta = rolling.prior7d > 0
      ? Math.abs((rolling.current7d - rolling.prior7d) / rolling.prior7d) : 0;
    const isNormalPrior = priorDelta < 0.15;
    seasonalityCheck = {
      result: "insufficientData",
      reason: rolling.prior7d > 0
        ? `Weekday history insufficient. Fallback: current 7d avg (${rolling.current7d.toFixed(2)}) vs prior 7d avg (${rolling.prior7d.toFixed(2)}), delta ${(priorDelta * 100).toFixed(1)}%.`
        : `Insufficient historical data for both weekday and prior-window comparison.`,
      weekdayAvailable: false,
      priorWindowAvg: rolling.prior7d,
      weekdayAvg: null,
    };
  }

  let confidenceScore = 50;

  if (!withinOneStdDev) {
    const sigmas = stdDev > 0 ? Math.abs(currentValue - mean14d) / stdDev : 0;
    confidenceScore += Math.min(sigmas * 15, 40);
  } else {
    confidenceScore -= 20;
  }

  if (seasonalityCheck.result === "anomalous") {
    confidenceScore += 10;
  } else if (seasonalityCheck.result === "normal") {
    confidenceScore -= 15;
  }

  const prior7dDelta = rolling.prior7d > 0
    ? Math.abs((rolling.current7d - rolling.prior7d) / rolling.prior7d) : 0;
  if (prior7dDelta > 0.2) {
    confidenceScore += 10;
  }

  confidenceScore = Math.max(0, Math.min(100, Math.round(confidenceScore)));

  let validationStatus: "ACTIONABLE" | "LOW_CONFIDENCE" | "NORMAL_VARIATION";
  let reasonSummary: string;

  if (withinOneStdDev) {
    validationStatus = "NORMAL_VARIATION";
    reasonSummary = `${metricName} delta of ${deltaPct.toFixed(1)}% falls within 1 standard deviation (σ=${stdDev.toFixed(2)}) of 14-day mean (${mean14d.toFixed(2)}). This is normal volatility, not a reliable signal.`;
  } else if (confidenceScore < CONFIDENCE_THRESHOLD) {
    validationStatus = "LOW_CONFIDENCE";
    reasonSummary = `${metricName} shows ${deltaPct.toFixed(1)}% change but confidence is ${confidenceScore}% (below ${CONFIDENCE_THRESHOLD}% threshold). ${seasonalityCheck.reason}`;
  } else {
    validationStatus = "ACTIONABLE";
    const direction = rawSignalType === "SCALE_CANDIDATE" ? "outperforming" : "underperforming";
    reasonSummary = `${metricName} is ${direction} baseline by ${Math.abs(deltaPct).toFixed(1)}% with ${confidenceScore}% confidence. Signal exceeds 1σ volatility band (σ=${stdDev.toFixed(2)}). ${seasonalityCheck.result === "anomalous" ? "Seasonal pattern confirms anomaly." : ""}`.trim();
  }

  return {
    validationStatus,
    confidenceScore,
    volatilityIndex: Math.round(volatilityIndex * 100) / 100,
    volatilityStdDev: Math.round(stdDev * 1000) / 1000,
    deltaPct: Math.round(deltaPct * 100) / 100,
    baselineWindow: "7d_rolling",
    comparisonWindow: "prior_7d",
    seasonalityCheck,
    reasonSummary,
  };
}

function getExpansionSuggestion(metric: string, ratio: number): ExpansionSuggestion {
  const budgetIncrease = Math.min(Math.round((ratio - 1) * 50), 100);

  let audienceExpansion: "lookalike" | "interest_expansion" | "retargeting_depth";
  if (metric === "reach" || metric === "impressions") {
    audienceExpansion = "lookalike";
  } else if (metric === "ctr" || metric === "engagement" || metric === "saves") {
    audienceExpansion = "interest_expansion";
  } else {
    audienceExpansion = "retargeting_depth";
  }

  return {
    suggestedBudgetIncreasePct: budgetIncrease,
    suggestedAudienceExpansion: audienceExpansion,
    rationale: `${metric} at ${ratio.toFixed(1)}x baseline suggests ${budgetIncrease}% budget increase with ${audienceExpansion.replace(/_/g, " ")} strategy.`,
  };
}

function isDuplicateSignal(campaignId: string, metric: string, deltaPct: number): boolean {
  const cacheKey = `${campaignId}:${metric}`;
  const cached = signalCache.get(cacheKey);
  if (!cached) return false;

  const hoursSince = (Date.now() - cached.emittedAt) / (1000 * 60 * 60);
  if (hoursSince >= SIGNAL_DEDUP_HOURS) return false;

  const deltaShift = Math.abs(deltaPct - cached.deltaPct) / (Math.abs(cached.deltaPct) || 1);
  return deltaShift < SIGNAL_DEDUP_DELTA_SHIFT;
}

function recordSignalEmission(campaignId: string, metric: string, deltaPct: number): void {
  const cacheKey = `${campaignId}:${metric}`;
  signalCache.set(cacheKey, { emittedAt: Date.now(), deltaPct });
}

async function checkDataIntegrity(campaignId: string, accountId: string, totalSpend: number, snapshotCount: number, totalConversions: number): Promise<void> {
  if (totalSpend > 0 && snapshotCount === 0 && totalConversions === 0) {
    console.warn(`${LOG_PREFIX} [INTEGRITY] Campaign ${campaignId}: Spend exists ($${totalSpend.toFixed(2)}) but zero snapshots and zero conversions. Possible data gap.`);
    await logAudit(accountId, "DATA_INTEGRITY_WARNING", {
      details: {
        campaignId,
        issue: "spend_without_data",
        totalSpend,
        snapshotCount,
        totalConversions,
        message: "Ad spend recorded but no performance snapshots or conversion events found. Data may be incomplete.",
      },
    });
  }
  if (totalSpend > 0 && snapshotCount > 10 && totalConversions === 0) {
    console.warn(`${LOG_PREFIX} [INTEGRITY] Campaign ${campaignId}: Spend ($${totalSpend.toFixed(2)}) with ${snapshotCount} snapshots but zero conversions. Tracking may be broken.`);
    await logAudit(accountId, "DATA_INTEGRITY_WARNING", {
      details: {
        campaignId,
        issue: "snapshots_without_conversions",
        totalSpend,
        snapshotCount,
        totalConversions,
        message: "Performance data exists with spend but no conversions recorded. Conversion tracking may be misconfigured.",
      },
    });
  }
}

export async function detectPerformanceSignals(campaignId: string, accountId: string = "default"): Promise<PerformanceSignal[]> {
  const signals: PerformanceSignal[] = [];

  console.log(`${LOG_PREFIX} [SignalDetection] Starting for campaign=${campaignId}, account=${accountId}`);
  console.log(`${LOG_PREFIX} [ConversionSource] Using conversionEvents table exclusively (unified source)`);

  const perfData = await db.select().from(performanceSnapshots)
    .where(snapshotFilter(campaignId, accountId))
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(200);

  const defaultValidation: SignalValidation = {
    validationStatus: "ACTIONABLE",
    confidenceScore: 0,
    volatilityIndex: 0,
    volatilityStdDev: 0,
    deltaPct: 0,
    baselineWindow: "N/A",
    comparisonWindow: "N/A",
    seasonalityCheck: { result: "insufficientData", reason: "Not enough data for validation", weekdayAvailable: false, priorWindowAvg: 0, weekdayAvg: null },
    reasonSummary: "Insufficient data",
  };

  if (perfData.length < 5) {
    console.log(`${LOG_PREFIX} [Safeguard] Data volume insufficient: ${perfData.length} snapshots (need 5)`);
    return [{
      signalType: "INSUFFICIENT_DATA_FOR_SIGNALS",
      metric: "data_volume",
      currentValue: perfData.length,
      baselineValue: 5,
      ratio: 0,
      deltaPct: 0,
      message: `Only ${perfData.length} snapshots available for campaign ${campaignId}. Minimum 5 required.`,
      reasoning: "Signal detection requires at least 5 performance snapshots to establish a meaningful baseline.",
      validation: defaultValidation,
    }];
  }

  const allSpend = await db.select().from(adSpendEntries)
    .where(spendFilter(campaignId, accountId));
  const totalSpend = allSpend.reduce((s, e) => s + (e.amount || 0), 0);

  const allConversions = await db.select().from(conversionEvents)
    .where(conversionFilter(campaignId, accountId));
  const totalConversions = allConversions.length;

  const timeSpanResult = await computeDataTimeSpanHours(campaignId, accountId);

  const spendMet = totalSpend >= MIN_SPEND_THRESHOLD;
  const timeMet = timeSpanResult.hours >= MIN_TIMESPAN_HOURS;
  const convMet = totalConversions >= MIN_CONVERSIONS_THRESHOLD;
  const safeguardsPassed = [spendMet, timeMet, convMet].filter(Boolean).length;

  console.log(`${LOG_PREFIX} [Safeguards] Spend: $${totalSpend.toFixed(2)}/${MIN_SPEND_THRESHOLD} (${spendMet ? 'PASS' : 'FAIL'}), TimeSpan: ${timeSpanResult.hours.toFixed(0)}h/${MIN_TIMESPAN_HOURS}h via ${timeSpanResult.source} (${timeMet ? 'PASS' : 'FAIL'}), Conversions: ${totalConversions}/${MIN_CONVERSIONS_THRESHOLD} from conversionEvents (${convMet ? 'PASS' : 'FAIL'}). Result: ${safeguardsPassed}/3 passed (need 2).`);

  await checkDataIntegrity(campaignId, accountId, totalSpend, perfData.length, totalConversions);

  if (safeguardsPassed < 2) {
    return [{
      signalType: "INSUFFICIENT_DATA_FOR_SIGNALS",
      metric: "minimum_data_safeguard",
      currentValue: safeguardsPassed,
      baselineValue: 2,
      ratio: 0,
      deltaPct: 0,
      message: `Insufficient data for reliable signals. Spend: $${totalSpend.toFixed(2)}/${MIN_SPEND_THRESHOLD} (${spendMet ? 'met' : 'not met'}), TimeSpan: ${timeSpanResult.hours.toFixed(0)}h/${MIN_TIMESPAN_HOURS}h (${timeMet ? 'met' : 'not met'}), Conversions: ${totalConversions}/${MIN_CONVERSIONS_THRESHOLD} (${convMet ? 'met' : 'not met'}). Need 2 of 3 thresholds.`,
      reasoning: `Safeguard check: ${safeguardsPassed} of 3 minimum-data thresholds met. Time span source: ${timeSpanResult.source}. Conversion source: conversionEvents table.`,
      validation: defaultValidation,
    }];
  }

  if (totalConversions === 0 && spendMet && timeMet) {
    signals.push({
      signalType: "REVIEW_NEEDED",
      metric: "zero_conversions",
      currentValue: 0,
      baselineValue: MIN_CONVERSIONS_THRESHOLD,
      ratio: 0,
      deltaPct: -100,
      message: `Zero conversions detected despite $${totalSpend.toFixed(2)} spend over ${timeSpanResult.hours.toFixed(0)}h. Campaign may need creative/targeting overhaul.`,
      reasoning: "Spend and time thresholds are met but conversion tracking shows zero events. This indicates a fundamental campaign performance issue or broken conversion tracking.",
      validation: {
        ...defaultValidation,
        validationStatus: "ACTIONABLE",
        confidenceScore: 95,
        deltaPct: -100,
        reasonSummary: "Zero conversions with meaningful spend is a high-confidence signal requiring immediate review.",
      },
    });
  }

  const metricExtractors: Record<string, (s: any) => number> = {
    reach: (s) => s.reach || 0,
    ctr: (s) => s.ctr || 0,
    cpa: (s) => s.cpa || 0,
    roas: (s) => s.roas || 0,
    saves: (s) => s.saves || 0,
    shares: (s) => s.shares || 0,
    conversions: (s) => s.conversions || 0,
    engagement: (s) => (s.likes || 0) + (s.comments || 0) + (s.shares || 0) + (s.saves || 0),
  };

  const rollingBaselines: Record<string, ReturnType<typeof computeRolling7DayBaseline>> = {};
  for (const [name, extractor] of Object.entries(metricExtractors)) {
    rollingBaselines[name] = computeRolling7DayBaseline(perfData, extractor);
  }

  const count = perfData.length;
  const recentWindow = perfData.slice(0, Math.min(10, Math.floor(count * 0.2)));

  for (const post of recentWindow) {
    const metricChecks: Array<{ name: string; value: number }> = [
      { name: "reach", value: post.reach || 0 },
      { name: "ctr", value: post.ctr || 0 },
      { name: "saves", value: post.saves || 0 },
      { name: "shares", value: post.shares || 0 },
      { name: "conversions", value: post.conversions || 0 },
      { name: "engagement", value: (post.likes || 0) + (post.comments || 0) + (post.shares || 0) + (post.saves || 0) },
    ];

    for (const m of metricChecks) {
      const rolling = rollingBaselines[m.name];
      if (!rolling || rolling.current7d <= 0) continue;

      const baseline = rolling.current7d;
      const ratio = m.value / baseline;
      const deltaPct = ((m.value - baseline) / baseline) * 100;

      if (ratio >= SCALE_THRESHOLD) {
        if (isDuplicateSignal(campaignId, `post_${m.name}`, deltaPct)) {
          console.log(`${LOG_PREFIX} [Dedup] Skipping duplicate SCALE signal for ${m.name} (deltaPct=${deltaPct.toFixed(1)}%)`);
          continue;
        }

        const validation = validateSignal(m.name, m.value, baseline, rolling, "SCALE_CANDIDATE");

        let finalSignalType: PerformanceSignal["signalType"] = "SCALE_CANDIDATE";
        if (validation.validationStatus === "NORMAL_VARIATION") {
          finalSignalType = "NORMAL_VARIATION";
          await logAudit(accountId, "SIGNAL_SUPPRESSED", {
            details: { campaignId, metric: m.name, postId: post.postId, deltaPct, confidenceScore: validation.confidenceScore, reason: validation.reasonSummary },
          });
        } else if (validation.validationStatus === "LOW_CONFIDENCE") {
          finalSignalType = "LOW_CONFIDENCE";
          await logAudit(accountId, "SIGNAL_DOWNGRADED", {
            details: { campaignId, metric: m.name, postId: post.postId, deltaPct, confidenceScore: validation.confidenceScore, reason: validation.reasonSummary },
          });
        }

        const signal: PerformanceSignal = {
          signalType: finalSignalType,
          metric: m.name,
          currentValue: m.value,
          baselineValue: Math.round(baseline * 100) / 100,
          ratio: Math.round(ratio * 100) / 100,
          deltaPct: Math.round(deltaPct * 100) / 100,
          postId: post.postId || undefined,
          contentType: post.contentType || undefined,
          message: `${m.name} is +${deltaPct.toFixed(1)}% above 7-day baseline (${m.value} vs avg ${baseline.toFixed(1)}).`,
          reasoning: validation.reasonSummary,
          validation,
        };

        if (finalSignalType === "SCALE_CANDIDATE") {
          signal.expansionSuggestion = getExpansionSuggestion(m.name, ratio);
        }

        signals.push(signal);
        recordSignalEmission(campaignId, `post_${m.name}`, deltaPct);

      } else if (ratio <= REVIEW_THRESHOLD) {
        if (isDuplicateSignal(campaignId, `post_${m.name}`, deltaPct)) {
          console.log(`${LOG_PREFIX} [Dedup] Skipping duplicate REVIEW signal for ${m.name} (deltaPct=${deltaPct.toFixed(1)}%)`);
          continue;
        }

        const validation = validateSignal(m.name, m.value, baseline, rolling, "REVIEW_NEEDED");

        let finalSignalType: PerformanceSignal["signalType"] = "REVIEW_NEEDED";
        if (validation.validationStatus === "NORMAL_VARIATION") {
          finalSignalType = "NORMAL_VARIATION";
          await logAudit(accountId, "SIGNAL_SUPPRESSED", {
            details: { campaignId, metric: m.name, postId: post.postId, deltaPct, confidenceScore: validation.confidenceScore, reason: validation.reasonSummary },
          });
        } else if (validation.validationStatus === "LOW_CONFIDENCE") {
          finalSignalType = "LOW_CONFIDENCE";
          await logAudit(accountId, "SIGNAL_DOWNGRADED", {
            details: { campaignId, metric: m.name, postId: post.postId, deltaPct, confidenceScore: validation.confidenceScore, reason: validation.reasonSummary },
          });
        }

        signals.push({
          signalType: finalSignalType,
          metric: m.name,
          currentValue: m.value,
          baselineValue: Math.round(baseline * 100) / 100,
          ratio: Math.round(ratio * 100) / 100,
          deltaPct: Math.round(deltaPct * 100) / 100,
          postId: post.postId || undefined,
          contentType: post.contentType || undefined,
          message: `${m.name} dropped ${Math.abs(deltaPct).toFixed(1)}% below 7-day baseline (${m.value} vs avg ${baseline.toFixed(1)}).`,
          reasoning: validation.reasonSummary,
          validation,
        });
        recordSignalEmission(campaignId, `post_${m.name}`, deltaPct);
      }
    }
  }

  const cpRolling = rollingBaselines["cpa"];
  if (cpRolling && cpRolling.current7d > 0) {
    const recentCpa = recentWindow.reduce((s, p) => s + (p.cpa || 0), 0) / (recentWindow.length || 1);
    const cpaBaseline = cpRolling.current7d;
    const cpaRatio = recentCpa / cpaBaseline;
    const cpaDeltaPct = ((recentCpa - cpaBaseline) / cpaBaseline) * 100;

    if (cpaRatio >= SCALE_THRESHOLD && !isDuplicateSignal(campaignId, "campaign_cpa", cpaDeltaPct)) {
      const validation = validateSignal("campaign_cpa", recentCpa, cpaBaseline, cpRolling, "REVIEW_NEEDED");
      let finalType: PerformanceSignal["signalType"] = "REVIEW_NEEDED";
      if (validation.validationStatus === "NORMAL_VARIATION") {
        finalType = "NORMAL_VARIATION";
        await logAudit(accountId, "SIGNAL_SUPPRESSED", { details: { campaignId, metric: "campaign_cpa", deltaPct: cpaDeltaPct, reason: validation.reasonSummary } });
      } else if (validation.validationStatus === "LOW_CONFIDENCE") {
        finalType = "LOW_CONFIDENCE";
        await logAudit(accountId, "SIGNAL_DOWNGRADED", { details: { campaignId, metric: "campaign_cpa", deltaPct: cpaDeltaPct, reason: validation.reasonSummary } });
      }
      signals.push({
        signalType: finalType,
        metric: "campaign_cpa",
        currentValue: Math.round(recentCpa * 100) / 100,
        baselineValue: Math.round(cpaBaseline * 100) / 100,
        ratio: Math.round(cpaRatio * 100) / 100,
        deltaPct: Math.round(cpaDeltaPct * 100) / 100,
        message: `Campaign CPA rose +${cpaDeltaPct.toFixed(1)}% vs 7-day baseline ($${recentCpa.toFixed(2)} vs avg $${cpaBaseline.toFixed(2)}).`,
        reasoning: validation.reasonSummary,
        validation,
      });
      recordSignalEmission(campaignId, "campaign_cpa", cpaDeltaPct);
    } else if (cpaRatio <= REVIEW_THRESHOLD && !isDuplicateSignal(campaignId, "campaign_cpa", cpaDeltaPct)) {
      const validation = validateSignal("campaign_cpa", recentCpa, cpaBaseline, cpRolling, "SCALE_CANDIDATE");
      let finalType: PerformanceSignal["signalType"] = "SCALE_CANDIDATE";
      if (validation.validationStatus === "NORMAL_VARIATION") {
        finalType = "NORMAL_VARIATION";
        await logAudit(accountId, "SIGNAL_SUPPRESSED", { details: { campaignId, metric: "campaign_cpa", deltaPct: cpaDeltaPct, reason: validation.reasonSummary } });
      } else if (validation.validationStatus === "LOW_CONFIDENCE") {
        finalType = "LOW_CONFIDENCE";
        await logAudit(accountId, "SIGNAL_DOWNGRADED", { details: { campaignId, metric: "campaign_cpa", deltaPct: cpaDeltaPct, reason: validation.reasonSummary } });
      }
      const signal: PerformanceSignal = {
        signalType: finalType,
        metric: "campaign_cpa",
        currentValue: Math.round(recentCpa * 100) / 100,
        baselineValue: Math.round(cpaBaseline * 100) / 100,
        ratio: Math.round(cpaRatio * 100) / 100,
        deltaPct: Math.round(cpaDeltaPct * 100) / 100,
        message: `Campaign CPA dropped ${Math.abs(cpaDeltaPct).toFixed(1)}% below 7-day baseline ($${recentCpa.toFixed(2)} vs avg $${cpaBaseline.toFixed(2)}). Efficiency improving.`,
        reasoning: validation.reasonSummary,
        validation,
      };
      if (finalType === "SCALE_CANDIDATE") {
        signal.expansionSuggestion = getExpansionSuggestion("campaign_cpa", 1 / cpaRatio);
      }
      signals.push(signal);
      recordSignalEmission(campaignId, "campaign_cpa", cpaDeltaPct);
    }
  }

  const actionable = signals.filter(s => s.signalType === "SCALE_CANDIDATE" || s.signalType === "REVIEW_NEEDED").length;
  const suppressed = signals.filter(s => s.signalType === "NORMAL_VARIATION").length;
  const lowConf = signals.filter(s => s.signalType === "LOW_CONFIDENCE").length;
  console.log(`${LOG_PREFIX} [SignalDetection] Complete. Total: ${signals.length}, Actionable: ${actionable}, NormalVariation: ${suppressed}, LowConfidence: ${lowConf}`);

  return signals;
}
