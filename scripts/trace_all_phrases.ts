import * as fs from "fs";
import * as path from "path";

function main() {
  const dir = path.join(process.cwd(), "scratch", "marketmind_strategy_dump");

  const p = JSON.parse(fs.readFileSync(path.join(dir, "strategic_plans.json"), "utf8")).find((x: any) => x.id === "23b8556c-fe75-440a-8ccb-fd520a3d6273");
  const planJson = typeof p.plan_json === "string" ? JSON.parse(p.plan_json) : p.plan_json;

  const roots = JSON.parse(fs.readFileSync(path.join(dir, "strategy_roots.json"), "utf8"));
  const aud = JSON.parse(fs.readFileSync(path.join(dir, "audience_snapshots.json"), "utf8"));
  const pos = JSON.parse(fs.readFileSync(path.join(dir, "positioning_snapshots.json"), "utf8"));
  const diff = JSON.parse(fs.readFileSync(path.join(dir, "differentiation_snapshots.json"), "utf8"));
  const mech = JSON.parse(fs.readFileSync(path.join(dir, "mechanism_snapshots.json"), "utf8"));
  const off = JSON.parse(fs.readFileSync(path.join(dir, "offer_snapshots.json"), "utf8"));
  const aw = JSON.parse(fs.readFileSync(path.join(dir, "awareness_snapshots.json"), "utf8"));
  const per = JSON.parse(fs.readFileSync(path.join(dir, "persuasion_snapshots.json"), "utf8"));
  const fun = JSON.parse(fs.readFileSync(path.join(dir, "funnel_snapshots.json"), "utf8"));
  const chan = JSON.parse(fs.readFileSync(path.join(dir, "channel_selection_snapshots.json"), "utf8"));
  const goals = JSON.parse(fs.readFileSync(path.join(dir, "goal_decompositions.json"), "utf8"));

  console.log("=== PHRASE TRACE ===");

  // Check where each term appears
  const terms = [
    "Community Engagement Validation Proof Tracker",
    "Community Engagement and Identity Validation Gap",
    "Community Engagement and Social Validation Gap",
    "Activate & Community Engagement and Identity Validation Gap method",
    "Live Market Mirror",
    "15-engine strategy pipeline",
    "Most marketing lacks strategic direction",
    "cost and affordability concerns",
    "trust and credibility doubts",
    "belonging / community",
    "belonging and social proof",
    "desperation / urgency",
    "desire for attractiveness",
    "SMB Marketing Leaders Stalled by Lack of Competitor Complaint Insights",
    "B2B Agencies Needing Transparent",
    "Adaptive Strategy Pipelines Grounded in Real Market Signals",
    "SMB Founders Overwhelmed by Marketing Complexity Without Clear 'Why' Before 'What'",
    "legacy marketing community platforms",
    "Legacy marketing community platforms fail to provide",
    "proof led entry awareness route",
    "proof led persuasion architecture",
    "YouTube Organic",
    "Email Marketing",
    "50,000",
    "2,000,000",
    "2.5%",
    "72%",
    "59%",
    "9/10",
    "authority_nurture",
    "reach_growth",
    "community engagement reduces buyer uncertainty"
  ];

  const filesMap: Record<string, any> = {
    "Plan": planJson,
    "StrategyRoots": roots,
    "Audience": aud,
    "Positioning": pos,
    "Differentiation": diff,
    "Mechanism": mech,
    "Offer": off,
    "Awareness": aw,
    "Persuasion": per,
    "Funnel": fun,
    "Channel": chan,
    "Goals": goals,
  };

  for (const term of terms) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`SEARCH TERM: "${term}"`);
    console.log(`--------------------------------------------------------------------------------`);
    for (const [name, obj] of Object.entries(filesMap)) {
      const str = JSON.stringify(obj);
      if (str.toLowerCase().includes(term.toLowerCase())) {
        console.log(`  FOUND in: ${name}`);
      }
    }
  }
}

main();
