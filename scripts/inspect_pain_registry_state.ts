import * as fs from "fs";

const data = JSON.parse(fs.readFileSync("production_e2e_run_output.json", "utf8"));

console.log("=== AUDIENCE SNAPSHOT ===");
const audSnap = data.audRow;
console.log("Audience Snapshot ID:", audSnap?.id);
console.log("Job ID:", audSnap?.jobId);
const parsedAud = typeof audSnap?.audienceData === "string" ? JSON.parse(audSnap.audienceData) : audSnap?.audienceData;
console.log("Audience segments count:", parsedAud?.audienceSegments?.length);
if (parsedAud?.audienceSegments) {
  parsedAud.audienceSegments.forEach((seg: any, sIdx: number) => {
    console.log(`\nSegment ${sIdx + 1}: ${seg.name} (id=${seg.id})`);
    console.log("  Roles:", seg.roles?.map((r: any) => `${r.description} (claimId=${r.claimId})`));
    console.log("  Pains count:", seg.pains?.length);
    seg.pains?.forEach((p: any) => {
      console.log(`    Pain: "${p.description}" | claimId=${p.claimId} | evidence=${p.sourceEvidenceIds?.join(",")}`);
    });
  });
}

console.log("\n=== TARGET COVERAGE ===");
const tc = parsedAud?.targetCoverage;
console.log("TC status:", tc?.status);
console.log("TC segmentMatches:", JSON.stringify(tc?.segmentMatches, null, 2));

console.log("\n=== RESULTS MAP (DIFFERENTIATION & POSITIONING) ===");
const resMap = data.resultsMap;
resMap?.forEach((r: any) => {
  console.log(`Engine: ${r.engineId} | Status: ${r.status} | BlockReason: ${r.blockReason}`);
});

console.log("\n=== DIFFERENTIATION SNAPSHOT ===");
const diffSnap = data.diffRow;
console.log("Diff Snapshot ID:", diffSnap?.id);
console.log("Diff Status:", diffSnap?.status);
console.log("Diff Pillars:", diffSnap?.differentiationPillars);
