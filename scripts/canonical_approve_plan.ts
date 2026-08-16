import 'dotenv/config';
import { db } from '../server/db';
import { strategicPlans, planApprovals } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { casUpdateStrategicPlanByVersion } from '../server/strategic-core/cas-helper';
import { activateExecution } from '../server/execution-activation/engine';
import { logAudit } from '../server/audit';

async function canonicalApprove() {
  const planId = "f769dc1d-c022-4670-ac35-61b43d4d0c1b";
  const decidedBy = "client";
  const reason = "Clean E2E verification passed with multi-pain strategic lanes, complete awareness contract, and grounded causal depth.";

  console.log(`[Approval] Loading plan ${planId}...`);
  const [plan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
  if (!plan) {
    throw new Error(`Plan ${planId} not found`);
  }

  if (plan.status !== "DRAFT" && plan.status !== "READY_FOR_REVIEW") {
    console.log(`Plan status is already ${plan.status}`);
    return;
  }

  console.log(`[Approval] Executing CAS version update from version ${plan.version}...`);
  await casUpdateStrategicPlanByVersion(plan.id, plan.version, { status: "APPROVED", updatedAt: new Date() });

  console.log(`[Approval] Inserting plan approval audit record...`);
  await db.insert(planApprovals).values({
    planId: plan.id,
    accountId: plan.accountId,
    decision: "APPROVED",
    reason,
    decidedBy,
  });

  console.log(`[Approval] Logging audit event...`);
  await logAudit(plan.accountId, "PLAN_APPROVED", {
    details: { planId: plan.id, decidedBy },
  });

  console.log(`[Approval] Triggering execution activation...`);
  try {
    const activationResult = await activateExecution(plan.id);
    console.log(`[ExecutionActivation] Success=${activationResult.success} | State=${activationResult.newState}`);
  } catch (err: any) {
    console.error(`[ExecutionActivation] Error=${err.message}`);
  }

  const [approvedPlan] = await db.select().from(strategicPlans).where(eq(strategicPlans.id, planId)).limit(1);
  console.log("\n=== CANONICAL APPROVAL RESULT ===");
  console.log(`Plan ID: ${approvedPlan.id}`);
  console.log(`Status: ${approvedPlan.status}`);
  console.log(`Version: ${approvedPlan.version}`);
  console.log(`Execution Status: ${approvedPlan.executionStatus}`);
}

canonicalApprove().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
