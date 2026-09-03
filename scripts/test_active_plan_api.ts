import "dotenv/config";
import jwt from "jsonwebtoken";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "avyron_jwt_secret_" + (process.env.REPL_ID || "dev");
  
  const token = jwt.sign(
    { userId: "1", email: "demo@avyron.ai", accountId },
    JWT_SECRET,
    { audience: "avyron-ai", issuer: "avyron-auth", expiresIn: "7d" }
  );

  const res = await fetch("http://localhost:5000/api/plans/active/campaign_1773576062201_6t0oxi", {
    headers: {
      "Authorization": `Bearer ${token}`
    }
  });

  console.log("Status:", res.status);
  const data = await res.json();
  const planPayload = data.plan?.planJson ? (typeof data.plan.planJson === 'string' ? JSON.parse(data.plan.planJson) : data.plan.planJson) : null;
  
  console.log("\n==================================================");
  console.log("ACTIVE PLAN API RESPONSE SUMMARY");
  console.log("==================================================");
  console.log("hasPlan:", data.hasPlan);
  console.log("runId (Job ID):", data.runId);
  console.log("planId:", data.plan?.id);
  console.log("plan status:", data.plan?.status);
  console.log("approvedLanes Count:", planPayload?.approvedLanes?.length);
  console.log("buyerConversionJourneys Count:", planPayload?.buyerConversionJourneys?.length);
  console.log("Journey 0 Lane ID:", planPayload?.buyerConversionJourneys?.[0]?.laneId);
  console.log("Journey 0 Label:", planPayload?.buyerConversionJourneys?.[0]?.laneLabel);
}

main().catch(console.error);
