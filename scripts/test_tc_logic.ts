import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import { buildAudiencePainRegistry, resolveTargetCoverageFit } from "../server/shared/audience-pain-registry";

async function main() {
  const snapRows = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, '3b2ca88a-1df9-4704-9bca-70e6579c2247'));
  const row = snapRows[0];
  
  const segments = typeof row.audienceSegments === 'string' ? JSON.parse(row.audienceSegments) : row.audienceSegments;
  const targetCoverage = typeof row.targetCoverage === 'string' ? JSON.parse(row.targetCoverage) : row.targetCoverage;

  const rawPains = segments.flatMap((s: any, sIdx: number) => (s.pains || []).map((p: any, pIdx: number) => ({
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

  const deterministicRegistry = buildAudiencePainRegistry(rawPains, { accountId: 'a2d87878-a1e9-41ea-a8a5-90beff569673', audienceSnapshotId: row.id }, segments);

  const coveredRegistry = resolveTargetCoverageFit(deterministicRegistry, targetCoverage, segments);

  for (const p of coveredRegistry) {
    console.log(`Pain: ${p.canonical}`);
    console.log(`Segment IDs: ${p.segmentIds.join(', ')}`);
    console.log(`Target Covered (Registry): ${p.targetCovered}`);
    console.log('---');
  }
}

main().catch(console.error).then(() => process.exit(0));
