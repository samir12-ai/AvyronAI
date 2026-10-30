import { db } from "../db";
import { competitorWebsiteSnapshots, ciCompetitors } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import * as crypto from "crypto";
import {
  isDocumentCandidateUrl,
  isDocumentContentType,
  detectBinaryContent,
  sanitizePostgresText
} from "../shared/web-ingestion-guard";

export interface CompetitorPageEvidence {
  competitorBusinessEvidenceId: string;
  competitorWebsiteSnapshotId: string;
  competitorId: string;
  sourceUrl: string;
  pageType: "HOME" | "PRODUCT" | "FEATURES" | "SOLUTIONS" | "PRICING" | "ABOUT" | "USE_CASE" | "CUSTOMER" | "INTEGRATION" | "POLICIES" | "CATALOG_INDEX" | "OTHER";
  contentHash: string;
  extractedAt: number;
  snippet: string;
  structuredData?: Record<string, any>;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCharCode(parseInt(dec, 10));
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCharCode(parseInt(hex, 16));
      } catch {
        return "";
      }
    });
}

export function extractJsonLd(html: string): { summary: string; raw: any[] } {
  const jsonLdRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const items: any[] = [];
  const summaries: string[] = [];
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const entries = Array.isArray(parsed) ? parsed : (parsed["@graph"] ? parsed["@graph"] : [parsed]);
      for (const item of entries) {
        if (!item || typeof item !== "object") continue;
        const type = item["@type"] || item.type;
        if (!type) continue;
        items.push(item);

        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) {
          const name = item.name || "";
          const desc = item.description ? String(item.description).slice(0, 150) : "";
          const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          const price = offers?.price || offers?.lowPrice;
          const currency = offers?.priceCurrency || "";
          let prodSummary = `Product: ${name}`;
          if (price && currency) prodSummary += ` | Price: ${currency} ${price}`;
          else if (price) prodSummary += ` | Price: ${price}`;
          if (desc) prodSummary += ` | Details: ${desc}`;
          summaries.push(prodSummary);
        } else if (type === "Organization" || type === "Store") {
          const name = item.name || "";
          const desc = item.description || "";
          if (name || desc) summaries.push(`Organization: ${name} ${desc ? `- ${desc}` : ""}`);
        } else if (type === "FAQPage") {
          summaries.push("FAQ Schema Available");
        }
      }
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }

  const summaryText = summaries.length > 0 ? `[STRUCTURED_DATA]\n${summaries.join("\n")}\n[/STRUCTURED_DATA]\n\n` : "";
  return { summary: summaryText, raw: items };
}

