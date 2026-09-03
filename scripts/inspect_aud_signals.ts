import "dotenv/config";
import { db } from "../server/db";
import { audienceSnapshots } from "../shared/schema";
import { eq } from "drizzle-orm";
import fs from "fs";

async function main() {
  const audSnapId = "5921969d-4b59-48e0-9373-a78d708683d8";
  const [audSnap] = await db.select().from(audienceSnapshots).where(eq(audienceSnapshots.id, audSnapId)).limit(1);

  const structuredSignals = typeof audSnap.structuredSignals === "string" ? JSON.parse(audSnap.structuredSignals) : audSnap.structuredSignals;
  const signalLineage = typeof audSnap.signalLineage === "string" ? JSON.parse(audSnap.signalLineage) : audSnap.signalLineage;
  const audiencePains = typeof audSnap.audiencePains === "string" ? JSON.parse(audSnap.audiencePains) : audSnap.audiencePains;

  fs.writeFileSync(
    "C:/Users/mahmo/.gemini/antigravity/brain/9555ab3d-27e6-4460-b3ad-232e0d7ef085/scratch/sara_ft_aud_signals.json",
    JSON.stringify({ structuredSignals, signalLineage, audiencePains }, null, 2),
    "utf8"
  );
  console.log(`Structured signals count: ${structuredSignals?.length || 0}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
