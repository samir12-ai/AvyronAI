import "dotenv/config";
import { db } from "../server/db";
import { ciCompetitorPosts, ciCompetitorComments, competitorWebsiteSnapshots } from "@shared/schema";
import { eq } from "drizzle-orm";
import { initializeSignalGovernance, resolveSignalsForEngine } from "../server/signal-governance/engine";
import { ENGINE_SIGNAL_REQUIREMENTS } from "../server/signal-governance/types";

async function main() {
  const accountId = "f020f6c7-15d8-4129-90a6-83a40558c642";
  const campaignId = "camp_mtewrp8kkom3";

  // Query all comments
  const comms = await db.select().from(ciCompetitorComments).where(eq(ciCompetitorComments.accountId, accountId));
  // Query all posts
  const posts = await db.select().from(ciCompetitorPosts).where(eq(ciCompetitorPosts.accountId, accountId));
  // Query all snapshots
  const snaps = await db.select().from(competitorWebsiteSnapshots);

  console.log(`Total database evidence:`);
  console.log(`  Comments: ${comms.length}`);
  console.log(`  Posts: ${posts.length}`);
  console.log(`  Web Snapshots: ${snaps.length}`);

  // Extract customer voice text samples
  const commentTexts = comms.map(c => c.commentText).filter((t): t is string => typeof t === "string" && t.length > 3);
  const postCaptions = posts.map(p => p.caption).filter((t): t is string => typeof t === "string" && t.length > 5);

  console.log(`  Valid comment texts: ${commentTexts.length}`);
  console.log(`  Valid post captions: ${postCaptions.length}`);

  console.log("\nSample real comments:");
  commentTexts.slice(0, 10).forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
}

main().catch(console.error);
