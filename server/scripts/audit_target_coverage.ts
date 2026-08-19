import 'dotenv/config';
import { db } from "../db";
import { ciCompetitors, ciCompetitorComments, ciCompetitorPosts, ciCompetitorReviews } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { SYNTHETIC_FILTERS } from "../audience-engine/constants";

function sanitizeTextItems<T extends { text: string }>(items: T[]): { clean: T[]; removed: number } {
  let removed = 0;
  const clean: T[] = [];
  for (const item of items) {
    const lower = item.text.toLowerCase();
    let isSynthetic = false;
    for (const filter of SYNTHETIC_FILTERS) {
      if (lower.includes(filter)) {
        isSynthetic = true;
        removed++;
        break;
      }
    }
    if (!isSynthetic) {
      clean.push(item);
    }
  }
  return { clean, removed };
}

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const competitors = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true),
    ));
  const competitorIds = competitors.map(c => c.id);
  const idList = sql.join(competitorIds.map(id => sql`${id}`), sql`, `);

  const [posts, rawComments, rawReviews] = await Promise.all([
    db.select({ caption: ciCompetitorPosts.caption, platform: ciCompetitorPosts.platform, competitorId: ciCompetitorPosts.competitorId })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} IN (${idList})`)
      .orderBy(desc(ciCompetitorPosts.createdAt))
      .limit(300),

    db.select({ commentText: ciCompetitorComments.commentText, competitorId: ciCompetitorComments.competitorId })
      .from(ciCompetitorComments)
      .where(sql`${ciCompetitorComments.competitorId} IN (${idList}) AND (${ciCompetitorComments.isSynthetic} = false OR ${ciCompetitorComments.isSynthetic} IS NULL) AND ${ciCompetitorComments.authorType} IS DISTINCT FROM 'owner'`)
      .orderBy(desc(ciCompetitorComments.createdAt))
      .limit(500),

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

  const captionSanitized = sanitizeTextItems(rawCaptionItems);
  const commentSanitized = sanitizeTextItems(rawCommentItems);

  const allRawEvidence = [
    ...captionSanitized.clean.map(i => ({ text: i.text, sourceActor: "COMPETITOR_BRAND" })),
    ...commentSanitized.clean.map(i => ({ text: i.text, sourceActor: "CUSTOMER_COMMENTER" })),
    ...rawReviewItems.map(i => ({ text: i.text, sourceActor: "REVIEWER" }))
  ].map((e, idx) => ({ id: `EV-${idx}`, text: e.text, sourceActor: e.sourceActor }));

  console.log(`\nExact Sanitized Pool: ${allRawEvidence.length} items`);
  console.log(`- Competitor Captions: ${captionSanitized.clean.length} (EV-0 to EV-${captionSanitized.clean.length - 1})`);
  console.log(`- Customer Comments: ${commentSanitized.clean.length} (EV-${captionSanitized.clean.length} to EV-${allRawEvidence.length - 1})`);

  // Inspect Segment 1 (EV-94, EV-98, EV-100...)
  console.log("\n=== SEGMENT 1 SAMPLE CITATIONS (EV-94, EV-98, EV-100, EV-101, EV-102, EV-103, EV-105, EV-195, EV-196, EV-197, EV-202, EV-254) ===");
  ["EV-94", "EV-98", "EV-100", "EV-101", "EV-102", "EV-103", "EV-105", "EV-195", "EV-196", "EV-197", "EV-202", "EV-254"].forEach(id => {
    const item = allRawEvidence.find(e => e.id === id);
    console.log(`[${id} | ${item?.sourceActor}]:\n  "${item?.text}"\n`);
  });

  // Inspect Segment 2 (EV-22, EV-74, EV-78, EV-79, EV-176)
  console.log("\n=== SEGMENT 2 CITATIONS (EV-22, EV-74, EV-78, EV-79, EV-176) ===");
  ["EV-22", "EV-74", "EV-78", "EV-79", "EV-176"].forEach(id => {
    const item = allRawEvidence.find(e => e.id === id);
    console.log(`[${id} | ${item?.sourceActor}]:\n  "${item?.text}"\n`);
  });

  // Inspect Segment 3 (EV-121, EV-356)
  console.log("\n=== SEGMENT 3 CITATIONS (EV-121, EV-356) ===");
  ["EV-121", "EV-356"].forEach(id => {
    const item = allRawEvidence.find(e => e.id === id);
    console.log(`[${id} | ${item?.sourceActor}]:\n  "${item?.text}"\n`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
