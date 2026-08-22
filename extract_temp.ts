import "dotenv/config";
import { db } from "C:/Users/mahmo/Projects/AvyronAI/server/db";
import { orchestratorJobs, audienceSnapshots, differentiationSnapshots, strategyRoots, miSnapshots } from "C:/Users/mahmo/Projects/AvyronAI/shared/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs";

async function main() {
  const [job] = await db.select().from(orchestratorJobs).orderBy(desc(orchestratorJobs.createdAt)).limit(1);
  console.log("Job ID:", job.id);
  console.log("Job Status:", job.status);

  const [aud] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.jobId, job.id)).limit(1);
  console.log("Audience Snapshot ID:", aud?.id);
  
  const [diff] = await db.select().from(differentiationSnapshots).where(eq(differentiationSnapshots.jobId, job.id)).limit(1);
  const [mi] = await db.select().from(miSnapshots).where(eq(miSnapshots.jobId, job.id)).limit(1);
  console.log("MI Snapshot ID:", mi?.id);

  const report: any = {
    jobId: job.id,
    audId: aud?.id,
    miId: mi?.id,
    audiencePains: [],
    targetCoveredPains: [],
    coreCandidates: [],
    miFacts: [],
    diffProposer: null,
    diffJudge: null,
    positioning: null
  };

  let allPains: any[] = [];
  if (aud && typeof aud.audienceSegments === 'string') {
    const segs = JSON.parse(aud.audienceSegments);
    segs.forEach((s: any) => {
      s.pains?.forEach((p: any) => {
        allPains.push({ segmentId: s.name, role: p.role, ...p });
      });
    });
  } else if (aud && typeof aud.audienceSegments === 'object') {
    const segs = aud.audienceSegments as any[];
    segs.forEach((s: any) => {
      s.pains?.forEach((p: any) => {
        allPains.push({ segmentId: s.name, role: p.role, ...p });
      });
    });
  }
  
  // Trace the pains
  allPains.forEach(p => {
    report.audiencePains.push({
      painId: p.claimId,
      canonicalPain: p.claim,
      segmentId: p.segmentId,
      role: p.role,
      evidenceUids: p.evidenceUids || []
    });

    if (p.targetCovered) {
      report.targetCoveredPains.push({
        painId: p.claimId,
        requiredCapability: p.requiredCapability,
        matchedProductCapability: p.matchedProductCapability,
        productTruthFactIds: p.productTruthFactIds || [],
        fitType: p.fitType
      });
    }

    if (p.targetCovered && p.fitType === "DIRECT_FIT") {
      report.coreCandidates.push({
        painId: p.claimId,
        productFitAuthorityId: p.productFitAuthorityId,
        materialityVerdict: p.classification,
        classification: p.classification,
        coreDecisionId: p.coreDecisionId
      });
    }
  });
  
  if (mi && mi.dominanceData) {
    const domData = typeof mi.dominanceData === 'string' ? JSON.parse(mi.dominanceData) : mi.dominanceData;
    domData.forEach((d: any) => {
      d.canonicalFacts?.forEach((f: any) => {
        report.miFacts.push({
          miAuthorityId: f.factId,
          competitorId: d.competitorId,
          factType: f.factType || "unknown",
          canonicalFact: f.text || f.fact
        });
      });
    });
  }

  if (diff) {
    report.diffStatus = diff.status;
    report.diffStatusMessage = diff.statusMessage;
    const differentiations = typeof diff.differentiations === 'string' ? JSON.parse(diff.differentiations) : (diff.differentiations || []);
    const dispositions = typeof diff.painDispositions === 'string' ? JSON.parse(diff.painDispositions) : (diff.painDispositions || []);
    
    report.diffProposer = {
      model: "gpt-4o",
      corePains: report.coreCandidates.filter((c:any) => c.classification === "CORE_PURCHASE").length,
      painIds: report.coreCandidates.filter((c:any) => c.classification === "CORE_PURCHASE").map((c:any) => c.painId),
      candidates: differentiations.map((d: any) => ({
        differentiationId: d.differentiationId || d.id,
        corePainIds: d.corePainIds,
        differentiationClaim: d.differentiationClaim,
        comparisonBaseline: d.comparisonBaseline,
        distinctiveProperty: d.distinctiveProperty,
        buyerValue: d.buyerValue,
        productTruthFactIds: d.productTruthFactIds,
        miAuthorityIds: d.miAuthorityIds,
        mechanismStatus: d.mechanismStatus,
        proofBoundary: d.proofBoundary
      }))
    };
    
    // We don't have the explicit judge trace in the snapshot, but we can look at diff.auditTrace if it exists
    report.diffJudge = diff.auditTrace || dispositions;
    report.finalDispositions = dispositions;
  }

  const [strat] = await db.select().from(strategyRoots).orderBy(desc(strategyRoots.createdAt)).limit(1);
  if (strat && strat.runId === job.id) {
    report.positioning = strat.positioningStrategy ? "EXECUTED" : "BLOCKED";
  } else {
    report.positioning = "BLOCKED";
  }

  fs.writeFileSync("C:/Users/mahmo/.gemini/antigravity/brain/b8fb5dac-575e-4c9c-8460-77f7f7b3318d/scratch/real_e2e_report.json", JSON.stringify(report, null, 2));
  console.log("Extracted to scratch/real_e2e_report.json");
}

main().catch(console.error).then(() => process.exit(0));
