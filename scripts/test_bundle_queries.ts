import "dotenv/config";
import { db } from "../server/db";
import { 
  competitorSources, 
  competitorWebsiteSnapshots, 
  ciCompetitorPosts, 
  ciCompetitorComments, 
  ciCompetitorReviews, 
  competitorPostClassifications,
  ciCompetitors
} from "@shared/schema";
import { eq, and, sql, desc, or, isNull } from "drizzle-orm";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  console.log("Testing Q1: ciCompetitors");
  const q1 = await db.select().from(ciCompetitors).where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true)));
  console.log("Q1 count:", q1.length);

  console.log("Testing Q2: competitorSources");
  const q2 = await db.select().from(competitorSources).where(and(eq(competitorSources.accountId, accountId), eq(competitorSources.campaignId, campaignId)));
  console.log("Q2 count:", q2.length);

  console.log("Testing Q3: competitorWebsiteSnapshots");
  const ids = q1.map(c => c.id);
  const q3 = await db.select().from(competitorWebsiteSnapshots).where(sql`${competitorWebsiteSnapshots.competitorId} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  console.log("Q3 count:", q3.length);

  console.log("Testing Q4: ciCompetitorPosts");
  const q4 = await db.select().from(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, accountId));
  console.log("Q4 count:", q4.length);

  console.log("Testing Q5: ciCompetitorComments");
  const q5 = await db.select().from(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, accountId));
  console.log("Q5 count:", q5.length);

  console.log("Testing Q6: ciCompetitorReviews");
  const q6 = await db.select().from(ciCompetitorReviews).where(eq(ciCompetitorReviews.accountId, accountId));
  console.log("Q6 count:", q6.length);

  console.log("Testing Q7: competitorPostClassifications");
  const postIds = q4.map(p => p.id).slice(0, 100);
  const q7 = await db.select().from(competitorPostClassifications).where(sql`${competitorPostClassifications.postId} IN (${sql.join(postIds.map(id => sql`${id}`), sql`, `)})`);
  console.log("Q7 count:", q7.length);
}

main().catch(console.error);
