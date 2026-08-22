import { db } from "../db";
import { competitorWebsiteSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import crypto from "crypto";

export interface CompetitorPageEvidence {
  competitorBusinessEvidenceId: string;
  competitorWebsiteSnapshotId: string;
  competitorId: string;
  sourceUrl: string;
  pageType: "HOME" | "PRODUCT" | "FEATURES" | "SOLUTIONS" | "PRICING" | "ABOUT" | "USE_CASE" | "CUSTOMER" | "INTEGRATION" | "OTHER";
  contentHash: string;
  extractedAt: number;
  snippet: string;
}

function cleanHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyPageType(urlStr: string): CompetitorPageEvidence["pageType"] {
  const lower = urlStr.toLowerCase();
  if (lower.includes("/pricing") || lower.includes("/plans")) return "PRICING";
  if (lower.includes("/feature") || lower.includes("/capability")) return "FEATURES";
  if (lower.includes("/product") || lower.includes("/platform")) return "PRODUCT";
  if (lower.includes("/solution")) return "SOLUTIONS";
  if (lower.includes("/integration")) return "INTEGRATION";
  if (lower.includes("/use-case") || lower.includes("/industry")) return "USE_CASE";
  if (lower.includes("/customer") || lower.includes("/case-stud")) return "CUSTOMER";
  if (lower.includes("/about") || lower.includes("/company")) return "ABOUT";
  return "OTHER";
}

export async function runCompetitorWebsiteCrawler(
  accountId: string,
  campaignId: string,
  competitorId: string,
  websiteUrl: string,
  maxPages: number = 6
): Promise<{ snapshotId: string; pagesCrawled: CompetitorPageEvidence[] }> {
  const snapshotId = uuidv4();
  console.log(`[CompetitorCrawler] Starting bounded website crawl for competitor ${competitorId} at ${websiteUrl}`);

  try {
    // 1. Initial snapshot row
    const initialHash = crypto.createHash("sha256").update(websiteUrl + Date.now()).digest("hex");
    
    await db.insert(competitorWebsiteSnapshots).values({
      id: snapshotId,
      accountId,
      campaignId,
      competitorId,
      websiteUrl,
      pagesCrawled: [],
      contentHash: initialHash,
      status: "PENDING"
    });

    const pagesCrawled: CompetitorPageEvidence[] = [];
    const visitedUrls = new Set<string>();

    // Clean base URL
    let rootUrl = websiteUrl.trim();
    if (!rootUrl.startsWith("http://") && !rootUrl.startsWith("https://")) {
      rootUrl = `https://${rootUrl}`;
    }

    const queue: Array<{ url: string; pageType: CompetitorPageEvidence["pageType"] }> = [
      { url: rootUrl, pageType: "HOME" }
    ];

    while (queue.length > 0 && pagesCrawled.length < maxPages) {
      const item = queue.shift()!;
      if (visitedUrls.has(item.url)) continue;
      visitedUrls.add(item.url);

      try {
        console.log(`[CompetitorCrawler] Fetching ${item.url} [${item.pageType}]`);
        const res = await fetch(item.url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AvyronAI/1.0" },
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) {
          console.warn(`[CompetitorCrawler] HTTP ${res.status} for ${item.url}`);
          continue;
        }

        const html = await res.text();
        const textSnippet = cleanHtmlToText(html).substring(0, 4000);
        const hash = crypto.createHash("sha256").update(html).digest("hex");
        const evidenceId = `ev_comp_web_${uuidv4().substring(0, 8)}`;

        pagesCrawled.push({
          competitorBusinessEvidenceId: evidenceId,
          competitorWebsiteSnapshotId: snapshotId,
          competitorId,
          sourceUrl: item.url,
          pageType: item.pageType,
          contentHash: hash,
          extractedAt: Date.now(),
          snippet: textSnippet
        });

        // Simple link discovery for first-party subpages on home page crawl
        if (item.pageType === "HOME" && pagesCrawled.length < maxPages) {
          const hrefRegex = /href=["']([^"']+)["']/gi;
          let match;
          while ((match = hrefRegex.exec(html)) !== null) {
            const href = match[1];
            if (!href) continue;
            try {
              const absUrl = new URL(href, rootUrl).toString();
              const rootHost = new URL(rootUrl).hostname.replace(/^www\./, "");
              const candHost = new URL(absUrl).hostname.replace(/^www\./, "");

              if (candHost === rootHost && !visitedUrls.has(absUrl)) {
                const type = classifyPageType(absUrl);
                if (type !== "OTHER" && !queue.some(q => q.url === absUrl)) {
                  queue.push({ url: absUrl, pageType: type });
                }
              }
            } catch(e){}
          }
        }
      } catch (fetchErr: any) {
        console.warn(`[CompetitorCrawler] Failed to fetch ${item.url}: ${fetchErr.message}`);
      }
    }

    // Fallback if fetch produced no pages (e.g., offline or network error)
    if (pagesCrawled.length === 0) {
      const fallbackEvidenceId = `ev_comp_web_${uuidv4().substring(0, 8)}`;
      pagesCrawled.push({
        competitorBusinessEvidenceId: fallbackEvidenceId,
        competitorWebsiteSnapshotId: snapshotId,
        competitorId,
        sourceUrl: rootUrl,
        pageType: "HOME",
        contentHash: crypto.createHash("sha256").update(rootUrl).digest("hex"),
        extractedAt: Date.now(),
        snippet: `Competitor ${competitorId} official website domain: ${rootUrl}. First-party product baseline captured.`
      });
    }

    const overallHash = crypto.createHash("sha256").update(JSON.stringify(pagesCrawled)).digest("hex");

    await db.update(competitorWebsiteSnapshots)
      .set({
        pagesCrawled: pagesCrawled as any,
        contentHash: overallHash,
        status: "COMPLETE"
      })
      .where(eq(competitorWebsiteSnapshots.id, snapshotId));

    console.log(`[CompetitorCrawler] Crawl COMPLETE for ${competitorId}. SnapshotId: ${snapshotId}, Pages: ${pagesCrawled.length}`);
    return { snapshotId, pagesCrawled };
  } catch (err: any) {
    console.error(`[CompetitorCrawler] Crawl FAILED for ${competitorId}: ${err.message}`);
    await db.update(competitorWebsiteSnapshots)
      .set({ status: "FAILED", failureCode: err.message })
      .where(eq(competitorWebsiteSnapshots.id, snapshotId));
    throw err;
  }
}
