import { db } from "../db";
import { orchestratorJobs } from "@shared/schema";
import { and, eq, desc, inArray } from "drizzle-orm";

// Statuses that indicate a run produced usable engine snapshots.
// COMPLETED              -> all engines ran end-to-end
// BLOCKED_BY_INTEGRITY   -> upstream engines (audience..integrity) ran;
//                          downstream were correctly gated. Snapshots that
//                          exist are valid and must be surfaced.
// BLOCKED                -> legacy block status; upstream snapshots usable.
// PARTIAL                -> some engines failed; valid snapshots still surfaced.
const RESOLVABLE_STATUSES = [
  "COMPLETED",
  "BLOCKED_BY_INTEGRITY",
  "BLOCKED",
  "PARTIAL",
];

export interface ResolvedRun {
  runId: string | null;
  isLatest: boolean;
  isStale: boolean;
  completedAt: Date | null;
  status: string | null;
  planId: string | null;
}

export async function resolveRunId(
  campaignId: string,
  accountId: string,
  requestedRunId?: string | null,
): Promise<ResolvedRun> {
  const [latest] = await db
    .select({
      id: orchestratorJobs.id,
      status: orchestratorJobs.status,
      completedAt: orchestratorJobs.completedAt,
      planId: orchestratorJobs.planId,
    })
    .from(orchestratorJobs)
    .where(
      and(
        eq(orchestratorJobs.accountId, accountId),
        eq(orchestratorJobs.campaignId, campaignId),
        inArray(orchestratorJobs.status, RESOLVABLE_STATUSES),
      ),
    )
    .orderBy(desc(orchestratorJobs.completedAt))
    .limit(1);

  const latestId = latest?.id ?? null;

  if (requestedRunId) {
    const [requested] = await db
      .select({
        id: orchestratorJobs.id,
        status: orchestratorJobs.status,
        completedAt: orchestratorJobs.completedAt,
        planId: orchestratorJobs.planId,
      })
      .from(orchestratorJobs)
      .where(
        and(
          eq(orchestratorJobs.accountId, accountId),
          eq(orchestratorJobs.campaignId, campaignId),
          eq(orchestratorJobs.id, requestedRunId),
        ),
      )
      .limit(1);

    if (!requested) {
      throw new Error(`RUN_NOT_FOUND: ${requestedRunId} for campaign ${campaignId}`);
    }

    return {
      runId: requested.id,
      isLatest: latestId === requested.id,
      isStale: latestId !== null && latestId !== requested.id,
      completedAt: requested.completedAt ?? null,
      status: requested.status ?? null,
      planId: requested.planId ?? null,
    };
  }

  return {
    runId: latestId,
    isLatest: true,
    isStale: false,
    completedAt: latest?.completedAt ?? null,
    status: latest?.status ?? null,
    planId: latest?.planId ?? null,
  };
}
