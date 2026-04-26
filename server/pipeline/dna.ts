/**
 * Phase 6 — DNA lifecycle.
 *
 * Locked by Samir 2026-04-20 (rev 2):
 *   - Operator-only transitions: proposed → active → paused → retired.
 *     No autonomous transitions. Period.
 *   - At most one ACTIVE DNA per (account, campaign). Enforced at the DB
 *     level via a partial unique index on pipeline_dna.
 *   - Editing the hypothesis on an active DNA does NOT mint a new dna_id.
 *     A pipeline_dna_versions row is appended for audit. The cluster
 *     baseline (which keys on dna_id) survives the wording change.
 *   - Activate retires the prior active DNA in the same transaction.
 */
import { db } from "../db";
import { pipelineDna, pipelineDnaVersions, type PipelineDna } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

export type DnaStatus = "proposed" | "active" | "paused" | "retired";

export class DnaLifecycleError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DnaLifecycleError";
  }
}

function snapshot(tx: typeof db, dnaId: string, hypothesis: string, status: DnaStatus, changedBy: string | null, reason: string | null) {
  return tx.insert(pipelineDnaVersions).values({
    dnaId, hypothesis, status, changedBy: changedBy ?? undefined, reason: reason ?? undefined,
  });
}

export async function getActiveDna(accountId: string, campaignId: string): Promise<PipelineDna | null> {
  const rows = await db.select().from(pipelineDna).where(
    and(
      eq(pipelineDna.accountId, accountId),
      eq(pipelineDna.campaignId, campaignId),
      eq(pipelineDna.status, "active"),
    ),
  ).limit(1);
  return rows[0] ?? null;
}

export async function listDnaForCampaign(accountId: string, campaignId: string): Promise<PipelineDna[]> {
  return db.select().from(pipelineDna).where(
    and(eq(pipelineDna.accountId, accountId), eq(pipelineDna.campaignId, campaignId)),
  ).orderBy(sql`${pipelineDna.createdAt} DESC`);
}

export async function createDna(opts: {
  accountId: string;
  campaignId: string;
  hypothesis: string;
  createdBy?: string | null;
  notes?: string | null;
}): Promise<PipelineDna> {
  if (!opts.hypothesis || !opts.hypothesis.trim()) {
    throw new DnaLifecycleError("INVALID_HYPOTHESIS", "hypothesis required");
  }
  const inserted = await db.insert(pipelineDna).values({
    accountId: opts.accountId,
    campaignId: opts.campaignId,
    hypothesis: opts.hypothesis.trim(),
    status: "proposed",
    createdBy: opts.createdBy ?? undefined,
    notes: opts.notes ?? undefined,
  }).returning();
  const row = inserted[0];
  await snapshot(db, row.id, row.hypothesis, "proposed", opts.createdBy ?? null, "created");
  return row;
}

export async function activateDna(opts: {
  dnaId: string;
  changedBy?: string | null;
  reason?: string | null;
}): Promise<PipelineDna> {
  return db.transaction(async (tx) => {
    // Lock the target row.
    const targetRows = await tx.execute<{ id: string; account_id: string; campaign_id: string; status: string; hypothesis: string }>(
      sql`SELECT id, account_id, campaign_id, status, hypothesis FROM pipeline_dna WHERE id = ${opts.dnaId} FOR UPDATE`,
    );
    const target = (targetRows.rows ?? targetRows as any)[0];
    if (!target) throw new DnaLifecycleError("UNKNOWN_DNA", `dna ${opts.dnaId} not found`);
    if (target.status === "retired") throw new DnaLifecycleError("INVALID_TRANSITION", "cannot activate a retired DNA");
    if (target.status === "active") {
      // Idempotent re-activate.
      const rows = await tx.select().from(pipelineDna).where(eq(pipelineDna.id, opts.dnaId)).limit(1);
      return rows[0];
    }

    // Lock-and-retire the prior active row, if any.
    const priorRows = await tx.execute<{ id: string; hypothesis: string }>(
      sql`SELECT id, hypothesis FROM pipeline_dna
          WHERE account_id = ${target.account_id} AND campaign_id = ${target.campaign_id} AND status = 'active'
          FOR UPDATE`,
    );
    const prior = (priorRows.rows ?? priorRows as any)[0];
    if (prior) {
      const now = new Date();
      await tx.update(pipelineDna).set({ status: "retired", retiredAt: now }).where(eq(pipelineDna.id, prior.id));
      await snapshot(tx as any, prior.id, prior.hypothesis, "retired", opts.changedBy ?? null, `retired_on_activate_of:${opts.dnaId}`);
    }

    const now = new Date();
    const updated = await tx.update(pipelineDna)
      .set({ status: "active", activatedAt: now })
      .where(eq(pipelineDna.id, opts.dnaId))
      .returning();
    const row = updated[0];
    await snapshot(tx as any, row.id, row.hypothesis, "active", opts.changedBy ?? null, opts.reason ?? "activate");
    return row;
  });
}

