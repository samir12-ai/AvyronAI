import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  CompetitorEntityRole,
  CompetitorClassification,
  CompetitorTier,
  JudgeVerdict,
} from "@shared/contracts/discovery-contracts";
import { evaluateCompetitorQuality } from "../discovery/competitor-quality-pipeline";

export interface QualityRevalidationCandidateResult {
  competitorId: string;
  name: string;
  domain: string;
  websiteUrl: string;
  currentTier: string;
  entityRole: CompetitorEntityRole;
  entityRoleReasoning: string;
  relevanceClassification: CompetitorClassification;
  relevanceReason: string;
  judgeVerdict: JudgeVerdict;
  judgeFinalReason: string;
  action: "KEEP_ACTIVE" | "KEEP_AS_BENCHMARK" | "DEACTIVATE_NOT_COMPETITOR" | "DEACTIVATE_INSUFFICIENT_EVIDENCE";
  evidenceSnippet: string;
}

export interface CompetitorQualityRevalidationReport {
  accountId: string;
  campaignId: string;
  dryRun: boolean;
  activeBefore: number;
  activeAfter: number;
  keepActiveCount: number;
  keepAsBenchmarkCount: number;
  deactivatedNotCompetitorCount: number;
  deactivatedInsufficientEvidenceCount: number;
  candidates: QualityRevalidationCandidateResult[];
  success: boolean;
}

/**
 * Normalizes a URL/domain to canonical hostname.
 */
function getHostname(urlStr: string): string {
  try {
    const u = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return urlStr.toLowerCase();
  }
}

/**
 * Revalidates all currently active canonical competitors against the unified
 * entity-role and relevance contract.
 */
