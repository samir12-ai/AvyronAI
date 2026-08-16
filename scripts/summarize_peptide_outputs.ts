import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";

  console.log("=========================================");
  console.log("PEPTIDE CAMPAIGN SUMMARY OF ENGINE OUTPUTS");
  console.log("=========================================");

  // 1. Audience
  const aud = await db.execute(sql`SELECT * FROM audience_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (aud.rows.length > 0) {
    const data = aud.rows[0];
    console.log(`\n--- AUDIENCE ENGINE ---`);
    console.log(`Snapshot ID: ${data.id}`);
    console.log(`Global Sophistication Tier: ${data.global_sophistication_tier}`);
    
    // Parse target_segments
    try {
      const segs = JSON.parse(data.target_segments as string);
      console.log(`Segments Found (${segs.length}):`);
      segs.forEach((s: any, idx: number) => {
        console.log(`  ${idx + 1}. Name: ${s.name}`);
        console.log(`     Tier: ${s.sophisticationTier}`);
        console.log(`     Pains: ${s.pains?.slice(0, 3).map((p: any) => p.pain || p).join("; ")}`);
      });
    } catch (e) {
      console.log(`Target Segments (raw): ${data.target_segments}`);
    }
  }

  // 2. Positioning
  const pos = await db.execute(sql`SELECT * FROM positioning_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (pos.rows.length > 0) {
    const data = pos.rows[0];
    console.log(`\n--- POSITIONING ENGINE ---`);
    console.log(`Snapshot ID: ${data.id}`);
    try {
      const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      console.log(`Primary Territory: ${result.primaryTerritory?.name}`);
      console.log(`Enemy Definition: ${result.primaryTerritory?.enemyDefinition}`);
      console.log(`Contrast Axis: ${result.primaryTerritory?.contrastAxis}`);
      console.log(`Category Game Dimension: ${result.categoryGame?.dimension}`);
    } catch (e) {
      console.log(`Positioning Result (raw): ${data.result}`);
    }
  }

  // 3. Differentiation
  const diff = await db.execute(sql`SELECT * FROM differentiation_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (diff.rows.length > 0) {
    const data = diff.rows[0];
    console.log(`\n--- DIFFERENTIATION ENGINE ---`);
    console.log(`Snapshot ID: ${data.id}`);
    try {
      const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      console.log(`Pillars Found (${result.pillars?.length || 0}):`);
      result.pillars?.forEach((p: any, idx: number) => {
        console.log(`  ${idx + 1}. Name: ${p.name}`);
        console.log(`     Claim: ${p.primaryClaim}`);
        console.log(`     Grounding Signals: ${p.signals?.join("; ")}`);
      });
    } catch (e) {
      console.log(`Differentiation Result (raw): ${data.result}`);
    }
  }

  // 4. Mechanism
  const mech = await db.execute(sql`SELECT * FROM mechanism_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (mech.rows.length > 0) {
    const data = mech.rows[0];
    console.log(`\n--- MECHANISM ENGINE ---`);
    console.log(`Snapshot ID: ${data.id}`);
    try {
      const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      console.log(`Mechanism Name: ${result.mechanismName}`);
      console.log(`Mechanism Promise: ${result.mechanismPromise}`);
      console.log(`Steps (${result.mechanismSteps?.length || 0}):`);
      result.mechanismSteps?.forEach((s: any, idx: number) => {
        console.log(`  - Step ${idx + 1}: ${s}`);
      });
    } catch (e) {
      console.log(`Mechanism Result (raw): ${data.result}`);
    }
  }

  // 5. Offer
  const offer = await db.execute(sql`SELECT * FROM offer_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (offer.rows.length > 0) {
    const data = offer.rows[0];
    console.log(`\n--- OFFER ENGINE ---`);
    console.log(`Snapshot ID: ${data.id}`);
    try {
      const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      console.log(`Primary Offer Name: ${result.offerName}`);
      console.log(`Core Payoff/Outcome: ${result.coreOutcome}`);
      console.log(`Pricing Model: ${result.pricingModel}`);
      console.log(`Risk Reversal: ${result.riskReversal}`);
    } catch (e) {
      console.log(`Offer Result (raw): ${data.result}`);
    }
  }

  // 6. Funnel
  const fun = await db.execute(sql`SELECT * FROM funnel_snapshots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (fun.rows.length > 0) {
    const data = fun.rows[0];
    console.log(`\n--- FUNNEL ENGINE ---`);
    console.log(`Snapshot ID: ${data.id}`);
    try {
      const result = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      console.log(`Funnel Type: ${result.funnelType}`);
      console.log(`Stages (${result.journeyStages?.length || 0}):`);
      result.journeyStages?.forEach((s: any, idx: number) => {
        console.log(`  - Stage ${idx + 1}: ${s.stageName} (Objective: ${s.stageObjective})`);
        console.log(`    Objections: ${s.objections?.join("; ")}`);
      });
    } catch (e) {
      console.log(`Funnel Result (raw): ${data.result}`);
    }
  }

  // 7. Strategy Root
  const roots = await db.execute(sql`SELECT * FROM strategy_roots WHERE campaign_id = ${campaignId} ORDER BY created_at DESC LIMIT 1`);
  if (roots.rows.length > 0) {
    const data = roots.rows[0];
    console.log(`\n--- STRATEGY ROOT ---`);
    console.log(`ID: ${data.id}`);
    console.log(`Approved Positioning: ${data.approved_positioning}`);
    console.log(`Approved Mechanism: ${JSON.stringify(data.approved_mechanism)}`);
    console.log(`Approved Objections: ${JSON.stringify(data.approved_objections)}`);
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
