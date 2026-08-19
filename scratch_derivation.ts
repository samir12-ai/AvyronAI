import 'dotenv/config';
import { db } from './server/db';
import { businessDataLayer } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { deriveAnchorFromProductDna } from './server/shared/strategic-doctrine';
import { writeProductAnchorAudited } from './server/shared/product-anchor-writer';

async function run() {
  const campaignId = 'campaign_1773576062201_6t0oxi';
  const biz = await db.select().from(businessDataLayer).where(eq(businessDataLayer.campaignId, campaignId)).limit(1);
  
  if (!biz || biz.length === 0) {
    console.log('No biz data found');
    process.exit(1);
  }

  const anchor = deriveAnchorFromProductDna(biz[0] as any);
  console.log('Derived Anchor strategicAdvantage:', anchor?.strategicAdvantage);
  console.log('Derived Anchor sourceFacts:', JSON.stringify(anchor?.sourceFacts, null, 2));
  
  // Rebuild Product Anchor through the normal audited production path
  if (anchor) {
    await writeProductAnchorAudited({
      campaignId,
      accountId: biz[0].accountId,
      writer: "CLI / System Repair",
      source: "system_repair",
      reason: "Rebuilding Product Anchor to apply data contamination guards",
      newAnchor: anchor,
      validationDecision: "SCHEMA_VALID"
    });
    console.log('Product Anchor rebuilt successfully.');
  }

  process.exit(0);
}

run();