export async function pauseDna(opts: { dnaId: string; changedBy?: string | null; reason?: string | null }): Promise<PipelineDna> {
  const rows = await db.select().from(pipelineDna).where(eq(pipelineDna.id, opts.dnaId)).limit(1);
  const row = rows[0];
  if (!row) throw new DnaLifecycleError("UNKNOWN_DNA", `dna ${opts.dnaId} not found`);
  if (row.status === "retired") throw new DnaLifecycleError("INVALID_TRANSITION", "cannot pause a retired DNA");
  if (row.status === "paused") return row;
  if (row.status !== "active") throw new DnaLifecycleError("INVALID_TRANSITION", `cannot pause from ${row.status}`);
  const updated = await db.update(pipelineDna).set({ status: "paused" }).where(eq(pipelineDna.id, opts.dnaId)).returning();
  await snapshot(db, opts.dnaId, row.hypothesis, "paused", opts.changedBy ?? null, opts.reason ?? "pause");
  return updated[0];
}

export async function retireDna(opts: { dnaId: string; changedBy?: string | null; reason?: string | null }): Promise<PipelineDna> {
  const rows = await db.select().from(pipelineDna).where(eq(pipelineDna.id, opts.dnaId)).limit(1);
  const row = rows[0];
  if (!row) throw new DnaLifecycleError("UNKNOWN_DNA", `dna ${opts.dnaId} not found`);
  if (row.status === "retired") return row;
  const now = new Date();
  const updated = await db.update(pipelineDna).set({ status: "retired", retiredAt: now }).where(eq(pipelineDna.id, opts.dnaId)).returning();
  await snapshot(db, opts.dnaId, row.hypothesis, "retired", opts.changedBy ?? null, opts.reason ?? "retire");
  return updated[0];
}

/**
 * Edit hypothesis on an existing DNA. Does NOT mint a new dna_id (Samir-locked
 * §6.2). Appends a versions row for audit. The cluster baseline survives.
 */
export async function editDnaHypothesis(opts: {
  dnaId: string;
  hypothesis: string;
  changedBy?: string | null;
  reason?: string | null;
}): Promise<PipelineDna> {
  if (!opts.hypothesis || !opts.hypothesis.trim()) {
    throw new DnaLifecycleError("INVALID_HYPOTHESIS", "hypothesis required");
  }
  const rows = await db.select().from(pipelineDna).where(eq(pipelineDna.id, opts.dnaId)).limit(1);
  const row = rows[0];
  if (!row) throw new DnaLifecycleError("UNKNOWN_DNA", `dna ${opts.dnaId} not found`);
  if (row.status === "retired") throw new DnaLifecycleError("INVALID_TRANSITION", "cannot edit a retired DNA");
  const next = opts.hypothesis.trim();
  const updated = await db.update(pipelineDna).set({ hypothesis: next }).where(eq(pipelineDna.id, opts.dnaId)).returning();
  await snapshot(db, opts.dnaId, next, row.status as DnaStatus, opts.changedBy ?? null, opts.reason ?? "edit_hypothesis");
  return updated[0];
}

export async function listDnaVersions(dnaId: string) {
  return db.select().from(pipelineDnaVersions).where(eq(pipelineDnaVersions.dnaId, dnaId)).orderBy(sql`${pipelineDnaVersions.changedAt} DESC`);
}
