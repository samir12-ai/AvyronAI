import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  const activePlan = JSON.parse(fs.readFileSync(path.join(dir, "strategic_plans.json"), "utf8")).find((p: any) => p.id === "23b8556c-fe75-440a-8ccb-fd520a3d6273");
  const planJson = typeof activePlan.plan_json === "string" ? JSON.parse(activePlan.plan_json) : activePlan.plan_json;

  console.log("================================================================================");
  console.log("  ACTIVE PLAN SECTIONS (strategic_plans ID: 23b8556c-fe75-440a-8ccb-fd520a3d6273)");
  console.log("================================================================================");
  console.log("\n[sections.strategicSummary]:\n", JSON.stringify(planJson.sections?.strategicSummary, null, 2));
  console.log("\n[sections.businessRepresentation]:\n", JSON.stringify(planJson.sections?.businessRepresentation, null, 2));
  console.log("\n[sections.strategicPillars]:\n", JSON.stringify(planJson.sections?.strategicPillars, null, 2));
  console.log("\n[lockedDecisionLabels]:\n", JSON.stringify(planJson.lockedDecisionLabels, null, 2));

  console.log("\n================================================================================");
  console.log("  ALL ENGINE SNAPSHOTS ASSOCIATED WITH ACTIVE PLAN / ROOT");
  console.log("================================================================================");

  // Audience
  const aud = JSON.parse(fs.readFileSync(path.join(dir, "audience_snapshots.json"), "utf8"));
  console.log(`\n--- AUDIENCE SNAPSHOTS (count=${aud.length}) ---`);
  aud.forEach((a: any, i: number) => {
    console.log(`\nAudience Snapshot #${i+1} [ID: ${a.id}, status: ${a.status}, version: ${a.engine_version}, createdAt: ${a.created_at}]:`);
    console.log("  segments:", a.segments);
    console.log("  pains:", a.pains);
    console.log("  desires:", a.desires);
    console.log("  unresolvedNeeds:", a.unresolved_needs);
  });

  // Positioning
  const pos = JSON.parse(fs.readFileSync(path.join(dir, "positioning_snapshots.json"), "utf8"));
  console.log(`\n--- POSITIONING SNAPSHOTS (count=${pos.length}) ---`);
  pos.forEach((p: any, i: number) => {
    console.log(`\nPositioning Snapshot #${i+1} [ID: ${p.id}, status: ${p.status}, version: ${p.engine_version}, createdAt: ${p.created_at}]:`);
    console.log("  territory:", p.territory);
    console.log("  enemyDefinition:", p.enemy_definition);
    console.log("  contrastAxis:", p.contrast_axis);
    console.log("  territories:", p.territories);
  });

  // Differentiation
  const diff = JSON.parse(fs.readFileSync(path.join(dir, "differentiation_snapshots.json"), "utf8"));
  console.log(`\n--- DIFFERENTIATION SNAPSHOTS (count=${diff.length}) ---`);
  diff.forEach((d: any, i: number) => {
    console.log(`\nDifferentiation Snapshot #${i+1} [ID: ${d.id}, status: ${d.status}, version: ${d.engine_version}, createdAt: ${d.created_at}]:`);
    console.log("  approvedClaims:", d.approved_claims);
    console.log("  differentiationVector:", d.differentiation_vector);
  });

  // Mechanism
  const mech = JSON.parse(fs.readFileSync(path.join(dir, "mechanism_snapshots.json"), "utf8"));
  console.log(`\n--- MECHANISM SNAPSHOTS (count=${mech.length}) ---`);
  mech.forEach((m: any, i: number) => {
    console.log(`\nMechanism Snapshot #${i+1} [ID: ${m.id}, status: ${m.status}, version: ${m.engine_version}, createdAt: ${m.created_at}]:`);
    console.log("  mechanism:", m.mechanism);
    console.log("  mechanisms:", m.mechanisms);
  });

  // Offer
  const off = JSON.parse(fs.readFileSync(path.join(dir, "offer_snapshots.json"), "utf8"));
  console.log(`\n--- OFFER SNAPSHOTS (count=${off.length}) ---`);
  off.forEach((o: any, i: number) => {
    console.log(`\nOffer Snapshot #${i+1} [ID: ${o.id}, status: ${o.status}, version: ${o.engine_version}, createdAt: ${o.created_at}]:`);
    console.log("  selectedOffer:", o.selected_offer);
    console.log("  offers:", o.offers);
  });

  // Awareness
  const aw = JSON.parse(fs.readFileSync(path.join(dir, "awareness_snapshots.json"), "utf8"));
  console.log(`\n--- AWARENESS SNAPSHOTS (count=${aw.length}) ---`);
  aw.forEach((a: any, i: number) => {
    console.log(`\nAwareness Snapshot #${i+1} [ID: ${a.id}, status: ${a.status}, version: ${a.engine_version}, createdAt: ${a.created_at}]:`);
    console.log("  primaryRoute:", a.primary_route);
    console.log("  alternativeRoute:", a.alternative_route);
  });

  // Persuasion
  const per = JSON.parse(fs.readFileSync(path.join(dir, "persuasion_snapshots.json"), "utf8"));
  console.log(`\n--- PERSUASION SNAPSHOTS (count=${per.length}) ---`);
  per.forEach((p: any, i: number) => {
    console.log(`\nPersuasion Snapshot #${i+1} [ID: ${p.id}, status: ${p.status}, version: ${p.engine_version}, createdAt: ${p.created_at}]:`);
    console.log("  primaryRoute:", p.primary_route);
    console.log("  alternativeRoute:", p.alternative_route);
  });

  // Funnel
  const fun = JSON.parse(fs.readFileSync(path.join(dir, "funnel_snapshots.json"), "utf8"));
  console.log(`\n--- FUNNEL SNAPSHOTS (count=${fun.length}) ---`);
  fun.forEach((f: any, i: number) => {
    console.log(`\nFunnel Snapshot #${i+1} [ID: ${f.id}, status: ${f.status}, version: ${f.engine_version}, createdAt: ${f.created_at}]:`);
    console.log("  selectedFunnel:", f.selected_funnel);
    console.log("  funnels:", f.funnels);
  });

  // Channel Selection
  const chan = JSON.parse(fs.readFileSync(path.join(dir, "channel_selection_snapshots.json"), "utf8"));
  console.log(`\n--- CHANNEL SELECTION SNAPSHOTS (count=${chan.length}) ---`);
  chan.forEach((c: any, i: number) => {
    console.log(`\nChannel Snapshot #${i+1} [ID: ${c.id}, status: ${c.status}, version: ${c.engine_version}, createdAt: ${c.created_at}]:`);
    console.log("  selectedChannels:", c.selected_channels);
    console.log("  channelScores:", c.channel_scores);
    console.log("  decisionSummary:", c.decision_summary);
  });

  // Goal Decompositions
  const goals = JSON.parse(fs.readFileSync(path.join(dir, "goal_decompositions.json"), "utf8"));
  console.log(`\n--- GOAL DECOMPOSITIONS (count=${goals.length}) ---`);
  goals.forEach((g: any, i: number) => {
    console.log(`\nGoal Decomposition #${i+1}:`);
    console.log("  goal_type:", g.goal_type);
    console.log("  goal_target:", g.goal_target);
    console.log("  goal_label:", g.goal_label);
    console.log("  funnel_math:", g.funnel_math);
    console.log("  assumptions:", g.assumptions);
  });
}

main();
