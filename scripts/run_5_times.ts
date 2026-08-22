import "dotenv/config";
import { runAudienceEngine } from "../server/audience-engine/engine";
import { buildAudiencePainRegistry } from "../server/shared/audience-pain-registry";
import { refineAudiencePainRegistry } from "../server/shared/pain-classifier";
import { db } from "../server/db";
import { brandConfig } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const miSnapshotId = "45876d50-a2fe-4dfc-b64f-4dfba1e14d76";

  const [bc] = await db.select().from(brandConfig).where(eq(brandConfig.accountId, accountId)).limit(1);
  const businessProfile = bc ? `Brand: ${bc.brandName || "Unknown"}. Industry: ${bc.targetIndustry || "Unknown"}. Tone: ${bc.tone || "Unknown"}.` : null;
  const productCapabilities = "product_capabilities"; // Actually we should fetch this properly if we care about accurate product fit. Wait, I can just grab it from a hardcoded string or bypass it for now.

  const runs: any[] = [];

  for (let i = 1; i <= 5; i++) {
    const jobId = `audit_run_b_${i}_${Date.now()}`;
    console.log(`\n\n=== RUN ${i} ===\n`);
    const res = await runAudienceEngine(accountId, campaignId, miSnapshotId, jobId);
    
    // We get the raw pains
    const rawSegments = res.audienceSegments || [];
    const rawPains = rawSegments.flatMap((s: any, sIdx: number) => (s.pains || []).map((p: any, pIdx: number) => ({
      painId: `pain_${sIdx + 1}_${pIdx + 1}`,
      canonical: p.claim || p.description,
      originalStatement: p.claim || p.description,
      role: s.role || s.roles?.[0]?.description,
      segmentId: s.name,
      segmentDefinition: s.segmentDefinition?.claim || s.name,
      roleClaimId: s.roleClaim?.claimId || s.roles?.[0]?.claimId,
      painClaimId: p.claimId,
      evidenceUids: p.sourceEvidenceIds || []
    })));

    const registry = buildAudiencePainRegistry(rawPains, { accountId, audienceSnapshotId: res.snapshotId }, rawSegments);
    
    // Product Fit
    const refined = await refineAudiencePainRegistry(registry, {
      accountId,
      campaignId,
      productCapabilities: "Fragmented data integration and analysis workflow breaks SMB founders’ ability to consolidate competitor, audience, and market intelligence into a unified, actionable marketing strategy.",
      businessProfile,
      audienceSegments: rawSegments,
      llmEnabled: true
    });

    runs.push({
      runId: i,
      snapshotId: res.snapshotId,
      registry: refined.registry
    });
  }

  // Dump the output
  const fs = require('fs');
  fs.writeFileSync('scratch/phase_b_5_runs.json', JSON.stringify(runs, null, 2));
  console.log("Done running 5 times.");
}
main().catch(console.error).then(() => process.exit(0));
