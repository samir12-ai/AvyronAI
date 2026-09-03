import "dotenv/config";
import { testApifyConnectivity } from "../server/acquisition/apify-client";

async function main() {
  console.log("Testing Apify connectivity...");
  const res = await testApifyConnectivity();
  console.log("Apify connectivity result:", res);
}

main().catch(console.error);
