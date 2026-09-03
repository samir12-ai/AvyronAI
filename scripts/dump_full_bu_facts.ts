import "dotenv/config";
import { db } from "../server/db";
import { businessUnderstandingSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";

async function main() {
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, buSnapId)).limit(1);

  const productUnderstanding = typeof buSnap?.productUnderstanding === "string" ? JSON.parse(buSnap.productUnderstanding) : buSnap?.productUnderstanding;
  const targetUnderstanding = typeof buSnap?.targetUnderstanding === "string" ? JSON.parse(buSnap.targetUnderstanding) : buSnap?.targetUnderstanding;
  const discoveredOfferings = typeof buSnap?.discoveredOfferings === "string" ? JSON.parse(buSnap.discoveredOfferings) : buSnap?.discoveredOfferings;

  const productFacts = productUnderstanding?.productTruthFacts || [];
  const targetRoles = targetUnderstanding?.targetRoles || [];

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/sara_ft_canonical_product_facts.json",
    JSON.stringify({ productFacts, targetRoles, discoveredOfferings, productUnderstanding, targetUnderstanding }, null, 2),
    "utf8"
  );
  console.log(`Extracted ${productFacts.length} product facts and ${targetRoles.length} target roles.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
