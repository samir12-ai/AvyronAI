import "dotenv/config";
import jwt from "jsonwebtoken";

async function main() {
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";
  const campaignId = "campaign_1773576062201_6t0oxi";
  const secret = process.env.JWT_SECRET || process.env.SESSION_SECRET || "avyron-secret";
  
  const token = jwt.sign(
    { userId: accountId, email: "admin@avyron.ai", accountId },
    secret,
    { expiresIn: "14d", audience: "avyron-ai", issuer: "avyron-auth" }
  );

  const res = await fetch(`http://127.0.0.1:8808/api/plans/active/${campaignId}?accountId=${accountId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  console.log("Response status:", res.status);
  console.log("Run ID:", data.runId);
  console.log("Plan ID:", data.planId || data.plan?.id);
  console.log("Is Latest:", data.isLatest);
  console.log("data.plan keys:", Object.keys(data.plan || {}));
  const sections = data.plan?.sections;
  console.log("sections keys:", Object.keys(sections || {}));
  console.log("Strategic Summary Strategy:\n", sections?.strategicSummary?.strategy);
  console.log("\nStrategic Summary Target Audience:\n", sections?.strategicSummary?.targetAudience);
  console.log("\nStrategic Summary Rationale:\n", sections?.strategicSummary?.rationale);
  console.log("\nBrand Spine Umbrella:", sections?.brandSpine?.umbrellaPositionName);
  console.log("Brand Spine Contrast:", sections?.brandSpine?.contrastAxis);
  console.log("\nApproved Lanes Count:", sections?.approvedLanes?.length);
  for (let i = 0; i < (sections?.approvedLanes?.length || 0); i++) {
    console.log(`Lane [${i+1}]: ${sections.approvedLanes[i].title} - ${sections.approvedLanes[i].messagingDirection}`);
  }
  if (sections?.businessRepresentation) {
    console.log("\nBusiness Representation Strategy:\n", sections.businessRepresentation.strategicSummary?.strategy);
  }
}

main().catch(console.error);
