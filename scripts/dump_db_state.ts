import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots, positioningSnapshots, systemControlVerdicts } from "../shared/schema";
import { eq, desc } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1786718877499_3jk4zv";

  console.log(`=== DB VERIFICATION FOR ${campaignId} ===`);

  // Query Audience Snapshot
  const [latestAud] = await db
    .select()
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.campaignId, campaignId))
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (latestAud) {
    console.log(`\n=== LATEST AUDIENCE SNAPSHOT (${latestAud.id}) ===`);
    console.log(`Audience Status: ${latestAud.status}`);
    const rawSegments = latestAud.audienceSegments;
    const segments = Array.isArray(rawSegments) ? rawSegments : typeof rawSegments === "string" ? JSON.parse(rawSegments) : [];
    console.log(`Segments count: ${segments.length}`);
    segments.forEach((s: any) => {
      console.log(` - [Role: ${s.role}] ${s.name}: ${s.description}`);
    });

    const rawTargetCoverage = latestAud.targetCoverage;
    const targetCoverage = typeof rawTargetCoverage === "object" ? rawTargetCoverage : JSON.parse((rawTargetCoverage as string) || "{}");
    console.log(`\nTarget Coverage:`, JSON.stringify(targetCoverage, null, 2));

    const rawPains = latestAud.audiencePains;
    const pains = Array.isArray(rawPains) ? rawPains : typeof rawPains === "string" ? JSON.parse(rawPains) : [];
    console.log(`\nPains count: ${pains.length}`);
    pains.slice(0, 8).forEach((p: any) => {
      console.log(` - ${p.canonical || p.pain || p.name} (freq=${p.frequency})`);
    });
  }

  // Query Positioning Snapshot
  const [latestPos] = await db
    .select()
    .from(positioningSnapshots)
    .where(eq(positioningSnapshots.campaignId, campaignId))
    .orderBy(desc(positioningSnapshots.createdAt))
    .limit(1);

  if (latestPos) {
    console.log(`\n=== POSITIONING SNAPSHOT (${latestPos.id}) ===`);
    console.log(`Positioning Territories:`, latestPos.territories);
  } else {
    console.log(`\n=== POSITIONING SNAPSHOT: NONE (Halted cleanly at Positioning Engine) ===`);
  }

  // Query Latest System Control Verdict
  const [latestSc] = await db
    .select()
    .from(systemControlVerdicts)
    .where(eq(systemControlVerdicts.campaignId, campaignId))
    .orderBy(desc(systemControlVerdicts.createdAt))
    .limit(1);

  if (latestSc) {
    console.log(`\n=== SYSTEM CONTROL VERDICT (${latestSc.id}) ===`);
    console.log(`Verdict: ${latestSc.verdict}`);
    console.log(`Execution Mode: ${latestSc.executionMode}`);
    console.log(`Block Reasons:`, JSON.stringify(typeof latestSc.blockReasons === "string" ? JSON.parse(latestSc.blockReasons) : latestSc.blockReasons, null, 2));
    console.log(`Downgrades:`, JSON.stringify(typeof latestSc.downgrades === "string" ? JSON.parse(latestSc.downgrades) : latestSc.downgrades, null, 2));
    const rawChecks = latestSc.structuralChecks;
    const checks: any[] = Array.isArray(rawChecks) ? rawChecks : typeof rawChecks === "string" ? JSON.parse(rawChecks) : [];
    console.log(`Structural Checks count: ${checks.length}`);
    checks.forEach((c: any) => {
      console.log(` - ${c.check}: ${c.status} (${c.details || c.unverifiedReason || ""})`);
    });
  }

  process.exit(0);
}

main().catch(console.error);
