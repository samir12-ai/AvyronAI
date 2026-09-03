import "dotenv/config";
import { db } from "../server/db";
import { 
  competitorSources, 
  competitorWebsiteSnapshots, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews, 
  ciCompetitors,
} from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  PAIN_CLUSTERS,
  DESIRE_CLUSTERS,
  OBJECTION_CLUSTERS,
  TRANSFORMATION_PATTERNS,
  EMOTIONAL_DRIVER_PATTERNS,
  LANGUAGE_PATTERNS,
  AUDIENCE_THRESHOLDS,
  MIN_EVIDENCE_PER_SIGNAL,
} from "../server/audience-engine/constants";

const ACCOUNT_ID = "f020f6c7-15d8-4129-90a6-83a40558c642";
const CAMPAIGN_ID = "camp_mtewrp8kkom3";

async function main() {
  console.log("================================================================================");
  console.log("FORENSIC TRACE: SARA-FT CUSTOMER VOICE -> AUDIENCE SIGNAL EXTRACTION & SGL");
  console.log("================================================================================\n");

  // 1. Fetch raw data
  const [allComps, allPosts, allComments, allReviews] = await Promise.all([
    db.select().from(ciCompetitors).where(and(eq(ciCompetitors.accountId, ACCOUNT_ID), eq(ciCompetitors.isActive, true))),
    db.select().from(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, ACCOUNT_ID)),
    db.select().from(ciCompetitorComments).where(and(
      eq(ciCompetitorComments.accountId, ACCOUNT_ID),
      sql`${ciCompetitorComments.authorType} IS DISTINCT FROM 'owner'`,
      sql`(${ciCompetitorComments.isSynthetic} = false OR ${ciCompetitorComments.isSynthetic} IS NULL)`
    )),
    db.select().from(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, ACCOUNT_ID)),
  ]);

  const compMap = new Map(allComps.map(c => [c.id, c.name]));

  console.log("--- 1. RAW INVENTORY OVERVIEW ---");
  console.log(`Competitors: ${allComps.length}`);
  console.log(`Posts: ${allPosts.length}`);
  console.log(`Comments (Non-owner, Non-synthetic): ${allComments.length}`);
  console.log(`Reviews: ${allReviews.length}`);

  // 2. Duplication Audit
  const rawTexts = allComments.map(c => (c.commentText || "").trim());
  const uniqueTexts = new Set(rawTexts);
  const textFreq: Record<string, number> = {};
  rawTexts.forEach(t => textFreq[t] = (textFreq[t] || 0) + 1);

  const postsWithComments = new Set(allComments.map(c => c.postId));
  const compsWithComments = new Set(allComments.map(c => c.competitorId));

  console.log("\n--- 2. DUPLICATION & CORPUS INTEGRITY ---");
  console.log(`Total Comments in DB: ${allComments.length}`);
  console.log(`Unique Comment Strings: ${uniqueTexts.size}`);
  console.log(`Posts with Comments: ${postsWithComments.size}`);
  console.log(`Competitors with Comments: ${compsWithComments.size}`);
  console.log(`Duplicate Rate: ${(((allComments.length - uniqueTexts.size) / allComments.length) * 100).toFixed(2)}%`);

  console.log("\nTop 15 Most Repeated Comment Strings:");
  Object.entries(textFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([text, count], i) => {
      console.log(`  [${i + 1}] (${count}x) "${text.slice(0, 60)}"`);
    });

  // 3. Competitor Representation Breakdown
  console.log("\n--- 3. COMPETITOR REPRESENTATION BREAKDOWN ---");
  const compDistribution: Record<string, { name: string; rawComments: number; posts: number }> = {};
  for (const c of allComps) {
    compDistribution[c.id] = { name: c.name, rawComments: 0, posts: 0 };
  }
  for (const p of allPosts) {
    if (compDistribution[p.competitorId]) compDistribution[p.competitorId].posts++;
  }
  for (const comm of allComments) {
    if (compDistribution[comm.competitorId]) compDistribution[comm.competitorId].rawComments++;
  }

  const sortedComps = Object.entries(compDistribution)
    .filter(([, v]) => v.rawComments > 0 || v.posts > 0)
    .sort((a, b) => b[1].rawComments - a[1].rawComments);

  console.log(`Competitors with active data (${sortedComps.length} competitors):`);
  sortedComps.slice(0, 20).forEach(([id, data]) => {
    console.log(`  ${data.name.padEnd(25)} (id: ${id}) | Posts: ${String(data.posts).padStart(3)} | Comments: ${String(data.rawComments).padStart(4)}`);
  });

  // 4. Semantic Categorization of Comments
  console.log("\n--- 4. HEURISTIC & PATTERN BREAKDOWN OF RAW COMMENTS ---");
  let emojiOnlyCount = 0;
  let genericPraiseCount = 0;
  let priceQueryCount = 0;
  let sizeQueryCount = 0;
  let shippingQueryCount = 0;
  let restockQueryCount = 0;
  let locationQueryCount = 0;
  let complaintCount = 0;
  let purchaseIntentCount = 0;
  let tagCount = 0;

  const emojiRegex = /^[\p{Emoji}\s\d\p{P}]+$/u;
  const priceKeywords = ["price", "cost", "how much", "combien", "prix", "??", "???", "????", "????"];
  const sizeKeywords = ["size", "fit", "length", "large", "small", "medium", "plus", "????", "????", "???"];
  const shippingKeywords = ["deliver", "shipping", "ship", "lebanon", "beirut", "?????", "???", "?????", "?????"];
  const restockKeywords = ["restock", "available", "stock", "when", "?????", "???", "????", "???"];
  const locationKeywords = ["where", "location", "branch", "shop", "store", "address", "?????", "???", "???", "???"];
  const genericPraiseWords = ["love", "wow", "beautiful", "nice", "gorgeous", "stunning", "mashallah", "pretty", "amazing", "super", "fire", "queen", "???", "????", "?????", "????", "?????"];
  const complaintKeywords = ["bad", "scam", "terrible", "worst", "never", "late", "delayed", "broken", "poor", "???", "???", "?????"];
  const purchaseIntentKeywords = ["order", "buy", "want", "book", "dm", "check dm", "inbox", "???", "???", "?????", "????"];

  for (const text of rawTexts) {
    const lower = text.toLowerCase();
    if (emojiRegex.test(text)) emojiOnlyCount++;
    if (genericPraiseWords.some(w => lower.includes(w))) genericPraiseCount++;
    if (priceKeywords.some(w => lower.includes(w))) priceQueryCount++;
    if (sizeKeywords.some(w => lower.includes(w))) sizeQueryCount++;
    if (shippingKeywords.some(w => lower.includes(w))) shippingQueryCount++;
    if (restockKeywords.some(w => lower.includes(w))) restockQueryCount++;
    if (locationKeywords.some(w => lower.includes(w))) locationQueryCount++;
    if (complaintKeywords.some(w => lower.includes(w))) complaintCount++;
    if (purchaseIntentKeywords.some(w => lower.includes(w))) purchaseIntentCount++;
    if (text.startsWith("@")) tagCount++;
  }

  console.log(`Total Comments Inspected: ${rawTexts.length}`);
  console.log(`  Emoji Only / Reaction Glyphs: ${emojiOnlyCount} (${((emojiOnlyCount / rawTexts.length) * 100).toFixed(1)}%)`);
  console.log(`  Generic Praise Mentions: ${genericPraiseCount}`);
  console.log(`  Friend Tags (@handle): ${tagCount}`);
  console.log(`  Price / Cost Inquiries: ${priceQueryCount}`);
  console.log(`  Size / Fit Inquiries: ${sizeQueryCount}`);
  console.log(`  Shipping / Delivery Inquiries: ${shippingQueryCount}`);
  console.log(`  Restock / Availability Inquiries: ${restockQueryCount}`);
  console.log(`  Store Location / Branch Inquiries: ${locationQueryCount}`);
  console.log(`  Purchase Intent / Order Requests: ${purchaseIntentCount}`);
  console.log(`  Complaints / Negative Friction: ${complaintCount}`);

  // 5. Trace Pattern Matching through Current Engine Logic
  console.log("\n--- 5. PATTERN CLUSTER MATCHING FUNNEL (BEFORE FILTERING) ---");
  
  const labeledComments = allComments.map(c => ({
    text: c.commentText || "",
    source: "comment",
    qualityWeight: 1.0,
    competitorId: c.competitorId,
  }));
  const labeledCaptions = allPosts.map(p => ({
    text: p.caption || "",
    source: "caption",
    qualityWeight: 0.6,
    competitorId: p.competitorId,
  }));

  const allLabeledTexts = [...labeledComments, ...labeledCaptions];

  function runMatch(clusters: any[], label: string) {
    console.log(`\nEvaluating ${label} (${clusters.length} canonical clusters defined):`);
    const hits: Array<{ canonical: string; rawCount: number; weightedCount: number; competitors: number; evidence: string[] }> = [];
    
    for (const cluster of clusters) {
      let rawCount = 0;
      let weightedCount = 0;
      const comps = new Set<string>();
      const ev: string[] = [];

      for (const item of allLabeledTexts) {
        const lower = item.text.toLowerCase();
        for (const pattern of cluster.patterns) {
          if (lower.includes(pattern.toLowerCase())) {
            rawCount++;
            weightedCount += item.qualityWeight;
            if (item.competitorId) comps.add(item.competitorId);
            if (ev.length < 3) ev.push(item.text.slice(0, 100));
            break;
          }
        }
      }

      if (rawCount > 0) {
        hits.push({
          canonical: cluster.canonical,
          rawCount,
          weightedCount,
          competitors: comps.size,
          evidence: ev,
        });
      }
    }

    hits.sort((a, b) => b.rawCount - a.rawCount);

    if (hits.length === 0) {
      console.log(`  -> 0 clusters matched any pattern.`);
    } else {
      hits.forEach((h, i) => {
        const passThreshold = h.rawCount >= MIN_EVIDENCE_PER_SIGNAL && h.weightedCount >= MIN_EVIDENCE_PER_SIGNAL;
        console.log(`  [${i + 1}] "${h.canonical}" | RawCount: ${h.rawCount} | Weighted: ${h.weightedCount.toFixed(1)} | Competitors: ${h.competitors} | ${passThreshold ? "PASSES INTEGRITY" : "FILTERED OUT (Count < 3)"}`);
        console.log(`      Evidence samples: ${JSON.stringify(h.evidence.slice(0, 2))}`);
      });
    }

    return hits;
  }

  const painHits = runMatch(PAIN_CLUSTERS, "PAIN_CLUSTERS");
  const desireHits = runMatch(DESIRE_CLUSTERS, "DESIRE_CLUSTERS");
  const objectionHits = runMatch(OBJECTION_CLUSTERS, "OBJECTION_CLUSTERS");
  const transformationHits = runMatch(TRANSFORMATION_PATTERNS, "TRANSFORMATION_PATTERNS");
  const driverHits = runMatch(EMOTIONAL_DRIVER_PATTERNS, "EMOTIONAL_DRIVER_PATTERNS");

  // 6. Stratified Sample of 100 Comments
  console.log("\n--- 6. STRATIFIED SAMPLE OF 100 REAL COMMENTS ---");
  const step = Math.max(1, Math.floor(allComments.length / 100));
  const sample100 = [];
  for (let i = 0; i < allComments.length && sample100.length < 100; i += step) {
    sample100.push(allComments[i]);
  }

  sample100.forEach((c, idx) => {
    const compName = compMap.get(c.competitorId) || "Unknown Competitor";
    const text = (c.commentText || "").trim();
    console.log(`  [${String(idx + 1).padStart(3)}] Competitor: ${compName.padEnd(25)} | Comment: "${text}"`);
  });
}

main().catch(console.error);
