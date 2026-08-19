import * as fs from "fs";

const roots = JSON.parse(fs.readFileSync("scripts/sfi_roots_dump.json", "utf-8"));
console.log(`Found ${roots.length} roots`);
for (let i = 0; i < roots.length; i++) {
  const r = roots[i];
  console.log(`\n--- Root index ${i} ---`);
  console.log("ID:", r.id, "Status:", r.status, "Created:", r.created_at);
  console.log("Brand Spine:", r.brand_spine);
  console.log("Approved Lanes:", r.approved_lanes ? (typeof r.approved_lanes === 'string' ? JSON.parse(r.approved_lanes).length : r.approved_lanes.length) : null);
  if (r.approved_lanes) {
    const lanes = typeof r.approved_lanes === 'string' ? JSON.parse(r.approved_lanes) : r.approved_lanes;
    console.log("Lanes summary:", lanes.map((l: any) => ({
      laneId: l.laneId || l.id,
      audience: l.targetAudience || l.audience,
      pain: l.corePain || l.pain,
      angle: l.strategicAngle || l.angle,
    })));
  }
}
