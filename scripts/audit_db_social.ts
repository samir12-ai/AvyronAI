import "dotenv/config";
import { db } from "../server/db";
import {
  userPublicProfiles,
  userChannelSnapshots,
  ownedPosts,
  ownedPostSnapshots,
  websiteSnapshots,
  businessDataLayer,
} from "@shared/schema";

async function main() {
  const actualAccountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  console.log("=== AUDITING ACTUAL ACCOUNT:", actualAccountId, "===");

  const bizData = await db.select().from(businessDataLayer);
  console.log("businessDataLayer total rows:", bizData.length);
  bizData.forEach((b) =>
    console.log(`bizData: id=${b.id}, accountId=${b.accountId}, campaignId=${b.campaignId}, websiteUrl=${b.websiteUrl}`)
  );

  const profiles = await db.select().from(userPublicProfiles);
  console.log("userPublicProfiles count:", profiles.length);
  profiles.forEach((p) => console.log(`profile: id=${p.id}, accountId=${p.accountId}, platform=${p.platform}, username=${p.username || p.handle}, followers=${p.followersCount}`));

  const channelSnaps = await db.select().from(userChannelSnapshots);
  console.log("userChannelSnapshots count:", channelSnaps.length);
  channelSnaps.forEach((c) => console.log(`channelSnap: id=${c.id}, accountId=${c.accountId}, platform=${c.platform}, followers=${c.followersCount}`));

  const posts = await db.select().from(ownedPosts);
  console.log("ownedPosts count:", posts.length);
  posts.forEach((p) => console.log(`ownedPost: id=${p.id}, accountId=${p.accountId}, campaignId=${p.campaignId}, caption=${p.caption?.slice(0, 30)}`));

  const postSnaps = await db.select().from(ownedPostSnapshots);
  console.log("ownedPostSnapshots count:", postSnaps.length);

  const webSnaps = await db.select().from(websiteSnapshots);
  console.log("websiteSnapshots count:", webSnaps.length);
  webSnaps.forEach((w) => console.log(`webSnap: id=${w.id}, accountId=${w.accountId}, campaignId=${w.campaignId}, url=${w.url}`));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
