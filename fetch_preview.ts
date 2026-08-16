import * as dotenv from 'dotenv';
dotenv.config();

import { db } from './server/db';
import { strategicPlans } from './shared/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const planId = '03f2a319-1dcd-4d2d-b274-ce8f3e9cd296';
  
  const [planRow] = await db.select({
      planJson: strategicPlans.planJson,
      status: strategicPlans.status
  })
  .from(strategicPlans)
  .where(eq(strategicPlans.id, planId));
  
  if (planRow) {
      const artifactPath = 'C:/Users/SFITELECOM FZCO/.gemini/antigravity/brain/51e86463-013f-45a2-b25a-8548e6d552a5/latest_plan_preview.json';
      
      const planParsed = JSON.parse(planRow.planJson);
      
      fs.writeFileSync(artifactPath, JSON.stringify({
          status: planRow.status,
          plan: planParsed
      }, null, 2));
      console.log('Successfully wrote latest plan to artifact');
  } else {
      console.log('Plan not found!');
  }
  
  process.exit(0);
}

main().catch(console.error);
