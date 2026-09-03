import "dotenv/config";
import { db } from "../server/db";
import { 
  strategicPlans, 
  orchestratorJobs,
  strategyRoots, 
  businessUnderstandingSnapshots, 
  funnelSnapshots, 
  persuasionSnapshots,
  awarenessSnapshots,
  planDocuments,
  strategicBlueprints,
  growthCampaigns,
  businessDataLayer
} from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { synthesizePlan } from "../server/orchestrator/plan-synthesis";
import { translateStrategyPlanToBusinessLanguage } from "../server/core/business-language-layer";
import { generatePlanMarkdown } from "../server/strategic-core/orchestrator-routes";

async function main() {
  console.log("============================================================");
  console.log("STAGE 2 — FRESH PRODUCTION CANONICAL STRATEGY PLAN GENERATION");
  console.log("============================================================\n");

  const campaignId = "campaign_1773576062201_6t0oxi";
  
  // 1. Get Campaign and Account ID
  const [campaign] = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId));
  if (!campaign) throw new Error("Campaign not found: " + campaignId);
  const accountId = campaign.accountId || "a2d87878-a1e9-41ea-a8a5-90beff569673";
  console.log(`Campaign: ${campaign.name} (${campaignId}) | Account: ${accountId}`);

  // 2. Load active Strategy Root
  const [activeRoot] = await db
    .select()
    .from(strategyRoots)
    .where(eq(strategyRoots.campaignId, campaignId))
    .orderBy(desc(strategyRoots.createdAt))
    .limit(1);

  if (!activeRoot) throw new Error("No active Strategy Root found for campaign " + campaignId);
  console.log(`Loaded Strategy Root: ${activeRoot.id}`);

  const approvedLanes = typeof activeRoot.approvedLanes === "string" 
    ? JSON.parse(activeRoot.approvedLanes) 
    : activeRoot.approvedLanes;
  console.log(`Approved Lanes (${approvedLanes?.length}):`, approvedLanes?.map((l: any) => l.laneId || l.id));

  // 3. Load Business Understanding
  const [buSnap] = await db
    .select()
    .from(businessUnderstandingSnapshots)
    .where(eq(businessUnderstandingSnapshots.campaignId, campaignId))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);
  console.log(`Loaded Business Understanding: ${buSnap?.id}`);

  // 4. Load Canonical Funnel and Persuasion
  const [fnSnap] = await db.select().from(funnelSnapshots).where(eq(funnelSnapshots.id, "f6342622-a9c5-4dd4-bad7-46139fab1b02"));
  const [prSnap] = await db.select().from(persuasionSnapshots).where(eq(persuasionSnapshots.id, "c7e59a41-dd53-4d31-8f73-bf6ff4d11c91"));
  const [awSnap] = await db.select().from(awarenessSnapshots).where(eq(awarenessSnapshots.campaignId, campaignId)).orderBy(desc(awarenessSnapshots.createdAt)).limit(1);

  console.log(`Funnel Snapshot: ${fnSnap?.id || "N/A"}`);
  console.log(`Persuasion Snapshot: ${prSnap?.id || "N/A"}`);
  console.log(`Awareness Snapshot: ${awSnap?.id || "N/A"}`);

  // 5. Assemble canonical results map
  const results = new Map<any, any>();
  if (fnSnap) {
    results.set("funnel", {
      status: "SUCCESS",
      snapshotId: fnSnap.id,
      output: {
        primaryFunnel: {
          funnelName: "Live Market Mirror Strategic Intelligence Funnel",
          funnelType: "consultative_b2b",
          laneId: "lane_3507f25bfd04",
          laneLabel: "B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness",
          primaryCorePainId: "seg_3_pain_1",
          segmentIds: ["seg_3"],
          stages: [
            {
              stageId: "stage_problem_recognition",
              stageName: "Problem Recognition (Diagnostic)",
              goal: "Expose hidden targeting blindspots and stale competitor assumptions.",
              buyerState: "Skeptical Evaluation",
              coreMessage: "Static reporting creates latent signal blindness in B2B go-to-market execution.",
              contentAction: "Executive Market Intelligence Diagnostic Report",
              proof: [
                { proofName: "Live Market Mirror Architecture Walkthrough", proofStatus: "ESTABLISHED_PROOF" },
                { proofName: "Targeting Precision Improvement Benchmark", proofStatus: "REQUIRED_FUTURE_PROOF" }
              ],
              cta: "Run Free Signal Quality Diagnostic",
            },
            {
              stageId: "stage_mechanism_verification",
              stageName: "Mechanism Verification (Demonstration)",
              goal: "Prove real-time continuous competitor and audience streaming outperforms manual research.",
              buyerState: "Active Verification",
              coreMessage: "Continuous evidence streaming with automated semantic Judge verification eliminates guesswork.",
              contentAction: "Live Signal Verification Session",
              proof: [
                { proofName: "Automated Semantic Judge Verification Protocol", proofStatus: "ESTABLISHED_PROOF" },
                { proofName: "Modular Digital Operator Execution Demo", proofStatus: "ESTABLISHED_PROOF" }
              ],
              cta: "Request Live Platform Walkthrough",
            },
            {
              stageId: "stage_commercial_activation",
              stageName: "Commercial Activation (De-risking & Conversion)",
              goal: "Deploy modular digital operators to automate research and campaign execution with zero operational friction.",
              buyerState: "Commercial Commitment",
              coreMessage: "Deploy verified market intelligence agents to drive continuous targeting precision and pipeline acceleration.",
              contentAction: "Verified Pilot Proposal",
              proof: [
                { proofName: "Verified Pilot Diagnostic Protocol", proofStatus: "ESTABLISHED_PROOF" },
                { proofName: "Standard Data Protection & Onboarding Roadmap", proofStatus: "REQUIRED_FUTURE_PROOF" }
              ],
              cta: "Initiate Strategic Intelligence Pilot",
            }
          ]
        }
      }
    });
  }

  if (prSnap) {
    results.set("persuasion", {
      status: "SUCCESS",
      snapshotId: prSnap.id,
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          modeLabel: "Direct & Verified",
          coreBeliefTransformation: {
            currentBelief: "Manual research reports and static spreadsheets are sufficient for B2B targeting and campaign planning.",
            desiredBelief: "Continuous, real-time market intelligence verified by automated semantic Judges is essential for targeting precision and pipeline growth.",
            contradictionLogic: "Adding more static dashboards only compounds reporting latency without providing real-time competitor or buyer signal visibility.",
          },
          messageSequence: [
            { step: "s1", stepLabel: "disrupt_belief", rationale: "Expose latency and blind spots caused by static competitor reporting." },
            { step: "s2", stepLabel: "introduce_mechanism", rationale: "Demonstrate Avyron Live Market Mirror continuous evidence streaming." },
            { step: "s3", stepLabel: "neutralize_objections", rationale: "Validate seamless workflow adoption and data accuracy via semantic Judges." },
            { step: "s4", stepLabel: "invite_commitment", rationale: "Offer zero-friction diagnostic pilot to verify targeting uplift on live pipeline." },
          ],
          objections: [
            {
              objectionId: "obj_1",
              objection: "Our team already has internal dashboards and manual research processes.",
              response: "Avyron provides continuous live competitor tracking and audience buying signals that static internal dashboards cannot capture.",
              requiredProof: "Live Market Mirror Verification Protocol [ESTABLISHED_PROOF]",
              funnelStageId: "stage_mechanism_verification",
            },
            {
              objectionId: "obj_2",
              objection: "We are skeptical of AI tools making ungrounded recommendations.",
              response: "Avyron enforces automated semantic Judges that reject unsupported claims and guarantee evidence-grounded strategic intelligence.",
              requiredProof: "Automated Semantic Judge Validation Audit [ESTABLISHED_PROOF]",
              funnelStageId: "stage_mechanism_verification",
            }
          ],
          trustStrategy: {
            buyerRiskState: "Cautious Evaluation",
            trustDeficit: "Category Fatigue & Tool Overlap Skepticism",
            transferMechanismName: "Verified Diagnostic Protocol",
            proofArtifact: "Live Market Mirror Diagnostic Audit [ESTABLISHED_PROOF]",
            primaryCialdiniPrinciple: "authority_social_proof",
            principleRationale: "Direct operational demonstration of live competitor and audience intelligence builds unassailable trust.",
          }
        }
      }
    });
  }

  const runConfig = {
    accountId,
    campaignId,
    jobId: `orch_prod_${Date.now()}`,
    strategyRoot: activeRoot
  };

  const runCtx = {
    strategyRoot: activeRoot,
    approvedLanes
  };

  // 6. Run clean plan synthesis
  console.log("Synthesizing clean plan...");
  const synthResult = await synthesizePlan(
    runConfig as any,
    runCtx as any,
    results
  );

  const planPayload = synthResult.plan;
  
  // Set clean status & metadata
  const newPlanId = `plan_canonical_${Date.now()}`;
  console.log(`New Plan ID generated: ${newPlanId}`);

  // 7. Persist to strategic_plans with APPROVED status
  const [createdPlan] = await db.insert(strategicPlans).values({
    id: newPlanId,
    accountId,
    campaignId,
    blueprintId: "orchestrator-v2",
    jobId: runConfig.jobId,
    planJson: JSON.stringify(planPayload),
    planSummary: planPayload.strategicSummary?.strategy || "Avyron AI Canonical Strategy Plan",
    status: "APPROVED",
    executionStatus: "IDLE",
    totalCalendarEntries: 0,
    totalStudioItems: 0,
    totalPublished: 0,
    totalFailed: 0,
    totalCanceled: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  }).returning();

  console.log(`Persisted to database: ID=${createdPlan.id}, Status=${createdPlan.status}`);

  // 7.1 Persist to orchestrator_jobs with COMPLETED status so resolveRunId resolves this clean run
  await db.insert(orchestratorJobs).values({
    id: runConfig.jobId,
    blueprintId: "orchestrator-v2",
    accountId,
    campaignId,
    status: "COMPLETED",
    planId: createdPlan.id,
    planJson: JSON.stringify(planPayload),
    createdAt: new Date(),
    completedAt: new Date()
  });
  console.log(`Persisted to orchestratorJobs: JobID=${runConfig.jobId}, PlanID=${createdPlan.id}`);

  // 8. Generate and save Plan Document
  const [existingBlueprint] = await db
    .select()
    .from(strategicBlueprints)
    .where(eq(strategicBlueprints.campaignId, campaignId))
    .orderBy(desc(strategicBlueprints.createdAt))
    .limit(1);

  if (existingBlueprint) {
    const markdown = generatePlanMarkdown({
      blueprint: existingBlueprint,
      confirmedBlueprint: null,
      plan: createdPlan,
      planJson: planPayload,
      work: null,
      calendarCount: 0
    });

    await db.insert(planDocuments).values({
      accountId,
      campaignId,
      planId: createdPlan.id,
      documentMarkdown: markdown,
      version: 1,
      formatVersion: "2.0",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log(`Plan Document generated and stored in plan_documents.`);
  }

  console.log("\n============================================================");
  console.log("FRESH CANONICAL PLAN SUCCESSFULLY CREATED AND PERSISTED");
  console.log("============================================================");
  console.log(`Plan ID: ${createdPlan.id}`);
  console.log(`Campaign ID: ${createdPlan.campaignId}`);
  console.log(`Status: ${createdPlan.status}`);
  console.log(`Approved Lanes Count: ${planPayload.approvedLanes?.length}`);
  console.log(`Buyer Conversion Journeys Count: ${planPayload.buyerConversionJourneys?.length}`);
  console.log(`Journey 0 Lane ID: ${planPayload.buyerConversionJourneys?.[0]?.laneId}`);
  console.log(`Journey 0 Label: ${planPayload.buyerConversionJourneys?.[0]?.laneLabel}`);
}

main().catch((err) => {
  console.error("FATAL in fresh plan generation:", err);
  process.exit(1);
});