export async function revalidateCanonicalCompetitors(options: {
  accountId: string;
  campaignId: string;
  dryRun?: boolean;
}): Promise<CompetitorQualityRevalidationReport> {
  const { accountId, campaignId, dryRun = false } = options;

  // 1. Fetch current canonical Business Understanding snapshot
  const [buSnap] = await db
    .select()
    .from(schema.businessUnderstandingSnapshots)
    .where(and(
      eq(schema.businessUnderstandingSnapshots.accountId, accountId),
      eq(schema.businessUnderstandingSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(schema.businessUnderstandingSnapshots.createdAt))
    .limit(1);

  const buPayload: any = buSnap?.businessUnderstanding || {};
  const offeringName = buPayload.campaignOffering?.offeringName || "summer dresses";
  const category = buPayload.campaignOffering?.category || "Modest Fashion / Dresses";
  const targetMarket = buPayload.targetUnderstanding?.geography || "Lebanon / Middle East";
  const productTruthFacts = (buPayload.campaignOffering?.productTruthFacts || []).map((f: any) => typeof f === "string" ? f : f.statement);
  const targetRoles = (buPayload.targetUnderstanding?.targetRoles || []).map((r: any) => typeof r === "string" ? r : r.roleTitle);

  // 2. Fetch all active canonical competitors
  const activeComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId),
      eq(schema.ciCompetitors.isActive, true)
    ));

  const candidateResults: QualityRevalidationCandidateResult[] = [];

  for (const comp of activeComps) {
    const rawUrl = comp.websiteUrl || comp.profileLink || "";
    const domain = getHostname(rawUrl);

    // Fetch existing stored web data or website snapshots
    const webDataRows = await db
      .select()
      .from(schema.competitorWebData)
      .where(and(
        eq(schema.competitorWebData.accountId, accountId),
        eq(schema.competitorWebData.competitorId, comp.id)
      ))
      .limit(3);

    let evidenceSnippet = "";
    if (webDataRows.length > 0) {
      evidenceSnippet = webDataRows.map(w => {
        const rawHeadlines = Array.isArray(w.headlines) ? w.headlines.join(", ") : (typeof w.headlines === "string" ? w.headlines : "");
        return `${w.pageType}: ${w.rawTextPreview || rawHeadlines}`;
      }).join(" | ").slice(0, 1000);
    }

    if (!evidenceSnippet || evidenceSnippet.length < 50) {
      const snapRows = await db
        .select()
        .from(schema.competitorWebsiteSnapshots)
        .where(and(
          eq(schema.competitorWebsiteSnapshots.accountId, accountId),
          eq(schema.competitorWebsiteSnapshots.competitorId, comp.id)
        ))
        .limit(2);

      if (snapRows.length > 0 && Array.isArray(snapRows[0].pagesCrawled)) {
        evidenceSnippet = (snapRows[0].pagesCrawled as any[]).map(p => `[${p.pageType}]: ${p.snippet || ""}`).join(" | ").slice(0, 1000);
      }
    }

    if (!evidenceSnippet || evidenceSnippet.length < 50) {
      // Fast fallback HTTP fetch for live snippet
      try {
        if (rawUrl.startsWith("http")) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const resp = await fetch(rawUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          });
          clearTimeout(timeout);
          if (resp.ok) {
            const html = await resp.text();
            const text = html
              .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
              .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            evidenceSnippet = text.slice(0, 1000);
          }
        }
      } catch (e) {
        // Fall back to stored metadata
      }
    }

    if (!evidenceSnippet) {
      evidenceSnippet = `Competitor name: "${comp.name}", website: ${rawUrl}, tier: ${comp.tier}, platform: ${comp.platform}.`;
    }

    // Step A, B, C: Execute canonical shared quality pipeline (Identity -> Relevance -> Final Judge)
    const quality = await evaluateCompetitorQuality(
      {
        candidateKey: comp.id,
        name: comp.name,
        domain,
        websiteUrl: rawUrl,
        evidenceText: evidenceSnippet,
      },
      {
        offeringName,
        category,
        targetMarket,
        productTruthFacts,
        targetRoles,
      },
      { accountId }
    );

    let action: "KEEP_ACTIVE" | "KEEP_AS_BENCHMARK" | "DEACTIVATE_NOT_COMPETITOR" | "DEACTIVATE_INSUFFICIENT_EVIDENCE" = "KEEP_ACTIVE";

    if (quality.judge.verdict === "REJECTED") {
      if (!quality.identity.isRealBusiness || quality.relevance.classification === "INSUFFICIENT_EVIDENCE") {
        action = "DEACTIVATE_INSUFFICIENT_EVIDENCE";
      } else {
        action = "DEACTIVATE_NOT_COMPETITOR";
      }
    } else if (quality.judge.verdict === "INSUFFICIENT_EVIDENCE") {
      action = "DEACTIVATE_INSUFFICIENT_EVIDENCE";
    } else if (quality.relevance.classification === "BENCHMARK_COMPETITOR") {
      action = "KEEP_AS_BENCHMARK";
    } else {
      action = "KEEP_ACTIVE";
    }

    candidateResults.push({
      competitorId: comp.id,
      name: comp.name,
      domain,
      websiteUrl: rawUrl,
      currentTier: comp.tier,
      entityRole: quality.identity.entityRole,
      entityRoleReasoning: quality.identity.entityRoleReasoning,
      relevanceClassification: quality.relevance.classification,
      relevanceReason: quality.relevance.reason,
      judgeVerdict: quality.judge.verdict,
      judgeFinalReason: quality.judge.finalReason,
      action,
      evidenceSnippet: evidenceSnippet.slice(0, 150),
    });
  }

  // 3. Perform transactional mutations if not dry run
  const deactivatedIds = candidateResults
    .filter(c => c.action.startsWith("DEACTIVATE"))
    .map(c => c.competitorId);

  const keptActiveIds = candidateResults
    .filter(c => c.action.startsWith("KEEP"))
    .map(c => c.competitorId);

  if (!dryRun && deactivatedIds.length > 0) {
    await db.transaction(async (tx) => {
      // Deactivate competitors in ci_competitors
      for (const res of candidateResults) {
        if (res.action.startsWith("DEACTIVATE")) {
          await tx
            .update(schema.ciCompetitors)
            .set({
              isActive: false,
              notes: sql`COALESCE(notes, '') || ' | DEACTIVATED_QUALITY_REVALIDATION: ' || ${res.judgeFinalReason}`,
              updatedAt: new Date(),
            })
            .where(and(
              eq(schema.ciCompetitors.accountId, accountId),
              eq(schema.ciCompetitors.campaignId, campaignId),
              eq(schema.ciCompetitors.id, res.competitorId)
            ));
        }
      }

      // Remove active monitoring schedules for deactivated competitors so Watchtower does not poll them
      await tx
        .delete(schema.miRefreshSchedule)
        .where(and(
          eq(schema.miRefreshSchedule.accountId, accountId),
          eq(schema.miRefreshSchedule.campaignId, campaignId),
          inArray(schema.miRefreshSchedule.competitorId, deactivatedIds)
        ));
    });
  }

  const postActiveComps = await db
    .select()
    .from(schema.ciCompetitors)
    .where(and(
      eq(schema.ciCompetitors.accountId, accountId),
      eq(schema.ciCompetitors.campaignId, campaignId),
      eq(schema.ciCompetitors.isActive, true)
    ));

  return {
    accountId,
    campaignId,
    dryRun,
    activeBefore: activeComps.length,
    activeAfter: dryRun ? (activeComps.length - deactivatedIds.length) : postActiveComps.length,
    keepActiveCount: candidateResults.filter(c => c.action === "KEEP_ACTIVE").length,
    keepAsBenchmarkCount: candidateResults.filter(c => c.action === "KEEP_AS_BENCHMARK").length,
    deactivatedNotCompetitorCount: candidateResults.filter(c => c.action === "DEACTIVATE_NOT_COMPETITOR").length,
    deactivatedInsufficientEvidenceCount: candidateResults.filter(c => c.action === "DEACTIVATE_INSUFFICIENT_EVIDENCE").length,
    candidates: candidateResults,
    success: true,
  };
}
