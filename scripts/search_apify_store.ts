import "dotenv/config";
import { apifyRequest } from "../server/acquisition/apify-client";

async function main() {
  console.log("Searching Apify store for review scrapers...");
  try {
    const res = await apifyRequest("/store?search=trustpilot&limit=5");
    console.log("Trustpilot actors:", res.data?.items?.map((a: any) => ({ id: a.id, name: a.name, username: a.username, title: a.title })));
  } catch (e) {
    console.error("Search error:", e);
  }

  try {
    const res2 = await apifyRequest("/store?search=google+reviews&limit=5");
    console.log("Google reviews actors:", res2.data?.items?.map((a: any) => ({ id: a.id, name: a.name, username: a.username, title: a.title })));
  } catch (e) {
    console.error("Search error 2:", e);
  }
}

main().catch(console.error);
