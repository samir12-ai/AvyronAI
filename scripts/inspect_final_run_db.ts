import 'dotenv/config';
import { db } from '../server/db';
import {
  strategicPlans,
  planApprovals,
  awarenessSnapshots,
  funnelSnapshots,
  strategyRoots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  mechanismSnapshots,
  offerSnapshots,
  persuasionSnapshots,
  strategyValidationSnapshots,
  systemControlVerdicts,
  growthCampaigns,
} from '../shared/schema';
import { eq, desc } from 'drizzle-orm';

async function inspect() {
  const planId = "f769dc1d-c022-4670-ac35-61b43d4d0c1b";
  const campaignId = "campaign_1786718877499_3jk4zv";

  console.log("=== CAMPAIGN ===");
  const [campaign] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId)).limit(1);
  if (campaign) {
    console.log(`Campaign Name: ${campaign.name}`);
    console.log(`Product Name: ${campaign.productName}`);
    console.log(`Product Type: ${campaign.productType}`);
    console.log(`Account ID: ${campaign.accountId}`);
  }

  console.log("\n=== STRATEGIC PLAN ===");
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
  if (plan) {
    console.log(`Plan ID: ${plan.id}`);
    console.log(`Status: ${plan.status}`);
    console.log(`Version: ${plan.version}`);
    console.log(`Execution Status: ${plan.executionStatus}`);
    console.log(`Job ID: ${plan.jobId}`);
    console.log(`Total Calendar Entries: ${plan.totalCalendarEntries}`);
    console.log(`Total Studio Items: ${plan.totalStudioItems}`);
    const planJson = typeof plan.planJson === 'string' ? JSON.parse(plan.planJson) : plan.planJson;
    console.log(`Plan Summary: ${plan.planSummary?.substring(0, 150)}...`);
    console.log(`Has Business Representation (BLL): ${!!planJson?.businessRepresentation}`);
    if (planJson?.businessRepresentation) {
      console.log(`BLL Object Keys: ${Object.keys(planJson.businessRepresentation).join(", ")}`);
      console.log(`BLL Strategic Summary Strategy: ${planJson.businessRepresentation.strategicSummary?.strategy}`);
    }
  } else {
    console.log("Plan not found!");
  }

  console.log("\n=== PLAN APPROVALS ===");
  const approvals = await db.select().from(planApprovals).where(eq(planApprovals.planId, planId)).orderBy(desc(planApprovals.createdAt));
  console.log(`Approvals Count: ${approvals.length}`);
  approvals.forEach((a, i) => {
    console.log(`  Approval #${i + 1}: Decision=${a.decision} | DecidedBy=${a.decidedBy} | Reason=${a.reason} | CreatedAt=${a.createdAt}`);
  });

  console.log("\n=== AWARENESS SNAPSHOT ===");
  const [awareness] = await db.select().from(awarenessSnapshots).where(eq(awarenessSnapshots.campaignId, campaignId)).orderBy(desc(awarenessSnapshots.createdAt)).limit(1);
  if (awareness) {
    console.log(`Awareness ID: ${awareness.id}`);
    console.log(`Status: ${awareness.status}`);
    console.log(`Primary Route: ${typeof awareness.primaryRoute === 'string' ? awareness.primaryRoute.substring(0, 150) : JSON.stringify(awareness.primaryRoute).substring(0, 150)}`);
    console.log(`Confidence Score: ${awareness.confidenceScore}`);
    console.log(`Created At: ${awareness.createdAt}`);
  }

  console.log("\n=== FUNNEL SNAPSHOT ===");
  const [funnel] = await db.select().from(funnelSnapshots).where(eq(funnelSnapshots.campaignId, campaignId)).orderBy(desc(funnelSnapshots.createdAt)).limit(1);
  if (funnel) {
    console.log(`Funnel ID: ${funnel.id}`);
    console.log(`Status: ${funnel.status}`);
    console.log(`Depth Score: ${funnel.depthScore}`);
    console.log(`Primary Funnel: ${typeof funnel.primaryFunnel === 'string' ? funnel.primaryFunnel.substring(0, 200) : JSON.stringify(funnel.primaryFunnel).substring(0, 200)}...`);
    console.log(`Created At: ${funnel.createdAt}`);
  }

  console.log("\n=== STATISTICAL VALIDATION SNAPSHOT ===");
  const [statVal] = await db.select().from(strategyValidationSnapshots).where(eq(strategyValidationSnapshots.campaignId, campaignId)).orderBy(desc(strategyValidationSnapshots.createdAt)).limit(1);
  if (statVal) {
    console.log(`StatVal ID: ${statVal.id}`);
    console.log(`Status: ${statVal.status}`);
    console.log(`Confidence Score: ${statVal.confidenceScore}`);
    console.log(`Created At: ${statVal.createdAt}`);
  }

  console.log("\n=== SYSTEM CONTROL VERDICT ===");
  const [verdict] = await db.select().from(systemControlVerdicts).where(eq(systemControlVerdicts.campaignId, campaignId)).orderBy(desc(systemControlVerdicts.createdAt)).limit(1);
  if (verdict) {
    console.log(`Verdict ID: ${verdict.id}`);
    console.log(`Verdict: ${verdict.verdict}`);
    console.log(`Execution Mode: ${verdict.executionMode}`);
    console.log(`Created At: ${verdict.createdAt}`);
  }

  console.log("\n=== STRATEGY ROOT ===");
  const [root] = await db.select().from(strategyRoots).where(eq(strategyRoots.campaignId, campaignId)).orderBy(desc(strategyRoots.createdAt)).limit(1);
  if (root) {
    console.log(`Root ID: ${root.id}`);
    console.log(`Version: ${root.version}`);
    console.log(`Status: ${root.status}`);
    console.log(`Brand Spine: ${typeof root.brandSpine === 'string' ? root.brandSpine.substring(0, 150) : JSON.stringify(root.brandSpine).substring(0, 150)}...`);
    console.log(`Approved Lanes: ${typeof root.approvedLanes === 'string' ? root.approvedLanes.substring(0, 150) : JSON.stringify(root.approvedLanes).substring(0, 150)}...`);
  }
}

inspect().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
