import 'dotenv/config';
import { db, pool } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import { ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorReviews } from "../../shared/schema";

const CAMPAIGN_ID = "campaign_1773576062201_6t0oxi";
const ACCOUNT_ID = "a2d87878-a1e9-41ea-a8a5-90beff569673";

async function run() {
  console.log("=== EVIDENCE RECALL FORENSIC AUDIT ===\n");

  // Load competitors
  const competitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, ACCOUNT_ID),
      eq(ciCompetitors.campaignId, CAMPAIGN_ID),
      eq(ciCompetitors.isActive, true),
    ));

  const competitorIds = competitors.map(c => c.id);
  console.log(`Competitors: ${competitors.length} (IDs: ${competitorIds.length})`);

  if (competitorIds.length === 0) {
    console.log("No competitors found.");
    await pool.end();
    process.exit(1);
  }

  const idList = sql.join(competitorIds.map(id => sql`${id}`), sql`, `);

  // Load posts, comments, reviews exactly as engine.ts does
  const [posts, rawComments, rawReviews] = await Promise.all([
    db.select({ caption: ciCompetitorPosts.caption, platform: ciCompetitorPosts.platform, competitorId: ciCompetitorPosts.competitorId })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} IN (${idList})`)
      .orderBy(desc(ciCompetitorPosts.createdAt))
      .limit(500),

    db.select({ commentText: ciCompetitorComments.commentText, competitorId: ciCompetitorComments.competitorId })
      .from(ciCompetitorComments)
      .where(sql`${ciCompetitorComments.competitorId} IN (${idList}) AND (${ciCompetitorComments.isSynthetic} = false OR ${ciCompetitorComments.isSynthetic} IS NULL) AND ${ciCompetitorComments.authorType} IS DISTINCT FROM 'owner'`)
      .orderBy(desc(ciCompetitorComments.createdAt))
      .limit(1500),

    db.select({ reviewText: ciCompetitorReviews.reviewText, competitorId: ciCompetitorReviews.competitorId })
      .from(ciCompetitorReviews)
      .where(sql`${ciCompetitorReviews.competitorId} IN (${idList}) AND ${ciCompetitorReviews.isSynthetic} = false`)
      .orderBy(desc(ciCompetitorReviews.createdAt))
      .limit(300),
  ]);

  const instagramPosts = posts.filter(p => !p.platform || p.platform === "instagram");
  const rawCaptionItems = instagramPosts
    .map(p => ({ text: p.caption, competitorId: p.competitorId }))
    .filter((i): i is { text: string; competitorId: string } => !!i.text && i.text.length > 5);
  const rawCommentItems = rawComments
    .map(c => ({ text: c.commentText, competitorId: c.competitorId }))
    .filter((i): i is { text: string; competitorId: string } => !!i.text && i.text.length > 3);
  const rawReviewItems = rawReviews
    .map(r => ({ text: r.reviewText, competitorId: r.competitorId }))
    .filter(i => i.text.length > 5);

  console.log(`\n## RAW POOL STATISTICS`);
  console.log(`- Captions (COMPETITOR_BRAND): ${rawCaptionItems.length}`);
  console.log(`- Comments (CUSTOMER_COMMENTER): ${rawCommentItems.length}`);
  console.log(`- Reviews (REVIEWER): ${rawReviewItems.length}`);
  console.log(`- Total Pool: ${rawCaptionItems.length + rawCommentItems.length + rawReviewItems.length}\n`);

  // SOURCE ACTOR DISTRIBUTION
  console.log(`## SOURCE ACTOR DISTRIBUTION`);
  console.log(`| Source Actor | Count | % |`);
  console.log(`|---|---|---|`);
  const totalPool = rawCaptionItems.length + rawCommentItems.length + rawReviewItems.length;
  console.log(`| COMPETITOR_BRAND | ${rawCaptionItems.length} | ${(rawCaptionItems.length/totalPool*100).toFixed(1)}% |`);
  console.log(`| CUSTOMER_COMMENTER | ${rawCommentItems.length} | ${(rawCommentItems.length/totalPool*100).toFixed(1)}% |`);
  console.log(`| REVIEWER | ${rawReviewItems.length} | ${(rawReviewItems.length/totalPool*100).toFixed(1)}% |`);
  console.log();

  // Classify ALL comments by content type
  let emojiNoise = 0;
  let genericPraise = 0;
  let questions = 0;
  let complaints = 0;
  let workflowProblem = 0;
  let promotional = 0;
  let substantive = 0;
  let ambiguousCount = 0;

  interface AuditComment { text: string; category: string; idx: number; wordCount: number; }
  const allAudited: AuditComment[] = [];

  for (let i = 0; i < rawCommentItems.length; i++) {
    const t = rawCommentItems[i].text;
    const lower = t.toLowerCase();
    const wordCount = t.split(/\s+/).length;
    let cat = "ambiguous";

    if (wordCount <= 3 && !/[a-zA-Z]{3,}/.test(t)) {
      emojiNoise++; cat = "emoji_noise";
    } else if (wordCount <= 5 && /^(great|awesome|love|amazing|nice|cool|good|wow|fire|best|this|so )/i.test(lower)) {
      genericPraise++; cat = "generic_praise";
    } else if (/\?/.test(t) && wordCount < 20) {
      questions++; cat = "question";
    } else if (/scam|refund|charged|cancel|worst|terrible|horrible|rip.?off|fraud|waste|don.?t buy|money back|unauthorized|stealing|stolen|ripped|cheat/i.test(lower)) {
      complaints++; cat = "complaint";
    } else if (/struggle|difficult|hard to|can.?t figure|confus|overwhelm|too complicated|time.?consuming|burn.?out|exhausting|frustrat/i.test(lower)) {
      workflowProblem++; cat = "workflow_problem";
    } else if (/check.*link|dm me|follow.*for|use.*code|discount|promo|sign up|click|giveaway/i.test(lower)) {
      promotional++; cat = "promotional";
    } else if (wordCount >= 10) {
      substantive++; cat = "substantive";
    } else {
      ambiguousCount++;
    }

    allAudited.push({ text: t, category: cat, idx: i, wordCount });
  }

  const total = rawCommentItems.length || 1;
  console.log(`## COMMENT CONTENT AUDIT (Heuristic Classification)`);
  console.log(`| Category | Count | % |`);
  console.log(`|---|---|---|`);
  console.log(`| Emoji/Noise | ${emojiNoise} | ${(emojiNoise/total*100).toFixed(1)}% |`);
  console.log(`| Generic Praise | ${genericPraise} | ${(genericPraise/total*100).toFixed(1)}% |`);
  console.log(`| Questions | ${questions} | ${(questions/total*100).toFixed(1)}% |`);
  console.log(`| Complaints | ${complaints} | ${(complaints/total*100).toFixed(1)}% |`);
  console.log(`| Workflow/Problem | ${workflowProblem} | ${(workflowProblem/total*100).toFixed(1)}% |`);
  console.log(`| Promotional/Bot | ${promotional} | ${(promotional/total*100).toFixed(1)}% |`);
  console.log(`| Substantive (10+ words) | ${substantive} | ${(substantive/total*100).toFixed(1)}% |`);
  console.log(`| Ambiguous | ${ambiguousCount} | ${(ambiguousCount/total*100).toFixed(1)}% |`);
  console.log();

  // 30 STRONGEST COMMENTS
  const strongCandidates = allAudited
    .filter(c => ["complaint", "workflow_problem", "substantive", "question"].includes(c.category))
    .sort((a, b) => b.wordCount - a.wordCount)
    .slice(0, 30);

  console.log(`## 30 STRONGEST COMMENTS (Most Likely Audience Signal)\n`);
  for (const sc of strongCandidates) {
    const evId = `EV-${rawCaptionItems.length + sc.idx}`;
    console.log(`### ${evId} [${sc.category}] (${sc.wordCount} words)`);
    console.log(`> "${sc.text.slice(0, 400)}"`);
    console.log();
  }

  // HISTORICAL SIGNAL PROBES
  console.log(`## HISTORICAL SIGNAL PROBES\n`);
  const probes = [
    { label: "price/cost/affordability", pattern: /price|cost|expensive|afford|cheap|pay|money|dollar|\$|pricing|subscription|fee/i },
    { label: "refund/cancel/billing", pattern: /refund|cancel|billing|charge|subscription|unsubscribe|payment/i },
    { label: "trust/scam/credibility", pattern: /scam|trust|legit|fake|real|honest|credib/i },
    { label: "support/help/service", pattern: /support|customer service|help desk|response|contact|ticket/i },
    { label: "complexity/confusion", pattern: /confus|complex|complic|overwhelm|understand|learn|figure out|hard to/i },
    { label: "workflow/time burden", pattern: /time|workflow|manual|automat|hours|schedule|posting|content creat/i },
    { label: "results/ROI/performance", pattern: /result|roi|return|performance|growth|sales|revenue|convert|leads/i },
    { label: "switching/alternative", pattern: /switch|altern|instead|better than|compared|versus|vs\b|moved to|tried/i },
    { label: "feature dissatisfaction", pattern: /feature|missing|wish|need|want|should have|doesn.?t have|lack/i },
  ];

  for (const probe of probes) {
    const commentMatches = rawCommentItems.filter(c => probe.pattern.test(c.text));
    console.log(`### ${probe.label}: ${commentMatches.length} comment matches`);
    if (commentMatches.length > 0) {
      const sample = commentMatches.slice(0, 3);
      for (const m of sample) {
        console.log(`  [CUSTOMER_COMMENTER] > "${m.text.slice(0, 250)}"`);
      }
    }
    console.log();
  }

  // SAMPLE CAPTIONS for context
  console.log(`## 5 SAMPLE COMPETITOR CAPTIONS (for contrast)\n`);
  for (let i = 0; i < Math.min(5, rawCaptionItems.length); i++) {
    console.log(`### EV-${i} [COMPETITOR_BRAND]`);
    console.log(`> "${rawCaptionItems[i].text.slice(0, 250)}"`);
    console.log();
  }

  await pool.end();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
