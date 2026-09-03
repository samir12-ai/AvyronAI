import "dotenv/config";
import { db } from "../server/db";
import { businessUnderstandingSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";

async function main() {
  const buSnapId = "90497a6c-91af-4061-b11b-5477367f8712";
  const [buSnap] = await db.select().from(businessUnderstandingSnapshots).where(eq(businessUnderstandingSnapshots.id, buSnapId)).limit(1);

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/bu_snap_dump.json",
    JSON.stringify(buSnap, null, 2),
    "utf8"
  );
  console.log("buSnap keys:", Object.keys(buSnap));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
