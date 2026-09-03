import "dotenv/config";
import { db } from "../server/db";
import { businessUnderstandingSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, buSnapId)).limit(1);
  console.log("BU Snap keys:", Object.keys(buSnap || {}));
  console.log("BU Snap raw row:", JSON.stringify(buSnap, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
