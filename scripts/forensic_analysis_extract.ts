import * as fs from 'fs';

const dump = JSON.parse(fs.readFileSync('scripts/target_run_dump.json', 'utf8'));

console.log("=== 1. ORCHESTRATOR JOB ===");
console.log({
  id: dump.job?.id,
  status: dump.job?.status,
  plan_id: dump.job?.plan_id,
  created_at: dump.job?.created_at,
  completed_at: dump.job?.completed_at,
  error: dump.job?.error,
});

console.log("\n=== 2. STRATEGY ROOTS ===");
console.log(`Found ${dump.roots?.length || 0} roots:`);
for (const r of dump.roots || []) {
  console.log(`- Root ID: ${r.id}, run_id: ${r.run_id}, created_at: ${r.created_at}, status: ${r.status}`);
  console.log(`  primaryAxis: ${r.primary_axis}`);
  console.log(`  contrastAxisText: ${r.contrast_axis_text}`);
  console.log(`  approved_claim: ${r.approved_claim}`);
  console.log(`  approved_mechanism: ${JSON.stringify(r.approved_mechanism)}`);
  console.log(`  approved_audience_pains: ${JSON.stringify(r.approved_audience_pains)}`);
  console.log(`  approved_lanes: ${JSON.stringify(r.approved_lanes)}`);
}

console.log("\n=== 3. STRATEGIC PAIN DECISIONS ===");
console.log(`Found ${dump.strategicPainDecisions?.length || 0} pain decisions:`);
for (const p of dump.strategicPainDecisions || []) {
  console.log(`- PainID: ${p.pain_id} | Final: ${p.final_classification} | Status: ${p.status} | Job: ${p.job_id}`);
  console.log(`  Reason: ${p.reason}`);
  console.log(`  Payload: ${JSON.stringify(p.payload)}`);
}
