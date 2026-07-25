import { db } from "../db";
import { pipelineRuns, type PipelineRun } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { Lane } from "@shared/contracts";
import { PipelineValidationError } from "./errors";

export type RunTrigger = "cron" | "manual" | "approval" | "bridge";
export type RunStatus = "pending" | "running" | "validated" | "rejected" | "failed";

export interface CreateRunInput {
  accountId?: string;
  campaignId: string;
  lane: Lane;
  trigger?: RunTrigger;
  parentRunId?: string;
}

export async function createRun(input: CreateRunInput): Promise<PipelineRun> {
  if (!input.campaignId) {
    throw new PipelineValidationError("MISSING_CAMPAIGN_ID", "campaignId required");
  }
  const [row] = await db
    .insert(pipelineRuns)
    .values({
      accountId: input.accountId,
      campaignId: input.campaignId,
      lane: input.lane,
      trigger: input.trigger ?? "manual",
      parentRunId: input.parentRunId ?? null,
      status: "pending",
    })
    .returning();
  return row;
}

export async function startRun(runId: string): Promise<PipelineRun> {
  const run = await getRun(runId);
  if (run.status !== "pending") {
    throw new PipelineValidationError("INVALID_RUN_TRANSITION", `cannot start run in status=${run.status}`, { runId });
  }
  const [row] = await db
    .update(pipelineRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(pipelineRuns.id, runId))
    .returning();
  return row;
}

export async function finishRun(runId: string, summary?: string): Promise<PipelineRun> {
  const run = await getRun(runId);
  if (run.status !== "running") {
    throw new PipelineValidationError("INVALID_RUN_TRANSITION", `cannot finish run in status=${run.status}`, { runId });
  }
  const [row] = await db
    .update(pipelineRuns)
    .set({ status: "validated", finishedAt: new Date(), summary: summary ?? null })
    .where(eq(pipelineRuns.id, runId))
    .returning();
  return row;
}

export async function rejectRun(runId: string, reasons: string[]): Promise<PipelineRun> {
  const [row] = await db
    .update(pipelineRuns)
    .set({
      status: "rejected",
      finishedAt: new Date(),
      rejectionReasons: JSON.stringify(reasons),
    })
    .where(eq(pipelineRuns.id, runId))
    .returning();
  return row;
}

export async function failRun(runId: string, reason: string): Promise<PipelineRun> {
  const [row] = await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      rejectionReasons: JSON.stringify([reason]),
    })
    .where(eq(pipelineRuns.id, runId))
    .returning();
  return row;
}

export async function getRun(runId: string): Promise<PipelineRun> {
  const [row] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
  if (!row) {
    throw new PipelineValidationError("RUN_NOT_FOUND", `run ${runId} not found`, { runId });
  }
  return row;
}

export async function listRuns(filter?: { lane?: Lane; status?: RunStatus; limit?: number }): Promise<PipelineRun[]> {
  const limit = Math.min(filter?.limit ?? 50, 200);
  const rows = await db.select().from(pipelineRuns).limit(limit);
  return rows
    .filter((r) => (filter?.lane ? r.lane === filter.lane : true))
    .filter((r) => (filter?.status ? r.status === filter.status : true))
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}
