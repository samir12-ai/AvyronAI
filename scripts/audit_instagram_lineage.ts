import "dotenv/config";
import { db } from "../server/db";
import {
  userPublicProfiles,
  ownedPosts,
  ownedPostSnapshots,
  websiteSnapshots,
  businessDataLayer,
  campaignSelections,
  strategicPlans,
  orchestratorJobs,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { assembleFactualDossier } from "../server/performance-loop/source-normalizer";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const scriptAccountId = "672c3737-2ba5-475b-b40a-5a3585dbcede";

  console.log("=== PART 1: CAMPAIGN & ACCOUNT AUDIT ===");
  const sel = await db.select().from(campaignSelections).where(eq(campaignSelections.selectedCampaignId, campaignId));
  console.log("campaignSelections count:", sel.length);
  if (sel.length > 0) console.log("campaignSelections:", sel[0]);

  const bizData = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId));
  console.log("businessDataLayer count:", bizData.length);
  if (bizData.length > 0) console.log("businessDataLayer:", bizData[0]);

  const plans = await db.select().from(strategicPlans).where(eq(strategicPlans.campaignId, campaignId));
  console.log("strategicPlans count:", plans.length);
  if (plans.length > 0) console.log("Plan accountId:", plans[0].accountId);

  const jobs = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.campaignId, campaignId));
  console.log("orchestratorJobs count:", jobs.length);
  if (jobs.length > 0) console.log("Job accountId:", jobs[0].accountId);

  console.log("\n=== PART 2: INSTAGRAM PROFILES & OWNED POSTS ===");
  const profiles = await db.select().from(userPublicProfiles);
  console.log("userPublicProfiles total count:", profiles.length);
  profiles.forEach(p => console.log(`Profile: id=${p.id}, accountId=${p.accountId}, platform=${p.platform}, username=${p.username || p.handle}, followers=${p.followersCount}`));

  const posts = await db.select().from(ownedPosts);
  console.log("ownedPosts total count:", posts.length);
  posts.forEach(p => console.log(`Post: id=${p.id}, accountId=${p.accountId}, campaignId=${p.campaignId}, caption=${p.caption?.slice(0, 40)}, postedAt=${p.postedAt}`));

  const postSnaps = await db.select().from(ownedPostSnapshots);
  console.log("ownedPostSnapshots total count:", postSnaps.length);

  console.log("\n=== PART 3: DOSSIER WITH scriptAccountId ===");
  const dossierScript = await assembleFactualDossier({ accountId: scriptAccountId, campaignId });
  console.log("Dossier for scriptAccountId:", JSON.stringify(dossierScript, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
