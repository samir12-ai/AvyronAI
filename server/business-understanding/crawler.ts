import { db } from "../db";
import { websiteSnapshots } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomUUID as uuidv4 } from "crypto";
import crypto from "crypto";
import {
  isDocumentCandidateUrl,
  isDocumentContentType,
  detectBinaryContent,
  sanitizePostgresText,
  extractAnchorDocumentLinks,
  normalizeDocumentUrl,
  classifyCleanPageType,
  type PageTypeCategory
} from "../shared/web-ingestion-guard";

export interface ExtractedFaqItem {
  question: string;
  answer: string | null;
  status: "ANSWER_EXTRACTED" | "MISSING_ANSWER";
}

export interface PageCoverageSummary {
  discoveredLinks: string[];
  resolvedFragments: string[];
  extractedSectionsCount: number;
  answeredFaqCount: number;
  unansweredFaqCount: number;
  omittedMiddleChars: number;
  inaccessibleItems: string[];
}

export interface OwnBusinessPageEvidence {
  businessEvidenceId: string;
  sourceUrl: string;
  pageType: PageTypeCategory;
  contentHash: string;
  extractedAt: number;
  cleanedText: string;
  wasTruncated?: boolean;
  inPageSections?: string[];
  extractionGaps?: string[];
  faqItems?: ExtractedFaqItem[];
  coverage?: PageCoverageSummary;
}

