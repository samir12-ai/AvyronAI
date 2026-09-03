import "dotenv/config";
import { generateAccessToken } from "../server/auth";
import { db } from "../server/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const campaignId = "campaign_1773576062201_6t0oxi";
  const accountId = "a2d87878-a1e9-41ea-a8a5-90beff569673";

  const allUsers = await db.select().from(users).where(eq(users.accountId, accountId)).limit(1);
  const user = allUsers[0] || { id: "test_user_id", email: "operator@avyron.ai", accountId };
  const token = generateAccessToken(user.id, user.email, user.accountId);

  const endpoints = [
    "/api/version",
    "/api/campaigns",
    `/api/plans/active/${campaignId}`,
    `/api/orchestrator/latest/${campaignId}`,
    `/api/intelligence/audience-positioning/${campaignId}`,
    `/api/audience-engine/latest?campaignId=${campaignId}`,
    `/api/dashboard/metrics?campaignId=${campaignId}`,
    `/api/autopilot/status`,
    `/api/strategy/dashboard?campaignId=${campaignId}`,
  ];

  console.log("=== FRONTEND ENDPOINTS DATA AUDIT ===");
  for (const ep of endpoints) {
    try {
      const res = await fetch("http://localhost:5000" + ep, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const data: any = await res.json();
      console.log(`\n[${res.status}] ${ep}`);
      if (ep.includes("orchestrator/latest")) {
        console.log(`  Orchestrator Latest: status=${data.status} jobId=${data.jobId} completedEngines=${data.completedEngines?.length}`);
      } else if (ep.includes("plans/active")) {
        console.log(`  Active Plan: id=${data.id || data.plan?.id} status=${data.status || data.plan?.status} title=${data.title || data.plan?.title}`);
      } else if (ep.includes("audience-positioning")) {
        console.log(`  Audience Positioning: targetAudience.segmentId=${data.data?.targetAudience?.segmentId} title=${data.data?.targetAudience?.title}`);
      } else if (ep.includes("dashboard/metrics")) {
        console.log(`  Dashboard Metrics: spend=${data.spend} impressions=${data.impressions} conversions=${data.conversions}`);
      } else {
        console.log(`  Data Summary: ${JSON.stringify(data).slice(0, 140)}...`);
      }
    } catch (err: any) {
      console.log(`\n[ERR] ${ep}: ${err.message}`);
    }
  }
}

main().catch(console.error);
