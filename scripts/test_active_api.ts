import "dotenv/config";
import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET || "avyron-secret-key-2026";
const ACCOUNT = "a2d87878-a1e9-41ea-a8a5-90beff569673";
const USER_ID = "demo-user-1";
const CAMPAIGN = "campaign_1773576062201_6t0oxi";

async function main() {
  const token = jwt.sign(
    { userId: USER_ID, email: "demo@avyron.ai", accountId: ACCOUNT },
    SECRET,
    { expiresIn: "7d", audience: "avyron-ai", issuer: "avyron-auth" }
  );

  console.log("Testing active plan API with valid JWT...");

  const res = await fetch(`http://127.0.0.1:8808/api/plans/active/${CAMPAIGN}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-account-id": ACCOUNT
    }
  });

  console.log("HTTP status:", res.status);
  const data = await res.json();
  console.log("hasPlan:", data.hasPlan);
  console.log("runId:", data.runId);
  console.log("isLatest:", data.isLatest);
  console.log("plan ID:", data.plan?.id);
  console.log("plan campaignId:", data.plan?.campaignId);
  console.log("plan createdAt:", data.plan?.createdAt);
  console.log("sections:", Object.keys(data.plan?.sections || {}));
  console.log("strategicLanes:", (data.plan?.sections?.strategicLanes || []).map((l: any) => l.title));
}

main().catch(err => { console.error(err); process.exit(1); });