function stripTagsAndEntities(rawHtml: string): string {
  return rawHtml
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, "")
    .replace(/<noscript\b[^<]*>([\s\S]*?)<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const HIGH_SIGNAL_SECTION_REGEX =
  /\b(pricing|price|plan|plans|package|packages|subscription|subscriptions|tier|tiers|billing|free trial|pay only|checkout|how it works|delivery|download|streaming|platform|software|saas|api|digital|physical|shipping|for business|corporate|enterprise|teams|b2b|b2c|clients|companies|partner|partnerships|white-label|use case|use cases|occasions|faq|frequently asked|refund|privacy|rights|license|terms)\b/i;

/**
 * Extracts FAQ questions and answers from JSON-LD (FAQPage), <details>/<summary>,
 * <dl>/<dt>/<dd>, and heading/accordion blocks.
 * Explicitly flags questions whose answers are missing or unrendered in static HTML
 * so downstream Business Understanding never treats a bare question as a verified capability.
 */
export function extractFaqItemsFromHtml(html: string): ExtractedFaqItem[] {
  if (!html || typeof html !== "string") return [];
  const items: ExtractedFaqItem[] = [];
  const seenQuestions = new Set<string>();

  const recordFaq = (rawQ: string, rawA: string | null) => {
    const q = stripTagsAndEntities(rawQ).replace(/\s+/g, " ").trim();
    if (!q || q.length < 6 || q.length > 260) return;
    const normQ = q.toLowerCase().replace(/[^a-z0-9?]+/g, " ").trim();
    if (seenQuestions.has(normQ)) return;

    const a = rawA ? stripTagsAndEntities(rawA).replace(/\s+/g, " ").trim() : "";
    // Ensure answer is not just a repeat of the question or another question
    const isRealAnswer =
      a.length >= 12 &&
      a.toLowerCase() !== q.toLowerCase() &&
      !(a.endsWith("?") && a.length < 120);

    seenQuestions.add(normQ);
    items.push({
      question: q,
      answer: isRealAnswer ? a.slice(0, 800) : null,
      status: isRealAnswer ? "ANSWER_EXTRACTED" : "MISSING_ANSWER",
    });
  };

  // 1. JSON-LD FAQPage structured data
  const jsonLdRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch;
  while ((ldMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(ldMatch[1].trim());
      const graphs = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.["@graph"])
        ? parsed["@graph"]
        : [parsed];
      for (const node of graphs) {
        if (node?.["@type"] === "FAQPage" && Array.isArray(node.mainEntity)) {
          for (const ent of node.mainEntity) {
            const q = ent?.name || ent?.headline || "";
            const a = ent?.acceptedAnswer?.text || ent?.suggestedAnswer?.text || "";
            if (q) recordFaq(String(q), a ? String(a) : null);
          }
        }
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  }

  const cleanedHtml = html
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, "");

  // 2. <details><summary>Question</summary>Answer</details>
  const detailsRegex = /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  let dMatch;
  while ((dMatch = detailsRegex.exec(cleanedHtml)) !== null) {
    recordFaq(dMatch[1], dMatch[2]);
  }

  // 3. <dt>Question</dt><dd>Answer</dd>
  const dlRegex = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let dlMatch;
  while ((dlMatch = dlRegex.exec(cleanedHtml)) !== null) {
    recordFaq(dlMatch[1], dlMatch[2]);
  }

  // 4. Question headings / buttons ending with '?' followed by sibling answer elements or nothing
  const questionBlockRegex =
    /<(h[2-5]|button|dt)\b[^>]*>([^<]*\?)\s*<\/\1>([\s\S]{0,1200}?)(?=<(?:h[1-5]|button|dt|section|footer)\b|$)/gi;
  let qMatch;
  while ((qMatch = questionBlockRegex.exec(cleanedHtml)) !== null) {
    const qText = qMatch[2];
    const trailingHtml = qMatch[3] || "";
    const trailingText = stripTagsAndEntities(trailingHtml);
    recordFaq(qText, trailingText.length >= 12 ? trailingText : null);
  }

  return items;
}

/**
 * Extracts structured, high-signal sections (pricing, delivery/how-it-works, B2B/B2C buyer segments,
 * use cases, FAQ) from anywhere in an HTML document so they are never lost behind repetitive middle-of-page cards.
 */
export function extractStructuredHtmlSections(html: string): {
  highSignalBlocks: string[];
  inPageAnchorTargets: string[];
  resolvedFragments: string[];
  extractionGaps: string[];
  faqItems: ExtractedFaqItem[];
} {
  const highSignalBlocks: string[] = [];
  const seenBlockText = new Set<string>();
  const inPageAnchorTargets: string[] = [];
  const resolvedFragments: string[] = [];
  const extractionGaps: string[] = [];

  const cleanedHtml = html
    .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, "");

  // 1. Discover in-page hash anchor links (e.g. href="#pricing", href="/#pricing")
  const hashAnchorRegex = /<a\b[^>]*href=["'](?:[^"']*?)#([a-zA-Z0-9_-]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let aMatch;
  while ((aMatch = hashAnchorRegex.exec(cleanedHtml)) !== null) {
    const fragId = aMatch[1]?.trim();
    if (fragId && !inPageAnchorTargets.includes(fragId)) {
      inPageAnchorTargets.push(fragId);
    }
  }

  // 2. Split document by semantic <section>/<article>/<details>/<div> with id or heading boundaries (<h1>..<h4>)
  const blockRegex =
    /<(?:section|article|details)\b[^>]*>[\s\S]*?<\/(?:section|article|details)>|<div\b[^>]*\bid=["'][^"']+["'][^>]*>[\s\S]{25,2500}?<\/div>|<h[1-4]\b[^>]*>[\s\S]*?(?=<h[1-4]\b|<\/body>|$)/gi;
  let bMatch;
  while ((bMatch = blockRegex.exec(cleanedHtml)) !== null) {
    const rawBlock = bMatch[0];
    const idAttrMatch = rawBlock.match(/\bid=["']([^"']+)["']/i);
    const blockId = idAttrMatch ? idAttrMatch[1].trim() : "";
    const text = stripTagsAndEntities(rawBlock);
    if (!text || text.length < 25) continue;

    const matchedFrag = inPageAnchorTargets.find(
      t =>
        (blockId && t.toLowerCase() === blockId.toLowerCase()) ||
        new RegExp(`^\\s*${t.replace(/[-_]/g, "[\\s\\-_]*")}\\b`, "i").test(text)
    );
    if (matchedFrag && !resolvedFragments.includes(matchedFrag)) {
      resolvedFragments.push(matchedFrag);
    }

    if (matchedFrag || HIGH_SIGNAL_SECTION_REGEX.test(text)) {
      const normalizedSnippet = text.slice(0, 950);
      const dedupeKey = normalizedSnippet.slice(0, 140).toLowerCase();
      if (!seenBlockText.has(dedupeKey)) {
        seenBlockText.add(dedupeKey);
        const label = matchedFrag
          ? `[RESOLVED FRAGMENT SECTION #${matchedFrag}]`
          : blockId
          ? `[SECTION #${blockId}]`
          : "[SECTION]";
        highSignalBlocks.push(`${label} ${normalizedSnippet}`);
      }
    }
  }

  // 3. Extract FAQ answers and detect unanswered questions
  const faqItems = extractFaqItemsFromHtml(html);
  for (const item of faqItems) {
    if (item.status === "MISSING_ANSWER") {
      extractionGaps.push(
        `FAQ question "${item.question}" has no accessible answer in static HTML (status: MISSING_ANSWER). Do not infer capability from the question alone.`
      );
    }
  }

  // 4. Check if any linked in-page anchor (e.g. #pricing) had no extractable section content
  for (const frag of inPageAnchorTargets) {
    if (!resolvedFragments.includes(frag)) {
      const idPattern = new RegExp(`\\bid=["']${frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
      if (!idPattern.test(cleanedHtml)) {
        extractionGaps.push(
          `In-page section '#${frag}' was linked in navigation but its target content was not present in static HTML.`
        );
      } else {
        resolvedFragments.push(frag);
      }
    }
  }

  return { highSignalBlocks, inPageAnchorTargets, resolvedFragments, extractionGaps, faqItems };
}

export function cleanHtmlToText(html: string, maxChars: number = 9500): string {
  if (!html || typeof html !== "string") return "";

  // Guard against binary input
  const binaryCheck = detectBinaryContent(html);
  if (binaryCheck.isBinary) {
    console.warn(`[OwnCrawler] Rejected binary content during text extraction: ${binaryCheck.reason}`);
    return "";
  }

  // Extract Title
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

  // Extract Meta Description
  const metaDescMatch =
    html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
    html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : "";

  // Extract Headings (h1..h4 across the entire document)
  const headings: string[] = [];
  const headingRegex = /<(h1|h2|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    const text = hMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text && text.length > 2 && text.length < 180 && !headings.includes(text)) {
      headings.push(text);
    }
  }

  const { highSignalBlocks, extractionGaps, faqItems } = extractStructuredHtmlSections(html);
  const bodyText = stripTagsAndEntities(html);

  const parts: string[] = [];
  if (title) parts.push(`[TITLE]: ${title}`);
  if (metaDesc) parts.push(`[META DESCRIPTION]: ${metaDesc}`);
  if (headings.length > 0) parts.push(`[KEY HEADINGS]: ${headings.slice(0, 25).join(" | ")}`);
  if (highSignalBlocks.length > 0) {
    parts.push(`[KEY SECTIONS (PRICING / DELIVERY / BUYERS / USE CASES)]:\n${highSignalBlocks.slice(0, 10).join("\n")}`);
  }
  const answeredFaqs = faqItems.filter(f => f.status === "ANSWER_EXTRACTED");
  const unansweredFaqs = faqItems.filter(f => f.status === "MISSING_ANSWER");
  if (answeredFaqs.length > 0) {
    parts.push(
      `[EXTRACTED FAQ ANSWERS]:\n${answeredFaqs
        .slice(0, 12)
        .map(f => `Q: ${f.question}\nA: ${f.answer}`)
        .join("\n")}`
    );
  }
  if (unansweredFaqs.length > 0) {
    parts.push(
      `[UNANSWERED FAQ QUESTIONS — MISSING ANSWER IN HTML (STATUS: UNKNOWN, DO NOT INFER CAPABILITY)]:\n${unansweredFaqs
        .slice(0, 12)
        .map(f => `- "${f.question}" -> [MISSING_ANSWER]`)
        .join("\n")}`
    );
  }
  if (extractionGaps.length > 0) {
    parts.push(`[EXTRACTION GAPS]: ${extractionGaps.join(" ")}`);
  }

  const headerText = parts.join("\n\n");
  const remainingBudget = Math.max(1500, maxChars - headerText.length - 40);

  let boundedBody = bodyText;
  if (bodyText.length > remainingBudget) {
    const headLen = Math.floor(remainingBudget * 0.65);
    const tailLen = remainingBudget - headLen;
    boundedBody = `${bodyText.slice(0, headLen)} ... [MIDDLE REPETITIVE CONTENT OMITTED] ... ${bodyText.slice(bodyText.length - tailLen)}`;
  }

  const finalParts = [...parts];
  if (boundedBody) {
    finalParts.push(`[PAGE CONTENT]: ${boundedBody}`);
  }

  return sanitizePostgresText(finalParts.join("\n\n")).slice(0, maxChars);
}

export function classifyPageType(urlStr: string, anchorText?: string, pageTitle?: string): PageTypeCategory {
  return classifyCleanPageType(urlStr, anchorText, pageTitle);
}

export async function runWebsiteCrawler(
  snapshotId: string,
  url: string,
  maxPages: number = 6
): Promise<OwnBusinessPageEvidence[]> {
  try {
    console.log(`[OwnCrawler] Starting bounded website crawl for ${url} (max ${maxPages} pages)`);

    let rootUrl = url.trim();
    if (!rootUrl.startsWith("http://") && !rootUrl.startsWith("https://")) {
      rootUrl = `https://${rootUrl}`;
    }

    if (!isDocumentCandidateUrl(rootUrl)) {
      throw new Error(`INVALID_ROOT_URL: ${url} is not a valid document URL`);
    }

    const normalizedRoot = normalizeDocumentUrl(rootUrl);
    const canonicalRootUrl = normalizedRoot ? normalizedRoot.canonicalUrl : rootUrl;

    const pagesCrawled: OwnBusinessPageEvidence[] = [];
    const visitedUrls = new Set<string>();
    const visitedContentHashes = new Set<string>();

    const queue: Array<{ url: string; pageType: PageTypeCategory }> = [
      { url: canonicalRootUrl, pageType: "HOME" }
    ];

    while (queue.length > 0 && pagesCrawled.length < maxPages) {
      const item = queue.shift()!;
      const normItem = normalizeDocumentUrl(item.url, canonicalRootUrl);
      const targetUrl = normItem ? normItem.canonicalUrl : item.url;

      if (visitedUrls.has(targetUrl)) continue;
      visitedUrls.add(targetUrl);

      // Admission check before fetching
      if (!isDocumentCandidateUrl(targetUrl, canonicalRootUrl)) {
        console.warn(`[OwnCrawler] Skipping non-document candidate URL: ${targetUrl}`);
        continue;
      }

      try {
        console.log(`[OwnCrawler] Fetching ${targetUrl} [${item.pageType}]`);
        const res = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AvyronAI/1.0",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1"
          },
          signal: AbortSignal.timeout(8000),
          redirect: "follow"
        });

        if (!res.ok) {
          console.warn(`[OwnCrawler] HTTP ${res.status} for ${targetUrl}`);
          continue;
        }

        // Validate Content-Type
        const contentType = res.headers.get("content-type");
        if (!isDocumentContentType(contentType)) {
          console.warn(`[OwnCrawler] Rejected non-document Content-Type '${contentType}' for ${targetUrl}`);
          continue;
        }

        // Validate final redirected URL and deduplicate if redirected to an already visited URL
        if (res.url) {
          if (!isDocumentCandidateUrl(res.url, canonicalRootUrl)) {
            console.warn(`[OwnCrawler] Redirected to non-document URL: ${res.url}`);
            continue;
          }
          const redirectedNorm = normalizeDocumentUrl(res.url, canonicalRootUrl);
          if (redirectedNorm && redirectedNorm.canonicalUrl !== targetUrl) {
            if (visitedUrls.has(redirectedNorm.canonicalUrl)) {
              console.log(`[OwnCrawler] Skipping duplicate redirected document: ${res.url}`);
              continue;
            }
            visitedUrls.add(redirectedNorm.canonicalUrl);
          }
        }

        const html = await res.text();

        // Inspect body for binary / null-byte contamination
        const binaryCheck = detectBinaryContent(html);
        if (binaryCheck.isBinary) {
          console.warn(`[OwnCrawler] Rejected binary payload for ${targetUrl} (${binaryCheck.reason})`);
          continue;
        }

        const hash = crypto.createHash("sha256").update(html).digest("hex");
        if (visitedContentHashes.has(hash)) {
          console.log(`[OwnCrawler] Skipping identical HTML document hash for ${targetUrl}`);
          continue;
        }
        visitedContentHashes.add(hash);

        const rawBodyLen = stripTagsAndEntities(html).length;
        const { highSignalBlocks, inPageAnchorTargets, resolvedFragments, extractionGaps, faqItems } = extractStructuredHtmlSections(html);
        const maxPageChars = 9500;
        const cleaned = cleanHtmlToText(html, maxPageChars);
        if (!cleaned || cleaned.trim().length < 20) {
          console.warn(`[OwnCrawler] Insufficient text extracted from ${targetUrl}, skipping`);
          continue;
        }

        const discoveredAnchors = extractAnchorDocumentLinks(html, canonicalRootUrl);
        const evidenceId = `ev_web_${uuidv4().substring(0, 8)}`;

        pagesCrawled.push({
          businessEvidenceId: evidenceId,
          sourceUrl: targetUrl,
          pageType: item.pageType,
          contentHash: hash,
          extractedAt: Date.now(),
          cleanedText: cleaned,
          wasTruncated: rawBodyLen > maxPageChars,
          inPageSections: inPageAnchorTargets.length > 0 ? inPageAnchorTargets : undefined,
          extractionGaps: extractionGaps.length > 0 ? extractionGaps : undefined,
          faqItems: faqItems.length > 0 ? faqItems : undefined,
          coverage: {
            discoveredLinks: discoveredAnchors.map(a => a.url),
            resolvedFragments,
            extractedSectionsCount: highSignalBlocks.length,
            answeredFaqCount: faqItems.filter(f => f.status === "ANSWER_EXTRACTED").length,
            unansweredFaqCount: faqItems.filter(f => f.status === "MISSING_ANSWER").length,
            omittedMiddleChars: Math.max(0, rawBodyLen - maxPageChars),
            inaccessibleItems: extractionGaps,
          },
        });

        // Link discovery for internal first-party pages strictly from anchor tags
        if ((item.pageType === "HOME" || item.pageType === "CATALOG_INDEX") && pagesCrawled.length < maxPages) {
          for (const cand of discoveredAnchors) {
            if (visitedUrls.has(cand.url) || queue.some(q => q.url === cand.url)) continue;

            const type = classifyCleanPageType(cand.url, cand.anchorText);
            if (type !== "OTHER") {
              queue.push({ url: cand.url, pageType: type });
            }
          }
        }
      } catch (fetchErr: any) {
        console.warn(`[OwnCrawler] Failed to fetch ${targetUrl}: ${fetchErr.message}`);
      }
    }

    // Fallback if network was offline or yielded 0 pages
    if (pagesCrawled.length === 0) {
      const fallbackEvidenceId = `ev_web_${uuidv4().substring(0, 8)}`;
      pagesCrawled.push({
        businessEvidenceId: fallbackEvidenceId,
        sourceUrl: canonicalRootUrl,
        pageType: "HOME",
        contentHash: crypto.createHash("sha256").update(canonicalRootUrl).digest("hex"),
        extractedAt: Date.now(),
        cleanedText: `Official business domain: ${canonicalRootUrl}. First-party product homepage baseline captured.`,
        extractionGaps: ["Live page HTML could not be fetched; only root URL baseline is available."]
      });
    }

    const overallHash = crypto.createHash("sha256").update(JSON.stringify(pagesCrawled)).digest("hex");

    // Only update websiteSnapshots if the record exists in the database and not running in offline test mode
    if (snapshotId && !snapshotId.startsWith("offline_")) {
      const [existingRow] = await db
        .select({ id: websiteSnapshots.id })
        .from(websiteSnapshots)
        .where(eq(websiteSnapshots.id, snapshotId))
        .limit(1);

      if (existingRow) {
        await db.update(websiteSnapshots)
          .set({
            pagesCrawled: pagesCrawled as any,
            contentHash: overallHash,
            status: "COMPLETE",
          })
          .where(eq(websiteSnapshots.id, snapshotId));
      }
    }

    console.log(`[OwnCrawler] Finished crawl for ${url}. Pages: ${pagesCrawled.length}, Hash: ${overallHash}`);
    return pagesCrawled;
  } catch (error: any) {
    console.error(`[OwnCrawler] Failed: ${error.message}`);
    if (snapshotId && !snapshotId.startsWith("offline_")) {
      try {
        const [existingRow] = await db
          .select({ id: websiteSnapshots.id })
          .from(websiteSnapshots)
          .where(eq(websiteSnapshots.id, snapshotId))
          .limit(1);

        if (existingRow) {
          await db.update(websiteSnapshots)
            .set({
              status: "FAILED",
              failureCode: error.code || "FETCH_FAILED",
            })
            .where(eq(websiteSnapshots.id, snapshotId));
        }
      } catch (dbErr) {
        console.warn(`[OwnCrawler] Failed to record failure state:`, dbErr);
      }
    }
    throw error;
  }
}
