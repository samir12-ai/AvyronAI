import * as fs from 'fs';

const dump = JSON.parse(fs.readFileSync('scripts/target_run_dump.json', 'utf8'));

console.log("================== FUNNEL SNAPSHOT ==================");
console.log(JSON.stringify(dump.funnelSnap, null, 2));

console.log("\n================== PERSUASION SNAPSHOT ==================");
console.log(JSON.stringify(dump.persuasionSnap, null, 2));
