import "dotenv/config";
import { db } from "../server/db";
import { ciCompetitors, ciCompetitorPosts, ciCompetitorComments, ciCompetitorReviews } from "@shared/schema";
import { eq, and, sql, desc } from "drizzle-orm";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  const compsExact = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true),
    ));

  console.log(`Matching ciCompetitors with exact campaignId '${campaignId}': ${compsExact.length}`);

  const compsAll = await db.select().from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.isActive, true),
    ));

  console.log(`Matching ciCompetitors with accountId only: ${compsAll.length}`);
  compsAll.forEach(c => console.log(`  - ${c.name} (id: ${c.id}, campaignId: ${c.campaignId})`));

  const competitorIds = compsAll.map(c => c.id);
  const idList = sql.join(competitorIds.map(id => sql`${id}`), sql`, `);

  const [posts, rawComments, rawReviews] = await Promise.all([
    db.select({ caption: ciCompetitorPosts.caption, platform: ciCompetitorPosts.platform, competitorId: ciCompetitorPosts.competitorId })
      .from(ciCompetitorPosts)
      .where(sql`${ciCompetitorPosts.competitorId} IN (${idList})`),

    db.select({ commentText: ciCompetitorComments.commentText, competitorId: ciCompetitorComments.competitorId })
      .from(ciCompetitorComments)
      .where(sql`${ciCompetitorComments.competitorId} IN (${idList}) AND (${ciCompetitorComments.isSynthetic} = false OR ${ciCompetitorComments.isSynthetic} IS NULL) AND ${ciCompetitorComments.authorType} IS DISTINCT FROM 'owner'`),

    db.select({ reviewText: ciCompetitorReviews.reviewText, competitorId: ciCompetitorReviews.competitorId })
      .from(ciCompetitorReviews)
      .where(sql`${ciCompetitorReviews.competitorId} IN (${idList}) AND ${ciCompetitorReviews.isSynthetic} = false`),
  ]);

  console.log(`\nQuery results using all competitor IDs:`);
  console.log(`  Posts: ${posts.length}`);
  console.log(`  Comments: ${rawComments.length}`);
  console.log(`  Reviews: ${rawReviews.length}`);
}

main().catch(console.error);
