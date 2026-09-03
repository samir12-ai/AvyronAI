import 'dotenv/config';
import { generateAccessToken } from "../auth";
import fetch from "node-fetch";

async function main() {
  const accountId = 'a2d87878-a1e9-41ea-a8a5-90beff569673';
  const campaignId = 'campaign_1773576062201_6t0oxi';
  const token = generateAccessToken("user_1", "admin@avyron.ai", accountId);

  console.log("=== CALLING ACTIVE PLAN API ===");
  try {
    const res = await fetch(`http://localhost:5000/api/plans/active/${campaignId}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log("Status:", res.status);
    const data = await res.json() as any;
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error("API Call Failed:", err.message);
  }

  process.exit(0);
}

main();

