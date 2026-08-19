import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  console.log("================================================================================");
  console.log("  DETAILED SNAPSHOT INSPECTION FOR MARKETMIND");
  console.log("================================================================================");

  // Audience Snapshots
  const aud = JSON.parse(fs.readFileSync(path.join(dir, "audience_snapshots.json"), "utf8"));
  console.log("\n>>> AUDIENCE SNAPSHOTS:");
  aud.forEach((a: any) => {
    console.log(`\nID: ${a.id} | Engine Version: ${a.engine_version} | Status: ${a.status}`);
    const segs = typeof a.segments === "string" ? JSON.parse(a.segments) : a.segments;
    console.log("Segments:", JSON.stringify(segs, null, 2));
    const pains = typeof a.pains === "string" ? JSON.parse(a.pains) : a.pains;
    console.log("Pains:", JSON.stringify(pains, null, 2));
    const desires = typeof a.desires === "string" ? JSON.parse(a.desires) : a.desires;
    console.log("Desires:", JSON.stringify(desires, null, 2));
    const un = typeof a.unresolved_needs === "string" ? JSON.parse(a.unresolved_needs) : a.unresolved_needs;
    console.log("Unresolved Needs:", JSON.stringify(un, null, 2));
  });

  // Positioning Snapshots
  const pos = JSON.parse(fs.readFileSync(path.join(dir, "positioning_snapshots.json"), "utf8"));
  console.log("\n>>> POSITIONING SNAPSHOTS:");
  pos.forEach((p: any) => {
    console.log(`\nID: ${p.id} | Engine Version: ${p.engine_version} | Status: ${p.status}`);
    const terr = typeof p.territory === "string" ? JSON.parse(p.territory) : p.territory;
    console.log("Selected Territory:", JSON.stringify(terr, null, 2));
    console.log("Enemy Definition:", p.enemy_definition);
    console.log("Contrast Axis:", p.contrast_axis);
    const terrs = typeof p.territories === "string" ? JSON.parse(p.territories) : p.territories;
    console.log("Candidate Territories:", JSON.stringify(terrs, null, 2));
  });

  // Mechanism Snapshots
  const mech = JSON.parse(fs.readFileSync(path.join(dir, "mechanism_snapshots.json"), "utf8"));
  console.log("\n>>> MECHANISM SNAPSHOTS:");
  mech.forEach((m: any) => {
    console.log(`\nID: ${m.id} | Engine Version: ${m.engine_version} | Status: ${m.status}`);
    const mechanism = typeof m.mechanism === "string" ? JSON.parse(m.mechanism) : m.mechanism;
    console.log("Selected Mechanism:", JSON.stringify(mechanism, null, 2));
    const mechs = typeof m.mechanisms === "string" ? JSON.parse(m.mechanisms) : m.mechanisms;
    console.log("Candidate Mechanisms:", JSON.stringify(mechs, null, 2));
  });

  // Differentiation Snapshots
  const diff = JSON.parse(fs.readFileSync(path.join(dir, "differentiation_snapshots.json"), "utf8"));
  console.log("\n>>> DIFFERENTIATION SNAPSHOTS:");
  diff.forEach((d: any) => {
    console.log(`\nID: ${d.id} | Engine Version: ${d.engine_version} | Status: ${d.status}`);
    const claims = typeof d.approved_claims === "string" ? JSON.parse(d.approved_claims) : d.approved_claims;
    console.log("Approved Claims:", JSON.stringify(claims, null, 2));
    const vec = typeof d.differentiation_vector === "string" ? JSON.parse(d.differentiation_vector) : d.differentiation_vector;
    console.log("Differentiation Vector:", JSON.stringify(vec, null, 2));
  });

  // Offer Snapshots
  const off = JSON.parse(fs.readFileSync(path.join(dir, "offer_snapshots.json"), "utf8"));
  console.log("\n>>> OFFER SNAPSHOTS:");
  off.forEach((o: any) => {
    console.log(`\nID: ${o.id} | Engine Version: ${o.engine_version} | Status: ${o.status}`);
    const sel = typeof o.selected_offer === "string" ? JSON.parse(o.selected_offer) : o.selected_offer;
    console.log("Selected Offer:", JSON.stringify(sel, null, 2));
  });

  // Awareness Snapshots
  const aw = JSON.parse(fs.readFileSync(path.join(dir, "awareness_snapshots.json"), "utf8"));
  console.log("\n>>> AWARENESS SNAPSHOTS:");
  aw.forEach((a: any) => {
    console.log(`\nID: ${a.id} | Engine Version: ${a.engine_version} | Status: ${a.status}`);
    const pr = typeof a.primary_route === "string" ? JSON.parse(a.primary_route) : a.primary_route;
    console.log("Primary Route:", JSON.stringify(pr, null, 2));
  });

  // Persuasion Snapshots
  const per = JSON.parse(fs.readFileSync(path.join(dir, "persuasion_snapshots.json"), "utf8"));
  console.log("\n>>> PERSUASION SNAPSHOTS:");
  per.forEach((p: any) => {
    console.log(`\nID: ${p.id} | Engine Version: ${p.engine_version} | Status: ${p.status}`);
    const pr = typeof p.primary_route === "string" ? JSON.parse(p.primary_route) : p.primary_route;
    console.log("Primary Route:", JSON.stringify(pr, null, 2));
  });

  // Funnel Snapshots
  const fun = JSON.parse(fs.readFileSync(path.join(dir, "funnel_snapshots.json"), "utf8"));
  console.log("\n>>> FUNNEL SNAPSHOTS:");
  fun.forEach((f: any) => {
    console.log(`\nID: ${f.id} | Engine Version: ${f.engine_version} | Status: ${f.status}`);
    console.log("Selected Funnel:", f.selected_funnel || f);
  });

  // Channel Selection Snapshots
  const chan = JSON.parse(fs.readFileSync(path.join(dir, "channel_selection_snapshots.json"), "utf8"));
  console.log("\n>>> CHANNEL SNAPSHOTS:");
  chan.forEach((c: any) => {
    console.log(`\nID: ${c.id} | Engine Version: ${c.engine_version} | Status: ${c.status}`);
    console.log("Selected Channels:", c.selected_channels);
    console.log("Channel Scores:", c.channel_scores);
  });
}

main();