export function extractMetaAndEmbeddedState(html: string): string {
  const parts: string[] = [];

  // 1. Extract standard meta description / OpenGraph title & description
  const metaRegex = /<meta\b[^>]*>/gi;
  let mMatch;
  while ((mMatch = metaRegex.exec(html)) !== null) {
    const tag = mMatch[0];
    const nameMatch = tag.match(/(?:name|property)=["']([^"']+)["']/i);
    const contentMatch = tag.match(/content=["']([^"']+)["']/i);
    const key = (nameMatch?.[1] || "").toLowerCase().trim();
    const val = decodeHtmlEntities((contentMatch?.[1] || "").trim());
    if (
      val &&
      val.length >= 10 &&
      ["description", "og:title", "og:description", "twitter:title", "twitter:description"].includes(key)
    ) {
      const entry = `[META ${key}]: ${val}`;
      if (!parts.includes(entry)) parts.push(entry);
    }
  }

  // 2. Extract embedded SSR product/CMS JSON state (e.g. window.appSettings / songProduct / cmsSettings / __NEXT_DATA__)
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let sMatch;
  while ((sMatch = scriptRegex.exec(html)) !== null) {
    const scriptBody = sMatch[1] || "";
    if (
      !scriptBody.includes("songProduct") &&
      !scriptBody.includes("cmsSettings") &&
      !scriptBody.includes("appSettings") &&
      !scriptBody.includes("__NEXT_DATA__") &&
      !scriptBody.includes("product_type")
    ) {
      continue;
    }

    const unescaped = scriptBody
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\u0026/gi, "&")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, " ");

    // Extract title/description/text/price fields from embedded product/CMS objects
    const prodMatch = scriptBody.match(/songProduct\s*:\s*(\{[\s\S]*?\})\s*(?:,\s*[a-zA-Z_]+\s*:|\})/);
    if (prodMatch?.[1]) {
      try {
        const prod = JSON.parse(prodMatch[1]);
        const rawDesc = String(prod.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const priceStr = typeof prod.price === "number" ? `$${(prod.price / 100).toFixed(2)} USD` : "";
        if (prod.title || rawDesc) {
          parts.push(
            `[EMBEDDED_PRODUCT] ${prod.title || prod.name || "Product"}${priceStr ? ` | Price: ${priceStr}` : ""} | ${decodeHtmlEntities(rawDesc)}`
          );
        }
      } catch {}
    }

    const textMatches = [...unescaped.matchAll(/"(?:description|text|headline|subheadline|error_message)"\s*:\s*"([^"]{25,1500})"/gi)];
    for (const tm of textMatches.slice(0, 8)) {
      const cleanVal = decodeHtmlEntities(tm[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (cleanVal.length >= 25 && !cleanVal.startsWith("http") && !parts.some((p) => p.includes(cleanVal.slice(0, 40)))) {
        parts.push(cleanVal);
      }
    }
  }

  return parts.length > 0 ? `${parts.join("\n")}\n\n` : "";
}

export function cleanHtmlToText(html: string): string {
  const binaryCheck = detectBinaryContent(html);
  if (binaryCheck.isBinary) {
    return "";
  }

  const { summary } = extractJsonLd(html);
  const metaAndEmbedded = extractMetaAndEmbeddedState(html);

  // Strip script, style, noscript, svg, and cookie/consent banners
  const cleaned = html
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<noscript\b[^<]*>([\s\S]*?)<\/noscript>/gi, "")
    .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, "")
    .replace(/<(div|aside|section)\b[^>]*(cookie|consent|onetrust|cc-window)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const decoded = decodeHtmlEntities(cleaned);
  const textBody = decoded
    .replace(/\r\n|\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

  return sanitizePostgresText((summary + metaAndEmbedded + textBody).slice(0, 4000));
}

export function detectPageDefects(text: string): { isShell: boolean; failureCode: string | null } {
  const lower = text.toLowerCase();
  if (
    lower.includes("attention required! | cloudflare") ||
    lower.includes("just a moment...") ||
    lower.includes("checking your browser before accessing") ||
    lower.includes("verify you are human")
  ) {
    return { isShell: true, failureCode: "BOT_CHALLENGE" };
  }
  if (lower.includes("to get full functionality of this site you need to enable javascript") && text.length < 250) {
    return { isShell: true, failureCode: "JS_SHELL_UNRENDERABLE" };
  }
  if (lower.includes("you need to enable javascript to run this app") && text.length < 250) {
    return { isShell: true, failureCode: "JS_SHELL_UNRENDERABLE" };
  }
  if (text.trim().length < 50) {
    return { isShell: true, failureCode: "EMPTY_PAGE" };
  }
  return { isShell: false, failureCode: null };
}

export function classifyPageType(
  urlStr: string,
  anchorText?: string,
  pageTitle?: string
): CompetitorPageEvidence["pageType"] {
  if (!isDocumentCandidateUrl(urlStr)) {
    return "OTHER";
  }

  let decoded = urlStr;
  try {
    decoded = decodeURIComponent(urlStr);
  } catch {}

  const lower = `${decoded.toLowerCase()} ${(anchorText || "").toLowerCase()} ${(pageTitle || "").toLowerCase()}`;

  // 1. Pricing & Plans
  if (lower.includes("/pricing") || lower.includes("/plans") || lower.includes("/rates") || lower.includes("أسعار") || lower.includes("/pricing-plans")) {
    return "PRICING";
  }

  // 2. Policies, Shipping, Returns, FAQ
  if (
    lower.includes("/shipping") ||
    lower.includes("/delivery") ||
    lower.includes("/returns") ||
    lower.includes("/exchanges") ||
    lower.includes("/refund") ||
    lower.includes("/faq") ||
    lower.includes("/terms") ||
    lower.includes("الشحن") ||
    lower.includes("التوصيل") ||
    lower.includes("الاسترجاع") ||
    lower.includes("الاستبدال") ||
    lower.includes("سياسة-الاسترجاع")
  ) {
    return "POLICIES";
  }

  // 3. About, Company, Story
  if (
    lower.includes("/about") ||
    lower.includes("/company") ||
    lower.includes("/our-story") ||
    lower.includes("/who-we-are") ||
    lower.includes("من-نحن") ||
    lower.includes("عن-المتجر") ||
    lower.includes("قصتنا")
  ) {
    return "ABOUT";
  }

  // 4. Features, Craftsmanship, Fabrics, Guide
  if (
    lower.includes("/feature") ||
    lower.includes("/capability") ||
    lower.includes("/fabric-guide") ||
    lower.includes("/materials") ||
    lower.includes("/craftsmanship") ||
    lower.includes("دليل-الأقمشة") ||
    lower.includes("تفاصيل-القماش")
  ) {
    return "FEATURES";
  }

  // 5. Individual Product
  if (
    lower.includes("/products/") ||
    lower.includes("/product/") ||
    lower.includes("/p/") ||
    lower.includes("/item/") ||
    lower.includes("/منتج/") ||
    lower.includes("اشتري الآن")
  ) {
    return "PRODUCT";
  }

  // 6. Catalog Index / Collections / Categories
  if (
    lower.includes("/collections") ||
    lower.includes("/category/") ||
    lower.includes("/categories/") ||
    lower.includes("/catalog") ||
    lower.includes("/shop") ||
    lower.includes("فساتين") ||
    lower.includes("عبايات") ||
    lower.includes("أقسام") ||
    lower.includes("تصنيفات")
  ) {
    return "CATALOG_INDEX";
  }

  // 7. Solutions / Use cases
  if (lower.includes("/solution")) return "SOLUTIONS";
  if (lower.includes("/integration")) return "INTEGRATION";
  if (lower.includes("/use-case") || lower.includes("/industry")) return "USE_CASE";
  if (lower.includes("/customer") || lower.includes("/case-stud") || lower.includes("/reviews")) return "CUSTOMER";

  return "OTHER";
}

export async function runCompetitorWebsiteCrawler(
  accountId: string,
  campaignId: string,
  competitorId: string,
  websiteUrl: string,
  maxPages: number = 6,
  options?: { forceRecrawl?: boolean }
): Promise<{ snapshotId: string; pagesCrawled: CompetitorPageEvidence[]; status: "COMPLETE" | "FAILED"; failureCode?: string; reused?: boolean }> {
  // 1. Check recent snapshots for this competitor to enforce reuse and bounded failure backoff
  if (!options?.forceRecrawl) {
    const recentSnapshots = await db
      .select()
      .from(competitorWebsiteSnapshots)
      .where(eq(competitorWebsiteSnapshots.competitorId, competitorId))
      .orderBy(desc(competitorWebsiteSnapshots.createdAt))
      .limit(5);

    if (recentSnapshots.length > 0) {
      const latest = recentSnapshots[0];
      const latestAgeMs = latest.createdAt ? Date.now() - new Date(latest.createdAt).getTime() : Infinity;

      // If latest snapshot is COMPLETE and fresh (< 6h), reuse it directly without network crawl
      if (latest.status === "COMPLETE" && Array.isArray(latest.pagesCrawled) && latest.pagesCrawled.length > 0 && latestAgeMs < 6 * 60 * 60 * 1000) {
        console.log(`[CompetitorCrawler] Reusing fresh COMPLETE website snapshot ${latest.id} for ${competitorId} (age=${Math.round(latestAgeMs / 60000)}m)`);
        await db.update(ciCompetitors)
          .set({ websiteEnrichmentStatus: "COMPLETE", websiteScrapedAt: latest.createdAt || new Date(), updatedAt: new Date() })
          .where(eq(ciCompetitors.id, competitorId));
        return {
          snapshotId: latest.id,
          pagesCrawled: latest.pagesCrawled as CompetitorPageEvidence[],
          status: "COMPLETE",
          reused: true,
        };
      }

      // If latest snapshot FAILED, enforce bounded exponential backoff (6h -> 12h -> 24h)
      if (latest.status === "FAILED") {
        let consecutiveFailures = 0;
        for (const s of recentSnapshots) {
          if (s.status === "FAILED") consecutiveFailures++;
          else break;
        }
        const backoffHours = consecutiveFailures === 1 ? 6 : consecutiveFailures === 2 ? 12 : 24;
        const backoffMs = backoffHours * 60 * 60 * 1000;
        if (latestAgeMs < backoffMs) {
          console.log(
            `[CompetitorCrawler] BACKOFF_COOLDOWN: Skipping crawl for ${competitorId} (${websiteUrl}) after ${consecutiveFailures} consecutive failure(s). Next retry in ${Math.ceil((backoffMs - latestAgeMs) / 60000)}m.`
          );
          return {
            snapshotId: latest.id,
            pagesCrawled: [],
            status: "FAILED",
            failureCode: latest.failureCode || "BACKOFF_COOLDOWN_ACTIVE",
            reused: true,
          };
        }
      }
    }
  }

  const snapshotId = uuidv4();
  console.log(`[CompetitorCrawler] Starting bounded website crawl for competitor ${competitorId} at ${websiteUrl}`);

  try {
    const initialHash = crypto.createHash("sha256").update(websiteUrl).digest("hex");
    
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

    let rootUrl = websiteUrl.trim();
    if (!rootUrl.startsWith("http://") && !rootUrl.startsWith("https://")) {
      rootUrl = `https://${rootUrl}`;
    }

    if (!isDocumentCandidateUrl(rootUrl)) {
      console.warn(`[CompetitorCrawler] Root URL is not a valid document URL: ${rootUrl}`);
      await db.update(competitorWebsiteSnapshots)
        .set({ status: "FAILED", failureCode: "INVALID_ROOT_URL" })
        .where(eq(competitorWebsiteSnapshots.id, snapshotId));
      return { snapshotId, pagesCrawled: [], status: "FAILED", failureCode: "INVALID_ROOT_URL" };
    }

    // Category allocation counters to prevent products from consuming every slot
    let productCount = 0;
    let aboutCount = 0;
    let policyCount = 0;
    let pricingCount = 0;
    let catalogCount = 0;

    const queue: Array<{ url: string; pageType: CompetitorPageEvidence["pageType"] }> = [
      { url: rootUrl, pageType: "HOME" }
    ];

    while (queue.length > 0 && pagesCrawled.length < maxPages) {
      const item = queue.shift()!;
      if (visitedUrls.has(item.url)) continue;
      visitedUrls.add(item.url);

      if (!isDocumentCandidateUrl(item.url, rootUrl)) {
        continue;
      }

      try {
        console.log(`[CompetitorCrawler] Fetching ${item.url} [${item.pageType}]`);
        const res = await fetch(item.url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(8000),
          redirect: "follow"
        });

        if (!res.ok) {
          console.warn(`[CompetitorCrawler] HTTP ${res.status} for ${item.url}`);
          continue;
        }

        const contentType = res.headers.get("content-type");
        if (!isDocumentContentType(contentType)) {
          console.warn(`[CompetitorCrawler] Non-document Content-Type '${contentType}' for ${item.url}`);
          continue;
        }

        if (res.url && !isDocumentCandidateUrl(res.url, rootUrl)) {
          console.warn(`[CompetitorCrawler] Redirected to non-document URL: ${res.url}`);
          continue;
        }

        const html = await res.text();
        const binaryCheck = detectBinaryContent(html);
        if (binaryCheck.isBinary) {
          console.warn(`[CompetitorCrawler] Binary payload detected for ${item.url}`);
          continue;
        }

        const textSnippet = cleanHtmlToText(html);
        const { isShell, failureCode } = detectPageDefects(textSnippet);

        if (isShell) {
          console.warn(`[CompetitorCrawler] Page ${item.url} flagged as unusable shell: ${failureCode}`);
          continue;
        }

        const hash = crypto.createHash("sha256").update(textSnippet).digest("hex");
        const evidenceId = `ev_comp_web_${uuidv4().substring(0, 8)}`;
        const { raw: rawJsonLd } = extractJsonLd(html);

        // Extract outbound links so source discovery can reuse stored website snapshots without re-fetching HTML
        const outboundLinks: string[] = [];
        const allHrefRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
        let outMatch;
        while ((outMatch = allHrefRegex.exec(html)) !== null) {
          const rawHref = outMatch[1]?.trim();
          if (rawHref && /^https?:\/\//i.test(rawHref) && outboundLinks.length < 100) {
            if (!outboundLinks.includes(rawHref)) outboundLinks.push(rawHref);
          }
        }
        // Also capture social/blog/review links embedded in JSON state (e.g. window.appSettings footer links)
        const embeddedSocialRegex = /https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|tiktok\.com|youtube\.com|linkedin\.com|twitter\.com|x\.com|[a-z0-9-]+\.trustpilot\.com|blog\.[a-z0-9.-]+)\/[^\s"'<>\\]+/gi;
        let embMatch;
        while ((embMatch = embeddedSocialRegex.exec(html)) !== null) {
          const rawUrl = embMatch[0]?.trim();
          if (rawUrl && outboundLinks.length < 120 && !outboundLinks.includes(rawUrl)) {
            outboundLinks.push(rawUrl);
          }
        }

        pagesCrawled.push({
          competitorBusinessEvidenceId: evidenceId,
          competitorWebsiteSnapshotId: snapshotId,
          competitorId,
          sourceUrl: item.url,
          pageType: item.pageType,
          contentHash: hash,
          extractedAt: Date.now(),
          snippet: textSnippet,
           outboundLinks: outboundLinks.length > 0 ? outboundLinks : undefined,
          structuredData: rawJsonLd.length > 0 ? { jsonLd: rawJsonLd } : undefined
        } as any);

        // Link discovery on homepage or catalog pages
        if ((item.pageType === "HOME" || item.pageType === "CATALOG_INDEX") && pagesCrawled.length < maxPages) {
          const hrefRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let match;
          while ((match = hrefRegex.exec(html)) !== null) {
            const href = match[1];
            const anchorText = match[2] ? match[2].replace(/<[^>]+>/g, "").trim() : "";
            if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;

            try {
              const absUrl = new URL(href, rootUrl).toString();
              const rootHost = new URL(rootUrl).hostname.replace(/^www\./, "");
              const candHost = new URL(absUrl).hostname.replace(/^www\./, "");

              if (candHost === rootHost && !visitedUrls.has(absUrl) && isDocumentCandidateUrl(absUrl, rootUrl)) {
                const type = classifyPageType(absUrl, anchorText);

                // Enforce bounded slot limits
                let allowEnqueue = false;
                if (type === "ABOUT" && aboutCount < 1) {
                  allowEnqueue = true;
                  aboutCount++;
                } else if (type === "POLICIES" && policyCount < 1) {
                  allowEnqueue = true;
                  policyCount++;
                } else if (type === "PRICING" && pricingCount < 1) {
                  allowEnqueue = true;
                  pricingCount++;
                } else if (type === "PRODUCT" && productCount < 2) {
                  allowEnqueue = true;
                  productCount++;
                } else if (type === "CATALOG_INDEX" && catalogCount < 1) {
                  allowEnqueue = true;
                  catalogCount++;
                } else if (type !== "OTHER" && queue.length < 3) {
                  allowEnqueue = true;
                } else if (queue.length === 0 && pagesCrawled.length < 3) {
                  // Fallback: allow same-domain content links if priority queues are empty
                  allowEnqueue = true;
                }

                if (allowEnqueue && !queue.some(q => q.url === absUrl)) {
                  queue.push({ url: absUrl, pageType: type });
                }
              }
            } catch {}
          }
        }
      } catch (fetchErr: any) {
        console.warn(`[CompetitorCrawler] Failed to fetch ${item.url}: ${fetchErr.message}`);
      }
    }

    // Do NOT fabricate a successful result if 0 pages were captured
    if (pagesCrawled.length === 0) {
      console.warn(`[CompetitorCrawler] Crawl produced 0 usable pages for ${competitorId}`);
      await db.update(competitorWebsiteSnapshots)
        .set({
          status: "FAILED",
          failureCode: "ZERO_USABLE_PAGES_EXTRACTED",
          pagesCrawled: []
        })
        .where(eq(competitorWebsiteSnapshots.id, snapshotId));
      return { snapshotId, pagesCrawled: [], status: "FAILED", failureCode: "ZERO_USABLE_PAGES_EXTRACTED" };
    }

    // Compute deterministic contentHash strictly from normalized page content (excluding random UUIDs and timestamps)
    const normalizedForHash = pagesCrawled
      .map(p => ({
        sourceUrl: p.sourceUrl,
        pageType: p.pageType,
        contentHash: p.contentHash,
        snippet: p.snippet,
      }))
      .sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl));
    const overallHash = crypto.createHash("sha256").update(JSON.stringify(normalizedForHash)).digest("hex");

    // Check if an existing COMPLETE snapshot for this competitor already has the identical contentHash
    const [existingSameHash] = await db
      .select()
      .from(competitorWebsiteSnapshots)
      .where(
        and(
          eq(competitorWebsiteSnapshots.competitorId, competitorId),
          eq(competitorWebsiteSnapshots.status, "COMPLETE"),
          eq(competitorWebsiteSnapshots.contentHash, overallHash)
        )
      )
      .orderBy(desc(competitorWebsiteSnapshots.createdAt))
      .limit(1);

    if (existingSameHash && existingSameHash.id !== snapshotId) {
      // Remove the temporary PENDING row and reuse the existing unchanged snapshot
      await db.delete(competitorWebsiteSnapshots).where(eq(competitorWebsiteSnapshots.id, snapshotId));
      await db.update(ciCompetitors)
        .set({ websiteEnrichmentStatus: "COMPLETE", websiteScrapedAt: new Date(), updatedAt: new Date() })
        .where(eq(ciCompetitors.id, competitorId));
      console.log(
        `[CompetitorCrawler] Website content unchanged for ${competitorId} (contentHash=${overallHash.slice(0, 12)}). Reusing snapshot ${existingSameHash.id}.`
      );
      return {
        snapshotId: existingSameHash.id,
        pagesCrawled: (existingSameHash.pagesCrawled as CompetitorPageEvidence[]) || pagesCrawled,
        status: "COMPLETE",
        reused: true,
      };
    }

    await db.update(competitorWebsiteSnapshots)
      .set({
        pagesCrawled: pagesCrawled as any,
        contentHash: overallHash,
        status: "COMPLETE"
      })
      .where(eq(competitorWebsiteSnapshots.id, snapshotId));

    await db.update(ciCompetitors)
      .set({ websiteEnrichmentStatus: "COMPLETE", websiteScrapedAt: new Date(), updatedAt: new Date() })
      .where(eq(ciCompetitors.id, competitorId));

    console.log(`[CompetitorCrawler] Crawl COMPLETE for ${competitorId}. SnapshotId: ${snapshotId}, Pages: ${pagesCrawled.length}`);
    return { snapshotId, pagesCrawled, status: "COMPLETE" };
  } catch (err: any) {
    console.error(`[CompetitorCrawler] Crawl FAILED for ${competitorId}: ${err.message}`);
    await db.update(competitorWebsiteSnapshots)
      .set({ status: "FAILED", failureCode: err.message })
      .where(eq(competitorWebsiteSnapshots.id, snapshotId));
    throw err;
  }
}
