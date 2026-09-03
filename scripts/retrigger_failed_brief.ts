import "dotenv/config";
import { db } from "../server/db";
import { watchtowerStrategicBriefs, pipelineChangeEvents } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { executeBriefJob } from "../server/watchtower/strategic-brief-runner";
import { randomUUID } from "crypto";

async function retrigger() {
  const eventId = "wt_1787326800284_do2uglv";
  console.log("=== RETRIGGERING STRATEGIC BRIEF FOR EVENT:", eventId, "===");

  const [event] = await db
    .select()
    .from(pipelineChangeEvents)
    .where(eq(pipelineChangeEvents.id, eventId))
    .limit(1);

  if (!event) {
    console.error("Event not found:", eventId);
    process.exit(1);
  }

  // Create a new queued brief row
  const newBriefId = `brief_${Date.now()}_${randomUUID().slice(0, 7)}`;
  const [newBrief] = await db
    .insert(watchtowerStrategicBriefs)
    .values({
      id: newBriefId,
      eventId: event.id,
      campaignId: event.campaignId,
      accountId: event.accountId,
      status: "queued",
      isLatest: false,
    })
    .returning();

  console.log("Created new queued brief row:", newBrief.id);

  // Execute the pipeline using our updated code
  await executeBriefJob(newBrief.id);

  // Read back the result
  const [updatedBrief] = await db
    .select()
    .from(watchtowerStrategicBriefs)
    .where(eq(watchtowerStrategicBriefs.id, newBrief.id))
    .limit(1);

  console.log("\n=== COMPLETED BRIEF STATUS ===");
  console.log("Brief ID:", updatedBrief.id);
  console.log("Status:", updatedBrief.status);
  console.log("Is Latest:", updatedBrief.isLatest);
  console.log("Validated Confidence:", updatedBrief.finalValidatedConfidence);
  console.log("Executive Summary:", (updatedBrief.brief as any)?.executiveSummary);
  console.log("Claims Count:", (updatedBrief.brief as any)?.claims?.length);
  console.log("Judge Result Verdict:", (updatedBrief.judgeResult as any)?.verdict);
  console.log("Violations:", updatedBrief.deterministicViolations);

  process.exit(0);
}

retrigger().catch((err) => {
  console.error(err);
  process.exit(1);
});
