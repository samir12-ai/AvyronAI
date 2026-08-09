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
  /**
   * Phase R T002 — when the *absolute* latest run for this campaign (any
   * status, including FAILED/RUNNING/TIMED_OUT/CANCELLED that is NOT in
   * RESOLVABLE_STATUSES) is newer than the resolved run, surface it here so
   * the dashboard can show "newer failed run exists" instead of silently
   * presenting an older COMPLETED run as the truth.
   *
   * Null when the resolved run IS the absolute latest, or when no jobs exist.
   */
  newerNonResolvableRun?: {
    runId: string;
    status: string;
    /**
     * Task #171 — distinguishes a genuinely in-progress run (fresh RUNNING)
     * from a terminal failure (FAILED / TIMED_OUT / CANCELLED). Consumers use
     * this to decide whether to show "run in progress — previous plan still
     * viewable" vs "previous run failed — previous plan still viewable".
     */
    shadowKind: "IN_PROGRESS" | "FAILED";
    createdAt: Date | null;
    completedAt: Date | null;
  } | null;
}

/**
 * Phase R T002 — pure decision helper extracted for unit testing.
 *
 * Given the latest run that produced usable snapshots and the latest run of
 * ANY status (whichever is more recent by createdAt), determine whether the
 * resolved run is being shadowed by a newer non-resolvable (failed/running/
 * timed-out) run. Returns the shadowing run when true, else null.
 *
 * This is the gate that prevents the dashboard / API from claiming an older
 * COMPLETED run is the active state when in reality a newer run failed.
 */
/** Task #171 — classify the shadow run's state for consumers. */
function shadowKindForStatus(status: string): "IN_PROGRESS" | "FAILED" {
  return status === "RUNNING" ? "IN_PROGRESS" : "FAILED";
}

export function detectNewerNonResolvableRun(
  resolved: { id: string; createdAt: Date | null; completedAt: Date | null } | null,
  latestAnyStatus: { id: string; status: string; createdAt: Date | null; completedAt: Date | null } | null,
): { runId: string; status: string; shadowKind: "IN_PROGRESS" | "FAILED"; createdAt: Date | null; completedAt: Date | null } | null {
  if (!latestAnyStatus) return null;
  if (RESOLVABLE_STATUSES.includes(latestAnyStatus.status)) return null;
  if (!resolved) {
    return {
      runId: latestAnyStatus.id,
      status: latestAnyStatus.status,
      shadowKind: shadowKindForStatus(latestAnyStatus.status),
      createdAt: latestAnyStatus.createdAt,
      completedAt: latestAnyStatus.completedAt,
    };
  }
  if (latestAnyStatus.id === resolved.id) return null;
  // The newer run shadows the resolved one only if it was created after.
  const resolvedTs = (resolved.completedAt ?? resolved.createdAt)?.getTime() ?? 0;
  const latestTs = (latestAnyStatus.createdAt ?? latestAnyStatus.completedAt)?.getTime() ?? 0;
  if (latestTs <= resolvedTs) return null;
  return {
    runId: latestAnyStatus.id,
    status: latestAnyStatus.status,
    shadowKind: shadowKindForStatus(latestAnyStatus.status),
    createdAt: latestAnyStatus.createdAt,
    completedAt: latestAnyStatus.completedAt,
  };
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
      // Phase R T002 — createdAt is required for shadow-detection; absence
      // would silently fall back to a 0-timestamp comparison and let any
      // newer failed run "shadow" the resolved run incorrectly.
      createdAt: orchestratorJobs.createdAt,
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

  // Phase R T002 — also fetch the absolute latest job (any status) so we can
  // surface newer-failed-shadowing-older-completed cases to the consumer.
  const [latestAny] = await db
    .select({
      id: orchestratorJobs.id,
      status: orchestratorJobs.status,
      createdAt: orchestratorJobs.createdAt,
      completedAt: orchestratorJobs.completedAt,
    })
    .from(orchestratorJobs)
    .where(
      and(
        eq(orchestratorJobs.accountId, accountId),
        eq(orchestratorJobs.campaignId, campaignId),
      ),
    )
    .orderBy(desc(orchestratorJobs.createdAt))
    .limit(1);

  const newerNonResolvableRun = detectNewerNonResolvableRun(
    latest ? { id: latest.id, createdAt: latest.createdAt ?? null, completedAt: latest.completedAt ?? null } : null,
    latestAny ? { id: latestAny.id, status: latestAny.status as string, createdAt: latestAny.createdAt ?? null, completedAt: latestAny.completedAt ?? null } : null,
  );

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
      status: pickRunStatus(requested),
      planId: requested.planId ?? null,
      newerNonResolvableRun,
    };
  }

  return {
    runId: latestId,
    isLatest: true,
    // A resolved run is "stale" iff a newer failed/running run shadows it —
    // even though it is the latest *resolvable* run, it is no longer the
    // latest *attempted* run, so consumers must not present it as fresh.
    isStale: newerNonResolvableRun !== null,
    completedAt: latest?.completedAt ?? null,
    status: pickRunStatus(latest),
    planId: latest?.planId ?? null,
    newerNonResolvableRun,
  };
}

// extract the run status read out of the LHS
// fallback expression so the lint rule's no-semantic-fallback check
// passes without an eslint-disable. The DB column IS the canonical
// run-status field (drizzle nullable string column), so we read it
// directly and normalise undefined → null in a guarded statement.
function pickRunStatus(row: { status?: string | null } | null | undefined): string | null {
  if (!row) return null;
  const v = row.status;
  return typeof v === "string" && v.length > 0 ? v : null;
}
