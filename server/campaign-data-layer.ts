import { db } from "./db";
import {
  performanceSnapshots,
  revenueEntries,
  adSpendEntries,
  leads,
  conversionEvents,
  publishedPosts,
  strategyInsights,
  strategyDecisions,
  strategyMemory,
  baselineHistory,
} from "@shared/schema";
import { eq, desc, sql, gte, and } from "drizzle-orm";

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
  topRevenueContent: Array<{ postId: string; revenue: number; caption?: string }>;
  costPerLead: string;
  leadToCustomerRate: string;
}

export interface PerformanceSignal {
  signalType: "SCALE_CANDIDATE" | "REVIEW_NEEDED";
  metric: string;
  currentValue: number;
  baselineValue: number;
  ratio: number;
  postId?: string;
  contentType?: string;
  message: string;
}

const SCALE_THRESHOLD = 1.5;
const REVIEW_THRESHOLD = 0.7;

export async function getCampaignMetrics(campaignId: string, accountId: string = "default"): Promise<CampaignMetrics> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const perfData = await db.select().from(performanceSnapshots)
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(200);

  const allRevenue = await db.select().from(revenueEntries)
    .where(eq(revenueEntries.accountId, accountId));

  const allSpend = await db.select().from(adSpendEntries)
    .where(eq(adSpendEntries.accountId, accountId));

  const allLeads = await db.select().from(leads)
    .where(eq(leads.accountId, accountId));

  const posts = await db.select().from(publishedPosts)
    .where(eq(publishedPosts.accountId, accountId));

  const totalSpend = allSpend.reduce((s, e) => s + (e.amount || 0), 0);
  const totalRevenue = allRevenue.reduce((s, e) => s + (e.amount || 0), 0);
  const totalConversions = perfData.reduce((s, p) => s + (p.conversions || 0), 0);
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
  const monthConversions = perfData
    .filter(p => p.fetchedAt && p.fetchedAt >= monthStart)
    .reduce((s, p) => s + (p.conversions || 0), 0);

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
    .where(eq(revenueEntries.accountId, accountId));
  const monthRevEntries = allRevenue.filter(r => r.createdAt && r.createdAt >= monthStart);

  const allSpend = await db.select().from(adSpendEntries)
    .where(eq(adSpendEntries.accountId, accountId));
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
    .where(eq(publishedPosts.accountId, accountId));
  const postMap = new Map(posts.map(p => [p.id, p]));

  const topRevenueContent = revenueByContent.slice(0, 10).map(item => ({
    postId: item.postId,
    revenue: item.revenue,
    caption: postMap.get(item.postId)?.caption?.substring(0, 100),
  }));

  const allLeads = await db.select().from(leads)
    .where(eq(leads.accountId, accountId));
  const monthLeads = allLeads.filter(l => l.createdAt && l.createdAt >= monthStart);
  const convertedLeads = allLeads.filter(l => l.status === "converted");

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
    topRevenueContent,
    costPerLead: monthLeads.length > 0 ? (monthSpend / monthLeads.length).toFixed(2) : "0",
    leadToCustomerRate: allLeads.length > 0 ? ((convertedLeads.length / allLeads.length) * 100).toFixed(1) : "0",
  };
}

