import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  let out = "";
  const append = (str: string) => { out += str + "\n"; };

  append("================================================================================");
  append("  DETAILED SNAPSHOT INSPECTION FOR MARKETMIND");
  append("================================================================================");

  // Audience Snapshots
  const aud = JSON.parse(fs.readFileSync(path.join(dir, "audience_snapshots.json"), "utf8"));
  append("\n>>> AUDIENCE SNAPSHOTS:");
  aud.forEach((a: any) => {
    append(`\nID: ${a.id} | Engine Version: ${a.engine_version} | Status: ${a.status} | CreatedAt: ${a.created_at}`);
    const segs = typeof a.segments === "string" ? JSON.parse(a.segments) : a.segments;
    append("Segments: " + JSON.stringify(segs, null, 2));
    const pains = typeof a.pains === "string" ? JSON.parse(a.pains) : a.pains;
    append("Pains: " + JSON.stringify(pains, null, 2));
    const desires = typeof a.desires === "string" ? JSON.parse(a.desires) : a.desires;
    append("Desires: " + JSON.stringify(desires, null, 2));
    const un = typeof a.unresolved_needs === "string" ? JSON.parse(a.unresolved_needs) : a.unresolved_needs;
    append("Unresolved Needs: " + JSON.stringify(un, null, 2));
  });

  // Positioning Snapshots
  const pos = JSON.parse(fs.readFileSync(path.join(dir, "positioning_snapshots.json"), "utf8"));
  append("\n>>> POSITIONING SNAPSHOTS:");
  pos.forEach((p: any) => {
    append(`\nID: ${p.id} | Engine Version: ${p.engine_version} | Status: ${p.status} | CreatedAt: ${p.created_at}`);
    const terr = typeof p.territory === "string" ? JSON.parse(p.territory) : p.territory;
    append("Selected Territory: " + JSON.stringify(terr, null, 2));
    append("Enemy Definition: " + p.enemy_definition);
    append("Contrast Axis: " + p.contrast_axis);
    const terrs = typeof p.territories === "string" ? JSON.parse(p.territories) : p.territories;
    append("Candidate Territories: " + JSON.stringify(terrs, null, 2));
  });

  // Differentiation Snapshots
  const diff = JSON.parse(fs.readFileSync(path.join(dir, "differentiation_snapshots.json"), "utf8"));
  append("\n>>> DIFFERENTIATION SNAPSHOTS:");
  diff.forEach((d: any) => {
    append(`\nID: ${d.id} | Engine Version: ${d.engine_version} | Status: ${d.status} | CreatedAt: ${d.created_at}`);
    const claims = typeof d.approved_claims === "string" ? JSON.parse(d.approved_claims) : d.approved_claims;
    append("Approved Claims: " + JSON.stringify(claims, null, 2));
    const vec = typeof d.differentiation_vector === "string" ? JSON.parse(d.differentiation_vector) : d.differentiation_vector;
    append("Differentiation Vector: " + JSON.stringify(vec, null, 2));
  });

  // Mechanism Snapshots
  const mech = JSON.parse(fs.readFileSync(path.join(dir, "mechanism_snapshots.json"), "utf8"));
  append("\n>>> MECHANISM SNAPSHOTS:");
  mech.forEach((m: any) => {
    append(`\nID: ${m.id} | Engine Version: ${m.engine_version} | Status: ${m.status} | CreatedAt: ${m.created_at}`);
    const mechanism = typeof m.mechanism === "string" ? JSON.parse(m.mechanism) : m.mechanism;
    append("Selected Mechanism: " + JSON.stringify(mechanism, null, 2));
    const mechs = typeof m.mechanisms === "string" ? JSON.parse(m.mechanisms) : m.mechanisms;
    append("Candidate Mechanisms: " + JSON.stringify(mechs, null, 2));
  });

  // Offer Snapshots
  const off = JSON.parse(fs.readFileSync(path.join(dir, "offer_snapshots.json"), "utf8"));
  append("\n>>> OFFER SNAPSHOTS:");
  off.forEach((o: any) => {
    append(`\nID: ${o.id} | Engine Version: ${o.engine_version} | Status: ${o.status} | CreatedAt: ${o.created_at}`);
    const sel = typeof o.selected_offer === "string" ? JSON.parse(o.selected_offer) : o.selected_offer;
    append("Selected Offer: " + JSON.stringify(sel, null, 2));
  });

  // Awareness Snapshots
  const aw = JSON.parse(fs.readFileSync(path.join(dir, "awareness_snapshots.json"), "utf8"));
  append("\n>>> AWARENESS SNAPSHOTS:");
  aw.forEach((a: any) => {
    append(`\nID: ${a.id} | Engine Version: ${a.engine_version} | Status: ${a.status} | CreatedAt: ${a.created_at}`);
    const pr = typeof a.primary_route === "string" ? JSON.parse(a.primary_route) : a.primary_route;
    append("Primary Route: " + JSON.stringify(pr, null, 2));
  });

  // Persuasion Snapshots
  const per = JSON.parse(fs.readFileSync(path.join(dir, "persuasion_snapshots.json"), "utf8"));
  append("\n>>> PERSUASION SNAPSHOTS:");
  per.forEach((p: any) => {
    append(`\nID: ${p.id} | Engine Version: ${p.engine_version} | Status: ${p.status} | CreatedAt: ${p.created_at}`);
    const pr = typeof p.primary_route === "string" ? JSON.parse(p.primary_route) : p.primary_route;
    append("Primary Route: " + JSON.stringify(pr, null, 2));
  });

  // Funnel Snapshots
  const fun = JSON.parse(fs.readFileSync(path.join(dir, "funnel_snapshots.json"), "utf8"));
  append("\n>>> FUNNEL SNAPSHOTS:");
  fun.forEach((f: any) => {
    append(`\nID: ${f.id} | Engine Version: ${f.engine_version} | Status: ${f.status} | CreatedAt: ${f.created_at}`);
    append("Selected Funnel: " + JSON.stringify(f.selected_funnel || f, null, 2));
  });

  // Channel Selection Snapshots
  const chan = JSON.parse(fs.readFileSync(path.join(dir, "channel_selection_snapshots.json"), "utf8"));
  append("\n>>> CHANNEL SNAPSHOTS:");
  chan.forEach((c: any) => {
    append(`\nID: ${c.id} | Engine Version: ${c.engine_version} | Status: ${c.status} | CreatedAt: ${c.created_at}`);
    append("Selected Channels: " + JSON.stringify(c.selected_channels, null, 2));
    append("Channel Scores: " + JSON.stringify(c.channel_scores, null, 2));
  });

  fs.writeFileSync(path.join(process.cwd(), "scratch", "snapshot_details_utf8.txt"), out, "utf8");
  console.log("Successfully wrote snapshot_details_utf8.txt");
}

main();
