import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  console.log("================================================================================");
  console.log("  MARKETMIND CANONICAL STRATEGY WORD-BY-WORD PROVENANCE AUDIT — FORENSIC DUMP   ");
  console.log(`  Campaign: ${campaignId} | Account: ${accountId}`);
  console.log("================================================================================");

  // 1. Current Strategy Root
  const roots = await db.execute(sql`
    SELECT * FROM strategy_roots
    WHERE campaign_id = ${campaignId}
    ORDER BY created_at DESC
  `);
  console.log(`\n--- 1. STRATEGY ROOTS (count=${roots.rows.length}) ---`);
  roots.rows.forEach((r: any, idx: number) => {
    console.log(`[Strategy Root #${idx+1}] ID: ${r.id}, version: ${r.version}, status: ${r.status}, createdAt: ${r.created_at}`);
    console.log(`  canonical_statement:`, r.canonical_statement);
    console.log(`  full_payload:`, JSON.stringify(r.payload || r, null, 2).slice(0, 1500));
  });

  // 2. Current Strategic Plans / Plan Documents
  const plans = await db.execute(sql`
    SELECT * FROM strategic_plans
    WHERE campaign_id = ${campaignId}
    ORDER BY created_at DESC
  `);
  console.log(`\n--- 2. STRATEGIC PLANS (count=${plans.rows.length}) ---`);
  plans.rows.forEach((p: any, idx: number) => {
    console.log(`[Strategic Plan #${idx+1}] ID: ${p.id}, status: ${p.status}, createdAt: ${p.created_at}`);
    console.log(`  plan_data:`, JSON.stringify(p.plan_data || p, null, 2).slice(0, 2000));
  });

  const planDocs = await db.execute(sql`
    SELECT * FROM plan_documents
    WHERE campaign_id = ${campaignId}
    ORDER BY created_at DESC
  `);
  console.log(`\n--- 2b. PLAN DOCUMENTS (count=${planDocs.rows.length}) ---`);
  planDocs.rows.forEach((p: any) => {
    console.log(`[Plan Doc] ID: ${p.id}, docType: ${p.doc_type}, createdAt: ${p.created_at}`);
    console.log(`  content:`, JSON.stringify(p.content || p.document, null, 2).slice(0, 2000));
  });

  // 3. Engine Snapshots
  const audSnaps = await db.execute(sql`SELECT * FROM audience_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 3. AUDIENCE SNAPSHOTS (count=${audSnaps.rows.length}) ---`);
  audSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const posSnaps = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 4. POSITIONING SNAPSHOTS (count=${posSnaps.rows.length}) ---`);
  posSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const diffSnaps = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 5. DIFFERENTIATION SNAPSHOTS (count=${diffSnaps.rows.length}) ---`);
  diffSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const mechSnaps = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 6. MECHANISM SNAPSHOTS (count=${mechSnaps.rows.length}) ---`);
  mechSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const offerSnaps = await db.execute(sql`SELECT * FROM offer_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 7. OFFER SNAPSHOTS (count=${offerSnaps.rows.length}) ---`);
  offerSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const awareSnaps = await db.execute(sql`SELECT * FROM awareness_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 8. AWARENESS SNAPSHOTS (count=${awareSnaps.rows.length}) ---`);
  awareSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const persSnaps = await db.execute(sql`SELECT * FROM persuasion_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 9. PERSUASION SNAPSHOTS (count=${persSnaps.rows.length}) ---`);
  persSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const funSnaps = await db.execute(sql`SELECT * FROM funnel_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 10. FUNNEL SNAPSHOTS (count=${funSnaps.rows.length}) ---`);
  funSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const chanSnaps = await db.execute(sql`SELECT * FROM channel_selection_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC`);
  console.log(`\n--- 11. CHANNEL SELECTION SNAPSHOTS (count=${chanSnaps.rows.length}) ---`);
  chanSnaps.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  // 4. BLL / Product Truth
  const bdl = await db.execute(sql`SELECT * FROM business_data_layer WHERE campaign_id = ${campaignId} OR account_id = ${accountId}`);
  console.log(`\n--- 12. BUSINESS DATA LAYER (count=${bdl.rows.length}) ---`);
  bdl.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  // 5. Goal Decompositions & Simulations
  const goals = await db.execute(sql`SELECT * FROM goal_decompositions WHERE campaign_id = ${campaignId}`);
  console.log(`\n--- 13. GOAL DECOMPOSITIONS (count=${goals.rows.length}) ---`);
  goals.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  const sims = await db.execute(sql`SELECT * FROM growth_simulations WHERE campaign_id = ${campaignId}`);
  console.log(`\n--- 14. GROWTH SIMULATIONS (count=${sims.rows.length}) ---`);
  sims.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  // 6. Root Bundles
  const bundles = await db.execute(sql`SELECT * FROM root_bundles WHERE campaign_id = ${campaignId}`);
  console.log(`\n--- 15. ROOT BUNDLES (count=${bundles.rows.length}) ---`);
  bundles.rows.forEach(r => console.log(JSON.stringify(r, null, 2).slice(0, 2000)));

  process.exit(0);
}

main().catch(console.error);