export async function detectPerformanceSignals(campaignId: string, accountId: string = "default"): Promise<PerformanceSignal[]> {
  const signals: PerformanceSignal[] = [];

  const perfData = await db.select().from(performanceSnapshots)
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(100);

  if (perfData.length < 5) return signals;

  const count = perfData.length;
  const baselines = {
    reach: perfData.reduce((s, p) => s + (p.reach || 0), 0) / count,
    ctr: perfData.reduce((s, p) => s + (p.ctr || 0), 0) / count,
    cpa: perfData.reduce((s, p) => s + (p.cpa || 0), 0) / count,
    roas: perfData.reduce((s, p) => s + (p.roas || 0), 0) / count,
    saves: perfData.reduce((s, p) => s + (p.saves || 0), 0) / count,
    shares: perfData.reduce((s, p) => s + (p.shares || 0), 0) / count,
    conversions: perfData.reduce((s, p) => s + (p.conversions || 0), 0) / count,
    engagement: perfData.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0), 0) / count,
  };

  const recentWindow = perfData.slice(0, Math.min(10, Math.floor(count * 0.2)));

  for (const post of recentWindow) {
    const metrics: Array<{ name: string; value: number; baseline: number }> = [
      { name: "reach", value: post.reach || 0, baseline: baselines.reach },
      { name: "ctr", value: post.ctr || 0, baseline: baselines.ctr },
      { name: "saves", value: post.saves || 0, baseline: baselines.saves },
      { name: "shares", value: post.shares || 0, baseline: baselines.shares },
      { name: "conversions", value: post.conversions || 0, baseline: baselines.conversions },
    ];

    const engagement = (post.likes || 0) + (post.comments || 0) + (post.shares || 0) + (post.saves || 0);
    metrics.push({ name: "engagement", value: engagement, baseline: baselines.engagement });

    for (const m of metrics) {
      if (m.baseline <= 0) continue;
      const ratio = m.value / m.baseline;

      if (ratio >= SCALE_THRESHOLD) {
        signals.push({
          signalType: "SCALE_CANDIDATE",
          metric: m.name,
          currentValue: m.value,
          baselineValue: Math.round(m.baseline * 100) / 100,
          ratio: Math.round(ratio * 100) / 100,
          postId: post.postId || undefined,
          contentType: post.contentType || undefined,
          message: `${m.name} is ${ratio.toFixed(1)}x above baseline (${m.value} vs avg ${m.baseline.toFixed(1)}). Consider scaling.`,
        });
      } else if (ratio <= REVIEW_THRESHOLD) {
        signals.push({
          signalType: "REVIEW_NEEDED",
          metric: m.name,
          currentValue: m.value,
          baselineValue: Math.round(m.baseline * 100) / 100,
          ratio: Math.round(ratio * 100) / 100,
          postId: post.postId || undefined,
          contentType: post.contentType || undefined,
          message: `${m.name} dropped to ${ratio.toFixed(1)}x of baseline (${m.value} vs avg ${m.baseline.toFixed(1)}). Review creative/offer.`,
        });
      }
    }
  }

  if (baselines.cpa > 0) {
    const recentCpa = recentWindow.reduce((s, p) => s + (p.cpa || 0), 0) / (recentWindow.length || 1);
    const cpaRatio = recentCpa / baselines.cpa;
    if (cpaRatio >= SCALE_THRESHOLD) {
      signals.push({
        signalType: "REVIEW_NEEDED",
        metric: "campaign_cpa",
        currentValue: Math.round(recentCpa * 100) / 100,
        baselineValue: Math.round(baselines.cpa * 100) / 100,
        ratio: Math.round(cpaRatio * 100) / 100,
        message: `Campaign CPA has risen to ${cpaRatio.toFixed(1)}x baseline ($${recentCpa.toFixed(2)} vs avg $${baselines.cpa.toFixed(2)}). Review campaign efficiency.`,
      });
    } else if (cpaRatio <= REVIEW_THRESHOLD) {
      signals.push({
        signalType: "SCALE_CANDIDATE",
        metric: "campaign_cpa",
        currentValue: Math.round(recentCpa * 100) / 100,
        baselineValue: Math.round(baselines.cpa * 100) / 100,
        ratio: Math.round(cpaRatio * 100) / 100,
        message: `Campaign CPA dropped to ${cpaRatio.toFixed(1)}x baseline ($${recentCpa.toFixed(2)} vs avg $${baselines.cpa.toFixed(2)}). Efficiency improving — consider scaling.`,
      });
    }
  }

  return signals;
}
