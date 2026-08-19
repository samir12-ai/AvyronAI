import 'dotenv/config';
import { db } from "../db";
import {
  ciCompetitorComments,
  ciEvidenceBatches,
  audienceSnapshots
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

async function main() {
  console.log("================================================================================");
  console.log("AVYRON — MARKETMIND RECALL AUDIT (PHASE 15 & 16)");
  console.log("================================================================================");

  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  // 1. Raw Evidence Pool Count & Content Analysis
  const comments = await db.select().from(ciCompetitorComments)
    .where(eq(ciCompetitorComments.accountId, accountId));

  console.log(`\n1. Total Scraped Raw Comments in DB for campaign: ${comments.length}`);

  // Search for themes: fragmented tools, scattered data, strategy confusion, manual research, workflow
  const themePatterns = [
    { name: "Fragmented Tools / Tabs", regex: /(tab|tabs|fragment|switch|multiple tool|scattered|disjointed)/i },
    { name: "Scattered Data / Insights / Manual Research", regex: /(data|insight|manual|research|spreadsheet|excel|gather|collect)/i },
    { name: "Strategy Confusion / Generic Advice / Positioning", regex: /(strategy|direction|generic|confus|advice|position|plan)/i },
    { name: "Email / Prospecting Workflows", regex: /(email|inbox|prospect|lead|outreach|crm)/i },
    { name: "Ad Design / Creative Burden", regex: /(ad|ads|design|creative|copy|convert|campaign)/i },
    { name: "Billing / Refund / Cancellation", regex: /(charge|unauthorized|refund|cancel|billing|money|subscri)/i }
  ];

  console.log("\nTheme distribution in raw scraped comments:");
  themePatterns.forEach(theme => {
    const matching = comments.filter(c => theme.regex.test(c.commentText || ""));
    console.log(`  - Theme: "${theme.name}" -> ${matching.length} comments`);
  });

  console.log("\n--- Sample Comments for 'Fragmented Tools / Tabs' ---");
  comments.filter(c => /(tab|tabs|fragment|switch|multiple tool|scattered|disjointed)/i.test(c.commentText || ""))
    .slice(0, 5)
    .forEach((c, idx) => console.log(`  [${idx + 1}] ID: ${c.id} | "${c.commentText}"`));

  console.log("\n--- Sample Comments for 'Scattered Data / Insights / Manual Research' ---");
  comments.filter(c => /(data|insight|manual|research|spreadsheet|excel|gather|collect)/i.test(c.commentText || ""))
    .slice(0, 5)
    .forEach((c, idx) => console.log(`  [${idx + 1}] ID: ${c.id} | "${c.commentText}"`));

  console.log("\n--- Sample Comments for 'Strategy Confusion / Generic Advice / Positioning' ---");
  comments.filter(c => /(strategy|direction|generic|confus|advice|position|plan)/i.test(c.commentText || ""))
    .slice(0, 5)
    .forEach((c, idx) => console.log(`  [${idx + 1}] ID: ${c.id} | "${c.commentText}"`));

  // 3. Latest Canonical Audience Snapshot
  const [snap] = await db.select().from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  console.log(`\n3. Canonical Audience Snapshot: ${snap?.id}`);
  const segments = JSON.parse((snap?.audienceSegments as string) || "[]");
  console.log(`  Canonical Segments Produced (${segments.length}):`);
  segments.forEach((s: any, idx: number) => {
    console.log(`\n  Segment ${idx + 1}: "${s.name}" (Role: ${s.role})`);
    console.log(`    Definition: "${s.segmentDefinition?.claim || s.segmentDefinition}"`);
    console.log(`    Pains (${s.pains?.length || 0}):`);
    (s.pains || []).forEach((p: any) => {
      console.log(`      - [${p.claimId}] "${p.claim}" (Evidence: ${JSON.stringify(p.evidenceIds)})`);
    });
  });

  console.log("\n================================================================================");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
