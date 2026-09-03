import fs from 'fs';

async function main() {
  const logPath = 'C:\\Users\\mahmo\\.gemini\\antigravity\\brain\\30f73e45-fa5f-494f-a081-d3bd1645b3b1\\.system_generated\\tasks\\task-6537.log';
  const logContent = fs.readFileSync(logPath, 'utf8');
  const lines = logContent.split('\n');

  console.log("Total log lines:", lines.length);

  // Search for key stages in log
  const keywords = [
    "target-assessment-engine",
    "product-assessment-engine",
    "strategic-pain-decision",
    "PAIN_REGISTRY_BUILT",
    "STRATEGIC_LANES_BUILT",
    "lane-grouper",
    "PositioningEngine-V3",
    "MechanismEngine",
    "OfferEngine",
    "AwarenessEngine",
    "FunnelEngine",
    "PersuasionEngine",
    "ChannelSelection",
    "STRATEGY_ROOT",
    "PlanSynthesis",
    "STRATEGIC_EXCLUDED",
    "CORE_PURCHASE",
    "SUPPORTING",
    "seg_1_pain",
    "seg_2_pain",
    "seg_3_pain",
    "Migrated Platform Community Engagement Deficit",
    "SaaS Billing Trust Repair Engine"
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (keywords.some(k => line.includes(k))) {
      if (line.length > 500) {
        console.log(`[L${i+1}] ${line.slice(0, 500)}...`);
      } else {
        console.log(`[L${i+1}] ${line}`);
      }
    }
  }
}

main();
