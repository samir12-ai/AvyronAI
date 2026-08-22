import "dotenv/config";
import { db } from "../server/db";
import { orchestratorJobs } from "../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
  const jobs = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, 'orch_1787162650218_tt5qth'));
  const job = jobs[0];
  console.log(JSON.stringify(job, null, 2));
}
main().catch(console.error).then(() => process.exit(0));
