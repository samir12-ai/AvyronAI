import 'dotenv/config';
import { matchAudienceToTargetsWithJudge, NormalizedTargetRole } from "../audience-engine/target-coverage";

async function runTest(name: string, target: string, segment: string, def: string) {
  console.log(`\n------------------------------------------------------------`);
  console.log(`CASE: ${name}`);
  console.log(`Target: ${target}`);
  console.log(`Segment: ${segment}`);

  const targetRoles: NormalizedTargetRole[] = [{
    targetId: 't1',
    roleName: target,
    description: target,
    buyerType: 'UNKNOWN',
    sourceLineages: []
  }];

  const audienceSegments = [{
    id: 's1',
    name: segment,
    role: 'UNKNOWN',
    segmentDefinition: def || segment
  }];

  const result = await matchAudienceToTargetsWithJudge(targetRoles, audienceSegments, "gpt-4.1-mini", "gpt-4o-mini");
  
  if (result.matches && result.matches.length > 0) {
    const match = result.matches[0];
    console.log(`\nDecision: ${match.coverageDecision}`);
    console.log(`Reason: ${match.reason}`);
    console.log(`Judge Valid: ${result.valid}`);
    if (!result.valid) console.log(`Rejection: ${result.rejectionReasons}`);
  } else {
    console.log("No match evaluated or returned.");
  }
}

async function main() {
  await runTest(
    "1 - SAME PERSON, IRRELEVANT PAIN", 
    "SMB founders and owners", 
    "SMB Founders and Owners Struggling with Billing and Customer Service Issues", 
    ""
  );

  await runTest(
    "2 - VALID SEMANTIC IDENTITY", 
    "Marketing Managers and Marketing Leads", 
    "Marketing Professionals Focused on Data Quality and Targeting Accuracy", 
    "Marketing professionals and teams who prioritize clean, reliable data and improved targeting systems to enhance go-to-market strategies and decision-making."
  );

  await runTest(
    "3 - GENERIC BUT RELATED", 
    "Marketing Managers", 
    "Business professionals interested in AI software", 
    ""
  );

  await runTest(
    "4 - CLEAR DIFFERENT ROLE", 
    "CEOs", 
    "Customer support representatives", 
    ""
  );

  await runTest(
    "5 - NARROWER VALID SUBGROUP", 
    "Marketing teams", 
    "Paid acquisition managers responsible for campaign performance", 
    ""
  );

  await runTest(
    "6 - OWNER / STRATEGY ROLE", 
    "Agency owners and strategy leads", 
    "Agency strategy leads managing client campaigns", 
    ""
  );
}

main().catch(console.error);
