import * as fs from 'fs';

const dump = JSON.parse(fs.readFileSync('scripts/target_run_dump.json', 'utf8'));

console.log("=== STRATEGY ROOT FOR TARGET RUN ===");
const targetRoot = dump.roots?.find((r: any) => r.run_id === 'orch_1787429278658_ba94b6') || dump.roots?.[0];
console.log(JSON.stringify(targetRoot, null, 2));

console.log("\n=== POSITIONING SNAPSHOT ===");
console.log({
  id: dump.positioningSnap?.id,
  territory: dump.positioningSnap?.territory,
  enemy_definition: dump.positioningSnap?.enemy_definition,
  contrast_axis: dump.positioningSnap?.contrast_axis,
  narrative_direction: dump.positioningSnap?.narrative_direction,
  differentiation_vector: dump.positioningSnap?.differentiation_vector,
});

console.log("\n=== MECHANISM SNAPSHOT ===");
console.log({
  id: dump.mechanismSnap?.id,
  primary_mechanism: dump.mechanismSnap?.primary_mechanism,
});

console.log("\n=== OFFER SNAPSHOT ===");
console.log({
  id: dump.offerSnap?.id,
  primary_offer: dump.offerSnap?.primary_offer,
});

console.log("\n=== AWARENESS SNAPSHOT ===");
console.log({
  id: dump.awarenessSnap?.id,
  primary_route: dump.awarenessSnap?.primary_route,
});
