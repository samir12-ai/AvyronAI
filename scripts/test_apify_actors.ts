import "dotenv/config";
import { apifyRequest } from "../server/acquisition/apify-client";

async function main() {
  console.log("Checking Apify actors / store...");
  // Check our user / runs
  const runs = await apifyRequest("/actor-runs?limit=10&desc=true");
  console.log("Recent Apify runs:", runs.data.items.map((r: any) => ({ id: r.id, actId: r.actId, status: r.status, startedAt: r.startedAt })));
}

main().catch(console.error);
